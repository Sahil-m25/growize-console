/* POST /api/investors/[id]/kam/share/retry — D121 A: queue the KAM share again and try it inside this request's deadline.
   kam-assign's authority (the Investors-side "assign" right from the live session), and the Contact visible on the
   person's own token; the share itself is made by the share service, never on this person's token.
   200 → { share: { state, lastTriedAt } } · 403 → seat-denied / not-visible · 400 → invalid-request · 503 → not answering. */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { failureResponse, investorsContext, NO_STORE } from "@/server/investors/http";

export const dynamic = "force-dynamic";

async function post_(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await investorsContext();
  if (!c.ok) return c.response;
  const { id } = await params;
  const { createKamShareStatus } = await import("@/server/investors/kam-share-status");
  const { kamShareQueue } = await import("@/server/investors/kam-share-runtime");
  const { mayAssignKam } = await import("@/server/investors/kam-authority");
  const { pastStopMargin } = await import("@/lib/zoho/deadline");
  const { rt, crm, principal } = c.ctx;
  const r = await createKamShareStatus({ crm, queue: kamShareQueue(), events: rt.events, authority: { mayAssign: mayAssignKam }, shouldStop: () => pastStopMargin() })
    .retry(principal.credential, principal.sessionId, id);
  if (r.ok) return Response.json({ share: r.value }, { headers: NO_STORE });
  if (r.kind === "refused" && r.reason === "invalid-request") return Response.json({ error: "The request is not valid.", code: "invalid-request" }, { status: 400, headers: NO_STORE });
  return failureResponse(r);
}

export const POST = withErrorCapture(guardApi("/api/investors/[id]/kam/share/retry", post_), "/api/investors/[id]/kam/share/retry");
