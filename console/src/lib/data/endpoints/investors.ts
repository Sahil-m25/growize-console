/* M09-S03-W1 — the investor record: GET /api/investors/[id]/record (server/investors/record).
   Live: one Contact plus its allotments, and Money / Paper only for a seat whose record has them.
   Fixture: the same InvestorRecord projected from the demo book. Its `investor` is the book's own
   ImInvestor object, so the section bodies not yet wired (Care, Money, Paper, Tickets…) read on unchanged. */

import type { InvestorRecord, RecordSection } from "@/server/investors/record";
import type { InvestorStateLabel } from "@/server/investors/lifecycle";
import { I, allotsOf, dueBy, gotBy, isAM, llpName, llpOf, pageReadable } from "@/lib/im";
import { fail, ok, type ReadEndpoint } from "../api";
import type { ImBook } from "./im";

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
        status: a.Allocation_Status, agreementSigned: null, paymentStatus: null, holdUntil: null };
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
