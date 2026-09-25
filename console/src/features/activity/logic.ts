/* ── features/activity/logic.ts — the one filtered record set, shared by the page and its drawer ──
   Ports the pure head of `ref/03-app.js` (redesigned) `actSets()` (11570), `actPeople()` (11531),
   `actScopeLabel()` (11579) and the filename half of `actCSV()` (11605–11624).

   `activityRows` (selectors/activity.ts) is the actor- and record-access gate — everyone who may
   appear here at all. This file layers the toolbar's own filters (month, day, person, kind) on top
   of it, once, so the page and the "All history…" drawer can never disagree about what counts.

   ponytail: `activityWho`/`activitySolo` (selectors/activity.ts) collapse an unset person filter to
   "me", where the redesigned prototype's ACTWHO starts and stays `null` (team-wide) until someone
   actually picks a name — see crossOwnerRequests. Rather than edit that shared file, `who` below is
   computed locally, straight off the raw ui value, the way `actRows()` reads `ACTWHO` directly. */

import { KINDS } from "@/domain";
import type { LogEntry, PersonKey } from "@/domain";
import { P, activityRows, may } from "@/lib/selectors";
import type { ConsoleState } from "@/lib/store";
import type { ActView } from "./csv";

export const monthKey = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
export const daysInMonth = (d: Date): number => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();

export type ActivityFilters = {
  solo: boolean;
  /** everyone with at least one row in scope — actPeople(), not the full reporting chain */
  actors: PersonKey[];
  ACTM: Date;
  ACTDAY: string | null;
  /** the raw, unvalidated ui value — what the Person select's `value` binds to */
  ACTWHO: PersonKey | null;
  ACTKIND: string | null;
  ACTVIEW: ActView;
  ACTLIMIT: number;
  /** the validated filter actually applied to rows — null means "everyone in scope" */
  who: PersonKey | null;
  mkey: string;
  days: number;
  /** every matching row, all time (what the "All history…" drawer exports) */
  allTime: LogEntry[];
  /** allTime narrowed to the picked day, or the picked month */
  rows: LogEntry[];
  cuts: number;
  scopeLabel: (allHistory?: boolean) => string;
  exportName: (allHistory: boolean, view: ActView) => string;
};

export function activityFilters(state: ConsoleState): ActivityFilters {
  const solo = !may(state, "activity", "others");
  const base = activityRows(state);
  const actors = [...new Set(base.map((e) => e.who))]
    .filter((k): k is PersonKey => !!k)
    .sort((a, b) => P(state.PEOPLE, a).n.localeCompare(P(state.PEOPLE, b).n));

  const ACTM = state.ui.ACTM ?? new Date(state.NOW.getFullYear(), state.NOW.getMonth(), 1);
  const ACTDAY = state.ui.ACTDAY ?? null;
  const ACTWHO = state.ui.ACTWHO ?? null;
  const who = ACTWHO && actors.includes(ACTWHO) ? ACTWHO : null;
  const ACTKIND = state.ui.ACTKIND ?? null;
  const ACTVIEW: ActView = state.ui.ACTVIEW ?? "log";
  const ACTLIMIT = state.ui.ACTLIMIT ?? 40;
  const mkey = monthKey(ACTM);
  const days = daysInMonth(ACTM);

  const allTime = base
    .filter((e) => (!who || e.who === who) && (!ACTKIND || e.kind === ACTKIND))
    .sort((a, b) => (b.d + "T" + b.at.slice(-5)).localeCompare(a.d + "T" + a.at.slice(-5)));
  const rows = allTime.filter((e) => (ACTDAY ? e.d === ACTDAY : e.d.startsWith(mkey)));

  const cuts = [ACTDAY, ACTWHO, ACTKIND].filter(Boolean).length;
  const scopeLabel = (allHistory = false): string =>
    `${who ? P(state.PEOPLE, who).n : solo ? P(state.PEOPLE, state.WHO).n : "Your team"} · `
    + `${allHistory ? "All history" : ACTDAY || mkey}${ACTKIND ? " · " + KINDS[ACTKIND as keyof typeof KINDS] : " · All actions"}`;

  const exportName = (allHistory: boolean, view: ActView) =>
    `growize-activity-${allHistory ? "all-history" : ACTDAY || mkey}-${view}`
    + `${who ? "-" + who : ""}${ACTKIND ? "-" + ACTKIND : ""}.csv`;

  return {
    solo, actors, ACTM, ACTDAY, ACTWHO, ACTKIND, ACTVIEW, ACTLIMIT, who, mkey, days, allTime, rows,
    cuts, scopeLabel, exportName,
  };
}
