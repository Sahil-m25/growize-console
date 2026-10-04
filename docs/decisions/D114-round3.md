# D114 — Fan-out round 3 on the 4 Oct rulings (4 Oct 2026)

Built on integrate2 from D113. Five agents (receipts rule on Opus), then a docs sweep and a bug-fix agent.
- **D113 ruling 1 built:** a Finance-recorded receipt is matched by the recorder (server + demo); the bank statement auto-matches pending money-in; IR claims stay pending until Finance confirms; refunds keep D22's second hand.
- **M09-S08:** an IR's Investors page reuses the Investors list/record components — own-lead investors only, read-only, no money (GET /api/investors/mine).
- **Fact changes applied (D113 ruling 3), M19-S10/S11:** ui-cases.json updated; 6 retired, 6 converted, 28 promoted, 2 added (367 cases); per-seat case generator (143 cases).
- **M19-S07/S08:** smoke suite (7/7 on the demo build, wired after deploy and hourly in production, gated on hosting); runner settle wait, flake log and quarantine.
- **M18-S05/S09/S10, M20-S01/S03/S04/S05/S06:** backup/restore plan, go-live checklist and rollback, runbook and hypercare, product brief and KPIs, 8 seat guides, support model, stage reviews, change control (docs/launch, docs/ops). Drills wait for hosting (AP4) and the log store (D47).
- **Bugs fixed:** Payments-register reveal behind step-up with a logged reveal (TC-E11-016/E15-009); Investors-only seats can open Your account and sign out (TC-IM01-016/020); distinct names on the Assignments report (TC-E12-002).
- **Docs made consistent** with D110/D113 (UAT, runbooks, guides, access and seat plans, env README).
- **Jev UI suite on the merged tree: 344 PASS, 5 REVIEW, 0 FAIL of 349; calibration 18/18** (224/319 on 30 Sep).
- Gates: tsc clean; vitest 68 files / 584; node 89 files / 1,821; lint; scripts 50; jev 36; dialogs 0; smoke 7/7.
