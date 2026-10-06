# D124 — A staging-only test sign-in for the automated UI tester (6 Oct 2026)

**Status:** decided and built on branch `test-signin-staging` (from `staging-catalyst-2026-10-06`, 5c28361). Not deployed.
The owner sets the variables and enrols the test users (`catalyst/README.md`, "Test sign-in for staging (Jev)").

## Why
Jev + Playwright must test every seat unattended. D53 makes every screen run on the signed-in person's own Zoho token,
so a test needs a real session per sandbox test user, and Zoho sign-in needs a password typed by a person. A fixture
session would not exercise the access wall, which is the thing under test.

## Decision
1. **Gate.** `testSigninEnabled(env)` (`console/src/server/oauth/test-signin-gate.ts`): on only when
   `ZOHO_CRM_ENVIRONMENT=sandbox` AND `ZOHO_EXPECTED_ORG_ID` is set AND `GZ_TEST_SIGNIN_SECRET` has ≥ 32 characters AND
   `GZ_TEST_SIGNIN_USERS` names at least one Zoho user id. Otherwise both routes answer 404, indistinguishable from
   absent. Production is never sandbox, so it can never be on (unit-tested with every other variable set).
2. **Enrolment by a person, once.** An allowlisted user completing the normal Zoho sign-in while the gate is on has their
   refresh token kept: sealed with ZOHO_SESSION_KEY bound to their user id, in SharedState (`test-enrol|<id>`, no expiry);
   read-only fallback `GZ_TEST_REFRESH_<id>`. Plane C `test-signin-enrolled`. Sessions holding an enrolled token carry
   `keepGrant`, so sign-out and expiry never revoke it at Zoho (they would un-enrol the user). No token reaches an HTTP
   response or a log.
3. **Mint.** `POST /api/test/session`, header `X-Test-Signin-Secret` (sha256 + `timingSafeEqual`), body `{zohoUserId}`:
   the enrolled token is refreshed and handed to `UserSessions.signInWithRefreshToken`, which runs **the same function**
   as the OAuth callback after its code exchange (`establish`: org zgid proof, CurrentUser, seat, D60 admission, stored
   session). Same refusals as sign-in, as `{ok:false, why}`. The normal `gz_zsid` cookie is set. A refused mint never
   revokes the enrolled token. Plane C `test-signin-used` (user id, seat). `GET /api/test/session/status` lists the
   allowlist with enrolled true/false and seat, never a token.
4. **Guards.** Rate rule `test-signin` (10/min per IP+session, 50/min per IP) plus 8 mints per user per 10 minutes
   (Zoho's documented ~10 access tokens per refresh token per 10 minutes; not re-verified here). The H2 Origin check exempts exactly
   `/api/test/session`, only while the gate is on: the caller is a server-side request context, authenticated by a
   custom header no cross-site page can send without a CORS preflight this app never grants.
5. **Registration.** `/api/test/session` is named in `API_ROUTES` as `open` (said why). Like every `/api/test/**` route
   it stays out of the leak matrix and contract table, which exclude `/api/test`, `/api/auth` and `/api/webhooks` by
   design (`scripts/leak-matrix.lib.cjs` EXCLUDED); a unit test asserts the registration, the rate rule and the
   narrow Origin exemption.

## Not chosen
- A fixture or stub session on staging: would bypass the per-user Zoho wall being tested.
- Storing test passwords and driving Zoho's login page: a password in CI, and Zoho's login page changes and challenges.
- A secret in the URL (`GET ?u=`): leaks into logs and history.

## Consequences
- With `STATE_STORE=memory` (staging today) an enrolment is lost on every instance recycle/redeploy; re-enrol, paste
  `GZ_TEST_REFRESH_<id>`, or move staging to `STATE_STORE=catalyst` (carry-forward B-19).
- An enrolled token is a long-lived credential for a sandbox user held by the staging app. It is sandbox-only, sealed at
  rest, and revocable in Zoho; retire it with the test users.
- Zoho caps refresh tokens per user per client (20 in its OAuth docs; not re-verified here) and deletes the oldest past it; many later normal
  sign-ins by the same test user can evict the enrolled token (status keeps saying enrolled; the mint then fails
  `failed` / `refresh-refused`). Re-enrol when that happens.
