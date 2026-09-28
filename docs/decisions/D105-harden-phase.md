# D105 — Phase 2c "harden": route contracts, security hardening, webhook tests, Jev triage, UAT pack (28 Sep 2026)

**Why.** 93 API routes and no test at the HTTP boundary; no security headers, Origin check, rate limits or upload caps; webhook HMAC/replay untested; 88 of 98 Jev failures unexplained; no UAT material for M18-S08. None of it needs the sandbox. Owner chose all four items and a second worktree so phase 2b keeps the 3 Oct target.

**Decided.**
- New phase `harden` ("2c. Test contracts and security hardening", type `Hardening`) between wire and test, listed in `phases.json` `parallel` so status.mjs forecasts it on its own clock; phase 3 starts when every clock has ended.
- New stories (S5, Must): **M18-S14** every route refuses at the door (401/403/4xx, masked fields, unlisted route fails); **M18-S15** security headers, Origin/Sec-Fetch-Site guard on writes, rate limits on sign-in/search/upload/webhooks with 429 + Retry-After, upload size/type caps, `npm audit --audit-level=high` in CI; **M19-S12** the 88 unexplained Jev failures each fixed or written up as FACT CHANGE PROPOSED.
- New subtasks on existing stories: **M12-S05-H5** webhook HMAC/replay/dead-letter tests; **M18-S08-H5/H6** UAT pack (per-seat scenario scripts with expected screen and Zoho state, entry criteria, sign-off sheet, defect intake).
- 5 units, assumed 150 min each (12.5 loop h); forecast finish 29 Sep on the side clock. Gate: tests exist and pass on demo data, typecheck + npm test pass, CI check job runs them.

**Run it.** On the laptop, from the main repo:
```
git -C "F:\Growize Business Unit\growize-console" worktree add "F:\Growize Business Unit\growize-console-harden" -b autopilot/harden autopilot/backend
echo harden> "F:\Growize Business Unit\growize-console-harden\autopilot\.phase"
```
then run /build in that worktree (next.mjs asks for one regression first). Merge autopilot/harden back into autopilot/backend when the 5 units are done; progress merges with merge-progress.mjs as for D100.

**Order of the rest.** Everything on the sandbox (40 ui-staging + 24 manual cases, staging-proof notes, migration dry run M18-S12/S06, backup/restore drill M18-S05, isolation proof against real Zoho sharing M03-S07/M18-S02) stays in phase 3 behind M02-S10; nothing to write now, only to sequence.
