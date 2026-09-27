import { NextResponse } from "next/server";
import { handleZohoSignWebhook, MAX_WEBHOOK_BYTES, ZOHO_SIGN_SIGNATURE_HEADER } from "../../../../server/zoho-sign/webhook";
import { logProviderCallbackBoundary, zohoSignWebhookDeps } from "../../../../server/zoho-sign/runtime";
import { readLimitedUtf8Body } from "../../../../server/http/limited-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const CALLBACK_DEADLINE_MS = 4_000;

export async function POST(request: Request): Promise<NextResponse> {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), CALLBACK_DEADLINE_MS);
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_WEBHOOK_BYTES) {
    logProviderCallbackBoundary("payload-too-large");
    clearTimeout(deadline);
    return NextResponse.json({ accepted: false, reason: "payload-too-large" }, { status: 413 });
  }

  try {
    const body = await readLimitedUtf8Body(request, MAX_WEBHOOK_BYTES, controller.signal);
    if (!body.ok) {
      logProviderCallbackBoundary(
        body.reason === "aborted" ? "callback-deadline"
          : body.reason === "read-failed" ? "request-read-failed"
            : body.reason,
      );
      const status = body.reason === "payload-too-large" ? 413
        : body.reason === "invalid-utf8" ? 400
          : 503;
      return NextResponse.json({ accepted: false, reason: body.reason }, { status });
    }

    const result = await handleZohoSignWebhook(
      { body: body.body, signature: request.headers.get(ZOHO_SIGN_SIGNATURE_HEADER), signal: controller.signal },
      zohoSignWebhookDeps(),
    );

    if (result.ok) {
      return NextResponse.json({ accepted: true, outcome: result.outcome }, { status: 200 });
    }
    if (result.kind === "provider-failed" || result.kind === "crm-failed") {
      logProviderCallbackBoundary(result.kind);
    }
    const status = result.kind === "invalid-signature" ? 401
      : result.kind === "invalid-payload" ? 400
        : result.kind === "ambiguous" ? 409
          : 503;
    return NextResponse.json({ accepted: false, reason: result.kind }, { status });
  } catch {
    // Configuration and secret-store failures are deliberately indistinguishable here.
    logProviderCallbackBoundary("callback-unavailable");
    return NextResponse.json({ accepted: false, reason: "unavailable" }, { status: 503 });
  } finally {
    clearTimeout(deadline);
  }
}
