/* M09-S03-W1 — the investor record: GET /api/investors/[id]/record (server/investors/record).
   Live: one Contact plus its allotments, and Money / Paper only for a seat whose record has them.
   Fixture: the same InvestorRecord projected from the demo book. Its `investor` is the book's own
   ImInvestor object, so the section bodies not yet wired (Care, Money, Paper, Tickets…) read on unchanged. */

import type { InvestorRecord, RecordSection } from "@/server/investors/record";
import type { InvestorStateLabel } from "@/server/investors/lifecycle";
import type { AmSummary } from "@/server/data/live";
import type { AmServiceView } from "@/server/investors/am-service";
import type { KamAssigned } from "@/server/investors/kam-assign";
import type { AddPaidCreated } from "@/server/investors/add-paid";
import type { InvestorSearchResult } from "@/server/investors/search";
import type { IrInvestorRow } from "@/server/investors/ir-list";
import type { FinanceInvestorRow, FinanceSummary } from "@/server/investors/finance-list";
import {
  I, KAMS, allots, irInvestors, irMayOpen, allotsOf, bookOf, cOf_all, cared, dueBy, dupEmail, gotBy, invMatch, isAM, lastC, llpName, llpOf, may, mayAddInvestor, myBook, needsKam, nextInvId,
  overdue, pageReadable, poolBook, quiet, tierOf, when, who, MOODS,
} from "@/lib/im";
import type { ImInvestor, ImState } from "@/lib/im";
import { fail, ok, type ReadEndpoint, type WriteEndpoint } from "../api";
import { imFixtureWrite, imLiveError, type ImBook, type ImDispatch } from "./im";
import { FIXTURE_VERSION } from "./version";

type InvestorSearchValue = Extract<InvestorSearchResult, { ok: true }>["value"];

export type RecordAnswer = { record: InvestorRecord };

/* server/investors/record sectionsFor: the Account Management side has Care and no Money / Paper; the Finance side
   (and the super user) has Money and Paper and no Care. The IR sections never arise on the Investors side's book. */
const FINANCE_SIDE: readonly RecordSection[] = ["who", "hold", "money", "paper", "jrn", "tkt"];
const AM_SIDE: readonly RecordSection[] = ["who", "hold", "care", "jrn", "tkt"];

/* M09-S08 (D113 ruling 2): an IR's record — who, hold and journey only (server/investors/record IR_SECTIONS; parity asserted in
   ir-investors.test.tsx). No money, no paper, no care; the book's own investor object is scrubbed to what the route's irContacts
   projection carries (name, ARL code, mobile, email, city, residency, the lead link) — no address, nominee, KYC, PAN, Aadhaar or bank. */
const IR_SIDE: readonly RecordSection[] = ["who", "hold", "jrn"];
const IR_BANK = { acct: "", ifsc: "", name: "", drop: "" };
export const irView = (x: ImInvestor): ImInvestor => {
  const { kycWhy: _w, fema: _f, hold: _h, nextOn: _n, ...rest } = x;
  return { ...rest, addr: "", nominee: "", pan: null, aadh: null, aref: null, kyc: "pending", kycOn: null, bank: IR_BANK, kam: null, kamOn: null, intro: null };
};

function irRecord(s: ImBook["s"], me: string, id: string | null) {
  if (!irMayOpen(s, me, id)) return fail(404, "not-visible", "Not found, or not yours to open.");
  const x = irInvestors(s, me).find(y => y.id === id)!;
  const holdings = allots(s).filter(a => a.Customer === x.id).map(a => {
    const l = llpOf(s, a.LLP_Lookup);
    return { id: a.id, llpId: a.LLP_Lookup, llpName: l ? l.Name : "", block: l ? l.Block_Code : "", committed: a.Committed_Units, issued: a.Issued_Units,
      status: a.Allocation_Status, agreementSigned: null, paymentStatus: null, holdUntil: null, version: FIXTURE_VERSION };
  });
  return ok({ record: {
    id: x.id, version: null, sections: IR_SIDE, investor: irView(x), state: x.st as InvestorStateLabel,
    kyc: null, fema: null, holdings, hold: x.hold ? { until: x.hold, extension: null } : null, money: null, paper: null,
    origin: { leadId: x.lead ?? null, irId: x.ir ?? null, irVia: null, saidYesAt: null },
  } });
}

export const investorRecord: ReadEndpoint<ImBook, string | null, RecordAnswer> = {
  path: id => (id ? `/api/investors/${encodeURIComponent(id)}/record` : null),
  pick: j => j as RecordAnswer,
  fixture({ s, me }, id) {
    if (!s.data.P[me]) return irRecord(s, me, id);   /* a lead-side person with no Investors seat: the IR's own-lead record */
    if (!pageReadable(s, me, "inv")) return fail(403, "seat-denied", "This page is not part of your seat.");
    const x = I(s, me, id);
    if (!x) return fail(404, "not-visible", "Not found, or not yours to open.");
    const sections = isAM(s, me) ? AM_SIDE : FINANCE_SIDE;
    const money = sections.includes("money");
    const holdings = allotsOf(s, me, x.id).map(a => {
      const l = llpOf(s, a.LLP_Lookup);
      return { id: a.id, llpId: a.LLP_Lookup, llpName: llpName(s, a), block: l ? l.Block_Code : "", committed: a.Committed_Units, issued: a.Issued_Units,
        status: a.Allocation_Status, agreementSigned: null, paymentStatus: null, holdUntil: null, version: FIXTURE_VERSION };
    });
    return ok({ record: {
      id: x.id, version: null, sections, investor: x,
      state: x.st as InvestorStateLabel,
      kyc: money ? { status: x.kyc, on: x.kycOn } : null,
      fema: money && x.fema ? x.fema : null,
      holdings,
      hold: x.hold ? { until: x.hold, extension: null } : null,
      /* receipts: not projected — the Money section still reads the book until M10-S08-W1 */
      money: money ? { paid: gotBy(s, me, x.id), due: dueBy(s, me, x.id), receipts: [] } : null,
      /* not projected — the Paper section still reads the book until M12-S01-W1 */
      paper: null,
      origin: { leadId: x.lead ?? null, irId: x.ir ?? null, irVia: null, saidYesAt: null },
    } });
  },
};

/* ---- M09-S08-W1 — an IR's Investors list: GET /api/investors/mine (server/investors/ir-list) ----
   The investors that came from the signed-in IR's own leads (Contacts.Originating_IR = me): id, ARL code, name, farms, state,
   lead link — the columns of M09-S08-NOTE-3 and nothing else (no price, amount, yield, receipt, phone, email or identity).
   Arg: whether this seat is an IR (nothing to read for any other). The fixture is `irInvestors` over the demo book. */
export type IrListAnswer = { rows: IrInvestorRow[]; truncated: boolean };

export const irInvestorList: ReadEndpoint<ImBook, boolean, IrListAnswer> = {
  path: ir => (ir ? "/api/investors/mine" : null),
  pick: j => j as IrListAnswer,
  fixture({ s, me }) {
    if (s.data.P[me]) return fail(403, "seat-denied", "This list is an IR's own.");
    const rows = irInvestors(s, me).map((x): IrInvestorRow => ({
      id: x.id, code: x.id, name: x.n, state: x.st, leadId: x.lead ?? null,
      /* the demo's farm is its block letter (the live route reads the LLP's own id, name and block) */
      farms: Object.entries(x.blocks).map(([block, units]) => ({ llpId: block, name: s.data.FARMS.find(f => f.k === block)?.n ?? "", block, units })),
    })).sort((a, b) => a.name.localeCompare(b.name, "en-IN") || a.id.localeCompare(b.id));
    return ok({ rows, truncated: false });
  },
};

/* ---- M09-S01-W1 — Finance's Investors list: GET /api/investors/finance (server/investors/finance-list) ----
   One row per investor on the book with the summary counts. Org-wide seats only (Finance, Head of Finance, Compliance, the viewers,
   the super user); an account-management seat reads its own book (amBook / amManagers) and is refused here, as the route refuses it.
   Live: `id` is the Contact id (what the record route takes) and `code` the ARL ID. Fixture: both are the book's ARL id, the
   same word the reducer and the record route's fixture use. The demo book has no email, residency beyond NRI, KYC date, FEMA
   "done" or said-yes stamp: those come back null / derived and the screen reads none of them yet. */
/** statusHidden: the seat's Zoho profile hides KYC/FEMA, so those columns read "not visible" (B-02a). */
export type FinanceList = { rows: readonly FinanceInvestorRow[]; summary: FinanceSummary; truncated: boolean; statusHidden: boolean };

/** args: whether this seat is on the Finance side (nothing to read for an account-management seat) */
export const financeInvestors: ReadEndpoint<ImBook, boolean, FinanceList> = {
  path: fin => (fin ? "/api/investors/finance" : null),
  pick: j => j as FinanceList,
  fixture({ s, me }) {
    if (!pageReadable(s, me, "inv") || isAM(s, me)) return fail(403, "seat-denied", "This page is not part of your seat.");
    const rows = s.data.INV.map((x): FinanceInvestorRow => {
      const units = x.st === "lapsed" ? 0 : x.units;   /* the route counts live allotments only */
      return {
        id: x.id, code: x.id, name: x.n, city: x.city, email: x.em, residency: x.nri ? "NRI" : null, nri: x.nri,
        kyc: x.kyc === "passed" ? "passed" : x.kyc === "failed" ? "failed" : "pending", kycOn: x.kycOn,
        fema: x.fema === "outstanding" ? "outstanding" : null,
        units, farms: Object.entries(x.blocks).map(([block, n]) => ({ llpId: block, name: s.data.FARMS.find(f => f.k === block)?.n ?? "", block, units: n })),
        state: x.st === "said yes" ? null : x.st, stateLabel: x.st, paid: gotBy(s, me, x.id), due: dueBy(s, me, x.id),
        ir: x.ir || null, lead: x.lead ?? null, saidYesAt: null,
      };
    });
    return ok({
      rows, truncated: false, statusHidden: false,
      summary: {
        onBook: rows.length, units: rows.reduce((t, r) => t + r.units, 0),
        kycNotPassed: rows.filter(r => r.kyc !== "passed" && r.kyc !== "na").length, balanceOutstanding: rows.filter(r => r.due > 0).length,
        nri: rows.filter(r => r.nri).length, femaOutstanding: rows.filter(r => r.fema === "outstanding").length,
        saidYes: rows.filter(r => r.stateLabel === "said yes").length,
      },
    });
  },
};

/* ---- M09-S02-W1 — the account-management book's counts: GET /api/investors/am (server/data/live amSummary) ----
   "N under care" and "No manager", for a KAM (own book) or the Head of AM (allotted accounts and the pool).
   The route serves counts only; the rows the page lists are still the book's until the AM list has a route. */
export type AmAnswer = { summary: AmSummary; state: string };

/** args: whether this seat is on the account-management side (nothing to read for any other seat) */
export const amBook: ReadEndpoint<ImBook, boolean, AmAnswer> = {
  path: am => (am ? "/api/investors/am" : null),
  pick: j => j as AmAnswer,
  fixture({ s, me }) {
    if (!pageReadable(s, me, "inv") || !isAM(s, me)) return fail(403, "seat-denied", "This page is not part of your seat.");
    const book = myBook(s, me).filter(cared);
    return ok({ summary: { underCare: book.length, noManager: book.filter(needsKam).length }, state: "fresh" });
  },
};

/* ---- M09-S04-W2 / M09-S02-W2 — the account-management list: GET /api/investors/am/managers (server/investors/am-service) ----
   The managers the "Name a manager" drawer offers (accounts, tiers, gone quiet, load), the shared pool, and the AM row
   list. A KAM reads their own row only (no pool); the Head of AM everyone. Live the manager is the Zoho user id; the
   fixture's is the demo seat key (the same word the reducer's assignKam takes). */
export type AmManagers = Pick<AmServiceView, "book" | "managers" | "pool" | "accounts">;

/** the demo's "26 Aug 10:00" as the route's naive IST "2026-08-26T10:00" (the demo clock is IST wall time kept as UTC ms) */
const stampOf = (s: ImState, at: string): string | null => { const ms = when(s.data.NOW, at); return ms == null ? null : new Date(ms).toISOString().slice(0, 16); };
const tierCount = (b: ImInvestor[]) => { const t = { A: 0, B: 0, C: 0 }; b.forEach(x => { t[tierOf(x)!.k as "A" | "B" | "C"]++; }); return t; };
const perMonth = (b: ImInvestor[]) => Math.round(b.reduce((a, y) => a + 30 / tierOf(y)!.every, 0) * 10) / 10;

/** The demo book's answer in the route's shape (no seat check: the Service fixture also serves the money seats, see numbers.ts). */
export function amManagersView(s: ImState, me: string): AmManagers {
  const kam = who(s, me).r === "kam";
  const managers = (kam ? [me] : KAMS(s)).map(k => {
    const b = bookOf(s, me, k), t = tierCount(b);
    return { id: k, name: who(s, k).n, left: false, accounts: b.length, tierA: t.A, tiers: t, perMonth: perMonth(b), goneQuiet: b.filter(y => quiet(s, me, y)).length,
      conversations: cOf_all(s, me).filter(c => c.by === k).length,
      openTickets: s.data.TKT.filter(x => I(s, me, x.inv) && x.state !== "closed" && x.own === k).length,
      onConcern: b.filter(y => lastC(s, me, y.id)?.mood === "concern").length };
  });
  const pool = kam ? null : (() => { const b = poolBook(s, me); return { accounts: b.length, tierA: tierCount(b).A, goneQuiet: b.filter(y => quiet(s, me, y)).length, shouldBeNamed: b.filter(needsKam).length }; })();
  const accounts = myBook(s, me).filter(cared).map(x => { const l = lastC(s, me, x.id), o = overdue(s, me, x);
    return { id: x.id, code: x.id, name: x.n, city: x.city || null, nri: x.nri, units: x.units, tier: tierOf(x)!.k as "A" | "B" | "C", kamUserId: x.kam || null, introduced: !!x.intro,
      lastHeardAt: l ? stampOf(s, l.at) : null, lastMood: l ? MOODS[l.mood] : null, overdue: o }; });
  return { book: kam ? "kam" : "head", managers, pool, accounts };
}

export const amManagers: ReadEndpoint<ImBook, boolean, AmManagers> = {
  path: am => (am ? "/api/investors/am/managers" : null),
  pick: j => j as AmManagers,
  fixture({ s, me }) {
    if (!pageReadable(s, me, "inv") || !isAM(s, me)) return fail(403, "seat-denied", "This page is not part of your seat.");
    return ok(amManagersView(s, me));
  },
};

/* ---- M09-S04-W1 — name or move an account's key account manager: PUT /api/investors/[id]/kam ----
   { kamUserId | null, expectedModifiedTime } — the Head of AM only; null returns the account to the pool.
   `kam` is the seat key the demo reducer's assignKam names; live it is the Zoho user id. */
export type KamArgs = { id: string; kam: string | null; expectedModifiedTime: string | null };
export type KamAnswer = Pick<KamAssigned, "contactId" | "toKam" | "changed">;

export const kamAssign: WriteEndpoint<ImBook, KamArgs, KamAnswer, ImDispatch> = {
  method: "PUT",
  path: a => `/api/investors/${encodeURIComponent(a.id)}/kam`,
  body: a => ({ kamUserId: a.kam, expectedModifiedTime: a.expectedModifiedTime }),
  pick: j => (j as { kam: KamAssigned }).kam,
  fixture(b, d, a) {
    if (!may(b.s, b.me, "assign")) return fail(403, "seat-denied", "Naming a key account manager is the Head of Account Management's.");
    return imFixtureWrite(b, d, { type: "assignKam", id: a.id, k: a.kam }, { contactId: a.id, toKam: a.kam, changed: true });
  },
  onLiveError: imLiveError,
};

/* ---- R5 — move a whole book: POST /api/kams/[userId]/move-book (server/investors/kam-move-book) ----
   { toKamUserId, continueFrom? } — every Contact through the same guarded PUT as kamAssign. A book that did not fit the
   request answers continueFrom; the page asks again with it. Fixture: the reducer's assignKam for each account the old
   manager holds in the book this seat reads (seat keys, as kamAssign's fixture). */
export type MoveBookArgs = { from: string; to: string; continueFrom?: string | null };
export type MoveBookAnswer = { moved: number; notMoved: number; continueFrom: string | null };

export const kamMoveBook: WriteEndpoint<ImBook, MoveBookArgs, MoveBookAnswer, ImDispatch> = {
  method: "POST",
  path: a => `/api/kams/${encodeURIComponent(a.from)}/move-book`,
  body: a => (a.continueFrom ? { toKamUserId: a.to, continueFrom: a.continueFrom } : { toKamUserId: a.to }),
  pick: j => {
    const r = j as { moved?: unknown; notMoved?: unknown; continueFrom?: unknown };
    return { moved: typeof r.moved === "number" ? r.moved : 0, notMoved: Array.isArray(r.notMoved) ? r.notMoved.length : 0,
      continueFrom: typeof r.continueFrom === "string" ? r.continueFrom : null };
  },
  fixture(b, d, a) {
    const { s, me } = b;
    if (!may(s, me, "assign")) return fail(403, "seat-denied", "Naming a key account manager is the Head of Account Management's.");
    if (a.from === a.to) return fail(400, "same-kam", "The request is not valid.");
    if (!KAMS(s).includes(a.to)) return fail(403, "assignee-not-am", "Only a key account manager can be named.");
    if (a.continueFrom) return ok({ moved: 0, notMoved: 0, continueFrom: null });
    const ids = bookOf(s, me, a.from).filter(cared).map(x => x.id);
    ids.forEach(id => d({ type: "assignKam", id, k: a.to }));
    return ok({ moved: ids.length, notMoved: 0, continueFrom: null });
  },
  onLiveError: imLiveError,
};

/* ---- M09-S07-W1 — the Investors search box: GET /api/investors/search?q=&farm=<LLP id> ----
   Name, ARL code, city or phone digits (and one farm), inside the seat's own book, on the person's own token.
   Hits carry no money and only the last four digits of the mobile. */
export type SearchArgs = { q: string; farm: string | null };
export type SearchAnswer = Pick<InvestorSearchValue, "hits" | "more" | "farmId">;

/** the route's rule for a usable term: an ARL code, 4–15 digits of a phone, or a word of two letters or more */
const searchable = (q: string): boolean => {
  const t = q.trim();
  const digits = t.replace(/[\s()+.-]/g, "");
  if (/^\d+$/.test(digits)) return digits.length >= 4 && digits.length <= 15;
  return t.split(/\s+/).some(w => w.replace(/[^\p{L}\p{N}.-]/gu, "").length >= 2);
};

export const investorSearch: ReadEndpoint<ImBook, SearchArgs, SearchAnswer> = {
  path: a => {
    if (!a.q.trim() && !a.farm) return null;
    const p = new URLSearchParams();
    if (a.q.trim()) p.set("q", a.q.trim());
    if (a.farm) p.set("farm", a.farm);
    return "/api/investors/search?" + p.toString();
  },
  pick: j => j as SearchAnswer,
  fixture({ s, me }, a) {
    if (!pageReadable(s, me, "inv")) return fail(403, "capability-missing", "This page is not part of your seat.");
    if (!a.farm && !searchable(a.q)) return fail(400, "term-too-short", "Type a little more to search.");
    const farm = a.farm ? llpOf(s, a.farm) : null;
    if (a.farm && !farm) return fail(400, "invalid-request", "Search finds your investors only.");
    const q = a.q.trim();
    const hits = (isAM(s, me) ? myBook(s, me).filter(cared) : myBook(s, me)).filter(x => (!q || invMatch(s, x, q)) && (!farm || !!x.blocks[farm.Block_Code]))
      .map(x => ({ id: x.id, name: x.n, code: x.id, city: x.city || null, phoneLast4: x.ph.replace(/\D/g, "").slice(-4) || null }));
    return ok({ hits, more: 0, farmId: a.farm });
  },
};

/* ---- M09-S09-W1 — Add investor (already paid): POST /api/investors/add-paid ----
   Body { name, email, mobile, llpId, units, amountPaid, investmentDate }, an Idempotency-Key per press.
   A 409 "duplicate-email" carries the existing investor: ApiErr.recordId is its contactId. */
export type AddPaidArgs = { name: string; email: string; mobile: string; llpId: string; units: number; amountPaid: number; investmentDate: string };
export type AddPaidAnswer = Pick<AddPaidCreated, "contactId" | "code" | "allocationStatus">;

export const addPaid: WriteEndpoint<ImBook, AddPaidArgs, AddPaidAnswer, ImDispatch> = {
  method: "POST",
  path: () => "/api/investors/add-paid",
  body: a => a,
  idempotent: true,
  pick: j => (j as { investor: AddPaidCreated }).investor,
  fixture(b, d, a) {
    const dup = dupEmail(b.s, a.email);
    if (dup) return fail(409, "duplicate-email", dup.em + " is already on the book.", dup.id);
    if (!mayAddInvestor(b.s, b.me)) return fail(403, "not-finance", "Adding an investor is Finance's.");
    const id = nextInvId(b.s), l = llpOf(b.s, a.llpId);
    const paidInFull = !!l && a.amountPaid >= a.units * l.Unit_Price;
    return imFixtureWrite(b, d, { type: "addInvestor", n: a.name, em: a.email, ph: a.mobile, llp: a.llpId, units: a.units, paid: a.amountPaid, on: a.investmentDate },
      { contactId: id, code: id, allocationStatus: paidInFull ? "Issued" as const : "Reserved" as const });
  },
  onLiveError: imLiveError,
};
