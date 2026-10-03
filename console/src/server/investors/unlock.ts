/**
 * M10-S21-T02 — UNLOCK THE INVESTOR APP AND SEND THE WELCOME FROM THE CONSOLE (D10, D73, D93).
 *
 * The App account card on the investor record, read and written live on the person's own token (D53):
 *   card    — Contacts.App_Access (Hold | Invite), App_Welcome_At / App_Welcome_Channel (written back by the
 *             investor app's sync, never by the console) and the record's timeline (who changed App_Access,
 *             when — ids only; the timeline parse drops values). What the card reads is worked out from
 *             those facts, the same lines the front-end's accessView draws:
 *               no App_Access                          → "No account yet — it opens On hold at the first matched receipt"
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
 * Idempotent: unlocking an invited account, or locking a held one, changes nothing and answers `already`.
 * Finance (Head of Finance, Finance Operations, the super user) controls this; every other seat reads the card
 * with `mayChange: false` ("Finance controls app access"). Logs carry ids and codes only — never the reason.
 */

import type { TimelineEntry, UserCredential, ZohoClient, ZohoRecord } from "../../lib/zoho/client";
import { isUserCredential } from "../../lib/zoho/client";
import type { ZohoFailureKind } from "../../lib/zoho/errors";
import type { OpsLog } from "../../lib/zoho/log";

export const CONTACTS_MODULE = "Contacts";
export const APP_ACCESS_FIELD = "App_Access";
export const APP_ACCESS_FIELDS = Object.freeze(["ARL_ID", APP_ACCESS_FIELD, "App_Welcome_At", "App_Welcome_Channel", "Modified_Time"]);
/** M08-S08-T03: the account's mark, written once by money/match at the first matched receipt (Tentative, App_Mark_At = that time). */
export const APP_MARK_FIELDS = Object.freeze(["App_Account_Mark", "App_Mark_At"]);
export const LOCK_REASON_MAX = 500;
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
}

export interface AppAccessPrincipal { readonly credential: UserCredential; readonly sessionId: string }
export interface AppAccessAuthority {
  /** Re-derived from the live session: may this person change app access (Finance, super user)? */
  mayChange(credential: UserCredential, sessionId: string, signal?: AbortSignal): Promise<boolean>;
}

export type AppAccessRefusal =
  | "invalid-request"
  | "not-finance"
  | "not-visible"
  | "no-account"
  | "reason-required"
  | "changed";

export type AppAccessResult =
  | { readonly ok: true; readonly value: AppAccessCard; readonly already: boolean; readonly noteSaved?: boolean }
  | { readonly ok: false; readonly kind: "refused"; readonly reasonCode: AppAccessRefusal; readonly message: string; readonly retryable: false }
  | { readonly ok: false; readonly kind: "source-error"; readonly errorKind: ZohoFailureKind | "unexpected"; readonly message: string; readonly retryable: boolean };

export interface AppAccessDependencies {
  readonly crm: Pick<ZohoClient, "getRecord" | "update" | "insert" | "timeline">;
  readonly authority: AppAccessAuthority;
  readonly log: OpsLog;
  readonly recordIdPrefix: string;
  readonly clock?: () => number;
}

export interface AppAccessService {
  card(principal: AppAccessPrincipal, contactId: unknown, signal?: AbortSignal): Promise<AppAccessResult>;
  unlock(principal: AppAccessPrincipal, contactId: unknown, expectedModifiedTime?: unknown, signal?: AbortSignal): Promise<AppAccessResult>;
  lock(principal: AppAccessPrincipal, contactId: unknown, reason: unknown, expectedModifiedTime?: unknown, signal?: AbortSignal): Promise<AppAccessResult>;
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
  if (!access) return { state: "none", text: "No account yet — it opens On hold at the first matched receipt" };
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
const retryableKind = (k: string): boolean =>
  k === "network" || k === "server" || k === "busy" || k === "concurrency-exceeded" || k === "rate-limited-unclassified" || k === "unexpected";

export function createAppAccess(deps: AppAccessDependencies): AppAccessService {
  if (!deps || typeof deps.crm?.getRecord !== "function" || typeof deps.crm?.update !== "function" || typeof deps.crm?.insert !== "function"
    || typeof deps.crm?.timeline !== "function" || typeof deps.authority?.mayChange !== "function" || typeof deps.log?.refusal !== "function"
    || typeof deps.recordIdPrefix !== "string" || !RECORD_PREFIX.test(deps.recordIdPrefix)) {
    throw new TypeError("app access needs crm (getRecord/update/insert/timeline), the Finance authority, the ops log and the record-id prefix");
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
  const failed = (kind: ZohoFailureKind | "unexpected"): AppAccessResult => ({
    ok: false, kind: "source-error", errorKind: kind, message: "Not changed — Zoho is not answering. Try again.", retryable: retryableKind(kind),
  });
  const trusted = (p: unknown): AppAccessPrincipal | null => {
    const c = p && typeof p === "object" ? (p as { credential?: unknown; sessionId?: unknown }) : null;
    return c && isUserCredential(c.credential) && typeof c.sessionId === "string" && SESSION_ID.test(c.sessionId)
      ? { credential: c.credential, sessionId: c.sessionId } : null;
  };
  const mayChange = async (p: AppAccessPrincipal, signal?: AbortSignal): Promise<boolean> => {
    try { return (await deps.authority.mayChange(p.credential, p.sessionId, signal)) === true; } catch { return false; }
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
  const view = (rec: ZohoRecord, hist: readonly AppAccessChange[] | null, may: boolean): AppAccessCard => {
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
    });
  };

  /** Hold ↔ Invite, guarded; `from` is the state the button was pressed on. */
  const change = async (p: AppAccessPrincipal, contactId: unknown, from: AppAccess, to: AppAccess, expected: unknown, signal: AbortSignal | undefined,
    after?: (id: string) => Promise<boolean>): Promise<AppAccessResult> => {
    const me = p.credential.userId;
    if (!validId(contactId)) return refuse(me, "invalid-request", "Not changed — open the investor again.");
    if (expected !== undefined && expected !== null && (typeof expected !== "string" || !ZOHO_DATETIME.test(expected))) {
      return refuse(me, "invalid-request", "Not changed — reload the investor and try again.", [contactId]);
    }
    if (!(await mayChange(p, signal))) return refuse(me, "not-finance", "Finance controls app access.", [contactId]);
    let rec: ZohoRecord | null;
    try { rec = await readContact(p.credential, contactId, signal); } catch (e) { return failed(e instanceof SourceFail ? e.kind : "unexpected"); }
    if (!rec) return refuse(me, "not-visible", "Not changed — this investor is not visible to you.", [contactId]);
    const now = rec[APP_ACCESS_FIELD];
    if (now !== "Hold" && now !== "Invite") return refuse(me, "no-account", "No account yet — it opens On hold at the first matched receipt.", [contactId]);
    const modified = typeof rec.Modified_Time === "string" && ZOHO_DATETIME.test(rec.Modified_Time) ? rec.Modified_Time : null;
    if (now === to) {
      // Already there (a second press, a retry): nothing to write.
      return { ok: true, value: view(rec, await history(p.credential, contactId, signal), true), already: true };
    }
    if (now !== from) return refuse(me, "changed", "Not changed — someone changed this investor's app access. Reload and look again.", [contactId]);
    if (typeof expected === "string" && modified && expected !== modified) {
      return refuse(me, "changed", "Not changed — this investor changed since you opened them. Reload and look again.", [contactId]);
    }
    const w = await crm.update(p.credential, CONTACTS_MODULE, contactId, { [APP_ACCESS_FIELD]: to }, { ifUnmodifiedSince: (expected as string | undefined) ?? modified, signal })
      .catch(() => ({ ok: false as const, error: { kind: "unexpected" as const, status: 0, code: "THROWN" }, creditsRemaining: null }));
    if (!w.ok) {
      if (w.error.kind === "conflict") return refuse(me, "changed", "Not changed — this investor changed since you opened them. Reload and look again.", [contactId]);
      if (w.error.kind === "not-found" || w.error.kind === "forbidden") return refuse(me, "not-visible", "Not changed — this investor is not visible to you.", [contactId]);
      note(me, "write-failed-" + w.error.kind, [contactId]);
      return failed(w.error.kind);
    }
    const noteSaved = after ? await after(contactId).catch(() => false) : undefined;
    note(me, to === "Invite" ? "unlocked" : "locked", [contactId]);
    // Read back what Zoho holds now; if that read fails, answer from the write.
    let fresh: ZohoRecord | null = null;
    try { fresh = await readContact(p.credential, contactId, signal); } catch { fresh = null; }
    const base: ZohoRecord = fresh ?? { ...rec, [APP_ACCESS_FIELD]: to, Modified_Time: w.value.modifiedTime ?? modified };
    let hist = await history(p.credential, contactId, signal);
    if (hist && !hist.some((h) => w.value.modifiedTime && h.at === w.value.modifiedTime)) {
      // The timeline can lag the write: count this change so the card reads right straight away.
      hist = [{ at: w.value.modifiedTime ?? new Date(clock()).toISOString(), byId: me }, ...hist];
    }
    return { ok: true, value: view(base, hist, true), already: false, ...(noteSaved !== undefined ? { noteSaved } : {}) };
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
      return { ok: true, value: view(rec, hist, may), already: false };
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
  };
  return Object.freeze(service);
}
