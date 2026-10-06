/* POST /api/leads/[id]/touches — record one touch with no next step: the quick log (logTouch) and the backdated entry or
   inbound reply (saveTouch). Header Idempotency-Key (one per press).
   Body: { expectedModifiedTime, channel: "msg"|"email"|"call"|"visit"|"reply", occurredAt?, reached?, outcome?, note? }
   200 → { touchId, modifiedTime, firstTouch }   4xx → { error, code } — nothing was written (server/leads/touches record).
   Consent is checked per channel except for a reply; a call or visit counts toward First touch only when `reached`. */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { touchesService } from "@/server/leads/followup-runtime";
import type { TouchCommand } from "@/server/leads/touches";
import { leadWrite } from "@/app/api/leads/http";

export const dynamic = "force-dynamic";

async function post_(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return leadWrite(req, ctx, {
    idem: "touch",
    run: ({ principal, leadId, body, signal }) => touchesService().record(principal, {
      leadId,
      expectedModifiedTime: body.expectedModifiedTime as string,
      channel: body.channel as TouchCommand["channel"],
      ...(body.occurredAt !== undefined ? { occurredAt: body.occurredAt as string } : {}),
      ...(body.reached !== undefined ? { reached: body.reached as boolean } : {}),
      ...(body.outcome !== undefined ? { outcome: body.outcome as string } : {}),
      ...(body.note !== undefined ? { note: body.note as string } : {}),
    }, signal),
  });
}

export const POST = withErrorCapture(guardApi("/api/leads", post_), "/api/leads/[id]/touches");
