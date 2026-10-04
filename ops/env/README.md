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
| `SESSION_ENC_KEY` | **S** | 32 random bytes, base64 — its own, not `ZOHO_SESSION_KEY` (optional while `STATE_STORE` is memory: absent, a per-process key is made) | 32 random bytes, base64 — its own; **required** with `STATE_STORE=catalyst` (the server refuses to start without it) | oauth/session-store.ts — seals each stored user session record (AES-256-GCM, bound to its key); rotating it signs everyone out |
| `ZOHO_CRM_RECORD_ID_PREFIX` | V | sandbox org's record-id prefix | live org's prefix | oauth, data, email, zoho-sign |
| `ZOHO_SEAT_IDS` | V | JSON `{roleIds,profileIds}` of the **sandbox** roles | same, live ids | oauth/runtime.ts, data/zoho-source.ts |
| `ZOHO_UNASSIGNED_QUEUE_USER_ID` | V | sandbox queue user id | live queue user id | data/zoho-source.ts |
| `CONSOLE_SUPER_ADMIN_IDS` | V | Sahil's sandbox Zoho user id | Sahil's live Zoho user id | access/policy.ts (D115: the super administrator — loads event sheets; unset = nobody) |
| `ZOHO_PROVIDER_CALLBACK_REFRESH_TOKEN` | **S** | sandbox service refresh token (job `provider-callback`) | live | zoho-sign/runtime.ts |
| `ZOHO_SIGN_API_ORIGIN` | V | `https://sign.zoho.in` | `https://sign.zoho.in` | zoho-sign/runtime.ts (must be India DC) |
| `ZOHO_SIGN_WEBHOOK_SECRET` | **S** | its own | its own | zoho-sign/runtime.ts |
| `ZOHO_SIGN_WEBHOOK_SECRET_PREVIOUS` | **S** | only during a rotation | only during a rotation | zoho-sign/runtime.ts |
| `ORG_EMAIL_DOMAINS` | V | `agresearchlabs.com` | `agresearchlabs.com` | leads/email-runtime.ts |
| `FOLLOWUP_UNDO_SECRET` | **S** | ≥ 32 chars, its own | ≥ 32 chars, its own | leads/email-runtime.ts |
| `ALERT_EMAIL_TO` | V | ops alert inbox | ops alert inbox | ops/runtime.ts |
| `LOG_STORE` | V | `jsonl` | `jsonl` | logs/factory.ts (`memory` loses logs on restart) |
| `LOG_DIR` | V | persistent volume path | persistent volume. Log store: OPEN — owner (D47); no Object Lock on Plane B (C-07, M18-S05-T01); hosting AP4 open | logs/factory.ts |
| `GZ_SIGNIN_LIST` | V | `staging` (shows the tester's sign-in list) | **—** | access/signin-list.ts |
| `ZOHO_STUB_USER` | V | **—** | **—** (ignored in production anyway) | lib/data/stub-user.ts, api/auth/zoho |
| `FIXTURE_MODE` | V | **—** | **—** (`local` = fixtures, never deployed) | lib/fixture-mode.ts |
| `GZ_LOCAL_BUILD` | V | **—** | **—** | lib/fixture-mode.ts, stub-user.ts |
| `JEV_SEED_TOKEN` | **S** | set: guards `/api/test/*` | **—** (test API must not be reachable) | scripts/jev-staging-seed.mjs sends it |
| `NEXT_PUBLIC_RETICLE_TOKEN` / `_URL` / `_ROOT` | V | **—** | **—** (dev-only Reticle bridge) | app/reticle-dev.tsx |
| `GZ_RATE_LIMITS` | V | **—** | **—** (`on` only forces the limits on under `NODE_ENV=test`; every other mode enforces them) | server/http/request-gate.ts |
| `STATE_STORE` | V | unset (`memory`) until hosting is chosen | `catalyst` if AP4 lands on Catalyst AppSail (more than one instance); unset only on a single-instance host | server/state/runtime.ts — anything but unset/`memory`/`catalyst` refuses to start |
| `CATALYST_API_ORIGIN` | V | with `STATE_STORE=catalyst`: `https://api.catalyst.zoho.in` (India DC host UNVERIFIED) | same | server/state/catalyst.ts |
| `CATALYST_PROJECT_ID` | V | with `STATE_STORE=catalyst`: the numeric project id | same | server/state/catalyst.ts |
| `CATALYST_STATE_TABLE` | V | with `STATE_STORE=catalyst`: the NoSQL table (partition key `k`, TTL attribute `ttl`) | same | server/state/catalyst.ts |
| `CATALYST_REFRESH_TOKEN` | **S** | with `STATE_STORE=catalyst`: a refresh token with the ZohoCatalyst.nosql item scopes | same | server/state/catalyst.ts (uses `ZOHO_ACCOUNTS_ORIGIN`, `ZOHO_OAUTH_CLIENT_ID`/`SECRET`) |
| `GRANT_STORE` | V | unset | unset with `STATE_STORE=catalyst` (→ `shared`); `jsonl` only on a single host with a persistent disk | access/grants.ts — `memory` \| `jsonl` \| `shared`; unset follows `STATE_STORE` (`catalyst` → `shared`, else `memory`); `shared` without `STATE_STORE=catalyst` refuses to start |
| `GRANT_DIR` | V | with `GRANT_STORE=jsonl` only | same | access/grants.ts |
| `JOB_SECRET` | **S** | ≥ 32 random chars, its own | ≥ 32 random chars, its own | jobs/claim.ts — the `X-Job-Secret` header the platform scheduler sends to `POST /api/jobs/sign-recheck` and `/api/jobs/outbox-drain` (constant-time compare); unset → those answer 503 `not-configured` |
| `SIGN_CHECK_TIMER` | V | unset | unset (`off` under `STATE_STORE=catalyst`; the scheduler calls the job instead) | zoho-sign/runtime.ts — `on` \| `off`; unset = `on` on a single-process store, `off` when `STATE_STORE=catalyst` |
| `CATALYST_ORG_ID`, `CATALYST_ENVIRONMENT` | V | optional (`CATALYST-ORG` header; `Development` sends `Environment: Development`) | optional | server/state/catalyst.ts |

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
- **Rate limits, step-up locks, webhook dedupe and user sessions live in a SharedState (M18-S15-H3, M18-S09-NOTE-1).** `console/src/server/state/`
  — `STATE_STORE` unset keeps them in the Node process's memory, which is correct only for **one instance**; a host
  that runs more than one (autoscaling, Catalyst AppSail's up-to-5, serverless) must set `STATE_STORE=catalyst` (or
  add another adapter behind the same interface). A misconfigured store refuses to start; it never falls back to
  memory. `STATE_STORE=catalyst` also moves, in one switch, the webhook seen-ids, the investor-app request index,
  the push outbox queue (each delivery attempt claimed), the grant store (unless `GRANT_STORE` says otherwise) and
  the money Idempotency-Key guards (mark-paid, add-paid, record-receipt) and the payout job's run claim. The Zoho
  Sign dead-letters and the push ledger are append-only records and go to the log sink (`LOG_STORE=jsonl` /
  `LOG_SINK=stratus`). On such a host set `JOB_SECRET` and schedule the two job calls (`catalyst/README.md`).
  Sessions are sealed with `SESSION_ENC_KEY`. The rest of the inventory: `docs/architecture/shared-state.md`.
- **The client IP comes from the proxy.** The limiter reads the right-most `X-Forwarded-For` hop (else
  `X-Real-IP`) — the address the host's own edge appended. Confirm the chosen host sets it that way (one trusted
  hop); with no proxy header every caller shares one "unknown" bucket per session.
- Local development: copy `.env.example` to `console/.env.local` (git-ignored) and fill what you need, or
  use `npm run dev:local` (fixtures, no Zoho).
