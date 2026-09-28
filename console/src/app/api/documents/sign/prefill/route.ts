/* GET /api/documents/sign/prefill?paper=&id= — M12-S04 AC2/AC4/AC7: the send panel's facts on the sender's own token:
   recipient name and email from the Contact, NRI (Aadhaar eSign not offered), what is already out, and whether Send is offered.
   200 → { prefill } · 403 → { error, code } (a viewer or KAM: "Sending belongs to Finance…") · 503 Zoho down. */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { investorsContext, NO_STORE } from "@/server/investors/http";

export const dynamic = "force-dynamic";

async function get(req: Request) {
  const c = await investorsContext();
  if (!c.ok) return c.response;
  const { principal } = c.ctx;
  const { signPersonRuntime } = await import("@/server/zoho-sign/runtime");
  const q = new URL(req.url).searchParams;
  const r = await signPersonRuntime().sender.prefill({ credential: principal.credential, seat: principal.session.seat }, q.get("paper"), q.get("id"), req.signal);
  if (r.ok) return Response.json({ prefill: r.value }, { headers: NO_STORE });
  const status = r.kind === "source-error" ? 503 : r.reasonCode === "invalid-request" ? 400 : 403;
  return Response.json({ error: r.message, code: r.reasonCode }, { status, headers: NO_STORE });
}

export const GET = withErrorCapture(guardApi("/api/documents", get), "/api/documents/sign/prefill");
