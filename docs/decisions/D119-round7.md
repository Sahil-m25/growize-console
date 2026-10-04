# D119 — Fan-out round 7 and full regression (4–5 Oct 2026)

Branch integrate3. Five agents (two Opus: roster UI, ledger; three Sonnet: UI fixes, idempotency, tests). Scope: the last items buildable without Zoho, Catalyst or a tester seat and not waiting on a decision.

## Built
- Roster live: absence drawer, Foot buttons and presence roster write through /api/availability (fixture half = the reducer); live roster fills state.AVAIL; Team member drawer shows Out / Back on; marking a primary back in ends their explicit covers with a Plane C line (D44) (M08-S05-NOTE-4/-6/-7).
- One ledger everywhere: Finance's Investors list no longer counts Pending money as paid (D21); holds, Investors Today and Numbers read ledger rows (no UTR); live Dataset rows follow the ledger (a reversal cancels its target; Part = balance); replay and ledger read Balance and Forfeit rows; demo add-paid starts no hold (M01-S08-NOTE-3/-4, M09-S09-NOTE-7).
- Match opens the step-up panel for a refund and retries once; a continuing event-sheet load shows "Loading — n of m rows so far" with running counts; Zoho numeric user ids accepted on error lines (the sealed-session part stays open) (M10-S02-NOTE-10, M18-S09-NOTE-9, M01-S04-NOTE-4 part).
- Sign send, document upload, IR payment claim, lead email and the receipt-replay turn on SharedState idempotency (M18-S09-NOTE-8).
- Leak detector knows every console mask (3+1 and last-four); Head of Account Management in the read budget (5 calls); Today's three activity reads recorded as a Zoho limit (COQL is one module) (M18-S02-NOTE-4, M18-S01-NOTE-2/-4).

## Full regression on the merged build
- Jev UI suite, all 397 cases: 378 PASS, 1 REVIEW, 0 FAIL of 379; calibration 18/18 seeded-wrong cases caught. TC-IM05-002 got the masked-reference fact change (same as TC-IM05-012, D113 #3). TC-IM05-007 stays REVIEW (0.69; 0.75 on the round-6 build — not a regression): the investor page shows the full UTR to Finance, which is the open owner question on UTR masking.
- Per-seat generated suite: 143 of 143 PASS.
- tsc clean · vitest 88 files / 767 · node 99 files / 3,221 · scripts 55 · lint · dialogs 0 · build ok · smoke 7/7.

## Tracker
14 lines closed (two as Zoho limits), 9 notes added; open 354.
