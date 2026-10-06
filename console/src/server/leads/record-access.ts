/**
 * Cluster C2 (ir-write-map.md) — the one admission every lead-record write here runs first: the session is the same
 * person's (D53), the seat may work leads, the lead is visible on their own token, it is in their book (owner, a live
 * Cover_By window, or a team member's), and — for an update — it has not changed since the page read it (D44).
 * Shared by notes.ts, details.ts and forecast.ts; journey.ts keeps its own (same rules).
 */

import type { UserCredential, ZohoClient, ZohoRecord } from "../../lib/zoho/client";
import { isUserCredential } from "../../lib/zoho/client";
import type { ZohoFailureKind } from "../../lib/zoho/errors";
import type { OpsLog } from "../../lib/zoho/log";
import type { FollowupAccessAuthority } from "./followup";
import { LEADS_MODULE } from "./capture";

const SESSION_ID = /^[A-Za-z0-9_-]{16,128}$/;
const RECORD_ID = /^\d{15,22}$/;
export const RECORD_PREFIX = /^\d{6,16}$/;
export const ZOHO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/;

export type AdmitRefusal = "invalid-request" | "session-changed" | "capability-missing" | "not-visible" | "not-in-book" | "lead-changed";
export type SourceError = { readonly ok: false; readonly kind: "source-error"; readonly source: "access" | "zoho"; readonly errorKind: ZohoFailureKind | "unexpected"; readonly retryable: boolean };
export type Refused<C extends string> = { readonly ok: false; readonly kind: "refused"; readonly reasonCode: C; readonly reason: string; readonly field?: string };
export type Principal = { readonly credential: UserCredential; readonly sessionId: string };

/** Zoho time in IST, as every stamp here is written (rule 9). */
export const zohoTime = (ms: number): string => `${new Date(ms + 5.5 * 3_600_000).toISOString().slice(0, 19)}+05:30`;
export const istDay = (ms: number): string => zohoTime(ms).slice(0, 10);
export const retryable = (k: ZohoFailureKind | "unexpected"): boolean => k === "network" || k === "server" || k === "busy" || k === "unexpected";
export const zohoError = (k: ZohoFailureKind | "unexpected"): SourceError => ({ ok: false, kind: "source-error", source: "zoho", errorKind: k, retryable: retryable(k) });

/** The field Zoho named when it rejected a write (invalid-data, or a failed record in a partial answer). */
export function rejectedField(e: { kind: string; field?: string | null; records?: readonly { ok: boolean; field: string | null }[] | null }): string | null {
  if (e.kind !== "invalid-data" && e.kind !== "partial") return null;
  return e.field ?? e.records?.find((r) => !r.ok)?.field ?? null;
}

export interface AdmitDependencies {
  readonly crm: Pick<ZohoClient, "getRecord">;
  readonly access: FollowupAccessAuthority;
  readonly log: OpsLog;
  readonly recordIdPrefix: string;
  readonly clock: () => number;
  /** The ops-log action name ("lead-note", "lead-details", "lead-forecast"). */
  readonly action: string;
}

export function createAdmit(deps: AdmitDependencies) {
  const { crm, access, log, clock } = deps;
  const validId = (v: unknown): v is string => typeof v === "string" && RECORD_ID.test(v) && v.startsWith(deps.recordIdPrefix);
  const idOf = (v: unknown): string | null => {
    const id = v && typeof v === "object" ? (v as { id?: unknown }).id : undefined;
    return typeof id === "string" && RECORD_ID.test(id) ? id : null;
  };
  /** Log a refusal (ids and codes only) and answer it in the service's own words. */
  function refuse<C extends string>(userId: string, code: C, reason: string, ids: readonly unknown[] = [], field?: string): Refused<C> {
    log.refusal({ at: clock(), actor: { kind: "user", userId }, action: deps.action, reason: code, recordIds: ids.filter(validId) });
    return field ? { ok: false, kind: "refused", reasonCode: code, reason, field } : { ok: false, kind: "refused", reasonCode: code, reason };
  }
  const WORDS: Readonly<Record<AdmitRefusal, string>> = {
    "invalid-request": "Not saved — the request is incomplete.",
    "session-changed": "Not saved — the sign-in session changed. Sign in again.",
    "capability-missing": "Not saved — this seat does not work leads.",
    "not-visible": "Not saved — the lead is unavailable.",
    "not-in-book": "Not saved — this lead is not in your book.",
    "lead-changed": "Not saved — the lead changed in Zoho since it was opened. Reload it and try again.",
  };

  /**
   * Admit `principal` to `leadId`, reading `fields` (plus the book's own). `expected` is the Modified_Time the page
   * loaded: a string checks it; null skips it (an insert under the lead changes nothing on it).
   */
  async function admit(principal: Principal, leadId: unknown, expected: unknown, fields: readonly string[], signal?: AbortSignal)
    : Promise<{ readonly me: string; readonly L: ZohoRecord } | Refused<AdmitRefusal> | SourceError> {
    const cred = principal?.credential;
    if (!isUserCredential(cred) || !validId(cred.userId) || typeof principal.sessionId !== "string" || !SESSION_ID.test(principal.sessionId)
      || !validId(leadId) || (expected !== null && (typeof expected !== "string" || !ZOHO_DATETIME.test(expected)))) {
      return refuse(isUserCredential(cred) ? cred.userId : "unrecognised", "invalid-request", WORDS["invalid-request"]);
    }
    const me = cred.userId;
    let a;
    try { a = await access.recheck(cred, principal.sessionId, signal); } catch {
      return { ok: false, kind: "source-error", source: "access", errorKind: "unexpected", retryable: true };
    }
    if (!a || a.actor?.userId !== me) return refuse(me, "session-changed", WORDS["session-changed"]);
    if (!a.mayRecordFollowup) return refuse(me, "capability-missing", WORDS["capability-missing"], [leadId]);
    let got: Awaited<ReturnType<typeof crm.getRecord>>;
    const want = [...new Set(["Modified_Time", "Owner", "Cover_By", "Cover_Until", "Lost_At", ...fields])];
    try { got = await crm.getRecord(cred, LEADS_MODULE, leadId, { fields: want, signal }); } catch { return zohoError("unexpected"); }
    if (!got.ok) return got.error.kind === "not-found" || got.error.kind === "forbidden" ? refuse(me, "not-visible", WORDS["not-visible"], [leadId]) : zohoError(got.error.kind);
    if (!got.value || got.value.id !== leadId) return refuse(me, "not-visible", WORDS["not-visible"], [leadId]);
    const L = got.value as ZohoRecord;
    const owner = idOf(L.Owner), today = istDay(clock());
    const inBook = owner === me /* D44: a named secondary is dormant; only a live cover admits (server/leads/cover.ts) */
      || (idOf(L.Cover_By) === me && typeof L.Cover_Until === "string" && L.Cover_Until >= today)
      || (owner !== null && a.teamOwnerIds.includes(owner));
    if (!inBook) return refuse(me, "not-in-book", WORDS["not-in-book"], [leadId]);
    if (expected !== null && L.Modified_Time !== expected) return refuse(me, "lead-changed", WORDS["lead-changed"], [leadId]);
    return { me, L };
  }

  return Object.freeze({ admit, refuse, validId });
}
