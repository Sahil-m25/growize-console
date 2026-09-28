/* GET /api/farms — the LLP shelf (M11-S01-T02): one row per LLP from LLP_Creation_Module on the person's own token. */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { cacheView, failureResponse, NO_STORE, routeContext } from "@/server/cases/http";
import { createFarmShelf } from "@/server/farms/shelf";

export const dynamic = "force-dynamic";

async function get(req: Request) {
  const c = await routeContext();
  if (!c.ok) return c.response;
  const r = await createFarmShelf(c.ctx).list({ credential: c.ctx.credential, seat: c.ctx.seat }, req.signal);
  if (!r.ok) return failureResponse(r);
  return Response.json({ rows: r.rows, truncated: r.truncated, totals: cacheView(r.totals), superUser: r.superUser }, { headers: NO_STORE });
}

export const GET = withErrorCapture(guardApi("/api/farms", get), "/api/farms");
