/* GET /api/events/[id] — one event: the leads the viewer may open, and a count of the rest (M14-S01-T02, D69). */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { failureResponse, NO_STORE, routeContext } from "@/server/cases/http";
import { createEventsService } from "@/server/events/events";

export const dynamic = "force-dynamic";

async function get(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await routeContext();
  if (!c.ok) return c.response;
  const { id } = await params;
  const r = await createEventsService(c.ctx).one({ credential: c.ctx.credential, seat: c.ctx.seat }, id, req.signal);
  if (!r.ok) return failureResponse(r);
  return Response.json({ event: r.event, leads: r.leads, othersCount: r.othersCount, truncated: r.truncated }, { headers: NO_STORE });
}

export const GET = withErrorCapture(guardApi("/api/events", get), "/api/events/[id]");
