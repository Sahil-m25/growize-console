/* GET /api/test/state-health — D125 staging diagnostics for the shared-state store (probe, env names, token mint, recent
   enrolment save failures). Same gate as the D124 test sign-in: 404 unless on and the X-Test-Signin-Secret matches. */
import { sharedState } from "@/server/state/runtime";
import { zohoSignInConfigured } from "@/server/oauth/runtime";
import { testStateHealth } from "@/server/oauth/test-state-health";
import { TEST_STATE_HEALTH_ROUTE } from "@/server/oauth/test-signin-gate";
import { withErrorCapture } from "@/server/ops/runtime";

export const dynamic = "force-dynamic";

async function get_(req: Request) {
  return testStateHealth(req, { env: process.env, configured: zohoSignInConfigured(), state: sharedState });
}

export const GET = withErrorCapture(get_, TEST_STATE_HEALTH_ROUTE);
