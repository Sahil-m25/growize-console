/**
 * M10-S03-T01 — Finance answers an IR's payment report (D21, D45, D49, D68, D70, D82).
 *
 * A report is a Receipts row with Match_State = Claimed and UTR = CLAIM-<leadId>-<n> (server/leads/claim.ts).
 * Finance answers it one of two ways, on their own token (D53); the IR's fields (Kind, Amount, Mode, Received_On,
 * UTR, Note, Allotment) are never edited — the report stays exactly as the IR wrote it:
 *
 *   confirm   "Confirm and record it": ONE receipt is recorded through record-receipt.ts commit() (the M01-S08 replay
 *             path: Pending, recorded_by = Finance, one per Idempotency-Key) from the report's kind / mode / amount /
 *             date and the report's allotment. The report's reference is kept masked only (claim.ts), so Finance
 *             enters the bank reference they see; when the report kept a last four, it must agree. The report itself
 *             stays pending until this confirm; the receipt Finance records here is matched at once when the paper
 *             allows it (D113 ruling 1 — Finance's record is Finance's approval; record-receipt.ts → match.ts).
 *   notThere  "Not there yet" with a reason: the reason goes on the report as a Zoho Note under Finance's name, and
 *             money.not_found { reason, claim_id, at } is published (contracts/money.not_found.json).
 *
 * Receipts has no answer fields (no Claim_Id, Answer, Answer_Reason): the answer is Match_State plus a Note.
 * Either answer moves the report out of Claimed to "Not found" — the one picklist value every money reader
 * (register, by-allotment, receipt-replay, gates) already treats as "not money", so the answered report neither
 * counts nor blocks the IR's next report (claim.ts: one open claim per lead). Which answer it was is the Note
 * ("Finance found it" / "Finance did not find it"); the confirmed receipt carries a Note naming the report
 * (the claim_id link). PROVISIONAL (Jev 0.59); FACT CHANGE PROPOSED: a Zoho answer field so the two read apart.
 *
 * Who: Finance with the Investors-side "pay" capability (Head of Finance, Finance Operations, the super user).
 * A KAM or an IR gets no report and no answer. The super user sees the drawer with Finance named as the doer
 * and a super-user note. Retries are safe: the receipt by its key, the Notes by reading them back, the event by
 * an id derived from the report. Nothing is cached (D45); logs carry ids and codes only — never the reason or
 * the reference.
 */

import type { UserCredential, ZohoClient, ZohoRecord } from "../../lib/zoho/client";
import { isUserCredential } from "../../lib/zoho/client";
import type { ZohoFailureKind } from "../../lib/zoho/errors";
import type { OpsLog } from "../../lib/zoho/log";
import type { AllotmentReceiptWrites } from "./allotment-receipts";
import { factEventId, istIso, type Published, type Publish } from "./match";
import type { RecordedReceipt, RecordReceipt } from "./record-receipt";
import { ALLOTMENTS_MODULE, RECEIPTS_MODULE } from "./receipt-replay";

export const CLAIM_STATE = "Claimed";
export const ANSWERED_STATE = "Not found";
export const FOUND_TITLE = "Finance found it";
export const NOT_FOUND_TITLE = "Finance did not find it";
export const LINK_TITLE = "Answers an IR's report";
export const REASON_MAX = 500;
export const SUPER_USER_NOTE = "You are here as the super user. Finance answers this report.";
export const notFoundText = (reason: string): string => `${NOT_FOUND_TITLE}: ${reason}`;

const SESSION_ID = /^[A-Za-z0-9_-]{16,128}$/;
const RECORD_ID = /^\d{15,22}$/;
const RECORD_PREFIX = /^\d{6,16}$/;
const ZDT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/;
const KEY = /^CLAIM-(\d{15,22})-\d{1,4}$/;
const MASK = /••••([A-Z0-9]{1,4})/;
const UTR = /^[A-Z0-9][A-Z0-9._/-]{2,79}$/;
const LIST_LIMIT = 200;
const CLAIM_FIELDS = Object.freeze(["UTR", "Allotment", "Kind", "Amount", "Mode", "Received_On", "Match_State", "Created_By", "Note", "Modified_Time"]);
const ALLOTMENT_FIELDS = Object.freeze(["Customer", "Allocation_Status", "Hold_Until"]);
/** Receipts.Kind → the Money drawer's words (record-receipt RECORD_KINDS). */
const KIND_WORD: Readonly<Record<string, "advance" | "balance" | "full">> = Object.freeze({ Advance: "advance", Part: "balance", Balance: "balance", Full: "full" });

export type ClaimAnswerRefusal =
  | "invalid-request" | "not-finance" | "not-visible" | "not-a-claim" | "already-answered" | "reference-required"
  | "reference-differs" | "reason-required" | "claim-changed" | "source-invalid";

const MESSAGE: Readonly<Record<ClaimAnswerRefusal, string>> = Object.freeze({
  "invalid-request": "Not saved yet — reload the page and try again.",
  "not-finance": "Finance answers the IR's payment reports.",
  "not-visible": "This report is not available to you.",
  "not-a-claim": "This is not an IR's payment report.",
  "already-answered": "Finance has already answered this report.",
  "reference-required": "Not saved yet — enter the bank reference you found.",
  "reference-differs": "Not saved yet — that reference does not end the way the investor's did. Check it against the bank.",
  "reason-required": `Say why it is not there yet (up to ${REASON_MAX} characters). The IR sees it on the lead.`,
  "claim-changed": "Not saved yet — the report changed while you were answering it. Reload and answer again.",
  "source-invalid": "Not saved yet — Zoho returned something the console cannot read. Digital Infrastructure has been told.",
});

export interface ClaimRow {
  readonly claimId: string;
  readonly leadId: string;
  readonly allotmentId: string;
  readonly kind: "advance" | "balance" | "full";
  readonly mode: string;
  readonly amountRupees: number;
  readonly saidOn: string;
  readonly byId: string;
}
export interface ClaimDetail extends ClaimRow {
  readonly investorId: string;
  /** The IR who wrote the report (Created_By), and their words as Zoho keeps them (reference masked). */
  readonly byName: string | null;
  readonly words: string;
  readonly refLastFour: string | null;
  readonly alreadyInRupees: number;
  readonly outstandingRupees: number;
  readonly holdUntil: string | null;
  readonly doer: "Finance";
  readonly superUser: boolean;
  readonly superUserNote: string | null;
  readonly offers: readonly ("confirm" | "not-there")[];
}
export interface ConfirmView {
  readonly claimId: string;
  readonly receipt: RecordedReceipt;
  /** The report left Claimed (answered). false: the receipt stands; press again to finish the answer. */
  readonly answered: boolean;
  readonly linked: boolean;
}
export interface NotThereView {
  readonly claimId: string;
  readonly says: string;
  readonly duplicate: boolean;
  readonly moneyNotFound: Published | null;
}

type Fail =
  | { readonly ok: false; readonly kind: "refused"; readonly reasonCode: string; readonly message: string; readonly retryable: false }
  | { readonly ok: false; readonly kind: "source-error"; readonly errorKind: ZohoFailureKind | "unexpected"; readonly message: string; readonly retryable: boolean }
  | { readonly ok: false; readonly kind: "unknown-outcome"; readonly message: string; readonly retryable: true };
export type Answer<T> = { readonly ok: true; readonly value: T } | Fail;

export interface ClaimAnswerAuthority {
  /** Fresh check on the live session: may this person answer (Investors "pay"), and are they the super user? */
  seatOf(credential: UserCredential, sessionId: string, signal?: AbortSignal): Promise<{ readonly mayAnswer: boolean; readonly superUser: boolean }>;
}
export interface ClaimAnswerDependencies {
  readonly crm: Pick<ZohoClient, "getRecord" | "coql" | "update" | "insert" | "getRelated">;
  readonly record: Pick<RecordReceipt, "commit">;
  readonly writes: Pick<AllotmentReceiptWrites, "paymentStatus">;
  readonly authority: ClaimAnswerAuthority;
  readonly publish: Publish;
  readonly log: OpsLog;
  readonly recordIdPrefix: string;
  readonly clock?: () => number;
}

class Unreadable { constructor(readonly ids: readonly string[]) {} }
class SourceFail { constructor(readonly kind: ZohoFailureKind | "unexpected") {} }
const retryableKind = (k: ZohoFailureKind | "unexpected"): boolean =>
  k === "network" || k === "server" || k === "busy" || k === "concurrency-exceeded" || k === "rate-limited-unclassified" || k === "unexpected";
const int = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) ? v : null);

export function createClaimAnswers(deps: ClaimAnswerDependencies) {
  if (!deps || typeof deps.crm?.getRecord !== "function" || typeof deps.crm?.coql !== "function" || typeof deps.crm?.update !== "function"
    || typeof deps.crm?.insert !== "function" || typeof deps.crm?.getRelated !== "function" || typeof deps.record?.commit !== "function"
    || typeof deps.writes?.paymentStatus !== "function" || typeof deps.authority?.seatOf !== "function" || typeof deps.publish !== "function"
    || typeof deps.log?.refusal !== "function" || typeof deps.recordIdPrefix !== "string" || !RECORD_PREFIX.test(deps.recordIdPrefix)) {
    throw new TypeError("Claim answers need crm.getRecord/coql/update/insert/getRelated, record-receipt, the allotment receipt writes, the authority, the publisher, the ops log and the CRM record-id prefix.");
  }
  const { crm, record, writes, authority, publish, log } = deps;
  const clock = deps.clock ?? Date.now;
  const validId = (v: unknown): v is string => typeof v === "string" && RECORD_ID.test(v) && v.startsWith(deps.recordIdPrefix);
  const idOf = (v: unknown): string | null => {
    const id = v && typeof v === "object" ? (v as { id?: unknown }).id : undefined;
    return validId(id) ? id : null;
  };
  /** A user lookup (Created_By): the id as Zoho gives it (users share the org prefix, but do not insist). */
  const userOf = (v: unknown): { id: string; name: string | null } | null => {
    const o = v && typeof v === "object" ? (v as { id?: unknown; name?: unknown }) : null;
    return o && typeof o.id === "string" && RECORD_ID.test(o.id) ? { id: o.id, name: typeof o.name === "string" ? o.name.slice(0, 80) : null } : null;
  };
  const now = (): number => { try { return clock(); } catch { return 0; } };
  const refuse = (me: string, code: ClaimAnswerRefusal, ids: readonly unknown[] = []): Fail => {
    log.refusal({ at: now(), actor: { kind: "user", userId: me }, action: "claim-answer", reason: code, recordIds: ids.filter(validId) });
    return { ok: false, kind: "refused", reasonCode: code, message: MESSAGE[code], retryable: false };
  };
  const sourceError = (k: ZohoFailureKind | "unexpected"): Fail => ({
    ok: false, kind: "source-error", errorKind: k, retryable: retryableKind(k),
    message: retryableKind(k) ? "Not saved yet — Zoho is not answering. Press again; it will not be saved twice." : "Not saved yet — Zoho refused it.",
  });
  const failOf = (me: string, e: unknown): Fail =>
    e instanceof Unreadable ? refuse(me, "source-invalid", e.ids) : e instanceof SourceFail ? sourceError(e.kind) : sourceError("unexpected");

  type P = { credential: UserCredential; sessionId: string };
  const trusted = (p: unknown): P | null => {
    const c = p && typeof p === "object" ? (p as { credential?: unknown; sessionId?: unknown }) : null;
    return c && isUserCredential(c.credential) && typeof c.sessionId === "string" && SESSION_ID.test(c.sessionId)
      ? { credential: c.credential, sessionId: c.sessionId } : null;
  };
  const seat = async (p: P, signal?: AbortSignal) => {
    try {
      const s = await authority.seatOf(p.credential, p.sessionId, signal);
      return { mayAnswer: s?.mayAnswer === true, superUser: s?.superUser === true };
    } catch { return { mayAnswer: false, superUser: false }; }
  };

  const rowOf = (r: ZohoRecord): (ClaimRow & { state: string; modifiedTime: string | null; note: string; byName: string | null }) | null => {
    const m = typeof r.UTR === "string" ? KEY.exec(r.UTR) : null;
    const allotmentId = idOf(r.Allotment), amount = int(r.Amount), by = userOf(r.Created_By);
    const kind = typeof r.Kind === "string" ? KIND_WORD[r.Kind] : undefined;
    if (!validId(r.id) || !m || !validId(m[1]) || !allotmentId || amount === null || amount <= 0 || !kind || typeof r.Mode !== "string"
      || typeof r.Received_On !== "string" || !by || typeof r.Match_State !== "string") return null;
    return {
      claimId: r.id, leadId: m[1], allotmentId, kind, mode: r.Mode, amountRupees: amount, saidOn: r.Received_On.slice(0, 10), byId: by.id,
      state: r.Match_State, modifiedTime: typeof r.Modified_Time === "string" && ZDT.test(r.Modified_Time) ? r.Modified_Time : null,
      note: typeof r.Note === "string" ? r.Note : "", byName: by.name,
    };
  };

  async function readClaim(cred: UserCredential, claimId: string, signal?: AbortSignal) {
    const r = await crm.getRecord(cred, RECEIPTS_MODULE, claimId, { fields: CLAIM_FIELDS, signal });
    if (!r.ok) {
      if (r.error.kind === "not-found" || r.error.kind === "forbidden") return null;
      throw new SourceFail(r.error.kind);
    }
    if (!r.value) return null;
    if (r.value.id !== claimId) throw new Unreadable([claimId]);
    if (typeof r.value.UTR !== "string" || !KEY.test(r.value.UTR)) return "not-a-claim" as const;
    const row = rowOf(r.value);
    if (!row || !row.modifiedTime) throw new Unreadable([claimId]);
    return row;
  }
  async function readAllotment(cred: UserCredential, allotmentId: string, signal?: AbortSignal) {
    const r = await crm.getRecord(cred, ALLOTMENTS_MODULE, allotmentId, { fields: ALLOTMENT_FIELDS, signal });
    if (!r.ok) throw new SourceFail(r.error.kind);
    const investorId = idOf(r.value?.Customer);
    if (!r.value || r.value.id !== allotmentId || !investorId) throw new Unreadable([allotmentId]);
    const h = r.value.Hold_Until;
    return { investorId, holdUntil: typeof h === "string" && /^\d{4}-\d{2}-\d{2}/.test(h) ? h.slice(0, 10) : null };
  }
  /** The Notes on a record (to read an answer back, and to never write the same Note twice). */
  async function notesOf(cred: UserCredential, id: string, signal?: AbortSignal): Promise<readonly { title: string; content: string }[]> {
    const r = await crm.getRelated(cred, RECEIPTS_MODULE, id, "Notes", { fields: ["Note_Title", "Note_Content"], perPage: 200, signal });
    if (!r.ok) {
      if (r.error.kind === "not-found") return [];
      throw new SourceFail(r.error.kind);
    }
    return r.value.records.map((n) => ({ title: typeof n.Note_Title === "string" ? n.Note_Title : "", content: typeof n.Note_Content === "string" ? n.Note_Content : "" }));
  }
  async function noteOnce(cred: UserCredential, id: string, title: string, content: string, signal?: AbortSignal): Promise<boolean> {
    const have = await notesOf(cred, id, signal);
    if (have.some((n) => n.title === title && n.content === content)) return true;
    const r = await crm.insert(cred, "Notes", [{ Note_Title: title, Note_Content: content, Parent_Id: { module: { api_name: RECEIPTS_MODULE }, id } }], { signal });
    return r.ok && r.value.length === 1 && r.value[0]!.ok === true;
  }
  /** Claimed → answered, guarded by the report's Modified_Time (D44). Only Match_State is written. */
  async function answer(cred: UserCredential, claimId: string, modifiedTime: string, signal?: AbortSignal): Promise<"ok" | "changed" | ZohoFailureKind> {
    const w = await crm.update(cred, RECEIPTS_MODULE, claimId, { Match_State: ANSWERED_STATE }, { ifUnmodifiedSince: modifiedTime, signal });
    return w.ok ? "ok" : w.error.kind === "conflict" ? "changed" : w.error.kind;
  }

  async function gate(principal: unknown, claimId: unknown, signal?: AbortSignal): Promise<Fail | { p: P; superUser: boolean }> {
    const p = trusted(principal);
    if (!p) return refuse("unrecognised", "invalid-request");
    const s = await seat(p, signal);
    if (!s.mayAnswer) return refuse(p.credential.userId, "not-finance", validId(claimId) ? [claimId] : []);
    if (claimId !== undefined && !validId(claimId)) return refuse(p.credential.userId, "invalid-request");
    return { p, superUser: s.superUser };
  }

  return Object.freeze({
    /** The reports waiting on Finance (Today, Investors side). Finance only; a KAM or an IR gets none. */
    async waiting(principal: unknown, signal?: AbortSignal): Promise<Answer<{ readonly claims: readonly ClaimRow[]; readonly superUser: boolean }>> {
      const g = await gate(principal, undefined, signal);
      if ("ok" in g) return g;
      const me = g.p.credential.userId;
      try {
        const r = await crm.coql(g.p.credential,
          `select id, UTR, Allotment, Kind, Amount, Mode, Received_On, Match_State, Created_By from ${RECEIPTS_MODULE} where Match_State = '${CLAIM_STATE}' limit 0, ${LIST_LIMIT}`, { signal });
        if (!r.ok) throw new SourceFail(r.error.kind);
        if (r.value.invalidRecordIds) throw new Unreadable([]);
        const claims: ClaimRow[] = [];
        for (const rec of r.value.records) {
          const row = rowOf(rec);
          if (!row || row.state !== CLAIM_STATE) throw new Unreadable([rec.id]);
          const { claimId, leadId, allotmentId, kind, mode, amountRupees, saidOn, byId } = row;
          claims.push(Object.freeze({ claimId, leadId, allotmentId, kind, mode, amountRupees, saidOn, byId }));
        }
        return { ok: true, value: Object.freeze({ claims: Object.freeze(claims), superUser: g.superUser }) };
      } catch (e) { return failOf(me, e); }
    },

    /** The drawer: the IR's words, already in / outstanding / hold ends, and what Finance may do. */
    async detail(principal: unknown, claimId: unknown, signal?: AbortSignal): Promise<Answer<ClaimDetail>> {
      const g = await gate(principal, claimId, signal);
      if ("ok" in g) return g;
      const { p } = g, me = p.credential.userId, id = claimId as string;
      try {
        const c = await readClaim(p.credential, id, signal);
        if (c === null) return refuse(me, "not-visible", [id]);
        if (c === "not-a-claim") return refuse(me, "not-a-claim", [id]);
        if (c.state !== CLAIM_STATE) return refuse(me, "already-answered", [id]);
        const a = await readAllotment(p.credential, c.allotmentId, signal);
        const ps = await writes.paymentStatus(p, c.allotmentId, signal);
        if (!ps.ok) return ps.kind === "refused" ? refuse(me, ps.reasonCode === "allotment-not-visible" ? "not-visible" : "source-invalid", [id, c.allotmentId]) : sourceError(ps.errorKind);
        const last = MASK.exec(c.note);
        return {
          ok: true,
          value: Object.freeze({
            claimId: c.claimId, leadId: c.leadId, allotmentId: c.allotmentId, kind: c.kind, mode: c.mode, amountRupees: c.amountRupees, saidOn: c.saidOn,
            byId: c.byId, byName: c.byName, words: c.note, refLastFour: last ? last[1]! : null, investorId: a.investorId,
            alreadyInRupees: ps.value.receivedRupees, outstandingRupees: Math.max(0, ps.value.amountRupees - ps.value.receivedRupees),
            holdUntil: a.holdUntil, doer: "Finance" as const, superUser: g.superUser, superUserNote: g.superUser ? SUPER_USER_NOTE : null,
            offers: Object.freeze(["confirm", "not-there"] as const),
          }),
        };
      } catch (e) { return failOf(me, e); }
    },

    /** "Confirm and record it". body: { ref, receivedOn? }. One receipt per Idempotency-Key (record-receipt commit). */
    async confirm(principal: unknown, claimId: unknown, body: unknown, idempotencyKey: unknown, signal?: AbortSignal): Promise<Answer<ConfirmView>> {
      const g = await gate(principal, claimId, signal);
      if ("ok" in g) return g;
      const { p } = g, me = p.credential.userId, id = claimId as string;
      const b = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
      const ref = typeof b.ref === "string" ? b.ref.replace(/\s+/g, "").toUpperCase() : "";
      if (!UTR.test(ref)) return refuse(me, "reference-required", [id]);
      let c: Awaited<ReturnType<typeof readClaim>>;
      try { c = await readClaim(p.credential, id, signal); } catch (e) { return failOf(me, e); }
      if (c === null) return refuse(me, "not-visible", [id]);
      if (c === "not-a-claim") return refuse(me, "not-a-claim", [id]);
      if (c.state !== CLAIM_STATE) return refuse(me, "already-answered", [id]);
      const last = MASK.exec(c.note)?.[1];
      if (last && !ref.endsWith(last)) return refuse(me, "reference-differs", [id]);

      const rec = await record.commit(p, {
        allotmentId: c.allotmentId, kind: c.kind, mode: c.mode, ref, amount: c.amountRupees,
        receivedOn: typeof b.receivedOn === "string" && b.receivedOn ? b.receivedOn : c.saidOn,
      }, idempotencyKey, signal);
      if (!rec.ok) return rec;
      const receiptId = rec.value.receiptId;
      let linked = false, answered = false;
      try {
        linked = await noteOnce(p.credential, receiptId, LINK_TITLE, `Report ${id}`, signal);
        const found = await noteOnce(p.credential, id, FOUND_TITLE, `Recorded as receipt ${receiptId}`, signal);
        if (found) answered = (await answer(p.credential, id, c.modifiedTime!, signal)) === "ok";
      } catch { /* the receipt stands; press again to finish the answer */ }
      if (!linked || !answered) log.refusal({ at: now(), actor: { kind: "user", userId: me }, action: "claim-answer", reason: "answer-incomplete", recordIds: [id, receiptId] });
      return { ok: true, value: Object.freeze({ claimId: id, receipt: rec.value, answered, linked }) };
    },

    /** "Not there yet" with a reason: the reason on the report as a Note, the report answered, money.not_found out. */
    async notThere(principal: unknown, claimId: unknown, body: unknown, signal?: AbortSignal): Promise<Answer<NotThereView>> {
      const g = await gate(principal, claimId, signal);
      if ("ok" in g) return g;
      const { p } = g, me = p.credential.userId, id = claimId as string;
      const b = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
      const reason = typeof b.reason === "string" ? b.reason.trim().replace(/\s+/g, " ") : "";
      if (!reason || reason.length > REASON_MAX) return refuse(me, "reason-required", [id]);
      try {
        const c = await readClaim(p.credential, id, signal);
        if (c === null) return refuse(me, "not-visible", [id]);
        if (c === "not-a-claim") return refuse(me, "not-a-claim", [id]);
        let duplicate = false;
        if (c.state !== CLAIM_STATE) {
          // A retry of this very answer is answered the same; anything else was answered already.
          const notes = c.state === ANSWERED_STATE ? await notesOf(p.credential, id, signal) : [];
          if (notes.some((n) => n.title === FOUND_TITLE) || !notes.some((n) => n.title === NOT_FOUND_TITLE && n.content === reason)) return refuse(me, "already-answered", [id]);
          duplicate = true;
        } else {
          if (!(await noteOnce(p.credential, id, NOT_FOUND_TITLE, reason, signal))) return sourceError("unexpected");
          const w = await answer(p.credential, id, c.modifiedTime!, signal);
          if (w === "changed") return refuse(me, "claim-changed", [id]);
          if (w !== "ok") return sourceError(w);
        }
        const a = await readAllotment(p.credential, c.allotmentId, signal);
        const at = now();
        let moneyNotFound: Published | null;
        try {
          moneyNotFound = await publish({
            event_id: factEventId(`money.not_found:${id}`), type: "money.not_found", schema_version: 1, occurred_at: istIso(at),
            actor: { kind: "user", zoho_user_id: me }, ids: { investor_contact_id: a.investorId },
            payload: { reason, claim_id: id, at: istIso(at) }, origin: "console",
          });
        } catch { moneyNotFound = { ok: false, reason: "unexpected" }; }
        if (!moneyNotFound.ok) log.refusal({ at, actor: { kind: "user", userId: me }, action: "claim-answer", reason: "event-not-sent", recordIds: [id] });
        return { ok: true, value: Object.freeze({ claimId: id, says: notFoundText(reason), duplicate, moneyNotFound }) };
      } catch (e) { return failOf(me, e); }
    },
  });
}
export type ClaimAnswers = ReturnType<typeof createClaimAnswers>;
