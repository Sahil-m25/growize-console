/* M08-S04-W1 — the reservation hold: GET /api/holds, /api/holds/land, /api/holds/[allotmentId] and the two writes
   POST /api/holds/[id]/extend and /release (server/holds).
   Live: the routes (Money seats read the whole book; the Head of Finance / super user extend and release).
   Fixture: the same answers projected from the demo book — the hold is the investor's own `hold` day, the allotment
   is the investor's Reserved allotment, the land is the shelf (FARMS + INV) — and Release runs the reducer's lapseHold. */

import type { HoldDetail, HoldLine, Holds } from "@/server/holds/holds";
import {
  FORFEIT, I, allotsOf, dueBy, farmShelf, gotBy, holdDays, isAM, llpName, may, notFin, nowDay, pageReadable, when, ymd,
  imReducer,
} from "@/lib/im";
import type { ImInvestor } from "@/lib/im";
import { fail, ok, type ReadEndpoint, type WriteEndpoint } from "../api";
import { imLiveError, type ImBook, type ImDispatch } from "./im";

type LandOk = Omit<Extract<Awaited<ReturnType<Holds["land"]>>, { ok: true }>, "ok">;
export type HoldsList = { holds: HoldLine[]; exposure: number; through: string; truncated: boolean; asOf: number };
export type LandRead = Pick<LandOk, "llps" | "free" | "total" | "released" | "reserved" | "allotted">;
export type HoldOne = { hold: HoldDetail; money: boolean };

const NO_BOOK = () => fail(403, "no-book", "This page is not part of your seat.");
const WINDOW = 21;

/* the book's hold day ("23 Sep") as the route's IST day ("2026-09-23") */
const holdIso = (b: ImBook, x: ImInvestor): string | null => { const ms = when(b.s.data.NOW, x.hold); return ms == null ? null : ymd(ms); };

/** One demo reservation as the route's HoldLine (money seats; `due` / `received` null for a seat behind the money wall). */
export function fixtureHoldLine(b: ImBook, x: ImInvestor): HoldLine | null {
  const { s, me } = b;
  const days = holdDays(s, x), ends = holdIso(b, x);
  if (days == null || !ends) return null;
  const a = allotsOf(s, me, x.id).find(y => y.Allocation_Status === "Reserved") ?? allotsOf(s, me, x.id)[0];
  const money = !notFin(s, me);
  return {
    allotmentId: a ? a.id : x.id, investor: { id: x.id, name: x.n },
    llp: a ? { id: a.LLP_Lookup, name: llpName(s, a) } : { id: "", name: null },
    units: x.units, holdEnds: ends, daysLeft: days, urgent: days <= 3, ranOut: days < 0,
    forfeitPerUnit: FORFEIT, forfeit: FORFEIT * x.units,
    due: money ? dueBy(s, me, x.id) : null, received: money ? gotBy(s, me, x.id) : null,
    /* the demo book keeps no extension on the Investors side (the lead side's EXT is its own) */
    extension: { state: null, days: null }, modifiedTime: null,
  };
}

export const holdsList: ReadEndpoint<ImBook, void, HoldsList> = {
  path: () => "/api/holds",
  pick: j => j as HoldsList,
  fixture(b) {
    const { s, me } = b;
    if (!pageReadable(s, me, "dash") || isAM(s, me) || notFin(s, me)) return NO_BOOK();
    const holds = s.data.INV.filter(x => x.st === "reserved" && x.hold && (holdDays(s, x) ?? 999) <= WINDOW)
      .map(x => fixtureHoldLine(b, x)).filter((h): h is HoldLine => !!h)
      .sort((a, c) => a.daysLeft - c.daysLeft || a.allotmentId.localeCompare(c.allotmentId));
    return ok({ holds, exposure: holds.reduce((t, h) => t + h.forfeit, 0), through: ymd(nowDay(s.data.NOW) + WINDOW * 86_400_000), truncated: false, asOf: 0 });
  },
};

export const holdsLand: ReadEndpoint<ImBook, void, LandRead> = {
  path: () => "/api/holds/land",
  pick: j => j as LandRead,
  fixture(b) {
    const { s, me } = b;
    if (!pageReadable(s, me, "dash") || isAM(s, me) || notFin(s, me)) return NO_BOOK();
    const llps = s.data.FARMS.map(f => {
      const sh = farmShelf(s, f.k);
      const id = (s.data.LLP || []).find(l => l.Block_Code === f.k)?.id ?? f.k;
      return { id, name: f.n, block: f.k, totalUnits: f.units, released: f.released, notReleased: f.released === 0, allotted: sh.al,
        reserved: sh.re + sh.pd, free: sh.fr, oversold: sh.used > f.released, offShelf: Math.max(0, f.units - f.released) };
    });
    const sum = (f: (l: (typeof llps)[number]) => number) => llps.reduce((t, l) => t + f(l), 0);
    return ok({ llps, free: sum(l => l.free), total: sum(l => l.totalUnits), released: sum(l => l.released), reserved: sum(l => l.reserved), allotted: sum(l => l.allotted) });
  },
};

/** One reservation, by allotment id. `path` is the cache key: it names the allotment. */
export const holdOne: ReadEndpoint<ImBook, string | null, HoldOne> = {
  path: id => (id ? `/api/holds/${encodeURIComponent(id)}` : null),
  pick: j => j as HoldOne,
  fixture(b, id) {
    const { s, me } = b;
    if (!pageReadable(s, me, "inv")) return NO_BOOK();
    const a = (s.data.ALLOT || []).find(y => y.id === id && y.Allocation_Status === "Reserved");
    const x = a ? I(s, me, a.Customer) : null;
    if (!a || !x || !x.hold) return fail(404, "not-found", "Not found, or not yours to open.");
    const line = fixtureHoldLine(b, x);
    if (!line) return fail(404, "not-found", "Not found, or not yours to open.");
    const money = !notFin(s, me), mayRelease = may(s, me, "refund");
    return ok({ money, hold: { ...line,
      onLapse: money ? { forfeit: line.forfeit, refund: Math.max(0, gotBy(s, me, x.id) - line.forfeit) } : null,
      offers: { release: mayRelease && line.ranOut, extend: mayRelease && !line.ranOut && line.extension.state !== "Requested" } } });
  },
};

/* ---- writes ------------------------------------------------------------------------------------- */
export type ExtendArgs = { id: string; days: number; reason: string; expectedModifiedTime: string | null };
export type Extended = { state: "pending-approval" | "extended"; from: string; to: string };
export const holdExtend: WriteEndpoint<ImBook, ExtendArgs, Extended, ImDispatch> = {
  method: "POST",
  path: a => `/api/holds/${encodeURIComponent(a.id)}/extend`,
  body: a => ({ days: a.days, reason: a.reason, expectedModifiedTime: a.expectedModifiedTime }),
  pick: j => j as Extended,
  /* the Investors demo book has no extension action: the answer is the route's (held for approval), nothing is written */
  fixture(b, _d, a) {
    const one = holdOne.fixture(b, a.id);
    if (!one.ok) return one;
    if (!one.data.hold.offers.extend) return fail(403, "not-allowed", "Only the Head of Finance can extend a running hold.");
    const from = one.data.hold.holdEnds;
    return ok({ state: "pending-approval" as const, from, to: ymd(Date.parse(from + "T00:00:00Z") + a.days * 86_400_000) });
  },
  onLiveError: imLiveError,
};

export type ReleaseArgs = { id: string };
export type Released = { state: "pending-approval" | "released"; units: number; forfeit: number; refund: number };
export const holdRelease: WriteEndpoint<ImBook, ReleaseArgs, Released, ImDispatch> = {
  method: "POST",
  path: a => `/api/holds/${encodeURIComponent(a.id)}/release`,
  pick: j => j as Released,
  /* the caller has already confirmed in the page: lapseHold asks (confirm), so the confirmation is replayed */
  fixture(b, d, a) {
    const one = holdOne.fixture(b, a.id);
    if (!one.ok) return one;
    const h = one.data.hold, inv = h.investor.id;
    const peek = imReducer(imReducer({ ...b.s, ui: { ...b.s.ui, NOTE: null, PENDING: null } }, b.me, { type: "lapseHold", id: inv }), b.me, { type: "confirmYes" });
    if (peek.ui.NOTE) return fail(422, "refused", peek.ui.NOTE.msg);
    d({ type: "lapseHold", id: inv }); d({ type: "confirmYes" });
    return ok({ state: "released" as const, units: h.units, forfeit: h.onLapse?.forfeit ?? h.forfeit, refund: h.onLapse?.refund ?? 0 });
  },
  onLiveError: imLiveError,
};
