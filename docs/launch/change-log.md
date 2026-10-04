# Change log

Process: `docs/launch/change-control.md`. One row per request. Newest last. Written 4 Oct 2026 from the decision files, so the first rows are history. "Size" is as stated in the source. "Moved out" is blank where the source says nothing.

| ID | Date | Request | Raised by | Size | Impact | Owner's decision | Goes to | Moved out | Source |
|---|---|---|---|---|---|---|---|---|---|
| CL-01 | 28 Sep | Count "done" and "waiting" apart. Turn 66 FRONT-END LOOP notes into wiring units. UAT becomes a dated stage with entry criteria. | Owner | 66 units on 64 stories, about 32 loop hours (assumed 30 min each) | New phase 2b. Loop finish moved from 1 Oct to 3 Oct 20:44 IST | Decided by the owner, 28 Sep | This stage | Nothing. Target 3 Oct kept with no slack | D104 |
| CL-02 | 28 Sep | Harden phase: M18-S14 (route contracts), M18-S15 (browser and request hardening), M19-S12 (88 unexplained Jev failures), M12-S05-H5 (webhook tests), M18-S08-H5/H6 (UAT pack) | Build team | 5 units at 150 min each = 12.5 loop hours | New phase 2c in a second worktree, on its own clock. Phase 3 starts when every clock has ended | Owner chose all four items and a second worktree, 28 Sep | This stage | Nothing. Phase 2b keeps the 3 Oct target | D105 |
| CL-03 | 29 Sep | Decide open PROVISIONAL and FACT CHANGE lines with a rulings sheet | Build team | 109 items judged | 31 items put to the owner. 78 stay open | Owner rules on the first three tiers | This stage | | D106 |
| CL-04 | 29 Sep | M19-S13: one Jev layer for the whole build | Build team | 6 units, 15 loop hours | Phase 2c, side clock. UI runner moves onto the shared client | Decided by the owner, 29 Sep | This stage | Nothing. Main forecast unchanged | D107 |
| CL-05 | 29 Sep | Decisions audit and build audit | Build team | 88 rows; 134 stories | 7 real conflicts listed. Round notes must now name acceptance lines and decisions applied | Owner ruled on the 7 on 30 Sep (CL-06) | This stage | | D108, D109 |
| CL-06 | 30 Sep | Rulings on the 7 conflicts: Sahil on a non-admin Digital Infrastructure profile; search scope follows the seat; D15 superseded; investor sign-in stays Supabase pending a Portals spike; D10, D24, D20, D23, D46, D49 marked superseded | Audit | Adds wiring units M06-S03-W2 and M06-S05-W2 and spike M20-S07-H7 (no size stated) | Search is org-wide for DI and the business owner. Owner task: create the profile (M03-S05-T02) | Owner's words for rulings 1 to 4; 5 to 7 housekeeping | This stage | | D110 |
| CL-07 | 30 Sep | Fan-out: parallel agents in git worktrees, Sonnet builders, Opus for design and integration | Owner | First run: 15 agents | Phase 2b 44/66, phase 2c 7/7. next 15.5.4 to 15.5.26 | Decided by the owner, 30 Sep | This stage | | D111 |
| CL-08 | 4 Oct | A receipt Finance records is matched, no second person. Refunds and money leaving keep the second hand. | Owner | Changes D21/D22 reading for ordinary receipts. TC-IM05-006 follows | UAT steps FIN-12, FIN-14, HOF-02, gap 8, and two runbook pages still read the old way | Owner ruling 1 | This stage | | D113 |
| CL-09 | 4 Oct | M09-S08: an IR sees their own investors by reusing the Investors page | Owner | One component set, IR-scoped, read only, no money | Wiring unit M09-S08 | Owner ruling 2 | This stage | | D113 |
| CL-10 | 4 Oct | All FACT CHANGE PROPOSED test-case changes approved. `ui-cases.json` may be edited. M19-S10 and S11 proceed. | Owner | About 40 lines | Test cases change | Owner ruling 3 | This stage | | D113 |
| CL-11 | 4 Oct | 401 body stays as built. M18-S14 acceptance 1 changes to "no record data". | Owner | One acceptance line | Test and story text | Owner ruling 5a | This stage | | D113 |
| CL-12 | 4 Oct | Farm ops: not provisioned now, persona kept. `bu` seat is the business owner. M11-S07-NOTE-3 closed. Compliance reads the Finance trail, no separate Auditor profile. | Owner | Seat and UAT scope | UAT-FARM not run. No Farm ops guide | Owner rulings 5b to 5e | This stage | | D113 |
| CL-13 | 4 Oct | Zoho fields for claims, events and app mark kept for later; the code reads them when present | Owner | 3 groups of fields | None before go-live | Owner ruling 6 | Backlog | | D113 |
| CL-14 | 4 Oct | Launch documents: backup plan, go-live checklist, runbook, hypercare, brief, guides, support model, change control | Plan stories M18-S05, S09, S10, M20-S01, S03 to S06 | 8 stories | Docs only. No app code. Many lines are OPEN — owner | Planned work, not a change | This stage | | `docs/launch/`, `docs/ops/` |

## Stories added after 28 Sep (TC-E17-006)
| Story | Date | Log row |
|---|---|---|
| M19-S13 | 29 Sep | CL-04 |
| M06-S03-W2, M06-S05-W2 (units) | 30 Sep | CL-06 |
| M20-S07-H7 (spike) | 30 Sep | CL-06 |
| M18-S14, M18-S15, M19-S12 (added 28 Sep, the same day) | 28 Sep | CL-02 |

Two rows have no stated size in their source (CL-06). The plan files under `pm/plan-merged/` are not edited by hand, so this log is the record to check them against.
