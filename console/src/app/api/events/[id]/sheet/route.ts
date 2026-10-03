/* GET /api/events/[id]/sheet — the sheet's state on Lead_Events (M14-S03-W2): the card's source instead of the demo book.
   200 → { sheet: { eventId, eventName, state: "none" | "ready" | "loaded", inFile, willLoad, duplicates, refused, loaded,
                    filledBy, filledAt, loadedBy: { id, name } | null, loadedAt (naive IST), rule, staff: [{ id, name }] (named order),
                    mayLoad, log: [{ at, what, by, note }] } }
   PROVISIONAL: willLoad, filledBy/At and rule are null (Zoho holds no row counts for a Ready sheet and no rule — it needs
   Lead_Events.Sheet_Rows, Sheet_Filled_By/At and Load_Rule). No lead is read and no identity field is served.
   400 not an id · 403 not your seat · 404 gone or not yours · 502/503 Zoho not answering.
   POST /api/events/[id]/sheet — load the event's tablet sheet once (M14-S03-T01).
   Body: { rule: { kind: "round-robin" | "me" | "unassigned" } | { kind: "one", ownerId }, rows: [{ name, mobile, email?, city?, units?, consent: { msg, call, email? } }] }.
   PROVISIONAL (jev 0.95): the rows are the sheet as the page read it; every row is re-checked here. A Sheet reader replaces the body later.
   200 → { load: { inFile, loaded, duplicates, refused, split[{ownerId,count}], assigned[{leadId,ownerId}], rows[], countsSaved } }
   403 capability-missing ("Your seat does not load event sheets; …"); 409 already-loaded ("A sheet loads once."); 422 owner-missing. */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { failureResponse, NO_STORE, routeContext } from "@/server/cases/http";

export const dynamic = "force-dynamic";
const MAX_BODY = 512 * 1024;

async function get(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await routeContext();
  if (!c.ok) return c.response;
  const { eventServices } = await import("@/server/events/http");
  const { createSheetState } = await import("@/server/events/sheet-state");
  const r = await createSheetState({ crm: c.ctx.crm, events: c.ctx.events, authority: eventServices(c.ctx).authority })
    .forEvent({ credential: c.ctx.credential, seat: c.ctx.seat }, (await params).id, req.signal);
  if (!r.ok) return failureResponse(r);
  return Response.json({ sheet: r.sheet }, { headers: NO_STORE });
}

async function post(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await routeContext();
  if (!c.ok) return c.response;
  const { id } = await params;
  const raw = await req.text().catch(() => "");
  if (raw.length > MAX_BODY) return Response.json({ error: "The sheet is too long.", code: "too-many-rows" }, { status: 413, headers: NO_STORE });
  let body: { rule?: unknown; rows?: unknown } | null = null;
  try { body = JSON.parse(raw); } catch { body = null; }
  const { eventServices, WRITE_STATUS } = await import("@/server/events/http");
  const rows = Array.isArray(body?.rows) ? body!.rows : null;
  const r = await eventServices(c.ctx).loader.load(c.ctx.credential, id, body?.rule as never, { rows: async () => rows as never }, req.signal);
  if (r.ok) return Response.json({ load: r.value }, { headers: NO_STORE });
  if (r.kind === "refused") return Response.json({ error: r.reason, code: r.reasonCode }, { status: WRITE_STATUS[r.reasonCode] ?? 403, headers: NO_STORE });
  return failureResponse(r);
}

export const GET = withErrorCapture(guardApi("/api/events/[id]/sheet", get), "/api/events/[id]/sheet");
export const POST = withErrorCapture(guardApi("/api/events", post), "/api/events/[id]/sheet");
