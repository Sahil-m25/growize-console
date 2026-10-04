# Decisions index gap (4 Oct 2026)

> **Resolved 4 Oct 2026 (D115 #6, D116):** the rows are in docs/DECISIONS.md, linking to docs/decisions/PROJECT-DOCS.md.

`docs/DECISIONS.md` jumps from D93 to D104. This report lists which D-numbers are cited in `docs/` or `autopilot/phases.json` but have no file in `docs/decisions/` and/or no row in the index. `docs/DECISIONS.md` was not edited. The decision texts live in the claude.ai Growize project (`decisions-and-changes-d*.md`, per `docs/launch/stage-reviews.md` line 192).

## Cited, no row and no file
| D | Cited in |
|---|---|
| D67 | `docs/SESSIONS.md:245` ("D67 draft + D68"); `docs/decisions/D68-sahil-super-user.md:3`; `docs/launch/stage-reviews.md:192` |
| D86 | `docs/launch/stage-reviews.md:192` (only, as a gap) |
| D92 | `docs/launch/stage-reviews.md:192` (only, as a gap) |
| D94 | `docs/launch/stage-reviews.md:192` (only, as a gap) |
| D98 | `autopilot/phases.json:2`; `docs/SESSIONS.md:299`; `docs/decisions/D104-tracker-waiting-wire-phase.md:16`; `docs/decisions/D108-decisions-audit.md:5`; `docs/launch/stage-reviews.md:7,24,27,33`; `docs/reports/jev-triage-2026-09-30.md:27,30,76,81,82`; `docs/reports/p3-money-proposed-ui-cases.json:2`; `docs/reports/phase1-jev-2026-09-28.md:28`; `docs/reports/rulings-2026-09-29.md:21,33,98` (and `.json`); `docs/reports/ui-cases-retired.md:11`; `docs/reports/ui-suite-2026-10-04.md:21` |
| D100 | `docs/decisions/D105-harden-phase.md:16` |
| D103 | `docs/launch/stage-reviews.md:192` (only, as a gap) |

## Has a row, no file
| D | Cited in |
|---|---|
| D83 | `docs/SESSIONS.md:261,263`; `docs/decisions/D108-decisions-audit.md:5`; `docs/decisions/D82-payouts-claims-events-plan-ladder.md:43,51,55,62`; `docs/reports/decisions-audit-2026-09-29.md:11,37` (and `.json`) |
| D84 | `docs/SESSIONS.md:287`; `docs/decisions/D108-decisions-audit.md:5`; `docs/decisions/D82-payouts-claims-events-plan-ladder.md:50`; `docs/launch/product-brief.md:54`; `docs/reports/decisions-audit-2026-09-29.md:54`; `docs/reports/rulings-2026-09-29.md:34,44,82,89,100` (and `.json`) |
| D85 | `docs/SESSIONS.md:263`; `docs/decisions/D108-decisions-audit.md:5`; `docs/decisions/D82-payouts-claims-events-plan-ladder.md:60`; `docs/launch/stage-reviews.md:46`; `docs/zoho-module-register.md:3,19,23,32`; `docs/reports/build-audit-2026-09-29.json:147,238`; `docs/reports/decisions-audit-2026-09-29.md:11,54` (and `.json`) |
| D34 | Row says "No file exists" (already recorded as missing in the index) |

## Missing from both and not cited anywhere in docs/ or phases.json
D87, D88, D89, D90, D91, D95, D96, D97, D99, D101, D102. They are in the project docs list (`decisions-and-changes-d87.md` ... `d102.md`) but not in the repo.

## Note on D98
D98 is the most-cited missing decision (phases.json plus about a dozen documents). Restoring its row and file is the first priority.
