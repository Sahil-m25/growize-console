/* GET /api/investors/[id]/record — the investor record (M09-S03-T01): one GET of the Contact plus its
   allotments (with LLP), and — only for a seat whose record has Money / Paper — Receipts and the D70
   attachments. `version` (Modified_Time) is what a later write sends as If-Unmodified-Since; that write's
   412 is answered 409 "Changed by someone else — reload."
   GC-1524: the record's Journey tab reads `story` (server/investors/story) — the origin lead's stamps and touches, on the
   same person's token, falling back to the Contact's own stamps where Zoho does not return the lead to them. */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { failureResponse, investorsContext, NO_STORE } from "@/server/investors/http";

export const dynamic = "force-dynamic";

async function get(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await investorsContext();
  if (!c.ok) return c.response;
  const { id } = await params;
  const { createInvestorRecordReader } = await import("@/server/investors/record");
  const { rt, crm, principal } = c.ctx;
  const r = await createInvestorRecordReader({ crm, events: rt.events }).read(principal.credential, principal.session.seat, id, req.signal, { story: true });
  if (!r.ok) return failureResponse(r);
  return Response.json({ record: r.record }, { headers: NO_STORE });
}

export const GET = withErrorCapture(guardApi("/api/investors", get), "/api/investors/[id]/record");
