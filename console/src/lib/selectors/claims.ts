/* ── selectors/claims.ts — "the investor says they have paid" ───────────────────────────────
   Ports `ref/03-app.js` lines 1550–1630. The writes — `claimPaid`, `confirmClaim`, `rejectClaim`,
   `reopenClaim` — are the store's; every check they make, and everything the block on the lead
   reads, is here.

   A claim is not a payment. The IR hears "I sent it on Friday", and the honest thing to do with
   that is to record it AS a claim, hand it to Finance to find in the account, and let the investor's
   own contact answer them without asking anybody. Finance's answer comes back to the lead.
   ────────────────────────────────────────────────────────────────────────────────────────── */

import { CLAIMARCHIVE as CLAIMARCHIVE0, CLAIMKINDS, CLAIMMODES, ST, UNIT } from "@/domain";
import { CLAIM as CLAIM0 } from "@/domain";
import type { Claim, Lead, LeadId, PayReceipt } from "@/domain";
import { dISO, dISOtoDisp, money } from "@/lib/format";
import type { Ctx } from "./ctx";
import { canAssign, canOperateLeads, isFin, may, roleOf, seeMoney } from "./access";
import { lost, named, openable, payOf } from "./leads";
import { suppOK } from "./paper";

export const claimOf = (ctx: Ctx, id: LeadId): Claim | null => (ctx.CLAIM || CLAIM0)[id] || null;
export const claimArchiveOf = (ctx: Ctx, id: LeadId): Claim[] => (ctx.CLAIMARCHIVE || CLAIMARCHIVE0)[id] || [];

export const claimOpen = (ctx: Ctx, id: LeadId): boolean => {
  const c = claimOf(ctx, id);
  return !!c && c.state === "waiting";
};

export const claimsWaiting = (ctx: Ctx): Lead[] => openable(ctx).filter(l => claimOpen(ctx, l.id));

/* Who may report a payment at all — ir-console-redesigned.html:5427's `canReportPayment`. Named
   alone is "watching" — edit-revoked, so unable to change the record — so this asks for edit too,
   not merely a name on the lead. */
export const canReportPayment = (ctx: Ctx, l: Lead | null | undefined): boolean =>
  !!l && canOperateLeads(ctx) && openable(ctx).some(x => x.id === l.id) && !lost(l)
  && ((named(ctx, l) && may(ctx, "leads", "edit")) || canAssign(ctx));

/* the sentence that goes with a no, in the same shape every other refusal in this console uses —
   ir-console-redesigned.html:5417-5426 */
export function claimWhy(ctx: Ctx, l: Lead | null | undefined): string {
  if (!l) return "";
  if (lost(l)) return "This lead is closed as lost. Reopen it before reporting a payment.";
  if (l.done >= ST.PAID) return "Finance has already banked this one — there is nothing left to tell them.";
  if (l.done < ST.CONVERTED) return "The investor has not said yes yet, so there is no money to report.";
  if (!suppOK(ctx, l)) return "The supplementary agreement is not signed and verified yet.";
  if (!l.own) return "Nobody carries this lead, so there is nobody for Finance to answer.";
  const p = payOf(ctx, l.id);
  if (p && p.state === "full") return "Finance has already banked the whole of this one — the "
    + "receipt landed while this was open, which is the answer you were going to ask for.";
  if (claimOf(ctx, l.id)) return "Finance already has this one. What you told them is on the "
    + "record above, and they answer it there.";
  return "This is not yours to send — the lead's own owner reports money on it.";
}

/* the supplementary agreement has to be back before money is claimed against it, and a lead that
   is already fully paid has nothing left to claim */
export const canClaim = (ctx: Ctx, l: Lead | null | undefined): boolean => {
  if (!l || lost(l) || !l.own) return false;
  const p = payOf(ctx, l.id);
  return l.done >= ST.CONVERTED && l.done < ST.PAID && suppOK(ctx, l)
    && !claimOpen(ctx, l.id) && !(p && p.state === "full")
    && canReportPayment(ctx, l);
};

/* Finance answers a claim against the bank, in the Investor Management portal. Nobody else can. */
export const canAnswerClaim = (ctx: Ctx, id: LeadId): boolean =>
  isFin(ctx.ROLE) && may(ctx, "pay", "record")
  && openable(ctx).some(l => l.id === id) && claimOpen(ctx, id);

/* when Finance could not find it, the IR may ask them to look again */
export const canReopenClaim = (ctx: Ctx, l: Lead | null | undefined): boolean => {
  if (!l) return false;
  const c = claimOf(ctx, l.id);
  return !!c && c.state === "notfound" && canReportPayment(ctx, l);
};

/* once Finance has matched a report, the same lead may still owe more — starting a new one
   archives the confirmed report rather than overwriting it. */
export const canStartPaymentReport = (ctx: Ctx, l: Lead | null | undefined): boolean => {
  if (!l) return false;
  const c = claimOf(ctx, l.id);
  return !!c && c.state === "confirmed" && canClaim(ctx, l);
};

/* ---- the fields a payment-report draft owes before it may be sent ---------------------------- */
export type ClaimDraft = {
  kind: string; mode: string; amount: string | number; said_on: string; ref?: string; note?: string;
};

export function claimFieldsError(ctx: Ctx, d: ClaimDraft): string {
  if (!Object.hasOwn(CLAIMKINDS, d.kind)) return "Choose what the payment was for.";
  if (!(CLAIMMODES as readonly string[]).includes(d.mode)) return "Choose a payment method.";
  if (!/^\d+(?:\.\d{1,2})?$/.test(String(d.amount).trim()) || !Number.isFinite(Number(d.amount))
    || Number(d.amount) <= 0 || Number(d.amount) > 1e10)
    return "Enter the amount the investor reported, greater than zero, with at most two decimal places.";
  if (!d.said_on || d.said_on > dISO(ctx.NOW)) return "Choose the actual payment date, today or earlier.";
  const ref = String(d.ref || "").trim();
  if (ref && !/^[A-Za-z0-9\s/-]{3,64}$/.test(ref))
    return "Use 3–64 letters, numbers, spaces, slashes or hyphens for the reference, or leave it blank.";
  if (String(d.note || "").length > 1000) return "Keep the note within 1,000 characters.";
  return "";
}

/* what a report reads as, everywhere it is printed — the lead, the money drawer, Finance's day */
export function claimReportLabel(ctx: Ctx, c: Claim): string {
  return (CLAIMKINDS[c.kind] || "Payment") + " · "
    + (Number.isFinite(c.amount) ? money(c.amount) : "Amount not recorded") + " · "
    + (c.said_on ? dISOtoDisp(c.said_on, ctx.NOW) : "Payment date not recorded");
}

export type ReceiptMatch = { ok: boolean; why?: string } & Partial<PayReceipt>;

/* a report is answered by finding the ONE confirmed receipt it describes exactly — never a total,
   never a guess. ir-console-redesigned.html:5449-5459. */
export function claimReceiptMatch(ctx: Ctx, id: LeadId): ReceiptMatch {
  const c = claimOf(ctx, id), p = payOf(ctx, id);
  if (!c) return { ok: false, why: "No payment report is on this record." };
  if (!p || !(["part", "full"] as const).includes(p.state as "part" | "full"))
    return { ok: false, why: "No confirmed receipt is available yet. Finance records the bank receipt in the investor system first." };
  if (!Number.isFinite(c.amount) || !c.said_on)
    return { ok: false, why: "This older report has incomplete payment facts. Finance must review it before matching." };
  if (!Array.isArray(p.receipts) || !p.receipts.length)
    return { ok: false, why: "Only a payment total is available. Finance must provide the individual receipt amount and payment date before matching." };
  const norm = (v: unknown): string => String(v || "").replace(/\s/g, "").toUpperCase();
  const used = new Set(claimArchiveOf(ctx, id).map(x => x.receipt?.id).filter(Boolean));
  const matches = p.receipts.filter(r => r.id && !used.has(r.id) && r.confirmedBy
    && roleOf(ctx.PEOPLE, r.confirmedBy) === "fin" && r.confirmedAt && !r.reversed
    && (c.kind === "other" || r.kind === c.kind) && r.amount === c.amount && r.paidOn === c.said_on
    && r.mode === c.mode && (!c.ref || c.ref === "—" || norm(c.ref) === norm(r.ref)));
  if (matches.length !== 1)
    return {
      ok: false,
      why: matches.length > 1
        ? "More than one receipt matches. Finance must resolve the duplicate before answering this report."
        : "No individual receipt matches the reported amount, date, method and reference. Review the receipt in the investor system.",
    };
  return { ok: true, ...matches[0] };
}

/* what `record()` should be called with when Finance confirms a claim: an advance is an advance,
   and a "full" claim against a part-paid lead is the balance, not a second full payment */
export const claimRecordKind = (ctx: Ctx, id: LeadId): "advance" | "balance" | "full" | null => {
  const c = claimOf(ctx, id);
  if (!c) return null;
  const before = payOf(ctx, id);
  return c.kind === "advance" ? "advance" : (before && before.state === "part" ? "balance" : "full");
};

/* ---- the block, as facts --------------------------------------------------------------------
   one block, so the claim reads identically on the lead, in the money drawer and on Finance's day.
   The prototype's `claimBlock(l)` returned the markup; this is the half of it that is a reading of
   the record. The `<div class="note">` is `src/features/lead/**`'s. */
export type ClaimBlock = {
  c: Claim;
  amt: string;              /* the reported amount, already in ₹L / ₹Cr */
  label: string;            /* the full "Balance · ₹22.5L · 27 Aug" line — claimReportLabel */
  advance: boolean;
  waiting: boolean;
  match: ReceiptMatch;
  answerable: boolean;      /* Finance may confirm it or say it is not there */
  reopenable: boolean;      /* the IR may ask Finance to look again */
  tone: "due" | "";         /* the prototype's `note ${c.state==="notfound"?"due":""}` */
};

export function claimBlock(ctx: Ctx, l: Lead, actions = true): ClaimBlock | null {
  if (!seeMoney(ctx, l)) return null;
  const c = claimOf(ctx, l.id);
  if (!c) return null;
  const advance = c.kind === "advance";
  /* a report the store has not yet built with the redesign's amount/said_on falls back to the
     old 10%-or-whole-ticket guess so an in-flight fixture never crashes the block. */
  return {
    c, advance, label: claimReportLabel(ctx, c), match: claimReceiptMatch(ctx, l.id),
    amt: Number.isFinite(c.amount) ? money(c.amount)
      : advance ? money(Math.round(l.units * UNIT * 0.1)) : money(l.units * UNIT),
    waiting: c.state === "waiting",
    answerable: actions && canAnswerClaim(ctx, l.id),
    reopenable: actions && canReopenClaim(ctx, l),
    /* ir-console-redesigned.html:5514's `claimBlock`: `note ${c.state==="notfound"?"due":""}` —
       waiting carries no tone at all, "due" is notfound's alone. */
    tone: c.state === "notfound" ? "due" : "",
  };
}
