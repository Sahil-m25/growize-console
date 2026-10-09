# B-27 — turning the Activity page on in staging (owner runbook)

Staging today: `/activity` shows 0 actions after IR writes. Why, and the smallest setup that fixes it. About 20 minutes, no new bucket, no new Catalyst service.

## Why it is empty

- Lead actions (notes, lost / re-open, forecast, absence …) are not written by the console at all. They reach the Activity page only through the **nightly Zoho audit-log export**, which `POST /api/jobs/audit-export` archives (`server/activity/runtime.ts`, `export-job.ts`). The page reads that archive plus Plane C (reveals, step-ups, seat changes — written by the console).
- On staging nothing runs that job (no Catalyst cron, no `JOB_SECRET`, no `ZOHO_AUDIT_ARCHIVE_REFRESH_TOKEN`), and the archive has no home: with no `LOG_SINK` the archive is `null` (`AUDIT_ARCHIVE_DIR` unset), so the page reads an empty archive. Plane C falls back to the **in-memory ring**, which is per AppSail instance and lost on recycle — so even an investor-side reveal can vanish or differ between requests.
- `LOG_SINK=stratus` would fix the home but needs a bucket plus `STRATUS_BUCKET_URL`, `STRATUS_CLIENT_ID/SECRET/REFRESH_TOKEN` (a second grant).
- **New: `LOG_SINK=state`** puts Plane C, the Sign dead-letters, the push ledger **and** the audit archive in the Catalyst NoSQL state store staging already has (`STATE_STORE=catalyst`, `GZ_STATE_*`). One variable, no bucket, same India-DC Catalyst project (D47), codes and ids only (D45, rule 7). Plane B (ops/errors) stays in memory by design (one line per Zoho call is too many NoSQL writes).

Even when everything below is done, a lead action shows **the day after**, around 02:00 IST, when yesterday's export is archived. The page already says so. Same-day rows need an owner ruling (not built).

## Can Stratus reuse the `GZ_STATE_*` credential? (not needed, but the answer)

- NoSQL needs `ZohoCatalyst.nosql.READ` + `ZohoCatalyst.nosql.rows.ALL` (verified live; per-endpoint scopes in the docs are `ZohoCatalyst.nosql.item.INSERT/UPDATE/READ`, <https://docs.catalyst.zoho.com/en/cloud-scale/help/nosql/llms-full.md>).
- Stratus needs `Stratus.fileop.CREATE` (upload) and `ZohoCatalyst.buckets.objects.READ` (list), per `docs/architecture/log-sink.md` and the Catalyst API reference <https://docs.catalyst.zoho.com/en/api/code-reference/cloud-scale/stratus/llms-full.md>. **UNVERIFIED** against a real bucket: that these work from AppSail, and that one refresh token can carry both families.
- A Zoho refresh token is bound to the scopes it was minted with. The existing `GZ_STATE_REFRESH_TOKEN` does not carry the Stratus scopes, so reusing the credential means re-minting it with all four scopes **and** creating a bucket. That is strictly more work than `LOG_SINK=state`.

## The audit-archive grant: who and which scopes

The export runs as a background service (D53: never a screen). Sources: Zoho CRM v8 docs.

| Call (what the code does) | Scope |
|---|---|
| `POST /crm/v8/settings/audit_log_export` (request the day) | `ZohoCRM.settings.audit_logs.CREATE` — <https://www.zoho.com/crm/developer/docs/api/v8/create-export-audit-log.html> |
| `GET /crm/v8/settings/audit_log_export/{id}` (poll) | `ZohoCRM.settings.audit_logs.READ` — <https://www.zoho.com/crm/developer/docs/api/v8/get-export-audit-log.html> |
| Download the CSV/ZIP (`download_links`) | `ZohoFiles.files.READ` — <https://www.zoho.com/crm/developer/docs/api/v8/download-export-audit-log-result.html> |
| `GET /crm/v8/users?type=AllUsers` (name/email in the export → user id) | `ZohoCRM.users.READ` |

Scope string: `ZohoCRM.settings.audit_logs.CREATE,ZohoCRM.settings.audit_logs.READ,ZohoFiles.files.READ,ZohoCRM.users.READ`

Who: the audit-log docs say only **Administrator-profile or CEO-role users see all audit logs**; anyone else sees their own and their subordinates'. So the token must belong to a dedicated service user in the **sandbox "Growize Staging"** org with the Administrator profile or the CEO role (not a person's own account, and not an IR). **Decision for you:** D52 says no administrator token serves a screen; this one never does (background export only, output = ids and codes), but you are creating one admin-level credential. If you do not want that, the Activity lead side stays empty.

## Steps

### 1. Mint `ZOHO_AUDIT_ARCHIVE_REFRESH_TOKEN` (same OAuth client as the app)

The app refreshes this token with `ZOHO_OAUTH_CLIENT_ID/SECRET`, so mint it on **that** client (a token from another client will not refresh).

1. <https://api-console.zoho.in> → your client (the one whose id is `ZOHO_OAUTH_CLIENT_ID`) → add the authorized redirect URI `https://localhost/` if missing.
2. In a private window sign in to Zoho as the **service user** (Admin/CEO, sandbox) and open (fill in the client id; one line):
   `https://accounts.zoho.in/oauth/v2/auth?response_type=code&access_type=offline&prompt=consent&client_id=<ZOHO_OAUTH_CLIENT_ID>&scope=ZohoCRM.settings.audit_logs.CREATE,ZohoCRM.settings.audit_logs.READ,ZohoFiles.files.READ,ZohoCRM.users.READ&redirect_uri=https://localhost/`
3. Choose the sandbox org **Growize Staging** on the consent screen, Accept. The browser fails to load `https://localhost/?code=…`; copy the `code` value from the address bar (valid 2 minutes).
4. Exchange it (terminal):
   `curl -s -X POST https://accounts.zoho.in/oauth/v2/token -d grant_type=authorization_code -d client_id=<id> -d client_secret=<secret> -d redirect_uri=https://localhost/ -d code=<code>`
   Copy `refresh_token` from the answer (never `access_token`). Do not paste it anywhere but step 2.

### 2. Set the AppSail variables (Catalyst console)

Catalyst console → project GrowizeConsole (Development) → AppSail → `growize-console` → Environment variables → add, then save:

| Name | Value |
|---|---|
| `LOG_SINK` | `state` |
| `ZOHO_AUDIT_ARCHIVE_REFRESH_TOKEN` | the refresh token from step 1 (secret) |
| `JOB_SECRET` | a new random string, 32+ characters (secret; also used in step 3) |
| `ZOHO_FINANCE_USER_IDS` | optional (Auditor view) |

Do **not** set `LOG_STORE`, `AUDIT_ARCHIVE_DIR` or any `STRATUS_*`. Already present and required: `STATE_STORE=catalyst` and the `GZ_STATE_*` set, `ZOHO_ACCOUNTS_ORIGIN`, `ZOHO_OAUTH_CLIENT_ID/SECRET`. If you deploy with the CLI, deploy without an `env_variables` key (catalyst/README.md, "Deploying without wiping the secrets"), then restart/redeploy so the app starts with `LOG_SINK=state`. `LOG_SINK=state` fails closed at start-up unless `STATE_STORE=catalyst`.

Deploy a build that contains this change (branch `b27-archive`) first; an older build ignores `LOG_SINK=state` with a start-up error.

### 3. Create the cron job (Catalyst console)

Job Scheduling → Job Pool → **Webhook** pool (create one if none: name `gz-jobs`) → create a webhook job, then a cron for it:

| Field | Value |
|---|---|
| Cron name | `gz-audit-export` |
| URL | `https://growize-console-50046579043.development.catalystappsail.in/api/jobs/audit-export` |
| Request method | `POST` |
| Header | key `X-Job-Secret`, value = the `JOB_SECRET` from step 2 |
| Body / query | none |
| Cron type | Cron Expression: `*/10 20-21 * * *` |
| Retries | 0 |

`*/10 20-21 * * *` is every 10 minutes 20:00–21:50 UTC = 01:30–03:20 IST, if the scheduler runs in UTC. If the console shows the schedule in IST, use `*/10 1-3 * * *`. **UNVERIFIED:** the exact expression grammar and per-request timeout of Catalyst crons (catalyst/README.md, Job Scheduling). Each call requests or resumes yesterday's export and polls ~20 s, so several ticks finish one day.

### 4. Verify

Replace `$SECRET` with `JOB_SECRET`, `$APP` with the staging URL. Never put the secret in a URL.

1. Wrong secret: `curl -s -o /dev/null -w '%{http_code}\n' -X POST $APP/api/jobs/audit-export -H 'X-Job-Secret: nope'` → `401`.
2. Run it by hand: `curl -s -X POST $APP/api/jobs/audit-export -H "X-Job-Secret: $SECRET"` →
   - first calls: `{"job":"audit-export","ran":true,"summary":{"ok":false,"day":"YYYY-MM-DD","code":"export-pending"}}` (Zoho is still building the export; call again every ~30 s);
   - then `{"job":"audit-export","ran":true,"summary":{"ok":true,"day":"YYYY-MM-DD","rows":<n>,"skipped":false}}`;
   - calling again for the same day → `"skipped":true`.
   - Problems by code: `credential-not-configured` (token variable missing), `credential-unavailable` (token refused: re-mint, check the OAuth client is the same), `users-unavailable` (`ZohoCRM.users.READ` missing), `export-failed`/`http-403` (the service user is not Admin/CEO or a scope is missing), `ran:false,"code":"already-running"` (another call holds it; wait), HTTP `503 not-configured` (`JOB_SECRET` missing) or `state-unavailable`.
3. `/api/system` (System page) → "Audit archive last run" changes from "never" to today.
4. Open `/activity` as an IR for the month containing yesterday: the lead side lists yesterday's actions (the response has `"archive":"state"`). Make a note today; it appears after tomorrow's run.
5. Do a reveal (step-up) as an Investors-side seat, restart/recycle the app, reload `/activity`: the Identity row is still there (Plane C is now in NoSQL, not the ring).
6. The day before has no export yet? Run step 2 once on the first evening; a day's export covers the IST day before the call.

## Rollback

Remove `LOG_SINK` and redeploy: Plane C goes back to the in-memory ring and the archive to "not set up". Archived data stays in the `gz_state` table (keys `audit|…`, `lg-…`); nothing else reads it.
