/* /api/users/[id]/manager — who a person reports to, on Teams (M17-S02-T01, the prototype's setMgr; D60).
     PUT { manager: "<Zoho user id>" | null }
   200 → { whom, from, to }   4xx/5xx → { error, code, lose? } — nothing changed:
   400 bad request · 403 not yours to move / manager outside your reach / your seat moved · 404 not a Zoho user you see
   · 409 already their manager, "That would make a loop", or the new chain would take pages away (lose = page ids)
   · 502 Zoho refused · 503 Zoho not answering or the write unconfirmed.
   On the changer's own Zoho token (Users PUT Reporting_To); Plane C manager-change. Server: server/access/manager-change.ts. */
import { guardApi } from "@/server/access/guard";
import { managerChanges } from "@/server/access/runtime";
import { sessionCredential } from "@/server/oauth/request";
import { zohoSignInConfigured } from "@/server/oauth/runtime";
import { withErrorCapture } from "@/server/ops/runtime";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const MAX_BODY = 1024;
type Ctx = { params: Promise<{ id: string }> };

async function put(req: Request, ctx: Ctx) {
  if (!zohoSignInConfigured()) return Response.json({ error: "Managers are changed once Zoho sign-in is connected.", code: "not-configured" }, { status: 503, headers: NO_STORE });
  const s = await sessionCredential();
  if (!s.ok) return s.response;
  const { id } = await ctx.params;
  const raw = await req.text().catch(() => "");
  let manager: unknown = undefined;
  if (raw.length <= MAX_BODY) {
    try { const p: unknown = JSON.parse(raw); manager = p && typeof p === "object" && !Array.isArray(p) && "manager" in p ? (p as { manager?: unknown }).manager : undefined; } catch { manager = undefined; }
  }
  const r = await managerChanges().change(s.credential, s.session, { whom: id, manager });
  if (!r.ok) return Response.json({ error: r.message, code: r.refusal, ...(r.lose ? { lose: r.lose } : {}) }, { status: r.status, headers: NO_STORE });
  return Response.json({ whom: r.whom, from: r.from, to: r.to }, { headers: NO_STORE });
}

export const PUT = withErrorCapture(guardApi("/api/users/[id]/manager", put), "/api/users/[id]/manager");
