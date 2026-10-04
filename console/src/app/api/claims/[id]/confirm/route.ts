/* POST /api/claims/[id]/confirm — "Confirm and record it" (M10-S03-T01).
   Header Idempotency-Key (one per press). Body: { ref (the bank reference Finance found), receivedOn? }.
   Records ONE receipt from the report's kind / mode / amount / date on the report's allotment, recorded by the person
   pressing — and matched by them at once when the paper allows (D113: Finance's confirmation is the approval) — then
   answers the report. Until this press the IR's report stays pending (Match_State Claimed).
   200 → { confirm: { claimId, receipt, answered, linked } } · 403 not Finance · 409 answered / changed · 422 reference. */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { NO_STORE, claimsContext, jsonBody } from "../../http";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

async function post_(req: Request, { params }: Ctx) {
  const c = await claimsContext();
  if (!c.ok) return c.response;
  const r = await c.answers.confirm(c.principal, (await params).id, await jsonBody(req), req.headers.get("Idempotency-Key"), req.signal);
  if (r.ok) return Response.json({ confirm: r.value }, { headers: NO_STORE });
  return c.moneyFailure(r, NO_STORE);
}

export const POST = withErrorCapture(guardApi("/api/claims/[id]/confirm", post_), "/api/claims/[id]/confirm");
