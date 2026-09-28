/* GET /api/farms/[id] — one LLP (M11-S01-T02): its row, masked PAN/GST, SPOCs and insurance. */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { failureResponse, NO_STORE, routeContext } from "@/server/cases/http";
import { createFarmShelf } from "@/server/farms/shelf";

export const dynamic = "force-dynamic";

async function get(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await routeContext();
  if (!c.ok) return c.response;
  const { id } = await params;
  const r = await createFarmShelf(c.ctx).one({ credential: c.ctx.credential, seat: c.ctx.seat }, id, req.signal);
  if (!r.ok) return failureResponse(r);
  return Response.json({ farm: r.farm, superUser: r.superUser }, { headers: NO_STORE });
}

export const GET = withErrorCapture(guardApi("/api/farms", get), "/api/farms/[id]");
