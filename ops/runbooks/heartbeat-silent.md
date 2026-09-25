# The heartbeat stopped

**23 Sep 2026 — re-scoped. The canary stays; the job chain it watched does not.** The nightly chain
on Supabase's pg_cron — the reconcile, the outbox drain, the mirror's upkeep — went with the mirror
(D45). What still runs on a clock is D53's short list of background work, each on a service profile
with identity fields hidden: the audit-log archive (D47), the cover-window share and unshare at each
window's boundary (D52, A-17), and the nightly invariant checks. A dead-man heartbeat over those is
still the only way their silence gets noticed. Where they are scheduled is not settled — the
cover-window pair is meant to be Zoho custom functions, the rest wait on A-05's store — so the steps
are rewritten around what each missed run costs rather than around a scheduler. The old steps queried
Supabase and pg_cron, which no longer exist, and told you to wait on a reconcile that no longer runs.

**You will see:** the off-platform monitor pages you. Nothing in Zoho is complaining, because the
thing that would complain is the thing that stopped.

**What it means:** a background job did not report. It does not mean the job failed — it means
nobody can tell you whether it ran. Silence is the failure mode this canary exists to break.

**First, in order — by what a missed run costs:**

1. **The cover-window unshare.** A missed unshare leaves a peer with record-level access to a lead
   after the window closed — a grant nobody approved. In Zoho, check the sharing on every lead whose
   D44 window ended since the last good heartbeat, and remove any share still standing — as an
   administrator in Zoho itself, never through the application (D52). A missed *share* only means the
   covering IR cannot see the lead yet.
2. **The audit-log archive.** Skippable: the job exports unfiltered and filters on our side, so the
   next run reaches the full three years and catches up (D47). Only a gap nearing Zoho's three-year
   deletion is urgent.
3. **The invariant checks.** A missed night is a night unchecked, not a night broken. Run them once
   by hand when the scheduler is back.
4. Then the scheduler's own run history for the silent window. A job that *started* and never
   finished is the common case.

**Do not:** re-run the cover-window job by hand without reading each window's end time first.
Sharing a lead whose window has closed hands out access nobody approved; unsharing one still open
cuts off an IR in the middle of cover.

**When it is back:** the report for the missed date must still be produced. `python ops/diagnose/run.py
--date YYYY-MM-DD` backfills it — though the diagnostic's own source list still names the mirrors,
the outbox and the reconcile (`ops/diagnose/README.md`) and is owed the same pass as this page.
