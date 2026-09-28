/* POST /api/webhooks/investor-app — request.raised and push.delivered from the investor app (M13-S01-T02).
   No person behind it: authenticated by the HMAC over the exact body (X-Signature), validated against
   contracts/, applied once per event_id. 200 → { accepted, applied, caseId? } · 401 bad signature · 400 invalid ·
   422 refused (M13-S05: the Contact is not the sender's, a reused app_request_id) · 503 not configured or Zoho
   down (the app redelivers). A request.raised answers with its Case id, the same one on a replay. The body is never logged. */
import { NextResponse } from "next/server";
import { guardApi } from "@/server/access/guard";
import { readLimitedUtf8Body } from "@/server/http/limited-body";
import { withErrorCapture } from "@/server/ops/runtime";
import { INBOUND_SIGNATURE_HEADER, MAX_INBOUND_BYTES } from "@/server/contracts/inbound";
import { investorAppInbound } from "@/server/contracts/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store" };

async function post(request: Request): Promise<Response> {
  let inbound: ReturnType<typeof investorAppInbound>;
  try { inbound = investorAppInbound(); } catch { return NextResponse.json({ accepted: false, reason: "not-configured" }, { status: 503, headers: NO_STORE }); }
  const body = await readLimitedUtf8Body(request, MAX_INBOUND_BYTES, AbortSignal.timeout(4_000));
  if (!body.ok) return NextResponse.json({ accepted: false, reason: body.reason }, { status: body.reason === "payload-too-large" ? 413 : 400, headers: NO_STORE });
  try {
    const r = await inbound.handle(body.body, request.headers.get(INBOUND_SIGNATURE_HEADER));
    if (r.status === 200) return NextResponse.json({ accepted: true, applied: r.applied, ...(r.caseId !== undefined ? { caseId: r.caseId } : {}) }, { status: 200, headers: NO_STORE });
    return NextResponse.json({ accepted: false, reason: r.reason }, { status: r.status, headers: NO_STORE });
  } catch {
    return NextResponse.json({ accepted: false, reason: "unavailable" }, { status: 503, headers: NO_STORE });
  }
}

export const POST = withErrorCapture(guardApi("/api/webhooks/investor-app", post), "/api/webhooks/investor-app");
