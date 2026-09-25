/**
 * TEMPORARY ACCESS. Ports `ref/03-app.js` lines 256-283 and 334.
 *
 * Somebody is out and something has to be done from their screen. The way every office solves that
 * is a shared password, and a shared password destroys the one thing this console exists for:
 * knowing who did what. So the login is never lent — the access is.
 *
 * A person who holds a page may lend that page, to one named person, for a stated window, with a
 * reason. It is never more than the lender holds. The borrower has to switch it on, and while it
 * is on the console says so on every screen and stamps the grant onto every line it writes. It can
 * be pulled at any moment, and pulling it does not erase a single thing done under it: the grant
 * keeps its own list of what it was used for, and that list outlives the grant.
 */

import type { CapGrid, Duration, PersonKey, TempGrant, TempStateRead } from "./types";

/** The last grant id minted; the next one is this plus one. */
export const TSEQ = 2;

export const TEMP: TempGrant[] = [
  {id:"T-01", to:"kavya", by:"tasneem", page:"docs", caps:["view"], from:"27 Aug 09:40",
   until:"02 Sep", why:"Chasing Joseph Mathew's FEMA pack while Harsha is out",
   state:"live", acts:3},
  {id:"T-00", to:"ananya", by:"tasneem", page:"goals", caps:["view"], from:"04 Aug 11:00",
   until:"11 Aug", why:"Building the September event plan", state:"live", acts:2},
  {id:"T-02", to:"nikhil", by:"tasneem", page:"activity", caps:["view","others"], from:"12 Aug 10:05",
   until:"15 Aug", why:"Covering the weekly review", state:"revoked", by2:"tasneem",
   on:"14 Aug 17:20", acts:6}
];

/** How long a page may be lent for. */
export const TDUR: Record<string, Duration> = {d1:{t:"today only",days:1}, d3:{t:"3 days",days:3},
              w1:{t:"1 week",days:7},   w2:{t:"2 weeks",days:14}};

/** Every state a grant reads as. `expired`/`pending`/`invalid`/`unavailable` are all derived, never
 *  stored (ir-console-redesigned.html:2904). */
export const TSTATE: Record<TempStateRead, string> = {live:"live", revoked:"revoked", expired:"expired",
  pending:"not started", invalid:"invalid window", unavailable:"unavailable"};

/**
 * Per-person capability overrides — `person -> {page:[caps]}`.
 *
 * The effective grid for a person is their seat's preset plus any override here, and never a page
 * their chain does not reach. The prototype starts this empty; a manager fills it from the grid on
 * People, and `resetCaps()` deletes a person's entry to put them back on the seat preset.
 */
export const GRANT: Record<PersonKey, CapGrid> = {};
