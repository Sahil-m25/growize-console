/**
 * M01-S03-T05 — THE INVESTORS SIDE'S PLANE B / PLANE C EVENTS (D47). Ids and status only.
 *
 *  Plane B (lib/zoho/log OpsLog.refusal): our layer said no — a scope drift, a seat without the book,
 *    and a 412 ALREADY_MODIFIED on a write (reason "already-modified"). The Zoho call line itself is
 *    written by the client; this adds the refusal the person saw.
 *  Plane C (identity/plane-c): authority — an identity reveal (pan / bank_account), a step-up, a seat change.
 *
 * Nothing here takes a value: the arguments are a Zoho user id, short codes, a seat token and record
 * ids. Both writers rebuild every line from an allow-list, so even a caller who passes more keeps nothing.
 */

import type { ZohoFailure } from "../../lib/zoho/errors";
import type { OpsLog } from "../../lib/zoho/log";
import { revealWhyOf, type PlaneCLog } from "../identity/plane-c";

const RECORD_ID = /^\d{15,22}$/;
const ids = (xs: readonly (string | null | undefined)[]): string[] => xs.filter((x): x is string => typeof x === "string" && RECORD_ID.test(x));

export type RevealField = "pan" | "bank_account";

export interface InvestorEvents {
  /** Plane B: a read or write this layer refused. */
  refusal(userId: string, action: string, reason: string, recordIds?: readonly string[]): void;
  /** Plane B: Zoho answered 412 ALREADY_MODIFIED to a conditional write. */
  conflict(userId: string, action: string, recordId: string | null): void;
  /** Plane C: an identity field shown in full (or refused). The field is a code; the value never travels. `why` is the
   *  chosen reason (a REVEAL_WHY code or its chip label); without one the line says "unstated" (M15-S05-NOTE-1). */
  reveal(userId: string, seat: string | null, field: RevealField, contactId: string, outcome: "ok" | "refused", why?: string | null): void;
  /** Plane C: a step-up (re-authentication before a sensitive act). */
  stepUp(userId: string, seat: string | null, outcome: "ok" | "refused", reason: string): void;
  /** Plane C: the session's seat changed between two reads (Zoho role moved). */
  seatChange(userId: string, from: string | null, to: string | null): void;
  /**
   * M09-S04-T02: a key account manager named, moved or returned to the pool. Plane C authority line (grant-change):
   * who = the person who moved it, whom = the new KAM (the previous one when returned), recordIds = [Contact,
   * previous KAM] — user ids only, never a name (CLAUDE.md). Names are read in Zoho's field history on KAM.
   */
  kamMove(userId: string, seat: string | null, contactId: string, fromKam: string | null, toKam: string | null): void;
  /** M08-S08-NOTE-10: Plane C — "Send welcome and unlock" released app access (ok, reason "released") or the release was
   *  refused (reason = the refusal code). recordIds = [Contact]; ids and codes only, never a name or an email. */
  appAccessReleased(userId: string, seat: string | null, contactId: string, outcome: "ok" | "refused", reason: string): void;
  /** M15-S05-NOTE-1 / M10-S23: Plane C — a test sign-in link issued for a Contact, living `ttlMinutes`; `real` = a real
   *  investor (after the warning), not a listed test account. Never the URL, the token or the reason's words. */
  testLinkIssued(userId: string, seat: string | null, contactId: string, ttlMinutes: number, real: boolean): void;
}

/** What the person is told on a 412: an in-page refusal naming the newer change, never a silent overwrite. */
export interface ConflictRefusal {
  readonly kind: "conflict";
  readonly recordId: string | null;
  readonly reason: string;
}

export function createInvestorEvents(deps: { readonly log: OpsLog; readonly planeC: PlaneCLog; readonly clock?: () => number }): InvestorEvents {
  const clock = deps.clock ?? Date.now;
  const user = (userId: string) => ({ kind: "user" as const, userId });
  return Object.freeze({
    refusal(userId: string, action: string, reason: string, recordIds: readonly string[] = []) {
      deps.log.refusal({ at: clock(), actor: user(userId), action, reason, recordIds: ids(recordIds) });
    },
    conflict(userId: string, action: string, recordId: string | null) {
      deps.log.refusal({ at: clock(), actor: user(userId), action, reason: "already-modified", recordIds: ids([recordId]) });
    },
    reveal(userId: string, seat: string | null, field: RevealField, contactId: string, outcome: "ok" | "refused", why?: string | null) {
      deps.planeC.record({ at: clock(), who: userId, action: "reveal", outcome, reason: field === "pan" ? "pan" : "bank-account", seat, recordIds: ids([contactId]),
        why: revealWhyOf(why) ?? "unstated" });
    },
    stepUp(userId: string, seat: string | null, outcome: "ok" | "refused", reason: string) {
      deps.planeC.record({ at: clock(), who: userId, action: "step-up", outcome, reason, seat });
    },
    seatChange(userId: string, from: string | null, to: string | null) {
      deps.planeC.record({ at: clock(), who: userId, action: "seat-change", outcome: "ok", reason: from ? `from-${from}` : "from-none", seat: to });
    },
    kamMove(userId: string, seat: string | null, contactId: string, fromKam: string | null, toKam: string | null) {
      const reason = toKam === null ? "kam-returned" : fromKam === null ? "kam-named" : "kam-moved";
      const whom = toKam ?? fromKam;
      deps.planeC.record({
        at: clock(), who: userId, action: "grant-change", outcome: "ok", reason, seat,
        ...(whom ? { whom } : {}), recordIds: ids([contactId, fromKam]),
      });
    },
    appAccessReleased(userId: string, seat: string | null, contactId: string, outcome: "ok" | "refused", reason: string) {
      deps.planeC.record({ at: clock(), who: userId, action: "app-access-released", outcome, reason, seat, recordIds: ids([contactId]) });
    },
    testLinkIssued(userId: string, seat: string | null, contactId: string, ttlMinutes: number, real: boolean) {
      deps.planeC.record({ at: clock(), who: userId, action: "test-link-issued", outcome: "ok", reason: real ? "real-investor" : "test-account", seat,
        recordIds: ids([contactId]), ttlMinutes });
    },
  });
}

/** Turns a write's 412 into the refusal the page shows, logging it once. Other failures pass through as null. */
export function conflictOf(events: InvestorEvents, userId: string, action: string, failure: ZohoFailure): ConflictRefusal | null {
  if (failure.kind !== "conflict") return null;
  events.conflict(userId, action, failure.recordId);
  return Object.freeze({
    kind: "conflict",
    recordId: failure.recordId,
    reason: "Someone else changed this record after you opened it. Their change is kept; reload to see it, then make yours again.",
  });
}
