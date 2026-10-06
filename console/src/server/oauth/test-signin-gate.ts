/* D124 — the staging test sign-in's gate, on its own with no imports so the request gate (server/http/request-gate.ts)
   can ask it without loading the sign-in. Everything else is in ./test-signin.ts. */

export const TEST_SESSION_ROUTE = "/api/test/session";
export const TEST_SESSION_STATUS_ROUTE = "/api/test/session/status";
export const TEST_SECRET_MIN = 32;
const USER_ID = /^\d{15,25}$/;

/** GZ_TEST_SIGNIN_USERS: comma-separated Zoho user ids; anything not shaped like one is dropped. */
export function testSigninUsers(env: NodeJS.ProcessEnv = process.env): readonly string[] {
  return [...new Set((env.GZ_TEST_SIGNIN_USERS ?? "").split(",").map((s) => s.trim()).filter((s) => USER_ID.test(s)))];
}

export function testSigninEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ZOHO_CRM_ENVIRONMENT === "sandbox"
    && (env.ZOHO_EXPECTED_ORG_ID ?? "").trim() !== ""
    && (env.GZ_TEST_SIGNIN_SECRET ?? "").trim().length >= TEST_SECRET_MIN
    && testSigninUsers(env).length > 0;
}

