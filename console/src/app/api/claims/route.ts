/* GET /api/claims — the IR payment reports waiting on Finance (M10-S03, Today on the Investors side).
   Finance ("pay": Head of Finance, Finance Operations, super user) only; any other seat gets 403 and no report.
   200 → { claims: [{ claimId, leadId, allotmentId, kind, mode, amountRupees, saidOn, byId }], superUser }.
   Server: server/money/claim-answer.ts. */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { NO_STORE, claimsContext } from "./http";

export const dynamic = "force-dynamic";

async function get_(req: Request) {
  const c = await claimsContext();
  if (!c.ok) return c.response;
  const r = await c.answers.waiting(c.principal, req.signal);
  if (r.ok) return Response.json(r.value, { headers: NO_STORE });
  return c.moneyFailure(r, NO_STORE);
}

export const GET = withErrorCapture(guardApi("/api/claims", get_), "/api/claims");
