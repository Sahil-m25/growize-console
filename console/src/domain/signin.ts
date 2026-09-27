/**
 * The sign-in door's copy and the merged console's two-sided page map.
 * Ports `ref/ir-merged.js` lines 180, 11098-11102 and `ref/merge-glue.js` lines 7-18.
 */

/** Why somebody is looking at the sign-in screen, if not by choice. */
export type SignOutWhy = "chose" | "expired" | "revoked";

export const SIGNOUTMSG: Record<SignOutWhy, readonly [string, string]> = {
  chose:  ["You are signed out.", "Nothing you had recorded was lost."],
  expired:["Your session ended after 12 hours.", "Sign in again to carry on. Recorded work is saved; unsaved inputs were cleared."],
  /* the second line names who can grant, read from the record (@/lib/signin-copy revokedLine) */
  revoked:["Your access has been turned off.", "Digital Infrastructure can turn it back on."],
};

/** Console access only by a Digital Infrastructure grant. */
export const BYGRANT = ["exec", "bu", "corp", "cp"] as const;

/** One rail entry per page that exists on both sides: lead key → Investors view. */
export const MERGE: Record<string, string> = {today:"dash", pay:"txn", docs:"docs", activity:"act", people:"team", system:"sys",
  inv:"inv", farms:"farms", tkt:"tkt", invupd:"upd", numbers:"ins"};

/** Investors view → the rail entry it sits under. */
export const IM2M: Record<string, string> = Object.fromEntries(Object.entries(MERGE).map(([k, v]) => [v, k]));
