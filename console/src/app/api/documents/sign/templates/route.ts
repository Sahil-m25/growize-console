/* GET /api/documents/sign/templates — M12-S04 (the template picker): Finance's Zoho Sign templates, read on the sender's own
   Sign token (D53), for the send drawer and the Send one panel to pick from. Ids and names only.
   200 → { templates: [{ templateId, name }] } · 403 → { error, code } (a seat that sends no paper) · 503 Zoho Sign not answering.
   PROVISIONAL: GET /templates and its page_context are from Zoho's documentation, not yet run against the sandbox. */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { investorsContext, NO_STORE } from "@/server/investors/http";

export const dynamic = "force-dynamic";

async function get(req: Request) {
  const c = await investorsContext();
  if (!c.ok) return c.response;
  const { principal } = c.ctx;
  const { signPersonRuntime } = await import("@/server/zoho-sign/runtime");
  const r = await signPersonRuntime().sender.templates({ credential: principal.credential, seat: principal.session.seat }, req.signal);
  if (r.ok) return Response.json({ templates: r.value }, { headers: NO_STORE });
  const status = r.kind === "source-error" ? 503 : r.reasonCode === "invalid-request" ? 400 : 403;
  return Response.json({ error: r.message, code: r.reasonCode }, { status, headers: NO_STORE });
}

export const GET = withErrorCapture(guardApi("/api/documents", get), "/api/documents/sign/templates");
