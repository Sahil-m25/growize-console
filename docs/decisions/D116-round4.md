# D116 — Fan-out round 4 (4 Oct 2026)

Branch integrate3 from integrate2 (D114). Nine agents in their own worktrees (D111): six Sonnet (tracker reconcile, system gaps, rights grid, mail/lead gaps, Docker image, rulings sheet), three Opus (D115 money/access rulings, shared state, log sink). One coordinator merged, fixed, ran the gate and is the only writer of the tracker.

## Tracker reconciled with the code
- `docs/reports/tracker-reconcile-2026-10-04.{json,md}`: 248 non-provisional open lines checked — 45 done, 8 superseded, 21 open-local, 174 external (Zoho, tester, staging, hosting).
- 76 BLOCKED lines ticked (reconcile + this round + 18 superseded provisional/fact lines); 20 new notes; open lines 410 → 354.
- Seven wire units moved review → done; M02-S04 zoho → waiting; M12-S11 stays in review (rankForFinance, "not signed after all").
- Phase status: fe 92/92 · zoho 7 done + 112 waiting · wire 65/66 · harden 7/7 · test 39 done + 54 waiting, 52 left. The reconcile lists 47 test subtasks doable locally (mostly Jev cases already passing that only need recording).

## Code gaps closed
- GET /api/system feeds the System checks (Plane B headroom, audit archive last run, investor-app delivery, Plane C chain verdict); `ZOHO_LICENCE_EXPIRES_ON`.
- Weekly money reconciliation runbook (ops/runbooks/weekly-reconciliation.md).
- Zoho send_mail attachments by file id; DeckMailer on `GROWIZE_DECK_FILE_ID`; NDA gate unchanged.
- Consent_How written only with the org's picklist values; Consent_Visit no longer read (the org has no such field).
- Lead search filed as an event, not a refusal; Plane C reveal lines carry the chosen reason.

## D115 built
- App access Hold on every creation path, released only by "Send welcome and unlock".
- Event-sheet load: super administrator (`CONSOLE_SUPER_ADMIN_IDS`), grantable; IR keeps its load.
- Rights grid: 8 Investors seats as columns with their Zoho role.
- Case facts updated: TC-E10-012 (title), TC-IM11-005/006 (titles, "offers Send welcome and unlock"), TC-IM10-002/004 (8 seat columns).

## Host-agnostic prep for Catalyst (AP4/D47 still open)
- `server/state` SharedState (claim/release/get/set/incr/take): memory by default; Catalyst NoSQL adapter behind `STATE_STORE=catalyst` (fails the start if misconfigured). Rate limits, step-up and both webhook in-flight claims moved onto it. Inventory of all in-process state: docs/architecture/shared-state.md. **Sessions are still an in-memory Map — must move before any multi-instance host.**
- Log sink for Planes B/C: file by default; Stratus segments behind `LOG_SINK=stratus` (India buckets only). Plane C hash chain + verifier (scripts/verify-audit-chain.mjs). docs/architecture/log-sink.md.
- `output: "standalone"`, console/Dockerfile (node 22, amd64, non-root, listens on X_ZOHO_CATALYST_LISTEN_PORT): 135 MB image; start to first 200 in 5–7 s in this sandbox (server ready in 0.4 s); 91–122 MiB in use; healthy at 512 MB and 1 GB. catalyst/README.md + app-config template.
- 30-second audit: statements upload, event sheet load (>~1,000 rows) and KAM seat change (>~55 investors) cannot fit; nightly export and legacy migration need Job Scheduling. docs/architecture/catalyst-limits-audit.md.
- Fix during integration: instrumentation hook made edge-safe (build failed on node:crypto).

## Owner material
- Rulings sheet: docs/reports/rulings-sheet-2026-10-04.csv (184 rows: 165 provisional/fact/owner lines with Jev scores, lowest first; 19 OWNER-INPUT rows for KPIs, SLAs, on-call and the refunds-only Zoho rule).
- Decisions index: D67, D86–D92, D94–D103 added, pointing at docs/decisions/PROJECT-DOCS.md.

## Gates (merged tree)
tsc clean · vitest 71 files / 635 · node 90 files / 1,851 · scripts 54 · lint · dialogs 0 · `next build` ok · smoke 7/7 · Jev re-run of the ruling-affected cases: TC-E10-010/012, TC-IM10-002/003/004, TC-IM11-005/006, TC-E14-001..003 PASS; TC-IM10-001 REVIEW 0.76 (same 0.77 on the D114 build — not a regression).
