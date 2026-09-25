# D64 — Jev is the main tester for the IR console

**Date:** 24 Sep 2026 · **Decided by:** owner (Sahil) · **Confirms:** D63

## Decision
Jev is the main tester for the IR console.

## What this means
- **Every run:** the Jev UI runner (`pm/jev-ui-runner.mjs`) runs every UI case: on the prototype now, and on staging after each deploy once the app is built.
- **Verdicts:**
  - PASS: every screen fact scores ≥ 0.80 and every step was clear.
  - FAIL: a fact scores ≤ 0.10.
  - REVIEW: anything else. The tester decides these.
- **When a run counts:** only if every seeded-wrong case fails and near-miss false passes stay ≤ 1% (`pm/jev-calibrate.mjs`).
- **Re-measuring:** the 0.80 threshold is re-measured at each stage gate.
- **The freelance tester's role changes.** Weekend work is now:
  - reviewing REVIEW rows
  - running the manual and staging cases
  - exploratory and usability sessions
  - confirming the calibration result at each gate
- **Still needed by the build (E16):**
  - staging test sign-in per seat
  - Zoho sandbox seed and reset for fixtures
  - the CI job that blocks promotion on any P1 FAIL or an untrusted run
  - a rotated TypeSafe key stored as a CI secret

## Workbook
The "Decisions & gaps" row is marked Decided. 21 owner decisions remain open.
