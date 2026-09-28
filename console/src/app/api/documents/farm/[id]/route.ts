/* GET /api/documents/farm/[id] — M12-S01-T03: one LLP's project papers plus, for the holders inside the viewer's
   own investors scope, their allotment papers (files, or a count only for an IR). Viewer's own token; metadata
   only. 200 → { documents } · 403 · 503 */
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
  const r = await createDocumentsReader({ crm, events: rt.events }).forFarm(principal.credential, principal.session.seat, id, req.signal);
  if (!r.ok) return failureResponse(r);
  return Response.json({ documents: r.documents }, { headers: NO_STORE });
}

export const GET = withErrorCapture(guardApi("/api/documents", get), "/api/documents/farm/[id]");
