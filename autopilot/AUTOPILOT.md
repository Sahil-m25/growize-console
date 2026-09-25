# Autopilot — how one round works

You are the autopilot for the Growize build (D65). You work **one round**: one story, start to finish, then you stop.
The driver (`autopilot/run.ps1` / `run.sh`) starts the next round with a fresh context. Read `CLAUDE.md` first as always;
this file adds the loop. The queue name is given in the prompt as `QUEUE=…`; since D69–D73 (25 Sep) there is one queue, `console`, built from `pm/plan-merged/growize-console-plan.json` (the old `ir`/`im` queues are retired).

## The round

1. **Stop checks.** If `autopilot/STOP` exists, write nothing and stop.
   Run `git -c core.filemode=false status --porcelain` (file-mode-only changes are noise from mounted drives; ignore them).
   If content changes are left from a crashed round, and only in files the previous story would touch (`app`, `zoho/`, `contracts/`, tests), commit them as
   `WIP: recovered by autopilot`. If anything else is modified, leave it alone and do not stage it.
   Make sure you are on branch `autopilot/<QUEUE>`; create it from the current branch if it does not exist.

2. **Get the assignment — from code, not judgement.**
   `node autopilot/next.mjs <QUEUE>` prints one JSON packet:
   - `type: "story"`: the story, its acceptance criteria, its subtasks split by doer, its test cases (UI steps, screen facts, fixtures), the decisions to read and the prototype to follow.
   - `type: "regression"`: re-run the whole suite of done stories. Go to step 7 with `--regression`.
   - `type: "fix"`: a defect or a regression failure. Treat it as the story it names.
   - `type: "none"`: nothing is ready. Stop.
   Record the start with `node autopilot/done.mjs <QUEUE> <STORY> in_progress`.

3. **People's work goes to BLOCKED.md, not into a wait.**
   For every subtask whose `doer` is not `Autopilot` or `Autopilot (Jev)`, run
   `node autopilot/done.mjs <QUEUE> <STORY> --human <SUBTASK_ID>`. It appends the item to `autopilot/<QUEUE>/BLOCKED.md` with the
   subtask's detail. Before that, rewrite the detail into exact steps where you can: which Zoho screen, which field names, which values.
   Take them from `zoho/` or `pm/plan-merged/zoho-field-mapping.json` (and `ZOHO-FIELD-MAPPING.md`).
   Then continue. Never wait for a person.
   If an item in BLOCKED.md is marked `done` by the owner, the subtask is done. `next.mjs` reads that.

4. **Open owner decisions.** The packet lists the ones that touch this story.
   - Build the recommended default: the first option in the item, or the prototype's behaviour when the item names none.
   - Write `PROVISIONAL: <decision> → built as <default>` with `done.mjs --human` so it lands in BLOCKED.md.
   Never invent a new decision number. Decision records are the owner's.

5. **Build.** Follow `CLAUDE.md`'s rules, especially: Zoho is the only store, every human reads and writes as themselves, the cache is keyed by scope, and identity stays out of logs.
   - **Where the work goes:**
     - Code goes in `console/` — one app; the Investors side is part of it (no separate `portal/` app).
     - Every Zoho change is a script plus an export under `zoho/`.
     - Every event is a schema in `contracts/`.
   - **Write the least code that works.**
   - **Unit tests:** add them for every rule you add or change, using `npm test` in the app folder (Vitest; E16-S06 sets it up).
   - **Checks:** `npm run typecheck` and `npm test` must pass.

6. **Start the app.** In the app folder run `npm run dev` in the background, with these settings, and wait for the port to answer:
   - Until the Zoho sandbox seeding exists (E16-S03): `FIXTURE_MODE=local`. The app serves the prototype's demo data through the same Zoho client interface, and shows a dev sign-in list with the prototype's names. For the runner, set `SEED_CMD="node autopilot/seed-local.mjs"` so fixtures are applied through the app's test-only endpoint. Building this mode is E16-S03-T03, day 2.
   - Once the sandbox exists: point the app at the Zoho sandbox, set `SEED_CMD` to the sandbox seeder, and set `SESSIONS_DIR` to the saved test sessions (E16-S02). Saved sessions replace the sign-in steps.

7. **Test with Jev.**
   `node autopilot/test-story.mjs <QUEUE> <STORY>` runs the story's UI cases plus its epic's calibration cases through `pm/jev-ui-runner.mjs` against the app (`APP_URL`, default http://localhost:3001 for `ir`, 3002 for `im`).
   - **Exit 0:** every fact is ≥ 0.80, every step was clear, and every calibration case failed. Go to step 8.
   - **Exit 1:** something failed. Read the result file it names: which step picked which control, which fact failed.
     - Fix the code. You may also reword a *step* when the control is right but its label differs.
     - Re-run. You get 3 attempts in total.
     - After the third, mark the story `review` with the reason.
   - **Exit 3: a calibration case passed.** The judge cannot be trusted. Run `node autopilot/done.mjs <QUEUE> STOP "calibration case passed: <id>"`; this creates `autopilot/STOP`. Then stop the round.
   - **API cases** (`ui_mode: api`) become automated tests in the app's test suite. Run them with `npm test`.
   - **`ui-staging` and `manual` cases** are not yours: `done.mjs` lists them for the tester.
   - **Never change a case's expected facts to make it pass.** If a fact is wrong, write `FACT CHANGE PROPOSED: <case> <old> → <new> <why>` to BLOCKED.md with `--human`, and leave the case failing.

8. **Commit and record.**
   - Stage only the files the story touched. Commit as `<STORY> <title> [autopilot]`, with the attribution lines from `CLAUDE.md` / the session.
   - Record the result: `node autopilot/done.mjs <QUEUE> <STORY> <done|review|waiting> --commit <sha> --note "<one line>"`.
     - `waiting` means your part is done but a person's part (BLOCKED.md) is still open.
     - The same command marks the story's autopilot subtasks done.
   - Append one line to `docs/SESSIONS.md`.
   - (No workbook rebuild for the console queue yet; `node autopilot/status.mjs` is enough.)

9. **Stop the round.** Stop the dev server and end. The driver starts the next round.

## Never
- Never push, deploy to production, or change DNS.
- Never delete Zoho records or fields, or change another person's records.
- Never use real investor data, or print or commit `.typesafe-key` or any token.
- Never act as the integration user to do a human's work.
- Never edit `pm/tests/*` expected facts, `pm/jev-ui-runner.mjs`, or `pm/jev-calibrate.mjs`. Propose changes in BLOCKED.md instead.
- Never work on more than one story in a round.
- Never skip the test step. A story without a Jev run is not done.

## When something outside the code is broken
If npm, the network, Zoho or TypeSafe fails:
- Retry once after 60 seconds.
- If it still fails, record the story as `review` with the error, write the error to BLOCKED.md, and end the round. The driver waits and tries again later.
