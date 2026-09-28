/**
 * Route half for the event writes and the sheet load (M14-S02, M14-S03): the write authority re-read
 * from the live session on every call — the seat's `events · edit` / `events · load` through the front
 * end's own rule over the guard's one-person context (./caps) with the person's stored grants — and the services on the shared runtime.
 *
 * No roster reader is wired yet (Plane C availability, D49), so eligibleStaffIds is null and staff are
 * checked for shape only (GAP in BLOCKED.md). ZOHO_UNASSIGNED_QUEUE_USER_ID names the unassigned queue.
 */

import { cookies } from "next/headers";
import type { RouteContext } from "../cases/http";
import type { EventsWriteAccess, EventsWriteAuthority } from "./writes";
import { createEventWrites } from "./writes";
import { createSheetLoader } from "./loader";

export function sessionEventsAuthority(env: NodeJS.ProcessEnv = process.env): EventsWriteAuthority {
  return {
    async recheck(cred, signal): Promise<EventsWriteAccess | null> {
      if (signal?.aborted) return null;
      const [{ userSessions }, { SID_COOKIE }, { zohoSeatOf }, { readGrants, ZOHO_SEAT_SIDES }, { sharedGrantReader }, { eventCaps }] = await Promise.all([
        import("../oauth/runtime"), import("../oauth/user-session"), import("../data/live"), import("../access/policy"), import("../access/grants"), import("./caps"),
      ]);
      const jar = await cookies();
      const now = await userSessions(env).credential(jar.get(SID_COOKIE)?.value);
      if (!now.ok || now.credential.userId !== cred.userId) return null;
      const seat = zohoSeatOf(now.session.seat);
      if (!seat) return null;
      const grants = await readGrants(sharedGrantReader(), now.session.who, ZOHO_SEAT_SIDES[seat].lead);
      const caps = eventCaps(now.session.seat, now.session.who, grants, new Date());
      return {
        userId: cred.userId,
        mayEdit: caps.edit,
        mayLoad: caps.load,
        eligibleStaffIds: null,
        unassignedQueueUserId: /^\d{15,22}$/.test(env.ZOHO_UNASSIGNED_QUEUE_USER_ID ?? "") ? env.ZOHO_UNASSIGNED_QUEUE_USER_ID! : null,
      };
    },
  };
}

export function eventServices(ctx: RouteContext, env: NodeJS.ProcessEnv = process.env) {
  const authority = sessionEventsAuthority(env);
  const recordIdPrefix = env.ZOHO_CRM_RECORD_ID_PREFIX ?? "";
  return {
    writes: createEventWrites({ crm: ctx.crm, authority, events: ctx.events, recordIdPrefix, cache: ctx.cache }),
    loader: createSheetLoader({ crm: ctx.crm, authority, events: ctx.events, recordIdPrefix, cache: ctx.cache }),
  };
}

export const WRITE_STATUS: Readonly<Record<string, number>> = Object.freeze({
  "invalid-request": 400, "session-changed": 401, "capability-missing": 403, "not-found": 404, gaps: 422, conflict: 409,
  "confirm-needed": 428, "source-invalid": 502, "event-not-run": 409, "sheet-not-ready": 409, "already-loaded": 409,
  "owner-missing": 422, "owner-not-assignable": 422, "no-staff": 422, "unassigned-queue-missing": 503, "too-many-rows": 413, "no-rows": 422,
});
