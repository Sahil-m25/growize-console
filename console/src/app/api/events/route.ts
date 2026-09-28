/* GET /api/events — Upcoming and Completed events with what each produced (M14-S01-T02). */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { cacheView, failureResponse, NO_STORE, routeContext } from "@/server/cases/http";
import { createEventsService } from "@/server/events/events";

export const dynamic = "force-dynamic";

async function get(req: Request) {
  const c = await routeContext();
  if (!c.ok) return c.response;
  const r = await createEventsService(c.ctx).list({ credential: c.ctx.credential, seat: c.ctx.seat }, req.signal);
  if (!r.ok) return failureResponse(r);
  return Response.json({ upcoming: r.upcoming, completed: r.completed, truncated: r.truncated, stats: cacheView(r.stats) }, { headers: NO_STORE });
}

export const GET = withErrorCapture(guardApi("/api/events", get), "/api/events");
