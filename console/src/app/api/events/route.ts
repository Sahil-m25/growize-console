/* GET /api/events — Upcoming and Completed events with what each produced (M14-S01-T02).
   POST /api/events — add an event (M14-S02-T01). Body: { name, startsOn, endsOn, city, kind, channel, state, cost, namesTaken?, staffIds[] }.
   200 → { event: { eventId, name, startsOn, endsOn, city, staffIds, state } }; 422 → { error, code: "gaps", gaps[] }; 403 → an IR (no events · edit). */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { cacheView, failureResponse, NO_STORE, routeContext } from "@/server/cases/http";
import { createEventsService } from "@/server/events/events";

export const dynamic = "force-dynamic";
const MAX_BODY = 8 * 1024;

async function get(req: Request) {
  const c = await routeContext();
  if (!c.ok) return c.response;
  const r = await createEventsService(c.ctx).list({ credential: c.ctx.credential, seat: c.ctx.seat }, req.signal);
  if (!r.ok) return failureResponse(r);
  return Response.json({ upcoming: r.upcoming, completed: r.completed, truncated: r.truncated, stats: cacheView(r.stats) }, { headers: NO_STORE });
}

async function post(req: Request) {
  const c = await routeContext();
  if (!c.ok) return c.response;
  const raw = await req.text().catch(() => "");
  if (raw.length > MAX_BODY) return Response.json({ error: "The event is too long.", code: "invalid-request" }, { status: 413, headers: NO_STORE });
  let body: unknown = null;
  try { body = JSON.parse(raw); } catch { body = null; }
  const { eventServices, WRITE_STATUS } = await import("@/server/events/http");
  const r = await eventServices(c.ctx).writes.create(c.ctx.credential, body as never, req.signal);
  if (r.ok) return Response.json({ event: r.value }, { headers: NO_STORE });
  if (r.kind === "refused") return Response.json({ error: r.reason, code: r.reasonCode, ...(r.gaps ? { gaps: r.gaps } : {}) }, { status: WRITE_STATUS[r.reasonCode] ?? 403, headers: NO_STORE });
  return failureResponse(r);
}

export const GET = withErrorCapture(guardApi("/api/events", get), "/api/events");
export const POST = withErrorCapture(guardApi("/api/events", post), "/api/events");
