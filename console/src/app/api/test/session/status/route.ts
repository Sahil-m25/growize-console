/* GET /api/test/session/status — D124 staging test sign-in: which allowlisted test users are enrolled. Never a token.
   404 unless the gate is on (server/oauth/test-signin.ts). Header X-Test-Signin-Secret. */
import { sharedState } from "@/server/state/runtime";
import { cookieBase, oauthParts, zohoSignInConfigured } from "@/server/oauth/runtime";
import { testSessionStatus, TEST_SESSION_STATUS_ROUTE } from "@/server/oauth/test-signin";
import { withErrorCapture } from "@/server/ops/runtime";

export const dynamic = "force-dynamic";

async function get_(req: Request) {
  return testSessionStatus(req, {
    env: process.env,
    configured: zohoSignInConfigured(),
    sessions: () => oauthParts().sessions,
    enrolment: () => oauthParts().testEnrolment ?? null,
    state: sharedState,
    cookie: { secure: cookieBase().secure },
  });
}

export const GET = withErrorCapture(get_, TEST_SESSION_STATUS_ROUTE);
