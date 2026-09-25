/* ── features/add/cap.ts — why a capability is missing, said once ────────────────────────────
   Ports `ref/03-app.js` (redesigned) 4174–4184 (`grantorOf`, `whoCanGrant`, `capWhy`).

   Every dependency this needs — `hasCap`, `mgrOf`, `roleOf`, `PAGECAPS`, `CAPT` — already lives in
   `@/lib/selectors` and `@/domain`; only the three functions that compose them into a sentence are
   missing. They belong in `src/lib/selectors/access.ts` (Events, Leads and every other page that
   refuses a write will want the same wording) — see crossOwnerRequests. Kept here, under the
   prototype's own names, only because this feature is what needed it first. */

import type { Cap, PersonKey } from "@/domain";
import { CAPT, PAGECAPS } from "@/domain";
import type { Ctx } from "@/lib/selectors";
import { hasCap, mgrOf, P, roleOf } from "@/lib/selectors";

/* who can put a refused capability back. Never a desk to ring: the manager who holds the grid, or
   Digital Infrastructure when there is nobody above you. 03-app.js:4174 */
export function grantorOf(ctx: Ctx, k: PersonKey): PersonKey | null {
  return mgrOf(ctx.PEOPLE, k)
    ?? Object.keys(ctx.PEOPLE).find(x => ctx.PEOPLE[x]?.on && roleOf(ctx.PEOPLE, x) === "ops")
    ?? null;
}

/* a grant may never exceed the granter's own set. 03-app.js:4183 */
function whoCanGrant(ctx: Ctx, p: string, c: Cap): PersonKey | null {
  const g = grantorOf(ctx, ctx.WHO);
  return g && hasCap(ctx, g, p, c) ? g : null;
}

/* 03-app.js:4184 */
export function capWhy(ctx: Ctx, p: string, c: Cap): string {
  const g = whoCanGrant(ctx, p, c);
  const any = Object.keys(ctx.PEOPLE).some(k => ctx.PEOPLE[k]?.on && !ctx.PEOPLE[k]?.ext && hasCap(ctx, k, p, c));
  const page = (PAGECAPS as Record<string, { t: string; nopage?: boolean }>)[p];
  const where = page ? (page.nopage ? "" : " on " + page.t) : " on " + p;
  return `Your seat does not hold “${CAPT[c] || c}”${where}. Your access grid `
    + `decides that, not this screen. `
    + (g ? `Ask ${P(ctx.PEOPLE, g).n.split(" ")[0]} to put it back.`
      : any ? `Nobody above you holds it either — it has to come from whoever set the seats up.`
        : `No seat in this console holds it, so there is nothing here to ask for.`);
}
