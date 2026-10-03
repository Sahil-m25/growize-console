/* GET /api/cases/deliveries?ids=a,b,c — the list form of /api/cases/[id]/deliveries (M13-S05-W1): whether the replies on
   many tickets reached the investor app, in one read (the register asks once for its open rows instead of once per row).
   ids: up to 100 Case ids. 200 { cases: { [caseId]: { replies: [{ eventId, status, label, attempts, reason, deliveredAt }], label } } }
   — a Case the person may not read is simply absent. Ids and status only, never the reply text.
   400 no ids or a malformed id · 403 not your seat · 502/503 Zoho not answering. */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { failureResponse, NO_STORE, routeContext } from "@/server/cases/http";
import { createCaseDeliveries } from "@/server/cases/deliveries";

export const dynamic = "force-dynamic";

async function get(req: Request) {
  const c = await routeContext();
  if (!c.ok) return c.response;
  const raw = new URL(req.url).searchParams.get("ids") ?? "";
  const ids = raw ? raw.split(",") : [];
  const { investorAppDeliveries } = await import("@/server/contracts/runtime");
  const r = await createCaseDeliveries({ crm: c.ctx.crm, events: c.ctx.events, deliveries: investorAppDeliveries })
    .forCases({ credential: c.ctx.credential, seat: c.ctx.seat }, ids, req.signal);
  if (!r.ok) return failureResponse(r);
  return Response.json({ cases: r.cases }, { headers: NO_STORE });
}

export const GET = withErrorCapture(guardApi("/api/cases/deliveries", get), "/api/cases/deliveries");
