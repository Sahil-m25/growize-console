/* POST /api/holds/[id]/extend { days, reason, expectedModifiedTime? } — 'Extend the hold' (M08-S04-T02): the Head of
   Finance or the super user; one guarded edit (old deadline + days, IST) held by Zoho's approval process
   (GZ_EXTEND_APPROVAL=on once Sahil has built it). 200 → { state: "pending-approval" | "extended", from, to }. */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { jsonBody, NO_STORE } from "@/server/cases/http";
import { requestHoldExtension } from "@/server/holds/extend";
import { holdsContext, holdsPublish } from "@/server/holds/runtime";
import { authorityEvents } from "@/server/identity/authority";

export const dynamic = "force-dynamic";

async function post(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await holdsContext();
  if (!c.ok) return c.response;
  const { id } = await params;
  const r = await requestHoldExtension({
    crm: c.ctx.crm, as: c.ctx.credential, session: c.ctx.session, allotmentId: id, body: await jsonBody(req, 4096),
    events: authorityEvents(), publish: await holdsPublish(), approvalConfigured: process.env.GZ_EXTEND_APPROVAL === "on",
  });
  if (!r.ok) return Response.json({ error: r.message, code: r.refusal }, { status: r.status, headers: NO_STORE });
  return Response.json({ allotmentId: r.allotmentId, state: r.state, from: r.from, to: r.to }, { headers: NO_STORE });
}

export const POST = withErrorCapture(guardApi("/api/holds", post), "/api/holds/[id]/extend");
