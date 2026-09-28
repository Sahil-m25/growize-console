# D104 — Tracker shows waiting apart from done; FRONT-END LOOP items become phase 2b units (28 Sep 2026)

**Why.** The Slack tracker read "Phase 2: 118 of 119 done" while 111 of those units were *waiting*: code and fixture tests written, nothing proven against Zoho (no sandbox). The 66 "FRONT-END LOOP" notes in BLOCKED.md (screens still on the demo reducer that must be wired to the new /api routes) were counted nowhere, so the forecast missed ~32 loop hours. BLOCKED.md had 400 untyped lines. "UAT remaining" meant a story (M18-S08) and six reserved days, not tests that exist.

**Decided (owner, 28 Sep).**
1. `status.mjs`/`status.json` carry `done` (proven) and `waiting` (code written, proof waits on a person) separately; the canvas phase table shows both. `built` (done + waiting) is kept for the loop's own logic (PHASE_OK unchanged).
2. New phase **2b "wire"** (`autopilot/phases.json`, type `Wiring`) between Zoho and Test. `autopilot/wire-units.mjs` turns every open FRONT-END LOOP note into an Autopilot subtask `<STORY>-W<n>` (`from: <NOTE id>`, 1 h) in the merged plan; idempotent. 66 notes → 66 subtasks on 64 stories → 64 units, assumed 30 min each (`targets.json`) until 5 rounds are measured. Gate: the screen reads/writes through its /api route, its Jev UI cases still pass with FIXTURE_MODE=local, typecheck and npm test pass. No live Zoho needed.
3. A phase whose only open units are in *review* no longer holds the loop in that phase (`lib.mjs` `OPEN`, `status.mjs` `current`). M02-S04 in review was blocking everything after phase 2.
4. The canvas gains a **Backlog in BLOCKED.md** table by kind: FRONT-END LOOP 66, PROVISIONAL 70, FACT CHANGE PROPOSED 40, BLOCK 6, STAGING PROOF 4, OWNER ACTION 2, tasks for people 22 (Sahil 10, Autopilot 11, Tester 1), other notes 188. Decisions waiting on the owner = PROVISIONAL + FACT CHANGE PROPOSED (110).
5. UAT is a dated stage with entry criteria (sandbox live, phase 2b through, smoke suite green), shown as a range on the canvas, not a "remaining" tag.

**Effect on the forecast.** Loop finish moves from 1 Oct to 3 Oct 20:44 IST (target 3 Oct 23:59 — still on track, with no slack); people's testing/UAT 3 → 9 Oct.

**To run phase 2b now.** In the backend worktree set `autopilot/.phase` to `wire` (or delete it on a checkout where phases 1–2 are merged) and run /build; `next.mjs` asks for one regression first, then hands out W-units. Ticking a FRONT-END LOOP note in BLOCKED.md does nothing by itself; the unit is done when `done.mjs` records it.

**Not changed.** progress.json, BLOCKED.md contents, the plan's existing subtasks, PHASE_OK, D98 phase gates for fe/zoho/test.
