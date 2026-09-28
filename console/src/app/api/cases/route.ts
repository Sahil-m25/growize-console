/* GET /api/cases — the tickets register scoped by seat (M13-S02-T02). Read only: no write route exists. */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { cacheView, failureResponse, NO_STORE, routeContext } from "@/server/cases/http";
import { createCasesRegister } from "@/server/cases/register";

export const dynamic = "force-dynamic";

async function get(req: Request) {
  const c = await routeContext();
  if (!c.ok) return c.response;
  const r = await createCasesRegister(c.ctx).list({ credential: c.ctx.credential, seat: c.ctx.seat }, req.signal);
  if (!r.ok) return failureResponse(r);
  return Response.json({ rows: r.rows, truncated: r.truncated, cuts: cacheView(r.cuts), mine: r.mine, readOnly: r.readOnly, offersMine: r.offersMine }, { headers: NO_STORE });
}

export const GET = withErrorCapture(guardApi("/api/cases", get), "/api/cases");
