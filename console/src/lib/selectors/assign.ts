/* ── Assignments by IR — the merged prototype's `arData()` and its helpers (ir-merged.js 11118–11235).
   Leads handed over in each period, and what has happened to them since. Pure: every global the
   prototype reached for is read off `ctx`. The table (`features/numbers/AssignReport.tsx`) and the
   tests read the same object. ───────────────────────────────────────────────────────────────── */

import { ST, TOUCHCHANNELS, TOUCHSLA } from "@/domain";
import type { Channel, Lead, LogEntry, PersonKey } from "@/domain";
import { dAdd, monday, nowT, sod, whenT } from "@/lib/format";
import type { Ctx } from "./ctx";
import { me } from "./ctx";
import { roleOf } from "./access";
import { active, assignees, conFor, isHumanTouch, lost, noNext, nxDue, tList } from "./leads";
import { median } from "./numbers";

export const AR_WHAT = ["Assigned owner", "Changed the owner", "Reassigned on request", "Reassigned to secondary", "Handed to secondary"];
export const AR_REACHED = ["Connected", "Interested", "Call back", "Not now", "Not interested", "Reply received", "Visit completed"];

/* the person a handover line made the owner: `about` when the line carries it, else read off the note */
export function arTo(ctx: Ctx, e: LogEntry): PersonKey | null {
  const ab = e.about as unknown;
  const a1 = Array.isArray(ab) ? (ab[0] as PersonKey | undefined) : (ab as PersonKey | undefined);
  if (a1 && ctx.PEOPLE[a1]) return a1;
  const n = String(e.note || "");
  let name: string | null = null, m: RegExpExecArray | null;
  if (e.what === "Handed to secondary") { m = /^(.*?) acting for /.exec(n); name = m && m[1]; }
  else if ((m = /→\s*(.*?)(?:\s+·|\s+carries it|$)/.exec(n))) name = m[1];
  else if ((m = /^(.*?)(?:\s+carries it|\s+·)/.exec(n))) name = m[1];
  /* the port's assign line carries the bare name ("Kavya Nair"), not "Kavya Nair carries it" */
  else name = n;
  if (!name) return null;
  const nm = name.trim();
  return Object.keys(ctx.PEOPLE).find(k => ctx.PEOPLE[k].n === nm) || null;
}

/* when the current owner was given the lead: the latest handover line naming them, else capture */
export function arAssignedAt(ctx: Ctx, l: Lead): { t: Date | null; cap: boolean } {
  let best: Date | null = null;
  ctx.LOG.forEach(e => {
    if (e.lead !== l.id || !AR_WHAT.includes(e.what) || arTo(ctx, e) !== l.own) return;
    const t = whenT(e.at, ctx.NOW);
    if (t && (!best || t > best)) best = t;
  });
  return best ? { t: best, cap: false } : { t: whenT((l.at || [])[0], ctx.NOW), cap: true };
}

type ArTouch = { ch: string; t: Date; src: string };
/* every contact attempt the owner made after assignment, one entry per attempt. Fixture touch
   stamps carry no author, so a stamp no saved follow-up accounts for is read as the owner's. */
export function arTouches(ctx: Ctx, l: Lead, own: PersonKey, t0: Date): ArTouch[] {
  const out: ArTouch[] = [], ix = (ctx.INTERACTIONS || {})[l.id] || [];
  const add = (ch: string, at: string, src: string) => {
    const t = whenT(at, ctx.NOW); if (!t || t < t0) return;
    if (out.some(x => x.ch === ch && Math.abs(x.t.getTime() - t.getTime()) <= 15 * 6e4)) return;
    out.push({ ch, t, src });
  };
  ix.forEach(x => { if (x.who === own && TOUCHCHANNELS.includes(x.channel as Channel)) add(x.channel, x.at, "fu"); });
  ctx.LOG.forEach(e => { if (e.lead === l.id && e.who === own && isHumanTouch(e)) add(e.kind, e.at, "log"); });
  TOUCHCHANNELS.forEach(k => tList(l, k).forEach(at => {
    const by = ix.find(x => x.at === at && x.channel === k);
    if (!by || by.who === own) add(k, at, "touch");
  }));
  return out.sort((a, b) => a.t.getTime() - b.t.getTime());
}

/* the first-touch service level: the earliest-due channel the investor permits, counted from the
   day the lead reached this owner. No permitted channel, no promise. */
export function arDeadline(l: Lead, t0: Date | null): Date | null {
  const xs = TOUCHSLA.filter(x => conFor(l, x.k)); if (!xs.length || !t0) return null;
  const d = sod(t0); d.setDate(d.getDate() + Math.min(...xs.map(x => x.days)) + 1); return d;
}

export type ArLead = {
  l: Lead; own: PersonKey; t0: Date | null; cap: boolean; n: number; first: Date | null;
  worked: boolean; reached: boolean; missed: boolean; hrs: number | null;
};

export function arLead(ctx: Ctx, l: Lead): ArLead {
  const own = l.own as PersonKey, a = arAssignedAt(ctx, l), t0 = a.t, T = t0 ? arTouches(ctx, l, own, t0) : [];
  const first = T[0] ? T[0].t : null, dl = t0 ? arDeadline(l, t0) : null;
  const ge = (s: string | null | undefined) => { const w = whenT(s, ctx.NOW); return !!w && !!t0 && w >= t0; };
  const reached = !!t0 && ((!!l.reply && ge(l.reply))
    || ((ctx.INTERACTIONS || {})[l.id] || []).some(x => AR_REACHED.includes(x.outcome) && ge(x.at))
    || (["call", "visit"] as const).some(k => tList(l, k).some(at => ge(at))));
  const worked = T.length > 0;
  return { l, own, t0, cap: a.cap, n: T.length, first, worked, reached,
    missed: !!dl && (first ? first >= dl : nowT(ctx.NOW) >= dl),
    hrs: first && t0 ? (first.getTime() - t0.getTime()) / 36e5 : null };
}

export type ArPeriod = { k: string; t: string; in: (t: Date) => boolean };
/* non-overlapping periods on the console clock; the week starts on Monday */
export function arPeriods(NOW: Date): ArPeriod[] {
  const w0 = monday(NOW), w1 = dAdd(w0, -7), m0 = new Date(NOW.getFullYear(), NOW.getMonth(), 1), cut = m0 < w1 ? m0 : w1;
  return [
    { k: "tw", t: "This week", in: t => t >= w0 },
    { k: "lw", t: "Last week", in: t => t >= w1 && t < w0 },
    { k: "em", t: "Earlier this month", in: t => t >= m0 && t < w1 },
    { k: "bm", t: "Before this month", in: t => t < cut },
    { k: "all", t: "Total", in: () => true }];
}

/* whose rows this seat sees: a manager their team, the wider seats every IR, an IR themselves.
   Someone off or gone appears only while leads assigned to them are still in the window. */
export function arPeople(ctx: Ctx): PersonKey[] {
  const r = roleOf(ctx.PEOPLE, me(ctx)) as string, isIRk = (k: PersonKey) => roleOf(ctx.PEOPLE, k) === "ir";
  const ks = ["exec", "bu", "corp", "ops"].includes(r) ? Object.keys(ctx.PEOPLE).filter(isIRk)
    : r === "ir" ? [me(ctx)] : Object.keys(ctx.PEOPLE).filter(k => isIRk(k) && ctx.PEOPLE[k].mgr === me(ctx));
  const on = assignees(ctx);
  return ks.filter(k => on.includes(k) || ctx.LEADS.some(l => l.own === k && l.done > 0));
}

export const arDur = (h: number | null): string => h == null ? "—" : h < 1 ? Math.max(1, Math.round(h * 60)) + " min"
  : h < 48 ? Math.round(h) + " h" : Math.round(h / 24) + " d";

export type ArMacro = { k: string; t: string; f?: (x: ArLead) => boolean; v?: (xs: ArLead[]) => string };
/* the metrics inside the row, in Jev's order; `f` picks the leads, `v` makes a value instead of a count */
export const AR_MACROS = (NOW: Date): ArMacro[] => [
  { k: "att", t: "Attempted only — never reached", f: x => x.worked && !x.reached },
  { k: "rch", t: "Reached the investor", f: x => x.reached },
  { k: "qual", t: "Qualified or further", f: x => x.l.done >= ST.QUALIFIED && !lost(x.l) },
  { k: "yes", t: "Said yes or further", f: x => x.l.done >= ST.CONVERTED && !lost(x.l) },
  { k: "paid", t: "10% in or paid", f: x => x.l.done >= ST.RESERVED && !lost(x.l) },
  { k: "lost", t: "Closed as lost", f: x => lost(x.l) },
  { k: "nonx", t: "Worked, no next step", f: x => x.worked && noNext(x.l) },
  { k: "ovd", t: "Next step overdue", f: x => active(x.l) && nxDue(x.l, NOW) === "overdue" },
  { k: "tch", t: "Touches per worked lead", v: xs => { const w = xs.filter(x => x.worked);
    return w.length ? (w.reduce((a, x) => a + x.n, 0) / w.length).toFixed(1) : "—"; } },
  { k: "fst", t: "Assignment to first touch (median)",
    v: xs => arDur(median(xs.filter(x => x.worked).map(x => x.hrs))) },
];

export type ArCell = { xs: ArLead[]; n: number; w: number; nw: ArLead[] };
export type ArRow = { k: PersonKey; per: ArCell[]; missed: ArLead[]; cap: boolean };
export type ArData = { P5: ArPeriod[]; rows: ArRow[]; tot: { per: ArCell[]; missed: ArLead[] }; all: ArLead[] };

/* the whole report, computed */
export function arData(ctx: Ctx): ArData {
  const P5 = arPeriods(ctx.NOW), ks = arPeople(ctx);
  const all = ctx.LEADS.filter(l => l.own && l.done > 0 && ks.includes(l.own)).map(l => arLead(ctx, l)).filter(x => x.t0);
  const cell = (xs: ArLead[]): ArCell => ({ xs, n: xs.length, w: xs.filter(x => x.worked).length, nw: xs.filter(x => !x.worked) });
  const rows = ks.map(k => {
    const mine = all.filter(x => x.own === k);
    return { k, per: P5.map(p => cell(mine.filter(x => p.in(x.t0 as Date)))), missed: mine.filter(x => x.missed), cap: mine.some(x => x.cap) };
  });
  const tot = { per: P5.map(p => cell(all.filter(x => p.in(x.t0 as Date)))), missed: all.filter(x => x.missed) };
  return { P5, rows, tot, all };
}
