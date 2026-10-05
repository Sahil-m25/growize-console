/* The live wiring shared by the two routes that name a key account manager: PUT /api/investors/[id]/kam and
   POST /api/kams/[userId]/move-book. One place builds the assignment service, so both re-derive the "assign" right from the
   live session the same way (the Investors-side capability, the front end's own rule). */
import type { LiveContext } from "../data/zoho-source";
import type { UserCredential } from "../../lib/zoho/client";

export async function kamServices(ctx: LiveContext) {
  const { createKamAssignment } = await import("./kam-assign");
  const { createZohoUserDirectory } = await import("../identity/users");
  const { oauthParts } = await import("../oauth/runtime");
  const { mayAssignKam } = await import("./kam-authority");
  const { rt, crm } = ctx;
  const users = createZohoUserDirectory({ seats: oauthParts().seats, gate: rt.gate, log: rt.log });
  // One rule for every route that names a manager: kam-authority.mayAssignKam.
  const authority = { mayAssign: (cred: UserCredential, sid: string) => mayAssignKam(cred, sid) };
  return { assignment: createKamAssignment({ crm, events: rt.events, users, authority }), users, authority, crm, events: rt.events };
}
