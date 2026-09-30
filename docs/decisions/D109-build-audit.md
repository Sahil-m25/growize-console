# D109 — Build audit with Jev: what was built vs the acceptance and the decisions (29 Sep 2026)

**How.** `autopilot/build-audit.mjs` judged all 134 stories with a built phase: `build` (round notes, finished subtasks, phase statuses) against the story's acceptance, the decisions it cites and the nine rules. Jev: 114 aligned, 5 drifted, 9 incomplete, 6 unclear; 2 decisive. Report: docs/reports/build-audit-2026-09-29.md. A person read every flagged row.

**Findings.**
1. **M02-S13 (drifted 0.71) — the story text is stale, the build is right.** Acceptance names Contacts KYC_Proof/PAN_Proof/Bank_Proof/Nominee_Form and Signed_NDA on the allotment; the build created PAN_Proof/Bank_Proof/FEMA_Declaration on Contacts and NDA on the Lead — which is D79. Fix: FACT CHANGE on the acceptance to match D79, not the build.
2. **M19-S01 (incomplete 0.71) — known.** The a11y contract exists (lint, labels) but is not enforced in CI; already PROVISIONAL M19-S01-NOTE-1 and covered by M18-S15-H4 (CI). No new work.
3. **Weak flags (18)** are almost all front-end rounds whose only note is a Jev pass count ("app 3/4 vs prototype 3/4"); the one failing case per story is in the M19-S12 triage. M02-S11/M02-S03 "drift" is the owner's own D75/D77 ruling — not drift.

**Conclusion.** Nothing built contradicts a decision in force. One story text lags a decision (M02-S13). The evidence gap is the notes themselves.

**Changed.** AUTOPILOT.md: a round's note must name what was built, the acceptance lines met, the decisions applied and what is left — a Jev pass count alone no longer counts. `autopilot/build-audit.mjs` and `autopilot/decisions-audit.mjs` stay as the two audit commands (to move under jev/cli.mjs in M19-S13).
