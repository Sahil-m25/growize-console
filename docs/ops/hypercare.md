# Hypercare plan: the first two weeks (M18-S10)

Written 4 Oct 2026. Status: plan. It starts on go-live day. The date is **OPEN — owner** (`docs/launch/go-live-checklist.md`).

Items marked "proposed" are mine and the owner may change them. Items marked **OPEN — owner** are not decided.

## Purpose
Catch problems the same day, answer people fast, and write down what happened. Two weeks is 10 working days (Monday to Friday). Which days are working days for the team: **OPEN — owner** (the plan assumes Monday to Friday).

## Who
| Role | Who |
|---|---|
| Hypercare lead. Runs the daily review, triages defects. | Sahil (M18-S10-T02) |
| Deputy | **OPEN — owner** |
| Seat holders on call for questions | The people in `docs/ops/runbook.md` section 1, plus each seat's holder (names in `docs/uat/scenarios/`) |
| Decides rollback in the first 48 hours | Sahil calls it. Backup person **OPEN — owner** |

## Window 1: the first 48 hours (rollback window)
- A failed smoke check or a P1 means rollback (`go-live-checklist.md` section 4). App access is withdrawn within 30 minutes. Staff continue in Zoho.
- Sahil looks at Logs and System at the start of the first day, at midday and at the end (proposed). Alerts go to his email.
- Seat holders are told how to reach him (`docs/launch/support-model.md`). A top-severity report gets a response the same working day, and in this window within 1 hour (proposed).
- After 48 hours with no P1, write "rollback window closed" with the time in the log.

## The daily 30-minute health review
Held at the end of each working day (proposed: 17:30 IST). Sahil alone is enough. Write the result in `docs/ops/hypercare-log.md` before leaving. No entry means the review did not happen.

Look at, in this order:

| # | Check | Where | Good means | Act when |
|---|---|---|---|---|
| 1 | Errors | Logs, Plane B, `server-error` lines by route | No route with a run of 5xx | A route repeats: `runbook.md` section 4 |
| 2 | 429s | Logs, Plane B, 429 lines by kind and person | None, or a few `concurrency-exceeded` that retried | Any `credits-exhausted`, or one person in a loop |
| 3 | Failed saves | Logs, save-failed lines by route | None, or single cases that were retried | Three in ten minutes already alerted. Look at repeats on one page |
| 4 | Zoho credits | System page; the `credits-header` alert and its projection line | The day ends with credits left | Projection says the allowance runs out before midnight |
| 5 | Zoho Sign | System page, Sign webhook health; the `sign-webhook-failed` alert | No failed webhook. No request out for signature longer than Finance expects | `runbook.md` section 8 |
| 6 | Push to the app | System page, "not delivered yet" count | Zero, or only fresh ones | `runbook.md` section 9 |
| 7 | Refusals | Logs, `refused` lines by person | Few, and explained | A burst against one person: `sign-in-history.md` |
| 8 | Alerts received today | Email | Each one has a line in the log with what was done | Any unexplained alert |
| 9 | Reports from users | Defects line list (`autopilot/console/BLOCKED.md` or the team's tracker) | Each has a severity and an owner | Any S1 without a response |
| 10 | Licence and expiry | System page | Expiry date known and in the future | Under 30 days |

Credits are the only count the alerts do not give you daily. The projection line in the first credits alert of the day does.

## What to record each day (`docs/ops/hypercare-log.md`)

One row per working day:

| Date | Day | Errors | 429s | Failed saves | Credits | Sign failures | Push failures | New reports | Open P1 / P2 | Decisions, notes | Who |
|---|---|---|---|---|---|---|---|---|---|---|---|

Use words for "nothing": write "none". Never put a name, PAN, bank number or note body in the log. Record ids only.

## Weekly items

Week 1:
- First weekly bank statement reconciliation by Finance (`docs/runbooks/weekly-reconciliation.md`). Sahil checks it happened.
- First sign-in history check on Monday (`ops/runbooks/sign-in-history.md`).
- Confirm the first backup file exists (`docs/launch/backup-restore-plan.md`).
- Friday status note to the owner: done, next, risks, decisions needed (`docs/launch/stage-reviews.md`).

Week 2:
- Second reconciliation. Second sign-in check.
- First read of the KPIs that already have data (`docs/launch/product-brief.md`). No targets are changed here.
- Friday status note. Then the hypercare retrospective.

## Defect triage rhythm (proposed)
- Reports arrive by the one intake route (`docs/launch/support-model.md`).
- Sahil triages new reports twice a day: start of day and the daily review.
- Severity decides the clock (support model section 3). P1 first.
- A fix that touches Zoho setup goes through change control (`docs/launch/change-control.md`).
- Fixes are batched into one release a day at most during hypercare, unless a P1 needs one now (proposed).

## Exit (proposed)
Hypercare ends when all hold:
1. Ten working days logged.
2. No open P1. Every open P2 has a written workaround.
3. No unexplained alert in the last 3 working days.
4. The owner agrees in writing.
Then support returns to the normal model, the daily review stops, and the weekly checks stay. The retrospective is written (`docs/launch/stage-reviews.md`, template for the go-live stage).

If a P1 appears after day 10, hypercare restarts for 5 working days (proposed).

## Open items
| # | Item | Owner |
|---|---|---|
| 1 | Working days and hours for the team | owner |
| 2 | Deputy for Sahil | owner |
| 3 | Time of the daily review (17:30 is a proposal) | owner |
