# Environment matrix — staging and production (M01-S05-T01, M19-S05-T01)

Two deployed environments, one per Zoho org (D26, D51):

| | staging | production |
|---|---|---|
| Zoho org | **sandbox** (M02-S10) — tokens carry the sandbox `api_domain` | live org |
| Deployed by | `.github/workflows/pipeline.yml` job `staging`, on every push to `main` | job `production`, after green staging **and** a manual approval |
| GitHub Environment | `staging` | `production` (add *Required reviewers*: Sahil) |
| Who uses it | the weekend tester + the Jev UI suite | real users, from go-live only |

**Hosting is not chosen yet (AP4).** The workflow's deploy steps are placeholders that fail loudly; the
staging and production jobs stay skipped until the repository variable `HOSTING_READY` is `true`.

## Every variable the code reads

Found with `grep -rhoE "process\.env\.[A-Z0-9_]+" console/src console/scripts` **plus** the ones read
through `env.X` (injected `NodeJS.ProcessEnv`) and `required("X")` (zoho-sign/runtime.ts), which that grep
misses. Re-run both when adding a variable; this table and `.env.example` must list it.

Legend: **S** = secret (GitHub Environment *secret*, host secret store; never in the client bundle, never
`NEXT_PUBLIC_`), **V** = plain config (GitHub Environment *variable*), **—** = must be unset.

### App server (Next.js)

| Variable | Kind | staging | production | Read by |
|---|---|---|---|---|
| `NODE_ENV` | V | `production` (set by `next build/start`) | `production` | many (guards, stub, sign-in list) |
| `ZOHO_ACCOUNTS_ORIGIN` | V | `https://accounts.zoho.in` | `https://accounts.zoho.in` | oauth/runtime.ts, zoho-sign/runtime.ts (must be India DC) |
| `ZOHO_OAUTH_CLIENT_ID` | V | sandbox OAuth client id | live OAuth client id | oauth/runtime.ts, zoho-sign/runtime.ts |
| `ZOHO_OAUTH_CLIENT_SECRET` | **S** | sandbox client secret | live client secret | oauth/runtime.ts, zoho-sign/runtime.ts |
| `ZOHO_OAUTH_REDIRECT_URI` | V | `https://<staging-host>/api/auth/zoho/callback` | `https://<prod-host>/api/auth/zoho/callback` | oauth/runtime.ts (https ⇒ secure cookies) |
| `ZOHO_OAUTH_SCOPES` | V | optional (defaults in code) | optional | oauth/runtime.ts |
| `ZOHO_SESSION_KEY` | **S** | 32 random bytes, base64 — its own | 32 random bytes, base64 — its own | oauth/crypto.ts (session sealing) |
| `ZOHO_CRM_RECORD_ID_PREFIX` | V | sandbox org's record-id prefix | live org's prefix | oauth, data, email, zoho-sign |
| `ZOHO_SEAT_IDS` | V | JSON `{roleIds,profileIds}` of the **sandbox** roles | same, live ids | oauth/runtime.ts, data/zoho-source.ts |
| `ZOHO_UNASSIGNED_QUEUE_USER_ID` | V | sandbox queue user id | live queue user id | data/zoho-source.ts |
| `ZOHO_PROVIDER_CALLBACK_REFRESH_TOKEN` | **S** | sandbox service refresh token (job `provider-callback`) | live | zoho-sign/runtime.ts |
| `ZOHO_SIGN_API_ORIGIN` | V | `https://sign.zoho.in` | `https://sign.zoho.in` | zoho-sign/runtime.ts (must be India DC) |
| `ZOHO_SIGN_WEBHOOK_SECRET` | **S** | its own | its own | zoho-sign/runtime.ts |
| `ZOHO_SIGN_WEBHOOK_SECRET_PREVIOUS` | **S** | only during a rotation | only during a rotation | zoho-sign/runtime.ts |
| `ORG_EMAIL_DOMAINS` | V | `agresearchlabs.com` | `agresearchlabs.com` | leads/email-runtime.ts |
| `FOLLOWUP_UNDO_SECRET` | **S** | ≥ 32 chars, its own | ≥ 32 chars, its own | leads/email-runtime.ts |
| `ALERT_EMAIL_TO` | V | ops alert inbox | ops alert inbox | ops/runtime.ts |
| `LOG_STORE` | V | `jsonl` | `jsonl` | logs/factory.ts (`memory` loses logs on restart) |
| `LOG_DIR` | V | persistent volume path | persistent volume (Object Lock bucket mount, AP4) | logs/factory.ts |
| `GZ_SIGNIN_LIST` | V | `staging` (shows the tester's sign-in list) | **—** | access/signin-list.ts |
| `ZOHO_STUB_USER` | V | **—** | **—** (ignored in production anyway) | lib/data/stub-user.ts, api/auth/zoho |
| `FIXTURE_MODE` | V | **—** | **—** (`local` = fixtures, never deployed) | lib/fixture-mode.ts |
| `GZ_LOCAL_BUILD` | V | **—** | **—** | lib/fixture-mode.ts, stub-user.ts |
| `JEV_SEED_TOKEN` | **S** | set: guards `/api/test/*` | **—** (test API must not be reachable) | scripts/jev-staging-seed.mjs sends it |
| `NEXT_PUBLIC_RETICLE_TOKEN` / `_URL` / `_ROOT` | V | **—** | **—** (dev-only Reticle bridge) | app/reticle-dev.tsx |
| `GZ_RATE_LIMITS` | V | **—** | **—** (`on` only forces the limits on under `NODE_ENV=test`; every other mode enforces them) | server/http/request-gate.ts |

### CI / test tooling (GitHub Environment `staging` only)

| Variable | Kind | Used by |
|---|---|---|
| `STAGING_URL` | V | jev-staging-run.mjs, jev-staging-seed.mjs, leak-matrix, smoke |
| `APP_URL` | V | jev-staging-seed.mjs fallback for `STAGING_URL` (leave unset) |
| `JEV_STAGING_CONFIG` | V (path) | written by CI from secret `JEV_STAGING_CONFIG_JSON` |
| `JEV_SESSIONS_DIR` | V (path) | CI unpacks secret `JEV_SESSIONS_TGZ_B64` here |
| `JEV_PW_<SEAT>` | **S** | jev-sessions.mjs sign-in (only if sessions are minted in CI) |
| `TYPESAFE_API_KEY` | **S** | pm/jev-ui-runner.mjs (Jev judge) |
| `TS_KEY_FILE` | V (path) | alternative to `TYPESAFE_API_KEY` |
| `FIXTURES` | V (path) | fixtures file for the runner/seeder (default `pm/merge-audit/ui-sahil/fixtures-merged.json`) |
| `ONLY` | V | runner case filter (comma list) — CI sets it from `vars.JEV_ONLY` |
| `PASS_AT` | V | Jev pass threshold (default 0.80) |
| `SEED_WAIT_MS` | V | seed settle wait (default 700) |
| `SETTLE_MS` / `SETTLE_CAP_MS` | V | runner's settle wait after each step: quiet time (default 250 ms) and cap (default 6000 ms), M19-S08 |
| `JEV_RETRY_REVIEW` | V | `1` = the runner re-runs a REVIEW case once (same as `--retry-review`) |
| `SMOKE_ALERT_WEBHOOK` | **S** | smoke.mjs / production-check.yml: chat webhook that takes `{"text"}`, called when a smoke or production check fails (production Environment too) |
| `PROD_CHECK_SESSIONS_TGZ_B64` | **S** | production-check.yml: tar.gz of `ir.json` / `inv.json` saved sessions for a test IR with no book (production Environment) |
| `LEAK_MATRIX_CONFIG` | V (path) | scripts/leak-matrix.mjs |
| `NODE_PATH` | V | set by test harnesses themselves — do not configure |

### One-off operator scripts (never in CI, never on the host)

| Variable | Kind | Used by |
|---|---|---|
| `ZOHO_ACCESS_TOKEN` | **S** | scripts/migrate-legacy-payments.cjs |
| `ZOHO_API_DOMAIN` | V | scripts/migrate-legacy-payments.cjs |
| `ZOHO_RECORD_PREFIX` | V | scripts/migrate-legacy-payments.cjs |

## Rules

- Staging and production never share a secret value: separate OAuth clients, session keys, webhook secrets.
- Only `NEXT_PUBLIC_*` reaches the browser; none of the secrets above may be renamed to it. CI's
  `bundle secret scan` step builds and greps `.next/static` for `client_secret`, `refresh_token` and each
  secret's value (TC-E01-018).
- **Rate limits are in-process (M18-S15-H3).** `console/src/server/http/request-gate.ts` keeps one token bucket
  per client IP + session in the Node process's memory (`RATE_LIMITS`: sign-in `/api/auth/*`, `/api/*/search`,
  `/api/documents/upload`, `/api/webhooks/*`). That is correct only for **one instance**. A host that runs
  more than one instance (autoscaling, several regions, serverless functions — AP4 is not chosen) divides the
  limit by nothing and multiplies it by the instance count: before going multi-instance, move the buckets to a
  shared store (e.g. Redis/Upstash `INCR` + `EXPIRE`) behind the same `RateLimiter` interface.
- **The client IP comes from the proxy.** The limiter reads the right-most `X-Forwarded-For` hop (else
  `X-Real-IP`) — the address the host's own edge appended. Confirm the chosen host sets it that way (one trusted
  hop); with no proxy header every caller shares one "unknown" bucket per session.
- Local development: copy `.env.example` to `console/.env.local` (git-ignored) and fill what you need, or
  use `npm run dev:local` (fixtures, no Zoho).
