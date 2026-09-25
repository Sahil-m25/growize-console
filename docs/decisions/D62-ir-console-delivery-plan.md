# D62 — IR console delivery plan: epics, stories, subtasks and Jev-judged test cases replace plan.xlsx

**Date:** 24 Sep 2026 · **Supersedes:** `docs/plan.xlsx` (7 Sep, built for the old two-org/mirror architecture) · **Scope:** IR console only
**Files:** `pm/IR-Console-Delivery-Plan.xlsx` (master), `pm/tests/ir-console-plan.json` (the same plan plus each automated case's script), `pm/observe.mjs`, `pm/judge.mjs`, `pm/build_xlsx.py`, `pm/tests/verdicts-2026-09-24.csv`

## Decision
The IR console is delivered from one workbook: Epic → Story (user story + Given/When/Then) → Subtask (≤ 8 h, one owner, one week) → Test case. Every test case is either automated (a setup/act/observe script) and judged by Jev, or manual (needs the real Zoho org, staging or email delivery).

## How the project runs
- Two people: Sahil builds everything, a freelance tester tests.
- Waterfall by stage. Build Mon–Fri, test Sat–Sun. Each stage has an exit gate (Must stories built, P1 tests passed, no open S1/S2 defects) and the owner signs it off before the next stage starts.
- Stages:
  - **S0** Zoho org & environment: 28 Sep–4 Oct (licence renewal before 13 Oct)
  - **S1** Foundations & access: 5–11 Oct
  - **S2** Core IR work: 12 Oct–1 Nov
  - **S3** Journey, paperwork, events: 2–15 Nov
  - **S4** Visibility & admin: 16–29 Nov
  - **S5** Hardening, UAT, migration, go-live: 30 Nov–13 Dec

## Contents
- **Plan:** 15 epics, 86 stories (66 Must), 229 subtasks, 310 test cases.
- **Test cases:** 147 functional, 72 negative, 63 permission, 19 non-functional, 9 regression. 247 are automated and 63 are manual.
- **Hours:** Sahil 323.5 h and tester 141.5 h. Sahil peaks at 39 h in W1 and is 24–36 h in every other week, against 40 h capacity.
- **Epics:**
  - **E01** Foundations & Zoho client
  - **E02** Zoho org build-out
  - **E03** Access & seats
  - **E04** Lead capture
  - **E05** Today
  - **E06** Leads & org search
  - **E07** Lead page
  - **E08** Journey & gates
  - **E09** Paperwork & material
  - **E10** Events
  - **E11** Updates & Activity
  - **E12** Numbers & Plan
  - **E13** Transfers
  - **E14** Teams/Profile/System
  - **E15** Non-functional & release

## Testing with Jev
1. `observe.mjs` drives each automated case in Chromium and records what it sees.
2. `judge.mjs` asks Jev (`jev-latest`, noul) whether the observed facts satisfy the expected result. Jev sees the test, seat, preconditions, steps, expected result, the observe code and the observation. PASS is ≥ 0.90, FAIL ≤ 0.10, anything between is REVIEW for the tester. The key stays in `growize/.typesafe-key`.

The first judge pass gave 93 PASS and 150 REVIEW, because the expected results were prose and the evidence was implicit. Each case was then rewritten so that its expected result is a list of numbered facts and its observation returns one named key per fact. The second pass gave **232 PASS · 12 REVIEW · 3 FAIL**.

The 3 FAILs, plus the one REVIEW at 0.12, are real prototype gaps, not test errors:
- **TC-E07-013:** "keeps the scheduled step" never saves.
- **TC-E10-007:** editing an event logs a date change that did not happen.
- **TC-E12-011:** the IR Manager sees ₹ on Numbers.
- **TC-E15-031:** the System page shows old-design checks and the wrong renewal date.

## Open (in the workbook's "Decisions & gaps" sheet)
- **20 owner decisions.** Key ones: where page grants live, which seats may see money, today-overdue definition, go-live on 10 or 14 Dec, calendar sync to be enabled before the S2 test weekend.
- **15 prototype gaps** for the build to fix.
