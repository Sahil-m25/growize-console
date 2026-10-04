/**
 * M08-S05 — owners and cover (D44, D49, D51/D52 A-14/A-17).
 *
 * THE ACTIVE-SECONDARY PREDICATE. A secondary is a dormant backup label: naming someone Secondary_Owner
 * gives them nothing (D44). A person other than the owner works a lead only while
 *   - an explicit cover window names them: Lead.Cover_By = them and Cover_Until (a date, IST) is today or
 *     later; if Cover_By is set at all, only that recipient qualifies — an expired or different-recipient
 *     window never falls back to automatic access; or
 *   - with no explicit window, a live roster absence of the owner (Plane C availability, D49) says so:
 *     the roster names them as covering that owner, or names the owner absent and they are the lead's
 *     named secondary — and the person admitted is themself in, not on a roster absence (D44: "actively available
 *     to cover"). server/roster/roster.ts reads the roster from Plane C; with no reader, or a failed read, nobody
 *     is admitted this way (fail closed).
 * search.ts, book.ts and every lead read/write in this folder ask `activeFor`, or its COQL twin.
 *
 * THE WINDOW. Handover {duration} is started by the owner, a manager over the owner, or a secondary who
 * already holds the lead; a dormant secondary on a healthy owner's lead changes nothing (refused, Plane C
 * refused-action). It is written to the Lead (Cover_By, Cover_Until) on the starter's own token with
 * If-Unmodified-Since (D53, A-03) — Zoho is the store (D45) — then Zoho record-level sharing adds the
 * secondary (A-14/A-17) through the cover-window-share service job (lib/zoho/cover-window-share.ts;
 * PROVISIONAL jev "b" 0.85), and Plane C files the grant (D49: who, whom, outcome). Ending — by the
 * owner, whoever carries it or a manager — clears the window, revokes the share and files the end.
 * Expiry is `sweepExpiredCovers`, run on the service token by a schedule: revoke, then clear.
 * Nothing is cached; logs hold ids and codes only.
 */

import type { ServiceCredential, UserCredential, ZohoClient, ZohoRecord, ZohoServiceClient } from "../../lib/zoho/client";
import { isUserCredential } from "../../lib/zoho/client";
import type { CoverWindow, CoverWindowResult } from "../../lib/zoho/cover-window-share";
import type { ZohoFailureKind } from "../../lib/zoho/errors";
import type { OpsLog } from "../../lib/zoho/log";
import type { PlaneCLog } from "../identity/plane-c";
import type { LeadsAccess, LeadsAccessAuthority } from "./book";
import { LEADS_MODULE } from "./capture";

const SESSION_ID = /^[A-Za-z0-9_-]{16,128}$/;
const RECORD_ID = /^\d{15,22}$/;
const RECORD_PREFIX = /^\d{6,16}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/;
const SWEEP_PAGE = 200;

/** The prototype's DUR. "back" (until the owner is back) ends the day before the roster's first day back; 14 days only when the roster does not say when. */
export const COVER_DURATIONS = Object.freeze({ today: 1, d3: 3, w1: 7, w2: 14, back: 14 } as const);
export type CoverDuration = keyof typeof COVER_DURATIONS;

/* ---- the predicate --------------------------------------------------------------------------- */

/** One live roster fact from Plane C (D49): an owner away today, and who (if named) covers them. */
export interface RosterNow {
  /** Owners on a current, bounded absence (start ≤ today < back). */
  readonly absentOwnerIds: readonly string[];
  /** Per-owner roster cover: while the owner is away, `coverById` works their leads. */
  readonly covers: readonly { readonly ownerId: string; readonly coverById: string }[];
  /** The first day back of each absent person (IST, YYYY-MM-DD); lets "until they are back" end on the real day. */
  readonly backOn?: Readonly<Record<string, string>>;
}
/** Plane C's availability reader (D49): server/roster/roster.ts `createRoster` over the log sink. Absent → no roster admission. */
export interface RosterReader {
  current(signal?: AbortSignal): Promise<RosterNow>;
}
export const NO_ROSTER: RosterNow = Object.freeze({ absentOwnerIds: Object.freeze([]), covers: Object.freeze([]) });

const idOf = (v: unknown): string | null => {
  const id = v && typeof v === "object" ? (v as { id?: unknown }).id : undefined;
  return typeof id === "string" && RECORD_ID.test(id) ? id : null;
};
export const istDate = (ms: number): string => new Date(ms + 5.5 * 3_600_000).toISOString().slice(0, 10);
const addDays = (day: string, n: number): string => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Why `me` may work this lead as someone other than its owner, or null (dormant, expired, someone else's). */
export function activeFor(L: ZohoRecord, me: string, today: string, roster: RosterNow = NO_ROSTER): "cover" | "roster" | null {
  const owner = idOf(L.Owner);
  if (!owner || owner === me) return null;
  const by = idOf(L.Cover_By);
  if (L.Cover_By !== null && L.Cover_By !== undefined && L.Cover_By !== "") {
    // Explicit window: only its named, current recipient. No fallback to the roster.
    return by === me && typeof L.Cover_Until === "string" && DATE.test(L.Cover_Until) && L.Cover_Until >= today ? "cover" : null;
  }
  if (roster.absentOwnerIds.includes(me)) return null; // the cover is away too
  if (roster.covers.some((c) => c.ownerId === owner && c.coverById === me)) return "roster";
  if (idOf(L.Secondary_Owner) === me && roster.absentOwnerIds.includes(owner)) return "roster";
  return null;
}

/** The personal-book COQL clause for "working as someone else" — the twin of `activeFor`. */
export function activeClause(me: string, today: string, roster: RosterNow = NO_ROSTER): string {
  const parts = [`(Cover_By = '${me}' and Cover_Until >= '${today}')`];
  if (roster.absentOwnerIds.includes(me)) return parts[0]!; // away themselves: no roster admission
  const covered = [...new Set(roster.covers.filter((c) => c.coverById === me && c.ownerId !== me).map((c) => c.ownerId))].filter((x) => RECORD_ID.test(x)).slice(0, 100);
  const absent = [...new Set(roster.absentOwnerIds)].filter((x) => RECORD_ID.test(x) && x !== me).slice(0, 100);
  const inList = (ids: string[]) => ids.map((x) => `'${x}'`).join(", ");
  if (covered.length) parts.push(`(Cover_By is null and Owner in (${inList(covered)}))`);
  if (absent.length) parts.push(`(Cover_By is null and Secondary_Owner = '${me}' and Owner in (${inList(absent)}))`);
  return parts.join(" or ");
}

/** Reads the roster, or none on any failure (fail closed: nobody gains access because Plane C was down). */
export async function rosterNow(reader: RosterReader | undefined, signal?: AbortSignal): Promise<RosterNow> {
  if (!reader) return NO_ROSTER;
  try {
    const r = await reader.current(signal);
    const ok = (x: unknown): x is string => typeof x === "string" && RECORD_ID.test(x);
    return Object.freeze({
      absentOwnerIds: Object.freeze((Array.isArray(r?.absentOwnerIds) ? r.absentOwnerIds : []).filter(ok)),
      covers: Object.freeze((Array.isArray(r?.covers) ? r.covers : []).filter((c) => c && ok(c.ownerId) && ok(c.coverById))),
      backOn: Object.freeze(Object.fromEntries(Object.entries(r?.backOn ?? {}).filter(([k, v]) => ok(k) && typeof v === "string" && DATE.test(v)))),
    });
  } catch {
    return NO_ROSTER;
  }
}

/* ---- the window ------------------------------------------------------------------------------ */

export type CoverRefusal = "invalid-request" | "session-changed" | "capability-missing" | "not-visible" | "lead-changed" | "lead-closed"
  | "no-secondary" | "not-yours-to-cover" | "no-cover" | "not-yours-to-end";
export type CoverResult =
  | { readonly ok: true; readonly value: { readonly leadId: string; readonly coverById: string | null; readonly coverUntil: string | null;
      readonly modifiedTime: string | null; /** false: the window stands in Zoho but the record share did not land — the sweep retries. */ readonly shared: boolean } }
  | { readonly ok: false; readonly kind: "refused"; readonly reasonCode: CoverRefusal; readonly reason: string }
  | { readonly ok: false; readonly kind: "source-error"; readonly source: "access" | "zoho"; readonly errorKind: ZohoFailureKind | "unexpected"; readonly retryable: boolean };

const REASON: Readonly<Record<CoverRefusal, string>> = Object.freeze({
  "invalid-request": "the request is invalid",
  "session-changed": "the sign-in session changed",
  "capability-missing": "this seat cannot hand leads over",
  "not-visible": "the lead is unavailable",
  "lead-changed": "the lead changed in Zoho since it was opened — review it and try again",
  "lead-closed": "every rung is done or the lead is lost; the names are history",
  "no-secondary": "this lead names no secondary to hand it to",
  "not-yours-to-cover": "cover is the owner's, the secondary's or a manager's to start, and this lead names none of them as you",
  "no-cover": "no cover is running on this lead",
  "not-yours-to-end": "a cover ends when the owner, whoever is carrying it, or a manager says so",
});

/** Opens or closes the record share for a window. Runtime: the cover-window-share service job. */
export type CoverShare = (windows: readonly CoverWindow[], signal?: AbortSignal) => Promise<readonly CoverWindowResult[]>;

export interface CoverDependencies {
  readonly crm: Pick<ZohoClient, "getRecord" | "update">;
  readonly access: LeadsAccessAuthority;
  readonly share: CoverShare;
  readonly log: OpsLog;
  readonly planeC: PlaneCLog;
  readonly recordIdPrefix: string;
  readonly roster?: RosterReader;
  readonly clock?: () => number;
}

const FIELDS = ["Modified_Time", "Owner", "Secondary_Owner", "Cover_By", "Cover_Until", "Lost_At", "Onboarded_At"];
type Principal = { credential: UserCredential; sessionId: string };

export function createCover(deps: CoverDependencies) {
  if (!deps || typeof deps.crm?.getRecord !== "function" || typeof deps.crm?.update !== "function" || typeof deps.access?.recheck !== "function"
    || typeof deps.share !== "function" || typeof deps.log?.refusal !== "function" || typeof deps.planeC?.record !== "function"
    || typeof deps.recordIdPrefix !== "string" || !RECORD_PREFIX.test(deps.recordIdPrefix)) {
    throw new TypeError("Cover needs crm.getRecord/update, the access authority, the share job, the ops log, Plane C and the CRM record-id prefix.");
  }
  const { crm, access, log, planeC } = deps;
  const clock = deps.clock ?? Date.now;
  const validId = (v: unknown): v is string => typeof v === "string" && RECORD_ID.test(v) && v.startsWith(deps.recordIdPrefix);
  const seatCode = (a: LeadsAccess | null) => a?.actor?.seat ?? null;
  const refuse = (me: string, a: LeadsAccess | null, action: "cover-start" | "cover-end", code: CoverRefusal, ids: string[] = []): CoverResult => {
    log.refusal({ at: clock(), actor: { kind: "user", userId: me }, action, reason: code, recordIds: ids.filter(validId) });
    if (code === "not-yours-to-cover" || code === "not-yours-to-end" || code === "capability-missing") {
      planeC.record({ at: clock(), who: me, action: "refused-action", outcome: "refused", reason: action, seat: seatCode(a), recordIds: ids.filter(validId) });
    }
    return { ok: false, kind: "refused", reasonCode: code, reason: REASON[code] };
  };
  const zoho = (k: ZohoFailureKind | "unexpected"): CoverResult =>
    ({ ok: false, kind: "source-error", source: "zoho", errorKind: k, retryable: k === "network" || k === "server" || k === "busy" });
  const isManagerOf = (a: LeadsAccess, owner: string) => a.teamOrgWide || (a.teamOwnerIds !== null && a.teamOwnerIds.includes(owner));

  const open = async (p: Principal, leadId: string, expected: string, action: "cover-start" | "cover-end", signal?: AbortSignal)
    : Promise<{ me: string; a: LeadsAccess; L: ZohoRecord; owner: string; today: string } | CoverResult> => {
    const cred = p?.credential;
    if (!isUserCredential(cred) || !validId(cred.userId) || typeof p.sessionId !== "string" || !SESSION_ID.test(p.sessionId)
      || !validId(leadId) || typeof expected !== "string" || !DATETIME.test(expected)) {
      return refuse(isUserCredential(cred) ? cred.userId : "unrecognised", null, action, "invalid-request");
    }
    const me = cred.userId;
    let a: LeadsAccess | null;
    try { a = await access.recheck(cred, p.sessionId, signal); } catch {
      return { ok: false, kind: "source-error", source: "access", errorKind: "unexpected", retryable: true };
    }
    if (!a || a.actor?.userId !== me) return refuse(me, a, action, "session-changed");
    if (!a.mayViewLeads || a.actor.seat === "channel-partner") return refuse(me, a, action, "capability-missing", [leadId]);
    let got: Awaited<ReturnType<typeof crm.getRecord>>;
    try { got = await crm.getRecord(cred, LEADS_MODULE, leadId, { fields: FIELDS, signal }); } catch { return zoho("unexpected"); }
    if (!got.ok) return got.error.kind === "not-found" || got.error.kind === "forbidden" ? refuse(me, a, action, "not-visible", [leadId]) : zoho(got.error.kind);
    if (!got.value || got.value.id !== leadId) return refuse(me, a, action, "not-visible", [leadId]);
    const L = got.value;
    if (L.Modified_Time !== expected) return refuse(me, a, action, "lead-changed", [leadId]);
    const owner = idOf(L.Owner);
    if (!owner || !validId(owner)) return zoho("unexpected");
    if (L.Lost_At || L.Onboarded_At) return refuse(me, a, action, "lead-closed", [leadId]);
    return { me, a, L, owner, today: istDate(clock()) };
  };

  const write = async (cred: UserCredential, leadId: string, expected: string, fields: Record<string, unknown>, signal?: AbortSignal) => {
    try {
      return await crm.update(cred, LEADS_MODULE, leadId, fields as never, { ifUnmodifiedSince: expected, signal });
    } catch {
      return null;
    }
  };
  const shareOk = async (w: CoverWindow, signal?: AbortSignal): Promise<boolean> => {
    try {
      const r = await deps.share([w], signal);
      return r.length === 1 && r[0]!.ok === true;
    } catch {
      return false;
    }
  };

  return Object.freeze({
    /** Hand the lead to its secondary for `duration`. */
    async start(p: Principal, leadId: string, expected: string, duration: CoverDuration, signal?: AbortSignal): Promise<CoverResult> {
      const o = await open(p, leadId, expected, "cover-start", signal);
      if (!("L" in o)) return o;
      const { me, a, L, owner, today } = o;
      if (typeof duration !== "string" || !Object.prototype.hasOwnProperty.call(COVER_DURATIONS, duration)) return refuse(me, a, "cover-start", "invalid-request", [leadId]);
      const sec = idOf(L.Secondary_Owner);
      if (!sec || !validId(sec) || sec === owner) return refuse(me, a, "cover-start", "no-secondary", [leadId]);
      const roster = await rosterNow(deps.roster, signal);
      // D44: owner, a manager over the owner, or a secondary who already holds it. A dormant secondary: nothing changes.
      const allowed = owner === me || isManagerOf(a, owner) || (sec === me && activeFor(L, me, today, roster) !== null);
      if (!allowed) return refuse(me, a, "cover-start", "not-yours-to-cover", [leadId]);
      const back = duration === "back" ? roster.backOn?.[owner] : undefined;
      const until = back && DATE.test(back) && addDays(back, -1) >= today ? addDays(back, -1) : addDays(today, COVER_DURATIONS[duration]);
      const put = await write(p.credential, leadId, expected, { Cover_By: { id: sec }, Cover_Until: until }, signal);
      if (!put) return zoho("unexpected");
      if (!put.ok) return put.error.kind === "conflict" ? refuse(me, a, "cover-start", "lead-changed", [leadId]) : zoho(put.error.kind);
      const previous = idOf(L.Cover_By);
      if (previous && previous !== sec) await shareOk({ leadId, coverUserId: previous, state: "closed" }, signal);
      const shared = await shareOk({ leadId, coverUserId: sec, state: "open" }, signal);
      if (!shared) log.refusal({ at: clock(), actor: { kind: "user", userId: me }, action: "cover-start", reason: "share-pending", recordIds: [leadId] });
      planeC.record({ at: clock(), who: me, whom: sec, action: "grant-change", outcome: "ok", reason: `cover-open-${duration}`, seat: seatCode(a), recordIds: [leadId] });
      return { ok: true, value: { leadId, coverById: sec, coverUntil: until, modifiedTime: put.value.modifiedTime, shared } };
    },

    /** End the running window: the owner, the person carrying it, or a manager. */
    async end(p: Principal, leadId: string, expected: string, signal?: AbortSignal): Promise<CoverResult> {
      const o = await open(p, leadId, expected, "cover-end", signal);
      if (!("L" in o)) return o;
      const { me, a, L, owner } = o;
      const by = idOf(L.Cover_By);
      if (!by || !validId(by)) return refuse(me, a, "cover-end", "no-cover", [leadId]);
      if (!(owner === me || by === me || isManagerOf(a, owner))) return refuse(me, a, "cover-end", "not-yours-to-end", [leadId]);
      const put = await write(p.credential, leadId, expected, { Cover_By: null, Cover_Until: null }, signal);
      if (!put) return zoho("unexpected");
      if (!put.ok) return put.error.kind === "conflict" ? refuse(me, a, "cover-end", "lead-changed", [leadId]) : zoho(put.error.kind);
      const revoked = await shareOk({ leadId, coverUserId: by, state: "closed" }, signal);
      if (!revoked) log.refusal({ at: clock(), actor: { kind: "user", userId: me }, action: "cover-end", reason: "unshare-pending", recordIds: [leadId] });
      planeC.record({ at: clock(), who: me, whom: by, action: "grant-change", outcome: "ended", reason: "cover-end", seat: seatCode(a), recordIds: [leadId] });
      return { ok: true, value: { leadId, coverById: null, coverUntil: null, modifiedTime: put.value.modifiedTime, shared: revoked } };
    },
  });
}

/* ---- expiry ---------------------------------------------------------------------------------- */

export interface SweepResult {
  readonly ok: boolean;
  /** Leads whose window expired, was revoked in Zoho and cleared. */
  readonly closed: readonly string[];
  /** Leads left for the next run: revoke or clear failed. */
  readonly failed: readonly string[];
}

/**
 * Close every window whose Cover_Until is before today (IST): revoke the share, then clear the fields with
 * If-Unmodified-Since. Runs on the cover-window-share service credential (a schedule; no screen). A lead
 * whose revoke fails keeps its fields, so the next run tries again; the fields alone already admit nobody.
 */
export async function sweepExpiredCovers(
  client: Pick<ZohoServiceClient, "coql" | "update" | "unshare">,
  as: ServiceCredential,
  planeC: PlaneCLog,
  recordIdPrefix: string,
  clock: () => number = Date.now,
  signal?: AbortSignal,
): Promise<SweepResult> {
  const today = istDate(clock());
  const valid = (v: unknown): v is string => typeof v === "string" && RECORD_ID.test(v) && v.startsWith(recordIdPrefix);
  const r = await client.coql(as, `select id, Cover_By, Cover_Until, Modified_Time from ${LEADS_MODULE} where (Cover_By is not null and Cover_Until < '${today}') order by id asc limit 0, ${SWEEP_PAGE}`, { signal });
  if (!r.ok) return { ok: false, closed: [], failed: [] };
  const closed: string[] = [], failed: string[] = [];
  for (const L of r.value.records) {
    const by = idOf(L.Cover_By);
    if (!valid(L.id) || !by || typeof L.Cover_Until !== "string" || !(L.Cover_Until < today) || typeof L.Modified_Time !== "string") {
      if (valid(L.id)) failed.push(L.id);
      continue;
    }
    const un = await client.unshare(as, LEADS_MODULE, L.id, by, { signal });
    if (!un.ok) { failed.push(L.id); continue; }
    const put = await client.update(as, LEADS_MODULE, L.id, { Cover_By: null, Cover_Until: null }, { ifUnmodifiedSince: L.Modified_Time, signal });
    if (!put.ok) { failed.push(L.id); continue; }
    planeC.record({ at: clock(), who: by, whom: by, action: "grant-change", outcome: "ended", reason: "cover-expired", seat: null, recordIds: [L.id] });
    closed.push(L.id);
  }
  return { ok: failed.length === 0, closed, failed };
}
