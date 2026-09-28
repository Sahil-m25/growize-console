/**
 * M01-S10-T04 — RELEASING A LAPSED RESERVATION: STEP-UP, THEN THE ZOHO APPROVAL PROCESS (D22).
 *
 * The prototype's lapseHold (ir-merged 4114-4167): only a seat with the "refund" right (Head of Finance;
 * the super user's `di` side), only an allotment still Reserved whose Hold_Until has passed. Here the
 * caller has already passed requireStepUp("release"). The one write is the allotment's
 * Allocation_Status → Cancelled, on the person's own token, guarded by the Modified_Time the screen
 * loaded (If-Unmodified-Since). Zoho's approval process (M01-S10-T03, Sahil's config: approvers the tech
 * lead and Pradeep) catches that edit and holds it; the record is read back once for `$approval_state`,
 * and the answer is "pending-approval". The forfeit and refund Receipts follow the approval
 * (M02-S12); nothing here moves money.
 *
 * Fail closed: until Sahil confirms the approval process exists (GZ_RELEASE_APPROVAL=on), the release is
 * refused — without it the edit would cancel the allotment with no second hand.
 */

import type { ZohoClient, UserCredential } from "../../lib/zoho/client";
import type { AuthorityEvents } from "../identity/authority";
import { ZOHO_SEAT_OF_TOKEN } from "./guard-core";
import { seatAccess } from "./policy";

export const RELEASE_MODULE = "LLP_UnitAllocation_Module";
const FIELDS = ["Allocation_Status", "Hold_Until", "Reserved_Units", "Modified_Time"] as const;
const RECORD_ID = /^\d{15,22}$/;

export type ReleaseRefusal = "no-release-right" | "approval-not-configured" | "not-found" | "not-reserved" | "hold-running" | "changed" | "zoho";

export const RELEASE_MESSAGES: Readonly<Record<ReleaseRefusal, string>> = Object.freeze({
  "no-release-right": "Your seat cannot release a reservation.",
  "approval-not-configured": "Releasing a reservation waits for the Zoho approval process to be set up. Nothing was changed.",
  "not-found": "That reservation is not one Zoho shows you.",
  "not-reserved": "This allotment is not a reservation any more.",
  "hold-running": "The hold has not run out yet.",
  changed: "Someone changed this reservation after you opened it. Reload, then try again.",
  zoho: "Zoho did not take the release. Nothing was changed; try again.",
});

export type ReleaseResult =
  | { readonly ok: true; readonly allotmentId: string; readonly state: "pending-approval" | "released"; readonly modifiedTime: string | null }
  | { readonly ok: false; readonly status: 403 | 404 | 409 | 502 | 503; readonly refusal: ReleaseRefusal; readonly message: string };

/** "YYYY-MM-DD" for a moment, in Asia/Kolkata. */
export const kolkataDay = (ms: number): string => new Date(ms + 330 * 60_000).toISOString().slice(0, 10);

export async function releaseLapsedHold(d: {
  readonly crm: Pick<ZohoClient, "getRecord" | "update">;
  readonly as: UserCredential;
  readonly session: { readonly who: string; readonly seat: string };
  readonly allotmentId: string;
  readonly events: AuthorityEvents;
  readonly approvalConfigured: boolean;
  readonly clock?: () => number;
}): Promise<ReleaseResult> {
  const now = (d.clock ?? Date.now)();
  const { who, seat } = d.session;
  const id = d.allotmentId;
  const no = (status: 403 | 404 | 409 | 502 | 503, refusal: ReleaseRefusal): ReleaseResult => {
    d.events.refusedAction(who, seat, `release-${refusal}`, RECORD_ID.test(id) ? [id] : []);
    return { ok: false, status, refusal, message: RELEASE_MESSAGES[refusal] };
  };
  const zseat = Object.prototype.hasOwnProperty.call(ZOHO_SEAT_OF_TOKEN, seat) ? ZOHO_SEAT_OF_TOKEN[seat]! : null;
  if (!zseat || !seatAccess(zseat, who, {}).imCan("refund")) return no(403, "no-release-right");
  if (!d.approvalConfigured) return no(503, "approval-not-configured");
  if (typeof id !== "string" || !RECORD_ID.test(id)) return no(404, "not-found");

  const got = await d.crm.getRecord(d.as, RELEASE_MODULE, id, { fields: FIELDS });
  if (!got.ok) return no(502, "zoho");
  const rec = got.value;
  if (!rec) return no(404, "not-found");
  if (rec.Allocation_Status !== "Reserved") return no(409, "not-reserved");
  const hold = typeof rec.Hold_Until === "string" ? rec.Hold_Until.slice(0, 10) : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(hold) || hold >= kolkataDay(now)) return no(409, "hold-running");
  const since = typeof rec.Modified_Time === "string" ? rec.Modified_Time : null;
  if (!since) return no(409, "changed");

  const w = await d.crm.update(d.as, RELEASE_MODULE, id, { Allocation_Status: "Cancelled" }, { ifUnmodifiedSince: since });
  if (!w.ok) return w.error.kind === "conflict" ? no(409, "changed") : no(502, "zoho");

  /* the approval process holds the edit: read back its state (ids and a status only) */
  const back = await d.crm.getRecord(d.as, RELEASE_MODULE, id, { fields: ["Allocation_Status", "$approval_state"] });
  /* Zoho reads a record outside any approval as "approved"; anything else is the process holding it */
  const released = back.ok && !!back.value && back.value.Allocation_Status === "Cancelled" && back.value.$approval_state === "approved";
  return { ok: true, allotmentId: id, state: released ? "released" : "pending-approval", modifiedTime: w.value.modifiedTime };
}
