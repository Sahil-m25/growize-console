/* GET /api/farms/shelf — the Farms tiles, per-LLP released / allotted / reserved-or-paid / free and who is on which
   LLP (M11-S03-T02). Counted off the allotment records on the person's own token; names only within the seat's
   Investors scope. Read-only: nothing here releases land or takes it back. Nothing kept (D45). */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { failureResponse, NO_STORE, routeContext } from "@/server/cases/http";
import { createFarmOccupancy } from "@/server/farms/occupancy";

export const dynamic = "force-dynamic";

async function get(req: Request) {
  const c = await routeContext();
  if (!c.ok) return c.response;
  const r = await createFarmOccupancy(c.ctx).read({ credential: c.ctx.credential, seat: c.ctx.seat }, req.signal);
  if (!r.ok) return failureResponse(r);
  const { ok: _ok, ...body } = r;
  return Response.json(body, { headers: NO_STORE });
}

export const GET = withErrorCapture(guardApi("/api/farms", get), "/api/farms/shelf");
