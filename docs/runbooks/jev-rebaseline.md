# Jev UI suite: flaky cases, retries, quarantine and re-baselining (M19-S08, D63)

The suite is only worth running if a red case means something. This is how a result that is not clean is handled, the same way every time. Nothing here changes a question, `STEP_MIN` (0.60), `PASS_AT` (0.80) or the verdict logic of `pm/jev-ui-runner.mjs` (D63, D64).

## 1. What the runner does by itself

| Mechanism | What | Knob |
|---|---|---|
| Settle wait | After each step the runner waits until no request is in flight and the page's DOM has not changed for `SETTLE_MS` (default 250 ms), at most `SETTLE_CAP_MS` (default 6000 ms). It replaced a fixed 300 ms wait that lost to sign-in latency on a busy machine (`docs/reports/jev-triage-2026-09-30.md`). A case's own `wait` sets the quiet time. Each trace step records `settled` (ms) and `settle_capped` when the cap was hit | `SETTLE_MS`, `SETTLE_CAP_MS` |
| Retry a REVIEW | `--retry-review` (or `JEV_RETRY_REVIEW=1`) runs a REVIEW case once more. A decisive verdict (PASS or FAIL) is better evidence than a REVIEW; between two REVIEWs, the one with no unsure step and the higher score is kept. The result carries `retried: true` and `first_attempts`. CI passes it; a crash (`runError`) is not retried. Calibration cases are retried like any other and must still end FAIL | `--retry-review` |
| Quarantine | Cases on `jev/quarantine.json` still run and are listed as failing (`QUARANTINED`, with the fix-by date in the workbook's `run_error` column), but do not make `jev-staging-run.mjs` exit non-zero (TC-E16-014). Calibration cases cannot be quarantined | `jev/quarantine.json` |

A REVIEW that stays REVIEW after the retry is not noise to wave through: read its score. A fact scoring 0.79 against `PASS_AT` 0.80 with the fact plainly true on screen is a **borderline** case, see section 3.

## 2. The flake log and when a case is quarantined

After each staging or full local run, from the checkout:

    node jev/flake.mjs record <results.json>     # appends each case's verdict to jev/flake-log.jsonl
    node jev/flake.mjs list                      # the quarantine list; OVERDUE marks a passed fix-by date

A flip is a case changing between PASS and not-PASS on different days (re-runs on one day are one reading). **Two flips inside 7 days** put the case on `jev/quarantine.json` with `since` and `fix_by` (14 days later). Commit the log and the list; the list is a decision, so it carries the reason.

Every Monday: `node jev/flake.mjs list`. For each quarantined case, either fix it (section 3) and `node jev/flake.mjs release TC-…`, or move the fix-by date with a one-line reason in the commit message. A case past its fix-by date is a defect in the suite, not a fact of life. `node jev/flake.mjs check <results.json>` prints what CI will do with a results file (exit 1 only for a non-quarantined case).

## 3. A case is not PASS: which kind is it?

Run it alone three times (`ONLY=TC-… node pm/jev-ui-runner.mjs …`), then against the phase-1 prototype (the D98 authority). Classify as `jev-triage-2026-09-30.md` does:

| Result | Class | Do |
|---|---|---|
| Fails the same way on the app and the prototype | **stale** (the fact is wrong) | Section 4: propose a fact change. Never edit the runner or the threshold to make it pass |
| The app differs from the prototype or the acceptance line | **bug** | Fix the app, in the story that broke it |
| PASS 3 of 3 on a quiet machine, failed once under load | **flaky (latency)** | The settle wait should have absorbed it. If a trace shows `settle_capped`, raise `SETTLE_CAP_MS` for that run and open a defect on whatever never goes quiet (a poll, an animation) |
| Scores straddle 0.80, fact true on screen | **borderline** | Do not lower `PASS_AT`. Reword the fact so it states one thing the screen can show (one fact per line, no negation, no counts of things the page does not print), then section 4 |

Two jumps of more than 0.15 for the same screen are a quarantine candidate even before the 7-day rule fires: record it and let the rule decide.

## 4. Re-baselining after a planned UI change

A UI change re-baselines the cases it affects **in the same story** (M19-S08 AC3), not afterwards:

1. Before building, list the cases that touch the screen: `grep` the story's `ui_cases` and the ids in `pm/plan-merged/ui-cases.json` that name the changed control or text.
2. Build. Run those cases (`ONLY=…`) against the local demo build: `cd console && npm run build:local && PORT=3401 npm run start:local`, runner env `FIXTURES=pm/merge-audit/ui-sahil/fixtures-merged.json SEED_CMD="node autopilot/seed-local.mjs" APP_URL=http://localhost:3401`.
3. For every case that is no longer PASS, decide by section 3. A fact that is now wrong because the screen **intentionally** changed is a FACT CHANGE: propose it with the decision that drives it (the rulings flow, D106; owner approval is recorded in `docs/DECISIONS.md`). Cases are edited only by the person or story that owns `ui-cases.json`; the runner is never edited to fit a case.
4. After a big UI change (more than a screen's worth), re-measure the judge: `node jev/cli.mjs calibrate` writes `jev/calibration/thresholds.json`. `PASS_AT` is a measured number (0 clear false passes in 375 near-miss wrong facts, 14/14 seeded-wrong caught at 0.80); change it only from a new measurement.
5. The calibration cases (`expect_fail`) must still all end FAIL. A calibration case that PASSES makes the run untrusted whatever else is green (D63): stop and fix the judge or the case before reading any other result.
6. Record the run: `node jev/flake.mjs record <results.json>`.

## 5. Quick reference

    # three runs of the flaky set on the demo build, compare scores
    for i in 1 2 3; do APP_URL=http://localhost:3401 FIXTURES=pm/merge-audit/ui-sahil/fixtures-merged.json SEED_CMD="node autopilot/seed-local.mjs" \
      ONLY=TC-E03-007,TC-E03-012,TC-IM03-003 node pm/jev-ui-runner.mjs pm/plan-merged/ui-cases.json http://localhost:3401 /tmp/run-$i.json; done

Jev answers are cached by input (`jev/.cache`, `JEV_CACHE=0` to skip): an identical screen scores identically on a re-run. A re-run therefore tests the screen the runner reached, which is the point for latency flakes; to measure the judge's own noise, run with `JEV_CACHE=0`.

## 6. What the settle wait measured (4 Oct 2026, M19-S08)

The 11-case flaky set plus 3 calibration cases, on the merged demo build, on a machine at load 5 to 17 (other agents' suites), fixed 300 ms wait (before) against the settle wait (after), runs alternated:

| | First 3 runs | 7 runs |
|---|---|---|
| Real cases not PASS, before | 10 of 33 | 22 of 77 |
| Real cases not PASS, after | 9 of 33 | 23 of 77 |
| Latency-class failure (screen read before sign-in/data settled), before | 1 (TC-E12-010, FAIL 0.04) | 1 |
| Latency-class failure, after | 0 | 0 |
| Calibration cases caught | 9/9 before, 9/9 after | 21/21, 21/21 |

Settle took a median of 406 ms a step (p95 980 ms, max 2.1 s, never capped over 450 steps). The remaining not-PASS results are judge borderline, not timing: TC-E03-007 (0.65-0.75), TC-E03-012 (0.79) and TC-IM03-003 (0.79) end REVIEW in every run, before and after; TC-E03-019 and TC-IM01-007 dip to 0.79 once each. Those need reworded facts (section 3), not a longer wait, and `--retry-review` does not move them because an identical screen is judged identically (cache). The settle wait removes the timing flake; it does not change the judge.
