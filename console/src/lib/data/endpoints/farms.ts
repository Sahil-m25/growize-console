/* M11-S01-W1 — the Farms LLP list and one LLP: GET /api/farms and GET /api/farms/[id].
   Live: the route (server/farms/shelf, LLP_Creation_Module on the person's own token).
   Fixture: the same FarmRow / FarmDetail projected from the demo book's LLP records. */

import type { cacheView } from "@/server/cases/http";
import type { FarmDetail, FarmRow, ShelfTotals } from "@/server/farms/shelf";
import { isSuper, llpAcres, llpCounts, llpOf, llpTotal, llps, maskId, onSale, pageReadable, type ImLlp } from "@/lib/im";
import { fail, ok, type ReadEndpoint } from "../api";
import type { ImBook } from "./im";

export type FarmList = { rows: FarmRow[]; truncated: boolean; totals: ReturnType<typeof cacheView<ShelfTotals>>; superUser: boolean };
export type FarmOne = { farm: FarmDetail; superUser: boolean };

const NO_PAGE = () => fail(403, "no-book", "This page is not part of your seat.");

/** One demo LLP as the route's FarmRow. */
export function fixtureFarmRow({ s }: ImBook, l: ImLlp): FarmRow {
  const n = llpCounts(s, l), total = llpTotal(s, l), blk = s.data.FARMS.find(f => f.k === l.Block_Code);
  return {
    id: l.id, name: l.Name, block: l.Block_Code || null, acres: llpAcres(s, l), totalUnits: total,
    reservedUnits: n.reserved, issuedUnits: n.issued, freeUnits: Math.max(0, n.free),
    releasedUnits: blk ? blk.released : null, unitPrice: l.Unit_Price, status: l.LLP_Status,
    onSale: onSale(l), reservable: l.LLP_Status === "Open for Reservation",
    yieldPct: l.Annual_Rental_Yield, cropStage: blk ? blk.crop : null,
    insurance: { provider: l.Insurer || null, policyNo: l.Insurance_Policy_No || null, amount: null, till: l.Insured_Till || null },
    version: null,
  };
}

export const farmList: ReadEndpoint<ImBook, void, FarmList> = {
  path: () => "/api/farms",
  pick: j => j as FarmList,
  fixture(b) {
    if (!pageReadable(b.s, b.me, "farms")) return NO_PAGE();
    const rows = llps(b.s).map(l => fixtureFarmRow(b, l));
    const sum = (f: (r: FarmRow) => number) => rows.reduce((a, r) => a + f(r), 0);
    const value: ShelfTotals = { llps: rows.length, total: sum(r => r.totalUnits ?? 0), reserved: sum(r => r.reservedUnits), issued: sum(r => r.issuedUnits), free: sum(r => r.freeUnits ?? 0) };
    return ok({ rows, truncated: false, totals: { state: "fresh", value, asOf: 0 }, superUser: isSuper(b.s, b.me) });
  },
};

export const farmOne: ReadEndpoint<ImBook, string | null, FarmOne> = {
  path: id => (id ? `/api/farms/${encodeURIComponent(id)}` : null),
  pick: j => j as FarmOne,
  fixture(b, id) {
    if (!pageReadable(b.s, b.me, "farms")) return NO_PAGE();
    const l = llpOf(b.s, id);
    if (!l) return fail(404, "not-found", "Not found, or not yours to open.");
    return ok({
      farm: { ...fixtureFarmRow(b, l), pan: l.PAN ? maskId(l.PAN) : null, gst: l.GST ? maskId(l.GST) : null, incorporationNo: null,
        spocs: l.SPOCs.map(p => ({ name: p.n, phone: p.ph || null })) },
      superUser: isSuper(b.s, b.me),
    });
  },
};
