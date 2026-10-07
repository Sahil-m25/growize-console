# Shared state — what the console keeps in process memory, and what must move (4 Oct 2026)

Hosting is undecided (D47, AP4). The lead candidate, Zoho Catalyst AppSail, runs **up to 5 instances**, recycles
each one **about 5 minutes after it starts**, gives each its own **ephemeral disk**, and cuts a request at **30 s**
(Catalyst docs, checked 4 Oct). The console was written for one long-lived process. This page lists every piece of
mutable server state in `console/src` that lives across requests, says which of it must be shared, and describes
the `SharedState` interface that the first items (limits, step-up, webhook claims, user sessions) now use.

Nothing here is a store of records. Rule 1 and D45 still hold: Zoho is the only store of facts. What is listed
below is counters, claims, short-lived windows and queues. Rule 7 applies to it: keys and values carry ids and
hashes only. The catalyst adapter also hashes every key before it leaves the process.

## The interface — `console/src/server/state/`

| File | What it is |
|---|---|
| `shared-state.ts` | `SharedState`: `claim(key, ttl?) → boolean` (set-if-absent), `release(key)`, `get(key)`, `set(key, value, ttl?)`, `incr(key, ttl?) → n` (fixed window), `take(key, capacity, perMinute) → waitMs` (token bucket). Methods reject with `SharedStateError` when the backend can't answer, and never report "absent" to cover a failure. |
| `memory.ts` | The default. One `Map`, atomic inside the process, bounded (expired entries swept; entries with no expiry, i.e. locks, are never evicted). This is exactly the behaviour the console had before. |
| `catalyst.ts` | Catalyst NoSQL over REST using `fetch` (no new dependency). Used only when `STATE_STORE=catalyst`. Wire shapes VERIFIED against the official SDK zcatalyst-sdk-node 3.4.0 (6 Oct 2026): insert/update/delete bodies are arrays, update/delete `keys` is one object, reads are `POST /item/fetch` (`data.get[].item`), writes answer `data.create/update/delete[]` with a per-item `status`. The partition-key attribute name is `CATALYST_STATE_PK` (default `k`). The parts marked UNVERIFIED are listed below. |
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
| Money Idempotency-Key guards (mark-paid, add-paid, record-receipt) | refuses "busy" / "in-progress", writes nothing | A money write never runs without its guard. |
| Payout schedule job | skips the allotment as "busy" | Nothing is written; the next run fills it. |
| Grant store (`shared`) | rejects → the door refuses a granted-only seat; a grant change answers an error | Fail closed. |
| Seen-ids / request index | rejects → the webhook answers 5xx / retryable | The sender redelivers. |
| Push outbox queue | the event stays in this process and the write is retried on the next drain; `push-failed` alert `queue-unavailable` | A queued push is not dropped while the instance lives. |
| Job endpoints | 503 `state-unavailable`, nothing runs | The next scheduled call runs it. |

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
| 6 | **User sessions** (sid hash → who, seat, sealed refresh token, createdAt, expiresAt) | server/oauth/session-store.ts (wired in oauth/runtime.ts) | S | **moved** (4 Oct, M18-S09-NOTE-1): `sess\|<sha256(sid)>` = the whole record AES-256-GCM sealed with `SESSION_ENC_KEY`, bound to its key, TTL = the rest of the 12 h + 10 min grace (so the first late read still ends it: "expired" note, refresh token revoked, Plane C); `sess-n\|<who>` (`incr`) + `sess-ix\|<who>\|<n>` slots give `keysOf` (newest 64). A record that will not open = signed out, and released. Sign-out / change of person delete it and first tell `session-end.ts` listeners (receipt-replay `discardSession`). `SESSION_ENC_KEY` is required with `STATE_STORE=catalyst` (start refused) | Was: everyone signed out on every instance hop and every ~5-min recycle |
| 7 | Live user access tokens + one-refresh-at-a-time map | server/oauth/user-session.ts | L | unchanged | Re-minted per instance from the stored session. Watch Zoho's per-refresh-token mint limit (spike item 9) |
| 8 | Webhook "seen" event ids (Sign webhook, Sign embed, inbound) | contracts/inbound.ts `createSeenEvents` / `createSharedSeenEvents` | S | **moved** with `STATE_STORE=catalyst`: `seen\|<receiver>\|<id>`, TTL 14 d (`get`/`set`); file/memory otherwise as before | — |
| 9 | Request index (app_request_id → Case) | server/contracts/requests.ts `createSharedRequestIndex` | S | **moved** with `STATE_STORE=catalyst`: `req\|<app_request_id>` → `caseId\|contactId`, no expiry | — |
| 10 | Push outbox queue + dead-letter shelf | server/contracts/outbox.ts + outbox-queue.ts | S | **moved** with `STATE_STORE=catalyst`: queue in SharedState, one claim per delivery attempt, drained by `POST /api/jobs/outbox-drain`; the push ledger → log sink plane `push` | — |
| 11 | Sign dead-letter list | server/zoho-sign/runtime.ts | S | **moved** to the log sink plane `sign-dead` (day file with `LOG_STORE=jsonl`, Stratus with `LOG_SINK=stratus`); memory only when there is no durable sink | — |
| 12 | Grant store (`GRANT_STORE=memory\|jsonl\|shared`) | server/access/grants.ts `createSharedGrantStore` | S | **moved**: `shared` (default with `STATE_STORE=catalyst`) is a SharedState list of grant lines | — |
| 13 | Idempotency replay maps: record-receipt, add-paid, mark-paid (money) — and receipt-replay, Sign send, document upload, payment claim, lead email (others) | money/record-receipt.ts, investors/add-paid.ts, payouts/mark-paid.ts (+ the others) | S (money) / L (others) | **money moved** to `state/idempotent.ts` (claim + stored answer, TTL 10 min); mark-paid's per-payout lock is a claim too. receipt-replay.ts (owned by r6-money) and the L-class maps are unchanged | The others: a double press on two instances is joined only per instance. Receipts are still protected at Zoho once `Idempotency_Key` is unique |
| 14 | Payout schedule job `running` set | server/payouts/schedule.ts | S | **moved**: `claim(payout-run\|<allotment>, 300 s)`, released when the run ends | — |
| 15 | Alert engine windows, last-fired, fired-day, history; credit samples | server/ops/alerts.ts, ops/runtime.ts | S (degrades) | not moved | Thresholds count per instance (alerts fire late or never); "once a day" alerts fire once per instance |
| 16 | Alert outbox mailer (held alerts until mail is configured) | server/ops/alerts.ts `createOutboxMailer` | L today | not moved | Held alerts are lost on recycle. Matters once mail is wired |
| 17 | Test-link register | server/investors/test-link.ts | S (small) | not moved | A link issued on one instance is unknown on another |
| 18 | Background timers: Sign re-check every 10 min (`ensureSignCheck`), outbox drain | zoho-sign/runtime.ts, contracts/runtime.ts | S (scheduling) | **moved**: `POST /api/jobs/sign-recheck` and `/api/jobs/outbox-drain` (JOB_SECRET, platform cron, catalyst/README.md), each run `claim(job\|<name>)`; the Sign timer stays only with `SIGN_CHECK_TIMER=on` (default on a single-process store) and claims too | — |
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
3. **The error code and HTTP status of a failed condition** on insert and on update (expected 400 + a code). Put the real one in `CONDITION_FAILED_CODES` and remove the regex fallback. The adapter already treats a per-item non-success entry on a conditional write (HTTP 200) AND an HTTP 4xx `error_code` as "condition false"; the exact text/status of either is still UNVERIFIED (spike records it).
4. **Exact REST shapes: VERIFIED from the SDK (zcatalyst-sdk-node 3.4.0, `lib/no-sql/table.js`, `types.d.ts`).** Insert `POST /item` body `[{item, condition?, return?}]`; update `PUT /item` body `[{keys:{pk:{S}}, update_attributes:[{operation_type, attribute_path:[name], update_value?|update_function?}], condition?}]`; delete `DELETE /item` body `[{keys:{pk:{S}}}]`; fetch `POST /item/fetch` body `{keys:[{pk:{S}}], consistent_read:true}`; response `{status, data:{get|create|update|delete:[{status,item,old_item}]}}`. Still to confirm live (the spike): that the real table accepts them, and the partition-key attribute name (the owner's first spike got `INVALID_KEY: Mandatory Key K is missing` → `CATALYST_STATE_PK`). (`SHAPES`.)
5. **Conditional update on `ver equals n`** is atomic (compare-and-set). Run 20 concurrent increments and expect a final count of 20. Also check whether update on a missing item answers 404 or creates the item. (`updateIf`, `mutate`.)
6. **The `add` update function** atomically increments a number and can return the new value (`return: NEW` over REST?). If so, `incr` becomes one call instead of two.
7. **TTL attribute:** the column must be set at table creation; check it accepts epoch seconds in an N attribute, and that the 24-hour scheduler deletes items. Expiry correctness does not depend on it.
8. **Latency per call from AppSail** (same DC): p50/p95 for query, conditional insert and conditional update. Budget: a rate-limited request does 2 `take` calls = 4 HTTP calls, so p95 under ~50 ms per call keeps it under ~200 ms. If it is slower, switch the limiter to one `incr` per request (fixed window, documented behaviour change) or limit only per IP+session.
9. **Auth from AppSail:** can the app get a Catalyst token from the platform (environment or SDK credentials) instead of a refresh token in a secret? Which exact scopes do query (`ZohoCatalyst.nosql.POST`?) and delete (the docs say `item.INSERT`) need? What is Zoho's limit on access tokens minted per refresh token per period, given 5 instances recycling every ~5 minutes? This affects this adapter and every service token (inventory 7, 19).
10. **The India DC API host:** `https://api.catalyst.zoho.in` works (auth succeeded). Whether the `CATALYST-ORG` / `Environment` headers are needed for a Development vs Production project is still open.
11. **Errors under load:** what Catalyst answers when throttled (429? with what body?) and any per-project request quota. The adapter treats 429 and 5xx as `unavailable`.
12. **Item size and key length:** the 43-character hashed `k` and values up to 4 KB must fit (the documented item limit is 400 KB).
13. **Data Store `IsUnique` alternative:** what a duplicate insert answers (undocumented). Only needed if NoSQL fails item 1.
14. **Does `instrumentation.ts` `register()` throwing stop `next start` on AppSail?** It should refuse to serve. If not, `sharedState()` still throws on first use, so every rate-limited route returns 500. That is closed, but noisy.

## Round 6 — the rest of the per-instance state (M18-S09-NOTE-2, 4 Oct 2026)

**One switch.** `STATE_STORE=catalyst` moves every item below at once (`instanceStateShared()` in `state/runtime.ts`);
unset, each item keeps the exact behaviour it had (memory, or day files under `LOG_DIR` / `GRANT_DIR`). There is no
per-item switch to forget on a multi-instance host, except `GRANT_STORE`, which keeps its explicit values.

**Per item, and why that store.**

| Item | Store | Why this one |
|---|---|---|
| Webhook seen-ids (Sign webhook, Sign embed, inbound) | SharedState `get`/`set`, TTL 14 d | Small keyed state, read on every callback; the in-flight `claim` already guards concurrency, so a plain mark is enough. The log sink cannot answer "seen?" without reading days back |
| Request index | SharedState `get`/`set`, no TTL | Keyed lookup by app_request_id; ids only. Kept forever like the file index (each entry ~60 bytes) |
| Grant store | SharedState **list** (`state/shared-log.ts`) | Append-only lines that every door must see within seconds and that must replay in full on a fresh instance. Stratus fits "append-only" but buffers 30 s per instance and lists objects on each read — wrong for authority. Lines carry their slot; the highest slot per person+page wins, so the list needs no order |
| Sign dead-letters | **log sink**, plane `sign-dead` | Diagnostic, append-only, read only by Digital Infrastructure's list. Exactly what the sink is for; a 30 s flush delay is harmless. Stratus reads merge every instance's segments |
| Push ledger | **log sink**, plane `push` | Same: append-only delivery lines (ids, status, codes) read for the 14-day history |
| Push outbox queue | SharedState (`contracts/outbox-queue.ts`) | Mutable per-event state plus a claim per attempt; needs set-if-absent, which the sink does not have |
| Money Idempotency-Key guards | SharedState `claim` + stored answer (`state/idempotent.ts`) | The claim is the only cross-instance mutual exclusion we have |
| Payout run set, job runs | SharedState `claim` | Same |

**Building blocks (all on the existing five SharedState calls, no new dependency).**

- `state/shared-log.ts` — a list without scan: `incr` hands out a slot, `set` writes it. Readers return what they
  find in any order, keep missing slots as holes, re-read them and give one up after 10 minutes (a writer that
  crashed between `incr` and `set`). Cost: one `get` of the counter per poll plus one per new slot (25 in parallel).
- `state/idempotent.ts` — `once(scope, fingerprint, work)`: join a press running in this process; else replay a
  stored answer (fingerprint must match, else `reused`); else `claim`; the winner stores the fingerprint hash, runs,
  keeps the answer for the TTL (or releases the claim when the answer is retryable); a loser polls for the answer
  up to 20 s, then answers busy. A store failure answers `unavailable` and the money route refuses ("busy") — a
  money write never runs unguarded. Stored answers carry no reference: record-receipt blanks `ref`, mark-paid blanks
  `utrMasked`; both are re-filled from the replayed press, whose fingerprint (hashed) matched.
- `contracts/outbox-queue.ts` — keys and the delivery rule are in its header. The outbox keeps its synchronous
  in-process view (`state`, `forRecord`, `stats` answer from it; `sync()` refreshes from the queue; the deliveries
  routes sync at most every 5 s). `drain()` first picks up what other instances listed, then for each due event
  claims `ob|send|<id>` (120 s), re-reads the shared state, sends only if still due, and stores the new state before
  releasing. A push.delivered on an instance that never saw the event sets `ob|done|<id>`, which every reader
  applies over a stale "retrying".
- `jobs/claim.ts` — `claimJob(state, name, run)` and the endpoint door: `JOB_SECRET` (≥ 32 chars) in `X-Job-Secret`,
  compared with `timingSafeEqual` over sha256 digests. Routes `POST /api/jobs/sign-recheck`, `/api/jobs/outbox-drain`
  (guard rule `open`; not rate-limited; no Origin header from a scheduler, so the Origin check passes).

**Rule 7 on these values.** Keys are ids, hashes and codes (the catalyst adapter hashes every key again). The one
value that carries text is a queued push event (a reply, an update body): it passed the outbox's identity guard and
schema check, and is deleted on delivery or after 14 days (**PROVISIONAL**: owner to confirm a Catalyst NoSQL row may
hold an investor-facing message until delivered; the alternative is to re-build the event at drain time from Zoho).
Grant lines, seen-ids, the request index and idempotency answers are ids and codes only.

**Known limits (documented, not fixed here).**

- Grant changes reach other instances within `GRANT_REFRESH_MS` (2 s); each guarded request on a shared store costs
  at most one Catalyst `get` per 2 s per instance for the refresh. A fresh instance replays every grant line (25 reads in
  parallel); past a few thousand lines add a snapshot.
- The outbox low-water mark is a hint: an event replayed by an operator on one instance after others marked it dead
  is drained by that instance (it holds it), not picked up by a fresh one until it is listed again.
- The payout claim store failing skips the allotment as "busy" (nothing written); the System page's outbox stats are
  this instance's view.
- ~~`receipt-replay.ts` keeps its own in-process guards~~ — moved onto SharedState 4 Oct (M18-S09-NOTE-8; see "Round 7" below).
- Catalyst Job Scheduling's expression grammar and minimum interval are UNVERIFIED (catalyst/README.md).

## Round 7 — the last per-process idempotency maps (M18-S09-NOTE-8, 4 Oct 2026)

Five more guards moved onto `state/idempotent.ts` exactly as round 6 did for mark-paid, add-paid and record-receipt:
join a press already running in this process, else replay the stored answer (fingerprint must match, else `reused`),
else `claim` (the claim TTL is the guard's TTL); the winner stores the answer, a retryable failure releases the key; a
loser waits up to 20 s, then `busy`; a store that cannot answer is `unavailable` and the write is refused. Each
service takes an optional `state` (runtime passes `sharedState()`; absent, an in-process store, so behaviour on one
instance is what it was).

| Guard | Scope (hashed) | Kept | TTL | Stored answer (rule 7) | Put back on replay | A different press meanwhile |
|---|---|---|---|---|---|---|
| Zoho Sign send (`zoho-sign/send.ts`) | person + Idempotency-Key | success | 30 min | ids, codes, the doer note — no recipient, no file | `duplicate: true` | another key for the same paper+record: `busy` (claim `sign-send-paper\|…`, 120 s) |
| Document upload (`documents/upload.ts`) | person + key + attempt `#n` | success, or an unknown outcome with its before-count | 30 min | ids and codes; **file name blanked** (a name can carry identity) | `fileName` from the replayed press | another key for the same target: `busy` (claim `doc-upload-target\|…`, 300 s) |
| IR payment claim (`leads/claim.ts`) | lead + the report | success | 60 s | the claim view with **`ref` blanked** | `maskRef(ref)` from the replayed press, `duplicate: true` | another report on the lead: `in-progress` (claim `payment-claim-lead\|…`, 120 s) |
| Lead email (`leads/email.ts`) | person + lead + the exact email | a sent email | 60 s | message and touch ids; **`from` blanked** (the sender's mailbox) | `from` stays empty on a replay (nothing in the press names it) | another email to the lead: `sending` (claim `lead-email-lead\|…`, 180 s) |
| Receipt replay (`money/receipt-replay.ts`) | the durable receipt key | success | 11 min | receipt id + `duplicate` | `duplicate: true` | two keys for one allotment take turns across instances: claim `replay-turn\|<allotment>` (poll to the press's own deadline, TTL 5.5 min), inside the existing in-process queue |

**Why these TTLs.** The claim and payment-claim answers are held only for the double-press window: an identical
report or email a minute later is a new one (Finance may have answered the first). Sign and upload keep half an hour
(what the in-process maps held). Receipt replay holds for the signed context's life plus a minute; after that Zoho's
unique `Idempotency_Key` is the guard, as before.

**Document upload keeps its recovery.** An unknown outcome (the answer was lost) is stored with the target's file
count before the press. A retry with the same key, on any instance, counts again: more than before means the first
landed (answered `recovered: true`, nothing uploaded); the same count means it did not, and the press goes again as
attempt `#n+1` (four attempts, then "unknown outcome"). A clean refusal or not-saved is never kept.

**What stays per process, on purpose.** The receipt replay's capacity caps (64 presses, 16 per person, 8 queued per
allotment) and its session-abort registry (`discardSession`) are about this process's own work: a running press
cannot be aborted from another instance, and a cap is a resource limit, not a correctness rule. The press registers
its abort control before its first await, so a sign-out that lands while it is still claiming aborts it.

**Behaviour changes to know.** (1) The same email pressed twice at once now joins (both answered "Email sent", one
mail) instead of the second answering "sending"; a *different* email to that lead is still "sending". (2) A joined or
replayed receipt press is answered `duplicate: true`, as mark-paid already was. (3) On an unavailable store each of
these refuses ("busy" / "sending" / "in progress") rather than running unguarded.

**Tests.** `state/idempotency-sites.test.ts` (Sign, upload incl. lost-answer recovery, claim, email; memory and fake
Catalyst, two instances each; stored values searched for the recipient, name, reference, address and text) and the
`NOTE-8` cases in `money/receipt-replay.test.cjs`.

## Next, in order (not built here)

1. ~~User sessions onto SharedState~~ (inventory 6) — done 4 Oct (M18-S09-NOTE-1, r6-sessions). Catalyst cost: a session read is 1 query; sign-in is 4 calls (set, incr = 2, set); `keysOf` reads up to 65 items (seat change / access ended only).
2. ~~Seen-event ids, request index, grant store, push outbox, money idempotency maps, payout lock, Sign re-check timer~~ — done 4 Oct (M18-S09-NOTE-2, r6-instance-state; see "Round 6" above).
3. **Alert windows** (inventory 15), once mail is wired; the test-link register (17).
4. ~~The L-class idempotency maps (Sign send, document upload, payment claim, lead email) and the `receipt-replay.ts`
   guards onto `state/idempotent.ts`~~ — done 4 Oct (M18-S09-NOTE-8, r7-idempotency; see "Round 7" above).
