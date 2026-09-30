/* M11-S01-W1 — the Farms LLP list and one LLP: GET /api/farms and GET /api/farms/[id].
   Live: the route (server/farms/shelf, LLP_Creation_Module on the person's own token).
   Fixture: the same FarmRow / FarmDetail projected from the demo book's LLP records. */

import type { cacheView } from "@/server/cases/http";
import type { FarmDetail, FarmRow, ShelfTotals } from "@/server/farms/shelf";
import type { LlpShelf, OccupancyResult } from "@/server/farms/occupancy";
import type { ReleaseResult } from "@/server/farms/release";
import { allocated, blockUse, freeUnits, isSuper, llpAcres, llpCounts, llpOf, llpTotal, llps, maskId, may, notFin, onSale, pageReadable, released, reserved, type ImLlp } from "@/lib/im";
import { fail, ok, type ReadEndpoint, type WriteEndpoint } from "../api";
import { imFixtureWrite, imLiveError, type ImBook, type ImDispatch } from "./im";

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

/* ---- M11-S03-W1 — the shelf: GET /api/farms/shelf (server/farms/occupancy) ----
   Live: per-LLP released / allotted / reserved-or-paid / free counted off the allotment records. Fixture: the same
   answer projected from the demo book's blocks (FARMS) and investors — the page draws one bar per block. */
export type ShelfAnswer = Omit<Extract<OccupancyResult, { ok: true }>, "ok">;

export const farmShelf: ReadEndpoint<ImBook, void, ShelfAnswer> = {
  path: () => "/api/farms/shelf",
  pick: j => j as ShelfAnswer,
  fixture({ s, me }) {
    if (!pageReadable(s, me, "farms")) return NO_PAGE();
    const llpByBlock = new Map(llps(s).map(l => [l.Block_Code, l]));
    const shelf: LlpShelf[] = s.data.FARMS.map(f => {
      const l = llpByBlock.get(f.k);
      const u = blockUse(s, f.k);
      const sum = (st: string) => s.data.INV.filter(i => i.st === st).reduce((a, i) => a + (i.blocks[f.k] || 0), 0);
      const al = sum("allocated"), pd = sum("paid"), re = u - al - pd, left = f.released - u;
      return { id: l ? l.id : f.k, name: l ? l.Name : "Block " + f.k, block: f.k, acres: f.acres, totalUnits: f.units, released: f.released,
        notReleased: f.released === 0, allotted: al, reservedOrPaid: re + pd, paid: pd, reserved: re, free: Math.max(0, left), oversold: left < 0,
        recordedDiffers: false, status: l ? l.LLP_Status : "Draft", cropStage: f.crop };
    });
    const free = freeUnits(s);
    return ok({
      llps: shelf,
      tiles: { acres: s.data.FARMS.reduce((a, f) => a + f.acres, 0), units: s.data.FARMS.reduce((a, f) => a + f.units, 0),
        released: released(s), allotted: allocated(s), reservedOrPaid: reserved(s), free, oversold: free < 0 },
      /* who is on which LLP: the LLP drawer reads GET /api/farms/[id]/allotments (M11-S02-W1), not this list */
      occupants: [], countsComplete: true, namesShown: true, money: !notFin(s, me), asOf: 0, stale: false, truncated: false, superUser: isSuper(s, me),
    });
  },
};

/* ---- M11-S04-W1 — Release N / Take it back: POST / DELETE /api/farms/[id]/release { version } ----
   Head of Finance only (the "farm" capability). `k` is the demo block the reducer's releaseBlock / holdBlock names. */
export type ReleaseArgs = { id: string; k: string; version: string | null };
export type Released = Pick<Extract<ReleaseResult, { ok: true }>, "llpId" | "released">;

const releaseFixture = (type: "releaseBlock" | "holdBlock") => (b: ImBook, d: ImDispatch, a: ReleaseArgs) => {
  const f = b.s.data.FARMS.find(x => x.k === a.k);
  if (!may(b.s, b.me, "farm")) return fail(403, "read-only", "Releasing land or taking it back is the Head of Finance's.");
  return imFixtureWrite(b, d, { type, k: a.k }, { llpId: a.id, released: type === "releaseBlock" && f ? f.units : 0 });
};
export const farmRelease: WriteEndpoint<ImBook, ReleaseArgs, Released, ImDispatch> = {
  method: "POST",
  path: a => `/api/farms/${encodeURIComponent(a.id)}/release`,
  body: a => ({ version: a.version }),
  pick: j => j as Released,
  fixture: releaseFixture("releaseBlock"),
  onLiveError: imLiveError,
};
export const farmTakeBack: WriteEndpoint<ImBook, ReleaseArgs, Released, ImDispatch> = {
  method: "DELETE",
  path: a => `/api/farms/${encodeURIComponent(a.id)}/release`,
  body: a => ({ version: a.version }),
  pick: j => j as Released,
  fixture: releaseFixture("holdBlock"),
  onLiveError: imLiveError,
};
