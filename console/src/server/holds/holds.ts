/**
 * M08-S04-T04 — HOLDS AND LAND READS for Today (Investors side), the investor record and the lead page (D21, D45, D53).
 *
 *   list   Reserved allotments whose hold ends on or before today + 21 (IST), run-out ones included, each with
 *          days left by the one IST function (./rules), units, farm (LLP), balance due (committed − matched
 *          receipts through ../money/ledger, the register's rule — reversals cancel their target) and the forfeit;
 *          sorted by days left; total forfeit exposure. Money costs one Receipts row read per 100 allotments (one call
 *          per 2,000 receipts in that chunk).
 *          Money seats reading the whole book only (Finance, Head of Finance, viewers, the super user).
 *   one    one allotment's hold for the record banner / lead alert: any seat that may open the investor, on its
 *          own token, re-admitted against the seat's Investors scope (ir-guard admitContact). Money (due, refund)
 *          only for a Money seat — the account-management wall never names a money field (D12/D40).
 *   land   per-LLP free of total units and reserved units: ../farms/occupancy (imported, one rule for the shelf).
 * Rows are read per response and never cached (D45); logs carry ids and codes only.
 */

import type { UserCredential, ZohoClient, ZohoRecord } from "../../lib/zoho/client";
import type { ScopedCache } from "../../lib/zoho/cache";
import { coqlAll } from "../../lib/zoho/coql";
import type { InvestorEvents } from "../data/events";
import { admitContact } from "../data/ir-guard";
import { checkAmProjection, checkProjection, MODULES } from "../data/projections";
import { scopesFor } from "../data/scope";
import { idOf, inClause, IN_CHUNK, num, pagedSelect, str } from "../cases/predicate";
import { createFarmOccupancy } from "../farms/occupancy";
import { sectionsFor } from "../investors/record";
import {
  commitmentOf, dayOf, daysLeft, dueOf, FORFEIT_PER_UNIT, HOLD_WINDOW_DAYS, holdUntilFrom, lapseMoney,
  matchedMoneyOf, readLedgerReceipts, URGENT_DAYS,
} from "./rules";

const ALLOT = MODULES.allotments;
/** The hold line without money: units, farm, deadline, extension (the AM/IR wall, checked at load). */
export const HOLD_FIELDS = checkAmProjection(MODULES.amAllotments, [
  "id", "Customer", "Customer.Full_Name", "Customer.Origin_Lead", "Customer.Originating_IR", "Customer.KAM",
  "LLP", "LLP.Name", "Allocation_Status", "Reserved_Units", "Hold_Until", "Hold_Extension_State", "Hold_Extension_Days", "Modified_Time",
]);
/** The same for a Money seat: plus the unit price, so the balance due is committed − matched receipts. */
export const HOLD_MONEY_FIELDS = checkProjection(ALLOT, [...HOLD_FIELDS, "Unit_Price"]);

export interface HoldsDeps {
  readonly crm: Pick<ZohoClient, "coql" | "aggregate">;
  readonly cache: ScopedCache;
  readonly events: InvestorEvents;
  readonly clock?: () => number;
  readonly maxPages?: number;
}
export interface HoldsPrincipal {
  readonly credential: UserCredential;
  readonly seat: string;
  /** The seat holds the "refund" right (Head of Finance, super user): release and extend are offered. */
  readonly mayRelease?: boolean;
}

export interface HoldLine {
  readonly allotmentId: string;
  readonly investor: { readonly id: string; readonly name: string | null };
  readonly llp: { readonly id: string; readonly name: string | null };
  readonly units: number;
  /** The hold's last day, "YYYY-MM-DD" (Asia/Kolkata). */
  readonly holdEnds: string;
  readonly daysLeft: number;
  readonly urgent: boolean;
  readonly ranOut: boolean;
  readonly forfeitPerUnit: number;
  readonly forfeit: number;
  /** null where Money is hidden. */
  readonly due: number | null;
  readonly received: number | null;
  readonly extension: { readonly state: "Requested" | "Approved" | "Declined" | null; readonly days: number | null };
  readonly modifiedTime: string | null;
}
export interface HoldDetail extends HoldLine {
  /** What a lapse would keep and return; null where Money is hidden. */
  readonly onLapse: { readonly forfeit: number; readonly refund: number } | null;
  readonly offers: { readonly release: boolean; readonly extend: boolean };
}
export type HoldsRefusal = { readonly ok: false; readonly kind: "refused"; readonly reason: "no-book" | "not-found" | "invalid-request" | "scope-drift" | "source-invalid" };
export type HoldsFailure = { readonly ok: false; readonly kind: "source-error"; readonly errorKind: string; readonly retryable: boolean };

const retryable = (k: string) => k === "network" || k === "server" || k === "busy" || k === "concurrency-exceeded";
const EXT = new Set(["Requested", "Approved", "Declined"]);

/** A Money seat reading the whole book: sees every hold and its balance. */
export function holdsBookOf(seat: string, userId: string): { readonly money: boolean; readonly whole: boolean } {
  const inv = scopesFor(seat, userId).investors;
  return { money: (sectionsFor(seat, userId) ?? []).includes("money"), whole: inv.kind === "org" || inv.kind === "all" };
}

export function createHolds(deps: HoldsDeps) {
  const clock = deps.clock ?? Date.now;

  const matched = async (cred: UserCredential, ids: readonly string[], signal?: AbortSignal) => {
    const entries = [];
    for (let i = 0; i < ids.length; i += IN_CHUNK) {
      const r = await readLedgerReceipts(deps.crm, cred, inClause("Allotment", ids.slice(i, i + IN_CHUNK))!, { signal });
      if (!r.ok) return r.errorKind === "truncated"
        ? { ok: false as const, kind: "refused" as const, reason: "source-invalid" as const }
        : { ok: false as const, kind: "source-error" as const, errorKind: r.errorKind, retryable: retryable(r.errorKind) };
      entries.push(...r.entries);
    }
    return { ok: true as const, money: matchedMoneyOf(entries) };
  };

  const lineOf = (x: ZohoRecord, now: number, net: number | null): HoldLine | null => {
    const allotmentId = idOf(x.id), investorId = idOf(x.Customer), llpId = idOf(x.LLP), holdEnds = dayOf(x.Hold_Until);
    const units = num(x, "Reserved_Units");
    if (!allotmentId || !investorId || !llpId || !holdEnds || units === null || units < 0 || !Number.isSafeInteger(units)) return null;
    let due: number | null = null;
    if (net !== null) {
      const committed = commitmentOf(units, x.Unit_Price);
      if (committed === null) return null;
      due = dueOf(committed, net);
    }
    const d = daysLeft(holdEnds, now), st = str(x, "Hold_Extension_State", 20);
    return Object.freeze({
      allotmentId, investor: Object.freeze({ id: investorId, name: str(x, "Customer.Full_Name", 120) }),
      llp: Object.freeze({ id: llpId, name: str(x, "LLP.Name", 120) }), units, holdEnds, daysLeft: d,
      urgent: d <= URGENT_DAYS, ranOut: d < 0, forfeitPerUnit: FORFEIT_PER_UNIT, forfeit: FORFEIT_PER_UNIT * units,
      due, received: net === null ? null : Math.max(0, net),
      extension: Object.freeze({ state: st && EXT.has(st) ? (st as "Requested" | "Approved" | "Declined") : null, days: num(x, "Hold_Extension_Days") }),
      modifiedTime: str(x, "Modified_Time", 40),
    });
  };

  return Object.freeze({
    /** Holds running (and run out, not yet released) with deadline <= today + 21, by days left. */
    async list(p: HoldsPrincipal, signal?: AbortSignal): Promise<
      | { readonly ok: true; readonly holds: readonly HoldLine[]; readonly exposure: number; readonly through: string; readonly truncated: boolean; readonly asOf: number }
      | HoldsRefusal | HoldsFailure> {
      const me = p.credential.userId;
      const book = holdsBookOf(p.seat, me);
      if (!book.money || !book.whole) {
        deps.events.refusal(me, "holds-list", "seat-denied");
        return { ok: false, kind: "refused", reason: "no-book" };
      }
      const now = clock();
      const through = holdUntilFrom(now, HOLD_WINDOW_DAYS);
      const r = await pagedSelect(deps.crm, p.credential, HOLD_MONEY_FIELDS, ALLOT,
        coqlAll(["Allocation_Status = 'Reserved'", "Hold_Until is not null", `Hold_Until <= '${through}'`]), "Hold_Until asc", signal, deps.maxPages);
      if (!r.ok) return r.kind === "refused" ? { ok: false, kind: "refused", reason: r.reason } : r;
      const ids = r.rows.map((x) => idOf(x.id)).filter((x): x is string => !!x);
      const m = ids.length ? await matched(p.credential, ids, signal) : { ok: true as const, money: matchedMoneyOf([]) };
      if (!m.ok) return m;
      const holds: HoldLine[] = [];
      const bad: string[] = [];
      for (const x of r.rows) {
        const id = idOf(x.id);
        const line = lineOf(x, now, id ? m.money.byAllotment.get(id) ?? 0 : 0);
        if (line) holds.push(line); else if (id) bad.push(id);
      }
      if (bad.length) {
        deps.events.refusal(me, "holds-list", "source-invalid", bad);
        return { ok: false, kind: "refused", reason: "source-invalid" };
      }
      holds.sort((a, b) => a.daysLeft - b.daysLeft || a.allotmentId.localeCompare(b.allotmentId));
      return { ok: true, holds: Object.freeze(holds), exposure: holds.reduce((t, h) => t + h.forfeit, 0), through, truncated: r.truncated, asOf: now };
    },

    /** One allotment's hold, for the record banner and the lead page's alert. */
    async one(p: HoldsPrincipal, allotmentId: unknown, signal?: AbortSignal): Promise<{ readonly ok: true; readonly hold: HoldDetail; readonly money: boolean } | HoldsRefusal | HoldsFailure> {
      const me = p.credential.userId;
      if (typeof allotmentId !== "string" || !idOf(allotmentId)) return { ok: false, kind: "refused", reason: "invalid-request" };
      const scope = scopesFor(p.seat, me).investors;
      if (scope.kind === "none" || scope.kind === "user") {
        deps.events.refusal(me, "hold-one", "seat-denied", [allotmentId]);
        return { ok: false, kind: "refused", reason: "no-book" };
      }
      const book = holdsBookOf(p.seat, me);
      const r = await pagedSelect(deps.crm, p.credential, book.money ? HOLD_MONEY_FIELDS : HOLD_FIELDS, ALLOT,
        `id = '${allotmentId}' and Allocation_Status = 'Reserved'`, "id asc", signal, 1);
      if (!r.ok) return r.kind === "refused" ? { ok: false, kind: "refused", reason: r.reason } : r;
      const x = r.rows.find((y) => idOf(y.id) === allotmentId);
      if (!x) return { ok: false, kind: "refused", reason: "not-found" };
      const admitted = admitContact(scope, { originLeadId: idOf(x["Customer.Origin_Lead"]), originatingIrId: idOf(x["Customer.Originating_IR"]), kamId: idOf(x["Customer.KAM"]) });
      if (!admitted.ok) {
        deps.events.refusal(me, "hold-one", "scope-drift", [allotmentId]);
        return { ok: false, kind: "refused", reason: "scope-drift" };
      }
      let net: number | null = null;
      if (book.money) {
        const m = await matched(p.credential, [allotmentId], signal);
        if (!m.ok) return m;
        net = m.money.byAllotment.get(allotmentId) ?? 0;
      }
      const line = lineOf(x, clock(), net);
      if (!line) {
        deps.events.refusal(me, "hold-one", "source-invalid", [allotmentId]);
        return { ok: false, kind: "refused", reason: "source-invalid" };
      }
      const may = p.mayRelease === true;
      return { ok: true, money: book.money, hold: Object.freeze({
        ...line,
        onLapse: net === null ? null : lapseMoney(line.units, net),
        offers: Object.freeze({ release: may && line.ranOut, extend: may && !line.ranOut && line.extension.state !== "Requested" }),
      }) };
    },

    /** The Land card: per LLP free of total units and reserved units (../farms/occupancy). */
    async land(p: HoldsPrincipal, signal?: AbortSignal) {
      const r = await createFarmOccupancy(deps).read({ credential: p.credential, seat: p.seat }, signal);
      if (!r.ok) return r;
      return {
        ok: true as const,
        llps: Object.freeze(r.llps.map((l) => Object.freeze({
          id: l.id, name: l.name, block: l.block, totalUnits: l.totalUnits, released: l.released, notReleased: l.notReleased,
          allotted: l.allotted, reserved: l.reservedOrPaid, free: l.free, oversold: l.oversold,
          offShelf: l.notReleased ? l.totalUnits ?? 0 : Math.max(0, (l.totalUnits ?? 0) - l.released),
        }))),
        free: r.tiles.free, total: r.tiles.units, released: r.tiles.released, reserved: r.tiles.reservedOrPaid, allotted: r.tiles.allotted,
        countsComplete: r.countsComplete, asOf: r.asOf, stale: r.stale,
      };
    },
  });
}
export type Holds = ReturnType<typeof createHolds>;
