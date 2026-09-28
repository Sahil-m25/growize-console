/* GET /api/cases/[id]/deliveries — whether the replies on a ticket reached the investor app (M13-S05-T03).
   200 { caseId, replies: [{ eventId, status, label, attempts, reason, deliveredAt }], label } — label is the
   ticket's one line ("Delivered" only after the app's push.delivered; else "Not delivered yet"), null with no reply.
   Ids and status only, never the reply text. 403 not your seat · 404 not found or not yours · 503 Zoho not answering. */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { failureResponse, NO_STORE, routeContext } from "@/server/cases/http";
import { createCaseDeliveries } from "@/server/cases/deliveries";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

async function get(req: Request, { params }: Ctx) {
  const c = await routeContext();
  if (!c.ok) return c.response;
  const { investorAppDeliveries } = await import("@/server/contracts/runtime");
  const r = await createCaseDeliveries({ crm: c.ctx.crm, events: c.ctx.events, deliveries: investorAppDeliveries })
    .forCase({ credential: c.ctx.credential, seat: c.ctx.seat }, (await params).id, req.signal);
  if (!r.ok) return failureResponse(r);
  return Response.json({ caseId: r.caseId, replies: r.replies, label: r.label }, { headers: NO_STORE });
}

export const GET = withErrorCapture(guardApi("/api/cases/[id]/deliveries", get), "/api/cases/[id]/deliveries");
