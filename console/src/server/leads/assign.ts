/**
 * M05-S02 — "Assign to me" (an IR) and "Assign it" (a manager) on a lead with no owner.
 *
 * This only ever gives an UNOWNED lead an owner (prototype `assign`): moving a lead that already has
 * an owner is a reassignment, reason-coded, and is not this function. The lead is re-read first and
 * written with If-Unmodified-Since, so two IRs pressing at once cannot both take it — the second is
 * refused as already owned. The write is the person's own (D53); Zoho's record audit (Plane A)
 * holds "<IR> carries it" with who and when.
 */

import type { UserCredential, ZohoClient } from "../../lib/zoho/client";
import { isUserCredential } from "../../lib/zoho/client";
import type { ZohoFailureKind } from "../../lib/zoho/errors";
import type { OpsLog } from "../../lib/zoho/log";
import type { SeatedZohoUser } from "../oauth/seat";
import { LEADS_MODULE } from "./capture";

const SESSION_ID = /^[A-Za-z0-9_-]{16,128}$/;
const RECORD_ID = /^\d{15,22}$/;
const RECORD_PREFIX = /^\d{6,16}$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/;

export interface AssignAccess {
  readonly actor: SeatedZohoUser;
  /** An IR may take an unowned lead for themselves. */
  readonly mayTakeUnowned: boolean;
  /** A manager (leads · assign) may give one to anybody in this list. */
  readonly mayAssignOthers: boolean;
  readonly assignableOwnerIds: readonly string[];
  readonly unassignedQueueUserId: string | null;
}
export interface AssignAccessAuthority {
  recheck(credential: UserCredential, sessionId: string, signal?: AbortSignal): Promise<AssignAccess | null>;
}

export type AssignRefusal = "invalid-request" | "session-changed" | "capability-missing" | "owner-not-assignable"
  | "already-owned" | "not-visible" | "lead-changed" | "unassigned-queue-missing" | "source-invalid";
export type AssignResult =
  | { readonly ok: true; readonly value: { readonly leadId: string; readonly ownerId: string; readonly modifiedTime: string | null } }
  | { readonly ok: false; readonly kind: "refused"; readonly reasonCode: AssignRefusal; readonly reason: string }
  | { readonly ok: false; readonly kind: "source-error"; readonly source: "access" | "zoho"; readonly errorKind: ZohoFailureKind | "unexpected"; readonly retryable: boolean };

const REASON: Readonly<Record<AssignRefusal, string>> = Object.freeze({
  "invalid-request": "the request is invalid",
  "session-changed": "the sign-in session changed",
  "capability-missing": "an IR picks up a lead with no owner; moving one that has an owner is a manager's act",
  "owner-not-assignable": "that person cannot be given this lead",
  "already-owned": "somebody already carries this lead",
  "not-visible": "the lead is unavailable",
  "lead-changed": "the lead changed after it was opened",
  "unassigned-queue-missing": "the unassigned queue is not set up in Zoho yet",
  "source-invalid": "Zoho returned an invalid lead",
});

export interface AssignDependencies {
  readonly crm: Pick<ZohoClient, "getRecord" | "update">;
  readonly access: AssignAccessAuthority;
  readonly log: OpsLog;
  readonly recordIdPrefix: string;
  readonly clock?: () => number;
}

const zohoTime = (ms: number): string => `${new Date(ms + 5.5 * 3_600_000).toISOString().slice(0, 19)}+05:30`;

export function createLeadAssign(deps: AssignDependencies) {
  if (!deps || typeof deps.crm?.getRecord !== "function" || typeof deps.crm?.update !== "function" || typeof deps.access?.recheck !== "function"
    || typeof deps.log?.refusal !== "function" || typeof deps.recordIdPrefix !== "string" || !RECORD_PREFIX.test(deps.recordIdPrefix)) {
    throw new TypeError("Assigning needs crm.getRecord/update, the access authority, the ops log and the CRM record-id prefix.");
  }
  const { crm, access, log } = deps;
  const clock = deps.clock ?? Date.now;
  const validId = (v: unknown): v is string => typeof v === "string" && RECORD_ID.test(v) && v.startsWith(deps.recordIdPrefix);
  const refuse = (userId: string, code: AssignRefusal, ids: readonly string[] = []): AssignResult => {
    log.refusal({ at: clock(), actor: { kind: "user", userId }, action: "assign-owner", reason: code, recordIds: ids.filter(validId) });
    return { ok: false, kind: "refused", reasonCode: code, reason: REASON[code] };
  };
  const zohoError = (kind: ZohoFailureKind): AssignResult =>
    ({ ok: false, kind: "source-error", source: "zoho", errorKind: kind, retryable: kind === "network" || kind === "busy" });

  const allowed = (a: AssignAccess, me: string, to: string): boolean =>
    (a.mayTakeUnowned && to === me) || (a.mayAssignOthers && (to === me || a.assignableOwnerIds.includes(to)));

  return Object.freeze({
    async assign(principal: { credential: UserCredential; sessionId: string }, leadId: string, to: string, signal?: AbortSignal): Promise<AssignResult> {
      const cred = principal?.credential;
      if (!isUserCredential(cred) || !validId(cred.userId) || typeof principal.sessionId !== "string" || !SESSION_ID.test(principal.sessionId)
        || !validId(leadId) || !validId(to)) {
        return refuse(isUserCredential(cred) ? cred.userId : "unrecognised", "invalid-request");
      }
      const me = cred.userId;
      const read = async (): Promise<AssignAccess | AssignResult> => {
        try {
          const a = await access.recheck(cred, principal.sessionId, signal);
          if (!a || a.actor?.userId !== me) return refuse(me, "session-changed");
          if (!a.mayTakeUnowned && !a.mayAssignOthers) return refuse(me, "capability-missing", [leadId]);
          if (!allowed(a, me, to)) return refuse(me, a.mayAssignOthers ? "owner-not-assignable" : "capability-missing", [leadId]);
          if (!validId(a.unassignedQueueUserId)) return refuse(me, "unassigned-queue-missing", [leadId]);
          return a;
        } catch {
          return { ok: false, kind: "source-error", source: "access", errorKind: "unexpected", retryable: true };
        }
      };
      const a = await read();
      if (!("actor" in a)) return a;

      let got: Awaited<ReturnType<typeof crm.getRecord>>;
      try {
        got = await crm.getRecord(cred, LEADS_MODULE, leadId, { fields: ["Owner", "Modified_Time"], signal });
      } catch {
        return { ok: false, kind: "source-error", source: "zoho", errorKind: "unexpected", retryable: true };
      }
      if (!got.ok) return got.error.kind === "not-found" || got.error.kind === "forbidden" ? refuse(me, "not-visible", [leadId]) : zohoError(got.error.kind);
      if (!got.value) return refuse(me, "not-visible", [leadId]);
      const owner = (got.value.Owner as { id?: unknown } | null)?.id;
      const modified = got.value.Modified_Time;
      if (got.value.id !== leadId || !validId(owner) || typeof modified !== "string" || !DATETIME.test(modified)) return refuse(me, "source-invalid", [leadId]);
      if (owner !== a.unassignedQueueUserId) return refuse(me, "already-owned", [leadId]);

      const b = await read();
      if (!("actor" in b)) return b;
      if (b.unassignedQueueUserId !== a.unassignedQueueUserId) return refuse(me, "session-changed", [leadId]);

      let put: Awaited<ReturnType<typeof crm.update>>;
      try {
        put = await crm.update(cred, LEADS_MODULE, leadId, { Owner: { id: to }, Owner_Assigned_At: zohoTime(clock()) }, { ifUnmodifiedSince: modified, signal });
      } catch {
        return { ok: false, kind: "source-error", source: "zoho", errorKind: "unexpected", retryable: false };
      }
      if (!put.ok) {
        // Somebody else changed the lead after it was read: most often another IR took it first.
        if (put.error.kind === "conflict") return refuse(me, "lead-changed", [leadId]);
        return { ok: false, kind: "source-error", source: "zoho", errorKind: put.error.kind, retryable: false };
      }
      if (put.value.id !== leadId) return refuse(me, "source-invalid", [leadId]);
      return { ok: true, value: { leadId, ownerId: to, modifiedTime: put.value.modifiedTime } };
    },
  });
}
