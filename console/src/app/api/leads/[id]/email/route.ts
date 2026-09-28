/* POST /api/leads/[id]/email — the composer's Send (M07-S05-T02).
   Body: { expectedModifiedTime, template, subject, message, to?, scheduled? }. The recipient is always the
   lead's own address, read from Zoho; the sender is the signed-in person on their own token.
   200 → { sent: true, messageId, from, touchRecorded, touchId, notice }
   4xx → { error: <the inline message>, code }  — nothing was sent.
   Access guard: the parallel access work wraps API handlers with its guard; this route needs it too. */
import { cookies } from "next/headers";
import { noteZohoFailure } from "@/server/http/error-capture";
import { sessionCredential } from "@/server/oauth/request";
import { SID_COOKIE } from "@/server/oauth/user-session";
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import type { EmailRefusal } from "@/server/leads/email";
import { emailConfigured, emailSender } from "@/server/leads/email-runtime";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const MAX_BODY = 64 * 1024;
const STATUS: Partial<Record<EmailRefusal, number>> = {
  "session-changed": 401, "capability-missing": 403, "not-in-book": 403, "not-visible": 404,
  "lead-changed": 409, "sending": 409, "recipient-changed": 409, "too-long": 413,
  "daily-limit": 429, "send-unconfirmed": 502, "not-sent": 502, "zoho-consent": 422,
};

async function post_(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!emailConfigured()) return Response.json({ error: "Email is sent through Zoho once sign-in is connected." }, { status: 503, headers: NO_STORE });
  const s = await sessionCredential();
  if (!s.ok) return s.response;
  const { id } = await params;
  const raw = await req.text().catch(() => "");
  if (raw.length > MAX_BODY) return Response.json({ error: "Not sent — the email is too long.", code: "too-long" }, { status: 413, headers: NO_STORE });
  let body: Record<string, unknown> | null = null;
  try { const p: unknown = JSON.parse(raw); body = p && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, unknown>) : null; } catch { body = null; }
  if (!body) return Response.json({ error: "Not sent — the email is incomplete.", code: "invalid-request" }, { status: 400, headers: NO_STORE });
  const sid = (await cookies()).get(SID_COOKIE)?.value ?? "";
  const r = await emailSender().send({ credential: s.credential, sessionId: sid }, {
    leadId: id,
    expectedModifiedTime: body.expectedModifiedTime as string,
    template: body.template as string,
    subject: body.subject as string,
    message: body.message as string,
    ...(body.to !== undefined ? { to: body.to as string } : {}),
    ...(body.scheduled !== undefined ? { scheduled: body.scheduled as never } : {}),
  }, req.signal);
  if (r.ok) return Response.json(r.value, { headers: NO_STORE });
  if (r.kind === "refused") return Response.json({ error: r.reason, code: r.reasonCode }, { status: STATUS[r.reasonCode] ?? 422, headers: NO_STORE });
  if (r.errorKind !== "unexpected") noteZohoFailure({ kind: r.errorKind, status: null } as never);
  return Response.json({ error: "Not sent — Zoho is not answering. Try again.", code: r.errorKind }, { status: r.retryable ? 503 : 502, headers: NO_STORE });
}

export const POST = withErrorCapture(guardApi("/api/leads", post_), "/api/leads/[id]/email");
