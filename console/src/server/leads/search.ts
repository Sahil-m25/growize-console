/**
 * M06-S03 — "Find a lead" in the top bar. Leads only: this module never names Contacts (D69).
 *
 * Zoho's search runs on the person's own token, so sharing already narrows it; the rows are then
 * cut to the person's book — an IR's own, secondary and live-cover leads; an IR Manager's team; a
 * seat granted org-wide reading, every book (D60) — and anything else is dropped without a trace in
 * the answer (a line in Plane B records that sharing let it through). A result carries the name,
 * the last four digits of the phone, the stage and the owner: never the full number (D60).
 */

import type { UserCredential, ZohoClient, ZohoRecord } from "../../lib/zoho/client";
import { isUserCredential } from "../../lib/zoho/client";
import type { ZohoFailureKind } from "../../lib/zoho/errors";
import type { OpsLog } from "../../lib/zoho/log";
import type { LeadsAccess, LeadsAccessAuthority } from "./book";
import { LEADS_MODULE } from "./capture";

export const SHOWN = 8;
const SESSION_ID = /^[A-Za-z0-9_-]{16,128}$/;
const RECORD_ID = /^\d{15,22}$/;
const RECORD_PREFIX = /^\d{6,16}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const FIELDS = ["First_Name", "Last_Name", "Mobile", "Lead_Status", "Owner", "Secondary_Owner", "Cover_By", "Cover_Until"];

export interface SearchHit {
  readonly id: string;
  readonly name: string;
  readonly phoneLast4: string | null;
  readonly stage: string | null;
  readonly ownerId: string | null;
}
export type SearchResult =
  | { readonly ok: true; readonly value: { readonly book: "yours" | "team" | "all"; readonly hits: readonly SearchHit[]; readonly more: number } }
  | { readonly ok: false; readonly kind: "refused"; readonly reasonCode: "invalid-request" | "term-too-short" | "session-changed" | "capability-missing" | "source-invalid" }
  | { readonly ok: false; readonly kind: "source-error"; readonly source: "access" | "zoho"; readonly errorKind: ZohoFailureKind | "unexpected"; readonly retryable: boolean };

export interface SearchDependencies {
  readonly crm: Pick<ZohoClient, "search">;
  readonly access: LeadsAccessAuthority;
  readonly log: OpsLog;
  readonly recordIdPrefix: string;
  readonly clock?: () => number;
}

/** Three or more digits search the phone; otherwise two or more letters search words. */
export function searchQueryFor(raw: unknown): { phone: string } | { word: string } | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim();
  const digits = t.replace(/[\s()+-]/g, "");
  if (/^\d+$/.test(digits)) return digits.length >= 3 && digits.length <= 15 ? { phone: digits } : null;
  const word = t.replace(/[()\\,:"*]/g, " ").replace(/\s+/g, " ").trim();
  return word.length >= 2 && word.length <= 100 ? { word } : null;
}

const idOf = (v: unknown): string | null => {
  const id = v && typeof v === "object" ? (v as { id?: unknown }).id : undefined;
  return typeof id === "string" && RECORD_ID.test(id) ? id : null;
};
const istDate = (ms: number): string => new Date(ms + 5.5 * 3_600_000).toISOString().slice(0, 10);

export function createLeadSearch(deps: SearchDependencies) {
  if (!deps || typeof deps.crm?.search !== "function" || typeof deps.access?.recheck !== "function"
    || typeof deps.log?.refusal !== "function" || typeof deps.recordIdPrefix !== "string" || !RECORD_PREFIX.test(deps.recordIdPrefix)) {
    throw new TypeError("Lead search needs crm.search, the access authority, the ops log and the CRM record-id prefix.");
  }
  const { crm, access, log } = deps;
  const clock = deps.clock ?? Date.now;
  const validId = (v: unknown): v is string => typeof v === "string" && RECORD_ID.test(v) && v.startsWith(deps.recordIdPrefix);
  const refuse = (userId: string, reasonCode: Extract<SearchResult, { kind: "refused" }>["reasonCode"], ids: string[] = []): SearchResult => {
    log.refusal({ at: clock(), actor: { kind: "user", userId }, action: "lead-search", reason: reasonCode, recordIds: ids.filter(validId) });
    return { ok: false, kind: "refused", reasonCode };
  };

  const inBook = (a: LeadsAccess, me: string, r: ZohoRecord, today: string): boolean => {
    if (a.teamOrgWide) return true;
    const owner = idOf(r.Owner);
    if (a.teamOwnerIds !== null) {
      return owner === me || (owner !== null && (a.teamOwnerIds.includes(owner) || owner === a.unassignedQueueUserId));
    }
    const until = r.Cover_Until;
    return owner === me || idOf(r.Secondary_Owner) === me
      || (idOf(r.Cover_By) === me && typeof until === "string" && DATE.test(until) && until >= today);
  };

  return Object.freeze({
    async find(principal: { credential: UserCredential; sessionId: string }, term: string, signal?: AbortSignal): Promise<SearchResult> {
      const cred = principal?.credential;
      if (!isUserCredential(cred) || !validId(cred.userId) || typeof principal.sessionId !== "string" || !SESSION_ID.test(principal.sessionId)) {
        return refuse(isUserCredential(cred) ? cred.userId : "unrecognised", "invalid-request");
      }
      const me = cred.userId;
      const q = searchQueryFor(term);
      if (!q) return { ok: false, kind: "refused", reasonCode: "term-too-short" };
      let a: LeadsAccess | null;
      try {
        a = await access.recheck(cred, principal.sessionId, signal);
      } catch {
        return { ok: false, kind: "source-error", source: "access", errorKind: "unexpected", retryable: true };
      }
      if (!a || a.actor?.userId !== me) return refuse(me, "session-changed");
      if (!a.mayViewLeads) return refuse(me, "capability-missing");

      let res: Awaited<ReturnType<typeof crm.search>>;
      try {
        res = await crm.search(cred, LEADS_MODULE, q, { fields: FIELDS, perPage: 200, signal });
      } catch {
        return { ok: false, kind: "source-error", source: "zoho", errorKind: "unexpected", retryable: true };
      }
      if (!res.ok) {
        const k = res.error.kind;
        return { ok: false, kind: "source-error", source: "zoho", errorKind: k, retryable: k === "network" || k === "server" || k === "busy" };
      }
      if (res.value.invalidRecordIds) return refuse(me, "source-invalid");
      const today = istDate(clock());
      const hits: SearchHit[] = [];
      const dropped: string[] = [];
      for (const r of res.value.records) {
        if (!validId(r.id)) return refuse(me, "source-invalid");
        if (!inBook(a, me, r, today)) { dropped.push(r.id); continue; }
        const last = typeof r.Last_Name === "string" ? r.Last_Name : "";
        const first = typeof r.First_Name === "string" ? r.First_Name : "";
        const digits = typeof r.Mobile === "string" ? r.Mobile.replace(/\D/g, "") : "";
        const owner = idOf(r.Owner);
        hits.push(Object.freeze({
          id: r.id,
          name: `${first} ${last}`.trim().slice(0, 121),
          phoneLast4: digits.length >= 4 ? digits.slice(-4) : null,
          stage: typeof r.Lead_Status === "string" ? r.Lead_Status.slice(0, 120) : null,
          ownerId: owner === a.unassignedQueueUserId ? null : owner,
        }));
      }
      if (dropped.length) log.refusal({ at: clock(), actor: { kind: "user", userId: me }, action: "lead-search", reason: "outside-book", recordIds: dropped });
      const more = hits.length - SHOWN + (res.value.moreRecords ? 1 : 0);
      return { ok: true, value: {
        book: a.teamOrgWide ? "all" : a.teamOwnerIds !== null ? "team" : "yours",
        hits: Object.freeze(hits.slice(0, SHOWN)),
        more: Math.max(0, more),
      } };
    },
  });
}
