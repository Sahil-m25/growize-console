/* GET /api/holds/[id] — one reservation's hold clock (M08-S04): days left and hold end by the one IST function, the
   forfeit of ₹50,000 a unit, and for a Money seat the balance due and what a lapse would refund; which of
   'Extend the hold' / 'Release the reservation' the seat is offered. Scope re-checked (ir-guard). */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { failureResponse, NO_STORE } from "@/server/cases/http";
import { createHolds } from "@/server/holds/holds";
import { holdsContext } from "@/server/holds/runtime";

export const dynamic = "force-dynamic";

async function get(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await holdsContext();
  if (!c.ok) return c.response;
  const { id } = await params;
  const r = await createHolds(c.ctx).one({ credential: c.ctx.credential, seat: c.ctx.seat, mayRelease: c.ctx.mayRelease }, id, req.signal);
  if (!r.ok) return failureResponse(r);
  return Response.json({ hold: r.hold, money: r.money }, { headers: NO_STORE });
}

export const GET = withErrorCapture(guardApi("/api/holds", get), "/api/holds/[id]");
