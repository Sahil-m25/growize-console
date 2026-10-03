# Runbooks

**23 Sep 2026 — re-scoped to zero copy and one Enterprise org (D45, D52, D53).** MONEY is still
valid. DM, INBOUND, PLATFORM and PII are re-scoped — the canary still matters, the thing it watched
changed. OUTBOX is void: there is no outbox. Each page carries its own dated banner saying which and
why. Three rows below are amended to match; the eleven canaries in Build Book §22 are not, and
predate all three decisions.

One page per thing that goes wrong at 2am. Each says: what you will see, what it means, what to do
first, and what *not* to do. A runbook never asks you to think — thinking happens here, in daylight.

The eleven canaries in Build Book §22 each point at one of these.

| Canary | Runbook |
|---|---|
| DM · the dead-man heartbeat | [heartbeat-silent.md](heartbeat-silent.md) |
| INBOUND · a provider callback stopped arriving | [webhook-stopped.md](webhook-stopped.md) |
| OUTBOX · void since D45 — there is no outbox | [outbox-stuck.md](outbox-stuck.md) |
| MONEY · the ledger and the statement disagree | [money-mismatch.md](money-mismatch.md) |
| PLATFORM · the Zoho API budget is running out | [api-budget.md](api-budget.md) |
| PII · an identity field got past the wall | [pii-leak.md](pii-leak.md) |
| ROUTINE · who signed in, from where, who failed (no console screen; Zoho Directory) | [sign-in-history.md](sign-in-history.md) |
