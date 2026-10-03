/* M09-S03-W1 — the investor record: GET /api/investors/[id]/record (server/investors/record).
   Live: one Contact plus its allotments, and Money / Paper only for a seat whose record has them.
   Fixture: the same InvestorRecord projected from the demo book. Its `investor` is the book's own
   ImInvestor object, so the section bodies not yet wired (Care, Money, Paper, Tickets…) read on unchanged. */

import type { InvestorRecord, RecordSection } from "@/server/investors/record";
import type { InvestorStateLabel } from "@/server/investors/lifecycle";
import type { AmSummary } from "@/server/data/live";
import type { KamAssigned } from "@/server/investors/kam-assign";
import type { AddPaidCreated } from "@/server/investors/add-paid";
import type { InvestorSearchResult } from "@/server/investors/search";
import { I, allotsOf, cared, dueBy, dupEmail, gotBy, invMatch, isAM, llpName, llpOf, may, mayAddInvestor, myBook, needsKam, nextInvId, pageReadable } from "@/lib/im";
import { fail, ok, type ReadEndpoint, type WriteEndpoint } from "../api";
import { imFixtureWrite, imLiveError, type ImBook, type ImDispatch } from "./im";
import { FIXTURE_VERSION } from "./version";

type InvestorSearchValue = Extract<InvestorSearchResult, { ok: true }>["value"];

export type RecordAnswer = { record: InvestorRecord };

/* server/investors/record sectionsFor: the Account Management side has Care and no Money / Paper; the Finance side
   (and the super user) has Money and Paper and no Care. The IR sections never arise on the Investors side's book. */
const FINANCE_SIDE: readonly RecordSection[] = ["who", "hold", "money", "paper", "jrn", "tkt"];
const AM_SIDE: readonly RecordSection[] = ["who", "hold", "care", "jrn", "tkt"];

export const investorRecord: ReadEndpoint<ImBook, string | null, RecordAnswer> = {
  path: id => (id ? `/api/investors/${encodeURIComponent(id)}/record` : null),
  pick: j => j as RecordAnswer,
  fixture({ s, me }, id) {
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
