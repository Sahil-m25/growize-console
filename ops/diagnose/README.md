# The daily diagnostic

Runs every morning. **It finds what is wrong, works out why, and explains what fixing it would
cost. It changes nothing.** Not a line of code, not a row, not a setting.

## Why it is built this way

The failure analysis found 145 ways this system can break and 53 of them are silent — nothing
tells anyone. The eleven canaries alert on *conditions*. This job is different: it reads
everything the canaries produce plus the things no alert watches, and writes one report a person
can read in three minutes.

It never fixes, for one reason: **in a system that moves money, the wrong repair is worse than
the fault.** A job that quietly re-ran a failed webhook could double a receipt. A job that
"corrected" a stale mirror row could overwrite the newer value. So the diagnostic proposes, names
what would break, and stops.

## What it reads

| Source | What it looks for |
|---|---|
| The eleven canaries | anything that fired, anything that stopped firing |
| Cross-org invariants | rung ≤ lifecycle ≤ gates, one lead per investor, one uid per investor, fully paid and not allotted, gates without receipts, units disagreeing, duplicates |
| Outbox and inbox | undelivered rows by age, dead letters, signature failures, out-of-order drains |
| The reconcile | field differences between Zoho and each mirror, and their age |
| Money | receipts unmatched over three days, suspense lines, statement lines with no receipt, due below zero |
| Zoho | credit usage against the day's allowance, concurrency refusals, failed workflow and function notices, records edited by a human where only the integration user should write |
| Supabase | security and performance advisors, error rates by function, slow queries, connection headroom, `pg_cron` last-run age |
| Paper | documents sent over 48 hours with no status change, approvals pending over two days, signed rows with no file |
| Backups | last object age and size in S3, last restore drill date |
| The repo | tests failing in CI, the secrets scan, schema drift between the two projects, `contracts/` versions in use versus declared |

## What it writes

`ops/diagnose/reports/YYYY-MM-DD.md`, committed. One section per finding:

```
## F-2026-11-03-02 · Outbox: four events undelivered for 9 hours
Severity      major
What is wrong Four money.confirmed events for lead 8811 are on attempt 3, next attempt in 40m.
Why           The Investor org returned 401 on all four between 02:10 and 02:14. The integration
              user's refresh token was rotated at 02:09 by whoever regenerated the client secret.
Evidence      outbox rows 41022-41025; zoho_errors 02:10:14 INVALID_TOKEN; audit log 02:09:51
Blast radius  Two leads are sitting at rung 4 waiting for a gate that has already been paid.
              No money is lost; the receipts exist on the Investor side.
Proposed fix  Re-issue the integration refresh token and let the outbox drain on its own schedule.
Repercussions Draining replays four events. They are idempotent on event_id, so replay is safe —
              but only because the inbox dedupes; if the inbox were bypassed the acknowledgement
              email would be sent twice. Do NOT re-drive them by hand.
If ignored    The gates never open. The IR marks both leads Lost within a week, which strands two
              paid receipts (failure mode GA2 / C5).
Asked for?    No. Waiting for a person.
```

Every finding carries **why**, **blast radius**, **repercussions of the proposed fix**, and **what
happens if it is ignored**. A finding with no proposed fix says so rather than inventing one.

## Running it

```
python ops/diagnose/run.py --date today            # writes the report, changes nothing
python ops/diagnose/run.py --date today --dry-run  # prints, writes nothing
```

Scheduled at 07:00 IST — after the nightly jobs, before anyone starts work. It pings the
off-platform heartbeat when it finishes, so a diagnostic that stops running is itself noticed.

## The rule

The diagnostic has read-only credentials. Not by policy — by key. It physically cannot write to
Zoho, to either database, or to the seam. If a future version needs to fix something, that is a
different job, with a different key, and a person's decision in front of it.
