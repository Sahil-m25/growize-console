/* GET /api/events/[id] — one event: the leads the viewer may open, and a count of the rest (M14-S01-T02, D69).
   PATCH /api/events/[id] — correct it (M14-S02-T01). Body: the event draft, plus optional modifiedTime (as loaded).
     200 → { event: { eventId, name, moved[{field,from,to}], taggedStay, modifiedTime } } — the "Changed the event" line.
   DELETE /api/events/[id]?confirm=1 — remove it. Without confirm → 428 { code: "confirm-needed", taggedLeads, eventName }
     (the in-page confirmation's numbers; nothing written). With confirm → every tagged lead's Lead_Event is cleared,
     then the event is deleted: 200 { removed: { eventId, name, leadsUntagged } }; 500 { code: "incomplete", cleared, left }. */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { failureResponse, NO_STORE, routeContext } from "@/server/cases/http";
import { createEventsService } from "@/server/events/events";

export const dynamic = "force-dynamic";
const MAX_BODY = 8 * 1024;
type Ctx = { params: Promise<{ id: string }> };

async function get(req: Request, { params }: Ctx) {
  const c = await routeContext();
  if (!c.ok) return c.response;
  const { id } = await params;
  const r = await createEventsService(c.ctx).one({ credential: c.ctx.credential, seat: c.ctx.seat }, id, req.signal);
  if (!r.ok) return failureResponse(r);
  return Response.json({ event: r.event, leads: r.leads, othersCount: r.othersCount, truncated: r.truncated }, { headers: NO_STORE });
}

async function patch(req: Request, { params }: Ctx) {
  const c = await routeContext();
  if (!c.ok) return c.response;
  const { id } = await params;
  const raw = await req.text().catch(() => "");
  if (raw.length > MAX_BODY) return Response.json({ error: "The event is too long.", code: "invalid-request" }, { status: 413, headers: NO_STORE });
  let body: Record<string, unknown> | null = null;
  try { body = JSON.parse(raw); } catch { body = null; }
  const { eventServices, WRITE_STATUS } = await import("@/server/events/http");
  const seen = body && typeof body.modifiedTime === "string" ? body.modifiedTime : null;
  const r = await eventServices(c.ctx).writes.update(c.ctx.credential, id, body as never, seen, req.signal);
  if (r.ok) return Response.json({ event: r.value }, { headers: NO_STORE });
  if (r.kind === "refused") return Response.json({ error: r.reason, code: r.reasonCode, ...(r.gaps ? { gaps: r.gaps } : {}), ...(r.staff ? { staff: r.staff } : {}) }, { status: WRITE_STATUS[r.reasonCode] ?? 403, headers: NO_STORE });
  return failureResponse(r);
}

async function del(req: Request, { params }: Ctx) {
  const c = await routeContext();
  if (!c.ok) return c.response;
  const { id } = await params;
  const confirmed = new URL(req.url).searchParams.get("confirm") === "1";
  const { eventServices, WRITE_STATUS } = await import("@/server/events/http");
  const r = await eventServices(c.ctx).writes.remove(c.ctx.credential, id, confirmed, req.signal);
  if (r.ok) return Response.json({ removed: r.value }, { headers: NO_STORE });
  if (r.kind === "incomplete") return Response.json({ error: r.reason, code: "incomplete", cleared: r.cleared, left: r.left }, { status: 500, headers: NO_STORE });
  if (r.kind === "refused") {
    return Response.json({ error: r.reason, code: r.reasonCode, ...(r.taggedLeads !== undefined ? { taggedLeads: r.taggedLeads, eventName: r.eventName } : {}) },
      { status: WRITE_STATUS[r.reasonCode] ?? 403, headers: NO_STORE });
  }
  return failureResponse(r);
}

export const GET = withErrorCapture(guardApi("/api/events", get), "/api/events/[id]");
export const PATCH = withErrorCapture(guardApi("/api/events", patch), "/api/events/[id]");
export const DELETE = withErrorCapture(guardApi("/api/events", del), "/api/events/[id]");
