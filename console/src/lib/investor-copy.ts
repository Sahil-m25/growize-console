import { UNIT } from "@/domain";
import type { FinanceAccount } from "@/lib/data/types";
import type { InvestorCopy, Lead } from "@/domain";
import { accessMoment, nowT, pinAccessDate, stamp } from "./format";
import type { ConsoleState } from "./store";
import { canReadFinance, canViewInvestorCopy, own, roleOf } from "./selectors/access";
import { lost, openable } from "./selectors/leads";

type SourceAccount = FinanceAccount;
type SourcePayment = SourceAccount["payments"][number] & {reversed?: boolean};
/* the Finance projection arrives with the data (Dataset.FINMIRROR); its dates are pinned to the book's own clock */
const sourceOf = (state: Pick<ConsoleState,"FINMIRROR">): readonly SourceAccount[] => state.FINMIRROR?.accounts || [];
const actorsOf = (accounts: readonly SourceAccount[]) => new Set(accounts.flatMap(a=>(a?.payments || []).map(p=>p.recordedBy)));
const required = ["Non-disclosure agreement", "Supplementary agreement"];
export type CopyEligibility = { eligible: boolean; accountId: string | null; reason: string; receiptIds: string[]; documentIds: string[]; confirmed: number; requiredAdvance: number };
const waiting = (reason: string, accountId: string | null = null): CopyEligibility =>
  ({eligible:false,accountId,reason,receiptIds:[],documentIds:[],confirmed:0,requiredAdvance:0});

/** Reads only the trusted bundled source. UI claims, aggregates and ladder-derived paper are never evidence. */
function copyEvidence(state: Pick<ConsoleState,"LEADS"|"NOW"|"FINMIRROR">, lead: Lead, accounts: readonly SourceAccount[] = sourceOf(state)): CopyEligibility {
  const financeActors = actorsOf(accounts);
  const l = state.LEADS.find(x=>x.id === lead.id);
  if (!l) return waiting("Lead unavailable");
  if (!l.own || lost(l)) return waiting("Lead must be assigned and active");
  if (!Array.isArray(accounts)) return waiting("Waiting for a linked Finance source account");
  const matches: SourceAccount[] = accounts.filter(a=>a?.leadId === l.id), a = matches[0];
  if (matches.length !== 1 || !a || typeof a.accountId !== "string" || !/^ARL-INV-\d+$/.test(a.accountId)) return waiting("Waiting for a linked Finance source account");
  if (accounts.filter(x=>x?.accountId === a.accountId).length !== 1 || !Array.isArray(a.documents) || !Array.isArray(a.payments)) return waiting("Source account link needs review");
  if (!Number.isSafeInteger(l.units) || l.units <= 0 || !Number.isSafeInteger(a.units) || a.units <= 0 || l.units !== a.units
    || a.unitPrice !== UNIT) return waiting("Investment units need review",a.accountId);
  const total = Math.round(a.units * a.unitPrice * 100), advance = Math.round(total * 0.1);
  if (!Number.isSafeInteger(total) || !Number.isSafeInteger(advance) || advance <= 0) return waiting("Investment amount needs review",a.accountId);
  const at = (value: string | null) => {
    const date = typeof value === "string" && value && accessMoment(pinAccessDate(value,state.NOW),state.NOW);
    const end = new Date(state.NOW); end.setHours(23,59,59,999);
    return date && date <= end ? date : null;
  };
  const cents = (amount: number): number | null => {
    const rounded = Math.round(amount * 100);
    return Number.isFinite(amount) && amount > 0 && Number.isSafeInteger(rounded) && Math.abs(amount * 100 - rounded) < 0.000001 ? rounded : null;
  };
  const confirmedReceipt = (p: SourcePayment) => ["matched","confirmed"].includes(p.reconciliation) && !p.reversed;
  const allDocs = accounts.flatMap(x=>Array.isArray(x?.documents) ? x.documents.filter(Boolean) : []);
  const allPayments = accounts.flatMap(x=>Array.isArray(x?.payments) ? x.payments.filter(Boolean) : []);
  if (a.documents.some(d=>!d || typeof d.id !== "string" || !/^D-\d+[a-z]?$/.test(d.id) || allDocs.filter(x=>x.id === d.id).length !== 1)
    || a.payments.some(p=>!p || typeof p.id !== "string" || !/^T-\d+$/.test(p.id) || allPayments.filter(x=>x.id === p.id).length !== 1)) return waiting("Source history identifiers need review",a.accountId);
  const documents = required.map(title=>a.documents.filter(d=>d?.title === title));
  if (documents.some(rows=>rows.length !== 1)) return waiting("Waiting for signed required agreements",a.accountId);
  const signed = documents.map(rows=>rows[0]);
  if (new Set(signed.map(d=>d.id)).size !== signed.length || signed.some(d=>typeof d.id !== "string" || !/^D-\d+[a-z]?$/.test(d.id) || allDocs.filter(x=>x.id === d.id).length !== 1 || d.state !== "signed" || !financeActors.has(d.sentBy)
    || !at(d.sentOn) || !at(d.completedOn) || at(d.completedOn)! < at(d.sentOn)!)) return waiting("Waiting for signed required agreements",a.accountId);
  if (a.payments.some(p=>!p || confirmedReceipt(p) && !["advance","balance","full","refund","forfeit"].includes(p.kind))) return waiting("Finance confirmations need review",a.accountId);
  const receipts = a.payments.filter(p=>confirmedReceipt(p) && ["advance","balance","full","refund"].includes(p.kind));
  if (new Set(receipts.map(p=>p.id)).size !== receipts.length || receipts.some(p=>typeof p.id !== "string" || !/^T-\d+$/.test(p.id) || allPayments.filter(x=>x.id === p.id).length !== 1 || !financeActors.has(p.recordedBy)
    || !at(p.on) || cents(p.amount) === null)) return waiting("Finance confirmations need review",a.accountId);
  const confirmed = receipts.reduce((n,p)=>n + cents(p.amount)! * (p.kind === "refund" ? -1 : 1),0);
  if (!Number.isSafeInteger(confirmed) || confirmed < advance) return {...waiting("Waiting for Finance-confirmed 10% payment",a.accountId),confirmed:Math.max(0,confirmed)/100,requiredAdvance:advance/100};
  return {eligible:true,accountId:a.accountId,reason:"Ready to record local copy",receiptIds:receipts.map(p=>p.id),documentIds:signed.map(d=>d.id),confirmed:confirmed/100,requiredAdvance:advance/100};
}

export function investorCopyEligibility(state: ConsoleState, lead: Lead, accounts: readonly SourceAccount[] = sourceOf(state)): CopyEligibility {
  return canReadFinance(state,lead,"pay") && canReadFinance(state,lead,"docs")
    ? copyEvidence(state,lead,accounts) : waiting("Finance source history is unavailable for this lead");
}

function entry(l: Lead, evidence: CopyEligibility, mode: InvestorCopy["mode"], at: string, by: string): InvestorCopy {
  return {leadId:l.id,accountId:evidence.accountId!,sourceReceiptIds:[...evidence.receiptIds],sourceDocumentIds:[...evidence.documentIds],
    mode,status:"copied",copiedAt:at,copiedBy:by,snapshot:{id:l.id,n:l.n,units:l.units,owner:l.own || null,source:l.src,channelPartnerId:l.channelPartnerId || null}};
}

/** Trusted demo intake records local projections for qualifying source links, independently of the signed-in actor. */
export function projectInvestorCopies(state: ConsoleState): ConsoleState {
  let copies = state.INVESTORCOPY;
  for (const l of state.LEADS) {
    const e = copyEvidence(state,l);
    if (!e.eligible || copies[l.id] || Object.values(copies).some(c=>c.accountId === e.accountId)) continue;
    copies = {...copies,[l.id]:entry(l,e,"automatic",stamp(nowT(state.NOW)),"system")};
  }
  return copies === state.INVESTORCOPY ? state : {...state,INVESTORCOPY:copies};
}

export const canRecordInvestorCopy = (state: ConsoleState, l: Lead): boolean => roleOf(state.PEOPLE,state.WHO) === "ops" && own(state,"system","edit") && own(state,"xfer","view")
  && canReadFinance(state,l,"pay") && canReadFinance(state,l,"docs") && openable(state).some(x=>x.id === l.id);

/** Internal writer snapshot. Raw Finance fields never reach an ordinary IR or a copy-status view. */
export function investorCopyReplayTarget(state: ConsoleState, l: Lead) {
  if (!canRecordInvestorCopy(state,l)) return null;
  const accounts = sourceOf(state).filter(a=>a.leadId === l.id), account = accounts.length === 1 ? accounts[0] : null;
  return {account,eligibility:investorCopyEligibility(state,l),
    accountConflict:!!account && Object.entries(state.INVESTORCOPY).some(([id,c])=>id !== l.id && c?.accountId === account.accountId)};
}

/** Manual fallback reconciles the same existing source account, never creates or modifies one. */
export function recordInvestorCopy(state: ConsoleState, id: string): ConsoleState {
  const l = state.LEADS.find(x=>x.id === id);
  if (!l || !canRecordInvestorCopy(state,l)) return state;
  const e = investorCopyEligibility(state,l);
  if (!e.eligible || state.INVESTORCOPY[id] || Object.values(state.INVESTORCOPY).some(c=>c?.accountId === e.accountId)) return state;
  return {...state,INVESTORCOPY:{...state.INVESTORCOPY,[id]:entry(l,e,"manual",stamp(nowT(state.NOW)),state.WHO)}};
}

export const investorCopyBook = (state: ConsoleState): Lead[] => openable(state).filter(l=>canViewInvestorCopy(state,l)
  && (sourceOf(state).some(a=>a.leadId === l.id) || !!state.INVESTORCOPY[l.id]));

export const investorCopyOf = (state: ConsoleState, lead: Lead): InvestorCopy | null => {
  if (!canViewInvestorCopy(state,lead)) return null;
  const l = state.LEADS.find(x=>x.id === lead.id)!, c = state.INVESTORCOPY[l.id], a = sourceOf(state).find(x=>x.leadId === l.id);
  if (!c || !a || c.leadId !== l.id || c.snapshot?.id !== l.id || c.accountId !== a.accountId || c.status !== "copied"
    || !["automatic","manual"].includes(c.mode) || typeof c.copiedAt !== "string" || !accessMoment(pinAccessDate(c.copiedAt,state.NOW),state.NOW)
    || typeof c.copiedBy !== "string" || c.copiedBy !== "system" && !state.PEOPLE[c.copiedBy]) return null;
  const ids = (values: string[], known: string[]) => Array.isArray(values) ? [...new Set(values.filter(v=>typeof v === "string" && known.includes(v)))] : [];
  return {leadId:l.id,accountId:a.accountId,status:"copied",mode:c.mode,copiedAt:c.copiedAt,copiedBy:c.copiedBy,
    sourceReceiptIds:canReadFinance(state,l,"pay") ? ids(c.sourceReceiptIds,a.payments.map(p=>p.id)) : [],
    sourceDocumentIds:canReadFinance(state,l,"docs") ? ids(c.sourceDocumentIds,a.documents.map(d=>d.id)) : [],
    snapshot:{id:l.id,n:l.n,units:a.units,owner:l.own || null,source:l.src,channelPartnerId:l.channelPartnerId || null}};
};
