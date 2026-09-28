/**
 * M10-S02-T02 — "Match it": the second hand, and what a match sets moving (D10, D19, D21, D22, D70, D73).
 *
 * Recording is free; matching is the gated act (D21 / CLAUDE.md rule 3). This is the only console path that
 * moves a receipt to Matched, and it keeps the maker-checker rule on the server, whatever the front end shows:
 *   - who: the Head of Finance or the super user (lib/im/money.ts `mayMatch`), checked fresh on the live session;
 *   - never the same hand: Created_By (the recorder — record-receipt.ts writes on the recorder's own token, D53)
 *     must not be the matcher. Zoho's validation rule (M10-S02-T01, Sahil) refuses the same PUT again; its
 *     refusal naming Matched_By is answered with the same words;
 *   - only a Pending receipt is matched. A Claimed row is an IR's report, answered through claim-answer.ts;
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
 *   4. the investor's FIRST matched inbound money: account.opened { arl_code, at, state: tentative } (D10), and
 *      Contacts.App_Access empty → Hold with one guarded write (PROVISIONAL, Jev 0.54) — Hold/Invite once set are
 *      never touched (server/investors/unlock.ts owns them);
 *   5. the first matched Advance of a Reserved allotment starts the hold 30 days out (Asia/Kolkata): Hold_Until =
 *      match day + 30, written only when empty or earlier — never shortening a hold (PROVISIONAL, Jev 0.56).
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

export const CONTACTS_MODULE = "Contacts";
export const HOLD_DAYS = 30;
export const SAME_HAND_TEXT = "A receipt is matched by someone other than the person who recorded it — you recorded this one, so the Head of Finance matches it.";
export const NOT_MATCHER_TEXT = "Waiting for the Head of Finance. A receipt is matched by someone other than the person who recorded it.";
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
const ALLOTMENT_FIELDS = Object.freeze(["Allocation_Status", "Customer", "Hold_Until", "Supplementary_Verified_At", "Modified_Time"]);
const CONTACT_FIELDS = Object.freeze(["ARL_ID", "App_Access", "Modified_Time"]);

export type MatchRefusal =
  | "invalid-request" | "not-matcher" | "not-visible" | "is-claim" | "not-pending" | "same-hand" | "receipt-changed"
  | "supplementary-not-verified" | "allotment-cancelled" | "source-invalid";

const MESSAGE: Readonly<Record<MatchRefusal, string>> = Object.freeze({
  "invalid-request": "Not matched — reload the page and try again.",
  "not-matcher": NOT_MATCHER_TEXT,
  "not-visible": "This receipt is not available to you.",
  "is-claim": "This is an IR's report, not a receipt. Answer it from the report.",
  "not-pending": "Only a pending receipt can be matched.",
  "same-hand": SAME_HAND_TEXT,
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
  readonly appAccess: Consequence<"opened-on-hold" | "already-set">;
  readonly hold: Consequence<{ readonly until: string; readonly written: boolean }>;
}

export type MatchResult =
  | { readonly ok: true; readonly value: MatchView }
  | { readonly ok: false; readonly kind: "refused"; readonly reasonCode: MatchRefusal; readonly message: string; readonly retryable: false }
  | { readonly ok: false; readonly kind: "source-error"; readonly errorKind: ZohoFailureKind | "unexpected"; readonly message: string; readonly retryable: boolean };

export interface MatchAuthority {
  /** Fresh check on the live session: is this person the Head of Finance or the super user? */
  mayMatch(credential: UserCredential, sessionId: string, signal?: AbortSignal): Promise<boolean>;
}

export interface MatchDependencies {
  readonly crm: Pick<ZohoClient, "getRecord" | "coql" | "update">;
  readonly writes: Pick<AllotmentReceiptWrites, "paymentStatus">;
  readonly authority: MatchAuthority;
  readonly publish: Publish;
  readonly log: OpsLog;
  readonly recordIdPrefix: string;
  readonly clock?: () => number;
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
    let hold: MatchView["hold"] = { ok: true, value: null, code: null };
    const fail = (code: string) => ({ ok: false, value: null, code }) as const;

    let allot: ZohoRecord | null = null;
    try { allot = await read(cred, ALLOTMENTS_MODULE, t.allotmentId, ALLOTMENT_FIELDS, signal); } catch { allot = null; }
    investorId = idOf(allot?.Customer) ?? "";
    if (!allot || !investorId) {
      note(me, "match-consequences-unread", [t.id, t.allotmentId]);
      const skipped = fail("allotment-unread");
      return view(t, investorId, paymentStatus, null, false, null, inbound ? skipped : appAccess, inbound ? skipped : hold, inbound);
    }

    if (inbound) {
      moneyConfirmed = await safePublish({
        event_id: factEventId(`money.confirmed:${t.id}`), type: "money.confirmed", schema_version: 1, occurred_at: istIso(t.matchedAt),
        actor: { kind: "user", zoho_user_id: t.matchedBy }, ids: { investor_contact_id: investorId },
        payload: { kind: EVENT_KIND[t.kind]!, amount: t.amount, at: istIso(t.matchedAt), matched_by: t.matchedBy, receipt_id: t.id },
        origin: "console",
      });

      let others: { anywhere: number; advancesHere: number } | null = null;
      try { others = await otherMatched(cred, investorId, t.allotmentId, t.id, signal); } catch { others = null; }
      if (!others) {
        appAccess = fail("receipts-unread");
        hold = fail("receipts-unread");
      } else {
        firstMoney = others.anywhere === 0;
        if (firstMoney) ({ accountOpened, appAccess } = await openAccount(cred, investorId, t, signal));
        if (t.kind === "Advance" && others.advancesHere === 0 && allot.Allocation_Status === "Reserved") hold = await startHold(cred, allot, t, signal);
      }
    }
    return view(t, investorId, paymentStatus, moneyConfirmed, firstMoney, accountOpened, appAccess, hold, inbound);
  }

  const view = (t: Target, investorId: string, paymentStatus: PaymentStatusReading | null, moneyConfirmed: Published | null, firstMoney: boolean,
    accountOpened: Published | null, appAccess: MatchView["appAccess"], hold: MatchView["hold"], inbound: boolean): MatchView => Object.freeze({
    receiptId: t.id, state: "matched" as const, duplicate: t.duplicate, matchedBy: t.matchedBy, matchedAt: istIso(t.matchedAt),
    kind: t.kind, amountRupees: t.amount, link: Object.freeze({ allotmentId: t.allotmentId, investorId }),
    gate: inbound ? "opens-through-receipts" as const : "not-money" as const,
    paymentStatus, moneyConfirmed, firstMoney, accountOpened, appAccess, hold,
  });

  async function safePublish(event: Record<string, unknown>): Promise<Published> {
    try {
      const r = await publish(event);
      if (!r.ok) note("system", "event-not-sent", []);
      return r;
    } catch { return { ok: false, reason: "unexpected" }; }
  }

  async function openAccount(cred: UserCredential, investorId: string, t: Target, signal?: AbortSignal) {
    let c: ZohoRecord | null = null;
    try { c = await read(cred, CONTACTS_MODULE, investorId, CONTACT_FIELDS, signal); } catch { c = null; }
    if (!c) return { accountOpened: null, appAccess: { ok: false, value: null, code: "contact-unread" } as MatchView["appAccess"] };
    const code = typeof c.ARL_ID === "string" && ARL_CODE.test(c.ARL_ID) ? c.ARL_ID : null;
    const accountOpened: Published = code
      ? await safePublish({
        event_id: factEventId(`account.opened:${investorId}`), type: "account.opened", schema_version: 1, occurred_at: istIso(t.matchedAt),
        actor: { kind: "system" }, ids: { investor_contact_id: investorId, arl_code: code },
        payload: { arl_code: code, at: istIso(t.matchedAt), state: "tentative" }, origin: "console",
      })
      : { ok: false, reason: "no-arl-code" };
    const access = c.App_Access;
    if (access !== undefined && access !== null && access !== "") {
      return { accountOpened, appAccess: { ok: true, value: "already-set", code: null } as MatchView["appAccess"] };
    }
    const mt = typeof c.Modified_Time === "string" && ZDT.test(c.Modified_Time) ? c.Modified_Time : null;
    if (!mt) return { accountOpened, appAccess: { ok: false, value: null, code: "contact-unread" } as MatchView["appAccess"] };
    const w = await crm.update(cred, CONTACTS_MODULE, investorId, { App_Access: "Hold" }, { ifUnmodifiedSince: mt, signal });
    if (!w.ok) {
      note(cred.userId, "app-access-not-opened", [investorId, t.id]);
      return { accountOpened, appAccess: { ok: false, value: null, code: w.error.kind === "conflict" ? "contact-changed" : w.error.kind } as MatchView["appAccess"] };
    }
    return { accountOpened, appAccess: { ok: true, value: "opened-on-hold", code: null } as MatchView["appAccess"] };
  }

  async function startHold(cred: UserCredential, allot: ZohoRecord, t: Target, signal?: AbortSignal): Promise<MatchView["hold"]> {
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
    /** "Match it": the second hand confirms a pending receipt. body: { expectedModifiedTime? } (the row as the page loaded it). */
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
        if (recorder === me) return refuse(me, "same-hand", [receiptId]);
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

      const w = await crm.update(cred, RECEIPTS_MODULE, receiptId, { Match_State: "Matched", Matched_By: { id: me } },
        { ifUnmodifiedSince: rec.Modified_Time as string, signal });
      if (!w.ok) {
        const e = w.error;
        if (e.kind === "conflict") return refuse(me, "receipt-changed", [receiptId]);
        // Zoho's maker-checker validation rule (M10-S02-T01) names Matched_By.
        if (e.kind === "invalid-data" && (e.field === "Matched_By" || e.records?.some((r) => r.field === "Matched_By"))) return refuse(me, "same-hand", [receiptId]);
        if (e.kind === "invalid-data") return refuse(me, "source-invalid", [receiptId]);
        return sourceError(e.kind);
      }
      const at = now();
      return { ok: true, value: await consequences(cred, sessionId, {
        id: receiptId, kind: rec.Kind as string, amount: rec.Amount as number, allotmentId: idOf(rec.Allotment)!, matchedBy: me, matchedAt: at, duplicate: false,
      }, signal) };
    },
  });
}
export type ReceiptMatch = ReturnType<typeof createReceiptMatch>;
