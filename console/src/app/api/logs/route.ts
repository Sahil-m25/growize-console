/* GET /api/logs?from=YYYY-MM-DD&to=YYYY-MM-DD&plane=b|c&kind=<kind or group>&actor=<zoho user id>&outcome=ok|failed|refused|ended&offset&limit
   The Logs view (M15-S05-T01): Planes B and C read back from the day files, filtered, with the identity-reveal
   count and the API headroom (X-API-CREDITS-REMAINING) from Plane B. Readers: Digital Infrastructure / the
   super user, the Administrator seats, and the Auditor (server/logs/reader.ts logAccessOf). A reader without
   identity rights gets reveals as "Identity event" with record ids withheld. Invalid filters are ignored and named.
   200 → LogResult · 403 → not a log reader (logged to Plane B as a refusal). Sign-in history: Zoho Directory. */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { sessionCredential } from "@/server/oauth/request";
import { queryLogs } from "@/server/logs/reader";
import { logSource, planeBLog } from "@/server/logs/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };

async function get(request: Request): Promise<Response> {
  const s = await sessionCredential();
  if (!s.ok) return s.response;
  const q = new URL(request.url).searchParams;
  const r = queryLogs({ seat: s.session.seat },
    { from: q.get("from"), to: q.get("to"), plane: q.get("plane"), kind: q.get("kind"), actor: q.get("actor"), outcome: q.get("outcome"), offset: q.get("offset"), limit: q.get("limit") },
    logSource());
  if (!r.ok) {
    planeBLog().refusal({ at: Date.now(), actor: { kind: "user", userId: s.credential.userId }, action: "logs-read", reason: r.reason, recordIds: [] });
    return Response.json({ error: "The console logs are Digital Infrastructure's and the Auditor's.", code: r.reason }, { status: 403, headers: NO_STORE });
  }
  return Response.json(r, { headers: NO_STORE });
}

export const GET = withErrorCapture(guardApi("/api/logs", get), "/api/logs");
