/**
 * THE PLAN. Manual §1.2/§1.3 and the FY control page.
 * Ports `ref/03-app.js` lines 376-448, 608 and 5906-5908.
 */

import type { BaseWhy, Goals, Grain, GrainDef, Plan, PlanPath, PlanScalar, Source, SourceNeed } from "./types";

/**
 * Every derived plan figure comes from here, so Goals is the only place any of them change.
 *
 * Periods are editable; the master target, the planning baseline and the Finance-verified actual
 * are three separate things and the manual is explicit that they must never be merged.
 */
export const PLAN: Plan = {
  masterUnits: 208, acres: 8, byWhen: "31 March 2027",
  baseline: {units: 15, src: "Addendum B planning baseline", warn: true},
  /* a period is a DURATION, not a label — from/to are what every figure below is scoped by.
     target = units the BU Owner commits to. actual = fully-paid units Finance has verified.
     coll = ₹ Finance has actually banked in the window, which is never target × ₹25L, because a
     reservation banks 10% in one period and the balance in another. */
  grain: "month",
  periods: [
    /* actual and coll are what Finance has VERIFIED inside the window. Today is 28 August, so the
       first window has not opened: both are zero, and saying otherwise would be the one kind of lie
       this console exists to prevent. */
    {k:"sep", t:"September", from:"2026-09-01", to:"2026-09-30", target:50, actual:0, coll:0,
     emph:"Front-load demand; event and digital engine live"},
    {k:"oct", t:"October",   from:"2026-10-01", to:"2026-10-31", target:50, actual:0, coll:0,
     emph:"Maintain lead volume; improve qualification"},
    {k:"nov", t:"November",  from:"2026-11-01", to:"2026-11-30", target:50, actual:0, coll:0,
     emph:"Convert Sep–Oct pipeline; protect the payment cycle"},
    {k:"dec", t:"December",  from:"2026-12-01", to:"2026-12-31", target:43, actual:0, coll:0,
     emph:"Close the remaining FY target"}
  ],
  rates: {lead2qual:40, qual2res:18, res2paid:85},
  eventDays: 22, eventLen: 2, eventShare: 30,
  sla: {firstTouch:"same day", day3:100, packWeeks:4}
};

/** ₹25L per unit — fixed, never typed. */
export const UNIT = 2500000;

export const UNITS = [1,2,3,4,5,6,7,8,9,10] as const;

/**
 * Where a lead came from is the one field the whole funnel is sliced by, so it is a closed list
 * chosen at capture and never free text. "Founder network" carries a second question — which of
 * them — because that is the only reason the bucket exists.
 */
export const SOURCES = ["Events","Founder network","Referral — investor","Channel partner",
                 "Website","LinkedIn","Walk-in or call-in","Other"] as const satisfies readonly Source[];

export const SRCNEEDS: Partial<Record<Source, SourceNeed>> = {"Events":"event", "Founder network":"person", "Referral — investor":"person",
                  "Channel partner":"person"};

/**
 * Everything else in the product reads the plan through this, so there is one source.
 *
 * The prototype's `GOALS` is an object of getters over the live `PLAN`; ported as a function so it
 * reads whichever plan it is handed — `GOALS()` for the module fixture, `GOALS(state.PLAN)` for the
 * store's copy.
 */
export function GOALS(plan: Plan = PLAN): Goals {
  return {
    units: plan.periods.reduce((a, p) => a + p.target, 0),
    months: plan.periods.length,
    perUnit: UNIT,
    lead2qual: plan.rates.lead2qual,
    qual2res: plan.rates.qual2res,
    res2paid: plan.rates.res2paid,
    eventShare: plan.eventShare,
    eventDays: plan.eventDays,
    firstTouch: plan.sla.firstTouch,
    day3: plan.sla.day3,
    packWeeks: plan.sla.packWeeks,
  };
}

/** The end of the financial year the plan is written against. A reservation only counts toward the
 *  FY forecast when full payment is expected on or before this day. */
export const FYEND = new Date(2027, 2, 31);

/** The plan's scalars — rates, event days, service levels. Periods have their own two functions. */
export const PLANAT: Record<PlanScalar, PlanPath> = {lead2qual:["rates","lead2qual"], qual2res:["rates","qual2res"], res2paid:["rates","res2paid"],
  eventDays:[null,"eventDays"], eventShare:[null,"eventShare"], day3:["sla","day3"], packWeeks:["sla","packWeeks"]};

/* ---- Granularity. The plan is kept at whatever duration the BU actually runs on. Rebuilding
   keeps the total target and carries verified actuals into whichever new window contains them. ---- */
export const GRAINS: Record<Grain, GrainDef> = {week:{t:"Weekly",days:7}, fort:{t:"Fortnightly",days:14},
                month:{t:"Monthly",m:1}, quarter:{t:"Quarterly",m:3}};
export const MONFULL = ["January","February","March","April","May","June","July","August",
                 "September","October","November","December"] as const;

/* "Re-baseline only with recorded reason/approval" — manual Table 26. So it asks, from a closed
   list, exactly the way a reassignment does. */
export const BASEWHY = ["Finance verified the live figure","Units returned to the shelf",
                 "Correction of a data error","Approved re-baseline at the monthly review"] as const satisfies readonly BaseWhy[];
