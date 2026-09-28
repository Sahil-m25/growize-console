/* GET /api/farms/[id]/allotments — the investors holding allotments in one LLP (M11-S02-T02): the
   LLP→allotment related list on the person's own token; a KAM or an IR sees only their own investors.
   Cancelled allotments are listed but not counted in the units. Read-only; nothing kept (D45). */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { failureResponse, investorsContext, NO_STORE } from "@/server/investors/http";

export const dynamic = "force-dynamic";

async function get(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await investorsContext();
  if (!c.ok) return c.response;
  const { id } = await params;
  const { createAllotmentReader } = await import("@/server/investors/allotments");
  const { rt, crm, principal } = c.ctx;
  const r = await createAllotmentReader({ crm, events: rt.events }).byLlp(principal.credential, principal.session.seat, id, req.signal);
  if (!r.ok) return failureResponse(r);
  return Response.json({ llpId: r.llpId, allotments: r.rows, units: r.units, scoped: r.scoped, money: r.money, truncated: r.truncated }, { headers: NO_STORE });
}

export const GET = withErrorCapture(guardApi("/api/farms", get), "/api/farms/[id]/allotments");
