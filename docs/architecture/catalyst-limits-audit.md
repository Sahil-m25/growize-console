# Catalyst AppSail limits audit (4 Oct 2026, R4)

Scope: the 100 route handlers in `console/src/app/api/**/route.ts`, read against AppSail's 30 s request timeout,
the 10 s start window, ephemeral disk and instance recycling. Measured numbers are from the Docker image
(`console/Dockerfile`, fixture mode, 2 vCPU sandbox); everything else is read from the code and is an estimate.

## 1. Measured: the image

| | 512 MB limit | 1 GB limit |
|---|---|---|
| `docker run` to first 200 on `/` (5 runs, min / median / max) | 5.60 / 6.98 / 7.17 s | 5.17 / 5.87 / 6.55 s |
| `docker run` to first 200 on `/api/data/version` | 5.68 / 7.09 / 7.27 s | 5.33 / 5.95 / 6.63 s |
| Server's own log: "Ready in" | 0.34 - 0.59 s | same image |
| docker stats, idle | 91 MiB | 95 MiB |
| docker stats, after 27 routes x 2 rounds | 114 MiB | 122 MiB |
| node RSS after the rounds | 170 MB | 178 MB |
| OOM kills, restarts, final `/` | none, 0, 200 | none, 0, 200 |

- Image: 135 MB as stored by docker (compressed content), 325 MB unpacked; `/app` is 94 MB (37 MB is the sharp binaries, 8.7 MB typescript traced in). `node:22-slim` is the rest.
- The server is listening about 0.4 s after the process starts, far inside the 10 s window. The 5-7 s above include the sandbox's `docker run` overhead (~2 s, seen with a bare API probe: 2.1-2.8 s) and the first page render (~3 s cold, 2 vCPU); expect better on Catalyst, but UNVERIFIED there.
- 512 MB is comfortable for this load (peak 170 MB RSS). 256 MB is untested; do not go below 512 until it is.
- In the 27-route sweep, pages and `/api/data*`, `/api/session` return 200. `/api/farms|events|cases|teams` return 503 `not-configured` (no Zoho in the container, expected). `/api/activity` returned 500 with no archive/log configured; harmless in fixture mode but worth a clean 503 (GAP).
- Production build (no fixture flags) starts as uid 1000 and answers `/` 200 on a non-default `X_ZOHO_CATALYST_LISTEN_PORT`.
- The docker build needed `--network host` in this sandbox only (npm ci could not reach the registry from the default bridge).

## 2. Cross-cutting findings (not routes, but they decide whether AppSail works)

1. **No request deadline anywhere.** `lib/zoho/client.ts` calls `fetch` with only the caller's signal; routes pass `request.signal`, so a client disconnect aborts, but nothing aborts at 30 s. When AppSail answers 504 the handler may keep running and may still complete a write the caller thinks failed. No guard was added here: handlers read `request.signal` directly, so a guard in `withErrorCapture` would mean re-creating the `Request` for every route (not trivial, behaviour change on 100 routes). Proposed: one `AbortSignal.any([request.signal, AbortSignal.timeout(27_000)])` built in `withErrorCapture` and exposed through the existing `AsyncLocalStorage`, read by `client.ts` `execute()` when `spec.signal` is absent or alone; plus a per-attempt `AbortSignal.timeout(10_000)` on the Zoho `fetch`. Writes already tolerate `aborted` (unknown-outcome path, same-key retry).
2. **Retry budget per Zoho call** (`lib/zoho/errors.ts`): concurrency 429 up to 5 attempts, waits <= 0.1+0.2+0.4+0.8 = 1.5 s; unclassified 429 3 attempts, <= 3 s; 5xx/network (idempotent reads only) 4 attempts, <= 1.75 s. `Retry-After` is a floor capped at `MAX_RETRY_AFTER_MS` = 30 s per wait, so one throttled call can alone cost 4 x 30 = 120 s (concurrency) or 2 x 30 = 60 s (unclassified). Writes that are not idempotent never retry. Every estimate below is the no-retry figure; one throttled call breaks it.
3. **Per-call latency is not measured in this repo.** Estimates use 0.5 s per Zoho call (typical) and 1.5 s (degraded). UNVERIFIED; the System page's live-fetch latency check is the place to read the real figure.
4. **Sessions are in memory** (`server/oauth/runtime.ts` `createMemorySessionStore`). Instance recycle or a second instance signs everyone out. GAP before go-live.
5. **Local-disk stores are ephemeral on AppSail:** `LOG_STORE=jsonl` (Plane B), `GRANT_STORE=jsonl`, `AUDIT_ARCHIVE_DIR` (the audit archive). All lost on recycle; with `memory` the grants are lost too. GAP: rule 7/8 evidence cannot live there.
6. Module-level state (fixture lanes, rate limits `GZ_RATE_LIMITS`, Sign dedupe and dead letters) is per instance.

## 3. Routes that can pass 30 s

Call counts are sequential Zoho calls read from the code. "Expected" uses the real book (about 200 investors, one page per read).

| Route | Work (file) | Worst case from the code | Verdict | Fix |
|---|---|---|---|---|
| POST `/api/statements` | parse, <= 20 receipt look-ups, create + attach (<= 2 MB), then `autoMatch` runs `match()` for every credit line awaiting match, one after another (`server/money/statements.ts:305`) | each match is about 10-12 calls (`money/match.ts:207-447`: read receipt, read allotment, update receipt, payment status, other-matched COQLs, contact read and update, hold update, event publish). 5 lines = ~60 calls = 30 s at 0.5 s; 60 lines = ~720 calls = 6 min | **Fails by design** | Split: the upload returns after reconcile + attach (~25 calls, ~12 s); the page then calls the existing `POST /api/receipts/[id]/match` per line with a progress bar (no new infra). Alternative: Job Scheduling job that drains the awaiting list. |
| POST `/api/events/[id]/sheet` | 3 reads, then `onBook` 1 COQL per 25 phones, then 1 insert per 100 rows, 2 updates, all serial (`events/loader.ts:134-250`) | calls = 6 + 0.05 x rows. 2,000 rows (the cap) = 106 calls = 53 s at 0.5 s; breaks 30 s at ~1,080 rows (0.5 s) or ~280 rows (1.5 s) | **Fails above ~300-1,000 rows** | Run the `onBook` COQLs concurrently (gate allows 8 complex; 80 calls become ~10 waves, ~5 s) and the inserts in waves of 3-4. The claim-once rule forbids splitting the load into several POSTs. Lower `MAX_IMPORT_ROWS` only as a stop-gap. |
| PUT `/api/users/[id]` (KAM leaves seat) | <= 10 COQL pages of the book (`POOL_MAX` 2,000), a seat update, then one `update` per contact in a serial loop (`access/seat-change.ts:252`) | calls = ~3 + book size. 55 contacts = 30 s at 0.5 s; 2,000 = 1,000 s | **Fails above ~55 investors per KAM** | Bounded-concurrency updates (4 at a time, same `ifUnmodifiedSince`), or return `202` and finish in a Job Scheduling job; the response already separates `returned` / `notReturned`. |
| GET `/api/investors/finance` | contacts <= 10 pages, allotments and farms <= 10 each in parallel, receipts <= 10, `resolveIrs` chunks of 100 (`investors/finance-list.ts:169-207`) | cap: ~40-50 calls = 20-25 s at 0.5 s, over 30 s at 1.5 s. Expected: 5-8 calls, 3-4 s (cache hides repeats) | At risk only past ~1,000 investors or when degraded | Fetch contacts / allotments / receipts in parallel, not in sequence; lower page cap with a "truncated" banner (already modelled). |
| GET `/api/investors/mine`, `/am`, queues `/api/queues/investors` | same pattern: <= 10 contact pages, then allotments by id chunks of 100, farms by chunks (`investors/ir-list.ts:95-135`, `investors/am-service.ts:190`) | cap 30+ calls; expected 4-6 | At risk when degraded | As above; parallelise the independent reads. |
| GET `/api/payments` | receipts <= 5 pages x 2,000 rows, reserved allotments <= 5 pages, then allotment look-ups in IN chunks (`money/register.ts:128-175`) | 10-20 calls with 2,000-row bodies (5 MB response cap each) = 5-10 s expected, 30 s when degraded | At risk | Filter server-side (`kind`, `farm`, `reconciled` exist as parameters; push them into the COQL), cache the totals, page in the client. |
| GET `/api/investors/[id]/allotments`, `/holdings`, `/farms/[id]/allotments` | <= 10 and <= 5 pages of 200 (`investors/allotments.ts:134`, `holdings.ts:116`) | 10 calls = 5 s; 1.5 s degraded = 15 s | Safe | None; keep the caps. |
| GET `/api/numbers/*`, `/api/payouts`, `/api/holds*`, `/api/cases*`, `/api/updates`, `/api/events` | <= 5-10 pages each, several sections per page (`numbers/investors-side.ts:58`, `payouts/queue.ts:23`, `leads/today.ts:18`) | 5-30 calls cold; the five-minute cache serves repeats | At risk cold, only past the page caps | Warm the cached cuts from a scheduled job so a person never pays the cold cost; keep `truncated` flags. |
| GET `/api/teams`, `/api/teams/[id]` | <= 10 user pages, count aggregates in chunks, then a serial `readGrants` per member (`teams/service.ts:75-100`) | with the local grant store it is file reads (fast); with any remote grant store it is one call per member (2,000 max) | Safe today, a trap if grants move | Read all grants in one call when the store changes. |
| POST `/api/documents/upload` | body up to 20 MB (`MAX_UPLOAD_BYTES`), then 1 Zoho call (attachment) or 3 (file + update) | transfer time dominates: 20 MB at 5 Mbit/s up is 32 s before any Zoho call. Platform request-body limit on AppSail UNVERIFIED | **Fails on a slow link** | Lower the UI cap (5 MB covers PDFs and phone photos after resize), compress client-side, or upload straight to Zoho from the browser. |
| POST `/api/documents/sign/send` | reads 2-3, `getRequest`, then Sign create (+ submit for a PDF), update; PDF up to 20 MB (`zoho-sign/send.ts:124-189`, `lib/zoho/sign.ts`) | ~7 calls = 3.5 s; 10 s degraded; plus the upload transfer as above. Sign calls share the retry policy | At risk with a large PDF | Same upload cap; keep the same-key retry (503 + `retry: same-key` already exists). |
| POST `/api/investors/add-paid` | highest-code read, contact insert (+ re-read), allotment insert, receipt insert, up to 3 code-collision retries (`investors/add-paid.ts:364`) | 12-25 calls = 6-12 s; 20-40 s if collisions or degraded | At risk | Keep; add the request deadline from section 2 so a stall returns a clean "not saved, retry with the same key". |
| POST `/api/receipts/[id]/match`, `/receipts`, `/investors/[id]/allot`, `/leads/[id]/cover`, `/farms/[id]/release`, `/holds/[id]/extend` | single-record writes with 5-12 calls each | 3-7 s expected; ~20 s degraded | Safe | The request deadline only. |
| GET `/api/investors/search`, `/api/leads/search` | one COQL per 100 farm ids (`investors/search.ts:178`), one page each | 1-3 calls | Safe | None. |
| POST `/api/webhooks/zoho-sign`, `/investor-app` | re-fetch at source (rule 7), 3-4 calls | ~2 s | Safe | Answer 200 first, finish after, if the sender's own timeout is short. |
| GET/POST `/api/auth/*`, `/api/session`, `/api/errors`, `/api/logs`, `/api/test/*`, remaining GET reads | one to three calls | < 3 s | Safe | None. |

## 4. Work that is not a route and must not run in one (Job Scheduling or a separate function)

| Job | Why it cannot be a request | Where |
|---|---|---|
| Nightly audit export | users directory <= 10 pages, request, then up to 60 polls x 30 s sleep = 30 min, then download and parse | `server/activity/export-job.ts:221`, `nightlyAuditExport` in `activity/runtime.ts` |
| Legacy payment migration | up to 10,000 rows, written investor by investor with a re-read after each | `server/money/migrate-legacy.ts:132-291` |
| Lapse release, cover-window share, sign check | background by design (service credentials) | `access/lapse-release.ts`, `lib/zoho/cover-window-share.ts`, `zoho-sign/runtime.ts` |

Catalyst Job Scheduling is the platform feature for these (UNVERIFIED here: not read in this task). Rule 4 and the off-platform heartbeat still apply: a job that stops must be noticed from outside.

## 5. Order of work

1. Request deadline (section 2.1), then statements split, sheet-load concurrency, seat-change concurrency: these three can never fit in 30 s.
2. Shared session store and an off-box sink for logs, grants and the audit archive before any real user touches AppSail.
3. Lower the upload cap, parallelise the list reads, warm the cache from a job.
