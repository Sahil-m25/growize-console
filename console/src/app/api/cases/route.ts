/* /api/cases — the tickets register (M13-S02-T02) and opening a ticket (M13-S03-T02), on the person's own token.
   GET  → { rows, truncated, cuts, mine, readOnly, offersMine }
   POST { investorId, category: Bank|Query|Records|Access|Compliance, subject, description?, priority?: high|normal,
          ownerId?, origin?: Email|Phone } → 201 { row }
   403 read only / cannot assign · 400 missing · 422 not in your book · 503 Zoho not answering. */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { cacheView, failureResponse, jsonBody, NO_STORE, routeContext, writeFailure } from "@/server/cases/http";
import { createCasesRegister } from "@/server/cases/register";
import { createCaseWrites } from "@/server/cases/writes";

export const dynamic = "force-dynamic";

async function get(req: Request) {
  const c = await routeContext();
  if (!c.ok) return c.response;
  const r = await createCasesRegister(c.ctx).list({ credential: c.ctx.credential, seat: c.ctx.seat }, req.signal);
  if (!r.ok) return failureResponse(r);
  return Response.json({ rows: r.rows, truncated: r.truncated, cuts: cacheView(r.cuts), mine: r.mine, readOnly: r.readOnly, offersMine: r.offersMine }, { headers: NO_STORE });
}

async function post(req: Request) {
  const c = await routeContext();
  if (!c.ok) return c.response;
  const b = await jsonBody(req);
  const r = await createCaseWrites(c.ctx).open({ credential: c.ctx.credential, seat: c.ctx.seat }, {
    investorId: b.investorId, category: b.category, subject: b.subject, description: b.description, priority: b.priority, ownerId: b.ownerId, origin: b.origin,
  }, req.signal);
  if (!r.ok) return writeFailure(r);
  return Response.json({ row: r.row }, { status: 201, headers: NO_STORE });
}

export const GET = withErrorCapture(guardApi("/api/cases", get), "/api/cases");
export const POST = withErrorCapture(guardApi("/api/cases", post), "/api/cases");
