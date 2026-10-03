/* M16-S08-W1 / M16-S09-W1 — Numbers, Investors side: which sections this seat is offered and each section's figures
   (GET /api/numbers/investors-side, then ?section=cash|risk|paper|comp|svc). Service (M16-S08-W2) is the AM service's
   answer (server/investors/am-service): the four tiles, tier counts, load, managers and pool — a KAM or the Head of AM only;
   a seat that is not Account Management is refused 403 no-book (live and fixture alike).
   Live: the route (money sections refused 403 money-hidden to a seat without Receipts read; Collection is a scope-keyed aggregate).
   Fixture: the same answers projected from the demo book. */

import type { InvestorsSideAccess, InvestorsSideSection, InvestorsSideValue } from "@/server/numbers/investors-side";
import {
  aged, banked, cared, I, isAM, KAMS, lastC, may, nowFull, overdue, poolBook, quiet, readBook, ROLE, tierOf, when, pageReadable, PROGRAMME_UNITS, stuckDocs, UNIT, who,
} from "@/lib/im";
import { fail, ok, type ReadEndpoint } from "../api";
import type { ImBook } from "./im";
import { amManagersView } from "./investors";
import { outstandingMatched } from "./today";

const IST_MS = 5.5 * 3_600_000;
export type SideOffer = { side: InvestorsSideAccess | null };
type Served = InvestorsSideSection;
export type SectionValue<K extends Served = Served> = Extract<InvestorsSideValue, { section: K }> & { asOf: number; stale: boolean };
export type AnySection = SectionValue;

const NO_BOOK = () => fail(403, "no-book", "This section is not part of your seat.");
const MONEY_HIDDEN = () => fail(403, "money-hidden", "Money figures are Finance only.");

export const investorsSideOffer: ReadEndpoint<ImBook, void, SideOffer> = {
  path: () => "/api/numbers/investors-side",
  pick: j => j as SideOffer,
  fixture({ s, me }) {
    if (!pageReadable(s, me, "ins")) return NO_BOOK();
    return ok({ side: { sections: isAM(s, me) ? ["svc"] : ["cash", "risk", "paper", "comp", "svc"] } });
  },
};

/** null → nothing to read. */
export const investorsSection: ReadEndpoint<ImBook, InvestorsSideSection | null, AnySection> = {
  path: k => (k ? `/api/numbers/investors-side?section=${encodeURIComponent(k)}` : null),
  pick: j => j as AnySection,
  fixture({ s, me }, k) {
    if (!k) return fail(400, "invalid-request", "That is not a Numbers section.");
    if (!pageReadable(s, me, "ins")) return NO_BOOK();
    if (k === "svc") {
      /* PROVISIONAL: the route serves Service to a KAM or the Head of AM (the AM book is theirs to read); the demo also shows it to the
         money seats whose token reads the whole book, as the screen did before the route — live they are refused until that reader exists. */
      const am = amManagersView(s, me);
      const book = readBook(s, me).filter(cared), late = book.filter(x => quiet(s, me, x));
      const kept = book.filter(x => { const o = overdue(s, me, x); return o != null && o <= 0; }).length;
      const tk = s.data.TKT.filter(t => I(s, me, t.inv) && (!isAM(s, me) || (may(s, me, "assign") ? (ROLE[(s.data.P[t.own] || { r: "audit" }).r] || {}).tm === "am" : t.own === me))).filter(t => t.state !== "closed");
      const tiers = { A: 0, B: 0, C: 0 }; book.forEach(x => { tiers[tierOf(x)!.k as "A" | "B" | "C"]++; });
      const load = (b: typeof book) => Math.round(b.reduce((a, y) => a + 30 / tierOf(y)!.every, 0) * 10) / 10;
      return ok({ section: "svc", asOf: nowFull(s.data.NOW) - IST_MS, stale: false, book: may(s, me, "assign") ? "head" : "kam", managers: am.managers, pool: am.pool, team: KAMS(s).length, tiers,
        load: { perMonth: load(book), poolPerMonth: load(poolBook(s, me)) }, problems: [],
        tiles: { goneQuiet: late.length, insideCadencePct: book.length ? Math.round(kept / book.length * 100) : 100,
          ticketsPastWindow: tk.filter(t => (aged(s.data.NOW, t.opened) || 0) > (t.pri === "high" ? 2 : 5)).length,
          endedOnConcern: book.filter(x => lastC(s, me, x.id)?.mood === "concern").length } });
    }
    if (isAM(s, me)) return k === "cash" || k === "risk" ? MONEY_HIDDEN() : NO_BOOK();
    const asOf = nowFull(s.data.NOW) - IST_MS, at = { asOf, stale: false };
    if (k === "cash") {
      const got = banked(s), out = outstandingMatched(s), programme = PROGRAMME_UNITS * UNIT;
      const committed = s.data.INV.filter(x => x.st !== "lapsed").reduce((a, x) => a + x.units * UNIT, 0);
      const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : null);
      return ok({ section: "cash", ...at, collection: { banked: got, committed, outstanding: out, programme, programmeUnits: PROGRAMME_UNITS,
        pctOfCommitted: pct(got, committed), pctOfProgramme: pct(got, programme),
        byLlp: [] /* the per-LLP split is not read by the screen yet (M16-S08's LLP table) */, unlinkedBanked: 0 } });
    }
    if (k === "risk") {
      /* the route lists allotments with some money in and a balance still due, oldest last receipt first */
      const rows = s.data.INV.filter(x => x.st === "reserved").flatMap(x => {
        const committed = x.units * UNIT, received = s.data.TXN.filter(t => t.inv === x.id && t.rec === "matched" && t.kind !== "refund" && t.kind !== "forfeit")
          .reduce((a, t) => a + t.amt, 0), due = Math.max(0, committed - received);
        if (!(received > 0 && due > 0)) return [];
        const last = s.data.TXN.filter(t => t.inv === x.id && t.rec === "matched" && t.kind !== "refund" && t.kind !== "forfeit")
          .map(t => t.on).sort((a, b) => (when(s.data.NOW, b) ?? 0) - (when(s.data.NOW, a) ?? 0))[0] ?? null;
        return [{ allotmentId: x.id, investor: { id: x.id, name: x.n }, llp: { id: null, name: null }, committed, received, due, lastReceiptOn: last, days: aged(s.data.NOW, last) }];
      });
      return ok({ section: "risk", ...at, rows, due: rows.reduce((a, r) => a + r.due, 0) });
    }
    if (k === "paper") {
      const rows = stuckDocs(s).map(({ d, age }) => ({ key: d.id, document: d.t, module: "Attachments", recordId: d.id, contactId: d.inv, llpId: null,
        party: (I(s, me, d.inv) || { n: null }).n, method: d.sig, sentAt: d.sent, sentBy: who(s, d.by).n.split(" ")[0]!, expiresAt: d.exp ?? null,
        daysOut: age, status: null }));
      return ok({ section: "paper", ...at, rows, truncated: false });
    }
    const rows = s.data.INV.flatMap(x => {
      const missing = [...(x.kyc !== "passed" ? ["kyc" as const] : []), ...(x.fema === "outstanding" ? ["fema" as const] : []),
        ...(x.pan ? [] : ["pan-proof" as const]), ...(x.bank.drop === "matched" ? [] : ["bank-proof" as const])];
      return missing.length ? [{ contactId: x.id, arlId: x.id, name: x.n, kyc: x.kyc === "passed" ? "passed" as const : x.kyc === "failed" ? "failed" as const : "pending" as const,
        nri: x.nri, missing, blocks: missing.includes("kyc") || missing.includes("fema") ? "allotment" as const : null }] : [];
    });
    return ok({ section: "comp", ...at, rows, count: rows.length, truncated: false });
  },
};
