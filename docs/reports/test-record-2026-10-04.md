# Test record, 4 Oct 2026

Source list: `localTestWork` (47) in `tracker-reconcile-2026-10-04.json`. Evidence per subtask is in `test-record-2026-10-04.json`. Build: `npm run build:local` on branch agent/r5-test-record, local fixtures, port 3166.

## Counts

| Verdict | Subtasks |
|---|---|
| proven | 7 |
| partial | 38 |
| failed | 2 |
| not-local | 0 |

Rule used: a subtask is **proven** when every case it names runs locally and passes and nothing it asks for is a staging, sandbox, tester-only or real-Zoho observable. Running the same cases "on staging" alone did not downgrade it. Any named ui-staging case, Zoho record check, real send, restricted real user or tester procedure makes it **partial**. **failed** here means the deliverable does not exist, not that a test failed.

## Runs

- Jev UI: 114 story cases for these subtasks, 143 generated seat cases, 9 M09-S08 cases, plus the 18 calibration cases. 264 of 268 recorded cases PASS, 4 REVIEW, 0 FAIL. Calibration 18/18 seeded-wrong cases caught; M09-S08 CAL1/CAL2 caught.
- Node: `node scripts/run-tests.cjs` 90 files, 1851 pass, 0 fail. Vitest: 71 files, 635 pass, 0 fail. scripts: jev-calibration-gate 8, leak-matrix 6 pass.

## Proven (7)

M02-S01-T02, M03-S02-T03, M03-S03-T02, M04-S01-T04, M07-S01-T03, M18-S08-T01, M19-S03-T02

## Failed (2, deliverable absent)

- M18-S08-T03: usability tasks list, consent and timing sheet not written (docs/uat/README.md:112 lists them as not in the pack).
- M19-S01-T02: the one-page UI test contract is not in docs/ (lint and its test exist).

## REVIEW cases (4), all judge-borderline, screen checked

- TC-IM01-003 0.78: Sahil's menu lists all 15 pages named in the fact.
- GEN-TASNEEM-OPEN-TODAY 0.79 and GEN-DIVYA-OPEN-INVESTORS 0.76: the screens show 'Team follow-ups' and 'Accounts 13 under care'.
- TC-IM04-005 0.90: all facts pass, one typing step scored 0.58.

## Notes

- The 30 Sep bug-open cases TC-IM01-016, TC-IM01-020 and TC-E11-016 now PASS.
- TC-E07-012 (Undo gone after 10 s) scores 0.26-0.31 on the runner's defaults and passes (0.88) with `SETTLE_CAP_MS=15000`: the runner's 6 s settle cap is shorter than the 10 s window. Runner limit, not an app defect (timer at `LeadPage.tsx:366-369`). Suggest `"wait"` cases get a cap of at least wait + 4 s.
- A seat batch of 36 hung once on a Jev call (no call for 24 min) and one crashed with 'browser closed' under machine load; both were re-run in smaller batches.
- 390px probe (Playwright, 390x844): Today, Leads, lead page (Rohit, Sahil) and Documents, Tickets, Investors, Numbers (Meena) have no sideways scroll; screenshots in `test-record-2026-10-04-screens/`.

## Proposals

GAP: M18-S02-T01 — `pm/gen-seat-cases.mjs` emits UI cases only (ids `GEN-<seat>-<page>`); the API cases (`TC-PM-seat-page-action`) the subtask asks for are not generated.
GAP: M18-S01-T04 — per-page COQL budgets are asserted only for Investors Today and Numbers; Today, Leads, lead page, Documents and Tickets have none. TC-E15-001/002/004, TC-IM12-001/015 carry no test id.
GAP: TC ids with no test carrying them among these subtasks: TC-E01-009, TC-E01-010/011, TC-IM01-019, TC-E07-022, TC-IM11-013, TC-E14-004/006/022, TC-E15-008/010/011/024, TC-E16-013, TC-IM12-006.
GAP: M20-S07-T05 — no outbound test that one investor never receives another's events (only the inbound Contact check).
GAP: M10-S08-T03 — no Jev case for the one-farm investor or for the KAM/IR not seeing Money; M10-S08-NOTE-3 open.
FACT CHANGE PROPOSED: none.
