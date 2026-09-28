/**
 * People, seats and cover. Ports `ref/03-app.js` lines 4-64, 309-311, 816-822, 1316-1321.
 */

import type { BadgeStyle, ColourSlot, Duration, OutWhy, Person, PersonKey, Reason, SeatKey } from "./types";

/** A new member takes the least-used colour-and-shape pair, so nobody has to choose one. */
export function freeStyle(PEOPLE: Record<PersonKey, Person>): BadgeStyle {
  const used: Record<string, number> = {};
  Object.values(PEOPLE).forEach(p => { const k = (p.c || 0) + "|" + (p.sq ? 1 : 0); used[k] = (used[k] || 0) + 1; });
  let best = { c: 1 as ColourSlot, sq: false, n: 1e9 };
  for (const sq of [0, 1]) for (let c = 1; c <= 8; c++) {
    const n = used[c + "|" + sq] || 0;
    if (n < best.n) best = { c: c as ColourSlot, sq: !!sq, n };
  }
  return { c: best.c, sq: best.sq };
}

/**
 * One IR seat. Junior, IR and Senior used to be three seats with the same grid, which made two
 * thirds of the distinction a word on an offer letter. Now everybody who carries a book starts
 * identical and a manager tunes the individual — which is what seniority was meant to mean.
 */
export const SEAT: Partial<Record<SeatKey, string>> = {
  ir  :"IR Associate",
  cp  :"Channel Partner",
  conv:"IR Manager",
  exec:"Operations Lead — ARL",
  fin :"Finance, Legal & Compliance",
  am  :"Account Management",
  ops :"Digital Infrastructure & Data",
  bu  :"Growize BU Owner",
  corp:"Head, Corporate Operations"};


export const IR = ["ir"] as const satisfies readonly SeatKey[];

/** Who may see the numbers. */
export const MGMT = ["conv","exec","ops","fin","bu","corp","mkt"] as const satisfies readonly SeatKey[];

/** Reach everything: Digital, the BU Owner and Corporate Ops. */
export const ALL = ["ops","bu","corp"] as const satisfies readonly SeatKey[];

/** A team is named for what its manager does, not for who they are, so it survives the person. */
export const TEAMNAME: Record<SeatKey, string> = {conv:"Investor Relations", bu:"Growize BU", corp:"Corporate Operations",
  exec:"ARL Operations", ops:"Digital Infrastructure", fin:"Finance & Compliance",
  mkt:"Marketing", ir:"Investor Relations", cp:"Channel partners",
  /* the merged prototype names no Account Management team; its teamName() falls back to "Team" */
  am:"Team"};

/** The closed list §2 promises — nothing outside it is a reassignment. */
export const REASONS = ["Left the company","Long-term absence","Escalated by the lead",
                 "Territory correction","Load rebalancing","Duplicate merge"] as const satisfies readonly Reason[];

/** How long the cover runs — every handover answers this before it starts. */
export const DUR: Record<string, Duration> = {today:{t:"today only",days:1}, d3:{t:"3 days",days:3}, w1:{t:"1 week",days:7},
             w2:{t:"2 weeks",days:14}, back:{t:"until they are back",days:null}};

/** Why somebody is not at their desk. */
export const OUTWHY = ["On leave","Sick","Travelling","In training","Left the company"] as const satisfies readonly OutWhy[];

