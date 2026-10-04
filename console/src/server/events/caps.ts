/**
 * Who may add/correct/remove events (`events · edit`) and load a sheet (`events · load`) — asked of
 * the front end's own rule (lib/selectors/access `may`) over the same one-person context the route
 * guard decides pages with (access/policy accessCtx + ZOHO_SEAT_SIDES), so the page, the guard and
 * this write cannot disagree. The super user (D68) is Digital Infrastructure on the lead side, as in
 * the guard (guard-core reachForSides), not refused as seatAccess's sign-in door would.
 * D115 ruling 2: `events · load` on the Digital Infrastructure seat is the super administrator's alone (SUPERCAPS,
 * named by CONSOLE_SUPER_ADMIN_IDS through access/policy superAdminMark); another DI member loads only when granted.
 */

import type { CapGrid } from "../../domain";
import { may } from "../../lib/selectors/access";
import { accessCtx, ZOHO_SEAT_SIDES } from "../access/policy";
import { zohoSeatOf } from "../data/live";

export function eventCaps(seatToken: string, who: string, grants: CapGrid, now: Date = new Date()): { readonly edit: boolean; readonly load: boolean } {
  const seat = zohoSeatOf(seatToken);
  const sides = seat ? ZOHO_SEAT_SIDES[seat] : undefined;
  if (!sides) return { edit: false, load: false };
  const ctx = accessCtx(who, sides, grants, now);
  return { edit: may(ctx, "events", "edit"), load: may(ctx, "events", "load") };
}
