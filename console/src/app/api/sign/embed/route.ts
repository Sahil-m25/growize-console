/* POST /api/sign/embed — M12-S08-T01: the investor app asks for a one-time embedded Zoho Sign URL (contracts/sign.embed.json).
   No person behind it: authenticated by the contract HMAC over the exact body (X-Signature); the Contact must be the recipient.
   200 → { sign_url, expires_at } (valid 2 minutes, one-time; never stored or logged) · 401 bad signature · 400 invalid ·
   403 not the recipient / host not allowed · 409 replayed event or not out for signature · 503 not configured or Zoho down. */
import { NextResponse } from "next/server";
import { guardApi } from "@/server/access/guard";
import { readLimitedUtf8Body } from "@/server/http/limited-body";
import { withErrorCapture } from "@/server/ops/runtime";
import { EMBED_SIGNATURE_HEADER, MAX_EMBED_BYTES } from "@/server/zoho-sign/embed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "no-store, private", "Referrer-Policy": "no-referrer" };

async function post(request: Request): Promise<Response> {
  const { signEmbedEndpoint } = await import("@/server/zoho-sign/runtime");
  let endpoint: ReturnType<typeof signEmbedEndpoint>;
  try { endpoint = signEmbedEndpoint(); } catch { return NextResponse.json({ accepted: false, reason: "not-configured" }, { status: 503, headers: NO_STORE }); }
  const body = await readLimitedUtf8Body(request, MAX_EMBED_BYTES, AbortSignal.timeout(4_000));
  if (!body.ok) return NextResponse.json({ accepted: false, reason: body.reason }, { status: body.reason === "payload-too-large" ? 413 : 400, headers: NO_STORE });
  try {
    const r = await endpoint.handle(body.body, request.headers.get(EMBED_SIGNATURE_HEADER), request.signal);
    if (r.status === 200) return NextResponse.json({ sign_url: r.signUrl, expires_at: new Date(r.expiresAt).toISOString() }, { status: 200, headers: NO_STORE });
    return NextResponse.json({ accepted: false, reason: r.reason }, { status: r.status, headers: NO_STORE });
  } catch {
    return NextResponse.json({ accepted: false, reason: "unavailable" }, { status: 503, headers: NO_STORE });
  }
}

export const POST = withErrorCapture(guardApi("/api/sign/embed", post), "/api/sign/embed");
