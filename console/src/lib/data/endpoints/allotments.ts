/* M11-S02-W1 — allotment rows: GET /api/investors/[id]/allotments (the investor's, one row per LLP) and
   GET /api/farms/[id]/allotments (who holds units on one LLP) — server/investors/allotments.
   Live: the related lists on the person's own token, scoped by seat; money fields only for a seat whose record has Money.
   Fixture: the same AllotmentLine projected from the demo book's allotments (ImAllot).
   M11-S05-W1 — allot on the verified allocation letter: POST /api/investors/[id]/allot (server/investors/allot). */

import type { AllotmentLine } from "@/server/investors/allotments";
import type { Allotted } from "@/server/investors/allot";
import { I, agreementSigned, allotAmount, allotPayStatus, allotUnits, allotsOf, allotsOnLlp, llpOf, llpName, may, notFin, pageReadable, type ImAllot } from "@/lib/im";
import { fail, ok, type ReadEndpoint, type WriteEndpoint } from "../api";
import { imFixtureWrite, imLiveError, type ImBook, type ImDispatch } from "./im";

export type InvestorAllotments = { contactId: string; allotments: AllotmentLine[]; money: boolean; paper: boolean; truncated: boolean };
export type FarmAllotments = { llpId: string; allotments: AllotmentLine[]; units: { reserved: number; issued: number }; scoped: boolean; money: boolean; truncated: boolean };

const NO_PAGE = () => fail(403, "seat-denied", "This page is not part of your seat.");

/** One demo allotment as the route's AllotmentLine (money and paper fields null where the seat has neither). */
export function fixtureLine({ s, me }: ImBook, a: ImAllot): AllotmentLine {
  const fin = !notFin(s, me), x = I(s, me, a.Customer);
  return {
    id: a.id, investor: { id: a.Customer, name: x ? x.n : null }, llp: { id: a.LLP_Lookup, name: llpName(s, a) },
    status: a.Allocation_Status, reservedUnits: a.Allocation_Status === "Reserved" ? a.Committed_Units : 0, issuedUnits: a.Issued_Units,
    committedUnits: allotUnits(a), unitPrice: fin ? a.Unit_Price : null, amount: fin ? allotAmount(a) : null,
    capitalInvested: fin ? allotAmount(a) : null, paymentStatus: fin ? allotPayStatus(s, a) : null,
    agreementSigned: fin ? agreementSigned(s, a) : null, investedOn: a.Issued_On, holdUntil: null, linked: !!(a.Customer && llpOf(s, a.LLP_Lookup)),
  };
}

export const investorAllotments: ReadEndpoint<ImBook, string | null, InvestorAllotments> = {
  path: id => (id ? `/api/investors/${encodeURIComponent(id)}/allotments` : null),
  pick: j => j as InvestorAllotments,
  fixture(b, id) {
    if (!pageReadable(b.s, b.me, "inv")) return NO_PAGE();
    if (!id || !I(b.s, b.me, id)) return fail(404, "not-visible", "Not found, or not yours to open.");
    const fin = !notFin(b.s, b.me);
    return ok({ contactId: id, allotments: allotsOf(b.s, b.me, id).map(a => fixtureLine(b, a)), money: fin, paper: fin, truncated: false });
  },
};

export const farmAllotments: ReadEndpoint<ImBook, string | null, FarmAllotments> = {
  path: id => (id ? `/api/farms/${encodeURIComponent(id)}/allotments` : null),
  pick: j => j as FarmAllotments,
  fixture(b, id) {
    if (!pageReadable(b.s, b.me, "farms")) return NO_PAGE();
    if (!id || !llpOf(b.s, id)) return fail(404, "not-found", "Not found, or not yours to open.");
    const rows = allotsOnLlp(b.s, b.me, id).map(a => ({ a, line: fixtureLine(b, a) }));
    const live = rows.filter(r => r.a.Allocation_Status !== "Cancelled");
    return ok({
      llpId: id, allotments: rows.map(r => r.line), truncated: false, money: !notFin(b.s, b.me), scoped: false,
      units: { reserved: live.reduce((n, r) => n + r.line.reservedUnits, 0), issued: live.reduce((n, r) => n + r.line.issuedUnits, 0) },
    });
  },
};

/* ---- M11-S05-W1 — verify the Allocation letter → allot ---- */
export type AllotArgs = {
  /** the investor (Contact) and the allotment the letter allots */
  id: string; allotmentId: string;
  /** the e-Mudhra reference typed in the drawer; blank = one is generated */
  reference: string;
  expectedModifiedTime: string | null;
  /** the letter's document row — the reducer's verifyDoc names it */
  did: string;
};
export type AllotAnswer = { allotted: Pick<Allotted, "allotmentId" | "status" | "units">; already: boolean };

export const investorAllot: WriteEndpoint<ImBook, AllotArgs, AllotAnswer, ImDispatch> = {
  method: "POST",
  path: a => `/api/investors/${encodeURIComponent(a.id)}/allot`,
  body: a => ({ allotmentId: a.allotmentId, ...(a.reference.trim() ? { reference: a.reference.trim() } : {}),
    ...(a.expectedModifiedTime ? { expectedModifiedTime: a.expectedModifiedTime } : {}) }),
  pick: j => j as AllotAnswer,
  fixture: (b, d, a) => !may(b.s, b.me, "doc") ? fail(403, "not-finance", "Verifying paper is Finance's.") : imFixtureWrite(b, d, { type: "verifyDoc", did: a.did, ref: a.reference },
    { allotted: { allotmentId: a.allotmentId, status: "Issued" as const, units: 0 }, already: false }),
  onLiveError: imLiveError,
};
