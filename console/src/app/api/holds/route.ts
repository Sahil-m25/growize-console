/* GET /api/holds — Holds running on Today (Investors side, M08-S04-T04): Reserved allotments whose hold ends on or
   before today + 21 (IST), by days left, with units, farm, balance due and the forfeit exposure. Money seats reading
   the whole book only; rows on the person's own token, never cached (D45). */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { failureResponse, NO_STORE } from "@/server/cases/http";
import { createHolds } from "@/server/holds/holds";
import { holdsContext } from "@/server/holds/runtime";

export const dynamic = "force-dynamic";

async function get(req: Request) {
  const c = await holdsContext();
  if (!c.ok) return c.response;
  const r = await createHolds(c.ctx).list({ credential: c.ctx.credential, seat: c.ctx.seat, mayRelease: c.ctx.mayRelease }, req.signal);
  if (!r.ok) return failureResponse(r);
  const { ok: _ok, ...body } = r;
  return Response.json(body, { headers: NO_STORE });
}

export const GET = withErrorCapture(guardApi("/api/holds", get), "/api/holds");
