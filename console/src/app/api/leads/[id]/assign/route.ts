/* POST /api/leads/[id]/assign — "Assign to me" on a lead nobody carries (M05-S02, cluster C3). Self only this round:
   an IR takes an unowned lead for themselves; giving it to somebody else is a manager's act and is not wired yet.
   Body: {} (the owner is always the signed-in person). Re-reads the lead and writes with If-Unmodified-Since, so two IRs
   pressing at once cannot both take it: the second is refused 409 { code: "already-owned" }.
   200 → { leadId, ownerId, modifiedTime }   4xx → { error, code } — nothing changed. Written on the person's own token (D53). */
import { cookies } from "next/headers";
import { guardApi } from "@/server/access/guard";
import { SID_COOKIE } from "@/server/oauth/user-session";
import { sessionCredential } from "@/server/oauth/request";
import { withErrorCapture } from "@/server/ops/runtime";
import { intakeConfigured, intakeRuntime } from "@/server/leads/intake-runtime";
import { failure, NO_STORE } from "@/server/leads/intake-http";

export const dynamic = "force-dynamic";

async function post_(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!intakeConfigured()) return Response.json({ error: "Owners are written to Zoho once sign-in is connected." }, { status: 503, headers: NO_STORE });
  const s = await sessionCredential();
  if (!s.ok) return s.response;
  const { id } = await params;
  const sid = (await cookies()).get(SID_COOKIE)?.value ?? "";
  const r = await intakeRuntime().assign.assign({ credential: s.credential, sessionId: sid }, id, s.credential.userId, req.signal);
  if (r.ok) return Response.json(r.value, { headers: NO_STORE });
  return failure(r, "Not assigned");
}

export const POST = withErrorCapture(guardApi("/api/leads", post_), "/api/leads/[id]/assign");
