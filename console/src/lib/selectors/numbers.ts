/* ── selectors/numbers.ts — the KPI scorecard, the forecast roll-up, marketing's break ──────
   Ports `ref/03-app.js` lines 640–670 (fcRoll), 4076–4147 (the KPIs and the recovery list),
   4155–4190 (marketing's five steps and the break), 4467–4489 (the live-book helpers) and 4803–4804
   (the KPI RAG). `setRecov` / `clearRecov` are writes and belong to the store.

   Nothing on the live tab is typed: every figure is computed from the records the console holds —
   the ladder stamps, the touch lists, the receipts, the log — so it is small, honest and changes
   the moment somebody records something.
   ────────────────────────────────────────────────────────────────────────────────────────── */

import { GOALS, SPREAD, ST, TOUCHSLA } from "@/domain";
import type { EventRec, Lead, Plan } from "@/domain";
import { DAY, sod, whenT } from "@/lib/format";
import type { UiState } from "@/lib/store";
import type { Ctx } from "./ctx";
import { isFin, may, seesTeam } from "./access";
import { active, fcDate, fcInFY, fcOf, fcOK, openable, tFirst, tCount } from "./leads";
import { perEventNeed, planTotals } from "./plan";

/* ---- small statistics ----------------------------------------------------------------------- */
export const median = (xs: (number | null | undefined)[]): number | null => {
  const a = xs.filter((x): x is number => Number.isFinite(x as number)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};

export const fmtD = (d: number | null | undefined): string =>
  d == null ? "—"
    : d < 0.042 ? Math.max(1, Math.round(d * 1440)) + " min"
    : d < 1 ? Math.round(d * 24) + " h"
    : d < 10 ? (Math.round(d * 10) / 10) + " d" : Math.round(d) + " d";

export const fmtP = (p: number | null | undefined): string => (p == null ? "—" : p + "%");

/* ---- the book the live tab reads ------------------------------------------------------------
   Org-wide reporting presets retain aggregate reporting. A branch manager or a borrowed Numbers
   page reads their authorized records, so summaries cannot reveal another branch's workload. */
export const numBook = (ctx: Ctx): Lead[] => !may(ctx, "numbers", "view") ? []
  : (["exec", "ops", "corp", "bu", "fin", "mkt"].includes(ctx.ROLE) ? ctx.LEADS : openable(ctx))
    .filter(l => l.done > 0);
export const numNamed = (ctx: Ctx, l: Lead): boolean => openable(ctx).some(x => x.id === l.id);
export const canSeeOwners = (ctx: Ctx): boolean => seesTeam(ctx) || isFin(ctx.ROLE);

/* a first-touch channel is on time when its first entry lands within its SLA days of capture */
export const onTime = (l: Lead, x: (typeof TOUCHSLA)[number], NOW: Date): boolean => {
  const c = whenT(l.at[0], NOW), f = whenT(tFirst(l, x.k), NOW);
  return !!(c && f) && Math.floor((f.getTime() - sod(c).getTime()) / DAY) <= x.days;
};

/* ---- FORECAST ROLL-UP -----------------------------------------------------------------------
   three different things, never merged: dated but beyond the FY, categorised but not yet
   evidenced, and everything that counts */
export type FcBucket = { u: number; n: number };
export type FcRoll = {
  commit: FcBucket; probable: FcBucket; pipeline: FcBucket; out: FcBucket; bare: FcBucket;
};

export function fcRoll(ctx: Ctx): FcRoll {
  const r: FcRoll = {
    commit: { u: 0, n: 0 }, probable: { u: 0, n: 0 }, pipeline: { u: 0, n: 0 },
    out: { u: 0, n: 0 }, bare: { u: 0, n: 0 },
  };
  numBook(ctx).filter(l => active(l) && fcOf(l)).forEach(l => {
    const c = fcOf(l) as string;
    const k = (c === "pipeline" ? c
      : !fcDate(l, ctx.NOW) || !fcOK(l, ctx.NOW) ? "bare"
      : (!fcInFY(l, ctx.NOW) && l.done < ST.PAID) ? "out" : c) as keyof FcRoll;
    r[k].u += l.units; r[k].n++;
  });
  return r;
}

/* ===== THE KPI SCORECARD ====================================================================
   Everything a KPI needs, in one place, so a figure is never invented at the point of display.
   `have` is what the demo data shows; `want` comes from the plan; `built` says whether the field
   that would make it real exists yet.
   ========================================================================================== */
export type Kpi = {
  k: string; t: string; grp: string;
  have: number; want: number; unit: string;
  built: boolean; why: string | null; read: string;
  /* Change 6 — the lead filter behind this line's population, when one exists. `KpiRow` renders
     `have` as a button to it exactly when this is set and `hasLeads` is true; a metric with
     nothing on the book to point at (no field written yet, or no filter shaped like it) leaves
     this out and stays plain text. */
  jump?: Partial<UiState>;
};

export function kpis(ctx: Ctx): Kpi[] {
  const PLAN = ctx.PLAN, g = GOALS(PLAN);
  const mult = 1 / ((g.lead2qual / 100) * (g.qual2res / 100) * (g.res2paid / 100));
  const perEv = perEventNeed(PLAN);
  const lines: Kpi[] = [
    { k: "first", t: "First reply inside the window", grp: "Speed",
      have: 71, want: 100, unit: "%", built: false, why: "first_outbound_at is not written yet",
      read: "Three in ten leads never get a same-day reply. Everything downstream is measured on a cohort that was already cold." },
    { k: "day3", t: "Called by day 3", grp: "Speed",
      have: 64, want: g.day3, unit: "%", built: false, why: "stage times are not stored",
      read: "The Day-3 call is the single strongest predictor of qualification, and it is missed on a third of the book." },
    { k: "median", t: "Hours to first reply", grp: "Speed",
      have: 9.4, want: 4, unit: "h", built: false, why: "needs first_outbound_at in minutes",
      read: "The median is inside a working day, so the average is being dragged by a long tail, not by everyone being slow." },
    { k: "l2q", t: "Lead → Qualified", grp: "Funnel",
      have: 26, want: g.lead2qual, unit: "%", built: false, why: "qualification scorecard is not a field",
      read: "The plan needs 40%. At 26% every other rate has to be perfect, and none of them are.",
      jump: { LSTAGE: ST.QUALIFIED, LSTAGEMODE: "from" } },
    { k: "q2r", t: "Qualified → Reserved", grp: "Funnel",
      have: 14, want: g.qual2res, unit: "%", built: false, why: "reserved date is not stamped",
      read: "Closer to plan than the top of the funnel. This is not where the raise is being lost.",
      jump: { LSTAGE: ST.RESERVED, LSTAGEMODE: "from" } },
    { k: "r2p", t: "Reserved → Fully paid", grp: "Funnel",
      have: 71, want: g.res2paid, unit: "%", built: true, why: null,
      read: "Eight of 28 advances lapsed and forfeited. Each one is ₹50,000 kept and a unit back on the shelf.",
      jump: { LSTAGE: ST.PAID, LSTAGEMODE: "from" } },
    { k: "perev", t: "Leads per event", grp: "Demand",
      have: 35, want: perEv, unit: "", built: true, why: null,
      read: "A two-day activation is taking about 35 leads and the plan is built on " + perEv +
        ". Events are the channel that works; there are not enough of them, and each one is short." },
    { k: "nonev", t: "Leads from anything but events", grp: "Demand",
      have: 12, want: Math.round(g.units * (1 - g.eventShare / 100) * mult / Math.max(1, g.months * 4)),
      unit: "/wk", built: false, why: "source is free text in the CRM",
      read: "Digital and relationship-led are at a twelfth of what the plan assumes. This is the constraint." },
    { k: "touch", t: "Touches before a qualification", grp: "Effort",
      have: 2.3, want: 4, unit: "", built: false, why: "touch numbering is not stored",
      read: "Leads are being abandoned around the second attempt, well before the point most conversions happen." },
    { k: "cb", t: "Promised call-backs kept", grp: "Effort",
      have: 58, want: 95, unit: "%", built: false, why: "call-back date has no field",
      read: "A missed call-back is the cheapest lost lead there is — the person had already said yes to being called." },
    { k: "unass", t: "Hours a lead waits for an owner", grp: "Effort",
      have: 19, want: 2, unit: "h", built: false, why: "assignment time is not stamped",
      read: "Leads captured by anyone who is not an IR sit most of a day before a person picks them up.",
      jump: { LQ: "unassigned" } },
    { k: "lost", t: "Closes with a recorded reason", grp: "Learning",
      have: 31, want: 100, unit: "%", built: false, why: "no lost-reason field on Leads",
      read: "Two thirds of losses are recorded as nothing at all, so the objection list is built on a third of the evidence.",
      jump: { LFILT: "lost" } },
  ];
  return lines.concat(planLines(PLAN));
}

/* The plan's own periods, read as scorecard lines — ir-merged.js 7020 `planLines`. They carry the
   same bands as every other line, which is what lets the Plan page hang a recovery action on one;
   Numbers filters them out of its scorecard again. */
export function planLines(PLAN: Plan): Kpi[] {
  const T = planTotals(PLAN);
  return PLAN.periods.map(p => ({ k: "plan_" + p.k, t: p.t + " — fully paid against target", grp: "Plan",
    have: p.actual, want: p.target, unit: "", built: true, why: null,
    read: p.actual + " of " + p.target + " units verified by Finance in " + p.t + "." } as Kpi))
    .concat([{ k: "plan_total", t: "The plan — fully paid against target", grp: "Plan",
      have: T.actual, want: T.target, unit: "", built: true, why: null,
      read: T.actual + " of " + T.target + " units verified across every period." }]);
}

/* an hours metric is better when it is LOWER, so its score is inverted */
export const kScore = (m: Kpi): number =>
  m.unit === "h" ? Math.min(1, m.want / Math.max(0.1, m.have))
    : Math.min(1, m.have / Math.max(0.1, m.want));

export const kRag = (m: Kpi): "green" | "amber" | "red" => {
  const p = kScore(m) * 100;
  return p >= 100 ? "green" : p >= 90 ? "amber" : "red";
};
export const kCol = (m: Kpi): string =>
  ({ green: "var(--go)", amber: "var(--due)", red: "var(--late)" })[kRag(m)];

/* ---- RECOVERY ACTIONS. Manual operating rule 5 and the Table 24 scorecard: every Amber or Red
   line carries one owner, one recovery action and one date. Nothing here is optional — an amber
   line without a recovery action is itself an exception. ---- */
/* RECOVACTS — the closed list `setRecov` validates against — is @/domain's */

/* ===== MARKETING'S NUMBERS ==================================================================
   Marketing does not own a lead and cannot see an investor's money, so the whole commercial half of
   Numbers is noise to them. What they own is the top of the funnel: an event, a channel, a campaign,
   and the question "did it work". So they get one screen: what each thing produced, what it cost to
   produce it, and — the only line that changes a decision — WHERE IT BREAKS. Not "conversion is 12%"
   but "Koramangala Club: 26 names, 9 qualified, nothing reserved — it breaks at reservation."
   ========================================================================================== */
export type Stats = {
  captured: number; tagged: number;
  /* OPTIONAL, AND IT MATTERS. `srcStats` counts it; `evStats` does not, and the prototype's
     `evStats` never did — so for an event the "first touch" and "qualifying" steps below read
     undefined and their percentages come out NaN, which drops them out of every `x.gap > 0` test
     in `breakOf`. That is the prototype's behaviour, not a slip in the port: reading it as 0
     instead would make "first touch" the break on every event card. */
  touched?: number;
  qual: number; res: number; paid: number; done?: number; lost?: number;
};

export const srcStats = (ctx: Ctx, x: string): Stats => {
  const L = numBook(ctx).filter(l => l.src === x);
  return {
    captured: L.length, tagged: L.length,
    touched: L.filter(l => l.done >= ST.TOUCH).length,
    qual: L.filter(l => l.done >= ST.QUALIFIED).length,
    res: L.filter(l => l.done >= ST.RESERVED).length,
    paid: L.filter(l => l.done >= ST.PAID).length,
    lost: L.filter(l => !!l.lost).length,
  };
};

export const evLeads = (ctx: Ctx, id: string): Lead[] => ctx.LEADS.filter(l => l.ev === id);

/* counts come from the leads themselves — nothing about an event is typed twice */
export const evStats = (ctx: Ctx, e: EventRec): Stats => {
  const L = evLeads(ctx, e.id);
  return {
    captured: e.off || L.length, tagged: L.length,
    qual: L.filter(l => l.done >= ST.QUALIFIED).length,
    res: L.filter(l => l.done >= ST.RESERVED).length,
    paid: L.filter(l => l.done >= ST.PAID).length,
    done: L.filter(l => l.done >= ST.ALLOCATED).length,
  };
};

/* the five steps a name walks, and what the plan assumes at each */
export type Step = { t: string; have: number; of: number; want: number };

export const stepsOf = (PLAN: Plan, st: Stats): Step[] => {
  const r = PLAN.rates;
  return [
    { t: "reaching a record", have: st.tagged, of: st.captured, want: 100 },
    /* `touched` is absent on an event's stats — see the note on Stats. Left as the prototype
       had it: undefined in, NaN out, and the step drops out of the break test. */
    { t: "first touch", have: st.touched as number, of: st.tagged, want: 90 },
    { t: "qualifying", have: st.qual, of: st.touched as number, want: r.lead2qual },
    { t: "reserving", have: st.res, of: st.qual, want: r.qual2res },
    { t: "paying", have: st.paid, of: st.res, want: r.res2paid },
  ];
};

/* THE STEP THAT IS THIS EVENT'S FAULT. A leak every event shares is not an event's problem — it is
   the process, and repeating it on four cards teaches nobody anything. So a step only counts as an
   event's break when it is materially worse than the same step everywhere else; when nothing is,
   the event reads "in line", and the shared leak is stated once, at the top, as its own finding. */
/* SPREAD — points worse than everyone else to be yours — is @/domain's */

export type Base = Record<string, number | null>;
export type Break = Step & { pc: number; gap: number; own: number; shared?: boolean; ok?: boolean };

export function breakOf(PLAN: Plan, st: Stats, base: Base | null): Break | null {
  const live: Break[] = stepsOf(PLAN, st).filter(x => x.of > 0)
    .map(x => ({ ...x, pc: Math.round(x.have / x.of * 100) }) as Break)
    .map(x => ({ ...x, gap: x.want - x.pc, own: base ? (base[x.t] ?? x.pc) - x.pc : 99 }));
  if (!live.length) return null;
  const mine = live.filter(x => x.gap > 0 && x.own >= SPREAD);
  if (mine.length) return mine.sort((a, b) => b.own - a.own)[0];
  const worst = live.filter(x => x.gap > 0).sort((a, b) => b.gap - a.gap)[0];
  return worst ? { ...worst, shared: true } : { ...live[0], ok: true };
}

/* the same five steps across everything, which is what an event is compared against */
export function baseRates(PLAN: Plan, list: Stats[]): Base {
  const sum = list.reduce((a: Record<string, { have: number; of: number }>, st) => {
    stepsOf(PLAN, st).forEach(x => {
      a[x.t] = a[x.t] || { have: 0, of: 0 };
      a[x.t].have += x.have; a[x.t].of += x.of;
    });
    return a;
  }, {});
  const out: Base = {};
  Object.keys(sum).forEach(k => { out[k] = sum[k].of ? Math.round(sum[k].have / sum[k].of * 100) : null; });
  return out;
}

/* ---- the live tab's own aggregations --------------------------------------------------------
   the touch counts by channel, and the six-week bars, lifted out of `vNumbersLive` so the page
   draws them rather than computing them */
export const touchesByChannel = (ctx: Ctx): [string, number][] =>
  TOUCHSLA.map(x => [x.k, numBook(ctx).reduce((a, l) => a + tCount(l, x.k), 0)]);
