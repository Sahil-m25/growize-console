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
 * All of it is ./ledger ledgerOf, the one signed ledger the Money section and the receipt replay use: a matched
 * reversal (Reversal_Of) cancels the receipt it names once; a reversal that breaks that convention changes no figure.
 * Counts and totals are over the farm the person picked (all farms when none), before the kind and
 * reconciliation cuts, so the chips read the same whichever chip is on.
 *
 * B-02 (8 Oct 2026): ONE ROW NEVER BLANKS THE REGISTER. Until then any row this module could not parse refused the
 * whole page as source-invalid (502), so one stray receipt hid every rupee from Finance. Now a receipt or allotment
 * that cannot be read is left out of the rows and of the figures it would have moved, and is named in `problems`
 * ("<reason>:<count>"; the record ids go to the ops log only, never to the page). The page says so beside the totals:
 * they are then over what could be read — a stated partial figure, never a guessed one.
 * The legitimate shapes Zoho answers are read as such: picklist values in any letter case ("full" → Full, "not found"
 * → Not found), an Amount sent as a whole-number string or a whole currency value, a lookup as { id } or a bare id,
 * Received_On as a date or a datetime (sent as its YYYY-MM-DD day), and an allotment with no readable Customer or LLP
 * (its receipts still count; the investor or farm reads as unknown).
 */

import type { UserCredential, ZohoClient, ZohoRecord } from "../../lib/zoho/client";
import { isUserCredential } from "../../lib/zoho/client";
import type { ZohoFailureKind } from "../../lib/zoho/errors";
import type { OpsLog } from "../../lib/zoho/log";
import type { SeatedZohoUser } from "../oauth/seat";
import { dueOf, ledgerOf, sumsOf } from "./ledger";

export const RECEIPTS_MODULE = "Receipts";
export const ALLOTMENTS_MODULE = "LLP_UnitAllocation_Module";
const COQL_IN_LIMIT = 100;
const PAGE = 2_000;
const MAX_ROWS = 10_000;
const RECORD_ID = /^\d{15,22}$/;
const RECORD_PREFIX = /^\d{6,16}$/;
const SESSION_ID = /^[A-Za-z0-9_-]{16,128}$/;

export type RegisterKind = "advance" | "balance" | "full" | "refund" | "forfeit";
/** The Zoho Kind, keyed by canon (lower case), → the register's kind. Part is the live name of D70's Balance. */
const KIND: Readonly<Record<string, RegisterKind>> = Object.freeze({
  advance: "advance", part: "balance", balance: "balance", full: "full", refund: "refund", forfeit: "forfeit",
});
/** RegisterKind → the Zoho Kind the ledger reads (Part and Balance are one balance kind). */
const KIND_NAME: Readonly<Record<RegisterKind, string>> = Object.freeze({ advance: "Advance", balance: "Part", full: "Full", refund: "Refund", forfeit: "Forfeit" });
/** Match_State, keyed by canon (lower case), → the org's spelling, which the ledger reads. */
const MATCH_STATE: Readonly<Record<string, string>> = Object.freeze({
  pending: "Pending", matched: "Matched", "not found": "Not found", reversed: "Reversed", claimed: "Claimed",
});

/** Why a row was left out of the register, or read only in part. */
export type RegisterProblem =
  | "receipt-unreadable"    // no valid id, an unknown Kind or Match_State, an Amount that is not whole rupees above 0
  | "receipt-unlinked"      // no Allotment, or one this token cannot read or this module cannot parse
  | "allotment-unreadable"  // no valid id or no Allocation_Status (its receipts are then receipt-unlinked)
  | "allotment-unnamed"     // no readable Customer or LLP: kept, the investor or farm reads as unknown
  | "price-missing"         // a Reserved allotment with no units × price: kept, its still-due is not counted
  | "reversal-anomaly";     // a reversal that breaks the ledger's convention (./ledger): it changes no figure

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
  /** The receipt's own reference (Receipts.Name, e.g. T-0027) — what the page prints; the record id never reaches the screen (W3-1). */
  readonly ref: string | null;
  readonly kind: RegisterKind;
  readonly amount: number;
  readonly mode: string | null;
  /** Always null here (rule 7, D13): the full reference is a second, logged call behind step-up — POST /api/receipts/[id]/reveal. */
  readonly utr: string | null;
  /** The reference as "••• 1234" (its last four) for a seat that records; null when hidden. */
  readonly utrMask: string | null;
  /** The seat holds the reveal right: the row offers "Show the reference". */
  readonly canReveal: boolean;
  /** true: the screen reads "Finance only". */
  readonly utrHidden: boolean;
  /** The day it was received, YYYY-MM-DD. */
  readonly receivedOn: string | null;
  readonly matchState: string;
  readonly reconciled: boolean;
  readonly allotmentId: string;
  /** id null: the allotment names no readable Customer (problem allotment-unnamed) — the row still counts. */
  readonly investor: { readonly id: string | null; readonly name: string | null; /** the ARL ID (ARL-INV-0206), null when Zoho holds none */ readonly code: string | null };
  /** id null: the allotment names no readable LLP (problem allotment-unnamed) — the row still counts. */
  readonly farm: { readonly id: string | null; readonly name: string | null };
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
      readonly farms: readonly { readonly id: string; readonly name: string | null }[]; readonly readOnly: boolean;
      /** What was left out or read in part, as "<RegisterProblem>:<count>", in a fixed order. Empty when every row read. */
      readonly problems: readonly string[] } }
  | { readonly ok: false; readonly kind: "refused"; readonly reasonCode: "invalid-request" | "session-changed" | "capability-missing" | "source-invalid" }
  | { readonly ok: false; readonly kind: "source-error"; readonly errorKind: ZohoFailureKind | "unexpected"; readonly retryable: boolean };

export interface RegisterDependencies {
  readonly crm: Pick<ZohoClient, "coql">;
  readonly access: RegisterAccessAuthority;
  readonly log: OpsLog;
  readonly recordIdPrefix: string;
  readonly clock?: () => number;
}

interface Allot { id: string; investorId: string | null; investorName: string | null; investorCode: string | null; farmId: string | null; farmName: string | null; status: string; commitment: number }
class Fail { constructor(readonly kind: ZohoFailureKind | "unexpected") {} }

const PROBLEM_ORDER: readonly RegisterProblem[] = ["receipt-unreadable", "receipt-unlinked", "allotment-unreadable", "allotment-unnamed", "price-missing", "reversal-anomaly"];

/** "••• 1234": the last four and no more (lib/format maskRef — the same rule, kept here so the server module stays standalone). */
export const maskRef = (v: string): string => (v.trim().length <= 4 ? "••••" : "••• " + v.trim().slice(-4));
/** A picklist value as a lookup key: trimmed, lower case, "_" / "-" / runs of spaces as one space. "-None-" is no value. */
const canon = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const c = v.trim().toLowerCase().replace(/[\s_-]+/g, " ").trim();
  return c && c !== "none" ? c : null;
};
/** Whole numbers: a safe integer, or a whole-number string ("1500000", "1500000.00") as Zoho may send a currency. */
const whole = (v: unknown): number | null => {
  const x = typeof v === "number" ? v : typeof v === "string" && /^\d{1,16}(\.0+)?$/.test(v.trim()) ? Number(v.trim()) : NaN;
  return Number.isSafeInteger(x) ? x : null;
};
/** Received_On, a date or a datetime, as its YYYY-MM-DD day (Zoho stamps it in the org's zone, Asia/Kolkata — rule 9). */
const dayOf = (v: unknown): string | null => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const name = (v: unknown): string | null => {
  const n = v && typeof v === "object" ? (v as { name?: unknown }).name : undefined;
  return typeof n === "string" ? n.slice(0, 120) : null;
};

/** A short reference text (Receipts.Name, Contacts.ARL_ID): trimmed, never an empty string or "-None-". */
const code = (v: unknown): string | null => (typeof v === "string" && v.trim() && v.trim() !== "-None-" ? v.trim().slice(0, 40) : null);

export function createPaymentsRegister(deps: RegisterDependencies) {
  if (!deps || typeof deps.crm?.coql !== "function" || typeof deps.access?.recheck !== "function"
    || typeof deps.log?.refusal !== "function" || typeof deps.recordIdPrefix !== "string" || !RECORD_PREFIX.test(deps.recordIdPrefix)) {
    throw new TypeError("The payments register needs crm.coql, the access authority, the ops log and the CRM record-id prefix.");
  }
  const { crm, access, log } = deps;
  const clock = deps.clock ?? Date.now;
  const validId = (v: unknown): v is string => typeof v === "string" && RECORD_ID.test(v) && v.startsWith(deps.recordIdPrefix);
  /** A lookup, as { id, name? } or a bare id. */
  const idOf = (v: unknown): string | null => { const id = v && typeof v === "object" ? (v as { id?: unknown }).id : v; return validId(id) ? id : null; };
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
  const ALLOT = "id, Customer, Customer.ARL_ID, LLP, Allocation_Status, Issued_Units, Reserved_Units, Unit_Price";
  type Note = (p: RegisterProblem, id: unknown) => void;
  /** One allotment, or null when it cannot be one (its receipts are then receipt-unlinked). */
  const parseAllot = (r: ZohoRecord, note: Note): Allot | null => {
    const status = typeof r.Allocation_Status === "string" ? r.Allocation_Status.trim() : "";
    if (!validId(r.id) || !status || status === "-None-") { note("allotment-unreadable", r.id); return null; }
    const investorId = idOf(r.Customer), farmId = idOf(r.LLP);
    if (!investorId || !farmId) note("allotment-unnamed", r.id);
    const units = status === "Issued" ? whole(r.Issued_Units) : whole(r.Reserved_Units), price = whole(r.Unit_Price);
    const c = units !== null && price !== null && units >= 0 && price >= 0 ? units * price : null;
    const priced = c !== null && Number.isSafeInteger(c);
    if (status === "Reserved" && !priced) note("price-missing", r.id);
    return { id: r.id, investorId, investorName: investorId ? name(r.Customer) : null, investorCode: investorId ? code(r["Customer.ARL_ID"]) : null, farmId, farmName: farmId ? name(r.LLP) : null,
      status, commitment: priced ? (c as number) : 0 };
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
      const problems = new Map<RegisterProblem, string[]>();
      const note: Note = (p, id) => { const ids = problems.get(p) ?? []; ids.push(typeof id === "string" && RECORD_ID.test(id) ? id : ""); problems.set(p, ids); };
      try {
        const receipts = await all(cred, "select id, Name, Allotment, Kind, Amount, Mode, UTR, Received_On, Match_State, Reversal_Of, Created_By from Receipts where id is not null order by Received_On desc", signal);
        const reserved = await all(cred, `select ${ALLOT} from ${ALLOTMENTS_MODULE} where Allocation_Status = 'Reserved' order by id asc`, signal);
        const allots = new Map<string, Allot>();
        const asked = new Set<string>();
        for (const r of reserved) { const p = parseAllot(r, note); if (p) allots.set(p.id, p); if (validId(r.id)) asked.add(r.id); }
        const need = [...new Set(receipts.map((r) => idOf(r.Allotment)).filter((id): id is string => !!id && !asked.has(id)))];
        for (let i = 0; i < need.length; i += COQL_IN_LIMIT) {
          const rows = await all(cred, `select ${ALLOT} from ${ALLOTMENTS_MODULE} where id in (${need.slice(i, i + COQL_IN_LIMIT).map((x) => `'${x}'`).join(", ")}) order by id asc`, signal);
          for (const r of rows) { const p = parseAllot(r, note); if (p) allots.set(p.id, p); }
        }

        const rows: RegisterRow[] = [];
        for (const r of receipts) {
          const kindKey = canon(r.Kind), stateKey = canon(r.Match_State);
          const kind = kindKey ? KIND[kindKey] : undefined, amount = whole(r.Amount), match = stateKey ? MATCH_STATE[stateKey] : undefined;
          if (!validId(r.id) || !kind || amount === null || amount <= 0 || !match) { note("receipt-unreadable", r.id); continue; }
          const allotmentId = idOf(r.Allotment), al = allotmentId ? allots.get(allotmentId) : undefined;
          if (!al) { note("receipt-unlinked", r.id); continue; }
          const utr = typeof r.UTR === "string" && r.UTR.trim() ? r.UTR.slice(0, 80) : null;
          rows.push(Object.freeze({
            id: r.id, ref: code(r.Name), kind, amount, mode: typeof r.Mode === "string" && r.Mode && r.Mode !== "-None-" ? r.Mode : null,
            utr: null, utrMask: a.seesUtr && utr ? maskRef(utr) : null, canReveal: a.seesUtr && !!utr, utrHidden: !a.seesUtr,
            receivedOn: dayOf(r.Received_On),
            matchState: match, reconciled: match === "Matched", allotmentId: al.id,
            investor: Object.freeze({ id: al.investorId, name: al.investorName, code: al.investorCode }), farm: Object.freeze({ id: al.farmId, name: al.farmName }),
            recordedById: idOf(r.Created_By), reversalOf: idOf(r.Reversal_Of),
          }));
        }

        const inFarm = filter.farm ? rows.filter((r) => r.farm.id === filter.farm) : rows;
        // The one signed ledger (./ledger): refunds out, a matched reversal cancels its receipt once, Pending apart (D21).
        // A reversal that breaks the convention cancels nothing (the ledger's own rule): reported, never a refusal.
        const ledger = ledgerOf(rows.map((r) => ({ id: r.id, allotmentId: r.allotmentId, kind: KIND_NAME[r.kind], amount: r.amount, matchState: r.matchState, reversalOf: r.reversalOf })));
        for (const id of ledger.anomalies) note("reversal-anomaly", id);
        const inFarmAllots = new Set([...allots.values()].filter((x) => !filter.farm || x.farmId === filter.farm).map((x) => x.id));
        let received = 0, refunded = 0, recIn = 0, recOut = 0;
        for (const id of inFarmAllots) { const s = sumsOf(ledger, id); received += s.matchedIn; refunded += s.matchedOut; recIn += s.pendingIn; recOut += s.pendingOut; }
        const stillDue = [...allots.values()].filter((x) => inFarmAllots.has(x.id)).reduce((t, x) => t + dueOf(x.status, x.commitment, sumsOf(ledger, x.id)), 0);
        const cut: Record<string, (r: RegisterRow) => boolean> = {
          advance: (r) => r.kind === "advance",
          full: (r) => r.kind === "full" || r.kind === "balance",
          out: (r) => r.kind === "refund" || r.kind === "forfeit",
        };
        const counts: RegisterCounts = Object.freeze({ all: inFarm.length, advance: inFarm.filter(cut.advance).length, full: inFarm.filter(cut.full).length,
          out: inFarm.filter(cut.out).length, pending: inFarm.filter((r) => !r.reconciled).length });
        const shown = inFarm.filter((r) => (!filter.kind || cut[filter.kind](r)) && (filter.reconciled === undefined || r.reconciled === filter.reconciled));
        const farms = new Map<string, string | null>();
        for (const x of allots.values()) if (x.farmId && !farms.has(x.farmId)) farms.set(x.farmId, x.farmName);
        // Record ids only, to the ops log (never to the page, never an amount or a name): one line per reason.
        for (const p of PROBLEM_ORDER) {
          const ids = problems.get(p);
          if (ids) log.refusal({ at: clock(), actor, action: "payments-register", reason: `source-invalid.${p}`, recordIds: [...new Set(ids.filter(Boolean))] });
        }
        return { ok: true, value: {
          rows: Object.freeze(shown), counts,
          totals: Object.freeze({ received, refunded, netBanked: received - refunded, stillDue,
            recorded: Object.freeze({ received: recIn, refunded: recOut, net: recIn - recOut }) }),
          farms: Object.freeze([...farms].sort((x, y) => x[0].localeCompare(y[0])).map(([id, n]) => Object.freeze({ id, name: n }))),
          readOnly: !a.canRecord,
          problems: Object.freeze(PROBLEM_ORDER.filter((p) => problems.has(p)).map((p) => `${p}:${problems.get(p)!.length}`)),
        } };
      } catch (e) {
        if (e instanceof Fail) return { ok: false, kind: "source-error", errorKind: e.kind, retryable: e.kind === "network" || e.kind === "server" || e.kind === "busy" };
        throw e;
      }
    },
  });
}
