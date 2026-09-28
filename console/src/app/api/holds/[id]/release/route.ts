/* POST /api/holds/[id]/release — 'Release the reservation' (M08-S04-T02): a live step-up for "release", the Head of
   Finance or the super user, a run-out hold with money still due and no unmatched receipt. The cancel goes through
   server/access/lapse-release (Zoho's approval process); once it stands the Pending Refund is raised and hold.changed
   'lapsed' emitted. Pressing again after approval settles the refund once.
   200 → { state: "pending-approval" | "released", units, forfeit, refund, refundReceiptId }. */
import { guardApi } from "@/server/access/guard";
import { requireStepUp } from "@/server/access/runtime";
import { withErrorCapture } from "@/server/ops/runtime";
import { NO_STORE } from "@/server/cases/http";
import { createHoldLapse } from "@/server/holds/lapse";
import { holdsContext, holdsPublish } from "@/server/holds/runtime";
import { authorityEvents } from "@/server/identity/authority";
import { createAllotmentReceiptWrites } from "@/server/money/allotment-receipts";

export const dynamic = "force-dynamic";

async function post(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const c = await holdsContext();
  if (!c.ok) return c.response;
  const { id } = await params;
  const writes = createAllotmentReceiptWrites({
    crm: c.ctx.crm, log: c.ctx.log, recordIdPrefix: c.ctx.recordIdPrefix,
    // guarded() never calls the replay path; the Refund is written by the lapse itself.
    replay: { async replay() { return { ok: false, kind: "source-error", source: "zoho", errorKind: "unexpected", retryable: false }; } },
  });
  const r = await createHoldLapse({
    crm: c.ctx.crm, writes, publish: await holdsPublish(), events: authorityEvents(),
    approvalConfigured: process.env.GZ_RELEASE_APPROVAL === "on",
  }).lapse({ credential: c.ctx.credential, sessionId: c.ctx.sessionId, session: c.ctx.session }, id);
  if (!r.ok) return Response.json({ error: r.message, code: r.refusal }, { status: r.status, headers: NO_STORE });
  const { event: _e, ...body } = r.value;
  return Response.json(body, { headers: NO_STORE });
}

export const POST = withErrorCapture(guardApi("/api/holds", requireStepUp("release", post)), "/api/holds/[id]/release");
