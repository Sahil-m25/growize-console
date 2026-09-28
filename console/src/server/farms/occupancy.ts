/**
 * M11-S03-T02 — THE SHELF AND WHO IS ON WHICH LLP: released, allotted, reserved-or-paid and free per farm LLP
 * (D15, D45, D53, D54, D70).
 *
 * "No unit is sold twice because the free figure is arithmetic, not typed": the LLP's Units_Reserved /
 * Units_Issued are plain integer fields in the org (getFields, 28 Sep 2026 — no formula, no roll-up), so they are
 * NOT the count. The count is taken off the allotment records (LLP_UnitAllocation_Module) with one COQL aggregate
 * on the person's own token, grouped by LLP and Allocation_Status — Reserved counts Reserved_Units, Issued counts
 * Issued_Units, Cancelled counts nothing (../investors/allotments' rule). Per LLP:
 *     released  = Units_Released (the LLP's field; null or 0 → not released)
 *     allotted  = Σ Issued_Units of Issued allotments
 *     reservedOrPaid = Σ Reserved_Units of Reserved allotments   (paid = the part whose Receivable is 0 and Received > 0 —
 *                      Money seats only; the account-management wall never names a money field, D12/D40)
 *     free      = max(0, released − allotted − reservedOrPaid); oversold when that difference is negative.
 * The tiles sum the LLPs; the free tile is released − allotted − reservedOrPaid (negative → oversold), as the page reads it.
 * Where the seat reads the whole book (org / all) and the LLP's typed Units_Reserved / Units_Issued disagree with
 * the count, the LLP says so (`recordedDiffers`) — the arithmetic stands, the typed field is the one to fix.
 *
 * The counts are aggregates, cached (D52/D53) under the key of what the token can see: the seat's Investors scope
 * (org / all / subtree / own-book / own-lead), or the person alone for a seat with no Investors book — never the
 * farms "org" key, because a KAM's or an IR's token may not see every allotment and must not fill Finance's number.
 * `countsComplete` is false for those narrower seats (PROVISIONAL until Sahil's M11-S03-T01 roll-ups on the LLP
 * give every token the org-true figure).
 *
 * "Who is on which LLP" is rows: read per response, never cached (D45), within the seat's Investors scope — the
 * WHERE carries the scope through the Customer lookup (an IR's Originating_IR + Origin_Lead, a KAM's KAM) and every
 * row is re-admitted with ../data/ir-guard admitContact; one that is not refuses the whole read (scope drift,
 * Plane B), never trimmed. A seat without an Investors book sees the shelf's numbers and no names.
 * This read is read-only: releasing land or taking it back is ./release.ts; the one-LLP fresh count those guards
 * (and ./oversell.ts) read is `heldOn` below.
 */

import type { UserCredential, ZohoRecord } from "../../lib/zoho/client";
import { admitContact } from "../data/ir-guard";
import { checkAmProjection, checkProjection, MODULES } from "../data/projections";
import { scopedKey, scopesFor, type BookScope } from "../data/scope";
import { idOf, num, pagedSelect, RECORD_ID, str } from "../cases/predicate";
import { sectionsFor } from "../investors/record";
import { createFarmShelf, type FarmRow, type FarmsDeps, type FarmsPrincipal, type ShelfFailure, type ShelfRefusal } from "./shelf";

const ALLOT = MODULES.allotments;
const LIVE = "Allocation_Status in ('Reserved', 'Issued')";
/** Who is on which LLP: the investor through the lookup, units and status — no money field (checked at load). */
export const OCCUPANT_FIELDS = checkAmProjection(MODULES.amAllotments, [
  "id", "Customer", "Customer.Full_Name", "Customer.ARL_ID", "Customer.KAM", "Customer.Origin_Lead", "Customer.Originating_IR",
  "LLP", "Allocation_Status", "Reserved_Units", "Issued_Units",
]);
/** The same, for a Money seat: plus Received / Receivable to tell a paid reservation. */
export const OCCUPANT_MONEY_FIELDS = checkProjection(MODULES.allotments, [...OCCUPANT_FIELDS, "Total_Amount_Received", "Total_Amount_Receivable"]);
export const COUNT_QUERY = `select LLP, Allocation_Status, SUM(Reserved_Units), SUM(Issued_Units) from ${ALLOT} where ${LIVE} group by LLP, Allocation_Status`;
export const PAID_QUERY = `select LLP, SUM(Reserved_Units) from ${ALLOT} where Allocation_Status = 'Reserved' and Total_Amount_Receivable = 0 and Total_Amount_Received > 0 group by LLP`;

export interface LlpShelf {
  readonly id: string;
  readonly name: string;
  readonly block: string | null;
  readonly acres: number | null;
  readonly totalUnits: number | null;
  /** Units_Released; 0 when not set. */
  readonly released: number;
  readonly notReleased: boolean;
  readonly allotted: number;
  readonly reservedOrPaid: number;
  /** Of reservedOrPaid, fully paid and not yet allotted; null where Money is hidden. */
  readonly paid: number | null;
  /** reservedOrPaid − paid; equals reservedOrPaid where Money is hidden. */
  readonly reserved: number;
  readonly free: number;
  readonly oversold: boolean;
  /** Org-wide seats only: the LLP's typed Units_Reserved / Units_Issued disagree with the count. */
  readonly recordedDiffers: boolean;
  readonly status: FarmRow["status"];
  readonly cropStage: string | null;
}
export type ShelfTiles = Readonly<{ acres: number; units: number; released: number; allotted: number; reservedOrPaid: number; free: number; oversold: boolean }>;
export interface Occupant {
  readonly allotmentId: string;
  readonly investorId: string;
  readonly name: string | null;
  readonly code: string | null;
  readonly llpId: string;
  readonly status: "Reserved" | "Issued";
  readonly units: number;
  /** A Reserved allotment fully paid; null where Money is hidden. */
  readonly paid: boolean | null;
}
export type OccupancyResult =
  | { readonly ok: true; readonly llps: readonly LlpShelf[]; readonly tiles: ShelfTiles; readonly occupants: readonly Occupant[];
      readonly countsComplete: boolean; readonly namesShown: boolean; readonly money: boolean; readonly asOf: number; readonly stale: boolean;
      readonly truncated: boolean; readonly superUser: boolean }
  | ShelfRefusal | ShelfFailure | { readonly ok: false; readonly kind: "refused"; readonly reason: "scope-drift" };

type Counts = Readonly<Record<string, number>>;
const retryable = (k: string) => k === "network" || k === "server" || k === "busy" || k === "concurrency-exceeded";

/** The cache scope of the counts: what this token can see (the Investors scope), or the person alone. */
export function countScopeOf(seat: string, userId: string): BookScope {
  const s = scopesFor(seat, userId).investors;
  return s.kind === "none" ? Object.freeze({ kind: "user", userId }) : s;
}

/** The occupants' WHERE for a scope, through the Customer lookup; null for a scope without names. */
export function occupantsWhere(scope: BookScope): string | null {
  switch (scope.kind) {
    case "own-lead": return `${LIVE} and Customer.Originating_IR = '${scope.userId}' and Customer.Origin_Lead is not null`;
    case "own-book": return `${LIVE} and Customer.KAM = '${scope.userId}'`;
    case "subtree": case "org": case "all": return LIVE;
    default: return null;
  }
}

export function createFarmOccupancy(deps: FarmsDeps) {
  const shelf = createFarmShelf(deps);

  const aggregate = async (cred: UserCredential, q: string, signal?: AbortSignal): Promise<Counts> => {
    const r = await deps.crm.aggregate(cred, q, { signal });
    if (!r.ok) throw Object.assign(new Error("zoho"), { kind: r.error.kind });
    const out: Record<string, number> = {};
    for (const row of r.value) {
      const llp = typeof row.LLP === "string" ? row.LLP : null;
      if (!llp) continue;
      const st = row.Allocation_Status;
      const add = (k: string, v: unknown) => { if (typeof v === "number" && Number.isFinite(v)) out[k] = (out[k] ?? 0) + v; };
      if (st === "Issued") add(`${llp}:i`, row["SUM(Issued_Units)"]);
      else if (st === "Reserved") add(`${llp}:r`, row["SUM(Reserved_Units)"]);
      else if (st === undefined) add(`${llp}:p`, row["SUM(Reserved_Units)"]);
    }
    return out;
  };

  return Object.freeze({
    async read(p: FarmsPrincipal, signal?: AbortSignal): Promise<OccupancyResult> {
      const list = await shelf.list(p, signal);
      if (!list.ok) return list;
      const me = p.credential.userId;
      const invScope = scopesFor(p.seat, me).investors;
      const cScope = countScopeOf(p.seat, me);
      const money = (sectionsFor(p.seat, me) ?? []).includes("money");
      const countsComplete = invScope.kind === "org" || invScope.kind === "all";

      const counts = await deps.cache.readSettled<Counts>(scopedKey<Counts>(cScope, "farms.occupancy"), () => aggregate(p.credential, COUNT_QUERY, signal));
      if (counts.state === "error") return { ok: false, kind: "source-error", errorKind: counts.reason, retryable: retryable(counts.reason) };
      let paidCounts: Counts | null = null;
      if (money) {
        const pc = await deps.cache.readSettled<Counts>(scopedKey<Counts>(cScope, "farms.occupancy.paid"), async () => {
          const raw = await aggregate(p.credential, PAID_QUERY, signal);
          return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k.replace(/:p$/, ":paid"), v]));
        });
        if (pc.state === "error") return { ok: false, kind: "source-error", errorKind: pc.reason, retryable: retryable(pc.reason) };
        paidCounts = pc.value;
      }
      const c = counts.value;

      const llps: LlpShelf[] = list.rows.map((f) => {
        const released = Math.max(0, f.releasedUnits ?? 0);
        const allotted = c[`${f.id}:i`] ?? 0, reservedOrPaid = c[`${f.id}:r`] ?? 0;
        const paid = paidCounts ? Math.min(reservedOrPaid, paidCounts[`${f.id}:paid`] ?? 0) : null;
        const left = released - allotted - reservedOrPaid;
        return Object.freeze({
          id: f.id, name: f.name, block: f.block, acres: f.acres, totalUnits: f.totalUnits,
          released, notReleased: released === 0, allotted, reservedOrPaid, paid, reserved: reservedOrPaid - (paid ?? 0),
          free: Math.max(0, left), oversold: left < 0,
          recordedDiffers: countsComplete && (f.reservedUnits !== reservedOrPaid || f.issuedUnits !== allotted),
          status: f.status, cropStage: f.cropStage,
        });
      });
      const sum = (g: (x: LlpShelf) => number) => llps.reduce((t, x) => t + g(x), 0);
      const released = sum((x) => x.released), allotted = sum((x) => x.allotted), reservedOrPaid = sum((x) => x.reservedOrPaid);
      const tiles: ShelfTiles = Object.freeze({
        acres: Math.round(sum((x) => x.acres ?? 0) * 100) / 100, units: sum((x) => x.totalUnits ?? 0),
        released, allotted, reservedOrPaid, free: released - allotted - reservedOrPaid, oversold: released - allotted - reservedOrPaid < 0,
      });

      // Who is on which LLP — rows, within the seat's Investors scope, never cached.
      const where = occupantsWhere(invScope);
      const occupants: Occupant[] = [];
      let truncated = list.truncated;
      if (where) {
        const r = await pagedSelect(deps.crm, p.credential, money ? OCCUPANT_MONEY_FIELDS : OCCUPANT_FIELDS, ALLOT, where, "id asc", signal, deps.maxPages);
        if (!r.ok) return r.kind === "refused" ? { ok: false, kind: "refused", reason: r.reason } : r;
        truncated ||= r.truncated;
        const foreign: string[] = [];
        for (const x of r.rows) {
          const o = occupantOf(x, money);
          if (!o) continue;
          const admitted = admitContact(invScope, { originLeadId: idOf(x["Customer.Origin_Lead"]), originatingIrId: idOf(x["Customer.Originating_IR"]), kamId: idOf(x["Customer.KAM"]) });
          if (!admitted.ok) { foreign.push(o.allotmentId); continue; }
          occupants.push(o);
        }
        if (foreign.length) {
          deps.events.refusal(me, "farm-occupancy", "scope-drift", foreign);
          return { ok: false, kind: "refused", reason: "scope-drift" };
        }
      }
      return {
        ok: true, llps: Object.freeze(llps), tiles, occupants: Object.freeze(occupants), countsComplete, namesShown: where !== null, money,
        asOf: counts.asOf, stale: counts.state !== "fresh", truncated, superUser: list.superUser,
      };
    },
  });
}
export type FarmOccupancy = ReturnType<typeof createFarmOccupancy>;

function occupantOf(x: ZohoRecord, money: boolean): Occupant | null {
  const allotmentId = idOf(x.id), investorId = idOf(x.Customer), llpId = idOf(x.LLP);
  if (!allotmentId || !investorId || !llpId) return null;
  const st = str(x, "Allocation_Status", 20);
  if (st !== "Reserved" && st !== "Issued") return null;
  const units = Math.max(0, (st === "Issued" ? num(x, "Issued_Units") : num(x, "Reserved_Units")) ?? 0);
  const received = money ? num(x, "Total_Amount_Received") : null, receivable = money ? num(x, "Total_Amount_Receivable") : null;
  return Object.freeze({
    allotmentId, investorId, llpId, status: st, units,
    name: str(x, "Customer.Full_Name", 120), code: str(x, "Customer.ARL_ID", 40),
    paid: money ? st === "Reserved" && receivable === 0 && (received ?? 0) > 0 : null,
  });
}

/* ---- M11-S04 / M11-S07: the units held on ONE LLP, read fresh for a guard ---------------------------------------
 * The same rule as the shelf (Reserved counts Reserved_Units, Issued counts Issued_Units, Cancelled nothing), but
 * never through the cache: a guard that refuses or allows a write must read the count as Zoho has it now. One COQL
 * aggregate on the person's own token (D53); `exceptAllotmentId` leaves out the allotment being edited, so an
 * update is measured against everything else on the LLP. Counts only — no row, no name. */
export const heldQuery = (llpId: string, exceptAllotmentId: string | null = null): string =>
  `select Allocation_Status, SUM(Reserved_Units), SUM(Issued_Units) from ${ALLOT} where LLP = '${llpId}' and ${LIVE}` +
  (exceptAllotmentId ? ` and id != '${exceptAllotmentId}'` : "") + " group by Allocation_Status";

export type HeldCount =
  | { readonly ok: true; readonly allotted: number; readonly reserved: number; readonly held: number }
  | { readonly ok: false; readonly kind: "source-error"; readonly errorKind: string; readonly retryable: boolean };

export async function heldOn(
  crm: Pick<FarmsDeps["crm"], "aggregate">, cred: UserCredential, llpId: string,
  opts: { readonly exceptAllotmentId?: string | null; readonly signal?: AbortSignal } = {},
): Promise<HeldCount> {
  const except = opts.exceptAllotmentId ?? null;
  if (!RECORD_ID.test(llpId) || (except !== null && !RECORD_ID.test(except))) throw new TypeError("heldOn() takes record ids.");
  let r: Awaited<ReturnType<FarmsDeps["crm"]["aggregate"]>>;
  try { r = await crm.aggregate(cred, heldQuery(llpId, except), { signal: opts.signal }); }
  catch { return { ok: false, kind: "source-error", errorKind: "unexpected", retryable: true }; }
  if (!r.ok) return { ok: false, kind: "source-error", errorKind: r.error.kind, retryable: retryable(r.error.kind) };
  let allotted = 0, reserved = 0;
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, v) : 0);
  for (const row of r.value) {
    if (row.Allocation_Status === "Issued") allotted += n(row["SUM(Issued_Units)"]);
    else if (row.Allocation_Status === "Reserved") reserved += n(row["SUM(Reserved_Units)"]);
  }
  return { ok: true, allotted, reserved, held: allotted + reserved };
}
