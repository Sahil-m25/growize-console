/* ── features/goals/logic.ts — the priced dial write, shared by the page and its panels ─────────
   Ports `ref/03-app.js` (redesigned) `bump()`, 11258–11267, and the two lookup tables it reads,
   `PLANAT` (line ~11244) and `PLANNAME` (line ~11245 — kept in its prototype-given SCREAMING_CASE,
   as the port guide requires of a ported constant).

   `bump` used to live only in PlanPage; the redesign's "Planning assumptions & reference" section
   opens the funnel and mix dials from their own drawers (`./drawers.tsx`), so both need the same
   priced confirm rather than two copies of it. */

import { GRAINS, PLANAT } from "@/domain";
import type { Grain, Plan, PlanScalar } from "@/domain";
import { may, perEventNeed, planTotals } from "@/lib/selectors";
import type { ConsoleState } from "@/lib/store";
import { useConsole } from "@/lib/store";
import type { GoalsAsk } from "./state";

/* the dial's name and unit, so the confirm names the thing being changed rather than its key. */
export const PLANNAME: Partial<Record<PlanScalar, [string, string]>> = {
  lead2qual: ["Lead → Qualified", "%"], qual2res: ["Qualified → Reserved", "%"],
  res2paid: ["Reserved → Fully paid", "%"], eventDays: ["Field-event days", ""],
  eventShare: ["Share carried by events", "%"],
};

export type GoalsAskText = { title: string; what: string; not: string; btn: string };

/* askFirst({t,what,not,btn,run:…}) — 03-app.js(redesigned):11348 (`setGrain`), 11402 (`dropPeriod`)
   and 11258–11279 (`bump`), one function apiece. Priced fresh off *current* state, exactly as each
   prototype caller prices before it asks — never a snapshot frozen at the click that opened the
   drawer. Returns null when there is nothing left to ask (the write would be a no-op), the same
   guard each prototype function has before it ever calls `askFirst`. */
export function grainAskText(g: Grain): GoalsAskText {
  const v = GRAINS[g];
  return {
    title: `Rebuild the plan in ${v.t.toLowerCase()} periods`,
    what: "The total target is kept and split evenly across the new windows. Verified actuals and "
      + "collections move to the window that contains them.",
    not: "It does not change the target, and it loses nothing that was recorded — but the "
      + "row-by-row targets somebody set by hand are replaced by the even split.",
    btn: `${v.t} periods`,
  };
}

export function dropAskText(state: ConsoleState, pk: string): GoalsAskText | null {
  const p = state.PLAN.periods.find((x) => x.k === pk);
  if (!p) return null;
  return {
    title: `Remove ${p.t} from the plan`,
    what: "Its target comes out of the plan, and so does the actual recorded against it — the "
      + "totals above re-add without it.",
    not: "It does not touch a single lead or receipt. Nothing that was paid stops having been "
      + "paid; it is only this window's share of the target that goes.",
    btn: `Remove ${p.t}`,
  };
}

export function bumpAskText(state: ConsoleState, k: PlanScalar, d: number, lo: number, hi: number): GoalsAskText | null {
  const path = PLANAT[k];
  const g = state.PLAN;
  if (!path) return null;
  const [grp, key] = path;
  const src = (grp ? (g[grp] as unknown as Record<string, number>) : (g as unknown as Record<string, number>));
  const was = src[key];
  const now = Math.max(lo, Math.min(hi, was + d));
  if (now === was) return null;
  const cloned: Plan = grp
    ? { ...g, [grp]: { ...src, [key]: now } } as unknown as Plan
    : { ...g, [key]: now } as unknown as Plan;
  const snap = (plan: Plan): [string, number][] => {
    const t = planTotals(plan);
    return [["Captured", t.cap], ["Qualified", t.qual], ["Reserved", t.res], ["Leads an event", perEventNeed(plan)]];
  };
  const before = snap(g), after = snap(cloned);
  const moved = before.map(([t, x], i) => [t, x, after[i][1]] as const).filter(([, x, y]) => x !== y);
  const [nm, u] = PLANNAME[k] ?? [k, ""];
  const T = planTotals(g);
  const what = moved.length
    ? "Every requirement in the plan is derived from this, so one press moves all of them — "
      + moved.map(([t, x, y]) => `${t} ${x.toLocaleString("en-IN")} → ${y.toLocaleString("en-IN")}`).join(", ")
      + `. The target of ${T.target} units does not change.`
    : "No derived figure moves — this dial is not feeding anything at its current setting.";
  const not = "It changes no lead and no receipt. It is logged, and there is no take-back: setting it back to "
    + `${was}${u} is the way back, and that is another line in the log.`;
  return { title: `${nm}: ${was}${u} → ${now}${u}`, what, not, btn: `Set it to ${now}${u}` };
}

/* goalsAskText(state,ask) — the one place `p:goals.ask` (./drawers.tsx) turns a pending write into
   its title/body/foot text, whichever of the three kinds it is. */
export function goalsAskText(state: ConsoleState, ask: GoalsAsk | null | undefined): GoalsAskText | null {
  if (!ask) return null;
  if (ask.kind === "grain") return grainAskText(ask.g);
  if (ask.kind === "drop") return dropAskText(state, ask.pk);
  return bumpAskText(state, ask.k, ask.d, ask.lo, ask.hi);
}

export function usePlanBump(): (k: PlanScalar, d: number, lo: number, hi: number) => void {
  const { state, dispatch } = useConsole();
  return (k, d, lo, hi) => {
    if (!may(state, "goals", "edit") || !bumpAskText(state, k, d, lo, hi)) return;
    dispatch({
      type: "openDrawer", k: "p:goals.ask", id: null,
      seed: { GOALSASK: { kind: "bump", k, d, lo, hi } },
    });
  };
}

/* period-date inline validation — 03-app.js(redesigned):11332–11336's `PLAN_DATE_ERRORS` and
   `resetPlanDate`, held in `ui.PLANDATEERR` for the reason `./state.ts` gives.

   `planDateError` validates a period-date edit before it is dispatched, the way the prototype's
   `setPeriodDate` does before it ever writes — so a bad date is never sent to the store at all.
   Returns the message to show, or null when the value is fine and safe to dispatch. */
const dOf = (v: string): Date | null => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(v + "T00:00:00") : null);

export function planDateError(from: string, to: string): string | null {
  const a = dOf(from), b = dOf(to);
  if (!a || !b) return "Choose a real calendar date. The saved window is unchanged.";
  if (a > b) return "The end date must be on or after the start. The saved window is unchanged.";
  return null;
}
