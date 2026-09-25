# D65 — Three weeks for the IR console, then two for the IM portal, built by a hands-off autopilot

**Date:** 24 Sep 2026 · **Decided by:** owner

**Owner's answers:**
- IR console in 3 weeks, then the IM portal.
- Run it both ways: Claude Code on the PC, and Cowork.
- Fully hands-off.

**Files:**
- `autopilot/` — README, AUTOPILOT.md, PROMPT.md, run.ps1, run.sh, next.mjs, done.mjs, test-story.mjs, make-queue.mjs, seed-local.mjs, lib.mjs, the ir/ and im/ queues, PEOPLE-CALENDAR.md
- `pm/build_plan.py`, `pm/plan_config.py`, `pm/pm_blocks.py`
- `pm/IR-Console-Delivery-Plan.xlsx`, `pm/IM-Portal-Delivery-Plan.xlsx`
- `pm/tests/` — ir-console-plan.json, im-portal-plan.json, the ui-cases, fixtures, results, gaps and calibration files for each product
- `.claude/settings.json` (unattended allow-list), `.claude/commands/autopilot.md`

## Timeline
**IR console:**
- **Build days:** D1 Mon 28 Sep – D15 Fri 16 Oct.
- **Test weekends:** T1 3–4 Oct, T2 10–11 Oct, T3 17–18 Oct.
- **Live:** Mon 19 Oct.
- **Stage windows** (they overlap; the loop pulls whatever is ready):
  - S0 D1–D3
  - S1 D2–D5
  - S2 D5–D10
  - S3 D9–D12
  - S4 D11–D13
  - S5 D13–go-live
- **The Jev harness comes first:** the test foundations (E16-S01 to S06) are on D2–D4.

**IM portal:**
- **Build days:** D16 Mon 19 Oct – D25 Fri 30 Oct.
- **Test weekends:** T4 24–25 Oct, T5 31 Oct–1 Nov.
- **Live:** Mon 2 Nov.
- **Stages:** P1 D16–D18, P2 D17–D23, P3 D22–go-live.
- **Zoho admin prep:** 23 of Sahil's portal tasks (about 51 h) move into the quiet days of the IR build, D4–D12.

## Scope
- **IR console:** 89 of 104 stories are in the plan: the Must stories, plus the Should stories the owner asked for by name.
  - Kept Should stories: call times, notes, calendar sync, "your move", the assignments drill-down, transfers by month, smoke tests, flaky-test handling, runbook, exploratory testing.
  - 14 stories go to Backlog (later).
  - E15-S07 is dropped: the prototype's dead code does not travel into the build.
- **IM portal:** a new plan of 12 epics, 74 stories, 268 subtasks and 210 test cases, written by three agents from the prototype, D48, the seams file and the contracts.
  - 56 stories are in the plan: the Must stories and the ones they depend on. 18 Should stories are after go-live.

## Who does what
Every subtask has a doer.
- **Autopilot:** code.
- **Autopilot (Jev):** running tests, per D64.
- **Sahil:** Zoho admin screens, purchases, go-live.
- **Tester:** weekend review. Each weekend is 8 h: review REVIEW rows, run manual and staging cases, confirm calibration, plus exploratory sessions.
- **Business users:** UAT on D14 (IR) and D24–D25 (IM).

## How it runs
**One command:** `autopilot\run.ps1` on Windows, or `bash autopilot/run.sh`. It loops rounds until the IR queue is done, then carries on into the IM queue.

**Each round** is a fresh `claude -p` session and does one story:
1. `next.mjs` picks the next story in code, not by model judgement: a fix first, then a regression if one is due, then the earliest ready story, Must first.
2. People's subtasks, and any open decision the story touches, go to `BLOCKED.md` (decisions are marked PROVISIONAL, with the default that was built).
3. It builds the story and runs the unit tests.
4. It starts the app and runs the story's Jev UI cases plus its epic's calibration cases. It fixes and reruns, up to 3 attempts.
5. It commits on branch `autopilot/<queue>`, records the result with `done.mjs`, and rebuilds the workbook.

**Regression:** a full regression runs after every 6 finished stories. A story that broke goes back to the front of the queue.

**Hands-off:**
- It never waits. When only people's items are left, it re-checks every 30 minutes.
- When the owner ticks an item in `BLOCKED.md` (`- [x]`), a story that was waiting becomes done.
- If a calibration case passes, the loop writes STOP.

**It never:**
- edits a test's expected facts (it may only propose a change in BLOCKED.md)
- pushes, or deploys to production
- deletes Zoho data
- prints the key

**Test setup, before and after the sandbox:**
- **Before the Zoho sandbox exists**, the app runs in `FIXTURE_MODE=local` (E16-S03-T03, new). It serves the prototype's demo data through the same client, shows a dev sign-in list with the prototype's names, and has a test-only fixture endpoint. So the same plain-language cases run.
- **Later:** a sandbox seeder (`SEED_CMD`) and saved sessions per seat (`SESSIONS_DIR`) replace the sign-in steps.

**Why Claude Code and not Cowork for the build:** the build needs the local toolchain (npm, Playwright, the dev server, git). The desktop link's shell has no package network, so Cowork cannot run the build.
- Cowork gets a **daily check** instead: a scheduled task at 20:00 IST that reads progress, logs and BLOCKED.md, rebuilds the workbooks, and reports:
  - what moved
  - what Sahil owes tomorrow
  - whether the loop stalled
  - whether calibration held
- It needs "Require this computer" turned on in the desktop app to reach the folder.

## Workbooks
`pm/build_plan.py` builds both workbooks from `pm/plan_config.py` and overlays the autopilot's progress and the latest Jev results each time it runs.
- **Sheets:** Read me (how to run next time), Dashboard, Product brief, Ways of working, Stages, Days (hours by slot and doer), Epics, Stories (with an Autopilot column), Subtasks (Doer, Slot), Test cases (UI steps, screen facts, Jev result, tester result, effective Result), Test strategy, Jev calibration, Fixtures, Defects, Decisions & gaps, Risks, Dependencies, Change log, Budget, Backlog, Traceability.
- **Formulas:** IR 3,471, IM 2,647, 0 errors. The workbooks recalculate when Excel opens them.

## Jev on the prototypes, 24 Sep, runner widened
- **IR console:** 189 PASS, 16 REVIEW, 6 FAIL. 5 are the known real gaps; one (TC-E06-013) was a fact about layout that the wider rows changed. It was reworded to demand the same thing and now passes. Calibration caught 16 of 16.
- **IM portal:** 129 PASS, 3 REVIEW, 36 FAIL. The failures are real prototype gaps: native alert and confirm, no save queue or freshness, no second person matching money, recording refused against D21, oversell, no reversals, and others. Calibration caught 12 of 12. Near-miss false passes were 0 of 366 at ≥ 0.80.
- **Runner changes** from the agents' feedback:
  - collapsible sections
  - the sign-in screen and top-bar text
  - labels for boxes instead of their values
  - disabled and locked controls, with the reason
  - phone, mail and WhatsApp links blocked
  - a fixed clock
  - fixtures applied after sign-in
  - leaving a field after typing, except in search boxes
  - rows and panels with their own buttons
  - dropdowns shown with their current value
  - longer page text
  - `SEED_CMD` and `SESSIONS_DIR` for the built app

## Honest limits
- **Autopilot hours** are the effort a person would need: about 425 h for the IR console and 475 h for the portal. The three-week IR date holds only if the loop runs most of each day and small stories keep passing. The Should stories that were kept are the first to slip.
- **Sahil's own hours** peak at 11–12 h on D1 and D14 (IR) and 11 h on D21 (IM). The Days sheet shows these in red.
- **Open owner decisions:** IR 22, IM 20. The loop builds recommended defaults and flags each one as PROVISIONAL.
- **Before the first run:**
  - commit the current uncommitted work (about 30 changed and 86 new files)
  - rotate the TypeSafe key
  - install Playwright Chromium on the PC
