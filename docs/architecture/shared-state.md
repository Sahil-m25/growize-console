# Shared state — what the console keeps in process memory, and what must move (4 Oct 2026)

Hosting is undecided (D47, AP4). The lead candidate, Zoho Catalyst AppSail, runs **up to 5 instances**, recycles
each one **about 5 minutes after it starts**, gives each its own **ephemeral disk**, and cuts a request at **30 s**
(Catalyst docs, checked 4 Oct). The console was written for one long-lived process. This page lists every piece of
mutable server state in `console/src` that lives across requests, says which of it must be shared, and describes
the `SharedState` interface that the first three items now use.

Nothing here is a store of records. Rule 1 and D45 still hold: Zoho is the only store of facts. What is listed
below is counters, claims, short-lived windows and queues. Rule 7 applies to it: keys and values carry ids and
hashes only. The catalyst adapter also hashes every key before it leaves the process.

## The interface — `console/src/server/state/`

| File | What it is |
|---|---|
| `shared-state.ts` | `SharedState`: `claim(key, ttl?) → boolean` (set-if-absent), `release(key)`, `get(key)`, `set(key, value, ttl?)`, `incr(key, ttl?) → n` (fixed window), `take(key, capacity, perMinute) → waitMs` (token bucket). Methods reject with `SharedStateError` when the backend can't answer, and never report "absent" to cover a failure. |
| `memory.ts` | The default. One `Map`, atomic inside the process, bounded (expired entries swept; entries with no expiry, i.e. locks, are never evicted). This is exactly the behaviour the console had before. |
| `catalyst.ts` | Catalyst NoSQL over REST using `fetch` (no new dependency). Used only when `STATE_STORE=catalyst`. Doc URLs are cited in the header. The parts marked UNVERIFIED are listed below. |
| `runtime.ts` | `sharedState()` builds the process's one store from `STATE_STORE`. An unknown value or a misconfigured catalyst store throws. It **never** falls back to memory. |
| `src/instrumentation.ts` | At server start it runs `startupCheck()`: builds the store and, unless it is memory, does one live claim → second claim refused → release. Any failure stops the start. |
| `fake-catalyst.ts` | Test double: the REST semantics below, conditional writes applied atomically, requests delayed by random hops so concurrent callers interleave. |

**Why `take` and not just `incr`.** The limiter is a token bucket: burst N, refill N per minute, and a Retry-After
equal to when the next token lands. A fixed-window `incr` would allow 2N at a window edge and would change
Retry-After. To keep the behaviour the same, both adapters run the same pure step (`bucketStep`).

**Catalyst semantics (best effort, documented).** `claim` is one conditional insert, "only if no live item"
(`exp <= now`). Catalyst documents that conditions are ignored when no item exists. If the key is held by an
expired claim, the adapter takes it over with a conditional update on `exp <= now`, so it works whether or not a
conditional insert overwrites. `set`, `incr` and `take` read the item, then do a conditional update on `ver`, with
up to 8 rounds and jitter. Updates are never lost, but under contention the call rejects with `contended`. Cost:
`claim` is 1 call; everything else is 2 (read + write). The table needs partition key `k` (String) and TTL
attribute `ttl`. Catalyst's TTL scheduler runs only once every 24 h, so expiry is also enforced on read from our
own `exp`.

**What a caller does when the store fails.**

| Caller | On `SharedStateError` | Why |
|---|---|---|
| Rate limiter (`request-gate.ts`) | lets the request through (**PROVISIONAL**) | The limit is a guard in front of Zoho's own limits. Refusing every sign-in during a store outage is worse. The startup probe catches a misconfigured store, so fail-open covers outages only. Owner may rule otherwise. |
| Zoho Sign webhook | answers `provider-failed`, retryable | Zoho Sign redelivers. |
| Investor-app inbound webhook | throws → 5xx | The app redelivers. |
| Step-up (`step-up.ts`) | rejects → the route fails | Fail closed: no window is opened and no lock is skipped. |

## Inventory — every piece of cross-request mutable server state

Found by `grep` for module-level `let`/`Map`/`Set`, `globalThis.__gz*` singletons and `new Map/Set` inside service
factories under `console/src/server` and `console/src/lib` (server parts). Browser-only state (`features/*` drafts,
`lib/data/api.ts`, `components/shell/Live.tsx`, `lib/save-queue.ts`, `lib/zoho/error-beacon.ts`) is per tab and out
of scope. Immutable lookup tables (`ReadonlySet` constants) are not state.

Classes: **S** = must be shared across instances and survive restarts. **L** = fine to lose on restart / per
instance. **R8** = the rule-8 per-viewer cache (counts and aggregates only, 5-minute ceiling; keep those
semantics — per instance only means more fetches, never staler data).

| # | State | File | Class | Status after this change | Effect on AppSail if left per-process |
|---|---|---|---|---|---|
| 1 | Rate-limit token buckets (`RATE_LIMITS`, per IP+session and per IP) | server/http/request-gate.ts | S | **moved** to `SharedState.take` | Each instance has its own buckets: limits multiplied by up to 5 and reset every ~5 min |
| 2 | Step-up open windows (session × action → until) | server/identity/step-up.ts | S | **moved** (`set`/`get`, TTL 301 s) | A confirmed step-up is "missing" on the next instance, so the person is asked again at random |
| 3 | Step-up failure counts and locks | server/identity/step-up.ts | S | **moved** (`incr`, no expiry; lock = `claim`, no expiry, so it alerts once) | Three failures spread over instances never lock; a lock lifts itself on recycle |
| 4 | Zoho Sign webhook in-flight claim (`inFlight`) | server/zoho-sign/webhook.ts | S | **moved** (`claim`, TTL 120 s, released in `finally`; seen mark re-read after claiming) | Two deliveries on two instances are both processed |
| 5 | Investor-app inbound in-flight claim | server/contracts/inbound.ts | S | **moved** (`claim`, TTL 120 s) | Same, for request.raised / push.delivered |
| 6 | **User sessions** (`createMemorySessionStore`: sid → sealed refresh token, who, seat) | server/oauth/user-session.ts, oauth/runtime.ts | S | **not moved — GAP, blocking for AppSail** | Everyone is signed out on every instance hop and every ~5-min recycle. `SessionStore` is already an interface (get/put/delete/keysOf); a SharedState-backed store needs a per-user key index for `keysOf` |
| 7 | Live user access tokens + one-refresh-at-a-time map | server/oauth/user-session.ts | L | unchanged | Re-minted per instance from the stored session. Watch Zoho's per-refresh-token mint limit (spike item 9) |
| 8 | Webhook "seen" event ids (Sign webhook, Sign embed, inbound) | contracts/inbound.ts `createSeenEvents` + jsonl plane store | S | **not moved — GAP** (writer wired through the Plane store, owned by another agent) | On ephemeral disk, dedupe is forgotten on recycle and differs per instance. Next step: a `SeenEvents` on `claim(key, 14 d)` |
| 9 | Request index (app_request_id → Case) | server/contracts/requests.ts | S | not moved — GAP (same jsonl pattern) | A replayed request.raised may open a second Case |
| 10 | Push outbox queue + dead-letter shelf | server/contracts/outbox.ts | S | not moved — GAP | Queued pushes to the investor app are lost when the instance recycles |
| 11 | Sign dead-letter list | server/zoho-sign/runtime.ts | S | not moved (jsonl; Plane-store owned) | Dead letters are lost per instance |
| 12 | Grant store (`GRANT_STORE=memory\|jsonl`) | server/access/grants.ts | S | not moved — GAP | Grants given on one instance are invisible on others and lost on recycle (jsonl is on ephemeral disk) |
| 13 | Idempotency replay maps (`held`/`inFlight`/`replays`): record-receipt, receipt-replay, add-paid, mark-paid, Sign send, document upload, payment claim, lead email | money/*, investors/add-paid.ts, payouts/mark-paid.ts, zoho-sign/send.ts, documents/upload.ts, leads/claim.ts, leads/email.ts | S (money) / L (others) | not moved | A double-press reaching two instances writes twice. Receipts are protected at Zoho once the unique `Idempotency_Key` field exists (receipt-replay.ts header). Mark-paid and add-paid rely on these maps only. Candidate for `claim(idempotencyKey, 30 min)` |
| 14 | Payout schedule job `running` set | server/payouts/schedule.ts | S | not moved | Two instances can run the same schedule at once. Candidate for `claim` |
| 15 | Alert engine windows, last-fired, fired-day, history; credit samples | server/ops/alerts.ts, ops/runtime.ts | S (degrades) | not moved | Thresholds count per instance (alerts fire late or never); "once a day" alerts fire once per instance |
| 16 | Alert outbox mailer (held alerts until mail is configured) | server/ops/alerts.ts `createOutboxMailer` | L today | not moved | Held alerts are lost on recycle. Matters once mail is wired |
| 17 | Test-link register | server/investors/test-link.ts | S (small) | not moved | A link issued on one instance is unknown on another |
| 18 | Background timers: Sign re-check every 10 min (`ensureSignCheck`), outbox drain | zoho-sign/runtime.ts, ops/runtime.ts | S (scheduling) | not moved — GAP | 5 instances run 5 timers. An instance that lives ~5 min never reaches a 10-min tick. Needs a platform cron (Catalyst Job Scheduling) plus a `claim` per run |
| 19 | Service-token caches (provider-callback, kam-pool-return) | zoho-sign/runtime.ts, access/runtime.ts | L | unchanged | Re-minted per instance (spike item 9) |
| 20 | Scoped aggregate cache + in-flight coalescing | lib/zoho/cache.ts, lib/zoho/coalesce.ts (via data/zoho-source.ts, teams/runtime.ts) | R8 | unchanged — keep per instance | More Zoho reads, never staler data. Do **not** share: rule 8 keys it per viewer and forbids copies |
| 21 | Last-good-read times (freshness banner) | server/data/freshness.ts, documents/list.ts | R8 | unchanged | A banner may say "could not refresh" on one instance and not on another; still honest |
| 22 | Error-beacon budget (`windowStart`, `used`) | app/api/errors/route.ts | L | unchanged | The budget is per instance (×5). Harmless |
| 23 | Plane B/C sinks, identity log, audit archive | logs/*, identity/authority.ts, activity/* | — | out of scope (another agent owns the log writers) | jsonl on ephemeral disk is lost on recycle; covered by the Plane B/C store decision (D47) |
| 24 | Fixture-mode lanes | lib/fixture-mode.ts | L | unchanged | Development only |
| 25 | Per-request WeakMaps (receipts compose, payouts http) | app/api/receipts/compose.ts, payouts/http.ts | L | unchanged | Keyed by request objects; nothing crosses requests |

## What the Catalyst spike must verify for this adapter

Each item names the line of `catalyst.ts` that changes if the answer differs.

1. **Conditional insert is atomic and "only if absent" works.** Run 50 concurrent `POST …/item` calls with the same `k` and `condition: exp less_than <now>` from two AppSail instances. Exactly one must succeed. (`claim`, `insertIfFree`.)
2. **Insert onto an existing key:** without a condition, does it fail or overwrite? With a condition that holds, does it overwrite or fail? Record the exact `error_code` in each case. (`CONDITION_FAILED_CODES`; claim works either way.)
3. **The error code and HTTP status of a failed condition** on insert and on update (expected 400 + a code). Put the real one in `CONDITION_FAILED_CODES` and remove the regex fallback.
4. **Exact REST shapes:** `keys` for update/delete (the adapter sends `[{ "k": { "S": … } }]`, following the SDK); `update_attributes` entries (`operation_type`, `attribute_path`, `update_value`); `condition` (`attribute` as an array, operator spelled `less_than` / `equals`); `key_condition` for query; where query returns items (`data.fetched_data` as a list or a single object). (`SHAPES`, `itemsOf`.)
5. **Conditional update on `ver equals n`** is atomic (compare-and-set). Run 20 concurrent increments and expect a final count of 20. Also check whether update on a missing item answers 404 or creates the item. (`updateIf`, `mutate`.)
6. **The `add` update function** atomically increments a number and can return the new value (`return: NEW` over REST?). If so, `incr` becomes one call instead of two.
7. **TTL attribute:** the column must be set at table creation; check it accepts epoch seconds in an N attribute, and that the 24-hour scheduler deletes items. Expiry correctness does not depend on it.
8. **Latency per call from AppSail** (same DC): p50/p95 for query, conditional insert and conditional update. Budget: a rate-limited request does 2 `take` calls = 4 HTTP calls, so p95 under ~50 ms per call keeps it under ~200 ms. If it is slower, switch the limiter to one `incr` per request (fixed window, documented behaviour change) or limit only per IP+session.
9. **Auth from AppSail:** can the app get a Catalyst token from the platform (environment or SDK credentials) instead of a refresh token in a secret? Which exact scopes do query (`ZohoCatalyst.nosql.POST`?) and delete (the docs say `item.INSERT`) need? What is Zoho's limit on access tokens minted per refresh token per period, given 5 instances recycling every ~5 minutes? This affects this adapter and every service token (inventory 7, 19).
10. **The India DC API host** (`https://api.catalyst.zoho.in`?) and whether the `CATALYST-ORG` / `Environment` headers are needed for a Development vs Production project.
11. **Errors under load:** what Catalyst answers when throttled (429? with what body?) and any per-project request quota. The adapter treats 429 and 5xx as `unavailable`.
12. **Item size and key length:** the 43-character hashed `k` and values up to 4 KB must fit (the documented item limit is 400 KB).
13. **Data Store `IsUnique` alternative:** what a duplicate insert answers (undocumented). Only needed if NoSQL fails item 1.
14. **Does `instrumentation.ts` `register()` throwing stop `next start` on AppSail?** It should refuse to serve. If not, `sharedState()` still throws on first use, so every rate-limited route returns 500. That is closed, but noisy.

## Next, in order (not built here)

1. **User sessions onto SharedState** (inventory 6). AppSail cannot ship without this.
2. **Seen-event ids and the request index** onto `claim(key, 14 days)` (inventory 8, 9). This touches the Plane-store wiring, so coordinate with the log-writer owner.
3. **Money idempotency maps and the payout job lock** onto `claim` (inventory 13, 14).
4. **Background timers to a platform scheduler** with a per-run `claim` (inventory 18).
5. **Alert windows** (inventory 15), once mail is wired.
