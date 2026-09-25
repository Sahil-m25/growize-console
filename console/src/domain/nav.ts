/**
 * The nav, and the two grids that decide what a seat reaches and what it may do there.
 * Ports `ref/03-app.js` lines 63-86 and 164-244.
 */

import type { Cap, NavItem, NavKey, PageCaps, ScreenKey, SeatKey } from "./types";
import { ALL } from "./people";

export const NAV: readonly NavItem[] = [
  {k:"today",  t:"Today",    roles:["ir","conv","cp","exec","fin",...ALL], scoped:true},
  {k:"leads",  t:"Leads",     roles:["ir","conv","cp","exec","fin",...ALL], scoped:true},
  /* Updates is reachable and counted, but it is not a row in the sidebar: the bell in the top bar
     is its entry. */
  {k:"updates",t:"Updates",   roles:["ir","conv","cp","exec","fin",...ALL], bell:true},
  /* Capture came off the rail — it is a top-bar door and a door on every lead now, not a page
     whose only job was to hold the form. `add`'s capability stays on the grid (PAGECAPS.add,
     nopage:true); it is no longer a NAV row. */
  {k:"activity",t:"Activity",  roles:["ir","conv","cp","exec","fin",...ALL]},
  {k:"people", t:"Teams",      roles:["conv","exec",...ALL]},
  {k:"goals",  t:"Plan",      roles:["exec","conv","mkt","fin",...ALL]},
  {k:"events", t:"Events",    roles:["ir","conv","exec","mkt",...ALL]},
  {k:"pay",    t:"Payments",  roles:["ir","conv","exec","fin",...ALL]},
  {k:"docs",   t:"Documents", roles:["ir","conv","exec","fin",...ALL]},
  {k:"xfer",   t:"Investor copies", roles:["fin","exec",...ALL]},
  {k:"numbers",t:"Numbers",   roles:["conv","exec","fin","mkt",...ALL]},
  /* Digital Infrastructure runs the machine; Corporate Operations reads it. Both matter: Sahil is
     appointed under Pradeep, and a manager who cannot reach a page cannot be the ceiling for it. */
  {k:"system", t:"System",    roles:["ops","corp"]},
  /* everybody has one, and it is the only screen whose contents are the person reading it */
  {k:"me",     t:"Profile",   roles:["ir","cp","conv","exec","fin","ops","bu","corp"], menu:true}
];

/**
 * What each seat can reach — a grant may never exceed the granter's own set.
 *
 * The prototype pushes `"me"` onto every seat at import time (03-app.js:176-177), because "your own
 * profile is not something a manager grants or withholds — it is you". That push is baked into the
 * literal here rather than run as a side effect.
 */
export const SEATSCREENS: Record<SeatKey, ScreenKey[]> = {
  /* the merged seat carries the union of what the three used to have. Everybody starts here; a
     manager adds or removes per person from the grid on People. */
  ir  :["today","leads","updates","add","activity","events","pay","docs","me"],
  cp  :["today","leads","updates","add","activity","me"],
  fin :["today","leads","updates","activity","pay","docs","xfer","numbers","goals","me"],
  conv:["today","leads","updates","add","activity","teamscope","people","goals","events","numbers","pay","docs","me"],
  exec:["today","leads","updates","add","activity","teamscope","people","goals","events","xfer","numbers","pay","docs","me"],
  ops :["today","leads","updates","add","activity","teamscope","people","goals","events","pay","docs","xfer","numbers","system","me"],
  corp:["today","leads","updates","add","activity","teamscope","people","goals","events","pay","docs","xfer","numbers","system","me"],
  bu  :["today","leads","updates","add","activity","teamscope","people","goals","events","pay","docs","xfer","numbers","me"],
  mkt :["updates","add","events","goals","numbers","me"]
};

/** What each screen can be allowed to do. A seat is a preset over this grid, not a separate concept. */
export const PAGECAPS: Record<NavKey, PageCaps> = {
  today   :{t:"My day",   caps:["view"]},
  leads   :{t:"Leads",    caps:["view","edit","assign"]},
  updates :{t:"Updates",  caps:["view"]},
  /* Reading this form and writing a name onto the book are two different acts. `capture` is the
     right to put a name on the book, wherever the form was opened from, and there is no longer a
     page to hold it — `nopage` keeps it out of anywhere reach is counted or drawn as somewhere you
     can go (ir-console-redesigned.html:2721-2743). */
  add     :{t:"Adding leads", caps:["view","capture"], nopage:true},
  activity:{t:"Activity", caps:["view","others"]},
  people  :{t:"Teams",    caps:["view","seats","roster"]},
  goals   :{t:"Plan",     caps:["view","edit","target"]},
  events  :{t:"Events",   caps:["view","edit","load"]},
  pay     :{t:"Payments", caps:["view","record"]},
  docs    :{t:"Documents",caps:["view","send"]},
  /* `perform` was the administrator's approval of a transfer. Nothing performs a transfer any
     more — the confirmed receipt does it — so the toggle came off rather than being left as a
     switch that writes an audit line and changes nothing. */
  xfer    :{t:"Investor copies", caps:["view"]},
  numbers :{t:"Numbers",  caps:["view"]},
  system  :{t:"System",   caps:["view","edit"]},
  me      :{t:"Profile",  caps:["view"]}
};

/**
 * Only capabilities that a handler actually reads are on this list. A toggle that changes nothing
 * is worse than no toggle: it takes a manager's attention, writes a line into the audit log, and
 * leaves them believing they revoked something.
 */
export const CAPT: Record<Cap, string> = {view:"See it", edit:"Change things", assign:"Reassign an owner", target:"Set the target",
  others:"See other people's", seats:"Change seats", roster:"Mark availability",
  load:"Load the sheet", edit_ev:"Change events", record:"Record payment", send:"Send documents",
  capture:"Enter a new name",
  };

/**
 * The seat preset: which capabilities a seat gets on each page it reaches.
 *
 * The prototype declares five seats by hand and then derives the rest at import time
 * (03-app.js:206-244): `ops`, `corp` and `bu` are filled from {@link PAGECAPS}; every page a seat
 * reaches gets at least `view`, derived from {@link NAV} so the two can never drift; and any cap
 * the page does not have is dropped. The finished grid is baked in below, so nothing mutates at
 * import time — the derivation and the comments that explain it are kept as documentation.
 *
 * Derivation, verbatim from the prototype:
 * - `SEATCAPS.ops[p] = PAGECAPS[p].caps` for every page, then `ops.pay` and `ops.docs` are cut back
 *   to `["view"]`: Digital Infrastructure runs the machine and does not hold the money or the paper.
 *   The handlers have always said so; the grid used to disagree with them, which made the grid the
 *   thing that lied.
 * - `SEATCAPS.corp[p] = p==="goals" ? ["view","edit"] : ["view"]` — Corporate Operations reads the
 *   machine and sets no commercial terms (manual §7.2).
 * - `SEATCAPS.bu[p] = p==="goals" ? ["view","edit","target"] : ["view"]`, and never `system` — the
 *   BU Owner reads everything and owns the target, the extension and the refund.
 * - `today`, `updates` and `activity` are added to `ir`, `fin`, `conv` and `exec`: My day, Updates
 *   and Activity are everybody's — the seat decides scope, not admission.
 */
export const SEATCAPS: Record<SeatKey, Partial<Record<ScreenKey, Cap[]>>> = {
  cp  :{leads:["view","edit"], add:["view","capture"], today:["view"], updates:["view"], activity:["view"], me:["view"]},
  ir  :{leads:["view","edit"], add:["view","capture"], events:["view","load"],
        today:["view"], updates:["view"], activity:["view"], pay:["view"], docs:["view"], me:["view"]},
  /* Finance has no seat here at all. It writes in the Investor Management portal and its
   confirmations arrive as gates on this ladder — see THE GATE, NOT A HANDOVER. */
  fin :{leads:["view","edit"], pay:["view","record"], docs:["view","send"], xfer:["view"],
        numbers:["view"], goals:["view"],
        today:["view"], updates:["view"], activity:["view"], me:["view"]},
  conv:{leads:["view","edit","assign"], add:["view","capture"], activity:["view","others"],
        people:["view","seats","roster"], goals:["view"], events:["view","edit","load"], numbers:["view"],
        today:["view"], updates:["view"], pay:["view"], docs:["view"], me:["view"]},
  exec:{leads:["view","assign"], add:["view"], activity:["view","others"],
        people:["view","seats","roster"], goals:["view","edit"], events:["view","edit","load"],
        xfer:["view"], numbers:["view"], pay:[], docs:[],
        today:["view"], updates:["view"], me:["view"]},
  mkt :{updates:["view"], add:["view"], events:["view","edit","load"],
        goals:["view"], numbers:["view"]},
  ops :{today:["view"], leads:["view","edit","assign"], updates:["view"], add:["view","capture"],
        activity:["view","others"], people:["view","seats","roster"],
        goals:["view","edit","target"], events:["view","edit","load"],
        pay:["view"], docs:["view"], xfer:["view"], numbers:["view"],
        system:["view","edit"], me:["view"]},
  corp:{today:["view"], leads:["view"], updates:["view"], add:["view"], activity:["view"],
        people:["view"], goals:["view","edit"], events:["view"], pay:[], docs:[],
        xfer:["view"], numbers:["view"], system:["view"], me:["view"]},
  bu  :{today:["view"], leads:["view"], updates:["view"], add:["view"], activity:["view"],
        people:["view"], goals:["view","edit","target"], events:["view"], pay:[],
        docs:[], xfer:["view"], numbers:["view"], me:["view"]}
};
