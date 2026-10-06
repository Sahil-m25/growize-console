/* D132 — server-only composition of the Investors-side care writes (server/investors/care) for
     POST /api/investors/[id]/contact   logContact   (Idempotency-Key: it inserts a Touch)
     PUT  /api/investors/[id]/details   saveDetails
     POST /api/investors/[id]/kyc       passKyc / failKyc
   The right is re-derived from the live session the way kam-authority does it: the Investors-side capability of the
   person's seat (ROLE[..].can via seatAccess) and the seat's investors-book scope (a KAM is held to its own book). */
import type { UserCredential } from "../../lib/zoho/client";
import type { LiveContext } from "../data/zoho-source";
import type { CareCap, CareGrant } from "./care";

export async function mayCare(cred: UserCredential, sid: string, cap: CareCap): Promise<CareGrant | null> {
  const { userSessions } = await import("../oauth/runtime");
  const { zohoSeatOf } = await import("../data/live");
  const { seatAccess } = await import("../access/policy");
  const { scopesFor } = await import("../data/scope");
  const now = await userSessions().credential(sid);
  if (!now.ok || now.credential.userId !== cred.userId) return null;
  const seat = zohoSeatOf(now.session.seat);
  if (!seat || !seatAccess(seat, now.session.who, {}).imCan(cap)) return null;
  const scope = scopesFor(now.session.seat, cred.userId).investors;
  if (scope.kind === "none" || scope.kind === "own-lead") return null;   /* an IR never writes on the Investors side */
  return { seat: now.session.seat, ownBook: scope.kind === "own-book" };
}

export async function careService(ctx: LiveContext) {
  const { createInvestorCare } = await import("./care");
  return createInvestorCare({ crm: ctx.crm, events: ctx.rt.events, authority: { allow: (c, s, cap) => mayCare(c, s, cap) } });
}
