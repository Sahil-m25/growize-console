/* /api/farms/[id]/release — release a farm LLP's units (POST) or take them back (DELETE) (M11-S04-T01).
   Head of Finance only (the "farm" capability, server/access/policy). Body: { version } — the LLP's Modified_Time
   as the page loaded it (FarmRow.version); a newer one is a 409. A take-back while units are held is a 422 whose
   `error` names the units held (the in-page refusal); `held` carries the number. Written on the person's own token;
   nothing kept (D45). */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { investorAppPush, jsonBody, NO_STORE, routeContext, writeFailure } from "@/server/cases/http";
import { createFarmRelease, type ReleaseResult } from "@/server/farms/release";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function answer(r: ReleaseResult): Response {
  if (r.ok) return Response.json({ llpId: r.llpId, label: r.label, released: r.released, version: r.version, delivery: r.delivery }, { headers: NO_STORE });
  if (r.kind === "refused" && r.held !== undefined) {
    return Response.json({ error: r.message, code: r.reason, held: r.held }, { status: 422, headers: NO_STORE });
  }
  return writeFailure(r);
}

const versionOf = (body: Record<string, unknown>): string | null => (typeof body.version === "string" ? body.version : null);

async function post(req: Request, { params }: Ctx) {
  const c = await routeContext();
  if (!c.ok) return c.response;
  const { id } = await params;
  const body = await jsonBody(req);
  return answer(await createFarmRelease({ ...c.ctx, push: await investorAppPush() }).release({ credential: c.ctx.credential, seat: c.ctx.seat }, id, versionOf(body), req.signal));
}

async function del(req: Request, { params }: Ctx) {
  const c = await routeContext();
  if (!c.ok) return c.response;
  const { id } = await params;
  const body = await jsonBody(req);
  return answer(await createFarmRelease({ ...c.ctx, push: await investorAppPush() }).takeBack({ credential: c.ctx.credential, seat: c.ctx.seat }, id, versionOf(body), req.signal));
}

export const POST = withErrorCapture(guardApi("/api/farms", post), "/api/farms/[id]/release");
export const DELETE = withErrorCapture(guardApi("/api/farms", del), "/api/farms/[id]/release");
