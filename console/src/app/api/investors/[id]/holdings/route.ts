/* GET /api/investors/[id]/holdings — ARL holdings and their transactions, read-only (M10-S09-T01).
   Related-list reads on the viewer's own token; Finance-side seats with a holdings book only. This route
   exports GET and nothing else: the ledger is never written from the console (D70). */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { failureResponse, investorsContext, NO_STORE } from "@/server/investors/http";

export const dynamic = "force-dynamic";

async function get(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await investorsContext();
  if (!c.ok) return c.response;
  const { id } = await params;
  const { createHoldingsReader } = await import("@/server/investors/holdings");
  const { rt, crm, principal } = c.ctx;
  const r = await createHoldingsReader({ crm, events: rt.events }).read(principal.credential, principal.session.seat, id, req.signal);
  if (!r.ok) return failureResponse(r);
  return Response.json({ contactId: r.contactId, holdings: r.holdings, readOnly: true, truncated: r.truncated }, { headers: NO_STORE });
}

export const GET = withErrorCapture(guardApi("/api/investors", get), "/api/investors/[id]/holdings");
