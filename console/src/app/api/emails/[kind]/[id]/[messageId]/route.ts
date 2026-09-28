/* GET /api/emails/[kind]/[id]/[messageId]?owner= — M12-S09-T01: one email of a record, with its content, read-only,
   on the viewer's own token. The body passes through to this answer only: never logged, never cached (no-store).
   200 → { email } · 403 → { error, code } · 503 */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { investorsContext, NO_STORE } from "@/server/investors/http";

export const dynamic = "force-dynamic";

async function get(req: Request, { params }: { params: Promise<{ kind: string; id: string; messageId: string }> }) {
  const c = await investorsContext();
  if (!c.ok) return c.response;
  const { kind, id, messageId } = await params;
  const { rt, crm, principal } = c.ctx;
  const { createRecordEmails } = await import("@/server/emails/record-emails");
  const r = await createRecordEmails({ crm, events: rt.events, log: rt.log })
    .open(principal.credential, principal.session.seat, kind as never, id, messageId, new URL(req.url).searchParams.get("owner"), req.signal);
  if (r.ok) return Response.json({ email: r.value }, { headers: NO_STORE });
  if (r.kind === "refused") return Response.json({ error: r.message, code: r.reason }, { status: r.reason === "invalid-request" ? 400 : 403, headers: NO_STORE });
  return Response.json({ error: "Zoho is not answering. Try again.", code: r.errorKind }, { status: 503, headers: NO_STORE });
}

export const GET = withErrorCapture(guardApi("/api/emails", get), "/api/emails/[kind]/[id]/[messageId]");
