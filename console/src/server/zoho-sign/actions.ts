/**
 * M12-S05-T02 — REMIND, RECALL AND THE PERIODIC CHECK (D45, D47, D48, D72).
 *
 * Remind and recall run through the Zoho Sign API on the person's own token (D53): the record is read first
 * (it must be visible to them and name the request), Zoho Sign is re-read (only a request still out can be
 * reminded or recalled), then the act. A recall needs a reason (in-page confirmation); the reason is kept
 * in Zoho as a Note on the record, never in a log. The request id stays on the record, so the row reads
 * "Recalled" from Zoho Sign's own status (D77) and a new request may be sent.
 *
 * The periodic check (no webhook arrived): under the provider-callback service token, COQL the open
 * requests (request id set, not verified; ≤200 rows a page, ≤2000 a paper), re-read each from Zoho Sign
 * and file every completed one through the M12-S06 filer. Other states live in Zoho Sign and are read
 * live per viewer, so there is nothing else to write (D77). Plane B: one line per run with counts only.
 */

import type { ServiceCredential, UserCredential, ZohoClient, ZohoRecord, ZohoServiceClient } from "../../lib/zoho/client";
import { isUserCredential } from "../../lib/zoho/client";
import type { OpsLog } from "../../lib/zoho/log";
import type { SignApi } from "./api";
import { signFailure } from "./api";
import type { SignedFiler } from "./file";
import {
  addNote, cleanReason, isLive, isPaper, mayActOnPaper, PAPER_FIELDS, PAPER_KEYS, primaryDoerNote, RECORD_ID, reqIdOf, signStateOf, STATE_LABEL, verifiedOf, type Paper, type SignState,
} from "./papers";

export type ActRefusal = "invalid-request" | "seat-denied" | "not-visible" | "no-request" | "not-out" | "reason-required";
export const ACT_MESSAGE: Readonly<Record<ActRefusal, string>> = Object.freeze({
  "invalid-request": "Not done — the request is incomplete.",
  "seat-denied": "Reminding and recalling belong to Finance Operations, Compliance and the Head of Finance.",
  "not-visible": "You cannot open this record in Zoho.",
  "no-request": "Nothing has been sent for this paper.",
  "not-out": "This request is no longer out for signature.",
  "reason-required": "Give a reason for the recall.",
});
export type ActResult =
  | { readonly ok: true; readonly value: { readonly paper: Paper; readonly recordId: string; readonly requestId: string; readonly state: SignState; readonly label: string; readonly at: number; readonly noteSaved: boolean | null; readonly note: string | null } }
  | { readonly ok: false; readonly kind: "refused"; readonly reasonCode: ActRefusal; readonly message: string; readonly state?: SignState }
  | { readonly ok: false; readonly kind: "not-saved"; readonly errorKind: string; readonly message: string };

export interface SignActionsDeps {
  readonly crm: Pick<ZohoClient, "getRecord" | "insert">;
  readonly sign: Pick<SignApi, "getRequest" | "remind" | "recall">;
  readonly log: OpsLog;
  readonly clock?: () => number;
}

export function createSignActions(deps: SignActionsDeps) {
  const clock = deps.clock ?? Date.now;
  const refuse = (userId: string, action: string, code: ActRefusal, ids: readonly string[] = [], state?: SignState): ActResult => {
    deps.log.refusal({ at: clock(), actor: { kind: "user", userId }, action, reason: code, recordIds: ids.filter((x) => RECORD_ID.test(x)) });
    return { ok: false, kind: "refused", reasonCode: code, message: ACT_MESSAGE[code], ...(state ? { state } : {}) };
  };
  const notSaved = (kind: string): ActResult => {
    const f = signFailure(kind, "Not done yet — Zoho is not answering. Try again.");
    return { ok: false, kind: "not-saved", errorKind: f.reasonCode, message: f.message };
  };

  async function act(kind: "remind" | "recall", principal: { readonly credential: unknown; readonly seat: string }, paper: unknown, recordId: unknown, reasonIn: unknown, signal?: AbortSignal): Promise<ActResult> {
    const action = `sign-${kind}`;
    const cred = principal?.credential;
    if (!isUserCredential(cred)) return refuse("unrecognised", action, "invalid-request");
    const me = cred.userId, seat = String(principal.seat ?? "");
    if (!isPaper(paper) || typeof recordId !== "string" || !RECORD_ID.test(recordId)) return refuse(me, action, "invalid-request");
    if (!mayActOnPaper(seat, paper)) return refuse(me, action, "seat-denied", [recordId]);
    const reason = kind === "recall" ? cleanReason(reasonIn) : null;
    if (kind === "recall" && !reason) return refuse(me, action, "reason-required", [recordId]);
    const f = PAPER_FIELDS[paper];
    const cr = cred as UserCredential;
    let rec: ZohoRecord | null;
    try {
      const r = await deps.crm.getRecord(cr, f.module, recordId, { fields: ["id", f.req, f.verifiedAt], signal });
      if (!r.ok) return r.error.kind === "not-found" || r.error.kind === "forbidden" ? refuse(me, action, "not-visible", [recordId]) : notSaved(r.error.kind);
      rec = r.value;
    } catch { return notSaved("unexpected"); }
    if (!rec || rec.id !== recordId) return refuse(me, action, "not-visible", [recordId]);
    const requestId = reqIdOf(rec, f);
    if (!requestId) return refuse(me, action, "no-request", [recordId]);
    if (verifiedOf(rec, f)) return refuse(me, action, "not-out", [recordId], "signed");
    const live = await deps.sign.getRequest(cr, requestId, { signal });
    if (!live.ok) return notSaved(live.error.kind);
    const st = signStateOf(live.value);
    if (!isLive(st) || st === "draft") return refuse(me, action, "not-out", [recordId], st);
    const done = kind === "remind" ? await deps.sign.remind(cr, requestId, { signal }) : await deps.sign.recall(cr, requestId, { signal });
    if (!done.ok) return notSaved(done.error.kind);
    let noteSaved: boolean | null = null;
    if (kind === "recall") {
      const n = await addNote(deps.crm, cr, f.module, recordId, `Signature request recalled — ${f.label}`, `Reason: ${reason}`, signal);
      noteSaved = n.ok;
      if (!n.ok) deps.log.refusal({ at: clock(), actor: { kind: "user", userId: me }, action, reason: `note-not-saved.${n.errorKind}`, recordIds: [recordId] });
    }
    deps.log.event?.({ at: clock(), actor: { kind: "user", userId: me }, action, reason: `done.${paper}`, recordIds: [recordId] });
    const state: SignState = kind === "recall" ? "recalled" : st;
    return { ok: true, value: Object.freeze({ paper, recordId, requestId, state, label: kind === "remind" ? `Reminder sent` : STATE_LABEL.recalled, at: clock(), noteSaved, note: primaryDoerNote(seat) }) };
  }

  return Object.freeze({
    remind: (p: { readonly credential: unknown; readonly seat: string }, paper: unknown, recordId: unknown, signal?: AbortSignal) => act("remind", p, paper, recordId, null, signal),
    recall: (p: { readonly credential: unknown; readonly seat: string }, paper: unknown, recordId: unknown, reason: unknown, signal?: AbortSignal) => act("recall", p, paper, recordId, reason, signal),
  });
}

/* ---- the periodic check ------------------------------------------------------------------------------ */

export const CHECK_PAGE = 200;
export const CHECK_MAX_PAGES = 10;
export const CHECK_MAX_REQUESTS = 300;

export interface CheckDeps {
  readonly crm: Pick<ZohoServiceClient, "coql">;
  readonly sign: Pick<SignApi, "getRequest">;
  readonly filer: Pick<SignedFiler, "file">;
  readonly log: OpsLog;
  readonly clock?: () => number;
}
export interface CheckReport {
  readonly checked: number;
  readonly filed: number;
  readonly open: number;
  readonly failed: number;
  readonly truncated: boolean;
  readonly states: Readonly<Record<string, number>>;
}

export function createOpenRequestCheck(deps: CheckDeps) {
  const clock = deps.clock ?? Date.now;
  const ACTOR = { kind: "service", job: "provider-callback" } as const;
  return Object.freeze({
    async run(cred: ServiceCredential, signal?: AbortSignal): Promise<{ ok: true; report: CheckReport } | { ok: false; errorKind: string }> {
      const open: { paper: Paper; id: string; requestId: string }[] = [];
      let truncated = false;
      for (const paper of PAPER_KEYS) {
        const f = PAPER_FIELDS[paper];
        for (let page = 0; page < CHECK_MAX_PAGES; page++) {
          let r: Awaited<ReturnType<typeof deps.crm.coql>>;
          try {
            r = await deps.crm.coql(cred, `select id, ${f.req} from ${f.module} where (${f.req} is not null and ${f.verifiedAt} is null) order by id asc limit ${page * CHECK_PAGE}, ${CHECK_PAGE}`, { signal });
          } catch { return { ok: false, errorKind: "unexpected" }; }
          if (!r.ok) {
            deps.log.refusal({ at: clock(), actor: ACTOR, action: "sign-check", reason: `coql.${r.error.kind}`, recordIds: [] });
            return { ok: false, errorKind: r.error.kind };
          }
          for (const row of r.value.records) {
            const req = reqIdOf(row, f);
            if (RECORD_ID.test(row.id) && req) open.push({ paper, id: row.id, requestId: req });
          }
          if (!r.value.moreRecords) break;
          if (page === CHECK_MAX_PAGES - 1) truncated = true;
        }
      }
      if (open.length > CHECK_MAX_REQUESTS) { truncated = true; open.length = CHECK_MAX_REQUESTS; }
      const states: Record<string, number> = {};
      let filed = 0, failed = 0, stillOpen = 0;
      for (const o of open) {
        const g = await deps.sign.getRequest(cred, o.requestId, { signal });
        if (!g.ok) { failed++; continue; }
        const st = signStateOf(g.value);
        states[st] = (states[st] ?? 0) + 1;
        if (st !== "signed") { if (isLive(st)) stillOpen++; continue; }
        const f = PAPER_FIELDS[o.paper];
        const r = await deps.filer.file(cred, { module: f.module, id: o.id, paper: o.paper }, o.requestId, signal);
        if (r.ok) { if (r.outcome === "filed") filed++; } else failed++;
      }
      const report = Object.freeze({ checked: open.length, filed, open: stillOpen, failed, truncated, states: Object.freeze(states) });
      deps.log.event?.({ at: clock(), actor: ACTOR, action: "sign-check", reason: `checked-${open.length}.filed-${filed}.failed-${failed}${truncated ? ".truncated" : ""}`, recordIds: [] });
      return { ok: true, report };
    },
  });
}
