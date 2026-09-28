/**
 * M10-S20-T02 — who reads and who pays payouts: the front end's rule (lib/im/money mayPayouts / markPaidGate),
 * asked of the seat the live session holds now, through the one policy (../access/policy seatAccess):
 *   read  — the Investors-side "pay" or "bank" capability (Head of Finance, Finance Operations);
 *   pay   — the "pay" capability (the same two; Compliance, the Auditor, KAMs and IRs never). The super user's
 *           role has both, but its Zoho seat (Digital Infrastructure) is an Administrator profile the policy
 *           admits to no console page, so it is refused here too — the policy decides, not this file.
 * Every seat with pay/bank is on the Finance team or is the super user, so mayPayouts' notFin test holds too.
 */
import { seatAccess } from "../access/policy";
import { zohoSeatOf } from "../data/live";

export interface PayoutCaps { readonly read: boolean; readonly pay: boolean }

export function payoutCapsOf(seatToken: string, who: string): PayoutCaps {
  const seat = typeof seatToken === "string" ? zohoSeatOf(seatToken) : null;
  if (!seat) return Object.freeze({ read: false, pay: false });
  const a = seatAccess(seat, who, {});
  const pay = a.imCan("pay");
  return Object.freeze({ read: pay || a.imCan("bank"), pay });
}
