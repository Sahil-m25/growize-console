/**
 * M13-S03-T02 / M13-S06-T02 — the Investors-side rights a signed-in seat holds, read from the ONE rights
 * model (lib/im ROLE via server/access/policy seatAccess), never re-ported: the server and the screen
 * cannot disagree about who may work a ticket, close a bank ticket or publish an update.
 *
 *   tkt     work tickets (open, park, close, reply)          bank    see bank accounts (a Bank ticket needs it)
 *   assign  open a ticket owned by someone else              upd     publish an investor update
 *   team    "fin" (Finance, Legal & Compliance) · "am" (Account Management) · "di" · null
 *
 * The seat token is the session's (CONSOLE_SEAT vocabulary); an unknown token, a seat with no Investors
 * side (viewer, IR…) or an Administrator-profile seat holds no right — fail closed.
 */

import { ROLE, type ImCan } from "../../lib/im";
import { seatAccess, ZOHO_SEAT_SIDES } from "../access/policy";
import type { ZohoSeat } from "../oauth/seat";
import { CONSOLE_SEAT } from "../oauth/user-session";

export interface ImRights {
  readonly tkt: boolean;
  readonly bank: boolean;
  readonly assign: boolean;
  readonly upd: boolean;
  readonly team: "fin" | "am" | "di" | "sys" | null;
}

export const NO_RIGHTS: ImRights = Object.freeze({ tkt: false, bank: false, assign: false, upd: false, team: null });

/** The session's seat token back to its Zoho seat (the same map server/data/live.ts zohoSeatOf uses). */
export function zohoSeatOfToken(token: string): ZohoSeat | null {
  if (token === "ops" || token === "di") return "digital-infrastructure";
  const hit = (Object.entries(CONSOLE_SEAT) as [ZohoSeat, string | null][]).find(([, t]) => t === token);
  return hit ? hit[0] : null;
}

export function imRightsOf(seatToken: string, userId: string): ImRights {
  const seat = zohoSeatOfToken(seatToken);
  if (!seat) return NO_RIGHTS;
  const a = seatAccess(seat, userId, {});
  if (!a.admission.ok) return NO_RIGHTS;
  const im = ZOHO_SEAT_SIDES[seat].im;
  const can = (c: ImCan) => a.imCan(c);
  return Object.freeze({ tkt: can("tkt"), bank: can("bank"), assign: can("assign"), upd: can("upd"), team: im ? ROLE[im].tm : null });
}
