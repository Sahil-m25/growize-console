# D41 — Honest connection status and five-minute pending saves

_16 Sep 2026 · owner request for connection/freshness visibility and save recovery_

The header shows browser connection, data source, pending/failed saves and the last acknowledged local update, with text beside the status dot. Browser connectivity alone cannot establish server availability, upstream freshness or uptime. These versions use local demo fixtures and say so. No live Zoho/Supabase refresh time is fabricated.

Business saves made while the browser is offline wait in an in-memory queue for at most five elapsed minutes. Pending saves do not change records, count as recorded work, announce success or clear form drafts. Reconnection attempts only unexpired pending work. At the five-minute boundary, waiting work becomes failed; reconnection cannot silently revive it. Explicit retry starts a new waiting window. Repeated presses do not create duplicate queued work.

Capture immutable payloads and bind each task to the authenticated actor and session. Before replay, recheck current record visibility, exact operation permissions, eligible recipients, ownership, availability, consent and the relevant record/form context. Reject changed tasks instead of overwriting newer edits or clearing replacement drafts. Other investors' drafts remain independent. Only confirmed local application advances the last-local-update time and completes the matching form. Failures and retries stay scoped to their actor, session and readable record, including pop-out notices.

Sign-out, account changes and reset discard old work and cancel timers. Late asynchronous settlements cannot complete another session's task. A fresh confirmed replacement retires older matching failed/pending attempts while preserving unrelated work and its deadlines. The shared pure controller is `console/src/lib/save-queue.ts`; the standalone prototype embeds a generated copy so it works from a local file. Regenerate it with `console/prototype/ux-audit/embed-save-queue-runtime.cjs` after controller changes.

The queue currently lasts only while the demo page/provider is alive. This is not a durable backend outbox, a server write acknowledgement, a service uptime monitor or upstream synchronization. A real integration needs authoritative source timestamps/health, acknowledged writes, idempotency and appropriate durable recovery; the UI must keep distinguishing pending work from confirmed source data.
