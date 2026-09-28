/**
 * M01-S03-T02 — THE INVESTORS-SIDE MODULE ADAPTERS on the one shared client and gate.
 *
 * Contacts, LLP_Creation_Module, the canonical allotment module (LLP_UnitAllocation_Module), Receipts,
 * Cases, ARL_Holdings and ARL_Transactions — read-only, every call a COQL SELECT with the signed-in
 * person's own credential (D53) through the client (so through the process-wide gate, and written to
 * Plane B by the client). Each read names its projection (./projections — no pan, no bank_account).
 *
 * The scope decides the WHERE clause (own-lead: Originating_IR, own-book: KAM, then the dependent
 * modules by the ids read). Zoho's sharing already limits the token; each row is still checked against
 * the scope, so a stale share shows up as a Plane B refusal rather than somebody else's investor.
 * Rows are records, so none is cached (D52).
 */

import type { UserCredential, ZohoClient, ZohoRecord } from "../../lib/zoho/client";
import type { ZohoFailureKind } from "../../lib/zoho/errors";
import type { ImAllot, ImArlTxn, ImArlTxnType, ImHolding, ImLlp, ImLlpStatus, ImTicket } from "../../lib/im/types";
import type { InvestorEvents } from "./events";
import { MODULES, PROJECTIONS, type ModuleKey } from "./projections";
import type { BookScope } from "./scope";
import { parseContact, type ContactRow } from "./contact-row";
import { admitContact, contactsWhere, type IrRefusal } from "./ir-guard";

export { parseContact };

export const PAGE = 200;
export const DEFAULT_MAX_PAGES = 10;
export const IN_CHUNK = 100;
const RECORD_ID = /^\d{15,22}$/;

export type ReadResult<T> =
  | { readonly ok: true; readonly rows: readonly T[]; readonly truncated: boolean }
  | { readonly ok: false; readonly kind: "refused"; readonly reason: "scope-drift" | "source-invalid" | IrRefusal }
  | { readonly ok: false; readonly kind: "source-error"; readonly errorKind: ZohoFailureKind | "unexpected"; readonly retryable: boolean };

export type { ContactRow } from "./contact-row";

export interface ReceiptRow {
  readonly id: string;
  readonly allotmentId: string | null;
  readonly kind: string | null;
  readonly amount: number;
  readonly mode: string | null;
  readonly utr: string | null;
  readonly on: string | null;
  readonly byId: string | null;
  readonly matched: boolean;
  /** Zoho's Match_State as read (Pending / Matched / Not found / Reversed / Claimed), or null. */
  readonly matchState: string | null;
  readonly reversalOf: string | null;
}

export interface AllotmentRow extends ImAllot {
  readonly received: number | null;
  readonly receivable: number | null;
  readonly token: number | null;
}

export interface CaseRow extends ImTicket {
  readonly contactId: string | null;
}

export interface AdapterDeps {
  readonly crm: Pick<ZohoClient, "coql">;
  readonly events: InvestorEvents;
  readonly maxPages?: number;
}

/* ---- parsing ------------------------------------------------------------------------------- */
const idOf = (v: unknown): string | null => {
  if (typeof v === "string" && RECORD_ID.test(v)) return v;
  const id = v && typeof v === "object" && !Array.isArray(v) ? (v as { id?: unknown }).id : undefined;
  return typeof id === "string" && RECORD_ID.test(id) ? id : null;
};
const s = (r: ZohoRecord, k: string, max = 250): string | null => {
  const v = r[k];
  return typeof v === "string" && v !== "" ? v.slice(0, max) : null;
};
const n = (r: ZohoRecord, k: string): number | null => {
  const v = r[k];
  const x = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(x) ? x : null;
};
const day = (v: string | null): string | null => (v && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const stamp = (v: string | null): string | null => (v && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v) ? v.slice(0, 16) : day(v));
const quote = (ids: readonly string[]) => ids.map((x) => `'${x}'`).join(", ");

const LLP_STATUS: ReadonlySet<string> = new Set(["Draft", "Open for Reservation", "Open for Issuance", "Fully Subscribed", "Active"]);
const ARL_TYPES: ReadonlySet<string> = new Set(["Capital Call", "Interest", "Distribution", "Conversion", "Fee"]);
const INSTRUMENTS: ReadonlySet<string> = new Set(["CCD", "Equity", "Preference"]);

export function createInvestorsAdapters(deps: AdapterDeps) {
  const maxPages = deps.maxPages ?? DEFAULT_MAX_PAGES;
  const { crm, events } = deps;

  /** Every page of one SELECT, through the shared client. */
  const selectAll = async (cred: UserCredential, key: ModuleKey, where: string, signal?: AbortSignal): Promise<ReadResult<ZohoRecord>> => {
    const rows: ZohoRecord[] = [];
    for (let page = 0; page < maxPages; page++) {
      let res: Awaited<ReturnType<typeof crm.coql>>;
      try {
        res = await crm.coql(cred, `select ${PROJECTIONS[key].join(", ")} from ${MODULES[key]} where (${where}) order by id asc limit ${page * PAGE}, ${PAGE}`, { signal });
      } catch {
        return { ok: false, kind: "source-error", errorKind: "unexpected", retryable: true };
      }
      if (!res.ok) {
        const k = res.error.kind;
        return { ok: false, kind: "source-error", errorKind: k, retryable: k === "network" || k === "server" || k === "busy" || k === "concurrency-exceeded" };
      }
      if (res.value.invalidRecordIds) return { ok: false, kind: "refused", reason: "source-invalid" };
      rows.push(...res.value.records);
      if (!res.value.moreRecords) return { ok: true, rows, truncated: false };
    }
    return { ok: true, rows, truncated: true };
  };

  /** The same SELECT over a list of ids, IN_CHUNK at a time. An empty list costs no call. */
  const selectIn = async (cred: UserCredential, key: ModuleKey, field: string, ids: readonly string[], signal?: AbortSignal): Promise<ReadResult<ZohoRecord>> => {
    const good = [...new Set(ids.filter((x) => RECORD_ID.test(x)))];
    const rows: ZohoRecord[] = [];
    let truncated = false;
    for (let i = 0; i < good.length; i += IN_CHUNK) {
      const r = await selectAll(cred, key, `${field} in (${quote(good.slice(i, i + IN_CHUNK))})`, signal);
      if (!r.ok) return r;
      rows.push(...r.rows);
      truncated ||= r.truncated;
    }
    return { ok: true, rows, truncated };
  };

  const drift = <T>(userId: string, action: string, recordIds: readonly string[]): ReadResult<T> => {
    events.refusal(userId, action, "scope-drift", recordIds);
    return { ok: false, kind: "refused", reason: "scope-drift" };
  };
  const mapRows = <T>(r: ReadResult<ZohoRecord>, f: (x: ZohoRecord) => T | null): ReadResult<T> => {
    if (!r.ok) return r;
    const out: T[] = [];
    for (const x of r.rows) {
      const m = f(x);
      if (m !== null) out.push(m);
    }
    return { ok: true, rows: Object.freeze(out), truncated: r.truncated };
  };
  const EMPTY = Object.freeze({ ok: true as const, rows: Object.freeze([]) as readonly never[], truncated: false });


  return Object.freeze({
    /**
     * Contacts in the scope — the WHERE clause and the per-row admission both come from ./ir-guard, the one
     * choke point: an IR's own-lead read asks for Originating_IR = me AND Origin_Lead present (D69, default
     * deny), and any row the guard does not admit refuses the whole read (Plane B), never passes through.
     */
    async contacts(cred: UserCredential, scope: BookScope, signal?: AbortSignal): Promise<ReadResult<ContactRow>> {
      const where = contactsWhere(scope);
      if (!where || scope.kind === "user") return EMPTY;
      const r = mapRows(await selectAll(cred, "contacts", where, signal), parseContact);
      if (!r.ok) return r;
      const foreign = r.rows.filter((c) => !admitContact(scope, c).ok);
      if (foreign.length) return drift(cred.userId, "investors-book", foreign.map((c) => c.id));
      return r;
    },

    async llps(cred: UserCredential, signal?: AbortSignal): Promise<ReadResult<ImLlp>> {
      return mapRows(await selectAll(cred, "llps", "id is not null", signal), (r): ImLlp | null => {
        if (!idOf(r.id)) return null;
        const status = s(r, "LLP_Status", 40);
        return Object.freeze({
          id: r.id, Name: s(r, "Name", 120) ?? "", Block_Code: s(r, "Block_Code", 20) ?? "",
          ...(n(r, "Acreage_Acres") !== null ? { Acreage_Acres: n(r, "Acreage_Acres")! } : {}),
          ...(n(r, "Total_Units") !== null ? { Total_Units: n(r, "Total_Units")! } : {}),
          Unit_Price: n(r, "Unit_Price") ?? 0,
          // The org holds the value "Darft" (CARRY-FORWARD C-12): it reads as Draft.
          LLP_Status: (status === "Darft" ? "Draft" : status && LLP_STATUS.has(status) ? status : "Draft") as ImLlpStatus,
          PAN: "", GST: "", SPOCs: [],
          Insurer: s(r, "Insurer", 120) ?? "", Insurance_Policy_No: s(r, "Insurance_Policy_No", 60) ?? "",
          Insured_Till: day(s(r, "Insured_Till", 40)) ?? "", Annual_Rental_Yield: n(r, "Annual_Rental_Yield") ?? 0,
        });
      });
    },

    /** Allotments of the given contacts (own scopes), or every allotment the token sees (wider scopes). */
    async allotments(cred: UserCredential, scope: BookScope, contactIds: readonly string[], signal?: AbortSignal, only = false): Promise<ReadResult<AllotmentRow>> {
      if (scope.kind === "none" || scope.kind === "user") return EMPTY;
      // `only`: read just these ids even for a wider scope (one investor opened by id).
      const own = only || scope.kind === "own-lead" || scope.kind === "own-book";
      const raw = own ? await selectIn(cred, "allotments", "Customer", contactIds, signal) : await selectAll(cred, "allotments", "id is not null", signal);
      const r = mapRows(raw, (x): AllotmentRow | null => {
        const customer = idOf(x.Customer);
        if (!idOf(x.id) || !customer) return null;
        const st = s(x, "Allocation_Status", 40);
        const status = st === "Issued" || st === "Cancelled" ? st : "Reserved";
        const issued = n(x, "Issued_Units") ?? 0, reserved = n(x, "Reserved_Units") ?? 0, price = n(x, "Unit_Price") ?? 0;
        const committed = Math.max(issued, reserved);
        return Object.freeze({
          id: x.id, Customer: customer, LLP_Lookup: idOf(x.LLP) ?? "", Committed_Units: committed, Issued_Units: issued,
          Unit_Price: price, Ticket_Snapshot: committed * price, Allocation_Status: status,
          Issued_On: day(s(x, "Issued_On", 40)), Annual_Rental_Yield: n(x, "Annual_Rental_Yield") ?? 0,
          received: n(x, "Total_Amount_Received"), receivable: n(x, "Total_Amount_Receivable"), token: n(x, "Token_Advance_Amount"),
        });
      });
      if (!r.ok || !own) return r;
      const allowed = new Set(contactIds);
      const foreign = r.rows.filter((a) => !allowed.has(a.Customer));
      return foreign.length ? drift(cred.userId, "investors-allotments", foreign.map((a) => a.id)) : r;
    },

    /** Receipts against the given allotments (own scopes) or every receipt the token sees. */
    async receipts(cred: UserCredential, scope: BookScope, allotmentIds: readonly string[], signal?: AbortSignal, only = false): Promise<ReadResult<ReceiptRow>> {
      if (scope.kind === "none" || scope.kind === "user") return EMPTY;
      // `only`: read just these ids even for a wider scope (one investor opened by id).
      const own = only || scope.kind === "own-lead" || scope.kind === "own-book";
      const raw = own ? await selectIn(cred, "receipts", "Allotment", allotmentIds, signal) : await selectAll(cred, "receipts", "id is not null", signal);
      const r = mapRows(raw, (x): ReceiptRow | null => {
        if (!idOf(x.id)) return null;
        return Object.freeze({
          id: x.id, allotmentId: idOf(x.Allotment), kind: s(x, "Kind", 40), amount: n(x, "Amount") ?? 0, mode: s(x, "Mode", 20),
          utr: s(x, "UTR", 40), on: day(s(x, "Received_On", 40)), byId: idOf(x.Created_By),
          matched: s(x, "Match_State", 20) === "Matched", matchState: s(x, "Match_State", 20), reversalOf: idOf(x.Reversal_Of),
        });
      });
      if (!r.ok || !own) return r;
      const allowed = new Set(allotmentIds);
      const foreign = r.rows.filter((x) => !x.allotmentId || !allowed.has(x.allotmentId));
      return foreign.length ? drift(cred.userId, "investors-receipts", foreign.map((x) => x.id)) : r;
    },

    /** Cases (tickets) of the given contacts (own-book) or every case the token sees. */
    async cases(cred: UserCredential, scope: BookScope, contactIds: readonly string[], signal?: AbortSignal): Promise<ReadResult<CaseRow>> {
      if (scope.kind === "none" || scope.kind === "user") return EMPTY;
      const own = scope.kind === "own-lead" || scope.kind === "own-book";
      const raw = own ? await selectIn(cred, "cases", "Contact_Name", contactIds, signal) : await selectAll(cred, "cases", "id is not null", signal);
      const r = mapRows(raw, (x): CaseRow | null => {
        if (!idOf(x.id)) return null;
        const status = (s(x, "Status", 40) ?? "").toLowerCase();
        const closed = stamp(s(x, "Closed_At", 40));
        const contactId = idOf(x.Contact_Name);
        return Object.freeze({
          id: x.id, contactId, inv: contactId ?? "", t: s(x, "Subject", 255) ?? "", cat: s(x, "Category", 40) ?? "",
          opened: stamp(s(x, "Created_Time", 40)) ?? "", by: (s(x, "Case_Origin", 40) ?? "").toLowerCase() === "investor" ? "investor" : "staff",
          own: idOf(x.Owner) ?? "", pri: (s(x, "Priority", 20) ?? "").toLowerCase() === "high" ? "high" : "normal",
          state: status === "closed" ? "closed" : status.includes("wait") || status.includes("hold") ? "waiting" : "open",
          d: s(x, "Description", 2000) ?? "", sla: stamp(s(x, "SLA_Due", 40)) ?? "",
          ...(closed ? { closed } : {}),
        });
      });
      if (!r.ok || !own) return r;
      const allowed = new Set(contactIds);
      const foreign = r.rows.filter((x) => !x.contactId || !allowed.has(x.contactId));
      return foreign.length ? drift(cred.userId, "investors-cases", foreign.map((x) => x.id)) : r;
    },

    /** ARL_Holdings — the corporate instruments ledger (read-only; org and all scopes only). */
    async holdings(cred: UserCredential, scope: BookScope, signal?: AbortSignal): Promise<ReadResult<ImHolding>> {
      if (scope.kind !== "org" && scope.kind !== "all") return EMPTY;
      return mapRows(await selectAll(cred, "holdings", "id is not null", signal), (x): ImHolding | null => {
        const contact = idOf(x.Contact);
        const type = s(x, "Instrument_Type", 20);
        if (!idOf(x.id) || !contact || !type || !INSTRUMENTS.has(type)) return null;
        return Object.freeze({
          id: x.id, Contact: contact, Instrument_Type: type as ImHolding["Instrument_Type"], Amount_Invested: n(x, "Amount_Invested") ?? 0,
          Invested_On: day(s(x, "Invested_On", 40)) ?? "", Interest_Rate: n(x, "Interest_Rate"), Maturity_On: day(s(x, "Maturity_On", 40)),
        });
      });
    },

    /** ARL_Transactions against the given holdings (read-only). */
    async arlTransactions(cred: UserCredential, holdingIds: readonly string[], signal?: AbortSignal): Promise<ReadResult<ImArlTxn>> {
      const r = mapRows(await selectIn(cred, "arlTransactions", "Holding", holdingIds, signal), (x): ImArlTxn | null => {
        const holding = idOf(x.Holding);
        const type = s(x, "Type", 20);
        if (!idOf(x.id) || !holding || !type || !ARL_TYPES.has(type)) return null;
        return Object.freeze({ id: x.id, Holding: holding, Type: type as ImArlTxnType, Date: day(s(x, "Date", 40)) ?? "", Amount: n(x, "Amount") ?? 0 });
      });
      if (!r.ok) return r;
      const allowed = new Set(holdingIds);
      const foreign = r.rows.filter((x) => !allowed.has(x.Holding));
      return foreign.length ? drift(cred.userId, "investors-arl-transactions", foreign.map((x) => x.id)) : r;
    },
  });
}
export type InvestorsAdapters = ReturnType<typeof createInvestorsAdapters>;
