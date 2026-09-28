/* GET /api/holds/land — the Land card on Today (Investors side, M08-S04-T04): per LLP free of total units and
   reserved units, counted off the allotments by server/farms/occupancy on the person's own token. */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { failureResponse, NO_STORE } from "@/server/cases/http";
import { createHolds } from "@/server/holds/holds";
import { holdsContext } from "@/server/holds/runtime";

export const dynamic = "force-dynamic";

async function get(req: Request) {
  const c = await holdsContext();
  if (!c.ok) return c.response;
  const r = await createHolds(c.ctx).land({ credential: c.ctx.credential, seat: c.ctx.seat }, req.signal);
  if (!r.ok) return failureResponse(r);
  const { ok: _ok, ...body } = r;
  return Response.json(body, { headers: NO_STORE });
}

export const GET = withErrorCapture(guardApi("/api/holds", get), "/api/holds/land");
