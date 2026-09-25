# Growize — agent instructions

> **This is the clean build repo (`growize-console`, started 25 Sep 2026).** It carries only what the
> one-app build needs: `console/` (the Next.js app + the merged prototype), `autopilot/` (console queue),
> `pm/plan-merged/` (plan, gaps, UI cases, Zoho mapping), `contracts/`, `zoho/`, `ops/` and the current `docs/`.
> The older folder `growize/` is the archive (IR/IM plans, old prototypes, merge audits, graphify). Where this
> file points at something not here (graphify, `docs/plan.html`, `portal/`), it lives in the archive.

> Tools: Jev, reticle, graphify, ponytail and chisle are wired at project scope — see `tools/PLUGINS.md`; fresh clones run `scripts/setup.sh` first.


You are working in a monorepo that builds four things over thirteen weeks: the **lead console**,
the **Investor Management portal**, the **investor app**, and (later, out of scope) a master
dashboard. Two hundred investors' money runs through this. Read this file first, every session.

## Where the truth is

| You need | Read |
|---|---|
| Why anything is the way it is | `docs/DECISIONS.md` — the index. Open only the decision you need. |
| What is still undecided | `docs/OPEN-QUESTIONS.md`, and `docs/ready-to-build.html` for who can close each one |
| What is decided and not yet built, what waits on the owner, what is known broken | `docs/CARRY-FORWARD.md` — `/resume` reads it. A decision that creates work and adds no line there has not finished |
| How this repo is organised, and why | Build Book **§23**. The daily diagnostic is **§24**; how you are meant to work is **§25** |
| The full design — data model, write path, rules, money, compliance | `docs/build-book.html` — 25 sections and three appendices (§ numbers are cited everywhere) |
| How a thing is proved | `docs/test-book.html` — 104 cases, each carrying the decision it defends |
| How it fails | `docs/where-it-breaks.html` — 145 modes |
| What is built this week | `docs/plan.html` and `docs/plan.xlsx` |
| Every event that crosses a seam | `contracts/` — 30 schemas. Declare it there **before** you emit it. Under one org most are now same-org field writes; the schema is still the field contract (D52) |
| The shape of the code | `tools/graphify/graphify-out/graph.json` — query this instead of re-reading files. **It holds zero nodes today** (C-01 in `docs/CARRY-FORWARD.md`): a query returns nothing, so open the files until it is rebuilt |
| What to build this week, in what order, with which agents, and the gate that says it is done | `docs/stages/` — the protocol in `README.md`, then the stage sheet, then only the week you are in |

**Never re-derive a decision from the code.** If the code and `docs/DECISIONS.md` disagree, the
document is right and the code is a defect — say so rather than quietly matching the code.

**Most of what the table points at predates 22 September** and describes two orgs and a Supabase
mirror. Where it disagrees with D45 (zero copy), D52 (one Enterprise org) or D53 (every human on
their own seat), the decision is right and the rewrite is owed — A-04 and A-18 in the carry-forward.

## The nine rules this system is built on

1. **One fact, one writer, and Zoho is the only store.** One Enterprise org holds leads and
   investors (D52); no mirror, no sync job, no second copy of a record (D45). If the same number can
   be changed from two screens, that is a defect even when both agree.
2. **Every human reads and writes as themselves.** Everyone, viewers included, holds a full
   Enterprise seat and calls Zoho on their own token, so Zoho's sharing, roles and field-level
   security scope every screen (D53). Service tokens do background work only and never serve a
   screen; no administrator token is used by the application at all (D52).
3. **Recording money is always allowed; matching is what the rules gate** (D21).
4. **A gate opens on a fact and closes on its reversal.** Three reversal events exist; use them (D19).
5. **One consequence, one actor.** Never two things that both send the acknowledgement (D19).
6. **A system touch is never a human touch.** Automated mail never counts as a conversation.
7. **Identity is walled by field-level security, and by our own guards around it.** PAN and bank
   are hidden from every IR and service profile; new Contact fields are created hidden. D52's guards
   keep identity out of logs (a callback is re-fetched, its payload never logged), out of the cache,
   and out of any export not run on the requester's own token; a reveal is a second, logged call
   behind step-up (D13, D22).
8. **The cache is keyed by who may see it, and it is never a copy.** Per user, per manager subtree
   or per role — the same aggregate differs by who asks (D53). Counts and aggregates only, a
   five-minute ceiling, and a failed fetch past expiry says so rather than serving old data (D45).
9. **Every clock is computed in Asia/Kolkata from the event**, by one function.

Until 23 Sep, rule 8 was *every webhook has something behind it that does not depend on it*, and the
stage sheets and D32 still cite it by number. What survives: a callback is a hint re-fetched at
source (rule 7), the bank statement stands behind every receipt, and an off-platform heartbeat behind
every scheduled job. The nightly reconcile it named went with the mirror.

## How to work here

- **Write the least code that works.** Check in order: does it need to exist; is it already here;
  is it in the standard library; is it a platform feature; is it in a dependency we already have;
  is it one line. Only then write something. (This is the ponytail ladder — see `tools/PLUGINS.md`.)
- **No database of ours holds records.** `db-*` are the Supabase projects D45 abolished; build
  nothing there. Planes B and C's store is open (D47) — once chosen, its changes are migrations.
- **Every Zoho change is an export committed under `zoho/`.** Never a console-only change.
- **Every event is a schema in `contracts/`,** versioned, validated at both ends.
- Ask for the graph before reading files: `tools/graphify/graphify-out/graph.json`. **Empty today
  (C-01)** — read the files, and never take an empty answer as evidence the code is not there.
- When you finish something, append one line to `docs/SESSIONS.md`: date, what changed, which
  decision or test case it serves.

## What you must never do

- Never implement a fix from the daily diagnostic without being asked. The diagnostic explains;
  a person decides. See `ops/diagnose/README.md`.
- Never put real investor data, a real PAN, a real bank account or a real signature into a test.
- Never let an identity field reach a log, the cache or an export — there is no mirror to leak
  into; these are where the leaks live now (D52).
- Never act as the integration user to do a human's work.

## The autopilot (D65)

When started by `autopilot/run.*` or `/autopilot`, follow `autopilot/AUTOPILOT.md`: one story per round, test it with Jev (`autopilot/test-story.mjs`), record with `autopilot/done.mjs`. People's work goes to `autopilot/<queue>/BLOCKED.md`; never wait for it.
