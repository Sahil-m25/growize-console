# Staging regression cases

`w3-regress.json` holds the 12 staging-harness cases (Playwright + Jev) added for the 6–9 Oct 2026 defects that had no failing-if-it-returns case. A copy of `/home/claude/gz/harness/cases/w3-regress.json`; run it from the harness (`node harness/run.mjs harness/cases/w3-regress.json`, format in the harness `README.md`), not from here. Ids are `W3-REG-<defect>`; which defect each proves is in `docs/uat/STAGING-DEFECTS.md`. Write cases touch seed records only and never send mail.
