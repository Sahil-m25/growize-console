/* POST /api/test/sign/complete — test signing (sandbox only): mark a test-signing request signed (or declined) and run the
   real Zoho Sign webhook path for it. 404 unless the D124 test sign-in gate AND ZOHO_SIGN_MODE=fake are on
   (server/zoho-sign/fake-complete.ts). Header X-Test-Signin-Secret; body { requestId, outcome?: "completed" | "declined" }. */
import { zohoSignInConfigured } from "@/server/oauth/runtime";
import { withErrorCapture } from "@/server/ops/runtime";
import { testSignComplete, TEST_SIGN_COMPLETE_ROUTE } from "@/server/zoho-sign/fake-complete";
import { handleZohoSignWebhook } from "@/server/zoho-sign/webhook";
import { fakeSign, fakeWebhookSecret, zohoSignWebhookDeps } from "@/server/zoho-sign/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function post_(req: Request) {
  return testSignComplete(req, {
    env: process.env,
    configured: zohoSignInConfigured(),
    fake: () => fakeSign(),
    secret: fakeWebhookSecret,
    webhook: (body, signature) => handleZohoSignWebhook({ body, signature, signal: req.signal }, zohoSignWebhookDeps()),
  });
}

export const POST = withErrorCapture(post_, TEST_SIGN_COMPLETE_ROUTE);
