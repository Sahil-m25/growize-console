# Operations runbook (M18-S09, M18-S10)

Written 4 Oct 2026. This is the first page to open when something is wrong. It points to the detailed pages. It does not replace them.

Rules for every fault:
- Say what you see. Say what it means. Do the first step. Write down what you did.
- Never paste a token, secret, PAN, Aadhaar, bank number or investor name into chat, a ticket or a screenshot.
- Never fix by editing a record by hand. Money, paper and allotments are undone by reversal events (D19).
- Never use an administrator token through the app (CLAUDE.md rule 2). An administrator looks in Zoho directly.

## 1. Who is on call

| Role | Who |
|---|---|
| First responder, alert recipient | Sahil (Digital Infrastructure). Alerts go to `ALERT_EMAIL_TO`, set to Sahil's address (M18-S04-NOTE-1). Step-up failure alerts go to Sahil and Pradeep (M01-S10). |
| Deputy when Sahil is away | **OPEN — owner** |
| Out-of-hours cover and phone numbers | **OPEN — owner** |
| Money questions | Head of Finance (Harsha Bhat) |
| Decision on rollback, restore, or telling investors | **OPEN — owner** to name the person. Sahil calls a rollback (`docs/launch/go-live-checklist.md` section 4). |
| Legal or regulator notice after a leak | Counsel, per Q20 (`ops/runbooks/pii-leak.md`). Name: **OPEN — owner** |

Until these are filled the on-call answer is "Sahil, and nobody else". That is a risk. Say so at go/no-go.

## 2. Index of runbooks

| Page | Use it when | State |
|---|---|---|
| `ops/runbooks/webhook-stopped.md` | A provider callback stopped arriving (Zoho Sign, mail, bank) | Valid, re-scoped 23 Sep |
| `ops/runbooks/api-budget.md` | Zoho credits or concurrency running out, 429s | Valid, re-scoped 23 Sep |
| `ops/runbooks/pii-leak.md` | An identity field got past the wall | Rewritten 23 Sep |
| `ops/runbooks/money-mismatch.md` | Ledger and bank statement disagree | Valid. Updated to D113 (refunds keep D22's second hand) |
| `ops/runbooks/heartbeat-silent.md` | The dead-man heartbeat stopped | Re-scoped. Where jobs run is not settled |
| `ops/runbooks/sign-in-history.md` | Who signed in, from where, who failed | Written 4 Oct |
| `ops/runbooks/outbox-stuck.md` | Nothing. Void: there is no outbox (D45) | Void, kept as record |
| `docs/runbooks/weekly-reconciliation.md` | Every week: Finance uploads the bank statement | Written. Matching step predates D113 |
| `docs/launch/backup-restore-plan.md` | Backup, restore, drill | Plan only |
| `docs/launch/go-live-checklist.md` | Go-live, rollback | Plan only |
| `docs/ops/hypercare.md` | First two weeks after go-live | Plan only |
| `ops/diagnose/README.md` | The daily diagnostic. It explains. A person decides. | Source list still names the mirror and the outbox (A-18) |
| This page, sections 4 to 11 | 429 storms, conflicts, token refresh, stuck save, Zoho Sign outage, push backlog, secret rotation, licence renewal, leaver and onboarding, restore | New |

## 3. Alerts to actions

The console raises these seven alerts by email (`console/src/server/ops/alerts.ts`). Each names the rule, count, window, route templates and request ids. Never a body or an identity value.

| Alert (rule) | Fires when | Do |
|---|---|---|
| `credits-header` "Zoho credits: past half the daily allowance" | First `X-API-CREDITS-REMAINING` of the Kolkata day. Once a day. | `ops/runbooks/api-budget.md`. Read the projection line in the alert. Nothing to do if it says the day ends with credits left. |
| `server-error-spike` "Console: server errors spiking" | 5 or more 5xx in 5 minutes (PROVISIONAL threshold). Quiet 30 minutes after. | Section 4. Open Logs, find the route from the alert. If it began right after a deploy, roll back (go-live checklist 4a). |
| `failed-saves` "Console: saves are failing" | 3 or more failed saves in 10 minutes. Quiet 30 minutes. | Section 7. |
| `token-refresh-failed` "Zoho: a service token failed to refresh" | Any failure. The alert names the job. | Section 6. |
| `sign-webhook-failed` "Zoho Sign: a webhook could not be processed" | Any failure. | Section 8 and `webhook-stopped.md`. |
| `push-failed` "Investor app: a push failed" | Any failed push to the investor app. | Section 9. |
| `backup-failed` "Backup: a run failed" | Any failed backup run. | `docs/launch/backup-restore-plan.md`. Run the backup again by hand and write why it failed. |

Also watch (no email yet):

| Canary | Do |
|---|---|
| Heartbeat silent | `heartbeat-silent.md`. First check the cover-window unshare. |
| MONEY: statement line with no receipt, or receipt with no line | `money-mismatch.md` |
| PII: an identity value where it must not be | `pii-leak.md`. Stop the path first. |
| Sign-in probing: many `refused` lines against one person | Logs page, Plane B. Then `sign-in-history.md`. |
| Three failed step-ups | Locked action and an alert to Sahil and Pradeep. Check Plane C. Then `sign-in-history.md`. |

Until a real mailer is plugged in, alerts sit in an in-memory outbox and no email is sent (M18-S04-NOTE-1). Do not go live without it (go-live checklist D3).

## 4. 429 storms and server errors

A 429 has three different causes. They have different fixes. Read which one first.

**Zoho 429.** The console classifies it (`console/src/lib/zoho/errors.ts`):

| Kind | Meaning | What the console does | What you do |
|---|---|---|---|
| `credits-exhausted` | The org's daily credits are gone | Never retries. Hours away. | Wait for the day to reset. Find the loop (`api-budget.md` step 2). Do not buy credits first. |
| `concurrency-exceeded` | Too many calls in flight (org, or the sub-bucket for COQL, sorted lists, bulk) | Retries fast. A write is safe to resend because it was refused before it ran. | Find what is calling in a loop. Pause one background job. The client gate is about 12 calls overall and 8 complex (D53). Do not raise retries. |
| `rate-limited-unclassified` | The body names both a daily limit and concurrency | Retries twice, slowly | Treat as concurrency first. |

**The console's own 429.** Rate limits at the door: sign-in `/api/auth/*` 20 a minute, search 60, upload 20, webhooks 120, per client IP and session, with a coarser limit per IP (`console/src/server/http/request-gate.ts`). A 429 with `Retry-After` there means one caller is hammering. Look in Plane B for the person and route. A webhook 429 may be a sender retrying. The limits are in-process: with more than one instance each has its own bucket (`ops/env/README.md`).

**A storm.** Steps:
1. Read one 429 body. Which kind?
2. Plane B, by route and by person. Every human calls on their own token, so the noisy seat names itself (D47).
3. Pause one background job for a cycle if Zoho's concurrency is full. Never pause the cover-window unshare.
4. If it began at a deploy, roll back.
5. Tell the seat holder if one person is the cause. Write what you found.

**Do not** stretch the cache past five minutes. **Do not** cache documents (D45, D8).

## 5. Conflict on save ("Changed by someone else")

You see: a save is refused with "Changed by someone else — reload". Zoho answered 412 `ALREADY_MODIFIED`; the console reads `Modified_Time` on every read and sends it back on the write (D44, D112).
Meaning: two people worked the same record. This is expected under a cover window (D44).
Do: the person reloads and redoes the change. Nothing was written. No admin action.
Escalate if: the same person gets it on a record nobody else touched. A workflow in Zoho may be changing the record after each read. Check the record's timeline in Zoho.
Do not: save over it by another route.

## 6. Token refresh failed

You see: the `token-refresh-failed` alert, with a job name (for example the Zoho Sign callback job), or people asked to sign in again.
Meaning: a service refresh token or the OAuth client no longer works. Common causes: the token was revoked, the service user was deactivated, the client secret was rotated on one side only.
Do:
1. Read the job name in the alert. It names which credential.
2. Check the service user is still active in Zoho and still on its restricted profile.
3. Re-consent the service user for that OAuth client. Store the new refresh token in the host secret store only (`ops/env/README.md`, `ZOHO_PROVIDER_CALLBACK_REFRESH_TOKEN`).
4. Confirm the refresh response carries `api_domain` of the India data centre (`https://www.zohoapis.in`). A different domain is the wrong data centre.
5. Run the failing job once. Confirm the alert stops.
For a staff member whose session expired: they sign in again with Zoho. Nothing for you to do.
Do not: use the super admin's token as a service token (A-12, CLAUDE.md).

## 7. A save is stuck or failing

You see: "Not saved yet" on a page, the save status showing Retry, "N changes waiting", or the `failed-saves` alert.
How it works (D41): a failed write tells the person, changes nothing on the record, shows Retry, and keeps the typed text. An offline write is queued and fails visibly after 5 minutes. A refresh while a save is pending loses it. Signing out discards a pending save.
Do:
1. Ask the person for the page and the time. Do not ask for the record's contents.
2. Plane B: find the failed save by route and time. Look at the Zoho status and code (no body is logged).
3. By code: 403 means a profile or field-level security refusal. 412 means a conflict (section 5). 429 means section 4. 5xx from Zoho means check Zoho's status page. A validation refusal means the person's input broke a Zoho rule: read the message.
4. Tell the person to press Retry once the cause is gone.
5. If three or more people are affected, it is `failed-saves`. Treat as an incident: section 3.
Do not: re-enter their work for them as another person. Never act as the integration user to do a human's work (CLAUDE.md).

## 8. Zoho Sign outage

You see: papers do not move from "Out for signature" to Viewed or Signed. The `sign-webhook-failed` alert. Zoho Sign's own status page shows an incident.
What still works: the console can mark a paper verified from a signed scan uploaded by hand. Every paper can arrive by Zoho Sign or manual upload into the same slot, verified the same way (D78).
Do:
1. Check Zoho Sign status. If it is down, say so on the Finance channel. IRs keep chasing as normal. The IR's word "they say it's signed" is only a hint and never changes the status (IR-08).
2. Do not resend requests. A second send is refused while one is out. Wait.
3. If investors cannot wait, use the manual route: Finance uploads the scanned signed copy and presses "The signed copy is here" (FIN-10).
4. When Sign is back: if events were lost, run the poller for Sign (the Sign GET answers what the webhook would). The webhook is a hint, the poller is the truth (`webhook-stopped.md` step 3).
5. If signatures fail HMAC: someone rotated the secret on one side only. Two secrets are meant to be live during a rotation (`ZOHO_SIGN_WEBHOOK_SECRET_PREVIOUS`).
Do not: replay a payload from a log. Do not paste the webhook secret anywhere.

## 9. Investor-app push backlog

You see: System shows push "not delivered yet". The `push-failed` alert. Investors say the app has not updated.
How it works (D73, `console/src/server/contracts/events.ts`): each event is signed, sent with its `event_id` as the idempotency key, and retried on 5xx or network errors with backoff (up to 30 seconds between tries). It counts as delivered only when the app answers `push.delivered` for that event. A 4xx is a refusal and is not retried. An unknown `schema_version` is dead-lettered.
Do:
1. System, Investors side: how many events and how old.
2. Is the app's receiver up? Today it is a stub (MA1, the app codebase is not in the repo). In production: OPEN — owner for the app's contact and status page.
3. Reason `refused:4xx`: the app rejects the event. Check the schema version and the signing key. Do not retry blindly.
4. Reason `unreachable` or `no-ack`: wait for the app, then resend. The same event twice is processed once.
5. When the receiver is back, confirm one event goes to delivered. Then the backlog.
Do not: tell investors "delivered" when the page says "not delivered yet".

## 10. Leaked field and money mismatch

- Leaked field: go straight to `ops/runbooks/pii-leak.md`. Stop the path before you diagnose.
- Money mismatch: `ops/runbooks/money-mismatch.md`. The first two causes (timing, a typo) are almost always it. Wrong receipts are reversed and re-recorded, never edited. Weekly routine: `docs/runbooks/weekly-reconciliation.md`.
- D113 changed who matches a receipt: a receipt Finance records is matched, automatically from the statement where possible, else by Finance. Refunds and money leaving keep a second hand (D22). The runbook pages now say so.

## 11. Routine tasks

### Secret rotation
Which secrets are in `ops/env/README.md` (marked S). Rules: staging and production never share a value. A secret never goes into chat, a screenshot, a log, or this repo.
Webhook and event signing keys (`ZOHO_SIGN_WEBHOOK_SECRET`, contract HMAC keys): two keys are live during a rotation.
1. Set the new key as current and the old as `..._PREVIOUS`. Deploy.
2. Update the other side (Zoho Sign webhook, the investor app) to sign with the new key.
3. Confirm events arrive and verify with the new key. Watch Plane B for signature failures.
4. After the longest retry window has passed, remove the previous key.
Other secrets (`ZOHO_OAUTH_CLIENT_SECRET`, `ZOHO_SESSION_KEY`, `FOLLOWUP_UNDO_SECRET`, refresh tokens): rotate in the host secret store, redeploy, test. A new `ZOHO_SESSION_KEY` signs everyone out. Do it outside working hours. Rotation cadence: **OPEN — owner**.
Do not rotate a key during a rollback or cutover.

### Licence renewal
- Zoho CRM Enterprise: expires **13 Oct 2026** (A-20). If it lapses, field-level security, sandbox, approvals and concurrency limits go with it. Renew before the date. Save the invoice reference in `ops/` notes. After each renewal enter the new expiry date once so System can show it (M17-S06-NOTE-1).
- Seats: every human holds a full Enterprise seat, viewers included (D53). A new seat needs a licence first.
- Zoho Sign plan: renewal date recorded in the ops notes (M20-S08-T01).
- Who pays and who reminds: **OPEN — owner**. Proposed: a calendar reminder 30 days before each expiry (proposed).

### Onboarding a person
Seat rows are in `ops/SEAT-PLAN.md` and `docs/ACCESS-PLAN.md`. Sahil assigns seats, roles and responsibilities (D113 5c).
1. Owner or manager asks Sahil in writing: name, company email, seat.
2. Buy or free a licence.
3. In Zoho Setup, invite the person at their own company mailbox with the exact role and profile for the seat (M03-S05-T01). Never share a login.
4. The person accepts the invite and signs in once.
5. Run T11 or the isolation check for that profile if it is a new profile. For an existing profile with a test user already passed, run the seat's UAT smoke steps.
6. Give them their quick guide (`docs/launch/guides/`).
7. For a KAM: Head of AM assigns accounts. For an IR: IR Manager deals leads.
8. Write a line in the ops notes: date, who, seat.

### Leaver (or a laptop lost)
1. Same day: in Zoho Directory, end the person's sessions and force a password reset (`sign-in-history.md`). For a lost device, do this at once.
2. Deactivate the Zoho user. The seat frees a licence. (The exact screen is Setup, Users. Not verified; note the path in the first run.)
3. Remove any page grants (Teams, grants are Digital Infrastructure's or the manager's).
4. Remove any live cover-window shares for that person. Check the sharing on leads they covered (`heartbeat-silent.md` step 1).
5. Reassign their work first, before deactivation if you can: IR leads by the IR Manager (Assign owner, or hand over); KAM accounts by the Head of AM (Move the account); open tickets by the ticket owner's manager; Finance queue items by the Head of Finance.
6. Check Plane C: any identity reveals or step-up failures by that person in their last week. A reveal with no matching sign-in is escalated (`sign-in-history.md`).
7. Write a line in the ops notes: date, who, what was reassigned.
Do not delete the person's records or touches. History stays (D19, audit).

### Restore
Use `docs/launch/backup-restore-plan.md`. A production restore needs the owner's approval, Finance's count check and a pause on writes. The tester follows the drill steps in section 6 of that plan without asking Sahil (TC-E15-036).

## 12. Weekly and daily routines

| When | What | Who | Page |
|---|---|---|---|
| Every week | Bank statement upload and reconciliation | Finance | `docs/runbooks/weekly-reconciliation.md` |
| Every Monday (PROVISIONAL, owner to confirm) | Sign-in history check, ten minutes | Sahil | `ops/runbooks/sign-in-history.md` |
| Every week | Backup file exists; Zoho export under `zoho/` current | Sahil | `backup-restore-plan.md` |
| Every day | Daily diagnostic report (explains, never fixes) | Sahil reads | `ops/diagnose/README.md` |
| Two weeks after go-live | Daily 30-minute health review | Sahil | `docs/ops/hypercare.md` |
| Each quarter | Restore drill, key rotation with two live keys | Sahil | `ops/drills/README.md` |

## 13. Open items

| # | Item | Owner |
|---|---|---|
| 1 | Deputy, out-of-hours cover, phone numbers | owner |
| 2 | Who decides rollback in Sahil's absence, restore, investor notice | owner |
| 3 | Counsel's name for a notifiable leak (Q20) | owner |
| 4 | Investor app contact and status page | owner |
| 5 | Secret rotation cadence | owner |
| 6 | Licence reminder owner | owner |
| 7 | Where scheduled jobs run (`heartbeat-silent.md`) | owner |
