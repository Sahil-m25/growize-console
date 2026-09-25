# Stage 5 · Migration, the last checks, and go-live · Week 13 · 30 Nov – 06 Dec 2026 · **heaviest week**

**22 Sep 2026.** This sheet predates D45 (zero copy); what production consists of, and therefore what week 13 migrates into, has changed. **D46** states the rule; this sheet has not been reworked against it.

**23 Sep 2026 — and it is now one Enterprise org (D52).** Production is one Enterprise org (D51) holding leads and investors both, so week 13 migrates the existing investors into the org the lead team is already working in, not into a separate Investor org — and the executed rollback must remove exactly the migrated records while live leads sit beside them in the same org. The handover as code, the cross-org seam and week 5's handover work no longer exist; production's accounts are a full Enterprise seat for every human (D53) and background-only service identities, none of them an administrator. The full rewrite of this sheet is tracked as **A-04** in `docs/CARRY-FORWARD.md` and has not been done; until it lands, read D52 and D53 alongside D45 and D46 before any task here.

Read `docs/stages/README.md` first. Then this. Then only what this names.

## What the stage delivers

One week. *Rehearsed twice, run once, with a rollback that has been executed.* From the plan:
*every historic investor present with the right money and units, and not one message fired at them.*
Then **Demo three — the whole thing, on real data**, *with the rollback run in front of you so the
decision to go is reversible.*

This stage builds no pages. It builds production, moves the existing investors into it, proves the
move can be undone, lets the seven people who will live with it accept it, runs the seventeen-case
smoke pack against production, and switches every webhook and canary on — each fired once on
purpose.

**Stage 5 is signed when:** X-01 to X-03 and N-01 to N-04 are green; the seven acceptance days are
done by the seven people; the seventeen-case smoke pack passes against production; the rollback has
been **executed**, not described; and **Q20 is in hand**. Then the run.

**The date that does not move, in the other direction:** *the securities-law opinion on what a unit
is — it gates go-live, not the build. Nothing scales before it.* If Q20 is not in hand on Monday,
this week rehearses and does not run, and the run date is set the day the opinion arrives.

**Decisions this stage stands on:** D13, D14 (*a separate AWS account, S3 with Object Lock, a KMS
key* — the backup target and the drill), D19, D20 (*seats are bought per org at the cheapest
edition that carries the features that org actually uses* — go-live is when they are bought), D22,
D24; Q20, Q28 (the payroll headcount — Zoho One or not, §25).
**Build Book:** §17 (the phases — phase 6 is the proof); §22; §24; §25; Appendix A **PL**
(*platform, keys and backups*, 15 modes), **OA**, **LT** (*legal and timing*, 5); Appendix B
segment N; `ops/drills/`, `ops/backup/`, every runbook.
**Test Book:** X-01 to X-03, N-01 to N-04; the **seven acceptance scripts**, one per role, run by
the people who will live with it; the **seventeen-case smoke pack**: L0-01, L0-04, L1-01, L3-01,
L4-02, L5-01, L6-01, L6-03, M0-01, M2-01, M2-02, M2-05, M3-02, M4-01, M5-03, A-01, S-01 — against
production, before anyone else touches it.

| Case | Proves |
|---|---|
| X-01 | The migration creates every existing investor and fires nothing at them |
| X-02 | The rollback was demonstrated, not described |
| X-03 | Go-live day has a checklist somebody who did not build it can follow |
| N-01 | The secrets scan is clean and no debug route survives |
| N-02 | The DPDP evidence pack exists before go-live, not after a complaint |
| N-03 | Statement day does not exhaust the budget |
| N-04 | The chaos drill is run by the people who will be on call |

**The jobs this week:**

| Job | Way | Fires when | Writes | How we know it ran |
|---|---|---|---|---|
| Migration assertions | job | during the cutover | counts, sums, and that nothing fired | **the run is the evidence for go-live** |
| Every webhook and canary, in production | — | switched on, each fired once on purpose | — | the sixteen, each seen once |

## Real data

This is the first week real investor data is handled. Every session that touches it is **plain** —
no headroom, ever, on anything derived from it (README). No fixture, test, seed or log is derived
from it. The copy used for rehearsal is deleted after each rehearsal and the deletion is recorded.
The migration source — the existing portal's investor records — is read once per rehearsal, by the
migration job, and by nothing else. An agent that finds a real PAN in its context stops and says
so.

## Before any code — production's accounts

| # | What | Who | Landed |
|---|---|---|---|
| Q20 | The securities-law opinion, in hand | counsel, Sahil | |
| D-1 (prod) | Both Zoho orgs in production, **built from the same export the sandbox was built from** (`zoho/` — every change was an export, so this is a promotion, not a rebuild); **real seats** bought at D20's editions, per org, informed by Q28; **real integration users**, one per org, their own seats | Sahil | |
| D-2, D-3 (prod) | Production OAuth clients per app per org; the integration users' tokens; all in the vault | builder | |
| D-4 (prod) | The two Supabase projects promoted from branches (Appendix C) — every migration applied, `get_advisors` clean | builder | |
| D-5 | **The separate AWS account, the S3 bucket with Object Lock on, the KMS key** — before the first rehearsal, because the rehearsal takes the first backup (D14) | Sahil, Pradeep | |
| D-6 (prod) | eMudhra production credentials and template ids | Sahil | |
| D-7 (prod) | The heartbeat monitor pointed at production's jobs; two phones; the on-call named | builder | |
| D-9 | The sending domain with SPF, DKIM and DMARC set — *otherwise every welcome mail lands in spam and the mail canary fires forever* | Pradeep | |
| D-11, D-12 | Production secrets in the vault; the repo's `main` protected; the tester a reader | Sahil | |

## The order

```
13.1 production built (evidence) ──► 13.2 rehearsal 1 ──► 13.3 the rollback, executed ──► 13.4 rehearsal 2
                                                                                          ──► 13.5 the last checks: N-01…N-04 (evidence)
                                                                                          ──► 13.6 the seven acceptance days
                                                                                          ──► 13.7 the run: cutover, assertions, smoke pack, switch-on
```

Monday: 13.1, 13.2. Tuesday: 13.3, 13.4. Wednesday: 13.5. Thursday, Friday: 13.6 — and Saturday and
Sunday, because seven days of acceptance do not fit in two. **The run is the following Monday at
the earliest**, and only when every line of the gate is met. The plan calls this the heaviest week;
it is also the only one whose Friday is not the end.

### 13.1 · Production, built — evidence

**Owner:** builder. **Agents:** **planner** ×1; **reviewer**.

**Read:** Appendix C (*environments and change: Supabase branches for schema; the Zoho sandbox for
rules; every change a migration or an export in the repo, never a dashboard edit*), D20, D14,
`ops/backup/`.

**Do:** promote — never rebuild. Both Zoho orgs from `zoho/`'s exports (modules, fields, layouts,
blueprints, validation rules, workflows, approvals, field-level security, encryption — the screens
that have no API are the person's list in Appendix C; do them, then export again and diff: zero).
Both Supabase projects from `db-*/migrations`. Every function deployed. Every secret from the vault
by name. The backup job pointed at the Object Lock bucket; the first backup taken now, empty, to
prove the path.

**Done when:** a re-export of each production org diffs empty against `zoho/`. `RAN`. Each project's
migration list equals the repo's. `RAN`. `get_advisors` clean on both. `RAN`. A backup object exists
in the bucket with Object Lock set. `SAW`.

### 13.2 · Rehearsal 1 — evidence

**Owner:** builder, with Sahil watching. **Agents:** **planner** ×1 — the cutover script, step by
step, with the assertion after each step and the rollback point before each; **reviewer** of the
script before it runs.

**Read:** X-01, X-03; Appendix A **PL**, **LT**; the plan: *the existing investors created in the
Investor org with every rule suspended, then the assertions: counts, sums, one login per investor,
no mail, no holds, no checks, no notifications.*

**Do:**
- **Every rule suspended**: the blueprints, the workflows, the approvals, the canaries, the mail, the
  push — off, by a switch the script throws and the assertions confirm, before one record moves.
  *Not one message fired at them.*
- **The migration**: the existing investors created in the Investor org — Contacts with ARLs,
  their units, their money as ledger rows already confirmed (they paid before this system existed;
  the statement that proves it is the historic one), their documents attached, KYC as the historic
  state, the KAM named by tier — and mirrored; **one login per investor** on the app.
- **The assertions job** runs after: counts (investors, units, documents) equal the source; sums
  (money by investor, total) equal the source; one login per investor; **no mail sent, no hold
  opened, no check (KYC, FEMA) started, no notification fired**; every invariant of 11.5 clean.
  Each assertion names the records, never a count alone.
- **The checklist** (X-03): the script, printed, with a box per step — written so that *somebody who
  did not build it can follow it*; the tester reads it cold before rehearsal 2 and marks what they
  could not follow.

**Done when:** X-01 on rehearsal 1: every investor present, sums equal, nothing fired — the
assertions' report. `SAW`. The checklist exists and the tester's cold read is recorded. `SAW`.

### 13.3 · The rollback, executed — evidence · **seam**

**Owner:** builder, with the tester. **Agents:** **adversary** ×1 — *it drives the rollback and then
tries to find any trace the migration left: a Contact, a mirror row, a login, a backup object, a
log line, a mail in an outbox.*

**Read:** X-02 (*the rollback was demonstrated, not described*), D14, `ops/drills/`.

**Do:** after rehearsal 1, **roll back** — the script's rollback branch, not a manual undo: the
Investor org's migrated records removed, the mirror restored from the pre-migration point, the app
logins removed — and **prove the pre-state is bit-identical**: the backup taken in 13.1 restored
into a clean project and diffed against the rolled-back one; the Zoho org's record count at the
pre-migration number; the outbox empty of anything the migration produced. The adversary looks for
what was missed.

**Done when:** X-02: the rollback ran; the diff is empty; the adversary found nothing. `SAW`, `RAN`,
`SAW`.

### 13.4 · Rehearsal 2 — evidence

**Owner:** builder; the tester follows the checklist. **Agents:** none new.

**Do:** the script again, from the rolled-back state, **the tester reading the checklist aloud and
the builder doing only what it says** — X-03's real test. The assertions again. The rollback point
taken again but not used. The rehearsal copy of real data deleted, recorded.

**Done when:** X-01 again, identical figures to rehearsal 1. `SAW`. The tester's checklist marks
every step followed, or the steps that needed the builder's memory — those are fixed in the
checklist before the run. `SAW`.

### 13.5 · The last checks — N-01 to N-04 — evidence

**Owner:** builder; N-04 is the on-call people's. **Agents:** **adversary** ×1 for N-01 — *find a
secret in the repo, its history, a build artefact, an environment variable echoed in a log; find a
debug route, a test persona's login, a bypass left from a seam run*; **planner** ×1 for the chaos
drill's script from `ops/drills/`.

**Read:** N-01 to N-04; Appendix A **PL**; §25's API-limits table; D-9; the DPDP evidence pack's
contents from Appendix B segment N.

**Do:**
- **N-01**: a secrets scan over the repo and its full history, clean; every debug route, test-only
  endpoint, seam-run bypass and test persona removed from production — the adversary proves it.
- **N-02**: **the DPDP evidence pack exists before go-live** — consent by purpose with its capture
  time (stage 2's 4.1), the erasure path's proof (11.4's M6-03), the reveal log (7.3), the access
  matrices signed (L8-01, M8-01), the retention rules, the breach runbook — one bundle, produced by
  the same export mechanism as M6-04, behind step-up.
- **N-03**: **statement day does not exhaust the budget** — the week's statement (9.5) run against
  production's credit limits with the historic investors' receipts: Zoho credits remaining above the
  floor, Supabase within its compute; the numbers recorded.
- **N-04**: **the chaos drill run by the people who will be on call** — not the builder: the
  on-call pair walks `ops/drills/`'s chaos script on production-before-cutover (a dead webhook, a
  silent heartbeat, a stuck outbox, a stale mirror), following the runbooks, with the builder
  silent in the room.

**Done when:** N-01's scan output and the adversary's empty report. `RAN`, `SAW`. N-02's pack,
produced in under the runbook's time. `SAW`. N-03's numbers. `RAN`. N-04's drill record, in the
on-call pair's hand. `SAW`.

### 13.6 · The seven acceptance days — the people's

**Owner:** the seven people, one role per day — the Test Book's seven acceptance scripts; the
tester records; the builder fixes only what a script names, on the same day, and re-runs that
script's step. **Agents:** **reviewer** on each day's fix; nothing else.

**Read:** the seven acceptance scripts in the Test Book; §2's roles.

**Do:** each person works their script on production-before-cutover with the test personas, in
their own seat, on their own machine. What they cannot do, or do wrong, is a finding — a script
step, a case id, a decision. A finding that names a decision is a register item (D16) and is not
fixed this week. A finding that names a defect is fixed and its step re-run before the day ends.

**Done when:** seven scripts, each signed by its person. `SAW`.

### 13.7 · The run — cutover, assertions, smoke pack, switch-on — evidence

**Owner:** builder, Sahil, the tester, the on-call pair — in the room. **Agents:** **verifier** on
the gate below, before the first step; **adversary** ×1 after the smoke pack — the last one, on
production, every persona, every door.

**Read:** everything above; X-01, X-03; the checklist; the plan: *the seven acceptance days, one per
role, then the seventeen-case smoke pack against production before anyone else touches it; every
webhook and canary switched on in production, and each fired once on purpose.*

**Do, in this order, from the checklist, the tester reading:**
1. The gate below: every line met. The verifier's report in hand.
2. The pre-cutover backup to the Object Lock bucket; its restore proved (the drill).
3. The migration, every rule suspended; the assertions; *nothing fired*.
4. **The seventeen-case smoke pack against production**, with the test personas, before anyone
   else touches it — every one green, or the rollback runs and the day ends.
5. **Every webhook and canary switched on** — the sixteen jobs of the plan, in production, **each
   fired once on purpose** and seen once: the heartbeat, the outbox alarm, the reconciles, the
   pollers, the signatures, the mail events, the app requests, the farm updates, the statement
   match, the migration assertions; the eleven canaries to two phones.
6. The historic investors' app logins enabled — and **not one message fired at them** until Sahil
   says the first update goes.
7. Seats confirmed per person (D24: every write identity holds one); the integration users' tokens
   rotated to their production values; the test personas removed.
8. **Demo three — the whole thing, on real data, with the rollback run in front of you**: the
   rollback branch executed on a copy of production taken at step 2, live, so the decision to go is
   reversible — then the decision.
9. `SESSIONS.md`: the line that says the system is live, what was migrated, and who was in the
   room.

**Done when:** every step's box ticked by the tester; the smoke pack's seventeen green on
production; the sixteen jobs' first firings seen; Demo three done; the decision recorded. `SAW`.

## The gate — before the run, not after

1. Stage 4 signed.
2. **Q20 in hand.** If not, the gate is OPEN and the week rehearses only.
3. Every row of *production's accounts* landed; both orgs re-export to a zero diff against `zoho/`;
   both projects' migrations equal the repo's; `get_advisors` clean.
4. X-01 on both rehearsals with identical figures; nothing fired.
5. X-02: the rollback executed, the diff empty, the adversary's search empty.
6. X-03: the checklist followed cold by the tester in rehearsal 2, and every step that needed the
   builder's memory fixed.
7. N-01 to N-04, each, with the on-call pair's drill record.
8. Seven acceptance scripts signed by seven people.
9. The rehearsal copies of real data deleted, recorded.
10. The seventeen-case smoke pack green against production-before-cutover (it runs again after).
11. Seats bought at D20's editions per org; every write identity holds one; Q28 answered.
12. The eleven standing checks — and for this week, the verifier runs plain.

## Stage 5 · signed when

The run happened once, from the checklist, with the smoke pack green after it, the sixteen jobs
each seen once, Demo three done with the rollback executed live, and the line in `SESSIONS.md`.
The heartbeat has paged nobody since. The first weekly statement (N-03) has been matched in
production. The build is over; the runbooks are the system now.

## If it slips

*A go-live that slips is a go-live that did not happen.* The rehearsals do not slip — they are the
week. The run waits for Q20 and for two clean rehearsals and seven signatures, however long that
is; the date moves in `SESSIONS.md`, in the open, and nothing is cut to meet it. The plan's cut
order lives in `docs/where-it-breaks.html`, for Sahil to invoke — and it does not apply to this
stage: there is nothing in a cutover to cut.
