/**
 * The nav, and the two grids that decide what a seat reaches and what it may do there.
 * Ports `ref/03-app.js` lines 63-86 and 164-244.
 */

import type { Cap, ImNavKey, LeadNavKey, NavItem, NavKey, PageCaps, ScreenKey, SeatKey } from "./types";

/* ===== D60 — WHO USES THIS CONSOLE (owner's decision) =========================================
   Three seats sign in by default: the IR, the IR Manager and Digital Infrastructure — and Digital
   Infrastructure is the only seat that reaches everything. Everybody else (the Operations Lead,
   the BU Owner, Corporate Operations, channel partners) has no console at all until Digital
   Infrastructure grants them a page, and then reaches exactly what was granted. Finance and
   Marketing never sign in here: Finance works in the Investors pages. Their records
   stay — they are names on receipts, signatures and plans — they are just never a login.
   ============================================================================================= */
export const DEFSEATS = ["ir","conv","ops"] as const satisfies readonly SeatKey[];   /* console access by default */
export const NOSIGN   = ["fin","mkt","am"] as const satisfies readonly SeatKey[];    /* never sign in to this console */
const BYGRANT_ = ["exec","bu","corp","cp"] as const satisfies readonly SeatKey[];    /* = BYGRANT (./signin) */
const ALL_ = ["ops"] as const;                  /* reaches everything: Digital Infrastructure, alone */

/* `roles` is who holds the entry BY DEFAULT. Anybody else reaches an entry only when it has been
   granted to them by name (navFor asks the grant), and never more than the granter holds. */
export const NAV: readonly NavItem[] = [
  {k:"today",  t:"Today",     roles:["ir","conv",...ALL_], scoped:true},
  {k:"leads",  t:"Leads",     roles:["ir","conv",...ALL_], scoped:true},
  /* Updates is reachable and counted, but it is not a row in the sidebar: the bell in the top bar
     is its entry, and the page is what "See everything" opens. One destination, not two. */
  {k:"updates",t:"Updates",   roles:["ir","conv",...ALL_], bell:true},
  {k:"activity",t:"Activity", roles:["ir","conv",...ALL_]},
  {k:"people", t:"Teams",     roles:["conv",...ALL_]},
  {k:"goals",  t:"Plan",      roles:["conv",...ALL_]},
  {k:"events", t:"Events",    roles:["ir","conv",...ALL_]},
  {k:"pay",    t:"Payments",  roles:["ir","conv",...ALL_]},
  {k:"docs",   t:"Documents", roles:["ir","conv",...ALL_]},
  {k:"xfer",   t:"Transfers", roles:["conv",...ALL_]},
  {k:"numbers",t:"Numbers",   roles:["conv",...ALL_]},
  /* Digital Infrastructure runs the machine; anybody else reads it only by a grant. */
  {k:"system", t:"System",    roles:[...ALL_]},
  /* everybody who can sign in has one, and it is the only screen whose contents are the person
     reading it — so a granted seat gets it with its first page, never as a grant of its own */
  {k:"me",     t:"Profile",   roles:[...DEFSEATS,...BYGRANT_], menu:true}
];

/* D60: two lists per seat, never one. SEATSCREENS is the CEILING — every page the seat could ever
   be granted, and the set the manager chain is checked against. SEATDEF is what the seat holds BY
   DEFAULT, before anybody grants anything. The ceiling is Digital Infrastructure's own reach for
   every console seat (it may grant any page to anyone), except a channel partner, who only ever
   works leads; Finance and Marketing have no ceiling because they never sign in here.
   (ir-merged.js:319-352; the `me` push is baked into the literals.) */
export const FULLREACH: readonly ScreenKey[] = ["today","leads","updates","add","activity","teamscope","people","goals","events",
                   "pay","docs","xfer","numbers","system"];
const FULL_: ScreenKey[] = [...FULLREACH, "me"];
export const SEATSCREENS: Record<SeatKey, ScreenKey[]> = {
  ir  :FULL_.slice(),
  cp  :["today","leads","updates","add","activity","me"],
  conv:FULL_.slice(),
  exec:FULL_.slice(),
  ops :FULL_.slice(),
  corp:FULL_.slice(),
  bu  :FULL_.slice(),
  fin :["me"],
  am  :["me"],
  mkt :["me"]
};
/* the default reach, derived from NAV so the rail and the preset can never drift; `add` (capture)
   and `teamscope` are not rail entries, so they are named per seat */
const SEATEXTRA: Partial<Record<SeatKey, ScreenKey[]>> = {ir:["add"], conv:["add","teamscope"], ops:["add","teamscope"]};
export const SEATDEF: Record<SeatKey, ScreenKey[]> = Object.fromEntries(
  (Object.keys(SEATSCREENS) as SeatKey[]).map(st => [st,
    !(DEFSEATS as readonly string[]).includes(st) ? []
      : FULL_.filter(p => NAV.some(n => n.k === p && (n.roles as readonly string[]).includes(st))
                          || (SEATEXTRA[st] || []).includes(p))]),
) as Record<SeatKey, ScreenKey[]>;

/** What each screen can be allowed to do. A seat is a preset over this grid, not a separate concept. */
export const PAGECAPS: Record<LeadNavKey, PageCaps> & Partial<Record<ImNavKey, PageCaps>> = {
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
  xfer    :{t:"Transfers", caps:["view"]},
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
 * The seat preset: which capabilities a seat gets on each page it reaches BY DEFAULT. Only the three
 * console seats have one. The rest start empty and are granted page by page by Digital
 * Infrastructure; their Profile comes with the first grant, because it is them rather than a page.
 * ir-merged.js:398-431 — the import-time derivation (ops from the whole of PAGECAPS with pay/docs cut
 * to "view"; today/updates/activity for ir and conv; "view" on every default NAV page; caps the page
 * lacks dropped; ir/conv pay/docs read-only) is baked into the literal below.
 */
export const SEATCAPS: Record<SeatKey, Partial<Record<ScreenKey, Cap[]>>> = {
  ir  :{leads:["view","edit"], add:["view","capture"], events:["view","load"],
        today:["view"], updates:["view"], activity:["view"], pay:["view"], docs:["view"], me:["view"]},
  conv:{leads:["view","edit","assign"], add:["view","capture"], activity:["view","others"],
        people:["view","seats","roster"], goals:["view"], events:["view","edit","load"],
        numbers:["view"], xfer:["view"], today:["view"], updates:["view"], pay:["view"], docs:["view"], me:["view"]},
  ops :{today:["view"], leads:["view","edit","assign"], updates:["view"], add:["view","capture"],
        activity:["view","others"], people:["view","seats","roster"],
        goals:["view","edit","target"], events:["view","edit","load"],
        pay:["view"], docs:["view"], xfer:["view"], numbers:["view"],
        system:["view","edit"], me:["view"]},
  exec:{me:["view"]}, bu:{me:["view"]}, corp:{me:["view"]}, cp:{me:["view"]},
  /* Finance and Marketing never sign in here. Finance writes in the Investors pages and
     its confirmations arrive as gates on this ladder — see THE GATE, NOT A HANDOVER. */
  fin :{}, am :{}, mkt :{}
};
