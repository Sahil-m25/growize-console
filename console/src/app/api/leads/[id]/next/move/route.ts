/* POST /api/leads/[id]/next/move — move the dated next step by whole days, keeping its hour (pullIn, moveNextTo).
   Body: { expectedModifiedTime, days: -366..366 but not 0 (negative pulls it earlier), activity?: { module, id } | null }
   200 → { nextStepAt, undoToken, undoUntil }   4xx → { error, code } — nothing was written (server/leads/followup reschedule).
   A move is an update guarded by If-Unmodified-Since, not an insert, so it takes no Idempotency-Key. */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { followupService } from "@/server/leads/followup-runtime";
import type { FollowupCommand } from "@/server/leads/followup";
import { leadWrite } from "@/app/api/leads/http";

export const dynamic = "force-dynamic";

async function post_(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return leadWrite(req, ctx, {
    run: ({ principal, leadId, body, signal }) => followupService().reschedule(principal, leadId, body.expectedModifiedTime as string,
      (body.activity ?? null) as FollowupCommand["scheduled"], body.days as number, signal),
  });
}

export const POST = withErrorCapture(guardApi("/api/leads", post_), "/api/leads/[id]/next/move");
