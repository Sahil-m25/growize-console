# D118 — Fan-out round 6 (4 Oct 2026)

Branch integrate3. Eight agents (four Opus: sessions, per-instance state, deadlines, money; four Sonnet: API matrix, missing tests, fixtures/docs, roster). Scope: everything buildable without Zoho, Catalyst or a tester seat and not blocked by a decision.

## Ready for any host
- Sessions on SharedState, sealed (AES-256-GCM) with SESSION_ENC_KEY; start refused on a shared store without the key; sign-out and change of person discard pending receipt replays (M18-S09-NOTE-1, M01-S08-NOTE-6).
- Per-instance state moved (M18-S09-NOTE-2): webhook seen-ids, request index, grant store (GRANT_STORE=shared), push outbox (claimed per delivery), money idempotency (mark-paid, add-paid, record-receipt), payout run claim; Sign dead-letters and push ledger to the log sink; Sign re-check and outbox drain as job endpoints (/api/jobs/*, JOB_SECRET) with a claim per run.
- Request deadline 25 s (REQUEST_DEADLINE_MS, 503 code "deadline"), per-attempt Zoho timeout 10 s; statement auto-match (4 lanes, per-investor order, continueWith), event sheet load (2,000 rows, resumable), KAM seat change (200 investors, continueFrom) (M18-S09-NOTE-3).

## Money and security
- One signed ledger (server/money/ledger.ts) for the register, the Money section and replay; replay handles refunds and reversals; property test replay = register (M01-S08-NOTE-5).
- Add-paid writes no hold; match.ts startHold is the one writer of Hold_Until (M09-S09-NOTE-4).
- Reveal/export route audit; a refund match now needs a live step-up "refund" (M01-S10-NOTE-6).

## Tests and docs
- API matrix: pm/gen-api-matrix.mjs, 1,070 seat×route cases (TC-PM-*) run on the contract rig; no leak found (M18-S02-T01). Outbound isolation: 19 tests, every outbound type (M20-S07-T05).
- 18 TC ids without a test now carried (staging halves listed in docs/reports/r6-missing-tests.md); runner settle cap follows the case wait (TC-E07-012 passes); Assignments buttons named distinctly (TC-E12-002 0.96).
- Fixtures L3_NDA_SENT_BACK, IM:ALLOTMENT_NO_CUSTOMER, IM:ALLOTMENT_NO_LLP; cases TC-E09-015, TC-IM06-025/026, TC-IM05-043..045, TC-E14-022 added (all pass).
- docs/uat usability pack; docs/UI-TEST-CONTRACT.md; 18 mapping rows (App_Access, Investor_Payouts) added to pm/plan-merged/zoho-field-mapping.json.
- Roster reader over Plane C (availability writer, /api/availability); cover and event staff admitted by roster (M14-S02-NOTE-3; M08-S05-NOTE-4 server side — the UI controls still need wiring).

## Gates (merged tree)
tsc clean · vitest 84 files / 730 · node 99 files / 3,197 (two tests fixed at merge: a timing-dependent loader assertion and the secret scanner matching its own samples) · scripts 55 · lint · dialogs 0 · build ok · smoke 7/7 · Jev on 24 touched cases: 24 PASS.

## Tracker
20 lines ticked, 21 notes added (open 359). Phases: fe 92/92 · zoho 7 + 112 waiting · wire 66/66 · harden 7/7 · test 47 done, 84 waiting, 14 left.
