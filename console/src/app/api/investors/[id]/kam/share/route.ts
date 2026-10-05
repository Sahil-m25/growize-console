/* GET /api/investors/[id]/kam/share — D121 A: where the share service's KAM share stands, for the investor drawer.
   On the signed-in person's own token: the Contact must be visible to them (server/investors/kam-share-status).
   200 → { share: { state: "shared"|"pending"|"failed"|"none", lastTriedAt: <epoch ms>|null } }
   403 → not-visible · 400 → invalid-request · 503 → Zoho or the state store not answering. Codes and ids only. */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { failureResponse, investorsContext, NO_STORE } from "@/server/investors/http";

export const dynamic = "force-dynamic";

async function get_(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await investorsContext();
  if (!c.ok) return c.response;
  const { id } = await params;
  const { createKamShareStatus } = await import("@/server/investors/kam-share-status");
  const { kamShareQueue } = await import("@/server/investors/kam-share-runtime");
  const { mayAssignKam } = await import("@/server/investors/kam-authority");
  const { rt, crm, principal } = c.ctx;
  const r = await createKamShareStatus({ crm, queue: kamShareQueue(), events: rt.events, authority: { mayAssign: mayAssignKam } }).status(principal.credential, id);
  if (r.ok) return Response.json({ share: r.value }, { headers: NO_STORE });
  if (r.kind === "refused" && r.reason === "invalid-request") return Response.json({ error: "The request is not valid.", code: "invalid-request" }, { status: 400, headers: NO_STORE });
  return failureResponse(r);
}

export const GET = withErrorCapture(guardApi("/api/investors/[id]/kam/share", get_), "/api/investors/[id]/kam/share");
