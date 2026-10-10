/**
 * M11-S02-T02 — ALLOTMENT READS BY CONTACT AND BY LLP (D45, D53, D54, D70).
 *
 * An allotment (LLP_UnitAllocation_Module) links one investor Contact (Customer) to one farm LLP (LLP).
 * Both directions are Zoho related-list reads on the signed-in person's own token — the API names were
 * confirmed read-only with getRelatedLists (28 Sep 2026):
 *   Contacts/{id}/Customer1               — the Contact's allotments  (label "Customer")
 *   LLP_Creation_Module/{id}/Customer_List — the LLP's allotments     (label "Customer  List")
 * (the older LLP_Unit_Allocation module's lists, LLP_Customer_List / Units_list, are not read — M11-S02-T01).
 *
 * Scope by seat, reusing the one choke point (../data/ir-guard, ../data/scope):
 *   by Contact — the Contact is admitted first (ir-guard `one`: a KAM only their own book, an IR only a
 *                Contact from their own lead); every related row must name that Contact or the read is
 *                refused as scope drift (Plane B), never trimmed.
 *   by LLP     — a seat with an own-book / own-lead investors scope sees only the allotments of the
 *                Contacts that scope admits (read through the same WHERE clause the Investors list uses);
 *                org / subtree / all see every allotment the token returns.
 * The fields follow the record's section rules (./record sectionsFor, read-only): a seat without Money
 * (KAM, Head of AM, IR) reads the account-management projection — units, farm, status, hold; no price, no
 * amount — so a number it may not see is never even read. D138 (B-10): an IR's rows then carry the allotment's
 * Unit_Price where Zoho shows it to the IR (./ir-money, per field); and (D139, W2-KAM-1 ruled) so do a KAM's and the Head of AM's — on their own token, per field. Agreement_Signed is given only where Paper shows.
 * Payment_Status: the org has no such field on the module (getFields, 28 Sep 2026), so it is worked out from
 * the linked Receipts with money/allotment-receipts' rule (../money/by-allotment moneyOf) — Money seats only.
 *
 * The unit price and ticket are shown as recorded on the allotment, never recomputed from the LLP's price.
 * A Cancelled allotment is listed but its units count as neither reserved nor issued. No copy is kept:
 * rows live for one response, nothing is cached (D45).
 */

import type { UserCredential, ZohoClient, ZohoRecord } from "../../lib/zoho/client";
import type { ZohoFailureKind } from "../../lib/zoho/errors";
import { createInvestorsAdapters, type ReceiptRow } from "../data/adapters";
import type { InvestorEvents } from "../data/events";
import { admitContact, createInvestorGuard, type GuardRefusal, type PlaneCRefusal } from "../data/ir-guard";
import { checkAmProjection, checkProjection, MODULES } from "../data/projections";
import { isAmSeat } from "../data/am-scope";
import { scopesFor } from "../data/scope";
import { moneyOf } from "../money/by-allotment";
import type { PaymentStatus } from "../money/allotment-receipts";
import { sectionsFor } from "./record";
import { readIrMoney } from "./ir-money";

const RECORD_ID = /^\d{15,22}$/;
export const CONTACT_ALLOTMENTS_LIST = "Customer1";
export const LLP_ALLOTMENTS_LIST = "Customer_List";
const PER_PAGE = 200;
const MAX_PAGES = 10;

/** Finance-side projection: no identity field, no Customer_Email (checked at load). */
export const ALLOTMENT_FIELDS = checkProjection(MODULES.allotments, [
  "id", "Customer", "LLP", "Allocation_Status", "Reserved_Units", "Issued_Units", "Unit_Price", "Capital_Invested",
  "Token_Advance_Amount", "Total_Amount_Received", "Total_Amount_Receivable", "Investment_Date", "Hold_Until", "Supplementary_Verified_At",
]);
/** Account-management projection (KAM, Head of AM, IR): no money field (checked at load). */
export const AM_ALLOTMENT_FIELDS = checkAmProjection(MODULES.amAllotments, [
  "id", "Customer", "LLP", "Allocation_Status", "Reserved_Units", "Issued_Units", "Investment_Date", "Hold_Until",
]);
const PAPER_FIELD = "Supplementary_Verified_At";

export type AllocationStatus = "Reserved" | "Issued" | "Cancelled";

export interface AllotmentLine {
  readonly id: string;
  readonly investor: { readonly id: string; readonly name: string | null };
  readonly llp: { readonly id: string | null; readonly name: string | null };
  readonly status: AllocationStatus;
  readonly reservedUnits: number;
  readonly issuedUnits: number;
  /** max(reserved, issued) — the units the investor committed to (the Investors list's rule). */
  readonly committedUnits: number;
  /** Unit_Price as recorded; null where Money is hidden. */
  readonly unitPrice: number | null;
  /** Ticket snapshot = committed units × the recorded unit price; null where Money is hidden. */
  readonly amount: number | null;
  readonly capitalInvested: number | null;
  /** Worked out from linked Receipts (money/allotment-receipts rule); null where Money is hidden. */
  readonly paymentStatus: PaymentStatus | null;
  /** Supplementary agreement verified; null where Paper is hidden. */
  readonly agreementSigned: boolean | null;
  readonly investedOn: string | null;
  readonly holdUntil: string | null;
  /** false when the row lacks its Contact or its LLP link (AC1: both are required). */
  readonly linked: boolean;
}

export type AllotmentRefusal = GuardRefusal | { readonly ok: false; readonly kind: "refused"; readonly reason: "scope-drift" | "source-invalid" | "seat-denied" | "invalid-request" };
export type SourceError = { readonly ok: false; readonly kind: "source-error"; readonly errorKind: ZohoFailureKind | "unexpected" | string };

export type ByContactResult =
  | { readonly ok: true; readonly contactId: string; readonly rows: readonly AllotmentLine[]; readonly money: boolean; readonly paper: boolean;
      /** The Receipts read for a Money seat (for ../money/by-allotment); null otherwise. */
      readonly receipts: readonly ReceiptRow[] | null; readonly truncated: boolean }
  | AllotmentRefusal | SourceError;

export type ByLlpResult =
  | { readonly ok: true; readonly llpId: string; readonly rows: readonly AllotmentLine[]; readonly money: boolean;
      /** Units over the rows shown, Cancelled excluded (AC4). */
      readonly units: { readonly reserved: number; readonly issued: number };
      /** true when the seat sees only its own investors, so the totals are not the LLP's. */
      readonly scoped: boolean; readonly truncated: boolean }
  | AllotmentRefusal | SourceError;

export interface AllotmentReaderDeps {
  readonly crm: Pick<ZohoClient, "coql" | "getRelated">;
  readonly events: InvestorEvents;
  readonly planeCRefusal?: (e: PlaneCRefusal) => void;
}

const idOf = (v: unknown): string | null => {
  if (typeof v === "string" && RECORD_ID.test(v)) return v;
  const id = v && typeof v === "object" && !Array.isArray(v) ? (v as { id?: unknown }).id : undefined;
  return typeof id === "string" && RECORD_ID.test(id) ? id : null;
};
const nameOf = (v: unknown): string | null => {
  const n = v && typeof v === "object" && !Array.isArray(v) ? (v as { name?: unknown }).name : undefined;
  return typeof n === "string" && n !== "" ? n.slice(0, 120) : null;
};
const num = (r: ZohoRecord, k: string): number | null => {
  const v = r[k];
  const x = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(x) ? x : null;
};
const text = (r: ZohoRecord, k: string): string | null => (typeof r[k] === "string" && r[k] !== "" ? (r[k] as string).slice(0, 40) : null);
const day = (v: string | null): string | null => (v && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

class Fail { constructor(readonly kind: ZohoFailureKind | "unexpected") {} }
class Invalid { constructor(readonly ids: readonly string[]) {} }

export function createAllotmentReader(deps: AllotmentReaderDeps) {
  const { crm, events } = deps;
  const guard = createInvestorGuard({ events, planeCRefusal: deps.planeCRefusal });
  const adapters = createInvestorsAdapters({ crm, events });

  /** Every page of one related list; a 204 / not-found is an empty list. */
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

  const line = (x: ZohoRecord, money: boolean, paper: boolean): AllotmentLine | null => {
    if (!idOf(x.id)) return null;
    const st = text(x, "Allocation_Status");
    const status: AllocationStatus = st === "Issued" || st === "Cancelled" ? st : "Reserved";
    const reserved = num(x, "Reserved_Units") ?? 0, issued = num(x, "Issued_Units") ?? 0, committed = Math.max(reserved, issued);
    const price = money ? num(x, "Unit_Price") : null;
    const investorId = idOf(x.Customer), llpId = idOf(x.LLP);
    return Object.freeze({
      id: x.id, investor: Object.freeze({ id: investorId ?? "", name: nameOf(x.Customer) }), llp: Object.freeze({ id: llpId, name: nameOf(x.LLP) }),
      status, reservedUnits: reserved, issuedUnits: issued, committedUnits: committed,
      unitPrice: price, amount: price === null ? null : committed * price, capitalInvested: money ? num(x, "Capital_Invested") : null,
      paymentStatus: null, agreementSigned: paper ? !!text(x, PAPER_FIELD) : null,
      investedOn: day(text(x, "Investment_Date")), holdUntil: day(text(x, "Hold_Until")), linked: !!investorId && !!llpId,
    });
  };

  /** The unit price as Zoho returns it on the seat's own token, per field (./ir-money); where Zoho hides it the row keeps null —
   *  never a figure worked out from anything else. */
  async function withZohoPrice(cred: UserCredential, rows: readonly AllotmentLine[], signal?: AbortSignal): Promise<readonly AllotmentLine[]> {
    const m = await readIrMoney(crm, cred, rows.map((a) => a.id), signal);
    return m ? rows.map((a) => {
      const price = m.get(a.id)?.unitPrice ?? null;
      return price === null ? a : Object.freeze({ ...a, unitPrice: price, amount: a.committedUnits * price });
    }) : rows;
  }

  const failure = (userId: string, action: string, e: unknown): AllotmentRefusal | SourceError => {
    if (e instanceof Invalid) { events.refusal(userId, action, "source-invalid", e.ids); return { ok: false, kind: "refused", reason: "source-invalid" }; }
    return { ok: false, kind: "source-error", errorKind: e instanceof Fail ? e.kind : "unexpected" };
  };

  return Object.freeze({
    /** The allotments of one investor (the investor record's "What they hold"). */
    async byContact(cred: UserCredential, seat: string, contactId: string, signal?: AbortSignal, opts: { readonly requireMoney?: boolean } = {}): Promise<ByContactResult> {
      const me = cred.userId, action = opts.requireMoney ? "investor-money" : "investor-allotments";
      if (typeof contactId !== "string" || !RECORD_ID.test(contactId)) return guard.refuse(me, seat, action, "invalid-request", []);
      const sections = sectionsFor(seat, me);
      if (!sections) return guard.refuse(me, seat, action, "seat-denied", [contactId]);
      const money = sections.includes("money"), paper = sections.includes("paper");
      if (opts.requireMoney && !money) return guard.refuse(me, seat, action, "seat-denied", [contactId]);

      const one = await guard.one(crm, cred, seat, contactId, signal);
      if (!one.ok) return one;

      let got: { rows: ZohoRecord[]; truncated: boolean };
      try { got = await related(cred, MODULES.contacts, contactId, CONTACT_ALLOTMENTS_LIST, money ? ALLOTMENT_FIELDS : AM_ALLOTMENT_FIELDS, signal); }
      catch (e) { return failure(me, action, e); }
      const rows = got.rows.map((x) => line(x, money, paper)).filter((x): x is AllotmentLine => x !== null);
      const foreign = rows.filter((a) => a.investor.id !== contactId);
      if (foreign.length) { events.refusal(me, action, "scope-drift", foreign.map((a) => a.id)); return { ok: false, kind: "refused", reason: "scope-drift" }; }

      let receipts: readonly ReceiptRow[] | null = null;
      let out: readonly AllotmentLine[] = rows;
      if (money && rows.length) {
        const rc = await adapters.receipts(cred, scopesFor(seat, me).money, rows.map((a) => a.id), signal, true);
        if (!rc.ok) return rc.kind === "refused" ? { ok: false, kind: "refused", reason: rc.reason === "scope-drift" || rc.reason === "source-invalid" ? rc.reason : "scope-drift" }
          : { ok: false, kind: "source-error", errorKind: rc.errorKind };
        receipts = rc.rows;
        out = rows.map((a) => Object.freeze({ ...a, paymentStatus: moneyOf({ id: a.id, status: a.status, units: a.committedUnits, unitPrice: a.unitPrice ?? 0 }, rc.rows).paymentStatus }));
      } else if (money) receipts = Object.freeze([]);
      /* D138 (B-10) / D139 (W2-KAM-1): an IR, a KAM and the Head of AM see the unit price as Zoho shows it to them */
      if (!money && rows.length && (scopesFor(seat, me).investors.kind === "own-lead" || isAmSeat(seat))) out = await withZohoPrice(cred, out, signal);
      return { ok: true, contactId, rows: Object.freeze(out), money, paper, receipts, truncated: got.truncated };
    },

    /** The investors holding allotments in one LLP (Farms), within the seat's investors scope. */
    async byLlp(cred: UserCredential, seat: string, llpId: string, signal?: AbortSignal): Promise<ByLlpResult> {
      const me = cred.userId, action = "farm-allotments";
      if (typeof llpId !== "string" || !RECORD_ID.test(llpId)) return guard.refuse(me, seat, action, "invalid-request", []);
      const sections = sectionsFor(seat, me);
      const scope = scopesFor(seat, me).investors;
      if (!sections) return guard.refuse(me, seat, action, "seat-denied", [llpId]);
      const money = sections.includes("money");

      let got: { rows: ZohoRecord[]; truncated: boolean };
      try { got = await related(cred, MODULES.llps, llpId, LLP_ALLOTMENTS_LIST, money ? ALLOTMENT_FIELDS : AM_ALLOTMENT_FIELDS, signal); }
      catch (e) { return failure(me, action, e); }
      let rows: readonly AllotmentLine[] = got.rows.map((x) => line(x, money, false)).filter((x): x is AllotmentLine => x !== null);
      const foreignLlp = rows.filter((a) => a.llp.id !== llpId);
      if (foreignLlp.length) { events.refusal(me, action, "scope-drift", foreignLlp.map((a) => a.id)); return { ok: false, kind: "refused", reason: "scope-drift" }; }

      const scoped = scope.kind === "own-book" || scope.kind === "own-lead";
      if (scoped) {
        // The seat's own investors, read through the same WHERE clause and admission as the Investors list.
        const mine = await adapters.contacts(cred, scope, signal);
        if (!mine.ok) return mine.kind === "refused" ? { ok: false, kind: "refused", reason: mine.reason === "source-invalid" ? "source-invalid" : "scope-drift" }
          : { ok: false, kind: "source-error", errorKind: mine.errorKind };
        const admitted = new Set(mine.rows.filter((c) => admitContact(scope, c).ok).map((c) => c.id));
        rows = rows.filter((a) => admitted.has(a.investor.id));
      }
      /* D139 (W2-KAM-1): a KAM / Head of AM reads the unit price the same way */
      if (!money && isAmSeat(seat) && rows.length) rows = await withZohoPrice(cred, rows, signal);
      const live = rows.filter((a) => a.status !== "Cancelled");
      return {
        ok: true, llpId, rows: Object.freeze(rows), money, scoped, truncated: got.truncated,
        units: Object.freeze({
          reserved: live.filter((a) => a.status === "Reserved").reduce((t, a) => t + a.reservedUnits, 0),
          issued: live.filter((a) => a.status === "Issued").reduce((t, a) => t + a.issuedUnits, 0),
        }),
      };
    },
  });
}
export type AllotmentReader = ReturnType<typeof createAllotmentReader>;
