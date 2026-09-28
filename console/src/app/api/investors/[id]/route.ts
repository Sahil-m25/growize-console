/* GET /api/investors/[id] — one investor opened by URL or from a lead page (M03-S09, D69): the IR guard
   decides first (live.investor), then that Contact's allotments (and receipts, for a seat with money).
   A record the person may not see is refused (403), never "not found". */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { failureResponse, investorsContext, NO_STORE } from "@/server/investors/http";

export const dynamic = "force-dynamic";

async function get(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await investorsContext();
  if (!c.ok) return c.response;
  const { id } = await params;
  const r = await c.ctx.layer.investor(c.ctx.principal, id, req.signal);
  if (!r.ok) return failureResponse(r);
  return Response.json({ investor: r.investor, allotments: r.allotments, receipts: r.receipts }, { headers: NO_STORE });
}

export const GET = withErrorCapture(guardApi("/api/investors", get), "/api/investors/[id]");
