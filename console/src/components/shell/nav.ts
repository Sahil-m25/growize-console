/* =================================================================================================
   THE RAIL'S ARITHMETIC — count, landSafe, and the badge's wording.
   Ported from 03-app.js 7009–7021 and 7145–7151.

   navFor() and scopeCount() are pure reads of the record and live in @/lib/selectors with the rest
   of them; they are re-exported here so the shell has one import for everything the rail needs and
   there is still only one implementation of each.

   Every badge on the rail is counted off the same list the screen it points at draws, so the badge
   and the queue can never disagree — which is why count() is here beside the router rather than
   inside each page.
   ============================================================================================== */

import type { NavKey, Scope } from "@/domain";
import { PAGECAPS } from "@/domain";
import {
  canAssign,
  canOperateLeads,
  canReach,
  isIR,
  navFor,
  nextUp,
  openable,
  scopeCount,
  scopeOf,
  seesTeam,
  todayList,
  unread,
} from "@/lib/selectors";
import type { Action, ConsoleState } from "@/lib/store";
import { parentOf, pathOf, type View } from "./routes";
import { investorCopyBook, investorCopyEligibility, investorCopyOf } from "@/lib/investor-copy";

export { navFor, scopeCount };
export type NavItem = ReturnType<typeof navFor>[number];

/* count(k) — 03-app.js:7009 */
export function count(state: ConsoleState, k: NavKey): number {
  if (k === "today") return scopeCount(state, "today", scopeOf(state, "today"));
  if (k === "leads") return scopeCount(state, "leads", scopeOf(state, "leads"));
  if (k === "updates") return unread(state);
  if (k === "xfer") return canReach(state,"xfer") ? investorCopyBook(state).filter(l => investorCopyEligibility(state,l).eligible && !investorCopyOf(state,l)).length : 0;
  return 0;
}

/* ---- WHAT MAY BE RED — navOwns/scopeBreach/navHot/navTip, 03-app.js:12960-12998.

   Red is two claims at once: the figure is breached, and it is yours to clear. Updates is news,
   not a breach, and Investor copies is Finance's to clear in the portal, not this seat's — so
   only Today and Leads ever go red, and only for the seat that can act on what is overdue. */

/** navOwns(k,sc) — whether clearing this scope's figure is this seat's to do at all. */
export function navOwns(state: ConsoleState, k: NavKey, sc?: Scope): boolean {
  const s = sc ?? scopeOf(state, k);
  /* your own day is always yours; the team's day is a manager's only if they can move a lead */
  if (k === "today") return s === "team" ? canAssign(state) : true;
  /* an unowned lead is cleared by claiming it or by handing it to somebody — nothing else clears it */
  if (k === "leads") return s === "team" ? canAssign(state) : (isIR(state.ROLE) || canAssign(state));
  return false; /* Updates is news, not a breach; transfers are Finance's */
}

/** scopeBreach(k,sc) — how much of that figure has already slipped, not merely fallen due. */
export function scopeBreach(state: ConsoleState, k: "today" | "leads", sc: Scope): number {
  if (k === "today") return todayList(state, sc).filter((l) => nextUp(state, l).urg === "now").length;
  return scopeCount(state, k, sc); /* a lead with nobody's name on it is breached by definition */
}

/** navHot(k,sc) — the badge's red half: owned, and breached. */
export function navHot(state: ConsoleState, k: NavKey, sc?: Scope): boolean {
  if (k !== "today" && k !== "leads") return false;
  const s = sc ?? scopeOf(state, k);
  return navOwns(state, k, s) && scopeBreach(state, k, s) > 0;
}

/* navTip(k,c,sc) — what the badge means when you hover it — 03-app.js:12986 */
export function navTip(state: ConsoleState, k: NavKey, c: number, sc?: Scope): string {
  const s = sc ?? scopeOf(state, k);
  const w = s === "team" ? " in the team's book" : "";
  if (k === "today") {
    const b = scopeBreach(state, "today", s);
    return `${c} need you today${w}${b ? ` — ${b} already overdue` : " — none overdue yet"}`;
  }
  if (k === "leads") return `${c}${c === 1 ? " lead has" : " leads have"} no owner${w}`;
  if (k === "updates") return `${c} unread`;
  if (k === "xfer") return `${c} ready to recover local investor copy tracking — live intake is not connected`;
  return String(c);
}

/* whether this nav row carries the personal/team switch under it — 03-app.js:7061 */
export function scopedRow(state: ConsoleState, n: NavItem): boolean {
  return !!n.scoped && canOperateLeads(state) && seesTeam(state);
}

/* the two rows under a scoped destination — 03-app.js:7069 */
export const SUBSCOPES: readonly (readonly [Scope, string])[] = [
  ["mine", "Personal"],
  ["team", "Team"],
];

/* landSafe() — 03-app.js:7145. Where you land when a page goes out from under you: the first
   screen the seat holds, with a record screen counted as reachable when its list is. "today" was
   once hard-coded here, and Marketing has no My day — so a Marketing seat revoking its own
   borrowed page landed on a screen it does not reach and had no way back.

   The prototype assigns to VIEW; this returns the view instead, because the caller — the shell —
   is the only thing that can actually navigate. */
export function landSafe(state: ConsoleState, view: View | null): View {
  if (view === "me" && canReach(state, "me")) return view;
  const ok = navFor(state).map((n) => n.k as string);
  if (view === "lead" && ok.includes("leads")) return view;
  if (view === "event" && ok.includes("events")) return view;
  if (view !== null && ok.includes(view)) return view;
  return (ok.includes("today") ? "today" : (ok[0] ?? "me")) as View;
}

/* go()'s seat check — 03-app.js:7116: "seat check, not just nav". A record screen is reachable
   when its list is. A `nopage` view (`/add` — dropped from NAV on purpose, nav.ts's own comment
   above) is never a nav destination but is always reachable: `@/features/me/reach` and
   `@/features/people/helpers` already carry this same guard for counting/listing screens, and
   without it here the shell's own `blocked` check (Shell.tsx) redirected a direct `/add` load to
   `today` before that route's effect ever got to open its drawer. */
export function mayReach(state: ConsoleState, view: View): boolean {
  if (PAGECAPS[parentOf(view)]?.nopage) return true;
  return canReach(state, parentOf(view));
}

/* findInvestor() — the redesigned prototype, ~13298. The header's search button and the Ctrl/Cmd+K
   / "/" hotkey (Shell.tsx's global key handler) are the same act, so both call this rather than
   keeping two slightly different copies of it: a seat that cannot reach Leads gets nothing, an
   active filter never survives into a fresh search, and the query field is what ends up focused
   and selected either way. */
export function findInvestor(
  state: ConsoleState,
  dispatch: (a: Action) => unknown,
  navigate: (href: string) => void,
): void {
  if (!navFor(state).some((n) => n.k === "leads")) return;
  dispatch({ type: "clearLeadFilters" });
  if (state.VIEW !== "leads") navigate(pathOf("leads" as View));
  const n = document.getElementById("lq") as HTMLInputElement | null;
  if (n) {
    n.focus();
    n.select();
  }
}
