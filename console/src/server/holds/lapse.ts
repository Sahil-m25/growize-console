/**
 * M08-S04-T02 — RELEASING A RUN-OUT RESERVATION: the lapse (D19, D21, D22, D70).
 *
 * The prototype's lapse / lapseHold (merged html 4114-4167, 7031-7075): only the Head of Finance or the super user
 * (the "refund" right), only a Reserved allotment whose hold has run out (Asia/Kolkata, ./rules). Refused, in this order:
 *   no-release-right · hold-running · extension-waiting (decided first) · nothing-due (the balance landed: allot it,
 *   do not lapse it) · receipt-unmatched (a Pending or Claimed receipt is money nobody has matched yet — D21).
 * Then the one write is ../access/lapse-release releaseLapsedHold (imported, not re-built): Allocation_Status →
 * Cancelled on the person's own token with If-Unmodified-Since, held by Zoho's approval process.
 *
 * Once the release stands (approved — on this press, or on a later press after the approvers decided): the forfeit
 * is ₹50,000 a unit and the rest of the MATCHED money is raised as ONE Pending Refund receipt through
 * ../money/allotment-receipts `guarded` (a Cancelled allotment takes a Refund only). The Refund is matched later by
 * the second hand like every receipt; nothing here moves money to Matched. The forfeit is carried in the refund's
 * Note — Receipts.Kind has no Forfeit value in the org (GAP, reported). hold.changed "lapsed" is emitted with an event
 * id derived from the fact, so a re-press re-sends the same event and never a second refund (a Refund already
 * standing against the allotment is found and returned).
 * Logs carry ids and codes only.
 */

import type { UserCredential, ZohoClient, ZohoRecord } from "../../lib/zoho/client";
import type { AuthorityEvents } from "../identity/authority";
import { releaseLapsedHold, RELEASE_MESSAGES, type ReleaseRefusal } from "../access/lapse-release";
import { ZOHO_SEAT_OF_TOKEN } from "../access/guard-core";
import { seatAccess } from "../access/policy";
import type { AllotmentReceiptWrites } from "../money/allotment-receipts";
import type { Publish, Published } from "../money/match";
import { ALLOTMENTS_MODULE, RECEIPTS_MODULE } from "../money/register";
import { commitmentOf, dayOf, daysLeft, dueOf, holdChangedEvent, INBOUND_KINDS, lapseMoney, REFUND_KIND } from "./rules";

const RECORD_ID = /^\d{15,22}$/;
const SESSION_ID = /^[A-Za-z0-9_-]{16,128}$/;
const FIELDS = ["Allocation_Status", "Hold_Until", "Reserved_Units", "Unit_Price", "Customer", "Hold_Extension_State", "Modified_Time", "$approval_state"] as const;

export type LapseRefusal = ReleaseRefusal | "extension-waiting" | "nothing-due" | "receipt-unmatched" | "invalid-request" | "refund-not-raised";
export const LAPSE_MESSAGES: Readonly<Record<LapseRefusal, string>> = Object.freeze({
  ...RELEASE_MESSAGES,
  "extension-waiting": "There is an extension request waiting on the approvers. It has to be decided before the reservation can be released.",
  "nothing-due": "Nothing is due on this reservation — the balance has landed. Allot it; do not release it.",
  "receipt-unmatched": "A receipt against this reservation is not matched yet. Match or answer it before releasing the units.",
  "invalid-request": "Name the reservation to release.",
  "refund-not-raised": "The reservation is released, but the refund was not recorded. Press again to record it; nothing is recorded twice.",
});

export interface LapseView {
  readonly allotmentId: string;
  readonly state: "pending-approval" | "released";
  readonly units: number;
  readonly forfeit: number;
  readonly refund: number;
  /** The Pending Refund receipt, once raised (or found already standing). */
  readonly refundReceiptId: string | null;
  readonly event: Published | null;
}
export type LapseResult =
  | { readonly ok: true; readonly value: LapseView }
  | { readonly ok: false; readonly status: 400 | 403 | 404 | 409 | 502 | 503; readonly refusal: LapseRefusal; readonly message: string };

export interface LapseDependencies {
  readonly crm: Pick<ZohoClient, "getRecord" | "update" | "coql" | "insert">;
  readonly writes: Pick<AllotmentReceiptWrites, "guarded">;
  readonly publish: Publish;
  readonly events: AuthorityEvents;
  readonly approvalConfigured: boolean;
  readonly clock?: () => number;
}
export interface LapsePrincipal {
  readonly credential: UserCredential;
  readonly sessionId: string;
  readonly session: { readonly who: string; readonly seat: string };
}

class Fail { constructor(readonly status: 404 | 502, readonly refusal: LapseRefusal) {} }
const int = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) ? v : null);

export function createHoldLapse(deps: LapseDependencies) {
  const clock = deps.clock ?? Date.now;

  const receiptsOf = async (cred: UserCredential, id: string) => {
    const r = await deps.crm.coql(cred, `select id, Kind, Amount, Match_State from ${RECEIPTS_MODULE} where Allotment = '${id}' limit 0, 2000`);
    if (!r.ok || r.value.moreRecords) throw new Fail(502, "zoho");
    let net = 0, unmatched = 0;
    let refundId: string | null = null;
    for (const x of r.value.records) {
      const amount = int(x.Amount), kind = typeof x.Kind === "string" ? x.Kind : "", st = typeof x.Match_State === "string" ? x.Match_State : "";
      if (amount === null || amount <= 0) throw new Fail(502, "zoho");
      if (kind === REFUND_KIND && st !== "Reversed" && st !== "Not found" && typeof x.id === "string") refundId = x.id;
      if (st === "Pending" || st === "Claimed") { if (kind !== REFUND_KIND) unmatched++; continue; }
      if (st !== "Matched") continue;
      net += INBOUND_KINDS.has(kind) ? amount : kind === REFUND_KIND ? -amount : 0;
    }
    return { net, unmatched, refundId };
  };

  return Object.freeze({
    async lapse(p: LapsePrincipal, allotmentId: unknown): Promise<LapseResult> {
      const no = (status: 400 | 403 | 404 | 409 | 502 | 503, refusal: LapseRefusal, ids: readonly string[] = []): LapseResult => {
        deps.events.refusedAction(p?.session?.who ?? "unknown", p?.session?.seat ?? "unknown", `lapse-${refusal}`, ids.filter((x) => RECORD_ID.test(x)));
        return { ok: false, status, refusal, message: LAPSE_MESSAGES[refusal] };
      };
      if (!p || typeof p.sessionId !== "string" || !SESSION_ID.test(p.sessionId) || !p.session) return no(400, "invalid-request");
      if (typeof allotmentId !== "string" || !RECORD_ID.test(allotmentId)) return no(400, "invalid-request");
      const id = allotmentId, cred = p.credential, { who, seat } = p.session;
      const zseat = Object.prototype.hasOwnProperty.call(ZOHO_SEAT_OF_TOKEN, seat) ? ZOHO_SEAT_OF_TOKEN[seat]! : null;
      if (!zseat || !seatAccess(zseat, who, {}).imCan("refund")) return no(403, "no-release-right", [id]);
      if (!deps.approvalConfigured) return no(503, "approval-not-configured", [id]);

      try {
        const got = await deps.crm.getRecord(cred, ALLOTMENTS_MODULE, id, { fields: FIELDS });
        if (!got.ok) return no(got.error.kind === "not-found" || got.error.kind === "forbidden" ? 404 : 502, got.error.kind === "not-found" || got.error.kind === "forbidden" ? "not-found" : "zoho", [id]);
        const rec: ZohoRecord | null = got.value;
        if (!rec) return no(404, "not-found", [id]);
        const status = rec.Allocation_Status, hold = dayOf(rec.Hold_Until), units = int(rec.Reserved_Units), investorId = typeof rec.Customer === "object" && rec.Customer ? (rec.Customer as { id?: unknown }).id : null;
        if (!hold || units === null || units < 0 || typeof investorId !== "string") return no(502, "zoho", [id]);
        const now = clock();
        if (daysLeft(hold, now) >= 0) return no(409, "hold-running", [id]);
        const money = await receiptsOf(cred, id);
        const { forfeit, refund } = lapseMoney(units, money.net);

        let state: LapseView["state"];
        if (status === "Reserved") {
          if (rec.Hold_Extension_State === "Requested") return no(409, "extension-waiting", [id]);
          const committed = commitmentOf(units, rec.Unit_Price);
          if (committed === null) return no(502, "zoho", [id]);
          if (dueOf(committed, money.net) === 0) return no(409, "nothing-due", [id]);
          if (money.unmatched > 0) return no(409, "receipt-unmatched", [id]);
          const r = await releaseLapsedHold({ crm: deps.crm, as: cred, session: p.session, allotmentId: id, events: deps.events, approvalConfigured: deps.approvalConfigured, clock });
          if (!r.ok) return { ok: false, status: r.status, refusal: r.refusal, message: r.message };
          state = r.state;
        } else if (status === "Cancelled") {
          // A later press after the approvers decided: settle the refund once.
          state = rec.$approval_state === "approved" || rec.$approval_state === undefined ? "released" : "pending-approval";
        } else {
          return no(409, "not-reserved", [id]);
        }
        if (state === "pending-approval") {
          return { ok: true, value: Object.freeze({ allotmentId: id, state, units, forfeit, refund, refundReceiptId: null, event: null }) };
        }

        let refundReceiptId = money.refundId;
        if (!refundReceiptId && refund > 0) {
          const w = await deps.writes.guarded({ credential: cred, sessionId: p.sessionId }, id, REFUND_KIND, async (signal) => {
            const ins = await deps.crm.insert(cred, RECEIPTS_MODULE, [{
              Allotment: { id }, Kind: REFUND_KIND, Amount: refund, Match_State: "Pending",
              Note: `Reservation lapsed: ₹${forfeit.toLocaleString("en-IN")} forfeit (₹50,000 a unit) retained; ${units} unit${units === 1 ? "" : "s"} back on the shelf.`,
            }], { signal });
            const one = ins.ok ? ins.value[0] : null;
            return one && one.ok && one.id
              ? { ok: true as const, receiptId: one.id, duplicate: false }
              : { ok: false as const, kind: "source-error" as const, source: "zoho" as const, errorKind: ins.ok ? "unexpected" as const : ins.error.kind, retryable: true };
          });
          if (!w.ok) return no(502, "refund-not-raised", [id]);
          refundReceiptId = w.receiptId;
        }
        let event: Published | null = null;
        try {
          event = await deps.publish(holdChangedEvent({ allotmentId: id, investorId, holdDay: hold, state: "lapsed", at: now, by: cred.userId,
            reason: `${units} unit${units === 1 ? "" : "s"} released; forfeit ${forfeit}; refund ${refund}` }));
        } catch { event = { ok: false, reason: "unexpected" }; }
        return { ok: true, value: Object.freeze({ allotmentId: id, state, units, forfeit, refund, refundReceiptId, event }) };
      } catch (e) {
        if (e instanceof Fail) return no(e.status, e.refusal, [id]);
        throw e;
      }
    },
  });
}
export type HoldLapse = ReturnType<typeof createHoldLapse>;
