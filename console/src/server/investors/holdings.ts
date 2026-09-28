/**
 * M10-S09-T01 — ARL HOLDINGS AND TRANSACTIONS, READ-ONLY (D45, D52, D53, D70).
 *
 * An investor's corporate instruments with ARL (CCD, Equity, Preference) and each holding's transactions,
 * read as Zoho related lists on the signed-in person's own token — API names confirmed read-only with
 * getRelatedLists / getFields (28 Sep 2026):
 *   Contacts/{id}/ARL_Holdings                  — ARL_Holdings.Investor → Contacts
 *   ARL_Holdings/{id}/ARL_Transactions          — ARL_Transactions.Holding → ARL_Holdings
 * Field names are the org's, not the older projection's (ARL_Holdings: Instrument_Class, Invested_Amount,
 * Invested_Date, Maturity_Date, Interest_Rate_Pct …; ARL_Transactions: Type, Amount, Txn_Date, Reference).
 *
 * Who: a seat with a holdings book (../data/scope: org / all) whose investor record has Money
 * (./record sectionsFor) — Finance, Head of Finance, Compliance, the viewers, the super user. A KAM, the
 * Head of AM, an IR and anyone else is refused before anything is read (AC5). The Contact is admitted
 * through ../data/ir-guard first; every holding must name that Contact and every transaction its holding,
 * or the read is refused as scope drift (Plane B), never trimmed.
 *
 * Nothing here writes: this module has no write path and its route exports GET only (AC3, D70 — the
 * ledger is kept in Zoho, not edited from the console). Rows live for one response; nothing is cached.
 */

import type { UserCredential, ZohoClient, ZohoRecord } from "../../lib/zoho/client";
import type { ZohoFailureKind } from "../../lib/zoho/errors";
import type { InvestorEvents } from "../data/events";
import { createInvestorGuard, type GuardRefusal, type PlaneCRefusal } from "../data/ir-guard";
import { checkProjection, MODULES } from "../data/projections";
import { scopesFor } from "../data/scope";
import { sectionsFor } from "./record";

const RECORD_ID = /^\d{15,22}$/;
export const CONTACT_HOLDINGS_LIST = "ARL_Holdings";
export const HOLDING_TRANSACTIONS_LIST = "ARL_Transactions";
const PER_PAGE = 200;
const MAX_PAGES = 5;
/** More holdings than this for one investor is not expected; the panel says it is cut short. */
export const MAX_HOLDINGS = 50;

export const HOLDING_FIELDS = checkProjection(MODULES.holdings, [
  "id", "Name", "Investor", "Instrument_Class", "Invested_Amount", "Current_Value", "Interest_Accrued", "Invested_Date",
  "Maturity_Date", "Interest_Rate_Pct", "Units_Held", "Face_Value", "Conversion_Status", "Certificate_No",
]);
export const TRANSACTION_FIELDS = checkProjection(MODULES.arlTransactions, ["id", "Name", "Holding", "Type", "Amount", "Txn_Date", "Reference"]);

export type Instrument = "CCD" | "Equity" | "Preference";
export type ArlTxnType = "Capital Call" | "Interest" | "Distribution" | "Conversion" | "Fee";
const INSTRUMENTS: ReadonlySet<string> = new Set(["CCD", "Equity", "Preference"]);
const TXN_TYPES: ReadonlySet<string> = new Set(["Capital Call", "Interest", "Distribution", "Conversion", "Fee"]);

export interface ArlTransactionLine {
  readonly id: string;
  /** null when Zoho holds no type or one outside the picklist. */
  readonly type: ArlTxnType | null;
  readonly date: string | null;
  readonly amount: number | null;
  readonly reference: string | null;
}
export interface ArlHoldingLine {
  readonly id: string;
  readonly name: string | null;
  /** null when Zoho holds no instrument or one outside the picklist. */
  readonly instrument: Instrument | null;
  readonly amount: number | null;
  readonly currentValue: number | null;
  readonly interestAccrued: number | null;
  readonly investedOn: string | null;
  readonly maturesOn: string | null;
  readonly interestRatePct: number | null;
  readonly units: number | null;
  readonly faceValue: number | null;
  readonly conversionStatus: string | null;
  readonly certificateNo: string | null;
  readonly transactions: readonly ArlTransactionLine[];
}

export type HoldingsResult =
  | { readonly ok: true; readonly contactId: string; readonly holdings: readonly ArlHoldingLine[]; readonly readOnly: true; readonly truncated: boolean }
  | GuardRefusal
  | { readonly ok: false; readonly kind: "refused"; readonly reason: "scope-drift" | "source-invalid" }
  | { readonly ok: false; readonly kind: "source-error"; readonly errorKind: ZohoFailureKind | "unexpected" | string };

export interface HoldingsDeps {
  readonly crm: Pick<ZohoClient, "coql" | "getRelated">;
  readonly events: InvestorEvents;
  readonly planeCRefusal?: (e: PlaneCRefusal) => void;
}

/** May this seat see the ARL holdings panel at all? A holdings book AND a record with Money. */
export function seesHoldings(seat: string, userId: string): boolean {
  const k = scopesFor(seat, userId).holdings.kind;
  return (k === "org" || k === "all") && !!sectionsFor(seat, userId)?.includes("money");
}

const idOf = (v: unknown): string | null => {
  if (typeof v === "string" && RECORD_ID.test(v)) return v;
  const id = v && typeof v === "object" && !Array.isArray(v) ? (v as { id?: unknown }).id : undefined;
  return typeof id === "string" && RECORD_ID.test(id) ? id : null;
};
const num = (r: ZohoRecord, k: string): number | null => {
  const v = r[k];
  const x = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(x) ? x : null;
};
const text = (r: ZohoRecord, k: string, max = 120): string | null => (typeof r[k] === "string" && r[k] !== "" && r[k] !== "-None-" ? (r[k] as string).slice(0, max) : null);
const day = (v: string | null): string | null => (v && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

class Fail { constructor(readonly kind: ZohoFailureKind | "unexpected") {} }
class Invalid { constructor(readonly ids: readonly string[]) {} }
class Drift { constructor(readonly ids: readonly string[]) {} }

export function createHoldingsReader(deps: HoldingsDeps) {
  const { crm, events } = deps;
  const guard = createInvestorGuard({ events, planeCRefusal: deps.planeCRefusal });

  const related = async (cred: UserCredential, module: string, id: string, list: string, fields: readonly string[], signal?: AbortSignal) => {
    const rows: ZohoRecord[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      let r: Awaited<ReturnType<typeof crm.getRelated>>;
      try { r = await crm.getRelated(cred, module, id, list, { fields, page, perPage: PER_PAGE, signal }); } catch { throw new Fail("unexpected"); }
      if (!r.ok) { if (r.error.kind === "not-found") return { rows, truncated: false }; throw new Fail(r.error.kind); }
      if (r.value.invalidRecordIds) throw new Invalid([id]);
      rows.push(...r.value.records);
      if (!r.value.moreRecords) return { rows, truncated: false };
    }
    return { rows, truncated: true };
  };

  return Object.freeze({
    async read(cred: UserCredential, seat: string, contactId: string, signal?: AbortSignal): Promise<HoldingsResult> {
      const me = cred.userId, action = "investor-arl-holdings";
      if (typeof contactId !== "string" || !RECORD_ID.test(contactId)) return guard.refuse(me, seat, action, "invalid-request", []);
      if (!seesHoldings(seat, me)) return guard.refuse(me, seat, action, "seat-denied", [contactId]);
      const one = await guard.one(crm, cred, seat, contactId, signal);
      if (!one.ok) return one;
      try {
        const h = await related(cred, MODULES.contacts, contactId, CONTACT_HOLDINGS_LIST, HOLDING_FIELDS, signal);
        const raw = h.rows.filter((x) => idOf(x.id));
        const foreign = raw.filter((x) => idOf(x.Investor) !== contactId);
        if (foreign.length) throw new Drift(foreign.map((x) => x.id));
        let truncated = h.truncated || raw.length > MAX_HOLDINGS;
        const out: ArlHoldingLine[] = [];
        for (const x of raw.slice(0, MAX_HOLDINGS)) {
          const t = await related(cred, MODULES.holdings, x.id, HOLDING_TRANSACTIONS_LIST, TRANSACTION_FIELDS, signal);
          truncated ||= t.truncated;
          const txRaw = t.rows.filter((y) => idOf(y.id));
          const strays = txRaw.filter((y) => idOf(y.Holding) !== x.id);
          if (strays.length) throw new Drift(strays.map((y) => y.id));
          const transactions = txRaw.map((y): ArlTransactionLine => {
            const type = text(y, "Type", 40);
            return Object.freeze({ id: y.id, type: type && TXN_TYPES.has(type) ? (type as ArlTxnType) : null, date: day(text(y, "Txn_Date", 40)),
              amount: num(y, "Amount"), reference: text(y, "Reference", 120) });
          }).sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || a.id.localeCompare(b.id));
          const inst = text(x, "Instrument_Class", 40);
          out.push(Object.freeze({
            id: x.id, name: text(x, "Name"), instrument: inst && INSTRUMENTS.has(inst) ? (inst as Instrument) : null,
            amount: num(x, "Invested_Amount"), currentValue: num(x, "Current_Value"), interestAccrued: num(x, "Interest_Accrued"),
            investedOn: day(text(x, "Invested_Date", 40)), maturesOn: day(text(x, "Maturity_Date", 40)), interestRatePct: num(x, "Interest_Rate_Pct"),
            units: num(x, "Units_Held"), faceValue: num(x, "Face_Value"), conversionStatus: text(x, "Conversion_Status", 40),
            certificateNo: text(x, "Certificate_No", 60), transactions: Object.freeze(transactions),
          }));
        }
        return { ok: true, contactId, holdings: Object.freeze(out), readOnly: true, truncated };
      } catch (e) {
        if (e instanceof Drift) { events.refusal(me, action, "scope-drift", e.ids); return { ok: false, kind: "refused", reason: "scope-drift" }; }
        if (e instanceof Invalid) { events.refusal(me, action, "source-invalid", e.ids); return { ok: false, kind: "refused", reason: "source-invalid" }; }
        return { ok: false, kind: "source-error", errorKind: e instanceof Fail ? e.kind : "unexpected" };
      }
    },
  });
}
export type HoldingsReader = ReturnType<typeof createHoldingsReader>;
