/**
 * D137 ruling 3 — A RESERVED ALLOTMENT CONVERTS IN FULL WHEN THE COMMITTED AMOUNT IS IN.
 *
 * "Fully converted" = the allotment carries the D137 stamp, three fields on LLP_UnitAllocation_Module (proposed:
 * zoho/changes/2026-10-09-d137-fields.md):
 *   Converted_At   DateTime  when (IST, rule 9)
 *   Converted_By   Lookup (Users) who — a user lookup on the ALLOTMENT module, never on Leads (Leads is at its user-lookup limit)
 *   Converted_Via  Picklist  "Finance match" (automatic) | "Manual"
 * The names avoid the money words the account-management projection refuses, so a KAM and an IR may read the stamp (no amount).
 *
 *   auto    — called by money/match after Finance matches a receipt: matched inbound − matched refunds on the allotment >=
 *             units × Unit_Price (lib/money/ten-percent, the one arithmetic) and the allotment is Reserved and not yet stamped →
 *             ONE guarded write (If-Unmodified-Since = the allotment's Modified_Time, D44) on the MATCHER's own token (rule 2):
 *             Converted_At = now, Converted_By = the matcher, Converted_Via = "Finance match". A second match re-reads and
 *             answers `already`. Nothing else moves: Issued stays the allocation letter's (investors/allot), Payment_Status
 *             stays Zoho's workflow's (money/allotment-receipts).
 *   manual  — Finance (Finance Operations, Head of Finance), Digital Infrastructure or a KAM may stamp it by hand with a typed
 *             reason (>= 10 characters): the reason is written FIRST as a Note on the investor's Contact under their own
 *             name (no Note, no stamp; a failed stamp takes the Note back), then the guarded write with Converted_Via =
 *             "Manual". One ops-log line (`full-paid` / `manual`) and one Plane C line (`investor-converted`, reason
 *             `fully-paid-manual`) — who, when, which allotment; never the reason's words.
 * Org without the fields: the write is refused by Zoho as invalid-data naming one of them → `fields-missing`, reported, never
 * thrown; the match that called it stands. Logs carry ids and codes only.
 *
 * D138 (owner rulings, 10 Oct 2026):
 *   - conversion waits for the signed supplementary agreement: until the allotment's Supplementary_Verified_At is set, NO stamp is
 *     written, automatic or manual — `auto` answers `waiting-supplementary` (code `supplementary-not-signed`), `manual` refuses
 *     `supplementary-not-signed` (409) before any Note is written. Recording money stays allowed (rule 3); matching an allotment
 *     receipt is already gated on the same field (money/match `supplementary-not-verified`); a receipt matched on the LEAD before the
 *     allotment exists still counts toward the 10% (D137), but the full conversion it may cover waits here.
 *   - a KAM can NOT mark an allotment fully paid: the manual stamp is Finance Operations, Head of Finance and Digital Infrastructure
 *     only (the route's MANUAL_SEATS). A KAM asks Finance to confirm instead (./full-paid-request), a row on Finance's to-do.
 */
import type { UserCredential, ZohoClient, ZohoRecord } from "../../lib/zoho/client";
import { isUserCredential } from "../../lib/zoho/client";
import type { ZohoFailureKind } from "../../lib/zoho/errors";
import type { OpsLog } from "../../lib/zoho/log";
import { tenPercentTrail, type TenPercentTrail } from "../../lib/money/ten-percent";
import { committedOf, readReceipts } from "../money/matched-receipts";

export const ALLOTMENTS = "LLP_UnitAllocation_Module";
export const CONVERTED_FIELDS = Object.freeze(["Converted_At", "Converted_By", "Converted_Via"]);
export const VIA_AUTO = "Finance match";
export const VIA_MANUAL = "Manual";
export const MANUAL_REASON_MIN = 10;
export const MANUAL_REASON_MAX = 500;
export const MANUAL_NOTE_TITLE = "Allotment marked fully paid by hand (D137)";
export const FIELDS_MISSING_TEXT = "Not stamped — the allotment's Converted_At / Converted_By / Converted_Via fields are not in Zoho yet. Digital Infrastructure creates them (D137).";
const ALLOT_FIELDS = Object.freeze(["Name", "Customer", "LLP", "Allocation_Status", "Reserved_Units", "Issued_Units", "Unit_Price", "Hold_Until", "Supplementary_Verified_At", "Modified_Time"]);
const RECORD_ID = /^\d{15,22}$/;
const RECORD_PREFIX = /^\d{6,16}$/;
const SESSION_ID = /^[A-Za-z0-9_-]{16,128}$/;
const ZDT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/;

/** D138: the supplementary agreement is signed and verified on this allotment. */
export const supplementarySigned = (a: ZohoRecord): boolean => typeof a.Supplementary_Verified_At === "string" && ZDT.test(a.Supplementary_Verified_At);
export const SUPPLEMENTARY_NOT_SIGNED_TEXT = "Not converted — the supplementary agreement is not signed and verified yet. Until Finance verifies it, the allotment cannot be marked fully paid; you can still log a contact and add notes.";

export const istIso = (ms: number): string => `${new Date(ms + 5.5 * 3_600_000).toISOString().slice(0, 19)}+05:30`;

export interface ConvertedStamp { readonly at: string; readonly byId: string | null; readonly via: string | null }

const idOf = (v: unknown): string | null => {
  if (typeof v === "string" && RECORD_ID.test(v)) return v;
  const id = v && typeof v === "object" ? (v as { id?: unknown }).id : undefined;
  return typeof id === "string" && RECORD_ID.test(id) ? id : null;
};
export function stampOf(r: ZohoRecord): ConvertedStamp | null {
  const at = r.Converted_At;
  if (typeof at !== "string" || !ZDT.test(at)) return null;
  return Object.freeze({ at, byId: idOf(r.Converted_By), via: typeof r.Converted_Via === "string" ? r.Converted_Via : null });
}

/**
 * The stamps of these allotments, on the reader's own token. null = not readable (the fields do not exist yet, or the read failed):
 * the caller then treats every allotment as not stamped — a Reserved allotment stays "not converted", never the other way round.
 */
export async function readConverted(crm: Pick<ZohoClient, "coql">, cred: UserCredential, allotmentIds: readonly string[], signal?: AbortSignal)
  : Promise<ReadonlyMap<string, ConvertedStamp> | null> {
  const ids = [...new Set(allotmentIds.filter((x) => RECORD_ID.test(x)))];
  const out = new Map<string, ConvertedStamp>();
  for (let i = 0; i < ids.length; i += 100) {
    const list = ids.slice(i, i + 100).map((x) => `'${x}'`).join(", ");
    let r: Awaited<ReturnType<typeof crm.coql>>;
    try { r = await crm.coql(cred, `select id, ${CONVERTED_FIELDS.join(", ")} from ${ALLOTMENTS} where id in (${list}) limit 0, 200`, { signal }); } catch { return null; }
    if (!r.ok || r.value.invalidRecordIds) return null;
    for (const x of r.value.records) { const s = stampOf(x); if (s && typeof x.id === "string") out.set(x.id, s); }
  }
  return out;
}

export type AutoOutcome = { readonly ok: boolean; readonly value: "converted" | "already" | "not-yet" | "not-reserved" | "waiting-supplementary" | null; readonly code: string | null };

export type ManualRefusal = "invalid-request" | "not-allowed" | "not-visible" | "reason-short" | "changed" | "not-reserved" | "fields-missing" | "note-failed" | "supplementary-not-signed";
export type ManualResult =
  | { readonly ok: true; readonly value: { readonly allotmentId: string; readonly contactId: string; readonly stamp: ConvertedStamp; readonly already: boolean; readonly trail: TenPercentTrail | null } }
  | { readonly ok: false; readonly kind: "refused"; readonly reasonCode: ManualRefusal; readonly message: string; readonly retryable: false }
  | { readonly ok: false; readonly kind: "source-error"; readonly errorKind: ZohoFailureKind | "unexpected"; readonly message: string; readonly retryable: boolean };

const MESSAGE: Readonly<Record<ManualRefusal, string>> = Object.freeze({
  "invalid-request": "Not stamped — reload the investor and try again.",
  "not-allowed": "Finance or Digital Infrastructure marks an allotment fully paid. A KAM asks Finance to confirm the full payment.",
  "not-visible": "Not stamped — this allotment is not visible to you.",
  "reason-short": `Say why it is being marked fully paid by hand — at least ${MANUAL_REASON_MIN} characters. It goes on the record with your name.`,
  changed: "Not stamped — the allotment changed while you were looking at it. Reload and try again.",
  "not-reserved": "Only a Reserved allotment converts in full — this one is not Reserved.",
  "fields-missing": FIELDS_MISSING_TEXT,
  "note-failed": "Not stamped — the reason could not be written on the investor's record, so nothing was changed. Try again.",
  "supplementary-not-signed": SUPPLEMENTARY_NOT_SIGNED_TEXT,
});

export interface FullPaidDeps {
  readonly crm: Pick<ZohoClient, "getRecord" | "coql" | "update" | "insert"> & Partial<Pick<ZohoClient, "deleteRecord">>;
  /** Fresh on the live session: Finance Operations, Head of Finance or Digital Infrastructure (D138: not a KAM). */
  readonly authority?: { mayMarkManually(credential: UserCredential, sessionId: string, signal?: AbortSignal): Promise<boolean> };
  readonly log: OpsLog;
  /** Plane C (data/events.ts): investor-converted lines. Absent: no Plane C line (tests). */
  readonly events?: { investorConverted?(userId: string, seat: string | null, recordIds: readonly string[], outcome: "ok" | "refused", reason: string): void };
  readonly recordIdPrefix: string;
  readonly clock?: () => number;
}

const retryable = (k: string): boolean => k === "network" || k === "server" || k === "busy" || k === "concurrency-exceeded" || k === "rate-limited-unclassified" || k === "unexpected";
const namesConverted = (e: { field?: string | null; records?: readonly { field?: string | null }[] }): boolean =>
  [e.field, ...(e.records ?? []).map((r) => r.field)].some((f) => typeof f === "string" && CONVERTED_FIELDS.includes(f));

export function createFullPaid(deps: FullPaidDeps) {
  if (!deps || typeof deps.crm?.getRecord !== "function" || typeof deps.crm?.coql !== "function" || typeof deps.crm?.update !== "function"
    || typeof deps.crm?.insert !== "function" || typeof deps.log?.refusal !== "function" || typeof deps.recordIdPrefix !== "string" || !RECORD_PREFIX.test(deps.recordIdPrefix)) {
    throw new TypeError("full-paid needs crm (getRecord/coql/update/insert), the ops log and the record-id prefix");
  }
  const { crm, log } = deps;
  const clock = deps.clock ?? Date.now;
  const now = () => { try { return clock(); } catch { return 0; } };
  const validId = (v: unknown): v is string => typeof v === "string" && RECORD_ID.test(v) && v.startsWith(deps.recordIdPrefix);
  const note = (userId: string, reason: string, ids: readonly unknown[]) =>
    log.refusal({ at: now(), actor: { kind: "user", userId }, action: "full-paid", reason, recordIds: ids.filter(validId) });
  const planeC = (userId: string, seat: string | null, ids: readonly string[], outcome: "ok" | "refused", reason: string) => {
    try { deps.events?.investorConverted?.(userId, seat, ids.filter(validId), outcome, reason); } catch { /* never blocks */ }
  };

  async function readAllot(cred: UserCredential, id: string, signal?: AbortSignal): Promise<ZohoRecord | null | "error"> {
    let r = await crm.getRecord(cred, ALLOTMENTS, id, { fields: [...ALLOT_FIELDS, ...CONVERTED_FIELDS], signal }).catch(() => null);
    /* the stamp fields may not exist yet: read the allotment without them (then nothing is stamped) */
    if (r && !r.ok && r.error.kind === "invalid-data") r = await crm.getRecord(cred, ALLOTMENTS, id, { fields: ALLOT_FIELDS, signal }).catch(() => null);
    if (!r) return "error";
    if (!r.ok) return r.error.kind === "not-found" || r.error.kind === "forbidden" ? null : "error";
    return r.value && r.value.id === id ? r.value : null;
  }
  async function trailOf(cred: UserCredential, allot: ZohoRecord, signal?: AbortSignal): Promise<TenPercentTrail | null> {
    const committed = committedOf([allot]);
    if (committed === null) return null;
    const r = await readReceipts(crm, cred, `Allotment = '${allot.id}'`, signal);
    return r.ok ? tenPercentTrail(committed, r.rows) : null;
  }
  const stampFields = (me: string, via: string) => ({ Converted_At: istIso(now()), Converted_By: { id: me }, Converted_Via: via });

  return Object.freeze({
    /** After a Finance match (money/match consequences): stamp the allotment if the committed amount is now fully matched. */
    async auto(cred: UserCredential, allotmentId: string, signal?: AbortSignal): Promise<AutoOutcome> {
      const me = cred.userId;
      if (!validId(allotmentId)) return { ok: false, value: null, code: "invalid-request" };
      const a = await readAllot(cred, allotmentId, signal);
      if (a === "error" || !a) return { ok: false, value: null, code: "allotment-unread" };
      if (stampOf(a)) return { ok: true, value: "already", code: null };
      if (a.Allocation_Status !== "Reserved") return { ok: true, value: "not-reserved", code: null };
      /* D138: no full conversion before the signed supplementary — the money stays matched, the stamp waits */
      if (!supplementarySigned(a)) { note(me, "auto-waiting-supplementary", [allotmentId]); return { ok: true, value: "waiting-supplementary", code: "supplementary-not-signed" }; }
      const t = await trailOf(cred, a, signal);
      if (!t) return { ok: false, value: null, code: "receipts-unread" };
      if (!t.fullyPaid) return { ok: true, value: "not-yet", code: null };
      const mt = typeof a.Modified_Time === "string" && ZDT.test(a.Modified_Time) ? a.Modified_Time : null;
      if (!mt) return { ok: false, value: null, code: "allotment-unread" };
      const w = await crm.update(cred, ALLOTMENTS, allotmentId, stampFields(me, VIA_AUTO), { ifUnmodifiedSince: mt, signal })
        .catch(() => ({ ok: false as const, error: { kind: "unexpected" as const, status: 0 } }));
      if (!w.ok) {
        const e = w.error as { kind: string; field?: string | null; records?: readonly { field?: string | null }[] };
        const code = e.kind === "invalid-data" && namesConverted(e) ? "fields-missing" : e.kind === "conflict" ? "allotment-changed" : e.kind;
        note(me, "auto-not-stamped-" + code, [allotmentId]);
        return { ok: false, value: null, code };
      }
      note(me, "auto-stamped", [allotmentId, idOf(a.Customer)]);
      planeC(me, null, [allotmentId, idOf(a.Customer) ?? ""], "ok", "fully-paid-auto");
      return { ok: true, value: "converted", code: null };
    },

    /** Finance or Digital Infrastructure marks it by hand, with a reason (D137 ruling 3; D138: not a KAM, not before the supplementary). */
    async manual(principal: unknown, allotmentId: unknown, reason: unknown, expectedModifiedTime?: unknown, signal?: AbortSignal, pageContactId?: string): Promise<ManualResult> {
      const p = principal && typeof principal === "object" ? (principal as { credential?: unknown; sessionId?: unknown; seat?: unknown }) : null;
      const refuse = (me: string, code: ManualRefusal, ids: readonly unknown[] = [], seat: string | null = null): ManualResult => {
        note(me, code, ids);
        planeC(me, seat, ids.filter(validId) as string[], "refused", code);
        return { ok: false, kind: "refused", reasonCode: code, message: MESSAGE[code], retryable: false };
      };
      if (!p || !isUserCredential(p.credential) || typeof p.sessionId !== "string" || !SESSION_ID.test(p.sessionId)) return refuse("unrecognised", "invalid-request");
      const cred = p.credential, me = cred.userId, seat = typeof p.seat === "string" ? p.seat : null;
      let may = false;
      try { may = !!deps.authority && (await deps.authority.mayMarkManually(cred, p.sessionId, signal)) === true; } catch { may = false; }
      if (!may) return refuse(me, "not-allowed", [allotmentId], seat);
      if (!validId(allotmentId)) return refuse(me, "invalid-request", [], seat);
      if (expectedModifiedTime !== undefined && expectedModifiedTime !== null && (typeof expectedModifiedTime !== "string" || !ZDT.test(expectedModifiedTime))) return refuse(me, "invalid-request", [allotmentId], seat);
      const why = typeof reason === "string" ? reason.trim() : "";
      if (why.length < MANUAL_REASON_MIN) return refuse(me, "reason-short", [allotmentId], seat);
      if (why.length > MANUAL_REASON_MAX) return refuse(me, "invalid-request", [allotmentId], seat);
      const a = await readAllot(cred, allotmentId, signal);
      if (a === "error") return { ok: false, kind: "source-error", errorKind: "unexpected", message: "Not stamped — Zoho is not answering. Try again.", retryable: true };
      if (!a) return refuse(me, "not-visible", [allotmentId], seat);
      const contactId = idOf(a.Customer);
      /* the page names the investor; an allotment of someone else is not this page's to stamp */
      if (typeof pageContactId === "string" && contactId !== pageContactId) return refuse(me, "not-visible", [allotmentId], seat);
      const already = stampOf(a);
      if (already && contactId) return { ok: true, value: { allotmentId, contactId, stamp: already, already: true, trail: null } };
      if (a.Allocation_Status !== "Reserved" || !contactId) return refuse(me, "not-reserved", [allotmentId], seat);
      /* D138: refused before the Note — nothing is written while the supplementary is unsigned */
      if (!supplementarySigned(a)) return refuse(me, "supplementary-not-signed", [allotmentId, contactId], seat);
      const mt = typeof a.Modified_Time === "string" && ZDT.test(a.Modified_Time) ? a.Modified_Time : null;
      if (typeof expectedModifiedTime === "string" && mt && expectedModifiedTime !== mt) return refuse(me, "changed", [allotmentId], seat);
      /* the reason first, on the Contact, under their own name — no Note, no stamp */
      const n = await crm.insert(cred, "Notes", [{ Note_Title: MANUAL_NOTE_TITLE, Note_Content: why, Parent_Id: { module: { api_name: "Contacts" }, id: contactId } }], { signal }).catch(() => null);
      const noteId = n && n.ok && n.value.length === 1 && n.value[0]!.ok ? n.value[0]!.id : null;
      if (!noteId) return refuse(me, "note-failed", [allotmentId, contactId], seat);
      const w = await crm.update(cred, ALLOTMENTS, allotmentId, stampFields(me, VIA_MANUAL), { ifUnmodifiedSince: (expectedModifiedTime as string | undefined) ?? mt, signal })
        .catch(() => ({ ok: false as const, error: { kind: "unexpected" as const, status: 0 } }));
      if (!w.ok) {
        try { if (typeof crm.deleteRecord === "function") { const d = await crm.deleteRecord(cred, "Notes", noteId, { signal }); if (!d.ok) note(me, "manual-note-left", [contactId, noteId]); } } catch { note(me, "manual-note-left", [contactId, noteId]); }
        const e = w.error as { kind: string; field?: string | null; records?: readonly { field?: string | null }[] };
        if (e.kind === "invalid-data" && namesConverted(e)) return refuse(me, "fields-missing", [allotmentId], seat);
        if (e.kind === "conflict") return refuse(me, "changed", [allotmentId], seat);
        if (e.kind === "not-found" || e.kind === "forbidden") return refuse(me, "not-visible", [allotmentId], seat);
        note(me, "manual-write-failed-" + e.kind, [allotmentId]);
        return { ok: false, kind: "source-error", errorKind: e.kind as ZohoFailureKind, message: "Not stamped — Zoho did not take it. Try again.", retryable: retryable(e.kind) };
      }
      note(me, "manual", [allotmentId, contactId, noteId]);
      planeC(me, seat, [allotmentId, contactId], "ok", "fully-paid-manual");
      const t = await trailOf(cred, a, signal).catch(() => null);
      return { ok: true, value: { allotmentId, contactId, stamp: { at: istIso(now()), byId: me, via: VIA_MANUAL }, already: false, trail: t } };
    },
  });
}
export type FullPaid = ReturnType<typeof createFullPaid>;
