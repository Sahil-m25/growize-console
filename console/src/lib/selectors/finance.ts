import type { FinanceAccount } from "@/lib/data/types";
import type { Lead, PayRec } from "@/domain";
import { maskRef } from "@/lib/format";
import type { Ctx } from "./ctx";
import { me } from "./ctx";
import { canReadFinance, financeBankReference, financeReference, roleOf, scopedFinanceReader, seeMoney } from "./access";
import { claimOf } from "./claims";
import { payOf } from "./leads";

type SourceAccount = FinanceAccount;
export type FinancePayment = Omit<SourceAccount["payments"][number], "id" | "on" | "recordedBy" | "recordedByName" | "reconciliation"> & {
  id: string | null; on: string | null; confirmedOn: string | null; recordedBy: string | null; recordedByName: string | null; reconciliation: string | null;
};
export type FinanceDocument = {
  id: string | null; title: string; class: string; state: string;
  sentOn: string | null; sentBy: string | null; sentByName: string | null;
  signatureMethod: string | null; signatureReference: string | null; completedOn: string | null;
  verifiedBy: string | null; verifiedByName: string | null; expiresOn: string | null; reason: string | null;
};
/* the Finance projection comes with the data (Dataset.FINMIRROR), never from a bundled file */
const accountOf = (ctx: Ctx, l: Lead) => (ctx.FINMIRROR?.accounts || []).find(a => a.leadId === l.id);

/* financeNote(l,note) — ir-console-redesigned.html:4279-4285. Every reference this account could
   quote — the legacy PAY total, the claim, every receipt's own reference — is masked wherever it
   turns up inside a free-form note, for every reader who sees the note at all (the note itself is
   withheld from ir/conv, above; masking here is never role-gated the way `financeReference` is). */
function financeNote(rawRefs: (string | null | undefined)[], note: string): string {
  let text = note;
  for (const ref of rawRefs) {
    if (!ref || ref === "—") continue;
    text = text.split(ref).join(maskRef(ref));
  }
  return text;
}

/** The bundled source projection is authoritative only for its explicit lead/account links. */
export function financePaymentHistory(ctx: Ctx, l: Lead): FinancePayment[] {
  if (!canReadFinance(ctx,l,"pay")) return [];
  const linked = accountOf(ctx, l), legacy = ctx.PAY?.[l.id];
  const rawRows: FinancePayment[] = linked ? linked.payments.map(p=>({...p,confirmedOn:null})) :
    (legacy?.receipts || []).map(r=>({id:r.id,kind:r.kind,amount:r.amount,mode:r.mode,reference:r.ref,on:r.paidOn,
      confirmedOn:r.confirmedAt,recordedBy:r.confirmedBy,recordedByName:ctx.PEOPLE[r.confirmedBy]?.n || r.confirmedBy,
      reconciliation:null,note:null}));
  /* D42/financePaymentHistoryBlock (ir-console-redesigned.html:8977-8985): the reference prints
     `maskRef(r.reference)` for every role, with no reveal in this drawer — `pay:<id>`'s own
     `refTxt`/`RefButton` are the Payments page's, not this one. The note stays IR/conv's own
     exclusion (never shown to them at all); everyone else who does see it reads every reference it
     quotes through the same `maskRef`, via `financeNote`, never `financeReference`'s Finance-only
     wording (that is for a signature, not a bank reference). */
  const scoped = ["ir","conv"].includes(roleOf(ctx.PEOPLE,ctx.WHO) || "");
  const claim = claimOf(ctx, l.id);
  const rawRefs = [legacy?.utr, claim?.ref, ...rawRows.map(r => r.reference)];
  return rawRows.map(r => ({...r,reference:maskRef(r.reference),
    note: scoped ? null : r.note ? financeNote(rawRefs, r.note) : r.note}));
}

export function financeDocuments(ctx: Ctx, l: Lead): FinanceDocument[] {
  if (!canReadFinance(ctx,l,"docs")) return [];
  const linked = accountOf(ctx, l);
  const rows: FinanceDocument[] = linked ? linked.documents : ctx.DOCS.filter(d => d.lead === l.id).map(d => ({
    id:d.id || null,title:d.t,class:d.cls,state:d.state,sentOn:d.sent || (d.state === "signed" ? null : d.on),sentBy:d.by || null,
    sentByName:d.by ? ctx.PEOPLE[d.by]?.n || d.by : null,signatureMethod:d.how,signatureReference:d.ref,
    completedOn:d.completedOn || (d.state === "signed" ? d.on : null),verifiedBy:d.verifiedBy || null,
    verifiedByName:d.verifiedBy ? ctx.PEOPLE[d.verifiedBy]?.n || d.verifiedBy : null,expiresOn:d.expiresOn || null,reason:d.reason || null,
  }));
  /* only a document that actually carries a signature reference gets one printed — `financeReference`
     turns a missing value into "—", which is truthy, so gating on the RAW value first (never on its
     "—" fallback) is what keeps the dt/dd row from rendering where the prototype has none at all. */
  return rows.map(d => ({...d,signatureReference:d.signatureReference ? financeReference(ctx,d.signatureReference) : null,
    reason:["ir","conv"].includes(roleOf(ctx.PEOPLE,ctx.WHO) || "") ? null : d.reason}));
}

export function financePaySummary(ctx: Ctx, l: Lead): PayRec | null {
  if (!canReadFinance(ctx,l,"pay")) return null;
  const linked = accountOf(ctx, l);
  if (!linked) {
    const old = ctx.PAY?.[l.id];
    if (!old) return null;
    const {receipts:_individualHistory,...summary} = old;
    return {...summary,utr:financeBankReference(ctx,old.utr)};
  }
  const payments = financePaymentHistory(ctx,l), last = payments[payments.length-1];
  if (!last) return null;
  const got = payments.reduce((total,p) => total + (["refund","forfeit"].includes(p.kind) ? 0 : p.amount),0);
  return {state:linked.holdEnds ? "part" : "full",got,mode:last.mode,utr:last.reference || "—",on:last.on || "—",hold:linked.holdEnds};
}

export const financeAccountId = (ctx: Ctx, l: Lead): string | null =>
  (canReadFinance(ctx,l,"pay") || canReadFinance(ctx,l,"docs")) ? accountOf(ctx, l)?.accountId || ctx.ACCT?.[l.id]?.code || null : null;

export const hasFinanceSource = (ctx: Ctx, l: Lead): boolean =>
  (canReadFinance(ctx,l,"pay") || canReadFinance(ctx,l,"docs")) && !!accountOf(ctx, l);

/* ===== A REFERENCE, COVERED BY DEFAULT ========================================================
   Rule 7: identity is not readable by opening a record. A bank reference prints its last four
   characters everywhere, until a reader who may see money at all explicitly asks to see the rest —
   and asking is itself logged (`showRef`, the store's). `k` is the record's address, never the
   value itself — `"pay:L6"`, `"claim:L6"`, `"xfer:L6"` — so no reference is ever carried through a
   click handler and the mask, the reading and the log line cannot drift apart
   (ir-console-redesigned.html:11453-11487). ========================================================================================== */

/** Which references exist to be asked about at all — the record has to hold one, and the asker has
 *  to already read Finance's history for it. Never a reason on its own to show the value. */
export function refAllowed(ctx: Ctx, k: string): boolean {
  const i = k.indexOf(":");
  if (i < 0) return false;
  const src = k.slice(0, i), id = k.slice(i + 1);
  if (src === "xfer") return (ctx.XFER || []).some(x => x.lead === id);
  if (src !== "pay" && src !== "claim") return false;
  const lead = ctx.LEADS.find(l => l.id === id);
  /* an explicit Finance source link is itself a receipt to ask about, same as `financePaySummary`
     preferring it over whatever a stale `ctx.PAY` entry says (Explicit Finance source links win). */
  return canReadFinance(ctx, lead, "pay") && !!(src === "claim" ? claimOf(ctx, id) : (ctx.PAY?.[id] || (lead && accountOf(ctx, lead))));
}

/** Whether THIS session has already asked and it is still this seat's own reading — `REFSEEN` is
 *  session-scoped and never carries past a sign-out, same as the prototype's own module global. */
export const refShown = (ctx: Ctx, k: string): boolean =>
  !!(ctx.REFSEEN?.[k]) && ctx.REFSEEN![k] === me(ctx) && !scopedFinanceReader(ctx) && seeMoney(ctx) && refAllowed(ctx, k);

/** The value itself — masked for a scoped Finance reader (D42: IR/Convener/Ops never see it
 *  unmasked here, whatever `REFSEEN` says) and `undefined` when it may not be asked about at all. */
export function refOf(ctx: Ctx, k: string): string | undefined {
  if (!refAllowed(ctx, k)) return undefined;
  const i = k.indexOf(":"), src = k.slice(0, i), id = k.slice(i + 1);
  const lead = src === "pay" ? ctx.LEADS.find(l => l.id === id) : undefined;
  const linked = lead && accountOf(ctx, lead);
  const value = src === "claim" ? claimOf(ctx, id)?.ref
    : src === "xfer" ? (ctx.XFER || []).find(x => x.lead === id)?.utr
    /* the explicit Finance source link, when there is one, wins over a stale `ctx.PAY` entry —
       the raw reference off the mirror's own last payment, unmasked here same as the legacy read,
       so the one `maskRef`/reveal step below is the only place either is ever covered. */
    : linked ? linked.payments[linked.payments.length - 1]?.reference : ctx.PAY?.[id]?.utr;
  return scopedFinanceReader(ctx) ? maskRef(value) : value;
}

/** What a screen prints — never more than the log says was asked for. */
export function refTxt(ctx: Ctx, k: string): string {
  const v = refOf(ctx, k);
  return refShown(ctx, k) ? (v == null || v === "" ? "—" : String(v)) : maskRef(v);
}
