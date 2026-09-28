/* POST /api/documents/sign/verify — M12-S06 AC4: paper signed outside Zoho Sign. The signed copy is first filed to the slot
   (/api/documents/upload with slot=…); this sets *_Verified_At, *_Verified_By (the person) and *_Signed_Via in one guarded write,
   and keeps the reference as a Zoho Note. Body JSON { paper, recordId, method: "Class 3 DSC"|"Wet signature"|"Uploaded",
   reference?, expectedModifiedTime }. 200 → { verified } · 400/403/409 → { error, code } · 503 → Not saved yet. */
import { guardApi } from "@/server/access/guard";
import { withErrorCapture } from "@/server/ops/runtime";
import { investorsContext, NO_STORE } from "@/server/investors/http";

export const dynamic = "force-dynamic";
const STATUS: Record<string, number> = { "invalid-request": 400, "unknown-method": 400, "seat-denied": 403, "not-visible": 403, "already-verified": 409, "no-signed-copy": 409, "record-changed": 409 };

async function post(req: Request) {
  const c = await investorsContext();
  if (!c.ok) return c.response;
  const { principal } = c.ctx;
  const { signPersonRuntime } = await import("@/server/zoho-sign/runtime");
  let b: Record<string, unknown> = {};
  try { b = (await req.json()) as Record<string, unknown>; } catch { b = {}; }
  const r = await signPersonRuntime().verifier.verify({ credential: principal.credential, seat: principal.session.seat },
    { paper: b.paper, recordId: b.recordId, method: b.method, reference: b.reference, expectedModifiedTime: b.expectedModifiedTime }, req.signal);
  if (r.ok) return Response.json({ verified: r.value }, { headers: NO_STORE });
  if (r.kind === "refused") return Response.json({ error: r.message, code: r.reasonCode }, { status: STATUS[r.reasonCode] ?? 400, headers: NO_STORE });
  return Response.json({ error: r.message, code: r.errorKind }, { status: 503, headers: NO_STORE });
}

export const POST = withErrorCapture(guardApi("/api/documents", post), "/api/documents/sign/verify");
