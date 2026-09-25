# The stage sheets — how an agent works a stage of this build

Five sheets, one per stage of the plan: `STAGE-1.md` foundation (week 1), `STAGE-2.md` the lead
console (weeks 2–6), `STAGE-3.md` the Investor Management portal (weeks 7–11), `STAGE-4.md` the
investor app and the seam (week 12), `STAGE-5.md` migration and go-live (week 13). A sheet is the
whole brief for its stage: what the stage delivers and what *signed* means for it; then, week by
week inside it, what must exist by Friday, in what order it is built, which agents are spawned for
which task and what each hands back, and the gate that decides on Sunday night whether the week is
done. Hand the sheet to a Claude Code session started in this repo and say *this is the stage, this
is the week*. Nothing else needs saying.

This file is the part every sheet has in common. Read it once; the sheets assume it.

## Read order — and stop there

1. `/resume` — reads `CLAUDE.md`, the last ten lines of `docs/SESSIONS.md`, this week's row in the
   plan, and `docs/OPEN-QUESTIONS.md`. It tells you where the build is before you do anything.
2. **This stage's sheet** — the stage head, then the week you are in. Not the other weeks.
3. The decision files the week names, one at a time, from `docs/decisions/`. Not the index; not
   the others.
4. The Build Book sections the week cites. Not the book.
5. The Test Book cases the week cites, by ID. Not the book.

Ask the graph before you open a file: `tools/graphify/graphify-out/graph.json`, through
`graphify query "…"`, `graphify explain "…"`, `graphify affected "…"`. Reading a file is the last
resort, not the first move. The graph updates itself after every code edit (a hook does this — see
`tools/PLUGINS.md`), so it is current; if it ever describes something that is not there, say so and
regenerate before you trust anything else.

## Where the sheets stand among the documents

The plan (`docs/plan.html`) owns the calendar and the week's scope. The Build Book owns the design.
The decisions own the *why*. The Test Book owns what *proved* means — a case is the executable form
of a decision, and where the plan's one-line summary of a weekend and the Test Book's case differ,
**the case wins**; the sheets cite cases by ID for that reason. The sheets own none of those things.
They own the *order*, the *agents*, and the *gate*. When a sheet contradicts one of the documents
above, the sheet is wrong: follow the document, fix the sheet in the same session, one line in
`SESSIONS.md`.

## The shape of a week

The plan fixes this and the sheets do not vary it.

| When | What | The rule |
|---|---|---|
| **Monday, first** | Fix. | The weekend's defects are closed before new work starts. Nothing new is written while a defect from Saturday is open. A weekend that found nothing means Monday is a full building day. |
| **Monday → Friday** | Build. | One week, one scope, fixed on Monday morning. The week's task list is that scope. If it cannot fit, the week's *If it slips* says what moves; nothing else moves. |
| **Friday evening** | Hand over. | The week's pages deployed to the test environment, a one-page note for the tester, the session line in `SESSIONS.md`, the graph re-clustered. The Verifier's gate filled in with evidence. |
| **Saturday, Sunday** | Test. | The tester runs the week's Test Book cases and records results where both of you see them. The builder does not test their own week — the *case* runs are the tester's. |
| **End of a stage** (weeks 6, 11, 13) | Regress, sign, demonstrate. | Every case in the stage is run again on a clean seed, the stage's signing list is met, and the stage is demonstrated before the next one starts. |

The builder is one person. The tester is one person, at weekends. There is no third. Everything
below is about how one builder, working through one Claude Code session, gets the week's scope built
to a standard the tester can break on Saturday — and not before.

## Who does the work: the agents

Six roles. Two are Claude Code built-ins; four are defined in `.claude/agents/` so a sheet can say
*spawn the verifier* and the thing exists. The main session is the **builder** and is never spawned —
it is you.

| Role | Is | Spawned when | How many | Hands back |
|---|---|---|---|---|
| **builder** | the main session | never — it is the session | 1, always | the code |
| **scout** | built-in `Explore` | you need to know where something is or what depends on it, and the graph did not answer | as many as questions; they are cheap; run them in parallel | ≤ 10 lines: paths, graph node names, the one thing you asked. No opinions. |
| **planner** | built-in `Plan` | a task touches more than three files, crosses a seam (Zoho ↔ mirror ↔ portal ↔ app), or the sheet says so | 1 per such task, **before** any code | an ordered step list; for each step the files, and the decision or test case it serves |
| **reviewer** | `.claude/agents/reviewer.md` | at the end of every build day, over everything built that day; and always before the Friday handover | 1 per day (batches the day's tasks) — not 1 per task | findings ranked; each names the decision, rule or case it breaks; a verdict *ship* or *fix* per task |
| **adversary** | `.claude/agents/adversary.md` | only on tasks the sheet marks **seam** — sign-in, identity fields, gates, webhooks, the outbox, money, anything a person could reach that they should not | 1 per seam task, after the reviewer says *ship* | what it tried, in order; what held; what broke, with the exact request or click that broke it |
| **test-writer** | `.claude/agents/test-writer.md` | Friday, after the last reviewer verdict; or mid-week if a task says so | 1 per week | the unit tests the week's Test Book cases imply, named by case ID, run, with the pass count |
| **verifier** | `.claude/agents/verifier.md` | last thing Friday, alone, after everything above | 1 per week | the week's gate, every line answered with a command run or a thing observed — never with *yes* |

Numbers are ceilings, not targets. A week that needs fewer is a better week. A *heaviest week* (the
plan marks five: 5, 9, 10, 11, 13) is not a week with more agents; it is a week where the seams get
their adversary early — Wednesday, not Friday — so the fixes land inside the week.

### How they run together

- **Scouts** run in parallel with anything. Spawn three at once if you have three questions.
- **One builder.** Never two sessions writing this repo at once. Not two windows, not a subagent
  editing while you edit. One fact, one writer — the rule the system is built on applies to the people
  building it.
- The **reviewer** for Monday's work can run while you build Tuesday's. Don't wait for it; read it
  when it lands, and fix before you move to the next task.
- The **adversary** waits for the reviewer's *ship*. Attacking code that is still being fixed wastes
  the attack.
- The **test-writer** waits for every reviewer verdict of the week.
- The **verifier** runs alone, last. Nothing is being edited while it verifies. If it finds a gap you
  fix the gap, then run the verifier again — from the top, not from the gap.

### What every agent is told

Each agent's definition already carries the repo rules. What you add when you spawn one is only:
the task (copy the sheet's task block verbatim), the decision and case IDs from that block, and for
the reviewer and adversary, the list of files changed (`git diff --name-only` since the day started).
Do not paraphrase the task. Do not summarise the decision — name it and let the agent read it.

An agent that comes back with *looks good* has not done the job. Every role above hands back a
specific shape; if it is not that shape, spawn it again with the shape quoted.

## The ladder, on every task

Before writing anything, in this order (this is ponytail's ladder, repeated here so it applies
even when the plugin is not loaded — Build Book §25):

1. Does it need to exist? — the week says what exists by Friday; if it is not on the sheet it does not.
2. Is it already here? — ask the graph.
3. Is it in the standard library?
4. Is it a platform feature? — Zoho does validation, blueprints, field security, approvals,
   workflow, mail (D05, D13, D17, §20). Supabase does RLS, policies, pg_cron with pg_net (Q26).
   Do not rebuild what a platform already enforces; **enforce it there** and read the result here.
5. Is it in a dependency we already have?
6. Is it one line?
7. Only then: the minimum that passes the case.

## headroom — on, and off

`headroom wrap claude` compresses tool output before it reaches the model and makes a session go
further. Use it for **building days**: exploring code, writing pages, reading the graph.

Start plain `claude`, never wrapped, for:

- **Monday fix-first** — you are reading the tester's results and the daily diagnostic's report.
  Both are evidence. A dropped line is exactly the thing they exist to show you.
- any task the sheet marks **evidence** — money records, the ledger, the statement match, the
  audit log, the activity log, the reconcile's report, the register.
- the **verifier**'s run — it is checking evidence too.

Every task is marked *build* or *evidence*. When in doubt, plain. (§25: *compression is for
exploring code; it is never for reading evidence.*)

## Monday: fix first

1. Read the tester's weekend results (plain session).
2. `/diagnose` — the daily diagnostic, **read only**. It explains; a person decides. You do not
   implement a fix the diagnostic suggests unless Sahil, in this session, says *fix that one* — by
   finding id. (`CLAUDE.md`; §24; the `/diagnose` command says the same.)
3. For each tester defect: find the case it failed, find the decision that case defends, fix the code
   to match the decision — never the decision to match the code. If the code and the decision file
   disagree, the document is right and the code is a defect; say so.
4. Run the failed cases again. Green, or the day is not over.
5. Only then open the week's task list.

## Friday: hand over

In this order, so that each step's output feeds the next.

1. **Last reviewer verdict** in. Every task *ship*. No task on the sheet is *fix*.
2. **Adversary reports** in for every seam task. Nothing it broke is still broken.
3. **Test-writer**: the week's unit tests exist, are named by case ID, and pass. Record the count.
4. **Graph**: `graphify update tools/graphify --no-cluster` then `graphify cluster-only
   tools/graphify` — the hook keeps the graph current through the week but does not re-cluster;
   Friday does. The regenerated `GRAPH_REPORT.md` is part of the handover. (`/save` step 2 does the
   same; it was corrected on 9 Sep to pass `--code-only`, since the repo's 79 documents are
   deliberately not sent to an LLM for extraction.)
5. **Deploy** the week's pages to the test environment. A page that is on the sheet and not deployed
   is not done.
6. **The handover note** — one page, to the tester, in this shape:

   ```
   Week N · <dates> · <the week's title from the sheet>
   NEW this week: <the pages, one line each — what works inside it>
   LOOK AT: <the three things most likely to be wrong, and why>
   CASES: <Test Book IDs for this week — the sheet lists them>
   SEED: <which seed / personas TD-xx the cases need>
   KNOWN: <anything the builder already knows is short — say it, do not let the tester find it>
   ```

7. **`SESSIONS.md`**: one line — date · what changed · which decision or test case it serves.
   `/save` does this. A week with no line did not happen.
8. **The verifier**, alone, last. It fills the gate. If a line has no evidence the week is not done;
   fix, then re-run the verifier from the top.

## The gate

Every week ends with a gate: the list of things that are true on Friday night if the week is done.
The verifier answers each line with **one of three things** — the command it ran and what it
printed, the file or record it looked at and what it saw, or *NOT MET* with the reason. Never
*yes*, never *done*, never *should be*.

A gate with any *NOT MET* is an open week. It does not roll into Monday as debt; Monday's fix-first
is for the tester's findings, not the builder's leftovers. Either it is met by Friday night, or the
*If it slips* section of the week is invoked and the slip is written into `SESSIONS.md` in the
open — what moved, to where, and why.

## The stage gate

A stage ends the way the plan says: *every case in the stage is run again on a clean seed, and the
stage is demonstrated before the next one starts.* Each stage sheet carries its own **signing
list** — the plan's sentence for *stage N signed* broken into lines the verifier can answer — and a
demonstration. The next stage does not start with debt from this one. A stage that is not signed
on its Sunday is delayed, not slipped: the new date goes in `SESSIONS.md` and every later week's
dates move with it. Nothing is cut to make the date; the plan's own cut order lives in
`docs/where-it-breaks.html`, and only Sahil invokes it.

## What never happens, in any week

From `CLAUDE.md` and §25. Repeated because the agents are the ones most likely to do these by
accident.

- No real investor data, no real PAN, no real bank account, no real signature, in any test, seed or
  fixture. Ten personas, TD-01 to TD-10, exist for this.
- No identity field written into the Supabase mirror. The mapper is an allow-list; a new field is
  added to the list on purpose, by name, or it does not cross.
- No schema change outside `db-*/migrations`. No Zoho change without its export under `zoho/`. No
  event emitted that is not already a schema in `contracts/`.
- No session acts as the integration user to do a human's work.
- No decision re-derived from the code.
- No fix taken from the diagnostic without being asked.
- No second writer.

## When the plan changes

The plan is `docs/plan.html` and `docs/plan.xlsx`, and `docs/where-it-breaks.html` is *the only
page with dates on it: when a week moves, this is what changes.* If a week moves, the sheet's dates
move with it and the sheet says so at the top of that week. The sheets do not carry a second copy of
the schedule; they carry the scope, the order and the gate, and point at the plan for the calendar.
