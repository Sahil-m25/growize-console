/* ── selectors/plan.ts — the plan, the funnel behind it, and the shelf ──────────────────────
   Ports `ref/03-app.js` lines 378–424 (the funnel requirement and the totals), 668–678
   (inventory), 5956–5959 (the period label), 6034–6040 (the RAG).

   ---- THE PLAN. Manual §1.2/§1.3 and the FY control page. The master target, the planning
   baseline and the Finance-verified actual are three separate things and the manual is explicit
   that they must never be merged. ----

   The prototype's `GOALS` is not a constant, it is a live VIEW over `PLAN` —
   `get units(){ return planTotals().target; }` and eight more getters — so nothing here reads a
   frozen copy of it. @/domain ports it as `GOALS(plan)`, a function of whichever plan it is handed;
   every function below takes `PLAN` for the same reason.
   ────────────────────────────────────────────────────────────────────────────────────────── */

import { ST, UNIT } from "@/domain";
import type { Plan, PlanPeriod } from "@/domain";
import type { Ctx } from "./ctx";

/* the period label is a date printer, so it lives with the others; re-exported here because the
   plan is its only caller and `@/lib/selectors` should be one import for a page */
export { pLabel } from "@/lib/format";

export type Need = { res: number; qual: number; cap: number };

/* the funnel requirement is computed per period and summed — that is how the manual reaches
   ~228 reserved, ~1,268 qualified and ~3,170 captured rather than the smaller annual figures */
export const needFor = (PLAN: Plan, p: PlanPeriod): Need => {
  const r = PLAN.rates, res = Math.ceil(p.target / Math.max(1, r.res2paid) * 100);
  const qual = Math.ceil(res / Math.max(1, r.qual2res) * 100);
  const cap = Math.ceil(qual / Math.max(1, r.lead2qual) * 100);
  return { res, qual, cap };
};

export type PlanTotals = {
  target: number; actual: number; coll: number; res: number; qual: number; cap: number;
};

export const planTotals = (PLAN: Plan): PlanTotals =>
  PLAN.periods.reduce((a, p) => {
    const n = needFor(PLAN, p);
    return {
      target: a.target + p.target, actual: a.actual + p.actual, coll: a.coll + (p.coll || 0),
      res: a.res + n.res, qual: a.qual + n.qual, cap: a.cap + n.cap,
    };
  }, { target: 0, actual: 0, coll: 0, res: 0, qual: 0, cap: 0 });

/* the same period arithmetic, but for money: what the plan expects to bank in a window */
export const planMoney = (p: PlanPeriod): number => p.target * UNIT;

/* ---- DEMAND ---------------------------------------------------------------------------------
   leads per EVENT, not per event-day — the figure it is compared against is a whole event's take.
   Every divisor is floored at one, because a plan with a zero in it should read as a plan with a
   zero in it and not as Infinity. */
export const eventCount = (PLAN: Plan): number =>
  Math.max(1, Math.round(PLAN.eventDays / Math.max(1, PLAN.eventLen)));

export const perEventNeed = (PLAN: Plan): number => {
  const r = PLAN.rates, units = planTotals(PLAN).target;
  const mult = 1 / (Math.max(1, r.lead2qual) / 100 * Math.max(1, r.qual2res) / 100
    * Math.max(1, r.res2paid) / 100);
  return Math.max(1, Math.round(units * (PLAN.eventShare / 100) * mult / eventCount(PLAN)));
};

/* ---- SELLABLE INVENTORY ---------------------------------------------------------------------
   The manual's hardest control: "No unit can be reserved or allocated twice", and "the commercial
   team must not sell inventory that cannot be delivered". Released is what the farm interface has
   confirmed as deliverable; everything else is computed. */

/* a transferred lead keeps its row in LEADS, so the XFER snapshot only counts when there is no
   live lead behind it — otherwise every transfer burned its units twice */
export const invAlloc = (ctx: Ctx): number =>
  ctx.LEADS.filter(l => l.done >= ST.ALLOCATED).reduce((a, l) => a + l.units, 0)
  + (ctx.XFER || []).filter(x => x.state === "done" && !ctx.LEADS.some(l => l.id === x.lead))
    .reduce((a, x) => a + (x.units || 0), 0);

export const invRes = (ctx: Ctx): number =>
  ctx.LEADS.filter(l => l.done >= ST.RESERVED && l.done < ST.ALLOCATED)
    .reduce((a, l) => a + l.units, 0);

export const invFree = (ctx: Ctx): number => ctx.INV.released - invRes(ctx) - invAlloc(ctx);

/* ---- THE TRAJECTORY -------------------------------------------------------------------------
   manual §8: Green on or above trajectory, Amber 90–99%, Red below 90% — and red outright when
   there is not enough sellable inventory behind the plan, which is the same table's other clause */
export type PlanRag = "green" | "amber" | "red";

export function planRag(actual: number, target: number): PlanRag {
  if (!target) return "green";
  const pc = actual / target * 100;
  return pc >= 100 ? "green" : pc >= 90 ? "amber" : "red";
}

export const supplyShort = (ctx: Ctx): boolean => {
  const T = planTotals(ctx.PLAN);
  return T.target - T.actual > ctx.INV.released - invAlloc(ctx);
};

export const planRagAll = (ctx: Ctx, actual: number, target: number): PlanRag =>
  supplyShort(ctx) ? "red" : planRag(actual, target);
