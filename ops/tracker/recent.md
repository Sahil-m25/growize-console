*Updated 6 Oct 2026. Kept by the coordinator. Full record: `docs/decisions/D111`–`D123`.*

**Catalyst staging is live and signing in (6 Oct):**
- AppSail `growize-console` (India DC, Development) runs against the CRM sandbox Growize Staging only.
- Zoho sign-in verified end to end: an IR user lands on Today with the sandbox's leads.
- Four fixes on the way:
  - `CONSOLE_PUBLIC_ORIGIN` for the origin check behind AppSail;
  - the `ZohoCRM.org.READ` scope for the sandbox-org check;
  - sandbox users (type "Sandbox Developer User") allowed on sandbox deployments only;
  - staging-only refusal reasons (`GZ_SIGNIN_DEBUG=1`).
- **Deploy rule:** the deploy config carries no `env_variables`, so a deploy keeps the secrets entered in the Catalyst console. A deploy that carries them replaces every variable.
- To do:
  - switch `GZ_SIGNIN_DEBUG` off;
  - delete the test app `gz-envtest`;
  - move the client secret to a fresh OAuth client before anything goes live.

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

**Round 5 (D117):**
- Screens finished: Finance's Investors list on its route; IR payment reports on Payments and Today; Finance's paperwork queue ordered, with "Not signed after all"; agreed supplementary draft offered when sending.
- Audit trail: a reason is asked before showing a bank reference; app-access release and test sign-in links are logged in the audit trail.
- Farm releases are pushed to the investor app; an allotment can't be saved without its investor and farm.
- Live people list from Zoho users; System page now shows token expiry, cache errors and the last Zoho Sign event.
- Tests: 47 local test steps checked (7 fully proven, 38 local half proven, 2 missing documents); read-budget tests; 22 new or converted browser cases; one real bug fixed ("End access" on a lent page did nothing).
- **Phase 2b wiring: 66 of 66 done.**

**Round 6 (D118):**
- Hosting-ready: sign-in sessions and all other per-copy state on the shared store; a 25 s time limit on every request; statement upload, event sheet load and KAM seat change continue across requests instead of timing out.
- Money: one ledger function for register, Money section and replay; refunds and reversals replay correctly; adding a paid investor no longer writes its own hold; approving a refund asks for step-up.
- Tests: 1,070 API permission cases (no leak), an investor-app isolation test, tests for 18 untested case ids, 7 new browser cases; UAT usability pack and the UI test contract written.
- Roster: availability is now recorded and read; cover and event staffing use it (the screen controls still need wiring).

**Round 7 (D119):**
- **Full regression on the merged build: 378 of 379 browser cases pass, 0 fail** (one borderline case waits on the UTR masking ruling); per-seat suite 143/143; calibration 18/18.
- Roster live: the absence drawer and presence roster write through the availability service; the Team page shows Out / Back on; marking someone back in ends their covers (D44).
- Money: Finance's Investors list no longer counts Pending money as paid (D21); holds, Today, Numbers and the live data all read the one ledger; replay accepts Balance and Forfeit rows; demo add-paid starts no hold.
- Match opens step-up for a refund and retries; a continuing sheet load shows honest progress; every remaining double-press guard is shared across instances.
- Leak checker knows the console's masks; Head of Account Management in the call-budget tests.

**Sandbox and access (D120–D123, 5 Oct):**
- **Zoho sandbox "Growize Staging" is live** with the access wall applied (profiles, field security, sharing), 5 test users (IR A, IR B, KAM, Finance Ops, Compliance) and 132 seed records. The 7 Supabase/ARL sync workflows are off in the sandbox only.
- **Wall test with real logins: pass** for IR A/B, KAM and Finance Ops; Compliance reads pass. KYC writing is **parked** (owner).
- **KAM access is Zoho-native (D122):** naming a KAM on an investor shares it; a KAM Access field on allotments and touches is kept in step by Zoho workflows (KAM change, new allotment, new touch). The console's share service and its seat are **retired**.
- **Nightly safety net inside Zoho:** "GZ KAM Access Check Nightly" (02:00 IST) emails any record whose KAM/IR access is wrong. Last run: 80 records, 0 mismatches.
- **Cover windows, absence and IR hand-off on Zoho field sharing (D123):** no share-API calls; a secondary owner gets access only through Cover By (absence writes it); IR sees their own investors' allotments through IR Access, with price and amounts hidden and no receipts. **IR A login test: pass.**
- User-field sharing tightened: audit stamps no longer share; KAM and Originating IR editable only by Admin, AM Head and Digital Infrastructure.
- Decisions made with Jev (both option orders) plus an independent reviewer.

**Catalyst:** project **GrowizeConsole** created (India DC, Development environment, Asia/Kolkata); no app deployed yet. Deploy kit ready (`catalyst/README.md`, Docker image measured).

**Checks:** tsc clean · 775 + 3,250 tests pass · build ok · access-spec tests 15/15 · last full browser suite 378/379, 0 fail (D119).

**Waiting on the owner:**
- **Renew Zoho CRM Enterprise before 13 Oct** (A-20): field security, sandbox and sharing depend on it.
- For the Catalyst deploy: a Zoho **OAuth client** (Server-based, sandbox) with the Catalyst URL as redirect; the Catalyst CLI login; set `CONSOLE_SUPER_ADMIN_IDS` and the secrets.
- Fill in the rulings sheet (147 calls + 19 inputs) and the open rulings: UTR masking, step-up / second hand on payout "mark paid" and reversals, PAN mask form, hiding work buttons (TC-E07-022), Matched_By ≠ Created_By scope.
- Before live: approve the sandbox → live change set (fields, access spec, workflows, D122/D123), buy seats role by role (D54), tester seat and UAT users.

**Next:** deploy the console to Catalyst against the sandbox → run phase 2's 112 live proofs and phase 3's staging cases there → tester review and UAT → move the change set to live.
