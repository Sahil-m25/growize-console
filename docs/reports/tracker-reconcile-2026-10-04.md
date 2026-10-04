# Tracker reconcile, 4 Oct 2026

Source: `autopilot/console/BLOCKED.md` at 8a21d5d, 410 unticked lines. Evidence per line is in `tracker-reconcile-2026-10-04.json`. BLOCKED.md and progress.json were not edited.

## Counts (248 audited lines)

| Verdict | Lines |
|---|---|
| done | 45 |
| superseded | 8 |
| open-local | 21 |
| open-external | 174 |

Not audited, as the brief excludes them (PROVISIONAL, FACT CHANGE PROPOSED, OWNER): 162 lines (124 + 35 + 3). 248 + 162 = 410.

## Tick now (done)
M19-S03-T01, M16-S04-T02, M17-S05-T02, M17-S06-T02, M19-S02-NOTE-5, M01-S01-NOTE-5, M01-S04-NOTE-3, M18-S02-NOTE-2, M07-S05-NOTE-4, M09-S03-NOTE-2, M08-S07-NOTE-3, M06-S05-NOTE-3, M08-S02-NOTE-4, M08-S05-NOTE-5, M15-S03-NOTE-1, M03-S04-NOTE-3, M03-S04-NOTE-4, M09-S04-NOTE-3, M09-S04-NOTE-4, M09-S08-NOTE-3, M14-S02-NOTE-4, M14-S03-NOTE-6, M15-S05-NOTE-3, M15-S05-NOTE-4, M10-S03-NOTE-3, M12-S01-NOTE-5, M17-S01-NOTE-1, M13-S05-NOTE-6, M05-S06-NOTE-3, M08-S04-NOTE-3, M08-S08-NOTE-1, M08-S08-NOTE-5, M10-S05-NOTE-3, M11-S07-NOTE-4, M12-S02-NOTE-1, M17-S02-NOTE-4, M12-S04-NOTE-4, M12-S05-NOTE-2, M05-S07-NOTE-2, M05-S08-NOTE-2, M16-S08-NOTE-1, M10-S01-NOTE-6, M19-S12-NOTE-6, M08-S03-NOTE-7, M15-S05-NOTE-6

## Superseded
M03-S02-NOTE-1, M03-S03-NOTE-1, M14-S03-NOTE-4, M10-S02-NOTE-3, M17-S01-NOTE-3, M08-S08-NOTE-4, M16-S09-NOTE-2, M10-S02-NOTE-7

M08-S08-NOTE-4, M14-S03-NOTE-4 and M17-S01-NOTE-3 are superseded by the 4 Oct owner rulings (D115, not yet in docs/decisions). The code still follows the old behaviour, so D115 needs build work: app access Hold on creation and never opened by a match, event-sheet load for the super administrator only, seats as rights-grid columns.

## Open and doable locally (21)
M01-S08-NOTE-5, M01-S08-NOTE-6, M01-S08-NOTE-7, M01-S03-NOTE-4, M09-S01-NOTE-1, M07-S05-NOTE-3, M01-S10-NOTE-6, M10-S21-NOTE-1, M13-S01-NOTE-4, M15-S03-NOTE-5, M11-S02-NOTE-2, M14-S03-NOTE-5, M15-S05-NOTE-1, M15-S05-NOTE-2, M10-S22-NOTE-2, M10-S03-NOTE-4, M12-S11-NOTE-3, M12-S11-NOTE-5, M12-S12-NOTE-2, M12-S13-NOTE-2, M09-S09-NOTE-4

## Review units (progress.json)

| Unit | Verdict |
|---|---|
| M03-S04 wire | to-done |
| M08-S07 wire | to-done |
| M10-S01 wire | to-done |
| M12-S11 wire | stays-review |
| M14-S03 wire | to-done |
| M15-S05 wire | to-done |
| M16-S08 wire | to-done |
| M12-S01 wire | to-done |
| M02-S04 zoho | to-waiting |

7 to-done, 1 to-waiting (M02-S04 zoho), 1 stays-review (M12-S11 wire: Finance queue never calls `rankForFinance`; "not signed after all" note missing).

## Test-phase units (status.json: 54 waiting, 52 left)

106 stories have an unfinished test phase. The waiting ones are external except where listed: their open subtasks are Tester, Finance/KAM UAT, staging or sandbox runs. Locally doable subtasks are in `localTestWork` (47). Most are Jev UI cases already in ui-cases.json that passed in the 4 Oct suite (344 of 349), so they need recording; a few need a small build (M09-S01 Finance list client, M17-S02 multi-step Teams runner, M18-S01 read-budget assertions).

## Findings worth acting on
- M19-S03-T01 (seed manifest and reset script) is built: zoho/sandbox/reset.mjs and reset.test.mjs (TC-E16-005/006). Only the sandbox Test_Seed field is missing.
- Code gaps with no Zoho dependency: Finance Investors list has a route but no client (M09-S01); claims list has no consumer (M10-S03); no /api/system route and checks not wired (M15-S03-NOTE-5, M15-S05-NOTE-2); receipt replay still refuses ledgers with refunds (M01-S08-NOTE-5); discardSession is never called on sign-out (M01-S08-NOTE-6); Consent_How labels differ from the picklist (M14-S03-NOTE-5); App_Access and Investor_Payouts rows are missing from zoho-field-mapping.json (protected file).
- progress.json marks M02-S05-T01, M02-S08-T01, M02-S09-T01 and M20-S07-T04 done while their BLOCKED lines are open and the work is external. Treat as unproven.
