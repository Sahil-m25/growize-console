::: {.callout}
**Updated 04 Oct 2026 17:19 IST** from the build itself (autopilot progress). Statuses are not edited here; comment on a row instead.
:::

# :compass: Where we are

**Goal:** the whole Growize Console (lead side and Investors side, one app on Zoho), built in phases: **front end first, then plug into Zoho, then wire the screens to it, then test**. Owner's build target ![](slack_date:2026-10-03).

**Now working on:** 3. Test and harden — API cases, staging cases on the Zoho sandbox, the full regression, tester review and UAT.

**Also running in parallel:** 2. Plug into Zoho — the backend worktree (branch autopilot/backend) builds the Zoho layer; screens are wired to it after phase 1.

|Phase|Done (proven)|Waiting on people|Review|Left for the loop|Loop hours left|Forecast finish|Pace|
|---|---|---|---|---|---|---|---|
|**1. Front end on demo data**|92 of 92 (100%)|0 (0%)|0|0|0|done|0 min/unit measured|
|**2. Plug into Zoho**|7 of 119 (6%)|112 (94%)|0|0|0|done|10.4 min/unit measured|
|**2b. Wire screens to the API**|65 of 66 (98%)|0 (0%)|1|1|0.5|![](slack_date:2026-10-04)|assumed until 5 rounds|
|**2c. Test contracts and security hardening** :twisted_rightwards_arrows: parallel worktree|7 of 7 (100%)|0 (0%)|0|0|0|done|assumed until 5 rounds|
|**3. Test and harden** :arrow_left:|39 of 145 (27%)|54 (37%)|0|52|13|![](slack_date:2026-10-05)|assumed until 5 rounds|

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

**Latest decisions**

- **D111** (30 Sep 2026): Fan-out: parallel agents in git worktrees, Sonnet builders, Opus for pattern/security/Jev layer/integration; one coordinator records; first run 30 Sep — phase 2b 44/66 done + 22 review, phase 2c 7/7, next 15.5.26
- **D112** (4 Oct 2026): Fan-out rounds 1–2 (4 Oct): Modified_Time plumbing + 7 new routes; phase 2b 57/66; offline Investors receipts, Auditor Activity, oversell fixed; phase 3 local half 33 done / 47 waiting / 1 review; suites 1,792 server tests
- **D113** (4 Oct 2026): Owner rulings 4 Oct: Finance-recorded receipt is matched (auto from statement where possible, else Finance by hand; IR claims pending); IR investors view reuses the Investors page; all fact changes approved; 401 body as built; Farm ops persona kept; bu = business owner; NOTE-3 closed; comp reads Finance trail; D47/AP4 open
- **D114** (4 Oct 2026): Round 3 on the 4 Oct rulings: receipts matched by Finance built, IR Investors page, fact changes applied (UI suite 344/349, 0 FAIL), smoke suite + flake quarantine, launch/ops docs, 3 bugs fixed
- **D115** (4 Oct 2026): Owner rulings 4 Oct (second set): app access stays Hold until released (a match never opens it); event-sheet load is the super administrator's right (grantable); rights grid = 8 Investors seats as columns labelled with their Zoho role; provisional calls bulk-reviewed on one sheet; decisions index gap filled from the project docs
- **D116** (4 Oct 2026): Round 4: tracker reconciled with the code; code gaps closed (/api/system, mail attachments, Consent_How picklist, Consent_Visit dropped, log success kind, reveal reason); D115 built; host-agnostic prep for Catalyst (shared-state interface + NoSQL adapter, log sink + Stratus adapter + Plane C hash chain, standalone Docker image, 30 s audit)

## Stages

|Stage|What it delivers|Stories|Done|Forecast done|
|---|---|---|---|---|
|S0|Zoho org build-out and access wall|18|7|![](slack_date:2026-10-05)|
|S1|Foundations, access, test suite|23|5|![](slack_date:2026-10-05)|
|S2|Lead side daily work and Investors pages|30|13|![](slack_date:2026-10-05)|
|S3|Journey, gates, money, paper, Zoho Sign, farms|43|16|![](slack_date:2026-10-05)|
|S4|Updates, tickets, app push, activity, numbers, teams|24|15|![](slack_date:2026-10-05)|
|S5|Hardening, UAT, migration, release|17|5|![](slack_date:2026-10-05)|

# :calendar: Month by month

|Month|Stories finished|Forecast to finish|Cumulative forecast|
|---|---|---|---|
|September 2026|9|0|9 of 155|
|October 2026|52|52|113 of 155|

# :spiral_calendar_pad: Week by week

|Week of|Finished|Forecast|Cumulative|Burn-up|
|---|---|---|---|---|
|![](slack_date:2026-09-21)|2|0|2|:white_large_square::white_large_square::white_large_square::white_large_square::white_large_square::white_large_square::white_large_square::white_large_square::white_large_square::white_large_square: 1%|
|![](slack_date:2026-09-28) **(this week)**|59|13|74|:large_green_square::large_green_square::large_green_square::large_green_square::white_large_square::white_large_square::white_large_square::white_large_square::white_large_square::white_large_square: 48%|
|![](slack_date:2026-10-05)|0|39|113|:large_green_square::large_green_square::large_green_square::large_green_square::large_green_square::large_green_square::large_green_square::white_large_square::white_large_square::white_large_square: 73%|

## This week

**Finished (59):** M01-S07, M02-S03, M02-S11, M03-S04, M04-S02, M04-S04, M05-S01, M05-S02, M05-S03, M05-S07, M06-S01, M06-S02, M06-S03, M07-S02, M07-S06, M07-S07, M08-S01, M09-S09, M10-S03, M10-S09, M10-S20, M10-S21, M10-S22, M10-S23, M11-S04, M12-S05, M12-S07, M12-S08, M12-S09, M12-S12, M12-S14, M13-S01, M13-S05, M14-S02, M14-S03, M15-S01, M15-S05, M16-S02, M16-S04, M16-S06, M16-S07, M16-S08, M16-S09, M17-S01, M17-S05, M17-S06, M18-S14, M18-S15, M19-S04, M19-S05, M19-S06, M19-S08, M19-S10, M19-S12, M19-S13, M20-S01, M20-S04, M20-S05, M20-S06

**Planned by the forecast (13):** M03-S01, M19-S01, M19-S02, M19-S03, M02-S01, M02-S02, M02-S05, M02-S06, M02-S08, M02-S09, M02-S10, M02-S12, M20-S08

**Stuck: review or waiting on people (43):**

- **M01-S01** One Next.js shell with the rail built from the person's seat (waiting)
- **M01-S08** Every write goes through commit(): one press, one record, 'Not saved yet' when it cannot l (waiting)
- **M01-S10** Step-up before a reveal, an export or money leaving, with a second hand on refunds (waiting)
- **M02-S04** Roles, profiles, Private sharing and the field-level security wall for every seat (waiting)
- **M03-S06** The Auditor (viewer) reads and never writes (waiting)
- **M03-S07** Key account managers see and work only their own accounts (waiting)
- **M03-S08** Compliance owns KYC (waiting)
- **M04-S03** Contact permission at capture (waiting)
- **M05-S04** Call times and reschedule (waiting)
- **M05-S08** Account Management's Today (Investors side) (waiting)
- **M08-S03** Money in: the IR reports a payment, Finance records the receipt (waiting)
- **M08-S04** Reservation hold: clock, balance due, extend and release (waiting)
- **M08-S08** The first matched advance opens the investor app account (waiting)
- **M09-S03** The investor record — header, banners and sections by seat (waiting)
- **M09-S04** Who looks after the account — KAM ownership (waiting)
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
- **M12-S11** NDA loop on the lead page, and the IR's word beside Finance's queue (review)
- **M13-S02** Tickets register scoped by seat (waiting)
- **M13-S03** Open, wait and close a ticket (waiting)
- **M13-S04** A KAM hands a bank or compliance ticket to Finance and keeps watching (waiting)
- **M13-S06** Publish an investor update to a reconstructable segment (waiting)
- **M14-S01** Events list and event page (waiting)
- **M15-S03** Activity page: who did what, each seat its own scope, Lead side | Investors side (waiting)
- **M18-S05** Data and logs are backed up and restorable (waiting)
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
|**M01** Foundations & the one app shell|S1|10|1|:white_large_square::white_large_square::white_large_square::white_large_square::white_large_square: 10%|One Next.js + TypeScript app, one sign-in, one rail built from the seat, live Zoho reads through one client with scope-keyed cache, honest s|
|**M02** Zoho org build-out|S0|14|4|:large_green_square::white_large_square::white_large_square::white_large_square::white_large_square: 29%|The one Enterprise org ready for both sides before any second seat: fields, modules, the FLS wall, Receipts, document slots, Zoho Sign field|
|**M03** Access, seats & super user|S1|9|1|:white_large_square::white_large_square::white_large_square::white_large_square::white_large_square: 11%|Who may sign in and what each seat may read and do on both sides, enforced by Zoho and the data layer; Sahil as super user with PII masked; |
|**M04** Lead capture|S2|4|2|:large_green_square::large_green_square::white_large_square::white_large_square::white_large_square: 50%|Leads added one at a time, by CSV or from an event sheet, with duplicates refused and contact permission recorded.|
|**M05** Today (both sides)|S2|7|4|:large_green_square::large_green_square::white_large_square::white_large_square::white_large_square: 57%|One Today page with a 'Lead side / Investors side' switch: the IR's follow-ups and paperwork moves, and Finance's and Account Management's d|
|**M06** Leads book & lead search|S2|4|3|:large_green_square::large_green_square::large_green_square::white_large_square::white_large_square: 75%|Each person sees their own book of leads as an ordered list with honest counts, and finds a lead from the top bar — leads only, inside their|
|**M07** Lead page|S2|7|3|:large_green_square::large_green_square::white_large_square::white_large_square::white_large_square: 43%|One lead page where an IR sees the next step, reaches the investor, logs a contact once with Undo, emails through Zoho, closes as lost and r|
|**M08** Journey, gates & hand-offs between the sides|S3|7|1|:white_large_square::white_large_square::white_large_square::white_large_square::white_large_square: 14%|The lead's journey is true in Zoho, money gates are opened only by Finance, and Said yes hands the investor to the Investors side of the sam|
|**M09** Investors & the investor record|S2|7|1|:white_large_square::white_large_square::white_large_square::white_large_square::white_large_square: 14%|One Investors page and one sectioned investor record, scoped per seat: Finance sees the book, a KAM their accounts, an IR only the investors|
|**M10** Payments & receipts|S3|11|6|:large_green_square::large_green_square::white_large_square::white_large_square::white_large_square: 55%|Every rupee is a Receipt linked to an allotment (investor × farm LLP), recorded by Finance, matched by a second person, reconciled against t|
|**M11** Farms (the LLP shelf) & allotments|S3|6|1|:white_large_square::white_large_square::white_large_square::white_large_square::white_large_square: 17%|Farms are the LLP records in Zoho (LLP_Creation_Module): the shelf counts free units off the records, and every allotment links an investor |
|**M12** Documents, upload & Zoho Sign|S3|14|6|:large_green_square::large_green_square::white_large_square::white_large_square::white_large_square: 43%|Every document lives in Zoho in one of three scopes (personal on the Contact, per allotment, per farm LLP), is uploaded straight from the co|
|**M13** Tickets & investor updates (pushed to the investor app)|S4|6|2|:large_green_square::white_large_square::white_large_square::white_large_square::white_large_square: 33%|Tickets (Zoho Cases) and investor updates are worked in the console and reach the existing investor app through the signed event contracts, |
|**M14** Events|S3|3|2|:large_green_square::large_green_square::large_green_square::white_large_square::white_large_square: 67%|Events are the lead side's diary (Lead_Events module, D85): list, event page, add/correct/remove by the IR Manager, capture and CSV/sheet lo|
|**M15** Updates & Activity|S4|3|2|:large_green_square::large_green_square::large_green_square::white_large_square::white_large_square: 67%|People see what others changed on their book (bell and Updates), managers review who did what on one Activity page with a Lead side / Invest|
|**M16** Numbers, Plan & Transfers|S4|8|6|:large_green_square::large_green_square::large_green_square::white_large_square::white_large_square: 75%|One Numbers page with a Lead side / Investors side switch, a Plan page and a Transfers page, all worked out live from Zoho within the viewer|
|**M17** Teams, Profile & System|S4|4|3|:large_green_square::large_green_square::large_green_square::white_large_square::white_large_square: 75%|Admin pages of the one app: Teams (members plus an Investors side seats section), seat and page grants, temporary access, own profile, Syste|
|**M18** Hardening, security & release|S5|12|2|:white_large_square::white_large_square::white_large_square::white_large_square::white_large_square: 17%|Prove the one app is fast inside Zoho's limits, leaks nothing across seats or users, works on a phone and by keyboard, fails visibly, can be|
|**M19** Quality — Jev UI suite|S1|12|7|:large_green_square::large_green_square::white_large_square::white_large_square::white_large_square: 58%|A Jev UI suite that runs the same plain-language cases against the merged prototype (growize-console-merged.html) and the built app, per sea|
|**M20** Launch readiness & operations|S0|7|4|:large_green_square::large_green_square::white_large_square::white_large_square::white_large_square: 57%|The brief, KPIs, status rhythm and change control that keep the plan honest, the guides and support model for go-live, and the two outside p|
# :card_index_dividers: Backlog in BLOCKED.md — 354 open, 168 ticked

|Kind|Open|What it is|
|---|---|---|
|FRONT-END LOOP|3|Screens to wire to their API route (now phase 2b units)|
|PROVISIONAL|122|Choices the build made at low confidence — owner confirms or reverses|
|FACT CHANGE PROPOSED|28|Test cases that contradict a decision — owner rules, then the case changes|
|BLOCK|7|Do-not-activate blocks (a design or decision gap)|
|STAGING PROOF|4|Proofs to run on the sandbox|
|OWNER ACTION|2|Owner actions in Zoho|
|Tasks for people|19|Sahil 11, Autopilot 7, Tester 1|
|Other notes|169|Zoho fields/modules the code expects, secrets and config, staging steps|

Decisions waiting on the owner = PROVISIONAL + FACT CHANGE PROPOSED. Tick a line in BLOCKED.md when it is done; the loop reads the ticks.


# :hammer_and_wrench: People's to-do (from the build)

- [ ] M02-S01-T01 (M02-S01, Sahil, Before its story (do early)) Renew Enterprise and buy the test-user seat — Renew the Enterprise subscription (annual) before 13 Oct; add one user licence for the restricted test user; save the invoice reference in the ops notes.
- [ ] M02-S04-T02 (M02-S04, Sahil, Before its story (do early)) Profiles per seat — One profile per seat of both sides, module permissions per SEATCAPS (no Convert/Export/Mass delete for IR); API access on (T7); Sahil's profile with every module but identity fields hidden (D68).
- [ ] M02-S04-T03 (M02-S04, Sahil, Before its story (do early)) Field-level security wall — Encrypt pan and bank_account on Contacts; pan readable by Head of Finance and Compliance, bank by Head of Finance and Finance; hide pan, bank, Aadhaar_Number, UTR_n, DOB everywhere else; aadhaar_last4/aadhaar_ref o
- [ ] M02-S04-T04 (M02-S04, Sahil, Before its story (do early)) Private sharing and B-12 rules — Default sharing Private on Leads, Contacts and custom modules; IR Manager read on IR subtree via hierarchy; Finance → Leads sharing rule for gate columns (B-12); document the answer.
- [ ] M02-S06-T01 (M02-S06, Sahil, Before its story (do early)) Remove Convert permission — Untick Convert Leads on every profile; confirm no workflow converts.
- [ ] M02-S10-T02 (M02-S10, Sahil, Before its story (do early)) Register OAuth clients — In Zoho API Console, register separate server-based clients for staging/sandbox and production. Add only each deployment's exact HTTPS OAuth callback URI. Grant only CRM module access, settings read, COQL read, ZohoCR
- [ ] M02-S10-NOTE-1 (M02-S10) M02-S10-T01 OWNER ACTION: In Zoho CRM Setup > Data Administration > Sandbox, create the Enterprise developer sandbox only after the S0 module/profile/FLS work is complete. Copy metadata, not real investor data. In the sandbox, compare module API names, Leads field API names,
- [ ] M20-S08-T01 (M20-S08, Sahil, Before its story (do early)) Plan choice and purchase request — In sign.zoho.in, compare the Enterprise and API plans using ARL's expected annual envelope volume. Require API access, HMAC-secured webhooks, Aadhaar eSign, email OTP and enough signing credits. Send the own
- [ ] M20-S08-T02 (M20-S08, Sahil, Before its story (do early)) OAuth client and secrets — After the paid Sign plan is active, update the India-DC OAuth clients with only ZohoSign.documents.CREATE, ZohoSign.documents.READ, ZohoSign.documents.UPDATE and ZohoSign.templates.READ. Re-consent the restricted pr
- [ ] M20-S08-NOTE-1 (M20-S08) M20-S08-T03 OWNER ACTION, AFTER NOTE-3 IS CLEARED: Deploy the durable worker and persistent Plane B sink to staging and production first. In Zoho Sign > Settings > Developer Settings > Webhooks, create exactly two callbacks, one for each host's /api/webhooks/zoho-sign route;
- [ ] M20-S08-NOTE-2 (M20-S08) FACT CHANGE PROPOSED: M20-S08-T03 says to store Sign status on the Zoho record, but D77 requires status to be read live from Zoho Sign and D79 created request-id/verification fields without a status field. The local webhook therefore verifies and re-fetches the request, reso
- [ ] M20-S08-NOTE-3 (M20-S08) PRODUCTION ACTIVATION BLOCK: Do not register either callback yet. Zoho Sign requires HTTP 200 within 5 seconds and advises against heavy inline work; this local boundary still performs source re-fetch plus CRM resolution before acknowledging, and an unlinked event has no dur
- [ ] M01-S08-NOTE-1 (M01-S08) RECEIPT IDEMPOTENCY FIELD AND KEYS: In the Enterprise sandbox, add a single-line Receipts field with API name `Idempotency_Key`, at least 64 characters, globally unique and writable/readable by Finance through its own user tokens. Keep it off ordinary layouts and deny Receip
- [ ] M01-S08-NOTE-2 (M01-S08) ZOHO-SIDE ATOMICITY BLOCK: Before enabling receipt replay, export one process-singleton service from the server composition root, then design and sandbox-prove a Zoho-resident atomic guard that covers both the allotment snapshot and its receipt ledger. The mutex, dedupe join
- [ ] M01-S08-NOTE-3 (M01-S08) SANDBOX ACCESS AND FAILURE PROOF: With two restricted Finance seats and one restricted IR seat, prove `UTR` and `Idempotency_Key` uniqueness, cross-Finance visibility of an exact retry, Finance-only create, IR direct-API refusal, and no identity/amount/UTR/HMAC/session value
- [ ] M01-S08-NOTE-4 (M01-S08) UTR FACT CONFLICT: D76 and the current field mapping say `Receipts.UTR` is unique, but STAGE-3 section 9.1 says a second distinct receipt with the same UTR must still be recorded and flagged for statement review; blocking it also conflicts with D21's "recording money is alwa
- [ ] M01-S08-NOTE-5 (M01-S08) REFUND AND REVERSAL LEDGER CONVENTION: M10 has not yet defined which Receipt row/state proves an approved refund or reversal and how `Refund`, `Reversed` and `Reversal_Of` interact without double-subtracting. This guard therefore refuses an allotment ledger containing any of
- [ ] M01-S08-NOTE-6 (M01-S08) SESSION REVOCATION AND IDENTITY WIRING: The Zoho OAuth/session story must supply this guard's authoritative `session.recheck` dependency and call `discardSession(actorId, sessionId)` on the process-singleton service instance before destroying a signed-out session. Recheck mu
- [ ] M01-S08-NOTE-7 (M01-S08) PLAN AND FIELD-MAP DRIFT: The merged field map and M02-S12-T03 still say a Receipt duplicates Contact/Investor and LLP lookups, but the later as-applied D76 decision deliberately omitted both and reads those parents through the canonical `Allotment`; `Created_By` remains the
- [ ] M01-S08-NOTE-8 (M01-S08) OFFLINE CONTEXT INTEGRATION: When the frontend data source is available, renew a receipt preparation while online at least every four minutes and disable offline submission once it is five minutes old. At the actual press, derive `queuedAt` as the server's `preparedAt` plus 
- [ ] M03-S05-T01 (M03-S05, Sahil, Before its story (do early)) Buy seats and invite users — First complete the Enterprise renewal and single restricted-test-user licence in M02-S01-T01; that test seat must exist before T11. Only after M02-S04's profiles/FLS/sharing wall exists and the restricted user has
- [ ] M03-S05-NOTE-1 (M03-S05) SANITIZED SEAT EXPORTS AND STAGING PROOF: After the role/profile wall is final in both the Enterprise sandbox and production, call `GET /crm/v8/settings/roles`, `GET /crm/v8/settings/profiles` and `GET /crm/v8/users?type=CurrentUser` with the restricted user's own scoped OAu
- [ ] M03-S05-NOTE-4 (M03-S05) ENTERPRISE ENTITLEMENT PROOF: CurrentUser proves the authenticated user, active/confirmed state, user type and role/profile, but not that the org's paid Enterprise entitlement is current. Before enabling sign-in, capture sanitized Organization API evidence for the configured
- [ ] M03-S07-T01 (M03-S07, Sahil, Before its story (do early)) Sharing for KAM books — Private default on Contacts; KAM access by owner/kam lookup sharing rule; Head of AM above KAMs in the hierarchy.
- [ ] M03-S07-NOTE-1 (M03-S07) ZOHO SHARING PROOF (human, sandbox then production): the backend refuses foreign rows, but only Zoho sharing proves a KAM token cannot read them. With synthetic Contacts + Issued allotments: (1) signed in as a KAM (Imran), COQL 'select id from Contacts where id is not null' 
- [ ] M04-S01-NOTE-1 (M04-S01) ZOHO SETUP FOR CAPTURE (M04-S01-T01; the super admin creates fields, so this waits for Sahil's approval — on approval Claude can apply it through the Zoho connector and export zoho/leads/fields.json). Live Leads metadata read 27 Sep: Lead_Event, City, Units_Interested, Conse
- [ ] M04-S01-NOTE-2 (M04-S01) PROVISIONAL: How is an unassigned lead represented in Zoho, where every record must have an Owner? → built as (b) a dedicated 'Unassigned' queue user owns it (Jev 0.49 vs 0.49 for (a) the adding manager owns it with Owner_Assigned_At empty; LOW CONFIDENCE). Needs a seat for 
- [ ] M04-S02-NOTE-1 (M04-S02) ZOHO DUPLICATE CHECK ON LEADS.MOBILE (M04-S02 hard stop; super admin): Setup > Modules and Fields > Leads > Standard layout > Mobile > Edit Properties > tick "Do not allow duplicate values". Zoho refuses this while duplicates exist, so first run the report Leads grouped by M
- [ ] M04-S02-NOTE-2 (M04-S02) FACT CHANGE PROPOSED: M04-S02-T01 says the duplicate lookup uses a service read across the org; CLAUDE.md rule 2 (D53) says a service token never serves a screen, so it was built on the person's own token instead. Consequence for acceptance 3: a number held in a book the IR 
- [ ] M06-S01-NOTE-1 (M06-S01) LEADS BOOK SHARING (M06-S01, super admin; with M02-S04's Private sharing): (1) Leads default sharing Private, IR Manager above her IRs in the role hierarchy so Team scope reads her IRs' leads; (2) a sharing rule giving the Investor Relations role Read on Leads owned by the u
- [ ] M05-S01-NOTE-1 (M05-S01) PROVISIONAL: Where are nextUp/workGroup computed for Today in the Zoho phase? → built as (b): the server returns the Today read (open leads in scope plus their open Tasks, Calls and Meetings; lost and onboarded left out) and the existing ported rule in features/today/work.ts
- [ ] M05-S01-NOTE-2 (M05-S01) TODAY ACTIVITY MODULES (M05-S01; needs M02-S07): the Zoho connector used for setup gets "permission denied" on Tasks, Calls and Events (Meetings), so the field names in console/src/server/leads/today.ts (ACTIVITY_QUERIES) are Zoho's standard ones and unproved in this org: Ta
- [ ] M05-S02-NOTE-1 (M05-S02) ASSIGN TO ME NEEDS WRITE ON QUEUE LEADS (M05-S02, super admin; follows the unassigned-queue PROVISIONAL in M04-S01): the Leads sharing rule for records owned by the unassigned queue user must give the Investor Relations role Read/Write (not Read only), so an IR's own token c
- [ ] M06-S03-NOTE-1 (M06-S03) LEAD SEARCH STAGING PROOF (M06-S03): with real tokens on staging — (1) an IR's GET /crm/v8/Leads/search?word=<another IR's lead name> returns nothing (Private sharing) and the console says "No lead matches in your book"; (2) Zoho's phone= search finds a lead from 3+ typed di
- [ ] M07-S03-NOTE-1 (M07-S03) FOLLOW-UP SAVE AND UNDO — ZOHO AND SECRETS (M07-S03): (1) the IR, IR Manager and Digital Infrastructure profiles need Delete (single record, not mass delete) on Touches, Tasks, Calls and Meetings (Events), or Undo and the automatic take-back cannot remove what a save created
- [ ] M07-S03-NOTE-2 (M07-S03) FACT CHANGE PROPOSED: M07-S03-T01 says a saved follow-up "writes Calls (completed)"; D76 (as applied, 25 Sep) made the shared Touches module the one log of every human contact, and D58 keeps Calls for scheduled callbacks. Built per D76/D58: the contact is one Touch (Channel,
- [ ] M07-S04-NOTE-1 (M07-S04) ACTIVITY MAPPING STAGING PROOF (M07-S04; D58): after M02-S07 gives the console's profiles access to Calls and Meetings, confirm on staging that (1) a Call created with Reminder "15 mins" shows a 15-minute reminder (if Zoho's Calls reminder field or value differs in this org,
- [ ] M07-S06-NOTE-1 (M07-S06) CLOSE AS LOST IN ZOHO (M07-S06): the console records a loss as Leads.Lost_At + Lost_Reason and clears Next_Step fields; it never writes Lead_Status, which the blueprint owns (D45). Needed from the super admin: (1) decide whether the Lead Nurturing blueprint should move Lead_
- [ ] M04-S04-NOTE-1 (M04-S04) CSV IMPORT DEPENDENCIES (M04-S04): a retried import is safe only once Leads.Mobile has "Do not allow duplicate values" (M04-S02-NOTE-1) — until then a retry after a part-way failure could write a row twice, so do not enable the import on production before that setting is on.
- [ ] M05-S04-T02 (M05-S04, Tester, Testing phase) Test call times (Sat–Sun) — Run TC-E05-010..011; manual check of the reminder in Zoho CRM calendar.
- [ ] M08-S01-NOTE-1 (M08-S01) JOURNEY FIELDS (M08-S01, super admin): the rungs are the existing Leads date stamps (First_Touch_At, Qualified_At, Engaged_At, Said_Yes_At, Reserved_At, Fully_Paid_At, Allocated_At, Onboarded_At). Two new Leads fields are needed: a checkbox "Engagement Skipped" (API Engageme
- [ ] M16-S01-NOTE-1 (M16-S01) ASSIGNMENTS REPORT — ZOHO SETUP (M16-S01, super admin): (1) a Leads workflow rule "On edit, when Owner is modified" with a field update setting Owner_Assigned_At to the rule's execution time, so owner changes made in Zoho itself (not only through the console, which already s
- [ ] M16-S03-NOTE-1 (M16-S03) NUMBERS SECTIONS STAGING PROOF (M16-S03): the sections use COQL aggregates (select COUNT(id)[, SUM(Units_Interested)] … group by Lead_Source / Owner / Lost_Reason / Forecast). On staging confirm (1) this org's COQL returns aggregate rows keyed "COUNT(id)" and "SUM(Units_Inte
- [ ] M16-S04-NOTE-1 (M16-S04) PLAN READ — WHAT IT NEEDS (M16-S04): (1) at least one Sales_Plans record per period with Plan_Scope "Team", Period_From/Period_To and Target_Units (Collection_Target optional) — the console reads, never writes, them; (2) the paid figure is worked out from Receipts (Match_Sta
- [ ] M16-S06-NOTE-1 (M16-S06) TRANSFERS — ACCESS AND LEGACY (M16-S06): units and value come from the investor's Contact (Origin_Lead = the lead) and its allotments, read with the person's own token. The IR Manager therefore needs Read on Contacts and LLP_UnitAllocation_Module for her team's converted lea
- [ ] M17-S05-NOTE-1 (M17-S05) OWN PROFILE IN ZOHO (M17-S05): the console changes a person's own display name and mobile with PUT /crm/v8/users/{their id} on their own token. Zoho may only allow that for profiles with "Manage Users" or with the users.UPDATE OAuth scope; on staging, sign in as a restricted
- [ ] M20-S07-NOTE-1 (M20-S07) INVESTOR APP CONTRACTS — PEOPLE'S PART (M20-S07): (1) add the investor app codebase to the repo when ready (M20-S07-T04; the stub receiver in console/src/server/contracts/events.ts stands in until then); (2) put two random 32+ character contract signing keys in the server se
- [ ] M17-S06-NOTE-1 (M17-S06) SYSTEM CHECKS — SOURCES (M17-S06): the checks are computed from Plane B (the Zoho call log) plus facts the server holds; two of those facts need a person: (1) the Enterprise licence expiry date (Organization API or entered once by Sahil after each renewal — the check shows "
- [ ] M10-S08-NOTE-1 (M10-S08) PROVISIONAL: the two-farm investor, an app On hold and a locked app are shown only with the new fixture IM:MONEY_DEMO (added to pm/merge-audit/ui-sahil/fixtures-merged.json), because every demo investor in the prototype holds one block and changing the default book would cha
- [ ] M19-S01-NOTE-1 (M19-S01) PROVISIONAL: the a11y lint (npm run lint:a11y) is in place but not wired into a pre-commit hook or CI yet; wire it when CI exists. Controls the prototype leaves unlabelled carry a title rather than an aria-label so the UI cases still find them by their row.
- [ ] M01-S02-NOTE-1 (M01-S02) PROVISIONAL (Jev decide, low confidence): the phase-2 queue was stuck on three dependency cycles (M03-S01>M01-S02>M01-S01, M10-S01<>M10-S07, M08-S02>M10-S02>M08-S03/M08-S02). Dropped the links M01-S02->M01-S01, M10-S01->M10-S07 and M08-S02->M10-S02 in pm/plan-merged/growize-
- [ ] M01-S02-NOTE-2 (M01-S02) PROVISIONAL: A Zoho-signed-in session holds the Zoho CRM user id from CurrentUser as its PersonKey (Jev 0.94), until the Zoho data source keys PEOPLE.
- [ ] M01-S02-NOTE-3 (M01-S02) PROVISIONAL: Only a definitive Zoho refusal (error body or 400/401) on token refresh signs a person out as 'revoked'; a network error, timeout or 5xx fails that one request and keeps the session (Jev, low confidence).
- [ ] M01-S02-NOTE-5 (M01-S02) HUMAN PROOF (after M02-S10-T02): On staging set ZOHO_ACCOUNTS_ORIGIN, ZOHO_OAUTH_CLIENT_ID, ZOHO_OAUTH_CLIENT_SECRET, ZOHO_OAUTH_REDIRECT_URI, ZOHO_SESSION_KEY, ZOHO_CRM_RECORD_ID_PREFIX and ZOHO_SEAT_IDS (from the sanitized roles/profiles export), sign in as Rohit on zoho.i
- [ ] M01-S02-NOTE-6 (M01-S02) HUMAN PROOF (after M02-S10): On staging confirm sign-out revokes the refresh token (Zoho Accounts connected apps no longer lists the grant) and a Marketing-role user is refused with 'No console access: your Zoho account does not hold a console seat.'
- [ ] M18-S04-NOTE-1 (M18-S04) HUMAN: Choose the alert email provider, set ALERT_EMAIL_TO to Sahil's address and plug a real AlertMailer in with setAlertMailer() in console/src/server/ops/runtime.ts; until then alerts sit in an in-memory outbox and no email is sent.
- [ ] M18-S04-NOTE-3 (M18-S04) PROVISIONAL: A 5xx spike alert is at least 5 server errors within 5 minutes (Jev 0.66); every alert rule has a 30-minute cool-down and the credits-header alert fires at most once per Kolkata day.
- [ ] M18-S04-NOTE-4 (M18-S04) PROVISIONAL: Plane B error lines are kept in an in-memory buffer of 2,000 until D47 decides where Plane B is stored.
- [ ] M10-S01-NOTE-1 (M10-S01) HUMAN PROOF: Sahil confirms whether Amount_1..10, UTR/UTR_2..10 and Date_1..10 still exist on LLP_UnitAllocation_Module (or Contacts) - live field metadata on 28 Sep shows neither module has them - and if they exist under other names supplies them to the migration via --slot
- [ ] M10-S01-NOTE-2 (M10-S01) HUMAN: Sahil completes Receipts (M10-S01-T01) by adding Contact and LLP lookups, Kind values Balance and Forfeit, Matched_At, Claim_Id and a unique Idempotency_Key (needed by receipt-replay.ts), which live Receipts lacks today.
- [ ] M10-S01-NOTE-3 (M10-S01) HUMAN: Finance supplies a JSON file mapping each legacy UTR to its mode (NEFT/RTGS/IMPS/SWIFT/UPI/Cheque), kept out of the repo; the migration halts on any UTR not listed.
- [ ] M10-S01-NOTE-4 (M10-S01) PROVISIONAL: A moved legacy payment's Kind is inferred - the payment that brings the allotment to units x unit price is Full, a first payment equal to Token_Advance_Amount is Advance, every other is Part (Jev 0.78).
- [ ] M10-S01-NOTE-5 (M10-S01) PROVISIONAL: Moved legacy receipts get Match_State Matched with a Note naming the source record and slot (Jev, low confidence).
- [ ] M18-S12-NOTE-1 (M18-S12) HUMAN PROOF (M18-S12-T02): Sahil runs node scripts/migrate-legacy-payments.cjs --source allotments --modes modes.json on the sandbox with his own token, Finance reviews any halt and its record ids, then the same command is re-run with --commit on the sandbox and then product
- [ ] M01-S03-NOTE-1 (M01-S03) PROVISIONAL: An IR Manager's team leads are read with no owner filter on the manager's own token, relying on Zoho's role hierarchy, until a server reader of the Zoho Users reporting_to subtree exists (Jev 0.58, low confidence).
- [ ] M01-S03-NOTE-2 (M01-S03) PROVISIONAL: Digital Infrastructure (ops/di) gets the 'all' scope in server/data/scope.ts, but an Administrator-profile seat cannot sign in yet, so that scope is unused until the owner resolves Sahil's profile.
- [ ] M01-S03-NOTE-3 (M01-S03) PROVISIONAL: Field API names for Cases (Category, SLA_Due, Closed_At), ARL_Holdings, ARL_Transactions, allotment Issued_On/Annual_Rental_Yield and Contacts.Originating_IR come from money-types.ts and the Zoho mapping and must be confirmed against the sandbox (M02-S10) before
- [ ] M01-S03-NOTE-4 (M01-S03) GAP: The live source maps leads and investor books only; PEOPLE (the signed-in person's name and entry) and most other Dataset keys stay empty until a Zoho Users reader and their stories are built, so a live screen will show no name.
- [ ] M01-S03-NOTE-5 (M01-S03) HUMAN PROOF (T06): On staging sign in as Rohit, load Leads, block the zohoapis host for 5 minutes and confirm Today shows an error or stale message with Retry, not old counts.
- [ ] M01-S03-NOTE-6 (M01-S03) HUMAN PROOF (T07): With the restricted sandbox user, load Investors as Imran and then as Divya within the cache TTL and confirm each gets their own cache key and list and Plane B lines carry ids and status only.
- [ ] M03-S01-NOTE-5 (M03-S01) PROVISIONAL: The D80 role Compliance and Audit takes Investors seat comp, not audit (Jev 0.97); grants are checked only against the seat's own limit until the manager chain is read from Zoho; the staging sign-in list switch is GZ_SIGNIN_LIST=staging.
- [ ] M10-S07-NOTE-1 (M10-S07) HUMAN: Live proof needs M10-S07-T01 in Zoho (Receipts Contact/LLP lookups filled by Deluge, Payment_Status with values Yet to initiate/Partial/Full and its workflow on match/reversal) plus Receipts Idempotency_Key, tested on the sandbox (M02-S10).
- [ ] M10-S07-NOTE-2 (M10-S07) HUMAN PROOF: In the sandbox record an Advance on a Reserved allotment and confirm the reply shows Payment_Status with source zoho and no mismatch; then set the allotment Cancelled and confirm an Advance is refused as allotment-cancelled and nothing is written to Receipts.
- [ ] M10-S07-NOTE-3 (M10-S07) PROVISIONAL: After a Receipt write the backend re-reads Payment_Status from Zoho and also computes it from Matched receipts (Refund out) against units x unit price, returning both and flagging a mismatch, never writing it (Jev 0.5); receipts are create-only, so a wrong allot
- [ ] M19-S02-NOTE-1 (M19-S02) HUMAN PROOF (T01): After M02-S10 create one sandbox user per seat, copy console/scripts/jev-staging.config.example.json to jev-staging.config.json with real logins and the staging URL, run node console/scripts/jev-sessions.mjs sign-in, then jev-sessions.mjs check must show o
- [ ] M19-S02-NOTE-2 (M19-S02) HUMAN PROOF (T02, TC-E16-003): Add seeded ids for the fixtures, then node console/scripts/jev-staging-run.mjs --only TC-E03-006 must start on Rohit's Today page without a Zoho sign-in page and record a verdict in results.csv.
- [ ] M19-S02-NOTE-3 (M19-S02) HUMAN PROOF (T03): After a staging run, python3 console/scripts/jev-fill-workbook.py <results.csv> growize/pm/IR-Console-Delivery-Plan.xlsx --out <copy>.xlsx fills the Jev columns and reports no missing ids.
- [ ] M19-S02-NOTE-4 (M19-S02) PROVISIONAL: The staging runner resets once per case, not per fixture (Jev 0.91); it uses the existing /api/test/fixture and /api/test/reset endpoints, which need Zoho sandbox seeding behind them on staging (M19-S03); Zoho login autofill uses #login_id/#nextbtn/#password wit
- [ ] M01-S01-NOTE-3 (M01-S01) FACT CHANGE PROPOSED: The rail (lib/selectors/access.ts navFor/MERGE) gives Finance no Transfers or Profile and gives KAM/Head of AM extra Numbers and Teams with no Profile, unlike the acceptance; the server guard enforces the rail as built, so Finance is refused /xfer and t
- [ ] M01-S04-NOTE-1 (M01-S04) PROVISIONAL: Planes B and C are stored as append-only daily JSONL files under LOG_DIR (LOG_STORE=jsonl; Jev 0.93 over a Postgres table or S3 Object Lock, per C-07); Sahil to confirm and to decide when scanned day files ship to a locked archive bucket.
- [ ] M01-S04-NOTE-2 (M01-S04) HUMAN PROOF: Set LOG_STORE=jsonl and LOG_DIR on the staging host (AP4), then run TC-E01-010 (sign-in, refused /numbers, sign-out reach Plane C) and TC-E01-011 (no phone, PAN or email in the ops and identity logs) on staging.
- [ ] M18-S02-NOTE-1 (M18-S02) HUMAN PROOF (T02): On staging sign the restricted sandbox test user in once per role with jev-sessions.mjs, fill console/scripts/leak-matrix.config.json with each role's session and in-scope Zoho record and user ids from the staging seed, then node console/scripts/leak-matri
- [ ] M03-S09-NOTE-1 (M03-S09) PROVISIONAL: IR investor scope uses the filter plus a read-only record share at hand-off (Jev 1.00); refused Investors-side reads go to Plane B now and to Plane C through a hook awaiting a scope-refused action in server/identity/plane-c.ts.
- [ ] M03-S09-NOTE-2 (M03-S09) HUMAN: The handoff-share service credential (AP4) and a caller at the said-yes hand-off in server/leads are needed before record shares run; prove on the Zoho sandbox (M02-S10).
- [ ] M03-S09-NOTE-3 (M03-S09) HUMAN (T04): Sahil creates two restricted IR test users on the sandbox for the API/UI scope probes.
- [ ] M09-S01-NOTE-1 (M09-S01) WAITING: The Finance list read (server/investors/finance-list.ts) needs an API route (e.g. /api/investors/finance calling list and summary behind guardApi), the T02 table on the front end and the Jev UI cases.
- [ ] M09-S01-NOTE-2 (M09-S01) PROVISIONAL: KYC 'NA' is reported as its own value and not counted as not passed; Paid counts only receipts that stand (refunds out); Due is units x price minus what stands on Reserved allotments, as the Payments register works it out.
- [ ] M07-S05-NOTE-1 (M07-S05) HUMAN: Set ORG_EMAIL_DOMAINS=agresearchlabs.com and FOLLOWUP_UNDO_SECRET (32+ characters) in the server secret store, and confirm the user scopes include ZohoCRM.send_mail.all.CREATE and settings read access to from_addresses.
- [ ] M07-S05-NOTE-2 (M07-S05) HUMAN PROOF (TC-E07-024): On staging Rohit sends the Introduction to a test inbox: it arrives from rohit@agresearchlabs.com, the Lead lists it under Emails, and exactly one Email touch reads 'Email approved and sent - From rohit@agresearchlabs.com via Zoho'; capture real sen
- [ ] M07-S05-NOTE-3 (M07-S05) GAP: The Lead needs an NDA-signed stamp (from the Zoho Sign completion) and an NdaReader wired into the email sender; until then the deck and webinar templates are refused, and attaching deck or webinar material is not built.
- [ ] M07-S05-NOTE-5 (M07-S05) PROVISIONAL: When Zoho accepts the email but recording the touch fails, the answer is still sent with a Plane B touch-not-recorded line and a notice to use Log a contact (Jev 0.94); only IR, channel-partner and IR Manager seats may send, a manager only on leads they own or c
- [ ] M19-S04-NOTE-1 (M19-S04) OPS: No CI yet; when a pipeline exists run node console/scripts/jev-calibration-gate.mjs --results <ui-results.json> --run-calibrate pm/jev-calibrate.mjs --calibration <cal-out.json> --record <gate-record.json> after each suite and fail on non-zero exit; copy pm/jev-calibrat
- [ ] M19-S04-NOTE-2 (M19-S04) PROVISIONAL: A seeded-wrong case ending REVIEW warns but does not fail the gate, and mutations a person checked and found still true are excluded from the 1% rule through --reviewed (D63's baseline had 6 of 494 facts over 0.80).
- [ ] M03-S02-NOTE-2 (M03-S02) PROVISIONAL: Grants are kept in an app-side append-only store (GRANT_STORE=jsonl, GRANT_DIR) per Jev (1.00) while OD9 stays open; production must set both or grants are lost on restart and granted-only seats are refused.
- [ ] M03-S02-NOTE-3 (M03-S02) GAP: A user's manager is read from the Zoho user's Reporting_To (reports_to also accepted); the CurrentUser answer checked read-only had no such key, so confirm it on the sandbox with a user who has a manager.
- [ ] M01-S10-NOTE-1 (M01-S10) HUMAN: Build the T03 Zoho approval process on Allocation_Status -> Cancelled and refund Receipts (approvers the tech lead and Pradeep), then set GZ_RELEASE_APPROVAL=on; until then /api/auth/step-up/release refuses with approval-not-configured.
- [ ] M01-S10-NOTE-2 (M01-S10) HUMAN: Register https://<deployment>/api/auth/step-up/callback as a redirect URI on the Zoho OAuth client, set ZOHO_STEPUP_REDIRECT_URI, and set STEPUP_ALERT_TO (Sahil and Pradeep) with the mail provider.
- [ ] M01-S10-NOTE-3 (M01-S10) HUMAN PROOF: On the sandbox show that Zoho Accounts forces a fresh login with prompt=login&max_age=0 and that the approval process leaves $approval_state pending after the API edit.
- [ ] M01-S10-NOTE-4 (M01-S10) PROVISIONAL: Step-up windows, failure counts and locks are kept in process memory, so a restart lifts locks; there is no unlock route yet (StepUp.unlock exists for Digital Infrastructure).
- [ ] M01-S10-NOTE-6 (M01-S10) GAP: After approval the forfeit and refund Receipts are M02-S12's; the reveal and export routes still need wrapping with requireStepUp by their owners.
- [ ] M09-S02-NOTE-1 (M09-S02) HUMAN: Set Contacts to Private sharing with role hierarchy Head of AM > KAMs (KAM reads Contacts where KAM = self; Head of AM reads allotted Contacts and the pool) and prove it with the restricted KAM test user (T01).
- [ ] M09-S02-NOTE-2 (M09-S02) HUMAN: ZOHO_SEAT_IDS must carry the 'Head of Account Management' role id and the 'AM Head' profile id, or the Head of AM's book is refused as seat-denied.
- [ ] M09-S02-NOTE-3 (M09-S02) PROVISIONAL: With no active-KAM reader wired, only an account with no KAM counts as 'No manager'; an account whose KAM has left counts once a reader of current KAM seats is wired.
- [ ] M09-S03-NOTE-3 (M09-S03) PROVISIONAL: An IR's record offers only Who they are, What they hold and Journey (IR_SECTIONS in server/investors/record.ts) until the owner names the sections allowed for IRs.
- [ ] M08-S07-NOTE-1 (M08-S07) HUMAN: Build the Contacts lifecycle blueprint Said yes -> Reserved -> Paid -> Allotted, the arl_code auto-number, and stop native Lead conversion (T01); no lifecycle field exists on Contacts as of 28 Sep 2026.
- [ ] M08-S07-NOTE-2 (M08-S07) FACT CHANGE PROPOSED: Set LIFECYCLE_FIELD in server/investors/lifecycle.ts to the blueprint's Contacts field once T01 creates it; until then the state label is derived from allotments and Said_Yes_At.
- [ ] M08-S07-NOTE-4 (M08-S07) HUMAN PROOF: TC-IM11-003 and TC-IM11-013 need a sandbox lead moved to Said yes by the IR test user.
- [ ] M09-S09-NOTE-2 (M09-S09) PROVISIONAL: The allotment is Issued when the amount covers units x price and Reserved with a 30-day Hold_Until otherwise, although the story's Zoho line says Issued always (Jev 0.87); the money paid becomes one Pending receipt through the allotment-receipts guard, not recei
- [ ] M09-S09-NOTE-3 (M09-S09) HUMAN PROOF: In the sandbox confirm Finance profiles may delete the Contacts and allotments they just created (the rollback) and that COQL accepts ARL_ID like 'ARL-INV-%' order by ARL_ID desc for minting the next code.
- [ ] M10-S21-NOTE-1 (M10-S21) GAP: Contacts.App_Access has field history tracking off and is missing from pm/plan-merged/zoho-field-mapping.json; Sahil to turn on history tracking and add the mapping row so Zoho field history records who and when.
- [ ] M10-S21-NOTE-2 (M10-S21) PROVISIONAL: Unlock writes only App_Access (Hold -> Invite) and leaves App_Welcome_At/App_Welcome_Channel to the app sync (Jev 0.81); 'Locked' is worked out as Hold after an invite, and the lock reason is saved as a Note on the Contact.
- [ ] M10-S21-NOTE-4 (M10-S21) HUMAN PROOF: Needs the investor app's staging webhook (MA1) to prove Invite sends exactly one welcome and App_Welcome_At is written back.
- [ ] M06-S05-NOTE-1 (M06-S05) HUMAN PROOF: In the sandbox sign in as the restricted IR test user and search for a name held only by another IR's lead; Zoho must return nothing.
- [ ] M06-S05-NOTE-2 (M06-S05) PROVISIONAL: The search cache holds only the in-book result count under the leads scope and a per-process HMAC of the term; hit rows are never cached (Jev 0.83).
- [ ] M08-S02-NOTE-1 (M08-S02) FACT CHANGE PROPOSED: Leads.advance_confirmed_at, balance_confirmed_at, supp_verified_at and allotted_at (zoho/field-register.json) do not exist in live Zoho; gates read Receipts.Match_State, allotment units x unit price, Supplementary_Verified_At and Lead.NDA_Verified_At in
- [ ] M08-S02-NOTE-2 (M08-S02) HUMAN: Confirm the IR profile can read the Contact, allotments and Receipts of its own converted lead (the M03-S09 hand-off share); a covering IR who is not the Originating_IR sees no investor, so the gate shows 'your move'.
- [ ] M08-S02-NOTE-3 (M08-S02) HUMAN PROOF: TC-E08-010 on staging: Finance matches the balance receipt, then GET /api/leads/<Prakash>/gate as Rohit shows met true and who null.
- [ ] M08-S05-NOTE-2 (M08-S05) HUMAN: Create the cover-window-share service grant and set ZOHO_COVER_WINDOW_SHARE_REFRESH_TOKEN; without it a cover window is written with shared false and no Zoho record share. Schedule leadsRuntime().sweep() daily after IST midnight.
- [ ] M08-S05-NOTE-3 (M08-S05) HUMAN PROOF: TC-E08-025 in the sandbox: after 'Start today only' Kavya's user opens Sanjay Menon's Lead through a record share, and after 'End the cover' cannot.
- [ ] M08-S05-NOTE-4 (M08-S05) GAP: No Plane C availability/roster reader exists (D49); cover.ts admits nobody by roster until it is built, so TC-E08-020 roster cover is unproven; 'until they are back' is 14 days meanwhile.
- [ ] M11-S01-NOTE-1 (M11-S01) FACT CHANGE PROPOSED: server/data/projections.ts and adapters.ts select Unit_Price, Insurer and Insured_Till, which LLP_Creation_Module lacks (it has Pet_Unit_Price, Insurance_Provider, Insurance_expiry_date), parse the '20%' yield picklist as 0 and map Fully Subscribed/On H
- [ ] M11-S01-NOTE-2 (M11-S01) PROVISIONAL: The one-LLP detail reads the LLP's company PAN and GST on the viewer's token and masks them before they leave the server, never cached or logged (Jev 0.94); Sahil to confirm the no-PAN rule does not cover a company PAN.
- [ ] M11-S01-NOTE-3 (M11-S01) HUMAN: Sahil writes the Block A-F to LLP mapping (T01); production holds one LLP, EKA LLP (22 units, 19 issued), with no Block_Code set.
- [ ] M14-S01-NOTE-1 (M14-S01) GAP: Under Private sharing on Leads an IR's own-token group-by counts only leads that IR can see, so event totals will be too low until Leads sharing or a counts-only rule is decided.
- [ ] M14-S01-NOTE-2 (M14-S01) FACT CHANGE PROPOSED: Leads.Event_Name does not exist; the link is the lookup Leads.Lead_Event -> Lead_Events, and event staff come from Lead_Events_X_Users (userlookup221_3).
- [ ] M13-S02-NOTE-1 (M13-S02) FACT CHANGE PROPOSED: Cases has no Contact_Name or Category field; the investor is Related_To and the category Ticket_Category, so server/data/projections.ts cases should change as server/cases/register.ts reads them.
- [ ] M13-S02-NOTE-2 (M13-S02) HUMAN: Sahil adds app_request_id to Cases and an Investor (or App) value to Case_Origin, which today holds only Email, Phone and Web (T01).
- [ ] M13-S02-NOTE-3 (M13-S02) PROVISIONAL: With no subtree reader the Head of AM's Cases read uses Owner-is-anyone on their own token under Zoho's role hierarchy; ownerWhere in server/cases/predicate.ts is proposed as the shared team predicate.
- [ ] M13-S01-NOTE-1 (M13-S01) PROVISIONAL: The envelope gains an optional sent_at stamped on each send attempt (Jev 0.2, low); investor updates are not pushed because contracts/ has no schema for them (Jev 0.24, low).
- [ ] M13-S01-NOTE-2 (M13-S01) HUMAN: Supply the investor app's staging URL (INVESTOR_APP_URL) and the shared CONTRACT_SIGNING_KEY (MA1); until then the console pushes to the in-process stub.
- [ ] M13-S01-NOTE-3 (M13-S01) HUMAN PROOF: On the sandbox send a signed request.raised to /api/webhooks/investor-app and confirm one Case is created on the Contact and a replay creates none.
- [ ] M13-S01-NOTE-4 (M13-S01) GAP: Nothing calls publishToInvestorApp yet; the Case reply and farm-shelf writers must call it after their Zoho write succeeds.
- [ ] M15-S03-NOTE-2 (M15-S03) HUMAN PROOF: Run scripts/audit-export.cjs against the sandbox to confirm the audit export request, poll and download shapes and CSV columns, then compare one day with Zoho's audit log (T04).
- [ ] M15-S03-NOTE-3 (M15-S03) HUMAN: Choose the AWS account and bucket for S3 Object Lock (D14, AP4); create ZOHO_AUDIT_ARCHIVE_REFRESH_TOKEN with audit-log export and Users read scopes, and schedule scripts/audit-export.cjs nightly with a heartbeat.
- [ ] M15-S03-NOTE-4 (M15-S03) PROVISIONAL: The Auditor's Finance people come from ZOHO_FINANCE_USER_IDS; the module-to-kind table in server/activity/kinds.ts is ours; team ids for IR Manager/Head of AM need a subtree reader not yet wired.
- [ ] M15-S03-NOTE-6 (M15-S03) HUMAN PROOF: T08 UAT - Harsha, Latha, Sahil and Pradeep read their Activity page and sign off.
- [ ] M19-S06-NOTE-1 (M19-S06) HUMAN: TC-E16-011 (rule tests reported on every push) is proven only once the repo is pushed to GitHub and .github/workflows/pipeline.yml runs.
- [ ] M01-S05-NOTE-1 (M01-S05) HUMAN: AP4 hosting account is not chosen, so both Deploy steps in .github/workflows/pipeline.yml are failing placeholders and the staging/production jobs stay skipped until the repository variable HOSTING_READY is true.
- [ ] M01-S05-NOTE-2 (M01-S05) HUMAN: Create GitHub Environments 'staging' and 'production' with the secrets and variables in ops/env/README.md, using separate sandbox and live OAuth clients; push the repo to GitHub (CARRY-FORWARD E).
- [ ] M01-S05-NOTE-3 (M01-S05) HUMAN PROOF: TC-E01-017 (staging talks only to the sandbox) needs the deployed staging site and the M02-S10 sandbox.
- [ ] M19-S05-NOTE-1 (M19-S05) HUMAN: Turn on branch protection for main requiring the 'check' status, add Required reviewers to the 'production' Environment, and add secrets JEV_STAGING_CONFIG_JSON, JEV_SESSIONS_TGZ_B64 and TYPESAFE_API_KEY.
- [ ] M19-S05-NOTE-2 (M19-S05) GAP: pm/jev-calibrate.mjs is not in this repo (only in the growize/pm archive), so the CI calibration gate marks every staging run untrusted until it is copied in unchanged.
- [ ] M19-S05-NOTE-3 (M19-S05) HUMAN PROOF: TC-E16-010 (a failing P1 case blocks promotion and names TC-E05-004) needs a real staging deploy.
- [ ] M03-S04-NOTE-1 (M03-S04) HUMAN: Create the 'kam-pool-return' service grant (ZohoCRM.coql.READ + ZohoCRM.modules.contacts.READ on a profile that sees every Contact, identity fields hidden) and set ZOHO_KAM_POOL_RETURN_REFRESH_TOKEN; without it moving a KAM off the seat answers 503 and changes nothing
- [ ] M03-S04-NOTE-2 (M03-S04) HUMAN: Add ZohoCRM.users.UPDATE to the user OAuth client (M02-S10-T02), give the AM Head and Finance Head profiles 'Manage Users', and confirm on the sandbox that PUT /users/{id} with role and profile {id,name} applies (PROVISIONAL body shape).
- [ ] M03-S04-NOTE-5 (M03-S04) PROVISIONAL: Contacts return to the pool (KAM, KAM_Since, KAM_Intro_At cleared) on the seat-changer's token after an org-scope service read (Jev 0.98); crossing the sign-in line is filed as Plane C access-granted/access-ended (Jev 0.97); lead-side seat changes are not handle
- [ ] M09-S04-NOTE-1 (M09-S04) HUMAN: In Zoho add a Contacts workflow 'KAM changed -> clear KAM_Intro_At', turn on field history for Contacts.KAM, and let only the AM Head profile edit KAM and KAM_Since.
- [ ] M09-S04-NOTE-2 (M09-S04) PROVISIONAL: The console PUT writes only KAM and KAM_Since and leaves KAM_Intro_At to the Zoho workflow (Jev 0.28, low); 'logged with both names' is a Plane C line with user ids only, names coming from Zoho field history (Jev 1.00).
- [ ] M09-S04-NOTE-5 (M09-S04) HUMAN PROOF: On the sandbox as Head of AM name a KAM on an allotted Contact and confirm KAM/KAM_Since change, the workflow clears KAM_Intro_At and field history shows both names.
- [ ] M09-S08-NOTE-1 (M09-S08) HUMAN: In Zoho stamp Contacts.Originating_IR with the lead owner at Said yes, add the sharing rule 'IR role reads Contacts where Originating_IR = self' under Private sharing, and hide money and identity fields from the IR profile.
- [ ] M09-S08-NOTE-2 (M09-S08) HUMAN PROOF: On staging read Contacts through the API as the restricted IR test user and confirm Zoho returns only that IR's own-lead investors, and that another IR's investor by URL gives 403.
- [ ] M11-S02-NOTE-2 (M11-S02) GAP: 'Refuse to save an allotment without Customer and LLP' needs an allotment write path no T02 covers; reads expose linked:false for such rows.
- [ ] M11-S02-NOTE-3 (M11-S02) HUMAN: Hide the older LLP_Unit_Allocation module from console profiles so only LLP_UnitAllocation_Module (related lists Customer1 / Customer_List) is used.
- [ ] M11-S02-NOTE-4 (M11-S02) FACT CHANGE PROPOSED: The story names LLP_Lookup, committed units and Agreement_Signed; the org's allotment module has LLP, Reserved_Units/Issued_Units and Supplementary_Verified_At, which the code uses.
- [ ] M10-S08-NOTE-2 (M10-S08) PROVISIONAL: Blocks are one per allotment, not merged per LLP; totals are cross-checked against register.ts and allotment-receipts.ts (record.ts does not subtract matched refunds and should be aligned).
- [ ] M10-S09-NOTE-2 (M10-S09) FACT CHANGE PROPOSED: server/data/projections.ts holdings/arlTransactions use Contact, Instrument_Type, Amount_Invested, Invested_On, Interest_Rate, Maturity_On, Date, but the org has Investor, Instrument_Class, Invested_Amount, Invested_Date, Interest_Rate_Pct, Maturity_Dat
- [ ] M08-S03-NOTE-1 (M08-S03) FACT CHANGE PROPOSED: There is no Payment_Claims module (D82 agrees), so the IR's payment report is a Receipts record with Match_State = Claimed.
- [ ] M08-S03-NOTE-2 (M08-S03) PROVISIONAL: A claim's Receipts.UTR holds a unique key CLAIM-<leadId>-<n> (Jev 0.73), the IR's reference is kept only masked in the Note, paise are refused, and kind 'other' is stored as Part with a note; a Claim_Ref field would free UTR for bank references.
- [ ] M08-S03-NOTE-3 (M08-S03) HUMAN: Add a unique Idempotency_Key text field to Receipts, and set RECEIPT_IDEMPOTENCY_SECRET and RECEIPT_CONTEXT_SIGNING_SECRET (each 32+ bytes, different); until then /api/receipts answers 503.
- [ ] M08-S03-NOTE-5 (M08-S03) HUMAN PROOF: T06 Jev/API cases and T07 Finance UAT on the sandbox.
- [ ] M14-S02-NOTE-2 (M14-S02) HUMAN PROOF: On the sandbox confirm Event_Staff entries keyed by userlookup221_3 add a user and {id, _delete: null} removes one (getFields suggests the reverse direction of what events.ts reads).
- [ ] M14-S02-NOTE-3 (M14-S02) GAP: No roster reader is wired, so staff are checked for shape and uniqueness only, not that they carry a book.
- [ ] M14-S03-NOTE-2 (M14-S03) HUMAN: Sahil names the tablet intake sheet source and sets Lead_Events.Load_State to Ready when a sheet is ready; nothing sets it today.
- [ ] M14-S03-NOTE-3 (M14-S03) FACT CHANGE PROPOSED: Leads have no Event_Name/Event_Date/Event_Channel; loaded leads carry the lookup Leads.Lead_Event.
- [ ] M13-S03-NOTE-1 (M13-S03) PROVISIONAL: A reply is stored as a Note on the Case and pushed as case.replied; requestToCase now writes Related_To and Case_Origin (the org's names).
- [ ] M13-S03-NOTE-3 (M13-S03) HUMAN PROOF: On the sandbox open a Records ticket as Finance, park and close it, and confirm a KAM and a Compliance seat are refused on a Bank ticket.
- [ ] M13-S03-NOTE-4 (M13-S03) GAP: A new ticket is owned by the opener (or a named owner with assign); the category assignment rule (T01) is not in Zoho yet.
- [ ] M13-S06-NOTE-1 (M13-S06) PROVISIONAL: contracts/update.published.json is added and each update is pushed as one signed event per investor in the segment (Jev 0.82); a Notice is written as Category Other (Jev 0.24, low).
- [ ] M13-S06-NOTE-2 (M13-S06) FACT CHANGE PROPOSED: Add Notice to Investor_Updates.Category, NRI only to Audience, and a text field Audience_Predicate; until then an NRI-only publish is refused.
- [ ] M13-S06-NOTE-3 (M13-S06) HUMAN: Sahil adds the custom function refusing Statement and Compliance updates from Account Management profiles (T01).
- [ ] M13-S06-NOTE-5 (M13-S06) HUMAN PROOF: On the sandbox publish a Statement to everyone as Finance and confirm Sent_Count matches the book and the stub records one update.published per investor.
- [ ] M15-S05-NOTE-1 (M15-S05) GAP: Plane C reveal lines carry only the field, not the chosen reason; Plane C has no test-link action; server/leads/search.ts still files a successful search as a refusal and should use the new log.event kind.
- [ ] M15-S05-NOTE-5 (M15-S05) HUMAN PROOF: TC-E11-016..019 and TC-IM10-010..013 on staging, and a locked archive for the day files.
- [ ] M10-S22-NOTE-1 (M10-S22) PROVISIONAL: The app preview shows payout dates and states to every seat with the record, amounts only to seats with Money (Jev 0.75).
- [ ] M10-S22-NOTE-2 (M10-S22) GAP: Investor_Payouts exists in Zoho but has no rows in pm/plan-merged/zoho-field-mapping.json and no sandbox fixtures.
- [ ] M10-S23-NOTE-1 (M10-S23) PROVISIONAL: The one-time test link comes from a TestLinkIssuer interface that answers 503 not-configured until MA1 names the app's endpoint (Jev 0.25, low); only a reason length code is logged and the words stay in the in-process register (Jev 0.54).
- [ ] M10-S23-NOTE-2 (M10-S23) HUMAN: MA1 must name the investor app's generate-link endpoint and its 'link used' receiver, then a contract is declared in contracts/.
- [ ] M10-S23-NOTE-3 (M10-S23) GAP: No Zoho field marks a test investor account; ZOHO_TEST_INVESTOR_IDS stands in.
- [ ] M10-S03-NOTE-1 (M10-S03) PROVISIONAL: With no answer fields on Receipts both answers move the Claimed report to Match_State 'Not found' and record which answer by a Zoho Note; the confirmed receipt's Note names the report (Jev 0.59).
- [ ] M10-S03-NOTE-4 (M10-S03) FRONT-END LOOP: The claim drawer on Today and Payments reads GET /api/claims and /api/claims/[id], posts confirm with an Idempotency-Key and not-there with {reason}, and the IR's lead page shows 'Finance did not find it: <reason>'.
- [ ] M09-S07-NOTE-1 (M09-S07) PROVISIONAL: Investor search queries Contacts with COQL, the seat's scope in the WHERE and LIKE per token, not the Search API (Jev 0.76).
- [ ] M09-S07-NOTE-2 (M09-S07) HUMAN PROOF: On the sandbox confirm COQL Mobile like '%3017' and Mailing_City like '%Mysuru%' match regardless of case and phone formatting for Finance, KAM and IR seats.
- [ ] M11-S03-NOTE-1 (M11-S03) FACT CHANGE PROPOSED: LLP Units_Reserved/Units_Issued/Units_Released are plain integer fields, so the shelf counts allotted and reserved-or-paid from allotments and flags recordedDiffers where the typed fields disagree.
- [ ] M11-S03-NOTE-2 (M11-S03) HUMAN: Sahil sets up roll-ups or formulas for reserved, issued and available on the LLP (T01) so KAM/IR tokens read org-true counts; until then those seats get countsComplete false.
- [ ] M11-S03-NOTE-3 (M11-S03) HUMAN PROOF: On the sandbox confirm COQL accepts Customer.KAM / Customer.Originating_IR lookup criteria and the SUM group by LLP, Allocation_Status aggregate.
- [ ] M12-S01-NOTE-1 (M12-S01) PROVISIONAL: Personal-scope documents are listed for Finance, Head of Finance, Compliance, Digital Infrastructure, KAM (own book) and Head of AM; audit, exec and bu see none (Jev 0.39, low); an IR gets allotment paperwork counts only, never personal documents (Jev 0.92); /ap
- [ ] M12-S01-NOTE-2 (M12-S01) FACT CHANGE PROPOSED: D70 lets the originating IR see personal documents but M12-S01 AC6 says an IR never does; the code follows AC6.
- [ ] M12-S01-NOTE-3 (M12-S01) HUMAN: Sahil sets the T02 profile permissions and sharing so Attachments on Contacts, allotments and LLPs follow the scope table, and proves them with the restricted user.
- [ ] M12-S01-NOTE-4 (M12-S01) GAP: There is no Documents module in the org (type, scope, signing state), so reads return attachment metadata only; server/investors/record.ts should import listAttachments from server/documents/attachments.ts.
- [ ] M17-S01-NOTE-2 (M17-S01) PROVISIONAL: A Zoho user whose status is not 'active' is treated as left (seated from the role they still hold); confirm the deactivated status value and that GET /users?type=AllUsers returns them on the sandbox.
- [ ] M17-S01-NOTE-4 (M17-S01) HUMAN PROOF: Confirm KAM, viewer and IR profiles can read GET /users?type=AllUsers and the Contacts.KAM / Leads.Owner count aggregates on the sandbox.
- [ ] M13-S05-NOTE-1 (M13-S05) GAP: Cases has no app_request_id field, so request.raised is idempotent on a persistent index plus a COQL match on the Subject marker '- ref <app_request_id>' (Jev 0.73); switch to the field once it exists.
- [ ] M13-S05-NOTE-2 (M13-S05) PROVISIONAL: The Contact check requires actor.kind investor and actor.investor_contact_id equal to the request's Contact, and arl_code (when sent) equal to ARL_ID; a mismatch answers 422 (Jev 0.97). Request kinds map to Ticket_Category bank_change/payout_mandate Bank, exit C
- [ ] M13-S05-NOTE-3 (M13-S05) FACT CHANGE PROPOSED: contracts/request.executed.json gains state 'received' and an optional case_id so the app can link case.replied to its request (Jev 0.96); the investor app must accept it (MA1).
- [ ] M13-S05-NOTE-4 (M13-S05) HUMAN: The investor app must send actor.investor_contact_id on every request.raised; confirm with the app team together with MA1's Supabase-user-to-Contact mapping.
- [ ] M13-S05-NOTE-5 (M13-S05) GAP: A request whose Contact has no KAM is created under the provider-callback token's user until a routing rule exists.
- [ ] M13-S05-NOTE-7 (M13-S05) HUMAN PROOF: TC-IM08-016 on the sandbox (POST request.raised R-1 twice, one Case) once the signing key and staging exist.
- [ ] M10-S20-NOTE-1 (M10-S20) PROVISIONAL: The 60-month payout schedule is anchored on the allotment's Investment_Date until an issue-date field exists (Jev 0.14, low); LLP_UnitAllocation_Module has no Issued_On, and the data layer now reads Investment_Date instead.
- [ ] M10-S20-NOTE-2 (M10-S20) HUMAN: Investor_Payouts has no unique field; make Name (<allotmentId>-NN) unique so concurrent schedule runs can never duplicate an instalment.
- [ ] M10-S20-NOTE-4 (M10-S20) HUMAN PROOF: Run scripts/payouts-schedule.cjs without and with --commit on the sandbox and mark one payout paid.
- [ ] M05-S06-NOTE-2 (M05-S06) HUMAN PROOF: TC-IM03-015 on the sandbox: a cold Today render spends at most five COQL calls and Zoho accepts COQL aggregates grouped by the Allotment lookup on Receipts.
- [ ] M08-S04-NOTE-1 (M08-S04) HUMAN: Build Zoho approval processes on LLP_UnitAllocation_Module for the extend edit (Hold_Until + Hold_Extension_State=Requested) and the lapse edit (Allocation_Status=Cancelled), then set GZ_EXTEND_APPROVAL=on and GZ_RELEASE_APPROVAL=on.
- [ ] M08-S04-NOTE-2 (M08-S04) PROVISIONAL: 'Extend the hold' is one guarded edit of Hold_Until (old deadline + days) with the request fields, held by Zoho's approval process (Jev 0.89).
- [ ] M08-S04-NOTE-4 (M08-S04) FACT CHANGE PROPOSED: Receipts.Kind has no Forfeit value, so the lapse carries the forfeit in the Refund receipt's Note; add Forfeit to the picklist to list forfeits as rows.
- [ ] M08-S04-NOTE-5 (M08-S04) HUMAN PROOF: On the sandbox confirm the Pending Refund insert succeeds although Receipts.Name is system-mandatory and neither the replay path nor the lapse sets it.
- [ ] M08-S08-NOTE-2 (M08-S08) HUMAN: Sahil finishes T01 - App_Account_Mark is a plain picklist and there is no permanent_at field; the console sets Tentative on the first match and leaves Permanent to Zoho.
- [ ] M10-S05-NOTE-1 (M10-S05) HUMAN: Create a Statements module (Finance-only, Attachments, fields Name, Period_From, Period_To, Lines, Lines_Matched, Lines_Needs_Owner) and set ZOHO_STATEMENTS_MODULE; until then /api/statements answers 503.
- [ ] M10-S05-NOTE-4 (M10-S05) HUMAN PROOF: TC-IM05-026 (KAM token refused on Statements) and TC-IM05-027 (manual 20-line reconciliation) need the live module and profile.
- [ ] M11-S04-NOTE-1 (M11-S04) HUMAN: Install zoho/deluge/take_back_guard.dg as a validation rule function on LLP_Creation_Module.Units_Released (sandbox, then production) with the growize_crm connection per zoho/deluge/README.md.
- [ ] M11-S04-NOTE-2 (M11-S04) HUMAN PROOF: On the sandbox set Block A's Units_Released to 0 while units are held, confirm Zoho refuses it, and save the refusal body as __fixtures__/farms/guard.units-held-refused.response.json to confirm the mapping.
- [ ] M11-S04-NOTE-4 (M11-S04) PROVISIONAL: Release and take-back write only Units_Released (Total_Units or 0) and leave LLP_Status untouched (Jev 0.56); Sahil cannot release while his seat is an Administrator profile.
- [ ] M11-S07-NOTE-1 (M11-S07) HUMAN: Install zoho/deluge/oversell_guard.dg as a validation rule function on LLP_UnitAllocation_Module (Reserved_Units, Issued_Units, LLP) with the growize_crm connection (ZohoCRM.coql.READ, modules.READ) and report any compile error (T02).
- [ ] M11-S07-NOTE-2 (M11-S07) HUMAN PROOF: On the sandbox run TC-IM06-017 (a 2-unit Reserved allotment on the full Block B), confirm Zoho refuses it, and save the refusal body so ZOHO_GUARD_RULES can be tightened to the real code.
- [ ] M12-S02-NOTE-2 (M12-S02) HUMAN PROOF: On the sandbox upload a PDF to an allotment and to the Supplementary_Agreement slot as Harsha and confirm Zoho shows Harsha as uploader.
- [ ] M12-S02-NOTE-3 (M12-S02) PROVISIONAL: Upload seats until OD8 - Finance, Head of Finance and DI on all Investors-side scopes, Compliance on personal papers only, IR/channel partner/IR Manager only the lead NDA on leads they own or cover.
- [ ] M12-S03-NOTE-1 (M12-S03) PROVISIONAL: Jev chose reading Zoho Sign with the service token (0.07), which breaks D53, so rows come from CRM *_Sign_Req_Id/*_Signed_Via/*_Verified_At fields and a per-viewer Sign reader hook is left unwired; Send/Verify only for fin, head, di and ops until OD8.
- [ ] M12-S03-NOTE-2 (M12-S03) GAP: No Documents module and no Sign_Status/Sign_Sent_At fields, so 'sent by', 'sent on', expiry and live Sign status stay empty until they exist or a per-user Zoho Sign client does.
- [ ] M12-S09-NOTE-2 (M12-S09) HUMAN PROOF: On the sandbox confirm the v8 Emails list and open responses match the recorded fixtures.
- [ ] M12-S09-NOTE-3 (M12-S09) PROVISIONAL: An IR Manager reads lead emails only on leads they own or cover until a team (subtree) reader exists.
- [ ] M13-S04-NOTE-1 (M13-S04) HUMAN: Create Cases fields Handed_By (user lookup, lookup sharing Read Only) and Handed_At (DateTime) and turn on field history for Owner and Handed_By; the Tickets register already selects both, so the live Tickets read fails until they exist.
- [ ] M13-S04-NOTE-2 (M13-S04) PROVISIONAL: The KAM stays the watcher through Handed_By with lookup sharing; the register reads Owner = me or Handed_By = me (Jev 0.62).
- [ ] M13-S04-NOTE-3 (M13-S04) HUMAN PROOF: On the sandbox confirm change_owner works on a KAM's own token (Change Owner permission on Cases) and that Imran can still read the Case afterwards but cannot close it.
- [ ] M13-S04-NOTE-4 (M13-S04) HUMAN: File the cancelled cheque as a personal document on the Contact (Bank_Proof) with the KAM profile denied access, never on the Case (T02, D70).
- [ ] M17-S02-NOTE-2 (M17-S02) HUMAN PROOF: On the sandbox confirm PUT /users/{id} with Reporting_To changes a manager on a non-admin changer's token, and run TC-E14-004 and TC-E14-022 with a real restricted user.
- [ ] M17-S02-NOTE-3 (M17-S02) PROVISIONAL: A manager change is refused when the new manager is neither the changer nor someone they manage (the prototype only checks that the manager exists).
- [ ] M12-S04-NOTE-1 (M12-S04) HUMAN: Zoho Sign API plan with webhooks on sign.zoho.in (AP3) and ZohoSign.documents scopes added to the staff OAuth client, since send, remind, recall and the status read run on the person's own token.
- [ ] M12-S04-NOTE-2 (M12-S04) HUMAN: Finance's Zoho Sign templates (MA2) each with exactly one SIGN action and Aadhaar eSign set inside the template, because the API has no Aadhaar key and an uploaded PDF with Aadhaar is refused.
- [ ] M12-S04-NOTE-3 (M12-S04) FACT CHANGE PROPOSED: Per D77 only *_Sign_Req_Id and *_Signed_Via are written; status and sent time are read live from Zoho Sign instead of being written to the record.
- [ ] M12-S04-NOTE-5 (M12-S04) PROVISIONAL: Send, remind, recall, verify and block seats are fin, head, ops and di on every paper plus comp on the FEMA declaration, until OD8.
- [ ] M12-S05-NOTE-1 (M12-S05) HUMAN PROOF: A sandbox run of a real Zoho Sign webhook (x-zs-webhook-signature, operation_type/performed_at dedupe key) and of the decline-reason key in GET /requests/{id}.
- [ ] M12-S05-NOTE-3 (M12-S05) PROVISIONAL: A valid webhook writes nothing for sent/viewed/declined/expired/recalled and runs the filing only on a re-read 'completed' (D77, Jev 0.81).
- [ ] M12-S06-NOTE-1 (M12-S06) HUMAN: The provider-callback service profile needs write on the slot file fields and *_Verified_At (FLS, T01), and each slot file field must accept the signed PDF.
- [ ] M12-S06-NOTE-2 (M12-S06) FACT CHANGE PROPOSED: Contacts.Agreement_signed (Yes/No picklist) exists but is not written; the signed stamp stays Supplementary_Verified_At - confirm or retire the legacy picklist.
- [ ] M12-S06-NOTE-3 (M12-S06) HUMAN PROOF: On the sandbox prove GET /requests/{id}/pdf returns a single PDF for one-document requests and that automated filing leaving *_Verified_By empty is acceptable.
- [ ] M12-S07-NOTE-1 (M12-S07) PROVISIONAL: The block reason is a Zoho Note on the record and the slot's request id, method and verified fields are cleared, because no blocked or reason field exists (Jev 0.78).
- [ ] M12-S07-NOTE-2 (M12-S07) FACT CHANGE PROPOSED: Add *_Blocked_At and *_Blocked_Reason per paper slot so the Documents list can show a blocked row and its reason.
- [ ] M12-S08-NOTE-1 (M12-S08) PROVISIONAL: Requests are created without is_embedded so the email path always works; embedtoken answers 409 'sign from the email' if Zoho refuses (Jev 0.83); embedtoken and the Contact read run on the provider-callback service credential because the investor has no Zoho tok
- [ ] M12-S08-NOTE-2 (M12-S08) HUMAN: The investor app codebase, CONTRACT_SIGNING_KEY, its origin (INVESTOR_APP_URL or SIGN_EMBED_HOSTS) and its Supabase-user-to-Contact mapping (MA1).
- [ ] M05-S07-NOTE-3 (M05-S07) HUMAN PROOF: Live proof of Harsha's, Fahad's and Latha's queues on the sandbox.
- [ ] M05-S08-NOTE-3 (M05-S08) FACT CHANGE PROPOSED: Conversations are stored in Touches against the origin Lead, not on the Contact as AC4 says; accept Touches-on-Lead or add a Contact lookup to Touches.
- [ ] M05-S08-NOTE-4 (M05-S08) PROVISIONAL: Tickets open on the KAM are a tile and a separate list, not queue rows, matching the front end's mineQueue (Jev 0.75); the KAM access re-check is copied from server/data/live.ts and should be exported from there.
- [ ] M05-S08-NOTE-5 (M05-S08) HUMAN PROOF: Imran's and Divya's day on staging (T04 UAT).
- [ ] M16-S08-NOTE-2 (M16-S08) PROVISIONAL: COQL rejects PAN_Proof/Bank_Proof in criteria, so a proof slot counts as missing while its *_Verified_At is empty (Jev 0.95); Collection counts matched receipts only (D21, as Today) and differs from the register's netBanked until the register follows D21.
- [ ] M16-S09-NOTE-3 (M16-S09) HUMAN PROOF: With Receipts set to none for Account Management profiles (AP2), a live KAM probe of /api/numbers/investors-side?section=cash answers 403 money-hidden.
- [ ] M18-S01-NOTE-1 (M18-S01) HUMAN PROOF: Run node console/scripts/load-test.mjs on staging with 6 lead-side and 15 Investors-side sandbox sessions and --log-dir set to the staging LOG_DIR; attach the report showing p95 <= 2000 ms, no concurrency 429 and in-flight peaks <= 12 overall and 8 complex.
- [ ] M18-S01-NOTE-2 (M18-S01) GAP: Today's lead-side reads cannot be one COQL (COQL queries one module), so Tasks, Calls and Events cost three calls per 100 open leads; only Zoho's Composite API would cut that.
- [ ] M18-S01-NOTE-3 (M18-S01) PROVISIONAL: The daily credit projection assumes the header first appears at half the daily allowance (D47) and projects to Kolkata midnight, an early-warning estimate; the load-test page-to-API map must be checked against the front end's calls.
- [ ] M11-S05-NOTE-1 (M11-S05) HUMAN: Create the Allotment blueprint on LLP_UnitAllocation_Module Allocation_Status Reserved -> Issued (T01) with conditions Alloc_Letter_Verified_At set, balance due 0, KYC Completed and FEMA_Verified_At when FEMA_Applicable; Allocation_Status is still an ordinary editable
- [ ] M11-S05-NOTE-2 (M11-S05) HUMAN PROOF: On the sandbox record the real GET/PUT /actions/blueprint answers to replace the hand-built fixtures under __fixtures__/allot, and confirm a direct PUT of Allocation_Status is refused (TC-IM06-016).
- [ ] M11-S05-NOTE-4 (M11-S05) FACT CHANGE PROPOSED: The story says rung 7 ticks from the allotment, but journey.ts numbers it rung 8 'Allocated' and its alloc gate does not read Allocation_Status Issued or allotment.done.
- [ ] M11-S05-NOTE-5 (M11-S05) GAP: No field stores the e-Mudhra reference; lapse-release.ts still writes Allocation_Status Cancelled by update(), so Allocation_Status cannot be added to the client's blueprint-owned fields until it moves to a transition.
- [ ] M11-S05-NOTE-6 (M11-S05) PROVISIONAL: The letter's verification stamp is written before the transition because the blueprint condition reads it, so a refused allotment leaves the letter verified.
- [ ] M12-S11-NOTE-1 (M12-S11) HUMAN: Create on Leads the proposed round fields NDA_Told_Via (Call/WhatsApp/Email), NDA_Told_At, NDA_Told_By, NDA_Chase_Count, NDA_Last_Chase_At, NDA_Last_Chase_Via, NDA_Said_At, NDA_Said_By and the same eight with prefix Supp_, IR-editable on these only, plus a sharing rul
- [ ] M12-S11-NOTE-2 (M12-S11) PROVISIONAL: IR chases are a per-round count plus last-chase stamp and channel on the Lead with detail in the Touch and Note (Jev 0.26, low); every IR step of both rounds lives on the Lead (Jev 0.73); the IR's word for Finance is the round's Said_At/Said_By matched by round 
- [ ] M12-S11-NOTE-3 (M12-S11) FRONT-END LOOP: The lead page Paperwork row GETs /api/leads/[id]/paperwork and sends each step's rowToken (plus channel, attachmentId or link) and undoToken back; Finance's queue and verify panel use hints.ts hintForDocument/rankForFinance.
- [ ] M12-S11-NOTE-4 (M12-S11) HUMAN PROOF: TC-E09-001..009 and TC-IM07-008..010 on the sandbox once the fields and sharing rule exist.
- [ ] M12-S12-NOTE-1 (M12-S12) HUMAN: Create on Leads Supp_Draft_Version, Supp_Draft_Ref, Supp_Draft_At, Supp_Draft_By, Supp_Agreed_Ref, Supp_Agreed_Version, Supp_Agreed_At, Supp_Agreed_By (proposed; not in the org).
- [ ] M12-S12-NOTE-2 (M12-S12) GAP: Finance's Send on the allotment should offer the agreed draft (Lead.Supp_Agreed_Ref) in the documents send flow.
- [ ] M12-S13-NOTE-1 (M12-S13) HUMAN: Create Leads.Pitch_Deck_Sent_At (datetime, IR-editable) and put the approved pitch deck (MA4) in Zoho so its file id can be attached.
- [ ] M12-S05-NOTE-5 (M12-S05) HUMAN PROOF: Confirm a viewer's own Zoho token carries the ZohoSign scope so Documents rows show Viewed/Declined/Recalled and sent dates, and that one 10-minute sign-check cycle appears in Plane B once ZOHO_SIGN_API_ORIGIN and ZOHO_PROVIDER_CALLBACK_REFRESH_TOKEN are set.
- [ ] M10-S08-NOTE-3 (M10-S08) PROVISIONAL: By-allotment and the investor record count matched money only with a per-block recorded figure for Pending receipts (Jev 0.67).
- [ ] M09-S09-NOTE-4 (M09-S09) GAP: Add-paid still writes its own 30-day Hold_Until on a Reserved allotment; match.ts moves it only if the match gives a later day. The add-paid answer now says the app opens when the Head of Finance matches the receipt.
- [ ] M18-S08-NOTE-1 (M18-S08) WAITING: T08 UAT defect fixes start only once exploratory sessions and UAT (T01-T07) run on staging; nothing to build before then.
- [ ] M02-S13-NOTE-1 (M02-S13) FACT CHANGE PROPOSED: M02-S13 acceptance names Contacts KYC_Proof/Nominee_Form and Signed_NDA on the allotment; D79 put FEMA/PAN/bank proofs on the Contact and the NDA on the Lead, and the build follows D79. Rewrite the acceptance to D79's slot list (build audit D109).
- [ ] M03-S05-T02 (M03-S05, Sahil, Before its story (do early)) Digital Infrastructure profile for Sahil (non-admin) — Create profile "Digital Infrastructure" with every module of both sides and no Administrator; move Sahil's user onto it; keep the permanent super admin separate (D110).
- [ ] M11-S01-NOTE-5 (M11-S01) PROVISIONAL: LLP drawer shows SPOCs as "SPOC 1/2" (LLP_Creation_Module has no role field); fixture masks PAN/GST with maskId, live uses maskPan (different format). freeUnits floored at 0 as the route does.
- [ ] M09-S03-NOTE-4 (M09-S03) PROVISIONAL: record sections follow the route sectionsFor — Finance no Care tab on an allotted investor, KAM sees Care on any investor, FEMA banner only for seats that see Money (prototype showed it to all). Badge counts and gone-quiet banner still from the book until M05-S0
- [ ] M10-S02-NOTE-5 (M10-S02) PROVISIONAL: wiring fixture half serves the client demo book through lib/data/api (routes answer fixture mode with nothing), to keep one copy of the demo book while unwired reducer screens still write to it (rule 1).
- [ ] M01-S01-NOTE-6 (M01-S01) PROVISIONAL: live session book has blank names (session holds only a Zoho id and a seat token); the template sends a signed-out person to "/" without remembering the page asked for.
- [ ] M01-S09-NOTE-2 (M01-S09) PROVISIONAL: live top-bar wording "Browser online · Zoho" / "Live from Zoho, on your own sign-in" is the builder's own.
- [ ] M01-S10-NOTE-7 (M01-S10) PROVISIONAL: the chosen reveal reason is not carried across the Zoho step-up round trip; fixture mode never opens a step-up, so the demo never reveals and a hold release cannot complete in fixture mode.
- [ ] M03-S02-NOTE-5 (M03-S02) PROVISIONAL: "Remove all access" (resetCaps) has no route and still runs only the reducer.
- [ ] M17-S02-NOTE-5 (M17-S02) PROVISIONAL: a lead-side 403 step-up answer shows the message but offers no "Confirm with Zoho" button yet.
- [ ] M17-S01-NOTE-5 (M17-S01) PROVISIONAL: the Teams person drawer still reads the book; availability/clash/changed tags absent live.
- [ ] M05-S06-NOTE-4 (M05-S06) PROVISIONAL: fixture "as of" is the frozen demo clock (00:00); holds-ending chip still from the book (no route); balance outstanding counts matched receipts only (D21).
- [ ] M05-S07-NOTE-5 (M05-S07) PROVISIONAL: claim row "from <IR>" is fixture-only (route row does not name the IR); super user's Account Management queue still from the book; the route has no send/declined paper row — a "send a new one" row kind is an owner decision (M05-S07-NOTE-2).
- [ ] M16-S09-NOTE-4 (M16-S09) PROVISIONAL: the Investors-side switch for an IR is still decided by the store's sidesOf, not the route's side:null.
- [ ] M16-S08-NOTE-3 (M16-S08) PROVISIONAL: Service stays on the book (no route); At risk now by days since last receipt; Compliance drops the Aadhaar column (rule 7); per-LLP Collection split not rendered (route returns LLP ids without names).
- [ ] M08-S04-NOTE-7 (M08-S04) PROVISIONAL: Investors-side Extend has no reducer, so the fixture returns pending-approval and writes nothing; release now sits behind the D22 step-up.
- [ ] M09-S02-NOTE-5 (M09-S02) PROVISIONAL: AM rows are still the book's (no AM list route).
- [ ] M09-S07-NOTE-4 (M09-S07) PROVISIONAL: one letter or <4 digits is a 400 term-too-short as the route does (demo used to filter on one character); no farm filter control on the page.
- [ ] M09-S09-NOTE-5 (M09-S09) PROVISIONAL: fixture mirrors the route — Issued when the amount covers units × price, else Reserved.
- [ ] M11-S02-NOTE-5 (M11-S02) PROVISIONAL: Receipts/Payouts tabs on an allotment row show only where the book holds the allotment.
- [ ] M11-S05-NOTE-7 (M11-S05) PROVISIONAL: with several Reserved allotments one press allots the first.
- [ ] M09-S04-NOTE-6 (M09-S04) PROVISIONAL: per-KAM counts in the drawer still from the book (/am returns only two totals).
- [ ] M10-S01-NOTE-7 (M10-S01) PROVISIONAL: GET /api/payments did not exist and was added (guard-core + contract table); register rows carry no notes; "Show the reference" (TC-E15-009) not implemented.
- [ ] M12-S01-NOTE-6 (M12-S01) PROVISIONAL: the route's AttachmentLine has only name, size, time — slot and uploader no longer shown.
- [ ] M12-S04-NOTE-6 (M12-S04) PROVISIONAL: live send needs a Zoho Sign templateId the panel does not pick (sends ""); DSC and wet signature both map to email-otp.
- [ ] M12-S04-NOTE-7 (M12-S04) FACT CHANGE PROPOSED: M12-S03 "Everything on file" follows the route (FEMA, supplementary, allocation letter only — no NDA, no receipts): 29 not 45 on the demo; the lead-side Documents page (features/docs/DocsPage.tsx) is not wired.
- [ ] M12-S11-NOTE-6 (M12-S11) PROVISIONAL: RoundView lacks Finance's "not signed after all" note; Finance queue ordering (rankForFinance) needs a batch route.
- [ ] M14-S01-NOTE-4 (M14-S01) PROVISIONAL: events route serves only lead id, name, status — the event page drops Owner/Total columns and Fully paid/Investor bars; Upcoming/Completed still read Sheet-ready banners from state.SHEET.
- [ ] M13-S05-NOTE-8 (M13-S05) PROVISIONAL: deliveries are one GET per open row (N+1) until a list route exists.
- [ ] M14-S02-NOTE-5 (M14-S02) PROVISIONAL: events routes return no Modified_Time, so PATCH goes without it; staff picker uses assignees(state) (no roster reader).
- [ ] M18-S14-NOTE-2 (M18-S14) PROVISIONAL: 42 of 51 GET routes are marked needsSandbox (no judgeable body without Zoho); 47 body-input cases skipped (reach Zoho or 503 before reading the body). In fixture mode GET /api/data serves full pan/bank/utr to every seat (test-only book).
- [ ] M18-S15-NOTE-1 (M18-S15) PROVISIONAL: page CSP uses a per-request nonce + strict-dynamic (every page rendered per request); style-src keeps unsafe-inline; HSTS sent on every response, no preload until hosting (AP4); rate limits in-process keyed on the right-most X-Forwarded-For hop — needs a shared 
- [ ] M12-S05-NOTE-7 (M12-S05) BLOCK: Zoho Sign webhook still does the Sign re-read and CRM searches inline before acknowledging (M20-S08-NOTE-3); the EXPECTED-TO-CHANGE test pins it until the durable worker exists. Dead letters and the seen store persist only when LOG_DIR is set.
- [ ] M12-S05-NOTE-8 (M12-S05) PROVISIONAL: no stale-timestamp refusal for Zoho Sign (HMAC covers the body only); investor-app route has no dead-letter list.
- [ ] M18-S08-NOTE-2 (M18-S08) PROVISIONAL: defect triage SLAs in docs/uat/defect-intake.md are proposed (source only says same-working-day response); no scenario yet for the business owner, channel partners or the investor in the app; Farm ops blocked on its Zoho role (M03-S05-NOTE-2).
- [ ] M20-S07-NOTE-2 (M20-S07) OWNER: confirm with Zoho support whether a portal-user token/API exists before closing MA1; the spike read docs through a summarising fetch, so "not found" is not proof of absence.
- [ ] M19-S13-NOTE-1 (M19-S13) PROVISIONAL: decide threshold measured 0.50 (38 controls, 34/34 right at ≥0.50); build-audit type UNTRUSTED (44%) — its answers now read REVIEW; the never-list forces "owner" on decide and scans only the caller's own text.
- [ ] M14-S02-NOTE-6 (M14-S02) PROVISIONAL: the events staff picker still uses assignees(state) — no roster reader (M14-S02-NOTE-5 staff part).
- [ ] M09-S04-NOTE-7 (M09-S04) PROVISIONAL: manager names come from the Zoho user list on the head's token (null → "a manager" if refused); tier computed from issued units (A 4+, B 2–3, C 1) — no Tier field.
- [ ] M16-S08-NOTE-5 (M16-S08) PROVISIONAL: live Service is served only to KAM / Head of AM; Finance and other money seats get 403 no-book while the demo serves them; pool row drops the "on a concern" flag.
- [ ] M13-S05-NOTE-9 (M13-S05) PROVISIONAL: thread shows Notes only — no investor-reply source exists (case.replied goes out only); identity-shaped text in notes is masked.
- [ ] M17-S01-NOTE-6 (M17-S01) PROVISIONAL: live availability is only "Left the company" / "No absence is recorded" — Zoho keeps no absences (needs a source, D49).
- [ ] M12-S03-NOTE-4 (M12-S03) PROVISIONAL: lead-side list shows NDA rows only as the route does; document class and Issued/Filed states gone.
- [ ] M12-S04-NOTE-8 (M12-S04) PROVISIONAL: GET templates and page_context written from Zoho Sign docs, not yet run against the sandbox; the demo has no templates so no picker shows there.
- [ ] M11-S07-NOTE-6 (M11-S07) FACT CHANGE PROPOSED: M11-S07 AC1 says recording the advance is refused; D21/rule 3 say recording money is always allowed — built as: the reservation is refused, money against an existing reservation is always recorded. Proposed AC1: "the reservation is refused, and any mone
- [ ] M12-S01-NOTE-7 (M12-S01) PROVISIONAL: typed-slot files carry the slot but no uploader/time (Zoho file-upload value does not say who); plain Attachments carry the uploader but no slot; file-upload value keys copied from the uploader, unverified live.
- [ ] M01-S08-NOTE-9 (M01-S08) FIXED 4 Oct (d95c79d): Investors record-a-receipt now goes through the save queue (4-min renew, 5-min offline cap, queuedAt = preparedAt + monotonic time, retry = new key); TC-IM01-008/009 PASS. Still open: the live prepare → offline press → reconnect integration case agains
- [ ] M01-S01-NOTE-7 (M01-S01) PROVISIONAL: Google Fonts links removed from the layout (TC-IM01-001: Inter is embedded; mono now falls back to system monospace — embed IBM Plex Mono as a data URL if it must stay); the shell keeps two polite live regions (#live, #save-status) though TC-IM01-001 says one.
- [ ] M01-S07-NOTE-1 (M01-S07) PROVISIONAL: CI grep gate scripts/no-native-dialogs.cjs (npm run check:dialogs) allows alert/confirm/prompt only where a file binds them itself; last native window.confirm (useUntick) replaced by an in-page confirmation.
- [ ] M02-S04-NOTE-1 (M02-S04) PROVISIONAL: zoho/field-register.json is still hand-authored; the new test ties it to the mapping, identity.ts and SENSITIVE_CONTACT_FIELDS. Its pan/bank_account/aadhaar_* names are stale aliases — real names PAN_Number, Bank_Account_Number, Aadhaar_*.
- [ ] M10-S05-NOTE-5 (M10-S05) PROVISIONAL: docs/runbooks/weekly-reconciliation.md leaves the upload weekday to Finance; bank charges/debits with no receipt cannot be closed in the console.
- [ ] M10-S07-NOTE-4 (M10-S07) PROVISIONAL: 13 proposed UI cases for stories with no/ui-todo cases (M10-S07/S09/S20/S21/S22/S23, M16-S02/S04) in docs/reports/p3-money-proposed-ui-cases.json — promote into ui-cases.json if approved; negative facts score 0.61–0.63 (borderline, D63).
- [ ] M12-S01-NOTE-8 (M12-S01) FACT CHANGE PROPOSED: D70 lists the originating IR under personal-scope documents, AC6 says an IR never sees them; code and the new isolation suite follow AC6. Scope table for owner confirmation: docs/reports/m12-document-scope-table.md.
- [ ] M12-S04-NOTE-9 (M12-S04) PROVISIONAL: TC-IM07-005/006 and TC-E09-011..013 exist in the plan but not in ui-cases.json, so story runs skip them; proved from scratch copies (all pass) — add them to ui-cases.json if wanted.
- [ ] M12-S10-NOTE-1 (M12-S10) Local isolation suite built: console/src/server/http/contract/isolation.test.cjs (63 cases, seat × record-owner over documents, emails, tickets, search, embed signing). Real-Zoho sharing / restricted-user (T11) proof, sign-request listing and two-user probe need the sandbox.
- [ ] M13-S01-NOTE-5 (M13-S01) PROVISIONAL: all-events.test.cjs covers 31 schemas incl. update.published; contracts/README still says 30.
- [ ] M15-S05-NOTE-7 (M15-S05) PROVISIONAL: sign-in history checked weekly on Monday plus on demand by Digital Infrastructure (ops/runbooks/sign-in-history.md) — owner confirms.
- [ ] M09-S08-NOTE-5 (M09-S08) PROVISIONAL: IR sees their investor's mobile/email (irContacts projection) but no address, nominee, KYC or money; state cannot tell Paid from Reserved for an IR; other-IR record by id is 403 live / 404 fixture. Zoho FLS for the IR profile (M09-S08-NOTE-1) still has to hide i
- [ ] M10-S02-NOTE-8 (M10-S02) HUMAN: M10-S02-NOTE-3 (Zoho validation rule Matched_By ≠ Created_By) must apply to refunds only, or not be created — for all receipts it would block D113.
- [ ] M15-S05-NOTE-8 (M15-S05) PROVISIONAL: Finance seats now also see a masked reference and must reveal it (masked by default for everyone, rule 7); live reveal untested against Zoho (needs sandbox).
- [ ] M19-S08-NOTE-1 (M19-S08) PROVISIONAL: the settle wait removed the one timing flake (TC-E12-010) but the overall flake rate is flat — the remaining REVIEWs are judge-borderline wording, not timing.
- [ ] M19-S07-NOTE-1 (M19-S07) HUMAN: mint a saved Jev session for Meena (Investors side) for the staging smoke; a long-lived session or test user is needed for the hourly production check; SMOKE_ALERT_WEBHOOK relay to Sahil not built (needs hosting AP4).
- [ ] M20-S01-NOTE-1 (M20-S01) OWNER: 7 KPI targets, who enters Sales_Plans values and who signs the brief are open (docs/launch/product-brief.md).
- [ ] M20-S04-NOTE-1 (M20-S04) OWNER: agree the proposed support response times, the support mailbox/form and where the defects list lives after go-live.
- [ ] M15-S05-NOTE-9 (M15-S05) PROVISIONAL: licence expiry reads the new env ZOHO_LICENCE_EXPIRES_ON (YYYY-MM-DD, IST end of day); unset reads 'unknown' (counts as down). Add to the go-live env list (R4).
- [ ] M15-S05-NOTE-10 (M15-S05) GAP: service-token expiry, cache load errors and the last Zoho Sign event have no local source; the System card says 'not read yet' (needs a token-expiry accessor and a cache load counter) (R4).
- [ ] M15-S05-NOTE-11 (M15-S05) GAP: no Jev UI case covers the System page's Live checks card (R4).
- [ ] M12-S13-NOTE-4 (M12-S13) PROVISIONAL: deck attachment goes by Zoho file id on send_mail (v8 docs); unproven until TC-E07-024 runs on the sandbox (R4).
- [ ] M12-S13-NOTE-5 (M12-S13) HUMAN: upload the approved deck through the Zoho Files API and set GROWIZE_DECK_FILE_ID (sandbox and live) (R4).
- [ ] M14-S03-NOTE-8 (M14-S03) PROVISIONAL: Consent_How mapping — in person / on a call → Verbal, WhatsApp reply → Email reply (nearest), web form → Form, event → Event sheet (R4).
- [ ] M14-S03-NOTE-9 (M14-S03) HUMAN: set CONSOLE_SUPER_ADMIN_IDS to Sahil's Zoho user id on sandbox and live; until then nobody holds the event-sheet load right on the Digital Infrastructure side (D115 #2).
- [ ] M12-S11-NOTE-7 (M12-S11) PROVISIONAL: visit consent is not applicable (a visit is the team meeting the investor), so a visit next step is never refused for consent; create Leads.Consent_Visit only if the plan needs it (R4).
- [ ] M12-S11-NOTE-8 (M12-S11) FACT CHANGE PROPOSED: M04-S01-NOTE-1 steps (3) Consent_Visit and (4) five new Consent_How labels are no longer needed by the code; drop them unless the richer labels are wanted (R4).
- [ ] M12-S11-NOTE-9 (M12-S11) FRONT-END LOOP: Finance's paperwork queue never calls rankForFinance and the 'not signed after all' note is missing from RoundView (reconcile 4 Oct; local).
- [ ] M08-S08-NOTE-9 (M08-S08) PROVISIONAL: a match sets Hold on a Contact whose App_Access is empty and never changes a set value (D115 #1 read as 'created by a match'); strict 'never touch on match' is a two-line change in match.ts openAccount.
- [ ] M08-S08-NOTE-10 (M08-S08) GAP: the release ('Send welcome and unlock') logs to Plane B (app-access/unlocked), not Plane C; a Plane C action is needed for an audited release (R4).
- [ ] M18-S15-NOTE-2 (M18-S15) PROVISIONAL: shared state (rate limits, step-up, webhook in-flight claims) now behind server/state SharedState; memory by default, Catalyst NoSQL adapter behind STATE_STORE=catalyst (wire shapes UNVERIFIED); rate limiter fails open if the store is down, misconfiguration fail
- [ ] M18-S09-NOTE-1 (M18-S09) GAP: user sessions are an in-memory Map (oauth/runtime.ts createMemorySessionStore); on AppSail every recycle or instance hop signs everyone out. Move SessionStore onto SharedState before any multi-instance host (R4, blocks Catalyst).
- [ ] M18-S09-NOTE-2 (M18-S09) GAP: per-instance state not yet shared — webhook seen-ids, request index, grant store and Sign dead-letters (local jsonl), the push outbox, money idempotency maps (mark-paid/add-paid), the payout running set, and the 10-minute Sign re-check timer (needs a platform scheduler 
- [ ] M18-S09-NOTE-3 (M18-S09) GAP: no request deadline anywhere and three routes cannot fit AppSail's 30 s: POST /api/statements (serial auto-match), event sheet load above ~1,000 rows, KAM seat change above ~55 investors; nightly audit export and legacy migration need Job Scheduling (docs/architecture/c
- [ ] M18-S09-NOTE-4 (M18-S09) HUMAN: decide whether the demo fixtures file may ship inside the production image (it is read at run time; 37 KB); confirm the managed-runtime app-config.json shape from 'catalyst init' (catalyst/README.md).
- [ ] M18-S05-NOTE-1 (M18-S05) PROVISIONAL: Planes B/C go through a sink interface — file by default, Catalyst Stratus segments behind LOG_SINK=stratus (endpoints UNVERIFIED); Plane C carries a per-instance hash chain with a verifier (scripts/verify-audit-chain.mjs, /api/system card); a crash can lose up 
- [ ] M18-S05-NOTE-2 (M18-S05) HUMAN: decide where the daily chain anchor is kept outside the Stratus bucket (without it a deleted chain tail is undetectable); optionally a keyed HMAC so bucket writers cannot recompute hashes.
- [ ] M18-S05-NOTE-3 (M18-S05) GAP: the Payments register 'Show the reference' asks for no reason, so its Plane C reveal lines say why: unstated; add the reason chips and send {why} (R4).

# :clipboard: Stories

## M01 · Foundations & the one app shell

|Story|1. Front end on demo data|2. Plug into Zoho|2b. Wire screens to the API|2c. Test contracts and security hardening|3. Test and harden|Screens today|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|---|---|---|
|**M01-S01** One Next.js shell with the rail built from the person's seat|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:hourglass_flowing_sand: Waiting on people|Built (demo data)|S1|Must|8/10|
|**M01-S08** Every write goes through commit(): one press, one record, 'Not saved yet' when it cannot land|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|—|—|:white_check_mark: Done|Built (demo data)|S1|Must|5/6|
|**M01-S10** Step-up before a reveal, an export or money leaving, with a second hand on refunds|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:hourglass_flowing_sand: Waiting on people|Built (demo data)|S3|Must|5/10|
|**M01-S02** Sign in with my own Zoho account; signing out or changing person clears everything|—|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|To do|Partly built|S1|Must|4/6|
|**M01-S03** Live reads and writes through one Zoho client, gate and scope-keyed cache|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|—|—|To do|Built (demo data)|S1|Must|5/7|
|**M01-S04** Operations and identity logs|—|:hourglass_flowing_sand: Waiting on people|—|—|To do|Not a screen|S1|Must|1/2|
|**M01-S05** Staging and production environments|—|:hourglass_flowing_sand: Waiting on people|—|—|To do|Not a screen|S1|Must|1/2|
|**M01-S06** Pending saves while offline|:white_check_mark: Done|—|—|—|To do|Built (demo data)|S2|Must|1/2|
|**M01-S09** Honest connection and freshness line in the top bar|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|To do|Built (demo data)|S1|Must|3/4|
|**M01-S07** Refusals and confirmations said in the page, never in alert() or confirm()|:white_check_mark: Done|—|—|—|:white_check_mark: Done|Built (demo data)|S1|Must|6/6|

## M02 · Zoho org build-out

|Story|1. Front end on demo data|2. Plug into Zoho|2b. Wire screens to the API|2c. Test contracts and security hardening|3. Test and harden|Screens today|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|---|---|---|
|**M02-S04** Roles, profiles, Private sharing and the field-level security wall for every seat|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|—|—|:hourglass_flowing_sand: Waiting on people|Not a screen|S0|Must|4/10|
|**M02-S01** Enterprise renewed and seats ordered|—|—|—|—|To do|Not a screen|S0|Must|0/3|
|**M02-S02** Lead fields, rungs and picklists per the mapping|—|:hourglass_flowing_sand: Waiting on people|—|—|To do|Not a screen|S0|Must|3/4|
|**M02-S05** Restricted test user and T11|—|:hourglass_flowing_sand: Waiting on people|—|—|To do|Not a screen|S0|Must|1/3|
|**M02-S06** Native Lead conversion stopped|—|—|—|—|To do|Not a screen|S0|Must|0/2|
|**M02-S07** Calls, Meetings and Tasks visible to the seats that schedule, with meetings in Zoho Calendar|—|—|—|—|To do|Not a screen|S0|Should|0/2|
|**M02-S08** Email sent from the person's own mailbox|—|:hourglass_flowing_sand: Waiting on people|—|—|To do|Not a screen|S0|Must|1/2|
|**M02-S09** Cover windows as record-level sharing|—|:hourglass_flowing_sand: Waiting on people|—|—|To do|Not a screen|S0|Must|2/3|
|**M02-S10** Sandbox and the console's OAuth client|—|:hourglass_flowing_sand: Waiting on people|—|—|To do|Not a screen|S0|Must|1/3|
|**M02-S12** Receipts module linked to the allotment, the Contact and the LLP|—|:white_check_mark: Done|—|—|To do|Not a screen|S0|Must|3/4|
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
|**M03-S01** Only people with a seat or a granted page sign in|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|—|—|To do|Built (demo data)|S1|Must|3/4|
|**M03-S02** Sahil grants pages to other people, read-only by default|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|To do|Built (demo data)|S1|Must|3/4|
|**M03-S03** Extra pages for IRs, and the IR Manager's limits|—|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|To do|Built (demo data)|S1|Must|2/3|
|**M03-S05** Zoho users provisioned seat by seat, both sides|—|:hourglass_flowing_sand: Waiting on people|—|—|To do|Not a screen|S1|Must|2/5|
|**M03-S09** An IR sees investor data only for investors from their own leads, enforced at the data layer|—|:hourglass_flowing_sand: Waiting on people|—|—|To do|Partly built|S1|Must|2/4|
|**M03-S04** Grant and seat changes move the sign-in list, follow the job and are logged|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:white_check_mark: Done|Built (demo data)|S1|Must|5/6|

## M04 · Lead capture

|Story|1. Front end on demo data|2. Plug into Zoho|2b. Wire screens to the API|2c. Test contracts and security hardening|3. Test and harden|Screens today|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|---|---|---|
|**M04-S03** Contact permission at capture|:white_check_mark: Done|—|—|—|:white_check_mark: Done|Built (demo data)|S2|Must|2/3|
|**M04-S01** Add a single lead|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|—|—|To do|Built (demo data)|S2|Must|3/4|
|**M04-S02** Duplicate mobile refused|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|—|—|:hourglass_flowing_sand: Waiting on people|Built (demo data)|S2|Must|3/3|
|**M04-S04** CSV import with preview|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|—|—|:hourglass_flowing_sand: Waiting on people|Built (demo data)|S2|Should|3/3|

## M05 · Today (both sides)

|Story|1. Front end on demo data|2. Plug into Zoho|2b. Wire screens to the API|2c. Test contracts and security hardening|3. Test and harden|Screens today|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|---|---|---|
|**M05-S04** Call times and reschedule|—|:hourglass_flowing_sand: Waiting on people|—|—|—|Partly built|S2|Should|1/2|
|**M05-S08** Account Management's Today (Investors side)|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:hourglass_flowing_sand: Waiting on people|Built (demo data)|S2|Must|4/5|
|**M05-S06** Headline figures on Today (Investors side)|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|To do|Built (demo data)|S3|Must|3/4|
|**M05-S01** My day list (Lead side)|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|—|—|:hourglass_flowing_sand: Waiting on people|Built (demo data)|S2|Must|3/3|
|**M05-S02** One action per row and the focus panel|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|—|—|:hourglass_flowing_sand: Waiting on people|Built (demo data)|S2|Must|3/3|
|**M05-S03** Paperwork 'your move' on Today|:white_check_mark: Done|—|—|—|:hourglass_flowing_sand: Waiting on people|Built (demo data)|S2|Must|2/2|
|**M05-S07** Waiting on you: the Investors-side queue per seat, including IR payment claims|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:hourglass_flowing_sand: Waiting on people|Built (demo data)|S3|Must|6/6|

## M06 · Leads book & lead search

|Story|1. Front end on demo data|2. Plug into Zoho|2b. Wire screens to the API|2c. Test contracts and security hardening|3. Test and harden|Screens today|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|---|---|---|
|**M06-S05** Search wall: the lead search never reaches investor data|—|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|To do|Built (demo data)|S2|Must|3/4|
|**M06-S01** Leads list with Personal and Team scope|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|—|—|:white_check_mark: Done|Built (demo data)|S2|Must|3/3|
|**M06-S02** Filters, sort and the Overdue fix|:white_check_mark: Done|—|—|—|:white_check_mark: Done|Built (demo data)|S2|Must|2/2|
|**M06-S03** Find a lead in the top bar (leads only, own book)|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:hourglass_flowing_sand: Waiting on people|Built (demo data)|S2|Must|4/4|

## M07 · Lead page

|Story|1. Front end on demo data|2. Plug into Zoho|2b. Wire screens to the API|2c. Test contracts and security hardening|3. Test and harden|Screens today|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|---|---|---|
|**M07-S01** Lead page shell and Next step card|:white_check_mark: Done|—|—|—|To do|Built (demo data)|S2|Must|2/3|
|**M07-S03** Save on the last tap, recorded once, with 10-second Undo|—|:hourglass_flowing_sand: Waiting on people|—|—|To do|Built (demo data)|S2|Must|2/3|
|**M07-S04** Call time and Zoho activity mapping|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|—|—|To do|Built (demo data)|S2|Must|2/3|
|**M07-S05** Email composer sent through Zoho send_mail|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|To do|Built (demo data)|S2|Must|3/4|
|**M07-S02** Logging flow — one question at a time|:white_check_mark: Done|—|—|—|:hourglass_flowing_sand: Waiting on people|Built (demo data)|S2|Must|2/2|
|**M07-S06** Close as lost in one step, undo and re-open|—|:hourglass_flowing_sand: Waiting on people|—|—|:white_check_mark: Done|Partly built|S2|Must|2/2|
|**M07-S07** Latest note, all notes and inline note|:white_check_mark: Done|—|—|—|:white_check_mark: Done|Built (demo data)|S2|Should|2/2|

## M08 · Journey, gates & hand-offs between the sides

|Story|1. Front end on demo data|2. Plug into Zoho|2b. Wire screens to the API|2c. Test contracts and security hardening|3. Test and harden|Screens today|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|---|---|---|
|**M08-S03** Money in: the IR reports a payment, Finance records the receipt|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:hourglass_flowing_sand: Waiting on people|Built (demo data)|S3|Must|6/8|
|**M08-S04** Reservation hold: clock, balance due, extend and release|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:hourglass_flowing_sand: Waiting on people|Built (demo data)|S3|Must|7/8|
|**M08-S08** The first matched advance opens the investor app account|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:hourglass_flowing_sand: Waiting on people|Built (demo data)|S3|Must|4/5|
|**M08-S02** Finance gates read live from Zoho|—|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|To do|Built (demo data)|S3|Must|2/3|
|**M08-S05** Owners and cover (D44)|—|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|To do|Partly built|S3|Must|2/3|
|**M08-S07** 'Said yes' becomes the investor record|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|To do|Built (demo data)|S3|Must|3/5|
|**M08-S01** Journey bar, ticks, un-tick and skip|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|—|—|:white_check_mark: Done|Built (demo data)|S3|Must|3/3|

## M09 · Investors & the investor record

|Story|1. Front end on demo data|2. Plug into Zoho|2b. Wire screens to the API|2c. Test contracts and security hardening|3. Test and harden|Screens today|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|---|---|---|
|**M09-S03** The investor record — header, banners and sections by seat|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:white_check_mark: Done|Built (demo data)|S2|Must|4/5|
|**M09-S04** Who looks after the account — KAM ownership|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:white_check_mark: Done|Built (demo data)|S2|Must|4/5|
|**M09-S01** Investors list for Finance|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|—|—|To do|Built (demo data)|S2|Must|2/3|
|**M09-S02** KAM book and Head of AM book|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|To do|Built (demo data)|S2|Must|3/5|
|**M09-S07** Investor search on the Investors page|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|To do|Built (demo data)|S2|Must|3/4|
|**M09-S08** An IR sees only investors from their own leads|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|To do|Built (demo data)|S2|Must|3/5|
|**M09-S09** Add an investor who has already paid, straight from the console|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:hourglass_flowing_sand: Waiting on people|Built (demo data)|S2|Must|4/4|

## M10 · Payments & receipts

|Story|1. Front end on demo data|2. Plug into Zoho|2b. Wire screens to the API|2c. Test contracts and security hardening|3. Test and harden|Screens today|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|---|---|---|
|**M10-S01** Payments register|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:hourglass_flowing_sand: Waiting on people|Built (demo data)|S3|Must|5/6|
|**M10-S02** Match a receipt — the second hand|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:hourglass_flowing_sand: Waiting on people|Built (demo data)|S3|Must|5/6|
|**M10-S05** Weekly bank statement upload and reconciliation|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:hourglass_flowing_sand: Waiting on people|Built (demo data)|S3|Must|5/7|
|**M10-S07** Receipts belong to the allotment (investor × farm)|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|—|—|:hourglass_flowing_sand: Waiting on people|Built (demo data)|S3|Must|3/4|
|**M10-S08** Per-farm payment view for an investor with several allotments|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|To do|Built (demo data)|S3|Should|3/4|
|**M10-S03** Answer an IR's payment report|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:hourglass_flowing_sand: Waiting on people|Built (demo data)|S3|Must|4/4|
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
|**M12-S11** NDA loop on the lead page, and the IR's word beside Finance's queue|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:eyes: Review|—|To do|Built (demo data)|S3|Must|3/6|
|**M12-S01** Documents in three scopes, with who sees what|—|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:hourglass_flowing_sand: Waiting on people|Partly built|S3|Must|4/5|
|**M12-S02** Upload a document straight from the console to Zoho|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:hourglass_flowing_sand: Waiting on people|Built (demo data)|S3|Must|4/5|
|**M12-S03** Documents page: out for signature and on file, scoped to the seat|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:white_check_mark: Done|Built (demo data)|S3|Must|4/5|
|**M12-S04** Send a document for signature through Zoho Sign|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:white_check_mark: Done|Built (demo data)|S3|Must|5/7|
|**M12-S06** Signed PDF filed to the allotment and Agreement_Signed set|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:white_check_mark: Done|Built (demo data)|S3|Must|4/5|
|**M12-S10** Isolation suite: no user sees another user's leads, investors, documents, sign requests, emails or tickets|—|—|—|—|:hourglass_flowing_sand: Waiting on people|Partly built|S3|Must|4/8|
|**M12-S13** Material follows the NDA; deck email marks the deck sent|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|To do|Built (demo data)|S3|Must|3/4|
|**M12-S05** Live signature status from Zoho Sign webhooks, with reminders and recall|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|Built (demo data)|S3|Must|7/7|
|**M12-S07** Block or supersede a document|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:white_check_mark: Done|Built (demo data)|S3|Must|4/4|
|**M12-S08** The investor signs by email or inside the investor app|—|:hourglass_flowing_sand: Waiting on people|—|—|:hourglass_flowing_sand: Waiting on people|Partly built|S3|Should|3/3|
|**M12-S09** See a record's emails in the console|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:hourglass_flowing_sand: Waiting on people|Built (demo data)|S3|Should|4/4|
|**M12-S12** Supplementary agreement draft loop|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|—|—|:white_check_mark: Done|Built (demo data)|S3|Must|3/3|
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
|**M16-S01** Assignments by IR report|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|—|—|To do|Built (demo data)|S4|Must|2/3|
|**M16-S03** Lead-side Numbers sections computed live, one scope at a time|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|—|—|To do|Built (demo data)|S4|Must|2/3|
|**M16-S02** Open one IR's row and list the leads behind a count|:white_check_mark: Done|—|—|—|:white_check_mark: Done|Built (demo data)|S4|Should|2/2|
|**M16-S04** Read the plan|—|:hourglass_flowing_sand: Waiting on people|—|—|:hourglass_flowing_sand: Waiting on people|Partly built|S4|Must|2/2|
|**M16-S06** Transfers per month: leads that became investors|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|—|—|:hourglass_flowing_sand: Waiting on people|Built (demo data)|S4|Must|3/3|
|**M16-S07** Open a month to its investors|:white_check_mark: Done|—|—|—|:white_check_mark: Done|Built (demo data)|S4|Should|2/2|
|**M16-S08** Investors side of Numbers: collection, paper and compliance|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:white_check_mark: Done|Built (demo data)|S4|Should|4/4|
|**M16-S09** Money figures only to seats that may see them|—|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:hourglass_flowing_sand: Waiting on people|Partly built|S4|Must|3/3|

## M17 · Teams, Profile & System

|Story|1. Front end on demo data|2. Plug into Zoho|2b. Wire screens to the API|2c. Test contracts and security hardening|3. Test and harden|Screens today|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|---|---|---|
|**M17-S02** Grant pages and change seats|—|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|To do|Built (demo data)|S4|Must|2/3|
|**M17-S01** Teams: members, seats and what each seat may do, from Zoho|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|:white_check_mark: Done|Built (demo data)|S4|Must|5/5|
|**M17-S05** My profile|—|:hourglass_flowing_sand: Waiting on people|—|—|:white_check_mark: Done|Built (demo data)|S4|Must|2/2|
|**M17-S06** System health and administration|—|:hourglass_flowing_sand: Waiting on people|—|—|:hourglass_flowing_sand: Waiting on people|Partly built|S4|Must|2/2|

## M18 · Hardening, security & release

|Story|1. Front end on demo data|2. Plug into Zoho|2b. Wire screens to the API|2c. Test contracts and security hardening|3. Test and harden|Screens today|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|---|---|---|
|**M18-S05** Data and logs are backed up and restorable|—|—|—|—|:hourglass_flowing_sand: Waiting on people|Not a screen|S5|Must|1/3|
|**M18-S09** Go-live by checklist with a runbook and a rehearsed rollback|—|—|—|—|:hourglass_flowing_sand: Waiting on people|Not a screen|S5|Must|3/6|
|**M18-S10** Runbook and hypercare|—|—|—|—|:hourglass_flowing_sand: Waiting on people|Not a screen|S5|Should|1/3|
|**M18-S01** The app stays fast inside Zoho's API limits|—|:hourglass_flowing_sand: Waiting on people|—|—|To do|Not a screen|S5|Must|3/6|
|**M18-S02** Nothing leaks outside a seat's scope: seat x page x action x field matrix|—|:hourglass_flowing_sand: Waiting on people|—|—|To do|Not a screen|S5|Must|2/6|
|**M18-S03** Every page works on a phone and by keyboard|:white_check_mark: Done|—|—|—|To do|Not a screen|S5|Must|2/4|
|**M18-S04** Errors are captured, visible and alerted|—|:hourglass_flowing_sand: Waiting on people|:white_check_mark: Done|—|To do|Not a screen|S5|Must|3/4|
|**M18-S06** Legacy records carried across without new Deals|—|—|—|—|To do|Not a screen|S5|Must|0/3|
|**M18-S08** Exploratory sessions and UAT signed off on both sides|—|:hourglass_flowing_sand: Waiting on people|—|:white_check_mark: Done|To do|Not a screen|S5|Must|3/11|
|**M18-S12** Move the org's old payment columns into Receipts on the allotment|—|:hourglass_flowing_sand: Waiting on people|—|—|To do|Partly built|S5|Must|1/3|
|**M18-S14** Every API route refuses at the door: no session, wrong seat, bad input, masked fields|—|—|—|:white_check_mark: Done|—|—|S5|Must|3/3|
|**M18-S15** Browser and request hardening: security headers, Origin check, rate limits, upload limits|—|—|—|:white_check_mark: Done|—|—|S5|Must|4/4|

## M19 · Quality — Jev UI suite

|Story|1. Front end on demo data|2. Plug into Zoho|2b. Wire screens to the API|2c. Test contracts and security hardening|3. Test and harden|Screens today|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|---|---|---|
|**M19-S07** Smoke suite and production check|—|—|—|—|:hourglass_flowing_sand: Waiting on people|Not a screen|S5|Should|1/2|
|**M19-S11** Regenerate the Jev UI cases against the merged console: super user and per seat|—|—|—|—|:white_check_mark: Done|Not a screen|S2|Must|3/4|
|**M19-S01** UI test contract|:white_check_mark: Done|—|—|—|To do|Not a screen|S1|Must|1/3|
|**M19-S02** Jev UI runner on staging|—|:hourglass_flowing_sand: Waiting on people|—|—|To do|Not a screen|S1|Must|3/5|
|**M19-S03** Zoho sandbox seed and reset|:white_check_mark: Done|:white_check_mark: Done|—|—|To do|Not a screen|S1|Must|2/3|
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
|**M20-S07** Bring the investor app codebase into the repo and wire the contract receivers|—|:hourglass_flowing_sand: Waiting on people|—|:white_check_mark: Done|To do|Partly built|S4|Must|5/6|
|**M20-S08** Buy the Zoho Sign plan and set up its webhooks|—|:hourglass_flowing_sand: Waiting on people|—|—|To do|Not a screen|S0|Must|1/4|
|**M20-S01** Product brief and KPIs|—|—|—|—|:hourglass_flowing_sand: Waiting on people|Not a screen|S0|Must|1/1|
|**M20-S04** Support model and issue intake|—|—|—|—|:hourglass_flowing_sand: Waiting on people|Not a screen|S5|Must|1/1|
|**M20-S05** Stage reviews, status and retrospectives|—|—|—|—|:white_check_mark: Done|Not a screen|S0|Must|6/6|
|**M20-S06** Change control|—|—|—|—|:white_check_mark: Done|Not a screen|S0|Must|1/1|
