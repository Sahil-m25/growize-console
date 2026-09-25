# D53 — Every human holds a full Enterprise seat; the cache is keyed by who may see it, not by the query

_23 Sep 2026 · the owner's call · closes B-11 · corrects D45's shared-cache row and D46's "load-bearing" framing · shrinks A-15 · every judgment put to Jev (`jev-1.13.0`) first_

## What was decided

Every member of staff — IRs, the manager, Finance, and D24's read-only viewers (founder, tech,
marketing, BU owner, operations) — holds a **full Enterprise seat** and reads and writes with their
own per-user token. Not Lite users; full seats. **B-11 is closed** that way.

## What it fixes

**Every human read is scoped and attributed by Zoho itself** (Jev 0.85). Viewers no longer read
through a service token, so Private default sharing, the role hierarchy and field-level security
apply to them natively, and every read carries their own name. D5's count of rules enforced outside
Zoho falls to **one**: the identity reveal, which can never move, because Zoho does not see reads.

**Service tokens shrink to background work only** (Jev 0.93): scheduled jobs (the audit-log archive,
the cover-window share and unshare at window boundaries, nightly invariant checks) and inbound
provider callbacks (eMudhra, mail events). Each runs on a profile with identity fields hidden, and
**no service token ever serves a screen.**

## What it breaks — the cache as designed would leak

D45 specified a server-side cache for Numbers and Plan aggregates and badge counts, **"shared across
the team"**, and D46 called it load-bearing because it collapses many users' calls into one. Under
per-user tokens and Private sharing, the same COQL aggregate returns **different results for
different people** — an IR's funnel counts their own leads, the manager's counts the team. A cache
keyed only by query would serve the manager's team-wide numbers to an IR who may see only their own
book. Jev **0.93** that it leaks. That is exactly D52's "shared server cache keyed wrongly" leak path,
found in the design before any code was written.

**The cache is keyed by visibility scope** (Jev 0.99, confidence 0.98):

| Data | Key | Shared between |
|---|---|---|
| A user's own book, their own counts and badges | the user | nobody |
| Team views (a manager's subtree) | the manager's subtree | only users with the identical subtree |
| Org-wide Numbers and Plan, visible only to the named seats | the role | holders of that role |
| Anything the user just wrote | not cached | — (optimistic update, then Zoho's answer) |

Computing aggregates once with an all-seeing service token and partitioning them per requester scored
**0.01** — it preserves the one-call collapse by putting a token that sees everything behind a screen,
which is the leak path under a different name.

## What stays true, and what must now be measured

The TypeSafe-pass guards on the cache stand unchanged: a hard **5-minute TTL ceiling**; an explicit
**stale or error state** when a live fetch fails and the entry has expired — never a silent serve of
old data; the cache private to the request path, never read by an export or report as ground truth;
aggregates and counts only, never a per-record payload.

**What is now uncertain is concurrency.** With cross-user sharing mostly gone, is the team still
inside Enterprise's limits (20 concurrent, 10 on COQL, `sort_by` and bulk)? Jev **0.67** — likely,
not settled. The per-session book cache, a client-side concurrency gate (about 8 complex calls and 12
overall in flight), and scope keys shared among same-scope users probably hold at 5–15 people, but
"probably" is what load tests are for. **T10 is widened** to measure it before go-live.

_23 Sep 2026 — **D54:** the org has one licence. The wall is built first, then one seat for the restricted test user and T11, then the team's seats role by role._
