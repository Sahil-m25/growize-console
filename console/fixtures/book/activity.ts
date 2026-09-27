/** The demo audit trail — six weeks of seeded work plus the hand-written head. Ports `ref/03-app.js`
 *  lines 1157-1221. Fixture mode only. */

import type { ActKind, IsoDate, LeadId, LogEntry, PersonKey, Stamp } from "../../src/domain/types";
import { VERB } from "../../src/domain/activity";
import { ST } from "../../src/domain/ladder";
import { COVER } from "./people";
import { LEADS } from "./leads";
import { TODAY } from "./clock";

/* The two date printers the seeder needs, kept private here so the seed is reproducible without
   reaching into anybody else's module. `MON` is the prototype's month table (03-app.js:1151). */
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const iso = (d: Date): IsoDate =>
  d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const disp = (d: Date, h: number, m: number): Stamp =>
  String(d.getDate()).padStart(2, "0") + " " + MON[d.getMonth()] + " " +
  String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");

/** `acting()` (03-app.js:945) — who is actually carrying a lead today. */
const acting = (l: { own: PersonKey | null; cov?: { by: PersonKey } | null }): PersonKey | null =>
  l.cov ? l.cov.by : (l.own && COVER[l.own] ? COVER[l.own].by : l.own);

interface SeedTeam {
  load: number;
  mix: ActKind[];
  /** Memoised on first use, exactly as the prototype memoises it onto the team object. */
  pool?: LeadId[];
}

/** Deterministic six weeks of real-looking work, so the calendar has something to show. */
export function seedLog(): LogEntry[] {
  let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const out: LogEntry[] = [], touches: Record<string, number> = {};
  /* weight and bias per person, so the table shows difference rather than noise */
  const team: Record<PersonKey, SeedTeam> = {
    kavya  :{load:1.15, mix:["msg","msg","call","call","email","stage","stage","mat","pack"]},
    rohit  :{load:0.95, mix:["msg","call","call","email","stage","mat","pack"]},
    ananya :{load:1.30, mix:["msg","msg","msg","call","call","call","email","mat"]},   /* busy, few stages */
    nikhil :{load:0.70, mix:["msg","call","email","mat","mat","pack","pack"]},
    tasneem:{load:0.45, mix:["call","email","stage","stage"]}
  };
  const ids = LEADS.map(l => l.id);
  for (let back = 40; back >= 0; back--) {
    const d = new Date(TODAY); d.setDate(d.getDate() - back);
    const dow = d.getDay();                                  /* 0 Sun */
    for (const who of Object.keys(team)) {
      if (dow === 0 && rnd() > 0.35) continue;                /* Sundays are webinar day, light */
      const day = dow === 6 ? 0.6 : dow === 0 ? 0.3 : 1;
      const n = Math.round((1 + rnd() * 4) * day * team[who].load);
      /* an IR works their own book and whatever they are covering; the manager works anybody's */
      const pool = team[who].pool || (team[who].pool = LEADS
        .filter(l => l.own && l.done < ST.PAID && (who === "tasneem" || l.own === who || acting(l) === who)).map(l => l.id));
      for (let i = 0; i < n; i++) {
        const mix = team[who].mix, k = mix[Math.floor(rnd() * mix.length)];
        const lead = pool.length ? pool[Math.floor(rnd() * pool.length)] : ids[Math.floor(rnd() * ids.length)];
        let touch: number | null = null;
        /* the ordinal is "attempt N on this lead this week" — the week is the unit the manual reviews in */
        if (["msg", "call", "email"].includes(k)) {
          const wk = lead + "|" + iso(new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)));
          touches[wk] = (touches[wk] || 0) + 1; touch = touches[wk];
        }
        out.push({d:iso(d), at:disp(d, 9 + Math.floor(rnd() * 9), Math.floor(rnd() * 60)),
                  who, kind:k, what:VERB[k], lead, note:"", touch});
      }
    }
    if (rnd() > 0.6) out.push({d:iso(d), at:disp(d,11,Math.floor(rnd()*60)), who:"harsha", kind:"doc",
      what:VERB.doc, lead:ids[Math.floor(rnd()*ids.length)], note:"Agreement"});
    if (rnd() > 0.85) out.push({d:iso(d), at:disp(d,15,Math.floor(rnd()*60)), who:"harsha", kind:"money",
      what:VERB.money, lead:ids[Math.floor(rnd()*ids.length)], note:"10% advance"});
    if (rnd() > 0.9) out.push({d:iso(d), at:disp(d,10,Math.floor(rnd()*60)), who:"jhalak", kind:"admin",
      what:"Set coverage", lead:null, note:""});
  }
  return out;
}

/** The hand-written head of the trail. `d` and `kind` are filled in below, as the prototype does. */
type LogSeedRow = Omit<LogEntry, "d" | "kind"> & { d?: IsoDate; kind?: ActKind };

const LOG_SEED: LogSeedRow[] = [
 {at:"27 Aug 11:40", who:"jhalak", what:"Added lead", lead:"U2", note:"Left unassigned"},
 {at:"27 Aug 09:40", who:"harsha",  what:"Requested transfer", lead:"L13", note:"Full payment confirmed"},
 {at:"27 Aug 09:15", who:"tasneem",what:"Added lead", lead:"U1", note:"Left unassigned"},
 {at:"26 Aug 16:20", who:"harsha",  what:"Sent document", lead:"L7", note:"FEMA declaration"},
 {at:"26 Aug 10:40", who:"rohit",  what:"Marked done", lead:"L4", note:"Called — connected"},
 {at:"25 Aug 09:02", who:"harsha",  what:"Sent document", lead:"L6", note:"Advance receipt"},
 {at:"24 Aug 11:06", who:"harsha",  what:"Recorded payment", lead:"L6", note:"10% advance"},
 {at:"23 Aug 12:00", who:"kavya",  what:"Marked done", lead:"L3", note:"Webinar attended"},
 {at:"22 Aug 10:00", who:"nikhil", what:"Marked done", lead:"L10", note:"Called — connected"},
 {at:"20 Aug 14:30", who:"harsha",  what:"Recorded payment", lead:"L13", note:"Full"},
 {at:"18 Aug 16:20", who:"kavya",  what:"Marked done", lead:"L5", note:"Next step agreed"},
 {at:"18 Aug 09:00", who:"jhalak", what:"Set coverage", lead:null, note:"Ananya out 25–29 Aug, Nikhil covering"}
];

/* The year on a hand-written row is implied, and its kind is read off the words it was written in. */
const seedDay = (at: Stamp): IsoDate => { const m = at.match(/^(\d{2}) (\w{3})/);
  return m ? "2026-" + String(MON.indexOf(m[2]) + 1).padStart(2, "0") + "-" + m[1] : "";
};
const seedKind = (what: string): ActKind =>
  /payment/i.test(what) ? "money" : /document/i.test(what) ? "doc"
  : /Marked done|Un-ticked$/i.test(what) ? "stage" : /material/i.test(what) ? "mat"
  : /pack/i.test(what) ? "pack" : "admin";

export const LOG: LogEntry[] = LOG_SEED.map(e => ({
  ...e,
  d: e.d || seedDay(e.at),
  kind: e.kind || seedKind(e.what),
}));
LOG.push(...seedLog());
LOG.sort((a, b) => a.d === b.d ? b.at.localeCompare(a.at) : b.d.localeCompare(a.d));
