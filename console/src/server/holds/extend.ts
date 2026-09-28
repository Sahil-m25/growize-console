/**
 * M08-S04-T02 — EXTENDING A RUNNING HOLD THROUGH THE ZOHO APPROVAL PROCESS (D09, D22, D48).
 *
 * The prototype's decideExt (merged html 7011-7030): an extension extends the deadline it was granted against —
 * old Hold_Until + days, by the one IST function (./rules extendedDeadline) — never today + days.
 * Who: the Head of Finance or the super user (the "refund" right, as the release). Only a Reserved allotment whose
 * hold is still running, with no request already waiting.
 *
 * The write (PROVISIONAL, Jev decide a 0.89): ONE guarded edit on the person's own token (If-Unmodified-Since = the
 * Modified_Time the page loaded, or the one just read) of Hold_Until = the new day together with
 * Hold_Extension_State = Requested, Hold_Extension_Days, Hold_Extension_Reason and Hold_Extension_Asked_By. Zoho's
 * approval process on the allotment (M08-S04-T01, Sahil) holds the edit until the approvers decide; its field update
 * sets Approved / Declined and Hold_Extension_Decided_At. The record is read back once for `$approval_state`.
 * hold.changed "extended" is emitted when the edit stands (approved); a pending answer emits nothing yet.
 * Fail closed: until the approval process exists (GZ_EXTEND_APPROVAL=on) the extension is refused — without it the
 * edit would move the deadline with no second hand.
 */

import type { UserCredential, ZohoClient } from "../../lib/zoho/client";
import type { AuthorityEvents } from "../identity/authority";
import { ZOHO_SEAT_OF_TOKEN } from "../access/guard-core";
import { seatAccess } from "../access/policy";
import type { Publish, Published } from "../money/match";
import { ALLOTMENTS_MODULE } from "../money/register";
import { dayOf, daysLeft, extendedDeadline, holdChangedEvent } from "./rules";

const RECORD_ID = /^\d{15,22}$/;
const ZDT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/;
export const MAX_EXTENSION_DAYS = 30;
const FIELDS = ["Allocation_Status", "Hold_Until", "Customer", "Hold_Extension_State", "Modified_Time"] as const;

export type ExtendRefusal = "no-extend-right" | "approval-not-configured" | "invalid-request" | "not-found" | "not-reserved"
  | "hold-ran-out" | "already-requested" | "changed" | "zoho";
export const EXTEND_MESSAGES: Readonly<Record<ExtendRefusal, string>> = Object.freeze({
  "no-extend-right": "Your seat cannot extend a hold.",
  "approval-not-configured": "Extending a hold waits for the Zoho approval process to be set up. Nothing was changed.",
  "invalid-request": `Say how many days (1–${MAX_EXTENSION_DAYS}) and why.`,
  "not-found": "That reservation is not one Zoho shows you.",
  "not-reserved": "This allotment is not a reservation any more.",
  "hold-ran-out": "The hold has already run out. Release the reservation, or record the balance.",
  "already-requested": "An extension is already waiting on the approvers.",
  changed: "Someone changed this reservation after you opened it. Reload, then try again.",
  zoho: "Zoho did not take the extension. Nothing was changed; try again.",
});

export type ExtendResult =
  | { readonly ok: true; readonly allotmentId: string; readonly state: "pending-approval" | "extended"; readonly from: string; readonly to: string; readonly event: Published | null }
  | { readonly ok: false; readonly status: 400 | 403 | 404 | 409 | 502 | 503; readonly refusal: ExtendRefusal; readonly message: string };

export async function requestHoldExtension(d: {
  readonly crm: Pick<ZohoClient, "getRecord" | "update">;
  readonly as: UserCredential;
  readonly session: { readonly who: string; readonly seat: string };
  readonly allotmentId: unknown;
  readonly body: { readonly days?: unknown; readonly reason?: unknown; readonly expectedModifiedTime?: unknown };
  readonly events: AuthorityEvents;
  readonly publish: Publish;
  readonly approvalConfigured: boolean;
  readonly clock?: () => number;
}): Promise<ExtendResult> {
  const now = (d.clock ?? Date.now)();
  const { who, seat } = d.session;
  const id = typeof d.allotmentId === "string" ? d.allotmentId : "";
  const no = (status: 400 | 403 | 404 | 409 | 502 | 503, refusal: ExtendRefusal): ExtendResult => {
    d.events.refusedAction(who, seat, `extend-${refusal}`, RECORD_ID.test(id) ? [id] : []);
    return { ok: false, status, refusal, message: EXTEND_MESSAGES[refusal] };
  };
  const zseat = Object.prototype.hasOwnProperty.call(ZOHO_SEAT_OF_TOKEN, seat) ? ZOHO_SEAT_OF_TOKEN[seat]! : null;
  if (!zseat || !seatAccess(zseat, who, {}).imCan("refund")) return no(403, "no-extend-right");
  if (!d.approvalConfigured) return no(503, "approval-not-configured");
  const days = d.body?.days, reason = typeof d.body?.reason === "string" ? d.body.reason.trim() : "";
  const expected = d.body?.expectedModifiedTime;
  if (!RECORD_ID.test(id) || typeof days !== "number" || !Number.isSafeInteger(days) || days < 1 || days > MAX_EXTENSION_DAYS
    || !reason || reason.length > 1000 || (expected !== undefined && expected !== null && (typeof expected !== "string" || !ZDT.test(expected)))) {
    return no(400, "invalid-request");
  }

  const got = await d.crm.getRecord(d.as, ALLOTMENTS_MODULE, id, { fields: FIELDS });
  if (!got.ok) return no(502, "zoho");
  const rec = got.value;
  if (!rec) return no(404, "not-found");
  if (rec.Allocation_Status !== "Reserved") return no(409, "not-reserved");
  const hold = dayOf(rec.Hold_Until);
  if (!hold || daysLeft(hold, now) < 0) return no(409, "hold-ran-out");
  if (rec.Hold_Extension_State === "Requested") return no(409, "already-requested");
  const mt = typeof rec.Modified_Time === "string" && ZDT.test(rec.Modified_Time) ? rec.Modified_Time : null;
  if (!mt || (typeof expected === "string" && expected !== mt)) return no(409, "changed");
  const investorId = rec.Customer && typeof rec.Customer === "object" ? (rec.Customer as { id?: unknown }).id : null;

  const to = extendedDeadline(hold, days);
  const w = await d.crm.update(d.as, ALLOTMENTS_MODULE, id, {
    Hold_Until: to, Hold_Extension_State: "Requested", Hold_Extension_Days: days, Hold_Extension_Reason: reason,
    Hold_Extension_Asked_By: { id: d.as.userId },
  }, { ifUnmodifiedSince: mt });
  if (!w.ok) return w.error.kind === "conflict" ? no(409, "changed") : no(502, "zoho");

  const back = await d.crm.getRecord(d.as, ALLOTMENTS_MODULE, id, { fields: ["Hold_Until", "$approval_state"] });
  const extended = back.ok && !!back.value && dayOf(back.value.Hold_Until) === to && back.value.$approval_state === "approved";
  let event: Published | null = null;
  if (extended && typeof investorId === "string") {
    try {
      event = await d.publish(holdChangedEvent({ allotmentId: id, investorId, holdDay: to, state: "extended", at: now, by: d.as.userId, reason: `${days} days` }));
    } catch { event = { ok: false, reason: "unexpected" }; }
  }
  return { ok: true, allotmentId: id, state: extended ? "extended" : "pending-approval", from: hold, to, event };
}
