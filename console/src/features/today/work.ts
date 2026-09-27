/* ── the daily work queue — local to Today. workGroups/workList, 03-app.js 6212–6229;
   financeTodayWork, 03-app.js ~6819. `workGroup` itself is the canonical selector from
   `@/lib/selectors` (selectors/leads.ts), which already carries the consent/wait/lateOf branches
   this file's own reimplementation used to be missing — re-exported here so every existing caller
   (`WORK_GROUPS`, `workList`, `TodayPage.tsx`) keeps importing it from `./work` unchanged. ─────── */

import { ST, TOUCHCHANNELS } from "@/domain";
import type { Channel, Claim, InteractionRec, Lead, PersonKey, XferRow } from "@/domain";
import { DAY, dISOtoDisp, money, when, whenT } from "@/lib/format";
import type { Ctx, NextUp } from "@/lib/selectors";
import {
  canViewInvestorCopy,
  canWork,
  chanOf,
  claimOf,
  claimOpen,
  conFor,
  inReservation,
  lost,
  may,
  openable,
  own,
  P,
  paperNow,
  payOf,
  roleOf,
  tList,
  todayList,
  workGroup,
} from "@/lib/selectors";
export { workGroup };

export type WorkGroupKey = "today" | "upcoming" | "waiting" | "all";

export const WORK_GROUPS: readonly { k: WorkGroupKey; t: string; accepts: readonly string[] }[] = [
  { k: "today", t: "Due now", accepts: ["overdue", "today"] },
  { k: "upcoming", t: "Upcoming", accepts: ["upcoming"] },
  { k: "waiting", t: "Waiting", accepts: ["waiting"] },
  { k: "all", t: "All open", accepts: ["overdue", "today", "upcoming", "waiting"] },
];

export function workList(ctx: Ctx, all: Lead[], group: WorkGroupKey, chan: string | null): Lead[] {
  const g = WORK_GROUPS.find((x) => x.k === group) || WORK_GROUPS[0]!;
  return all.filter((l) => g.accepts.includes(workGroup(ctx, l)) && (!chan || chanOf(ctx, l) === chan));
}

/* financeTodayWork() — 03-app.js:6819. Every open lead sorted once into exactly one of four
   Finance beats: a reported payment, paperwork Finance owes, a reservation clock, or everything
   else that is still open. */
export type FinanceWork = {
  book: Lead[];
  claims: Lead[];
  paper: { l: Lead; p: ReturnType<typeof paperNow> }[];
  holds: { l: Lead; left: number | null }[];
  other: Lead[];
};

export function financeTodayWork(ctx: Ctx): FinanceWork {
  const book = openable(ctx).filter((l) => !lost(l) && l.done < ST.ONBOARDED);
  const used = new Set<string>();

  const claims = book.filter((l) => claimOpen(ctx, l.id));
  claims.forEach((l) => used.add(l.id));

  const paper = book
    .map((l) => ({ l, p: paperNow(ctx, l) }))
    .filter((x) => !used.has(x.l.id) && x.p.mine && x.p.n.who === "Finance");
  paper.forEach((x) => used.add(x.l.id));

  const holds = book
    .filter((l) => !used.has(l.id) && inReservation(ctx, l))
    .map((l) => {
      const p = payOf(ctx, l.id);
      const date = p && p.hold ? when(p.hold, ctx.NOW) : null;
      return { l, left: date ? Math.round((date.getTime() - ctx.NOW.getTime()) / DAY) : null };
    })
    .sort((a, b) => (a.left ?? 1e9) - (b.left ?? 1e9));
  holds.forEach((x) => used.add(x.l.id));

  /* financeTodayWork's "other" — ir-console-redesigned.html:6819. The redesign reads this off
     `todayList()`, not off `book.filter(active)`: the two lists differ on an unowned lead (`active`
     needs an owner, `todayList` does not) and on scope (`todayList` follows the seat's own team
     setting; `active` does not filter by team at all). */
  const other = todayList(ctx).filter((l) => book.some((x) => x.id === l.id) && !used.has(l.id));
  return { book, claims, paper, holds, other };
}

/* xferRows()/xOwner() — ir-console-redesigned.html ~9170-9180, read by vFinanceToday's own
   "Investor entry status" disclosure (6829) as well as by the Investor copies screen. Kept local
   to Today (not `@/features/xfer`, whose own `xferRows()` is private to that module) because
   this is the one other caller — same filter, verbatim: a done transfer row is visible only when
   its lead is still open and reachable, or, for a lead that has already left the book, when the
   seat holds an explicitly granted (never borrowed) elevated transfer scope. */
export function xferRows(ctx: Ctx): XferRow[] {
  if (!may(ctx, "xfer", "view")) return [];
  const XFER = ctx.XFER ?? [];
  const ids = new Set(openable(ctx).map((l) => l.id));
  const history = ["exec", "ops", "corp", "bu"].includes(roleOf(ctx.PEOPLE, ctx.WHO) || "") && own(ctx, "xfer", "view");
  return XFER.filter(
    (x) =>
      x.state === "done" &&
      (ctx.LEADS.some((l) => l.id === x.lead)
        ? ids.has(x.lead) && canViewInvestorCopy(ctx, ctx.LEADS.find((l) => l.id === x.lead) as Lead)
        : history),
  );
}

/** the "transfer" Check's own owner (the dataset's `CHECKS`) — who an unacknowledged investor
 *  entry is chased to. 03-app.js:9170. null when no such check is recorded (the empty book). */
export function xOwner(ctx: { CHECKS: readonly { k: string; own: PersonKey }[] }): PersonKey | null {
  return ctx.CHECKS.find((c) => c.k === "transfer")?.own ?? null;
}

/* waNum() — 03-app.js:3373. Also below: partnerLabel/primaryWorkChannel (workRow/investorWorkPanel,
   6746/6781/6795) and the claim-report helpers Finance's day needs (claimReportLabel/
   claimReceiptMatch, 5448-5459) — kept local to Today because the shared claim selectors
   (`@/lib/selectors/claims.ts`) do not export them yet; see the hand-back's crossOwnerRequests. */
export function partnerLabel(ctx: Ctx, l: Lead): string {
  if (l.src !== "Channel partner") return "";
  return l.channelPartnerId ? P(ctx.PEOPLE, l.channelPartnerId).n : "Partner not recorded";
}

/* primaryWorkChannel(l,u) — 6746. The one channel a row or panel leads with when `nextUp` names a
   touch this seat may actually send on this lead — a number for call/msg, an email address for
   email, or (for visit, which has no address to check) simply permission to visit. */
export function primaryWorkChannel(ctx: Ctx, l: Lead, u: NextUp): Channel | null {
  if (!canWork(ctx, l) || !u.rec || !["touch", "followup"].includes(u.rec.kind)) return null;
  const ch = (u.rec.kind === "touch" ? u.rec.k : chanOf(ctx, l)) as Channel;
  if (!conFor(l, ch)) return null;
  if (ch === "visit") return ch;
  if (ch === "email") return l.em ? ch : null;
  if (ch === "call" || ch === "msg") return waNum(l.ph) ? ch : null;
  return null;
}

/* CLAIMKINDS — 5407, verbatim. */
const CLAIMKINDS: Record<string, string> = {
  advance: "Advance",
  balance: "Balance",
  full: "Full payment",
  other: "Other payment",
};

/* claimReportLabel(c) — 5448. */
export function claimReportLabel(ctx: Ctx, c: Claim): string {
  return (
    (CLAIMKINDS[c.kind] || "Payment") +
    " · " +
    (Number.isFinite(c.amount) ? money(c.amount) : "Amount not recorded") +
    " · " +
    (c.said_on ? dISOtoDisp(c.said_on, ctx.NOW) : "Payment date not recorded")
  );
}

export type ClaimMatch = { ok: boolean; why?: string };

/* claimReceiptMatch(id) — 5449. Whether the report on this lead lines up with exactly one
   confirmed, unreversed receipt Finance already holds — kind, amount, date, method and (when given)
   reference all agreeing. Approximated here without the prototype's CLAIMARCHIVE (which receipts a
   past match already used) — see the hand-back's crossOwnerRequests; a receipt that answered an
   earlier report on this lead could still be offered again. */
export function claimReceiptMatch(ctx: Ctx, id: string): ClaimMatch {
  const c = claimOf(ctx, id);
  const p = payOf(ctx, id);
  if (!c) return { ok: false, why: "No payment report is on this record." };
  if (!p || !["part", "full"].includes(p.state))
    return {
      ok: false,
      why: "No confirmed receipt is available yet. Finance records the bank receipt in the investor system first.",
    };
  if (!Number.isFinite(c.amount) || !c.said_on)
    return {
      ok: false,
      why: "This older report has incomplete payment facts. Finance must review it before matching.",
    };
  if (!p.receipts || !p.receipts.length)
    return {
      ok: false,
      why: "Only a payment total is available. Finance must provide the individual receipt amount and payment date before matching.",
    };
  const norm = (v: string) => String(v || "").replace(/\s/g, "").toUpperCase();
  const matches = p.receipts.filter(
    (r) =>
      !r.reversed &&
      (c.kind === "other" || r.kind === c.kind) &&
      r.amount === c.amount &&
      r.paidOn === c.said_on &&
      r.mode === c.mode &&
      (!c.ref || c.ref === "—" || norm(c.ref) === norm(r.ref)),
  );
  if (matches.length !== 1)
    return {
      ok: false,
      why:
        matches.length > 1
          ? "More than one receipt matches. Finance must resolve the duplicate before answering this report."
          : "No individual receipt matches the reported amount, date, method and reference. Review the receipt in the investor system.",
    };
  return { ok: true };
}

/* ---- followupContext(l) — 6057. The redesign's replacement for a raw log dump on the work panel:
   the last thing that happened, the last objection heard, the latest free-text note, and how they
   like to be reached. `INTERACTIONS`/`CALLS`/`NOTES` are read the same way `failedCallAttempts` and
   its neighbours in `@/lib/selectors/leads.ts` do — `ctx.X || X_SEED`. Kept local for the same
   reason as the claim helpers above. ---- */
export const FUCHANNELS: Record<string, string> = {
  call: "Call",
  msg: "WhatsApp",
  email: "Email",
  visit: "Visit",
  reply: "Inbound reply",
  other: "Task completed",
};

/* FUOUTCOMES — 03-app.js:5991, verbatim. What "outcome" options the followup drawer offers, per
   channel. */
export const FUOUTCOMES: Record<string, readonly string[]> = {
  call: ["Connected", "Interested", "Call back", "Not now", "Not interested", "No answer", "Wrong number"],
  msg: ["Message sent", "Reply received", "Interested", "Not now"],
  email: ["Email sent", "Reply received", "Interested", "Not now"],
  visit: ["Visit completed", "Interested", "Not now", "Not interested", "Investor unavailable"],
  reply: ["Reply received", "Interested", "Call back", "Not now", "Not interested"],
  other: ["Completed"],
};

export type FuEvent = { channel: string; outcome: string; at: string; who?: PersonKey; obj?: string[] };

const interactionsOf = (ctx: Ctx, l: Lead): InteractionRec[] =>
  (ctx.INTERACTIONS || {})[l.id] || [];

/* fuLatest(l) — 6047 */
export function fuLatest(ctx: Ctx, l: Lead): FuEvent | null {
  const a: FuEvent[] = [...interactionsOf(ctx, l)];
  const c = (ctx.CALLS || {})[l.id];
  if (c && c.o) a.push({ channel: "call", outcome: c.o, at: c.at || "", who: c.who, obj: c.obj || [] });
  TOUCHCHANNELS.forEach((k) =>
    tList(l, k).forEach((at) =>
      a.push({
        channel: k,
        at,
        who: l.own || undefined,
        outcome:
          k === "call" ? "Connected" : k === "msg" ? "Message sent" : k === "visit" ? "Visit completed" : "Email sent",
      }),
    ),
  );
  if (l.reply) a.push({ channel: "reply", outcome: "Reply received", at: l.reply, who: l.own || undefined });
  a.sort((x, y) => (whenT(y.at, ctx.NOW)?.getTime() || 0) - (whenT(x.at, ctx.NOW)?.getTime() || 0));
  return a[0] || null;
}

/* the last interaction that carries an objection worth surfacing as "Previously raised" — 6059.
   Reads the live `CALLS` record too, not only `INTERACTIONS` — a call outcome/objection toggled
   after the load-time seed (`toggleObj`) lands in `CALLS`, not in `INTERACTIONS`, which is seeded
   from `CALLS` only once at module load (`seedInteractions`, `src/domain/notes.ts`). */
export function fuHeard(ctx: Ctx, l: Lead): FuEvent | null {
  const a: FuEvent[] = [...interactionsOf(ctx, l)];
  const c = (ctx.CALLS || {})[l.id];
  if (c && c.o) a.push({ channel: "call", outcome: c.o, at: c.at || "", who: c.who, obj: c.obj || [] });
  return (
    a
      .filter((x) => x.obj && x.obj.length)
      .sort((a2, b) => (whenT(b.at, ctx.NOW)?.getTime() || 0) - (whenT(a2.at, ctx.NOW)?.getTime() || 0))[0] || null
  );
}

export const latestNote = (ctx: Ctx, l: Lead): string | null => (ctx.NOTES || {})[l.id]?.[0]?.t || null;

/* waNum() — 03-app.js:3373. The digits and only the digits, normalised to a WhatsApp-ready
   91-prefixed number; +91 98861 40277, 098861 40277 and 9886140277 are one person. */
export function waNum(ph: string): string {
  let d = String(ph || "").replace(/\D/g, "");
  if (d.length === 11 && d[0] === "0") d = d.slice(1);
  return d.length === 10 ? "91" + d : d;
}
