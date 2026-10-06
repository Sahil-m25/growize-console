/* POST /api/leads/[id]/followup — the follow-up save: the lead page's finish flow (lpFinish), "they're out" (lpLose) and the
   follow-up drawer (saveFollowup). Header Idempotency-Key (one per press).
   Body: { expectedModifiedTime, contact: { channel, outcome, occurredAt, reached, note? }, scheduled: { module, id } | null,
           complete, keep, next: { text, at, channel } | null, lost?: { reason } }
   200 → { touchId, nextId, undoToken, undoUntil }   4xx → { error, code } — nothing was written (server/leads/followup save).
   The Lead is written first with If-Unmodified-Since (409 lead-changed), then the Touch, the closed Task and the next step. */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { followupService } from "@/server/leads/followup-runtime";
import type { FollowupCommand } from "@/server/leads/followup";
import { leadWrite } from "@/app/api/leads/http";

export const dynamic = "force-dynamic";

async function post_(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return leadWrite(req, ctx, {
    idem: "followup",
    run: ({ principal, leadId, body, signal }) => followupService().save(principal, {
      leadId,
      expectedModifiedTime: body.expectedModifiedTime as string,
      contact: body.contact as FollowupCommand["contact"],
      scheduled: (body.scheduled ?? null) as FollowupCommand["scheduled"],
      complete: body.complete as boolean,
      keep: body.keep as boolean,
      next: (body.next ?? null) as FollowupCommand["next"],
      ...(body.lost !== undefined ? { lost: body.lost as FollowupCommand["lost"] } : {}),
    }, signal),
  });
}

export const POST = withErrorCapture(guardApi("/api/leads", post_), "/api/leads/[id]/followup");
