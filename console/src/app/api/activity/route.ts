/* GET /api/activity?side=lead|investors&month=YYYY-MM&day=YYYY-MM-DD&person=<zoho user id>&kind=<kind>&offset&limit
   The Activity page's rows and summaries for the signed-in seat (M15-S03-T02/T05): the archived org audit
   plus Plane C, scoped to the reader and to records they can open (checked on their own token). Invalid
   filters are ignored and named in `ignored`. 200 → ActivityResult · 403 → this seat has no Activity. */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { sessionCredential } from "@/server/oauth/request";
import { queryActivity } from "@/server/activity/query";
import { activityDeps, auditArchive } from "@/server/activity/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };

async function get(request: Request): Promise<Response> {
  const s = await sessionCredential();
  if (!s.ok) return s.response;
  const q = new URL(request.url).searchParams;
  const r = await queryActivity({ seat: s.session.seat, userId: s.credential.userId },
    { side: q.get("side"), month: q.get("month"), day: q.get("day"), person: q.get("person"), kind: q.get("kind"), offset: q.get("offset"), limit: q.get("limit") },
    activityDeps(s.credential));
  if (!r.ok) return Response.json({ error: "Activity is not part of this seat." }, { status: 403, headers: NO_STORE });
  return Response.json({ ...r, archive: auditArchive()?.kind ?? "not-configured" }, { headers: NO_STORE });
}

export const GET = withErrorCapture(guardApi("/api/activity", get), "/api/activity");
