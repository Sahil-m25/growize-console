/* /api/updates — investor updates (M13-S06-T02), on the person's own token.
   GET  → { rows, truncated, readOnly, kinds }   kinds = what this seat may publish (a KAM: Produce, Notice)
   POST { headline, kind: Produce|Statement|Compliance|Notice, audience: all|allotted|farm|nri, llpId?, body }
        → 201 { row, predicate, count, pushed: { queued, refused } }: the audience resolved as COQL at publish, the
        count stored on the record, then update.published pushed to exactly those investors.
   403 read only / kind is Finance's · 400 missing · 422 empty segment / NRI not storable / identity in text. */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { investorAppPush, jsonBody, NO_STORE, routeContext, writeFailure } from "@/server/cases/http";
import { createInvestorUpdates } from "@/server/updates/publish";

export const dynamic = "force-dynamic";

async function get(req: Request) {
  const c = await routeContext();
  if (!c.ok) return c.response;
  const r = await createInvestorUpdates(c.ctx).list({ credential: c.ctx.credential, seat: c.ctx.seat }, req.signal);
  if (!r.ok) return writeFailure(r);
  return Response.json({ rows: r.rows, truncated: r.truncated, readOnly: r.readOnly, kinds: r.kinds }, { headers: NO_STORE });
}

async function post(req: Request) {
  const c = await routeContext();
  if (!c.ok) return c.response;
  const b = await jsonBody(req);
  const r = await createInvestorUpdates({ ...c.ctx, push: await investorAppPush() }).publish({ credential: c.ctx.credential, seat: c.ctx.seat }, {
    headline: b.headline, kind: b.kind, audience: b.audience, llpId: b.llpId, body: b.body,
  }, req.signal);
  if (!r.ok) return writeFailure(r);
  return Response.json({ row: r.row, predicate: r.predicate, count: r.count, pushed: r.pushed }, { status: 201, headers: NO_STORE });
}

export const GET = withErrorCapture(guardApi("/api/updates", get), "/api/updates");
export const POST = withErrorCapture(guardApi("/api/updates", post), "/api/updates");
