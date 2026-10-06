/* POST /api/test/session — D124 staging test sign-in: mint a real console session for an enrolled sandbox test user.
   404 unless the gate is on (server/oauth/test-signin.ts). Header X-Test-Signin-Secret; body { zohoUserId }. */
import { sharedState } from "@/server/state/runtime";
import { cookieBase, oauthParts, zohoSignInConfigured } from "@/server/oauth/runtime";
import { testSessionMint, TEST_SESSION_ROUTE } from "@/server/oauth/test-signin";
import { withErrorCapture } from "@/server/ops/runtime";

export const dynamic = "force-dynamic";

async function post_(req: Request) {
  return testSessionMint(req, {
    env: process.env,
    configured: zohoSignInConfigured(),
    sessions: () => oauthParts().sessions,
    enrolment: () => oauthParts().testEnrolment ?? null,
    state: sharedState,
    cookie: { secure: cookieBase().secure },
  });
}

export const POST = withErrorCapture(post_, TEST_SESSION_ROUTE);
