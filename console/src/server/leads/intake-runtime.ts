/**
 * Server-only composition of the Add page's writes and the lead-ownership and updates writes (cluster C3):
 * capture (+ its idempotent wrapper and the per-row file import), the duplicate check, "Assign to me" and
 * "mark updates read" — for POST /api/leads, /api/leads/duplicate, /api/leads/import, /api/leads/[id]/assign
 * and /api/leads/updates/read.
 *
 *   ZOHO_CRM_RECORD_ID_PREFIX, and Zoho sign-in configured (server/oauth/runtime)   as for the rest of the leads side
 *   ZOHO_UNASSIGNED_QUEUE_USER_ID                                                    the "Needs an owner" queue user
 *
 * Access is re-derived from the live session on every recheck (the way ./runtime.ts does it): the seat's own `add ·
 * capture` capability (page grants are not read here, as in the payment-claim route). PROVISIONAL: there is no
 * subtree reader yet, so the list of people a manager may give a lead to is empty — a manager's capture is theirs or the
 * unassigned queue, and "Assign to me" is the IR's alone (self only this round).
 * "Last seen" for Updates lives in the shared state (Plane C: the console's own memory, never a business fact, D47).
 */

import { createZohoClient, type UserCredential } from "../../lib/zoho/client";
import { dataRuntime } from "../data/zoho-source";
import { zohoSeatOf } from "../data/live";
import { seatAccess } from "../access/policy";
import { userSessions } from "../oauth/runtime";
import { sharedState } from "../state/runtime";
import type { SharedState } from "../state/shared-state";
import { createLeadAssign, type AssignAccessAuthority } from "./assign";
import { createLeadCapture, type CaptureAccessAuthority } from "./capture";
import { createDuplicateCheck } from "./duplicate";
import { createIntake } from "./intake";
import { leadsConfigured, sessionLeadsAccess } from "./runtime";
import { createUpdates, type SeenStore, type UpdateKind } from "./updates";

type Recheck = (sid: string, signal?: AbortSignal) => Promise<{ credential: UserCredential; session: { seat: string; who: string } } | null>;

/** The capture capability of the seat the live session holds now. */
export function sessionCaptureAccess(recheckSession: Recheck, unassignedQueueUserId: string | null): CaptureAccessAuthority {
  return {
    async recheck(cred, sid, signal) {
      const now = await recheckSession(sid, signal);
      if (!now || now.credential.userId !== cred.userId) return null;
      const seat = zohoSeatOf(now.session.seat);
      if (!seat) return null;
      return {
        actor: { userId: cred.userId, roleId: "", profileId: "", seat },
        mayCapture: seatAccess(seat, now.session.who, {}).may("add", "capture"),
        assignableOwnerIds: [],
        unassignedQueueUserId,
      };
    },
  };
}

/** "Assign to me": an IR with edit on Leads may take an unowned lead for themselves; nothing else this round. */
export function sessionAssignAccess(recheckSession: Recheck, unassignedQueueUserId: string | null): AssignAccessAuthority {
  return {
    async recheck(cred, sid, signal) {
      const now = await recheckSession(sid, signal);
      if (!now || now.credential.userId !== cred.userId) return null;
      const seat = zohoSeatOf(now.session.seat);
      if (!seat) return null;
      return {
        actor: { userId: cred.userId, roleId: "", profileId: "", seat },
        mayTakeUnowned: seat === "investor-relations" && seatAccess(seat, now.session.who, {}).may("leads", "edit"),
        mayAssignOthers: false,
        assignableOwnerIds: [],
        unassignedQueueUserId,
      };
    },
  };
}

/** The per-person "last seen" of each Updates group, in the shared state. No expiry: it is a person's own bookmark. */
export function stateSeenStore(state: SharedState): SeenStore {
  const key = (userId: string, kind: UpdateKind) => `lead-updates-seen|${userId}|${kind}`;
  return {
    lastSeen: (userId, kind) => state.get(key(userId, kind)),
    async markSeen(userId, kind, at) {
      // never move the bookmark back (two tabs, or a retry arriving late)
      const prev = await state.get(key(userId, kind));
      if (prev && Date.parse(prev) >= Date.parse(at)) return;
      await state.set(key(userId, kind), at);
    },
  };
}

function build(env: NodeJS.ProcessEnv) {
  if (!leadsConfigured(env)) throw new Error("Lead intake is not configured.");
  const rt = dataRuntime();
  const recordIdPrefix = env.ZOHO_CRM_RECORD_ID_PREFIX!;
  const crm = createZohoClient({ gate: rt.gate, log: rt.log, recordIdPrefix });
  const sessions = userSessions(env);
  const recheck: Recheck = async (sid) => {
    const r = await sessions.credential(sid);
    return r.ok ? { credential: r.credential, session: r.session } : null;
  };
  const queue = env.ZOHO_UNASSIGNED_QUEUE_USER_ID || null;
  const captureAccess = sessionCaptureAccess(recheck, queue);
  const state = sharedState();
  const capture = createLeadCapture({ crm, access: captureAccess, log: rt.log, cache: rt.cache, recordIdPrefix });
  return {
    intake: createIntake({ capture, state }),
    duplicates: createDuplicateCheck({ crm, access: captureAccess, log: rt.log, recordIdPrefix }),
    assign: createLeadAssign({ crm, access: sessionAssignAccess(recheck, queue), log: rt.log, recordIdPrefix }),
    updates: createUpdates({ crm, access: sessionLeadsAccess(recheck, queue), seen: stateSeenStore(state), log: rt.log, recordIdPrefix }),
  };
}

type Intake = ReturnType<typeof build>;
const G = globalThis as typeof globalThis & { __gzIntakeRuntime?: Intake };

/** The one intake runtime of this process (kept across dev reloads). Throws if not configured. */
export function intakeRuntime(env: NodeJS.ProcessEnv = process.env): Intake {
  return (G.__gzIntakeRuntime ??= build(env));
}

export { leadsConfigured as intakeConfigured };
