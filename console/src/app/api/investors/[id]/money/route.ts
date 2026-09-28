/* GET /api/investors/[id]/money — the Money section per allotment (M10-S08-T01): one block per allotment
   (farm LLP) with its receipts, paid, due and Payment_Status, and a total when there is more than one.
   Finance side only: a KAM or an IR is refused (403). Read-only; nothing kept (D45). */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { failureResponse, investorsContext, NO_STORE } from "@/server/investors/http";

export const dynamic = "force-dynamic";

async function get(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await investorsContext();
  if (!c.ok) return c.response;
  const { id } = await params;
  const { createAllotmentReader } = await import("@/server/investors/allotments");
  const { createMoneyByAllotment } = await import("@/server/money/by-allotment");
  const { rt, crm, principal } = c.ctx;
  const allotments = createAllotmentReader({ crm, events: rt.events });
  const r = await createMoneyByAllotment({ allotments }).read(principal.credential, principal.session.seat, id, req.signal);
  if (!r.ok) return failureResponse(r);
  return Response.json({ money: r.money }, { headers: NO_STORE });
}

export const GET = withErrorCapture(guardApi("/api/investors", get), "/api/investors/[id]/money");
