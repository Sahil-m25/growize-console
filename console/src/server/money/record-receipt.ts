/**
 * M08-S03-T04 — Finance records a receipt, through commit() (D21, D45, D47, D53, D70).
 *
 * Every rupee that arrives is recorded, whatever state the paper is in: recording is never refused for an
 * unsigned or unverified supplementary agreement — it is recorded "unmatched" (Match_State Pending) and the
 * answer says it cannot be MATCHED until the supplementary is signed and verified (D21 / CLAUDE.md rule 3).
 *
 * D113 ruling 1: a receipt a Finance seat records IS matched — recording by a Finance seat is Finance's own approval,
 * no second person. So when the paper allows it, the receipt inserted here is matched at once through match.ts
 * (the one path to Matched: Matched_By = the recorder, on the recorder's token; the gate, money.confirmed, the hold
 * and the investor's app account at the first matched money all follow from there, exactly as a "Match it" press).
 * If that match does not land (paper not verified, Zoho busy, a refusal), the receipt stays recorded and Pending and
 * the answer says so — Finance confirms it by hand with "Match it", or the weekly statement does (statements.ts).
 *
 * This file adds no Zoho logic of its own. It composes the existing write path:
 *   receipt-replay.ts        prepare() seals the live allotment context; replay() inserts ONE Pending receipt
 *                            keyed by a durable idempotency key (lost responses recovered by that key);
 *   allotment-receipts.ts    record(): allotment required, Cancelled takes no inbound money, 412 → changed,
 *                            then re-reads the allotment's Payment_Status.
 * and adds what commit() is in the prototype (ir-console-redesigned `commit`, merged html 8184–8249):
 *   - who may record: a fresh check on the live session (Finance Operations, Head of Finance, super user);
 *     every other seat is "Read only — Finance Operations and the Head of Finance record money.";
 *   - the double-press guard: one Idempotency-Key per press. A second press with the same key joins the first
 *     and gets its answer (a success is held for ten minutes, ids only — never a record, D45); the same key
 *     with a different receipt is refused;
 *   - "Not saved yet": every answer that is not a Zoho-confirmed id says so, and says whether pressing again
 *     is safe (it is, with the same key — replay() recovers by the key).
 *
 * The allotment lookup is the only link written: the investor (Contact) and the farm (LLP) follow from the
 * allotment (D70) and come back in `link`. recorded_by is the token user — the insert runs on the person's
 * own token, so Zoho's Created_By is them (D53); it is returned as `recordedBy`.
 * Logs carry ids and codes only; the bank reference is never logged.
 */

import type { UserCredential } from "../../lib/zoho/client";
import { isUserCredential } from "../../lib/zoho/client";
import type { ZohoFailureKind } from "../../lib/zoho/errors";
import type { OpsLog } from "../../lib/zoho/log";
import type { AllotmentLink, AllotmentReceiptResult, AllotmentReceiptWrites, PaymentStatusReading } from "./allotment-receipts";
import type { MatchResult, MatchView } from "./match";
import type {
  QueuedReceiptReplay, ReceiptKind, ReceiptMode, ReceiptReplayPrincipal, ReceiptReplayService, ReceiptReplaySnapshot,
} from "./receipt-replay";
import { RECEIPT_MODES } from "./receipt-replay";
import { createMemoryState } from "../state/memory";
import { createIdempotency } from "../state/idempotent";
import type { SharedState } from "../state/shared-state";

export const READ_ONLY_TEXT = "Read only — Finance Operations and the Head of Finance record money.";
export const MATCH_BLOCKED_TEXT = "Recorded. It cannot be matched until the supplementary agreement is signed and verified.";
/** The receipt is recorded but the immediate match did not land: Finance presses "Match it" on Payments. */
export const NOT_MATCHED_YET_TEXT = "Recorded, not matched yet — press 'Match it' on Payments.";
export const RECORD_REPLAY_TTL_MS = 10 * 60 * 1_000;

/** The Money drawer's words → Receipts.Kind. "Part" is the live name of D70's Balance. Refunds have their own flow. */
export const RECORD_KINDS: Readonly<Record<string, ReceiptKind>> = Object.freeze({ advance: "Advance", balance: "Part", full: "Full" });

const SESSION_ID = /^[A-Za-z0-9_-]{16,128}$/;
const RECORD_ID = /^\d{15,22}$/;
const RECORD_PREFIX = /^\d{6,16}$/;
const OPAQUE_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/;
const UTR = /^[A-Z0-9][A-Z0-9._/-]{2,79}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type RecordRefusal =
  | "invalid-request" | "read-only" | "idempotency-key-invalid" | "idempotency-key-reused" | "fields" | "nothing-due" | "busy";

export interface RecordedReceipt {
  readonly receiptId: string;
  readonly duplicate: boolean;
  /** matched: Finance's own record matched it (D113); unmatched: Pending — the paper is not verified, or the match did not land. */
  readonly state: "matched" | "unmatched";
  /** who matched it (the recorder) and when (IST), when matched now; null otherwise */
  readonly matchedBy: string | null;
  readonly matchedAt: string | null;
  /** match.ts's answer (the gate, money.confirmed, the app account, the hold) when the match ran; null otherwise */
  readonly match: MatchView | null;
  readonly kind: keyof typeof RECORD_KINDS;
  readonly mode: ReceiptMode;
  readonly amountRupees: number;
  /** Finance's own entry, answered to Finance only (this route is Finance's). */
  readonly ref: string;
  readonly receivedOn: string;
  readonly recordedBy: string;
  readonly link: AllotmentLink;
  readonly matchable: boolean;
  readonly matchNote: string | null;
  readonly paymentStatus: PaymentStatusReading | null;
}

export interface Prepared {
  readonly preparedAt: number;
  readonly contextToken: string;
  readonly expected: ReceiptReplaySnapshot;
  readonly amountDueRupees: number;
  readonly matchable: boolean;
  readonly matchNote: string | null;
}

type Fail =
  | { readonly ok: false; readonly kind: "refused"; readonly reasonCode: string; readonly message: string; readonly retryable: false }
  | { readonly ok: false; readonly kind: "source-error"; readonly errorKind: ZohoFailureKind | "unexpected"; readonly message: string; readonly retryable: boolean }
  | { readonly ok: false; readonly kind: "unknown-outcome"; readonly message: string; readonly retryable: true };
export type RecordResult = { readonly ok: true; readonly value: RecordedReceipt } | Fail;
export type PrepareResult = { readonly ok: true; readonly value: Prepared } | Fail;

export interface RecordAuthority {
  /** Fresh check on the live session: may this person record money (Investors-side "pay")? */
  mayRecord(credential: UserCredential, sessionId: string, signal?: AbortSignal): Promise<boolean>;
}

/** match.ts's "Match it", called with the recorder's own principal (D113). */
export interface RecordMatch {
  match(principal: unknown, receiptId: unknown, body?: unknown, signal?: AbortSignal): Promise<MatchResult>;
}

export interface RecordReceiptDependencies {
  readonly replay: Pick<ReceiptReplayService, "prepare">;
  /** D113: match a Finance seat's receipt as it is recorded. Absent: recorded Pending (the pre-D113 behaviour). */
  readonly match?: RecordMatch;
  readonly writes: Pick<AllotmentReceiptWrites, "record">;
  readonly authority: RecordAuthority;
  readonly log: OpsLog;
  readonly recordIdPrefix: string;
  readonly clock?: () => number;
  /** Where the double-press guard lives (runtime: sharedState()); default an in-process store. */
  readonly state?: SharedState;
}

/** What a refusal from the write path says, in the drawer's words. Every one begins "Not saved yet". */
const TEXT: Readonly<Record<string, string>> = Object.freeze({
  "invalid-request": "Not saved yet — reload the page and try again.",
  "read-only": READ_ONLY_TEXT,
  "idempotency-key-invalid": "Not saved yet — reload the page and try again.",
  "idempotency-key-reused": "Not saved yet — this press was already used for a different receipt. Reload and record it again.",
  fields: "Not saved yet — check the receipt.",
  "nothing-due": "Not saved yet — nothing is due on this allotment. Enter the amount that arrived.",
  busy: "Not saved yet — the console is busy. Try again in a minute.",
  "allotment-required": "Not saved yet — choose the farm this money is for.",
  "allotment-not-visible": "Not saved yet — this allotment is not available to you.",
  "allotment-cancelled": "Not saved yet — this allotment is cancelled; it takes refunds only.",
  "allotment-changed": "Not saved yet — the allotment changed while you were entering this. Review it and record again.",
  "allotment-target-changed": "Not saved yet — the allotment changed while you were entering this. Review it and record again.",
  "reservation-state-changed": "Not saved yet — the allotment changed while you were entering this. Review it and record again.",
  "hold-changed": "Not saved yet — the hold changed while you were entering this. Review it and record again.",
  "supplementary-round-changed": "Not saved yet — the supplementary agreement changed while you were entering this. Review it and record again.",
  "amount-due-changed": "Not saved yet — someone recorded money on this allotment meanwhile. Review it and record again.",
  "balance-already-recorded": "Not saved yet — the balance is already recorded.",
  "receipt-reference-reused": "Not saved yet — that bank reference is already recorded on another receipt.",
  "save-expired": "Not saved yet — the waiting save expired. Record it again.",
  "session-changed": "Not saved yet — sign in again.",
  "actor-changed": "Not saved yet — sign in again.",
  "permission-changed": READ_ONLY_TEXT,
  "context-token-invalid": "Not saved yet — reload the page and try again.",
  "refund-requires-approved-flow": "Not saved yet — refunds go through their approval.",
  "source-invalid": "Not saved yet — Zoho returned something the console cannot read. Digital Infrastructure has been told.",
});
const textOf = (code: string): string => TEXT[code] ?? "Not saved yet — try again.";
const RETRY_SAME_KEY = "Not saved yet — Zoho has not confirmed it. Press again; it will not be recorded twice.";
const istDate = (ms: number): string => new Date(ms + 5.5 * 3_600_000).toISOString().slice(0, 10);

interface Intent {
  readonly allotmentId: string; readonly kind: keyof typeof RECORD_KINDS; readonly mode: ReceiptMode; readonly ref: string;
  readonly receivedOn: string; readonly amountRupees: number | null;
  readonly prepared: { readonly preparedAt: number; readonly contextToken: string; readonly expected: ReceiptReplaySnapshot } | null;
  readonly queuedAt: number | null;
}

export function createRecordReceipt(deps: RecordReceiptDependencies) {
  if (!deps || typeof deps.replay?.prepare !== "function" || typeof deps.writes?.record !== "function"
    || typeof deps.authority?.mayRecord !== "function" || typeof deps.log?.refusal !== "function"
    || typeof deps.recordIdPrefix !== "string" || !RECORD_PREFIX.test(deps.recordIdPrefix)) {
    throw new TypeError("Recording a receipt needs the replay service, the allotment receipt writes, the record authority, the ops log and the CRM record-id prefix.");
  }
  const { replay, writes, authority, log } = deps;
  const clock = deps.clock ?? Date.now;
  const validId = (v: unknown): v is string => typeof v === "string" && RECORD_ID.test(v) && v.startsWith(deps.recordIdPrefix);
  // The double-press guard (../state/idempotent): claimed in SharedState, so a second press on another instance
  // joins the first. Only a confirmed id is held; the stored answer carries no reference (re-filled on replay).
  const presses = createIdempotency<RecordResult>({
    state: deps.state ?? createMemoryState({ clock }), ns: "record-receipt", ttlSeconds: RECORD_REPLAY_TTL_MS / 1_000, clock,
    keep: (r) => r.ok,
    save: (r) => JSON.stringify(r.ok ? { ...r, value: { ...r.value, ref: "" } } : r),
    load: (s) => { try { return JSON.parse(s) as RecordResult; } catch { return null; } },
  });

  const refuse = (me: string, code: string, ids: readonly unknown[] = []): Fail => {
    let at = 0;
    try { at = clock(); } catch { /* the refusal stands */ }
    log.refusal({ at, actor: { kind: "user", userId: me }, action: "record-receipt", reason: code, recordIds: ids.filter(validId) });
    return { ok: false, kind: "refused", reasonCode: code, message: textOf(code), retryable: false };
  };
  /** A refusal already logged by the layer that made it: answered, not logged twice. */
  const passOn = (code: string): Fail => ({ ok: false, kind: "refused", reasonCode: code, message: textOf(code), retryable: false });
  const failOf = (r: Exclude<AllotmentReceiptResult, { ok: true }> | Exclude<Awaited<ReturnType<ReceiptReplayService["prepare"]>>, { ok: true }>): Fail => {
    if (r.kind === "refused") return passOn(r.reasonCode);
    if (r.kind === "unknown-outcome") return { ok: false, kind: "unknown-outcome", message: RETRY_SAME_KEY, retryable: true };
    return { ok: false, kind: "source-error", errorKind: r.errorKind, message: r.retryable ? RETRY_SAME_KEY : "Not saved yet — Zoho refused it. Try again later.", retryable: r.retryable };
  };
  const trusted = (p: unknown): ReceiptReplayPrincipal | null => {
    const c = p && typeof p === "object" ? (p as { credential?: unknown; sessionId?: unknown }) : null;
    return c && isUserCredential(c.credential) && typeof c.sessionId === "string" && SESSION_ID.test(c.sessionId)
      ? { credential: c.credential, sessionId: c.sessionId } : null;
  };
  const may = async (p: ReceiptReplayPrincipal, signal?: AbortSignal): Promise<boolean> => {
    try { return (await authority.mayRecord(p.credential, p.sessionId, signal)) === true; } catch { return false; }
  };
  /** The gates' rule (gates.ts): the supplementary is verified when Supplementary_Verified_At is stamped. */
  const matchableOf = (e: ReceiptReplaySnapshot): boolean => e.supplementary.verifiedAt !== null;

  function parse(me: string, body: unknown): Intent | Fail {
    const b = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
    if (!b) return refuse(me, "invalid-request");
    if (!validId(b.allotmentId)) return refuse(me, "allotment-required");
    const kind = typeof b.kind === "string" ? b.kind.toLowerCase() : "";
    if (!Object.hasOwn(RECORD_KINDS, kind)) return refuse(me, "fields");
    const mode = typeof b.mode === "string" ? b.mode : "";
    if (!(RECEIPT_MODES as readonly string[]).includes(mode)) return refuse(me, "fields");
    const ref = typeof b.ref === "string" ? b.ref.replace(/\s+/g, "").toUpperCase() : "";
    if (!UTR.test(ref)) return refuse(me, "fields");
    const today = istDate(clock());
    const day = b.receivedOn === undefined || b.receivedOn === null || b.receivedOn === "" ? today : b.receivedOn;
    if (typeof day !== "string" || !ISO_DATE.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`))
      || new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day || day > today) return refuse(me, "fields");
    let amountRupees: number | null = null;
    if (b.amount !== undefined && b.amount !== null && b.amount !== "") {
      const n = typeof b.amount === "number" ? b.amount : typeof b.amount === "string" && /^\d{1,15}$/.test(b.amount.trim()) ? Number(b.amount) : NaN;
      if (!Number.isSafeInteger(n) || n <= 0) return refuse(me, "fields");
      amountRupees = n;
    } else if (kind === "advance") return refuse(me, "fields");
    let prepared: Intent["prepared"] = null;
    const pr = b.prepared && typeof b.prepared === "object" ? (b.prepared as Record<string, unknown>) : null;
    if (pr) {
      if (!Number.isSafeInteger(pr.preparedAt) || typeof pr.contextToken !== "string" || !pr.expected || typeof pr.expected !== "object") {
        return refuse(me, "invalid-request");
      }
      prepared = { preparedAt: pr.preparedAt as number, contextToken: pr.contextToken, expected: pr.expected as ReceiptReplaySnapshot };
    }
    const queuedAt = Number.isSafeInteger(b.queuedAt) ? (b.queuedAt as number) : null;
    return { allotmentId: b.allotmentId, kind: kind as Intent["kind"], mode: mode as ReceiptMode, ref, receivedOn: day, amountRupees, prepared, queuedAt };
  }

  async function prepareFor(p: ReceiptReplayPrincipal, allotmentId: string, signal?: AbortSignal): Promise<PrepareResult> {
    const r = await replay.prepare(p, allotmentId, signal);
    if (!r.ok) return failOf(r);
    const matchable = matchableOf(r.value.expected);
    return { ok: true, value: Object.freeze({ ...r.value, amountDueRupees: r.value.expected.amountDueRupees, matchable,
      matchNote: matchable ? null : MATCH_BLOCKED_TEXT }) };
  }

  async function run(p: ReceiptReplayPrincipal, key: string, i: Intent, signal?: AbortSignal): Promise<RecordResult> {
    const me = p.credential.userId;
    let prepared = i.prepared;
    if (!prepared) {
      const got = await prepareFor(p, i.allotmentId, signal);
      if (!got.ok) return got;
      prepared = got.value;
    }
    // The drawer's computed amount: the balance (or a full payment) is what is still due.
    const amountRupees = i.amountRupees ?? prepared.expected?.amountDueRupees ?? 0;
    if (!Number.isSafeInteger(amountRupees) || amountRupees <= 0) return refuse(me, "nothing-due", [i.allotmentId]);
    const command: QueuedReceiptReplay = {
      preparedAt: prepared.preparedAt,
      queuedAt: i.queuedAt ?? Math.max(prepared.preparedAt, clock()),
      contextToken: prepared.contextToken,
      idempotencyKey: key,
      intent: { allotmentId: i.allotmentId, kind: RECORD_KINDS[i.kind]!, amountRupees, mode: i.mode, utr: i.ref,
        receivedOn: `${i.receivedOn}T00:00:00+05:30` },
      expected: prepared.expected,
    };
    let r: AllotmentReceiptResult;
    try { r = await writes.record(p, command, signal); } catch {
      return { ok: false, kind: "unknown-outcome", message: RETRY_SAME_KEY, retryable: true };
    }
    if (!r.ok) return failOf(r);
    const matchable = matchableOf(prepared.expected);
    // D113: Finance's record is Finance's approval — match it now, through match.ts, on the recorder's own token.
    let matched: MatchView | null = null, matchNote: string | null = matchable ? null : MATCH_BLOCKED_TEXT;
    if (matchable && deps.match) {
      let m: MatchResult;
      try { m = await deps.match.match(p, r.receiptId, {}, signal); } catch { m = { ok: false, kind: "source-error", errorKind: "unexpected", message: "", retryable: true }; }
      if (m.ok) matched = m.value;
      else {
        matchNote = m.kind === "refused" && m.reasonCode === "supplementary-not-verified" ? MATCH_BLOCKED_TEXT : NOT_MATCHED_YET_TEXT;
        let at = 0;
        try { at = clock(); } catch { /* the note stands */ }
        log.refusal({ at, actor: { kind: "user", userId: me }, action: "record-receipt",
          reason: `not-matched.${m.kind === "refused" ? m.reasonCode : m.errorKind}`.slice(0, 64), recordIds: [r.receiptId].filter(validId) });
      }
    }
    return {
      ok: true,
      value: Object.freeze({
        receiptId: r.receiptId, duplicate: r.duplicate, state: matched ? "matched" as const : "unmatched" as const, kind: i.kind, mode: i.mode, amountRupees,
        ref: i.ref, receivedOn: i.receivedOn, recordedBy: me, link: r.link, matchable,
        matchNote, paymentStatus: matched?.paymentStatus ?? r.paymentStatus,
        matchedBy: matched ? matched.matchedBy : null, matchedAt: matched ? matched.matchedAt : null, match: matched,
      }),
    };
  }

  return Object.freeze({
    /** Seal the live allotment context for the drawer (and an offline press). Finance seats only. */
    async prepare(principal: unknown, allotmentId: unknown, signal?: AbortSignal): Promise<PrepareResult> {
      const p = trusted(principal);
      if (!p) return refuse("unrecognised", "invalid-request");
      if (!validId(allotmentId)) return refuse(p.credential.userId, "allotment-required");
      if (!(await may(p, signal))) return refuse(p.credential.userId, "read-only", [allotmentId]);
      return prepareFor(p, allotmentId, signal);
    },

    /** commit(): record one receipt, exactly once per Idempotency-Key. */
    async commit(principal: unknown, body: unknown, idempotencyKey: unknown, signal?: AbortSignal): Promise<RecordResult> {
      const p = trusted(principal);
      if (!p) return refuse("unrecognised", "invalid-request");
      const me = p.credential.userId;
      if (typeof idempotencyKey !== "string" || !OPAQUE_KEY.test(idempotencyKey)) return refuse(me, "idempotency-key-invalid");
      const i = parse(me, body);
      if ("ok" in i) return i;
      if (!(await may(p, signal))) return refuse(me, "read-only", [i.allotmentId]);

      const slot = `${me}\u0000${p.sessionId}\u0000${idempotencyKey}`;
      const fingerprint = JSON.stringify([i.allotmentId, i.kind, i.mode, i.ref, i.receivedOn, i.amountRupees]);
      const o = await presses.once(slot, fingerprint, () => run(p, idempotencyKey, i, signal));
      if (o.kind === "reused") return refuse(me, "idempotency-key-reused", [i.allotmentId]);
      if (o.kind === "busy" || o.kind === "unavailable") return refuse(me, "busy", [i.allotmentId]);
      const r = o.result;
      if (o.kind === "ran") return r;
      return r.ok ? { ok: true, value: Object.freeze({ ...r.value, ref: i.ref, duplicate: true }) } : r;
    },
  });
}
export type RecordReceipt = ReturnType<typeof createRecordReceipt>;
