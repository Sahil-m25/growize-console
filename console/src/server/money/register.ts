/**
 * M10-S01-T03 — the Payments register: every receipt, refund and forfeit, with received, refunded,
 * net banked and still due, and filters by kind, by farm (LLP) and by reconciliation.
 *
 * Read-only, on the person's own token (D53): Zoho's sharing rule (Receipts is Finance-only, ACCESS-PLAN)
 * and field-level security decide what comes back; the access authority decides whether the page is
 * offered at all (a KAM gets none) and whether the UTR is shown ("Finance only" otherwise). Every row
 * names the investor and farm of the allotment it is linked to (D70: a receipt links to the allotment,
 * and through it to the Contact and the LLP). Nothing is cached — rows are records (D45/D52).
 *
 * Totals, worked out from the receipts, never typed — MATCHED money only (D21: recording is free, only matched money
 * counts), the same rule as Today (numbers/investors-today), Numbers (numbers/investors-side) and holds/rules:
 *   received   = MATCHED inbound receipts (Advance, Part/Balance, Full)
 *   refunded   = MATCHED Refund receipts
 *   net banked = received − refunded
 *   still due  = over Reserved allotments, units × unit price − the allotment's matched net, never below 0
 *   recorded   = recorded, not yet matched (Pending): { received, refunded, net } — shown apart, never in the above
 * Counts and totals are over the farm the person picked (all farms when none), before the kind and
 * reconciliation cuts, so the chips read the same whichever chip is on.
 */

import type { UserCredential, ZohoClient, ZohoRecord } from "../../lib/zoho/client";
import { isUserCredential } from "../../lib/zoho/client";
import type { ZohoFailureKind } from "../../lib/zoho/errors";
import type { OpsLog } from "../../lib/zoho/log";
import type { SeatedZohoUser } from "../oauth/seat";

export const RECEIPTS_MODULE = "Receipts";
export const ALLOTMENTS_MODULE = "LLP_UnitAllocation_Module";
const COQL_IN_LIMIT = 100;
const PAGE = 2_000;
const MAX_ROWS = 10_000;
const RECORD_ID = /^\d{15,22}$/;
const RECORD_PREFIX = /^\d{6,16}$/;
const SESSION_ID = /^[A-Za-z0-9_-]{16,128}$/;

export type RegisterKind = "advance" | "balance" | "full" | "refund" | "forfeit";
const KIND: Readonly<Record<string, RegisterKind>> = Object.freeze({
  Advance: "advance", Part: "balance", Balance: "balance", Full: "full", Refund: "refund", Forfeit: "forfeit",
});
const MATCH_STATES: ReadonlySet<string> = new Set(["Pending", "Matched", "Not found", "Reversed", "Claimed"]);

export interface RegisterAccess {
  readonly actor: SeatedZohoUser;
  /** False for a KAM, or any seat the rail offers no Payments page (M10-S01 AC4). */
  readonly seesRegister: boolean;
  /** Finance seats only; everyone else reads "Finance only" (AC6). */
  readonly seesUtr: boolean;
  /** A viewer (the Auditor) reads the register and cannot record (AC4). */
  readonly canRecord: boolean;
}
export interface RegisterAccessAuthority { recheck(credential: UserCredential, sessionId: string, signal?: AbortSignal): Promise<RegisterAccess | null> }

export interface RegisterFilter {
  /** advance: Advance · full: Full and balance · out: Refunds and forfeits. Absent: everything. */
  readonly kind?: "advance" | "full" | "out";
  /** An LLP (farm) record id. */
  readonly farm?: string;
  /** true: matched only · false: not reconciled only. */
  readonly reconciled?: boolean;
}
export interface RegisterRow {
  readonly id: string;
  readonly kind: RegisterKind;
  readonly amount: number;
  readonly mode: string | null;
  /** null when hidden: the screen reads "Finance only". */
  readonly utr: string | null;
  readonly utrHidden: boolean;
  readonly receivedOn: string | null;
  readonly matchState: string;
  readonly reconciled: boolean;
  readonly allotmentId: string;
  readonly investor: { readonly id: string; readonly name: string | null };
  readonly farm: { readonly id: string; readonly name: string | null };
  readonly recordedById: string | null;
  readonly reversalOf: string | null;
}
export interface RegisterCounts { readonly all: number; readonly advance: number; readonly full: number; readonly out: number; readonly pending: number }
/** Pending receipts: recorded by one hand, waiting for the second (D21). */
export interface RecordedNotMatched { readonly received: number; readonly refunded: number; readonly net: number }
export interface RegisterTotals {
  readonly received: number; readonly refunded: number; readonly netBanked: number; readonly stillDue: number;
  readonly recorded: RecordedNotMatched;
}
export type RegisterResult =
  | { readonly ok: true; readonly value: { readonly rows: readonly RegisterRow[]; readonly counts: RegisterCounts; readonly totals: RegisterTotals;
      readonly farms: readonly { readonly id: string; readonly name: string | null }[]; readonly readOnly: boolean } }
  | { readonly ok: false; readonly kind: "refused"; readonly reasonCode: "invalid-request" | "session-changed" | "capability-missing" | "source-invalid" }
  | { readonly ok: false; readonly kind: "source-error"; readonly errorKind: ZohoFailureKind | "unexpected"; readonly retryable: boolean };

export interface RegisterDependencies {
  readonly crm: Pick<ZohoClient, "coql">;
  readonly access: RegisterAccessAuthority;
  readonly log: OpsLog;
  readonly recordIdPrefix: string;
  readonly clock?: () => number;
}

interface Allot { id: string; investorId: string; investorName: string | null; farmId: string; farmName: string | null; status: string; commitment: number }
class Fail { constructor(readonly kind: ZohoFailureKind | "unexpected") {} }
class Invalid { constructor(readonly ids: string[]) {} }

const int = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) ? v : null);
const name = (v: unknown): string | null => {
  const n = v && typeof v === "object" ? (v as { name?: unknown }).name : undefined;
  return typeof n === "string" ? n.slice(0, 120) : null;
};

export function createPaymentsRegister(deps: RegisterDependencies) {
  if (!deps || typeof deps.crm?.coql !== "function" || typeof deps.access?.recheck !== "function"
    || typeof deps.log?.refusal !== "function" || typeof deps.recordIdPrefix !== "string" || !RECORD_PREFIX.test(deps.recordIdPrefix)) {
    throw new TypeError("The payments register needs crm.coql, the access authority, the ops log and the CRM record-id prefix.");
  }
  const { crm, access, log } = deps;
  const clock = deps.clock ?? Date.now;
  const validId = (v: unknown): v is string => typeof v === "string" && RECORD_ID.test(v) && v.startsWith(deps.recordIdPrefix);
  const idOf = (v: unknown): string | null => { const id = v && typeof v === "object" ? (v as { id?: unknown }).id : undefined; return validId(id) ? id : null; };
  const all = async (cred: UserCredential, q: string, signal?: AbortSignal): Promise<ZohoRecord[]> => {
    const rows: ZohoRecord[] = [];
    for (let off = 0; off < MAX_ROWS; off += PAGE) {
      const r = await crm.coql(cred, `${q} limit ${off}, ${PAGE}`, { signal });
      if (!r.ok) throw new Fail(r.error.kind);
      if (r.value.invalidRecordIds) throw new Fail("unexpected");
      rows.push(...r.value.records);
      if (!r.value.moreRecords) return rows;
    }
    throw new Fail("unexpected");
  };
  const ALLOT = "id, Customer, LLP, Allocation_Status, Issued_Units, Reserved_Units, Unit_Price";
  const parseAllot = (r: ZohoRecord): Allot => {
    const investorId = idOf(r.Customer), farmId = idOf(r.LLP), status = typeof r.Allocation_Status === "string" ? r.Allocation_Status : "";
    const units = status === "Issued" ? int(r.Issued_Units) : int(r.Reserved_Units), price = int(r.Unit_Price);
    if (!validId(r.id) || !investorId || !farmId || !status) throw new Invalid([r.id]);
    const commitment = units !== null && price !== null && units >= 0 && price >= 0 ? units * price : null;
    if (status === "Reserved" && (commitment === null || !Number.isSafeInteger(commitment))) throw new Invalid([r.id]);
    return { id: r.id, investorId, investorName: name(r.Customer), farmId, farmName: name(r.LLP), status, commitment: commitment ?? 0 };
  };

  return Object.freeze({
    async read(principal: { credential: UserCredential; sessionId: string }, filter: RegisterFilter = {}, signal?: AbortSignal): Promise<RegisterResult> {
      const cred = principal?.credential;
      if (!isUserCredential(cred) || !validId(cred.userId) || typeof principal.sessionId !== "string" || !SESSION_ID.test(principal.sessionId)
        || !filter || typeof filter !== "object"
        || (filter.kind !== undefined && !["advance", "full", "out"].includes(filter.kind))
        || (filter.farm !== undefined && !validId(filter.farm))
        || (filter.reconciled !== undefined && typeof filter.reconciled !== "boolean")) {
        return { ok: false, kind: "refused", reasonCode: "invalid-request" };
      }
      let a: RegisterAccess | null;
      try { a = await access.recheck(cred, principal.sessionId, signal); } catch { return { ok: false, kind: "source-error", errorKind: "unexpected", retryable: true }; }
      if (!a || a.actor?.userId !== cred.userId) return { ok: false, kind: "refused", reasonCode: "session-changed" };
      const actor = { kind: "user" as const, userId: cred.userId };
      if (!a.seesRegister) {
        log.refusal({ at: clock(), actor, action: "payments-register", reason: "capability-missing", recordIds: [] });
        return { ok: false, kind: "refused", reasonCode: "capability-missing" };
      }
      try {
        const receipts = await all(cred, "select id, Allotment, Kind, Amount, Mode, UTR, Received_On, Match_State, Reversal_Of, Created_By from Receipts where id is not null order by Received_On desc", signal);
        const reserved = await all(cred, `select ${ALLOT} from ${ALLOTMENTS_MODULE} where Allocation_Status = 'Reserved' order by id asc`, signal);
        const allots = new Map<string, Allot>();
        for (const r of reserved) { const p = parseAllot(r); allots.set(p.id, p); }
        const need = [...new Set(receipts.map((r) => idOf(r.Allotment)).filter((id): id is string => !!id && !allots.has(id)))];
        for (let i = 0; i < need.length; i += COQL_IN_LIMIT) {
          const rows = await all(cred, `select ${ALLOT} from ${ALLOTMENTS_MODULE} where id in (${need.slice(i, i + COQL_IN_LIMIT).map((x) => `'${x}'`).join(", ")}) order by id asc`, signal);
          for (const r of rows) { const p = parseAllot(r); allots.set(p.id, p); }
        }

        const rows: RegisterRow[] = [];
        for (const r of receipts) {
          const allotmentId = idOf(r.Allotment), al = allotmentId ? allots.get(allotmentId) : undefined;
          const kind = typeof r.Kind === "string" ? KIND[r.Kind] : undefined, amount = int(r.Amount);
          const match = typeof r.Match_State === "string" && MATCH_STATES.has(r.Match_State) ? r.Match_State : null;
          if (!validId(r.id) || !al || !kind || amount === null || amount <= 0 || !match) throw new Invalid([r.id]);
          const utr = typeof r.UTR === "string" ? r.UTR.slice(0, 80) : null;
          rows.push(Object.freeze({
            id: r.id, kind, amount, mode: typeof r.Mode === "string" ? r.Mode : null,
            utr: a.seesUtr ? utr : null, utrHidden: !a.seesUtr,
            receivedOn: typeof r.Received_On === "string" ? r.Received_On : null,
            matchState: match, reconciled: match === "Matched", allotmentId: al.id,
            investor: Object.freeze({ id: al.investorId, name: al.investorName }), farm: Object.freeze({ id: al.farmId, name: al.farmName }),
            recordedById: idOf(r.Created_By), reversalOf: idOf(r.Reversal_Of),
          }));
        }

        const inFarm = filter.farm ? rows.filter((r) => r.farm.id === filter.farm) : rows;
        const matched = (r: RegisterRow) => r.matchState === "Matched";
        const pending = (r: RegisterRow) => r.matchState === "Pending";
        const inbound = (r: RegisterRow) => r.kind === "advance" || r.kind === "balance" || r.kind === "full";
        const sum = (keep: (r: RegisterRow) => boolean) => inFarm.filter(keep).reduce((t, r) => t + r.amount, 0);
        const received = sum((r) => inbound(r) && matched(r));
        const refunded = sum((r) => r.kind === "refund" && matched(r));
        const recIn = sum((r) => inbound(r) && pending(r)), recOut = sum((r) => r.kind === "refund" && pending(r));
        const matchedByAllot = new Map<string, number>();
        for (const r of rows) if (matched(r)) matchedByAllot.set(r.allotmentId, (matchedByAllot.get(r.allotmentId) ?? 0) + (inbound(r) ? r.amount : r.kind === "refund" ? -r.amount : 0));
        const stillDue = [...allots.values()].filter((x) => x.status === "Reserved" && (!filter.farm || x.farmId === filter.farm))
          .reduce((t, x) => t + Math.max(0, x.commitment - Math.max(0, matchedByAllot.get(x.id) ?? 0)), 0);
        const cut: Record<string, (r: RegisterRow) => boolean> = {
          advance: (r) => r.kind === "advance",
          full: (r) => r.kind === "full" || r.kind === "balance",
          out: (r) => r.kind === "refund" || r.kind === "forfeit",
        };
        const counts: RegisterCounts = Object.freeze({ all: inFarm.length, advance: inFarm.filter(cut.advance).length, full: inFarm.filter(cut.full).length,
          out: inFarm.filter(cut.out).length, pending: inFarm.filter((r) => !r.reconciled).length });
        const shown = inFarm.filter((r) => (!filter.kind || cut[filter.kind](r)) && (filter.reconciled === undefined || r.reconciled === filter.reconciled));
        const farms = new Map<string, string | null>();
        for (const x of allots.values()) if (!farms.has(x.farmId)) farms.set(x.farmId, x.farmName);
        return { ok: true, value: {
          rows: Object.freeze(shown), counts,
          totals: Object.freeze({ received, refunded, netBanked: received - refunded, stillDue,
            recorded: Object.freeze({ received: recIn, refunded: recOut, net: recIn - recOut }) }),
          farms: Object.freeze([...farms].sort((x, y) => x[0].localeCompare(y[0])).map(([id, n]) => Object.freeze({ id, name: n }))),
          readOnly: !a.canRecord,
        } };
      } catch (e) {
        if (e instanceof Invalid) {
          log.refusal({ at: clock(), actor, action: "payments-register", reason: "source-invalid", recordIds: e.ids.filter((id) => RECORD_ID.test(id)) });
          return { ok: false, kind: "refused", reasonCode: "source-invalid" };
        }
        if (e instanceof Fail) return { ok: false, kind: "source-error", errorKind: e.kind, retryable: e.kind === "network" || e.kind === "server" || e.kind === "busy" };
        throw e;
      }
    },
  });
}
