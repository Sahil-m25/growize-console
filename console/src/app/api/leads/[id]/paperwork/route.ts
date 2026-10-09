/* /api/leads/[id]/paperwork — the lead page's Paperwork row (M12-S11-T02, M12-S12-T01).
   GET  → { leadId, modifiedTime, rounds: [{ round, title, next, told, reminders, said, draft, agreed, sent, verified }], offers: [{ round, beat, channels, rowToken }], suppUnread }
   POST { round: "nda"|"supp", beat: "told"|"chase"|"said"|"draft"|"redraft"|"agreed"|"request", channel?: "call"|"msg"|"email", rowToken, attachmentId? | link? }
        → { round, beat, modifiedTime, touchId, noteId, draftVersion, undoToken, undoUntil, already? }   (Undo lives 10 s)
        G1 "request": the IR asks Finance to send the round's paper (Lead.*_Requested_At/_By); `already: true` = asked before,
        nothing written; 409 already-sent = Finance has sent or verified it
   POST { undoToken } → { undone: true, round, beat }
   A draft file is first uploaded to the Lead's Attachments through POST /api/documents/upload?scope=lead (M12-S02),
   then named here by its attachmentId. 4xx → { error, code } — nothing was written. */
import { cookies } from "next/headers";
import { noteZohoFailure } from "@/server/http/error-capture";
import { sessionCredential } from "@/server/oauth/request";
import { SID_COOKIE } from "@/server/oauth/user-session";
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import type { PaperworkRefusal, PaperworkResult } from "@/server/leads/paperwork";
import { emailConfigured, paperworkService } from "@/server/leads/email-runtime";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const MAX_BODY = 8 * 1024;
const STATUS: Partial<Record<PaperworkRefusal, number>> = {
  "session-changed": 401, "capability-missing": 403, "not-in-book": 403, "not-visible": 404, "not-from-row": 403,
  "finance-beat": 403, "no-consent": 403, "lead-changed": 409, "out-of-order": 409, "lead-lost": 409,
  "undo-expired": 410, "undo-invalid": 403, "partial": 502, "source-invalid": 502, "already-sent": 409,
};
const NOT_READY = () => Response.json({ error: "Paperwork is recorded in Zoho once sign-in is connected.", code: "not-configured" }, { status: 503, headers: NO_STORE });

function answer<T>(r: PaperworkResult<T>): Response {
  if (r.ok) return Response.json(r.value, { headers: NO_STORE });
  if (r.kind === "refused") return Response.json({ error: r.reason, code: r.reasonCode }, { status: STATUS[r.reasonCode] ?? 422, headers: NO_STORE });
  if (r.errorKind !== "unexpected") noteZohoFailure({ kind: r.errorKind, status: null } as never);
  return Response.json({ error: "Not saved — Zoho is not answering. Try again.", code: r.errorKind }, { status: r.retryable ? 503 : 502, headers: NO_STORE });
}

async function get_(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!emailConfigured()) return NOT_READY();
  const s = await sessionCredential();
  if (!s.ok) return s.response;
  const { id } = await params;
  const sid = (await cookies()).get(SID_COOKIE)?.value ?? "";
  return answer(await paperworkService().read({ credential: s.credential, sessionId: sid }, id, _req.signal));
}

async function post_(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!emailConfigured()) return NOT_READY();
  const s = await sessionCredential();
  if (!s.ok) return s.response;
  const { id } = await params;
  const raw = await req.text().catch(() => "");
  let body: Record<string, unknown> | null = null;
  if (raw.length <= MAX_BODY) {
    try { const p: unknown = JSON.parse(raw); body = p && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, unknown>) : null; } catch { body = null; }
  }
  if (!body) return Response.json({ error: "Not saved — the step is incomplete.", code: "invalid-request" }, { status: 400, headers: NO_STORE });
  const sid = (await cookies()).get(SID_COOKIE)?.value ?? "";
  const principal = { credential: s.credential, sessionId: sid };
  if (typeof body.undoToken === "string") return answer(await paperworkService().undo(principal, body.undoToken, req.signal));
  return answer(await paperworkService().step(principal, {
    leadId: id, round: body.round as string, beat: body.beat as string, rowToken: body.rowToken as string,
    ...(body.channel !== undefined ? { channel: body.channel as string | null } : {}),
    ...(body.attachmentId !== undefined ? { attachmentId: body.attachmentId as string | null } : {}),
    ...(body.link !== undefined ? { link: body.link as string | null } : {}),
  }, req.signal));
}

export const GET = withErrorCapture(guardApi("/api/leads", get_), "/api/leads/[id]/paperwork");
export const POST = withErrorCapture(guardApi("/api/leads", post_), "/api/leads/[id]/paperwork");
