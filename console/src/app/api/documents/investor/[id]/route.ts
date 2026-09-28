/* GET /api/documents/investor/[id] — M12-S01-T03: one investor's papers in D70's three scopes (personal on the
   Contact, per allotment, project on the LLPs they hold), read on the viewer's own token and cut to what the seat
   may see (server/documents/scope). Metadata only, never a file body. 200 → { documents } · 403 · 503 */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { failureResponse, investorsContext, NO_STORE } from "@/server/investors/http";

export const dynamic = "force-dynamic";

async function get(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await investorsContext();
  if (!c.ok) return c.response;
  const { id } = await params;
  const { createDocumentsReader } = await import("@/server/documents/reader");
  const { rt, crm, principal } = c.ctx;
  const r = await createDocumentsReader({ crm, events: rt.events }).forInvestor(principal.credential, principal.session.seat, id, req.signal);
  if (!r.ok) return failureResponse(r);
  return Response.json({ documents: r.documents }, { headers: NO_STORE });
}

export const GET = withErrorCapture(guardApi("/api/documents", get), "/api/documents/investor/[id]");
