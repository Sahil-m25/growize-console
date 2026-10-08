/* POST /api/documents/sign/block — M12-S07-T01: block or supersede a paper (signed ones too) with a mandatory reason.
   Body JSON { paper, recordId, reason, expectedModifiedTime }. Recalls a request still out, then clears the slot's request id,
   method and verified stamp (Agreement_Signed and the lead's alloc gate) in one guarded write; the reason is a Zoho Note.
   200 → { blocked } · 400/403/409 → { error, code } · 503 → { error: "Not done yet", code, recalled }. */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { investorsContext, NO_STORE } from "@/server/investors/http";

export const dynamic = "force-dynamic";
const STATUS: Record<string, number> = { "invalid-request": 400, "reason-required": 400, "seat-denied": 403, "not-visible": 403, "nothing-to-block": 409, "record-changed": 409 };

async function post(req: Request) {
  const c = await investorsContext();
  if (!c.ok) return c.response;
  const { principal } = c.ctx;
  const { signPersonRuntime, signPersonConfigured } = await import("@/server/zoho-sign/runtime");
  if (!signPersonConfigured()) return Response.json({ error: "Sending for signature is not connected yet.", code: "not-configured" }, { status: 503, headers: NO_STORE });
  let b: Record<string, unknown> = {};
  try { b = (await req.json()) as Record<string, unknown>; } catch { b = {}; }
  const r = await signPersonRuntime().blocker.block({ credential: principal.credential, seat: principal.session.seat },
    { paper: b.paper, recordId: b.recordId, reason: b.reason, expectedModifiedTime: b.expectedModifiedTime }, req.signal);
  if (r.ok) return Response.json({ blocked: r.value }, { headers: NO_STORE });
  if (r.kind === "refused") return Response.json({ error: r.message, code: r.reasonCode }, { status: STATUS[r.reasonCode] ?? 400, headers: NO_STORE });
  return Response.json({ error: r.message, code: r.errorKind, recalled: r.recalled }, { status: 503, headers: NO_STORE });
}

export const POST = withErrorCapture(guardApi("/api/documents", post), "/api/documents/sign/block");
