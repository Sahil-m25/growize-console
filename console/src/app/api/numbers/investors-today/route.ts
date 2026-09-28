/* GET /api/numbers/investors-today — the headline figures on Today, Investors side (M05-S06-T01): banked to date,
   balance outstanding (matched receipts only, D21), units held of released and tickets open, each with when it was
   read and a stale/error state (D41). Aggregates only, in the scope-keyed cache (D53); at most five COQL calls cold. */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { NO_STORE, routeContext } from "@/server/cases/http";
import { createInvestorsToday } from "@/server/numbers/investors-today";

export const dynamic = "force-dynamic";

async function get(req: Request) {
  const c = await routeContext();
  if (!c.ok) return c.response;
  const r = await createInvestorsToday(c.ctx).read({ credential: c.ctx.credential, seat: c.ctx.seat }, req.signal);
  if (!r.ok) return Response.json({ error: "This page is not part of your seat.", code: r.reason }, { status: 403, headers: NO_STORE });
  return Response.json(r.value, { headers: NO_STORE });
}

export const GET = withErrorCapture(guardApi("/api/numbers/investors-today", get), "/api/numbers/investors-today");
