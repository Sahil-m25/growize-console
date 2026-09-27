/**
 * Money: what Finance has confirmed, what an IR says an investor has paid, the reservation clock,
 * and the transfer into the investor database.
 * Ports `ref/03-app.js` lines 652-657, 689-696, 796-808, 1275, 1557-1561, 1938 and 1963.
 */

import type { ClaimKind } from "./types";


/**
 * RESERVATION EXTENSION. Balance is due in 30 days; the BU Owner approves an extension, and a
 * lapse forfeits ₹50,000 per unit and puts the units back on the shelf.
 */
export const EXTDAYS = [7,15,30] as const;


/** ₹50,000 per unit, forfeit when a reservation lapses. */
export const FORFEIT = 50000;


/** What a payment report is FOR — `CLAIMKINDS`. */
export const CLAIMKINDS: Record<ClaimKind, string> = {
  advance:"Advance", balance:"Balance", full:"Full payment", other:"Other payment",
};

/** How the investor said they paid. */
export const CLAIMMODES = ["RTGS", "NEFT", "IMPS", "SWIFT", "Cheque"] as const;

