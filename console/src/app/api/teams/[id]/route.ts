/* GET /api/teams/{zoho user id} — one member in full (M17-S01-T01): their row, the lead pages they reach, what
   they hold by name, their managers. Only someone the viewer may open (themselves, their own people, an
   Investors side seat they may read); anyone else is 403 cannot-open. Email only on the Teams page's rule. */
import { guardApi } from "@/server/access/guard";
import { sessionCredential } from "@/server/oauth/request";
import { zohoSignInConfigured } from "@/server/oauth/runtime";
import { withErrorCapture } from "@/server/ops/runtime";
import { teamsService } from "@/server/teams/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };

async function get(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!zohoSignInConfigured()) return Response.json({ error: "Teams reads Zoho once Zoho sign-in is connected.", code: "not-configured" }, { status: 503, headers: NO_STORE });
  const s = await sessionCredential();
  if (!s.ok) return s.response;
  const { id } = await ctx.params;
  const r = await teamsService().member(s.credential, s.session, id);
  if (!r.ok) return Response.json({ error: r.message, code: r.code }, { status: r.status, headers: NO_STORE });
  return Response.json(r.detail, { headers: NO_STORE });
}

export const GET = withErrorCapture(guardApi("/api/teams", get), "/api/teams");
