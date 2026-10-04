# Stage reviews, status notes and retrospectives (M20-S05)

Written 4 Oct 2026. Reviews below cover the stages that have actually run. Stages not yet run are templates.

## 1. What "stage" means here

The plan (D62) had calendar stages S0 to S5 with gates. D66 replaced the calendar with progress, and D98 split the build into phases that run in order: 1 front end on demo data, 2 plug into Zoho, 2b wire screens to the API, 2c harden, 3 test and harden. No calendar stage S0 to S5 has been run and signed as a stage. Every story still carries an S-number (S0 18 stories, S1 23, S2 30, S3 43, S4 24, S5 17). Those are a reading order, not a gate that was held.

So the reviews below are per build phase. They are the honest record of what ran. The S0 to S5 templates in section 6 wait for the people's stages (sandbox proofs, UAT, go-live, hypercare).

Each review answers the three acceptance lines of M20-S05: status sent, risk register and change log reviewed, one thing to change.

- **Risk register.** The PM workbook's Risks sheet (D63) is not in this repo as text. The risks named below are the ones the evidence shows. Reconcile them with the sheet when the owner opens it.
- **Change log.** `docs/launch/change-log.md`.

Sources: `docs/DECISIONS.md` and decision files D104 to D113, `docs/SESSIONS.md`, `docs/reports/*`, `autopilot/status.json` (snapshot 4 Oct 00:07 UTC).

## 2. Gate review and retro: Phase 1, front end on demo data

| | |
|---|---|
| Ran | From 24 Sep 21:00 IST (build start) to 28 Sep |
| Gate (phases.json) | The story's screens exist in `console/` and its Jev UI cases pass on demo data (`FIXTURE_MODE=local`). No Zoho calls. |
| Result | 92 of 92 front-end units built. Sign-in screen, one data interface, Investors side merged into one console (D98). Full Jev suite 28 Sep: app 221/319 (69%), prototype 218/319 (68%). Calibration 18/18 (`docs/reports/phase1-jev-2026-09-28.md`). |
| Gate met? | Yes by the stated gate. Not by the stronger reading "every case passes": 98 cases failed on 28 Sep. |

**What went well.** The merged prototype became the authority (D98). Calibration caught every seeded-wrong case (18/18) on both runs.

**What did not.** On 27 Sep every case failed at its first step because there was no sign-in screen (97/319 = 30% before the lead side was re-ported). Many failing cases were written for the old separate portals. M19-S12 later called 82 of the failures stale (`docs/reports/jev-triage-2026-09-30.md`). 40 FACT CHANGE PROPOSED lines piled up in BLOCKED.md waiting for the owner (D104).

**Risks seen.** Test expectations that disagree with the merged console. A story text that lags a decision (M02-S13, D109).

**Change log.** D98 itself: three phases, merged prototype. No D98 file exists in `docs/decisions/` (see section 7).

**One thing to change.** Check a test case's facts against the merged console before counting its failure as a bug. This became D106 (rulings sheet) and the owner's approval of all fact changes in D113 item 3.

## 3. Gate review and retro: Phase 2, plug into Zoho

| | |
|---|---|
| Ran | In parallel with phase 1 from 24 Sep (D98). Code half finished by 30 Sep |
| Gate | The same screens read and write Zoho through `src/lib/zoho` as the signed-in person; unit and API tests pass; UI cases still pass on demo data. |
| Result (status.json, 4 Oct) | 119 units: 7 done, 111 waiting, 1 in review |
| Gate met? | The code half, yes. The proof against real Zoho, no. There is no sandbox yet. |

**What went well.** The owner's rulings on the Zoho shape were recorded as decisions (D74 to D85). 36 fields were created in production and later reconciled (D74, D75, D77).

**What did not.** The tracker said "Phase 2: 118 of 119 done" while 111 units were waiting for proof (D104). That hid about 32 loop hours of wiring and made the forecast too good. Sahil's Zoho setup tasks are still open on 4 Oct (twelve task lines in BLOCKED.md, list in `go-live-checklist.md` section 6) even though D66 said the Zoho admin work comes first.

**Risks seen.**
- Enterprise expires 13 Oct 2026 (A-20). Nothing renewed yet.
- The wall (profiles, field-level security, Private sharing) is not built in the real org (A-21). T11 cannot run.
- Zoho Sign is on a free plan with no API (D78, AP3).

**Change log.** D104 split "done" from "waiting" and added phase 2b. D110 moved Sahil off the Administrator profile.

**One thing to change.** A unit is "waiting", not "done", until it is proved. Done in D104. Next: put Sahil's Zoho tasks on a dated list that the owner sees (`autopilot/PEOPLE-CALENDAR.md`) and ask for the dates in each Friday note.

## 4. Gate review and retro: Phase 2b, wire screens to the API

| | |
|---|---|
| Ran | 28 Sep to 4 Oct (D104). Fan-out from 30 Sep (D111). |
| Gate | The screen reads and writes through its `/api` route, not the demo reducer; Jev UI cases still pass with `FIXTURE_MODE=local`; typecheck and npm test pass. No live Zoho. |
| Result | 66 units. 44 done, 22 in review after fan-out wave 2 (30 Sep, D111). 57 done, 9 in review after rounds 1 and 2 (4 Oct, D112). |
| Gate met? | 57 of 66 yes. 9 wait for owner decisions or Zoho fields. |

**What went well.** One wiring pattern (`docs/WIRING.md`) and three pilots, then six Sonnet builders in parallel. The stale-edit guard now rides every read (`Modified_Time`), so a stale save gets "Changed by someone else, reload" (D112). Seven new routes. Real bugs fixed: offline Investors receipts now queue; Auditor Activity reads the Finance trail.

**What did not.** The laptop CLI lost the API in round 2 on 30 Sep (`ENOTFOUND`, 15 minute pause). Round 1 and 2 of 4 Oct ran in a cloud workspace, "laptop not linked" (D112). The unit count: 66 units (68 subtasks); older text quotes 64 (D104) or 68 (D111) for the same work.

**Risks seen.** The 9 review units need owner rulings or Zoho fields: D113 answered several (items 2, 5d, 6).

**Change log.** D104 added the phase. D110 added wiring units M06-S03-W2 and M06-S05-W2.

**One thing to change.** Run fan-out in the cloud workspace by default when the laptop is unreliable, and keep one coordinator as the only writer of `progress.json` and BLOCKED.md (D111).

## 5. Gate review and retro: Phase 2c, harden

| | |
|---|---|
| Ran | 28 Sep to 30 Sep, in its own worktree (D105) |
| Gate | The unit's tests exist and pass on demo data, typecheck and npm test pass, CI's check job runs them. |
| Result | 7 of 7 done: M18-S14 route contract suite, M18-S15 security hardening, M12-S05-H5 webhook tests, M19-S12 Jev triage, M18-S08 UAT pack, M20-S07-H7 Portals spike, M19-S13 one Jev layer (D107). |
| Gate met? | Yes. Gates on `integrate2` after round 2: tsc clean; vitest 64 files / 543; node suite 86 files / 1,792; lint:a11y; scripts 44/44; jev 31/31; no-native-dialog gate 0; local build ok. |

**What went well.** Security headers, Origin guard, rate limits and `npm audit` (high and above clean after Next 15.5.26) now run in CI. 131 UAT steps written. The Portals spike answered "no direct path" without a sandbox.

**What did not.** Planned as 5 units at 12.5 loop hours (D105); it became 7. The 401 body as built does not match acceptance 1 of M18-S14. The owner chose "as built" (D113 5a).

**Risks seen.** Rate limits are in-process: more than one instance multiplies them (`ops/env/README.md`).

**Change log.** D105 added M18-S14, M18-S15, M19-S12 and subtasks. D107 added M19-S13.

**One thing to change.** When a built shape differs from an acceptance line, raise the fact change in the same round, so the owner rules on it early (D113 5a took four days).

## 6. Phase 3 (local half) and the audits

| | |
|---|---|
| Ran | 3 and 4 Oct (D112), after audits on 29 and 30 Sep |
| Gate | API cases, staging cases on the Zoho sandbox, the full regression, tester review and UAT |
| Result (status.json, 4 Oct) | 145 units: 33 done, 47 waiting on the sandbox or the tester, 1 in review (TC-E11-016, no reveal control on the Investors-side Payments register) |
| Gate met? | No. The local half is done. The sandbox half cannot start. |

Measured so far:
- Jev UI suite on the local build: 213 to 224 of 319 passing (M19-S12). The rest: 82 stale, 8 bug-open, 5 flaky-borderline.
- Isolation matrix: 63 cases on recorded fixtures. All 31 contract schemas through the stub receiver.
- Audits: rulings sheet D106 (109 open lines: 15 reverse, 4 confirm, 12 for the owner, 78 undecided); decisions audit D108 (88 rows, 7 real conflicts); build audit D109 (134 stories: 114 aligned, 5 drifted, 9 incomplete, 6 unclear).
- Owner rulings D110 (30 Sep) and D113 (4 Oct) closed the conflicts the audits raised.

**What went well.** The audits found one story text that lags a decision and nothing built that contradicts a decision in force (D109). The owner ruled on 31 of the 110 waiting lines (the top three tiers of D106); 78 stay open and are read by cost.

**What did not.** Forecast: D66 aimed for everything built by Sat 3 Oct. `autopilot/status.json` (4 Oct 00:07 UTC) says `on_track: false`, loop finish 5 Oct 11:59 UTC, testing end 11 Oct. The UAT pack says UAT runs to about 9 Oct. These are projections that do not agree. D113 leaves log store and hosting open, and the sandbox half of 47 units waits on both.

**Risks seen.**
1. No hosting (AP4): staging and production jobs stay skipped and deploy steps fail on purpose.
2. Enterprise renewal by 13 Oct.
3. The Zoho wall and T11 not done: no real seat can be added.
4. Planes B and C store open (D47): alerts and logs have no durable home.
5. Alert email not wired: alerts sit in memory (M18-S04-NOTE-1).
6. Sahil is the only on-call person.
7. KPI targets blank (OD10).

**Change log.** D106, D107, D108, D109, D110, D111, D112, D113: see `change-log.md`.

**One thing to change.** The sandbox and hosting block more units than anything else. Ask the owner for AP4 and the 13 Oct renewal this week, in the Friday note, with dates.

## 7. Templates for stages not yet run

Copy one block per stage. Fill it at the gate, not before.

### Review and retro template

```
## Gate review and retro: <stage>
Dates: <start> to <end>
Gate (from plan or phases.json): <text>
Result: <numbers, with the source file>
Gate met? <yes / no / partly, and what is missing>

What went well:
What did not:
Risks seen: (reviewed against the Risks sheet on <date>)
Change log reviewed on <date>: <rows added, rows decided>
ONE thing to change: <one line, with an owner and a date>
```

### Stages to review when they run
| Stage | Gate | Review due |
|---|---|---|
| Sandbox proofs (phase 3, sandbox half) | The 47 waiting units proved on the sandbox; T11 passed on every profile | When the sandbox half ends |
| UAT | `docs/uat/README.md` exit rule met, blocker list signed | Day 6 of UAT |
| Go-live | `docs/launch/go-live-checklist.md` every line ticked | Go-live day |
| Hypercare | `docs/ops/hypercare.md` exit rule met | Day 10 of hypercare |
| Plan stages S0 to S5 (D62) | Not used as gates since D66. Fill only if the owner wants the plan's stage view | OPEN — owner |

The M20-S05 subtasks T01 to T06 (S0 to S5 reviews) are covered by the phase reviews above and these templates. Whether the owner wants the S0 to S5 view as well: **OPEN — owner**.

## 8. The Friday status note

Each Friday a short note goes to the owner. Four headings, no more than a page.

```
Status, week ending <Friday date>
Done:
Next:
Risks:
Decisions needed from you: (each with the date it blocks)
```

Rules: numbers come from `autopilot/status.json` and the defects list. Say "blocked" plainly. Never put investor names, PAN, bank numbers or tokens in it. Where it goes: **OPEN — owner** (the plan used the Slack channel #growize-app-documents, D66).

### First note: as at Sunday 4 Oct 2026

**Done.** Phase 1 and 2c complete. Phase 2b 57 of 66. Phase 3 local half 33 of 145 done, 47 waiting. D113 rulings recorded. Launch documents written: backup plan, go-live checklist, runbook, hypercare, brief, guides, support model, change control.

**Next.** Sandbox and hosting so the 47 waiting units can be proved. Enterprise renewal. The Zoho wall and T11.

**Risks.** The seven in section 6.

**Decisions needed from you.**
1. Hosting (AP4), blocks staging and production.
2. Planes B and C store, Option 1 or 2 (`backup-restore-plan.md`).
3. Renewal of Enterprise before 13 Oct.
4. KPI targets (`product-brief.md`).
5. On-call deputy, who calls rollback.
6. Go-live date and who says go.
7. Whether receipts FIN-12, FIN-14, HOF-02 in UAT follow D113 item 1.

## 9. Conflicts found while writing this
- Decisions D94 to D103 are cited (D98 is cited by `phases.json`, D104, D105, D108) but have no file in `docs/decisions/` and no row in `docs/DECISIONS.md`. The index jumps from D93 to D104. D67 and D86 to D92 are also absent. The decision files exist in the claude.ai project (`decisions-and-changes-d97` to `d103`, per its doc list), not in the repo.
- Forecast: D66 says built by 3 Oct. `status.json` says finish 5 Oct and `on_track: false`. The UAT README projects UAT 4 to 9 Oct. The people calendar says testing 5 to 11 Oct.
- Phase 2b unit count: 66 units (68 subtasks). D104 says 64 and D111 text says 68; both stay as history.
