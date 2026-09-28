/* GET /api/payouts — Payments: "payouts due this month" (M10-S20-T02). Scheduled Investor_Payouts with Due_On
   in the current IST month across the allotments the seat sees, and apart the Scheduled ones overdue.
   Head of Finance and Finance Operations only; read on the person's own token; nothing kept.
   200 → { month: "YYYY-MM", due: QueueLine[], overdue: QueueLine[], truncated } */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { investorsContext } from "@/server/investors/http";
import { NO_STORE, payoutReads, readFailure } from "@/server/payouts/http";

export const dynamic = "force-dynamic";

async function get(req: Request) {
  const c = await investorsContext();
  if (!c.ok) return c.response;
  const r = await (await payoutReads(c.ctx)).dueQueue(c.ctx.principal.credential, req.signal);
  if (!r.ok) return readFailure(r);
  return Response.json({ month: r.month, due: r.due, overdue: r.overdue, truncated: r.truncated }, { headers: NO_STORE });
}

export const GET = withErrorCapture(guardApi("/api/payouts", get), "/api/payouts");
