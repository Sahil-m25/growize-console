# R6 missing tests (M19-S12-NOTE-7)

Every id below now has a test whose name carries it, or a reason it cannot run off staging.

| TC | Where it runs now | What is left for staging |
|---|---|---|
| TC-E01-009 | console/src/lib/zoho/rate-limit-cases.test.cjs | The real Retry-After Zoho sends |
| TC-E01-010, E01-011, IM01-019, IM12-006 | console/src/server/logs/identity-log-cases.test.cjs | None for the logs; live userId defect recorded as a todo (GAP) |
| TC-E07-022 | seat-refusal-cases.test.cjs (API); email.test.cjs | UI half fails locally, see proposed-cases.json |
| TC-E14-022 | manager-page-writes.test.ts (console half); UI case proposed | Zoho read-only profile and field-level security |
| TC-E15-001 | console/scripts/render-timing.mjs (measure) | Run on staging: warm timings exceed 300 ms in this sandbox |
| TC-E15-002 | load-test.test.cjs (harness half) | The live 15-minute load run |
| TC-E15-004, E15-024 | rate-limit-cases, identity-log-cases | A mail reaching Sahil's inbox |
| TC-E15-008 | sign-out-clean.test.ts | UI case not proposed (REVIEW) |
| TC-E15-010 | isolation.test.cjs (local half) | Zoho sharing with a restricted test user |
| TC-E15-011 | secrets-headers.test.cjs | None |
| TC-E16-013 | seat-refusal-cases.test.cjs; manager-page-writes.test.ts | None |
| TC-IM11-013 | none | Staging only: the Said-yes upsert is a Zoho-side function, not in this repo |
| TC-IM12-001 | documents, cases, investors-today, investors-side, read-budget tests | None |
| TC-IM12-015 | rate-limit-cases | None |
