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

Stage the standalone output, then deploy:

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
ZOHO_TEST_INVESTOR_IDS.
Service-credential refresh tokens: ZOHO_KAM_POOL_RETURN_REFRESH_TOKEN, ZOHO_COVER_WINDOW_SHARE_REFRESH_TOKEN,
ZOHO_PROVIDER_CALLBACK_REFRESH_TOKEN, ZOHO_AUDIT_ARCHIVE_REFRESH_TOKEN.
Signing and idempotency secrets: ZOHO_SIGN_WEBHOOK_SECRET_PREVIOUS (and the current secret, named in server/zoho-sign),
RECEIPT_IDEMPOTENCY_SECRET, RECEIPT_CONTEXT_SIGNING_SECRET, FOLLOWUP_UNDO_SECRET, CONTRACT_SIGNING_KEY,
CONTRACT_SIGNING_KEY_PREVIOUS.
Policy and mail: ORG_EMAIL_DOMAINS, SIGN_EMBED_HOSTS, INVESTOR_APP_URL, ALERT_EMAIL_TO, STEPUP_ALERT_TO,
GZ_RATE_LIMITS, GZ_SIGNIN_LIST, GZ_RELEASE_APPROVAL, GZ_EXTEND_APPROVAL.
Stores (see warning): LOG_STORE, LOG_DIR, LOG_SINK, GRANT_STORE, GRANT_DIR, AUDIT_ARCHIVE_DIR, CONTRACTS_DIR, STATE_STORE.
Jobs: JOB_SECRET, SIGN_CHECK_TIMER.
Platform: X_ZOHO_CATALYST_LISTEN_PORT (set by Catalyst), NODE_ENV.
Dev-only (not for production): FIXTURE_MODE, GZ_LOCAL_BUILD, ZOHO_STUB_USER, NEXT_PUBLIC_RETICLE_URL/TOKEN/ROOT.

Run `grep -rhoE "env\.[A-Z][A-Z0-9_]{4,}" console/src | sort -u` before each release; this list was taken 4 Oct 2026.

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
