/**
 * People, seats and cover. Ports `ref/03-app.js` lines 4-64, 309-311, 816-822, 1316-1321.
 */

import type {
  Absence,
  BadgeStyle,
  ColourSlot,
  Cover,
  Duration,
  OutWhy,
  Person,
  PersonKey,
  Reason,
  SeatKey,
} from "./types";

/**
 * Roles and holders are the manual's Table 8. Role names are fixed; people may change.
 *
 * `c` is one of the eight validated categorical slots and `sq` is the second channel — a square
 * instead of a circle — so twelve people are told apart without spending a status colour on any of
 * them. The four who carry a book get four maximally separated hues, because those are the badges
 * read fastest and most often. `mgr` is who they are appointed under, which is the ceiling on
 * what they can reach.
 */
export const PEOPLE: Record<PersonKey, Person> = {
  rohit  :{n:"Rohit Deshpande", i:"RD", seat:"ir",     mgr:"tasneem", on:true,  c:1, em:"rohit@agresearchlabs.com",   ph:"+91 99450 21188"},
  kavya  :{n:"Kavya Nair",      i:"KN", seat:"ir",   mgr:"tasneem", on:true,  c:2, em:"kavya@agresearchlabs.com",   ph:"+91 98807 41290"},
  nikhil :{n:"Nikhil Rao",      i:"NR", seat:"ir",   mgr:"tasneem", on:true,  c:6, em:"nikhil@agresearchlabs.com",  ph:"+91 97400 33265"},
  ananya :{n:"Ananya Iyer",     i:"AI", seat:"ir",     mgr:"tasneem", on:true,  c:7, em:"ananya@agresearchlabs.com",  ph:"+91 99012 55471"},
  tasneem:{n:"Tasneem Qureshi", i:"TQ", seat:"conv",   mgr:"arvind",  on:true,  c:8, em:"tasneem@agresearchlabs.com", ph:"+91 98450 60093"},
  gokul  :{n:"Gokul S",         i:"GS", seat:"mkt",    mgr:"arvind",  on:false, c:5, em:"gokul@agresearchlabs.com",   ph:"+91 93430 71120"},
  jhalak :{n:"Jhalak Mehta",    i:"JM", seat:"exec",   mgr:"pradeep", on:true,  c:3, em:"jhalak@agresearchlabs.com",  ph:"+91 98860 24417"},
  /* Harsha has no account here. Finance works in the Investor Management portal, and everything
     they do arrives on these screens over the link — so they are a NAME in this console, on every
     receipt and every signature, and never a login. `ext` is what says so. */
  harsha :{n:"Harsha Bhat",     i:"HB", seat:"fin",    mgr:"arvind",  on:true,  c:4, em:"harsha@agresearchlabs.com",  ph:"+91 99860 71304", ext:"the Investor Management portal"},
  sahil  :{n:"Sahil Mohite",    i:"SM", seat:"ops",    mgr:"pradeep", on:true,  c:3, sq:true, em:"sahil@agresearchlabs.com", ph:"+91 97318 44026"},
  arvind :{n:"Arvind Menon",    i:"AM", seat:"bu",     mgr:null,      on:true,  c:1, sq:true, em:"arvind@agresearchlabs.com", ph:"+91 98450 10002"},
  pradeep:{n:"Pradeep Ram",     i:"PR", seat:"corp",   mgr:null,      on:true,  c:8, sq:true, em:"pradeep@agresearchlabs.com", ph:"+91 98450 10001"},
  vinay  :{n:"Vinay Shenoy",    i:"VS", seat:"ir",   mgr:"tasneem", on:false, c:5, sq:true, em:"vinay@agresearchlabs.com", ph:""}   /* left the org */
};

/** A new member takes the least-used colour-and-shape pair, so nobody has to choose one. */
export function freeStyle(): BadgeStyle {
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
  ops :"Digital Infrastructure & Data",
  bu  :"Growize BU Owner",
  corp:"Head, Corporate Operations"};

export const COVER: Record<PersonKey, Cover> = {ananya:{by:"nikhil", to:"29 Aug", why:"Planned leave"}};

/**
 * The demo signs in as a PERSON. Once three people share the IR seat, a seat switcher cannot tell
 * Rohit's book from Kavya's — and the difference between two people on one seat is exactly what
 * this model is for.
 *
 * Who can actually sign in here. Finance is deliberately absent: see `PEOPLE.harsha`.
 */
export const SIGNINS = ["rohit","kavya","nikhil","ananya","tasneem","gokul","jhalak","sahil",
                 "arvind","pradeep"] as const;

export const IR = ["ir"] as const satisfies readonly SeatKey[];

/** Who may see the numbers. */
export const MGMT = ["conv","exec","ops","fin","bu","corp","mkt"] as const satisfies readonly SeatKey[];

/** Reach everything: Digital, the BU Owner and Corporate Ops. */
export const ALL = ["ops","bu","corp"] as const satisfies readonly SeatKey[];

/** A team is named for what its manager does, not for who they are, so it survives the person. */
export const TEAMNAME: Record<SeatKey, string> = {conv:"Investor Relations", bu:"Growize BU", corp:"Corporate Operations",
  exec:"ARL Operations", ops:"Digital Infrastructure", fin:"Finance & Compliance",
  mkt:"Marketing", ir:"Investor Relations", cp:"Channel partners"};

/** The closed list §2 promises — nothing outside it is a reassignment. */
export const REASONS = ["Left the company","Long-term absence","Escalated by the lead",
                 "Territory correction","Load rebalancing","Duplicate merge"] as const satisfies readonly Reason[];

/** How long the cover runs — every handover answers this before it starts. */
export const DUR: Record<string, Duration> = {today:{t:"today only",days:1}, d3:{t:"3 days",days:3}, w1:{t:"1 week",days:7},
             w2:{t:"2 weeks",days:14}, back:{t:"until they are back",days:null}};

/** Why somebody is not at their desk. */
export const OUTWHY = ["On leave","Sick","Travelling","In training","Left the company"] as const satisfies readonly OutWhy[];

/**
 * Who is working today. One record per person; absent means available.
 *
 * An absence carries the day they are back, as a date rather than a phrase, for one reason: it is
 * what lets the note put itself away. "Back next week" has to be cleared by hand and never is;
 * "back on 29 Aug" stops being true on the 30th on its own, and the roster stops lying.
 *
 * Seeded to agree with {@link COVER} — Ananya is out, Nikhil covers.
 */
export const AVAIL: Record<PersonKey, Absence> = {
  ananya:{why:"On leave", from:"2026-08-25", to:"2026-08-29", by:"tasneem", at:"24 Aug 17:40"}
};
