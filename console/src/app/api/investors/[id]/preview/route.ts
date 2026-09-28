/* GET /api/investors/[id]/preview — the "Preview app" mock-up's data (M10-S22-T02): the investor record read
   on the viewer's own token plus that investor's Investor_Payouts, shaped as the app's screens. A seat without
   the investor in scope is refused 403 (the button is not offered). Amounts only for a seat whose record has
   Money; nothing in the answer changes anything. 200 → { preview } · 403 · 503 */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { failureResponse, investorsContext, NO_STORE } from "@/server/investors/http";

export const dynamic = "force-dynamic";

async function get(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await investorsContext();
  if (!c.ok) return c.response;
  const { id } = await params;
  const { createAppPreviewReader } = await import("@/server/investors/preview");
  const { rt, crm, principal } = c.ctx;
  const r = await createAppPreviewReader({ crm, events: rt.events, log: rt.log }).read(principal.credential, principal.session.seat, id, req.signal);
  if (!r.ok) return failureResponse(r);
  return Response.json({ preview: r.preview }, { headers: NO_STORE });
}

export const GET = withErrorCapture(guardApi("/api/investors/[id]/preview", get), "/api/investors/[id]/preview");
