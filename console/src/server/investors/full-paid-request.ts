/**
 * D138 (owner ruling 10 Oct 2026, D137 open question 6) — A KAM ASKS FINANCE TO CONFIRM THE FULL PAYMENT; A KAM NEVER STAMPS IT.
 *
 * A KAM reads no money (D12/D40) and Zoho gives the KAM profile read-only on Converted_* (zoho/changes/2026-10-10-sandbox.md), so
 * the KAM's old "Mark fully paid…" became "Ask Finance to confirm full payment": a request that lands on Finance's to-do (the G1
 * queue pattern — server/queues/queue.ts reads it, one row per open request). Finance confirms by matching the remaining money
 * (the automatic full conversion, ./full-paid auto) or by the manual stamp (Finance, Digital Infrastructure).
 *
 * Where it lives (Zoho is the only store, rule 1):
 *   - the KAM's note as a Note on the investor's Contact, under the KAM's own name — Zoho records who and when (Created_By /
 *     Created_Time); the note's words never reach a log;
 *   - LLP_UnitAllocation_Module.Convert_Requested_At (DateTime, PROPOSED in zoho/changes/2026-10-10-d138-fields.md) on the allotment:
 *     the flag Finance's queue reads. No user lookup (the module is at its limit since Converted_By); the requester is the Note's
 *     author and the Contact's KAM. The name avoids the money words the account-management projection refuses.
 * Order: the Note first (no Note, no request); then one guarded write (If-Unmodified-Since, D44) on the KAM's own token (rule 2);
 * a failed write takes the Note back. Until the field exists Zoho refuses it as invalid-data naming it → `fields-missing`, said.
 *
 * Refused: a seat that is not a KAM; an allotment that is not the page's investor's (`not-visible`); not Reserved; already stamped
 * (`already-converted`); D138's supplementary gate (`supplementary-not-signed`, 409 — before the signed supplementary the full
 * payment cannot be confirmed, so it is not asked for). A request already open answers `already` and writes nothing.
 * One ops-log line (`full-paid-request` / `requested`, ids only). Nothing is cached.
 */
import type { UserCredential, ZohoClient, ZohoRecord } from "../../lib/zoho/client";
import { isUserCredential } from "../../lib/zoho/client";
import type { ZohoFailureKind } from "../../lib/zoho/errors";
import type { OpsLog } from "../../lib/zoho/log";
import { checkAmProjection, MODULES } from "../data/projections";
import { ALLOTMENTS, CONVERTED_FIELDS, istIso, stampOf, supplementarySigned, SUPPLEMENTARY_NOT_SIGNED_TEXT } from "./full-paid";

export const REQUEST_FIELD = "Convert_Requested_At";
export const REQUEST_NOTE_TITLE = "Asked Finance to confirm the full payment (D138)";
export const REQUEST_NOTE_MIN = 10;
export const REQUEST_NOTE_MAX = 500;
/** What the KAM's read selects of the allotment: no money name (the account-management wall, checked at load). */
export const REQUEST_ALLOT_FIELDS: readonly string[] = checkAmProjection(MODULES.amAllotments, [
  "id", "Customer", "Allocation_Status", "Supplementary_Verified_At", REQUEST_FIELD, "Modified_Time",
]);
const RECORD_ID = /^\d{15,22}$/;
const RECORD_PREFIX = /^\d{6,16}$/;
const SESSION_ID = /^[A-Za-z0-9_-]{16,128}$/;
const ZDT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/;

export type RequestRefusal = "invalid-request" | "not-allowed" | "not-visible" | "note-short" | "not-reserved" | "already-converted"
  | "supplementary-not-signed" | "changed" | "fields-missing" | "note-failed";
export const REQUEST_MESSAGES: Readonly<Record<RequestRefusal, string>> = Object.freeze({
  "invalid-request": "Not sent — reload the investor and try again.",
  "not-allowed": "Only the account's KAM asks Finance to confirm a full payment from here.",
  "not-visible": "Not sent — this allotment is not one Zoho shows you on this investor.",
  "note-short": `Say what you were told — at least ${REQUEST_NOTE_MIN} characters. It goes on the record with your name.`,
  "not-reserved": "Only a Reserved allotment waits for its full payment — this one is not Reserved.",
  "already-converted": "This allotment is already converted in full. Nothing to ask.",
  "supplementary-not-signed": SUPPLEMENTARY_NOT_SIGNED_TEXT,
  changed: "Not sent — the allotment changed while you were looking at it. Reload and try again.",
  "fields-missing": "Not sent — the request field (Convert_Requested_At on the allotment) is not in Zoho yet. Digital Infrastructure creates it (D138). Nothing was changed.",
  "note-failed": "Not sent — your note could not be written on the investor's record, so nothing was changed. Try again.",
});

export type RequestResult =
  | { readonly ok: true; readonly value: { readonly allotmentId: string; readonly contactId: string; readonly requestedAt: string; readonly already: boolean } }
  | { readonly ok: false; readonly kind: "refused"; readonly reasonCode: RequestRefusal; readonly message: string }
  | { readonly ok: false; readonly kind: "source-error"; readonly errorKind: ZohoFailureKind | "unexpected"; readonly message: string; readonly retryable: boolean };

export interface FullPaidRequestDeps {
  readonly crm: Pick<ZohoClient, "getRecord" | "update" | "insert"> & Partial<Pick<ZohoClient, "deleteRecord">>;
  /** Fresh on the live session: the KAM seat. */
  readonly authority: { mayRequest(credential: UserCredential, sessionId: string, signal?: AbortSignal): Promise<boolean> };
  readonly log: OpsLog;
  readonly recordIdPrefix: string;
  readonly clock?: () => number;
}

const idOf = (v: unknown): string | null => {
  if (typeof v === "string" && RECORD_ID.test(v)) return v;
  const id = v && typeof v === "object" ? (v as { id?: unknown }).id : undefined;
  return typeof id === "string" && RECORD_ID.test(id) ? id : null;
};
const retryable = (k: string): boolean => k === "network" || k === "server" || k === "busy" || k === "concurrency-exceeded" || k === "rate-limited-unclassified" || k === "unexpected";
const names = (e: { field?: string | null; records?: readonly { field?: string | null }[] }, f: string): boolean =>
  [e.field, ...(e.records ?? []).map((r) => r.field)].some((x) => x === f);

export function createFullPaidRequest(deps: FullPaidRequestDeps) {
  if (!deps || typeof deps.crm?.getRecord !== "function" || typeof deps.crm?.update !== "function" || typeof deps.crm?.insert !== "function"
    || typeof deps.authority?.mayRequest !== "function" || typeof deps.log?.refusal !== "function"
    || typeof deps.recordIdPrefix !== "string" || !RECORD_PREFIX.test(deps.recordIdPrefix)) {
    throw new TypeError("full-paid-request needs crm (getRecord/update/insert), the KAM authority, the ops log and the record-id prefix");
  }
  const { crm, log } = deps;
  const now = () => { try { return (deps.clock ?? Date.now)(); } catch { return 0; } };
  const validId = (v: unknown): v is string => typeof v === "string" && RECORD_ID.test(v) && v.startsWith(deps.recordIdPrefix);
  const note = (userId: string, reason: string, ids: readonly unknown[]) =>
    log.refusal({ at: now(), actor: { kind: "user", userId }, action: "full-paid-request", reason, recordIds: ids.filter(validId) });
  const refuse = (me: string, code: RequestRefusal, ids: readonly unknown[] = []): RequestResult => {
    note(me, code, ids);
    return { ok: false, kind: "refused", reasonCode: code, message: REQUEST_MESSAGES[code] };
  };

  /** The allotment as the KAM may read it; the stamp read alongside when Zoho shows it (read-only for the KAM profile). */
  async function read(cred: UserCredential, id: string, signal?: AbortSignal): Promise<ZohoRecord | null | "error" | "fields-missing"> {
    let r = await crm.getRecord(cred, ALLOTMENTS, id, { fields: [...REQUEST_ALLOT_FIELDS, ...CONVERTED_FIELDS], signal }).catch(() => null);
    if (r && !r.ok && r.error.kind === "invalid-data") r = await crm.getRecord(cred, ALLOTMENTS, id, { fields: REQUEST_ALLOT_FIELDS, signal }).catch(() => null);
    if (r && !r.ok && r.error.kind === "invalid-data") return "fields-missing";
    if (!r) return "error";
    if (!r.ok) return r.error.kind === "not-found" || r.error.kind === "forbidden" ? null : "error";
    return r.value && r.value.id === id ? r.value : null;
  }

  return Object.freeze({
    async request(principal: unknown, allotmentId: unknown, text: unknown, pageContactId: unknown, signal?: AbortSignal): Promise<RequestResult> {
      const p = principal && typeof principal === "object" ? (principal as { credential?: unknown; sessionId?: unknown }) : null;
      if (!p || !isUserCredential(p.credential) || typeof p.sessionId !== "string" || !SESSION_ID.test(p.sessionId)) return refuse("unrecognised", "invalid-request");
      const cred = p.credential, me = cred.userId;
      let may = false;
      try { may = (await deps.authority.mayRequest(cred, p.sessionId, signal)) === true; } catch { may = false; }
      if (!may) return refuse(me, "not-allowed", [allotmentId]);
      if (!validId(allotmentId) || !validId(pageContactId)) return refuse(me, "invalid-request", []);
      const why = typeof text === "string" ? text.trim() : "";
      if (why.length < REQUEST_NOTE_MIN) return refuse(me, "note-short", [allotmentId]);
      if (why.length > REQUEST_NOTE_MAX) return refuse(me, "invalid-request", [allotmentId]);
      const a = await read(cred, allotmentId, signal);
      if (a === "error") return { ok: false, kind: "source-error", errorKind: "unexpected", message: "Not sent — Zoho is not answering. Try again.", retryable: true };
      if (a === "fields-missing") return refuse(me, "fields-missing", [allotmentId]);
      if (!a || idOf(a.Customer) !== pageContactId) return refuse(me, "not-visible", [allotmentId]);
      if (stampOf(a)) return refuse(me, "already-converted", [allotmentId]);
      if (a.Allocation_Status !== "Reserved") return refuse(me, "not-reserved", [allotmentId]);
      if (!supplementarySigned(a)) return refuse(me, "supplementary-not-signed", [allotmentId, pageContactId]);
      const open = typeof a[REQUEST_FIELD] === "string" && ZDT.test(a[REQUEST_FIELD] as string) ? (a[REQUEST_FIELD] as string) : null;
      if (open) return { ok: true, value: { allotmentId, contactId: pageContactId, requestedAt: open, already: true } };
      const mt = typeof a.Modified_Time === "string" && ZDT.test(a.Modified_Time) ? a.Modified_Time : null;
      if (!mt) return { ok: false, kind: "source-error", errorKind: "unexpected", message: "Not sent — Zoho is not answering. Try again.", retryable: true };

      /* the KAM's words first, on the Contact, under their own name — no Note, no request */
      const n = await crm.insert(cred, "Notes", [{ Note_Title: REQUEST_NOTE_TITLE, Note_Content: why, Parent_Id: { module: { api_name: "Contacts" }, id: pageContactId } }], { signal }).catch(() => null);
      const noteId = n && n.ok && n.value.length === 1 && n.value[0]!.ok ? n.value[0]!.id : null;
      if (!noteId) return refuse(me, "note-failed", [allotmentId, pageContactId]);
      const at = istIso(now());
      const w = await crm.update(cred, ALLOTMENTS, allotmentId, { [REQUEST_FIELD]: at }, { ifUnmodifiedSince: mt, signal })
        .catch(() => ({ ok: false as const, error: { kind: "unexpected" as const, status: 0 } }));
      if (!w.ok) {
        try { if (typeof crm.deleteRecord === "function") { const d = await crm.deleteRecord(cred, "Notes", noteId, { signal }); if (!d.ok) note(me, "request-note-left", [pageContactId, noteId]); } }
        catch { note(me, "request-note-left", [pageContactId, noteId]); }
        const e = w.error as { kind: string; field?: string | null; records?: readonly { field?: string | null }[] };
        if (e.kind === "invalid-data" && names(e, REQUEST_FIELD)) return refuse(me, "fields-missing", [allotmentId]);
        if (e.kind === "conflict") return refuse(me, "changed", [allotmentId]);
        if (e.kind === "not-found" || e.kind === "forbidden") return refuse(me, "not-visible", [allotmentId]);
        note(me, "request-write-failed-" + e.kind, [allotmentId]);
        return { ok: false, kind: "source-error", errorKind: e.kind as ZohoFailureKind, message: "Not sent — Zoho did not take it. Try again.", retryable: retryable(e.kind) };
      }
      note(me, "requested", [allotmentId, pageContactId, noteId]);
      return { ok: true, value: { allotmentId, contactId: pageContactId, requestedAt: at, already: false } };
    },
  });
}
export type FullPaidRequest = ReturnType<typeof createFullPaidRequest>;
