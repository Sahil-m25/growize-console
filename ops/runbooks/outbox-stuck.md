# The outbox is backing up

**23 Sep 2026 — void. There is no outbox.** D45 abolished the mirror this queue fed, and D52 put
leads and investors in one org, so the twenty crossing facts it carried are now ordinary same-org
field writes made on the acting person's own token (D53). There is no `events` table, no
`events_dead`, no worker and no per-record queue; every query below runs against nothing. The only
buffer left between a click and Zoho is the save queue (D41) — pending, failed and retried saves show
on the ops console's Health panel (`docs/ops-audit-console.md` §2), and a refresh mid-outage loses
them. The OUTBOX canary in Build Book §22 should be retired with this page's reason. Kept, not
deleted, as the record of what the old design needed.

**You will see:** the OUTBOX canary — undelivered events older than the threshold, or a count climbing.

**What it means:** one event at the head of a per-record queue is failing, and ordering is preserved
per record, so everything behind it waits. That is by design: delivering event 4 before event 2 would
apply a reversal before the thing it reverses.

**First, in order:**

1. `select id, type, attempts, last_error from events where delivered_at is null order by created_at limit 20`
2. Group by `last_error`. One error on one record is a poison message. The same error on everything is
   the receiver being down or a credential expiring — check the Zoho refresh token first, it is the
   commonest.
3. A poison message: read the payload. If the schema is wrong, it dead-letters — move it to
   `events_dead` with the reason, and the queue drains. **Record which record it was**; a human has to
   decide what that record's true state is.
4. A receiver being down: nothing to do but fix the receiver. The outbox is durable; it will drain.

**Do not:** delete an undelivered event to unblock the queue. Dead-letter it, with the reason, so the
reconcile can find the record later. A deleted event is a fact that silently never happened.

**Do not:** raise the worker's concurrency to catch up. Per-record ordering is the invariant; parallel
workers on the same record break it.
