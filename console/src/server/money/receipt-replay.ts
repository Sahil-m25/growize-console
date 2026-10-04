/**
 * M01-S08-T03 — validate a queued receipt against live Zoho state before replaying it.
 *
 * This is deliberately a server-domain boundary, not an HTTP route.  The OAuth/session story owns
 * minting `ReceiptReplayPrincipal`; the eventual Receipts POST must pass its Idempotency-Key header
 * into `command.idempotencyKey` and must never accept a credential, actor or capability from JSON.
 *
 * Zoho is the only durable store. A long-lived server-HMAC of the opaque queue key, actor and session
 * is persisted beside the bank reference on the Receipt; an independent short-lived HMAC seals the
 * replay context without exposing actor/session identifiers to browser code. We use create-only
 * `insert()`: generic upsert would silently edit an older money record.  The live org does not yet
 * have `Idempotency_Key`, so activation remains blocked until that unique field is added and
 * exported; there is intentionally no local fallback.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

import type {
  UserCredential,
  ZohoClient,
  ZohoFields,
  ZohoRecord,
  ZohoResult,
} from "../../lib/zoho/client";
import { isUserCredential } from "../../lib/zoho/client";
import type { ZohoFailureKind } from "../../lib/zoho/errors";
import { ACTOR_ID, RECORD_ID, type OpsLog } from "../../lib/zoho/log";
import { dueOf, FORFEIT_KIND, LEDGER_KINDS, ledgerOf, recordedOf, sumsOf } from "./ledger";
import { createIdempotency } from "../state/idempotent";
import { createMemoryState } from "../state/memory";
import { SharedStateError, type SharedState } from "../state/shared-state";

export const RECEIPTS_MODULE = "Receipts";
export const ALLOTMENTS_MODULE = "LLP_UnitAllocation_Module";
export const RECEIPT_REPLAY_MAX_AGE_MS = 5 * 60 * 1_000;
/**
 * Preparation happens while online, before the user may press save offline.  Keeping the sealed
 * snapshot for two queue windows lets the UI refresh it every five minutes while preserving a full
 * five-minute replay window measured from the actual press.
 */
export const RECEIPT_CONTEXT_MAX_AGE_MS = 2 * RECEIPT_REPLAY_MAX_AGE_MS;
export const RECEIPT_PREPARATION_TIMEOUT_MS = 10_000;
export const RECEIPT_IDEMPOTENCY_FIELD = "Idempotency_Key";
export const RECEIPT_IDEMPOTENCY_VERSION = "receipt-v1";
export const RECEIPT_CONTEXT_VERSION = "receipt-context-v1";
export const MAX_SUPPLEMENTARY_FILES = 5;
export const MAX_IN_FLIGHT_RECEIPT_REPLAYS = 64;
export const MAX_IN_FLIGHT_RECEIPT_REPLAYS_PER_ACTOR = 16;
export const MAX_QUEUED_RECEIPT_REPLAYS_PER_ALLOTMENT = 8;
export const RECEIPT_RECOVERY_TIMEOUT_MS = 5_000;

const SESSION_ID = /^[A-Za-z0-9_-]{16,128}$/;
const OPAQUE_IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/;
const DURABLE_IDEMPOTENCY_KEY = /^receipt-v1_[A-Za-z0-9_-]{43}$/;
const CONTEXT_TOKEN = /^receipt-context-v1_[A-Za-z0-9_-]{43}$/;
const ZOHO_ERROR_CODE = /^[A-Z][A-Z0-9_]{1,63}$/;
// Zoho File System ids are encrypted opaque tokens, not CRM record ids. File-field attachment ids
// remain ordinary numeric CRM ids and are checked against this org's prefix at the parse boundary.
const ZFS_FILE_ID = /^[A-Za-z0-9_-]{16,200}$/;
const UTR = /^[A-Z0-9][A-Z0-9._/-]{2,79}$/;
// CRM normalises DateTime fields to seconds; refusing fractions keeps retry comparison lossless.
const ISO_DATETIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:Z|([+-])(\d{2}):(\d{2}))$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export const RECEIPT_KINDS = ["Advance", "Part", "Full", "Refund"] as const;
export type ReceiptKind = (typeof RECEIPT_KINDS)[number];
export const RECEIPT_MODES = ["NEFT", "RTGS", "IMPS", "SWIFT", "UPI", "Cheque"] as const;
export type ReceiptMode = (typeof RECEIPT_MODES)[number];
export const ALLOCATION_STATES = ["Reserved", "Issued", "Cancelled"] as const;
export type AllocationState = (typeof ALLOCATION_STATES)[number];

export interface ReceiptIntent {
  readonly allotmentId: string;
  readonly kind: ReceiptKind;
  /** D81's money model and M10's module contract use whole rupees. */
  readonly amountRupees: number;
  readonly mode: ReceiptMode;
  readonly utr: string;
  readonly receivedOn: string;
}

export interface SupplementarySnapshot {
  readonly fileIds: readonly string[];
  readonly signRequestId: string | null;
  readonly signedVia: string | null;
  readonly verifiedAt: string | null;
}

export interface ReservationSnapshot {
  readonly allocationState: AllocationState;
  readonly units: number;
  readonly unitPriceRupees: number;
  readonly holdUntil: string | null;
  readonly extensionState: string | null;
  readonly extensionDecidedAt: string | null;
}

export interface AllotmentTargetSnapshot {
  readonly customerId: string;
  readonly llpId: string;
}

export interface ReceiptReplaySnapshot {
  /** Still due as the Payments register shows it (./ledger dueOf): MATCHED money only (D21); 0 unless Reserved. */
  readonly amountDueRupees: number;
  /** Recorded, not yet matched (Pending), net of pending refunds/reversals — the register's recorded.net. */
  readonly recordedRupees: number;
  readonly target: AllotmentTargetSnapshot;
  readonly supplementary: SupplementarySnapshot;
  readonly reservation: ReservationSnapshot;
}

export interface QueuedReceiptReplay {
  /** Server time when the live snapshot was sealed; returned unchanged from prepare(). */
  readonly preparedAt: number;
  /** Time of the actual press, derived from preparedAt plus monotonic browser elapsed time. */
  readonly queuedAt: number;
  /** Server-issued and bound to the live principal/session; the browser never receives their raw identifiers. */
  readonly contextToken: string;
  readonly idempotencyKey: string;
  readonly intent: ReceiptIntent;
  readonly expected: ReceiptReplaySnapshot;
}

export interface ReceiptReplayPrincipal {
  readonly credential: UserCredential;
  readonly sessionId: string;
}

export interface ReceiptCreatePermission {
  /** Must perform a fresh authoritative check. A cached/UI role is not a permission result. */
  recheck(credential: UserCredential, signal?: AbortSignal): Promise<boolean>;
}

export interface ReceiptReplaySessionAuthority {
  /**
   * Authoritative check that this exact token-verified user credential belongs to this exact live
   * session. Checking the credential and session independently is insufficient.
   */
  recheck(credential: UserCredential, sessionId: string, signal?: AbortSignal): Promise<boolean>;
}

export interface ReceiptReplayDependencies {
  readonly crm: Pick<ZohoClient, "getRecord" | "coql" | "insert">;
  readonly permission: ReceiptCreatePermission;
  readonly session: ReceiptReplaySessionAuthority;
  readonly log: OpsLog;
  /** Stable numeric prefix shared by record ids in this Zoho org; rejects arbitrary digit strings before logging. */
  readonly recordIdPrefix: string;
  /** Escrowed durable-key derivation secret, at least 32 bytes; rotate only after draining/invalidation. */
  readonly idempotencySecret: string;
  /** Short-lived queue-context signer, independent of the durable receipt identity. */
  readonly contextSigningSecret: string;
  /** Accepted signers for rolling rotation; retain them past the ten-minute context lifetime. */
  readonly previousContextSigningSecrets?: readonly string[];
  /** Server-owned preparation deadline; injectable only to make timeout behavior deterministic in tests. */
  readonly preparationTimeoutMs?: number;
  readonly clock?: () => number;
  /** Where the double-press guard and the per-allotment turn live (state/idempotent.ts). Absent: this process only. */
  readonly state?: SharedState;
}

export type ReceiptRefusalCode =
  | "invalid-request"
  | "actor-changed"
  | "session-changed"
  | "save-expired"
  | "permission-changed"
  | "refund-requires-approved-flow"
  | "idempotency-key-invalid"
  | "context-token-invalid"
  | "idempotency-key-reused"
  | "receipt-reference-reused"
  | "allotment-not-visible"
  | "source-invalid"
  | "allotment-target-changed"
  | "balance-already-recorded"
  | "amount-due-changed"
  | "supplementary-round-changed"
  | "reservation-state-changed"
  | "hold-changed";

export type ReceiptReplayResult =
  | { readonly ok: true; readonly receiptId: string; readonly duplicate: boolean }
  | {
      readonly ok: false;
      readonly kind: "refused";
      readonly reasonCode: ReceiptRefusalCode;
      readonly reason: string;
      readonly retryable: false;
    }
  | {
      readonly ok: false;
      readonly kind: "source-error";
      readonly source: "permission" | "session" | "zoho";
      readonly errorKind: ZohoFailureKind | "unexpected";
      readonly retryable: boolean;
    }
  | {
      readonly ok: false;
      readonly kind: "unknown-outcome";
      readonly reason: "the receipt outcome is unknown and must be reconciled by its idempotency key";
      readonly retryable: false;
    };

type ReceiptReplayError = Extract<ReceiptReplayResult, { readonly ok: false }>;

type NormalizedIntent = ReceiptIntent;
type CapturedReceiptReplay = {
  readonly preparedAt: number;
  readonly queuedAt: number;
  readonly contextToken: string;
  readonly durableIdempotencyKey: string;
  readonly intent: NormalizedIntent;
  readonly expected: ReceiptReplaySnapshot;
};

type ReplayControl = {
  readonly controller: AbortController;
  reason: "deadline" | "session" | null;
};
/** A Receipts row already on the allotment. Its kind is any ledger kind (./ledger LEDGER_KINDS — Balance, D70's name
 *  for Part, and Forfeit included), not only what a press may record; a Forfeit is money kept on a lapse/release and
 *  moves no bank money, so it alone may carry no Mode or UTR (M01-S08-NOTE-4). */
type ExistingIntent = Omit<NormalizedIntent, "kind" | "mode" | "utr"> & {
  readonly kind: string;
  readonly mode: ReceiptMode | null;
  readonly utr: string | null;
};
type ExistingReceipt = {
  readonly id: string;
  readonly intent: ExistingIntent;
  readonly idempotencyKey: string | null;
  readonly matchState: "Pending" | "Matched" | "Not found" | "Reversed" | "Claimed";
  readonly reversalOf: string | null;
};
type SourceContext = { readonly snapshot: ReceiptReplaySnapshot; readonly receipts: readonly ExistingReceipt[] };

const REFUSAL_TEXT: Readonly<Record<ReceiptRefusalCode, string>> = Object.freeze({
  "invalid-request": "receipt request is invalid",
  "actor-changed": "the signed-in person changed",
  "session-changed": "the sign-in session changed",
  "save-expired": "the waiting save expired",
  "permission-changed": "receipt permission changed",
  "refund-requires-approved-flow": "refund requires its approved release flow",
  "idempotency-key-invalid": "the receipt request key does not match its contents",
  "context-token-invalid": "the receipt context is not server-issued or was changed",
  "idempotency-key-reused": "the receipt request key was reused",
  "receipt-reference-reused": "the receipt reference is already used for another receipt",
  "allotment-not-visible": "the allotment is not available to this person",
  "source-invalid": "Zoho returned an invalid receipt context",
  "allotment-target-changed": "the allotment investor or LLP changed",
  "balance-already-recorded": "balance already recorded",
  "amount-due-changed": "amount due changed",
  "supplementary-round-changed": "supplementary round changed",
  "reservation-state-changed": "reservation state changed",
  "hold-changed": "hold changed",
});

const setOf = <T extends string>(items: readonly T[]): ReadonlySet<string> => new Set(items);
const KINDS = setOf(RECEIPT_KINDS);
const MODES = setOf(RECEIPT_MODES);
const STATES = setOf(ALLOCATION_STATES);
const MATCH_STATES = new Set(["Pending", "Matched", "Not found", "Reversed", "Claimed"]);

const obj = (value: unknown): Readonly<Record<string, unknown>> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Readonly<Record<string, unknown>>) : null;

const leapYear = (year: number): boolean => year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);

function validDateParts(year: number, month: number, day: number): boolean {
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const days = [31, leapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1];
}

function validIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = ISO_DATE.exec(value);
  return match !== null && validDateParts(Number(match[1]), Number(match[2]), Number(match[3]));
}

function validIsoDateTime(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = ISO_DATETIME.exec(value);
  if (!match || !validDateParts(Number(match[1]), Number(match[2]), Number(match[3]))) return false;
  if (Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6]) > 59) return false;
  if (match[7] !== undefined) {
    const offsetHours = Number(match[8]);
    const offsetMinutes = Number(match[9]);
    if (offsetHours > 14 || offsetMinutes > 59 || (offsetHours === 14 && offsetMinutes !== 0)) return false;
  }
  return !Number.isNaN(Date.parse(value));
}

const safeInteger = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "string" && /^-?\d{1,15}$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
};

const nullableString = (value: unknown, maximum = 200): string | null | undefined =>
  value === null || value === undefined || value === ""
    ? null
    : typeof value === "string" && value.length <= maximum
      ? value
      : undefined;

const lookupId = (value: unknown): string | null => {
  const record = obj(value);
  return record && typeof record.id === "string" && RECORD_ID.test(record.id) ? record.id : null;
};

const fileIds = (
  value: unknown,
  validOrgRecordId: (value: unknown) => value is string,
): readonly string[] | null => {
  if (value === null || value === undefined || value === "") return Object.freeze([]);
  if (!Array.isArray(value) || value.length > MAX_SUPPLEMENTARY_FILES) return null;
  const ids: string[] = [];
  for (const raw of value) {
    const file = obj(raw);
    if (!file) return null;
    const candidate = typeof file.file_Id === "string" && ZFS_FILE_ID.test(file.file_Id)
      ? file.file_Id
      : [file.attachment_Id, file.id].find(validOrgRecordId);
    if (!candidate) return null;
    ids.push(candidate);
  }
  return Object.freeze([...new Set(ids)].sort());
};

function normalizeIntent(intent: ReceiptIntent): NormalizedIntent | null {
  if (!intent || typeof intent !== "object") return null;
  if (typeof intent.allotmentId !== "string" || !RECORD_ID.test(intent.allotmentId)) return null;
  if (!KINDS.has(intent.kind) || !MODES.has(intent.mode)) return null;
  if (!Number.isSafeInteger(intent.amountRupees) || intent.amountRupees <= 0) return null;
  if (typeof intent.utr !== "string" || intent.utr.length > 80) return null;
  const utr = intent.utr.trim().toUpperCase();
  if (!UTR.test(utr)) return null;
  if (!validIsoDateTime(intent.receivedOn)) return null;
  return Object.freeze({
    allotmentId: intent.allotmentId,
    kind: intent.kind,
    amountRupees: intent.amountRupees,
    mode: intent.mode,
    utr,
    receivedOn: intent.receivedOn,
  });
}

function validNullableText(value: unknown, maximum = 200): value is string | null {
  return value === null || (typeof value === "string" && value.length <= maximum);
}

function validSnapshot(value: unknown): value is ReceiptReplaySnapshot {
  const snapshot = obj(value);
  const target = obj(snapshot?.target);
  const supplementary = obj(snapshot?.supplementary);
  const reservation = obj(snapshot?.reservation);
  if (!snapshot || !target || !supplementary || !reservation) return false;
  if (!Number.isSafeInteger(snapshot.amountDueRupees) || (snapshot.amountDueRupees as number) < 0) return false;
  if (!Number.isSafeInteger(snapshot.recordedRupees)) return false;
  if (typeof target.customerId !== "string" || !RECORD_ID.test(target.customerId)
    || typeof target.llpId !== "string" || !RECORD_ID.test(target.llpId)) return false;
  if (!Array.isArray(supplementary.fileIds) || supplementary.fileIds.length > MAX_SUPPLEMENTARY_FILES
    || supplementary.fileIds.some((id) => typeof id !== "string" || !ZFS_FILE_ID.test(id))
    || !validNullableText(supplementary.signRequestId)
    || !validNullableText(supplementary.signedVia)
    || !validNullableText(supplementary.verifiedAt)) return false;
  if (supplementary.verifiedAt !== null && !validIsoDateTime(supplementary.verifiedAt)) return false;
  if (typeof reservation.allocationState !== "string" || !STATES.has(reservation.allocationState)
    || !Number.isSafeInteger(reservation.units) || (reservation.units as number) < 0
    || !Number.isSafeInteger(reservation.unitPriceRupees) || (reservation.unitPriceRupees as number) <= 0
    || !validNullableText(reservation.holdUntil)
    || !validNullableText(reservation.extensionState)
    || !validNullableText(reservation.extensionDecidedAt)) return false;
  if (reservation.holdUntil !== null && !validIsoDate(reservation.holdUntil)) return false;
  if (reservation.extensionDecidedAt !== null && !validIsoDateTime(reservation.extensionDecidedAt)) return false;
  return true;
}

function captureSnapshot(value: unknown): ReceiptReplaySnapshot | null {
  if (!validSnapshot(value)) return null;
  return Object.freeze({
    amountDueRupees: value.amountDueRupees,
    recordedRupees: value.recordedRupees,
    target: Object.freeze({ customerId: value.target.customerId, llpId: value.target.llpId }),
    supplementary: Object.freeze({
      fileIds: Object.freeze([...new Set(value.supplementary.fileIds)].sort()),
      signRequestId: value.supplementary.signRequestId,
      signedVia: value.supplementary.signedVia,
      verifiedAt: value.supplementary.verifiedAt,
    }),
    reservation: Object.freeze({
      allocationState: value.reservation.allocationState,
      units: value.reservation.units,
      unitPriceRupees: value.reservation.unitPriceRupees,
      holdUntil: value.reservation.holdUntil,
      extensionState: value.reservation.extensionState,
      extensionDecidedAt: value.reservation.extensionDecidedAt,
    }),
  });
}

function durableReceiptIdempotencyKey(
  secret: string,
  principal: ReceiptReplayPrincipal,
  opaqueKey: string,
): string {
  const canonical = JSON.stringify([
    RECEIPT_IDEMPOTENCY_VERSION,
    principal.credential.userId,
    principal.sessionId,
    opaqueKey,
  ]);
  return `${RECEIPT_IDEMPOTENCY_VERSION}_${createHmac("sha256", secret).update(canonical, "utf8").digest("base64url")}`;
}

function snapshotFingerprintParts(expected: ReceiptReplaySnapshot): readonly unknown[] {
  return [
    expected.amountDueRupees,
    expected.recordedRupees,
    [expected.target.customerId, expected.target.llpId],
    [[...expected.supplementary.fileIds].sort(), expected.supplementary.signRequestId,
      expected.supplementary.signedVia, expected.supplementary.verifiedAt],
    [expected.reservation.allocationState, expected.reservation.units, expected.reservation.unitPriceRupees,
      expected.reservation.holdUntil, expected.reservation.extensionState, expected.reservation.extensionDecidedAt],
  ];
}

function receiptContextToken(
  secret: string,
  principal: ReceiptReplayPrincipal,
  preparedAt: number,
  allotmentId: string,
  expected: ReceiptReplaySnapshot,
): string {
  const canonical = JSON.stringify([
    RECEIPT_CONTEXT_VERSION,
    principal.credential.userId,
    principal.sessionId,
    preparedAt,
    allotmentId,
    ...snapshotFingerprintParts(expected),
  ]);
  return `${RECEIPT_CONTEXT_VERSION}_${createHmac("sha256", secret).update(canonical, "utf8").digest("base64url")}`;
}

function sameFixedToken(left: string, right: string): boolean {
  const a = Buffer.from(left, "ascii");
  const b = Buffer.from(right, "ascii");
  return a.length === b.length && timingSafeEqual(a, b);
}

function sameInstant(a: string, b: string): boolean {
  const left = Date.parse(a);
  const right = Date.parse(b);
  return !Number.isNaN(left) && !Number.isNaN(right) && left === right;
}

function sameIntent(a: ExistingIntent, b: NormalizedIntent): boolean {
  return a.allotmentId === b.allotmentId
    && a.kind === b.kind
    && a.amountRupees === b.amountRupees
    && a.mode === b.mode
    && a.utr === b.utr
    && sameInstant(a.receivedOn, b.receivedOn);
}

function parseExistingReceipt(record: ZohoRecord): ExistingReceipt | null {
  if (!RECORD_ID.test(record.id)) return null;
  const allotmentId = lookupId(record.Allotment);
  const amountRupees = safeInteger(record.Amount);
  const kind = typeof record.Kind === "string" && LEDGER_KINDS.has(record.Kind) ? record.Kind : null;
  const mode = typeof record.Mode === "string" && MODES.has(record.Mode) ? (record.Mode as ReceiptMode) : null;
  const utr = typeof record.UTR === "string" ? record.UTR.trim().toUpperCase() : "";
  // A Forfeit moves no bank money: no Mode and no UTR are its normal shape; one that carries them is checked as usual.
  const bankless = kind === FORFEIT_KIND && (record.Mode === null || record.Mode === undefined || record.Mode === "")
    && (record.UTR === null || record.UTR === undefined || record.UTR === "");
  const receivedOn = typeof record.Received_On === "string" ? record.Received_On : "";
  const matchState = typeof record.Match_State === "string" && MATCH_STATES.has(record.Match_State)
    ? (record.Match_State as ExistingReceipt["matchState"])
    : null;
  const reversalOf = record.Reversal_Of === null || record.Reversal_Of === undefined || record.Reversal_Of === ""
    ? null
    : lookupId(record.Reversal_Of);
  const idempotencyKey = record[RECEIPT_IDEMPOTENCY_FIELD] === null
      || record[RECEIPT_IDEMPOTENCY_FIELD] === undefined
      || record[RECEIPT_IDEMPOTENCY_FIELD] === ""
    ? null
    : typeof record[RECEIPT_IDEMPOTENCY_FIELD] === "string" && DURABLE_IDEMPOTENCY_KEY.test(record[RECEIPT_IDEMPOTENCY_FIELD] as string)
      ? record[RECEIPT_IDEMPOTENCY_FIELD] as string
      : undefined;
  if (!allotmentId || amountRupees === null || amountRupees <= 0 || !kind || (!bankless && (!mode || !UTR.test(utr)))
    || !validIsoDateTime(receivedOn) || !matchState
    || idempotencyKey === undefined
    || (record.Reversal_Of !== null && record.Reversal_Of !== undefined && record.Reversal_Of !== "" && !reversalOf)) return null;
  return Object.freeze({
    id: record.id,
    intent: Object.freeze({ allotmentId, amountRupees, kind, mode: bankless ? null : mode, utr: bankless ? null : utr, receivedOn }),
    idempotencyKey,
    matchState,
    reversalOf,
  });
}

/**
 * The allotment's money through ./ledger — the one signed ledger the Payments register and the Money section use,
 * so what replay seals is what the register shows. A refund is money out, a matched reversal cancels the receipt it
 * names (once), Pending money is never matched (D21). A ledger whose reversals break that convention is refused
 * here (a writer must not seal a precondition the readers could sum two ways); an inbound receipt after a clean
 * refund or reversal stays recordable (rule 3).
 */
function ledgerMoney(
  receipts: readonly ExistingReceipt[],
  allotmentId: string,
  allocationState: AllocationState,
  commitment: number,
): { readonly due: number; readonly recorded: number } | null {
  const ledger = ledgerOf(receipts.map((r) => ({
    id: r.id, allotmentId: r.intent.allotmentId, kind: r.intent.kind, amount: r.intent.amountRupees, matchState: r.matchState, reversalOf: r.reversalOf,
  })));
  if (ledger.anomalies.length) return null;
  const sums = sumsOf(ledger, allotmentId);
  const values = [sums.matchedIn, sums.matchedOut, sums.pendingIn, sums.pendingOut];
  if (!values.every(Number.isSafeInteger)) return null;
  return { due: dueOf(allocationState, commitment, sums), recorded: recordedOf(sums) };
}

/** Money still to be recorded before the commitment is covered: due less what is already recorded and waiting. */
export function outstandingRupees(snapshot: Pick<ReceiptReplaySnapshot, "amountDueRupees" | "recordedRupees">): number {
  return Math.max(0, snapshot.amountDueRupees - Math.max(0, snapshot.recordedRupees));
}

function parseAllotment(
  allotmentId: string,
  record: ZohoRecord,
  receipts: readonly ExistingReceipt[],
  validOrgRecordId: (value: unknown) => value is string,
): ReceiptReplaySnapshot | null {
  const allocationState = typeof record.Allocation_Status === "string" && STATES.has(record.Allocation_Status)
    ? (record.Allocation_Status as AllocationState)
    : null;
  const reservedUnits = safeInteger(record.Reserved_Units);
  const issuedUnits = safeInteger(record.Issued_Units);
  const unitPriceRupees = safeInteger(record.Unit_Price);
  const customerId = lookupId(record.Customer);
  const llpId = lookupId(record.LLP);
  const supplementaryFiles = fileIds(record.Supplementary_Agreement, validOrgRecordId);
  const signRequestId = nullableString(record.Supplementary_Sign_Req_Id);
  const signedVia = nullableString(record.Supplementary_Signed_Via);
  const verifiedAt = nullableString(record.Supplementary_Verified_At);
  const holdUntil = nullableString(record.Hold_Until);
  const extensionState = nullableString(record.Hold_Extension_State);
  const extensionDecidedAt = nullableString(record.Hold_Extension_Decided_At);
  if (!allocationState || reservedUnits === null || issuedUnits === null || unitPriceRupees === null
    || reservedUnits < 0 || issuedUnits < 0 || unitPriceRupees <= 0 || !customerId || !llpId
    || supplementaryFiles === null || signRequestId === undefined || signedVia === undefined || verifiedAt === undefined
    || holdUntil === undefined || extensionState === undefined || extensionDecidedAt === undefined
    || (verifiedAt !== null && !validIsoDateTime(verifiedAt))
    || (holdUntil !== null && !validIsoDate(holdUntil))
    || (extensionDecidedAt !== null && !validIsoDateTime(extensionDecidedAt))) return null;
  const units = allocationState === "Reserved" ? reservedUnits : issuedUnits;
  const commitment = units * unitPriceRupees;
  if (!Number.isSafeInteger(commitment) || commitment < 0) return null;
  // An excess credit or an over-refund is still money and must not make the ledger unreadable (D21).
  const money = ledgerMoney(receipts, allotmentId, allocationState, commitment);
  if (money === null) return null;
  return Object.freeze({
    amountDueRupees: money.due,
    recordedRupees: money.recorded,
    target: Object.freeze({ customerId, llpId }),
    supplementary: Object.freeze({ fileIds: supplementaryFiles, signRequestId, signedVia, verifiedAt }),
    reservation: Object.freeze({
      allocationState,
      units,
      unitPriceRupees,
      holdUntil,
      extensionState,
      extensionDecidedAt,
    }),
  });
}

function sameStrings(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function sameSupplementary(a: SupplementarySnapshot, b: SupplementarySnapshot): boolean {
  return sameStrings([...a.fileIds].sort(), [...b.fileIds].sort())
    && a.signRequestId === b.signRequestId
    && a.signedVia === b.signedVia
    && a.verifiedAt === b.verifiedAt;
}

function sameTarget(a: AllotmentTargetSnapshot, b: AllotmentTargetSnapshot): boolean {
  return a.customerId === b.customerId && a.llpId === b.llpId;
}

function sameReservationState(a: ReservationSnapshot, b: ReservationSnapshot): boolean {
  return a.allocationState === b.allocationState && a.units === b.units && a.unitPriceRupees === b.unitPriceRupees;
}

function sameHold(a: ReservationSnapshot, b: ReservationSnapshot): boolean {
  return a.holdUntil === b.holdUntil
    && a.extensionState === b.extensionState
    && a.extensionDecidedAt === b.extensionDecidedAt;
}

function replayFingerprint(
  principal: ReceiptReplayPrincipal,
  preparedAt: number,
  queuedAt: number,
  contextToken: string,
  intent: NormalizedIntent,
  expected: ReceiptReplaySnapshot,
): string {
  return JSON.stringify([
    principal.credential.userId,
    principal.sessionId,
    preparedAt,
    queuedAt,
    contextToken,
    [intent.allotmentId, intent.kind, intent.amountRupees, intent.mode, intent.utr, Date.parse(intent.receivedOn)],
    ...snapshotFingerprintParts(expected),
  ]);
}

function sourceFailure(error: ZohoResult<unknown> & { readonly ok: false }): ReceiptReplayError {
  const kind = error.error.kind;
  return {
    ok: false,
    kind: "source-error",
    source: "zoho",
    errorKind: kind,
    retryable: kind === "network" || kind === "server" || kind === "busy" || kind === "concurrency-exceeded" || kind === "rate-limited-unclassified",
  };
}

const ALLOTMENT_FIELDS = Object.freeze([
  "Customer",
  "LLP",
  "Allocation_Status",
  "Reserved_Units",
  "Issued_Units",
  "Unit_Price",
  "Supplementary_Agreement",
  "Supplementary_Signed_Via",
  "Supplementary_Sign_Req_Id",
  "Supplementary_Verified_At",
  "Hold_Until",
  "Hold_Extension_State",
  "Hold_Extension_Decided_At",
]);
const RECEIPT_FIELDS = Object.freeze([
  "Allotment",
  "Kind",
  "Amount",
  "Mode",
  "UTR",
  "Received_On",
  RECEIPT_IDEMPOTENCY_FIELD,
  "Match_State",
  "Reversal_Of",
]);
const COQL_RECEIPT_FIELDS = Object.freeze(["id", ...RECEIPT_FIELDS]);

export interface ReceiptReplayPreparation {
  readonly preparedAt: number;
  readonly contextToken: string;
  readonly expected: ReceiptReplaySnapshot;
}

export type ReceiptReplayPreparationResult =
  | { readonly ok: true; readonly value: ReceiptReplayPreparation }
  | Extract<ReceiptReplayResult, { readonly ok: false }>;

export interface ReceiptReplayService {
  /** Fetch and seal the live preconditions that an offline queue entry must return unchanged. */
  prepare(principal: ReceiptReplayPrincipal, allotmentId: string, signal?: AbortSignal): Promise<ReceiptReplayPreparationResult>;
  replay(principal: ReceiptReplayPrincipal, command: QueuedReceiptReplay, signal?: AbortSignal): Promise<ReceiptReplayResult>;
  /** Called by sign-out before clearing the session; aborts queued/in-flight work and recovers ambiguity by key. */
  discardSession(actorId: string, sessionId: string): void;
}

export function createReceiptReplayService(dependencies: ReceiptReplayDependencies): ReceiptReplayService {
  const { crm, permission, session, log } = dependencies;
  if (typeof dependencies.recordIdPrefix !== "string" || !/^\d{6,16}$/.test(dependencies.recordIdPrefix)) {
    throw new TypeError("receipt replay recordIdPrefix must be 6–16 digits from this Zoho org");
  }
  const recordIdPrefix = dependencies.recordIdPrefix;
  const validOrgRecordId = (value: unknown): value is string =>
    typeof value === "string" && RECORD_ID.test(value) && value.startsWith(recordIdPrefix);
  const validAllotmentId = validOrgRecordId;
  const validSnapshotRecordIds = (snapshot: ReceiptReplaySnapshot): boolean =>
    validOrgRecordId(snapshot.target.customerId)
      && validOrgRecordId(snapshot.target.llpId);
  const validExistingRecordIds = (receipt: ExistingReceipt): boolean =>
    validOrgRecordId(receipt.id)
      && validOrgRecordId(receipt.intent.allotmentId)
      && (receipt.reversalOf === null || validOrgRecordId(receipt.reversalOf));
  if (typeof dependencies.idempotencySecret !== "string"
    || Buffer.byteLength(dependencies.idempotencySecret, "utf8") < 32) {
    throw new TypeError("receipt replay idempotencySecret must contain at least 32 bytes");
  }
  const idempotencySecret = dependencies.idempotencySecret;
  if (typeof dependencies.contextSigningSecret !== "string"
    || Buffer.byteLength(dependencies.contextSigningSecret, "utf8") < 32) {
    throw new TypeError("receipt replay contextSigningSecret must contain at least 32 bytes");
  }
  const contextSigningSecret = dependencies.contextSigningSecret;
  const previousContextSigningSecrets = dependencies.previousContextSigningSecrets ?? [];
  if (!Array.isArray(previousContextSigningSecrets) || previousContextSigningSecrets.length > 2
    || previousContextSigningSecrets.some(
      (secret) => typeof secret !== "string" || Buffer.byteLength(secret, "utf8") < 32,
    )) {
    throw new TypeError("receipt replay accepts at most two previous context signing secrets of at least 32 bytes each");
  }
  const contextSigningSecrets = Object.freeze([contextSigningSecret, ...previousContextSigningSecrets]);
  if (new Set([idempotencySecret, ...contextSigningSecrets]).size !== contextSigningSecrets.length + 1) {
    throw new TypeError("receipt replay durable and context signing secrets must all be distinct");
  }
  const preparationTimeoutMs = dependencies.preparationTimeoutMs ?? RECEIPT_PREPARATION_TIMEOUT_MS;
  if (!Number.isSafeInteger(preparationTimeoutMs)
    || preparationTimeoutMs < 1
    || preparationTimeoutMs > RECEIPT_PREPARATION_TIMEOUT_MS) {
    throw new RangeError(`receipt replay preparationTimeoutMs must be 1–${RECEIPT_PREPARATION_TIMEOUT_MS}`);
  }
  const clock = dependencies.clock ?? Date.now;
  // The double-press guard (state/idempotent.ts): a press running here is joined, a stored answer is replayed,
  // else the key is claimed in SharedState so the same press on another instance writes nothing. Only a
  // success is kept; the answer is ids and a flag (rule 7: no reference travels in it).
  const state = dependencies.state ?? createMemoryState({ clock });
  const presses = createIdempotency<ReceiptReplayResult>({
    state, ns: "receipt-replay", ttlSeconds: RECEIPT_CONTEXT_MAX_AGE_MS / 1_000 + 60, clock,
    keep: (r) => r.ok,
    save: (r) => JSON.stringify(r),
    load: (v) => { try { return JSON.parse(v) as ReceiptReplayResult; } catch { return null; } },
  });
  let running = 0;
  const allotmentTails = new Map<string, Promise<void>>();
  const queuedByAllotment = new Map<string, number>();
  const inFlightByActor = new Map<string, number>();
  const controlsBySession = new Map<string, Set<ReplayControl>>();

  const sampledNow = (): number | null => {
    try {
      const now = clock();
      return Number.isSafeInteger(now) && now >= 0 ? now : null;
    } catch {
      return null;
    }
  };

  const sourceUnavailable = (
    source: "permission" | "session" | "zoho",
    errorKind: ZohoFailureKind | "unexpected" = "unexpected",
  ): ReceiptReplayError => ({ ok: false, kind: "source-error", source, errorKind, retryable: true });

  const unknownOutcome = (): ReceiptReplayError => ({
    ok: false,
    kind: "unknown-outcome",
    reason: "the receipt outcome is unknown and must be reconciled by its idempotency key",
    retryable: false,
  });

  const sessionKey = (principal: ReceiptReplayPrincipal): string =>
    `${principal.credential.userId}\u0000${principal.sessionId}`;

  const awaitUntilAborted = <T>(promise: Promise<T>, signal?: AbortSignal): Promise<T | null> => {
    if (!signal) return promise;
    if (signal.aborted) {
      // The dependency call is created before this helper is entered. Observe a late rejection even
      // though cancellation wins immediately, otherwise Node can surface it as unhandled.
      void promise.catch(() => undefined);
      return Promise.resolve(null);
    }
    return new Promise<T | null>((resolve, reject) => {
      let settled = false;
      const finish = (value: T | null, error?: unknown) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        if (error !== undefined) reject(error);
        else resolve(value);
      };
      const onAbort = () => finish(null);
      signal.addEventListener("abort", onAbort, { once: true });
      void promise.then((value) => finish(value), (error: unknown) => finish(null, error));
    });
  };

  const trustedPrincipalOf = (value: unknown): ReceiptReplayPrincipal | null => {
    const candidate = obj(value);
    const credential = candidate?.credential;
    const sessionId = candidate?.sessionId;
    return isUserCredential(credential) && typeof sessionId === "string" && SESSION_ID.test(sessionId)
      ? Object.freeze({ credential, sessionId })
      : null;
  };

  const serializeAllotment = <T>(allotmentId: string, task: () => Promise<T>): Promise<T> => {
    const prior = allotmentTails.get(allotmentId) ?? Promise.resolve();
    const run = prior.then(task, task);
    const tail = run.then(() => undefined, () => undefined);
    allotmentTails.set(allotmentId, tail);
    void tail.then(() => {
      if (allotmentTails.get(allotmentId) === tail) allotmentTails.delete(allotmentId);
    });
    return run;
  };

  /** The allotment's turn across instances: claim `replay-turn|<allotment>` (poll until the press's own deadline). */
  const turnOn = async (
    allotmentId: string,
    control: ReplayControl,
    waitMs: number,
    task: () => Promise<ReceiptReplayResult>,
    busy: () => ReceiptReplayError,
  ): Promise<ReceiptReplayResult> => {
    const key = `replay-turn|${allotmentId}`;
    const until = (sampledNow() ?? 0) + waitMs;
    let pause = 25, waited = 0;
    for (;;) {
      if (control.controller.signal.aborted) return task(); // execute() answers the cancellation itself
      let got: boolean;
      try { got = await state.claim(key, RECEIPT_REPLAY_MAX_AGE_MS / 1_000 + 30); } catch (e) {
        if (e instanceof SharedStateError) return busy();
        throw e;
      }
      if (got) {
        try { return await task(); } finally { await state.release(key).catch(() => { /* the TTL frees it */ }); }
      }
      if (waited >= waitMs || (sampledNow() ?? Number.MAX_SAFE_INTEGER) >= until) return busy();
      await new Promise<void>((r) => setTimeout(r, pause));
      waited += pause;
      pause = Math.min(500, pause * 2);
    }
  };

  const refuse = (
    principal: ReceiptReplayPrincipal | null | undefined,
    reasonCode: ReceiptRefusalCode,
    recordIds: readonly string[] = [],
  ): Extract<ReceiptReplayResult, { readonly kind: "refused" }> => {
    log.refusal({
      at: sampledNow() ?? 0,
      actor: { kind: "user", userId: principal?.credential?.userId ?? "unrecognised" },
      action: "receipt-replay",
      reason: reasonCode,
      recordIds: recordIds.filter(validOrgRecordId),
    });
    return { ok: false, kind: "refused", reasonCode, reason: REFUSAL_TEXT[reasonCode], retryable: false };
  };

  const cancellationResult = (
    principal: ReceiptReplayPrincipal,
    control: ReplayControl,
    allotmentId: string,
  ): ReceiptReplayError => control.reason === "session"
    ? refuse(principal, "session-changed", [allotmentId])
    : refuse(principal, "save-expired", [allotmentId]);

  const recheckSession = async (
    principal: ReceiptReplayPrincipal,
    signal?: AbortSignal,
  ): Promise<true | ReceiptReplayError> => {
    try {
      const active = await awaitUntilAborted(
        session.recheck(principal.credential, principal.sessionId, signal),
        signal,
      );
      if (active === null) return sourceUnavailable("session", "aborted");
      return active === true ? true : refuse(principal, "session-changed");
    } catch {
      return sourceUnavailable("session");
    }
  };

  const recheckPermission = async (
    principal: ReceiptReplayPrincipal,
    signal?: AbortSignal,
  ): Promise<true | ReceiptReplayError> => {
    try {
      const allowed = await awaitUntilAborted(permission.recheck(principal.credential, signal), signal);
      if (allowed === null) return sourceUnavailable("permission", "aborted");
      return allowed === true ? true : refuse(principal, "permission-changed");
    } catch {
      return sourceUnavailable("permission");
    }
  };

  const findUnique = async (
    principal: ReceiptReplayPrincipal,
    field: "UTR" | typeof RECEIPT_IDEMPOTENCY_FIELD,
    value: string,
    signal?: AbortSignal,
  ): Promise<ExistingReceipt | null | ReceiptReplayError> => {
    let found: Awaited<ReturnType<ReceiptReplayDependencies["crm"]["coql"]>> | null;
    try {
      found = await awaitUntilAborted(crm.coql(
        principal.credential,
        `select ${COQL_RECEIPT_FIELDS.join(", ")} from ${RECEIPTS_MODULE} where ${field} = '${value}' limit 0, 2`,
        { signal },
      ), signal);
    } catch {
      return sourceUnavailable("zoho");
    }
    if (found === null) return sourceUnavailable("zoho", "aborted");
    if (!found.ok) return sourceFailure(found);
    if (found.value.invalidRecordIds || found.value.moreRecords || found.value.records.length > 1) {
      return refuse(principal, "source-invalid");
    }
    if (found.value.records.length === 0) return null;
    const parsed = parseExistingReceipt(found.value.records[0]);
    if (!parsed || !validExistingRecordIds(parsed)
      || (field === "UTR" ? parsed.intent.utr !== value : parsed.idempotencyKey !== value)) {
      return refuse(principal, "source-invalid", [found.value.records[0].id]);
    }
    return parsed;
  };

  const findByUtr = (principal: ReceiptReplayPrincipal, utr: string, signal?: AbortSignal) =>
    findUnique(principal, "UTR", utr, signal);
  const findByIdempotencyKey = (principal: ReceiptReplayPrincipal, key: string, signal?: AbortSignal) =>
    findUnique(principal, RECEIPT_IDEMPOTENCY_FIELD, key, signal);

  const readContext = async (
    principal: ReceiptReplayPrincipal,
    allotmentId: string,
    signal?: AbortSignal,
  ): Promise<SourceContext | ReceiptReplayError> => {
    let allotment: Awaited<ReturnType<ReceiptReplayDependencies["crm"]["getRecord"]>> | null;
    try {
      allotment = await awaitUntilAborted(
        crm.getRecord(principal.credential, ALLOTMENTS_MODULE, allotmentId, { fields: ALLOTMENT_FIELDS, signal }),
        signal,
      );
    } catch {
      return sourceUnavailable("zoho");
    }
    if (allotment === null) return sourceUnavailable("zoho", "aborted");
    if (!allotment.ok) {
      if (allotment.error.kind === "not-found" || allotment.error.kind === "forbidden") {
        return refuse(principal, "allotment-not-visible", [allotmentId]);
      }
      return sourceFailure(allotment);
    }
    if (!allotment.value) return refuse(principal, "allotment-not-visible", [allotmentId]);
    if (allotment.value.id !== allotmentId) return refuse(principal, "source-invalid", [allotmentId, allotment.value.id]);

    const receipts: ExistingReceipt[] = [];
    const seenReceiptIds = new Set<string>();
    const seenUtrs = new Set<string>();
    const seenIdempotencyKeys = new Set<string>();
    let result: Awaited<ReturnType<ReceiptReplayDependencies["crm"]["coql"]>> | null;
    try {
      result = await awaitUntilAborted(crm.coql(
        principal.credential,
        `select ${COQL_RECEIPT_FIELDS.join(", ")} from ${RECEIPTS_MODULE} where Allotment = '${allotmentId}' limit 0, 2000`,
        { signal },
      ), signal);
    } catch {
      return sourceUnavailable("zoho");
    }
    if (result === null) return sourceUnavailable("zoho", "aborted");
    if (!result.ok) return sourceFailure(result);
    if (result.value.invalidRecordIds || result.value.moreRecords || result.value.records.length > 2_000) {
      return refuse(principal, "source-invalid", [allotmentId]);
    }
    for (const row of result.value.records) {
      const parsed = parseExistingReceipt(row);
      if (!parsed || !validExistingRecordIds(parsed)
        || parsed.intent.allotmentId !== allotmentId || seenReceiptIds.has(parsed.id)
        || (parsed.intent.utr !== null && seenUtrs.has(parsed.intent.utr))
        || (parsed.idempotencyKey !== null && seenIdempotencyKeys.has(parsed.idempotencyKey))) {
        return refuse(principal, "source-invalid", [allotmentId, row.id]);
      }
      seenReceiptIds.add(parsed.id);
      if (parsed.intent.utr !== null) seenUtrs.add(parsed.intent.utr);
      if (parsed.idempotencyKey !== null) seenIdempotencyKeys.add(parsed.idempotencyKey);
      receipts.push(parsed);
    }
    const snapshot = parseAllotment(allotmentId, allotment.value, receipts, validOrgRecordId);
    return snapshot && validSnapshotRecordIds(snapshot)
      ? { snapshot, receipts: Object.freeze(receipts.slice()) }
      : refuse(principal, "source-invalid", [allotmentId]);
  };

  const withRecoveryDeadline = async <T>(task: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    const recovery = new AbortController();
    const timer = setTimeout(() => recovery.abort(), RECEIPT_RECOVERY_TIMEOUT_MS);
    timer.unref?.();
    try {
      return await task(recovery.signal);
    } finally {
      clearTimeout(timer);
    }
  };

  const recoverApplied = async (
    principal: ReceiptReplayPrincipal,
    durableKey: string,
    intent: NormalizedIntent,
    signal: AbortSignal,
  ): Promise<ReceiptReplayResult | null> => {
    const found = await findByIdempotencyKey(principal, durableKey, signal);
    if (found && "ok" in found) {
      return found.kind === "source-error" && found.errorKind === "aborted"
        ? sourceUnavailable("zoho", "aborted")
        : found;
    }
    if (!found) return null;
    if (found.idempotencyKey !== durableKey) return refuse(principal, "source-invalid", [found.id]);
    return sameIntent(found.intent, intent)
      ? { ok: true, receiptId: found.id, duplicate: true }
      : refuse(principal, "idempotency-key-reused", [intent.allotmentId, found.id]);
  };

  const execute = async (
    principal: ReceiptReplayPrincipal,
    command: CapturedReceiptReplay,
    control: ReplayControl,
  ): Promise<ReceiptReplayResult> => {
    const intent = command.intent;
    const durableKey = command.durableIdempotencyKey;
    const signal = control.controller.signal;
    const unresolvedWrite = (errorKind: ZohoFailureKind | "unexpected" = "unexpected"): ReceiptReplayError =>
      control.reason === null ? sourceUnavailable("zoho", errorKind) : unknownOutcome();
    if (signal.aborted) return cancellationResult(principal, control, intent.allotmentId);

    const active = await recheckSession(principal, signal);
    if (active !== true) return signal.aborted ? cancellationResult(principal, control, intent.allotmentId) : active;
    const allowed = await recheckPermission(principal, signal);
    if (allowed !== true) return signal.aborted ? cancellationResult(principal, control, intent.allotmentId) : allowed;

    // The actual press gets the full D41 queue window; the independently sealed preparation also
    // expires so an old form cannot silently reuse a snapshot forever.
    const nowAtExecution = sampledNow();
    if (nowAtExecution === null) return sourceUnavailable("zoho");
    const queueAgeAtExecution = nowAtExecution - command.queuedAt;
    const contextAgeAtExecution = nowAtExecution - command.preparedAt;
    if (queueAgeAtExecution < 0 || queueAgeAtExecution >= RECEIPT_REPLAY_MAX_AGE_MS
      || contextAgeAtExecution < 0 || contextAgeAtExecution >= RECEIPT_CONTEXT_MAX_AGE_MS) {
      return refuse(principal, "save-expired", [intent.allotmentId]);
    }

    // Exact applied retries precede the live-context comparison: the first success changed due.
    const applied = await findByIdempotencyKey(principal, durableKey, signal);
    if (signal.aborted) return cancellationResult(principal, control, intent.allotmentId);
    if (applied && "ok" in applied) return applied;
    if (applied) {
      if (applied.idempotencyKey !== durableKey) {
        return refuse(principal, "source-invalid", [applied.id]);
      }
      if (sameIntent(applied.intent, intent)) return { ok: true, receiptId: applied.id, duplicate: true };
      return refuse(principal, "idempotency-key-reused", [intent.allotmentId, applied.id]);
    }
    // A different logical press can carry the same bank reference. It is not this request's retry:
    // re-read the balance first so TC-IM01-010 gets the business refusal it requires.
    const reference = await findByUtr(principal, intent.utr, signal);
    if (signal.aborted) return cancellationResult(principal, control, intent.allotmentId);
    if (reference && "ok" in reference) return reference;
    if (reference && reference.idempotencyKey !== null
      && reference.idempotencyKey === durableKey && sameIntent(reference.intent, intent)) {
      return { ok: true, receiptId: reference.id, duplicate: true };
    }

    const context = await readContext(principal, intent.allotmentId, signal);
    if (signal.aborted) return cancellationResult(principal, control, intent.allotmentId);
    if ("ok" in context) return context;
    // Close the cross-process window between the two unique-key searches and this complete read.
    // If this exact press landed meanwhile, it is a retry, not a stale second receipt.
    const appliedInContext = context.receipts.find(
      (receipt) => receipt.idempotencyKey === durableKey,
    );
    if (appliedInContext) {
      if (sameIntent(appliedInContext.intent, intent)) return { ok: true, receiptId: appliedInContext.id, duplicate: true };
      return refuse(principal, "idempotency-key-reused", [intent.allotmentId, appliedInContext.id]);
    }
    const referenceInContext = context.receipts.find((receipt) => receipt.intent.utr === intent.utr) ?? null;
    if (reference && referenceInContext && reference.id !== referenceInContext.id) {
      return refuse(principal, "source-invalid", [intent.allotmentId, reference.id, referenceInContext.id]);
    }
    const liveReference = reference ?? referenceInContext;
    const current = context.snapshot;
    if (!sameTarget(current.target, command.expected.target)) {
      return refuse(principal, "allotment-target-changed", [intent.allotmentId]);
    }
    if (!sameSupplementary(current.supplementary, command.expected.supplementary)) {
      return refuse(principal, "supplementary-round-changed", [intent.allotmentId]);
    }
    if (!sameReservationState(current.reservation, command.expected.reservation)) {
      return refuse(principal, "reservation-state-changed", [intent.allotmentId]);
    }
    if (!sameHold(current.reservation, command.expected.reservation)) {
      return refuse(principal, "hold-changed", [intent.allotmentId]);
    }
    if (current.amountDueRupees !== command.expected.amountDueRupees || current.recordedRupees !== command.expected.recordedRupees) {
      // Another hand recorded or matched money meanwhile. If this press was the whole balance and nothing is left
      // to record, it is the same money landing twice.
      const balanceWasTheIntent = intent.kind !== "Refund" && intent.amountRupees === outstandingRupees(command.expected);
      if (balanceWasTheIntent && outstandingRupees(current) === 0) {
        return refuse(principal, "balance-already-recorded", [intent.allotmentId]);
      }
      return refuse(principal, "amount-due-changed", [intent.allotmentId]);
    }
    if (liveReference) return refuse(principal, "receipt-reference-reused", [intent.allotmentId, liveReference.id]);

    const nowBeforeInsert = sampledNow();
    if (nowBeforeInsert === null) return sourceUnavailable("zoho");
    const queueAgeBeforeInsert = nowBeforeInsert - command.queuedAt;
    const contextAgeBeforeInsert = nowBeforeInsert - command.preparedAt;
    if (queueAgeBeforeInsert < 0 || queueAgeBeforeInsert >= RECEIPT_REPLAY_MAX_AGE_MS
      || contextAgeBeforeInsert < 0 || contextAgeBeforeInsert >= RECEIPT_CONTEXT_MAX_AGE_MS
      || signal.aborted) {
      return signal.aborted
        ? cancellationResult(principal, control, intent.allotmentId)
        : refuse(principal, "save-expired", [intent.allotmentId]);
    }
    const sessionStillActive = await recheckSession(principal, signal);
    if (sessionStillActive !== true) {
      return signal.aborted ? cancellationResult(principal, control, intent.allotmentId) : sessionStillActive;
    }
    const permissionStillActive = await recheckPermission(principal, signal);
    if (permissionStillActive !== true) {
      return signal.aborted ? cancellationResult(principal, control, intent.allotmentId) : permissionStillActive;
    }
    const nowAtDispatch = sampledNow();
    if (nowAtDispatch === null) return sourceUnavailable("zoho");
    const queueAgeAtDispatch = nowAtDispatch - command.queuedAt;
    const contextAgeAtDispatch = nowAtDispatch - command.preparedAt;
    if (queueAgeAtDispatch < 0 || queueAgeAtDispatch >= RECEIPT_REPLAY_MAX_AGE_MS
      || contextAgeAtDispatch < 0 || contextAgeAtDispatch >= RECEIPT_CONTEXT_MAX_AGE_MS
      || signal.aborted) {
      return signal.aborted
        ? cancellationResult(principal, control, intent.allotmentId)
        : refuse(principal, "save-expired", [intent.allotmentId]);
    }

    const recoverAfterWrite = (duplicateConstraint: boolean): Promise<ReceiptReplayResult | null> =>
      withRecoveryDeadline(async (recoverySignal) => {
        const recovered = await recoverApplied(principal, durableKey, intent, recoverySignal);
        if (recovered || !duplicateConstraint) return recovered;
        const racedReference = await findByUtr(principal, intent.utr, recoverySignal);
        if (racedReference && "ok" in racedReference) {
          return racedReference.kind === "source-error" && racedReference.errorKind === "aborted"
            ? sourceUnavailable("zoho", "aborted")
            : racedReference;
        }
        if (racedReference?.idempotencyKey === durableKey) {
          return sameIntent(racedReference.intent, intent)
            ? { ok: true, receiptId: racedReference.id, duplicate: true }
            : refuse(principal, "idempotency-key-reused", [intent.allotmentId, racedReference.id]);
        }
        const fresh = await readContext(principal, intent.allotmentId, recoverySignal);
        if ("ok" in fresh) {
          return fresh.kind === "source-error" && fresh.errorKind === "aborted"
            ? sourceUnavailable("zoho", "aborted")
            : fresh;
        }
        const racedKeyInContext = fresh.receipts.find((receipt) => receipt.idempotencyKey === durableKey);
        if (racedKeyInContext) {
          if (sameIntent(racedKeyInContext.intent, intent)) {
            return { ok: true, receiptId: racedKeyInContext.id, duplicate: true };
          }
          return refuse(principal, "idempotency-key-reused", [intent.allotmentId, racedKeyInContext.id]);
        }
        const racedReferenceInContext = fresh.receipts.find((receipt) => receipt.intent.utr === intent.utr) ?? null;
        if (racedReference && racedReferenceInContext && racedReference.id !== racedReferenceInContext.id) {
          return refuse(principal, "source-invalid", [intent.allotmentId, racedReference.id, racedReferenceInContext.id]);
        }
        const winningReference = racedReference ?? racedReferenceInContext;
        if (winningReference) {
          const balanceWasTheIntent = intent.kind !== "Refund"
            && intent.amountRupees === outstandingRupees(command.expected);
          if (balanceWasTheIntent && outstandingRupees(fresh.snapshot) === 0) {
            return refuse(principal, "balance-already-recorded", [intent.allotmentId, winningReference.id]);
          }
          return refuse(principal, "receipt-reference-reused", [intent.allotmentId, winningReference.id]);
        }
        return null;
      });

    const fields: ZohoFields = {
      Allotment: { id: intent.allotmentId },
      Kind: intent.kind,
      Amount: intent.amountRupees,
      Mode: intent.mode,
      UTR: intent.utr,
      Received_On: intent.receivedOn,
      [RECEIPT_IDEMPOTENCY_FIELD]: durableKey,
      Match_State: "Pending",
    };
    // A disconnect or sign-out can abort the transport. If the POST crossed the network first,
    // the independent recovery read below identifies its outcome under the original durable key.
    let inserted: Awaited<ReturnType<ReceiptReplayDependencies["crm"]["insert"]>> | null;
    try {
      inserted = await awaitUntilAborted(
        crm.insert(principal.credential, RECEIPTS_MODULE, [fields], { signal }),
        signal,
      );
    } catch {
      const recovered = await recoverAfterWrite(false);
      return recovered ?? unresolvedWrite();
    }
    if (inserted === null) {
      const recovered = await recoverAfterWrite(false);
      return recovered ?? unresolvedWrite("aborted");
    }
    if (!inserted.ok) {
      const perRecordOutcomes = inserted.error.kind === "partial" || inserted.error.kind === "invalid-data"
        ? inserted.error.records
        : null;
      const definitiveSingleFailure = perRecordOutcomes?.length === 1
        && !perRecordOutcomes[0].ok
        && perRecordOutcomes[0].code !== "SUCCESS"
        && ZOHO_ERROR_CODE.test(perRecordOutcomes[0].code);
      const duplicateConstraint = (inserted.error.kind === "invalid-data" && inserted.error.code === "DUPLICATE_DATA")
        || (definitiveSingleFailure && perRecordOutcomes[0].code === "DUPLICATE_DATA");
      const ambiguousPerRecord = (inserted.error.kind === "partial"
        || (inserted.error.kind === "invalid-data"
          && inserted.error.status >= 200
          && inserted.error.status < 300))
        && !definitiveSingleFailure;
      const recovered = await recoverAfterWrite(duplicateConstraint);
      if (recovered) return recovered;
      if (duplicateConstraint || ambiguousPerRecord || inserted.error.kind === "unexpected") {
        // A unique constraint fired but the winning row is not queryable yet. The only safe answer
        // is ambiguous/retryable with the same key. A malformed/oversized acknowledgement is also
        // inconclusive because the POST may have committed before its response was rejected.
        return unresolvedWrite();
      }
      if (inserted.error.kind === "aborted") {
        return unresolvedWrite("aborted");
      }
      if (control.reason !== null
        && (inserted.error.kind === "network" || inserted.error.kind === "server")) return unknownOutcome();
      return sourceFailure(inserted);
    }
    const outcome = inserted.value[0];
    if (inserted.value.length !== 1
      || !outcome?.ok
      || outcome.index !== 0
      || outcome.code !== "SUCCESS"
      || !validOrgRecordId(outcome.id)) {
      const recovered = await recoverAfterWrite(false);
      return recovered ?? unresolvedWrite();
    }
    return { ok: true, receiptId: outcome.id, duplicate: false };
  };

  return {
    async prepare(principal, allotmentId, signal) {
      const trustedPrincipal = trustedPrincipalOf(principal);
      if (!trustedPrincipal || !validAllotmentId(allotmentId)) {
        return refuse(trustedPrincipal, "invalid-request");
      }
      const deadline = new AbortController();
      const abortFromCaller = () => deadline.abort();
      if (signal?.aborted) deadline.abort();
      else signal?.addEventListener("abort", abortFromCaller, { once: true });
      const timer = setTimeout(() => deadline.abort(), preparationTimeoutMs);
      timer.unref?.();
      try {
        const boundedSignal = deadline.signal;
        const active = await recheckSession(trustedPrincipal, boundedSignal);
        if (active !== true) return active;
        const allowed = await recheckPermission(trustedPrincipal, boundedSignal);
        if (allowed !== true) return allowed;
        const context = await readContext(trustedPrincipal, allotmentId, boundedSignal);
        if ("ok" in context) return context;
        const sessionStillActive = await recheckSession(trustedPrincipal, boundedSignal);
        if (sessionStillActive !== true) return sessionStillActive;
        const permissionStillActive = await recheckPermission(trustedPrincipal, boundedSignal);
        if (permissionStillActive !== true) return permissionStillActive;
        const preparedAt = sampledNow();
        if (preparedAt === null) return sourceUnavailable("zoho");
        const expected = context.snapshot;
        return {
          ok: true,
          value: Object.freeze({
            preparedAt,
            contextToken: receiptContextToken(contextSigningSecret, trustedPrincipal, preparedAt, allotmentId, expected),
            expected,
          }),
        };
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abortFromCaller);
      }
    },

    async replay(principal, command, _signal) {
      const trustedPrincipal = trustedPrincipalOf(principal);
      if (!trustedPrincipal) return refuse(null, "invalid-request");
      const intent = normalizeIntent(command?.intent);
      const expected = captureSnapshot(command?.expected);
      if (!command || typeof command !== "object" || !intent || !validAllotmentId(intent.allotmentId)
        || !Number.isSafeInteger(command.preparedAt) || command.preparedAt < 0
        || !Number.isSafeInteger(command.queuedAt) || command.queuedAt < 0
        || command.queuedAt < command.preparedAt
        || !expected || !validSnapshotRecordIds(expected)) {
        return refuse(trustedPrincipal, "invalid-request");
      }
      if (typeof command.idempotencyKey !== "string" || !OPAQUE_IDEMPOTENCY_KEY.test(command.idempotencyKey)) {
        return refuse(trustedPrincipal, "idempotency-key-invalid");
      }
      if (typeof command.contextToken !== "string" || !CONTEXT_TOKEN.test(command.contextToken)
        || !contextSigningSecrets.map((secret) => receiptContextToken(
          secret,
          trustedPrincipal,
          command.preparedAt,
          intent.allotmentId,
          expected,
        )).some((candidate) => sameFixedToken(candidate, command.contextToken))) {
        return refuse(trustedPrincipal, "context-token-invalid");
      }
      const now = sampledNow();
      if (now === null) return sourceUnavailable("zoho");
      const queueAge = now - command.queuedAt;
      const contextAge = now - command.preparedAt;
      const preparationAgeAtPress = command.queuedAt - command.preparedAt;
      if (queueAge < 0 || queueAge >= RECEIPT_REPLAY_MAX_AGE_MS
        || preparationAgeAtPress >= RECEIPT_REPLAY_MAX_AGE_MS
        || contextAge < 0 || contextAge >= RECEIPT_CONTEXT_MAX_AGE_MS) {
        return refuse(trustedPrincipal, "save-expired", [intent.allotmentId]);
      }
      if (intent.kind === "Refund") return refuse(trustedPrincipal, "refund-requires-approved-flow", [intent.allotmentId]);

      // Capture every caller-owned value before the first await. Browser code cannot mutate a queued
      // command while permission/context checks are running and change the money record we create.
      const durableIdempotencyKey = durableReceiptIdempotencyKey(
        idempotencySecret,
        trustedPrincipal,
        command.idempotencyKey,
      );
      const captured: CapturedReceiptReplay = Object.freeze({
        preparedAt: command.preparedAt,
        queuedAt: command.queuedAt,
        contextToken: command.contextToken,
        durableIdempotencyKey,
        intent,
        expected,
      });
      const scope = captured.durableIdempotencyKey;
      const fingerprint = replayFingerprint(
        trustedPrincipal,
        captured.preparedAt,
        captured.queuedAt,
        captured.contextToken,
        captured.intent,
        captured.expected,
      );
      const actorId = trustedPrincipal.credential.userId;
      const allotmentId = captured.intent.allotmentId;
      const busy = (): ReceiptReplayError => sourceUnavailable("zoho", "busy");
      // Registered before the first await, so a session that ends while this press is still being claimed
      // aborts it (discardSession) — whether this press wins the claim or only joins another.
      const control: ReplayControl = { controller: new AbortController(), reason: null };
      const remainingMs = Math.min(
        RECEIPT_REPLAY_MAX_AGE_MS - queueAge,
        RECEIPT_CONTEXT_MAX_AGE_MS - contextAge,
      );
      const timer = setTimeout(() => {
        if (!control.controller.signal.aborted) {
          control.reason = "deadline";
          control.controller.abort();
        }
      }, remainingMs);
      timer.unref?.();
      const activeSessionKey = sessionKey(trustedPrincipal);
      const sessionControls = controlsBySession.get(activeSessionKey) ?? new Set<ReplayControl>();
      sessionControls.add(control);
      controlsBySession.set(activeSessionKey, sessionControls);
      try {
        const o = await presses.once(scope, fingerprint, async () => {
          if (running >= MAX_IN_FLIGHT_RECEIPT_REPLAYS
            || (inFlightByActor.get(actorId) ?? 0) >= MAX_IN_FLIGHT_RECEIPT_REPLAYS_PER_ACTOR
            || (queuedByAllotment.get(allotmentId) ?? 0) >= MAX_QUEUED_RECEIPT_REPLAYS_PER_ALLOTMENT) {
            return busy();
          }
          running += 1;
          inFlightByActor.set(actorId, (inFlightByActor.get(actorId) ?? 0) + 1);
          queuedByAllotment.set(allotmentId, (queuedByAllotment.get(allotmentId) ?? 0) + 1);
          // Same-process different-key presses take turns here; across instances the turn is a SharedState claim
          // on the allotment (turnOn), so two keys for one allotment never run at once on two processes either.
          // Once a money commit starts it is not cancelled by a browser disconnect. The idempotency
          // key lets that browser (or another waiter) recover the durable outcome later.
          try {
            return await serializeAllotment(allotmentId, () => turnOn(allotmentId, control, remainingMs,
              () => execute(trustedPrincipal, captured, control), busy));
          } finally {
            running -= 1;
            const actorPending = (inFlightByActor.get(actorId) ?? 1) - 1;
            if (actorPending === 0) inFlightByActor.delete(actorId);
            else inFlightByActor.set(actorId, actorPending);
            const allotmentPending = (queuedByAllotment.get(allotmentId) ?? 1) - 1;
            if (allotmentPending === 0) queuedByAllotment.delete(allotmentId);
            else queuedByAllotment.set(allotmentId, allotmentPending);
          }
        });
        if (o.kind === "reused") return refuse(trustedPrincipal, "idempotency-key-reused", [captured.intent.allotmentId]);
        if (o.kind === "busy" || o.kind === "unavailable") return busy();
        const r = o.result;
        return o.kind === "replay" && r.ok ? { ok: true, receiptId: r.receiptId, duplicate: true } : r;
      } finally {
        clearTimeout(timer);
        sessionControls.delete(control);
        if (sessionControls.size === 0) controlsBySession.delete(activeSessionKey);
      }
    },

    discardSession(actorId, sessionId) {
      if (typeof actorId !== "string" || !ACTOR_ID.test(actorId)
        || typeof sessionId !== "string" || !SESSION_ID.test(sessionId)) return;
      const controls = controlsBySession.get(`${actorId}\u0000${sessionId}`);
      if (!controls) return;
      for (const control of controls) {
        if (control.controller.signal.aborted) continue;
        control.reason = "session";
        control.controller.abort();
      }
    },
  };
}
