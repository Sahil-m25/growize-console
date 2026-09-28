/* POST /api/claims/[id]/not-there — "Not there yet" with a reason (M10-S03-T01).
   Body: { reason } (≤ 500). The reason goes on the report as a Note under the person's name, the report is answered
   (its IR fields untouched) and money.not_found is published. 200 → { answer: { claimId, says, duplicate, moneyNotFound } }. */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { NO_STORE, claimsContext, jsonBody } from "../../http";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

async function post_(req: Request, { params }: Ctx) {
  const c = await claimsContext();
  if (!c.ok) return c.response;
  const r = await c.answers.notThere(c.principal, (await params).id, await jsonBody(req), req.signal);
  if (r.ok) return Response.json({ answer: r.value }, { headers: NO_STORE });
  return c.moneyFailure(r, NO_STORE);
}

export const POST = withErrorCapture(guardApi("/api/claims/[id]/not-there", post_), "/api/claims/[id]/not-there");
