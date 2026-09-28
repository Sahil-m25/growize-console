/* GET /api/documents/list?cut=out|all — M12-S03-T02: the Documents page, cut to the seat, on the viewer's own
   token. "out" = papers out for signature (rail badge = outCount); "all" = every paper with a request plus the
   files the seat may list. 200 → { documents } · 403 → { error, code } · 503 → { error, code, fresh } — no rows,
   with the time of the last good read (stale/error state; never old rows). */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { investorsContext, NO_STORE } from "@/server/investors/http";

export const dynamic = "force-dynamic";

async function get(req: Request) {
  const c = await investorsContext();
  if (!c.ok) return c.response;
  const { rt, crm, principal } = c.ctx;
  const { createDocumentsList } = await import("@/server/documents/list");
  const cut = new URL(req.url).searchParams.get("cut") ?? "out";
  const r = await createDocumentsList({ crm, log: rt.log }).read(principal.credential, principal.session.seat, cut as never, req.signal);
  if (r.ok) return Response.json({ documents: r.page }, { headers: NO_STORE });
  if (r.kind === "refused") return Response.json({ error: r.reason === "seat-denied" ? "Your seat has no Documents page." : "Unknown view.", code: r.reason }, { status: r.reason === "seat-denied" ? 403 : 400, headers: NO_STORE });
  return Response.json({ error: "Zoho is not answering. Try again.", code: r.errorKind, fresh: r.fresh }, { status: 503, headers: NO_STORE });
}

export const GET = withErrorCapture(guardApi("/api/documents", get), "/api/documents/list");
