# D63 — Plan gaps closed after a Jev review; Jev becomes the main tester, running cases through the UI

**Date:** 24 Sep 2026 · **Amends:** D62 · **Files:** `pm/IR-Console-Delivery-Plan.xlsx` (v2), `pm/jev-ui-runner.mjs`, `pm/jev-calibrate.mjs`, `pm/jev-gaps.mjs`, `pm/tests/ui-cases.json`, `pm/tests/fixtures.json`, `pm/tests/ui-results-2026-09-24.json`, `pm/tests/calibration.json`, `pm/build_xlsx2.py`, `pm/pm_sheets.py`

## Question
The owner, acting as product manager, asked two things:
1. Does the D62 plan cover what a project needs?
2. Are these the right test cases, given that Jev will run them through the browser?

## Jev gap review (`pm/jev-gaps.mjs`)
Jev read the full plan (sheets, epics, stories, subtasks, tests) and scored 34 product-management items and 29 kinds of testing. For each, it gave the probability the item is covered and when it is needed.

**Covered (≥ 0.95):**
- Schedule and milestones
- Estimates
- Stage gates
- Decision log

**Missing, needed before coding:**
- Risk register
- Vendor and external dependencies
- Change control
- Budget
- Definition of Ready and Done
- Test strategy
- Critical path
- RACI
- Communication plan

**Missing, needed before go-live:**
- Support model
- Training
- Product KPIs and their instrumentation

**Testing gaps:**
- **Biggest gap:** 208 of the 247 automated cases arranged or read state through prototype internals, so they could not run on the built app.
- **Also missing:** judge calibration, unit tests, a UI test contract, CI, flaky-test handling, visual/cross-browser checks, exploratory and usability sessions, and smoke tests.

## What changed
### Workbook v2
- **Plan size:** 17 epics, 104 stories, 269 subtasks, 333 test cases.
- **New epics:**
  - **E16 Quality engineering:** UI test contract, runner on staging, sandbox seed and reset, calibration gate, CI, unit tests, permission matrix, flaky-test handling, visual checks, exploratory and usability sessions, converting the remaining cases.
  - **E17 Launch readiness:** product brief and KPIs, KPI instrumentation, training, support, stage reviews and retros, change control.
- **New sheets:** Product brief (KPI targets left for the owner), Ways of working (DoR, DoD, rhythm, severity and triage, RACI, rules for writing UI cases), Test strategy, Jev calibration, Fixtures, Risks, Dependencies, Change log, Budget (unit costs left for the owner), Backlog, Traceability.
- **Load:** Sahil 28–39.5 h/week (W0, W1 and W3 are at 39–39.5 h, logged as a risk). Tester 7.5–21 h per weekend.

### Jev UI runner (`pm/jev-ui-runner.mjs`)
- **Case format:** steps in plain words, facts about the screen, and named fixtures for the starting data. Nothing inside the app is used.
- **How it runs a step:** it lists the controls on screen, including labels, the row each sits in, closed sections and disabled state.
  - If a step names one control by its visible label, code picks it.
  - Otherwise Jev chooses the control.
- **How it judges:** Jev judges each screen fact separately. PASS means every fact is ≥ 0.80 and every step was clear. FAIL means a fact is ≤ 0.10. Anything else is REVIEW, and the tester decides.
- **Fixtures:** run in the prototype now; on staging they will seed the Zoho sandbox. Phone, mail and WhatsApp links are blocked. The clock can be pinned. Disabled buttons are never pressed.
- **Converted cases:** agents A–D and F converted their cases. Group E's agent was stopped, so E was converted by hand.
  - 203 cases run through the UI.
  - 33 are UI-on-staging.
  - 63 are API checks.
  - 16 are manual.
  - 18 are still prototype-only; converting them is E16-S12.

### Results on the D61 prototype
- **Run:** 211 UI cases (203 plan cases plus 8 proof-of-concept cases), and 16 seeded-wrong cases.
  - 190 PASS.
  - 16 REVIEW, which go to the tester.
  - 5 FAIL. All five are real gaps:
    - E07-013: "keeps the scheduled step" never saves.
    - E10-007: editing an event logs a date change that did not happen.
    - E12-011: the IR Manager sees ₹ on Numbers.
    - E15-027: the legacy copy rows appear nowhere.
    - E15-031: System still shows old checks and the wrong renewal date.
- **Seeded-wrong cases:** 16 of 16 FAILed (p ≤ 0.08).

### Calibration (`pm/jev-calibrate.mjs`)
- **Method:** 494 true facts from passing cases were changed by one person, number, date or negation, then judged against the same screens.
- **Result:** 6 scored ≥ 0.80. Checked by hand:
  - 5 were changes that were still true on screen.
  - 1 is arguable.
  - So there were 0–1 clear false passes.
- **Threshold:** 187 of 203 true cases pass at 0.80, against 160 at 0.90. PASS_AT is therefore 0.80.
- **Rule:** re-measure at each stage gate. A run where any seeded-wrong case passes is not trusted.

## Lessons now written into "Ways of working"
- Steps use visible labels and name the row when a label repeats.
- A fact describes the current screen: write "does not offer X", never "no longer".
- A fact about a list gives the whole list or its count.
- Preconditions are fixtures, not app internals.
- A calibration case's title must not reveal it. A title that said "seeded wrong" changed Jev's step choice.

## Open
- **Owner decisions:** 22 are open, including accepting Jev as the main tester under the calibration rule, KPI targets and budget unit costs.
- **Slack:** the connector is connected but switched off for this chat.
- **Next:** the Investment Management portal delivery workbook, in the same format.
