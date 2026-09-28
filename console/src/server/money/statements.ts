/**
 * M10-S05-T02 — weekly bank statement: upload, store in Zoho, reconcile against Receipts (D21, D22, D45, D53, D71).
 *
 * "Upload the bank statement" (Payments page, Finance only):
 *   1. who: the Investors-side "pay" capability (Finance Operations, Head of Finance, super user), re-checked on the
 *      live session. A KAM (any other seat) is refused before anything is read or stored (TC-IM05-026; Zoho's
 *      Finance-only profile on Statements is the second wall — M10-S05-T01, Sahil);
 *   2. the file is parsed in memory (statement-parse.ts). No temp file, no cache, and no statement line, UTR or
 *      narration ever reaches a log — logs carry the Statements record id and counts only;
 *   3. each line is reconciled against Receipts, read on the uploader's own token (D53): a line matches a receipt on
 *      reference (UTR) + amount (to the paisa) + date (the receipt's Received_On within DATE_SLACK_DAYS of the posting
 *      date, IST) and direction (credits ↔ Advance/Part/Full, debits ↔ Refund). Everything else is listed under
 *      "needs an owner" with who owns it and why — debits included (bank charges have no receipt);
 *   4. one Statements record is created (period, line counts) and the CSV is attached to it, streamed to Zoho on the
 *      uploader's token (D71). A failed attachment removes the record again, so nothing half-stored remains.
 *
 * SUGGESTIONS ONLY. A statement line matching a pending receipt is "awaiting the match": the match itself is the
 * second hand's act through POST /api/receipts/[id]/match (server/money/match.ts — Head of Finance, never the
 * recorder; it sets Matched_By, and the match time is the event's). Nothing here writes a receipt.
 *
 * The Statements module does not exist in Zoho yet (M10-S05-T01): the store is an interface; createZohoStatementStore
 * is the Zoho shape it will use once the module and its fields are made.
 */

import type { UserCredential, ZohoClient, ZohoRecord } from "../../lib/zoho/client";
import { isUserCredential } from "../../lib/zoho/client";
import type { ZohoFailureKind } from "../../lib/zoho/errors";
import type { OpsLog } from "../../lib/zoho/log";
import { RECEIPTS_MODULE } from "./receipt-replay";
import { MAX_STATEMENT_BYTES, parseStatement, type StatementDirection, type StatementLine } from "./statement-parse";

export const STATEMENTS_MODULE = "Statements";
export const DATE_SLACK_DAYS = 3;
const IN_LIMIT = 100;
const MAX_REF_QUERIES = 20;
const REFS_PER_LINE = 3;
const SESSION_ID = /^[A-Za-z0-9_-]{16,128}$/;
const RECORD_ID = /^\d{15,22}$/;
const RECORD_PREFIX = /^\d{6,16}$/;
const DAY = /^\d{4}-\d{2}-\d{2}/;
const SAFE_REF = /^[A-Z0-9]{6,30}$/;
const FILE_NAME = /^[^\\/\u0000-\u001f]{1,120}\.(csv|txt)$/i;
const FILE_TYPES: ReadonlySet<string> = new Set(["text/csv", "application/csv", "text/plain", "application/vnd.ms-excel", "application/octet-stream", ""]);
const INBOUND: ReadonlySet<string> = new Set(["Advance", "Part", "Balance", "Full"]);
const RECEIPT_FIELDS = "id, Allotment, Kind, Amount, UTR, Received_On, Match_State, Matched_By, Created_By";

export type Owner = "finance-operations" | "head-of-finance";
export type OwnerReason =
  | "no-receipt" | "debit-no-receipt" | "amount-differs" | "date-differs" | "kind-differs" | "duplicate-line"
  | "receipt-claimed" | "receipt-not-found" | "receipt-reversed";

export interface MatchedLine {
  readonly line: number;
  readonly date: string;
  readonly direction: StatementDirection;
  readonly amountPaise: number;
  /** the reference that matched (the receipt's UTR) */
  readonly utr: string;
  readonly receiptId: string;
  readonly kind: string;
  /** matched: already matched by the second hand; awaiting-match: pending — the Head of Finance matches it */
  readonly state: "matched" | "awaiting-match";
  readonly matchedBy: string | null;
  /** true: the uploader recorded this receipt, so the uploader cannot be the one to match it (D21) */
  readonly recordedByYou: boolean;
}

export interface OwnerLine {
  readonly line: number;
  readonly date: string;
  readonly direction: StatementDirection;
  readonly amountPaise: number;
  readonly utr: string | null;
  /** shown to Finance so the line can be identified; never logged */
  readonly narration: string;
  readonly owner: Owner;
  readonly reason: OwnerReason;
  /** the receipt the reference points at, when there is one (amount/date/kind differ, claimed…) */
  readonly receiptId: string | null;
}

export interface Reconciliation {
  readonly from: string;
  readonly to: string;
  readonly matched: readonly MatchedLine[];
  readonly needsOwner: readonly OwnerLine[];
  readonly counts: { readonly lines: number; readonly matched: number; readonly awaitingMatch: number; readonly needsOwner: number; readonly debits: number; readonly skipped: number };
}

export interface StatementSummary {
  readonly statementId: string;
  readonly name: string;
  readonly from: string | null;
  readonly to: string | null;
  readonly lines: number | null;
  readonly matched: number | null;
  readonly needsOwner: number | null;
  /** when the statement was uploaded and reconciled (Zoho Created_Time) */
  readonly reconciledAt: string | null;
}

export interface UploadView extends Reconciliation {
  readonly statementId: string;
  readonly attachmentId: string;
  readonly name: string;
}

type StoreFail = { readonly ok: false; readonly code: string; readonly errorKind?: ZohoFailureKind | "unexpected" };
export interface StatementStore {
  create(cred: UserCredential, fields: { readonly name: string; readonly from: string; readonly to: string; readonly lines: number; readonly matched: number; readonly needsOwner: number }, signal?: AbortSignal)
    : Promise<{ readonly ok: true; readonly id: string } | StoreFail>;
  attach(cred: UserCredential, id: string, file: { readonly fileName: string; readonly bytes: Uint8Array }, signal?: AbortSignal)
    : Promise<{ readonly ok: true; readonly attachmentId: string } | StoreFail>;
  remove(cred: UserCredential, id: string, signal?: AbortSignal): Promise<{ readonly ok: boolean }>;
  latest(cred: UserCredential, signal?: AbortSignal): Promise<{ readonly ok: true; readonly value: StatementSummary | null } | StoreFail>;
}

export interface StatementAuthority {
  /** Fresh check on the live session: the "pay" capability (Finance Operations, Head of Finance, super user). */
  mayUpload(credential: UserCredential, sessionId: string, signal?: AbortSignal): Promise<boolean>;
}

export interface StatementDependencies {
  readonly crm: Pick<ZohoClient, "coql">;
  readonly store: StatementStore;
  readonly authority: StatementAuthority;
  readonly log: OpsLog;
  readonly recordIdPrefix: string;
  readonly clock?: () => number;
}

export type StatementRefusal = "invalid-request" | "not-finance" | "file-type" | "too-large" | "unreadable" | "too-many-refs" | "source-invalid";
export type StatementResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly kind: "refused"; readonly reasonCode: StatementRefusal; readonly message: string; readonly retryable: false; readonly row?: number }
  | { readonly ok: false; readonly kind: "source-error"; readonly errorKind: ZohoFailureKind | "unexpected" | string; readonly message: string; readonly retryable: boolean };

const MESSAGE: Readonly<Record<Exclude<StatementRefusal, "unreadable">, string>> = Object.freeze({
  "invalid-request": "Not uploaded — reload the page and try again.",
  "not-finance": "Only Finance uploads the bank statement.",
  "file-type": "Upload the statement as a CSV file downloaded from net banking.",
  "too-large": "The statement is larger than 2 MB. Upload one week's CSV from net banking.",
  "too-many-refs": "The statement has too many lines to reconcile at once. Upload one week at a time.",
  "source-invalid": "Not reconciled — Zoho returned something the console cannot read. Digital Infrastructure has been told.",
});

const retryableKind = (k: string): boolean =>
  k === "network" || k === "server" || k === "busy" || k === "concurrency-exceeded" || k === "rate-limited-unclassified" || k === "unexpected";

/** IST calendar day of a Zoho datetime ("2026-09-01T00:00:00+05:30" → "2026-09-01"). */
export function istDayOf(zoho: string): string | null {
  const t = Date.parse(zoho);
  if (Number.isNaN(t)) return DAY.test(zoho) ? zoho.slice(0, 10) : null;
  return new Date(t + 5.5 * 3_600_000).toISOString().slice(0, 10);
}
const dayDiff = (a: string, b: string) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
/** Receipts.UTR as the statement prints it: uppercase A-Z0-9 only. */
export const utrKey = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const s = v.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return SAFE_REF.test(s) ? s : null;
};
/** Receipts.Amount (rupees, currency) → whole paise. */
const paiseOfAmount = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v * 100) : null);

/** The statement's name on its Zoho record: the ISO week of its last day, e.g. "Statement 2026-W40 (28 Sep–4 Oct)". */
export function statementName(from: string, to: string): string {
  const d = new Date(`${to}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const y = d.getUTCFullYear();
  const week = Math.ceil(((d.getTime() - Date.UTC(y, 0, 1)) / 86_400_000 + 1) / 7);
  const M = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const lab = (s: string) => `${+s.slice(8, 10)} ${M[+s.slice(5, 7) - 1]}`;
  return `Statement ${y}-W${String(week).padStart(2, "0")} (${lab(from)}–${lab(to)})`;
}

class Unreadable {}
class SourceFail { constructor(readonly kind: ZohoFailureKind | "unexpected") {} }

export function createStatements(deps: StatementDependencies) {
  if (!deps || typeof deps.crm?.coql !== "function" || typeof deps.store?.create !== "function" || typeof deps.store?.attach !== "function"
    || typeof deps.store?.remove !== "function" || typeof deps.store?.latest !== "function" || typeof deps.authority?.mayUpload !== "function"
    || typeof deps.log?.refusal !== "function" || typeof deps.recordIdPrefix !== "string" || !RECORD_PREFIX.test(deps.recordIdPrefix)) {
    throw new TypeError("Statements need crm.coql, the statement store, the upload authority, the ops log and the CRM record-id prefix.");
  }
  const { crm, store, authority, log } = deps;
  const clock = deps.clock ?? Date.now;
  const now = (): number => { try { return clock(); } catch { return 0; } };
  const validId = (v: unknown): v is string => typeof v === "string" && RECORD_ID.test(v) && v.startsWith(deps.recordIdPrefix);
  const idOf = (v: unknown): string | null => {
    const id = v && typeof v === "object" ? (v as { id?: unknown }).id : undefined;
    return validId(id) ? id : null;
  };
  const refuse = <T>(me: string, code: StatementRefusal, message?: string, ids: readonly string[] = [], row?: number): StatementResult<T> => {
    log.refusal({ at: now(), actor: { kind: "user", userId: me }, action: "statement-upload", reason: code, recordIds: ids.filter(validId) });
    return { ok: false, kind: "refused", reasonCode: code, message: message ?? MESSAGE[code as Exclude<StatementRefusal, "unreadable">], retryable: false, ...(row !== undefined ? { row } : {}) };
  };
  const sourceError = <T>(k: string, what: "reconciled" | "stored"): StatementResult<T> => ({
    ok: false, kind: "source-error", errorKind: k, retryable: retryableKind(k),
    message: retryableKind(k) ? `Not ${what} yet — Zoho is not answering. Upload again; nothing was kept.` : `Not ${what} — Zoho refused it.`,
  });
  const event = (me: string, action: string, reason: string, ids: readonly string[]) => {
    try { log.event?.({ at: now(), actor: { kind: "user", userId: me }, action, reason, recordIds: ids.filter(validId) }); } catch { /* never breaks the upload */ }
  };
  const principalOf = (principal: unknown): { cred: UserCredential; sid: string } | null => {
    const p = principal && typeof principal === "object" ? (principal as { credential?: unknown; sessionId?: unknown }) : null;
    return p && isUserCredential(p.credential) && typeof p.sessionId === "string" && SESSION_ID.test(p.sessionId) ? { cred: p.credential, sid: p.sessionId } : null;
  };
  const allowed = async (cred: UserCredential, sid: string, signal?: AbortSignal) => {
    try { return (await authority.mayUpload(cred, sid, signal)) === true; } catch { return false; }
  };

  /** Receipts whose UTR is one of `refs`, keyed by utrKey. On the caller's own token (D53). */
  async function receiptsByRef(cred: UserCredential, refs: readonly string[], signal?: AbortSignal): Promise<Map<string, ZohoRecord[]>> {
    const out = new Map<string, ZohoRecord[]>();
    for (let i = 0; i < refs.length; i += IN_LIMIT) {
      const chunk = refs.slice(i, i + IN_LIMIT);
      const r = await crm.coql(cred, `select ${RECEIPT_FIELDS} from ${RECEIPTS_MODULE} where UTR in (${chunk.map((x) => `'${x}'`).join(", ")}) limit 0, 2000`, { signal });
      if (!r.ok) throw new SourceFail(r.error.kind);
      if (r.value.invalidRecordIds || r.value.moreRecords) throw new Unreadable();
      for (const row of r.value.records) {
        const k = utrKey(row.UTR);
        if (!validId(row.id) || !k) throw new Unreadable();
        out.set(k, [...(out.get(k) ?? []), row]);
      }
    }
    return out;
  }

  async function reconcileLines(cred: UserCredential, lines: readonly StatementLine[], from: string, to: string, skipped: number, signal?: AbortSignal): Promise<Reconciliation> {
    const me = cred.userId;
    const refs = [...new Set(lines.flatMap((l) => l.refs.slice(0, REFS_PER_LINE)).filter((r) => SAFE_REF.test(r)))];
    if (refs.length > IN_LIMIT * MAX_REF_QUERIES) throw new RangeError("too-many-refs");
    const byRef = refs.length ? await receiptsByRef(cred, refs, signal) : new Map<string, ZohoRecord[]>();
    const used = new Set<string>();
    const matched: MatchedLine[] = [], needsOwner: OwnerLine[] = [];
    for (const l of lines) {
      const owner = (o: Owner, reason: OwnerReason, receiptId: string | null = null, utr: string | null = l.refs[0] ?? null) =>
        needsOwner.push(Object.freeze({ line: l.line, date: l.date, direction: l.direction, amountPaise: l.amountPaise, utr, narration: l.narration, owner: o, reason, receiptId }));
      let ref: string | null = null, candidates: ZohoRecord[] = [];
      for (const r of l.refs.slice(0, REFS_PER_LINE)) { const c = byRef.get(r); if (c?.length) { ref = r; candidates = c; break; } }
      if (!ref) { owner(l.direction === "credit" ? "finance-operations" : "head-of-finance", l.direction === "credit" ? "no-receipt" : "debit-no-receipt"); continue; }
      // Of the receipts on this reference, prefer the one agreeing on everything.
      const fits = (x: ZohoRecord) => {
        const kind = typeof x.Kind === "string" ? x.Kind : "";
        const dirOk = l.direction === "credit" ? INBOUND.has(kind) : kind === "Refund";
        const amtOk = paiseOfAmount(x.Amount) === l.amountPaise;
        const day = typeof x.Received_On === "string" ? istDayOf(x.Received_On) : null;
        const dateOk = day !== null && dayDiff(day, l.date) <= DATE_SLACK_DAYS;
        return { dirOk, amtOk, dateOk, all: dirOk && amtOk && dateOk };
      };
      const best = candidates.find((x) => fits(x).all && !used.has(x.id)) ?? candidates.find((x) => !used.has(x.id)) ?? candidates[0]!;
      const f = fits(best);
      if (used.has(best.id)) { owner("head-of-finance", "duplicate-line", best.id, ref); continue; }
      if (!f.dirOk) { owner("head-of-finance", "kind-differs", best.id, ref); continue; }
      if (!f.amtOk) { owner("head-of-finance", "amount-differs", best.id, ref); continue; }
      if (!f.dateOk) { owner("head-of-finance", "date-differs", best.id, ref); continue; }
      const state = best.Match_State;
      if (state === "Claimed") { owner("finance-operations", "receipt-claimed", best.id, ref); continue; }
      if (state === "Not found") { owner("head-of-finance", "receipt-not-found", best.id, ref); continue; }
      if (state === "Reversed") { owner("head-of-finance", "receipt-reversed", best.id, ref); continue; }
      if (state !== "Matched" && state !== "Pending") throw new Unreadable();
      used.add(best.id);
      matched.push(Object.freeze({
        line: l.line, date: l.date, direction: l.direction, amountPaise: l.amountPaise, utr: ref, receiptId: best.id, kind: String(best.Kind),
        state: state === "Matched" ? "matched" as const : "awaiting-match" as const,
        matchedBy: state === "Matched" ? idOf(best.Matched_By) : null,
        recordedByYou: idOf(best.Created_By) === me,
      }));
    }
    return Object.freeze({
      from, to, matched: Object.freeze(matched), needsOwner: Object.freeze(needsOwner),
      counts: Object.freeze({
        lines: lines.length, matched: matched.length, awaitingMatch: matched.filter((m) => m.state === "awaiting-match").length,
        needsOwner: needsOwner.length, debits: lines.filter((l) => l.direction === "debit").length, skipped,
      }),
    });
  }

  return Object.freeze({
    /**
     * "Upload the bank statement". file: { name, type, bytes } — the request's bytes, held for this call only.
     * The answer lists every line: matched (or awaiting the Head of Finance's match) and "needs an owner".
     */
    async upload(principal: unknown, file: unknown, signal?: AbortSignal): Promise<StatementResult<UploadView>> {
      const p = principalOf(principal);
      if (!p) return refuse("unrecognised", "invalid-request");
      const { cred, sid } = p, me = cred.userId;
      if (!(await allowed(cred, sid, signal))) return refuse(me, "not-finance");
      const f = file && typeof file === "object" ? (file as { name?: unknown; type?: unknown; bytes?: unknown }) : null;
      if (!f || typeof f.name !== "string" || !(f.bytes instanceof Uint8Array)) return refuse(me, "invalid-request");
      const name = f.name.trim();
      if (!FILE_NAME.test(name) || !FILE_TYPES.has(typeof f.type === "string" ? f.type.toLowerCase().split(";")[0]!.trim() : "")) return refuse(me, "file-type");
      if (f.bytes.byteLength > MAX_STATEMENT_BYTES) return refuse(me, "too-large");
      const parsed = parseStatement(f.bytes);
      if (!parsed.ok) return refuse(me, "unreadable", parsed.message, [], parsed.row);
      const s = parsed.value;

      let rec: Reconciliation;
      try { rec = await reconcileLines(cred, s.lines, s.from, s.to, s.skipped, signal); }
      catch (e) {
        if (e instanceof RangeError) return refuse(me, "too-many-refs");
        if (e instanceof Unreadable) return refuse(me, "source-invalid");
        if (e instanceof SourceFail) return sourceError(e.kind, "reconciled");
        return sourceError("unexpected", "reconciled");
      }

      const title = statementName(s.from, s.to);
      let created: Awaited<ReturnType<StatementStore["create"]>>;
      try { created = await store.create(cred, { name: title, from: s.from, to: s.to, lines: rec.counts.lines, matched: rec.counts.matched, needsOwner: rec.counts.needsOwner }, signal); }
      catch { created = { ok: false, code: "unexpected" }; }
      if (!created.ok) { event(me, "statement-upload", `not-stored.${created.code}`.slice(0, 64), []); return sourceError(created.errorKind ?? created.code, "stored"); }
      let attached: Awaited<ReturnType<StatementStore["attach"]>>;
      try { attached = await store.attach(cred, created.id, { fileName: name, bytes: f.bytes }, signal); }
      catch { attached = { ok: false, code: "unexpected" }; }
      if (!attached.ok) {
        let removed = false;
        try { removed = (await store.remove(cred, created.id, signal)).ok; } catch { removed = false; }
        event(me, "statement-upload", `file-not-attached.${removed ? "record-removed" : "record-left"}`, [created.id]);
        return sourceError(attached.errorKind ?? attached.code, "stored");
      }
      event(me, "statement-upload", `lines-${rec.counts.lines}.matched-${rec.counts.matched}.owner-${rec.counts.needsOwner}`, [created.id]);
      return { ok: true, value: Object.freeze({ ...rec, statementId: created.id, attachmentId: attached.attachmentId, name: title }) };
    },

    /** The last statement uploaded: "last reconciled <when>" on the Payments page (TC-IM05-019). */
    async latest(principal: unknown, signal?: AbortSignal): Promise<StatementResult<StatementSummary | null>> {
      const p = principalOf(principal);
      if (!p) return refuse("unrecognised", "invalid-request");
      if (!(await allowed(p.cred, p.sid, signal))) return refuse(p.cred.userId, "not-finance");
      let r: Awaited<ReturnType<StatementStore["latest"]>>;
      try { r = await store.latest(p.cred, signal); } catch { r = { ok: false, code: "unexpected" }; }
      if (!r.ok) return sourceError(r.errorKind ?? r.code, "reconciled");
      return { ok: true, value: r.value };
    },
  });
}
export type Statements = ReturnType<typeof createStatements>;

/* ---- the Zoho store (for when M10-S05-T01 makes the module) ------------------------------------------ */

/** Proposed Statements fields (Sahil, M10-S05-T01): Name, Period_From (date), Period_To (date), Lines, Lines_Matched,
 *  Lines_Needs_Owner (integers), Attachments on; Finance-only profile access. */
export const STATEMENT_FIELDS = Object.freeze(["Name", "Period_From", "Period_To", "Lines", "Lines_Matched", "Lines_Needs_Owner", "Created_Time"]);

export function createZohoStatementStore(o: {
  readonly crm: Pick<ZohoClient, "insert" | "coql" | "uploadAttachment" | "deleteRecord">;
  readonly recordIdPrefix: string;
  readonly module?: string;
}): StatementStore {
  const module = o.module ?? STATEMENTS_MODULE;
  const validId = (v: unknown): v is string => typeof v === "string" && RECORD_ID.test(v) && v.startsWith(o.recordIdPrefix);
  const int = (v: unknown) => (typeof v === "number" && Number.isSafeInteger(v) ? v : null);
  const str = (v: unknown) => (typeof v === "string" && v !== "" ? v : null);
  const store: StatementStore = {
    async create(cred, f, signal) {
      const r = await o.crm.insert(cred, module, [{
        Name: f.name, Period_From: f.from, Period_To: f.to, Lines: f.lines, Lines_Matched: f.matched, Lines_Needs_Owner: f.needsOwner,
      }], { signal });
      if (!r.ok) return { ok: false as const, code: r.error.kind, errorKind: r.error.kind };
      const first = r.value[0];
      return first?.ok && validId(first.id) ? { ok: true as const, id: first.id } : { ok: false as const, code: "invalid-data", errorKind: "invalid-data" as const };
    },
    async attach(cred, id, file, signal) {
      // D71: one file per call, multipart "file", on the uploader's own token; text/csv is an allowed upload type.
      let r: Awaited<ReturnType<ZohoClient["uploadAttachment"]>>;
      try { r = await o.crm.uploadAttachment(cred, module, id, { fileName: file.fileName, contentType: "text/csv", bytes: file.bytes }, { signal }); }
      catch { return { ok: false as const, code: "upload-refused", errorKind: "unexpected" as const }; }
      return r.ok ? { ok: true as const, attachmentId: r.value.attachmentId } : { ok: false as const, code: r.error.kind as string, errorKind: r.error.kind };
    },
    async remove(cred, id, signal) {
      try { const r = await o.crm.deleteRecord(cred, module, id, { signal }); return { ok: r.ok }; } catch { return { ok: false }; }
    },
    async latest(cred, signal) {
      const r = await o.crm.coql(cred, `select ${STATEMENT_FIELDS.join(", ")} from ${module} where Created_Time is not null order by Created_Time desc limit 0, 1`, { signal });
      if (!r.ok) {
        if (r.error.kind === "not-found") return { ok: true as const, value: null };
        return { ok: false as const, code: r.error.kind, errorKind: r.error.kind };
      }
      const x = r.value.records[0];
      if (!x) return { ok: true as const, value: null };
      if (!validId(x.id)) return { ok: false as const, code: "invalid-data", errorKind: "invalid-data" as const };
      return { ok: true as const, value: Object.freeze({
        statementId: x.id, name: str(x.Name) ?? "", from: str(x.Period_From), to: str(x.Period_To),
        lines: int(x.Lines), matched: int(x.Lines_Matched), needsOwner: int(x.Lines_Needs_Owner), reconciledAt: str(x.Created_Time),
      }) };
    },
  };
  return Object.freeze(store);
}
