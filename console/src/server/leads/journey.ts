/**
 * M08-S01 — the journey: tick the next rung, take the last one back, or skip Engagement.
 *
 * Each rung is a date stamp on the Lead (D55's nine rungs; Lead_Status stays the blueprint's, D45).
 * The server re-reads the lead and decides from its stamps alone which rung is next, so a stale
 * screen cannot tick two or tick out of order, and every write carries If-Unmodified-Since.
 *  - First touch is recorded by a follow-up, never by a tick.
 *  - Qualified needs a dated next step and the IR's stated scorecard (said, not held — prototype NEEDS).
 *  - Reserved, Fully paid and Allocated open only on Finance's fact (D09), read by a GateReader;
 *    without one the rung stays shut.
 *  - Taking back: one rung, within 8 hours of its stamp, with one of the five reasons, never while a
 *    payment stands against the lead, and only one back (Rung_Undone_At).
 */

import type { UserCredential, ZohoClient, ZohoRecord } from "../../lib/zoho/client";
import { isUserCredential } from "../../lib/zoho/client";
import type { ZohoFailureKind } from "../../lib/zoho/errors";
import type { OpsLog } from "../../lib/zoho/log";
import type { FollowupAccessAuthority } from "./followup";
import { LEADS_MODULE } from "./capture";

export const EDIT_HOURS = 8;
const SESSION_ID = /^[A-Za-z0-9_-]{16,128}$/;
const RECORD_ID = /^\d{15,22}$/;
const RECORD_PREFIX = /^\d{6,16}$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/;

/** Rungs 2–9 and the Lead stamp each one sets; rung 1 (captured) is the record's Created_Time. */
export const RUNGS = Object.freeze([
  { n: 2, t: "First touch made", field: "First_Touch_At" },
  { n: 3, t: "Qualified", field: "Qualified_At", needs: "scorecard" },
  { n: 4, t: "Engagement done", field: "Engaged_At", skip: true },
  { n: 5, t: "Investor said yes", field: "Said_Yes_At" },
  { n: 6, t: "Reserved — 10% in", field: "Reserved_At", gate: "advance" },
  { n: 7, t: "Fully paid", field: "Fully_Paid_At", gate: "balance" },
  { n: 8, t: "Allocated", field: "Allocated_At", gate: "alloc" },
  { n: 9, t: "Onboarded", field: "Onboarded_At" },
] as const);
export const UNDO_REASONS = Object.freeze(["Ticked on the wrong lead", "Ticked the wrong rung", "It did not actually happen",
  "The investor went back on it", "Recorded before the evidence was in"]);
type Gate = "advance" | "balance" | "alloc";

/** Finance's facts (M08-S02 reads them live). Absent → gated rungs stay shut. */
export interface GateReader {
  met(credential: UserCredential, leadId: string, gate: Gate, signal?: AbortSignal): Promise<boolean>;
}

export type JourneyRefusal = "invalid-request" | "session-changed" | "capability-missing" | "not-visible" | "not-in-book"
  | "lead-changed" | "lead-closed" | "first-touch-by-followup" | "scorecard-needed" | "next-step-needed" | "units-needed"
  | "gate-shut" | "not-skippable" | "nothing-to-undo" | "undo-window-closed" | "already-undone" | "payment-stands" | "reason-needed";
export type JourneyResult =
  | { readonly ok: true; readonly value: { readonly rung: number; readonly modifiedTime: string | null } }
  | { readonly ok: false; readonly kind: "refused"; readonly reasonCode: JourneyRefusal; readonly reason: string }
  | { readonly ok: false; readonly kind: "source-error"; readonly source: "access" | "zoho"; readonly errorKind: ZohoFailureKind | "unexpected"; readonly retryable: boolean };

const REASON: Readonly<Record<JourneyRefusal, string>> = Object.freeze({
  "invalid-request": "the request is invalid",
  "session-changed": "the sign-in session changed",
  "capability-missing": "this seat cannot move the journey",
  "not-visible": "the lead is unavailable",
  "not-in-book": "this lead is not in your book",
  "lead-changed": "the lead changed in Zoho since it was opened — review it and try again",
  "lead-closed": "this lead is closed; the journey does not move",
  "first-touch-by-followup": "record the first contact as a follow-up; it ticks this rung",
  "scorecard-needed": "state the scorecard — budget, timeline and who signs — before Qualified",
  "next-step-needed": "Qualified needs a dated next step on the lead",
  "units-needed": "record how many units they intend before this rung",
  "gate-shut": "this rung waits on a fact Finance confirms; the lead stays yours",
  "not-skippable": "only the Engagement rung can be skipped, and only when it is next",
  "nothing-to-undo": "there is nothing before this one",
  "undo-window-closed": "a rung can be taken back for 8 hours, and only one back",
  "already-undone": "one rung back is one — a second correction is a new record",
  "payment-stands": "a payment is recorded against this lead; it has to be reversed first",
  "reason-needed": "choose why this rung is being taken back",
});

export interface JourneyDependencies {
  readonly crm: Pick<ZohoClient, "getRecord" | "update">;
  readonly access: FollowupAccessAuthority;
  readonly log: OpsLog;
  readonly recordIdPrefix: string;
  readonly gates?: GateReader;
  readonly clock?: () => number;
}

const FIELDS = ["Modified_Time", "Lost_At", "Owner", "Secondary_Owner", "Cover_By", "Cover_Until", "Next_Step_At", "Units_Interested",
  "Engagement_Skipped", "Rung_Undone_At", ...RUNGS.map((r) => r.field)];
const zohoTime = (ms: number): string => `${new Date(ms + 5.5 * 3_600_000).toISOString().slice(0, 19)}+05:30`;
const idOf = (v: unknown): string | null => {
  const id = v && typeof v === "object" ? (v as { id?: unknown }).id : undefined;
  return typeof id === "string" && RECORD_ID.test(id) ? id : null;
};
/** How far the lead is: the highest rung whose stamp is set, and every rung below it set too. */
export function doneOf(L: ZohoRecord): number | null {
  let done = 1;
  for (const r of RUNGS) {
    const v = L[r.field];
    if (v === null || v === undefined) break;
    if (typeof v !== "string" || !DATETIME.test(v)) return null;
    done = r.n;
  }
  // A stamp above a gap is a record this console cannot read honestly.
  for (const r of RUNGS) if (r.n > done && L[r.field]) return null;
  return done;
}

export function createJourney(deps: JourneyDependencies) {
  if (!deps || typeof deps.crm?.getRecord !== "function" || typeof deps.crm?.update !== "function" || typeof deps.access?.recheck !== "function"
    || typeof deps.log?.refusal !== "function" || typeof deps.recordIdPrefix !== "string" || !RECORD_PREFIX.test(deps.recordIdPrefix)) {
    throw new TypeError("The journey needs crm.getRecord/update, the access authority, the ops log and the CRM record-id prefix.");
  }
  const { crm, access, log, gates } = deps;
  const clock = deps.clock ?? Date.now;
  const validId = (v: unknown): v is string => typeof v === "string" && RECORD_ID.test(v) && v.startsWith(deps.recordIdPrefix);
  const refuse = (userId: string, code: JourneyRefusal, ids: readonly string[] = []): JourneyResult => {
    log.refusal({ at: clock(), actor: { kind: "user", userId }, action: "lead-journey", reason: code, recordIds: ids.filter(validId) });
    return { ok: false, kind: "refused", reasonCode: code, reason: REASON[code] };
  };
  const zoho = (k: ZohoFailureKind | "unexpected"): JourneyResult => ({ ok: false, kind: "source-error", source: "zoho", errorKind: k, retryable: false });

  /** Shared: principal, seat, lead read, book check. */
  const open = async (principal: { credential: UserCredential; sessionId: string }, leadId: string, expected: string, signal?: AbortSignal)
    : Promise<{ me: string; L: ZohoRecord; done: number } | JourneyResult> => {
    const cred = principal?.credential;
    if (!isUserCredential(cred) || !validId(cred.userId) || typeof principal.sessionId !== "string" || !SESSION_ID.test(principal.sessionId)
      || !validId(leadId) || typeof expected !== "string" || !DATETIME.test(expected)) {
      return refuse(isUserCredential(cred) ? cred.userId : "unrecognised", "invalid-request");
    }
    const me = cred.userId;
    let a;
    try { a = await access.recheck(cred, principal.sessionId, signal); } catch {
      return { ok: false, kind: "source-error", source: "access", errorKind: "unexpected", retryable: true };
    }
    if (!a || a.actor?.userId !== me) return refuse(me, "session-changed");
    if (!a.mayRecordFollowup) return refuse(me, "capability-missing");
    let got: Awaited<ReturnType<typeof crm.getRecord>>;
    try { got = await crm.getRecord(cred, LEADS_MODULE, leadId, { fields: FIELDS, signal }); } catch { return zoho("unexpected"); }
    if (!got.ok) return got.error.kind === "not-found" || got.error.kind === "forbidden" ? refuse(me, "not-visible", [leadId]) : zoho(got.error.kind);
    if (!got.value || got.value.id !== leadId) return refuse(me, "not-visible", [leadId]);
    const L = got.value as ZohoRecord;
    if (L.Modified_Time !== expected) return refuse(me, "lead-changed", [leadId]);
    const owner = idOf(L.Owner), today = zohoTime(clock()).slice(0, 10);
    const inBook = owner === me || idOf(L.Secondary_Owner) === me
      || (idOf(L.Cover_By) === me && typeof L.Cover_Until === "string" && L.Cover_Until >= today)
      || (owner !== null && a.teamOwnerIds.includes(owner));
    if (!inBook) return refuse(me, "not-in-book", [leadId]);
    const done = doneOf(L);
    if (done === null) return zoho("unexpected");
    if (L.Lost_At || done >= 9) return refuse(me, "lead-closed", [leadId]);
    return { me, L, done };
  };
  const write = async (principal: { credential: UserCredential }, me: string, leadId: string, expected: string, fields: Record<string, string | boolean | null>, rung: number, signal?: AbortSignal): Promise<JourneyResult> => {
    let put: Awaited<ReturnType<typeof crm.update>>;
    try { put = await crm.update(principal.credential, LEADS_MODULE, leadId, fields, { ifUnmodifiedSince: expected, signal }); } catch { return zoho("unexpected"); }
    if (!put.ok) return put.error.kind === "conflict" ? refuse(me, "lead-changed", [leadId]) : zoho(put.error.kind);
    return { ok: true, value: { rung, modifiedTime: put.value.modifiedTime } };
  };

  return Object.freeze({
    /** Mark the next rung done. `scorecardStated` is the IR's own statement for Qualified. */
    async tick(principal: { credential: UserCredential; sessionId: string }, leadId: string, expected: string, scorecardStated = false, signal?: AbortSignal): Promise<JourneyResult> {
      const o = await open(principal, leadId, expected, signal);
      if (!("L" in o)) return o;
      const { me, L, done } = o;
      const rung = RUNGS.find((r) => r.n === done + 1)!;
      if (rung.n === 2) return refuse(me, "first-touch-by-followup", [leadId]);
      if ("needs" in rung) {
        if (!L.Next_Step_At) return refuse(me, "next-step-needed", [leadId]);
        if (scorecardStated !== true) return refuse(me, "scorecard-needed", [leadId]);
      }
      if (rung.n >= 5 && rung.n <= 8 && !(Number.isSafeInteger(L.Units_Interested) && (L.Units_Interested as number) > 0)) return refuse(me, "units-needed", [leadId]);
      if ("gate" in rung) {
        let met = false;
        try { met = !!gates && await gates.met(principal.credential, leadId, rung.gate, signal); } catch { met = false; }
        if (!met) return refuse(me, "gate-shut", [leadId]);
      }
      return write(principal, me, leadId, expected, { [rung.field]: zohoTime(clock()) }, rung.n, signal);
    },

    /** Skip Engagement: only when it is the next rung. Its stamp is set and the skip is marked. */
    async skip(principal: { credential: UserCredential; sessionId: string }, leadId: string, expected: string, signal?: AbortSignal): Promise<JourneyResult> {
      const o = await open(principal, leadId, expected, signal);
      if (!("L" in o)) return o;
      if (o.done !== 3) return refuse(o.me, "not-skippable", [leadId]);
      return write(principal, o.me, leadId, expected, { Engaged_At: zohoTime(clock()), Engagement_Skipped: true }, 4, signal);
    },

    /** Take the last rung back: one, within 8 hours, with a reason, never over a payment. */
    async untick(principal: { credential: UserCredential; sessionId: string }, leadId: string, expected: string, reason: string, signal?: AbortSignal): Promise<JourneyResult> {
      const o = await open(principal, leadId, expected, signal);
      if (!("L" in o)) return o;
      const { me, L, done } = o;
      if (!UNDO_REASONS.includes(reason)) return refuse(me, "reason-needed", [leadId]);
      if (done <= 1) return refuse(me, "nothing-to-undo", [leadId]);
      const rung = RUNGS.find((r) => r.n === done)!;
      const at = Date.parse(L[rung.field] as string), now = clock();
      if (!(now - at <= EDIT_HOURS * 3_600_000 && now - at >= -180_000)) return refuse(me, "undo-window-closed", [leadId]);
      const undone = typeof L.Rung_Undone_At === "string" ? Date.parse(L.Rung_Undone_At) : NaN;
      if (Number.isFinite(undone) && now - undone <= EDIT_HOURS * 3_600_000) return refuse(me, "already-undone", [leadId]);
      if (L.Reserved_At && done <= 7) return refuse(me, "payment-stands", [leadId]);
      const fields: Record<string, string | boolean | null> = { [rung.field]: null, Rung_Undone_At: zohoTime(now) };
      if (rung.n === 4) fields.Engagement_Skipped = false;
      return write(principal, me, leadId, expected, fields, done - 1, signal);
    },
  });
}
