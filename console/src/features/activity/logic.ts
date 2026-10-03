/* ── features/activity/logic.ts — the one filtered record set, shared by the page and its drawer ──
   Ports the pure head of `ref/03-app.js` (redesigned) `actSets()` (11570), `actPeople()` (11531),
   `actScopeLabel()` (11579) and the filename half of `actCSV()` (11605–11624).

   M15-S03-W2: the rows are the route's (GET /api/activity?side=lead, month-scoped — the actor and record gate is
   the route's own: self / team / all, and only leads the reader can open). The toolbar's month, day, person and
   action are the route's filters, so the page, By person, By day and both exports still read ONE answer.
   The route is month-scoped, so "all history" is the chosen month with the day cleared (PROVISIONAL, see report). */

import type { PersonKey } from "@/domain";
import { P, may } from "@/lib/selectors";
import type { ConsoleState } from "@/lib/store";
import { useApiRead, type Read } from "@/lib/data/api";
import { leadActivityRead, type LeadActivityArgs, type LeadActivityView } from "@/lib/data/endpoints/activity";
import type { ActView } from "./csv";

export const monthKey = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
export const daysInMonth = (d: Date): number => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();

/** The toolbar's choices, off the ui — what the page asks the route (no rows here). */
export type ActivityUi = {
  ACTM: Date;
  ACTDAY: string | null;
  /** the raw, unvalidated ui value — what the Person select's `value` binds to */
  ACTWHO: PersonKey | null;
  ACTKIND: string | null;
  ACTVIEW: ActView;
  ACTLIMIT: number;
  mkey: string;
  days: number;
  cuts: number;
  args: LeadActivityArgs;
};

export function activityUi(state: ConsoleState): ActivityUi {
  const ACTM = state.ui.ACTM ?? new Date(state.NOW.getFullYear(), state.NOW.getMonth(), 1);
  const ACTDAY = state.ui.ACTDAY ?? null;
  const ACTWHO = state.ui.ACTWHO ?? null;
  const ACTKIND = state.ui.ACTKIND ?? null;
  const mkey = monthKey(ACTM);
  return {
    ACTM, ACTDAY, ACTWHO, ACTKIND, ACTVIEW: state.ui.ACTVIEW ?? "log", ACTLIMIT: state.ui.ACTLIMIT ?? 40,
    mkey, days: daysInMonth(ACTM), cuts: [ACTDAY, ACTWHO, ACTKIND].filter(Boolean).length,
    args: { month: mkey, day: ACTDAY, person: ACTWHO, kind: ACTKIND },
  };
}

/** What the page and the drawer read: `view` = the toolbar's cut; `all` = the same month with the day cleared. */
export type ActivityReads = { view: Read<LeadActivityView>; all: Read<LeadActivityView> };
export function useLeadActivity(state: ConsoleState, ui: ActivityUi): ActivityReads {
  const view = useApiRead(leadActivityRead, state, ui.args);
  /* with no day picked the two are the same read — never fetch it twice */
  const wide = useApiRead(leadActivityRead, state, ui.ACTDAY ? { ...ui.args, day: null } : null);
  return { view, all: ui.ACTDAY ? wide : view };
}

/** "Rohit Deshpande · 2026-08 · Calls" — what the toolbar is cut to. */
export function scopeLabel(state: ConsoleState, ui: ActivityUi, d: Pick<LeadActivityView, "solo" | "person" | "kinds"> | null, allHistory = false): string {
  const who = d ? d.person : ui.ACTWHO, solo = d ? d.solo : !may(state, "activity", "others");
  return `${who ? P(state.PEOPLE, who as PersonKey).n : solo ? P(state.PEOPLE, state.WHO).n : "Your team"} · `
    + `${allHistory ? ui.mkey + " (whole month)" : ui.ACTDAY || ui.mkey}${ui.ACTKIND && d ? " · " + (d.kinds[ui.ACTKIND] ?? ui.ACTKIND) : " · All actions"}`;
}

export const exportName = (ui: ActivityUi, d: Pick<LeadActivityView, "person"> | null, allHistory: boolean, view: ActView): string =>
  `growize-activity-${allHistory ? ui.mkey + "-whole-month" : ui.ACTDAY || ui.mkey}-${view}`
  + `${d?.person ? "-" + d.person : ""}${ui.ACTKIND ? "-" + ui.ACTKIND : ""}.csv`;
