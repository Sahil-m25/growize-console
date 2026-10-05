/* The live wiring shared by the two routes that name a key account manager: PUT /api/investors/[id]/kam and
   POST /api/kams/[userId]/move-book. One place builds the assignment service, so both re-derive the "assign" right from the
   live session the same way (the Investors-side capability, the front end's own rule). */
import type { LiveContext } from "../data/zoho-source";

export async function kamServices(ctx: LiveContext) {
  const { createKamAssignment } = await import("./kam-assign");
  const { createZohoUserDirectory } = await import("../identity/users");
  const { oauthParts, userSessions } = await import("../oauth/runtime");
  const { zohoSeatOf } = await import("../data/live");
  const { seatAccess } = await import("../access/policy");
  const { rt, crm } = ctx;
  const users = createZohoUserDirectory({ seats: oauthParts().seats, gate: rt.gate, log: rt.log });
  const authority = {
    async mayAssign(cred: { userId: string }, sid: string): Promise<string | null> {
      const now = await userSessions().credential(sid);
      if (!now.ok || now.credential.userId !== cred.userId) return null;
      const seat = zohoSeatOf(now.session.seat);
      return seat && seatAccess(seat, now.session.who, {}).imCan("assign") ? now.session.seat : null;
    },
  };
  return { assignment: createKamAssignment({ crm, events: rt.events, users, authority }), users, authority, crm, events: rt.events };
}
