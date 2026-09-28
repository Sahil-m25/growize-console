/* GET /api/investors/am — the account-management book's counts (M09-S02-T02): "N under care" and
   "No manager", cached under the AM scope (a KAM's by user, the Head of AM's by subtree — A-19).
   Counts only; any seat but a KAM or the Head of AM is refused. */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { failureResponse, investorsContext, NO_STORE } from "@/server/investors/http";

export const dynamic = "force-dynamic";

async function get(req: Request) {
  const c = await investorsContext();
  if (!c.ok) return c.response;
  const r = await c.ctx.layer.amSummary(c.ctx.principal, req.signal);
  if (r === null) return failureResponse({ kind: "refused", reason: "seat-denied" });
  if (r.state === "error") return failureResponse({ kind: "source-error", errorKind: "source-error" });
  return Response.json({ summary: r.value, state: r.state }, { headers: NO_STORE });
}

export const GET = withErrorCapture(guardApi("/api/investors", get), "/api/investors/am");
