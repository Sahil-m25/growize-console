*Updated 4 Oct 2026. Kept by the coordinator. Full record: `docs/decisions/D111`–`D116`.*

**How the build runs now (D111):** parallel agents, each in its own git worktree. Sonnet builds; Opus takes money, access, security, the Jev layer and integration. One coordinator merges the work, runs the checks and is the only one who updates this tracker. The autopilot loop is no longer used, because it kept stopping.

**Round 1–2 (D112):**
- New screens and routes.
- Offline Investors receipts, the Auditor's Activity view and the oversell guard fixed.
- Phase 3 local half started.

**Owner rulings (D113):**
- A Finance-recorded receipt is matched by Finance. The bank statement auto-matches where it can.
- IR sees investors through the Investors page.
- All test-wording changes approved.
- Farm ops persona kept.

**Round 3 (D114):**
- The D113 receipts rule built.
- IR Investors page.
- Smoke suite and flaky-test quarantine.
- Launch and ops docs: backup, go-live, runbook, guides, support, change control.
- Browser test suite **344 pass, 5 review, 0 fail of 349**.

**Hosting research (AP4 / D47, not decided):**
- **Zoho Catalyst AppSail** (India data centre) is the lead option. It needs code changes first, because AppSail recycles instances and its disk isn't kept.
- **PostHog** is fine for everyday logs. Neither PostHog nor **Datadog** can hold the audit trail, and neither has an India region.
- **Catalyst cost** at our size:
  - **~₹1,250–1,500/month** running in business hours (Basic plan ₹1,500);
  - ~₹3,450 kept warm 24×7;
  - ~₹6,900 at worst (2 GB).
- A 1-day Catalyst trial is waiting for a Catalyst project in the India data centre and a CLI login.

**Owner rulings (D115):**
- App access stays **Hold until released** with "Send welcome and unlock". A match never opens it.
- Loading an event sheet is the **super administrator's** right, and he can grant it.
- The rights grid shows **seats as columns** (8 Investors seats, each labelled with its Zoho role).
- Provisional calls go to one rulings sheet for bulk approval.

**Round 4 (D116):**
- Tracker reconciled with the code: **410 → 354 open**, 7 wire units moved to done.
- Code gaps closed:
  - live System checks (`/api/system`);
  - mail attachments for the deck;
  - Consent_How uses Zoho's own picklist values;
  - Consent_Visit is no longer read;
  - searches logged as successes, and reveals logged with a reason.
- D115 built.
- Catalyst prep done without an account:
  - shared state store;
  - audit-log storage with a hash chain;
  - Docker image (135 MB, healthy at 512 MB);
  - 30-second limit audit.
- **Blocker for Catalyst:** sign-in sessions are still kept in memory.

**Checks:** tsc clean · 635 + 1,851 tests pass · build ok · smoke 7/7.

**Waiting on the owner:**
- Fill in the rulings sheet: 147 calls plus 19 inputs (KPIs, support response times, on-call).
- Decide whether the Zoho rule Matched_By ≠ Created_By should apply to refunds only.
- Set `CONSOLE_SUPER_ADMIN_IDS`.
- The Zoho sandbox, test user and tester seat.
- Catalyst project access.

**Next local work:**
- Move sessions into the shared store.
- Add a request time limit and fix the 3 actions that can exceed 30 s.
- Record the 47 test steps that can run here.
- M12-S11 (Finance's paperwork queue).
