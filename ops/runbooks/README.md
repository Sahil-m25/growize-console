# Runbooks

One page per thing that goes wrong at 2am. Each says: what you will see, what it means, what to do first, and what *not* to do. A runbook never asks you to think. Thinking happens here, in daylight.

The operations entry point is `docs/ops/runbook.md`: who is on call, alerts to actions, and the procedures that have no page of their own (429 storms, conflicts, token refresh, stuck saves, Zoho Sign outage, investor-app push backlog, secret rotation, licence renewal, onboarding and leavers, restore).

**23 Sep 2026: re-scoped to zero copy and one Enterprise org (D45, D52, D53).** MONEY is still valid. DM, INBOUND, PLATFORM and PII are re-scoped: the canary still matters, the thing it watched changed. OUTBOX is void: there is no outbox. Each page carries its own dated banner saying which and why. The eleven canaries in Build Book section 22 predate all three decisions and are not amended.

## Index

| Page | Use it when | State (4 Oct 2026) |
|---|---|---|
| [webhook-stopped.md](webhook-stopped.md) | INBOUND: a provider callback stopped arriving (Zoho Sign, mail, bank) | Re-scoped 23 Sep. Names `ZOHO_SIGN_WEBHOOK_SECRET_PREVIOUS`, as in `ops/env/README.md` |
| [api-budget.md](api-budget.md) | PLATFORM: the Zoho API budget is running out, or 429s | Re-scoped 23 Sep |
| [pii-leak.md](pii-leak.md) | PII: an identity field got past the wall. Act before you diagnose. | Rewritten 23 Sep |
| [money-mismatch.md](money-mismatch.md) | MONEY: the ledger and the bank statement disagree | Valid. The "same person matches" step predates D113 item 1 |
| [heartbeat-silent.md](heartbeat-silent.md) | DM: the dead-man heartbeat stopped | Re-scoped 23 Sep. Where jobs run is not settled |
| [sign-in-history.md](sign-in-history.md) | ROUTINE: who signed in, from where, who failed (Zoho Directory; no console screen) | Written 4 Oct |
| [outbox-stuck.md](outbox-stuck.md) | Nothing. Void since D45. Kept as the record of what the old design needed. | Void |

Also in the repo:

| Page | What |
|---|---|
| [../../docs/runbooks/weekly-reconciliation.md](../../docs/runbooks/weekly-reconciliation.md) | Weekly bank statement reconciliation by Finance (M10-S05-T06) |
| [../../docs/ops/runbook.md](../../docs/ops/runbook.md) | The operations runbook |
| [../../docs/ops/hypercare.md](../../docs/ops/hypercare.md) | The two-week hypercare plan |
| [../../docs/launch/backup-restore-plan.md](../../docs/launch/backup-restore-plan.md) | Backup, restore and the drill |
| [../../docs/launch/go-live-checklist.md](../../docs/launch/go-live-checklist.md) | Go-live checklist, cutover, rollback |
| [../drills/README.md](../drills/README.md) | The drills and their cadence. Outcomes go in `ops/drills/<date>-<name>.md` |
| [../env/README.md](../env/README.md) | Every variable and secret, per environment |
| [../diagnose/README.md](../diagnose/README.md) | The daily diagnostic. It explains. A person decides. |

## Alerts to pages

| Alert | Page |
|---|---|
| `credits-header` | api-budget.md |
| `server-error-spike`, `failed-saves`, `token-refresh-failed`, `push-failed` | `docs/ops/runbook.md` sections 4 to 9 |
| `sign-webhook-failed` | webhook-stopped.md and `docs/ops/runbook.md` section 8 |
| `backup-failed` | `docs/launch/backup-restore-plan.md` |
