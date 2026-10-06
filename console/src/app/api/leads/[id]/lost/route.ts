/* /api/leads/[id]/lost — close a lead as lost with no contact, and re-open it.
   POST   { expectedModifiedTime, reason (one of the eight), note? }   header Idempotency-Key (the note is inserted)
          → { noteId, modifiedTime }   (server/leads/followup close: Lost_At, Lost_Reason, Next_Step* cleared; refused once money is in)
   DELETE { expectedModifiedTime, next: { text, at, channel } | null }   a re-open, not a delete: Lost_At and Lost_Reason are
          cleared, and the caller supplies the next step that comes back (server/leads/followup reopen) → { modifiedTime }
   4xx → { error, code } — nothing was written. The close stays in Zoho's field history (Plane A). */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { followupService } from "@/server/leads/followup-runtime";
import type { FollowupCommand } from "@/server/leads/followup";
import { leadWrite } from "@/app/api/leads/http";

export const dynamic = "force-dynamic";

async function post_(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return leadWrite(req, ctx, {
    idem: "lost",
    run: ({ principal, leadId, body, signal }) => followupService().close(principal, {
      leadId,
      expectedModifiedTime: body.expectedModifiedTime as string,
      reason: body.reason as string,
      ...(body.note !== undefined ? { note: body.note as string | null } : {}),
    }, signal),
  });
}

async function delete_(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return leadWrite(req, ctx, {
    run: ({ principal, leadId, body, signal }) => followupService().reopen(principal, leadId, body.expectedModifiedTime as string,
      (body.next ?? null) as FollowupCommand["next"], signal),
  });
}

export const POST = withErrorCapture(guardApi("/api/leads", post_), "/api/leads/[id]/lost");
export const DELETE = withErrorCapture(guardApi("/api/leads", delete_), "/api/leads/[id]/lost");
