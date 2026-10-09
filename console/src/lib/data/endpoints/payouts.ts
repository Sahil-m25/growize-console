/* M10-S20-W1 — monthly payouts (D82, D84): the Payments "due this month" queue, one allotment's Payouts tab, Mark paid
   and the schedule job.
     GET  /api/payouts                       { month, due, overdue, truncated }      (server/payouts/queue)
     GET  /api/payouts/allotments/[id]       { allotmentId, payouts: ScheduleLine[] }
     POST /api/payouts/[id]/paid             Idempotency-Key per press; { paidOn, mode, utr, tds, modifiedTime }
     POST /api/payouts/schedule              { allotmentIds, commit? } → { outcomes }  (creates the missing of the 60, never a duplicate)
   Live: the routes on the person's own token (Head of Finance / Finance Operations; the UTR comes back masked, "••••1234").
   Fixture: the demo book's PAYOUT records, the reducer's markPayoutPaid / schedulePayouts. */

import type { QueueLine, ScheduleLine } from "@/server/payouts/queue";
import type { PaidPayout } from "@/server/payouts/mark-paid";
import type { AllotmentOutcome } from "@/server/payouts/schedule";
import { I, PAYOUT_MONTHS, allotOf, llpOf, may, mayPayouts, payoutOf, payouts, payoutsDue, payoutsOf, thisMonth, who } from "@/lib/im";
import type { ImPayout } from "@/lib/im";
import { fail, ok, type ReadEndpoint, type WriteEndpoint } from "../api";
import { imFixtureWrite, imLiveError, type ImBook, type ImDispatch } from "./im";

const READ_ONLY = () => fail(403, "seat-denied", "Read only — payouts are Finance's.");
/** server/payouts/queue maskUtr: the bank reference is never returned whole */
const maskUtr = (v: string | null): string | null => (v && v.trim() ? "••••" + v.trim().slice(-4) : null);

const lineOf = (p: ImPayout) => ({
  id: p.id, ref: p.id, allotmentId: p.Allotment, kind: p.Payout_Kind, instalment: p.Instalment_No, month: p.Period_Month, dueOn: p.Due_On,
  gross: p.Gross_Amount, tds: p.TDS_Amount, net: p.Net_Amount, state: p.Payout_State,
});

/* ── the queue ─────────────────────────────────────────────────────────────────────────────── */
export type PayoutQueue = { month: string; due: QueueLine[]; overdue: QueueLine[]; truncated: boolean };

export const payoutQueue: ReadEndpoint<ImBook, void, PayoutQueue> = {
  path: () => "/api/payouts",
  pick: j => j as PayoutQueue,
  fixture({ s, me }) {
    if (!mayPayouts(s, me)) return READ_ONLY();
    const month = thisMonth(s.data.NOW);
    const queue = (p: ImPayout): QueueLine => {
      const a = allotOf(s, p.Allotment)!, x = I(s, me, a.Customer), l = llpOf(s, a.LLP_Lookup);
      return { ...lineOf(p), investor: { id: a.Customer, name: x ? x.n : null, code: a.Customer }, farm: { id: a.LLP_Lookup, name: l ? l.Name : null } };
    };
    const seen = (p: ImPayout) => { const a = allotOf(s, p.Allotment); return !!a && !!I(s, me, a.Customer); };
    return ok({
      month, truncated: false, due: payoutsDue(s, me).map(queue),
      overdue: payouts(s).filter(p => p.Payout_State === "Scheduled" && p.Due_On.slice(0, 7) < month && seen(p))
        .sort((x, y) => (x.Due_On < y.Due_On ? -1 : 1)).map(queue),
    });
  },
};

/* ── one allotment's schedule (the Payouts tab) and the Mark paid drawer ───────────────────── */
export type PayoutSchedule = { allotmentId: string; payouts: ScheduleLine[] };

export const payoutSchedule: ReadEndpoint<ImBook, string | null, PayoutSchedule> = {
  path: id => (id ? `/api/payouts/allotments/${encodeURIComponent(id)}` : null),
  pick: j => j as PayoutSchedule,
  fixture({ s, me }, id) {
    if (!id) return READ_ONLY();
    if (!mayPayouts(s, me)) return READ_ONLY();
    const a = allotOf(s, id);
    if (!a || !I(s, me, a.Customer)) return fail(403, "not-visible", "Read only — payouts are Finance's.");
    return ok({ allotmentId: id, payouts: payoutsOf(s, me, id).map((p): ScheduleLine => ({
      ...lineOf(p), paidOn: p.Paid_On, mode: p.Payout_Mode, utrMasked: maskUtr(p.Payout_UTR),
      paidBy: p.Paid_By ? { id: p.Paid_By, name: who(s, p.Paid_By).n } : null, modifiedTime: null,
    })) });
  },
};

/* ── Mark paid ─────────────────────────────────────────────────────────────────────────────── */
export type PaidArgs = { id: string; paidOn: string; mode: "NEFT" | "RTGS" | "IMPS" | "UPI"; utr: string; tds: number; modifiedTime: string | null };
export type Paid = Pick<PaidPayout, "payoutId" | "state" | "paidOn" | "mode" | "utrMasked" | "gross" | "tds" | "net" | "duplicate">;

export const payoutPaid: WriteEndpoint<ImBook, PaidArgs, Paid, ImDispatch> = {
  method: "POST",
  path: a => `/api/payouts/${encodeURIComponent(a.id)}/paid`,
  body: a => ({ paidOn: a.paidOn, mode: a.mode, utr: a.utr, tds: a.tds, ...(a.modifiedTime ? { modifiedTime: a.modifiedTime } : {}) }),
  idempotent: true,
  pick: j => (j as { payout: PaidPayout }).payout,
  fixture(b, d, a) {
    const p = payoutOf(b.s, a.id), gross = p ? p.Gross_Amount : 0;
    return imFixtureWrite(b, d, { type: "markPayoutPaid", id: a.id, paidOn: a.paidOn, mode: a.mode, utr: a.utr, tds: a.tds },
      { payoutId: a.id, state: "Paid" as const, paidOn: a.paidOn, mode: a.mode, utrMasked: maskUtr(a.utr.trim().toUpperCase()) ?? "", gross, tds: a.tds || 0, net: gross - (a.tds || 0), duplicate: false });
  },
  onLiveError: imLiveError,
};

/* ── the schedule job: the missing of an Issued allotment's 60 monthly payouts ─────────────── */
export type ScheduleArgs = { allotmentIds: string[]; commit?: boolean };
export type ScheduleRun = { outcomes: AllotmentOutcome[] };

export const payoutScheduleRun: WriteEndpoint<ImBook, ScheduleArgs, ScheduleRun, ImDispatch> = {
  method: "POST",
  path: () => "/api/payouts/schedule",
  body: a => ({ allotmentIds: a.allotmentIds, commit: a.commit !== false }),
  pick: j => j as ScheduleRun,
  fixture(b, d, a) {
    const { s, me } = b;
    if (!may(s, me, "pay")) return READ_ONLY();
    const outcomes = a.allotmentIds.map((id): AllotmentOutcome => {
      const al = allotOf(s, id);
      if (!al || !I(s, me, al.Customer)) return { allotmentId: id, status: "skipped", reason: "not-visible" };
      if (al.Allocation_Status !== "Issued") return { allotmentId: id, status: "skipped", reason: "not-issued" };
      if (!al.Issued_On) return { allotmentId: id, status: "skipped", reason: "no-issue-date" };
      const present = payouts(s).filter(p => p.Allotment === id).length;
      if (present >= PAYOUT_MONTHS) return { allotmentId: id, status: "complete", present, doubled: [] };
      return a.commit === false ? { allotmentId: id, status: "planned", wouldCreate: PAYOUT_MONTHS - present, present, doubled: [] }
        : { allotmentId: id, status: "created", created: PAYOUT_MONTHS - present, present, doubled: [] };
    });
    if (a.commit === false) return ok({ outcomes });
    return imFixtureWrite(b, d, { type: "schedulePayouts", ids: a.allotmentIds }, { outcomes });
  },
  onLiveError: imLiveError,
};
