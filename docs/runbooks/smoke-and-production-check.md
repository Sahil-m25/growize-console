# Smoke suite and the production check (M19-S07)

`console/scripts/smoke.mjs` answers one question in under three minutes: **is the app up and sane?** It is small and fixed on purpose; the Jev suite answers whether it is right.

    node console/scripts/smoke.mjs <url> [--mode deploy|production] [--out smoke.json] [--budget-s 180]
         [--ir "Rohit Deshpande"] [--inv "Meena Raghavan"] [--storage-ir f.json] [--storage-inv f.json] [--jev] [--alert-webhook URL]

Exit 0 = all pass; 1 = a check failed or the budget was beaten; 2 = bad arguments. Playwright's Chromium is needed for the page checks (`npx playwright install chromium`).

| Check | Passes when |
|---|---|
| boots | `GET /` answers below 500 with an HTML page (retries for 30 s while a deploy starts) |
| sign-in screen | a signed-out visitor sees the sign-in screen (the Zoho button, or the people list on a fixture build) |
| rail: IR side, rail: Investors side | signed in as an IR seat / an Investors-side seat, every rail link opens and draws its page (one page per rail area per side), without bouncing to sign-in |
| /api/data | JSON, `Cache-Control: no-store`, never a 5xx |
| security headers | CSP (script-src with no inline/eval/wildcard), HSTS, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy on `/`, `/api/data` and a 404 |
| no native dialogs | no alert/confirm/prompt and no uncaught page error during any visit |
| Jev: 6 smoke cases (`--jev`, deploy mode only) | the six plain-language cases of `pm/smoke-cases.json` (sign in, Today, open a lead, save a note on a test lead, search, sign out) all PASS through `pm/jev-ui-runner.mjs --retry-review` |

A page check with no way to sign in is reported SKIP, never PASS.

## Signing in
- **Local / demo build** (fixture sign-in): nothing to pass; the script picks `--ir` and `--inv` from the people list.
- **Staging / production** (Zoho): pass saved Playwright sessions with `--storage-ir` and `--storage-inv` (from `console/scripts/jev-sessions.mjs`). CI uses `rohit.json` and `meena.json` from the Jev sessions directory.

## Where it runs
- **Staging job** (`pipeline.yml`): after the deploy and the saved-sessions step, before the Jev suite; a failure stops the job. The deploy step is still the AP4 placeholder.
- **Production**: `--mode production` is **read-only by construction**: the HTTP helper refuses non-GET methods, the browser aborts any non-GET request (reported as a failed `read-only` check), nothing but rail links is clicked, `/api/test/*` must answer 4xx, and `/api/data` with no session must answer 401/403 (a 200 means fixture data is being served). `--jev` is refused in this mode because case 4 writes a note.
- **Hourly** (`production-check.yml`, `HOSTING_READY` gated): signs in with the saved test sessions of an IR with no book, opens each rail page, and POSTs `{"text": …}` to `SMOKE_ALERT_WEBHOOK` on failure. The webhook is the hand-off to the alert path that reaches Sahil (email/WhatsApp, M19-S07-T02).

## Open for the owner (needs AP4 or a person)
- Hosting, so the deploy step and the staging/production URLs exist.
- A test IR with no book in the production Zoho org, its saved sessions as secret `PROD_CHECK_SESSIONS_TGZ_B64`, and the alert relay behind `SMOKE_ALERT_WEBHOOK`.
- Saved sessions last 12 hours (`jev-sessions.mjs check`); an hourly check needs a session that outlives that, or a re-mint step. Until then an expired session surfaces as an alert.
