/**
 * M10-S02-T02 — "Match it", and what a match sets moving (D10, D19, D21, D22, D70, D73, D113 ruling 1).
 *
 * Recording is free; matching is the gated act (D21 / CLAUDE.md rule 3) — and the gate is the Finance seat (D113):
 * a receipt a Finance seat records is Finance's own approval, so record-receipt.ts matches it through this file
 * straight after the insert. This is the only console path that moves a receipt to Matched:
 *   - who, for inbound money (Advance / Part / Full): a Finance seat — the Investors-side "pay" capability (Finance
 *     Operations, Head of Finance, super user), checked fresh on the live session (`mayMatch`). The recorder may
 *     match their own receipt: no second person (D113 supersedes the second-person reading of D21/D22);
 *   - who, for money leaving (a Refund): D22's second hand stays — the Head of Finance or an administrator
 *     (`mayApproveOutbound`), never the person who recorded it (Created_By ≠ the matcher). A Zoho validation rule
 *     refusing Matched_By is answered with the same words for a refund; for inbound money it means Zoho still
 *     holds the old two-person rule (M10-S02-T01), answered as such;
 *   - only a Pending receipt is matched: a recorded one whose paper was not verified yet, a legacy or added-as-paid
 *     row, or one the weekly statement confirms (statements.ts). A Claimed row is an IR's report and stays pending
 *     until Finance confirms it (claim-answer.ts records it, which matches it);
 *   - inbound money is matched only when the allotment's supplementary is verified (record-receipt MATCH_BLOCKED_TEXT).
 *
 * The write: ONE guarded PUT (If-Unmodified-Since = the receipt's Modified_Time, D44) of Match_State = Matched and
 * Matched_By = the matcher, on the matcher's own token. Receipts has no Matched_At; the match time is the fact's
 * time in the events (IST, rule 9).
 *
 * The consequences (each reported on its own; a failed one never un-does the match, and pressing again on a
 * matched receipt re-runs them idempotently — the events carry ids derived from the record, so the outbox and
 * the app apply them once):
 *   1. the lead's gate — gates.ts reads MATCHED money from Receipts, so the gate opens by the write itself; the
 *      Leads module has no gate field to write (FACT CHANGE PROPOSED, reported);
 *   2. money.confirmed { kind, amount, at, matched_by, receipt_id } to the investor app (contracts/money.confirmed.json);
 *      the bank reference never leaves (outbox identity guard);
 *   3. the allotment's Payment_Status: allotment-receipts.ts re-reads it and computes it from matched receipts
 *      (T01's Zoho workflow is its only writer); a mismatch is flagged, never written here;
 *   4. the investor's FIRST matched inbound money (Advance, Part or Full — D10 "first confirmed money"; a Refund
 *      never opens): account.opened { arl_code, at, state: tentative } (D10), and ONE guarded Contacts write of
 *      what is still empty — App_Access empty → Hold (PROVISIONAL, Jev 0.54) and App_Account_Mark empty →
 *      Tentative with App_Mark_At = the match time (M08-S08, PROVISIONAL, Jev 0.56; App_Mark_By stays empty: the
 *      system set it). If Zoho refuses the mark fields (T01 turning App_Account_Mark into a formula), the write is
 *      retried once with App_Access alone. Hold/Invite once set are never touched (server/investors/unlock.ts owns
 *      Hold → Invite, and so the welcome: nothing here sends one or sets Invite). Permanent is Zoho's (T01).
 *      D115 ruling 1: a match NEVER opens app access. The only App_Access value this file can write is Hold, and
 *      only into an empty field — that is the account being created On hold (an investor added by add-paid
 *      already holds Hold, so a match leaves it as it is). Opening (Hold → Invite) is the release alone:
 *      "Send welcome and unlock" in unlock.ts, behind the Investors "pay" right, logged (ops log `app-access` / `unlocked`).
 *      A Finance seat's recording (record-receipt.ts) reaches this by matching through here, never by writing the
 *      Contact itself (D113).
 *      Every publish result (delivered / queued / not sent) is logged as an ops event: type + status + ids only;
 *   5. the first matched Advance of a Reserved allotment starts the hold 30 days out (Asia/Kolkata): Hold_Until =
 *      match day + 30, written only when empty or earlier — never shortening a hold (PROVISIONAL, Jev 0.56).
 *      When this match writes the hold, hold.changed { deadline, state: open, by } goes to the investor app through
 *      the same publisher (server/contracts/runtime publishToInvestorApp), built by ../holds/rules holdChangedEvent
 *      so the deadline and event id are the holds' own (TC-IM05-028). A kept longer hold publishes nothing.
 *   6. D137 ruling 3: when matched money on the allotment now covers units × Unit_Price, the Reserved allotment converts in full
 *      automatically — investors/full-paid `auto` stamps Converted_At / Converted_By (the matcher) / Converted_Via "Finance match"
 *      on the matcher's own token (`converted` in the view; `fields-missing` until the fields exist).
 *   7. D140 (W8-IRA-1): the allotment's Total_Amount_Received = matched inbound − matched refunds, written by ./received-total (its
 *      one writer) on the matcher's own token, guarded; after the hold write so the two guarded writes never race (`received`).
 * D137 ruling 2(a): the match write also carries Receipts.Matched_At (IST) for the 10% trail; an org without the field gets the
 * match written without it.
 *
 * Nothing is cached (D45). Logs carry ids and codes only.
 */

import { createHash } from "node:crypto";
import type { UserCredential, ZohoClient, ZohoRecord } from "../../lib/zoho/client";
import { isUserCredential } from "../../lib/zoho/client";
import type { ZohoFailureKind } from "../../lib/zoho/errors";
import type { OpsLog } from "../../lib/zoho/log";
import type { AllotmentReceiptWrites, PaymentStatusReading } from "./allotment-receipts";
import { ALLOTMENTS_MODULE, RECEIPTS_MODULE } from "./receipt-replay";
import { ALLOTMENT_UNLINKED, missingLinks } from "../investors/allotment-guard";
import { holdChangedEvent } from "../holds/rules";
import { MATCHED_AT_FIELD } from "./matched-receipts";
import { syncReceived, type ReceivedSync } from "./received-total";

export const CONTACTS_MODULE = "Contacts";
export const HOLD_DAYS = 30;
/** D22: money leaving keeps its second hand. Ordinary receipts have none (D113). */
export const SAME_HAND_TEXT = "Money leaving is matched by a second person — you recorded this refund, so the Head of Finance or an administrator matches it.";
export const NOT_MATCHER_TEXT = "Finance matches receipts — Finance Operations or the Head of Finance.";
export const NOT_APPROVER_TEXT = "Money leaving is matched by the Head of Finance or an administrator, never by the person who recorded it.";
export const ZOHO_RULE_TEXT = "Not matched — Zoho still holds the old two-person rule on receipts. Digital Infrastructure removes it for ordinary receipts (D113).";
export const MATCH_NEEDS_PAPER_TEXT = "It cannot be matched until the supplementary agreement is signed and verified.";

const SESSION_ID = /^[A-Za-z0-9_-]{16,128}$/;
const RECORD_ID = /^\d{15,22}$/;
const RECORD_PREFIX = /^\d{6,16}$/;
const ZDT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ARL_CODE = /^ARL-INV-\d{4}$/;
const IN_LIMIT = 100;
const PAGE = 2_000;
const INBOUND: ReadonlySet<string> = new Set(["Advance", "Part", "Balance", "Full"]);
const KINDS: ReadonlySet<string> = new Set(["Advance", "Part", "Balance", "Full", "Refund"]);
const STATES: ReadonlySet<string> = new Set(["Pending", "Matched", "Not found", "Reversed", "Claimed"]);
/** Receipts.Kind → money.confirmed kind. Part is the live name of D70's Balance. */
const EVENT_KIND: Readonly<Record<string, "advance" | "balance" | "full">> = Object.freeze({ Advance: "advance", Part: "balance", Balance: "balance", Full: "full" });
const RECEIPT_FIELDS = Object.freeze(["Allotment", "Kind", "Amount", "Match_State", "Matched_By", "Created_By", "Modified_Time"]);
const ALLOTMENT_FIELDS = Object.freeze(["Allocation_Status", "Customer", "LLP", "Hold_Until", "Supplementary_Verified_At", "Modified_Time"]);
const CONTACT_FIELDS = Object.freeze(["ARL_ID", "App_Access", "App_Account_Mark", "Modified_Time"]);
const MARK_FIELDS: ReadonlySet<string> = new Set(["App_Account_Mark", "App_Mark_At"]);

export type MatchRefusal =
  | "invalid-request" | "not-matcher" | "not-approver" | "not-visible" | "is-claim" | "not-pending" | "same-hand" | "zoho-same-hand-rule"
  | "receipt-changed" | "supplementary-not-verified" | "allotment-cancelled" | "source-invalid"
  /* M01-S10-NOTE-6 / D22: approving a refund (money leaving) needs a live step-up ("refund") on this session */
  | "step-up" | "step-up-locked";

const MESSAGE: Readonly<Record<MatchRefusal, string>> = Object.freeze({
  "invalid-request": "Not matched — reload the page and try again.",
  "not-matcher": NOT_MATCHER_TEXT,
  "not-approver": NOT_APPROVER_TEXT,
  "not-visible": "This receipt is not available to you.",
  "step-up": "Not matched — confirm it is you with a fresh Zoho sign-in first. Money leaving needs it (D22).",
  "step-up-locked": "Not matched — approving refunds is locked for you after three failed confirmations. Ask Digital Infrastructure to unlock it.",
  "is-claim": "This is an IR's report, not a receipt. Answer it from the report.",
  "not-pending": "Only a pending receipt can be matched.",
  "same-hand": SAME_HAND_TEXT,
  "zoho-same-hand-rule": ZOHO_RULE_TEXT,
  "receipt-changed": "Not matched — the receipt changed while you were looking at it. Reload and match again.",
  "supplementary-not-verified": MATCH_NEEDS_PAPER_TEXT,
  "allotment-cancelled": "Not matched — this allotment is cancelled; it takes refunds only.",
  "source-invalid": "Not matched — Zoho returned something the console cannot read. Digital Infrastructure has been told.",
});

/** One event's outcome: the outbox's delivery state, or why it did not leave. */
export type Published =
  | { readonly ok: true; readonly eventId: string; readonly state?: unknown }
  | { readonly ok: false; readonly reason: string; readonly errors?: readonly string[] };
export type Publish = (event: Record<string, unknown>) => Promise<Published>;

export interface Consequence<T> { readonly ok: boolean; readonly value: T | null; readonly code: string | null }

export interface MatchView {
  readonly receiptId: string;
  readonly state: "matched";
  /** true: the receipt was already matched (a second press, a retry); the consequences were re-run. */
  readonly duplicate: boolean;
  readonly matchedBy: string;
  readonly matchedAt: string;
  readonly kind: string;
  readonly amountRupees: number;
  readonly link: { readonly allotmentId: string; readonly investorId: string };
  /** The lead's gate reads matched Receipts (gates.ts): nothing is written on the lead. */
  readonly gate: "opens-through-receipts" | "not-money";
  readonly paymentStatus: PaymentStatusReading | null;
  readonly moneyConfirmed: Published | null;
  readonly firstMoney: boolean;
  readonly accountOpened: Published | null;
  /** "opened-on-hold": an empty App_Access was created as Hold (never Invite — D115 ruling 1); "already-set": left as it was. */
  readonly appAccess: Consequence<"opened-on-hold" | "already-set">;
  /** App_Account_Mark on the first money: set Tentative here, already set, or left to Zoho (T01 formula refused the write). */
  readonly appMark: Consequence<"tentative-set" | "already-set" | "left-to-zoho">;
  readonly hold: Consequence<{ readonly until: string; readonly written: boolean }>;
  /** hold.changed 'open' when this match started the hold; null when no hold was written. */
  readonly holdChanged: Published | null;
  /** D137 ruling 3: the full conversion this match triggered ("converted"), or why not; null when not wired / not inbound. */
  readonly converted?: FullPaidOutcome | null;
  /** D140: the allotment's Total_Amount_Received brought in line with its matched receipts (./received-total), or why not. */
  readonly received?: ReceivedSync | null;
}
/** investors/full-paid AutoOutcome, restated so this module does not import the investors side. */
export type FullPaidOutcome = { readonly ok: boolean; readonly value: "converted" | "already" | "not-yet" | "not-reserved" | "waiting-supplementary" | null; readonly code: string | null };

export type MatchResult =
  | { readonly ok: true; readonly value: MatchView }
  | { readonly ok: false; readonly kind: "refused"; readonly reasonCode: MatchRefusal; readonly message: string; readonly retryable: false }
  | { readonly ok: false; readonly kind: "source-error"; readonly errorKind: ZohoFailureKind | "unexpected"; readonly message: string; readonly retryable: boolean };

export interface MatchAuthority {
  /** Fresh check on the live session: does this person hold a Finance seat (the "pay" capability)? (D113) */
  mayMatch(credential: UserCredential, sessionId: string, signal?: AbortSignal): Promise<boolean>;
  /** Fresh check: may this person be the second hand on money leaving — the Head of Finance or an administrator (D22)?
   *  Absent: `mayMatch` decides refunds too (the recorder is still refused). */
  mayApproveOutbound?(credential: UserCredential, sessionId: string, signal?: AbortSignal): Promise<boolean>;
  /** M01-S10-NOTE-6 / D22: is a step-up for "refund" live on this session? Asked only for money leaving, after the
   *  approver and same-hand checks. Absent: not asked (tests, doubles). The runtime always supplies it. */
  stepUpOutbound?(sessionId: string): Promise<"ok" | "step-up" | "locked">;
}

export interface MatchDependencies {
  readonly crm: Pick<ZohoClient, "getRecord" | "coql" | "update">;
  readonly writes: Pick<AllotmentReceiptWrites, "paymentStatus">;
  readonly authority: MatchAuthority;
  readonly publish: Publish;
  readonly log: OpsLog;
  readonly recordIdPrefix: string;
  readonly clock?: () => number;
  /** D137 ruling 3: the automatic full conversion after a match (investors/full-paid). Absent: not run (tests, doubles). */
  readonly fullPaid?: { auto(cred: UserCredential, allotmentId: string, signal?: AbortSignal): Promise<FullPaidOutcome> };
}

/** ISO 8601 in Asia/Kolkata (+05:30) — the one clock (rule 9). */
export const istIso = (ms: number): string => `${new Date(ms + 5.5 * 3_600_000).toISOString().slice(0, 19)}+05:30`;
export const istDay = (ms: number): string => new Date(ms + 5.5 * 3_600_000).toISOString().slice(0, 10);
/** The one IST hold function: the calendar day `days` after the IST day of `ms`. */
export function holdUntilFrom(ms: number, days: number = HOLD_DAYS): string {
  return new Date(Date.parse(`${istDay(ms)}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}
/** A stable event id for a fact (a retry re-sends the same id; consumers dedupe on it). RFC 4122 v5 shape. */
export function factEventId(fact: string): string {
  const h = createHash("sha256").update(`growize-console:${fact}`).digest("hex");
  const v = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${v}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

class Unreadable { constructor(readonly ids: readonly string[]) {} }
class SourceFail { constructor(readonly kind: ZohoFailureKind | "unexpected") {} }
const retryableKind = (k: ZohoFailureKind | "unexpected"): boolean =>
  k === "network" || k === "server" || k === "busy" || k === "concurrency-exceeded" || k === "rate-limited-unclassified" || k === "unexpected";
const int = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) ? v : null);

export function createReceiptMatch(deps: MatchDependencies) {
  if (!deps || typeof deps.crm?.getRecord !== "function" || typeof deps.crm?.coql !== "function" || typeof deps.crm?.update !== "function"
    || typeof deps.writes?.paymentStatus !== "function" || typeof deps.authority?.mayMatch !== "function" || typeof deps.publish !== "function"
    || typeof deps.log?.refusal !== "function" || typeof deps.recordIdPrefix !== "string" || !RECORD_PREFIX.test(deps.recordIdPrefix)) {
    throw new TypeError("Matching needs crm.getRecord/coql/update, the allotment receipt writes, the match authority, the publisher, the ops log and the CRM record-id prefix.");
  }
  const { crm, writes, authority, publish, log } = deps;
  const clock = deps.clock ?? Date.now;
  const validId = (v: unknown): v is string => typeof v === "string" && RECORD_ID.test(v) && v.startsWith(deps.recordIdPrefix);
  const idOf = (v: unknown): string | null => {
    const id = v && typeof v === "object" ? (v as { id?: unknown }).id : undefined;
    return validId(id) ? id : null;
  };
  const now = (): number => { try { return clock(); } catch { return 0; } };
  const refuse = (me: string, code: MatchRefusal, ids: readonly unknown[] = []): MatchResult => {
    log.refusal({ at: now(), actor: { kind: "user", userId: me }, action: "receipt-match", reason: code, recordIds: ids.filter(validId) });
    return { ok: false, kind: "refused", reasonCode: code, message: MESSAGE[code], retryable: false };
  };
  const sourceError = (k: ZohoFailureKind | "unexpected"): MatchResult => ({
    ok: false, kind: "source-error", errorKind: k, retryable: retryableKind(k),
    message: retryableKind(k) ? "Not matched yet — Zoho is not answering. Press again; it will not be matched twice." : "Not matched — Zoho refused it.",
  });
  const note = (me: string, reason: string, ids: readonly unknown[]) =>
    log.refusal({ at: now(), actor: { kind: "user", userId: me }, action: "receipt-match", reason, recordIds: ids.filter(validId) });

  const read = async (cred: UserCredential, module: string, id: string, fields: readonly string[], signal?: AbortSignal): Promise<ZohoRecord | null> => {
    const r = await crm.getRecord(cred, module, id, { fields, signal });
    if (!r.ok) {
      if (r.error.kind === "not-found" || r.error.kind === "forbidden") return null;
      throw new SourceFail(r.error.kind);
    }
    if (r.value && r.value.id !== id) throw new Unreadable([id]);
    return r.value;
  };

  /** Matched inbound receipts of the investor, other than this one: [on this allotment Advance count, anywhere count]. */
  async function otherMatched(cred: UserCredential, investorId: string, allotmentId: string, receiptId: string, signal?: AbortSignal) {
    const a = await crm.coql(cred, `select id, Customer from ${ALLOTMENTS_MODULE} where Customer = '${investorId}' limit 0, ${IN_LIMIT}`, { signal });
    if (!a.ok) throw new SourceFail(a.error.kind);
    if (a.value.invalidRecordIds || a.value.moreRecords) throw new Unreadable([investorId]);
    const ids = a.value.records.map((x) => x.id);
    if (ids.some((x) => !validId(x)) || a.value.records.some((x) => idOf(x.Customer) !== investorId)) throw new Unreadable([investorId]);
    if (!ids.includes(allotmentId)) ids.push(allotmentId);
    const r = await crm.coql(cred,
      `select id, Allotment, Kind, Match_State from ${RECEIPTS_MODULE} where Allotment in (${ids.map((x) => `'${x}'`).join(", ")}) limit 0, ${PAGE}`, { signal });
    if (!r.ok) throw new SourceFail(r.error.kind);
    if (r.value.invalidRecordIds || r.value.moreRecords) throw new Unreadable([investorId]);
    let anywhere = 0, advancesHere = 0;
    for (const row of r.value.records) {
      const on = idOf(row.Allotment);
      if (!validId(row.id) || !on || !ids.includes(on) || typeof row.Kind !== "string" || typeof row.Match_State !== "string") throw new Unreadable([row.id]);
      if (row.id === receiptId || row.Match_State !== "Matched" || !INBOUND.has(row.Kind)) continue;
      anywhere++;
      if (on === allotmentId && row.Kind === "Advance") advancesHere++;
    }
    return { anywhere, advancesHere };
  }

  interface Target { readonly id: string; readonly kind: string; readonly amount: number; readonly allotmentId: string; readonly matchedBy: string; readonly matchedAt: number; readonly duplicate: boolean }

  async function consequences(cred: UserCredential, sessionId: string, t: Target, signal?: AbortSignal): Promise<MatchView> {
    const me = cred.userId;
    const inbound = INBOUND.has(t.kind);
    let paymentStatus: PaymentStatusReading | null = null;
    try {
      const ps = await writes.paymentStatus({ credential: cred, sessionId }, t.allotmentId, signal);
      if (ps.ok) {
        paymentStatus = ps.value;
        if (ps.value.mismatch) note(me, "payment-status-mismatch", [t.allotmentId, t.id]);
      }
    } catch { paymentStatus = null; }

    let investorId = "";
    let moneyConfirmed: Published | null = null, accountOpened: Published | null = null, firstMoney = false;
    let appAccess: MatchView["appAccess"] = { ok: true, value: null, code: null };
    let appMark: MatchView["appMark"] = { ok: true, value: null, code: null };
    let hold: MatchView["hold"] = { ok: true, value: null, code: null };
    let holdChanged: Published | null = null;
    const fail = (code: string) => ({ ok: false, value: null, code }) as const;

    let allot: ZohoRecord | null = null;
    try { allot = await read(cred, ALLOTMENTS_MODULE, t.allotmentId, ALLOTMENT_FIELDS, signal); } catch { allot = null; }
    investorId = idOf(allot?.Customer) ?? "";
    if (!allot || !investorId) {
      note(me, "match-consequences-unread", [t.id, t.allotmentId]);
      const skipped = fail("allotment-unread");
      return view(t, investorId, paymentStatus, null, false, null, inbound ? skipped : appAccess, inbound ? skipped : appMark, inbound ? skipped : hold, inbound);
    }

    if (inbound) {
      moneyConfirmed = await safePublish([investorId, t.id], {
        event_id: factEventId(`money.confirmed:${t.id}`), type: "money.confirmed", schema_version: 1, occurred_at: istIso(t.matchedAt),
        actor: { kind: "user", zoho_user_id: t.matchedBy }, ids: { investor_contact_id: investorId },
        payload: { kind: EVENT_KIND[t.kind]!, amount: t.amount, at: istIso(t.matchedAt), matched_by: t.matchedBy, receipt_id: t.id },
        origin: "console",
      });

      let others: { anywhere: number; advancesHere: number } | null = null;
      try { others = await otherMatched(cred, investorId, t.allotmentId, t.id, signal); } catch { others = null; }
      if (!others) {
        appAccess = fail("receipts-unread");
        appMark = fail("receipts-unread");
        hold = fail("receipts-unread");
      } else {
        firstMoney = others.anywhere === 0;
        if (firstMoney) ({ accountOpened, appAccess, appMark } = await openAccount(cred, investorId, t, signal));
        if (t.kind === "Advance" && others.advancesHere === 0 && allot.Allocation_Status === "Reserved") {
          hold = await startHold(cred, allot, t, signal);
          if (hold.ok && hold.value?.written) {
            holdChanged = await safePublish([investorId, t.id],
              holdChangedEvent({ allotmentId: t.allotmentId, investorId, holdDay: hold.value.until, state: "open", at: t.matchedAt, by: t.matchedBy }));
          }
        }
      }
    }
    /* D140: the derived total on the allotment, by its one writer — after the hold (both are guarded writes on the allotment) and
       before the conversion (which re-reads the allotment). Inbound money and refunds alike. */
    let received: ReceivedSync | null = null;
    try { received = await syncReceived(crm, cred, t.allotmentId, signal, log, now); } catch { received = { ok: false, value: null, code: "unexpected" }; }
    /* D137 ruling 3: the remaining amount confirmed by Finance converts the Reserved allotment in full, automatically, on the
       matcher's own token (investors/full-paid auto: Converted_At / _By / _Via = "Finance match"). Reported, never undoing the match. */
    let converted: FullPaidOutcome | null = null;
    if (inbound && deps.fullPaid) {
      try { converted = await deps.fullPaid.auto(cred, t.allotmentId, signal); } catch { converted = { ok: false, value: null, code: "unexpected" }; }
    }
    return view(t, investorId, paymentStatus, moneyConfirmed, firstMoney, accountOpened, appAccess, appMark, hold, inbound, holdChanged, converted, received);
  }

  const view = (t: Target, investorId: string, paymentStatus: PaymentStatusReading | null, moneyConfirmed: Published | null, firstMoney: boolean,
    accountOpened: Published | null, appAccess: MatchView["appAccess"], appMark: MatchView["appMark"], hold: MatchView["hold"], inbound: boolean,
    holdChanged: Published | null = null, converted: FullPaidOutcome | null = null, received: ReceivedSync | null = null): MatchView => Object.freeze({
    receiptId: t.id, state: "matched" as const, duplicate: t.duplicate, matchedBy: t.matchedBy, matchedAt: istIso(t.matchedAt),
    kind: t.kind, amountRupees: t.amount, link: Object.freeze({ allotmentId: t.allotmentId, investorId }),
    gate: inbound ? "opens-through-receipts" as const : "not-money" as const,
    paymentStatus, moneyConfirmed, firstMoney, accountOpened, appAccess, appMark, hold, holdChanged, converted, received,
  });

  /** Publish, and log the delivery result (type + status code + record ids — never the payload). */
  async function safePublish(ids: readonly string[], event: Record<string, unknown>): Promise<Published> {
    let r: Published;
    try { r = await publish(event); } catch { r = { ok: false, reason: "unexpected" }; }
    if (!r.ok) note("system", "event-not-sent", ids);
    const st = r.ok ? (r.state && typeof r.state === "object" && typeof (r.state as { status?: unknown }).status === "string"
      ? (r.state as { status: string }).status : "queued") : "not-sent";
    try {
      log.event?.({ at: now(), actor: { kind: "service", job: "contract-publish" }, action: "contract-publish", reason: `${String(event.type)}.${st}`.toLowerCase().replace(/[^a-z0-9.-]/g, "-"), recordIds: ids.filter(validId) });
    } catch { /* logging never breaks a match */ }
    return r;
  }

  type Opened = { accountOpened: Published | null; appAccess: MatchView["appAccess"]; appMark: MatchView["appMark"] };
  async function openAccount(cred: UserCredential, investorId: string, t: Target, signal?: AbortSignal): Promise<Opened> {
    let c: ZohoRecord | null = null;
    try { c = await read(cred, CONTACTS_MODULE, investorId, CONTACT_FIELDS, signal); } catch { c = null; }
    const unread = { ok: false, value: null, code: "contact-unread" } as const;
    if (!c) return { accountOpened: null, appAccess: unread, appMark: unread };
    const code = typeof c.ARL_ID === "string" && ARL_CODE.test(c.ARL_ID) ? c.ARL_ID : null;
    const accountOpened: Published = code
      ? await safePublish([investorId, t.id], {
        event_id: factEventId(`account.opened:${investorId}`), type: "account.opened", schema_version: 1, occurred_at: istIso(t.matchedAt),
        actor: { kind: "system" }, ids: { investor_contact_id: investorId, arl_code: code },
        payload: { arl_code: code, at: istIso(t.matchedAt), state: "tentative" }, origin: "console",
      })
      : { ok: false, reason: "no-arl-code" };
    const empty = (v: unknown) => v === undefined || v === null || v === "";
    const needAccess = empty(c.App_Access), needMark = empty(c.App_Account_Mark);
    const setAlready = { ok: true, value: "already-set", code: null } as const;
    if (!needAccess && !needMark) return { accountOpened, appAccess: setAlready, appMark: setAlready };
    const mt = typeof c.Modified_Time === "string" && ZDT.test(c.Modified_Time) ? c.Modified_Time : null;
    if (!mt) return { accountOpened, appAccess: needAccess ? unread : setAlready, appMark: needMark ? unread : setAlready };
    const fields: { [field: string]: string } = {};
    if (needAccess) fields.App_Access = "Hold";
    if (needMark) { fields.App_Account_Mark = "Tentative"; fields.App_Mark_At = istIso(t.matchedAt); }
    let w = await crm.update(cred, CONTACTS_MODULE, investorId, fields, { ifUnmodifiedSince: mt, signal });
    let markLeft = false;
    if (!w.ok && needMark && w.error.kind === "invalid-data") {
      const e = w.error;
      const names = [e.field, ...(e.records ?? []).map((r) => r.field)].filter((x): x is string => typeof x === "string");
      if (names.some((f) => MARK_FIELDS.has(f))) {
        markLeft = true;
        note(cred.userId, "app-mark-left-to-zoho", [investorId, t.id]);
        if (needAccess) w = await crm.update(cred, CONTACTS_MODULE, investorId, { App_Access: "Hold" }, { ifUnmodifiedSince: mt, signal });
      }
    }
    if (markLeft && !needAccess) return { accountOpened, appAccess: setAlready, appMark: { ok: true, value: "left-to-zoho", code: null } };
    if (!w.ok) {
      note(cred.userId, "app-access-not-opened", [investorId, t.id]);
      const failed = { ok: false, value: null, code: w.error.kind === "conflict" ? "contact-changed" : w.error.kind } as const;
      return { accountOpened, appAccess: needAccess ? failed : setAlready, appMark: markLeft ? { ok: true, value: "left-to-zoho", code: null } : needMark ? failed : setAlready };
    }
    return {
      accountOpened,
      appAccess: needAccess ? { ok: true, value: "opened-on-hold", code: null } : setAlready,
      appMark: markLeft ? { ok: true, value: "left-to-zoho", code: null } : needMark ? { ok: true, value: "tentative-set", code: null } : setAlready,
    };
  }

  async function startHold(cred: UserCredential, allot: ZohoRecord, t: Target, signal?: AbortSignal): Promise<MatchView["hold"]> {
    // M11-S02 AC1: an allotment missing its Customer or LLP is not written to at all; the match itself stands.
    if (missingLinks(allot.Customer, allot.LLP).length) {
      note(cred.userId, "hold-not-started", [allot.id, t.id]);
      return { ok: false, value: null, code: ALLOTMENT_UNLINKED };
    }
    const until = holdUntilFrom(t.matchedAt);
    const current = typeof allot.Hold_Until === "string" && DAY.test(allot.Hold_Until.slice(0, 10)) ? allot.Hold_Until.slice(0, 10) : null;
    if (current !== null && current >= until) return { ok: true, value: { until: current, written: false }, code: null };
    const mt = typeof allot.Modified_Time === "string" && ZDT.test(allot.Modified_Time) ? allot.Modified_Time : null;
    if (!mt) return { ok: false, value: null, code: "allotment-unread" };
    const w = await crm.update(cred, ALLOTMENTS_MODULE, allot.id, { Hold_Until: until }, { ifUnmodifiedSince: mt, signal });
    if (!w.ok) {
      note(cred.userId, "hold-not-started", [allot.id, t.id]);
      return { ok: false, value: null, code: w.error.kind === "conflict" ? "allotment-changed" : w.error.kind };
    }
    return { ok: true, value: { until, written: true }, code: null };
  }

  return Object.freeze({
    /** "Match it": Finance confirms a pending receipt (a refund: the second hand). body: { expectedModifiedTime? } (the row as the page loaded it). */
    async match(principal: unknown, receiptId: unknown, body?: unknown, signal?: AbortSignal): Promise<MatchResult> {
      const p = principal && typeof principal === "object" ? (principal as { credential?: unknown; sessionId?: unknown }) : null;
      if (!p || !isUserCredential(p.credential) || typeof p.sessionId !== "string" || !SESSION_ID.test(p.sessionId)) return refuse("unrecognised", "invalid-request");
      const cred = p.credential, sessionId = p.sessionId, me = cred.userId;
      if (!validId(receiptId)) return refuse(me, "invalid-request");
      const b = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
      const expected = b.expectedModifiedTime === undefined || b.expectedModifiedTime === null || b.expectedModifiedTime === "" ? null : b.expectedModifiedTime;
      if (expected !== null && (typeof expected !== "string" || !ZDT.test(expected))) return refuse(me, "invalid-request", [receiptId]);
      let allowed = false;
      try { allowed = (await authority.mayMatch(cred, sessionId, signal)) === true; } catch { allowed = false; }
      if (!allowed) return refuse(me, "not-matcher", [receiptId]);

      let rec: ZohoRecord | null, allot: ZohoRecord | null;
      try {
        rec = await read(cred, RECEIPTS_MODULE, receiptId, RECEIPT_FIELDS, signal);
        if (!rec) return refuse(me, "not-visible", [receiptId]);
        const allotmentId = idOf(rec.Allotment), amount = int(rec.Amount), recorder = idOf(rec.Created_By);
        if (!allotmentId || amount === null || amount <= 0 || typeof rec.Kind !== "string" || !KINDS.has(rec.Kind)
          || typeof rec.Match_State !== "string" || !STATES.has(rec.Match_State) || !recorder
          || typeof rec.Modified_Time !== "string" || !ZDT.test(rec.Modified_Time)) return refuse(me, "source-invalid", [receiptId]);
        if (rec.Match_State === "Claimed") return refuse(me, "is-claim", [receiptId]);
        if (rec.Match_State === "Matched") {
          const by = idOf(rec.Matched_By) ?? (rec.Matched_By && typeof rec.Matched_By === "object" ? String((rec.Matched_By as { id?: unknown }).id ?? "") : "");
          if (!by) return refuse(me, "source-invalid", [receiptId]);
          const at = Date.parse(rec.Modified_Time);
          return { ok: true, value: await consequences(cred, sessionId, { id: receiptId, kind: rec.Kind, amount, allotmentId, matchedBy: by, matchedAt: at, duplicate: true }, signal) };
        }
        if (rec.Match_State !== "Pending") return refuse(me, "not-pending", [receiptId]);
        if (!INBOUND.has(rec.Kind)) {               // money leaving: D22's second hand
          let approver = true;
          if (authority.mayApproveOutbound) {
            try { approver = (await authority.mayApproveOutbound(cred, sessionId, signal)) === true; } catch { approver = false; }
          }
          if (!approver) return refuse(me, "not-approver", [receiptId]);
          if (recorder === me) return refuse(me, "same-hand", [receiptId]);
          if (authority.stepUpOutbound) {
            let su: "ok" | "step-up" | "locked" = "step-up";
            try { su = await authority.stepUpOutbound(sessionId); } catch { su = "step-up"; }
            if (su === "locked") return refuse(me, "step-up-locked", [receiptId]);
            if (su !== "ok") return refuse(me, "step-up", [receiptId]);
          }
        }
        if (expected !== null && expected !== rec.Modified_Time) return refuse(me, "receipt-changed", [receiptId]);
        allot = await read(cred, ALLOTMENTS_MODULE, allotmentId, ALLOTMENT_FIELDS, signal);
        if (!allot) return refuse(me, "not-visible", [receiptId, allotmentId]);
        if (INBOUND.has(rec.Kind)) {
          if (allot.Allocation_Status === "Cancelled") return refuse(me, "allotment-cancelled", [receiptId, allotmentId]);
          const v = allot.Supplementary_Verified_At;
          if (v === undefined || v === null || v === "") return refuse(me, "supplementary-not-verified", [receiptId, allotmentId]);
        }
      } catch (e) {
        if (e instanceof Unreadable) return refuse(me, "source-invalid", e.ids);
        if (e instanceof SourceFail) return sourceError(e.kind);
        return sourceError("unexpected");
      }

      /* D137 ruling 2(a): the match's date-time goes on the receipt (Receipts.Matched_At) so the 10% trail can say when. An org
         without the field refuses it as invalid-data naming it: the match is then written without it, never refused for it. */
      const atWrite = now();
      let w = await crm.update(cred, RECEIPTS_MODULE, receiptId, { Match_State: "Matched", Matched_By: { id: me }, [MATCHED_AT_FIELD]: istIso(atWrite) },
        { ifUnmodifiedSince: rec.Modified_Time as string, signal });
      if (!w.ok && w.error.kind === "invalid-data" && (w.error.field === MATCHED_AT_FIELD || w.error.records?.some((r) => r.field === MATCHED_AT_FIELD))) {
        w = await crm.update(cred, RECEIPTS_MODULE, receiptId, { Match_State: "Matched", Matched_By: { id: me } },
          { ifUnmodifiedSince: rec.Modified_Time as string, signal });
      }
      if (!w.ok) {
        const e = w.error;
        if (e.kind === "conflict") return refuse(me, "receipt-changed", [receiptId]);
        // A Zoho validation rule naming Matched_By (M10-S02-T01): the refund's second hand, or — on inbound money — the old two-person rule.
        if (e.kind === "invalid-data" && (e.field === "Matched_By" || e.records?.some((r) => r.field === "Matched_By"))) {
          return refuse(me, INBOUND.has(rec.Kind as string) ? "zoho-same-hand-rule" : "same-hand", [receiptId]);
        }
        if (e.kind === "invalid-data") return refuse(me, "source-invalid", [receiptId]);
        return sourceError(e.kind);
      }
      const at = atWrite;
      return { ok: true, value: await consequences(cred, sessionId, {
        id: receiptId, kind: rec.Kind as string, amount: rec.Amount as number, allotmentId: idOf(rec.Allotment)!, matchedBy: me, matchedAt: at, duplicate: false,
      }, signal) };
    },
  });
}
export type ReceiptMatch = ReturnType<typeof createReceiptMatch>;
