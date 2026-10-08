/* ── selectors/leads.ts — the book, and everything read off a lead ──────────────────────────
   Ports `ref/03-app.js` lines 116–149 (touches and consent), 513–571 (lost, active, the next
   action), 609–623 (forecast), 945–1046 (books, late, RAG, the queue), 1060–1126 (custody, cover),
   2058–2116 (nextUp), 2153–2157, 2479–2531 (the gap and the closers), 2610–2637 (the horizon),
   2712–2754 (search), 2947–2992 (paperNow, leadDoors).

   Everything here is a read. Where the prototype's function both decided and wrote — `tick`,
   `logTouch`, `closeLost`, `saveNext`, `assign` — only the decision is here; the write is the
   store's. See the hand-back note for the pairs.
   ────────────────────────────────────────────────────────────────────────────────────────── */

import { createElement } from "react";
import type { ReactNode } from "react";
import {
  CHAN, CHNAME, COLDAT, CUSTODY, FCAT, FORFEIT, FYEND, LADDER, RAGT, ROUNDS, SENDABLE, ST,
  TOUCHCHANNELS, TOUCHDONE, TOUCHSLA,
} from "@/domain";
/* the prototype read these as globals; a selector reads the store's copy, and a missing map is empty. */
import type {
  Channel, Cover, InteractionRec, Lead, LeadComparator, LeadId, LogEntry, PayRec, PersonKey,
  RagColour, SortKey, Stamp,
} from "@/domain";
import {
  accessDay, accessMoment, DAY, dayGap, dayOf, dISO, dISOtoDisp, dOf, money, norm, nowT, sameDay, when, whenFwd, whenT,
} from "@/lib/format";
import type { Ctx } from "./ctx";
import { me, P } from "./ctx";
import {
  canAssign, canDecideMove, canWork, canEdit, canOperateLeads, canReadFinance, canViewInvestorCopy, chainOf, consoleAccount, isFin, isIR, may, roleOf, seeMoney, seesTeam,
} from "./access";
import { avail, absRec, absFrom, absTo, outFor, outTo, logReadable, supervisedActors } from "./activity";
import { prDone, prMine, prNext, prAt, ndaOK, suppOK } from "./paper";
import { canClaim, claimOf } from "./claims";
import { financeAccountId, financeDocuments, financePaySummary } from "./finance";
import { gateOf, gateWait } from "./ladder";
import { planTotals } from "./plan";

/* the one reader for a receipt: the prototype indexed `PAY[l.id]` on a global that may not be on
   `Ctx` at all (see ctx.ts), and an id with no receipt has always answered undefined */
export const payOf = (ctx: Ctx, id: LeadId): PayRec | null => (ctx.PAY || {})[id] || null;

/* ===== TOUCHES ==============================================================================
   A channel is not one event. An IR emails once, then again, then a third time, and whether the
   investor ever came back is the signal that matters — so every touch is kept, by hand, and the
   reply is its own record. The first entry in a channel is what the service level reads.
   ========================================================================================== */
export const tList = (l: Lead | null | undefined, k: string): Stamp[] =>
  ((((l || {}) as Lead).touch || {}) as Record<string, Stamp[]>)[k] || [];
export const tFirst = (l: Lead | null | undefined, k: string): Stamp | null => tList(l, k)[0] || null;
export const tLast = (l: Lead | null | undefined, k: string): Stamp | null =>
  tList(l, k)[tList(l, k).length - 1] || null;
export const tCount = (l: Lead | null | undefined, k: string): number => tList(l, k).length;

/* ===== Primitive B — how quiet a lead has gone ==============================================
   `lateOf` answers 0 for a lost/onboarded/unowned lead, so it cannot say how long since anyone
   heard from them. This reads every touch on every channel and every logged attempt (a failed
   call still happened), and falls back to the capture date so a lead nobody has ever reached is
   the most dormant one, not a hidden one. Decisions taken as given: an interaction — including a
   "No answer" — counts as an attempt; the fallback is the capture date, never "no data". */
export function lastTouchAt(ctx: Ctx, l: Lead | null | undefined): Date | null {
  if (!l) return null;
  const ds = TOUCHCHANNELS.map(k => whenT(tLast(l, k), ctx.NOW)).filter((x): x is Date => !!x);
  const iv = ((ctx.INTERACTIONS || {})[l.id] || [])
    .map(x => whenT(x.at, ctx.NOW)).filter((x): x is Date => !!x);
  const all = [...ds, ...iv];
  return all.length ? all.reduce((a, b) => (b > a ? b : a)) : (whenT((l.at || [])[0], ctx.NOW) || null);
}
/* quietDays reads the store's own clock (`ctx.NOW`), never the wall clock — the console's one
   frozen NOW is what every other "how late" question in this file answers against too. */
export const quietDays = (ctx: Ctx, l: Lead | null | undefined): number | null => {
  const d = lastTouchAt(ctx, l);
  return d == null ? null : Math.max(0, Math.round((dayOf(ctx.NOW).getTime() - dayOf(d).getTime()) / 864e5));
};

/* A failed attempt is manual contact too, even though it leaves no channel stamp: a call that rang
   out or a visit nobody was home for still happened, and still counts toward how hard this lead
   has been worked (ir-console-redesigned.html:2648-2652). Read off `INTERACTIONS`, which the
   redesign's follow-up drawer writes and the seed starts empty, like the prototype's own. */
export const failedCallAttempts = (ctx: Ctx, l: Lead | null | undefined): InteractionRec[] =>
  ((ctx.INTERACTIONS || {})[(l || {} as Lead).id] || [])
    .filter(x => x.channel === "call" && ["No answer", "Wrong number"].includes(x.outcome));
export const failedVisitAttempts = (ctx: Ctx, l: Lead | null | undefined): InteractionRec[] =>
  ((ctx.INTERACTIONS || {})[(l || {} as Lead).id] || [])
    .filter(x => x.channel === "visit" && x.outcome === "Investor unavailable");

export const touches = (ctx: Ctx, l: Lead): number =>
  TOUCHCHANNELS.reduce((a, k) => a + tCount(l, k), 0)
  + failedCallAttempts(ctx, l).length + failedVisitAttempts(ctx, l).length;
export const touchDone = (l: Lead): number => TOUCHSLA.filter(x => conFor(l, x.k) && tCount(l, x.k)).length;

/* how many times we have reached out since they last came back to us — visits count, and so does
   an attempt that never landed a stamp because nobody answered */
export const sinceReply = (ctx: Ctx, l: Lead, NOW: Date): number => {
  const r = l && l.reply ? whenT(l.reply, NOW) : null;
  const after = (t: string): boolean => !r || (whenT(t, NOW) as Date) >= r;
  return TOUCHCHANNELS.reduce((a, k) => a + tList(l, k).filter(after).length, 0)
    + failedCallAttempts(ctx, l).filter(x => after(x.at)).length
    + failedVisitAttempts(ctx, l).filter(x => after(x.at)).length;
};

/* COLDAT — the manual's own "keep working no-reply leads" — lives in @/domain */
export const cold = (ctx: Ctx, l: Lead, NOW: Date): boolean =>
  active(l) && l.done < ST.CONVERTED && sinceReply(ctx, l, NOW) >= COLDAT;

/* ===== CONSENT ==============================================================================
   Consent was asked for one channel at a time, so it is checked one channel at a time. A lead who
   ticked Email only is not a lead you may WhatsApp, and the console will not record that you did.
   A lead captured before per-channel consent existed carries the blanket flag, and is read as
   consented on every channel — the honest reading of a record that does not say otherwise.
   ========================================================================================== */
/* A channel added after a lead's `con` was first recorded (Visit, for the leads captured before
   it existed) reads as NOT consented until somebody explicitly grants it — the redesign's
   tightening: a channel present in `con` must say `true`, not merely "not false". */
export const conFor = (l: Lead | null | undefined, k: Channel): boolean =>
  !!l && !!l.consent && (!l.con || (l.con as Record<string, boolean>)[k] === true);

export const conWhy = (l: Lead | null | undefined, k: Channel): string =>
  !l || !l.consent
    ? "Consent has to be recorded before any outbound touch."
    : "This lead agreed to " + ((Object.keys(l.con || {}) as Channel[])
        .filter(x => (l.con as Record<string, boolean>)[x])
        .map(x => CHNAME[x] || x).join(" and ") || "nothing")
      + " only, so " + (CHNAME[k] || k) + " cannot be recorded against them.";

/** Whether any channel is open to contact this lead at all — Visits included. */
export const anyConsent = (l: Lead | null | undefined): boolean =>
  TOUCHCHANNELS.some(k => conFor(l, k));

export type MissingTouch = { k: Channel; t: string; due: string; days: number; date: Date; late: number; state: "overdue" | "today" | "ahead" };

/** A first-touch promise applies only to a channel the investor permits. Its deadline is the
 *  capture date plus the channel's SLA, so an email due tomorrow cannot become overdue today. */
export function missingTouch(ctx: Ctx, l: Lead | null | undefined): MissingTouch | null {
  if (!l || l.done > ST.TOUCH) return null;
  const x = TOUCHSLA.find(x => conFor(l, x.k) && !tCount(l, x.k));
  if (!x) return null;
  const NOW = ctx.NOW;
  const src = whenT((l.at || [])[0], NOW) || NOW;
  const date = new Date(src.getFullYear(), src.getMonth(), src.getDate());
  date.setDate(date.getDate() + x.days);
  const late = Math.max(0, Math.floor((dayOf(NOW).getTime() - date.getTime()) / DAY));
  return { ...x, date, late, state: late > 0 ? "overdue" : sameDay(date, NOW) ? "today" : "ahead" };
}

/* knownUnitIntent(l) — ir-console-redesigned.html:3136. A lead the capture form was explicitly
   told has no unit count yet (`unitsKnown===false`) is not one, however many units its record
   otherwise carries; every other lead is, once the count itself is a real positive integer. Gates
   `claimPaid`/`confirmClaim`/the paid-forward reports (5461, 5466) and prints "Not discussed" on
   the leads table (7440) rather than guessing a figure nobody has said yet. */
export const knownUnitIntent = (l: Lead | null | undefined): boolean =>
  !!l && l.unitsKnown !== false && Number.isInteger(Number(l.units)) && Number(l.units) > 0;

/* ===== HOW A LEAD ENDS ====================================================================== */
export const lost = (l: Lead | null | undefined): boolean => !!(l && l.lost);

/* active = someone owns it, it is on the ladder, it has not been lost and it has not left the book */
export const active = (l: Lead): boolean =>
  !!l.own && l.done > 0 && l.done < ST.ONBOARDED && !lost(l);

/* Primitive A — has this lead reached at least rung n, on this ladder or past it. The Leads stage
   filter's "from" mode and the Numbers funnel read the same test, so a rung's reach and its
   clickthrough can never disagree. */
export const stageAtLeast = (l: Lead | null | undefined, n: number): boolean => !!l && l.done >= n;

/* ===== CUSTODY ==============================================================================
   THE GATE, NOT A HANDOVER. The lead never leaves the IR. Three rungs rest on a fact only Finance
   can establish, but ownership does not move; the truth gets checked. See selectors/ladder.ts.
   ========================================================================================== */
export const custodian = (l: Lead | null | undefined): "IR" | "Closed" | null =>
  !l ? null : l.done >= LADDER.length ? "Closed" : "IR";

/* ===== COVER ================================================================================ */
export function coverLive(ctx: Ctx, cover: Cover | null | undefined, owner?: PersonKey | null): cover is Cover {
  if (!cover || !canOperateLeads(ctx,cover.by) || roleOf(ctx.PEOPLE, cover.by) === "cp" || cover.by === owner) return false;
  if (owner && !canOperateLeads(ctx,owner)) return false;
  if (!avail(ctx,cover.by)) return false;
  const until = accessDay(cover.to, ctx.NOW), from = cover.from ? accessMoment(cover.from, ctx.NOW) : null;
  const today = dayOf(ctx.NOW);
  return !!until && until >= today && (!cover.from || (!!from && from <= ctx.NOW && dayOf(from) <= until));
}

export const covOf = (ctx: Ctx, l: Lead): Cover | null => {
  const canonical = ctx.LEADS.find(x=>x.id === l.id);
  if (!canonical?.own || !canOperateLeads(ctx,canonical.own)) return null;
  const explicit = canonical.cov || ctx.COVER[canonical.own];
  return coverLive(ctx,explicit,canonical.own) ? explicit : null;
};
export const acting = (ctx: Ctx, l: Lead): PersonKey | null => covOf(ctx, l)?.by ?? ctx.LEADS.find(x=>x.id === l.id)?.own ?? null;

/* The secondary works the lead only when the primary cannot: marked out, or a cover window is open.
   Availability is the trigger — a colour on a dot never was one. */
export function secondaryHolds(ctx: Ctx, lead: Lead, k: PersonKey): boolean {
  const l = ctx.LEADS.find(x=>x.id === lead.id);
  if (!l?.own || !canOperateLeads(ctx,l.own) || l.sec !== k || !secOK(ctx,l)) return false;
  const cover = covOf(ctx,l);
  if (l.cov || ctx.COVER[l.own]) return !!cover && cover.by === k;
  const absence = outFor(ctx,l.own), from = accessDay(absence?.from,ctx.NOW), to = accessDay(absence?.to,ctx.NOW), today = dayOf(ctx.NOW);
  return !!absence && !absence.perm && !!from && !!to && from < to && from <= today && today < to;
}
export const secondaryMayWork = (ctx: Ctx, l: Lead): boolean => secondaryHolds(ctx,l,me(ctx));

/* a secondary is only cover if they are somebody else, still here, and at their desk */
export const secOK = (ctx: Ctx, lead: Lead | null | undefined): boolean => {
  const l = lead && ctx.LEADS.find(x=>x.id === lead.id);
  return !!l?.sec && l.sec !== l.own && consoleAccount(ctx.PEOPLE,l.sec,ctx.CAPS) && roleOf(ctx.PEOPLE,l.sec) === "ir" && avail(ctx,l.sec);
};

export const inBookOf = (ctx: Ctx, lead: Lead): boolean => {
  const l = ctx.LEADS.find(x=>x.id === lead.id);
  return !!l?.own && consoleAccount(ctx.PEOPLE,me(ctx),ctx.CAPS) && (l.own === me(ctx)
    || (roleOf(ctx.PEOPLE,me(ctx)) !== "cp" && (acting(ctx,l) === me(ctx) || secondaryMayWork(ctx,l))));
};

export const inBook = inBookOf;

/* named on the lead but unable to change it — always say why, never just grey things out */
export const named = (ctx: Ctx, l: Lead | null | undefined): boolean =>
  !!l && !!l.own && inBook(ctx, l);

export const watching = (ctx: Ctx, l: Lead): boolean => named(ctx, l) && !canEdit(ctx, l);

export const whyLocked = (ctx: Ctx, l: Lead): string =>
  lost(l)
    ? `Closed as lost. Re-opening it is the only thing left on this record.`
    : custodian(l) === "Closed"
    ? `Every rung on this one is done. Nothing here changes again.`
    : `${P(ctx.PEOPLE, l.own).n} is working this one.`;

/* ===== THE NEXT ACTION ======================================================================
   Manual Table 11: "No active lead without stage + next action/date". It is a control, not a note.
   ========================================================================================== */
export const hasNext = (l: Lead): boolean => !!(l.nx && l.nx.t && l.nx.by);

/* before the first touch lands, the three first-touch SLAs ARE the next action — the manual puts
   this control on Qualification and Nurture (Table 11), which starts once the touch is made */
export const needsNext = (l: Lead): boolean =>
  active(l) && !lost(l)
  && (l.done > ST.TOUCH || (l.done === ST.TOUCH && touchDone(l) === TOUCHSLA.length));
export const noNext = (l: Lead): boolean => needsNext(l) && !hasNext(l);

/* ---- ONE CLOCK. A next step has a day and, when somebody agreed one, an hour. Every screen that
   asks "is this late" — the lead page, the list, the day, the filters, the numbers — reads these
   two functions, so they can never disagree about the same lead. The ISO date on the record wins
   over the printed one, because a printed "31 Mar" has thrown its year away. ---- */
export const nxDate = (l: Lead, NOW: Date): Date | null => {
  if (!hasNext(l)) return null;
  if (l.nx!.d && /^\d{4}-\d{2}-\d{2}$/.test(l.nx!.d)) {
    const d = new Date(l.nx!.d + "T00:00:00");
    if (!isNaN(d.getTime())) return d;
  }
  return when(l.nx!.by, NOW);
};

export const nxAt = (l: Lead, NOW: Date): Date | null => {
  const d = nxDate(l, NOW);
  if (!d) return null;
  const x = new Date(d.getTime());
  const m = /^(\d{1,2}):(\d{2})$/.exec(l.nx!.tm || "");
  if (m && +m[1] < 24 && +m[2] < 60) x.setHours(+m[1], +m[2], 0, 0); else x.setHours(23, 59, 0, 0);
  return x;
};

/* hours late — positive means the moment has passed */
export const nxLate = (l: Lead, NOW: Date): number | null => {
  const d = nxAt(l, NOW);
  return d == null ? null : (nowT(NOW).getTime() - d.getTime()) / 36e5;
};

export type Due = "overdue" | "today" | "ahead";
export const nxDue = (l: Lead, NOW: Date): Due | null => {
  const d = nxDate(l, NOW);
  if (!d) return null;
  return (nxLate(l, NOW) as number) > 0 ? "overdue" : sameDay(d, NOW) ? "today" : d < NOW ? "overdue" : "ahead";
};

export const nxTime = (l: Lead | null | undefined): string => (l && l.nx && l.nx.tm) || "";
/* the prototype's nxWhen escaped for HTML; React escapes, so this is the plain text */
export const nxWhen = (l: Lead): string =>
  !hasNext(l) ? "" : l.nx!.by + (nxTime(l) ? " · " + nxTime(l) : "");

/* Finance confirms money; the IR owns the follow-through and the forecast, which is what the
   manual's Table 9 and Table 18 say. */
export const canPlan = (ctx: Ctx, l: Lead | null | undefined): boolean =>
  !!l && !!l.own && openable(ctx).some(x => x.id === l.id)
  && custodian(l) !== "Closed" && may(ctx, "leads", "edit")
  && (inBookOf(ctx, l) || ["conv", "ops"].includes(roleOf(ctx.PEOPLE, me(ctx))!));

/* ===== FORECAST =============================================================================
   Manual §3.1 and Table 22. Commit and Probable need investor-specific evidence; a reservation
   only counts toward the FY forecast when full payment is expected on or before 31 March 2027.
   Pipeline is coverage, never achievement.
   ========================================================================================== */
export const fcOf = (l: Lead): string | null => (l.fc && l.fc.c) || null;

export const fcDate = (l: Lead | null | undefined, NOW: Date): Date | null =>
  !l || !l.fc || !l.fc.by ? null
    : l.done >= ST.PAID ? when(l.fc.by, NOW)   /* realised: 20 Aug means the 20 Aug that happened */
    : whenFwd(l.fc.by, NOW);                   /* a forecast always points forward */

/* the rule, spelled out: evidence for Commit/Probable, and an in-FY date to be counted */
export const fcInFY = (l: Lead, NOW: Date): boolean => {
  const d = fcDate(l, NOW);
  return !!d && d <= FYEND;
};

/* What a forecast owes is a DATE. It used to owe a written justification as well, and that turned
   out to be the wrong trade: an IR with a real date and no time to write a paragraph either left
   the category off or wrote something meaningless to clear the flag. Evidence is now asked for,
   shown where it exists, and never required — the date is the commitment. */
export const fcOK = (l: Lead, NOW: Date): boolean => {
  const c = fcOf(l);
  if (!c) return !(active(l) && l.done >= ST.QUALIFIED);
  if (c === "pipeline") return true;
  return !!fcDate(l, NOW);
};
export const fcBad = (l: Lead, NOW: Date): boolean =>
  active(l) && l.done >= ST.QUALIFIED && !fcOK(l, NOW);

/* ===== MONEY ON A LEAD ====================================================================== */
export const inReservation = (ctx: Ctx, l: Lead | null | undefined): boolean => {
  if (!l) return false;
  const p = payOf(ctx, l.id);
  return l.done >= ST.RESERVED && l.done < ST.PAID && !!p && p.state !== "full";
};

/* ===== THE BOOKS ============================================================================
   everyone's personal book is the same rule: primary or secondary, for the lead's whole life
   ========================================================================================== */

/* your book is what you own, what you back up, and what you are covering — for life */
export const myBook = (ctx: Ctx): Lead[] =>
  ctx.LEADS.filter(l => inBook(ctx, l));

/* the part of it you can act on today */
export const myWork = (ctx: Ctx): Lead[] =>
  ctx.LEADS.filter(l => inBookOf(ctx, l));

export const unassigned = (ctx: Ctx): Lead[] => roleOf(ctx.PEOPLE, me(ctx)) === "cp" ? [] : ctx.LEADS.filter(l => !l.own);

export const teamBook = (ctx: Ctx): Lead[] => {
  if (!seesTeam(ctx)) return [];
  const t = myTeamKeys(ctx);
  return ctx.LEADS.filter(l => !l.own || t.includes(l.own)
    || (roleOf(ctx.PEOPLE,me(ctx)) === "conv" && !!l.own && !!ctx.PEOPLE[l.own] && chainOf(ctx.PEOPLE,l.own).includes(me(ctx)))
    || (!!l.sec && t.includes(l.sec) && secondaryHolds(ctx,l,l.sec)));
};

/* myTeam lives in access.ts; this is the one-line indirection that keeps the import cycle to types */
const myTeamKeys = (ctx: Ctx): PersonKey[] =>
  ["ops", "corp", "bu", "exec"].includes(roleOf(ctx.PEOPLE, me(ctx))!)
    ? Object.keys(ctx.PEOPLE).filter(k => k !== me(ctx))
    : teamOfLocal(ctx, me(ctx));

function teamOfLocal(ctx: Ctx, k: PersonKey): PersonKey[] {
  const direct = Object.keys(ctx.PEOPLE).filter(x => ctx.PEOPLE[x].mgr === k && ctx.PEOPLE[x].on);
  return [...new Set(direct.concat(...direct.map(d => teamOfLocal(ctx, d))))];
}

export function visible(ctx: Ctx): Lead[] {
  if (!may(ctx, "leads", "view")) return [];
  /* Finance owns no book — its scope is the commercial close: Reserved and beyond, plus anything it
     already holds money or a document on, so nothing on its own screens is un-openable.
     The NDA goes out at first touch, so Finance's scope starts there rather than at the commercial
     close: a lead whose round is in flight, or whose NDA has not gone yet, is Finance's work. */
  if (roleOf(ctx.PEOPLE, me(ctx))! === "fin") return ctx.LEADS.filter(l =>
    l.done >= ST.CONVERTED || !!payOf(ctx, l.id)
    || ctx.DOCS.some(d => d.lead === l.id) || !!ctx.PAPER[l.id]
    || (l.done >= ROUNDS[0].from && !prDone(ctx, l.id, "nda") && !lost(l)));
  return myBook(ctx).concat(unassigned(ctx).filter(() => isIR(roleOf(ctx.PEOPLE, me(ctx))!)));   /* personal, lifetime */
}

/* the Team scope lists other people's leads, so those leads must be openable — read-only */
export const openable = (ctx: Ctx): Lead[] => {
  const p = visible(ctx);
  if (!seesTeam(ctx)) return p;
  const seen = new Set(p.map(l => l.id));
  return p.concat(teamBook(ctx).filter(l => !seen.has(l.id)));
};

/* who can be handed a lead today — never a hard-coded list, never someone who has left */
export const assignees = (ctx: Ctx): PersonKey[] =>
  Object.keys(ctx.PEOPLE).filter(k => consoleAccount(ctx.PEOPLE, k, ctx.CAPS) && ["ir", "cp"].includes(roleOf(ctx.PEOPLE, k) as string));
export const channelPartners = (ctx: Ctx): PersonKey[] =>
  Object.keys(ctx.PEOPLE).filter(k => consoleAccount(ctx.PEOPLE, k, ctx.CAPS) && roleOf(ctx.PEOPLE, k) === "cp");
export const sourceLabel = (ctx: Ctx, l: Lead): string => l.src === "Channel partner" && l.channelPartnerId
  ? l.src + " · " + P(ctx.PEOPLE, l.channelPartnerId).n : l.src;
/* everyone() — ir-console-redesigned.html 4068: roleOf(me())==="cp"?[me()]:PEOPLE on && roleOf!=="mkt".
   Team-availability roster, not console-login access — deliberately NOT gated by consoleAccount
   (which would drop Finance's `ext` seat and keep `mkt`, disagreeing with the prototype's own count). */
export const everyone = (ctx: Ctx): PersonKey[] => {
  const self = me(ctx);
  if (roleOf(ctx.PEOPLE, self) === "cp") return [self];
  return Object.keys(ctx.PEOPLE).filter(k => ctx.PEOPLE[k].on && roleOf(ctx.PEOPLE, k) !== "mkt");
};

/* one book per section, chosen by the sidebar */
export const scopeOf = (ctx: Ctx, v: string): "mine" | "team" =>
  seesTeam(ctx) ? (!canOperateLeads(ctx) && ["today", "leads"].includes(v) ? "team"
    : (ctx.SC as Record<string, "mine" | "team">)[v] || "mine") : "mine";
export const bookFor = (ctx: Ctx, v: string): Lead[] =>
  scopeOf(ctx, v) === "team" ? teamBook(ctx) : visible(ctx);

/* ===== HOW LATE, computed ===================================================================
   It used to be a number typed onto each lead, which made it a second clock: it could say five
   days on a record whose own stamps said four, and nothing would notice. Now it comes off the
   record — days past a dated next step, or days since the last thing that happened on a lead that
   owes one.
   ========================================================================================== */
export function lateOf(l: Lead | null | undefined, NOW: Date): number {
  if (!l || !l.own || !active(l)) return 0;
  if (hasNext(l)) return Math.max(0, Math.floor((nxLate(l, NOW) as number) / 24));
  /* the first-touch service levels come first — a lead still owed a permitted-channel touch is
     late off the SAME clock `missingTouch` reads, not a second one (ir-console-redesigned.html
     4010-4017). Inlined rather than calling `missingTouch(ctx, l)`, which needs a `Ctx` this
     function does not take. */
  if (l.done <= ST.TOUCH) {
    const x = TOUCHSLA.find(x => conFor(l, x.k) && !tCount(l, x.k));
    if (x) {
      const src = whenT((l.at || [])[0], NOW) || NOW;
      const date = new Date(src.getFullYear(), src.getMonth(), src.getDate());
      date.setDate(date.getDate() + x.days);
      return Math.max(0, Math.floor((dayOf(NOW).getTime() - date.getTime()) / DAY));
    }
    if (!TOUCHCHANNELS.some(k => conFor(l, k))) return 0;   /* no channel open at all — no clock runs */
  }
  const t = l.done <= ST.TOUCH ? l.at[0] : l.at[l.done - 1];
  const d = TOUCHCHANNELS.map(k => whenT(tLast(l, k), NOW)).filter((x): x is Date => !!x)
    .reduce<Date | null>((a, b) => (!a || b > a ? b : a), whenT(t, NOW));
  if (!d) return 0;
  return Math.max(0, Math.round((dayOf(NOW).getTime() - dayOf(d).getTime()) / 864e5));
}

export type Rag = RagColour;
export type RagReason = { c: Rag; why: string; t: string };

/* red / amber / green — AND the clause that produced it, off the same test, so the reason can
   never describe a different rule from the one that fired (ir-console-redesigned.html:4010-4064). */
export function ragOf(ctx: Ctx, l: Lead): RagReason {
  const R = (c: Rag, why?: string): RagReason => ({ c, why: why || "", t: RAGT[c] + (why ? " · " + why : "") });
  const ds = (n: number): string => n === 1 ? "1 day" : n + " days";
  if (!l.own) return R("red", "no owner");
  if (!P(ctx.PEOPLE, l.own).on) return R("red", "owner has left");    /* the owner has left — this needs a person */
  /* out with nobody on it at all. A named secondary IS the cover — secondaryMayWork hands them
     the lead the moment the owner is out — so a lead with one is slipping, not breached. */
  if (!avail(ctx, l.own) && !covOf(ctx, l) && !secOK(ctx, l) && l.done < ST.RESERVED) return R("red", "owner out, nobody covering");
  if (l.done >= ST.RESERVED) {
    /* the manual's red band includes an unresolved cash gate — a lapsed hold is exactly that */
    const p = payOf(ctx, l.id);
    const hd = p && p.hold ? when(p.hold, ctx.NOW) : null;
    const hdd = hd ? Math.round((hd.getTime() - ctx.NOW.getTime()) / DAY) : null;
    if (hd && hd < ctx.NOW && l.done < ST.PAID) return R("red", hdd! < 0 ? "hold lapsed " + ds(-hdd!) + " ago" : "hold lapsed");
    if ((nxLate(l, ctx.NOW) as number) > 0) return R("amber", (nxLate(l, ctx.NOW) as number) >= 24
      ? "next step " + ds(Math.floor((nxLate(l, ctx.NOW) as number) / 24)) + " overdue" : "next step overdue");
    if (hd && (hd.getTime() - ctx.NOW.getTime()) / DAY <= 3 && l.done < ST.PAID)
      return R("amber", hdd! <= 0 ? "hold ends today" : "hold ends in " + ds(hdd!));
    return R("green");
  }
  /* how late, and late at WHAT: a dated step that has passed, a record that owes a next step and
     has not got one, or a lead nobody has touched. lateOf measures all three, so the wording has
     to come off the same question it measured. */
  const n = lateOf(l, ctx.NOW);
  const slip = hasNext(l) ? "next step " + ds(n) + " overdue"
    : noNext(l) ? "no next step for " + ds(n)
    : "no touch for " + ds(n);
  if (n >= 3) return R("red", slip);
  if (n > 0) return R("amber", slip);
  if (covOf(ctx, l)) return R("amber", "owner out — " + P(ctx.PEOPLE, acting(ctx, l)).n + " covering");
  if (!avail(ctx, l.own)) {
    const to = outTo(ctx, l.own);          /* a roster with no date reads "—" — do not print it */
    return R("amber", to && to !== "—" ? "owner out until " + to : "owner out");
  }
  return R("green");
}

export function rag(ctx: Ctx, l: Lead): Rag { return ragOf(ctx, l).c; }

/* ===== PHONE MASKING ======================================================================== */
export const canSee = (ctx: Ctx, l: Lead): boolean =>
  openable(ctx).some(x => x.id === l.id)
  && (["conv", "fin", "ops", "corp", "bu", "exec"].includes(roleOf(ctx.PEOPLE, me(ctx))!) || (["ir", "cp"].includes(roleOf(ctx.PEOPLE, me(ctx))!) && inBook(ctx, l)));
export const ph = (ctx: Ctx, l: Lead): string =>
  canSee(ctx, l) ? l.ph : l.ph.slice(0, 7) + " ••• •••";

/* ===== PAPERWORK, READ ======================================================================
   Which round is live, whose move it is, and how to say that in four words. Everything that
   mentions the paperwork — the door, the lead banner, the queue, Finance's day — reads this.
   ========================================================================================== */
export type PaperNow = {
  R: (typeof ROUNDS)[number] | null;
  n: ReturnType<typeof prNext>;
  mine: boolean;
  label: string;
  short: string;
  cls: string;
};

export function paperNow(ctx: Ctx, l: Lead): PaperNow {
  for (const R of ROUNDS) {
    const n = prNext(ctx, l, R.k);
    if (n.k === "done" || n.k === "wait" || n.k === "none") continue;
    const mine = !!(n.who && prMine(ctx, l, n.who));
    return {
      R, n, mine,
      label: (R.k === "nda" ? "NDA" : "Supplementary") + " — " + (n.who === "Finance" ? "with Finance" : "your move"),
      short: (R.k === "nda" ? "NDA" : "Supp") + " · " + (mine ? "yours" : n.who === "Finance" ? "Finance" : "the IR"),
      cls: mine ? "bad" : "",
    };
  }
  const all = ROUNDS.every(R => prDone(ctx, l.id, R.k));
  const lab = all ? "both signed" : suppOK(ctx, l) ? "supplementary signed"
    : ndaOK(ctx, l) ? "NDA signed" : "nothing out yet";
  return {
    R: null, n: { k: all ? "done" : "wait" } as ReturnType<typeof prNext>, mine: false, label: lab,
    short: all ? "both signed" : lab, cls: all || ndaOK(ctx, l) ? "" : "q",
  };
}

/* PRSTEP / irPaperStep(l) — ir-merged.js:3290. The IR's one paperwork step on this lead right now,
   or null — the "Your move · …" chip on Today and Documents (D61). */
export const PRSTEP: Record<string, string> = {
  told: "Tell them it's sent", said: "Chase the signature", draft: "Send the draft", agreed: "Get the final draft agreed",
};
export function irPaperStep(ctx: Ctx, l: Lead | null | undefined): { R: NonNullable<PaperNow["R"]>; k: string; t: string } | null {
  const pn = l ? paperNow(ctx, l) : null;
  const k = pn && pn.n && "k" in pn.n ? String(pn.n.k) : "";
  const who = pn && pn.n && "who" in pn.n ? (pn.n as { who?: string | null }).who : undefined;
  return pn && pn.R && who === "IR" && canWork(ctx, l) && PRSTEP[k] ? { R: pn.R, k, t: PRSTEP[k]! } : null;
}

/* ===== WHAT THIS LEAD NEEDS NEXT, in the person's own words ================================= */
export type Urg = "now" | "soon" | "ok";
export type NextRec =
  | { kind: "assign" }
  | { kind: "touch"; k: string }
  /* `r` names the round (`nda`/`supp`) when `nextUp` is reading a live paperwork beat; the
     wait-on-Finance branch for the allotment gate carries the kind with no round to name. */
  | { kind: "paper"; r?: string }
  | { kind: "consent" }
  | { kind: "followup" }
  | { kind: "plan" }
  | { kind: "claim" };
/** Which KIND of work a row is — a queue is sorted by eye before it is read, and every line
 *  `nextUp` returns carries one (ir-console-redesigned.html:6224-6226). */
export type NextKind =
  | "closed" | "owner" | "paper" | "consent" | "step" | "touch" | "wait" | "plan" | "money" | "stage";
export type NextUp = { t: string; act: string | null; urg: Urg; rec?: NextRec | null; kind: NextKind };

/* a wording classifier for the channel a free-text next step reads as, when nothing on the record
   says so directly (ir-console-redesigned.html:6195-6202). */
export function channelForAction(t: string | null | undefined): Channel | "other" {
  const s = String(t || "").toLowerCase();
  if (/\b(whats?app|wa|message|msg|sms)\b/.test(s)) return "msg";
  if (/\b(e[ -]?mail|mail)\b/.test(s)) return "email";
  if (/\b(call(?:[ -]?back)?|phone|dial)\b/.test(s)) return "call";
  if (/\b(visit|in[ -]person|office meeting|farm meeting)\b/.test(s) && !/\b(book|schedule|arrange)\b/.test(s)) return "visit";
  return "other";
}

/* the channel a dated next step is actually planned on — the record's own tag when it carries
   one and is still a touch channel, the wording otherwise */
function plannedChannel(l: Lead): Channel | "other" {
  if (!hasNext(l)) return "other";
  const ch = l.nx!.ch;
  return ch && (TOUCHCHANNELS as readonly string[]).includes(ch) ? (ch as Channel) : channelForAction(l.nx!.t);
}

/* which channel the next action needs — this is what Today filters on
   (ir-console-redesigned.html:6203-6208) */
export function chanOf(ctx: Ctx, l: Lead): string {
  const u = nextUp(ctx, l);
  /* B-25: a touch owed on a channel the lead gave no permission for is not offered as that channel */
  if (u.rec && u.rec.kind === "touch") return u.rec.k === "other" || conFor(l, u.rec.k as Channel) ? u.rec.k : "other";
  if (u.kind !== "step" || !hasNext(l)) return "other";
  const ch = plannedChannel(l);
  return ch === "other" || conFor(l, ch) ? ch : "other";
}

/* All open work stays visible, with dated tasks and first-touch deadlines kept in their own time
   group. A Finance gate is a wait only when there is no IR task due against it
   (ir-console-redesigned.html:6212-6222). Lives here, not in `features/today`, because it reads
   `nextUp`'s `kind` and `missingTouch`, which only this file has both halves of. */
export function workGroup(ctx: Ctx, l: Lead | null | undefined): "overdue" | "today" | "waiting" | "upcoming" {
  if (!l || lost(l) || l.done >= ST.ONBOARDED) return "upcoming";
  if (!l.own) return "today";
  const u = nextUp(ctx, l);
  if (u.kind === "consent") return "today";
  if (hasNext(l)) { const d = nxDue(l, ctx.NOW); if (d) return d === "ahead" ? "upcoming" : d; }
  const miss = missingTouch(ctx, l);
  if (miss) return miss.state === "overdue" ? "overdue" : miss.state === "today" ? "today" : "upcoming";
  if (u.kind === "wait") return "waiting";
  /* the "consent" kind returned above already, so `u.kind` can never be it here — dropped rather
     than kept as a no-op check TS treats as unreachable. */
  return u.urg === "now" && lateOf(l, ctx.NOW) > 0 ? "overdue" : "today";
}

/* how long a paper beat has been waiting is measured from the one in FRONT of it */
const PREVBEAT: Record<string, string | null> =
  { draft: null, agreed: "draft", sent: "agreed", told: "sent", said: "told", ok: "said" };

export function nextUp(ctx: Ctx, l: Lead): NextUp {
  const canonical = openable(ctx).find(x=>x.id === l.id);
  if (!canonical) return {t:"Lead unavailable",act:null,urg:"ok",kind:"closed"};
  l = canonical;
  const NOW = ctx.NOW;
  if (lost(l)) return { t: "Closed as lost — " + l.lost!.why, act: null, urg: "ok", kind: "closed" };
  if (!l.own) return {
    t: "No owner yet — added by " + P(ctx.PEOPLE, l.by).n,
    act: isIR(roleOf(ctx.PEOPLE, me(ctx))!) && !canAssign(ctx) ? "Assign to me" : canAssign(ctx) ? "Assign it" : null,
    rec: isIR(roleOf(ctx.PEOPLE, me(ctx))!) && !canAssign(ctx) ? { kind: "assign" } : null, urg: "now", kind: "owner",
  };
  if (l.done >= ST.ONBOARDED) return { t: "Onboarded — relationship live", act: null, urg: "ok", kind: "closed" };
  const s = LADDER[l.done] || LADDER[0];
  /* Paper somebody owes: it outranks hygiene, because a signature nobody is chasing is the
     commonest way a converted lead goes quiet. For Finance it outranks everything on the lead,
     since sending and verifying is the whole of their part before the money. */
  const pw = paperNow(ctx, l);
  /* Measuring from "sent" at a point before anything was sent is how every beat read as merely
     "soon" for ever. */
  const pwUp = (): NextUp => {
    const from = PREVBEAT[pw.n.k as string];
    const src = (from && prAt(ctx, l.id, pw.R!.k, from))
      || (l.at || [])[Math.max(0, pw.R!.from - 1)] || null;
    const stale = !!src && (dayGap(whenT(src, NOW), NOW) as number) >= 3;
    return {
      t: pw.R!.t + " — " + pw.n.t!.toLowerCase(),
      act: pw.n.who === "Finance" ? (pw.n.k === "sent" ? "Send it" : "Verify it") : "Open the paperwork",
      rec: { kind: "paper", r: pw.R!.k }, urg: stale ? "now" : "soon", kind: "paper",
    };
  };
  /* a hold with a forfeit on it outranks a signature: once money is in, Finance's day leads with
     the clock, and the paperwork card carries the rest */
  if (isFin(roleOf(ctx.PEOPLE, me(ctx))!) && pw.mine && !payOf(ctx, l.id)) return pwUp();
  /* no channel open at all — record contact permission before anything else can be asked for. A
     dated next step planned on a channel the investor has since withdrawn is its own case: the
     permission that is missing is the PLANNED one, not contact in general. */
  const allowed = anyConsent(l);
  const plannedCh = plannedChannel(l);
  if (!isFin(roleOf(ctx.PEOPLE, me(ctx))!) && (!allowed || (plannedCh !== "other" && !conFor(l, plannedCh))))
    return {
      t: !allowed ? "Contact permission needs to be recorded" : "The planned " + CHAN[plannedCh].toLowerCase() + " needs permission",
      act: "Record contact permission", rec: { kind: "consent" }, urg: "now", kind: "consent",
    };
  /* A dated promise outranks generic paperwork and stage guidance. Future callbacks stay in
     Upcoming, even if the investor's commercial stage also has an outstanding gate. */
  if (hasNext(l)) {
    const due = nxDue(l, NOW);
    return {
      t: l.nx!.t + (due === "overdue" ? " — was due " + nxWhen(l) : due === "today" ? " — today" + (nxTime(l) ? " at " + nxTime(l) : "") : " — due " + nxWhen(l)),
      act: "Record contact", rec: { kind: "followup" },
      urg: due === "overdue" ? "now" : due === "today" ? "soon" : "ok", kind: "step",
    };
  }
  /* the first-touch service levels, in order, on a channel the investor actually permits */
  const miss = missingTouch(ctx, l);
  if (miss)
    return {
      t: miss.t + " — due " + dISOtoDisp(dISO(miss.date), NOW), act: TOUCHDONE[miss.k], rec: { kind: "touch", k: miss.k },
      urg: miss.state === "overdue" ? "now" : miss.state === "today" ? "soon" : "ok", kind: "touch",
    };
  if (pw.mine && pw.n.who === "IR") return pwUp();
  const waiting = gateWait(ctx, l);
  if (waiting && waiting.who === "fin")
    return {
      t: (gateOf(l) === "alloc" ? "Documents" : "Payment") + " awaiting Finance — " + waiting.t,
      act: gateOf(l) === "alloc" ? "View documents" : "View payment",
      rec: gateOf(l) === "alloc" ? { kind: "paper" } : { kind: "claim" }, urg: "ok", kind: "wait",
    };
  if (noNext(l)) return { t: "Next step missing", act: "Set the next step", rec: { kind: "plan" }, urg: "now", kind: "plan" };
  /* the three rungs with a gate on them. The lead is still the IR's on every one — what the line
     says is whether the next move is theirs or a fact they are waiting on. */
  {
    const g = gateWait(ctx, l);
    if (g && g.who === "fin") return { t: "Waiting on Finance — " + g.t, act: "Open the record", urg: "soon", kind: "wait" };
    if (g && l.done === ST.CONVERTED) return { t: "Said yes — chase the ten per cent", act: "Open the record", urg: "now", kind: "money" };
    if (g && l.done === ST.RESERVED) return { t: "Chase the balance before the hold lapses", act: "Open the record", urg: "now", kind: "money" };
    if (g) return { t: "Paperwork before allotment", act: "Open the record", urg: "now", kind: "paper" };
    if (l.done === ST.CONVERTED) return { t: "Said yes — the ten per cent is what moves it", act: "Open the record", urg: "now", kind: "money" };
    if (l.done === ST.RESERVED) return { t: "Advance confirmed — record the reservation", act: "Open the record", urg: "now", kind: "stage" };
    if (l.done === ST.PAID) return { t: "Paid in full and confirmed — record it", act: "Open the record", urg: "now", kind: "stage" };
    if (l.done === ST.ALLOCATED) return { t: "Allocated — onboard them", act: "Open the record", urg: "now", kind: "stage" };
  }
  if (hasNext(l)) return { t: l.nx!.t, act: "Open the record", urg: "ok", kind: "step" };
  return { t: s.t, act: "Open the record", urg: "ok", kind: "stage" };
}


/* ===== THE QUEUE ============================================================================
   one source for the queue, so the sidebar count and the list can never disagree.
   Today is personal for every seat that carries a book; the team scope is the same list, wider.
   ========================================================================================== */
export function todayList(ctx: Ctx, sc?: "mine" | "team"): Lead[] {
  if (!may(ctx, "today", "view")) return [];
  const s: "mine" | "team" = seesTeam(ctx) ? (sc || scopeOf(ctx, "today")) : "mine";
  const base = (
    s === "team"
      ? teamBook(ctx)
      : isFin(roleOf(ctx.PEOPLE, me(ctx))!)
      ? visible(ctx).filter(l => {
          if (l.done >= ST.ONBOARDED) return false;
          if (payOf(ctx, l.id)) return true;               /* money keeps it on the day */
          const w = paperNow(ctx, l);                      /* paper has its own card */
          return !(w.mine && w.n.who === "Finance");
        })
      : myWork(ctx)
  ).filter(l => !lost(l) && l.done < ST.ONBOARDED && !!l.own);   /* closed is closed; unowned leads are the Leads page's (merged todayList) */

  const ids = new Set(openable(ctx).map(l => l.id));
  const unique = [...new Map(base.filter(l => ids.has(l.id)).map(l => [l.id, l] as const)).values()];

  const mins = (l: Lead): number => {
    const t = nxTime(l);
    if (!t) return 24 * 60;
    const m = /^(\d{1,2}):(\d{2})$/.exec(t);
    return m ? (+m[1]) * 60 + (+m[2]) : 24 * 60;
  };
  const g: Record<string, number> = { overdue: 0, today: 1, waiting: 2, upcoming: 3 };
  return unique.sort((a, b) => {
    const ad = nxDate(a, ctx.NOW) || missingTouch(ctx, a)?.date || null;
    const bd = nxDate(b, ctx.NOW) || missingTouch(ctx, b)?.date || null;
    return g[workGroup(ctx, a)] - g[workGroup(ctx, b)] || lateOf(b, ctx.NOW) - lateOf(a, ctx.NOW)
      || (ad && bd ? ad.getTime() - bd.getTime() : 0) || mins(a) - mins(b);
  });
}

/* each scope answers with the number that would make you open it — off the same list the screen
   draws, so the badge and the queue can never disagree. ONE QUESTION PER BADGE, in both scopes
   (ir-console-redesigned.html:12945-12958). */
export function scopeCount(ctx: Ctx, v: string, sc: "mine" | "team"): number {
  if (!may(ctx, v, "view")) return 0;
  const s: "mine" | "team" = seesTeam(ctx) ? sc : "mine";
  if (v === "today") return todayList(ctx, s).filter(l => nextUp(ctx, l).urg !== "ok").length;
  return (s === "team" ? teamBook(ctx) : visible(ctx)).filter(l => !l.own).length;
}

/* ===== THE DOORS ============================================================================
   The lead page shows the two things it is opened for and makes everything else a labelled door;
   the count is on the door, so you can see whether it is worth opening without opening it.

   The prototype's `leadDoors` returned the markup for that row. Only the DATA is here — the row of
   `<button class="door">`s is `src/features/lead/**`'s (PORT-GUIDE: innerHTML becomes JSX).
   ========================================================================================== */
export type Door = { k: string; t: string; v: string | number; cls: string };

export function leadDoors(ctx: Ctx, l: Lead, packWeeks: number): Door[] {
  const canonical = openable(ctx).find(x=>x.id === l.id);
  if (!canonical) return [];
  l = canonical;
  const sent = (ctx.SENT || {})[l.id] || {};
  const nSent = SENDABLE.filter(d => (sent as Record<string, string>)[d]).length;
  const nNotes = ((ctx.NOTES || {})[l.id] || []).length;
  const nLog = ctx.LOG.filter(e => e.lead === l.id && logReadable(ctx, e)).length;
  const p = financePaySummary(ctx,l), c = (ctx.CALLS || {})[l.id];
  const D: Door[] = [];
  const add = (k: string, t: string, v: string | number, cls?: string) => D.push({ k, t, v, cls: cls || "" });

  if (canViewInvestorCopy(ctx,l)) add("investorcopy", "Investor copy", ctx.INVESTORCOPY?.[l.id] ? "local copy recorded" : "not recorded locally", ctx.INVESTORCOPY?.[l.id] ? "" : "q");
  add("history", "History", nLog || "none", nLog ? "" : "q");
  add("notes", "Notes", nNotes || "none", nNotes ? "" : "q");
  add("material", "Material sent", nSent + " of " + SENDABLE.length, nSent ? "" : "q");
  if (canReadFinance(ctx, l, "docs")) { const docs = financeDocuments(ctx,l); add("paper", "Paperwork", `${docs.length} documents`, docs.length ? "" : "q"); }
  const acct = financeAccountId(ctx,l);
  if (acct && (canReadFinance(ctx,l,"pay") || canReadFinance(ctx,l,"docs"))) add("acct", "Growize account", acct, "");
  else if (seeMoney(ctx, l) && p) add("acct", "Growize account", "the link has not delivered it", "bad");
  if (l.src === "Events")
    add("pack", "Produce pack", ((ctx.PACK || {})[l.id] || 0) + " of " + packWeeks,
      ((ctx.PACK || {})[l.id] || 0) ? "" : "q");
  if (l.done >= ST.TOUCH && l.done < ST.RESERVED)
    add("call", "Last call", c && c.o ? c.o : "not recorded", c && c.o ? "" : "q");
  if (seeMoney(ctx, l))
    add("money", "Payment history", p ? (p.state === "full" ? "paid in full" : money(p.got)) : "nothing in", p ? "" : "q");
  if (inReservation(ctx, l)) {
    /* the reservation clock reads the raw store record, exactly as the prototype's `PAY[l.id]`
       does — not `financePaySummary`, which is null for a seat that cannot read Finance at all
       (ir-console-redesigned.html:7592). */
    const d = Math.round(((when(payOf(ctx, l.id)!.hold, ctx.NOW) as Date).getTime() - ctx.NOW.getTime()) / DAY);
    add("hold", "Reservation clock", d < 0 ? (-d) + "d over" : d + " days left", d <= 3 ? "bad" : "");
  }
  if (l.own)
    add("owner", "Owners", P(ctx.PEOPLE, l.own).i
      + (l.sec ? " / " + P(ctx.PEOPLE, l.sec).i : "")
      + (covOf(ctx, l) ? " · " + P(ctx.PEOPLE, acting(ctx, l)).i : ""));
  const cm = claimOf(ctx, l.id);
  if (seeMoney(ctx, l) && cm && cm.state === "waiting") add("claim", "Payment reported", P(ctx.PEOPLE, cm.by).i + " · " + cm.mode, "bad");
  else if (seeMoney(ctx, l) && cm && cm.state === "notfound") add("claim", "Payment reported", "not found yet", "bad");
  else if (canClaim(ctx, l)) add("claim", "Investor says they paid", "tell Finance", "q");
  if (lost(l)) add("lost", "Outcome", "lost — " + l.lost!.why, "bad");
  else if (canLose(ctx, l)) add("lost", "Outcome", "open", "q");
  add("details", "Details", "source, city, consent", "q");
  return D;
}


/* Losing one is the IR's call while they hold it. Once money is in it is not a loss, it is a
   refund or a forfeit — a different conversation, with Finance in it. Confirmed money blocks
   Lost even before the IR has ticked the Reserved rung — the stage can lag the bank by a beat,
   and Lost must not be a way past a receipt that has not yet been reflected on the ladder. */
export const canLose = (ctx: Ctx, l: Lead | null | undefined): boolean => {
  if (!l || !l.own || lost(l) || l.done >= ST.RESERVED) return false;
  const p = payOf(ctx, l.id);
  if (p && (Number(p.got) > 0 || (["part", "full"] as PayRec["state"][]).includes(p.state))) return false;
  return canEdit(ctx, l);
};

/* re-opening is the one write a closed lead still accepts, so it cannot ask canEdit — which now
   refuses everything on a closed lead, that being the point */
export const canReopen = (ctx: Ctx, l: Lead | null | undefined): boolean =>
  !!l && openable(ctx).some(x => x.id === l.id)
  && lost(l) && may(ctx, "leads", "edit") && custodian(l) === "IR"
  && (inBookOf(ctx, l) || ["conv", "ops"].includes(roleOf(ctx.PEOPLE, me(ctx))!));

/* Change 4 — a seat that cannot re-open a closed lead is told who can, the same discipline
   `whyLocked` already holds to for a locked one: never just a missing button. */
export const reopenHandoff = (ctx: Ctx, l: Lead | null | undefined): string | null =>
  !l || !lost(l) || canReopen(ctx, l) ? null
    /* a Conversion or Ops reader blocked here lacks the Leads edit right; naming their own seat
       as one that can re-open would tell them the opposite of what just happened */
    : ["conv", "ops"].includes(roleOf(ctx.PEOPLE, me(ctx)) ?? "")
      ? (l.own ? `Your seat cannot edit Leads, so ${P(ctx.PEOPLE, l.own).n} needs to re-open this.`
        : "Your seat cannot edit Leads, so it cannot re-open this.")
    : l.own ? `Only ${P(ctx.PEOPLE, l.own).n}, or Conversion or Ops, can re-open this.`
    : "Only Conversion or Ops can re-open this — it has no owner.";

/* The one reset every route into Leads applies before its own cut — clearLeadFilters, toLeads
   and the Numbers jump all spread this, so a filter added later cannot survive one path only. */
export const CLEARED_LEAD_FILTERS = {
  LQ: "", LFILT: null, LSRC: null, LSTAGE: null, LSTAGEMODE: "at", LOWN: null, LQUIET: null,
  LLOST: false,
} as const;

/* Seeing a lead and writing on it are different rights. */
export const canNote = (ctx: Ctx, l: Lead | null | undefined): boolean =>
  canOperateLeads(ctx) && !!l && openable(ctx).some(x => x.id === l.id)
  && !!(canEdit(ctx, l) || named(ctx, l) || canAssign(ctx)
    || (isFin(roleOf(ctx.PEOPLE, me(ctx))!) && (l.done >= ST.CONVERTED || !!payOf(ctx, l.id))));

/* Only the owner of record may ask for a move. */
export const canAskMove = (ctx: Ctx, l: Lead | null | undefined): boolean =>
  !!l && !!l.own && custodian(l) !== "Closed" && l.own === me(ctx) && !canAssign(ctx);

export const canAskExt = (ctx: Ctx, l: Lead | null | undefined): boolean =>
  !!l && openable(ctx).some(x => x.id === l.id)
  && custodian(l) !== "Closed" && (inBookOf(ctx, l) || canAssign(ctx) || isFin(roleOf(ctx.PEOPLE, me(ctx))!));

export const movesWaiting = (ctx: Ctx): Lead[] =>
  openable(ctx).filter(l => {
    const r = (ctx.REQ || {})[l.id];
    return !!r && r.state === "waiting" && canDecideMove(ctx, l);
  });


/* ===== SEARCH ===============================================================================
   One box, and it looks in everything somebody might remember — the name, a few digits of the
   phone, the city, the owner, the event, the stage — and every filter composes with every other.
   ========================================================================================== */
export const digits = (s: unknown): string => String(s == null ? "" : s).replace(/\D/g, "");
export const numeric = (t: string): boolean => /^[\d\s+\-()]+$/.test(t);

/* what a lead can be found by. The phone joins in only when this seat may see it — a masked number
   must not be confirmable by searching for it. */
export function hay(ctx: Ctx, l: Lead): string {
  const canonical = openable(ctx).find(x=>x.id === l.id);
  if (!canonical) return "";
  l = canonical;
  const e = l.ev ? ctx.EVENTS.find(x => x.id === l.ev) : null;
  const c = fcOf(l);
  return [
    l.id, l.n, canSee(ctx, l) && l.em, l.city, sourceLabel(ctx, l), e && e.n, e && e.id,
    l.own && P(ctx.PEOPLE, l.own).n, l.own && P(ctx.PEOPLE, l.own).i,
    l.sec && P(ctx.PEOPLE, l.sec).n, l.sec && P(ctx.PEOPLE, l.sec).i,
    LADDER[Math.max(0, l.done - 1)].t, l.nx && l.nx.t,
    c && (FCAT as Record<string, { t: string }>)[c].t,
    l.nri ? "nri" : "",
    l.own && acting(ctx, l) !== l.own ? P(ctx.PEOPLE, acting(ctx, l)).n : "",
    !l.own ? "unassigned no owner" : "",
    RAGT[rag(ctx, l)],
  ].filter(Boolean).map(norm).join(" · ");
}

export function matches(ctx: Ctx, l: Lead, q: string): boolean {
  if (!openable(ctx).some(x=>x.id === l.id)) return false;
  const query = norm(q).trim();
  if (!query) return true;
  const h = hay(ctx, l), d = canSee(ctx, l) ? digits(l.ph) : "";
  /* a number pasted as displayed ("+91 93105 99705") is one test against the phone, not three tokens */
  if (numeric(query)) return h.includes(query) || (digits(query).length >= 3 && d.includes(digits(query)));
  /* otherwise every token must land somewhere; only a numeric token may land in the phone, so
     "E-04" does not hit every number with 04 in it */
  return query.split(/\s+/).filter(Boolean)
    .every(t => h.includes(t) || (numeric(t) && digits(t).length >= 3 && d.includes(digits(t))));
}

/* the match, shown: split on the tokens, mark the hits.
   The prototype returned an HTML string built with `esc()` and `<mark>`; PORT-GUIDE forbids
   dangerouslySetInnerHTML, so this returns ReactNode — React does the escaping. */
export function hl(s: unknown, q: string): ReactNode[] {
  const str = String(s == null ? "" : s);
  const query = norm(q).trim();
  if (!query) return [str];
  const toks = [...new Set(query.split(/\s+/).filter(Boolean))]
    .sort((a, b) => b.length - a.length)
    .map(x => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp("(" + toks.join("|") + ")", "gi");
  return str.split(re).map((p, i) => (i % 2 ? createElement("mark", { key: i }, p) : p));
}

/* Change 3 — dormant, derived off Primitive B, no new field on the record. A lead can be
   perfectly "on schedule" by every dated-next-step test and still be one nobody has actually
   heard from in three months; this is the hygiene rule for that gap. */
export const DORMANTAT = 90;
export const dormant = (ctx: Ctx, l: Lead | null | undefined): boolean => {
  if (!l || lost(l) || !l.own || l.done >= ST.CONVERTED) return false;
  const q = quietDays(ctx, l);
  return q != null && q >= DORMANTAT;
};

/* the exceptions a list can be cut to — the manual's hygiene rules, plus the two that go stale */
export type ExcKey = "nonext" | "overdue" | "cold" | "fcgap" | "consent" | "due" | "hold7" | "lost" | "dormant";
export const EXC: Record<ExcKey, [string, (ctx: Ctx, l: Lead) => boolean]> = {
  nonext:  ["No next action",          (_c, l) => noNext(l)],
  /* merged ir-merged.js:4809 — Today's rule: a dated next step decides; without one, a missed first touch */
  overdue: ["Overdue",                 (c, l) => { if (!active(l)) return false; const d = hasNext(l) && nxDue(l, c.NOW);
              return d ? d === "overdue" : missingTouch(c, l)?.state === "overdue"; }],
  cold:    ["Going cold",              (c, l) => cold(c, l, c.NOW)],
  fcgap:   ["Forecast with no date",   (c, l) => fcBad(l, c.NOW)],
  consent: ["Permission missing",      (_c, l) => active(l) && !anyConsent(l)],
  due:     ["Due today",               (c, l) => active(l) && nxDue(l, c.NOW) === "today"],
  hold7:   ["Hold ends in 7 days",     (c, l) => inReservation(c, l)
              && ((when(payOf(c, l.id)!.hold, c.NOW) as Date).getTime() - c.NOW.getTime()) / DAY <= 7],
  dormant: ["Dormant — no decision",   (c, l) => dormant(c, l)],
  lost:    ["Closed as lost",          (_c, l) => lost(l)],
};

/* Change 2 — the days-since-contact cuts, beside EXC. */
export const QUIET: readonly [number, string][] = [
  [14, "14 days +"], [30, "30 days +"], [90, "3 months +"], [180, "6 months +"],
];

export type LeadFilters = {
  LQ: string; LFILT: ExcKey | null; LSRC: string | null;
  LSTAGE: number | null; LOWN: PersonKey | null;
  /** "at" = on this rung; "from" = this rung or past it. A modifier on LSTAGE, not a filter of
      its own — it never counts in leadFilterOn/leadAdvancedCount. */
  LSTAGEMODE?: "at" | "from";
  /** "Include leads closed as lost" — ir-console-redesigned.html:7362-7366, 7383. A lost lead
      stays out of the list by default; this switch, like every other cut, gets to say so and be
      turned off again, rather than being true and invisible at the same time. */
  LLOST?: boolean;
  /** Not contacted for at least this many days — a key of QUIET, or null for "Any time". */
  LQUIET?: number | null;
};

/* passesNoLost() — ir-console-redesigned.html:7380. The four cuts and the search, without the
   lost gate — exported so a page can report how many the lost cut alone is holding back
   (lostHeld) without duplicating this contract locally. */
export const passesNoLost = (ctx: Ctx, l: Lead, f: LeadFilters): boolean =>
  (!f.LFILT || EXC[f.LFILT][1](ctx, l)) && (!f.LSRC || l.src === f.LSRC)
  && (!f.LSTAGE || (f.LSTAGEMODE === "from" ? stageAtLeast(l, f.LSTAGE) : l.done === f.LSTAGE))
  && (!f.LOWN || l.own === f.LOWN)
  && (!f.LQUIET || (quietDays(ctx, l) != null && (quietDays(ctx, l) as number) >= f.LQUIET))
  && matches(ctx, l, f.LQ);

/* A lost lead stays searchable for ever and stays out of the way by default. It is only in the list
   when somebody asks for it — by name, by the Closed-as-lost cut, by the stage it died on, by the
   quiet cut, or by the "include closed leads" switch itself. */
export const passes = (ctx: Ctx, l: Lead, f: LeadFilters): boolean =>
  passesNoLost(ctx, l, f)
  && (!lost(l) || !!f.LLOST || f.LFILT === "lost" || !!f.LSTAGE || !!f.LQUIET || !!f.LQ.trim());

export const leadFilterOn = (f: LeadFilters): boolean =>
  !!(f.LQ.trim() || f.LFILT || f.LSRC || f.LSTAGE || f.LOWN || f.LLOST || f.LQUIET);

/* Sorting. Urgency is the right default because the queue is the product, but a person working a
   backlog wants the oldest thing first and a person preparing a review wants the biggest.

   THE TABLE LIVES HERE, not in @/domain, and @/domain's `types.ts` says so: four of the six
   comparators read `nextUp`, `lateOf` and `whenT`, which are selectors. `t` is the label printed
   verbatim in the sort menu; `f` is the prototype's own comparator, curried on Ctx because it
   needs the clock and the book. `SortKey` and `LeadComparator` are @/domain's. */
export const SORTS: Record<SortKey, { t: string; f: (ctx: Ctx) => LeadComparator }> = {
  urgent: {
    t: "Most urgent first",
    f: c => (a, b) => ({ now: 0, soon: 1, ok: 2 } as Record<Urg, number>)[nextUp(c, a).urg]
      - ({ now: 0, soon: 1, ok: 2 } as Record<Urg, number>)[nextUp(c, b).urg]
      || lateOf(b, c.NOW) - lateOf(a, c.NOW),
  },
  oldest: {
    t: "Oldest first",
    f: c => (a, b) => (whenT(a.at[0], c.NOW)?.getTime() || 0) - (whenT(b.at[0], c.NOW)?.getTime() || 0),
  },
  newest: {
    t: "Newest first",
    f: c => (a, b) => (whenT(b.at[0], c.NOW)?.getTime() || 0) - (whenT(a.at[0], c.NOW)?.getTime() || 0),
  },
  stage: {
    t: "Furthest along",
    f: c => (a, b) => b.done - a.done
      || (whenT(a.at[0], c.NOW)?.getTime() || 0) - (whenT(b.at[0], c.NOW)?.getTime() || 0),
  },
  units: { t: "Biggest first", f: () => (a, b) => b.units - a.units || b.done - a.done },
  name:  { t: "Name, A to Z", f: () => (a, b) => String(a.n).localeCompare(String(b.n)) },
};

/* setSort(v) falls back to "urgent" for any key not on the list — 03-app.js:1339 */
export const sortOf = (ctx: Ctx, v: string): LeadComparator =>
  SORTS[(SORTS[v as SortKey] ? v : "urgent") as SortKey].f(ctx);

/* ===== THE GAP, MADE SMALL ==================================================================
   Two hundred and eight units through the plan's rates is roughly three thousand captures, and
   three thousand is a number nobody can act on — it only says how far behind everyone is.
   The fix is arithmetic, not a feature. Divide the remaining gap ONCE — by the weeks left, and by
   the people who capture — and what comes out is small enough to do before lunch.
   ========================================================================================== */
export const capturers = (ctx: Ctx): number =>
  Math.max(1, Object.keys(ctx.PEOPLE).filter(k => ctx.PEOPLE[k].on && roleOf(ctx.PEOPLE, k) === "ir").length);

export const weeksLeft = (ctx: Ctx): number => {
  const last = ctx.PLAN.periods[ctx.PLAN.periods.length - 1];
  const end = last ? dOf(last.to) : null;
  return end ? Math.max(1, Math.ceil((end.getTime() - ctx.NOW.getTime()) / (7 * DAY))) : 1;
};

export const weekStart = (NOW: Date): Date => {
  const d = new Date(NOW.getTime());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  d.setHours(0, 0, 0, 0);
  return d;
};

export const addedBy = (l: Lead): PersonKey | null => (l.by || l.own || null) as PersonKey | null;

/* Capture credit is for the capture. Closing a lead as lost on Wednesday must not delete the name
   that was entered on Monday, or the console penalises the exact behaviour the closed-lost reason
   exists to encourage. */
const weeklyActors = (ctx: Ctx, team: boolean): Set<PersonKey> =>
  new Set(team && seesTeam(ctx) && may(ctx, "activity", "others") ? supervisedActors(ctx) : [me(ctx)]);

function capturedInWeek(k: PersonKey, book: Lead[], upper: Date): number {
  const start = weekStart(upper);
  return book.filter(l => {
    const at = accessMoment(l.at[0], upper);
    return addedBy(l) === k && at && at >= start && at <= upper;
  }).length;
}

export const capturedBy = (ctx: Ctx, k: PersonKey): number => {
  if (!may(ctx, "today", "view") || !weeklyActors(ctx, true).has(k)) return 0;
  return capturedInWeek(k, openable(ctx), nowT(ctx.NOW));
};

/** Imported interaction rows can include visits and flags for automated messages. Only human
 *  recording events count as follow-ups; stage edits, replies and system sends do not. */
export function isHumanTouch(e: LogEntry | null | undefined): boolean {
  if (!e) return false;
  const row = e as LogEntry & { auto?: boolean; automated?: boolean; system?: boolean; origin?: string };
  return ["msg", "email", "call", "visit"].includes(row.kind) && !row.auto && !row.automated
    && !row.system && row.origin !== "system" && !["system", "sys"].includes(row.who);
}

export type WeeklyWorkSummary = { leadsAdded: number; followups: number; investorsContacted: number };

/** Work recorded from Monday through the console's current clock. A backdated contact saved
 *  today counts when it was recorded in LOG; its original contact time remains in lead.touch. */
export function weeklyWorkSummary(ctx: Ctx, team = false): WeeklyWorkSummary {
  const empty = { leadsAdded: 0, followups: 0, investorsContacted: 0 };
  if (!may(ctx, "today", "view")) return empty;
  const actors = weeklyActors(ctx, team), book = openable(ctx), ids = new Set(book.map(l => l.id));
  const upper = nowT(ctx.NOW), start = weekStart(upper);
  const rows = may(ctx, "activity", "view") ? ctx.LOG.filter(e => {
    if (!actors.has(e.who) || !e.lead || !ids.has(e.lead) || !isHumanTouch(e)) return false;
    const anchor = accessDay(e.d, upper), at = anchor ? accessMoment(e.at || e.d, anchor) : null;
    return at && at >= start && at <= upper;
  }) : [];
  return {
    leadsAdded: [...actors].reduce((n, k) => n + capturedInWeek(k, book, upper), 0),
    followups: rows.length,
    investorsContacted: new Set(rows.map(e => e.lead)).size,
  };
}

export type Gap = { unitsLeft: number; res: number; qual: number; cap: number };

/* what the whole plan still needs, run back up the funnel from units to names */
export function gapNow(ctx: Ctx): Gap {
  const T = planTotals(ctx.PLAN), r = ctx.PLAN.rates;
  const paid = ctx.LEADS.filter(l => l.done >= ST.PAID).reduce((a, l) => a + l.units, 0);
  /* the ladder is the only writer of `paid` now — `T.actual` no longer competes with it
     (ir-console-redesigned.html:7007). */
  const unitsLeft = Math.max(0, T.target - paid);
  const res = Math.ceil(unitsLeft / Math.max(1, r.res2paid) * 100);
  const qual = Math.ceil(res / Math.max(1, r.qual2res) * 100);
  const cap = Math.ceil(qual / Math.max(1, r.lead2qual) * 100);
  return { unitsLeft, res, qual, cap };
}


export type Quota = Gap & {
  weeks: number; people: number; inHand: number; need: number;
  teamWeek: number; perWeek: number;
};

/* the same gap, made personal: this week, this person, this many names */
export function quota(ctx: Ctx): Quota {
  const g = gapNow(ctx), w = weeksLeft(ctx), n = capturers(ctx);
  const inHand = ctx.LEADS.filter(l => !lost(l) && l.done > 0 && l.done < ST.RESERVED).length;
  const need = Math.max(0, g.cap - inHand);
  return {
    ...g, weeks: w, people: n, inHand, need,
    teamWeek: Math.ceil(need / w), perWeek: Math.ceil(need / w / n),
  };
}

/* the shortest route to a unit that is already in the book, and the reason it is short */
export function whyClose(ctx: Ctx, l: Lead): string {
  const NOW = ctx.NOW;
  if (l.done >= ST.RESERVED) return "money in — finish it";
  if (fcOf(l) === "commit") return "already said yes";
  if (noNext(l)) return "no next step — one field away from workable";
  if (!l.consent) return "consent missing — outbound is blocked";
  if (cold(ctx, l, NOW)) return sinceReply(ctx, l, NOW) + " touches with no reply — change the channel";
  if (l.reply) return "came back to you";
  if (fcOf(l) === "probable") return "forecast says probable";
  return LADDER[Math.max(0, l.done - 1)].t.toLowerCase() + " — next step is due";
}

export function closers(ctx: Ctx, book: Lead[], n: number | undefined): Lead[] {
  const NOW = ctx.NOW;
  const score = (l: Lead): number => {
    let x = l.done * 10;
    if (l.done >= ST.RESERVED) return 200 + l.done;
    if (fcOf(l) === "commit") x += 25; else if (fcOf(l) === "probable") x += 12;
    if (l.reply) x += 8;
    if (noNext(l)) x += 6;
    if (cold(ctx, l, NOW)) x -= 10;
    if (!l.consent) x -= 18;
    return x + Math.min(6, l.units);
  };
  return book.filter(l => !lost(l) && active(l)).map(l => ({ l, s: score(l) }))
    .sort((a, b) => b.s - a.s).slice(0, n || 4).map(x => x.l);
}

/* ===== THE HORIZON ==========================================================================
   A queue answers "what now". It cannot answer "I am out from the 25th, what moves?" — so the same
   book is readable forward, day by day, with the roster laid over it.
   ========================================================================================== */
export type DueRow = { l: Lead; kind: "next" | "hold" | "fc"; t: string };

/* everything dated on a given day, from whichever record carries the date */
export function dueOn(ctx: Ctx, book: Lead[], d: Date): DueRow[] {
  const key = dISO(d), out: DueRow[] = [];
  book.forEach(l => {
    const nd = nxDate(l, ctx.NOW);
    if (hasNext(l) && nd && dISO(nd) === key) out.push({ l, kind: "next", t: l.nx!.t });
    const p = payOf(ctx, l.id);
    const hd = p && p.hold ? when(p.hold, ctx.NOW) : null;
    if (p && p.hold && hd && dISO(hd) === key && l.done < ST.PAID)
      out.push({
        l, kind: "hold",
        t: "Balance due — " + l.units + " unit" + (l.units > 1 ? "s" : "") + " and ₹"
          + (FORFEIT * l.units).toLocaleString("en-IN") + " at risk",
      });
    const fd = fcDate(l, ctx.NOW), c = fcOf(l);
    if (fd && dISO(fd) === key && c && c !== "pipeline" && l.done < ST.PAID)
      out.push({ l, kind: "fc", t: (FCAT as Record<string, { t: string }>)[c].t + " — full payment expected" });
  });
  const ord: Record<string, number> = { hold: 0, next: 1, fc: 2 };
  return out.sort((a, b) => ord[a.kind] - ord[b.kind]);
}

/* who on this book is rostered out that day — the reason the whole view exists */
export function outOn(ctx: Ctx, book: Lead[], d: Date): PersonKey[] {
  const key = dISO(d), who = new Set<PersonKey>();
  book.forEach(l => {
    if (!l.own) return;
    const o = absRec(ctx, l.own);
    if (!o) return;
    const a = absFrom(ctx, l.own), b = absTo(ctx, l.own);
    if (o.perm || (a && b && key >= dISO(a) && key < dISO(b))) who.add(l.own);
  });
  return [...who];
}
