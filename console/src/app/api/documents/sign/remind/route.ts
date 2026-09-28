/* POST /api/documents/sign/remind — M12-S05-T02: remind a Zoho Sign request through the API on the person's own token.
   Body JSON { paper, recordId }.
   200 → { done: { state, label, at } } · 400/403/409 → { error, code } · 503 → Zoho not answering. */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { investorsContext, NO_STORE } from "@/server/investors/http";

export const dynamic = "force-dynamic";
const STATUS: Record<string, number> = { "invalid-request": 400, "reason-required": 400, "seat-denied": 403, "not-visible": 403, "no-request": 409, "not-out": 409 };

async function post(req: Request) {
  const c = await investorsContext();
  if (!c.ok) return c.response;
  const { principal } = c.ctx;
  const { signPersonRuntime } = await import("@/server/zoho-sign/runtime");
  let b: Record<string, unknown> = {};
  try { b = (await req.json()) as Record<string, unknown>; } catch { b = {}; }
  const p = { credential: principal.credential, seat: principal.session.seat };
  const a = signPersonRuntime().actions;
  const r = await a.remind(p, b.paper, b.recordId, req.signal);
  if (r.ok) return Response.json({ done: r.value }, { headers: NO_STORE });
  if (r.kind === "refused") return Response.json({ error: r.message, code: r.reasonCode, ...(r.state ? { state: r.state } : {}) }, { status: STATUS[r.reasonCode] ?? 400, headers: NO_STORE });
  return Response.json({ error: r.message, code: r.errorKind }, { status: 503, headers: NO_STORE });
}

export const POST = withErrorCapture(guardApi("/api/documents", post), "/api/documents/sign/remind");
