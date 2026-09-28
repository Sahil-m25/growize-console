/* POST /api/cases/[id]/handover — a KAM (or the super user) hands a Bank or Compliance ticket to Finance and
   keeps watching it (M13-S04-T01). { expectedModifiedTime? } → 200 { row, to, already }: Handed_By/Handed_At
   written (guarded), then Cases change_owner to Finance Operations (else the Head of Finance), on the person's
   own token. 403 read only / not yours · 404 · 409 changed since loaded, already with Finance, nobody in Finance
   · 422 not a bank/compliance ticket held by Account Management · 503 Zoho not answering. Server: server/cases/handover. */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { jsonBody, NO_STORE, routeContext, writeFailure } from "@/server/cases/http";
import { createCaseHandover } from "@/server/cases/handover";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

async function post(req: Request, { params }: Ctx) {
  const c = await routeContext();
  if (!c.ok) return c.response;
  const b = await jsonBody(req, 4 * 1024);
  const { oauthParts } = await import("@/server/oauth/runtime");
  const r = await createCaseHandover({ ...c.ctx, seats: oauthParts().seats })
    .handToFinance({ credential: c.ctx.credential, seat: c.ctx.seat }, (await params).id, b.expectedModifiedTime, req.signal);
  if (!r.ok) return writeFailure(r);
  return Response.json({ row: r.row, to: r.to, already: r.already }, { headers: NO_STORE });
}

export const POST = withErrorCapture(guardApi("/api/cases/[id]/handover", post), "/api/cases/[id]/handover");
