/**
 * M08-S03-T01 — "the investor says they have paid": the IR's payment report, written to Zoho (D09, D21, D45, D82).
 *
 * D82: there is no Payment_Claims module. A report is a Receipts record with Match_State = "Claimed" — money the
 * investor says they sent that Finance has not yet found in the bank. The gates (gates.ts) already read Claimed
 * as "waiting on Finance", so the row reads "Waiting on Finance" and the stage does not move: nothing here writes
 * the lead, Lead_Status or a stage stamp (the blueprint owns those).
 *
 *   POST /api/leads/[id]/claim  { kind, mode, amount, said_on, ref?, note?, allotmentId? }
 *
 * The rules, in order:
 *   1. the draft passes the front end's own `claimFieldsError` (lib/selectors/claims.ts — imported, not re-ported),
 *      judged against today in IST; the ledger keeps whole rupees (D81, receipt-replay.ts), so paise are refused;
 *   2. the person may report on this lead (leads edit, via the injected authority) and the lead is in their book —
 *      gates.read() re-checks the session, the book and cover on their own token (D53);
 *   3. the lead is said-yes or reserved, not lost, not fully paid, the supplementary is verified (claims.ts
 *      `canClaim`/`claimWhy`), and no report is already waiting (one open claim per lead);
 *   4. the claim is written against the investor's one live allotment (Contact and LLP follow from it); with more
 *      than one live allotment the draft names it.
 *
 * The claim key. Receipts.UTR is unique, and receipt-replay.ts reads a valid UTR on every receipt of an allotment
 * (Claimed ones included). The IR's reference is NOT a confirmed bank reference, so it never goes into UTR — the
 * real UTR is Finance's to enter when they record the receipt. UTR holds a claim key, `CLAIM-<leadId>-<n>`
 * (PROVISIONAL, Jev 0.73): unique in Zoho, so a double press or a lost response that races past the in-process
 * guard is refused by Zoho as DUPLICATE_DATA and recovered by reading the key back — exactly one record.
 * The IR's reference is masked (last four only) wherever it is kept or returned; the full value is never stored,
 * logged or answered. Logs carry ids and codes only.
 */

import type { UserCredential, ZohoClient, ZohoFields, ZohoPage, ZohoRecord } from "../../lib/zoho/client";
import { isUserCredential } from "../../lib/zoho/client";
import type { ZohoFailureKind } from "../../lib/zoho/errors";
import type { OpsLog } from "../../lib/zoho/log";
import { claimFieldsError, type ClaimDraft } from "../../lib/selectors/claims";
import type { Ctx } from "../../lib/selectors/ctx";
import { ALLOTMENTS_MODULE, RECEIPTS_MODULE } from "../money/receipt-replay";
import { createIdempotency } from "../state/idempotent";
import { createMemoryState } from "../state/memory";
import type { SharedState } from "../state/shared-state";
import { ANSWERED_STATE, FOUND_TITLE, NOT_FOUND_TITLE, notFoundText } from "../money/claim-answer";
import type { Gates, GateResult } from "./gates";
import { readClaimLines, type IrClaimLine } from "./claim-lines";

export const CLAIM_KEY_PREFIX = "CLAIM-";
export const CLAIM_STATE = "Claimed";
export const CLAIM_WAITING_TEXT = "Payment reported — waiting for Finance to find it in the bank.";
export const CLAIM_ROW_TEXT = "Waiting on Finance";

/** What a report is for (claims.ts CLAIMKINDS) → Receipts.Kind. "Part" is the live name of D70's Balance. */
const KIND_TO_ZOHO: Readonly<Record<string, "Advance" | "Part" | "Full">> = Object.freeze({
  advance: "Advance", balance: "Part", full: "Full", other: "Part",
});

const SESSION_ID = /^[A-Za-z0-9_-]{16,128}$/;
const RECORD_ID = /^\d{15,22}$/;
const RECORD_PREFIX = /^\d{6,16}$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const KEY_SEQ = /^CLAIM-(\d{15,22})-(\d{1,4})$/;
const MAX_NOTE = 1_000;
/**
 * B-06 (owner ruling, 8 Oct 2026): an IR may create and view only their OWN Receipts rows — their payment reports.
 * "Own" is Zoho's: Receipts sharing is Private, so the IR's token returns only the rows the IR owns. What the IR may
 * read of those rows is Zoho's field-level security, and COQL refuses a whole query (INVALID_QUERY → invalid-data) if
 * any field it selects or filters on is hidden. So:
 *   - the lead page's read (`read`) selects only id, UTR (the claim key it filters on) and Match_State (the state) —
 *     never the allotment, money, Matched_By, Reversal_Of or Idempotency_Key fields;
 *   - the report (`report`) also reads back what it wrote (Allotment, Kind, Amount, Mode, Received_On) to recognise a
 *     double press — the fields the IR writes on create, and so must hold Read/Write on.
 * Zoho config (HUMAN; not yet in zoho/access/spec.json, whose receipt_money group still hides these from IR per D69):
 * IR and IR Manager field permissions on Receipts — Read/Write: UTR, Match_State, Kind, Amount, Mode, Received_On,
 * Allotment, Note; hidden: Matched_By, Reversal_Of, Idempotency_Key. Module: View + Create only (no Edit, so a report
 * cannot be changed after it is sent). A validation rule must hold an IR's create to Match_State = Claimed and a
 * UTR starting CLAIM- (rule 3: an IR records a report, never matched money).
 */
export const CLAIM_READ_FIELDS = "id, UTR, Match_State";
const CLAIM_REPORT_FIELDS = "id, UTR, Allotment, Kind, Amount, Mode, Received_On, Match_State";
const MAX_LIVE_ALLOTMENTS = 100;

export type ClaimRefusal =
  | "invalid-request" | "fields" | "whole-rupees" | "capability-missing" | "session-changed" | "not-visible" | "not-in-book"
  | "source-invalid" | "lost" | "not-converted" | "already-paid" | "supplementary-not-verified" | "already-waiting"
  | "no-allotment" | "allotment-required" | "in-progress";

export interface ClaimView {
  readonly leadId: string;
  readonly claimId: string;
  readonly allotmentId: string;
  readonly state: "waiting";
  readonly kind: string;
  readonly mode: string;
  readonly amountRupees: number;
  readonly saidOn: string;
  /** The IR's reference, masked (last four) — never the full value. null when none was given. */
  readonly ref: string | null;
  readonly says: typeof CLAIM_WAITING_TEXT;
  readonly row: typeof CLAIM_ROW_TEXT;
  /** true when this answer is the earlier press's record (double press, retry). */
  readonly duplicate: boolean;
}

export type ClaimResult =
  | { readonly ok: true; readonly value: ClaimView }
  | { readonly ok: false; readonly kind: "refused"; readonly reasonCode: ClaimRefusal; readonly message: string; readonly retryable: false }
  | { readonly ok: false; readonly kind: "source-error"; readonly errorKind: ZohoFailureKind | "unexpected"; readonly message: string; readonly retryable: boolean }
  | { readonly ok: false; readonly kind: "unknown-outcome"; readonly message: string; readonly retryable: true };

/** The lead page's read of the latest report: still waiting, or answered (found / not found, with Finance's words). */
export interface ClaimStateView {
  readonly leadId: string;
  readonly claimId: string | null;
  readonly state: "none" | "waiting" | "answered";
  /** Only for an answered report: Finance found the money, or did not. null when answered but the Note is unreadable. */
  readonly answer: "found" | "not-found" | null;
  /** Finance's reason (not-found only). */
  readonly reason: string | null;
  /** The sentence for the page: "Finance did not find it: <reason>" for not-found, else null. */
  readonly says: string | null;
  /** D139: all of the IR's own reports on this lead, newest first — state (pending / matched / rejected), amount, the date said, the day Finance answered. */
  readonly claims: readonly IrClaimLine[];
}

export interface ClaimAuthority {
  /** Fresh check: may this live session report money on leads (leads edit, or assign)? */
  mayReport(credential: UserCredential, sessionId: string, signal?: AbortSignal): Promise<boolean>;
}

export interface PaymentClaimDependencies {
  readonly crm: Pick<ZohoClient, "coql" | "insert"> & Partial<Pick<ZohoClient, "getRelated">>;
  readonly gates: Pick<Gates, "read">;
  readonly authority: ClaimAuthority;
  readonly log: OpsLog;
  readonly recordIdPrefix: string;
  readonly clock?: () => number;
  /** Where the double-press guard and the one-report-per-lead lock live (runtime: sharedState()); default this process only. */
  readonly state?: SharedState;
}

const CLAIM_PRESS_TTL_S = 60;
const CLAIM_LEAD_LOCK_S = 120;

const MESSAGE: Readonly<Record<ClaimRefusal, string>> = Object.freeze({
  "invalid-request": "Not saved yet — reload the page and try again.",
  fields: "Not saved yet — check the report.",
  "whole-rupees": "Enter the amount in whole rupees.",
  "capability-missing": "This is not yours to send — the lead's own owner reports money on it.",
  "session-changed": "Not saved yet — sign in again.",
  "not-visible": "This lead is not available to you.",
  "not-in-book": "This is not yours to send — the lead's own owner reports money on it.",
  "source-invalid": "Not saved yet — Zoho returned something the console cannot read. Digital Infrastructure has been told.",
  lost: "This lead is closed as lost. Reopen it before reporting a payment.",
  "not-converted": "The investor has not said yes yet, so there is no money to report.",
  "already-paid": "Finance has already banked this one — there is nothing left to tell them.",
  "supplementary-not-verified": "The supplementary agreement is not signed and verified yet.",
  "already-waiting": "Finance already has this one. What you told them is on the record above, and they answer it there.",
  "no-allotment": "There is no reserved farm on this investor yet, so there is nothing to report money against.",
  "allotment-required": "Choose which farm the payment was for.",
  "in-progress": "Not saved yet — the same report is still being saved. Wait a moment.",
});

/** Last four characters behind a mask; the full reference never leaves this function's caller. */
export function maskRef(ref: string | null | undefined): string | null {
  const r = String(ref ?? "").replace(/\s+/g, "").toUpperCase();
  if (!r) return null;
  return "••••" + (r.length > 4 ? r.slice(-4) : "");
}

const istDate = (ms: number): string => new Date(ms + 5.5 * 3_600_000).toISOString().slice(0, 10);
const leap = (y: number): boolean => y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
function validDate(s: string): boolean {
  const m = ISO_DATE.exec(s);
  if (!m) return false;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const days = [31, leap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return y >= 2000 && mo >= 1 && mo <= 12 && d >= 1 && d <= days[mo - 1]!;
}

/** claims.ts judges "today" with local Date getters; hand it a Date whose local calendar day is today in IST. */
function ctxFor(nowMs: number): Ctx {
  const [y, m, d] = istDate(nowMs).split("-").map(Number) as [number, number, number];
  return { NOW: new Date(y, m - 1, d, 12, 0, 0) } as unknown as Ctx;
}

interface Draft {
  readonly kind: string; readonly zohoKind: "Advance" | "Part" | "Full"; readonly mode: string;
  readonly amountRupees: number; readonly saidOn: string; readonly ref: string | null; readonly note: string;
  readonly allotmentId: string | null;
}

const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : "");

export function createPaymentClaims(deps: PaymentClaimDependencies) {
  if (!deps || typeof deps.crm?.coql !== "function" || typeof deps.crm?.insert !== "function" || typeof deps.gates?.read !== "function"
    || typeof deps.authority?.mayReport !== "function" || typeof deps.log?.refusal !== "function"
    || typeof deps.recordIdPrefix !== "string" || !RECORD_PREFIX.test(deps.recordIdPrefix)) {
    throw new TypeError("Payment claims need crm.coql/insert, the gates, the claim authority, the ops log and the CRM record-id prefix.");
  }
  const { crm, gates, authority, log } = deps;
  const clock = deps.clock ?? Date.now;
  const validId = (v: unknown): v is string => typeof v === "string" && RECORD_ID.test(v) && v.startsWith(deps.recordIdPrefix);
  const idOf = (v: unknown): string | null => {
    const id = v && typeof v === "object" ? (v as { id?: unknown }).id : undefined;
    return validId(id) ? id : null;
  };
  const state = deps.state ?? createMemoryState({ clock });
  // The double press (../state/idempotent): scoped to lead + report, so the same report joins/replays on any
  // instance within a minute (an identical report a minute later is a new report). Only a success is kept; the
  // stored answer carries no reference (the masked last four is put back from the replayed press).
  const presses = createIdempotency<ClaimResult>({
    state, ns: "payment-claim", ttlSeconds: CLAIM_PRESS_TTL_S, clock,
    keep: (r) => r.ok,
    save: (r) => JSON.stringify(r.ok ? { ...r, value: { ...r.value, ref: null } } : r),
    load: (s) => { try { return JSON.parse(s) as ClaimResult; } catch { return null; } },
  });

  const refuse = (me: string, code: ClaimRefusal, ids: readonly unknown[] = [], message?: string): ClaimResult => {
    let at = 0;
    try { at = clock(); } catch { /* the refusal stands */ }
    log.refusal({ at, actor: { kind: "user", userId: me }, action: "payment-claim", reason: code, recordIds: ids.filter(validId) });
    return { ok: false, kind: "refused", reasonCode: code, message: message ?? MESSAGE[code], retryable: false };
  };
  const failed = (k: ZohoFailureKind | "unexpected", message: string): ClaimResult => ({
    ok: false, kind: "source-error", errorKind: k, message,
    retryable: k === "network" || k === "server" || k === "busy" || k === "concurrency-exceeded" || k === "rate-limited-unclassified" || k === "unexpected",
  });
  const sourceError = (k: ZohoFailureKind | "unexpected"): ClaimResult => failed(k, k === "forbidden"
    ? "Not saved — your Zoho profile cannot save payment reports. Tell Digital Infrastructure."
    : k === "invalid-data"
      ? "Not saved — your Zoho profile cannot see the payment report's fields. Tell Digital Infrastructure."
      : "Not saved yet — Zoho is not answering. Try again.");
  /** A READ's failure (B-06b): never "Not saved", and a refusal is said as one, not as an outage. */
  const readError = (k: ZohoFailureKind | "unexpected"): ClaimResult => failed(k, k === "forbidden"
    ? "Payment reports can't be read for this lead yet — your Zoho profile cannot see them. Tell Digital Infrastructure."
    : k === "invalid-data"
      // B-06: COQL's INVALID_QUERY — a report field (the claim key or its state) is hidden from this profile. A refusal, not an outage.
      ? "Payment reports can't be read for this lead yet — your Zoho profile cannot see the report's fields. Tell Digital Infrastructure."
      : "Zoho is not answering. Try again.");

  /** Rule 1: the front end's own check, then whole rupees. */
  function parseDraft(me: string, body: unknown): Draft | ClaimResult {
    const b = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
    if (!b) return refuse(me, "invalid-request");
    const draft: ClaimDraft = {
      kind: str(b.kind), mode: str(b.mode), amount: typeof b.amount === "number" ? b.amount : str(b.amount),
      said_on: str(b.said_on), ref: str(b.ref), note: str(b.note),
    };
    const err = claimFieldsError(ctxFor(clock()), draft);
    if (err) return refuse(me, "fields", [], err);
    if (!validDate(draft.said_on)) return refuse(me, "fields", [], "Choose the actual payment date, today or earlier.");
    const amount = Number(String(draft.amount).trim());
    if (!Number.isSafeInteger(amount)) return refuse(me, "whole-rupees");
    const zohoKind = KIND_TO_ZOHO[draft.kind];
    if (!zohoKind) return refuse(me, "fields", [], "Choose what the payment was for.");
    const note = String(draft.note ?? "").trim();
    if (note.length > MAX_NOTE) return refuse(me, "fields", [], "Keep the note within 1,000 characters.");
    const allotmentId = b.allotmentId === undefined || b.allotmentId === null || b.allotmentId === "" ? null : b.allotmentId;
    if (allotmentId !== null && !validId(allotmentId)) return refuse(me, "invalid-request");
    const ref = String(draft.ref ?? "").trim();
    return { kind: draft.kind, zohoKind, mode: draft.mode, amountRupees: amount, saidOn: draft.said_on, ref: ref || null, note, allotmentId };
  }

  type Read = { readonly fail: ZohoFailureKind } | { readonly invalid: true } | { readonly page: ZohoPage };
  const coql = async (cred: UserCredential, q: string, signal?: AbortSignal): Promise<Read> => {
    const r = await crm.coql(cred, q, { signal });
    if (!r.ok) return { fail: r.error.kind };
    if (r.value.invalidRecordIds) return { invalid: true };
    return { page: r.value };
  };

  /** Rule 4: the investor's live allotments (Contact from the lead, allotments from the Contact). */
  async function liveAllotments(cred: UserCredential, leadId: string, signal?: AbortSignal): Promise<readonly string[] | { fail: ZohoFailureKind } | "invalid"> {
    const c = await coql(cred, `select id, Origin_Lead from Contacts where Origin_Lead = '${leadId}' limit 0, 2`, signal);
    if ("fail" in c) return { fail: c.fail };
    if ("invalid" in c) return "invalid";
    if (c.page.records.length === 0) return [];
    const contact = c.page.records[0]!;
    if (c.page.records.length > 1 || !validId(contact.id) || idOf(contact.Origin_Lead) !== leadId) return "invalid";
    const a = await coql(cred, `select id, Customer, Allocation_Status from ${ALLOTMENTS_MODULE} where Customer = '${contact.id}' limit 0, ${MAX_LIVE_ALLOTMENTS}`, signal);
    if ("fail" in a) return { fail: a.fail };
    if ("invalid" in a || a.page.moreRecords) return "invalid";
    const live: string[] = [];
    for (const r of a.page.records) {
      if (!validId(r.id) || idOf(r.Customer) !== contact.id || !["Reserved", "Issued", "Cancelled"].includes(String(r.Allocation_Status))) return "invalid";
      if (r.Allocation_Status !== "Cancelled") live.push(r.id);
    }
    return live;
  }

  interface Existing { readonly id: string; readonly seq: number; readonly allotmentId: string | null; readonly kind: unknown; readonly amount: unknown;
    readonly mode: unknown; readonly receivedOn: unknown; readonly state: unknown }
  /** Every claim key ever written for this lead (the sequence, and an open one). `fields`: the lead page's read asks only
   *  for what it shows (CLAIM_READ_FIELDS — B-06: COQL refuses the WHOLE query as INVALID_QUERY when one selected field is
   *  hidden from the profile, so the IR's read never names a field it does not need); the report asks for what it compares. */
  async function claimsOf(cred: UserCredential, leadId: string, signal?: AbortSignal, fields: string = CLAIM_REPORT_FIELDS): Promise<readonly Existing[] | { fail: ZohoFailureKind } | "invalid"> {
    const r = await coql(cred, `select ${fields} from ${RECEIPTS_MODULE} where UTR like '${CLAIM_KEY_PREFIX}${leadId}-%' limit 0, 200`, signal);
    if ("fail" in r) return { fail: r.fail };
    if ("invalid" in r || r.page.moreRecords) return "invalid";
    const out: Existing[] = [];
    for (const row of r.page.records) {
      const m = typeof row.UTR === "string" ? KEY_SEQ.exec(row.UTR) : null;
      if (!validId(row.id) || !m || m[1] !== leadId) return "invalid";
      out.push({ id: row.id, seq: Number(m[2]), allotmentId: idOf(row.Allotment), kind: row.Kind, amount: row.Amount, mode: row.Mode,
        receivedOn: row.Received_On, state: row.Match_State });
    }
    return out;
  }

  const receivedOnOf = (saidOn: string): string => `${saidOn}T00:00:00+05:30`;
  const sameIntent = (e: Existing, d: Draft, allotmentId: string | null): boolean =>
    e.state === CLAIM_STATE && (allotmentId === null || e.allotmentId === allotmentId) && e.kind === d.zohoKind && Number(e.amount) === d.amountRupees
    && e.mode === d.mode && typeof e.receivedOn === "string" && e.receivedOn.slice(0, 10) === d.saidOn;

  const view = (leadId: string, id: string, allotmentId: string, d: Draft, duplicate: boolean): ClaimResult => ({
    ok: true,
    value: Object.freeze({
      leadId, claimId: id, allotmentId, state: "waiting" as const, kind: d.kind, mode: d.mode, amountRupees: d.amountRupees,
      saidOn: d.saidOn, ref: maskRef(d.ref), says: CLAIM_WAITING_TEXT, row: CLAIM_ROW_TEXT, duplicate,
    }),
  });

  async function run(cred: UserCredential, sessionId: string, leadId: string, d: Draft, signal?: AbortSignal): Promise<ClaimResult> {
    const me = cred.userId;
    // Rule 2 + 3: the gate re-checks the session, the book and cover, and reads Finance's facts.
    let g: GateResult;
    try { g = await gates.read({ credential: cred, sessionId }, leadId, signal); } catch { return sourceError("unexpected"); }
    if (!g.ok) {
      if (g.kind === "refused") return refuse(me, g.reasonCode, [leadId]);
      return sourceError(g.errorKind);
    }
    const s = g.value;
    if (s.done >= 7) return refuse(me, "already-paid", [leadId]);
    if (s.done < 5) return refuse(me, "not-converted", [leadId]);
    if (s.gate === null) return refuse(me, "lost", [leadId]); // rungs 6 and 7 carry gates: none means Lost_At is set
    if (s.payment?.status === "Full") return refuse(me, "already-paid", [leadId]);

    const past = await claimsOf(cred, leadId, signal);
    if (past === "invalid") return refuse(me, "source-invalid", [leadId]);
    if ("fail" in past) return sourceError(past.fail);
    const open = past.filter((e) => e.state === CLAIM_STATE);
    if (open.length > 0 || s.payment?.reported) {
      // The earlier press of this very report answers the same; anything else is a second report (one per lead).
      const same = open.find((e) => sameIntent(e, d, d.allotmentId));
      if (same && same.allotmentId) return view(leadId, same.id, same.allotmentId, d, true);
      return refuse(me, "already-waiting", [leadId, ...open.map((e) => e.id)]);
    }
    if (!s.docs.supplementary) return refuse(me, "supplementary-not-verified", [leadId]);

    const live = await liveAllotments(cred, leadId, signal);
    if (live === "invalid") return refuse(me, "source-invalid", [leadId]);
    if ("fail" in live) return sourceError(live.fail);
    if (live.length === 0) return refuse(me, "no-allotment", [leadId]);
    let allotmentId: string;
    if (d.allotmentId !== null) {
      if (!live.includes(d.allotmentId)) return refuse(me, "allotment-required", [leadId, d.allotmentId]);
      allotmentId = d.allotmentId;
    } else if (live.length === 1) allotmentId = live[0]!;
    else return refuse(me, "allotment-required", [leadId]);

    const seq = past.reduce((n, e) => Math.max(n, e.seq), 0) + 1;
    const key = `${CLAIM_KEY_PREFIX}${leadId}-${seq}`;
    const masked = maskRef(d.ref);
    const noteLines = [
      `Investor says they paid (${d.kind === "other" ? "other payment" : d.kind}), reported by the IR in the console.`,
      masked ? `Reference the investor gave: ${masked}` : "No reference given.",
      d.note ? `IR's note: ${d.note}` : "",
    ].filter(Boolean);
    // Name: the module's record name (mandatory on a custom module; every other receipt writer sets one) — the claim key.
    const fields: ZohoFields = {
      Name: key, Allotment: { id: allotmentId }, Kind: d.zohoKind, Amount: d.amountRupees, Mode: d.mode, UTR: key,
      Received_On: receivedOnOf(d.saidOn), Match_State: CLAIM_STATE, Note: noteLines.join("\n"),
    };

    /** The key is unique: after an ambiguous or refused write, read it back to learn what Zoho holds. */
    const recover = async (): Promise<ClaimResult | null> => {
      const r = await coql(cred, `select ${CLAIM_REPORT_FIELDS} from ${RECEIPTS_MODULE} where UTR = '${key}' limit 0, 2`);
      if (!("page" in r) || r.page.records.length !== 1) return null;
      const row: ZohoRecord = r.page.records[0]!;
      if (!validId(row.id)) return null;
      const e: Existing = { id: row.id, seq, allotmentId: idOf(row.Allotment), kind: row.Kind, amount: row.Amount, mode: row.Mode, receivedOn: row.Received_On, state: row.Match_State };
      return sameIntent(e, d, allotmentId) ? view(leadId, row.id, allotmentId, d, true) : refuse(me, "already-waiting", [leadId, row.id]);
    };

    let ins: Awaited<ReturnType<typeof crm.insert>>;
    try { ins = await crm.insert(cred, RECEIPTS_MODULE, [fields], { signal }); } catch {
      return (await recover()) ?? { ok: false, kind: "unknown-outcome", message: "Not saved yet — Zoho has not confirmed it. Press again; it will not be sent twice.", retryable: true };
    }
    if (ins.ok) {
      const o = ins.value[0];
      if (ins.value.length === 1 && o?.ok && o.code === "SUCCESS" && validId(o.id)) return view(leadId, o.id, allotmentId, d, false);
      return (await recover()) ?? refuse(me, "source-invalid", [leadId, allotmentId]);
    }
    const e = ins.error;
    const recs = e.kind === "partial" || e.kind === "invalid-data" ? e.records : null;
    const duplicate = (e.kind === "invalid-data" && e.code === "DUPLICATE_DATA") || !!recs?.some((r) => r.code === "DUPLICATE_DATA");
    if (duplicate || e.kind === "partial" || e.kind === "network" || e.kind === "server" || e.kind === "unexpected" || e.kind === "aborted") {
      const got = await recover();
      if (got) return got;
      if (duplicate) return refuse(me, "in-progress", [leadId]);
      if (e.kind === "partial" || e.kind === "unexpected" || e.kind === "network" || e.kind === "aborted") {
        return { ok: false, kind: "unknown-outcome", message: "Not saved yet — Zoho has not confirmed it. Press again; it will not be sent twice.", retryable: true };
      }
    }
    if (e.kind === "invalid-data") return refuse(me, "source-invalid", [leadId, allotmentId]);
    return sourceError(e.kind);
  }

  type ClaimFailure = Exclude<ClaimResult, { readonly ok: true }>;
  const fail = (r: ClaimResult): ClaimFailure => r as ClaimFailure;
  type StateResult = { readonly ok: true; readonly value: ClaimStateView };
  return Object.freeze({
    /** The latest report on this lead and Finance's answer, on the person's own token (the lead must be in their book). */
    async read(principal: { credential: UserCredential; sessionId: string }, leadId: unknown, signal?: AbortSignal): Promise<StateResult | ClaimFailure> {
      const cred = principal?.credential;
      if (!isUserCredential(cred) || typeof principal.sessionId !== "string" || !SESSION_ID.test(principal.sessionId) || !validId(leadId)) {
        return fail(refuse(isUserCredential(cred) ? cred.userId : "unrecognised", "invalid-request"));
      }
      let g: GateResult;
      try { g = await gates.read({ credential: cred, sessionId: principal.sessionId }, leadId, signal); } catch { return fail(readError("unexpected")); }
      if (!g.ok) return fail(g.kind === "refused" ? refuse(cred.userId, g.reasonCode, [leadId]) : readError(g.errorKind));
      /* D139: every one of the IR's own reports on this lead, with its state, amount, date and the day Finance answered (./claim-lines) */
      const cl = await readClaimLines(crm, cred, [leadId], signal);
      if (!cl.ok) return fail(cl.kind === "invalid" ? refuse(cred.userId, "source-invalid", [leadId]) : readError(cl.kind));
      const claims = cl.lines;
      const out = (claimId: string | null, state: ClaimStateView["state"], answer: ClaimStateView["answer"] = null, reason: string | null = null): StateResult => ({
        ok: true, value: Object.freeze({ leadId, claimId, state, answer, reason, says: answer === "not-found" ? notFoundText(reason ?? "") : null, claims }) });
      const latest = claims[0];
      if (!latest) return out(null, "none");
      if (latest.state === "pending") return out(latest.claimId, "waiting");
      if (latest.state === "matched") return out(latest.claimId, "answered", "found");
      if (latest.state === "rejected") return out(latest.claimId, "answered", "not-found", latest.reason);
      return out(latest.claimId, "answered");
    },
    /** Report what the investor says they paid. Writes one Claimed receipt, or none. */
    async report(principal: { credential: UserCredential; sessionId: string }, leadId: unknown, body: unknown, signal?: AbortSignal): Promise<ClaimResult> {
      const cred = principal?.credential;
      if (!isUserCredential(cred) || typeof principal.sessionId !== "string" || !SESSION_ID.test(principal.sessionId) || !validId(leadId)) {
        return refuse(isUserCredential(cred) ? cred.userId : "unrecognised", "invalid-request");
      }
      const me = cred.userId;
      const d = parseDraft(me, body);
      if ("ok" in d) return d;
      let allowed = false;
      try { allowed = await authority.mayReport(cred, principal.sessionId, signal); } catch { allowed = false; }
      if (!allowed) return refuse(me, "capability-missing", [leadId]);
      // The double press: one claim per lead in flight. The same report joins the first; another waits its turn.
      const fingerprint = JSON.stringify([me, d.zohoKind, d.mode, d.amountRupees, d.saidOn, d.allotmentId]);
      // A different report on the same lead waits its turn: one claim per lead in flight, on any instance.
      const lock = `payment-claim-lead|${leadId}`;
      const o = await presses.once(`${leadId}\u0000${fingerprint}`, fingerprint, async () => {
        if (!(await state.claim(lock, CLAIM_LEAD_LOCK_S))) return refuse(me, "in-progress", [leadId]);
        try { return await run(cred, principal.sessionId, leadId, d, signal); } finally { await state.release(lock).catch(() => { /* the TTL frees it */ }); }
      });
      if (o.kind === "busy" || o.kind === "unavailable" || o.kind === "reused") return refuse(me, "in-progress", [leadId]);
      const r = o.result;
      if (o.kind === "ran") return r;
      return r.ok ? { ok: true, value: Object.freeze({ ...r.value, ref: maskRef(d.ref), duplicate: true }) } : r;
    },
  });
}
export type PaymentClaims = ReturnType<typeof createPaymentClaims>;
