/**
 * M11-S01-T02 — THE LLP SHELF: Farms read live from LLP_Creation_Module (D45, D53, D54, D68, D70).
 *
 * One row per LLP record — a "block" is an LLP, nothing else holds one. Every read is a COQL SELECT on the
 * signed-in person's own token; rows live for one response. free = total − reserved − issued is computed
 * on read (never stored). The only thing cached is the shelf's unit totals, keyed by the person's farms
 * scope (server/data/scope: org for every seat, all for the super user) — D52/D53.
 *
 * Field names are the org as found (read-only getFields, 28 Sep 2026): the price is `Pet_Unit_Price`
 * (label "Per Unit Price"), yield is a picklist of "NN%", the status picklist carries the typo "Darft" and
 * "Fully Subscribed / Closed" and "On Hold". Units_Reserved / Units_Issued are fields on the LLP.
 *
 * The one-LLP detail also reads the LLP's own PAN and GST (a company's, not a person's — PROVISIONAL, jev
 * decide a 0.94): masked here with lib/zoho/identity maskPan before they leave the server, never cached,
 * never logged. Zoho's field-level security still decides whether the token may read them at all; a field
 * the token may not read simply comes back absent and shows as not visible.
 */

import type { CacheError, CacheFresh, CacheStale, ScopedCache } from "../../lib/zoho/cache";
import type { UserCredential, ZohoClient, ZohoRecord } from "../../lib/zoho/client";
import { maskPan } from "../../lib/zoho/identity";
import type { InvestorEvents } from "../data/events";
import { checkProjection } from "../data/projections";
import { scopedKey, scopesFor, type BookScope } from "../data/scope";
import { day, idOf, num, pagedSelect, RECORD_ID, str } from "../cases/predicate";

export const LLP_MODULE = "LLP_Creation_Module";
/** The list projection: no PAN, GST or SPOC — the shelf does not need them (checked at load). */
export const SHELF_FIELDS = checkProjection(LLP_MODULE, [
  "id", "Name", "Block_Code", "Acreage_Acres", "Total_Units", "Units_Reserved", "Units_Issued", "Units_Released",
  "Pet_Unit_Price", "LLP_Status", "Annual_Rental_Yield", "Crop_Stage",
  "Insurance_Provider", "Insurance_Policy_No", "Insured_Amount", "Insurance_expiry_date",
]);
/** The detail adds the LLP's company PAN/GST (masked on read) and its two SPOCs. */
export const DETAIL_FIELDS = Object.freeze([...SHELF_FIELDS, "PAN", "GST", "SPOC_1_Full_Name", "SPOC_1_Contact_No", "SPOC_2_Full_Name", "SPOC_2_Contact_No", "Incorporation_No"]);

export type FarmStatus = "Draft" | "Open for Reservation" | "Open for Issuance" | "Fully Subscribed" | "Active" | "On Hold" | "Unknown";
const STATUS_OF: Readonly<Record<string, FarmStatus>> = Object.freeze({
  Darft: "Draft", Draft: "Draft", "Open for Reservation": "Open for Reservation", "Open for Issuance": "Open for Issuance",
  "Fully Subscribed / Closed": "Fully Subscribed", "Fully Subscribed": "Fully Subscribed", Active: "Active", "On Hold": "On Hold",
});
/** The org's picklist value → the console's status. Unknown values are shown as such, never guessed on sale. */
export const farmStatusOf = (raw: string | null): FarmStatus => (raw && Object.hasOwn(STATUS_OF, raw) ? STATUS_OF[raw]! : "Unknown");

export interface FarmRow {
  readonly id: string;
  readonly name: string;
  readonly block: string | null;
  readonly acres: number | null;
  readonly totalUnits: number | null;
  readonly reservedUnits: number;
  readonly issuedUnits: number;
  /** total − reserved − issued, floored at 0; null when the total is not set. */
  readonly freeUnits: number | null;
  readonly releasedUnits: number | null;
  readonly unitPrice: number | null;
  readonly status: FarmStatus;
  /** Open for Reservation / Open for Issuance. Draft, On Hold and unknown are not on sale. */
  readonly onSale: boolean;
  /** Only Open for Reservation offers a reservation. */
  readonly reservable: boolean;
  readonly yieldPct: number | null;
  readonly cropStage: string | null;
  readonly insurance: { readonly provider: string | null; readonly policyNo: string | null; readonly amount: number | null; readonly till: string | null };
}

export interface FarmDetail extends FarmRow {
  /** Masked (ABC•••••K); null when the token may not read it or it is empty. */
  readonly pan: string | null;
  readonly gst: string | null;
  readonly incorporationNo: string | null;
  readonly spocs: readonly { readonly name: string; readonly phone: string | null }[];
}

export type ShelfTotals = Readonly<Record<"llps" | "total" | "reserved" | "issued" | "free", number>>;
export type TotalsRead = CacheFresh<ShelfTotals> | CacheStale<ShelfTotals> | CacheError<ShelfTotals>;

export interface FarmsPrincipal { readonly credential: UserCredential; readonly seat: string }

export type ShelfRefusal = { readonly ok: false; readonly kind: "refused"; readonly reason: "no-book" | "not-found" | "source-invalid" | "invalid-request" };
export type ShelfFailure = { readonly ok: false; readonly kind: "source-error"; readonly errorKind: string; readonly retryable: boolean };

export interface FarmsDeps {
  readonly crm: Pick<ZohoClient, "coql" | "aggregate">;
  readonly cache: ScopedCache;
  readonly events: InvestorEvents;
  readonly maxPages?: number;
}

export function farmOf(r: ZohoRecord): FarmRow | null {
  if (!idOf(r.id)) return null;
  const total = num(r, "Total_Units");
  const reserved = Math.max(0, num(r, "Units_Reserved") ?? 0);
  const issued = Math.max(0, num(r, "Units_Issued") ?? 0);
  const status = farmStatusOf(str(r, "LLP_Status", 60));
  return Object.freeze({
    id: r.id, name: str(r, "Name", 120) ?? "", block: str(r, "Block_Code", 20),
    acres: num(r, "Acreage_Acres"), totalUnits: total, reservedUnits: reserved, issuedUnits: issued,
    freeUnits: total === null ? null : Math.max(0, total - reserved - issued),
    releasedUnits: num(r, "Units_Released"), unitPrice: num(r, "Pet_Unit_Price"), status,
    onSale: status === "Open for Reservation" || status === "Open for Issuance",
    reservable: status === "Open for Reservation",
    yieldPct: num(r, "Annual_Rental_Yield"), cropStage: str(r, "Crop_Stage", 60),
    insurance: Object.freeze({
      provider: str(r, "Insurance_Provider", 120), policyNo: str(r, "Insurance_Policy_No", 60),
      amount: num(r, "Insured_Amount"), till: day(str(r, "Insurance_expiry_date", 40)),
    }),
  });
}

const masked = (v: string | null): string | null => (v ? maskPan(v.trim()) : null);

export function createFarmShelf(deps: FarmsDeps) {
  const scopeOf = (p: FarmsPrincipal): BookScope => scopesFor(p.seat, p.credential.userId).farms;
  const noBook = (p: FarmsPrincipal, action: string): ShelfRefusal => {
    deps.events.refusal(p.credential.userId, action, "seat-denied");
    return { ok: false, kind: "refused", reason: "no-book" };
  };

  /** Shelf totals under this person's farms scope — the rail/number tiles; never a row. */
  const totals = (p: FarmsPrincipal, scope: BookScope, signal?: AbortSignal): Promise<TotalsRead> =>
    deps.cache.readSettled<ShelfTotals>(scopedKey<ShelfTotals>(scope, "farms.units"), async () => {
      const r = await deps.crm.aggregate(p.credential,
        `select COUNT(id), SUM(Total_Units), SUM(Units_Reserved), SUM(Units_Issued) from ${LLP_MODULE} where id is not null`, { signal });
      if (!r.ok) throw Object.assign(new Error("zoho"), { kind: r.error.kind });
      const row = r.value[0] ?? {};
      const v = (k: string) => (typeof row[k] === "number" ? (row[k] as number) : 0);
      const total = v("SUM(Total_Units)"), reserved = v("SUM(Units_Reserved)"), issued = v("SUM(Units_Issued)");
      return { llps: v("COUNT(id)"), total, reserved, issued, free: Math.max(0, total - reserved - issued) };
    });

  return Object.freeze({
    /** Every LLP the person's token sees, as the shelf. */
    async list(p: FarmsPrincipal, signal?: AbortSignal): Promise<
      { readonly ok: true; readonly rows: readonly FarmRow[]; readonly truncated: boolean; readonly totals: TotalsRead; readonly superUser: boolean } | ShelfRefusal | ShelfFailure
    > {
      const scope = scopeOf(p);
      if (scope.kind === "none") return noBook(p, "farms-list");
      const r = await pagedSelect(deps.crm, p.credential, SHELF_FIELDS, LLP_MODULE, "id is not null", "Name asc", signal, deps.maxPages);
      if (!r.ok) return r.kind === "refused" ? { ok: false, kind: "refused", reason: r.reason } : r;
      const rows = r.rows.map(farmOf).filter((x): x is FarmRow => x !== null);
      return { ok: true, rows: Object.freeze(rows), truncated: r.truncated, totals: await totals(p, scope, signal), superUser: scope.kind === "all" };
    },

    /** One LLP with its masked PAN/GST and SPOCs. */
    async one(p: FarmsPrincipal, id: string, signal?: AbortSignal): Promise<{ readonly ok: true; readonly farm: FarmDetail; readonly superUser: boolean } | ShelfRefusal | ShelfFailure> {
      const scope = scopeOf(p);
      if (scope.kind === "none") return noBook(p, "farms-open");
      if (typeof id !== "string" || !RECORD_ID.test(id)) return { ok: false, kind: "refused", reason: "invalid-request" };
      const r = await pagedSelect(deps.crm, p.credential, DETAIL_FIELDS, LLP_MODULE, `id = '${id}'`, "id asc", signal, 1);
      if (!r.ok) return r.kind === "refused" ? { ok: false, kind: "refused", reason: r.reason } : r;
      const rec = r.rows.find((x) => x.id === id);
      const row = rec ? farmOf(rec) : null;
      if (!rec || !row) {
        deps.events.refusal(p.credential.userId, "farms-open", "not-visible", [id]);
        return { ok: false, kind: "refused", reason: "not-found" };
      }
      const spocs = ([1, 2] as const)
        .map((n) => ({ name: str(rec, `SPOC_${n}_Full_Name`, 120), phone: str(rec, `SPOC_${n}_Contact_No`, 30) }))
        .filter((s): s is { name: string; phone: string | null } => s.name !== null)
        .map((s) => Object.freeze(s));
      return {
        ok: true, superUser: scope.kind === "all",
        farm: Object.freeze({
          ...row, pan: masked(str(rec, "PAN", 20)), gst: masked(str(rec, "GST", 20)),
          incorporationNo: str(rec, "Incorporation_No", 40), spocs: Object.freeze(spocs),
        }),
      };
    },
  });
}
export type FarmShelf = ReturnType<typeof createFarmShelf>;
