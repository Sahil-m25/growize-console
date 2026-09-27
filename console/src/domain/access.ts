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

import type { Duration, TempStateRead } from "./types";

/** How long a page may be lent for. */
export const TDUR: Record<string, Duration> = {d1:{t:"today only",days:1}, d3:{t:"3 days",days:3},
              w1:{t:"1 week",days:7},   w2:{t:"2 weeks",days:14}};

/** Every state a grant reads as. `expired`/`pending`/`invalid`/`unavailable` are all derived, never
 *  stored (ir-console-redesigned.html:2904). */
export const TSTATE: Record<TempStateRead, string> = {live:"live", revoked:"revoked", expired:"expired",
  pending:"not started", invalid:"invalid window", unavailable:"unavailable"};

