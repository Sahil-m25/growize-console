# The Zoho API budget is running out

**23 Sep 2026 — re-scoped.** The numbers are Enterprise's now — one org (D52), every human on a full
seat (D53) — and the budget matters more than when this was written, because under zero copy (D45)
every screen is a Zoho call and there is nothing to fall back on. The reconcile this page told you to
switch off no longer exists, and the Supabase document fallback is removed: it was a second store D45
forbids. The numbers, steps 1 to 3 and the last warning are rewritten.

**You will see:** the PLATFORM canary — `X-API-CREDITS-REMAINING` appearing on responses, which Zoho
sends only once the day passes 50% of its allowance, so its appearance is the alarm (D47); our own
in-flight count near a ceiling; or HTTP 429s.

**The numbers.** Enterprise: 50,000 credits a day plus 1,000 per licence, reset daily — about a dozen
full seats under D53 puts the day near 60,000. Concurrency **20** org-wide, and a sub-concurrency of
**10** on COQL, lists with `sort_by` or `cvid`, and bulk calls — the same on every edition, and the
bucket the console's heaviest screens, Leads and Numbers, draw on (D46, D53). Credits are not the
constraint; concurrency is.

**What it means:** something is reading in a loop, or too many complex calls are in flight at once.
Read the 429's body — Zoho returns the same code for credits, concurrency and sub-concurrency, and the
three have different fixes.

**First, in order:**

1. Plane B's call telemetry, by endpoint and by person (D47). Every human calls on their own token,
   so the noisy seat names itself; Zoho's API dashboard shows the same by user, module and IP, in its
   UI only, for thirty days.
2. The usual culprits, in order of likelihood: a document view that re-fetches per render instead of
   per open; a screen refreshing on a timer, when the own book refreshes only on sign-in, focus, action
   or write (D45); a cache keyed so narrowly it never hits, or not consulted at all (D53); a per-lead
   fan-out of Timeline calls behind Activity (D47 rejected it); a background job walking records one at
   a time instead of using Bulk Read; a retry loop with no backoff on a call that is failing for a
   reason retrying will not fix.
3. Immediate relief: pause one background job for a cycle — the audit archive is designed to be
   skippable, since the next unfiltered run catches up (D47). Never pause the cover-window unshare
   ([heartbeat-silent.md](heartbeat-silent.md)). If the 429s are sub-concurrency, the lever is the
   client-side gate — about 8 complex calls and 12 overall in flight (D53) — not more retries.

**Do not:** buy API credits as the first move. A loop that is burning 50,000 credits will burn 100,000.

**Do not:** stretch a cache TTL past five minutes to save calls. The ceiling is hard (D45): past it
the screen fails loud rather than ageing quietly into the copy D45 forbids.

**Do not:** cache documents or any per-record payload to save credits. Documents live only in Zoho on
purpose (D8); the cache holds counts and aggregates only (D45, D52); a document held anywhere else is
a second store and a leak path at once.
