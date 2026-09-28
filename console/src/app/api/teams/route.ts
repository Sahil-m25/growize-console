/* GET /api/teams — the Teams page from Zoho (M17-S01-T01): members, seats, teams and the rights grid, on the
   signed-in person's own token (D53), scoped by seat — the IR Manager sees herself and her reporting chain
   (leavers marked left), Finance/AM/KAM/viewers the Investors side seats, Digital Infrastructure everyone.
   200 → { view, grid, counts }   403 → { error, code } (an IR, a moved seat)   503 → Zoho did not answer.
   Emails only where the Teams page shows them (own, or every Investors row for a seat-changer); no phones. */
import { guardApi } from "@/server/access/guard";
import { sessionCredential } from "@/server/oauth/request";
import { zohoSignInConfigured } from "@/server/oauth/runtime";
import { withErrorCapture } from "@/server/ops/runtime";
import { teamsService } from "@/server/teams/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };

async function get(): Promise<Response> {
  if (!zohoSignInConfigured()) return Response.json({ error: "Teams reads Zoho once Zoho sign-in is connected.", code: "not-configured" }, { status: 503, headers: NO_STORE });
  const s = await sessionCredential();
  if (!s.ok) return s.response;
  const r = await teamsService().list(s.credential, s.session);
  if (!r.ok) return Response.json({ error: r.message, code: r.code }, { status: r.status, headers: NO_STORE });
  return Response.json({ view: r.view, grid: r.grid, counts: r.counts }, { headers: NO_STORE });
}

export const GET = withErrorCapture(guardApi("/api/teams", get), "/api/teams");
