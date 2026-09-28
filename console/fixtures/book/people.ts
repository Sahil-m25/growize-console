/** The demo staff (merged prototype, both sides), cover and absences. Ports `ref/03-app.js` lines 4-64.
 *  Fixture mode only. */

import type { Absence, Cover, Person, PersonKey } from "../../src/domain/types";

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
  /* the Investors side's staff — the merged prototype's PEOPLE carries them so a name never
     reaches a sentence as a raw key; the lead rules never admit them (`ext`). */
  meena  :{n:"Meena Raghavan",  i:"MR", seat:"fin",    mgr:"harsha",  on:true,  c:1, sq:true, em:"meena@agresearchlabs.com",  ph:"+91 99001 22410", ext:"the Investors pages"},
  fahad  :{n:"Fahad Rizvi",     i:"FR", seat:"fin",    mgr:"harsha",  on:true,  c:7, sq:true, em:"fahad@agresearchlabs.com",  ph:"+91 98802 47715", ext:"the Investors pages"},
  latha  :{n:"Latha Prabhu",    i:"LP", seat:"fin",    mgr:"harsha",  on:true,  c:3, em:"latha@agresearchlabs.com",  ph:"+91 97410 55082", ext:"the Investors pages"},
  divya  :{n:"Divya Kamath",    i:"DK", seat:"am",     mgr:"arvind",  on:true,  c:6, sq:true, em:"divya@agresearchlabs.com",  ph:"+91 99640 18327", ext:"the Investors pages"},
  imran  :{n:"Imran Sheikh",    i:"IS", seat:"am",     mgr:"divya",   on:true,  c:2, sq:true, em:"imran@agresearchlabs.com",  ph:"+91 98451 70036", ext:"the Investors pages"},
  neha   :{n:"Neha Bhandari",   i:"NB", seat:"am",     mgr:"divya",   on:true,  c:5, sq:true, em:"neha@agresearchlabs.com",   ph:"+91 99802 63391", ext:"the Investors pages"},
  sahil  :{n:"Sahil Mohite",    i:"SM", seat:"ops",    mgr:"pradeep", on:true,  c:3, sq:true, em:"sahil@agresearchlabs.com", ph:"+91 97318 44026"},
  arvind :{n:"Arvind Menon",    i:"AM", seat:"bu",     mgr:null,      on:true,  c:1, sq:true, em:"arvind@agresearchlabs.com", ph:"+91 98450 10002"},
  pradeep:{n:"Pradeep Ram",     i:"PR", seat:"corp",   mgr:null,      on:true,  c:8, sq:true, em:"pradeep@agresearchlabs.com", ph:"+91 98450 10001"},
  vinay  :{n:"Vinay Shenoy",    i:"VS", seat:"ir",   mgr:"tasneem", on:false, c:5, sq:true, em:"vinay@agresearchlabs.com", ph:""}   /* left the org */
};


export const COVER: Record<PersonKey, Cover> = {ananya:{by:"nikhil", to:"29 Aug", why:"Planned leave"}};

/**
 * Who may be offered on the sign-in screen: every person on the record, in the record's order
 * (merged prototype, `SIGNINS = Object.keys(PEOPLE)`). Whether they actually get in is the
 * admission rule's answer, never this list's.
 */
export const SIGNINS: PersonKey[] = Object.keys(PEOPLE);

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
