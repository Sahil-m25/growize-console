/* POST /api/cases/[id]/reply — answer the investor on a ticket (M13-S03-T02, closes M13-S01's gap).
   { message } → 201 { caseId, noteId, delivery: { eventId, label } }: a Note on the Case, then case.replied to the
   investor app through the signed outbox ("Not delivered yet" until the app answers push.delivered).
   403 read only / not yours · 404 · 422 an identity value in the text · 503 Zoho not answering. */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { investorAppPush, jsonBody, NO_STORE, routeContext, writeFailure } from "@/server/cases/http";
import { createCaseWrites } from "@/server/cases/writes";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

async function post(req: Request, { params }: Ctx) {
  const c = await routeContext();
  if (!c.ok) return c.response;
  const b = await jsonBody(req, 8 * 1024);
  const r = await createCaseWrites({ ...c.ctx, push: await investorAppPush() })
    .reply({ credential: c.ctx.credential, seat: c.ctx.seat }, (await params).id, b.message, req.signal);
  if (!r.ok) return writeFailure(r);
  return Response.json({ caseId: r.caseId, noteId: r.noteId, delivery: r.delivery }, { status: 201, headers: NO_STORE });
}

export const POST = withErrorCapture(guardApi("/api/cases/[id]/reply", post), "/api/cases/[id]/reply");
