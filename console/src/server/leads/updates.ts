/**
 * M15-S01 — Updates: what other people changed on my book in the last seven days (Plane A, D47).
 *
 * The leads come from the person's own scope (personal, or team for a manager), narrowed by COQL to
 * those modified in the window by somebody else; each one's Zoho timeline is then read (bounded,
 * D46 sub-concurrency) and only other people's lines inside the window are kept. The client drops
 * every old and new value at the parse, so a line says WHAT kind of change happened, never the
 * value. "Last seen" per group is the console's own memory (Plane B/C, not business data); until
 * that store is chosen (D47) it is an injected dependency.
 */

import type { UserCredential, ZohoClient } from "../../lib/zoho/client";
import { isUserCredential } from "../../lib/zoho/client";
import type { ZohoFailureKind } from "../../lib/zoho/errors";
import type { OpsLog } from "../../lib/zoho/log";
import type { LeadsAccessAuthority } from "./book";
import { LEADS_MODULE } from "./capture";

export const WINDOW_DAYS = 7;
export const MAX_LEADS = 50;
const CONCURRENCY = 4;
const SESSION_ID = /^[A-Za-z0-9_-]{16,128}$/;
const RECORD_ID = /^\d{15,22}$/;
const RECORD_PREFIX = /^\d{6,16}$/;

export type UpdateKind = "added" | "owner" | "stage" | "next-step" | "lost" | "consent" | "details";
const STAGE_FIELDS = new Set(["First_Touch_At", "Qualified_At", "Engaged_At", "Said_Yes_At", "Reserved_At", "Fully_Paid_At", "Allocated_At", "Onboarded_At"]);
/** Which kind a timeline line is, most telling first. */
export function kindOf(action: string, fields: readonly string[]): UpdateKind {
  if (/^added$/i.test(action)) return "added";
  if (fields.includes("Owner")) return "owner";
  if (fields.some((f) => f === "Lost_At" || f === "Lost_Reason")) return "lost";
  if (fields.some((f) => STAGE_FIELDS.has(f))) return "stage";
  if (fields.some((f) => f.startsWith("Next_Step"))) return "next-step";
  if (fields.some((f) => f.startsWith("Consent_"))) return "consent";
  return "details";
}

export interface SeenStore {
  lastSeen(userId: string, kind: UpdateKind): Promise<string | null>;
  markSeen(userId: string, kind: UpdateKind, at: string): Promise<void>;
}

export interface UpdateLine { readonly leadId: string; readonly at: string; readonly byId: string | null; readonly unread: boolean }
export interface UpdateGroup { readonly kind: UpdateKind; readonly leadCount: number; readonly unread: number; readonly lines: readonly UpdateLine[] }
export type UpdatesResult =
  | { readonly ok: true; readonly value: { readonly groups: readonly UpdateGroup[]; readonly truncated: boolean } }
  | { readonly ok: false; readonly kind: "refused"; readonly reasonCode: "invalid-request" | "session-changed" | "capability-missing" | "source-invalid" }
  | { readonly ok: false; readonly kind: "source-error"; readonly source: "access" | "zoho" | "seen"; readonly errorKind: ZohoFailureKind | "unexpected"; readonly retryable: boolean };

export interface UpdatesDependencies {
  readonly crm: Pick<ZohoClient, "coql" | "timeline">;
  readonly access: LeadsAccessAuthority;
  readonly seen: SeenStore;
  readonly log: OpsLog;
  readonly recordIdPrefix: string;
  readonly clock?: () => number;
}

const zohoTime = (ms: number): string => `${new Date(ms + 5.5 * 3_600_000).toISOString().slice(0, 19)}+05:30`;

export function createUpdates(deps: UpdatesDependencies) {
  if (!deps || typeof deps.crm?.coql !== "function" || typeof deps.crm?.timeline !== "function" || typeof deps.access?.recheck !== "function"
    || typeof deps.seen?.lastSeen !== "function" || typeof deps.log?.refusal !== "function"
    || typeof deps.recordIdPrefix !== "string" || !RECORD_PREFIX.test(deps.recordIdPrefix)) {
    throw new TypeError("Updates need crm.coql/timeline, the access authority, the seen store, the ops log and the CRM record-id prefix.");
  }
  const { crm, access, seen, log } = deps;
  const clock = deps.clock ?? Date.now;
  const validId = (v: unknown): v is string => typeof v === "string" && RECORD_ID.test(v) && v.startsWith(deps.recordIdPrefix);
  const refuse = (userId: string, reasonCode: "invalid-request" | "session-changed" | "capability-missing" | "source-invalid"): UpdatesResult => {
    log.refusal({ at: clock(), actor: { kind: "user", userId }, action: "updates", reason: reasonCode, recordIds: [] });
    return { ok: false, kind: "refused", reasonCode };
  };
  const zoho = (k: ZohoFailureKind | "unexpected"): UpdatesResult => ({ ok: false, kind: "source-error", source: "zoho", errorKind: k, retryable: k === "network" || k === "server" || k === "busy" });

  return Object.freeze({
    async read(principal: { credential: UserCredential; sessionId: string }, signal?: AbortSignal): Promise<UpdatesResult> {
      const cred = principal?.credential;
      if (!isUserCredential(cred) || !validId(cred.userId) || typeof principal.sessionId !== "string" || !SESSION_ID.test(principal.sessionId)) {
        return refuse(isUserCredential(cred) ? cred.userId : "unrecognised", "invalid-request");
      }
      const me = cred.userId;
      let a;
      try { a = await access.recheck(cred, principal.sessionId, signal); } catch {
        return { ok: false, kind: "source-error", source: "access", errorKind: "unexpected", retryable: true };
      }
      if (!a || a.actor?.userId !== me) return refuse(me, "session-changed");
      if (!a.mayViewLeads) return refuse(me, "capability-missing");

      const now = clock(), since = zohoTime(now - WINDOW_DAYS * 86_400_000), today = zohoTime(now).slice(0, 10);
      let scope: string;
      if (a.teamOrgWide) scope = "id is not null";
      else if (a.teamOwnerIds !== null) {
        const owners = [...new Set([me, ...a.teamOwnerIds, ...(a.unassignedQueueUserId ? [a.unassignedQueueUserId] : [])])].filter(validId).slice(0, 100);
        scope = `Owner in (${owners.map((id) => `'${id}'`).join(", ")})`;
      } else {
        scope = `Owner = '${me}' or (Cover_By = '${me}' and Cover_Until >= '${today}')`; // D44: a dormant secondary sees nothing
      }
      let res: Awaited<ReturnType<typeof crm.coql>>;
      try {
        res = await crm.coql(cred, `select id from ${LEADS_MODULE} where ((${scope}) and Modified_Time >= '${since}' and Modified_By != '${me}') order by Modified_Time desc limit 0, ${MAX_LEADS}`, { signal });
      } catch { return zoho("unexpected"); }
      if (!res.ok) return zoho(res.error.kind);
      if (res.value.invalidRecordIds || res.value.records.some((r) => !validId(r.id))) return refuse(me, "source-invalid");
      const leadIds = res.value.records.map((r) => r.id);

      const lines: (UpdateLine & { kind: UpdateKind })[] = [];
      let failed: UpdatesResult | null = null;
      let next = 0;
      const sinceMs = now - WINDOW_DAYS * 86_400_000;
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, leadIds.length) }, async () => {
        while (next < leadIds.length && !failed) {
          const leadId = leadIds[next++];
          let t: Awaited<ReturnType<typeof crm.timeline>>;
          try { t = await crm.timeline(cred, LEADS_MODULE, leadId, { perPage: 100, signal }); } catch { failed = zoho("unexpected"); return; }
          if (!t.ok) {
            // A lead that went out of reach since the list was read is simply not shown.
            if (t.error.kind === "not-found" || t.error.kind === "forbidden") continue;
            failed = zoho(t.error.kind); return;
          }
          for (const e of t.value.entries) {
            const at = Date.parse(e.at);
            if (!Number.isFinite(at) || at < sinceMs || at > now + 60_000 || e.byId === me) continue;
            lines.push({ leadId, at: e.at, byId: e.byId, unread: false, kind: kindOf(e.action, e.fields) });
          }
        }
      }));
      if (failed) return failed;

      const kinds = [...new Set(lines.map((l) => l.kind))];
      const groups: UpdateGroup[] = [];
      for (const kind of kinds) {
        let last: string | null;
        try { last = await seen.lastSeen(me, kind); } catch {
          return { ok: false, kind: "source-error", source: "seen", errorKind: "unexpected", retryable: true };
        }
        const lastMs = last ? Date.parse(last) : -Infinity;
        const mine = lines.filter((l) => l.kind === kind).sort((x, y) => Date.parse(y.at) - Date.parse(x.at))
          .map(({ kind: _k, ...l }) => Object.freeze({ ...l, unread: Date.parse(l.at) > lastMs }));
        groups.push(Object.freeze({ kind, leadCount: new Set(mine.map((l) => l.leadId)).size, unread: mine.filter((l) => l.unread).length, lines: Object.freeze(mine) }));
      }
      return { ok: true, value: { groups: Object.freeze(groups), truncated: res.value.moreRecords } };
    },

    /** Opening a group (or Mark all as read) records the newest line seen in it. */
    async markRead(principal: { credential: UserCredential; sessionId: string }, kinds: readonly UpdateKind[], signal?: AbortSignal): Promise<{ ok: boolean }> {
      const cred = principal?.credential;
      const KINDS: readonly string[] = ["added", "owner", "stage", "next-step", "lost", "consent", "details"];
      if (!isUserCredential(cred) || !validId(cred.userId) || !Array.isArray(kinds) || kinds.some((k) => !KINDS.includes(k))) return { ok: false };
      const a = await access.recheck(cred, principal.sessionId, signal).catch(() => null);
      if (!a || a.actor?.userId !== cred.userId) return { ok: false };
      const at = zohoTime(clock());
      for (const k of kinds) await seen.markSeen(cred.userId, k, at);
      return { ok: true };
    },
  });
}
