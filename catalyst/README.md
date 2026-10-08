# Deploying the console to Zoho Catalyst AppSail

Two variants. Both run the same Next.js `output: "standalone"` server (`console/next.config.mjs`).
Names of variables only below; values live in Catalyst's environment-variable store, never in git or an image.

Facts used (verified from the docs, 4 Oct 2026): custom runtime = OCI image, linux/amd64; app must listen on
`X_ZOHO_CATALYST_LISTEN_PORT` (default 9000) within 10 s; memory 128/256/512/1024/2048 MB; 30 s request timeout;
instances recycle; disk ephemeral. Docs: appsail/introduction, key-concepts/platform-management,
appsail-configurations, custom-runtimes/deploy-from-cli (docs.catalyst.zoho.com/en/serverless/help/appsail/...).

## A. Custom runtime (Docker image) — measured, recommended

Build from the repo root (context must be the root: the app reads `../contracts` and `../pm/...` at run time):

    docker build --platform linux/amd64 -f console/Dockerfile -t growize-console:<tag> .

Deploy (deploy-from-cli doc):

    catalyst init                      # new project   (existing project: catalyst appsail:add)
    #   choose AppSail, container image; the image is referenced as docker://localhost/growize-console:<tag>
    #   (or docker-archive://growize-console.tar after `docker save -o growize-console.tar growize-console:<tag>`)
    catalyst deploy                    # or: catalyst deploy appsail
    # standalone form (doc): catalyst deploy appsail --name <name> --source <image> [--command <command>] [--port <port>]

With an image, `app-config.json` is not created; the spec is stored in `catalyst.json` (doc). The image's CMD already
maps `X_ZOHO_CATALYST_LISTEN_PORT` to `PORT` and binds `0.0.0.0`.
Set memory to 512 MB or more (see docs/architecture/catalyst-limits-audit.md for measured numbers).
Fixture/demo image for testing only: add `--build-arg GZ_LOCAL_BUILD=1` and run with `FIXTURE_MODE=local GZ_LOCAL_BUILD=1`. Never ship that to production.

## B. Managed Node 22 runtime

`catalyst/app-config.json` is the template. Fields named in appsail-configurations: `command`, `env_variables`, `memory`,
`build_path`, `stack`. UNVERIFIED: the doc fetched gave no full example, so the `stack` value ("node22") and that
`build_path` is the folder uploaded must be checked against `catalyst init` output before the first deploy.

**Package built and smoke-tested (7 Oct 2026, `deploy-staging-next/`):** standalone output as `console/`, `.next/static`, `contracts/`,
`pm/merge-audit/ui-sahil/fixtures-merged.json`, `start.sh` (`cd console; PORT=$X_ZOHO_CATALYST_LISTEN_PORT; exec node server.js`) and an
`app-config.json` with NO `env_variables` (`"command":"sh start.sh","build_path":".","stack":"node20","memory":512`). Smoke in the VM
with `STATE_STORE` unset: `/` 200, `POST /api/test/session` 404. Variables to enter: `deploy-staging-next/ENV-STAGING.md`.

Stage the standalone output by hand, then deploy:

    cd console && npm ci && npx next build
    rm -rf ../build/appsail && mkdir -p ../build/appsail/console ../build/appsail/pm/merge-audit/ui-sahil
    cp -r .next/standalone/. ../build/appsail/console/
    mkdir -p ../build/appsail/console/.next && cp -r .next/static ../build/appsail/console/.next/static
    cp -r ../contracts ../build/appsail/contracts
    cp ../pm/merge-audit/ui-sahil/fixtures-merged.json ../build/appsail/pm/merge-audit/ui-sahil/
    # then: catalyst init (AppSail, Node 22, source = build/appsail) and  catalyst deploy
    # the command must run from build/appsail/console:  set "command" to "cd console && ..." if the platform starts at the root

Tracing note: `.next/standalone` already carries the production `node_modules`; do not `npm install` on the platform.

## Environment variable names (from `process.env` / `env.` in console/src; no values)

Zoho sign-in and API: ZOHO_OAUTH_CLIENT_ID, ZOHO_OAUTH_CLIENT_SECRET, ZOHO_OAUTH_REDIRECT_URI, ZOHO_OAUTH_SCOPES,
ZOHO_ACCOUNTS_ORIGIN, ZOHO_STEPUP_REDIRECT_URI, ZOHO_SIGN_API_ORIGIN, ZOHO_CRM_RECORD_ID_PREFIX, ZOHO_SESSION_KEY,
ZOHO_SEAT_IDS, ZOHO_UNASSIGNED_QUEUE_USER_ID, ZOHO_FINANCE_USER_IDS, ZOHO_STATEMENTS_MODULE, ZOHO_CONCURRENCY,
ZOHO_TEST_INVESTOR_IDS, ZOHO_CRM_ENVIRONMENT (`production` default | `sandbox`), ZOHO_EXPECTED_ORG_ID (org zgid;
required when ZOHO_CRM_ENVIRONMENT=sandbox, honoured when set in production), GZ_SANDBOX_MAIL_ALLOW (below).
Service-credential refresh tokens: ZOHO_KAM_POOL_RETURN_REFRESH_TOKEN, ZOHO_COVER_WINDOW_SHARE_REFRESH_TOKEN,
ZOHO_PROVIDER_CALLBACK_REFRESH_TOKEN, ZOHO_AUDIT_ARCHIVE_REFRESH_TOKEN.
Signing and idempotency secrets: ZOHO_SIGN_WEBHOOK_SECRET_PREVIOUS (and the current secret, named in server/zoho-sign),
RECEIPT_IDEMPOTENCY_SECRET, RECEIPT_CONTEXT_SIGNING_SECRET, FOLLOWUP_UNDO_SECRET, CONTRACT_SIGNING_KEY,
CONTRACT_SIGNING_KEY_PREVIOUS.
Policy and mail: ORG_EMAIL_DOMAINS, SIGN_EMBED_HOSTS, INVESTOR_APP_URL, ALERT_EMAIL_TO, STEPUP_ALERT_TO,
GZ_RATE_LIMITS, GZ_SIGNIN_LIST, GZ_RELEASE_APPROVAL, GZ_EXTEND_APPROVAL.
Staging test sign-in (D124, sandbox only): GZ_TEST_SIGNIN_SECRET, GZ_TEST_SIGNIN_USERS, GZ_TEST_REFRESH_<ZOHO_USER_ID>.
Stores (see warning): LOG_STORE, LOG_DIR, LOG_SINK, GRANT_STORE, GRANT_DIR, AUDIT_ARCHIVE_DIR, CONTRACTS_DIR, STATE_STORE.
Jobs: JOB_SECRET, SIGN_CHECK_TIMER.
Platform: X_ZOHO_CATALYST_LISTEN_PORT (set by Catalyst), NODE_ENV.
Dev-only (not for production): FIXTURE_MODE, GZ_LOCAL_BUILD, ZOHO_STUB_USER, NEXT_PUBLIC_RETICLE_URL/TOKEN/ROOT.

Run `grep -rhoE "env\.[A-Z][A-Z0-9_]{4,}" console/src | sort -u` before each release; this list was taken 4 Oct 2026.

## State store: Catalyst NoSQL table `gz_state` (live facts, 7 Oct 2026)

Table `gz_state` (India DC, Development): partition key `K` (String, capital) and a TTL attribute `ttl` (epoch seconds); other
attributes `v`, `exp`, `ver` are written by the adapter. Facts the adapter relies on, all VERIFIED live by spike run 2 and reproduced by
`console/src/server/state/fake-catalyst.ts`: per-item statuses are capitalised (`Success`, `CriteriaMismatch`, `ConditionMismatch`);
a false condition is HTTP 200, never an error; a plain insert overwrites; a conditional insert on an expired item overwrites (claim is
one call); update of a missing key creates nothing; a missing fetch is `data:{size:0}`; bursts bring 429 (retried with backoff, then
"unavailable") and occasional 500 (always "unavailable"). Still unmeasured: latency from inside AppSail, the TTL scheduler. Details:
`docs/architecture/shared-state.md`.

## Staging against the sandbox

The Development environment runs against the Zoho CRM sandbox **Growize Staging** (zgid 60090668120), never the live
org (60061770791). Set `ZOHO_CRM_ENVIRONMENT=sandbox` and `ZOHO_EXPECTED_ORG_ID=60090668120`; keep
`ZOHO_ACCOUNTS_ORIGIN=https://accounts.zoho.in` and the same OAuth client (sandbox tokens come from the same accounts
server; the person picks the sandbox org on Zoho's consent screen). `ZOHO_CRM_RECORD_ID_PREFIX` and `ZOHO_SEAT_IDS` must
be the sandbox org's, and every service refresh token must be minted against the sandbox.

**Sandbox mail sink (D131).** With `ZOHO_CRM_ENVIRONMENT` anything but production, every outbound mail path (CRM `send_mail`, Zoho Sign
recipients, the alert mailer) refuses unless **every** recipient matches `GZ_SANDBOX_MAIL_ALLOW`: a comma-separated list of domains
(`agresearchlabs.com`) and/or exact addresses (`qa@example.com`). Unset or empty means `agresearchlabs.com`; setting it replaces the default.
A refused send makes no request and returns the code `sandbox-mail-blocked`; the log line holds a hash of each recipient, never an address.
Production is unchanged. Zoho Sign runs on the live `sign.zoho.in` even in staging, which is why the guard sits in the console, not in Zoho.
The guard covers only mail the console sends; see `docs/decisions/D131-sandbox-mail-sink.md` for what it cannot cover (Zoho workflows in the sandbox).

What the console then does (`console/src/lib/zoho/client.ts`): every CRM call goes to `https://sandbox.zohoapis.in`
— derived from the token's `api_domain`, which Zoho does not promise points at the sandbox — and a `www.zohoapis.*`
host is refused. Each sign-in calls `GET /crm/v8/org` on the new token before anything else and refuses the session
("This console is connected to a different Zoho org") unless `org[0].zgid` equals `ZOHO_EXPECTED_ORG_ID`; each
background job's token passes the same check once per process. The System page shows the environment and the last
verified org id. Missing `ZOHO_EXPECTED_ORG_ID` in sandbox mode fails closed. This does not move Zoho Sign: Sign calls
still go to `sign.zoho.in`.

## Job Scheduling — the two calls a multi-instance deployment needs (M18-S09-NOTE-2)

AppSail instances live about 5 minutes, so no in-process timer can be relied on. With `STATE_STORE=catalyst` the
console turns its own Sign re-check timer off (`SIGN_CHECK_TIMER` unset) and expects these calls instead. Each run
claims `job|<name>` in SharedState first, so overlapping calls (a retry, two schedulers) do nothing and answer
`{ "ran": false, "code": "already-running" }`.

Create a **Webhook** job pool (Catalyst console → Job Scheduling → Job Pool → Webhook), then one cron per job,
each a webhook job with request method **POST** and one header **`X-Job-Secret: <JOB_SECRET>`** (the same value as
the app's `JOB_SECRET` secret; no body, no query parameters):

| Cron name | URL | Cron expression (CronExpression type) | Why |
|---|---|---|---|
| `gz-sign-recheck` | `https://<app-host>/api/jobs/sign-recheck` | `*/10 * * * *` | M12-S05-T02: every 10 minutes, re-check open Zoho Sign requests so a missed webhook is still caught |
| `gz-outbox-drain` | `https://<app-host>/api/jobs/outbox-drain` | `* * * * *` | M13-S01: retry queued pushes to the investor app even after the instance that queued them is gone |
| `gz-audit-export` | `https://<app-host>/api/jobs/audit-export` | `*/10 20-21 * * *` (UTC = 01:30–03:20 IST; adjust if the scheduler runs in IST) | M15-S03-T01 / B-27: yesterday's Zoho audit-log export into the activity archive. Each call requests or resumes the export and polls ~20 s; needs `ZOHO_AUDIT_ARCHIVE_REFRESH_TOKEN` and `LOG_SINK=stratus` (or the page says the log is not set up) |

Answers: 200 `{ran:true}` ran; 200 `already-running`; 401 wrong or missing secret; 503 `not-configured` (no
`JOB_SECRET`) or `state-unavailable` (the state store did not answer — the next tick runs it). Set the job's retry
count to 0: the next tick is the retry.

Sources: Webhook job pools take a URL, a request method and header key/value pairs, and a cron can be "Recursive" or
"Cron Expression" (https://docs.catalyst.zoho.com/en/job-scheduling/help/implementation/submit-job-predefined-cron;
https://docs.catalyst.zoho.com/en/sdk/nodejs/v2/job-scheduling/cron/create-cron-cron-expressions). **UNVERIFIED:** the
exact expression grammar (the SDK sample `'0 0 * 1 1'` reads as five fields; whether a seconds field or a minimum
interval applies), and the per-job request timeout. If one-minute crons are refused, schedule the outbox drain every
5 minutes (the publishing request still tries each event at once).

## Warnings found while preparing this (details in the audit)

1. Sessions are an in-memory Map (`oauth/runtime.ts` createMemorySessionStore). An AppSail instance recycle or a second
   instance signs people out / loses the session. Needs a shared store before go-live, or one pinned instance.
2. `LOG_STORE=jsonl`, `GRANT_STORE=jsonl`, `AUDIT_ARCHIVE_DIR` write to local disk. AppSail disk is ephemeral (256 MB default):
   Plane B/C logs, grants and the audit archive would vanish on recycle. Do not set the jsonl modes there: use
   `LOG_SINK=stratus` for the logs (and with it the Sign dead-letters and the push ledger) and `STATE_STORE=catalyst`
   (grants then default to `shared`, docs/architecture/shared-state.md).
3. The nightly audit export (`nightlyAuditExport`) can poll for 30 min; it cannot run inside a 30 s request. Use Job Scheduling.

## Staging deployment (5 Oct 2026)
- Project GrowizeConsole (64668000000018001, India DC, Development). AppSail `growize-console`, managed runtime node20, 512 MB,
  started by `sh start.sh` (maps X_ZOHO_CATALYST_LISTEN_PORT → PORT). URL: https://growize-console-50046579043.development.catalystappsail.in
- Non-secret settings are in `catalyst/app-config.staging.json` (sandbox mode, expected org 60090668120, redirects, sandbox role/profile ids).
- Secrets are set by the owner in the Catalyst console (AppSail → growize-console → Environment variables), never in git:
  ZOHO_OAUTH_CLIENT_ID, ZOHO_OAUTH_CLIENT_SECRET, ZOHO_SESSION_KEY. STATE_STORE=memory for the first smoke; switch to
  `catalyst` (+ SESSION_ENC_KEY, CATALYST_* settings) before more than one tester.
- Note: the code's profile name "Compliance & Audit" is "Compliance and Audit" in Zoho; ZOHO_SEAT_IDS maps the code name to the Zoho id.
- **CLI deploy replaces the AppSail environment variables with `app-config.json`'s `env_variables`** (verified 5 Oct: secrets added in
  the console were removed by the next `catalyst deploy`). After any CLI deploy, re-enter the secrets in the console, or deploy from the
  console. Also: the Catalyst API (and MCP) returns variable values in plain text to anyone with project access.
- Behind the AppSail proxy the app sees an internal Host, so `CONSOLE_PUBLIC_ORIGIN` names the public origin for the H2 origin check;
  sign-in and step-up redirects are relative (5 Oct fix).

## Deploying without wiping the secrets (verified 6 Oct 2026)

`catalyst deploy` sends `env_variables` from `app-config.json` and the platform REPLACES the AppSail's whole variable
set with it — every secret entered in the console is gone. When `app-config.json` has NO `env_variables` key, the
deploy leaves the existing variables untouched (proved on a throwaway AppSail: var kept across a code change).
Rule: the deploy copy of `app-config.json` never carries `env_variables`. Every variable (secret or not) lives in the
Catalyst console; `app-config.staging.json` in this folder is only the reference list of non-secret values to type in.

## Test sign-in for staging (Jev) — D124

Lets the automated UI tester (Jev + Playwright) get a real console session for each sandbox test user without a
password. Code: `console/src/server/oauth/test-signin.ts`; routes `POST /api/test/session` and
`GET /api/test/session/status`. **It is off unless all four hold:** `ZOHO_CRM_ENVIRONMENT=sandbox`,
`ZOHO_EXPECTED_ORG_ID` set, `GZ_TEST_SIGNIN_SECRET` at least 32 characters, `GZ_TEST_SIGNIN_USERS` non-empty. Off, both
routes answer 404 (as if absent). Production is never `sandbox`, so it cannot be turned on there.

Environment variables (names only; set them in the Catalyst console, never in git or `app-config.json`):

| Variable | Value |
|---|---|
| `GZ_TEST_SIGNIN_SECRET` | 48 random characters (e.g. `openssl rand -base64 36`). Secret. |
| `GZ_TEST_SIGNIN_USERS` | comma-separated Zoho user ids of the sandbox test users (Setup > Users in the sandbox, or `GET /crm/v8/users`) |
| `GZ_TEST_REFRESH_<ZOHO_USER_ID>` | optional, one per user: a refresh token minted on this deployment's OAuth client for that user. Only needed while `STATE_STORE=memory` (see below). Secret. |
| `STATE_STORE=catalyst` + `SESSION_ENC_KEY` + `GZ_STATE_*` | recommended: makes enrolment and sessions survive instance recycles. `GZ_STATE_*` = `GZ_STATE_API_ORIGIN`, `GZ_STATE_PROJECT_ID`, `GZ_STATE_TABLE`, `GZ_STATE_PK` (partition-key attribute name; live table: `K`, also the default), `GZ_STATE_REFRESH_TOKEN`, optional `GZ_STATE_ORG_ID`, `GZ_STATE_ENVIRONMENT` |

> Catalyst AppSail reserves the `CATALYST_` prefix: it rejects any environment variable whose name starts with it ("environment_variables must not contain reserved keywords", verified live 7 Oct 2026). Hence the `GZ_` names; the code still reads the old `CATALYST_*` names as a fallback (local runs only, the `GZ_` name wins), but never set them on AppSail.

**Enrolment (once per test user, by a person).** With the variables set and the app redeployed/restarted: open the
console in a private window, *Continue with Zoho*, sign in as the test user and pick the **Growize Staging** sandbox on
the consent screen. A user on `GZ_TEST_SIGNIN_USERS` is enrolled by that sign-in: their refresh token is kept sealed
(ZOHO_SESSION_KEY, AES-256-GCM) in the shared state store, and Plane C records `test-signin-enrolled`. Signing out or the
12 hours running out does **not** revoke an enrolled token. Repeat for each user, then check:

```sh
curl -s https://<app-host>/api/test/session/status -H "X-Test-Signin-Secret: $GZ_TEST_SIGNIN_SECRET"
# {"ok":true,"users":[{"zohoUserId":"…","enrolled":true,"source":"store","seat":"ir","seatName":"investor-relations"}, …]}
```

**Persistence.** With `STATE_STORE=memory` (staging today) the enrolment lives in the instance's memory and is lost on
every AppSail instance recycle or redeploy — status then shows `enrolled:false` and the users must sign in again. With
`STATE_STORE=catalyst` it is in Catalyst NoSQL and survives. Under memory you can instead paste a refresh token into
`GZ_TEST_REFRESH_<id>` (read-only fallback). The app never shows a token, so mint it yourself on the same OAuth client:
add a second redirect URI (e.g. `https://localhost/`) to the client in the Zoho API console, open
`https://accounts.zoho.in/oauth/v2/auth?response_type=code&access_type=offline&prompt=consent&client_id=<ZOHO_OAUTH_CLIENT_ID>&scope=<the scopes in oauth/runtime.ts DEFAULT_USER_SCOPES, comma-separated>&redirect_uri=https://localhost/`
signed in as the test user (pick the sandbox), copy `code` from the address bar, and exchange it within two minutes:
`curl -s -X POST https://accounts.zoho.in/oauth/v2/token -d grant_type=authorization_code -d client_id=… -d client_secret=… -d redirect_uri=https://localhost/ -d code=…` → `refresh_token`.

**Use (curl / Playwright).** The secret goes in a header, never a URL:

```sh
curl -s -c jar.txt -X POST https://<app-host>/api/test/session \
  -H "X-Test-Signin-Secret: $GZ_TEST_SIGNIN_SECRET" -H "Content-Type: application/json" \
  -d '{"zohoUserId":"<id>"}'
# 200 {"ok":true,"who":"<id>","seat":"ir","seatName":"investor-relations"}  + Set-Cookie: gz_zsid=… (the normal session)
```

```js
const ctx = await request.newContext({ baseURL: 'https://<app-host>' });
const r = await ctx.post('/api/test/session', { headers: { 'X-Test-Signin-Secret': process.env.GZ_TEST_SIGNIN_SECRET }, data: { zohoUserId: id } });
await ctx.storageState({ path: `sess/${id}.json` });   // then browser.newContext({ storageState: `sess/${id}.json` })
```

The session is minted by the same pipeline as the OAuth callback (org zgid check, CurrentUser, seat, D60 admission), so
it is refused for the same reasons: `{ok:false, why:"wrong-org"|"no-seat"|"no-grant"|"failed"}`. Other answers: 404 =
off or wrong/missing secret; 400 bad body; 403 `not-allowlisted`; 409 `not-enrolled` / `token-user-mismatch`; 429 =
the route limit (10/min) or `zoho-token-budget` (8 mints per user per 10 minutes — Zoho allows about 10 access tokens
per refresh token per 10 minutes; reuse the storage state instead of minting per test). Plane C records
`test-signin-used` with the user id and seat.

**Turn it off:** unset `GZ_TEST_SIGNIN_SECRET` (and the `GZ_TEST_REFRESH_*` variables) and redeploy; the routes are
404 again. Enrolled tokens stay valid at Zoho until revoked: revoke them per user in Zoho (accounts.zoho.in > Sessions >
Connected Apps) when the test users are retired.

