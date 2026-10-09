/* POST /api/leads/[id]/touches — record one touch with no next step: the quick log (logTouch) and the backdated entry or
   inbound reply (saveTouch). Header Idempotency-Key (one per press).
   Body: { expectedModifiedTime, channel: "msg"|"email"|"call"|"visit"|"reply", occurredAt?, reached?, outcome?, note? }
   200 → { touchId, modifiedTime, firstTouch }   4xx → { error, code } — nothing was written (server/leads/touches record).
   Consent is checked per channel except for a reply; a call or visit counts toward First touch only when `reached`. */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { touchesService } from "@/server/leads/followup-runtime";
import type { TouchCommand } from "@/server/leads/touches";
import { answer, leadWrite, NO_STORE } from "@/app/api/leads/http";
import { emailConfigured } from "@/server/leads/email-runtime";
import { sessionCredential } from "@/server/oauth/request";
import { SID_COOKIE } from "@/server/oauth/user-session";
import { cookies } from "next/headers";

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

/* GET — the lead's logged touches, newest first, on the person's own token: the Investor file's conversation history
   (W3-E2E-7: the file forgot every touch on reload because live mode never read them back).
   200 → { leadId, touches: [{ id, channel, outcome, note, at, byId, reply }], truncated }   4xx → { error, code }. */
async function get_(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!emailConfigured()) return Response.json({ error: "This is read from Zoho once sign-in is connected.", code: "not-configured" }, { status: 503, headers: NO_STORE });
  const s = await sessionCredential();
  if (!s.ok) return s.response;
  const { id } = await params;
  const sid = (await cookies()).get(SID_COOKIE)?.value ?? "";
  return answer(await touchesService().list({ credential: s.credential, sessionId: sid }, id, req.signal));
}

export const GET = withErrorCapture(guardApi("/api/leads", get_), "/api/leads/[id]/touches");
