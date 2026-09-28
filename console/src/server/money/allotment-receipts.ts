/**
 * M10-S07-T02 — allotment-scoped receipt writes (D70: a receipt belongs to one allotment, and through it
 * to the investor (Contact) and the farm (LLP)).
 *
 * A guard layer in front of every Receipt write. It does not change the M01-S08 replay path
 * (receipt-replay.ts); it wraps it:
 *   1. every write names an allotment id of this org, or it is refused (`allotment-required`);
 *   2. the allotment is read on the person's own token (D53); a Cancelled allotment takes no receipt
 *      except a Refund (`allotment-cancelled`);
 *   3. after a successful write the allotment is re-read and its Payment_Status returned. T01's Zoho
 *      workflow is the only writer of Payment_Status (rule 1); this layer never writes it. It also
 *      works out the value the workflow should hold from the MATCHED receipts against the allotment
 *      amount and flags a mismatch (PROVISIONAL, Jev: re-read + compute, never write).
 * A 412 from Zoho (the allotment/receipt changed under the write, D44) is answered as `allotment-changed`,
 * not as an unknown outcome. Recording stays free and matching stays gated (D21): new receipts are
 * Pending, and nothing here moves Match_State. Nothing is cached (D45); logs carry ids and codes only.
 */

import type { UserCredential, ZohoClient, ZohoRecord } from "../../lib/zoho/client";
import { isUserCredential } from "../../lib/zoho/client";
import type { ZohoFailureKind } from "../../lib/zoho/errors";
import type { OpsLog } from "../../lib/zoho/log";
import type { QueuedReceiptReplay, ReceiptReplayPrincipal, ReceiptReplayResult, ReceiptReplayService } from "./receipt-replay";
import { ALLOTMENTS_MODULE, RECEIPTS_MODULE } from "./receipt-replay";

export const PAYMENT_STATUS_FIELD = "Payment_Status";
export const PAYMENT_STATUSES = ["Yet to initiate", "Partial", "Full"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

const RECORD_ID = /^\d{15,22}$/;
const RECORD_PREFIX = /^\d{6,16}$/;
const SESSION_ID = /^[A-Za-z0-9_-]{16,128}$/;
const RECEIPT_PAGE = 2_000;
/** Kinds that bring money in; Part is the live name of D70's Balance. */
const INBOUND: ReadonlySet<string> = new Set(["Advance", "Part", "Balance", "Full"]);
const ALLOTMENT_FIELDS = Object.freeze(["Allocation_Status", "Reserved_Units", "Issued_Units", "Unit_Price", "Customer", "LLP", PAYMENT_STATUS_FIELD]);

export type AllotmentReceiptRefusal =
  | "invalid-request"
  | "allotment-required"
  | "allotment-not-visible"
  | "allotment-cancelled"
  | "allotment-changed"
  | "source-invalid";

export interface PaymentStatusReading {
  /** What Zoho holds now (T01's workflow). null: the field is absent or empty (workflow not live yet). */
  readonly live: PaymentStatus | null;
  /** Worked out here from matched receipts against units × unit price. */
  readonly expected: PaymentStatus;
  /** The value to show: Zoho's when it has one, else the computed one. */
  readonly value: PaymentStatus;
  readonly source: "zoho" | "computed";
  /** true when Zoho holds a value that disagrees with the matched receipts. */
  readonly mismatch: boolean;
  readonly receivedRupees: number;
  readonly amountRupees: number;
}

export interface AllotmentLink {
  readonly allotmentId: string;
  readonly investorId: string;
  readonly farmId: string;
}

export type AllotmentReceiptResult =
  | {
      readonly ok: true;
      readonly receiptId: string;
      readonly duplicate: boolean;
      readonly link: AllotmentLink;
      /** null when the write landed but the re-read failed: the receipt stands; reload to see the status. */
      readonly paymentStatus: PaymentStatusReading | null;
    }
  | { readonly ok: false; readonly kind: "refused"; readonly reasonCode: AllotmentReceiptRefusal; readonly retryable: false }
  | { readonly ok: false; readonly kind: "source-error"; readonly errorKind: ZohoFailureKind | "unexpected"; readonly retryable: boolean }
  | Exclude<ReceiptReplayResult, { readonly ok: true }>;

export type PaymentStatusResult =
  | { readonly ok: true; readonly value: PaymentStatusReading }
  | Extract<AllotmentReceiptResult, { readonly ok: false; readonly kind: "refused" | "source-error" }>;

export interface AllotmentReceiptDependencies {
  readonly crm: Pick<ZohoClient, "getRecord" | "coql">;
  /** The M01-S08 write path; the only writer of Receipts this layer calls. */
  readonly replay: Pick<ReceiptReplayService, "replay">;
  readonly log: OpsLog;
  readonly recordIdPrefix: string;
  readonly clock?: () => number;
}

/** Any Receipt write (the replay path today; M10's approved refund flow later). */
export type ReceiptWrite = (signal?: AbortSignal) => Promise<ReceiptReplayResult>;

export interface AllotmentReceiptWrites {
  /** Record one receipt through the replay path, scoped to its allotment. */
  record(principal: ReceiptReplayPrincipal, command: QueuedReceiptReplay, signal?: AbortSignal): Promise<AllotmentReceiptResult>;
  /** The same guard for any other Receipt writer: allotment required, Cancelled takes refunds only. */
  guarded(principal: ReceiptReplayPrincipal, allotmentId: unknown, kind: unknown, write: ReceiptWrite, signal?: AbortSignal): Promise<AllotmentReceiptResult>;
  /** Read-only: the allotment's Payment_Status beside the value its matched receipts give. */
  paymentStatus(principal: ReceiptReplayPrincipal, allotmentId: unknown, signal?: AbortSignal): Promise<PaymentStatusResult>;
}

/** D70 / zoho mapping: Received = 0 → Yet to initiate; Receivable > 0 → Partial; else Full. */
export function expectedPaymentStatus(receivedRupees: number, amountRupees: number): PaymentStatus {
  if (receivedRupees <= 0) return "Yet to initiate";
  return amountRupees - receivedRupees > 0 ? "Partial" : "Full";
}

class Unreadable { constructor(readonly ids: readonly string[]) {} }
class SourceFail { constructor(readonly kind: ZohoFailureKind | "unexpected") {} }

const int = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) ? v : null);
const retryableKind = (k: ZohoFailureKind | "unexpected"): boolean =>
  k === "network" || k === "server" || k === "busy" || k === "concurrency-exceeded" || k === "rate-limited-unclassified";

export function createAllotmentReceiptWrites(deps: AllotmentReceiptDependencies): AllotmentReceiptWrites {
  if (!deps || typeof deps.crm?.getRecord !== "function" || typeof deps.crm?.coql !== "function"
    || typeof deps.replay?.replay !== "function" || typeof deps.log?.refusal !== "function"
    || typeof deps.recordIdPrefix !== "string" || !RECORD_PREFIX.test(deps.recordIdPrefix)) {
    throw new TypeError("allotment receipt writes need crm.getRecord/coql, the replay service, the ops log and the CRM record-id prefix");
  }
  const { crm, replay, log } = deps;
  const clock = deps.clock ?? Date.now;
  const validId = (v: unknown): v is string => typeof v === "string" && RECORD_ID.test(v) && v.startsWith(deps.recordIdPrefix);
  const idOf = (v: unknown): string | null => {
    const id = v && typeof v === "object" ? (v as { id?: unknown }).id : undefined;
    return validId(id) ? id : null;
  };
  const trusted = (p: unknown): { credential: UserCredential; sessionId: string } | null => {
    const c = p && typeof p === "object" ? (p as { credential?: unknown; sessionId?: unknown }) : null;
    return c && isUserCredential(c.credential) && typeof c.sessionId === "string" && SESSION_ID.test(c.sessionId)
      ? { credential: c.credential, sessionId: c.sessionId }
      : null;
  };
  const refuse = (
    principal: { credential: UserCredential } | null,
    reasonCode: AllotmentReceiptRefusal,
    recordIds: readonly unknown[] = [],
  ): Extract<AllotmentReceiptResult, { kind: "refused" }> => {
    let at = 0;
    try { at = clock(); } catch { /* the refusal still stands */ }
    log.refusal({
      at,
      actor: { kind: "user", userId: principal?.credential.userId ?? "unrecognised" },
      action: "allotment-receipt",
      reason: reasonCode,
      recordIds: recordIds.filter(validId),
    });
    return { ok: false, kind: "refused", reasonCode, retryable: false };
  };

  interface Allot { status: string; amount: number; investorId: string; farmId: string; live: PaymentStatus | null; liveInvalid: boolean }
  const readAllotment = async (cred: UserCredential, allotmentId: string, signal?: AbortSignal): Promise<Allot | "not-visible"> => {
    const r = await crm.getRecord(cred, ALLOTMENTS_MODULE, allotmentId, { fields: ALLOTMENT_FIELDS, signal });
    if (!r.ok) {
      if (r.error.kind === "not-found" || r.error.kind === "forbidden") return "not-visible";
      throw new SourceFail(r.error.kind);
    }
    if (!r.value) return "not-visible";
    const rec: ZohoRecord = r.value;
    if (rec.id !== allotmentId) throw new Unreadable([allotmentId, rec.id]);
    const status = typeof rec.Allocation_Status === "string" ? rec.Allocation_Status : "";
    const investorId = idOf(rec.Customer), farmId = idOf(rec.LLP);
    // Same convention as the Payments register, so AC5's farm totals come from one rule.
    const units = status === "Issued" ? int(rec.Issued_Units) : int(rec.Reserved_Units);
    const price = int(rec.Unit_Price);
    const amount = units !== null && price !== null && units >= 0 && price >= 0 ? units * price : null;
    if (!["Reserved", "Issued", "Cancelled"].includes(status) || !investorId || !farmId
      || amount === null || !Number.isSafeInteger(amount)) throw new Unreadable([allotmentId]);
    const raw = rec[PAYMENT_STATUS_FIELD];
    const empty = raw === undefined || raw === null || raw === "";
    const live = !empty && typeof raw === "string" && (PAYMENT_STATUSES as readonly string[]).includes(raw) ? (raw as PaymentStatus) : null;
    return { status, amount, investorId, farmId, live, liveInvalid: !empty && live === null };
  };

  const matchedReceived = async (cred: UserCredential, allotmentId: string, signal?: AbortSignal): Promise<number> => {
    const r = await crm.coql(cred,
      `select id, Allotment, Kind, Amount, Match_State from ${RECEIPTS_MODULE} where Allotment = '${allotmentId}' limit 0, ${RECEIPT_PAGE}`,
      { signal });
    if (!r.ok) throw new SourceFail(r.error.kind);
    if (r.value.invalidRecordIds || r.value.moreRecords) throw new Unreadable([allotmentId]);
    let inbound = 0, refunded = 0;
    for (const row of r.value.records) {
      const amount = int(row.Amount);
      if (!validId(row.id) || idOf(row.Allotment) !== allotmentId || amount === null || amount <= 0
        || typeof row.Kind !== "string" || typeof row.Match_State !== "string") throw new Unreadable([allotmentId, row.id]);
      if (row.Match_State !== "Matched") continue; // only matched money moves the status (AC3, D21)
      if (INBOUND.has(row.Kind)) inbound += amount;
      else if (row.Kind === "Refund") refunded += amount;
    }
    const net = inbound - refunded;
    if (!Number.isSafeInteger(net)) throw new Unreadable([allotmentId]);
    return Math.max(0, net);
  };

  const reading = async (cred: UserCredential, allotmentId: string, signal?: AbortSignal): Promise<PaymentStatusReading | "not-visible"> => {
    const a = await readAllotment(cred, allotmentId, signal);
    if (a === "not-visible") return a;
    if (a.liveInvalid) throw new Unreadable([allotmentId]);
    const receivedRupees = await matchedReceived(cred, allotmentId, signal);
    const expected = expectedPaymentStatus(receivedRupees, a.amount);
    return Object.freeze({
      live: a.live,
      expected,
      value: a.live ?? expected,
      source: a.live ? "zoho" as const : "computed" as const,
      mismatch: a.live !== null && a.live !== expected,
      receivedRupees,
      amountRupees: a.amount,
    });
  };

  const failureOf = (principal: { credential: UserCredential }, e: unknown, allotmentId: string) => {
    if (e instanceof Unreadable) return refuse(principal, "source-invalid", e.ids);
    if (e instanceof SourceFail) {
      if (e.kind === "conflict") return refuse(principal, "allotment-changed", [allotmentId]);
      return { ok: false as const, kind: "source-error" as const, errorKind: e.kind, retryable: retryableKind(e.kind) };
    }
    return { ok: false as const, kind: "source-error" as const, errorKind: "unexpected" as const, retryable: true };
  };

  const guarded: AllotmentReceiptWrites["guarded"] = async (principal, allotmentId, kind, write, signal) => {
    const p = trusted(principal);
    if (!p || typeof write !== "function" || typeof kind !== "string" || !kind) return refuse(p, "invalid-request");
    if (allotmentId === undefined || allotmentId === null || allotmentId === "") return refuse(p, "allotment-required");
    if (!validId(allotmentId)) return refuse(p, "allotment-required");
    let link: AllotmentLink;
    try {
      const a = await readAllotment(p.credential, allotmentId, signal);
      if (a === "not-visible") return refuse(p, "allotment-not-visible", [allotmentId]);
      if (a.status === "Cancelled" && kind !== "Refund") return refuse(p, "allotment-cancelled", [allotmentId]);
      link = Object.freeze({ allotmentId, investorId: a.investorId, farmId: a.farmId });
    } catch (e) {
      return failureOf(p, e, allotmentId);
    }
    let written: ReceiptReplayResult;
    try {
      written = await write(signal);
    } catch {
      // The writer owns idempotent recovery; a throw here means the outcome was not reported.
      return { ok: false, kind: "source-error", errorKind: "unexpected", retryable: true };
    }
    if (!written.ok) {
      // D44: a 412 means the record changed under the write. Say so plainly; nothing was guessed.
      if (written.kind === "source-error" && written.errorKind === "conflict") return refuse(p, "allotment-changed", [allotmentId]);
      return written;
    }
    let paymentStatus: PaymentStatusReading | null = null;
    try {
      const r = await reading(p.credential, allotmentId, signal);
      paymentStatus = r === "not-visible" ? null : r;
      if (paymentStatus?.mismatch) {
        log.refusal({ at: clock(), actor: { kind: "user", userId: p.credential.userId }, action: "allotment-receipt",
          reason: "payment-status-mismatch", recordIds: [allotmentId, written.receiptId].filter(validId) });
      }
    } catch {
      paymentStatus = null; // the receipt stands; only the read-back failed
    }
    return { ok: true, receiptId: written.receiptId, duplicate: written.duplicate, link, paymentStatus };
  };

  const writes: AllotmentReceiptWrites = {
    guarded,
    async record(principal, command, signal) {
      const p = trusted(principal);
      if (!p || !command || typeof command !== "object" || !command.intent || typeof command.intent !== "object") {
        return refuse(p, "invalid-request");
      }
      const { allotmentId, kind } = command.intent as { allotmentId?: unknown; kind?: unknown };
      return guarded(p, allotmentId, kind, (s) => replay.replay(p, command, s), signal);
    },
    async paymentStatus(principal, allotmentId, signal) {
      const p = trusted(principal);
      if (!p) return refuse(null, "invalid-request");
      if (!validId(allotmentId)) return refuse(p, "allotment-required");
      try {
        const r = await reading(p.credential, allotmentId, signal);
        return r === "not-visible" ? refuse(p, "allotment-not-visible", [allotmentId]) : { ok: true, value: r };
      } catch (e) {
        return failureOf(p, e, allotmentId);
      }
    },
  };
  return Object.freeze(writes);
}
