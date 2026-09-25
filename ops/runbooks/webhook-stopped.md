# A webhook stopped arriving

**23 Sep 2026 — re-scoped. Zoho sends us nothing a screen waits on.** Under D45 every screen reads
Zoho live, so the Zoho-to-mirror webhook this page was mostly about is gone, and the reconcile that
closed its gaps with it. What still arrives from outside is the providers' callbacks — eMudhra's
signature events, the mail provider's delivery events, and whatever the bank and the FMS still send —
received by service identities that never serve a screen (D53). Each is a hint that a record changed,
re-fetched with the right token, its payload never logged (D52). This page now covers those only.
Step 1, the *what it means* paragraph and the last paragraph are rewritten, because the old versions
sent you to a Supabase table, to a rule that no longer exists and to a reconcile that does not run.

**You will see:** the INBOUND canary — no event of a type that normally arrives every day.

**What it means:** possibly the sender is down; possibly it is sending and we are rejecting; possibly
nothing happened today and this is a false alarm. A callback is only ever a hint; the provider's own
GET is the truth (D52), so nothing is lost yet — it is late, not gone.

**First, in order:**

1. Plane B's entries for that source — IDs and status codes, never bodies (D47, D52); until Plane B
   exists (A-05), the receiver's own request log. If requests are arriving and failing signature
   verification, someone rotated a key on one side only. Two keys are meant to be live during
   rotation; put the previous key back in `SEAM_HMAC_KEY_PREVIOUS`.
2. If nothing is arriving at all: check the sender. eMudhra and the bank both have status pages; the FMS has ours.
3. Run the poller for that source manually. Zoho, eMudhra and the bank all have a GET that answers
   the same question the webhook would have. **The poller is the truth; the webhook is a hint.**
4. Only if the poller also returns nothing is this real.

**Do not:** replay a webhook payload you captured from a log to "catch up". The record is re-fetched
on every delivery precisely so that a stale payload cannot be replayed into the system. And a payload
in a log is itself a broken guard (D52) — if you found one, go to [pii-leak.md](pii-leak.md).

**Zoho webhooks specifically:** no screen depends on one. If a Zoho workflow still notifies a
background job, it fires once and is never retried, so an outage leaves a permanent gap in that
stream — and nothing needs the stream to be whole, because the job re-reads Zoho on its next run.
There is no reconcile; do not go looking for one.
