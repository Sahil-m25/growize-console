/**
 * M05-S06-T01 — THE HEADLINE FIGURES ON TODAY (Investors side): banked to date, balance outstanding, units held of
 * released, tickets open — each with when it was read from Zoho, and a stale/error state when the read fails (D41).
 *
 * The money rules are the Payments register's (../money/register), through ../holds/rules and so ../money/ledger —
 * only MATCHED receipts count (D21), inbound kinds minus refunds, a matched reversal cancelling its target once:
 *   banked       = Σ matched inbound − Σ matched refunds, over every receipt the token sees
 *   outstanding  = Σ over Reserved allotments of max(0, units × Unit_Price − that allotment's matched net)
 *   units        = held (Issued_Units of Issued + Reserved_Units of Reserved, counted off the allotments as
 *                  ../farms/occupancy counts them — its COUNT_QUERY, imported) of released (Σ LLP Units_Released)
 *   tickets open = Cases not Closed (../cases/register cutsOf, its predicate casesWhere)
 *
 * COQL budget (TC-IM03-015): money 2 (the Receipts ledger rows + the Reserved allotments, one page per 2,000 each —
 * rows, not an aggregate, because an aggregate cannot see Reversal_Of; M01-S08-NOTE-3), units 2
 * aggregates, tickets 1 aggregate — at most five on a cold render. Each group is an AGGREGATE in the scope-keyed cache
 * (D52/D53, A-19): money under the seat's money scope, units under the Investors scope (farms/occupancy countScopeOf),
 * tickets under the cases scope; a reload inside the TTL spends none. Nothing record-shaped is cached or logged.
 */

import type { UserCredential, ZohoClient, ZohoRecord } from "../../lib/zoho/client";
import type { CacheError, CacheFresh, CacheStale, ScopedCache } from "../../lib/zoho/cache";
import { MODULES } from "../data/projections";
import { scopedKey, scopesFor } from "../data/scope";
import { idOf } from "../cases/predicate";
import { casesWhere, cutsOf, CASES_MODULE } from "../cases/register";
import { COUNT_QUERY, countScopeOf } from "../farms/occupancy";
import { sectionsFor } from "../investors/record";
import { ALLOTMENTS_MODULE } from "../money/register";
import { commitmentOf, dueOf, matchedMoneyOf, readLedgerReceipts } from "../holds/rules";

/** 30–60 s band (D45); the cache refuses anything past five minutes. */
export const TODAY_TTL_MS = 45_000;
const PAGE = 2_000;
const MAX_PAGES = 5;

export type TodayMoney = Readonly<{ banked: number; outstanding: number; reservedAllotments: number }>;
export type TodayUnits = Readonly<{ held: number; reserved: number; allotted: number; released: number; total: number }>;
export type TodayTickets = Readonly<{ open: number; high: number }>;
type Tile<V> =
  | { readonly state: "fresh" | "stale-but-refreshing"; readonly value: V; readonly asOf: number }
  | { readonly state: "error"; readonly reason: string; readonly lastGoodAt: number | null }
  | { readonly state: "hidden" };

export interface InvestorsToday {
  readonly money: Tile<TodayMoney>;
  readonly units: Tile<TodayUnits>;
  readonly tickets: Tile<TodayTickets>;
  /** The oldest figure's time (the "as of HH:MM" line); null when nothing was read. */
  readonly asOf: number | null;
  /** A figure is past its TTL or its read failed: the page shows the stale state. */
  readonly stale: boolean;
}

export interface InvestorsTodayDeps {
  readonly crm: Pick<ZohoClient, "coql" | "aggregate">;
  readonly cache: ScopedCache;
}

class ZohoFail extends Error { constructor(readonly kind: string) { super("zoho"); } }
const tile = <V>(r: CacheFresh<V> | CacheStale<V> | CacheError<V>): Tile<V> =>
  r.state === "error" ? { state: "error", reason: r.reason, lastGoodAt: r.lastGoodAt } : { state: r.state, value: r.value, asOf: r.asOf };

export function createInvestorsToday(deps: InvestorsTodayDeps) {
  const agg = async (cred: UserCredential, q: string, signal?: AbortSignal) => {
    const r = await deps.crm.aggregate(cred, q, { signal });
    if (!r.ok) throw new ZohoFail(r.error.kind);
    if (r.value.length >= 2_000) throw new ZohoFail("truncated");
    return r.value;
  };

  const money = async (cred: UserCredential, signal?: AbortSignal): Promise<TodayMoney> => {
    const rc = await readLedgerReceipts(deps.crm, cred, "id is not null", { signal, maxPages: MAX_PAGES });
    if (!rc.ok) throw new ZohoFail(rc.errorKind);
    const m = matchedMoneyOf(rc.entries);
    const reserved: ZohoRecord[] = [];
    for (let page = 0; ; page++) {
      if (page >= MAX_PAGES) throw new ZohoFail("truncated");
      const r = await deps.crm.coql(cred, `select id, Reserved_Units, Unit_Price from ${ALLOTMENTS_MODULE} where Allocation_Status = 'Reserved' order by id asc limit ${page * PAGE}, ${PAGE}`, { signal });
      if (!r.ok) throw new ZohoFail(r.error.kind);
      reserved.push(...r.value.records);
      if (!r.value.moreRecords) break;
    }
    let outstanding = 0;
    for (const x of reserved) {
      const id = idOf(x.id), committed = commitmentOf(x.Reserved_Units, x.Unit_Price);
      if (!id || committed === null) throw new ZohoFail("source-invalid");
      outstanding += dueOf(committed, m.byAllotment.get(id) ?? 0);
    }
    return Object.freeze({ banked: m.net, outstanding, reservedAllotments: reserved.length });
  };

  const units = async (cred: UserCredential, signal?: AbortSignal): Promise<TodayUnits> => {
    let reserved = 0, allotted = 0;
    for (const r of await agg(cred, COUNT_QUERY, signal)) {
      const n = (k: string) => (typeof r[k] === "number" ? (r[k] as number) : 0);
      if (r.Allocation_Status === "Issued") allotted += n("SUM(Issued_Units)");
      else if (r.Allocation_Status === "Reserved") reserved += n("SUM(Reserved_Units)");
    }
    const llp = (await agg(cred, `select SUM(Units_Released), SUM(Total_Units) from ${MODULES.llps} where id is not null`, signal))[0] ?? {};
    const released = typeof llp["SUM(Units_Released)"] === "number" ? (llp["SUM(Units_Released)"] as number) : 0;
    const total = typeof llp["SUM(Total_Units)"] === "number" ? (llp["SUM(Total_Units)"] as number) : 0;
    return Object.freeze({ held: reserved + allotted, reserved, allotted, released, total });
  };

  return Object.freeze({
    async read(p: { readonly credential: UserCredential; readonly seat: string }, signal?: AbortSignal): Promise<
      { readonly ok: true; readonly value: InvestorsToday } | { readonly ok: false; readonly kind: "refused"; readonly reason: "no-book" }> {
      const me = p.credential.userId;
      const scopes = scopesFor(p.seat, me);
      const sections = sectionsFor(p.seat, me);
      if (!sections) return { ok: false, kind: "refused", reason: "no-book" };
      const opts = { ttlMs: TODAY_TTL_MS };

      const moneyScope = scopes.money;
      const seesMoney = sections.includes("money") && (moneyScope.kind === "org" || moneyScope.kind === "all");
      const casesWherePredicate = scopes.cases.kind === "org" || scopes.cases.kind === "all" ? casesWhere(scopes.cases, null) : null;
      const [m, u, t] = await Promise.all([
        seesMoney ? deps.cache.readSettled<TodayMoney>(scopedKey<TodayMoney>(moneyScope, "today.investors.money"), () => money(p.credential, signal), opts) : null,
        deps.cache.readSettled<TodayUnits>(scopedKey<TodayUnits>(countScopeOf(p.seat, me), "today.investors.units"), () => units(p.credential, signal), opts),
        casesWherePredicate
          ? deps.cache.readSettled<TodayTickets>(scopedKey<TodayTickets>(scopes.cases, "today.investors.tickets"), async () => {
            const c = cutsOf(await agg(p.credential, `select Status, Priority, COUNT(id) from ${CASES_MODULE} where (${casesWherePredicate}) group by Status, Priority limit 0, 2000`, signal));
            return Object.freeze({ open: c.open, high: c.high });
          }, opts)
          : null,
      ]);
      const tiles = [m, u, t].filter((x) => x !== null);
      const times = tiles.map((x) => (x.state === "error" ? null : x.asOf)).filter((x): x is number => x !== null);
      return { ok: true, value: Object.freeze({
        money: m ? tile(m) : { state: "hidden" as const },
        units: tile(u),
        tickets: t ? tile(t) : { state: "hidden" as const },
        asOf: times.length ? Math.min(...times) : null,
        stale: tiles.some((x) => x.state !== "fresh"),
      }) };
    },
  });
}
export type InvestorsTodayReader = ReturnType<typeof createInvestorsToday>;
