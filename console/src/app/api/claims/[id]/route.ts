/* GET /api/claims/[id] — the claim drawer (M10-S03-T01): the IR's words and who wrote them, already in /
   outstanding / hold ends, Finance named as the doer (and the super-user note), and the two answers offered.
   200 → { claim: ClaimDetail } · 403 not Finance / not visible · 409 already answered. */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { NO_STORE, claimsContext } from "../http";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

async function get_(req: Request, { params }: Ctx) {
  const c = await claimsContext();
  if (!c.ok) return c.response;
  const r = await c.answers.detail(c.principal, (await params).id, req.signal);
  if (r.ok) return Response.json({ claim: r.value }, { headers: NO_STORE });
  return c.moneyFailure(r, NO_STORE);
}

export const GET = withErrorCapture(guardApi("/api/claims/[id]", get_), "/api/claims/[id]");
