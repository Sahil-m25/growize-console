/* PUT /api/leads/[id]/next — set or replace the next step with no contact (saveNext). Header Idempotency-Key (one per press).
   Body: { expectedModifiedTime, next: { text, at, channel }, scheduled?: { module, id } | null }
   200 → { nextId, modifiedTime }   4xx → { error, code } — nothing was written (server/leads/followup setNext).
   The old open Task is deferred, never deleted. There is no DELETE here yet: clearing the next step waits on an owner ruling. */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { followupService } from "@/server/leads/followup-runtime";
import type { FollowupCommand } from "@/server/leads/followup";
import { leadWrite } from "@/app/api/leads/http";

export const dynamic = "force-dynamic";

async function put_(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return leadWrite(req, ctx, {
    idem: "next",
    run: ({ principal, leadId, body, signal }) => followupService().setNext(principal, {
      leadId,
      expectedModifiedTime: body.expectedModifiedTime as string,
      next: body.next as NonNullable<FollowupCommand["next"]>,
      scheduled: (body.scheduled ?? null) as FollowupCommand["scheduled"],
    }, signal),
  });
}

export const PUT = withErrorCapture(guardApi("/api/leads", put_), "/api/leads/[id]/next");
