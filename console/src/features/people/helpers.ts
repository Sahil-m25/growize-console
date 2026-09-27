"use client";

/* Lending a page, and the one opener the roster shares with Profile and the presence drawer.
   Ports `ref/03-app.js` 5578–5583 (`tCanLend`, `tPages`, `tMine`, `tSeen`) and 913–918 (`absOpen`).

   Also carries what the redesigned prototype's vTeams/vMembers/person drawer need and the port's
   `@/lib/selectors` does not yet export: the "one answer to how many screens" count (`screensOf`,
   `screenCount`, ir-console-redesigned.html:2930-2954), the individual-override read-out (`capDev`,
   `devWhy`), a short availability line for the person drawer (`availStatus`, `availCover`,
   ir-console-redesigned.html:10358-10372), and the staff-handover plan the "leaver" flow reviews
   before it removes anybody (`leaverPlan` and friends, ir-console-redesigned.html:11117-11146).
   These are pure reads over selectors that already exist; see crossOwnerRequests for moving the
   screen-count and capability-deviation helpers into `@/lib/selectors/access.ts` — `@/domain`
   already carries `PageCaps.nopage` — so `@/features/me` can share them instead of reimplementing
   them. */

import { CAPT, PAGECAPS, SEATCAPS } from "@/domain";
import type { Cap, NavKey, PersonKey, TempGrant } from "@/domain";
import { dAdd, iso, isoDay } from "@/lib/format";
import {
  acting,
  active,
  canManage,
  hasCap,
  lost,
  outFor,
  outFromD,
  outTo,
  own,
  P,
  planFor,
  reachBase,
  reachOf,
  roleOf,
  secOK,
} from "@/lib/selectors";
import type { Action, ConsoleState } from "@/lib/store";

/* a borrowed page is never lent onward, so this reads `own` and never `may` */
export const tCanLend = (s: ConsoleState): boolean => own(s, "people", "seats");

export const tPages = (s: ConsoleState): string[] =>
  reachBase(s.PEOPLE, s.WHO).filter((x) => x !== "me" && !!(PAGECAPS as Record<string, unknown>)[x]);

export const tMine = (s: ConsoleState): TempGrant[] => s.TEMP.filter((g) => g.to === s.WHO);

/* who a grant is VISIBLE to. This is never the reporting chain (`supervisedActors`) — a viewer with
   no seats authority sees only what they granted, what they hold, and what they can manage; a BU
   Owner watching Kavya's numbers is not thereby entitled to see who lent Kavya a page.
   ir-console-redesigned.html:10948. */
export const tSeen = (s: ConsoleState): TempGrant[] =>
  s.TEMP.filter((g) => g.by === s.WHO || g.to === s.WHO || canManage(s, g.to));

/* every opener seeds its own draft, so yesterday's half-finished answer for one person is never
   offered as this person's. 03-app.js:913 */
export const absOpen = (s: ConsoleState, k: PersonKey): Action => {
  const a = s.AVAIL[k];
  return {
    type: "openDrawer",
    k: "absence",
    id: k,
    seed: {
      ABWHY: a ? a.why : null,
      ABFROM: a && isoDay.test(a.from) ? a.from : iso(s.NOW),
      ABTO: a && isoDay.test(a.to) ? a.to : iso(dAdd(s.NOW, 1)),
    },
  };
};

/* opening one member: the drawer, and the selection the seat control reads. 03-app.js:5504 */
export const openPerson = (k: PersonKey): Action => ({
  type: "openDrawer",
  k: "person",
  id: k,
  seed: { PSEL: k },
});

/** how many of the fourteen pages there are — `Object.keys(PAGECAPS).length` */
export const PAGECOUNT = Object.keys(PAGECAPS).length;

/* ---- "one answer to how many screens" — ir-console-redesigned.html:2930-2941 -------------------
   A screen is an entry in PAGECAPS that is not marked `nopage` — `add`'s capability stays on the
   grid (capture, wherever the form was opened from) but it is no longer a place you go, so it is
   dropped here exactly as the redesign drops it, and, unlike the ceiling `reachOf`, a page whose
   `view` was taken away by hand is dropped too. */
export function screensOf(s: ConsoleState, k: PersonKey): NavKey[] {
  return reachOf(s, k).filter(
    (p) => !PAGECAPS[p as NavKey]?.nopage && hasCap(s, k, p, "view"),
  ) as NavKey[];
}
export const screenCount = (): number =>
  (Object.keys(PAGECAPS) as NavKey[]).filter((p) => !PAGECAPS[p]!.nopage).length;

/** the part of somebody's access that nobody's seat gave them. 03-app.js (redesigned):2944 */
export type CapDeviation = { p: NavKey; off: Cap[]; on: Cap[]; gone: boolean };
export function capDev(s: ConsoleState, k: PersonKey): CapDeviation[] {
  const grant = s.CAPS[k] || {};
  const out: CapDeviation[] = [];
  (Object.keys(grant) as NavKey[]).forEach((p) => {
    if (!(PAGECAPS as Record<string, unknown>)[p] || reachBase(s.PEOPLE, k).indexOf(p) < 0) return;
    const seat = ((SEATCAPS as Record<string, Record<string, Cap[]>>)[roleOf(s.PEOPLE, k) || ""] || {})[p] || [];
    const now = grant[p] || [];
    const off = seat.filter((c) => now.indexOf(c) < 0);
    const on = now.filter((c) => seat.indexOf(c) < 0);
    if (off.length || on.length) out.push({ p, off, on, gone: now.indexOf("view") < 0 });
  });
  return out;
}
/** the same deviation in words, so the row, the hover and the grid all say it the same way */
export function devWhy(s: ConsoleState, k: PersonKey): string {
  return capDev(s, k)
    .map((d) => {
      const t = (PAGECAPS as Record<string, { t: string }>)[d.p]?.t ?? d.p;
      if (d.gone) return t + ": taken away";
      const parts = [
        d.off.length ? "without " + d.off.map((c) => CAPT[c] || c).join(" and ") : "",
        d.on.length ? "plus " + d.on.map((c) => CAPT[c] || c).join(" and ") : "",
      ].filter(Boolean);
      return t + ": " + parts.join(", ");
    })
    .join(" · ");
}

/* ---- a short availability line for the person drawer. 03-app.js (redesigned):10358-10372 ------ */
export type AvailInfo = { out: boolean; soon: boolean; t: string; detail: string };
export function availStatus(s: ConsoleState, k: PersonKey): AvailInfo {
  const o = outFor(s, k);
  const soon = planFor(s, k);
  return {
    out: !!o,
    soon: !!soon,
    t: o ? "Out" : "In",
    detail: o
      ? "Back " + outTo(s, k)
      : soon
        ? "Away " + outFromD(s, k) + " · back " + outTo(s, k)
        : "Available for follow-ups",
  };
}
/** who is actually carrying their book while they are out, read off the same cover the lead itself
    reads — never their absence reason, which stays off any list more than one person opens */
export function availCover(s: ConsoleState, k: PersonKey): string {
  if (!outFor(s, k)) return "";
  const names = Array.from(
    new Set(
      s.LEADS.filter((l) => l.own === k && active(l) && !lost(l))
        .map((l) => {
          const by = acting(s, l);
          return by !== k ? by : secOK(s, l) ? (l.sec ?? null) : null;
        })
        .filter((x): x is PersonKey => !!x),
    ),
  );
  return names.length ? "Cover: " + names.map((x) => P(s.PEOPLE, x).n).join(", ") : "";
}

/* ---- staff handover, reviewed before it removes anybody. 03-app.js (redesigned):11117-11157 ----
   Leaving the team is one reviewed write: the entire modeled IR book moves before access ends.
   Historical authors and commercial records are never rewritten by a staff handover. */
export const leaverDraftId = (s: ConsoleState, k: PersonKey): string => s.WHO + ":" + k;

/* leaverMayManage/leaverInScope/leaverSuccessors/leaverPlan/LeaverPlan used to be reimplemented
   here, and that copy's `leaverSuccessors` filtered through the port's broader `assignees` instead
   of the prototype's IR-only successor list — a Channel Partner could be picked as a leaver's
   successor. `@/lib/selectors/access.ts` already carries the correct versions (IR-only, with the
   `signature` field the reviewed-write refusal wants); re-exported rather than duplicated so the
   two can never drift again. */
export {
  leaverMayManage,
  leaverInScope,
  leaverSuccessors,
  leaverPlan,
  type LeaverPlan,
} from "@/lib/selectors";
