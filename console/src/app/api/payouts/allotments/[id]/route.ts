/* GET /api/payouts/allotments/[id] — the investor page's Payouts tab for one allotment (M10-S20-T02): its
   schedule in instalment order with state, amounts, paid-on, mode, the UTR masked, paid-by and Modified_Time
   (send it back when marking paid). Finance seats only; own token; nothing kept.
   200 → { allotmentId, payouts: ScheduleLine[] } */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { investorsContext } from "@/server/investors/http";
import { NO_STORE, payoutReads, readFailure } from "@/server/payouts/http";

export const dynamic = "force-dynamic";

async function get(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await investorsContext();
  if (!c.ok) return c.response;
  const { id } = await params;
  const r = await (await payoutReads(c.ctx)).scheduleOf(c.ctx.principal.credential, id, req.signal);
  if (!r.ok) return readFailure(r);
  return Response.json({ allotmentId: r.allotmentId, payouts: r.payouts }, { headers: NO_STORE });
}

export const GET = withErrorCapture(guardApi("/api/payouts", get), "/api/payouts/allotments/[id]");
