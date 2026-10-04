::: {.callout}
**Updated 05 Oct 2026 00:27 IST** from the build itself (autopilot progress). Statuses are not edited here; comment on a row instead.
:::

# :compass: Where we are

**Goal:** the whole Growize Console (lead side and Investors side, one app on Zoho), built in phases: **front end first, then plug into Zoho, then wire the screens to it, then test**. Owner's build target ![](slack_date:2026-10-03).

**Now working on:** 3. Test and harden — API cases, staging cases on the Zoho sandbox, the full regression, tester review and UAT.

**Also running in parallel:** 2. Plug into Zoho — the backend worktree (branch autopilot/backend) builds the Zoho layer; screens are wired to it after phase 1.

|Phase|Done (proven)|Waiting on people|Review|Left for the loop|Loop hours left|Forecast finish|Pace|
|---|---|---|---|---|---|---|---|
|**1. Front end on demo data**|92 of 92 (100%)|0 (0%)|0|0|0|done|0 min/unit measured|
|**2. Plug into Zoho**|7 of 119 (6%)|112 (94%)|0|0|0|done|10.4 min/unit measured|
|**2b. Wire screens to the API**|66 of 66 (100%)|0 (0%)|0|0|0|done|assumed until 5 rounds|
|**2c. Test contracts and security hardening** :twisted_rightwards_arrows: parallel worktree|7 of 7 (100%)|0 (0%)|0|0|0|done|assumed until 5 rounds|
|**3. Test and harden** :arrow_left:|47 of 145 (32%)|84 (58%)|0|14|3.5|![](slack_date:2026-10-05)|assumed until 5 rounds|

|Forecast|Date|
|---|---|
|All three phases through the loop|![](slack_date:2026-10-05)|
|People's testing and UAT (a dated stage, not a tag: starts only when the sandbox is live, the wiring phase is through and the smoke suite is green)|![](slack_date:2026-10-05) → ![](slack_date:2026-10-11)|
|Status|:red_circle: Behind the target|

::: {.callout}
**What each phase needs from people.** Phase 1 needs nothing. Phase 2 cannot be proven without the Zoho **sandbox**, an **OAuth client** for the console and a licensed **test user** (Sahil, in BLOCKED.md); its code is written and unit-tested, so it sits in *Waiting on people*, not *Done*. Phase 2b wires each screen to its API route on demo data and needs nothing. Phase 3 needs the sandbox for every live proof, then the tester's reviews and UAT by the business users (M18-S08).
:::

Phases 1 and 2 run at the same time in two windows; phase 3 starts when both are through. Forecast = loop hours left ÷ 14 loop hours a day. Minutes per unit are assumptions until each phase has 5 measured rounds; then the measured pace takes over. Stories count once per phase they have work in.

# :newspaper: Recent developments

*Updated 4 Oct 2026. Kept by the coordinator. Full record: `docs/decisions/D111`–`D119`.*

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

**Checks:** tsc clean · 767 + 3,221 tests pass · build ok · smoke 7/7 · full browser suite 378/379, 0 fail.

**Waiting on the owner:**
- Fill in the rulings sheet: 147 calls plus 19 inputs (KPIs, support response times, on-call).
- Decide whether the Zoho rule Matched_By ≠ Created_By should apply to refunds only.
- Set `CONSOLE_SUPER_ADMIN_IDS`.
- The Zoho sandbox, test user and tester seat.
- Catalyst project access.
- Rule: is the receipt UTR masked everywhere; do payout "mark paid" and reversals need step-up / a second hand; PAN mask form (first 3 + last 1 vs last four); hide work buttons for seats without lead-work rights (TC-E07-022).

**Next local work:** essentially none left without accounts or decisions — a few small notes (error-log user id from the sealed session, lapse receipts arithmetic, demo selectors) are in BLOCKED.md.

**Latest decisions**

- **D114** (4 Oct 2026): Round 3 on the 4 Oct rulings: receipts matched by Finance built, IR Investors page, fact changes applied (UI suite 344/349, 0 FAIL), smoke suite + flake quarantine, launch/ops docs, 3 bugs fixed
- **D115** (4 Oct 2026): Owner rulings 4 Oct (second set): app access stays Hold until released (a match never opens it); event-sheet load is the super administrator's right (grantable); rights grid = 8 Investors seats as columns labelled with their Zoho role; provisional calls bulk-reviewed on one sheet; decisions index gap filled from the project docs
- **D116** (4 Oct 2026): Round 4: tracker reconciled with the code; code gaps closed (/api/system, mail attachments, Consent_How picklist, Consent_Visit dropped, log success kind, reveal reason); D115 built; host-agnostic prep for Catalyst (shared-state interface + NoSQL adapter, log sink + Stratus adapter + Plane C hash chain, standalone Docker image, 30 s audit)
- **D117** (4 Oct 2026): Round 5: unwired screens finished (Finance list, claims on Payments/Today, Finance paperwork queue, agreed draft offer), audit-trail actions (reveal reason, app-access release, test link), farm push + allotment guard, live people list, System facts; 47 local test subtasks checked, read-budget tests, 22 browser cases; phase 2b 66/66
- **D118** (4 Oct 2026): Round 6: sessions and per-instance state on the shared store, request deadline and resumable long routes, one signed money ledger (refunds/reversals), add-paid hold removed, refund step-up; API seat matrix (1,070 cases, no leak), outbound isolation, missing TC tests, fixtures + cases, UAT usability pack, UI test contract, mapping rows, roster reader
- **D119** (5 Oct 2026): Round 7: roster UI live with cover ending on return (D44), one ledger everywhere (Finance list no longer counts Pending), Balance/Forfeit in replay, refund step-up panel, honest sheet-load progress, all idempotency guards shared; full UI regression 378/379 PASS + per-seat 143/143, 0 FAIL, calibration 18/18

## Stages

|Stage|What it delivers|Stories|Done|Forecast done|
|---|---|---|---|---|
|S0|Zoho org build-out and access wall|18|8|![](slack_date:2026-10-05)|
|S1|Foundations, access, test suite|23|14|![](slack_date:2026-10-05)|
|S2|Lead side daily work and Investors pages|30|22|—|
|S3|Journey, gates, money, paper, Zoho Sign, farms|43|21|—|
|S4|Updates, tickets, app push, activity, numbers, teams|24|19|—|
|S5|Hardening, UAT, migration, release|17|6|![](slack_date:2026-10-05)|

# :calendar: Month by month

|Month|Stories finished|Forecast to finish|Cumulative forecast|
|---|---|---|---|
|September 2026|9|0|9 of 155|
|October 2026|81|14|104 of 155|

# :spiral_calendar_pad: Week by week

|Week of|Finished|Forecast|Cumulative|Burn-up|
|---|---|---|---|---|
|![](slack_date:2026-09-21)|2|0|2|:white_large_square::white_large_square::white_large_square::white_large_square::white_large_square::white_large_square::white_large_square::white_large_square::white_large_square::white_large_square: 1%|
|![](slack_date:2026-09-28)|88|0|90|:large_green_square::large_green_square::large_green_square::large_green_square::large_green_square::white_large_square::white_large_square::white_large_square::white_large_square::white_large_square: 58%|
|![](slack_date:2026-10-05) **(this week)**|0|14|104|:large_green_square::large_green_square::large_green_square::large_green_square::large_green_square::large_green_square::white_large_square::white_large_square::white_large_square::white_large_square: 67%|

## This week

**Finished (0):** none yet

**Planned by the forecast (14):** M19-S02, M02-S05, M02-S06, M02-S08, M02-S09, M02-S10, M02-S12, M20-S08, M02-S07, M01-S05, M03-S05, M03-S09, M18-S06, M18-S12

**Stuck: review or waiting on people (51):**

- **M01-S01** One Next.js shell with the rail built from the person's seat (waiting)
- **M01-S08** Every write goes through commit(): one press, one record, 'Not saved yet' when it cannot l (waiting)
- **M01-S10** Step-up before a reveal, an export or money leaving, with a second hand on refunds (waiting)
- **M02-S01** Enterprise renewed and seats ordered (waiting)
- **M02-S04** Roles, profiles, Private sharing and the field-level security wall for every seat (waiting)
- **M03-S06** The Auditor (viewer) reads and never writes (waiting)
- **M03-S07** Key account managers see and work only their own accounts (waiting)
- **M03-S08** Compliance owns KYC (waiting)
- **M04-S03** Contact permission at capture (waiting)
- **M05-S04** Call times and reschedule (waiting)
- **M05-S08** Account Management's Today (Investors side) (waiting)
- **M08-S03** Money in: the IR reports a payment, Finance records the receipt (waiting)
- **M08-S04** Reservation hold: clock, balance due, extend and release (waiting)
- **M08-S07** 'Said yes' becomes the investor record (waiting)
- **M08-S08** The first matched advance opens the investor app account (waiting)
- **M09-S02** KAM book and Head of AM book (waiting)
- **M09-S03** The investor record — header, banners and sections by seat (waiting)
- **M09-S04** Who looks after the account — KAM ownership (waiting)
- **M09-S08** An IR sees only investors from their own leads (waiting)
- **M10-S01** Payments register (waiting)
- **M10-S02** Match a receipt — the second hand (waiting)
- **M10-S05** Weekly bank statement upload and reconciliation (waiting)
- **M10-S07** Receipts belong to the allotment (investor × farm) (waiting)
- **M11-S01** Farms are the LLP shelf (waiting)
- **M11-S02** An allotment links an investor to a farm LLP (waiting)
- **M11-S03** The shelf — released, held and free per farm LLP (waiting)
- **M11-S05** Allotment on the verified allocation letter (waiting)
- **M11-S07** No unit is sold twice — the oversell guard (waiting)
- **M12-S01** Documents in three scopes, with who sees what (waiting)
- **M12-S02** Upload a document straight from the console to Zoho (waiting)
- **M12-S03** Documents page: out for signature and on file, scoped to the seat (waiting)
- **M12-S04** Send a document for signature through Zoho Sign (waiting)
- **M12-S06** Signed PDF filed to the allotment and Agreement_Signed set (waiting)
- **M12-S10** Isolation suite: no user sees another user's leads, investors, documents, sign requests, e (waiting)
- **M12-S11** NDA loop on the lead page, and the IR's word beside Finance's queue (waiting)
- **M13-S02** Tickets register scoped by seat (waiting)
- **M13-S03** Open, wait and close a ticket (waiting)
- **M13-S04** A KAM hands a bank or compliance ticket to Finance and keeps watching (waiting)
- **M13-S06** Publish an investor update to a reconstructable segment (waiting)
- **M14-S01** Events list and event page (waiting)
- **M15-S03** Activity page: who did what, each seat its own scope, Lead side | Investors side (waiting)
- **M18-S01** The app stays fast inside Zoho's API limits (waiting)
- **M18-S02** Nothing leaks outside a seat's scope: seat x page x action x field matrix (waiting)
- **M18-S03** Every page works on a phone and by keyboard (waiting)
- **M18-S05** Data and logs are backed up and restorable (waiting)
- **M18-S08** Exploratory sessions and UAT signed off on both sides (waiting)
- **M18-S09** Go-live by checklist with a runbook and a rehearsed rollback (waiting)
- **M18-S10** Runbook and hypercare (waiting)
- **M19-S07** Smoke suite and production check (waiting)
- **M19-S11** Regenerate the Jev UI cases against the merged console: super user and per seat (waiting)
- **M20-S03** Training and quick guides (waiting)

# :mag: What exists today (28 Sep, after phase 1)

|Layer|State|
|---|---|
|Front end (screens)|94 stories built, 15 partly, 0 not started, 42 have no screen|
|Lead side screens|Re-ported to the merged prototype, screen for screen: sign-in (Continue with Zoho stub), Today, Leads, lead page, Add lead/CSV, Find, Events, Activity, Updates, Teams and the D60 access model, Profile, System, Numbers, Plan, Transfers, Payments, Documents|
|Investors side screens|Built from the prototype and merged into the one console: Today (Finance and Account Management), Investors list and record, Farms and allotments, Payments and receipts (Match it), monthly payouts, Documents (upload, signature status), Tickets, Investor updates, app access, app preview, test sign-in link, Numbers, Activity, Teams, System|
|Connected to Zoho|No screen reads or writes Zoho yet (phase 2). Every page reads one data interface (console/src/lib/data): a normal run starts empty; demo data loads only with FIXTURE_MODE=local|
|Zoho org|Modules and fields in place (M02 done items); still open: profiles per seat, field-level security (PAN not encrypted, only Administrator and Standard profiles exist), sharing rules, test user, sandbox and OAuth client|
|Tested by Jev|Full suite 28 Sep: app 221 of 319 pass (69%) vs the merged prototype 218 (68%), run the same evening; calibration 18/18 caught. Cases failing on both are mostly facts written for the old portal or the pre-merge console (fact changes proposed in BLOCKED.md). Per-epic table: docs/reports/phase1-jev-2026-09-28.md|

# :dart: Epics

|Epic|Stage|Stories|Done|Progress|Goal|
|---|---|---|---|---|---|
|**M01** Foundations & the one app shell|S1|10|6|:large_green_square::large_green_square::large_green_square::white_large_square::white_large_square: 60%|One Next.js + TypeScript app, one sign-in, one rail built from the seat, live Zoho reads through one client with scope-keyed cache, honest s|
|**M02** Zoho org build-out|S0|14|5|:large_green_square::white_large_square::white_large_square::white_large_square::white_large_square: 36%|The one Enterprise org ready for both sides before any second seat: fields, modules, the FLS wall, Receipts, document slots, Zoho Sign field|
|**M03** Access, seats & super user|S1|9|4|:large_green_square::large_green_square::white_large_square::white_large_square::white_large_square: 44%|Who may sign in and what each seat may read and do on both sides, enforced by Zoho and the data layer; Sahil as super user with PII masked; |
|**M04** Lead capture|S2|4|3|:large_green_square::large_green_square::large_green_square::white_large_square::white_large_square: 75%|Leads added one at a time, by CSV or from an event sheet, with duplicates refused and contact permission recorded.|
|**M05** Today (both sides)|S2|7|5|:large_green_square::large_green_square::large_green_square::white_large_square::white_large_square: 71%|One Today page with a 'Lead side / Investors side' switch: the IR's follow-ups and paperwork moves, and Finance's and Account Management's d|
|**M06** Leads book & lead search|S2|4|4|:large_green_square::large_green_square::large_green_square::large_green_square::large_green_square: 100%|Each person sees their own book of leads as an ordered list with honest counts, and finds a lead from the top bar — leads only, inside their|
|**M07** Lead page|S2|7|7|:large_green_square::large_green_square::large_green_square::large_green_square::large_green_square: 100%|One lead page where an IR sees the next step, reaches the investor, logs a contact once with Undo, emails through Zoho, closes as lost and r|
|**M08** Journey, gates & hand-offs between the sides|S3|7|3|:large_green_square::large_green_square::white_large_square::white_large_square::white_large_square: 43%|The lead's journey is true in Zoho, money gates are opened only by Finance, and Said yes hands the investor to the Investors side of the sam|
|**M09** Investors & the investor record|S2|7|3|:large_green_square::large_green_square::white_large_square::white_large_square::white_large_square: 43%|One Investors page and one sectioned investor record, scoped per seat: Finance sees the book, a KAM their accounts, an IR only the investors|
|**M10** Payments & receipts|S3|11|7|:large_green_square::large_green_square::large_green_square::white_large_square::white_large_square: 64%|Every rupee is a Receipt linked to an allotment (investor × farm LLP), recorded by Finance, matched by a second person, reconciled against t|
|**M11** Farms (the LLP shelf) & allotments|S3|6|1|:white_large_square::white_large_square::white_large_square::white_large_square::white_large_square: 17%|Farms are the LLP records in Zoho (LLP_Creation_Module): the shelf counts free units off the records, and every allotment links an investor |
|**M12** Documents, upload & Zoho Sign|S3|14|7|:large_green_square::large_green_square::white_large_square::white_large_square::white_large_square: 50%|Every document lives in Zoho in one of three scopes (personal on the Contact, per allotment, per farm LLP), is uploaded straight from the co|
|**M13** Tickets & investor updates (pushed to the investor app)|S4|6|2|:large_green_square::white_large_square::white_large_square::white_large_square::white_large_square: 33%|Tickets (Zoho Cases) and investor updates are worked in the console and reach the existing investor app through the signed event contracts, |
|**M14** Events|S3|3|2|:large_green_square::large_green_square::large_green_square::white_large_square::white_large_square: 67%|Events are the lead side's diary (Lead_Events module, D85): list, event page, add/correct/remove by the IR Manager, capture and CSV/sheet lo|
|**M15** Updates & Activity|S4|3|2|:large_green_square::large_green_square::large_green_square::white_large_square::white_large_square: 67%|People see what others changed on their book (bell and Updates), managers review who did what on one Activity page with a Lead side / Invest|
|**M16** Numbers, Plan & Transfers|S4|8|8|:large_green_square::large_green_square::large_green_square::large_green_square::large_green_square: 100%|One Numbers page with a Lead side / Investors side switch, a Plan page and a Transfers page, all worked out live from Zoho within the viewer|
|**M17** Teams, Profile & System|S4|4|4|:large_green_square::large_green_square::large_green_square::large_green_square::large_green_square: 100%|Admin pages of the one app: Teams (members plus an Investors side seats section), seat and page grants, temporary access, own profile, Syste|
|**M18** Hardening, security & release|S5|12|3|:large_green_square::white_large_square::white_large_square::white_large_square::white_large_square: 25%|Prove the one app is fast inside Zoho's limits, leaks nothing across seats or users, works on a phone and by keyboard, fails visibly, can be|
|**M19** Quality — Jev UI suite|S1|12|9|:large_green_square::large_green_square::large_green_square::white_large_square::white_large_square: 75%|A Jev UI suite that runs the same plain-language cases against the merged prototype (growize-console-merged.html) and the built app, per sea|
|**M20** Launch readiness & operations|S0|7|5|:large_green_square::large_green_square::large_green_square::white_large_square::white_large_square: 71%|The brief, KPIs, status rhythm and change control that keep the plan honest, the guides and support model for go-live, and the two outside p|
# :card_index_dividers: Backlog in BLOCKED.md — 354 open, 216 ticked

|Kind|Open|What it is|
|---|---|---|
|FRONT-END LOOP|0|Screens to wire to their API route (now phase 2b units)|
|PROVISIONAL|131|Choices the build made at low confidence — owner confirms or reverses|
|FACT CHANGE PROPOSED|30|Test cases that contradict a decision — owner rules, then the case changes|
|BLOCK|7|Do-not-activate blocks (a design or decision gap)|
|STAGING PROOF|4|Proofs to run on the sandbox|
|OWNER ACTION|2|Owner actions in Zoho|
|Tasks for people|19|Sahil 11, Autopilot 7, Tester 1|
|Other notes|161|Zoho fields/modules the code expects, secrets and config, staging steps|

Decisions waiting on the owner = PROVISIONAL + FACT CHANGE PROPOSED. Tick a line in BLOCKED.md when it is done; the loop reads the ticks.


# :hammer_and_wrench: People's to-do (from the build)

Open items only a person can do. Full text: autopilot/console/BLOCKED.md. Provisional calls and fact changes are on the rulings sheet (docs/reports/rulings-sheet-*.csv), not here.

**Tasks for people (12)**

- [ ] M02-S01-T01 (M02-S01, Sahil, Before its story (do early)) Renew Enterprise and buy the test-user seat — Renew the Enterprise subscription (annual) before 13 Oct; add one user licence for the restricted test user; save the invoice …
- [ ] M02-S04-T02 (M02-S04, Sahil, Before its story (do early)) Profiles per seat — One profile per seat of both sides, module permissions per SEATCAPS (no Convert/Export/Mass delete for IR); API access on (T7); Sahil's profile with …
- [ ] M02-S04-T03 (M02-S04, Sahil, Before its story (do early)) Field-level security wall — Encrypt pan and bank_account on Contacts; pan readable by Head of Finance and Compliance, bank by Head of Finance and Finance; hide pan, bank, …
- [ ] M02-S04-T04 (M02-S04, Sahil, Before its story (do early)) Private sharing and B-12 rules — Default sharing Private on Leads, Contacts and custom modules; IR Manager read on IR subtree via hierarchy; Finance → Leads sharing rule …
- [ ] M02-S06-T01 (M02-S06, Sahil, Before its story (do early)) Remove Convert permission — Untick Convert Leads on every profile; confirm no workflow converts.
- [ ] M02-S10-T02 (M02-S10, Sahil, Before its story (do early)) Register OAuth clients — In Zoho API Console, register separate server-based clients for staging/sandbox and production. Add only each deployment's exact HTTPS OAuth …
- [ ] M20-S08-T01 (M20-S08, Sahil, Before its story (do early)) Plan choice and purchase request — In sign.zoho.in, compare the Enterprise and API plans using ARL's expected annual envelope volume. Require API access, HMAC-secured …
- [ ] M20-S08-T02 (M20-S08, Sahil, Before its story (do early)) OAuth client and secrets — After the paid Sign plan is active, update the India-DC OAuth clients with only ZohoSign.documents.CREATE, ZohoSign.documents.READ, …
- [ ] M03-S05-T01 (M03-S05, Sahil, Before its story (do early)) Buy seats and invite users — First complete the Enterprise renewal and single restricted-test-user licence in M02-S01-T01; that test seat must exist before T11. Only after …
- [ ] M03-S07-T01 (M03-S07, Sahil, Before its story (do early)) Sharing for KAM books — Private default on Contacts; KAM access by owner/kam lookup sharing rule; Head of AM above KAMs in the hierarchy.
- [ ] M05-S04-T02 (M05-S04, Tester, Testing phase) Test call times (Sat–Sun) — Run TC-E05-010..011; manual check of the reminder in Zoho CRM calendar.
- [ ] M03-S05-T02 (M03-S05, Sahil, Before its story (do early)) Digital Infrastructure profile for Sahil (non-admin) — Create profile "Digital Infrastructure" with every module of both sides and no Administrator; move Sahil's user onto …

**Zoho and setup steps for the owner (66)**

- [ ] M18-S04-NOTE-1 (M18-S04) HUMAN: Choose the alert email provider, set ALERT_EMAIL_TO to Sahil's address and plug a real AlertMailer in with setAlertMailer() in console/src/server/ops/runtime.ts; until …
- [ ] M10-S01-NOTE-2 (M10-S01) HUMAN: Sahil completes Receipts (M10-S01-T01) by adding Contact and LLP lookups, Kind values Balance and Forfeit, Matched_At, Claim_Id and a unique Idempotency_Key (needed by …
- [ ] M10-S01-NOTE-3 (M10-S01) HUMAN: Finance supplies a JSON file mapping each legacy UTR to its mode (NEFT/RTGS/IMPS/SWIFT/UPI/Cheque), kept out of the repo; the migration halts on any UTR not listed.
- [ ] M10-S07-NOTE-1 (M10-S07) HUMAN: Live proof needs M10-S07-T01 in Zoho (Receipts Contact/LLP lookups filled by Deluge, Payment_Status with values Yet to initiate/Partial/Full and its workflow on …
- [ ] M03-S09-NOTE-2 (M03-S09) HUMAN: The handoff-share service credential (AP4) and a caller at the said-yes hand-off in server/leads are needed before record shares run; prove on the Zoho sandbox …
- [ ] M03-S09-NOTE-3 (M03-S09) HUMAN (T04): Sahil creates two restricted IR test users on the sandbox for the API/UI scope probes.
- [ ] M07-S05-NOTE-1 (M07-S05) HUMAN: Set ORG_EMAIL_DOMAINS=agresearchlabs.com and FOLLOWUP_UNDO_SECRET (32+ characters) in the server secret store, and confirm the user scopes include …
- [ ] M01-S10-NOTE-1 (M01-S10) HUMAN: Build the T03 Zoho approval process on Allocation_Status -> Cancelled and refund Receipts (approvers the tech lead and Pradeep), then set GZ_RELEASE_APPROVAL=on; until …
- [ ] M01-S10-NOTE-2 (M01-S10) HUMAN: Register https://<deployment>/api/auth/step-up/callback as a redirect URI on the Zoho OAuth client, set ZOHO_STEPUP_REDIRECT_URI, and set STEPUP_ALERT_TO (Sahil and …
- [ ] M09-S02-NOTE-1 (M09-S02) HUMAN: Set Contacts to Private sharing with role hierarchy Head of AM > KAMs (KAM reads Contacts where KAM = self; Head of AM reads allotted Contacts and the pool) and prove …
- [ ] M09-S02-NOTE-2 (M09-S02) HUMAN: ZOHO_SEAT_IDS must carry the 'Head of Account Management' role id and the 'AM Head' profile id, or the Head of AM's book is refused as seat-denied.
- [ ] M08-S07-NOTE-1 (M08-S07) HUMAN: Build the Contacts lifecycle blueprint Said yes -> Reserved -> Paid -> Allotted, the arl_code auto-number, and stop native Lead conversion (T01); no lifecycle field …
- [ ] M08-S02-NOTE-2 (M08-S02) HUMAN: Confirm the IR profile can read the Contact, allotments and Receipts of its own converted lead (the M03-S09 hand-off share); a covering IR who is not the …
- [ ] M08-S05-NOTE-2 (M08-S05) HUMAN: Create the cover-window-share service grant and set ZOHO_COVER_WINDOW_SHARE_REFRESH_TOKEN; without it a cover window is written with shared false and no Zoho record …
- [ ] M11-S01-NOTE-3 (M11-S01) HUMAN: Sahil writes the Block A-F to LLP mapping (T01); production holds one LLP, EKA LLP (22 units, 19 issued), with no Block_Code set.
- [ ] M13-S02-NOTE-2 (M13-S02) HUMAN: Sahil adds app_request_id to Cases and an Investor (or App) value to Case_Origin, which today holds only Email, Phone and Web (T01).
- [ ] M13-S01-NOTE-2 (M13-S01) HUMAN: Supply the investor app's staging URL (INVESTOR_APP_URL) and the shared CONTRACT_SIGNING_KEY (MA1); until then the console pushes to the in-process stub.
- [ ] M15-S03-NOTE-3 (M15-S03) HUMAN: Choose the AWS account and bucket for S3 Object Lock (D14, AP4); create ZOHO_AUDIT_ARCHIVE_REFRESH_TOKEN with audit-log export and Users read scopes, and schedule …
- [ ] M19-S06-NOTE-1 (M19-S06) HUMAN: TC-E16-011 (rule tests reported on every push) is proven only once the repo is pushed to GitHub and .github/workflows/pipeline.yml runs.
- [ ] M01-S05-NOTE-1 (M01-S05) HUMAN: AP4 hosting account is not chosen, so both Deploy steps in .github/workflows/pipeline.yml are failing placeholders and the staging/production jobs stay skipped until …
- [ ] M01-S05-NOTE-2 (M01-S05) HUMAN: Create GitHub Environments 'staging' and 'production' with the secrets and variables in ops/env/README.md, using separate sandbox and live OAuth clients; push the repo …
- [ ] M19-S05-NOTE-1 (M19-S05) HUMAN: Turn on branch protection for main requiring the 'check' status, add Required reviewers to the 'production' Environment, and add secrets JEV_STAGING_CONFIG_JSON, …
- [ ] M03-S04-NOTE-1 (M03-S04) HUMAN: Create the 'kam-pool-return' service grant (ZohoCRM.coql.READ + ZohoCRM.modules.contacts.READ on a profile that sees every Contact, identity fields hidden) and set …
- [ ] M03-S04-NOTE-2 (M03-S04) HUMAN: Add ZohoCRM.users.UPDATE to the user OAuth client (M02-S10-T02), give the AM Head and Finance Head profiles 'Manage Users', and confirm on the sandbox that PUT …
- [ ] M09-S04-NOTE-1 (M09-S04) HUMAN: In Zoho add a Contacts workflow 'KAM changed -> clear KAM_Intro_At', turn on field history for Contacts.KAM, and let only the AM Head profile edit KAM and KAM_Since.
- [ ] M09-S08-NOTE-1 (M09-S08) HUMAN: In Zoho stamp Contacts.Originating_IR with the lead owner at Said yes, add the sharing rule 'IR role reads Contacts where Originating_IR = self' under Private sharing, …
- [ ] M11-S02-NOTE-3 (M11-S02) HUMAN: Hide the older LLP_Unit_Allocation module from console profiles so only LLP_UnitAllocation_Module (related lists Customer1 / Customer_List) is used.
- [ ] M08-S03-NOTE-3 (M08-S03) HUMAN: Add a unique Idempotency_Key text field to Receipts, and set RECEIPT_IDEMPOTENCY_SECRET and RECEIPT_CONTEXT_SIGNING_SECRET (each 32+ bytes, different); until then …
- [ ] M14-S03-NOTE-2 (M14-S03) HUMAN: Sahil names the tablet intake sheet source and sets Lead_Events.Load_State to Ready when a sheet is ready; nothing sets it today.
- [ ] M13-S06-NOTE-3 (M13-S06) HUMAN: Sahil adds the custom function refusing Statement and Compliance updates from Account Management profiles (T01).
- [ ] M10-S23-NOTE-2 (M10-S23) HUMAN: MA1 must name the investor app's generate-link endpoint and its 'link used' receiver, then a contract is declared in contracts/.
- [ ] M11-S03-NOTE-2 (M11-S03) HUMAN: Sahil sets up roll-ups or formulas for reserved, issued and available on the LLP (T01) so KAM/IR tokens read org-true counts; until then those seats get countsComplete …
- [ ] M12-S01-NOTE-3 (M12-S01) HUMAN: Sahil sets the T02 profile permissions and sharing so Attachments on Contacts, allotments and LLPs follow the scope table, and proves them with the restricted user.
- [ ] M13-S05-NOTE-4 (M13-S05) HUMAN: The investor app must send actor.investor_contact_id on every request.raised; confirm with the app team together with MA1's Supabase-user-to-Contact mapping.
- [ ] M10-S20-NOTE-2 (M10-S20) HUMAN: Investor_Payouts has no unique field; make Name (<allotmentId>-NN) unique so concurrent schedule runs can never duplicate an instalment.
- [ ] M08-S04-NOTE-1 (M08-S04) HUMAN: Build Zoho approval processes on LLP_UnitAllocation_Module for the extend edit (Hold_Until + Hold_Extension_State=Requested) and the lapse edit …
- [ ] M08-S08-NOTE-2 (M08-S08) HUMAN: Sahil finishes T01 - App_Account_Mark is a plain picklist and there is no permanent_at field; the console sets Tentative on the first match and leaves Permanent to …
- [ ] M10-S05-NOTE-1 (M10-S05) HUMAN: Create a Statements module (Finance-only, Attachments, fields Name, Period_From, Period_To, Lines, Lines_Matched, Lines_Needs_Owner) and set ZOHO_STATEMENTS_MODULE; …
- [ ] M11-S04-NOTE-1 (M11-S04) HUMAN: Install zoho/deluge/take_back_guard.dg as a validation rule function on LLP_Creation_Module.Units_Released (sandbox, then production) with the growize_crm connection …
- [ ] M11-S07-NOTE-1 (M11-S07) HUMAN: Install zoho/deluge/oversell_guard.dg as a validation rule function on LLP_UnitAllocation_Module (Reserved_Units, Issued_Units, LLP) with the growize_crm connection …
- [ ] M13-S04-NOTE-1 (M13-S04) HUMAN: Create Cases fields Handed_By (user lookup, lookup sharing Read Only) and Handed_At (DateTime) and turn on field history for Owner and Handed_By; the Tickets register …
- [ ] M13-S04-NOTE-4 (M13-S04) HUMAN: File the cancelled cheque as a personal document on the Contact (Bank_Proof) with the KAM profile denied access, never on the Case (T02, D70).
- [ ] M12-S04-NOTE-1 (M12-S04) HUMAN: Zoho Sign API plan with webhooks on sign.zoho.in (AP3) and ZohoSign.documents scopes added to the staff OAuth client, since send, remind, recall and the status read …
- [ ] M12-S04-NOTE-2 (M12-S04) HUMAN: Finance's Zoho Sign templates (MA2) each with exactly one SIGN action and Aadhaar eSign set inside the template, because the API has no Aadhaar key and an uploaded PDF …
- [ ] M12-S06-NOTE-1 (M12-S06) HUMAN: The provider-callback service profile needs write on the slot file fields and *_Verified_At (FLS, T01), and each slot file field must accept the signed PDF.
- [ ] M12-S08-NOTE-2 (M12-S08) HUMAN: The investor app codebase, CONTRACT_SIGNING_KEY, its origin (INVESTOR_APP_URL or SIGN_EMBED_HOSTS) and its Supabase-user-to-Contact mapping (MA1).
- [ ] M11-S05-NOTE-1 (M11-S05) HUMAN: Create the Allotment blueprint on LLP_UnitAllocation_Module Allocation_Status Reserved -> Issued (T01) with conditions Alloc_Letter_Verified_At set, balance due 0, KYC …
- [ ] M12-S11-NOTE-1 (M12-S11) HUMAN: Create on Leads the proposed round fields NDA_Told_Via (Call/WhatsApp/Email), NDA_Told_At, NDA_Told_By, NDA_Chase_Count, NDA_Last_Chase_At, NDA_Last_Chase_Via, …
- [ ] M12-S12-NOTE-1 (M12-S12) HUMAN: Create on Leads Supp_Draft_Version, Supp_Draft_Ref, Supp_Draft_At, Supp_Draft_By, Supp_Agreed_Ref, Supp_Agreed_Version, Supp_Agreed_At, Supp_Agreed_By (proposed; not …
- [ ] M12-S13-NOTE-1 (M12-S13) HUMAN: Create Leads.Pitch_Deck_Sent_At (datetime, IR-editable) and put the approved pitch deck (MA4) in Zoho so its file id can be attached.
- [ ] M20-S07-NOTE-2 (M20-S07) OWNER: confirm with Zoho support whether a portal-user token/API exists before closing MA1; the spike read docs through a summarising fetch, so "not found" is not proof of …
- [ ] M10-S02-NOTE-8 (M10-S02) HUMAN: M10-S02-NOTE-3 (Zoho validation rule Matched_By ≠ Created_By) must apply to refunds only, or not be created — for all receipts it would block D113.
- [ ] M19-S07-NOTE-1 (M19-S07) HUMAN: mint a saved Jev session for Meena (Investors side) for the staging smoke; a long-lived session or test user is needed for the hourly production check; …
- [ ] M20-S01-NOTE-1 (M20-S01) OWNER: 7 KPI targets, who enters Sales_Plans values and who signs the brief are open (docs/launch/product-brief.md).
- [ ] M20-S04-NOTE-1 (M20-S04) OWNER: agree the proposed support response times, the support mailbox/form and where the defects list lives after go-live.
- [ ] M12-S13-NOTE-5 (M12-S13) HUMAN: upload the approved deck through the Zoho Files API and set GROWIZE_DECK_FILE_ID (sandbox and live) (R4).
- [ ] M14-S03-NOTE-9 (M14-S03) HUMAN: set CONSOLE_SUPER_ADMIN_IDS to Sahil's Zoho user id on sandbox and live; until then nobody holds the event-sheet load right on the Digital Infrastructure side (D115 …
- [ ] M18-S09-NOTE-4 (M18-S09) HUMAN: decide whether the demo fixtures file may ship inside the production image (it is read at run time; 37 KB); confirm the managed-runtime app-config.json shape from …
- [ ] M18-S05-NOTE-2 (M18-S05) HUMAN: decide where the daily chain anchor is kept outside the Stratus bucket (without it a deleted chain tail is undetectable); optionally a keyed HMAC so bucket writers …
- [ ] M12-S11-NOTE-10 (M12-S11) HUMAN: create NDA_Back_At/By/Why and Supp_Back_At/By/Why on Leads (read by the 'Not signed after all' note); nothing writes them yet — Finance's bounce write is a separate …
- [ ] M10-S01-NOTE-8 (M10-S01) OWNER: the Investors-side dataset sends Finance seats the full receipt UTR, and the investor page shows it unmasked with no step-up (features/im/money/record.tsx:41, …
- [ ] M10-S20-NOTE-5 (M10-S20) HUMAN: is marking a payout paid (POST /api/payouts/[id]/paid) 'money leaving' under D22, needing step-up? Left unwrapped (R6).
- [ ] M01-S08-NOTE-1 (M01-S08) HUMAN: under D22, does executing a reversal need the second hand? ledger.ts counts a reversal only once Matched (R6).
- [ ] M18-S09-NOTE-7 (M18-S09) HUMAN: on Catalyst, create a Webhook job pool and two crons (*/10 sign-recheck, every minute outbox-drain) calling /api/jobs/* with the JOB_SECRET header, and set …
- [ ] M18-S02-NOTE-5 (M18-S02) HUMAN: there is no per-investor topic/URL for investor-app events (one signed endpoint, routing by ids.investor_contact_id); is a per-investor channel wanted? (R6).
- [ ] M10-S21-NOTE-5 (M10-S21) HUMAN: the App_Access mapping row is added; turning on field history tracking for Contacts.App_Access in Zoho Setup is still Sahil's (R6).

**Proofs on the sandbox or staging (60)** — run once the Zoho sandbox, test user and hosting exist; listed in BLOCKED.md.

# :clipboard: Stories

## M01 · Foundations & the one app shell

|Story|1. Front end on demo data|2. Plug into Zoho|2b. Wire screens to the API|2c. Test contracts and security hardening|3. Test and harden|Screens today|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|---|---|---|
|**M01-S01** One Next.js shell with the rail built from the person's seat|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:hourglass_flowing_sand: Waiting on people|Built (demo data)|S1|Must|8/10|
|**M01-S08** Every write goes through commit(): one press, one record, 'Not saved yet' when it cannot land|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|—|—|:white_check_mark: Done|Built (demo data)|S1|Must|5/6|
|**M01-S10** Step-up before a reveal, an export or money leaving, with a second hand on refunds|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:hourglass_flowing_sand: Waiting on people|Built (demo data)|S3|Must|5/10|
|**M01-S05** Staging and production environments|—|:hourglass_flowing_sand: Waiting on people|—|—|To do|Not a screen|S1|Must|1/2|
|**M01-S02** Sign in with my own Zoho account; signing out or changing person clears everything|—|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:hourglass_flowing_sand: Waiting on people|Partly built|S1|Must|4/6|
|**M01-S03** Live reads and writes through one Zoho client, gate and scope-keyed cache|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|—|—|:hourglass_flowing_sand: Waiting on people|Built (demo data)|S1|Must|5/7|
|**M01-S04** Operations and identity logs|—|:hourglass_flowing_sand: Waiting on people|—|—|:hourglass_flowing_sand: Waiting on people|Not a screen|S1|Must|1/2|
|**M01-S06** Pending saves while offline|:white_check_mark: Done|—|—|—|:hourglass_flowing_sand: Waiting on people|Built (demo data)|S2|Must|1/2|
|**M01-S07** Refusals and confirmations said in the page, never in alert() or confirm()|:white_check_mark: Done|—|—|—|:white_check_mark: Done|Built (demo data)|S1|Must|6/6|
|**M01-S09** Honest connection and freshness line in the top bar|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:hourglass_flowing_sand: Waiting on people|Built (demo data)|S1|Must|3/4|

## M02 · Zoho org build-out

|Story|1. Front end on demo data|2. Plug into Zoho|2b. Wire screens to the API|2c. Test contracts and security hardening|3. Test and harden|Screens today|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|---|---|---|
|**M02-S01** Enterprise renewed and seats ordered|—|—|—|—|:hourglass_flowing_sand: Waiting on people|Not a screen|S0|Must|1/3|
|**M02-S04** Roles, profiles, Private sharing and the field-level security wall for every seat|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|—|—|:hourglass_flowing_sand: Waiting on people|Not a screen|S0|Must|4/10|
|**M02-S05** Restricted test user and T11|—|:hourglass_flowing_sand: Waiting on people|—|—|To do|Not a screen|S0|Must|1/3|
|**M02-S06** Native Lead conversion stopped|—|—|—|—|To do|Not a screen|S0|Must|0/2|
|**M02-S07** Calls, Meetings and Tasks visible to the seats that schedule, with meetings in Zoho Calendar|—|—|—|—|To do|Not a screen|S0|Should|0/2|
|**M02-S08** Email sent from the person's own mailbox|—|:hourglass_flowing_sand: Waiting on people|—|—|To do|Not a screen|S0|Must|1/2|
|**M02-S09** Cover windows as record-level sharing|—|:hourglass_flowing_sand: Waiting on people|—|—|To do|Not a screen|S0|Must|2/3|
|**M02-S10** Sandbox and the console's OAuth client|—|:hourglass_flowing_sand: Waiting on people|—|—|To do|Not a screen|S0|Must|1/3|
|**M02-S12** Receipts module linked to the allotment, the Contact and the LLP|—|:white_check_mark: Done|—|—|To do|Not a screen|S0|Must|3/4|
|**M02-S02** Lead fields, rungs and picklists per the mapping|—|:hourglass_flowing_sand: Waiting on people|—|—|:hourglass_flowing_sand: Waiting on people|Not a screen|S0|Must|3/4|
|**M02-S03** Custom modules for the lead side; LLP modules adopted|—|:white_check_mark: Done|—|—|:hourglass_flowing_sand: Waiting on people|Not a screen|S0|Must|2/3|
|**M02-S11** Decide the canonical allotment module: LLP_UnitAllocation_Module or LLP_Unit_Allocation|—|:white_check_mark: Done|—|—|:hourglass_flowing_sand: Waiting on people|Not a screen|S0|Must|4/4|
|**M02-S13** Document-slot file-upload fields on the Contact, the allotment and the LLP|—|:white_check_mark: Done|—|—|—|Not a screen|S0|Must|4/4|
|**M02-S14** Zoho Sign request id and status fields on the allotment and the Contact; Zoho Sign plan and webhooks|—|:white_check_mark: Done|—|—|—|Not a screen|S0|Must|4/4|

## M03 · Access, seats & super user

|Story|1. Front end on demo data|2. Plug into Zoho|2b. Wire screens to the API|2c. Test contracts and security hardening|3. Test and harden|Screens today|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|---|---|---|
|**M03-S06** The Auditor (viewer) reads and never writes|:white_check_mark: Done|—|—|—|:white_check_mark: Done|Built (demo data)|S1|Must|2/4|
|**M03-S07** Key account managers see and work only their own accounts|—|:hourglass_flowing_sand: Waiting on people|—|—|:hourglass_flowing_sand: Waiting on people|Partly built|S1|Must|2/4|
|**M03-S08** Compliance owns KYC|:white_check_mark: Done|—|—|—|:white_check_mark: Done|Built (demo data)|S1|Must|2/3|
|**M03-S05** Zoho users provisioned seat by seat, both sides|—|:hourglass_flowing_sand: Waiting on people|—|—|To do|Not a screen|S1|Must|2/5|
|**M03-S09** An IR sees investor data only for investors from their own leads, enforced at the data layer|—|:hourglass_flowing_sand: Waiting on people|—|—|To do|Partly built|S1|Must|2/4|
|**M03-S01** Only people with a seat or a granted page sign in|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|—|—|:hourglass_flowing_sand: Waiting on people|Built (demo data)|S1|Must|3/4|
|**M03-S02** Sahil grants pages to other people, read-only by default|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:white_check_mark: Done|Built (demo data)|S1|Must|4/4|
|**M03-S03** Extra pages for IRs, and the IR Manager's limits|—|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:white_check_mark: Done|Built (demo data)|S1|Must|3/3|
|**M03-S04** Grant and seat changes move the sign-in list, follow the job and are logged|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:white_check_mark: Done|Built (demo data)|S1|Must|5/6|

## M04 · Lead capture

|Story|1. Front end on demo data|2. Plug into Zoho|2b. Wire screens to the API|2c. Test contracts and security hardening|3. Test and harden|Screens today|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|---|---|---|
|**M04-S03** Contact permission at capture|:white_check_mark: Done|—|—|—|:white_check_mark: Done|Built (demo data)|S2|Must|2/3|
|**M04-S01** Add a single lead|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|—|—|:white_check_mark: Done|Built (demo data)|S2|Must|4/4|
|**M04-S02** Duplicate mobile refused|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|—|—|:hourglass_flowing_sand: Waiting on people|Built (demo data)|S2|Must|3/3|
|**M04-S04** CSV import with preview|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|—|—|:hourglass_flowing_sand: Waiting on people|Built (demo data)|S2|Should|3/3|

## M05 · Today (both sides)

|Story|1. Front end on demo data|2. Plug into Zoho|2b. Wire screens to the API|2c. Test contracts and security hardening|3. Test and harden|Screens today|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|---|---|---|
|**M05-S04** Call times and reschedule|—|:hourglass_flowing_sand: Waiting on people|—|—|—|Partly built|S2|Should|1/2|
|**M05-S08** Account Management's Today (Investors side)|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:hourglass_flowing_sand: Waiting on people|Built (demo data)|S2|Must|4/5|
|**M05-S01** My day list (Lead side)|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|—|—|:hourglass_flowing_sand: Waiting on people|Built (demo data)|S2|Must|3/3|
|**M05-S02** One action per row and the focus panel|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|—|—|:hourglass_flowing_sand: Waiting on people|Built (demo data)|S2|Must|3/3|
|**M05-S03** Paperwork 'your move' on Today|:white_check_mark: Done|—|—|—|:hourglass_flowing_sand: Waiting on people|Built (demo data)|S2|Must|2/2|
|**M05-S06** Headline figures on Today (Investors side)|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:hourglass_flowing_sand: Waiting on people|Built (demo data)|S3|Must|3/4|
|**M05-S07** Waiting on you: the Investors-side queue per seat, including IR payment claims|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:hourglass_flowing_sand: Waiting on people|Built (demo data)|S3|Must|6/6|

## M06 · Leads book & lead search

|Story|1. Front end on demo data|2. Plug into Zoho|2b. Wire screens to the API|2c. Test contracts and security hardening|3. Test and harden|Screens today|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|---|---|---|
|**M06-S01** Leads list with Personal and Team scope|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|—|—|:white_check_mark: Done|Built (demo data)|S2|Must|3/3|
|**M06-S02** Filters, sort and the Overdue fix|:white_check_mark: Done|—|—|—|:white_check_mark: Done|Built (demo data)|S2|Must|2/2|
|**M06-S03** Find a lead in the top bar (leads only, own book)|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:hourglass_flowing_sand: Waiting on people|Built (demo data)|S2|Must|4/4|
|**M06-S05** Search wall: the lead search never reaches investor data|—|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:hourglass_flowing_sand: Waiting on people|Built (demo data)|S2|Must|3/4|

## M07 · Lead page

|Story|1. Front end on demo data|2. Plug into Zoho|2b. Wire screens to the API|2c. Test contracts and security hardening|3. Test and harden|Screens today|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|---|---|---|
|**M07-S01** Lead page shell and Next step card|:white_check_mark: Done|—|—|—|:white_check_mark: Done|Built (demo data)|S2|Must|3/3|
|**M07-S02** Logging flow — one question at a time|:white_check_mark: Done|—|—|—|:hourglass_flowing_sand: Waiting on people|Built (demo data)|S2|Must|2/2|
|**M07-S03** Save on the last tap, recorded once, with 10-second Undo|—|:hourglass_flowing_sand: Waiting on people|—|—|:hourglass_flowing_sand: Waiting on people|Built (demo data)|S2|Must|2/3|
|**M07-S04** Call time and Zoho activity mapping|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|—|—|:hourglass_flowing_sand: Waiting on people|Built (demo data)|S2|Must|2/3|
|**M07-S05** Email composer sent through Zoho send_mail|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:hourglass_flowing_sand: Waiting on people|Built (demo data)|S2|Must|3/4|
|**M07-S06** Close as lost in one step, undo and re-open|—|:hourglass_flowing_sand: Waiting on people|—|—|:white_check_mark: Done|Partly built|S2|Must|2/2|
|**M07-S07** Latest note, all notes and inline note|:white_check_mark: Done|—|—|—|:white_check_mark: Done|Built (demo data)|S2|Should|2/2|

## M08 · Journey, gates & hand-offs between the sides

|Story|1. Front end on demo data|2. Plug into Zoho|2b. Wire screens to the API|2c. Test contracts and security hardening|3. Test and harden|Screens today|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|---|---|---|
|**M08-S03** Money in: the IR reports a payment, Finance records the receipt|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:hourglass_flowing_sand: Waiting on people|Built (demo data)|S3|Must|6/8|
|**M08-S04** Reservation hold: clock, balance due, extend and release|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:hourglass_flowing_sand: Waiting on people|Built (demo data)|S3|Must|7/8|
|**M08-S07** 'Said yes' becomes the investor record|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:hourglass_flowing_sand: Waiting on people|Built (demo data)|S3|Must|3/5|
|**M08-S08** The first matched advance opens the investor app account|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:hourglass_flowing_sand: Waiting on people|Built (demo data)|S3|Must|4/5|
|**M08-S01** Journey bar, ticks, un-tick and skip|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|—|—|:white_check_mark: Done|Built (demo data)|S3|Must|3/3|
|**M08-S02** Finance gates read live from Zoho|—|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:hourglass_flowing_sand: Waiting on people|Built (demo data)|S3|Must|2/3|
|**M08-S05** Owners and cover (D44)|—|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:hourglass_flowing_sand: Waiting on people|Partly built|S3|Must|2/3|

## M09 · Investors & the investor record

|Story|1. Front end on demo data|2. Plug into Zoho|2b. Wire screens to the API|2c. Test contracts and security hardening|3. Test and harden|Screens today|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|---|---|---|
|**M09-S02** KAM book and Head of AM book|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:hourglass_flowing_sand: Waiting on people|Built (demo data)|S2|Must|3/5|
|**M09-S03** The investor record — header, banners and sections by seat|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:white_check_mark: Done|Built (demo data)|S2|Must|4/5|
|**M09-S04** Who looks after the account — KAM ownership|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:white_check_mark: Done|Built (demo data)|S2|Must|4/5|
|**M09-S08** An IR sees only investors from their own leads|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:hourglass_flowing_sand: Waiting on people|Built (demo data)|S2|Must|3/5|
|**M09-S01** Investors list for Finance|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|—|—|:hourglass_flowing_sand: Waiting on people|Built (demo data)|S2|Must|2/3|
|**M09-S07** Investor search on the Investors page|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:hourglass_flowing_sand: Waiting on people|Built (demo data)|S2|Must|3/4|
|**M09-S09** Add an investor who has already paid, straight from the console|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:hourglass_flowing_sand: Waiting on people|Built (demo data)|S2|Must|4/4|

## M10 · Payments & receipts

|Story|1. Front end on demo data|2. Plug into Zoho|2b. Wire screens to the API|2c. Test contracts and security hardening|3. Test and harden|Screens today|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|---|---|---|
|**M10-S01** Payments register|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:hourglass_flowing_sand: Waiting on people|Built (demo data)|S3|Must|5/6|
|**M10-S02** Match a receipt — the second hand|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:hourglass_flowing_sand: Waiting on people|Built (demo data)|S3|Must|5/6|
|**M10-S05** Weekly bank statement upload and reconciliation|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:hourglass_flowing_sand: Waiting on people|Built (demo data)|S3|Must|5/7|
|**M10-S07** Receipts belong to the allotment (investor × farm)|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|—|—|:hourglass_flowing_sand: Waiting on people|Built (demo data)|S3|Must|3/4|
|**M10-S03** Answer an IR's payment report|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:hourglass_flowing_sand: Waiting on people|Built (demo data)|S3|Must|4/4|
|**M10-S08** Per-farm payment view for an investor with several allotments|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:white_check_mark: Done|Built (demo data)|S3|Should|4/4|
|**M10-S09** ARL holdings and transactions — read-only panel|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:hourglass_flowing_sand: Waiting on people|Built (demo data)|S3|Should|4/4|
|**M10-S20** Monthly payouts: 60-month schedule per allotment, Finance due queue|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:hourglass_flowing_sand: Waiting on people|Built (demo data)|S3|Must|4/4|
|**M10-S21** Unlock the investor app and send the welcome from the console|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:hourglass_flowing_sand: Waiting on people|Built (demo data)|S3|Must|4/4|
|**M10-S22** Preview the investor's app screens (mock-up with their data)|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:hourglass_flowing_sand: Waiting on people|Built (demo data)|S4|Should|4/4|
|**M10-S23** Test sign-in link to check the real app on another device|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:hourglass_flowing_sand: Waiting on people|Built (demo data)|S4|Should|4/4|

## M11 · Farms (the LLP shelf) & allotments

|Story|1. Front end on demo data|2. Plug into Zoho|2b. Wire screens to the API|2c. Test contracts and security hardening|3. Test and harden|Screens today|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|---|---|---|
|**M11-S01** Farms are the LLP shelf|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:hourglass_flowing_sand: Waiting on people|Built (demo data)|S3|Must|4/5|
|**M11-S02** An allotment links an investor to a farm LLP|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:hourglass_flowing_sand: Waiting on people|Built (demo data)|S3|Must|4/5|
|**M11-S03** The shelf — released, held and free per farm LLP|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:white_check_mark: Done|Built (demo data)|S3|Must|4/5|
|**M11-S05** Allotment on the verified allocation letter|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:hourglass_flowing_sand: Waiting on people|Built (demo data)|S3|Must|5/7|
|**M11-S07** No unit is sold twice — the oversell guard|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:hourglass_flowing_sand: Waiting on people|Built (demo data)|S3|Must|4/5|
|**M11-S04** Release a farm LLP's units or take them back|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:white_check_mark: Done|Built (demo data)|S3|Must|4/4|

## M12 · Documents, upload & Zoho Sign

|Story|1. Front end on demo data|2. Plug into Zoho|2b. Wire screens to the API|2c. Test contracts and security hardening|3. Test and harden|Screens today|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|---|---|---|
|**M12-S01** Documents in three scopes, with who sees what|—|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:hourglass_flowing_sand: Waiting on people|Partly built|S3|Must|4/5|
|**M12-S02** Upload a document straight from the console to Zoho|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:hourglass_flowing_sand: Waiting on people|Built (demo data)|S3|Must|4/5|
|**M12-S03** Documents page: out for signature and on file, scoped to the seat|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:white_check_mark: Done|Built (demo data)|S3|Must|4/5|
|**M12-S04** Send a document for signature through Zoho Sign|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:white_check_mark: Done|Built (demo data)|S3|Must|5/7|
|**M12-S06** Signed PDF filed to the allotment and Agreement_Signed set|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:white_check_mark: Done|Built (demo data)|S3|Must|4/5|
|**M12-S10** Isolation suite: no user sees another user's leads, investors, documents, sign requests, emails or tickets|—|—|—|—|:hourglass_flowing_sand: Waiting on people|Partly built|S3|Must|4/8|
|**M12-S11** NDA loop on the lead page, and the IR's word beside Finance's queue|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:hourglass_flowing_sand: Waiting on people|Built (demo data)|S3|Must|4/6|
|**M12-S05** Live signature status from Zoho Sign webhooks, with reminders and recall|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|Built (demo data)|S3|Must|7/7|
|**M12-S07** Block or supersede a document|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:white_check_mark: Done|Built (demo data)|S3|Must|4/4|
|**M12-S08** The investor signs by email or inside the investor app|—|:hourglass_flowing_sand: Waiting on people|—|—|:hourglass_flowing_sand: Waiting on people|Partly built|S3|Should|3/3|
|**M12-S09** See a record's emails in the console|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:hourglass_flowing_sand: Waiting on people|Built (demo data)|S3|Should|4/4|
|**M12-S12** Supplementary agreement draft loop|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|—|—|:white_check_mark: Done|Built (demo data)|S3|Must|3/3|
|**M12-S13** Material follows the NDA; deck email marks the deck sent|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:hourglass_flowing_sand: Waiting on people|Built (demo data)|S3|Must|3/4|
|**M12-S14** 'Your move' on Today and Documents|:white_check_mark: Done|—|—|—|:hourglass_flowing_sand: Waiting on people|Built (demo data)|S3|Should|2/2|

## M13 · Tickets & investor updates (pushed to the investor app)

|Story|1. Front end on demo data|2. Plug into Zoho|2b. Wire screens to the API|2c. Test contracts and security hardening|3. Test and harden|Screens today|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|---|---|---|
|**M13-S02** Tickets register scoped by seat|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:white_check_mark: Done|Built (demo data)|S4|Must|4/5|
|**M13-S03** Open, wait and close a ticket|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:white_check_mark: Done|Built (demo data)|S4|Must|4/5|
|**M13-S04** A KAM hands a bank or compliance ticket to Finance and keeps watching|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:white_check_mark: Done|Built (demo data)|S4|Must|4/5|
|**M13-S06** Publish an investor update to a reconstructable segment|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:white_check_mark: Done|Built (demo data)|S4|Must|4/5|
|**M13-S01** Push to the investor app through the signed contracts, with a stub receiver|—|:hourglass_flowing_sand: Waiting on people|—|—|:white_check_mark: Done|Partly built|S4|Must|4/4|
|**M13-S05** Investor requests arrive as tickets and replies go back to the app|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:hourglass_flowing_sand: Waiting on people|Built (demo data)|S4|Should|5/5|

## M14 · Events

|Story|1. Front end on demo data|2. Plug into Zoho|2b. Wire screens to the API|2c. Test contracts and security hardening|3. Test and harden|Screens today|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|---|---|---|
|**M14-S01** Events list and event page|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:white_check_mark: Done|Built (demo data)|S3|Must|4/5|
|**M14-S02** Add, correct and remove an event|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:white_check_mark: Done|Built (demo data)|S3|Must|4/4|
|**M14-S03** Capture and sheet load tie leads to the event|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:hourglass_flowing_sand: Waiting on people|Built (demo data)|S3|Must|4/4|

## M15 · Updates & Activity

|Story|1. Front end on demo data|2. Plug into Zoho|2b. Wire screens to the API|2c. Test contracts and security hardening|3. Test and harden|Screens today|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|---|---|---|
|**M15-S03** Activity page: who did what, each seat its own scope, Lead side / Investors side|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:hourglass_flowing_sand: Waiting on people|Built (demo data)|S4|Must|8/9|
|**M15-S01** Updates: what others changed on my book|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|—|—|:white_check_mark: Done|Built (demo data)|S4|Must|3/3|
|**M15-S05** Console logs for refusals, reveals and API headroom (Planes B and C), filterable|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:hourglass_flowing_sand: Waiting on people|Built (demo data)|S4|Must|4/5|

## M16 · Numbers, Plan & Transfers

|Story|1. Front end on demo data|2. Plug into Zoho|2b. Wire screens to the API|2c. Test contracts and security hardening|3. Test and harden|Screens today|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|---|---|---|
|**M16-S01** Assignments by IR report|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|—|—|:hourglass_flowing_sand: Waiting on people|Built (demo data)|S4|Must|2/3|
|**M16-S02** Open one IR's row and list the leads behind a count|:white_check_mark: Done|—|—|—|:white_check_mark: Done|Built (demo data)|S4|Should|2/2|
|**M16-S03** Lead-side Numbers sections computed live, one scope at a time|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|—|—|:hourglass_flowing_sand: Waiting on people|Built (demo data)|S4|Must|2/3|
|**M16-S04** Read the plan|—|:hourglass_flowing_sand: Waiting on people|—|—|:hourglass_flowing_sand: Waiting on people|Partly built|S4|Must|2/2|
|**M16-S06** Transfers per month: leads that became investors|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|—|—|:hourglass_flowing_sand: Waiting on people|Built (demo data)|S4|Must|3/3|
|**M16-S07** Open a month to its investors|:white_check_mark: Done|—|—|—|:white_check_mark: Done|Built (demo data)|S4|Should|2/2|
|**M16-S08** Investors side of Numbers: collection, paper and compliance|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:white_check_mark: Done|Built (demo data)|S4|Should|4/4|
|**M16-S09** Money figures only to seats that may see them|—|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:hourglass_flowing_sand: Waiting on people|Partly built|S4|Must|3/3|

## M17 · Teams, Profile & System

|Story|1. Front end on demo data|2. Plug into Zoho|2b. Wire screens to the API|2c. Test contracts and security hardening|3. Test and harden|Screens today|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|---|---|---|
|**M17-S01** Teams: members, seats and what each seat may do, from Zoho|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:white_check_mark: Done|Built (demo data)|S4|Must|5/5|
|**M17-S02** Grant pages and change seats|—|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:hourglass_flowing_sand: Waiting on people|Built (demo data)|S4|Must|2/3|
|**M17-S05** My profile|—|:hourglass_flowing_sand: Waiting on people|—|—|:white_check_mark: Done|Built (demo data)|S4|Must|2/2|
|**M17-S06** System health and administration|—|:hourglass_flowing_sand: Waiting on people|—|—|:hourglass_flowing_sand: Waiting on people|Partly built|S4|Must|2/2|

## M18 · Hardening, security & release

|Story|1. Front end on demo data|2. Plug into Zoho|2b. Wire screens to the API|2c. Test contracts and security hardening|3. Test and harden|Screens today|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|---|---|---|
|**M18-S01** The app stays fast inside Zoho's API limits|—|:hourglass_flowing_sand: Waiting on people|—|—|:hourglass_flowing_sand: Waiting on people|Not a screen|S5|Must|4/6|
|**M18-S02** Nothing leaks outside a seat's scope: seat x page x action x field matrix|—|:hourglass_flowing_sand: Waiting on people|—|—|:hourglass_flowing_sand: Waiting on people|Not a screen|S5|Must|3/6|
|**M18-S03** Every page works on a phone and by keyboard|:white_check_mark: Done|—|—|—|:hourglass_flowing_sand: Waiting on people|Not a screen|S5|Must|2/4|
|**M18-S05** Data and logs are backed up and restorable|—|—|—|—|:hourglass_flowing_sand: Waiting on people|Not a screen|S5|Must|1/3|
|**M18-S08** Exploratory sessions and UAT signed off on both sides|—|:hourglass_flowing_sand: Waiting on people|—|:white_check_mark: Done|:white_check_mark: Done|Not a screen|S5|Must|5/11|
|**M18-S09** Go-live by checklist with a runbook and a rehearsed rollback|—|—|—|—|:hourglass_flowing_sand: Waiting on people|Not a screen|S5|Must|3/6|
|**M18-S10** Runbook and hypercare|—|—|—|—|:hourglass_flowing_sand: Waiting on people|Not a screen|S5|Should|1/3|
|**M18-S06** Legacy records carried across without new Deals|—|—|—|—|To do|Not a screen|S5|Must|0/3|
|**M18-S12** Move the org's old payment columns into Receipts on the allotment|—|:hourglass_flowing_sand: Waiting on people|—|—|To do|Partly built|S5|Must|1/3|
|**M18-S04** Errors are captured, visible and alerted|—|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:hourglass_flowing_sand: Waiting on people|Not a screen|S5|Must|3/4|
|**M18-S14** Every API route refuses at the door: no session, wrong seat, bad input, masked fields|—|—|—|:white_check_mark: Done|—|—|S5|Must|3/3|
|**M18-S15** Browser and request hardening: security headers, Origin check, rate limits, upload limits|—|—|—|:white_check_mark: Done|—|—|S5|Must|4/4|

## M19 · Quality — Jev UI suite

|Story|1. Front end on demo data|2. Plug into Zoho|2b. Wire screens to the API|2c. Test contracts and security hardening|3. Test and harden|Screens today|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|---|---|---|
|**M19-S07** Smoke suite and production check|—|—|—|—|:hourglass_flowing_sand: Waiting on people|Not a screen|S5|Should|1/2|
|**M19-S11** Regenerate the Jev UI cases against the merged console: super user and per seat|—|—|—|—|:white_check_mark: Done|Not a screen|S2|Must|3/4|
|**M19-S02** Jev UI runner on staging|—|:hourglass_flowing_sand: Waiting on people|—|—|To do|Not a screen|S1|Must|3/5|
|**M19-S01** UI test contract|:white_check_mark: Done|—|—|—|:hourglass_flowing_sand: Waiting on people|Not a screen|S1|Must|2/3|
|**M19-S03** Zoho sandbox seed and reset|:white_check_mark: Done|:white_check_mark: Done|—|—|:white_check_mark: Done|Not a screen|S1|Must|3/3|
|**M19-S04** Judge calibration gate|—|:hourglass_flowing_sand: Waiting on people|—|—|—|Not a screen|S1|Must|1/1|
|**M19-S05** CI pipeline|—|:hourglass_flowing_sand: Waiting on people|—|—|—|Not a screen|S1|Must|1/1|
|**M19-S06** Unit tests for business rules|—|:white_check_mark: Done|—|—|—|Not a screen|S1|Must|1/1|
|**M19-S08** Flaky tests and re-baselining|—|—|—|—|:white_check_mark: Done|Not a screen|S3|Should|1/1|
|**M19-S10** Map the two old suites onto the merged console and retire dead cases|—|—|—|—|:white_check_mark: Done|Not a screen|S2|Must|2/2|
|**M19-S12** The 88 unexplained Jev failures are each a fixed bug or a proposed fact change|—|—|—|:white_check_mark: Done|—|—|S5|Must|3/3|
|**M19-S13** One Jev layer for the whole build: shared client, grounding, question library, calibration per question type, |—|—|—|:white_check_mark: Done|—|—|S5|Must|6/6|

## M20 · Launch readiness & operations

|Story|1. Front end on demo data|2. Plug into Zoho|2b. Wire screens to the API|2c. Test contracts and security hardening|3. Test and harden|Screens today|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|---|---|---|
|**M20-S03** Training and quick guides|—|—|—|—|:white_check_mark: Done|Not a screen|S5|Must|1/2|
|**M20-S08** Buy the Zoho Sign plan and set up its webhooks|—|:hourglass_flowing_sand: Waiting on people|—|—|To do|Not a screen|S0|Must|1/4|
|**M20-S01** Product brief and KPIs|—|—|—|—|:hourglass_flowing_sand: Waiting on people|Not a screen|S0|Must|1/1|
|**M20-S04** Support model and issue intake|—|—|—|—|:hourglass_flowing_sand: Waiting on people|Not a screen|S5|Must|1/1|
|**M20-S05** Stage reviews, status and retrospectives|—|—|—|—|:white_check_mark: Done|Not a screen|S0|Must|6/6|
|**M20-S06** Change control|—|—|—|—|:white_check_mark: Done|Not a screen|S0|Must|1/1|
|**M20-S07** Bring the investor app codebase into the repo and wire the contract receivers|—|:hourglass_flowing_sand: Waiting on people|—|:white_check_mark: Done|:white_check_mark: Done|Partly built|S4|Must|6/6|
