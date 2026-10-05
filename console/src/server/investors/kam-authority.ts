/* The Investors-side "assign" right, re-derived from the live session (M09-S04-T02): the seat token when the person may
   name or move a key account manager (Head of AM, and the seats the front-end rules give it), else null. Shared by
   PUT /api/investors/[id]/kam. */
import type { UserCredential } from "../../lib/zoho/client";

export async function mayAssignKam(cred: UserCredential, sid: string): Promise<string | null> {
  const { userSessions } = await import("../oauth/runtime");
  const { zohoSeatOf } = await import("../data/live");
  const { seatAccess } = await import("../access/policy");
  const now = await userSessions().credential(sid);
  if (!now.ok || now.credential.userId !== cred.userId) return null;
  const seat = zohoSeatOf(now.session.seat);
  return seat && seatAccess(seat, now.session.who, {}).imCan("assign") ? now.session.seat : null;
}
