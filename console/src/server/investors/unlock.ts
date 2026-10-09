/**
 * M10-S21-T02 — UNLOCK THE INVESTOR APP AND SEND THE WELCOME FROM THE CONSOLE (D10, D73, D93).
 *
 * The App account card on the investor record, read and written live on the person's own token (D53):
 *   card    — Contacts.App_Access (Hold | Invite), App_Welcome_At / App_Welcome_Channel (written back by the
 *             investor app's sync, never by the console) and the record's timeline (who changed App_Access,
 *             when — ids only; the timeline parse drops values). What the card reads is worked out from
 *             those facts, the same lines the front-end's accessView draws:
 *               no App_Access                          → NO_ACCOUNT_TEXT (created On hold; locked until released)
 *               Hold, never invited                    → "On hold — data synced, sign-in locked, no email sent"
 *               Hold after an invite (locked again)    → "Locked — sign-in blocked"
 *               Invite, no welcome since the unlock    → "Welcome sending…"
 *               Invite, App_Welcome_At after the unlock → "Welcome delivered <time> · <channel>"
 *   unlock  — "Send welcome and unlock": App_Access Hold → Invite, one guarded write (If-Unmodified-Since, D44).
 *             The console sends no mail: the investor app's zoho-crm-webhook (v36) sees Invite and sends the one
 *             welcome, then writes App_Welcome_At back (D73). Only App_Access is written (PROVISIONAL, jev 0.81:
 *             App_Welcome_* keep their one writer, the app sync).
 *   lock    — "Lock app access" with a reason: App_Access Invite → Hold, guarded, then the reason goes on the
 *             record as a Note on the Contact under the person's own name (it shows on their Activity). There is
 *             no Locked_Reason field in Zoho; a failed Note is reported, the lock stands.
 *
 * App_Access is a same-org field under D52: the investor app reads it through its own Zoho webhook, so no
 * contract event is pushed from here (contracts/ holds no console → app access event; server/contracts/events
 * is left as is). The welcome never goes out by itself: nothing here sets Invite except the button.
 *
 * D115 ruling 1: this unlock is THE release — the one console path that moves App_Access to Invite. Every account
 * is created Hold (add-paid at creation; money/match.ts only into an empty field) and a match never opens it.
 * Each release writes one ops-log line (Plane B, `app-access` / `unlocked`, the releaser and the Contact id only) and,
 * M08-S08-NOTE-10, one Plane C authority line (`app-access-released`: who, seat, the Contact id, ok / refused + code).
 *
 * G2 (owner workflow, 8 Oct; D136 proposed): the release opens only after the 10% is verified — at least one MATCHED Advance or
 * Full receipt on one of the investor's live (not Cancelled) allotments, read on the releaser's own token (Receipts ← allotment
 * ← Customer, as money/match reads it). Without one the unlock is refused (`ten-percent-not-verified`) and the card says why; a
 * read that fails or cannot be trusted refuses too (`ten-percent-unknown`) — never an unlock on an unknown.
 * GC-1526: Finance Operations and the Head of Finance (only — `authority.mayOverride`) may unlock without it, with a typed reason
 * (>= OVERRIDE_REASON_MIN characters) and an explicit confirmation. The reason is written FIRST, as a Note on the Contact under
 * their own name (no note, no unlock; an unlock that then fails takes the note back), then the guarded Hold → Invite; one ops-log
 * line (`app-access` / `override-unlocked`) and one Plane C line (`app-access-override`, beside the `app-access-released` one).
 * Other seats never see the override (`mayOverride: false` on the card) and are refused it.
 *
 * Idempotent: unlocking an invited account, or locking a held one, changes nothing and answers `already`.
 * Finance (Head of Finance, Finance Operations, the super user) controls this; every other seat reads the card
 * with `mayChange: false` ("Finance controls app access"). Logs carry ids and codes only — never the reason.
 */

import type { TimelineEntry, UserCredential, ZohoClient, ZohoRecord } from "../../lib/zoho/client";
import { isUserCredential } from "../../lib/zoho/client";
import type { ZohoFailureKind } from "../../lib/zoho/errors";
import type { OpsLog } from "../../lib/zoho/log";
import type { InvestorEvents } from "../data/events";
import { NOT_OVERRIDE_TEXT, OVERRIDE_REASON_MIN, TEN_PERCENT_KINDS, TEN_PERCENT_TEXT, TEN_PERCENT_UNKNOWN_TEXT, overrideReasonShort } from "../../lib/im/app-gate";

export const CONTACTS_MODULE = "Contacts";
export const APP_ACCESS_FIELD = "App_Access";
export const APP_ACCESS_FIELDS = Object.freeze(["ARL_ID", APP_ACCESS_FIELD, "App_Welcome_At", "App_Welcome_Channel", "Modified_Time"]);
/** M08-S08-T03: the account's mark, written once by money/match at the first matched receipt (Tentative, App_Mark_At = that time). */
export const APP_MARK_FIELDS = Object.freeze(["App_Account_Mark", "App_Mark_At"]);
export const LOCK_REASON_MAX = 500;
export const ALLOTMENTS_MODULE = "LLP_UnitAllocation_Module";
export const RECEIPTS_MODULE = "Receipts";
/* G2 / GC-1526: the gate's words and limits are shared with the card (lib/im/app-gate — values only, client-safe). */
export { NOT_OVERRIDE_TEXT, OVERRIDE_REASON_MIN, TEN_PERCENT_KINDS, TEN_PERCENT_TEXT, TEN_PERCENT_UNKNOWN_TEXT } from "../../lib/im/app-gate";
/** D115 ruling 1: what the card says before any account exists — it is created On hold and waits for the release. */
export const NO_ACCOUNT_TEXT = "No account yet — it is created On hold, and sign-in stays locked until Finance presses Send welcome and unlock";
const RECORD_ID = /^\d{15,22}$/;
const RECORD_PREFIX = /^\d{6,16}$/;
const SESSION_ID = /^[A-Za-z0-9_-]{16,128}$/;
const ZOHO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/;
const CHANNELS: ReadonlySet<string> = new Set(["Email", "WhatsApp", "SMS", "App push"]);

export type AppAccess = "Hold" | "Invite";
export type AppCardState = "none" | "hold" | "locked" | "sending" | "delivered";

export interface AppAccessChange { readonly at: string; readonly byId: string | null }

export interface AppAccessCard {
  readonly contactId: string;
  readonly code: string | null;
  readonly access: AppAccess | null;
  readonly state: AppCardState;
  /** the line the card reads (times in Asia/Kolkata) */
  readonly text: string;
  readonly welcomeAt: string | null;
  readonly welcomeChannel: string | null;
  /** send back as expectedModifiedTime on unlock / lock (D44) */
  readonly modifiedTime: string | null;
  /** M08-S08-T03: App_Account_Mark as Zoho holds it (null: empty, or Zoho would not read the field) and App_Mark_At */
  readonly mark: "Tentative" | "Permanent" | null;
  readonly markAt: string | null;
  /** when the account opened: the oldest App_Access change on the timeline, else the mark's time */
  readonly openedAt: string | null;
  /** App_Access changes, newest first, from the Zoho timeline: who and when (for Activity) */
  readonly history: readonly AppAccessChange[];
  /** false: read-only, "Finance controls app access" */
  readonly mayChange: boolean;
  /** null when the timeline could not be read: the card still stands, the history is unknown */
  readonly historyRead: boolean;
  /** G2: is the 10% verified (a matched Advance/Full receipt)? Read only while the account is on Hold and for a person who may
   *  release it (null otherwise); "unknown" = the receipts could not be read. */
  readonly tenPercent: TenPercent | null;
  /** GC-1526: may this person unlock without the 10% (Finance Operations, Head of Finance)? Every other seat: false. */
  readonly mayOverride: boolean;
}
export type TenPercent = "verified" | "not-verified" | "unknown";

/** `seat`: the console seat token of the session (for the Plane C line); the right itself is re-derived by `authority`. */
export interface AppAccessPrincipal { readonly credential: UserCredential; readonly sessionId: string; readonly seat?: string | null }
export interface AppAccessAuthority {
  /** Re-derived from the live session: may this person change app access (Finance, super user)? */
  mayChange(credential: UserCredential, sessionId: string, signal?: AbortSignal): Promise<boolean>;
  /** GC-1526: may this person unlock without a verified 10% (Finance Operations, Head of Finance — never another seat)? Absent: nobody. */
  mayOverride?(credential: UserCredential, sessionId: string, signal?: AbortSignal): Promise<boolean>;
}

export type AppAccessRefusal =
  | "invalid-request"
  | "not-finance"
  | "not-visible"
  | "no-account"
  | "reason-required"
  | "changed"
  | "ten-percent-not-verified"
  | "ten-percent-unknown"
  | "not-override"
  | "override-reason-short"
  | "confirm-needed"
  | "note-failed";

export type AppAccessResult =
  | { readonly ok: true; readonly value: AppAccessCard; readonly already: boolean; readonly noteSaved?: boolean }
  | { readonly ok: false; readonly kind: "refused"; readonly reasonCode: AppAccessRefusal; readonly message: string; readonly retryable: false }
  | { readonly ok: false; readonly kind: "source-error"; readonly errorKind: ZohoFailureKind | "unexpected"; readonly message: string; readonly retryable: boolean };

export interface AppAccessDependencies {
  readonly crm: Pick<ZohoClient, "getRecord" | "update" | "insert" | "timeline" | "coql"> & Partial<Pick<ZohoClient, "deleteRecord">>;
  readonly authority: AppAccessAuthority;
  readonly log: OpsLog;
  /** M08-S08-NOTE-10: Plane C — each release (and each refused release) is an authority line (data/events.ts). */
  readonly events: Pick<InvestorEvents, "appAccessReleased"> & Partial<Pick<InvestorEvents, "appAccessOverride">>;
  readonly recordIdPrefix: string;
  readonly clock?: () => number;
}

export interface AppAccessService {
  card(principal: AppAccessPrincipal, contactId: unknown, signal?: AbortSignal): Promise<AppAccessResult>;
  unlock(principal: AppAccessPrincipal, contactId: unknown, expectedModifiedTime?: unknown, signal?: AbortSignal): Promise<AppAccessResult>;
  lock(principal: AppAccessPrincipal, contactId: unknown, reason: unknown, expectedModifiedTime?: unknown, signal?: AbortSignal): Promise<AppAccessResult>;
  /** GC-1526: "Unlock without the 10%" — a typed reason and `confirmed: true` (the page's own confirmation step). */
  overrideUnlock(principal: AppAccessPrincipal, contactId: unknown, reason: unknown, confirmed: unknown, expectedModifiedTime?: unknown, signal?: AbortSignal): Promise<AppAccessResult>;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** A Zoho datetime as the card prints it, in Asia/Kolkata: "28 Sep 14:05". */
export function istLabel(zoho: string): string {
  const t = Date.parse(zoho);
  if (Number.isNaN(t)) return zoho;
  const d = new Date(t + 5.5 * 3_600_000);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

/** What the card reads, from the Contact's fields and its App_Access history (newest first). */
export function cardState(access: AppAccess | null, welcomeAt: string | null, channel: string | null, history: readonly AppAccessChange[])
  : { readonly state: AppCardState; readonly text: string } {
  if (!access) return { state: "none", text: NO_ACCOUNT_TEXT };
  const lastChange = history[0] ? Date.parse(history[0].at) : NaN;
  const welcomed = welcomeAt !== null && !Number.isNaN(Date.parse(welcomeAt));
  if (access === "Hold") {
    // Hold after an invite: a welcome was delivered once, or App_Access has moved more than the one open.
    return welcomed || history.length >= 2
      ? { state: "locked", text: "Locked — sign-in blocked" }
      : { state: "hold", text: "On hold — data synced, sign-in locked, no email sent" };
  }
  if (!welcomed || (!Number.isNaN(lastChange) && Date.parse(welcomeAt!) < lastChange)) return { state: "sending", text: "Welcome sending…" };
  return { state: "delivered", text: "Welcome delivered " + istLabel(welcomeAt!) + " · " + (channel || "Email") };
}

class SourceFail { constructor(readonly kind: ZohoFailureKind | "unexpected") {} }
const idOfRef = (v: unknown): string | null => {
  if (typeof v === "string" && RECORD_ID.test(v)) return v;
  const id = v && typeof v === "object" ? (v as { id?: unknown }).id : undefined;
  return typeof id === "string" && RECORD_ID.test(id) ? id : null;
};
const retryableKind = (k: string): boolean =>
  k === "network" || k === "server" || k === "busy" || k === "concurrency-exceeded" || k === "rate-limited-unclassified" || k === "unexpected";

export function createAppAccess(deps: AppAccessDependencies): AppAccessService {
  if (!deps || typeof deps.crm?.getRecord !== "function" || typeof deps.crm?.update !== "function" || typeof deps.crm?.insert !== "function"
    || typeof deps.crm?.timeline !== "function" || typeof deps.crm?.coql !== "function" || typeof deps.authority?.mayChange !== "function" || typeof deps.log?.refusal !== "function" || typeof deps.events?.appAccessReleased !== "function"
    || typeof deps.recordIdPrefix !== "string" || !RECORD_PREFIX.test(deps.recordIdPrefix)) {
    throw new TypeError("app access needs crm (getRecord/update/insert/timeline/coql), the Finance authority, the ops log, the Plane C events and the record-id prefix");
  }
  const { crm, log } = deps;
  const clock = deps.clock ?? Date.now;
  const validId = (v: unknown): v is string => typeof v === "string" && RECORD_ID.test(v) && v.startsWith(deps.recordIdPrefix);
  const note = (userId: string, reason: string, ids: readonly unknown[] = []) => {
    let at = 0;
    try { at = clock(); } catch { /* still logged */ }
    log.refusal({ at, actor: { kind: "user", userId }, action: "app-access", reason, recordIds: ids.filter(validId) });
  };
  const refuse = (userId: string, reasonCode: AppAccessRefusal, message: string, ids: readonly unknown[] = []): AppAccessResult => {
    note(userId, reasonCode, ids);
    return { ok: false, kind: "refused", reasonCode, message, retryable: false };
  };
  const refuseB = refuse;
  const released = (p: AppAccessPrincipal, contactId: unknown, outcome: "ok" | "refused", reason: string) => {
    try { deps.events.appAccessReleased(p.credential.userId, p.seat ?? null, validId(contactId) ? contactId : "", outcome, reason); } catch { /* never take the release down */ }
  };
  const failed = (kind: ZohoFailureKind | "unexpected"): AppAccessResult => ({
    ok: false, kind: "source-error", errorKind: kind, message: "Not changed — Zoho is not answering. Try again.", retryable: retryableKind(kind),
  });
  const trusted = (p: unknown): AppAccessPrincipal | null => {
    const c = p && typeof p === "object" ? (p as { credential?: unknown; sessionId?: unknown }) : null;
    const seat = (c as { seat?: unknown } | null)?.seat;
    return c && isUserCredential(c.credential) && typeof c.sessionId === "string" && SESSION_ID.test(c.sessionId)
      ? { credential: c.credential, sessionId: c.sessionId, seat: typeof seat === "string" ? seat : null } : null;
  };
  const mayChange = async (p: AppAccessPrincipal, signal?: AbortSignal): Promise<boolean> => {
    try { return (await deps.authority.mayChange(p.credential, p.sessionId, signal)) === true; } catch { return false; }
  };
  const mayOverride = async (p: AppAccessPrincipal, signal?: AbortSignal): Promise<boolean> => {
    if (typeof deps.authority.mayOverride !== "function") return false;
    try { return (await deps.authority.mayOverride(p.credential, p.sessionId, signal)) === true; } catch { return false; }
  };
  const overrideLine = (p: AppAccessPrincipal, contactId: unknown, outcome: "ok" | "refused", reason: string) => {
    try { deps.events.appAccessOverride?.(p.credential.userId, p.seat ?? null, validId(contactId) ? contactId : "", outcome, reason); } catch { /* never blocks */ }
  };

  /** G2: a matched Advance or Full receipt on one of the investor's live allotments (the 10%), on the person's own token. A read
   *  that fails, is cut short or names a record it cannot read is "unknown" — never "not verified", never "verified". */
  const tenPercent = async (cred: UserCredential, contactId: string, signal?: AbortSignal): Promise<TenPercent> => {
    try {
      const a = await crm.coql(cred, `select id, Customer, Allocation_Status from ${ALLOTMENTS_MODULE} where Customer = '${contactId}' limit 0, 100`, { signal });
      if (!a.ok || a.value.invalidRecordIds || a.value.moreRecords) return "unknown";
      if (a.value.records.some((r) => !validId(r.id))) return "unknown";
      const live = a.value.records.filter((r) => r.Allocation_Status !== "Cancelled" && (idOfRef(r.Customer) ?? contactId) === contactId).map((r) => r.id);
      if (!live.length) return "not-verified";
      const r = await crm.coql(cred, `select id, Allotment, Kind, Match_State from ${RECEIPTS_MODULE} where Allotment in (${live.map((x) => `'${x}'`).join(", ")}) and Match_State = 'Matched' limit 0, 200`, { signal });
      if (!r.ok || r.value.invalidRecordIds) return "unknown";
      const hit = r.value.records.some((x) => x.Match_State === "Matched" && typeof x.Kind === "string" && TEN_PERCENT_KINDS.has(x.Kind)
        && live.includes(idOfRef(x.Allotment) ?? ""));
      return hit ? "verified" : r.value.moreRecords ? "unknown" : "not-verified";
    } catch { return "unknown"; }
  };

  const readContact = async (cred: UserCredential, id: string, signal?: AbortSignal): Promise<ZohoRecord | null> => {
    let r = await crm.getRecord(cred, CONTACTS_MODULE, id, { fields: [...APP_ACCESS_FIELDS, ...APP_MARK_FIELDS], signal });
    /* PROVISIONAL: if Zoho refuses a mark field (App_Mark_At may not exist yet) the card still stands, without the mark */
    if (!r.ok && r.error.kind !== "not-found" && r.error.kind !== "forbidden") r = await crm.getRecord(cred, CONTACTS_MODULE, id, { fields: APP_ACCESS_FIELDS, signal });
    if (!r.ok) {
      if (r.error.kind === "not-found" || r.error.kind === "forbidden") return null;
      throw new SourceFail(r.error.kind);
    }
    return r.value && r.value.id === id ? r.value : null;
  };
  const history = async (cred: UserCredential, id: string, signal?: AbortSignal): Promise<readonly AppAccessChange[] | null> => {
    try {
      const r = await crm.timeline(cred, CONTACTS_MODULE, id, { perPage: 100, signal });
      if (!r.ok) return null;
      return r.value.entries
        .filter((e: TimelineEntry) => e.fields.includes(APP_ACCESS_FIELD) && !Number.isNaN(Date.parse(e.at)))
        .map((e) => Object.freeze({ at: e.at, byId: e.byId }))
        .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    } catch { return null; }
  };
  const view = (rec: ZohoRecord, hist: readonly AppAccessChange[] | null, may: boolean, ten: TenPercent | null = null, override = false): AppAccessCard => {
    const raw = rec[APP_ACCESS_FIELD];
    const access: AppAccess | null = raw === "Hold" || raw === "Invite" ? raw : null;
    const welcomeAt = typeof rec.App_Welcome_At === "string" && ZOHO_DATETIME.test(rec.App_Welcome_At) ? rec.App_Welcome_At : null;
    const welcomeChannel = typeof rec.App_Welcome_Channel === "string" && CHANNELS.has(rec.App_Welcome_Channel) ? rec.App_Welcome_Channel : null;
    const h = hist ?? [];
    const s = cardState(access, welcomeAt, welcomeChannel, h);
    const mark = rec.App_Account_Mark === "Tentative" || rec.App_Account_Mark === "Permanent" ? rec.App_Account_Mark : null;
    const markAt = typeof rec.App_Mark_At === "string" && (ZOHO_DATETIME.test(rec.App_Mark_At) || /^\d{4}-\d{2}-\d{2}$/.test(rec.App_Mark_At)) ? rec.App_Mark_At : null;
    return Object.freeze({
      contactId: rec.id,
      code: typeof rec.ARL_ID === "string" && /^ARL-INV-\d{4}$/.test(rec.ARL_ID) ? rec.ARL_ID : null,
      access, state: s.state, text: s.text, welcomeAt, welcomeChannel, mark, markAt, openedAt: h.length ? h[h.length - 1]!.at : markAt,
      modifiedTime: typeof rec.Modified_Time === "string" && ZOHO_DATETIME.test(rec.Modified_Time) ? rec.Modified_Time : null,
      history: Object.freeze([...h]), mayChange: may, historyRead: hist !== null,
      tenPercent: access === "Hold" ? ten : null, mayOverride: may && override,
    });
  };

  /** Hold ↔ Invite, guarded; `from` is the state the button was pressed on. */
  /** `override` (GC-1526): the reason note is written before the release, and the 10% gate is waived only when the 10% is really
   *  missing — a verified one releases as a plain unlock, with no note and no override line. */
  const change = async (p: AppAccessPrincipal, contactId: unknown, from: AppAccess, to: AppAccess, expected: unknown, signal: AbortSignal | undefined,
    after?: (id: string) => Promise<boolean>, override?: { readonly writeNote: (id: string) => Promise<string | null> }): Promise<AppAccessResult> => {
    const me = p.credential.userId;
    /* M08-S08-NOTE-10: a release's refusals are also Plane C authority lines (a lock is not a release) */
    const refuse = (userId: string, reasonCode: AppAccessRefusal, message: string, ids: readonly unknown[] = []): AppAccessResult => {
      if (to === "Invite") released(p, contactId, "refused", reasonCode);
      if (override) overrideLine(p, contactId, "refused", reasonCode);
      return refuseB(userId, reasonCode, message, ids);
    };
    if (!validId(contactId)) return refuse(me, "invalid-request", "Not changed — open the investor again.");
    if (expected !== undefined && expected !== null && (typeof expected !== "string" || !ZOHO_DATETIME.test(expected))) {
      return refuse(me, "invalid-request", "Not changed — reload the investor and try again.", [contactId]);
    }
    if (!(await mayChange(p, signal))) return refuse(me, "not-finance", "Finance controls app access.", [contactId]);
    let rec: ZohoRecord | null;
    try { rec = await readContact(p.credential, contactId, signal); } catch (e) { return failed(e instanceof SourceFail ? e.kind : "unexpected"); }
    if (!rec) return refuse(me, "not-visible", "Not changed — this investor is not visible to you.", [contactId]);
    const now = rec[APP_ACCESS_FIELD];
    if (now !== "Hold" && now !== "Invite") return refuse(me, "no-account", NO_ACCOUNT_TEXT + ".", [contactId]);
    const modified = typeof rec.Modified_Time === "string" && ZOHO_DATETIME.test(rec.Modified_Time) ? rec.Modified_Time : null;
    if (now === to) {
      // Already there (a second press, a retry): nothing to write.
      return { ok: true, value: view(rec, await history(p.credential, contactId, signal), true), already: true };
    }
    if (now !== from) return refuse(me, "changed", "Not changed — someone changed this investor's app access. Reload and look again.", [contactId]);
    if (typeof expected === "string" && modified && expected !== modified) {
      return refuse(me, "changed", "Not changed — this investor changed since you opened them. Reload and look again.", [contactId]);
    }
    /* G2: the release waits for the 10% (a matched Advance or Full receipt); GC-1526 waives it with a recorded reason */
    let noteId: string | null = null;
    if (to === "Invite") {
      const ten = await tenPercent(p.credential, contactId, signal);
      if (ten === "unknown") return refuse(me, "ten-percent-unknown", TEN_PERCENT_UNKNOWN_TEXT, [contactId]);
      if (ten === "not-verified") {
        if (!override) return refuse(me, "ten-percent-not-verified", TEN_PERCENT_TEXT, [contactId]);
        noteId = await override.writeNote(contactId).catch(() => null);
        if (!noteId) return refuse(me, "note-failed", "Not unlocked — the reason could not be written on the investor's record, so nothing was changed. Try again.", [contactId]);
      }
    }
    const takeNoteBack = async () => {
      if (!noteId) return;
      try {
        const d = typeof crm.deleteRecord === "function" ? await crm.deleteRecord(p.credential, "Notes", noteId, { signal }) : null;
        if (!d || !d.ok) note(me, "override-note-left", [contactId, noteId]);
      } catch { note(me, "override-note-left", [contactId, noteId]); }
    };
    const w = await crm.update(p.credential, CONTACTS_MODULE, contactId, { [APP_ACCESS_FIELD]: to }, { ifUnmodifiedSince: (expected as string | undefined) ?? modified, signal })
      .catch(() => ({ ok: false as const, error: { kind: "unexpected" as const, status: 0, code: "THROWN" }, creditsRemaining: null }));
    if (!w.ok) await takeNoteBack();
    if (!w.ok) {
      if (w.error.kind === "conflict") return refuse(me, "changed", "Not changed — this investor changed since you opened them. Reload and look again.", [contactId]);
      if (w.error.kind === "not-found" || w.error.kind === "forbidden") return refuse(me, "not-visible", "Not changed — this investor is not visible to you.", [contactId]);
      note(me, "write-failed-" + w.error.kind, [contactId]);
      return failed(w.error.kind);
    }
    const noteSaved = after ? await after(contactId).catch(() => false) : undefined;
    const overridden = !!override && noteId !== null;
    note(me, to === "Invite" ? (overridden ? "override-unlocked" : "unlocked") : "locked", overridden ? [contactId, noteId] : [contactId]);
    if (to === "Invite") released(p, contactId, "ok", overridden ? "override" : "released");
    if (overridden) overrideLine(p, contactId, "ok", "ten-percent-waived");
    // Read back what Zoho holds now; if that read fails, answer from the write.
    let fresh: ZohoRecord | null = null;
    try { fresh = await readContact(p.credential, contactId, signal); } catch { fresh = null; }
    const base: ZohoRecord = fresh ?? { ...rec, [APP_ACCESS_FIELD]: to, Modified_Time: w.value.modifiedTime ?? modified };
    let hist = await history(p.credential, contactId, signal);
    if (hist && !hist.some((h) => w.value.modifiedTime && h.at === w.value.modifiedTime)) {
      // The timeline can lag the write: count this change so the card reads right straight away.
      hist = [{ at: w.value.modifiedTime ?? new Date(clock()).toISOString(), byId: me }, ...hist];
    }
    return { ok: true, value: view(base, hist, true, null, await mayOverride(p, signal)), already: false,
      ...(noteSaved !== undefined ? { noteSaved } : overridden ? { noteSaved: true } : {}) };
  };

  const service: AppAccessService = {
    async card(principal, contactId, signal) {
      const p = trusted(principal);
      if (!p) { note("unrecognised", "invalid-request"); return { ok: false, kind: "refused", reasonCode: "invalid-request", message: "Sign in again.", retryable: false }; }
      if (!validId(contactId)) return refuse(p.credential.userId, "invalid-request", "Open the investor again.");
      let rec: ZohoRecord | null;
      try { rec = await readContact(p.credential, contactId, signal); } catch (e) { return failed(e instanceof SourceFail ? e.kind : "unexpected"); }
      if (!rec) return refuse(p.credential.userId, "not-visible", "This investor is not visible to you.", [contactId]);
      const [hist, may] = await Promise.all([history(p.credential, contactId, signal), mayChange(p, signal)]);
      /* G2: the gate is read only where it decides something — an account on Hold, for a person who may release it */
      const gate: readonly [TenPercent | null, boolean] = rec[APP_ACCESS_FIELD] === "Hold" && may
        ? await Promise.all([tenPercent(p.credential, contactId, signal), mayOverride(p, signal)]) : [null, false];
      return { ok: true, value: view(rec, hist, may, gate[0], gate[1]), already: false };
    },
    async unlock(principal, contactId, expectedModifiedTime, signal) {
      const p = trusted(principal);
      if (!p) { note("unrecognised", "invalid-request"); return { ok: false, kind: "refused", reasonCode: "invalid-request", message: "Sign in again.", retryable: false }; }
      return change(p, contactId, "Hold", "Invite", expectedModifiedTime, signal);
    },
    async lock(principal, contactId, reason, expectedModifiedTime, signal) {
      const p = trusted(principal);
      if (!p) { note("unrecognised", "invalid-request"); return { ok: false, kind: "refused", reasonCode: "invalid-request", message: "Sign in again.", retryable: false }; }
      const why = typeof reason === "string" ? reason.trim() : "";
      if (!why) return refuse(p.credential.userId, "reason-required", "Say why the app is being locked. It goes on the record with your name.", validId(contactId) ? [contactId] : []);
      if (why.length > LOCK_REASON_MAX) return refuse(p.credential.userId, "invalid-request", "Keep the reason under " + LOCK_REASON_MAX + " characters.");
      return change(p, contactId, "Invite", "Hold", expectedModifiedTime, signal, async (id) => {
        const r = await crm.insert(p.credential, "Notes", [{
          Note_Title: "App access locked",
          Note_Content: why,
          Parent_Id: { module: { api_name: CONTACTS_MODULE }, id },
        }], { signal });
        return r.ok && r.value.length === 1 && r.value[0]!.ok;
      });
    },
    async overrideUnlock(principal, contactId, reason, confirmed, expectedModifiedTime, signal) {
      const p = trusted(principal);
      if (!p) { note("unrecognised", "invalid-request"); return { ok: false, kind: "refused", reasonCode: "invalid-request", message: "Sign in again.", retryable: false }; }
      const me = p.credential.userId, ids = validId(contactId) ? [contactId] : [];
      const no = (code: AppAccessRefusal, message: string): AppAccessResult => {
        released(p, contactId, "refused", code);
        overrideLine(p, contactId, "refused", code);
        return refuse(me, code, message, ids);
      };
      /* other seats never see the override: refused before the reason is even looked at */
      if (!(await mayChange(p, signal)) || !(await mayOverride(p, signal))) return no("not-override", NOT_OVERRIDE_TEXT);
      if (typeof deps.events.appAccessOverride !== "function") return no("not-override", "The override is not available on this deployment.");
      const why = typeof reason === "string" ? reason.trim() : "";
      if (why.length < OVERRIDE_REASON_MIN) return no("override-reason-short", overrideReasonShort());
      if (why.length > LOCK_REASON_MAX) return no("invalid-request", "Keep the reason under " + LOCK_REASON_MAX + " characters.");
      if (confirmed !== true) return no("confirm-needed", "Confirm the unlock without the 10% first.");
      return change(p, contactId, "Hold", "Invite", expectedModifiedTime, signal, undefined, {
        writeNote: async (id) => {
          const r = await crm.insert(p.credential, "Notes", [{
            Note_Title: "App access unlocked without the 10% advance",
            Note_Content: why,
            Parent_Id: { module: { api_name: CONTACTS_MODULE }, id },
          }], { signal });
          const o = r.ok && r.value.length === 1 ? r.value[0]! : null;
          return o && o.ok && validId(o.id) ? o.id : null;
        },
      });
    },
  };
  return Object.freeze(service);
}
