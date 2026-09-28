/**
 * M09-S04-T02 — NAME OR MOVE A KEY ACCOUNT MANAGER (D12, D40, D53).
 *
 * One guarded PUT on the signed-in person's own token (D53): Contacts.KAM and KAM_Since, sent with
 * If-Unmodified-Since = the Contact's Modified_Time the person saw. Before it:
 *   1. the person's right is re-derived from the live session (`authority.mayAssign`: the Investors-side
 *      "assign" capability — Head of Account Management, and the seats the front-end rules give it). A KAM
 *      has no such right: they may log a conversation, never name or move a manager (AC3);
 *   2. the assignee is looked up by id (GET /users/{id}, identity/users) and must hold the Key Account Manager
 *      seat — anyone outside Account Management is refused (the prototype's KAMS(): role kam only);
 *   3. the Contact is read (id, KAM, KAM_Since, KAM_Intro_At, Modified_Time) and must still carry the version
 *      the person saw, and have an Issued allotment (D12: a KAM is named at allotment — the AM book's rule).
 * `kamUserId: null` returns the account to the shared pool. Naming the manager it already has writes nothing.
 *
 * KAM_Intro_At is NOT written here (PROVISIONAL, jev "b" 0.28): Sahil's Zoho workflow (M09-S04-T01) clears it
 * whenever KAM changes, one consequence with one actor. The move is logged by id only (jev "a" 1.00): a Plane C
 * grant-change line — who moved it, the new KAM as `whom`, the Contact and the previous KAM in recordIds. The
 * two names are read in Zoho's field history on Contacts.KAM (T01), never written to our logs (CLAUDE.md).
 */

import type { UserCredential, ZohoClient, ZohoRecord } from "../../lib/zoho/client";
import type { InvestorEvents } from "../data/events";
import { idOf, str } from "../data/contact-row";
import type { ZohoUserDirectory } from "../identity/users";
import type { ZohoSeat } from "../oauth/seat";
import { recordConflict, type RecordConflict } from "./record";

export const KAM_CONTACT_FIELDS = Object.freeze(["id", "KAM", "KAM_Since", "KAM_Intro_At", "Modified_Time"]);
/** The seats an account may be handed to: Key Account Manager only (prototype KAMS(): tm "am" and role kam). */
export const KAM_ASSIGNEE_SEATS: ReadonlySet<ZohoSeat> = new Set<ZohoSeat>(["key-account-manager"]);

const RECORD_ID = /^\d{15,22}$/;
const ZOHO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/;
const ACTION = "kam-assign";

export interface KamAssignCommand {
  readonly contactId: string;
  /** The new manager's Zoho user id, or null to return the account to the pool. */
  readonly kamUserId: string | null;
  /** The Contact's Modified_Time as the person saw it (the record's `version`). */
  readonly expectedModifiedTime: string;
}

export type KamAssignRefusal = "invalid-request" | "seat-denied" | "not-visible" | "not-allotted" | "assignee-not-am";

export interface KamAssigned {
  readonly contactId: string;
  readonly fromKam: string | null;
  readonly toKam: string | null;
  /** The date written as KAM_Since (IST), or null when returned to the pool or unchanged. */
  readonly kamSince: string | null;
  /** Zoho's new Modified_Time: the next write's If-Unmodified-Since. */
  readonly modifiedTime: string | null;
  /** false when the account already had this manager: nothing was written. */
  readonly changed: boolean;
}

export type KamAssignResult =
  | { readonly ok: true; readonly value: KamAssigned }
  | { readonly ok: false; readonly kind: "refused"; readonly reason: KamAssignRefusal }
  | RecordConflict
  | { readonly ok: false; readonly kind: "source-error"; readonly errorKind: string };

export interface KamAssignPrincipal {
  readonly credential: UserCredential;
  readonly sessionId: string;
}

export interface KamAssignDeps {
  readonly crm: Pick<ZohoClient, "coql" | "getRecord" | "update">;
  readonly users: Pick<ZohoUserDirectory, "lookup">;
  readonly events: InvestorEvents;
  /** Re-derived from the live session: the seat token when the person may name a manager, else null. */
  readonly authority: { mayAssign(credential: UserCredential, sessionId: string, signal?: AbortSignal): Promise<string | null> };
  readonly clock?: () => number;
}

/** The request body as a command, or null. Only these three keys; anything else is refused. */
export function parseKamCommand(contactId: unknown, body: unknown): KamAssignCommand | null {
  if (typeof contactId !== "string" || !RECORD_ID.test(contactId)) return null;
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  if (Object.keys(b).some((k) => k !== "kamUserId" && k !== "expectedModifiedTime")) return null;
  const kam = b.kamUserId;
  if (kam !== null && (typeof kam !== "string" || !RECORD_ID.test(kam))) return null;
  const v = b.expectedModifiedTime;
  if (typeof v !== "string" || !ZOHO_DATETIME.test(v) || Number.isNaN(Date.parse(v))) return null;
  return Object.freeze({ contactId, kamUserId: kam as string | null, expectedModifiedTime: v });
}

/** Today in Asia/Kolkata as YYYY-MM-DD (rule 9). */
export const istDay = (ms: number): string => new Date(ms + 5.5 * 3_600_000).toISOString().slice(0, 10);

export function createKamAssignment(deps: KamAssignDeps) {
  const clock = deps.clock ?? Date.now;
  const refuse = (userId: string, reason: KamAssignRefusal, ids: readonly string[]): KamAssignResult => {
    deps.events.refusal(userId, ACTION, reason, ids);
    return Object.freeze({ ok: false as const, kind: "refused" as const, reason });
  };
  const sourceError = (errorKind: string): KamAssignResult => Object.freeze({ ok: false as const, kind: "source-error" as const, errorKind });

  return Object.freeze({
    async assign(p: KamAssignPrincipal, cmd: KamAssignCommand | null, signal?: AbortSignal): Promise<KamAssignResult> {
      const me = p.credential.userId;
      if (!cmd) return refuse(me, "invalid-request", []);
      const { contactId, kamUserId } = cmd;

      // 1. The right, from the live session — before anything is read.
      let seat: string | null;
      try { seat = await deps.authority.mayAssign(p.credential, p.sessionId, signal); } catch { return sourceError("unexpected"); }
      if (!seat) return refuse(me, "seat-denied", [contactId]);

      // 2. The assignee is a Key Account Manager of this org (looked up on the person's own token).
      if (kamUserId !== null) {
        let who: Awaited<ReturnType<typeof deps.users.lookup>>;
        try { who = await deps.users.lookup(p.credential, kamUserId); } catch { who = null; }
        if (!who || who.who !== kamUserId || !KAM_ASSIGNEE_SEATS.has(who.seat)) return refuse(me, "assignee-not-am", [contactId]);
      }

      // 3. The Contact as it is now, and the version the person saw.
      let got: Awaited<ReturnType<typeof deps.crm.getRecord>>;
      try { got = await deps.crm.getRecord(p.credential, "Contacts", contactId, { fields: KAM_CONTACT_FIELDS, signal }); } catch { return sourceError("unexpected"); }
      if (!got.ok) {
        if (got.error.kind === "not-found" || got.error.kind === "forbidden") return refuse(me, "not-visible", [contactId]);
        return sourceError(got.error.kind);
      }
      const rec: ZohoRecord | null = got.value && got.value.id === contactId ? got.value : null;
      const version = rec ? str(rec, "Modified_Time", 40) : null;
      if (!rec || !version) return refuse(me, "not-visible", [contactId]);
      if (version !== cmd.expectedModifiedTime) {
        return recordConflict(deps.events, me, ACTION, { kind: "conflict", status: 412, code: "ALREADY_MODIFIED", recordId: contactId })!;
      }
      const fromKam = idOf(rec.KAM);
      if (fromKam === kamUserId) {
        return { ok: true, value: Object.freeze({ contactId, fromKam, toKam: kamUserId, kamSince: null, modifiedTime: version, changed: false }) };
      }

      // D12: only an allotted account (an Issued allotment) has a manager — the AM book's own rule.
      let al: Awaited<ReturnType<typeof deps.crm.coql>>;
      try {
        al = await deps.crm.coql(p.credential,
          `select id, Customer from LLP_UnitAllocation_Module where (Customer = '${contactId}' and Allocation_Status = 'Issued') limit 0, 1`, { signal });
      } catch { return sourceError("unexpected"); }
      if (!al.ok) return sourceError(al.error.kind);
      if (!al.value.records.some((x) => idOf(x.Customer) === contactId)) return refuse(me, "not-allotted", [contactId]);

      // 4. The one guarded write. KAM_Intro_At is cleared by the Zoho workflow on a KAM change (T01).
      const kamSince = kamUserId === null ? null : istDay(clock());
      let written: Awaited<ReturnType<typeof deps.crm.update>>;
      try {
        written = await deps.crm.update(p.credential, "Contacts", contactId,
          { KAM: kamUserId === null ? null : { id: kamUserId }, KAM_Since: kamSince }, { ifUnmodifiedSince: version, signal });
      } catch { return sourceError("unexpected"); }
      if (!written.ok) {
        const c = recordConflict(deps.events, me, ACTION, written.error);
        return c ?? sourceError(written.error.kind);
      }
      if (written.value.id !== contactId) return refuse(me, "not-visible", [contactId]);
      deps.events.kamMove(me, seat, contactId, fromKam, kamUserId);
      return { ok: true, value: Object.freeze({ contactId, fromKam, toKam: kamUserId, kamSince, modifiedTime: written.value.modifiedTime, changed: true }) };
    },
  });
}
export type KamAssignment = ReturnType<typeof createKamAssignment>;
