# D117 — Fan-out round 5 (4 Oct 2026)

Branch integrate3. Seven agents (six Sonnet, one Opus for the audit-trail work), one coordinator. Scope: the owner's points 3 (screens and features still unwired) and 4 (tests) from the "what needs no account" list.

## Screens and features
- Finance's Investors list reads GET /api/investors/finance (M09-S01-NOTE-1).
- IR payment reports (GET /api/claims) on Payments ("Payment reports waiting on Finance") and Today (M10-S03-NOTE-4).
- Finance's Out for signature ordered by rankForFinance through GET /api/documents/queue; "Not signed after all" note on the round from proposed Lead fields *_Back_At/By/Why (M12-S11-NOTE-3/-6). M12-S11 wire → done; phase 2b 66/66.
- The send flow offers the lead's agreed supplementary draft (M12-S12-NOTE-2); the file itself is not yet what Zoho Sign sends (no Writer export client).
- "Show the reference" asks the reason first and sends {why} (M18-S05-NOTE-3); Plane C actions `app-access-released` and `test-link-issued`, labelled in the log reader and Activity, covered by the hash chain and the identity scrubber (M08-S08-NOTE-10, M15-S05-NOTE-1).
- Farm release/take-back pushes `farm.shelf_changed` (new contract v1, PROVISIONAL) after the Zoho write (M13-S01-NOTE-4); `allotment-unlinked` guard on every allotment write path, "Needs a link" tag (M11-S02-NOTE-2).
- PEOPLE from Zoho Users on the viewer's token (M01-S03-NOTE-4); System facts: service-token expiry, rolling cache load window, last verified Zoho Sign event (M15-S05-NOTE-10).

## Tests
- 47 locally provable test subtasks checked (docs/reports/test-record-2026-10-04.json): 7 proven, 38 partial (local half proven, external left), 2 failed (missing documents). Jev: 264 PASS, 4 REVIEW, 0 FAIL of 268; calibration 18/18. Recorded: 8 subtasks done, 5 stories' test phase done; others marked waiting.
- Read-budget tests (M18-S01-T04): cold-read budgets per seat, investor record, badge cache, 450-lead book.
- Live checks card render tests; 22 browser cases added or converted (Teams and Plan form flows TC-E14-004/005/007/010/012/014/020, TC-E12-016..019, new TC-E14-024..028, TC-E11-016b, TC-IM05-041/042, TC-IM07-011); TC-E14-006 retired; fact changes TC-E11-016 (reason step), TC-IM05-012 (masked reference), TC-IM07-011 absence fact dropped; TC-IM06-027 dropped (not observable in the UI; covered by node tests).
- Runner: dropdown options separated in row text (TC-IM10-001 0.76 → 0.96); option list widened from 8 to 16.
- Bug fixed: "End access" on a temporary grant was a no-op (leads reducer rejected non-lead ids). Numbers' "Set action" buttons got distinct accessible names.

## Gates (merged tree)
tsc clean · vitest 79 files / 687 · node 92 files / 1,891 · scripts 54 · lint · dialogs 0 · build ok · smoke 7/7 · Jev on the 40 cases this round touched: 40 PASS after two case fixes.

## Tracker
13 BLOCKED lines ticked, 18 notes added (open 359). Phases: fe 92/92 · zoho 7 + 112 waiting · wire 66/66 · harden 7/7 · test 44 done, 87 waiting, 14 left.
