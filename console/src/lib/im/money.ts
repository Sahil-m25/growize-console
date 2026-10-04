/* ── im/money.ts — the rules the later owner decisions added (not in the prototype) ─────────
   Pure reads and gates for: farm LLPs and allotments (D70, M11-S01/S02, M10-S07/S08), monthly
   payouts (D82/D84, M10-S20), app access (D93, M10-S21/S22/S23), ARL holdings (M10-S09), the
   second-hand match (M10-S02) and adding an investor who already paid (M09-S09).
   Same shape as rules.ts: `(s, WHO, …)`, a Gate is {ok:true} or {ok:false,msg}. No wall clock —
   every date comes from data.NOW.
   ────────────────────────────────────────────────────────────────────────────────────────── */
import { MON, UNIT } from "./constants";
import { inr, nowDay, nowFull } from "./dates";
import { I, isSuper, may, notFin, pageReadable, txOf, who } from "./selectors";
import { PAPER_FIRST, matchGate, type Gate } from "./rules";
import type {
  ImAccess, ImAllot, ImArlTxn, ImCtx, ImData, ImDrawerKey, ImHolding, ImInvestor, ImLlp, ImLlpStatus, ImPayStatus,
  ImPayout, ImPayoutMode, ImTestLink, ImTxn,
} from "./types";

const OK: Gate = { ok: true };
const no = (msg: string | null = null): Gate => ({ ok: false, msg });
const pl = (n: number, w: string) => n + " " + w + (n === 1 ? "" : "s");

/* ============================ dates for the 60-month records ============================ */
const pad2 = (n: number) => String(n).padStart(2, "0");
/** "YYYY-MM-DD" of an epoch day */
export const ymd = (ms: number): string => {
  const d = new Date(ms); return d.getUTCFullYear() + "-" + pad2(d.getUTCMonth() + 1) + "-" + pad2(d.getUTCDate());
};
/** "2026-10-10" → "10 Oct 2026"; "2026-10" → "Oct 2026" */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(iso); if (!m) return iso;
  return (m[3] ? m[3] + " " : "") + MON[+m[2] - 1] + " " + m[1];
}
/** "YYYY-MM-DDTHH:MM" → "02 Sep 00:10" */
export function fmtAt(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso); if (!m) return iso;
  return m[3] + " " + MON[+m[2] - 1] + " " + m[4] + ":" + m[5];
}
const isoAt = (ms: number): string => {
  const d = new Date(ms);
  return ymd(ms) + "T" + pad2(d.getUTCHours()) + ":" + pad2(d.getUTCMinutes());
};
const parseIso = (iso: string): number | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(iso);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)) : null;
};
/** the month NOW falls in, "YYYY-MM" */
export const thisMonth = (NOW: string): string => ymd(nowDay(NOW)).slice(0, 7);

/* ============================ farm LLPs (M11-S01) ============================ */
export const LLP_STATUSES: ImLlpStatus[] = ["Draft", "Open for Reservation", "Open for Issuance", "Fully Subscribed", "Active"];
export const llps = (s: ImCtx): ImLlp[] => s.data.LLP || [];
export const llpOf = (s: ImCtx, id: string | null | undefined): ImLlp | null => llps(s).find(l => l.id === id) || null;
export const llpByCode = (s: ImCtx, k: string): ImLlp | null => llps(s).find(l => l.Block_Code === k) || null;
export const llpAcres = (s: ImCtx, l: ImLlp): number =>
  l.Acreage_Acres ?? (s.data.FARMS.find(f => f.k === l.Block_Code) || { acres: 0 }).acres;
export const llpTotal = (s: ImCtx, l: ImLlp): number =>
  l.Total_Units ?? (s.data.FARMS.find(f => f.k === l.Block_Code) || { units: 0 }).units;
/** Draft (and Fully Subscribed / Active) take no reservation */
export const onSale = (l: ImLlp | null | undefined): boolean =>
  !!l && (l.LLP_Status === "Open for Reservation" || l.LLP_Status === "Open for Issuance");
/** reserved / issued / free on the LLP, from its allotments; a Cancelled allotment counts for nothing */
export function llpCounts(s: ImCtx, l: ImLlp): { reserved: number; issued: number; free: number } {
  const on = allots(s).filter(a => a.LLP_Lookup === l.id);
  const reserved = on.filter(a => a.Allocation_Status === "Reserved").reduce((n, a) => n + a.Committed_Units, 0);
  const issued = on.filter(a => a.Allocation_Status === "Issued").reduce((n, a) => n + a.Issued_Units, 0);
  return { reserved, issued, free: llpTotal(s, l) - reserved - issued };
}
/** PAN / GST of an LLP are always masked on screen (M11-S01) */
export const maskId = (v: string | null | undefined): string => (v ? v.slice(0, 2) + "•••••••" + v.slice(-2) : "—");

/* ============================ allotments (M11-S02, M10-S07, M10-S08) ============================ */
export const allots = (s: ImCtx): ImAllot[] => s.data.ALLOT || [];
export const allotOf = (s: ImCtx, id: string | null | undefined): ImAllot | null => allots(s).find(a => a.id === id) || null;
/** an investor's allotments, for a seat that reads the investor (a KAM: only their own book) */
export const allotsOf = (s: ImCtx, WHO: string, inv: string): ImAllot[] =>
  I(s, WHO, inv) ? allots(s).filter(a => a.Customer === inv) : [];
/** the allotments on an LLP whose investor this seat reads */
export const allotsOnLlp = (s: ImCtx, WHO: string, llp: string): ImAllot[] =>
  allots(s).filter(a => a.LLP_Lookup === llp && !!I(s, WHO, a.Customer));
export const openAllots = (s: ImCtx, WHO: string, inv: string): ImAllot[] =>
  allotsOf(s, WHO, inv).filter(a => a.Allocation_Status !== "Cancelled");
export const allotUnits = (a: ImAllot): number => (a.Allocation_Status === "Issued" ? a.Issued_Units : a.Committed_Units);
/** the amount as recorded (the ticket snapshot) — never recomputed from today's LLP price */
export const allotAmount = (a: ImAllot): number => a.Ticket_Snapshot;
/** which allotment a receipt belongs to: its own link, or the investor's only allotment */
export function allotOfTxn(s: ImCtx, t: Pick<ImTxn, "inv" | "Allotment">): string | null {
  if (t.Allotment) return t.Allotment;
  const mine = allots(s).filter(a => a.Customer === t.inv);
  return mine.length === 1 ? mine[0].id : null;
}
const received = (t: ImTxn) => t.kind !== "refund" && t.kind !== "forfeit";
/** the receipts on one allotment (the related list), as this seat may read them */
export const allotTxns = (s: ImCtx, WHO: string, a: ImAllot): ReturnType<typeof txOf> =>
  txOf(s, WHO, a.Customer).filter(t => allotOfTxn(s, t) === a.id);
/** receipts on the investor that no allotment claims (only possible with several allotments) */
export const unlinkedTxns = (s: ImCtx, WHO: string, inv: string): ReturnType<typeof txOf> =>
  txOf(s, WHO, inv).filter(t => !allotOfTxn(s, t));
/** received on the allotment, whatever its reconciliation — reads the same as the investor's Paid */
export const allotPaid = (s: ImCtx, WHO: string, a: ImAllot): number =>
  allotTxns(s, WHO, a).filter(received).reduce((n, t) => n + t.amt, 0);
export const allotDue = (s: ImCtx, WHO: string, a: ImAllot): number =>
  a.Allocation_Status === "Cancelled" ? 0 : Math.max(0, allotAmount(a) - allotPaid(s, WHO, a));
/** Payment_Status from the matched receipts against the allotment amount (D70) */
export function paymentStatus(matched: number, amount: number): ImPayStatus {
  if (matched <= 0) return "Yet to initiate";
  return matched >= amount ? "Full" : "Partial";
}
export const allotPayStatus = (s: ImCtx, a: ImAllot): ImPayStatus =>
  paymentStatus(s.data.TXN.filter(t => t.rec === "matched" && received(t) && allotOfTxn(s, t) === a.id)
    .reduce((n, t) => n + t.amt, 0), allotAmount(a));
/** Agreement_Signed — the supplementary agreement for this investor is signed and verified */
export const agreementSigned = (s: ImCtx, a: ImAllot): boolean =>
  s.data.DOCS.some(d => d.inv === a.Customer && d.t === "Supplementary agreement" && d.state === "signed");
/** the allotment a receipt drawer starts on: the only open one, else none (it must be picked) */
export function prePick(s: ImCtx, WHO: string, inv: string): string | null {
  const o = openAllots(s, WHO, inv); return o.length === 1 ? o[0].id : null;
}
/** a receipt belongs to one allotment: picked when there are several; none but a refund on a Cancelled one */
export function allotPickGate(s: ImCtx, WHO: string, inv: string, allot: string | null | undefined, kind: ImTxn["kind"]): Gate {
  const x = I(s, WHO, inv); if (!x) return no();
  const mine = allotsOf(s, WHO, inv);
  if (!mine.length) return OK;                                  /* a book with no allotment records (phase-1 empty) */
  const a = allot ? mine.find(y => y.id === allot) : null;
  if (allot && !a) return no("That allotment is not " + x.n + "'s.");
  if (a && a.Allocation_Status === "Cancelled" && kind !== "refund")
    return no("The allotment on " + llpName(s, a) + " is Cancelled. Only a refund can be linked to it.");
  if (!a && openAllots(s, WHO, inv).length > 1)
    return no(x.n + " holds allotments in " + openAllots(s, WHO, inv).length + " farms. Pick the farm this receipt is for — "
      + "a receipt belongs to one allotment, so each farm's money adds up.");
  return OK;
}
/** With several open allotments a receipt is for one farm: its 10% advance, or what is still due on it.
 *  null: one allotment (or none) — the prototype's investor-level amount stands. */
export function allotReceiptAmt(s: ImCtx, WHO: string, inv: string, allot: string | null | undefined, kind: "advance" | "balance"): number | null {
  if (!allot || openAllots(s, WHO, inv).length < 2) return null;
  const a = allotOf(s, allot); if (!a) return null;
  return kind === "advance" ? Math.round(allotAmount(a) * 0.1) : allotDue(s, WHO, a);
}
export const llpName = (s: ImCtx, a: ImAllot): string => (llpOf(s, a.LLP_Lookup) || { Name: a.LLP_Lookup }).Name;

/* ============================ payouts (M10-S20, D82, D84) ============================ */
/** the day of the month a payout falls due */
export const PAYDAY = 10;
export const PAYOUT_MONTHS = 60;
export const PAYOUT_MODES: ImPayoutMode[] = ["NEFT", "RTGS", "IMPS", "UPI"];
/** Net_Amount = Gross_Amount − TDS_Amount; TDS is typed by Finance and never computed here */
export function payoutNet(gross: number, tds: number): number { return gross - (tds || 0); }
/** the monthly gross from the contract rate: issued amount × Annual_Rental_Yield ÷ 12 */
export const monthlyGross = (a: ImAllot): number =>
  Math.round(a.Issued_Units * a.Unit_Price * a.Annual_Rental_Yield / 100 / 12);
/** The 60 monthly records an issued allotment gets (the console creates them at issue, D82): the first
 *  falls due on the PAYDAY of the month after Issued_On. A Reserved or Cancelled allotment gets none. */
export function payoutSchedule(a: ImAllot, n = PAYOUT_MONTHS): ImPayout[] {
  if (a.Allocation_Status !== "Issued" || !a.Issued_On) return [];
  const m = /^(\d{4})-(\d{2})/.exec(a.Issued_On); if (!m) return [];
  const gross = monthlyGross(a);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(+m[1], +m[2] - 1 + 1 + i, PAYDAY));
    const due = ymd(d.getTime());
    return {
      id: "PO-" + a.id.replace(/^AL-/, "") + "-" + pad2(i + 1), Allotment: a.id, Payout_Kind: "Rental yield" as const,
      Instalment_No: i + 1, Period_Month: due.slice(0, 7), Due_On: due, Gross_Amount: gross, TDS_Amount: 0,
      Net_Amount: gross, Payout_State: "Scheduled" as const, Paid_On: null, Payout_Mode: null, Payout_UTR: null,
      Paid_By: null, Payout_Note: "",
    };
  });
}
export const mayPayouts = (s: ImCtx, WHO: string): boolean => !notFin(s, WHO) && (may(s, WHO, "pay") || may(s, WHO, "bank"));
export const payouts = (s: ImCtx): ImPayout[] => s.data.PAYOUT || [];
export const payoutOf = (s: ImCtx, id: string | null | undefined): ImPayout | null => payouts(s).find(p => p.id === id) || null;
/** one allotment's schedule, in order, for a seat that reads its investor */
export function payoutsOf(s: ImCtx, WHO: string, allot: string): ImPayout[] {
  const a = allotOf(s, allot);
  if (!a || !I(s, WHO, a.Customer) || !mayPayouts(s, WHO)) return [];
  return payouts(s).filter(p => p.Allotment === allot).sort((x, y) => x.Instalment_No - y.Instalment_No);
}
/** the Payments queue: Scheduled payouts falling due in NOW's month, across what this seat can see */
export function payoutsDue(s: ImCtx, WHO: string): ImPayout[] {
  if (!mayPayouts(s, WHO)) return [];
  const mo = thisMonth(s.data.NOW);
  return payouts(s).filter(p => p.Payout_State === "Scheduled" && p.Due_On.slice(0, 7) === mo && (() => {
    const a = allotOf(s, p.Allotment); return !!a && !!I(s, WHO, a.Customer);
  })()).sort((x, y) => (x.Due_On < y.Due_On ? -1 : x.Due_On > y.Due_On ? 1 : x.id < y.id ? -1 : 1));
}
/** marking a payout paid: Finance, once (the double-press guard), with the bank's UTR */
export function markPaidGate(s: ImCtx, WHO: string, id: string, utr: string, tds: number, paidOn: string): Gate {
  if (!may(s, WHO, "pay")) return no();
  const p = payoutOf(s, id); if (!p) return no();
  const a = allotOf(s, p.Allotment); if (!a || !I(s, WHO, a.Customer)) return no();
  if (p.Payout_State === "Paid")
    return no(p.id + " was already marked paid by " + who(s, p.Paid_By).n + " on " + fmtDate(p.Paid_On)
      + ".\n\nNothing was changed — a payout is paid once.");
  if (p.Payout_State === "Cancelled") return no(p.id + " is cancelled. A cancelled payout is not paid.");
  if (!utr.trim()) return no("A payout is marked paid with the bank's UTR, so the statement can be matched to it.");
  if (!(tds >= 0) || tds > p.Gross_Amount)
    return no("TDS has to be between ₹0 and the gross amount (" + inr(p.Gross_Amount) + "). The console never works it out — type what was deducted.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paidOn) || paidOn > ymd(nowDay(s.data.NOW))) return no("The paid-on date cannot be in the future.");
  const dup = payouts(s).find(q => q.id !== id && q.Payout_UTR && q.Payout_UTR.toUpperCase() === utr.trim().toUpperCase());
  if (dup) return no("UTR " + utr.trim().toUpperCase() + " is already on " + dup.id + ". One bank transfer pays one payout.");
  return OK;
}

/* ============================ app access (M10-S21, D93) ============================ */
export const accessOf = (s: ImCtx, WHO: string, id: string): ImAccess | null =>
  I(s, WHO, id) ? (s.data.ACCESS || {})[id] || null : null;
/** Finance controls app access (Head of Finance, Finance Operations, and the super user) */
export const mayAccess = (s: ImCtx, WHO: string): boolean => may(s, WHO, "pay");
export type ImAccessView = { k: "none" | "hold" | "sending" | "delivered" | "locked"; t: string };
/** what the App access card reads */
export function accessView(a: ImAccess | null, fmt: (at: string) => string = x => x): ImAccessView {
  if (!a) return { k: "none", t: "No account yet — it is created On hold, and sign-in stays locked until Finance presses Send welcome and unlock" };
  if (a.App_Access === "Hold") return a.Locked_Reason
    ? { k: "locked", t: "Locked — sign-in blocked" }
    : { k: "hold", t: "On hold — data synced, sign-in locked, no email sent" };
  if (!a.App_Welcome_At) return { k: "sending", t: "Welcome sending…" };
  return { k: "delivered", t: "Welcome delivered " + fmt(a.App_Welcome_At) + " · " + (a.App_Welcome_Channel || "Email") };
}
export function sendWelcomeGate(s: ImCtx, WHO: string, id: string): Gate & { ask?: string } {
  if (!mayAccess(s, WHO)) return no();
  const x = I(s, WHO, id), a = accessOf(s, WHO, id); if (!x || !a) return no();
  if (a.App_Access === "Invite") return no(x.n + "'s app is already unlocked. The welcome goes out once.");
  return { ok: true, ask: "Send " + x.n + " the Growize welcome and unlock their app?\n\nOne email goes to " + x.em
    + " now, and they can sign in from then on. Their data is already in the app." };
}
export function lockAppGate(s: ImCtx, WHO: string, id: string, why: string): Gate & { ask?: string } {
  if (!mayAccess(s, WHO)) return no();
  const x = I(s, WHO, id), a = accessOf(s, WHO, id); if (!x || !a) return no();
  if (a.App_Access === "Hold") return no(x.n + "'s app is already locked.");
  if (!why.trim()) return no("Say why the app is being locked. It goes on the record with your name.");
  return { ok: true, ask: "Lock " + x.n + "'s app?\n\nSign-in is blocked from now on; their data stays. Nothing is emailed to them." };
}
/** the investor's app account opens On hold at the first confirmed money (D93: the welcome never goes by itself) */
export function openHeld(d: ImData, id: string): boolean {
  d.ACCESS = d.ACCESS || {};
  if (d.ACCESS[id]) return false;
  d.ACCESS[id] = { App_Access: "Hold", App_Welcome_At: null, App_Welcome_Channel: null };
  return true;
}

/* ============================ app preview (M10-S22) ============================ */
/** offered only to a seat that has the investor in scope */
export const mayPreview = (s: ImCtx, WHO: string, id: string): boolean => !!I(s, WHO, id);
export const PREVIEW_TABS = ["Home", "Projects", "Project", "Financials", "Documents", "Activity", "Profile"] as const;

/* ============================ test sign-in link (M10-S23) ============================ */
export const TESTLINK_MIN = 10;
export const mayTestLink = (s: ImCtx, WHO: string): boolean => isSuper(s, WHO);
export const testLinks = (s: ImCtx): ImTestLink[] => s.data.TESTLINK || [];
/** live until 10 minutes after it was made or its first use, whichever comes first */
export function testLinkState(l: ImTestLink, nowMs: number): "live" | "used" | "expired" {
  if (l.usedAt) return "used";
  const e = parseIso(l.expires);
  return e != null && nowMs >= e ? "expired" : "live";
}
/** a short one-time token from the record and the moment (phase 1: a stub; phase 2: the app mints it) */
export function testToken(inv: string, at: string, n: number): string {
  let h = 2166136261;
  for (const c of inv + "|" + at + "|" + n) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return (h.toString(36) + (h ^ 0x5bd1e995).toString(36)).slice(0, 12).padEnd(12, "0");
}
export const TESTLINK_BASE = "https://app.growize.example/test-sign-in/";
export function newTestLink(s: ImCtx, WHO: string, inv: string, why: string): ImTestLink {
  const n = testLinks(s).length + 1, at = isoAt(nowFull(s.data.NOW));
  const tok = testToken(inv, at, n);
  return { id: "TL-" + pad2(n), inv, by: WHO, why: why.trim(), at, expires: isoAt(nowFull(s.data.NOW) + TESTLINK_MIN * 60000),
    usedAt: null, url: TESTLINK_BASE + tok };
}
export function testLinkGate(s: ImCtx, WHO: string, id: string, why: string): Gate & { ask?: string } {
  if (!mayTestLink(s, WHO)) return no();
  const x = I(s, WHO, id); if (!x) return no();
  if (!why.trim()) return no("Say why you need to sign in as the investor. It goes on the record with your name.");
  const acc = (s.data.ACCESS || {})[id];
  if (acc && acc.Test_Account) return OK;
  return { ok: true, ask: x.n + " is a real investor, not a test account.\n\nThe link opens the full app as " + x.n
    + " — their money, their documents, their messages. It works once, for " + TESTLINK_MIN + " minutes, and "
    + "nothing is emailed to them. Make it?" };
}
/** a placeholder QR drawn from the link text: an n×n grid with the three finder squares (phase 1 only) */
export function qrCells(text: string, n = 25): boolean[][] {
  let h = 2166136261;
  const rnd = () => { h ^= h << 13; h >>>= 0; h ^= h >>> 17; h ^= h << 5; h >>>= 0; return h / 4294967296; };
  for (const c of text) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  const finder = (r: number, c: number) => {
    const inF = (r0: number, c0: number) => r >= r0 && r < r0 + 7 && c >= c0 && c < c0 + 7;
    const at = inF(0, 0) ? [0, 0] : inF(0, n - 7) ? [0, n - 7] : inF(n - 7, 0) ? [n - 7, 0] : null;
    if (!at) return null;
    const y = r - at[0], x = c - at[1];
    return y === 0 || y === 6 || x === 0 || x === 6 || (y >= 2 && y <= 4 && x >= 2 && x <= 4);
  };
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => {
    const f = finder(r, c); return f != null ? f : rnd() < 0.5;
  }));
}

/* ============================ ARL holdings (M10-S09) ============================ */
/** Finance with money access and the super user; never a KAM, an IR or a viewer */
export const mayHoldings = (s: ImCtx, WHO: string): boolean => !notFin(s, WHO) && (may(s, WHO, "pay") || may(s, WHO, "bank"));
export const holdingsOf = (s: ImCtx, WHO: string, inv: string): ImHolding[] =>
  I(s, WHO, inv) && mayHoldings(s, WHO) ? (s.data.HOLDING || []).filter(h => h.Contact === inv) : [];
export const arlTxnsOf = (s: ImCtx, h: ImHolding): ImArlTxn[] =>
  (s.data.ARLTXN || []).filter(t => t.Holding === h.id).sort((a, b) => (a.Date < b.Date ? -1 : 1));

/* ============================ Match it (M10-S02, D113 ruling 1) ============================ */
/** "Match it" on a pending receipt: inbound money — any Finance seat, the recorder included (D113); money leaving —
 *  the Head of Finance or an administrator, never the one who recorded it (D22). */
export const mayMatch = (s: ImCtx, WHO: string, t: ImTxn | null | undefined): boolean =>
  matchGate(s, WHO, t).ok && (!!t && received(t) || who(s, WHO).r === "head" || who(s, WHO).r === "root" || isSuper(s, WHO));
/** what a pending row says to a Finance seat that may not match it now (null: nothing to say) */
export function matchWhy(s: ImCtx, WHO: string, t: ImTxn): string | null {
  if (t.rec !== "pending" || mayMatch(s, WHO, t) || !may(s, WHO, "pay")) return null;
  if (received(t)) return PAPER_FIRST;
  return t.by === WHO
    ? "You recorded this refund. Money leaving is matched by a second person — the Head of Finance or an administrator matches it."
    : "Waiting for the Head of Finance or an administrator. Money leaving is matched by a second person.";
}

/* ============================ add an investor who already paid (M09-S09) ============================ */
export const mayAddInvestor = (s: ImCtx, WHO: string): boolean => may(s, WHO, "pay");
/** the investor an email already belongs to (the whole book — a duplicate is a duplicate whoever looks) */
export const dupEmail = (s: ImCtx, em: string): ImInvestor | null => {
  const e = em.trim().toLowerCase(); return e ? s.data.INV.find(x => x.em.toLowerCase() === e) || null : null;
};
export function nextInvId(s: ImCtx): string {
  const n = s.data.INV.reduce((m, x) => Math.max(m, +(x.id.match(/(\d+)$/) || [0, 0])[1]), 0);
  return "ARL-INV-" + String(n + 1).padStart(4, "0");
}
export type AddInvForm = { n: string; em: string; ph: string; llp: string; units: number; paid: number; on: string };
export function addInvestorGate(s: ImCtx, WHO: string, f: AddInvForm): Gate {
  if (!mayAddInvestor(s, WHO)) return no();
  const miss = ([["n", "name"], ["em", "email"], ["ph", "mobile"], ["llp", "farm"], ["on", "investment date"]] as const)
    .filter(([k]) => !String(f[k] || "").trim()).map(([, t]): string => t);
  if (!(f.units > 0)) miss.push("units");
  if (!(f.paid > 0)) miss.push("amount paid");
  if (miss.length) return no("Not saved yet — " + miss.join(", ") + (miss.length === 1 ? " is" : " are") + " missing.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.em.trim())) return no("Not saved yet — " + f.em.trim() + " is not an email address.");
  const d = dupEmail(s, f.em);
  if (d) return no(f.em.trim() + " already belongs to " + d.n + " (" + d.id + "). Open their record instead of adding them twice.");
  const l = llpOf(s, f.llp); if (!l) return no("Not saved yet — pick the farm.");
  if (!onSale(l)) return no(l.Name + " is " + l.LLP_Status + " — it takes no new holdings.");
  if (!Number.isInteger(f.units)) return no("Not saved yet — units are whole units.");
  const free = llpCounts(s, l).free;
  if (f.units > free) return no(l.Name + " has " + pl(free, "unit") + " free. " + pl(f.units, "unit") + " would sell land twice.");
  if (f.paid > f.units * l.Unit_Price) return no("Not saved yet — " + inr(f.paid) + " is more than " + pl(f.units, "unit")
    + " cost (" + inr(f.units * l.Unit_Price) + ").");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.on) || f.on > ymd(nowDay(s.data.NOW))) return no("Not saved yet — the investment date cannot be in the future.");
  return OK;
}

/* ============================ the drawers these screens open ============================ */
export const MONEY_DRAWERS: ImDrawerKey[] = ["payout", "llp", "addinv", "applock", "testlink", "preview"];
export function moneyDrawerReadable(s: ImCtx, WHO: string, k: ImDrawerKey, id: string | null | undefined): boolean {
  /* M10-S20…S23-W1: whether the payout / investor exists is the route's answer (403/404 in the drawer), not the book's —
     these gates keep only the seat's rule */
  switch (k) {
    case "payout": return mayPayouts(s, WHO) && !!id;
    /* M11-S01-W1: whether the LLP exists is the route's answer (GET /api/farms/[id] → 404 in the drawer), not the book's */
    case "llp": return pageReadable(s, WHO, "farms") && !!id;
    case "addinv": return mayAddInvestor(s, WHO);
    case "applock": return mayAccess(s, WHO) && !!id;
    case "testlink": return mayTestLink(s, WHO) && !!id;
    case "preview": return !!id;
    default: return false;
  }
}

/* ============================ the book as a portfolio (the preview's figures) ============================ */
/** what the investor app shows on Home: units, invested, paid out, next payout */
export function portfolioOf(s: ImCtx, WHO: string, inv: string) {
  const x = I(s, WHO, inv); if (!x) return null;
  const al = openAllots(s, WHO, inv);
  const units = al.length ? al.reduce((n, a) => n + allotUnits(a), 0) : x.units;
  const invested = txOf(s, WHO, inv).filter(received).reduce((n, t) => n + t.amt, 0);
  const po = al.flatMap(a => payouts(s).filter(p => p.Allotment === a.id));
  const paidOut = po.filter(p => p.Payout_State === "Paid").reduce((n, p) => n + p.Net_Amount, 0);
  const next = po.filter(p => p.Payout_State === "Scheduled").sort((a, b) => (a.Due_On < b.Due_On ? -1 : 1))[0] || null;
  return { x, al, units, value: units * UNIT, invested, paidOut, next, payouts: po };
}
