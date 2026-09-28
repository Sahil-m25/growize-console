/* GET /api/emails/[kind]/[id]?index= — M12-S09-T01: a record's emails (kind = lead | investor | allotment), listed
   from Zoho CRM's Emails API on the viewer's own token: sender, recipients, subject, time — no body. Nothing is
   cached. 200 → { emails, nextIndex } · 403 → { error, code } (in-page refusal) · 503 */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { investorsContext, NO_STORE } from "@/server/investors/http";

export const dynamic = "force-dynamic";

async function get(req: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const c = await investorsContext();
  if (!c.ok) return c.response;
  const { kind, id } = await params;
  const { rt, crm, principal } = c.ctx;
  const { createRecordEmails } = await import("@/server/emails/record-emails");
  const r = await createRecordEmails({ crm, events: rt.events, log: rt.log })
    .list(principal.credential, principal.session.seat, kind as never, id, new URL(req.url).searchParams.get("index"), req.signal);
  if (r.ok) return Response.json(r.value, { headers: NO_STORE });
  if (r.kind === "refused") return Response.json({ error: r.message, code: r.reason }, { status: r.reason === "invalid-request" ? 400 : 403, headers: NO_STORE });
  return Response.json({ error: "Zoho is not answering. Try again.", code: r.errorKind }, { status: 503, headers: NO_STORE });
}

export const GET = withErrorCapture(guardApi("/api/emails", get), "/api/emails/[kind]/[id]");
