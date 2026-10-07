# Log sink for Planes B and C — design, chain format, retention, spike checklist

Status: **PROVISIONAL** — written 4 Oct 2026 while D47's store question (and AP4, the hosting account) is open.
The code supports both the file sink and Catalyst Stratus; nothing here chooses the host.

Code: `console/src/server/logs/` — `sink.ts` (interface + file adapter), `stratus.ts` (Stratus adapter and audit
archive), `chain.ts` (Plane C hash chain), `factory.ts` (selection), `runtime.ts` (`auditChain().verify(day)`).
Offline check: `console/scripts/verify-audit-chain.mjs`. Tests: `console/src/server/logs/sink.test.cjs`.

## Why

Planes B (operational/security log) and C (identity and authority log) were append-only JSONL day files under
`LOG_DIR`. Zoho Catalyst AppSail gives each instance an ephemeral disk, so on AppSail those files die with the
instance. DPDP Rules 2025 require logs kept at least one year. Catalyst Stratus (India buckets, `*.zohostratus.in`)
is durable and documents versioning, but no object lock, retention or WORM — so tamper evidence has to come from us.

## Selection (fails closed)

| Env | Store |
|---|---|
| fixture mode | memory, always |
| `LOG_SINK` unset or `file` | today's behaviour: `LOG_STORE=memory` (default) or `jsonl` + `LOG_DIR` |
| `LOG_SINK=stratus` | Stratus. `LOG_STORE` must be unset |
| anything else | start-up throws |

`LOG_SINK=stratus` needs `STRATUS_BUCKET_URL` (`https://<bucket>[-development].zohostratus.in`), `GZ_STATE_PROJECT_ID`,
`STRATUS_CLIENT_ID`, `STRATUS_CLIENT_SECRET`, `STRATUS_REFRESH_TOKEN`; optional `GZ_STRATUS_API_DOMAIN` (default and
only allowed value `https://api.catalyst.zoho.in`), `STRATUS_ACCOUNTS_ORIGIN` (`https://accounts.zoho.in`),
`LOG_INSTANCE_ID`, `LOG_FLUSH_LINES` (10–5000, default 500), `LOG_FLUSH_SECONDS` (5–300, default 30). A missing or
malformed variable stops start-up with an error that names the variables and never a value. Non-India buckets are refused.

With `LOG_SINK=stratus` the audit archive (Plane A's nightly export, `server/activity`) is also written to the bucket
(`growize-audit/`), and `AUDIT_ARCHIVE_DIR` is ignored.

## Rule 7 stays in front of every sink

Producers rebuild each line from an allow-list (`lib/zoho/log.ts`, `identity/plane-c.ts`); the factory then runs
`guardRecord` (`logs/guard.ts`) on every record before the in-memory ring and before any adapter. The chain fields
are added after the guard (they are our own hex). Test: *rule 7: the Stratus adapter receives scrubbed lines only*.

## The Stratus layout

```
growize-logs/<plane>/<day>/<instance>/<seq>.jsonl           segment: lines one instance buffered (plane = ops | identity | errors)
growize-logs/<plane>/<day>/<instance>/<seq>.manifest.json   { v:1, plane, day, instance, seq, lines, sha256, first, last, prevLast, at }
growize-audit/<day>-<random>.jsonl                          one archived day (Plane A)
growize-audit/<day>.seal.json                               { day, file, rows, sha256, at }
```

- `append` never waits on the network. A segment is cut at `LOG_FLUSH_LINES` lines or every `LOG_FLUSH_SECONDS`,
  and on `flush()`. The segment is uploaded first, then its manifest. A failed upload keeps the lines buffered and the
  next flush retries in order; past 20,000 buffered lines `append` throws, which the log writer reports
  (`onSinkError`) without failing the request. A failed upload raises the `backup-failed` alert.
- Keys are fresh (instance id + sequence), so nothing is ever rewritten; no `overwrite` header is sent.
- Reading a day lists `growize-logs/<plane>/<day>/`, fetches each manifest and segment, and leaves out a segment
  whose bytes no longer match its manifest's sha256. Verified segments are cached by key + version id. An instance's
  own unflushed lines are included in its reads.
- **Loss window:** a crash loses at most the last `LOG_FLUSH_SECONDS` of that instance's lines. A SIGTERM handler is
  not installed (it would change the platform's shutdown); `beforeExit` flushes best-effort. The spike decides
  whether AppSail gives a shutdown hook worth using.

## Plane C hash chain

Every stored Plane C line carries:

| field | meaning |
|---|---|
| `ch` | chain id = the writing instance (`LOG_INSTANCE_ID`, or `i-<12 hex>` / `p-<12 hex>` for the file sink) |
| `n` | position in the chain, from 0, restarted each UTC day |
| `prev` | previous line's `h`; for `n = 0`, `sha256("growize-plane-c\n" + ch + "\n" + day)` |
| `h` | `sha256(canonical(line without h))` — canonical = JSON with keys sorted at every level |

One chain per instance per day; segments cut it into pieces. Each manifest carries the segment's `first` and `last`
`h` and the previous segment's `last` (`prevLast`), so segments of one instance are linked. Instances are independent
chains; the day's set of chains is summarised by the **anchor** = `sha256` of the sorted `ch:lastN:lastH` lines.

`verifyChain` (and `auditChain().verify(day[, anchor])`, `verify-audit-chain.mjs`) reports:

| problem | caught by |
|---|---|
| `edited` | `h` does not recompute |
| `deleted` | a gap in `n` that no later line fills |
| `reordered` | an `n` found out of place |
| `broken-link` | `n` in order and `h` valid, but `prev` is not the previous `h` (a line rewritten with a fresh hash) |
| `unchained` | a line with no chain fields (inserted by hand) |
| `segment-edited` | segment bytes ≠ manifest sha256 (the lines are also left out of reads) |
| `segment-missing` | a gap in a chain's segment `seq` |
| `unsealed` | a segment without a manifest (a crash between the two uploads, or a deleted manifest) |
| `manifest-mismatch` | line count, first/last or `prevLast` disagree with the segment |
| `anchor-mismatch` | the day's heads differ from the anchor kept for it |

**What the chain cannot show by itself:** an attacker who can write the bucket can delete the *tail* of a chain or a
*whole* chain, or recompute every hash after an edit. That is why the anchor exists: for each closed day, keep the
anchor outside the bucket's trust domain and pass it back. A keyed HMAC (secret outside the bucket) would also stop
a full recompute; it is not built — say so if wanted.

The System page gets an **Audit trail chain** card when the composer passes `auditChain` facts
(`server/system/checks.ts`): working = intact, down = broken (names the kinds), attention = memory only. No
`/api/system` route exists yet; the route owner calls `auditChain().verify(yesterday)` and passes the result.

## Retention

- **At least one year** for Planes B and C (DPDP Rules 2025) and the audit archive. Nothing in the application
  deletes an object; there is no delete call in `stratus.ts`.
- **Stratus versioning ON** for the bucket: an overwrite or delete then leaves the earlier version, which is what
  makes `segment-edited` / `segment-missing` recoverable rather than just detected.
- No lifecycle rule shorter than 400 days. C-07 still applies: a line that leaked identity must stay erasable, which
  is a reason not to want object lock — the guard is the defence, versioning plus the chain the evidence.

## What the Catalyst spike must verify (all UNVERIFIED today)

1. **Endpoints.** Upload `PUT https://<bucket>.zohostratus.in/<key>` and download `GET` with
   `Authorization: Zoho-oauthtoken`; list `GET https://api.catalyst.zoho.in/baas/v1/project/{id}/bucket/objects?bucket_name&prefix&max_keys&continuation_token`.
   The reference names `/bucket/objects` but its sample URL reads `/buckets/objects` — confirm which.
   Sources: https://docs.catalyst.zoho.com/en/api/code-reference/cloud-scale/stratus/llms-full.md ,
   https://docs.catalyst.zoho.com/en/cloud-scale/help/stratus/llms-full.md ,
   https://docs.catalyst.zoho.com/en/sdk/nodejs/v2/cloud-scale/stratus/upload-object ,
   https://docs.catalyst.zoho.com/en/sdk/nodejs/v2/cloud-scale/stratus/list-objects
2. **Auth.** A Catalyst self-client refresh token with `Stratus.fileop.CREATE` and `ZohoCatalyst.buckets.objects.READ`
   (the scopes the reference lists) works from AppSail; or AppSail injects a credential and the token source can go.
3. **Development buckets.** Whether the list call needs `Environment: Development` (sent today for `-development` URLs).
4. **Write-once.** A PUT without `overwrite` to an existing key on a non-versioned bucket is refused; on a versioned
   bucket it creates a version. Confirm versioning can be switched on for the bucket and cannot be switched off by the
   application's token.
5. **Response shapes.** `data.contents[].key`, `version_id`, `data.truncated`, `data.next_continuation_token`; the
   error body (only the status is read today).
6. **Limits.** Object count per prefix and list latency for a busy day (~2,900 segments a day per plane per instance
   at 30 s if continuously busy); request rate limits; per-object minimum size billing.
7. **Region.** The bucket and project are in the India data centre.
8. **Shutdown.** Whether AppSail sends SIGTERM with a grace period (to flush before exit).
9. **Anchor home.** Where the daily anchor is kept outside the bucket (owner decision).

## Open

- D47 / AP4: host and store choice. This file is the design if Stratus is chosen.
- The register's "Show the reference" screen asks no reason, so its Plane C reveal lines carry `why: "unstated"`
  until the screen sends `{ why }` (POST `/api/receipts/[id]/reveal` accepts it).
