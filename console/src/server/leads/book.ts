/**
 * M06-S01 — the Leads list, read live from Zoho with the person's own token (D45, D53).
 *
 * Personal scope is what the person carries: owner, secondary, or cover still running, plus the
 * unassigned queue for an IR (prototype `visible()`). Team scope is the owners the session layer
 * says the person manages (IR Manager) or, for a seat granted org-wide reading (D60, D68), no owner
 * filter at all. Zoho's sharing already limits the token; each row is still checked against the
 * scope, so a stale share shows up as a refusal rather than as somebody else's lead on screen.
 *
 * Rows are records, so none is cached (D52: the shared cache holds counts only). Lost leads come
 * back marked, and the page holds them back; nothing is dropped here.
 */

import type { UserCredential, ZohoClient, ZohoRecord } from "../../lib/zoho/client";
import { isUserCredential } from "../../lib/zoho/client";
import type { ZohoFailureKind } from "../../lib/zoho/errors";
import type { OpsLog } from "../../lib/zoho/log";
import type { SeatedZohoUser } from "../oauth/seat";
import { LEADS_MODULE } from "./capture";

export const PAGE_SIZE = 200;
/** COQL takes at most 2,000 rows per query and 100,000 by paging one criteria set. */
export const MAX_OFFSET = 100_000 - PAGE_SIZE;
const SESSION_ID = /^[A-Za-z0-9_-]{16,128}$/;
const RECORD_ID = /^\d{15,22}$/;
const RECORD_PREFIX = /^\d{6,16}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/;

const FIELDS = Object.freeze([
  "id", "First_Name", "Last_Name", "Mobile", "Owner", "Secondary_Owner", "Cover_By", "Cover_Until",
  "Lead_Source", "Lead_Status", "Created_Time", "Lost_At", "Units_Interested", "Next_Step_At", "Last_Reply_At",
] as const);

export type LeadScope = "personal" | "team";

export interface LeadsAccess {
  readonly actor: SeatedZohoUser;
  readonly mayViewLeads: boolean;
  /** null: this seat has no Team scope. [] never means "everyone"; org-wide is `teamOrgWide`. */
  readonly teamOwnerIds: readonly string[] | null;
  /** Digital Infrastructure and people granted org-wide reading (D60, D68). */
  readonly teamOrgWide: boolean;
  /** The unassigned queue's Zoho user (PROVISIONAL in BLOCKED.md); null until set up. */
  readonly unassignedQueueUserId: string | null;
  /** An IR's personal book includes the unassigned queue ("Needs an owner"). */
  readonly seesUnassignedInPersonal: boolean;
}

export interface LeadsAccessAuthority {
  recheck(credential: UserCredential, sessionId: string, signal?: AbortSignal): Promise<LeadsAccess | null>;
}

export interface LeadRow {
  readonly id: string;
  readonly firstName: string | null;
  readonly lastName: string;
  readonly mobile: string | null;
  /** null = unassigned (owned by the queue user). */
  readonly ownerId: string | null;
  readonly secondaryOwnerId: string | null;
  readonly coverById: string | null;
  readonly coverUntil: string | null;
  readonly source: string | null;
  readonly status: string | null;
  readonly createdAt: string;
  readonly lostAt: string | null;
  readonly unitsInterested: number | null;
  readonly nextStepAt: string | null;
  readonly lastReplyAt: string | null;
  /** Why this row is in the personal book; "team" for Team scope. */
  readonly why: "owner" | "secondary" | "cover" | "unassigned" | "team";
}

export type BookResult =
  | { readonly ok: true; readonly value: { readonly scope: LeadScope; readonly rows: readonly LeadRow[]; readonly nextOffset: number | null } }
  | { readonly ok: false; readonly kind: "refused"; readonly reasonCode: "invalid-request" | "session-changed" | "capability-missing" | "no-team-scope" | "scope-drift" | "source-invalid" | "book-too-large" }
  | { readonly ok: false; readonly kind: "source-error"; readonly source: "access" | "zoho"; readonly errorKind: ZohoFailureKind | "unexpected"; readonly retryable: boolean };

export interface BookDependencies {
  readonly crm: Pick<ZohoClient, "coql">;
  readonly access: LeadsAccessAuthority;
  readonly log: OpsLog;
  readonly recordIdPrefix: string;
  readonly clock?: () => number;
}

const idOf = (v: unknown): string | null | undefined => {
  if (v === null || v === undefined || v === "") return null;
  const id = typeof v === "object" && !Array.isArray(v) ? (v as { id?: unknown }).id : undefined;
  return typeof id === "string" && RECORD_ID.test(id) ? id : undefined;
};
const str = (r: ZohoRecord, k: string, max: number, re?: RegExp): string | null | undefined => {
  const v = r[k];
  if (v === null || v === undefined || v === "") return null;
  return typeof v === "string" && v.length <= max && (!re || re.test(v)) ? v : undefined;
};
const istDate = (ms: number): string => new Date(ms + 5.5 * 3_600_000).toISOString().slice(0, 10);

export function createLeadsBook(deps: BookDependencies) {
  if (!deps || typeof deps.crm?.coql !== "function" || typeof deps.access?.recheck !== "function"
    || typeof deps.log?.refusal !== "function" || typeof deps.recordIdPrefix !== "string" || !RECORD_PREFIX.test(deps.recordIdPrefix)) {
    throw new TypeError("The Leads book needs crm.coql, the access authority, the ops log and the CRM record-id prefix.");
  }
  const { crm, access, log } = deps;
  const clock = deps.clock ?? Date.now;
  const validId = (v: unknown): v is string => typeof v === "string" && RECORD_ID.test(v) && v.startsWith(deps.recordIdPrefix);
  const refuse = (userId: string, reasonCode: Extract<BookResult, { kind: "refused" }>["reasonCode"], recordIds: readonly string[] = []): BookResult => {
    log.refusal({ at: clock(), actor: { kind: "user", userId }, action: "leads-book", reason: reasonCode, recordIds: recordIds.filter(validId) });
    return { ok: false, kind: "refused", reasonCode };
  };

  const parse = (r: ZohoRecord, queue: string | null): Omit<LeadRow, "why"> | null => {
    if (!validId(r.id)) return null;
    const owner = idOf(r.Owner), secondary = idOf(r.Secondary_Owner), cover = idOf(r.Cover_By);
    const row = {
      id: r.id,
      firstName: str(r, "First_Name", 40), lastName: str(r, "Last_Name", 80), mobile: str(r, "Mobile", 30),
      ownerId: owner === queue ? null : owner, secondaryOwnerId: secondary, coverById: cover,
      coverUntil: str(r, "Cover_Until", 10, DATE), source: str(r, "Lead_Source", 120), status: str(r, "Lead_Status", 120),
      createdAt: str(r, "Created_Time", 40, DATETIME), lostAt: str(r, "Lost_At", 40, DATETIME),
      nextStepAt: str(r, "Next_Step_At", 40, DATETIME), lastReplyAt: str(r, "Last_Reply_At", 40, DATETIME),
      unitsInterested: r.Units_Interested === null || r.Units_Interested === undefined ? null
        : Number.isSafeInteger(r.Units_Interested) && (r.Units_Interested as number) >= 0 ? r.Units_Interested as number : undefined,
    };
    if (Object.values(row).some((v) => v === undefined) || !row.lastName || !row.createdAt || !owner) return null;
    for (const id of [owner, secondary, cover]) if (id !== null && !validId(id)) return null;
    return row as Omit<LeadRow, "why">;
  };

  return Object.freeze({
    async list(principal: { credential: UserCredential; sessionId: string }, scope: LeadScope, offset = 0, signal?: AbortSignal): Promise<BookResult> {
      const cred = principal?.credential;
      if (!isUserCredential(cred) || !validId(cred.userId) || typeof principal.sessionId !== "string" || !SESSION_ID.test(principal.sessionId)
        || (scope !== "personal" && scope !== "team") || !Number.isSafeInteger(offset) || offset < 0 || offset > MAX_OFFSET || offset % PAGE_SIZE !== 0) {
        return refuse(isUserCredential(cred) ? cred.userId : "unrecognised", "invalid-request");
      }
      const me = cred.userId;
      const read = async (): Promise<LeadsAccess | BookResult> => {
        try {
          const a = await access.recheck(cred, principal.sessionId, signal);
          if (!a || a.actor?.userId !== me) return refuse(me, "session-changed");
          if (!a.mayViewLeads) return refuse(me, "capability-missing");
          if (a.unassignedQueueUserId !== null && !validId(a.unassignedQueueUserId)) return refuse(me, "session-changed");
          return a;
        } catch {
          return { ok: false, kind: "source-error", source: "access", errorKind: "unexpected", retryable: true };
        }
      };
      const a = await read();
      if (!("actor" in a)) return a;
      const queue = a.unassignedQueueUserId;
      const today = istDate(clock());

      let where: string;
      let team: ReadonlySet<string> | null = null;
      if (scope === "personal") {
        const parts = [`Owner = '${me}'`, `Secondary_Owner = '${me}'`, `(Cover_By = '${me}' and Cover_Until >= '${today}')`];
        if (a.seesUnassignedInPersonal && queue) parts.push(`Owner = '${queue}'`);
        where = parts.join(" or ");
      } else {
        if (!a.teamOrgWide && a.teamOwnerIds === null) return refuse(me, "no-team-scope");
        if (a.teamOrgWide) where = "id is not null";
        else {
          const owners = [...new Set([...(a.teamOwnerIds as readonly string[]), ...(queue ? [queue] : [])])];
          if (owners.some((id) => !validId(id)) || owners.length > 100) return refuse(me, "session-changed");
          if (owners.length === 0) return { ok: true, value: { scope, rows: [], nextOffset: null } };
          team = new Set(owners);
          where = `Owner in (${owners.map((id) => `'${id}'`).join(", ")})`;
        }
      }

      let res: Awaited<ReturnType<typeof crm.coql>>;
      try {
        res = await crm.coql(cred, `select ${FIELDS.join(", ")} from ${LEADS_MODULE} where (${where}) order by id asc limit ${offset}, ${PAGE_SIZE}`, { signal });
      } catch {
        return { ok: false, kind: "source-error", source: "zoho", errorKind: "unexpected", retryable: true };
      }
      if (!res.ok) {
        const k = res.error.kind;
        return { ok: false, kind: "source-error", source: "zoho", errorKind: k, retryable: k === "network" || k === "server" || k === "busy" };
      }
      if (res.value.invalidRecordIds) return refuse(me, "source-invalid");
      if (res.value.moreRecords && offset + PAGE_SIZE > MAX_OFFSET) return refuse(me, "book-too-large");

      const rows: LeadRow[] = [];
      for (const r of res.value.records) {
        const row = parse(r, queue);
        if (!row) return refuse(me, "source-invalid", [String(r.id)]);
        let why: LeadRow["why"] | null;
        if (scope === "team") {
          const owner = row.ownerId ?? queue;
          why = a.teamOrgWide || (owner !== null && team?.has(owner)) ? "team" : null;
        } else if (row.ownerId === me) why = "owner";
        else if (row.secondaryOwnerId === me) why = "secondary";
        else if (row.coverById === me && row.coverUntil !== null && row.coverUntil >= today) why = "cover";
        else if (row.ownerId === null && a.seesUnassignedInPersonal) why = "unassigned";
        else why = null;
        if (!why) return refuse(me, "scope-drift", [row.id]);
        rows.push(Object.freeze({ ...row, why }));
      }

      // The seat is read again before rows leave: a scope withdrawn mid-read returns nothing.
      const b = await read();
      if (!("actor" in b)) return b;
      if (b.actor.seat !== a.actor.seat || b.teamOrgWide !== a.teamOrgWide || b.unassignedQueueUserId !== queue
        || JSON.stringify(b.teamOwnerIds) !== JSON.stringify(a.teamOwnerIds) || b.seesUnassignedInPersonal !== a.seesUnassignedInPersonal) {
        return refuse(me, "session-changed");
      }
      return { ok: true, value: { scope, rows: Object.freeze(rows), nextOffset: res.value.moreRecords ? offset + PAGE_SIZE : null } };
    },
  });
}
