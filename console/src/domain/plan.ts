/**
 * THE PLAN. Manual §1.2/§1.3 and the FY control page.
 * Ports `ref/03-app.js` lines 376-448, 608 and 5906-5908.
 */

import type { BaseWhy, Goals, Grain, GrainDef, Plan, PlanPath, PlanScalar, Source, SourceNeed } from "./types";


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
 * reads whichever plan it is handed — always the store's own `GOALS(state.PLAN)`.
 */
export function GOALS(plan: Plan): Goals {
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
