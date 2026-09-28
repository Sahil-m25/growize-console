/* PATCH /api/cases/[id] — park a ticket waiting on the investor, or close it (M13-S03-T02).
   { to: "waiting" | "closed", expectedModifiedTime? } → 200 { row, already, modifiedTime }
   403 read only / not yours (Account Management works its own) / a bank ticket needs a bank seat ·
   404 not found · 409 changed since loaded ("reload") · 503 Zoho not answering. Server: server/cases/writes. */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { jsonBody, NO_STORE, routeContext, writeFailure } from "@/server/cases/http";
import { createCaseWrites } from "@/server/cases/writes";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

async function patch(req: Request, { params }: Ctx) {
  const c = await routeContext();
  if (!c.ok) return c.response;
  const b = await jsonBody(req, 4 * 1024);
  const r = await createCaseWrites(c.ctx).move({ credential: c.ctx.credential, seat: c.ctx.seat }, (await params).id, b.to, b.expectedModifiedTime, req.signal);
  if (!r.ok) return writeFailure(r);
  return Response.json({ row: r.row, already: r.already, modifiedTime: r.modifiedTime }, { headers: NO_STORE });
}

export const PATCH = withErrorCapture(guardApi("/api/cases/[id]", patch), "/api/cases/[id]");
