# D45 — Zero copy: the console reads and writes Zoho live; a cache is allowed, a copy is not

_22 Sep 2026 · the tech lead's instruction, confirmed against D3's stated rejection · supersedes D3 and D4; narrows D24's read path; re-scopes five System-page checks_

## What changed

D3 (4 Sep) made Supabase the read model and explicitly **rejected reading Zoho live in the UI** — "the Zoho API is for integration, not screens (20 concurrent, credits, latency)". D4 then built write-through so portal writes never depended on the Zoho→Supabase webhook, which had been dead since 13 Aug with 5,890 staleness alerts. Today the owner chose the opposite, with D3's reasons put in front of him and re-accepted: **the IR console's own screens read from and write to Zoho CRM directly. There is no second store.** The same call was made separately today for the external investor apps (Growize app, ARL investors app → Zoho CRM Portals).

The three reasons D3 gave do not go away because the decision reversed. They change from things the design avoids into things it must **budget for and monitor** — see "What this costs" and the two open questions.

**22 Sep 2026 (TypeSafe pass):** three gaps found and closed — see "TypeSafe pass — 22 Sep 2026" at the end of this file.

**22 Sep 2026 (Q30/Q31 closed — D46):** the cross-org read is **not** available from the console's seat; a token is bound to one org. It survives as a server-side read on a second credential held for an Investor-org identity, which costs a seat D45 assumed it would not. The "conditional on Q30" flags below therefore come off — the capability stands, its shape and price changed. Q31 closes the other way round from the worry: credits have four times the headroom, concurrency is **15** (D3's 20 was the Enterprise figure) with a **sub-concurrency of 10** on exactly the calls Leads and Numbers make — so the server-side shared cache below is load-bearing and belongs in week one. Full record: `D46-q30-q31-answered-and-the-stage-sheets-reconciled.md`.

**22 Sep 2026 (logging — D47):** the new System check below for *API concurrency and credit headroom* cannot be built by querying Zoho — there is no usage endpoint, only a UI dashboard with 30-day retention. It is assembled instead from the console's own call telemetry plus the `X-API-CREDITS-REMAINING` header, which Zoho sends only past 50% of the daily allowance, so its appearance is the warning. D47 also settles where the console's logs live: three planes, two of which hold no record data and were never inside this decision's ban. Full record: `D47-three-log-planes.md`.

## The function and design audit this came from

The owner asked for every function and page to be checked, JTBD-style from the user's seat, for whether it is still needed under zero copy. Findings:

**Page inventory — nothing to cut.** The 14 destinations (Today, Leads, Updates-as-bell, Activity, Teams, Plan, Events, Payments, Documents, Investor copies, Numbers, System, Profile, sign-in) already survived three rounds of this pruning — D30/31, D33/34, D35 — each with the test that no capability leaves with a page. Every remaining page traces to a stated requirement. The leverage is not in the page list; it is in the data layer.

**System-page checks that exist only because a copy sat between console and Zoho — retired:**
- `wb` "Growize → Zoho export" (fail since 13 Aug) — there is no local store to export from.
- `mirror` "The reporting mirror" (fail since 16 Jul) — Numbers and Plan query Zoho, not a nightly copy.
- `leadsdb` "Stand up leads-db and point Numbers at it" — retired *as framed*; replaced by the cache below, which is not a database.

**Checks that re-scope rather than retire:**
- `imlink` (IR console ↔ Investor Management portal) and `transfer` (ARL ID into the Investor org) were designed as one event stream each way because neither side could read the other's org. Under zero copy a live read of the Investor org keyed on ARL ID likely replaces the stream. One-writer-per-fact is unchanged: Finance writes the Investor org only, the IR writes the Leads org only. **Conditional on Q30.**
- `financeMirror()` / `imBanner` — the function is a permission filter, not a data mirror; it stays. Its backing read becomes a live Investor-org query; the "live portal sync is not connected" placeholder copy comes out when that is wired. **Conditional on Q30** — until it closes, the backing stays the current placeholder read, same as `imlink`/`transfer` above.

**Checks whose severity rises:**
- `licence` — a lapse no longer stops syncs; it blanks every screen. Nothing local remains to read.
- `backup` (D14) — Zoho's nightly copy is now the *only* copy of anything the console touches.
- `SAVEQUEUE` / pending saves (D41) — now the only buffer between a click and Zoho. D41 made it session-safe (in memory); a refresh mid-outage loses it. Whether that needs to survive a refresh is a build-time call, flagged here.

**Two checks to add** in place of the three retired: Zoho API concurrency and credit headroom; live-fetch latency and error rate per page.

## What "zero copy" rules out, and what it does not

**Ruled out:** any second persisted store of lead or investor data that screens read from; any sync job, webhook consumer or nightly reconcile whose purpose is to keep such a store current; any write path other than Zoho.

**Allowed — and expected:** a **cache**: ephemeral, short-TTL, read-only, non-authoritative, rebuilt from Zoho rather than synced to it. A cache degrades to "hit Zoho" when cold or expired; a read model drifts until someone notices. That distinction is the whole of why this is not D3 by another name. Rules:

| Data | Where | Freshness rule |
|---|---|---|
| Numbers / Plan aggregates — funnel counts, ageing bands, KPI rollups | server-side (Next.js layer; in-memory or Redis), shared across the team | 30–60 s TTL |
| Badge counts — Updates bell, presence / people count | server-side, shared | 30–60 s TTL |
| A user's own Leads / Today book | per-session, in the browser | fetched on sign-in / tab focus; refreshed on explicit action or after a write — **not** on a clock, because staleness here is visible to the person working the lead; a lead open under an active D44 cover window also checks its Zoho modified-time immediately before this session's write, so a concurrent primary/secondary edit surfaces as a conflict rather than a silent overwrite |
| Anything the user just wrote | none | optimistic local update, then Zoho's answer; never served from cache (D4's read-your-own-writes, kept without the mirror) |
| Cross-org joins (`imlink`, `transfer`) | none | always live; low volume; **conditional on Q30** — until then this stays the one-event-stream-each-way design |

The cache has **no write path** and **no sync job**. The prototype today has no caching machinery at all — it is in-memory mock data — so this is new build, not recovery.

## What this costs

Every screen that renders synchronously from a JS object today will wait on a network call. D27–D34 spent three rounds making the console one screen, dense and instant; that promise now depends on the cache above and on loading states the prototype has never needed. The concurrent-call ceiling and daily credit cap for the Leads org's edition (D20) are unverified — see Q30/Q31 — and decide whether the cache is a nicety or load-bearing.

## TypeSafe pass — 22 Sep 2026

Per the 22 Sep handoff, `/typesafe:typesafe-ai` was run against this decision's text — no prototype or port code touched — attacking three claims adversarially. Findings, folded back into the sections above; this section is the record of what changed and why.

**(a) Cache vs. copy — holds, once two enforcement gaps are closed.** The TTL-and-rebuild-from-source design is a genuine distinction from D3's synced mirror, not a rebrand of it, but the original text didn't say what a screen does on a failed live fetch with an expired cache entry, and didn't bound how far Q31's "TTLs lengthen" escape valve can stretch. Both are exactly the shape of failure that made the old mirror drift silently for weeks (dead webhook, 5,890 staleness alerts nobody looked at). Closed by adding: a failed live fetch with an expired or missing cache entry shows an explicit stale/error state, never a silent serve of old data — "non-authoritative" is enforced by this rule, not by the label alone; the cache is private to the request-serving layer, never a store a report, export or API reads as ground truth; and TTL has a hard ceiling (5 minutes) regardless of Q31 credit pressure — past it the screen fails loud rather than aging quietly into a copy.

**(b) Per-session freshness — failed for the D44 concurrent-viewer case; closed.** The original freshness rule ("refreshed on explicit action or after a write") implicitly assumed one viewer per book. D44 deliberately puts a primary and an actively-covering secondary on the same lead in two sessions at once, and neither session's own-action rule notices a write made by the other — the concrete failure is a double-recorded payment or a stage advance taken against a gate the other side already moved. Closed by adding a modified-time check immediately before any write on a lead open under an active D44 cover window, so a concurrent edit surfaces as a conflict before it is silently overwritten.

**(c) imlink/transfer's Q30 gate — sound as a pattern, inconsistently applied; fixed.** Writing a Q30-conditional direction into the record with a stated fallback matches how every other open question in this build is handled (OPEN-QUESTIONS.md's default-until-closed convention) — that part holds. But only the `imlink`/`transfer` bullet carried the "conditional on Q30" flag; `financeMirror()`'s new backing query and the cache table's cross-org-joins row depend on the identical unanswered capability and carried no such flag, so a reader working from either in isolation could build the live-query path before Q30 closes. Both now read as conditional on Q30 too, with the same fallback: the current placeholder read stays until Q30 answers yes.

Nothing here reopens the zero-copy reversal itself, which was the owner's direct call, not a claim this pass was asked to test.

**Live-verified, same day.** The three propositions above were re-run as actual `noul` calls against the TypeSafe API (model `jev-1.13.0`, SDK `@typesafe-ai/sdk`), not just reasoned through by hand. Each number is Jev's probability that the stated claim holds:
- Cache never becomes a copy (pre-fix text): **0.11** — confirms the gap; low probability the original design text closes every failure mode.
- Own-book freshness safe under D44's concurrent primary/secondary case: **0.16** — confirms the failure; low probability the rule as originally written detects the other session's write.
- Writing a Q30-conditional direction into the record, with a stated fallback, as sound practice: **0.75** — confirms this part holds; matches this build's own open-question convention.
- The "conditional on Q30" flag applied consistently across every Q30-dependent claim (pre-fix text): **0.12** — confirms the inconsistency between the `imlink`/`transfer` bullet and the unflagged `financeMirror()` bullet.

All four numbers point the same direction as the reasoning-only pass above; the three fixes already folded into this file (stale/error state + cache scope + TTL ceiling; the D44 modified-time check; the consistent Q30 flag) are what closes each gap.

## Rejected

Keeping Supabase as the console's read model while moving only the investor apps (the narrower reading of today's instruction) — the owner chose the full reversal explicitly. A "no cache anywhere" reading of zero copy — it would rebuild D3's latency problem from scratch.

**23 Sep 2026 (D53):** The cache table's first row — aggregates and badge counts **shared across the team** — would leak under per-user tokens and Private sharing, because the same aggregate differs by who asks. Every cache entry is keyed by visibility scope: per user, per manager subtree, or per role. The TTL ceiling, stale/error state, request-path privacy and aggregates-only rules stand. Full record: `D53-every-human-on-an-enterprise-seat-and-the-cache-keyed-by-scope.md`.
