::: {.callout}
**Updated 30 Sep 2026 11:47 IST** from the build itself (autopilot progress). Statuses are not edited here; comment on a row instead.
:::

# :compass: Where we are

**Goal:** the whole Growize Console (lead side and Investors side, one app on Zoho), built in phases: **front end first, then plug into Zoho, then wire the screens to it, then test**. Owner's build target ![](slack_date:2026-10-03).

**Now working on:** 2b. Wire screens to the API — The screen no longer touches the demo reducer: it reads and writes through its /api route (src/lib/data → the route), its Jev UI cases still pass with FIXTURE_MODE=local, typecheck and npm test pass. No live Zoho needed.

::: {.callout}
:warning: The build loop has not run for 40 hours. Nothing moves until /build runs on the laptop again.
:::

|Phase|Done (proven)|Waiting on people|Review|Left for the loop|Loop hours left|Forecast finish|Pace|
|---|---|---|---|---|---|---|---|
|**1. Front end on demo data**|92 of 92 (100%)|0 (0%)|0|0|0|done|0 min/unit measured|
|**2. Plug into Zoho**|7 of 119 (6%)|111 (93%)|1|1|0.2|![](slack_date:2026-09-30)|10.4 min/unit measured|
|**2b. Wire screens to the API** :arrow_left:|0 of 66 (0%)|0 (0%)|0|66|33|![](slack_date:2026-10-02)|assumed until 5 rounds|
|**2c. Test contracts and security hardening** :twisted_rightwards_arrows: parallel worktree|0 of 7 (0%)|0 (0%)|0|7|17.5|![](slack_date:2026-10-01)|assumed until 5 rounds|
|**3. Test and harden**|0 of 145 (0%)|0 (0%)|0|145|36.3|![](slack_date:2026-10-05)|assumed until 5 rounds|

|Forecast|Date|
|---|---|
|All three phases through the loop|![](slack_date:2026-10-05)|
|People's testing and UAT (a dated stage, not a tag: starts only when the sandbox is live, the wiring phase is through and the smoke suite is green)|![](slack_date:2026-10-05) → ![](slack_date:2026-10-11)|
|Status|:red_circle: Behind the target|

::: {.callout}
**What each phase needs from people.** Phase 1 needs nothing. Phase 2 cannot be proven without the Zoho **sandbox**, an **OAuth client** for the console and a licensed **test user** (Sahil, in BLOCKED.md); its code is written and unit-tested, so it sits in *Waiting on people*, not *Done*. Phase 2b wires each screen to its API route on demo data and needs nothing. Phase 3 needs the sandbox for every live proof, then the tester's reviews and UAT by the business users (M18-S08).
:::

Forecast = loop hours left ÷ 14 loop hours a day. Minutes per unit are assumptions until each phase has 5 measured rounds; then the measured pace takes over. Stories count once per phase they have work in.

## Stages

|Stage|What it delivers|Stories|Done|Forecast done|
|---|---|---|---|---|
|S0|Zoho org build-out and access wall|18|2|![](slack_date:2026-10-03)|
|S1|Foundations, access, test suite|23|3|![](slack_date:2026-10-03)|
|S2|Lead side daily work and Investors pages|30|0|![](slack_date:2026-10-05)|
|S3|Journey, gates, money, paper, Zoho Sign, farms|43|0|![](slack_date:2026-10-05)|
|S4|Updates, tickets, app push, activity, numbers, teams|24|0|![](slack_date:2026-10-05)|
|S5|Hardening, UAT, migration, release|17|0|![](slack_date:2026-10-05)|

# :calendar: Month by month

|Month|Stories finished|Forecast to finish|Cumulative forecast|
|---|---|---|---|
|September 2026|5|0|5 of 155|
|October 2026|0|149|154 of 155|

# :spiral_calendar_pad: Week by week

|Week of|Finished|Forecast|Cumulative|Burn-up|
|---|---|---|---|---|
|![](slack_date:2026-09-21)|2|0|2|:white_large_square::white_large_square::white_large_square::white_large_square::white_large_square::white_large_square::white_large_square::white_large_square::white_large_square::white_large_square: 1%|
|![](slack_date:2026-09-28) **(this week)**|3|123|128|:large_green_square::large_green_square::large_green_square::large_green_square::large_green_square::large_green_square::large_green_square::large_green_square::white_large_square::white_large_square: 83%|
|![](slack_date:2026-10-05)|0|26|154|:large_green_square::large_green_square::large_green_square::large_green_square::large_green_square::large_green_square::large_green_square::large_green_square::large_green_square::white_large_square: 99%|

## This week

**Finished (3):** M19-S04, M19-S05, M19-S06

**Planned by the forecast (123):** M18-S14, M18-S15, M19-S12, M19-S13, M03-S01, M19-S01, M19-S02, M19-S03, M02-S01, M02-S02, M02-S03, M02-S04, M02-S05, M02-S06, M02-S08, M02-S09, M02-S10, M02-S11, M02-S12, M20-S01, M20-S05, M20-S06, M20-S08, M02-S07, M01-S01, M01-S02, M01-S03, M01-S04, M01-S05, M01-S07, M01-S08, M01-S09, M03-S02, M03-S03, M03-S04, M03-S05, M03-S06, M03-S07, M03-S08, M03-S09, M01-S06, M04-S01, M04-S02, M04-S03, M05-S01, M05-S02, M05-S03, M05-S08, M06-S01, M06-S02, M06-S03, M06-S05, M07-S01, M07-S02, M07-S03, M07-S04, M07-S05, M07-S06, M09-S01, M09-S02, M09-S03, M09-S04, M09-S07, M09-S08, M19-S10, M19-S11, M04-S04, M07-S07, M01-S10, M05-S06, M05-S07, M08-S01, M08-S02, M08-S03, M08-S04, M08-S05, M08-S07, M08-S08, M10-S01, M10-S02, M10-S03, M10-S05, M10-S07, M11-S01, M11-S02, M11-S03, M11-S04, M11-S05, M11-S07, M12-S01, M12-S02, M12-S03, M12-S04, M12-S05, M12-S06, M12-S07, M12-S10, M12-S11, M12-S12, M12-S13, M14-S01, M14-S02, M14-S03, M10-S08, M10-S09, M12-S08, M12-S09, M12-S14, M19-S08, M13-S01, M13-S02, M13-S03, M13-S04, M13-S06, M15-S01, M15-S03, M15-S05, M16-S01, M16-S03, M16-S04, M16-S06, M16-S09, M17-S01

**Stuck: review or waiting on people (2):**

- **M02-S04** Roles, profiles, Private sharing and the field-level security wall for every seat (review)
- **M05-S04** Call times and reschedule (waiting)

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
|**M01** Foundations & the one app shell|S1|10|0|:white_large_square::white_large_square::white_large_square::white_large_square::white_large_square: 0%|One Next.js + TypeScript app, one sign-in, one rail built from the seat, live Zoho reads through one client with scope-keyed cache, honest s|
|**M02** Zoho org build-out|S0|14|2|:white_large_square::white_large_square::white_large_square::white_large_square::white_large_square: 14%|The one Enterprise org ready for both sides before any second seat: fields, modules, the FLS wall, Receipts, document slots, Zoho Sign field|
|**M03** Access, seats & super user|S1|9|0|:white_large_square::white_large_square::white_large_square::white_large_square::white_large_square: 0%|Who may sign in and what each seat may read and do on both sides, enforced by Zoho and the data layer; Sahil as super user with PII masked; |
|**M04** Lead capture|S2|4|0|:white_large_square::white_large_square::white_large_square::white_large_square::white_large_square: 0%|Leads added one at a time, by CSV or from an event sheet, with duplicates refused and contact permission recorded.|
|**M05** Today (both sides)|S2|7|0|:white_large_square::white_large_square::white_large_square::white_large_square::white_large_square: 0%|One Today page with a 'Lead side / Investors side' switch: the IR's follow-ups and paperwork moves, and Finance's and Account Management's d|
|**M06** Leads book & lead search|S2|4|0|:white_large_square::white_large_square::white_large_square::white_large_square::white_large_square: 0%|Each person sees their own book of leads as an ordered list with honest counts, and finds a lead from the top bar — leads only, inside their|
|**M07** Lead page|S2|7|0|:white_large_square::white_large_square::white_large_square::white_large_square::white_large_square: 0%|One lead page where an IR sees the next step, reaches the investor, logs a contact once with Undo, emails through Zoho, closes as lost and r|
|**M08** Journey, gates & hand-offs between the sides|S3|7|0|:white_large_square::white_large_square::white_large_square::white_large_square::white_large_square: 0%|The lead's journey is true in Zoho, money gates are opened only by Finance, and Said yes hands the investor to the Investors side of the sam|
|**M09** Investors & the investor record|S2|7|0|:white_large_square::white_large_square::white_large_square::white_large_square::white_large_square: 0%|One Investors page and one sectioned investor record, scoped per seat: Finance sees the book, a KAM their accounts, an IR only the investors|
|**M10** Payments & receipts|S3|11|0|:white_large_square::white_large_square::white_large_square::white_large_square::white_large_square: 0%|Every rupee is a Receipt linked to an allotment (investor × farm LLP), recorded by Finance, matched by a second person, reconciled against t|
|**M11** Farms (the LLP shelf) & allotments|S3|6|0|:white_large_square::white_large_square::white_large_square::white_large_square::white_large_square: 0%|Farms are the LLP records in Zoho (LLP_Creation_Module): the shelf counts free units off the records, and every allotment links an investor |
|**M12** Documents, upload & Zoho Sign|S3|14|0|:white_large_square::white_large_square::white_large_square::white_large_square::white_large_square: 0%|Every document lives in Zoho in one of three scopes (personal on the Contact, per allotment, per farm LLP), is uploaded straight from the co|
|**M13** Tickets & investor updates (pushed to the investor app)|S4|6|0|:white_large_square::white_large_square::white_large_square::white_large_square::white_large_square: 0%|Tickets (Zoho Cases) and investor updates are worked in the console and reach the existing investor app through the signed event contracts, |
|**M14** Events|S3|3|0|:white_large_square::white_large_square::white_large_square::white_large_square::white_large_square: 0%|Events are the lead side's diary (Lead_Events module, D85): list, event page, add/correct/remove by the IR Manager, capture and CSV/sheet lo|
|**M15** Updates & Activity|S4|3|0|:white_large_square::white_large_square::white_large_square::white_large_square::white_large_square: 0%|People see what others changed on their book (bell and Updates), managers review who did what on one Activity page with a Lead side / Invest|
|**M16** Numbers, Plan & Transfers|S4|8|0|:white_large_square::white_large_square::white_large_square::white_large_square::white_large_square: 0%|One Numbers page with a Lead side / Investors side switch, a Plan page and a Transfers page, all worked out live from Zoho within the viewer|
|**M17** Teams, Profile & System|S4|4|0|:white_large_square::white_large_square::white_large_square::white_large_square::white_large_square: 0%|Admin pages of the one app: Teams (members plus an Investors side seats section), seat and page grants, temporary access, own profile, Syste|
|**M18** Hardening, security & release|S5|12|0|:white_large_square::white_large_square::white_large_square::white_large_square::white_large_square: 0%|Prove the one app is fast inside Zoho's limits, leaks nothing across seats or users, works on a phone and by keyboard, fails visibly, can be|
|**M19** Quality — Jev UI suite|S1|12|3|:large_green_square::white_large_square::white_large_square::white_large_square::white_large_square: 25%|A Jev UI suite that runs the same plain-language cases against the merged prototype (growize-console-merged.html) and the built app, per sea|
|**M20** Launch readiness & operations|S0|7|0|:white_large_square::white_large_square::white_large_square::white_large_square::white_large_square: 0%|The brief, KPIs, status rhythm and change control that keep the plan honest, the guides and support model for go-live, and the two outside p|
# :card_index_dividers: Backlog in BLOCKED.md — 399 open, 3 ticked

|Kind|Open|What it is|
|---|---|---|
|FRONT-END LOOP|66|Screens to wire to their API route (now phase 2b units)|
|PROVISIONAL|70|Choices the build made at low confidence — owner confirms or reverses|
|FACT CHANGE PROPOSED|41|Test cases that contradict a decision — owner rules, then the case changes|
|BLOCK|6|Do-not-activate blocks (a design or decision gap)|
|STAGING PROOF|4|Proofs to run on the sandbox|
|OWNER ACTION|2|Owner actions in Zoho|
|Tasks for people|23|Sahil 11, Autopilot 11, Tester 1|
|Other notes|187|Zoho fields/modules the code expects, secrets and config, staging steps|

Decisions waiting on the owner = PROVISIONAL + FACT CHANGE PROPOSED. Tick a line in BLOCKED.md when it is done; the loop reads the ticks.


# :hammer_and_wrench: People's to-do (from the build)

- [ ] M02-S01-T01 (M02-S01, Sahil, Before its story (do early)) Renew Enterprise and buy the test-user seat — Renew the Enterprise subscription (annual) before 13 Oct; add one user licence for the restricted test user; save the invoice reference in the ops notes.
- [ ] M02-S04-T02 (M02-S04, Sahil, Before its story (do early)) Profiles per seat — One profile per seat of both sides, module permissions per SEATCAPS (no Convert/Export/Mass delete for IR); API access on (T7); Sahil's profile with every module but identity fields hidden (D68).
- [ ] M02-S04-T03 (M02-S04, Sahil, Before its story (do early)) Field-level security wall — Encrypt pan and bank_account on Contacts; pan readable by Head of Finance and Compliance, bank by Head of Finance and Finance; hide pan, bank, Aadhaar_Number, UTR_n, DOB everywhere else; aadhaar_last4/aadhaar_ref o
- [ ] M02-S04-T04 (M02-S04, Sahil, Before its story (do early)) Private sharing and B-12 rules — Default sharing Private on Leads, Contacts and custom modules; IR Manager read on IR subtree via hierarchy; Finance → Leads sharing rule for gate columns (B-12); document the answer.
- [ ] M02-S06-T01 (M02-S06, Sahil, Before its story (do early)) Remove Convert permission — Untick Convert Leads on every profile; confirm no workflow converts.
- [ ] M02-S10-T02 (M02-S10, Sahil, Before its story (do early)) Register OAuth clients — In Zoho API Console, register separate server-based clients for staging/sandbox and production. Add only each deployment's exact HTTPS OAuth callback URI. Grant only CRM module access, settings read, COQL read, ZohoCR
- [ ] M02-S10-NOTE-1 (M02-S10) M02-S10-T01 OWNER ACTION: In Zoho CRM Setup > Data Administration > Sandbox, create the Enterprise developer sandbox only after the S0 module/profile/FLS work is complete. Copy metadata, not real investor data. In the sandbox, compare module API names, Leads field API names,
- [ ] M02-S10-NOTE-2 (M02-S10) FACT CHANGE PROPOSED: TC-E02-020 currently says both GET /crm/v8/settings/profiles and a Zoho Books call must return OAUTH_SCOPE_MISMATCH, but this story explicitly grants CRM settings read. Expected behaviour should distinguish the allowed in-scope CRM call from the refused
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
- [ ] M03-S05-NOTE-2 (M03-S05) FARM OPERATIONS DECISION REQUIRED: M03-S05 acceptance requires a Farm ops seat, but D80's applied role tree has no Farm Operations role, `docs/ACCESS-PLAN.md` defines no Farm-ops role/profile, and `ops/SEAT-PLAN.md` ambiguously combines Farm ops with Channel Partner. The bac
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
- [ ] M15-S01-NOTE-1 (M15-S01) UPDATES — WHAT STILL NEEDS A PERSON (M15-S01): (1) "last seen" per group is stored in Plane B/C, whose store is still the owner's open choice (D47); the server takes it as a SeenStore dependency; (2) the IR Manager's state groups ("moves waiting for approval", "breaches in m
- [ ] M16-S01-NOTE-1 (M16-S01) ASSIGNMENTS REPORT — ZOHO SETUP (M16-S01, super admin): (1) a Leads workflow rule "On edit, when Owner is modified" with a field update setting Owner_Assigned_At to the rule's execution time, so owner changes made in Zoho itself (not only through the console, which already s
- [ ] M16-S03-NOTE-1 (M16-S03) NUMBERS SECTIONS STAGING PROOF (M16-S03): the sections use COQL aggregates (select COUNT(id)[, SUM(Units_Interested)] … group by Lead_Source / Owner / Lost_Reason / Forecast). On staging confirm (1) this org's COQL returns aggregate rows keyed "COUNT(id)" and "SUM(Units_Inte
- [ ] M16-S04-NOTE-1 (M16-S04) PLAN READ — WHAT IT NEEDS (M16-S04): (1) at least one Sales_Plans record per period with Plan_Scope "Team", Period_From/Period_To and Target_Units (Collection_Target optional) — the console reads, never writes, them; (2) the paid figure is worked out from Receipts (Match_Sta
- [ ] M16-S06-NOTE-1 (M16-S06) TRANSFERS — ACCESS AND LEGACY (M16-S06): units and value come from the investor's Contact (Origin_Lead = the lead) and its allotments, read with the person's own token. The IR Manager therefore needs Read on Contacts and LLP_UnitAllocation_Module for her team's converted lea
- [ ] M17-S05-NOTE-1 (M17-S05) OWN PROFILE IN ZOHO (M17-S05): the console changes a person's own display name and mobile with PUT /crm/v8/users/{their id} on their own token. Zoho may only allow that for profiles with "Manage Users" or with the users.UPDATE OAuth scope; on staging, sign in as a restricted
- [ ] M20-S07-NOTE-1 (M20-S07) INVESTOR APP CONTRACTS — PEOPLE'S PART (M20-S07): (1) add the investor app codebase to the repo when ready (M20-S07-T04; the stub receiver in console/src/server/contracts/events.ts stands in until then); (2) put two random 32+ character contract signing keys in the server se
- [ ] M17-S06-NOTE-1 (M17-S06) SYSTEM CHECKS — SOURCES (M17-S06): the checks are computed from Plane B (the Zoho call log) plus facts the server holds; two of those facts need a person: (1) the Enterprise licence expiry date (Organization API or entered once by Sahil after each renewal — the check shows "
- [ ] M03-S01-NOTE-1 (M03-S01) FACT CHANGE PROPOSED: TC-E03-001 'offers exactly six people … does not offer Harsha Bhat / Arvind Menon or Pradeep Ram' → the merged console (D98, prototype growize-console-merged.html vSignin) offers every person either side admits: the four IRs, Tasneem, Harsha, Meena, Fah
- [ ] M03-S01-NOTE-2 (M03-S01) FACT CHANGE PROPOSED: TC-E03-002 'does not offer Harsha Bhat' → Harsha Bhat (Head of Finance) signs in for the Investors side in the merged console (D98, merge notes 'Who sees what'). The prototype fails this fact too.
- [ ] M03-S01-NOTE-3 (M03-S01) FACT CHANGE PROPOSED: TC-E03-004 'does not offer Pradeep Ram' → Pradeep Ram holds the Investors-side administrator seat (System, Activity, Team) in the merged console, so he is offered. The prototype fails this fact too.
- [ ] M06-S02-NOTE-1 (M06-S02) FACT CHANGE PROPOSED: TC-E06-006 'A chip Name, A to Z × is shown' / 'offers Clear filters' → no chip: Name, A to Z is the default order and the merged prototype shows a chip only for a non-default sort. The prototype fails this case too.
- [ ] M14-S03-NOTE-1 (M14-S03) FACT CHANGE PROPOSED: TC-E10-012 'Sahil cannot load / no Load 31 leads' → 'Sahil (super user, D68) is offered Load 31 leads'. In the merged prototype his seat can load the sheet; the prototype fails the case too.
- [ ] M14-S02-NOTE-1 (M14-S02) FACT CHANGE PROPOSED: TC-E10-007 — the step that sets a run event back to Planned should be dropped: Planned is disabled for an event that has run (a run event cannot go back to planned). The facts can stay. The prototype fails the case too.
- [ ] M15-S01-NOTE-1 (M15-S01) FACT CHANGE PROPOSED: TC-E11-004 '…Needs attention, listing Ritu Anand and Harish Kamath' / '…listing Sanjay Menon and Farida Contractor' → '…Needs attention, reading They are listed once, on Leads under Needs an owner.' / '…They are listed once, on Today in the team's queue
- [ ] M10-S02-NOTE-1 (M10-S02) FACT CHANGE PROPOSED: TC-IM05-009 and TC-IM05-010 steps 'Press Transactions' → 'Press Payments'. In the merged console the Investors page Transactions is the rail entry Payments (merge-glue.js MT). The prototype fails both cases for this reason.
- [ ] M12-S14-NOTE-1 (M12-S14) FACT CHANGE PROPOSED: TC-E09-019 'a Call back step due 28 Aug · 16:30' → a wording true both before and after 16:30 (e.g. 'a Call back step for 28 Aug at 16:30'), or add fixture CLOCK_28AUG_1000. The row reads 'Call back — today at 16:30' before 16:30 and 'Overdue · Call bac
- [ ] M01-S01-NOTE-1 (M01-S01) FACT CHANGE PROPOSED: TC-IM01-001..004 and other Investors-portal cases still name the old portal's rail (Dashboard, Transactions, Insights, Activity log, Team, 'Toggle theme', 'Signed in as' dropdown). In the merged console (D98) these are Today, Payments, Numbers, Activity
- [ ] M10-S02-NOTE-2 (M10-S02) PROVISIONAL: recording a receipt still marks it matched by the recorder, as the merged prototype does; D21/CLAUDE.md rule 3 (record freely, matching gated by a second person) would make recorded receipts pending until 'Match it'. Built as the prototype; 'Match it' exists for
- [ ] M10-S08-NOTE-1 (M10-S08) PROVISIONAL: the two-farm investor, an app On hold and a locked app are shown only with the new fixture IM:MONEY_DEMO (added to pm/merge-audit/ui-sahil/fixtures-merged.json), because every demo investor in the prototype holds one block and changing the default book would cha
- [ ] M19-S01-NOTE-1 (M19-S01) PROVISIONAL: the a11y lint (npm run lint:a11y) is in place but not wired into a pre-commit hook or CI yet; wire it when CI exists. Controls the prototype leaves unlabelled carry a title rather than an aria-label so the UI cases still find them by their row.
- [ ] M01-S02-NOTE-1 (M01-S02) PROVISIONAL (Jev decide, low confidence): the phase-2 queue was stuck on three dependency cycles (M03-S01>M01-S02>M01-S01, M10-S01<>M10-S07, M08-S02>M10-S02>M08-S03/M08-S02). Dropped the links M01-S02->M01-S01, M10-S01->M10-S07 and M08-S02->M10-S02 in pm/plan-merged/growize-
- [ ] M01-S02-NOTE-2 (M01-S02) PROVISIONAL: A Zoho-signed-in session holds the Zoho CRM user id from CurrentUser as its PersonKey (Jev 0.94), until the Zoho data source keys PEOPLE.
- [ ] M01-S02-NOTE-3 (M01-S02) PROVISIONAL: Only a definitive Zoho refusal (error body or 400/401) on token refresh signs a person out as 'revoked'; a network error, timeout or 5xx fails that one request and keeps the session (Jev, low confidence).
- [ ] M01-S02-NOTE-4 (M01-S02) FRONT-END LOOP: In SignIn.tsx zoho(), when POST /api/auth/zoho returns redirect, navigate with window.location.assign(body.redirect); on load show GET /api/session's refusal.message on the sign-in screen, and when it returns signedOut expired|revoked call signOut(why).
- [ ] M01-S02-NOTE-5 (M01-S02) HUMAN PROOF (after M02-S10-T02): On staging set ZOHO_ACCOUNTS_ORIGIN, ZOHO_OAUTH_CLIENT_ID, ZOHO_OAUTH_CLIENT_SECRET, ZOHO_OAUTH_REDIRECT_URI, ZOHO_SESSION_KEY, ZOHO_CRM_RECORD_ID_PREFIX and ZOHO_SEAT_IDS (from the sanitized roles/profiles export), sign in as Rohit on zoho.i
- [ ] M01-S02-NOTE-6 (M01-S02) HUMAN PROOF (after M02-S10): On staging confirm sign-out revokes the refresh token (Zoho Accounts connected apps no longer lists the grant) and a Marketing-role user is refused with 'No console access: your Zoho account does not hold a console seat.'
- [ ] M18-S04-NOTE-1 (M18-S04) HUMAN: Choose the alert email provider, set ALERT_EMAIL_TO to Sahil's address and plug a real AlertMailer in with setAlertMailer() in console/src/server/ops/runtime.ts; until then alerts sit in an in-memory outbox and no email is sent.
- [ ] M18-S04-NOTE-2 (M18-S04) FRONT-END LOOP: call installErrorBeacon() (console/src/lib/zoho/error-beacon.ts) from a client component and sendErrorBeacon({source:'save-failed', requestId, zohoStatus, zohoCode}) from the save queue so browser errors and the failed-saves alert are fed.
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
- [ ] M03-S01-NOTE-1 (M03-S01) HUMAN PROOF (T03, TC-E03-023): Run the admission matrix on staging with one sandbox user per D80 role, including an inactive one, after M02-S10.
- [ ] M03-S01-NOTE-2 (M03-S01) OWNER DECISION: The story names Sahil (Digital Infrastructure) as someone who signs in, but D80 gives that role the Administrator profile, which CLAUDE.md bans, so the callback refuses him until the owner changes his profile or the rule.
- [ ] M03-S01-NOTE-3 (M03-S01) FACT CHANGE PROPOSED: The merged front end lets Pradeep (Corporate Ops, Investors seat root) in on the Investors side, contradicting the acceptance line and TC-E03-004; in Zoho he is refused only because the CEO role uses the Administrator profile.
- [ ] M03-S01-NOTE-4 (M03-S01) FACT CHANGE PROPOSED: TC-E03-001 and TC-E03-002 (six people, Harsha refused) contradict the merged front end and the acceptance line 'Finance (Harsha) is admitted'; the cases need rewriting.
- [ ] M03-S01-NOTE-5 (M03-S01) PROVISIONAL: The D80 role Compliance and Audit takes Investors seat comp, not audit (Jev 0.97); grants are checked only against the seat's own limit until the manager chain is read from Zoho; the staging sign-in list switch is GZ_SIGNIN_LIST=staging.
- [ ] M10-S07-NOTE-1 (M10-S07) HUMAN: Live proof needs M10-S07-T01 in Zoho (Receipts Contact/LLP lookups filled by Deluge, Payment_Status with values Yet to initiate/Partial/Full and its workflow on match/reversal) plus Receipts Idempotency_Key, tested on the sandbox (M02-S10).
- [ ] M10-S07-NOTE-2 (M10-S07) HUMAN PROOF: In the sandbox record an Advance on a Reserved allotment and confirm the reply shows Payment_Status with source zoho and no mismatch; then set the allotment Cancelled and confirm an Advance is refused as allotment-cancelled and nothing is written to Receipts.
- [ ] M10-S07-NOTE-3 (M10-S07) PROVISIONAL: After a Receipt write the backend re-reads Payment_Status from Zoho and also computes it from Matched receipts (Refund out) against units x unit price, returning both and flagging a mismatch, never writing it (Jev 0.5); receipts are create-only, so a wrong allot
- [ ] M19-S02-NOTE-1 (M19-S02) HUMAN PROOF (T01): After M02-S10 create one sandbox user per seat, copy console/scripts/jev-staging.config.example.json to jev-staging.config.json with real logins and the staging URL, run node console/scripts/jev-sessions.mjs sign-in, then jev-sessions.mjs check must show o
- [ ] M19-S02-NOTE-2 (M19-S02) HUMAN PROOF (T02, TC-E16-003): Add seeded ids for the fixtures, then node console/scripts/jev-staging-run.mjs --only TC-E03-006 must start on Rohit's Today page without a Zoho sign-in page and record a verdict in results.csv.
- [ ] M19-S02-NOTE-3 (M19-S02) HUMAN PROOF (T03): After a staging run, python3 console/scripts/jev-fill-workbook.py <results.csv> growize/pm/IR-Console-Delivery-Plan.xlsx --out <copy>.xlsx fills the Jev columns and reports no missing ids.
- [ ] M19-S02-NOTE-4 (M19-S02) PROVISIONAL: The staging runner resets once per case, not per fixture (Jev 0.91); it uses the existing /api/test/fixture and /api/test/reset endpoints, which need Zoho sandbox seeding behind them on staging (M19-S03); Zoho login autofill uses #login_id/#nextbtn/#password wit
- [ ] M19-S02-NOTE-5 (M19-S02) NOTE: console/scripts/*.test.cjs are not picked up by npm test (run-tests.cjs scans src/ only); run node --test console/scripts/jev-lib.test.cjs console/scripts/jev-fill-workbook.test.cjs.
- [ ] M01-S01-NOTE-1 (M01-S01) HUMAN PROOF (T04/T06): Once the Zoho sandbox (M02-S10) is live, sign in as an IR and as the IR Manager, type /system, and confirm the page lands on Today and Plane C holds one refusal line with only the Zoho user id and seat.
- [ ] M01-S01-NOTE-2 (M01-S01) FRONT-END LOOP: Add console/src/app/template.tsx as a server component that calls pageGuard(pageIdOf(headers().get('x-gz-path'))) from @/server/access/guard and redirects to v.landing when refused (middleware runs on Edge and cannot read the session store).
- [ ] M01-S01-NOTE-3 (M01-S01) FACT CHANGE PROPOSED: The rail (lib/selectors/access.ts navFor/MERGE) gives Finance no Transfers or Profile and gives KAM/Head of AM extra Numbers and Teams with no Profile, unlike the acceptance; the server guard enforces the rail as built, so Finance is refused /xfer and t
- [ ] M01-S01-NOTE-4 (M01-S01) PROVISIONAL: 'Farm ops' has no D80 role and is covered as Finance Operations (Investors seat ops); owner to confirm which Zoho role is Farm ops. Viewer, BU Owner and channel partner are refused on every page until grants exist (M03-S02).
- [ ] M01-S01-NOTE-5 (M01-S01) FOLLOW-UP: The route guard logs refusals as sign-in-refused/page-refused-<page> into its own memory sink; switch it to authorityEvents().refusedPage/refusedAction from server/identity/authority.ts and the shared sink factory (M01-S04 built both).
- [ ] M01-S04-NOTE-1 (M01-S04) PROVISIONAL: Planes B and C are stored as append-only daily JSONL files under LOG_DIR (LOG_STORE=jsonl; Jev 0.93 over a Postgres table or S3 Object Lock, per C-07); Sahil to confirm and to decide when scanned day files ship to a locked archive bucket.
- [ ] M01-S04-NOTE-2 (M01-S04) HUMAN PROOF: Set LOG_STORE=jsonl and LOG_DIR on the staging host (AP4), then run TC-E01-010 (sign-in, refused /numbers, sign-out reach Plane C) and TC-E01-011 (no phone, PAN or email in the ops and identity logs) on staging.
- [ ] M01-S04-NOTE-3 (M01-S04) FOLLOW-UP: The grants store (M03-S02) must call grantChange() from server/identity/authority.ts so grant changes reach Plane C.
- [ ] M18-S02-NOTE-1 (M18-S02) HUMAN PROOF (T02): On staging sign the restricted sandbox test user in once per role with jev-sessions.mjs, fill console/scripts/leak-matrix.config.json with each role's session and in-scope Zoho record and user ids from the staging seed, then node console/scripts/leak-matri
- [ ] M18-S02-NOTE-2 (M18-S02) NOTE: The log scrub test (T03) found and fixed a real leak - a phone number passed as creditsRemaining was logged - and error-log.ts now refuses identity-shaped request ids, user ids, Zoho codes and error names.
- [ ] M03-S09-NOTE-1 (M03-S09) PROVISIONAL: IR investor scope uses the filter plus a read-only record share at hand-off (Jev 1.00); refused Investors-side reads go to Plane B now and to Plane C through a hook awaiting a scope-refused action in server/identity/plane-c.ts.
- [ ] M03-S09-NOTE-2 (M03-S09) HUMAN: The handoff-share service credential (AP4) and a caller at the said-yes hand-off in server/leads are needed before record shares run; prove on the Zoho sandbox (M02-S10).
- [ ] M03-S09-NOTE-3 (M03-S09) HUMAN (T04): Sahil creates two restricted IR test users on the sandbox for the API/UI scope probes.
- [ ] M09-S01-NOTE-1 (M09-S01) WAITING: The Finance list read (server/investors/finance-list.ts) needs an API route (e.g. /api/investors/finance calling list and summary behind guardApi), the T02 table on the front end and the Jev UI cases.
- [ ] M09-S01-NOTE-2 (M09-S01) PROVISIONAL: KYC 'NA' is reported as its own value and not counted as not passed; Paid counts only receipts that stand (refunds out); Due is units x price minus what stands on Reserved allotments, as the Payments register works it out.
- [ ] M01-S09-NOTE-1 (M01-S09) FRONT-END LOOP: /api/data now returns fresh {source, at, failed, tone, ceilingMs, servedAt, problems}; src/lib/store.tsx should take failed from fresh.failed and treat source 'none' as no live source connected. TC-IM01-013 needs staging with Zoho unreachable.
- [ ] M07-S05-NOTE-1 (M07-S05) HUMAN: Set ORG_EMAIL_DOMAINS=agresearchlabs.com and FOLLOWUP_UNDO_SECRET (32+ characters) in the server secret store, and confirm the user scopes include ZohoCRM.send_mail.all.CREATE and settings read access to from_addresses.
- [ ] M07-S05-NOTE-2 (M07-S05) HUMAN PROOF (TC-E07-024): On staging Rohit sends the Introduction to a test inbox: it arrives from rohit@agresearchlabs.com, the Lead lists it under Emails, and exactly one Email touch reads 'Email approved and sent - From rohit@agresearchlabs.com via Zoho'; capture real sen
- [ ] M07-S05-NOTE-3 (M07-S05) GAP: The Lead needs an NDA-signed stamp (from the Zoho Sign completion) and an NdaReader wired into the email sender; until then the deck and webinar templates are refused, and attaching deck or webinar material is not built.
- [ ] M07-S05-NOTE-4 (M07-S05) FRONT-END LOOP: The composer's Send calls POST /api/leads/[id]/email with {expectedModifiedTime, template, subject, message, to, scheduled?}, shows error inline on a 4xx and notice on a 200.
- [ ] M07-S05-NOTE-5 (M07-S05) PROVISIONAL: When Zoho accepts the email but recording the touch fails, the answer is still sent with a Plane B touch-not-recorded line and a notice to use Log a contact (Jev 0.94); only IR, channel-partner and IR Manager seats may send, a manager only on leads they own or c
- [ ] M19-S04-NOTE-1 (M19-S04) OPS: No CI yet; when a pipeline exists run node console/scripts/jev-calibration-gate.mjs --results <ui-results.json> --run-calibrate pm/jev-calibrate.mjs --calibration <cal-out.json> --record <gate-record.json> after each suite and fail on non-zero exit; copy pm/jev-calibrat
- [ ] M19-S04-NOTE-2 (M19-S04) PROVISIONAL: A seeded-wrong case ending REVIEW warns but does not fail the gate, and mutations a person checked and found still true are excluded from the 1% rule through --reviewed (D63's baseline had 6 of 494 facts over 0.80).
- [ ] M03-S02-NOTE-1 (M03-S02) HUMAN: Sahil's Zoho role (Digital Infrastructure) uses the Administrator profile, so he maps to no console seat and cannot sign in or call /api/grants; until his profile moves off Administrator (D80 vs CLAUDE.md) only an IR Manager can grant, and only to her own IRs.
- [ ] M03-S02-NOTE-2 (M03-S02) PROVISIONAL: Grants are kept in an app-side append-only store (GRANT_STORE=jsonl, GRANT_DIR) per Jev (1.00) while OD9 stays open; production must set both or grants are lost on restart and granted-only seats are refused.
- [ ] M03-S02-NOTE-3 (M03-S02) GAP: A user's manager is read from the Zoho user's Reporting_To (reports_to also accepted); the CurrentUser answer checked read-only had no such key, so confirm it on the sandbox with a user who has a manager.
- [ ] M03-S02-NOTE-4 (M03-S02) FRONT-END LOOP: The T02 access grid should call POST/DELETE /api/grants {whom, page, cap} and show the returned refusal message.
- [ ] M01-S10-NOTE-1 (M01-S10) HUMAN: Build the T03 Zoho approval process on Allocation_Status -> Cancelled and refund Receipts (approvers the tech lead and Pradeep), then set GZ_RELEASE_APPROVAL=on; until then /api/auth/step-up/release refuses with approval-not-configured.
- [ ] M01-S10-NOTE-2 (M01-S10) HUMAN: Register https://<deployment>/api/auth/step-up/callback as a redirect URI on the Zoho OAuth client, set ZOHO_STEPUP_REDIRECT_URI, and set STEPUP_ALERT_TO (Sahil and Pradeep) with the mail provider.
- [ ] M01-S10-NOTE-3 (M01-S10) HUMAN PROOF: On the sandbox show that Zoho Accounts forces a fresh login with prompt=login&max_age=0 and that the approval process leaves $approval_state pending after the API edit.
- [ ] M01-S10-NOTE-4 (M01-S10) PROVISIONAL: Step-up windows, failure counts and locks are kept in process memory, so a restart lifts locks; there is no unlock route yet (StepUp.unlock exists for Digital Infrastructure).
- [ ] M01-S10-NOTE-5 (M01-S10) FRONT-END LOOP: The T02 step-up panel asks the reason first, then navigates to /api/auth/step-up?action=...&back=..., reads ?stepup=ok|failed|cancelled|locked, and asks /api/auth/step-up/status before offering reveal or release.
- [ ] M01-S10-NOTE-6 (M01-S10) GAP: After approval the forfeit and refund Receipts are M02-S12's; the reveal and export routes still need wrapping with requireStepUp by their owners.
- [ ] M09-S02-NOTE-1 (M09-S02) HUMAN: Set Contacts to Private sharing with role hierarchy Head of AM > KAMs (KAM reads Contacts where KAM = self; Head of AM reads allotted Contacts and the pool) and prove it with the restricted KAM test user (T01).
- [ ] M09-S02-NOTE-2 (M09-S02) HUMAN: ZOHO_SEAT_IDS must carry the 'Head of Account Management' role id and the 'AM Head' profile id, or the Head of AM's book is refused as seat-denied.
- [ ] M09-S02-NOTE-3 (M09-S02) PROVISIONAL: With no active-KAM reader wired, only an account with no KAM counts as 'No manager'; an account whose KAM has left counts once a reader of current KAM seats is wired.
- [ ] M09-S02-NOTE-4 (M09-S02) FRONT-END LOOP: AM columns, care filters and the 'My accounts'/'Accounts' heading (T03); counts are served by GET /api/investors/am.
- [ ] M09-S03-NOTE-1 (M09-S03) FRONT-END LOOP: Record header, banners and section bar by seat (T02) from GET /api/investors/[id]/record (sections, holdings, hold, money, paper, version); show a 409 'Changed by someone else - reload.' in the page.
- [ ] M09-S03-NOTE-2 (M09-S03) GAP: LLP_UnitAllocation_Module has no Payment_Status or Agreement_Signed field (28 Sep 2026); the record computes Payment_Status from matched receipts and Agreement_Signed from Supplementary_Verified_At.
- [ ] M09-S03-NOTE-3 (M09-S03) PROVISIONAL: An IR's record offers only Who they are, What they hold and Journey (IR_SECTIONS in server/investors/record.ts) until the owner names the sections allowed for IRs.
- [ ] M08-S07-NOTE-1 (M08-S07) HUMAN: Build the Contacts lifecycle blueprint Said yes -> Reserved -> Paid -> Allotted, the arl_code auto-number, and stop native Lead conversion (T01); no lifecycle field exists on Contacts as of 28 Sep 2026.
- [ ] M08-S07-NOTE-2 (M08-S07) FACT CHANGE PROPOSED: Set LIFECYCLE_FIELD in server/investors/lifecycle.ts to the blueprint's Contacts field once T01 creates it; until then the state label is derived from allotments and Said_Yes_At.
- [ ] M08-S07-NOTE-3 (M08-S07) FRONT-END LOOP: ImSt in src/lib/im/types.ts has no 'said yes' state, so the Dataset shows a said-yes Contact as 'reserved'; the correct label is in the Finance list's stateLabel and the record's state.
- [ ] M08-S07-NOTE-4 (M08-S07) HUMAN PROOF: TC-IM11-003 and TC-IM11-013 need a sandbox lead moved to Said yes by the IR test user.
- [ ] M09-S09-NOTE-1 (M09-S09) FRONT-END LOOP: The Add investor drawer still dispatches the demo reducer; wire it to POST /api/investors/add-paid (send an Idempotency-Key, show message, and on 409 link to existing.contactId).
- [ ] M09-S09-NOTE-2 (M09-S09) PROVISIONAL: The allotment is Issued when the amount covers units x price and Reserved with a 30-day Hold_Until otherwise, although the story's Zoho line says Issued always (Jev 0.87); the money paid becomes one Pending receipt through the allotment-receipts guard, not recei
- [ ] M09-S09-NOTE-3 (M09-S09) HUMAN PROOF: In the sandbox confirm Finance profiles may delete the Contacts and allotments they just created (the rollback) and that COQL accepts ARL_ID like 'ARL-INV-%' order by ARL_ID desc for minting the next code.
- [ ] M10-S21-NOTE-1 (M10-S21) GAP: Contacts.App_Access has field history tracking off and is missing from pm/plan-merged/zoho-field-mapping.json; Sahil to turn on history tracking and add the mapping row so Zoho field history records who and when.
- [ ] M10-S21-NOTE-2 (M10-S21) PROVISIONAL: Unlock writes only App_Access (Hold -> Invite) and leaves App_Welcome_At/App_Welcome_Channel to the app sync (Jev 0.81); 'Locked' is worked out as Hold after an invite, and the lock reason is saved as a Note on the Contact.
- [ ] M10-S21-NOTE-3 (M10-S21) FRONT-END LOOP: The App account card and Lock drawer still run on the demo reducer; wire them to GET/POST/DELETE /api/investors/[id]/unlock, sending card.modifiedTime back as expectedModifiedTime.
- [ ] M10-S21-NOTE-4 (M10-S21) HUMAN PROOF: Needs the investor app's staging webhook (MA1) to prove Invite sends exactly one welcome and App_Welcome_At is written back.
- [ ] M06-S05-NOTE-1 (M06-S05) HUMAN PROOF: In the sandbox sign in as the restricted IR test user and search for a name held only by another IR's lead; Zoho must return nothing.
- [ ] M06-S05-NOTE-2 (M06-S05) PROVISIONAL: The search cache holds only the in-book result count under the leads scope and a per-process HMAC of the term; hit rows are never cached (Jev 0.83).
- [ ] M06-S05-NOTE-3 (M06-S05) GAP: lib/zoho/log.ts has no success-event kind, so the D47 search line is written as a refusal-kind record with action lead-search.done; the log owner should add an event kind.
- [ ] M08-S02-NOTE-1 (M08-S02) FACT CHANGE PROPOSED: Leads.advance_confirmed_at, balance_confirmed_at, supp_verified_at and allotted_at (zoho/field-register.json) do not exist in live Zoho; gates read Receipts.Match_State, allotment units x unit price, Supplementary_Verified_At and Lead.NDA_Verified_At in
- [ ] M08-S02-NOTE-2 (M08-S02) HUMAN: Confirm the IR profile can read the Contact, allotments and Receipts of its own converted lead (the M03-S09 hand-off share); a covering IR who is not the Originating_IR sees no investor, so the gate shows 'your move'.
- [ ] M08-S02-NOTE-3 (M08-S02) HUMAN PROOF: TC-E08-010 on staging: Finance matches the balance receipt, then GET /api/leads/<Prakash>/gate as Rohit shows met true and who null.
- [ ] M08-S02-NOTE-4 (M08-S02) FRONT-END LOOP: The lead page's Next milestone row and payment drawer should read GET /api/leads/[id]/gate.
- [ ] M08-S05-NOTE-1 (M08-S05) FACT CHANGE PROPOSED: Per D44 a named secondary now gets no lead access unless a cover window runs (or the owner is away on the roster); the unconditional secondary access was removed from server/leads book, search, email, followup, journey and updates (TC-E08-017).
- [ ] M08-S05-NOTE-2 (M08-S05) HUMAN: Create the cover-window-share service grant and set ZOHO_COVER_WINDOW_SHARE_REFRESH_TOKEN; without it a cover window is written with shared false and no Zoho record share. Schedule leadsRuntime().sweep() daily after IST midnight.
- [ ] M08-S05-NOTE-3 (M08-S05) HUMAN PROOF: TC-E08-025 in the sandbox: after 'Start today only' Kavya's user opens Sanjay Menon's Lead through a record share, and after 'End the cover' cannot.
- [ ] M08-S05-NOTE-4 (M08-S05) GAP: No Plane C availability/roster reader exists (D49); cover.ts admits nobody by roster until it is built, so TC-E08-020 roster cover is unproven; 'until they are back' is 14 days meanwhile.
- [ ] M08-S05-NOTE-5 (M08-S05) FRONT-END LOOP: The People & details 'Start - <duration>' and 'End the cover' controls call POST/DELETE /api/leads/[id]/cover with expectedModifiedTime.
- [ ] M11-S01-NOTE-1 (M11-S01) FACT CHANGE PROPOSED: server/data/projections.ts and adapters.ts select Unit_Price, Insurer and Insured_Till, which LLP_Creation_Module lacks (it has Pet_Unit_Price, Insurance_Provider, Insurance_expiry_date), parse the '20%' yield picklist as 0 and map Fully Subscribed/On H
- [ ] M11-S01-NOTE-2 (M11-S01) PROVISIONAL: The one-LLP detail reads the LLP's company PAN and GST on the viewer's token and masks them before they leave the server, never cached or logged (Jev 0.94); Sahil to confirm the no-PAN rule does not cover a company PAN.
- [ ] M11-S01-NOTE-3 (M11-S01) HUMAN: Sahil writes the Block A-F to LLP mapping (T01); production holds one LLP, EKA LLP (22 units, 19 issued), with no Block_Code set.
- [ ] M11-S01-NOTE-4 (M11-S01) FRONT-END LOOP: The Farms list and detail drawer (T03) read GET /api/farms and /api/farms/[id].
- [ ] M14-S01-NOTE-1 (M14-S01) GAP: Under Private sharing on Leads an IR's own-token group-by counts only leads that IR can see, so event totals will be too low until Leads sharing or a counts-only rule is decided.
- [ ] M14-S01-NOTE-2 (M14-S01) FACT CHANGE PROPOSED: Leads.Event_Name does not exist; the link is the lookup Leads.Lead_Event -> Lead_Events, and event staff come from Lead_Events_X_Users (userlookup221_3).
- [ ] M14-S01-NOTE-3 (M14-S01) FRONT-END LOOP: The Events pages (T03) read GET /api/events and /api/events/[id].
- [ ] M13-S02-NOTE-1 (M13-S02) FACT CHANGE PROPOSED: Cases has no Contact_Name or Category field; the investor is Related_To and the category Ticket_Category, so server/data/projections.ts cases should change as server/cases/register.ts reads them.
- [ ] M13-S02-NOTE-2 (M13-S02) HUMAN: Sahil adds app_request_id to Cases and an Investor (or App) value to Case_Origin, which today holds only Email, Phone and Web (T01).
- [ ] M13-S02-NOTE-3 (M13-S02) PROVISIONAL: With no subtree reader the Head of AM's Cases read uses Owner-is-anyone on their own token under Zoho's role hierarchy; ownerWhere in server/cases/predicate.ts is proposed as the shared team predicate.
- [ ] M13-S02-NOTE-4 (M13-S02) FRONT-END LOOP: The Tickets page (T03) reads GET /api/cases.
- [ ] M13-S01-NOTE-1 (M13-S01) PROVISIONAL: The envelope gains an optional sent_at stamped on each send attempt (Jev 0.2, low); investor updates are not pushed because contracts/ has no schema for them (Jev 0.24, low).
- [ ] M13-S01-NOTE-2 (M13-S01) HUMAN: Supply the investor app's staging URL (INVESTOR_APP_URL) and the shared CONTRACT_SIGNING_KEY (MA1); until then the console pushes to the in-process stub.
- [ ] M13-S01-NOTE-3 (M13-S01) HUMAN PROOF: On the sandbox send a signed request.raised to /api/webhooks/investor-app and confirm one Case is created on the Contact and a replay creates none.
- [ ] M13-S01-NOTE-4 (M13-S01) GAP: Nothing calls publishToInvestorApp yet; the Case reply and farm-shelf writers must call it after their Zoho write succeeds.
- [ ] M15-S03-NOTE-1 (M15-S03) FRONT-END LOOP: The Activity page with the Lead side | Investors side switch (T03/T06) reads GET /api/activity and /api/activity/history.
- [ ] M15-S03-NOTE-2 (M15-S03) HUMAN PROOF: Run scripts/audit-export.cjs against the sandbox to confirm the audit export request, poll and download shapes and CSV columns, then compare one day with Zoho's audit log (T04).
- [ ] M15-S03-NOTE-3 (M15-S03) HUMAN: Choose the AWS account and bucket for S3 Object Lock (D14, AP4); create ZOHO_AUDIT_ARCHIVE_REFRESH_TOKEN with audit-log export and Users read scopes, and schedule scripts/audit-export.cjs nightly with a heartbeat.
- [ ] M15-S03-NOTE-4 (M15-S03) PROVISIONAL: The Auditor's Finance people come from ZOHO_FINANCE_USER_IDS; the module-to-kind table in server/activity/kinds.ts is ours; team ids for IR Manager/Head of AM need a subtree reader not yet wired.
- [ ] M15-S03-NOTE-5 (M15-S03) GAP: server/system/checks.ts should read auditArchive().lastRun() and investorAppOutbox().stats() for its audit-archive and investor-app delivery checks.
- [ ] M15-S03-NOTE-6 (M15-S03) HUMAN PROOF: T08 UAT - Harsha, Latha, Sahil and Pradeep read their Activity page and sign off.
- [ ] M19-S06-NOTE-1 (M19-S06) HUMAN: TC-E16-011 (rule tests reported on every push) is proven only once the repo is pushed to GitHub and .github/workflows/pipeline.yml runs.
- [ ] M01-S05-NOTE-1 (M01-S05) HUMAN: AP4 hosting account is not chosen, so both Deploy steps in .github/workflows/pipeline.yml are failing placeholders and the staging/production jobs stay skipped until the repository variable HOSTING_READY is true.
- [ ] M01-S05-NOTE-2 (M01-S05) HUMAN: Create GitHub Environments 'staging' and 'production' with the secrets and variables in ops/env/README.md, using separate sandbox and live OAuth clients; push the repo to GitHub (CARRY-FORWARD E).
- [ ] M01-S05-NOTE-3 (M01-S05) HUMAN PROOF: TC-E01-017 (staging talks only to the sandbox) needs the deployed staging site and the M02-S10 sandbox.
- [ ] M19-S05-NOTE-1 (M19-S05) HUMAN: Turn on branch protection for main requiring the 'check' status, add Required reviewers to the 'production' Environment, and add secrets JEV_STAGING_CONFIG_JSON, JEV_SESSIONS_TGZ_B64 and TYPESAFE_API_KEY.
- [ ] M19-S05-NOTE-2 (M19-S05) GAP: pm/jev-calibrate.mjs is not in this repo (only in the growize/pm archive), so the CI calibration gate marks every staging run untrusted until it is copied in unchanged.
- [ ] M19-S05-NOTE-3 (M19-S05) HUMAN PROOF: TC-E16-010 (a failing P1 case blocks promotion and names TC-E05-004) needs a real staging deploy.
- [ ] M03-S03-NOTE-1 (M03-S03) HUMAN: Digital Infrastructure (Sahil) cannot hold a console session while that role uses the Administrator profile (D80 vs CLAUDE.md), so 'Sahil grants Rohit Numbers' is proven only at rule level (grants.test.cjs).
- [ ] M03-S03-NOTE-2 (M03-S03) FRONT-END LOOP: TC-E03-015..018 (Jev grantor matrix, T02) need the Teams screens on staging.
- [ ] M03-S04-NOTE-1 (M03-S04) HUMAN: Create the 'kam-pool-return' service grant (ZohoCRM.coql.READ + ZohoCRM.modules.contacts.READ on a profile that sees every Contact, identity fields hidden) and set ZOHO_KAM_POOL_RETURN_REFRESH_TOKEN; without it moving a KAM off the seat answers 503 and changes nothing
- [ ] M03-S04-NOTE-2 (M03-S04) HUMAN: Add ZohoCRM.users.UPDATE to the user OAuth client (M02-S10-T02), give the AM Head and Finance Head profiles 'Manage Users', and confirm on the sandbox that PUT /users/{id} with role and profile {id,name} applies (PROVISIONAL body shape).
- [ ] M03-S04-NOTE-3 (M03-S04) GAP: server/activity must map the new Plane C actions access-granted and access-ended to 'Console access granted/ended' and show the seat-change count ('N accounts returned to the pool').
- [ ] M03-S04-NOTE-4 (M03-S04) FRONT-END LOOP: The T03 seat dropdown calls PUT /api/users/{id} {seat}, labels rows 'Seat for <name>', and never offers root/di or a seat control on the super admin's or own row.
- [ ] M03-S04-NOTE-5 (M03-S04) PROVISIONAL: Contacts return to the pool (KAM, KAM_Since, KAM_Intro_At cleared) on the seat-changer's token after an org-scope service read (Jev 0.98); crossing the sign-in line is filed as Plane C access-granted/access-ended (Jev 0.97); lead-side seat changes are not handle
- [ ] M09-S04-NOTE-1 (M09-S04) HUMAN: In Zoho add a Contacts workflow 'KAM changed -> clear KAM_Intro_At', turn on field history for Contacts.KAM, and let only the AM Head profile edit KAM and KAM_Since.
- [ ] M09-S04-NOTE-2 (M09-S04) PROVISIONAL: The console PUT writes only KAM and KAM_Since and leaves KAM_Intro_At to the Zoho workflow (Jev 0.28, low); 'logged with both names' is a Plane C line with user ids only, names coming from Zoho field history (Jev 1.00).
- [ ] M09-S04-NOTE-3 (M09-S04) GAP: Contacts has no Tier field (28 Sep 2026); the story lists tier, so it must be computed or created.
- [ ] M09-S04-NOTE-4 (M09-S04) FRONT-END LOOP: The care card and manager drawer call PUT /api/investors/[id]/kam {kamUserId|null, expectedModifiedTime}, with per-KAM counts worked out from /api/investors/am.
- [ ] M09-S04-NOTE-5 (M09-S04) HUMAN PROOF: On the sandbox as Head of AM name a KAM on an allotted Contact and confirm KAM/KAM_Since change, the workflow clears KAM_Intro_At and field history shows both names.
- [ ] M09-S08-NOTE-1 (M09-S08) HUMAN: In Zoho stamp Contacts.Originating_IR with the lead owner at Said yes, add the sharing rule 'IR role reads Contacts where Originating_IR = self' under Private sharing, and hide money and identity fields from the IR profile.
- [ ] M09-S08-NOTE-2 (M09-S08) HUMAN PROOF: On staging read Contacts through the API as the restricted IR test user and confirm Zoho returns only that IR's own-lead investors, and that another IR's investor by URL gives 403.
- [ ] M09-S08-NOTE-3 (M09-S08) FRONT-END LOOP: IR columns on Investors (name, ARL code, farms, state, lead link); the server sends an IR no price, amount, yield or receipts.
- [ ] M11-S02-NOTE-1 (M11-S02) FRONT-END LOOP: Allotment rows on the investor record and the LLP (GET /api/investors/[id]/allotments, GET /api/farms/[id]/allotments) and the Jev cases.
- [ ] M11-S02-NOTE-2 (M11-S02) GAP: 'Refuse to save an allotment without Customer and LLP' needs an allotment write path no T02 covers; reads expose linked:false for such rows.
- [ ] M11-S02-NOTE-3 (M11-S02) HUMAN: Hide the older LLP_Unit_Allocation module from console profiles so only LLP_UnitAllocation_Module (related lists Customer1 / Customer_List) is used.
- [ ] M11-S02-NOTE-4 (M11-S02) FACT CHANGE PROPOSED: The story names LLP_Lookup, committed units and Agreement_Signed; the org's allotment module has LLP, Reserved_Units/Issued_Units and Supplementary_Verified_At, which the code uses.
- [ ] M10-S08-NOTE-1 (M10-S08) FRONT-END LOOP: Per-farm Money blocks (GET /api/investors/[id]/money) and the Jev cases.
- [ ] M10-S08-NOTE-2 (M10-S08) PROVISIONAL: Blocks are one per allotment, not merged per LLP; totals are cross-checked against register.ts and allotment-receipts.ts (record.ts does not subtract matched refunds and should be aligned).
- [ ] M10-S09-NOTE-1 (M10-S09) FRONT-END LOOP: The ARL holdings panel (GET /api/investors/[id]/holdings, readOnly) and the Jev cases.
- [ ] M10-S09-NOTE-2 (M10-S09) FACT CHANGE PROPOSED: server/data/projections.ts holdings/arlTransactions use Contact, Instrument_Type, Amount_Invested, Invested_On, Interest_Rate, Maturity_On, Date, but the org has Investor, Instrument_Class, Invested_Amount, Invested_Date, Interest_Rate_Pct, Maturity_Dat
- [ ] M08-S03-NOTE-1 (M08-S03) FACT CHANGE PROPOSED: There is no Payment_Claims module (D82 agrees), so the IR's payment report is a Receipts record with Match_State = Claimed.
- [ ] M08-S03-NOTE-2 (M08-S03) PROVISIONAL: A claim's Receipts.UTR holds a unique key CLAIM-<leadId>-<n> (Jev 0.73), the IR's reference is kept only masked in the Note, paise are refused, and kind 'other' is stored as Part with a note; a Claim_Ref field would free UTR for bank references.
- [ ] M08-S03-NOTE-3 (M08-S03) HUMAN: Add a unique Idempotency_Key text field to Receipts, and set RECEIPT_IDEMPOTENCY_SECRET and RECEIPT_CONTEXT_SIGNING_SECRET (each 32+ bytes, different); until then /api/receipts answers 503.
- [ ] M08-S03-NOTE-4 (M08-S03) FRONT-END LOOP: The claim drawer and row (T02) and the record-a-receipt drawer (T05: POST /api/receipts/prepare then POST /api/receipts with a per-press Idempotency-Key).
- [ ] M08-S03-NOTE-5 (M08-S03) HUMAN PROOF: T06 Jev/API cases and T07 Finance UAT on the sandbox.
- [ ] M14-S02-NOTE-1 (M14-S02) FACT CHANGE PROPOSED: Removal clears Leads.Lead_Event (not Event_Name) and staff are written through Lead_Events.Event_Staff (rows in Lead_Events_X_Users).
- [ ] M14-S02-NOTE-2 (M14-S02) HUMAN PROOF: On the sandbox confirm Event_Staff entries keyed by userlookup221_3 add a user and {id, _delete: null} removes one (getFields suggests the reverse direction of what events.ts reads).
- [ ] M14-S02-NOTE-3 (M14-S02) GAP: No roster reader is wired, so staff are checked for shape and uniqueness only, not that they carry a book.
- [ ] M14-S02-NOTE-4 (M14-S02) FRONT-END LOOP: The event drawer (gaps list, confirm-before-remove from the 428 answer) and the activity lines written from the API answer.
- [ ] M14-S03-NOTE-1 (M14-S03) PROVISIONAL: Until a Google/Zoho Sheet reader exists, the page posts parsed intake rows to POST /api/events/[id]/sheet and the loader re-checks every row (Jev 0.95); 'All to one person' must be the loader, the event's staff or a roster-eligible user.
- [ ] M14-S03-NOTE-2 (M14-S03) HUMAN: Sahil names the tablet intake sheet source and sets Lead_Events.Load_State to Ready when a sheet is ready; nothing sets it today.
- [ ] M14-S03-NOTE-3 (M14-S03) FACT CHANGE PROPOSED: Leads have no Event_Name/Event_Date/Event_Channel; loaded leads carry the lookup Leads.Lead_Event.
- [ ] M14-S03-NOTE-4 (M14-S03) GAP: The front-end policy gives Digital Infrastructure the events load right but TC-E10-012 says Sahil cannot load; the server follows the policy until the owner decides.
- [ ] M14-S03-NOTE-5 (M14-S03) GAP: server/leads/capture.ts writes Consent_How 'On the event sheet' but the picklist holds Form, Verbal, Email reply and Event sheet.
- [ ] M14-S03-NOTE-6 (M14-S03) FRONT-END LOOP: The capture event picker and the sheet card (rule select, split preview, 'Loaded the event sheet' lines).
- [ ] M13-S03-NOTE-1 (M13-S03) PROVISIONAL: A reply is stored as a Note on the Case and pushed as case.replied; requestToCase now writes Related_To and Case_Origin (the org's names).
- [ ] M13-S03-NOTE-2 (M13-S03) FRONT-END LOOP: The Tickets drawer and row chips call POST /api/cases, PATCH /api/cases/[id] {to, expectedModifiedTime} and POST /api/cases/[id]/reply.
- [ ] M13-S03-NOTE-3 (M13-S03) HUMAN PROOF: On the sandbox open a Records ticket as Finance, park and close it, and confirm a KAM and a Compliance seat are refused on a Bank ticket.
- [ ] M13-S03-NOTE-4 (M13-S03) GAP: A new ticket is owned by the opener (or a named owner with assign); the category assignment rule (T01) is not in Zoho yet.
- [ ] M13-S06-NOTE-1 (M13-S06) PROVISIONAL: contracts/update.published.json is added and each update is pushed as one signed event per investor in the segment (Jev 0.82); a Notice is written as Category Other (Jev 0.24, low).
- [ ] M13-S06-NOTE-2 (M13-S06) FACT CHANGE PROPOSED: Add Notice to Investor_Updates.Category, NRI only to Audience, and a text field Audience_Predicate; until then an NRI-only publish is refused.
- [ ] M13-S06-NOTE-3 (M13-S06) HUMAN: Sahil adds the custom function refusing Statement and Compliance updates from Account Management profiles (T01).
- [ ] M13-S06-NOTE-4 (M13-S06) FRONT-END LOOP: The Investor updates page and publish drawer read GET /api/updates and POST {headline, kind, audience, llpId, body}.
- [ ] M13-S06-NOTE-5 (M13-S06) HUMAN PROOF: On the sandbox publish a Statement to everyone as Finance and confirm Sent_Count matches the book and the stub records one update.published per investor.
- [ ] M15-S05-NOTE-1 (M15-S05) GAP: Plane C reveal lines carry only the field, not the chosen reason; Plane C has no test-link action; server/leads/search.ts still files a successful search as a refusal and should use the new log.event kind.
- [ ] M15-S05-NOTE-2 (M15-S05) GAP: No /api/system route feeds server/system/checks.ts; it should pass planeBBetween(...) as SystemFacts.ops so headroom reads the stored credits header, plus auditArchive().lastRun() and investorAppOutbox().stats().
- [ ] M15-S05-NOTE-3 (M15-S05) GAP: The sign-in history runbook ops/runbooks/sign-in-history.md the reader points to does not exist (T03).
- [ ] M15-S05-NOTE-4 (M15-S05) FRONT-END LOOP: The Logs view on GET /api/logs (filters, byActor chips, identityReveals, headroom, signInHistory).
- [ ] M15-S05-NOTE-5 (M15-S05) HUMAN PROOF: TC-E11-016..019 and TC-IM10-010..013 on staging, and a locked archive for the day files.
- [ ] M10-S22-NOTE-1 (M10-S22) PROVISIONAL: The app preview shows payout dates and states to every seat with the record, amounts only to seats with Money (Jev 0.75).
- [ ] M10-S22-NOTE-2 (M10-S22) GAP: Investor_Payouts exists in Zoho but has no rows in pm/plan-merged/zoho-field-mapping.json and no sandbox fixtures.
- [ ] M10-S22-NOTE-3 (M10-S22) FRONT-END LOOP: Wire features/im/money/preview.tsx to GET /api/investors/[id]/preview.
- [ ] M10-S23-NOTE-1 (M10-S23) PROVISIONAL: The one-time test link comes from a TestLinkIssuer interface that answers 503 not-configured until MA1 names the app's endpoint (Jev 0.25, low); only a reason length code is logged and the words stay in the in-process register (Jev 0.54).
- [ ] M10-S23-NOTE-2 (M10-S23) HUMAN: MA1 must name the investor app's generate-link endpoint and its 'link used' receiver, then a contract is declared in contracts/.
- [ ] M10-S23-NOTE-3 (M10-S23) GAP: No Zoho field marks a test investor account; ZOHO_TEST_INVESTOR_IDS stands in.
- [ ] M10-S23-NOTE-4 (M10-S23) FRONT-END LOOP: Wire the 'Create test sign-in link' drawer to POST/GET /api/investors/[id]/test-link (409 confirm-needed carries the warning).
- [ ] M10-S02-NOTE-1 (M10-S02) FACT CHANGE PROPOSED: Leads has no gate field; gates.ts reads matched Receipts, so the match itself opens the gate and money.confirmed goes to the investor app only.
- [ ] M10-S02-NOTE-2 (M10-S02) PROVISIONAL: On an investor's first matched money match.ts writes Contacts.App_Access empty->Hold (guarded) beside account.opened tentative (Jev 0.54); the first matched Advance on a Reserved allotment sets Hold_Until = IST match day + 30 only when empty or earlier (Jev 0.56
- [ ] M10-S02-NOTE-3 (M10-S02) HUMAN: T01 Zoho validation rule Matched_By != Created_By and a record lock on matched receipts; match.ts refuses the same hand itself, but TC-IM05-024 (Zoho refusing) needs the rule.
- [ ] M10-S02-NOTE-4 (M10-S02) FRONT-END LOOP: 'Match it' posts /api/receipts/[id]/match {expectedModifiedTime}; match time is carried only in events (Receipts has no Matched_At).
- [ ] M10-S03-NOTE-1 (M10-S03) PROVISIONAL: With no answer fields on Receipts both answers move the Claimed report to Match_State 'Not found' and record which answer by a Zoho Note; the confirmed receipt's Note names the report (Jev 0.59).
- [ ] M10-S03-NOTE-2 (M10-S03) FACT CHANGE PROPOSED: Add Receipts fields Claim_Of (lookup Receipts), Claim_Answer (Found/Not there) and Claim_Answer_Reason so a found report does not read as not found in gates.ts.
- [ ] M10-S03-NOTE-3 (M10-S03) GAP: claim.ts keeps only the masked last four of the IR's reference, so 'Confirm and record it' needs Finance to enter the bank reference (checked against those four).
- [ ] M10-S03-NOTE-4 (M10-S03) FRONT-END LOOP: The claim drawer on Today and Payments reads GET /api/claims and /api/claims/[id], posts confirm with an Idempotency-Key and not-there with {reason}, and the IR's lead page shows 'Finance did not find it: <reason>'.
- [ ] M09-S07-NOTE-1 (M09-S07) PROVISIONAL: Investor search queries Contacts with COQL, the seat's scope in the WHERE and LIKE per token, not the Search API (Jev 0.76).
- [ ] M09-S07-NOTE-2 (M09-S07) HUMAN PROOF: On the sandbox confirm COQL Mobile like '%3017' and Mailing_City like '%Mysuru%' match regardless of case and phone formatting for Finance, KAM and IR seats.
- [ ] M09-S07-NOTE-3 (M09-S07) FRONT-END LOOP: The Investors search box calls GET /api/investors/search?q=&farm=<LLP id> with a 200 ms debounce.
- [ ] M11-S03-NOTE-1 (M11-S03) FACT CHANGE PROPOSED: LLP Units_Reserved/Units_Issued/Units_Released are plain integer fields, so the shelf counts allotted and reserved-or-paid from allotments and flags recordedDiffers where the typed fields disagree.
- [ ] M11-S03-NOTE-2 (M11-S03) HUMAN: Sahil sets up roll-ups or formulas for reserved, issued and available on the LLP (T01) so KAM/IR tokens read org-true counts; until then those seats get countsComplete false.
- [ ] M11-S03-NOTE-3 (M11-S03) HUMAN PROOF: On the sandbox confirm COQL accepts Customer.KAM / Customer.Originating_IR lookup criteria and the SUM group by LLP, Allocation_Status aggregate.
- [ ] M11-S03-NOTE-4 (M11-S03) FRONT-END LOOP: Farms tiles, per-LLP bars and occupancy table read GET /api/farms/shelf.
- [ ] M12-S01-NOTE-1 (M12-S01) PROVISIONAL: Personal-scope documents are listed for Finance, Head of Finance, Compliance, Digital Infrastructure, KAM (own book) and Head of AM; audit, exec and bu see none (Jev 0.39, low); an IR gets allotment paperwork counts only, never personal documents (Jev 0.92); /ap
- [ ] M12-S01-NOTE-2 (M12-S01) FACT CHANGE PROPOSED: D70 lets the originating IR see personal documents but M12-S01 AC6 says an IR never does; the code follows AC6.
- [ ] M12-S01-NOTE-3 (M12-S01) HUMAN: Sahil sets the T02 profile permissions and sharing so Attachments on Contacts, allotments and LLPs follow the scope table, and proves them with the restricted user.
- [ ] M12-S01-NOTE-4 (M12-S01) GAP: There is no Documents module in the org (type, scope, signing state), so reads return attachment metadata only; server/investors/record.ts should import listAttachments from server/documents/attachments.ts.
- [ ] M12-S01-NOTE-5 (M12-S01) FRONT-END LOOP: The investor DOCS tab reads /api/documents/investor/[id] and /api/documents/farm/[id] (AC7).
- [ ] M17-S01-NOTE-1 (M17-S01) FRONT-END LOOP: The Teams page and rights-grid tile are ported onto GET /api/teams and /api/teams/{id}, then TC-E14-001..003 and TC-IM10-001..004 re-run (T04).
- [ ] M17-S01-NOTE-2 (M17-S01) PROVISIONAL: A Zoho user whose status is not 'active' is treated as left (seated from the role they still hold); confirm the deactivated status value and that GET /users?type=AllUsers returns them on the sandbox.
- [ ] M17-S01-NOTE-3 (M17-S01) GAP: The rights grid has one column per D80 Zoho role (12, 7 with an Investors seat) while the prototype shows 8 Investors seat columns incl. Auditor and Administrator, which have no D80 role; the front end chooses the columns.
- [ ] M17-S01-NOTE-4 (M17-S01) HUMAN PROOF: Confirm KAM, viewer and IR profiles can read GET /users?type=AllUsers and the Contacts.KAM / Leads.Owner count aggregates on the sandbox.
- [ ] M13-S05-NOTE-1 (M13-S05) GAP: Cases has no app_request_id field, so request.raised is idempotent on a persistent index plus a COQL match on the Subject marker '- ref <app_request_id>' (Jev 0.73); switch to the field once it exists.
- [ ] M13-S05-NOTE-2 (M13-S05) PROVISIONAL: The Contact check requires actor.kind investor and actor.investor_contact_id equal to the request's Contact, and arl_code (when sent) equal to ARL_ID; a mismatch answers 422 (Jev 0.97). Request kinds map to Ticket_Category bank_change/payout_mandate Bank, exit C
- [ ] M13-S05-NOTE-3 (M13-S05) FACT CHANGE PROPOSED: contracts/request.executed.json gains state 'received' and an optional case_id so the app can link case.replied to its request (Jev 0.96); the investor app must accept it (MA1).
- [ ] M13-S05-NOTE-4 (M13-S05) HUMAN: The investor app must send actor.investor_contact_id on every request.raised; confirm with the app team together with MA1's Supabase-user-to-Contact mapping.
- [ ] M13-S05-NOTE-5 (M13-S05) GAP: A request whose Contact has no KAM is created under the provider-callback token's user until a routing rule exists.
- [ ] M13-S05-NOTE-6 (M13-S05) FRONT-END LOOP: The reply thread and 'Reply to the investor' control read GET /api/cases/[id]/deliveries for 'Reply not delivered yet' / 'Delivered'.
- [ ] M13-S05-NOTE-7 (M13-S05) HUMAN PROOF: TC-IM08-016 on the sandbox (POST request.raised R-1 twice, one Case) once the signing key and staging exist.
- [ ] M10-S20-NOTE-1 (M10-S20) PROVISIONAL: The 60-month payout schedule is anchored on the allotment's Investment_Date until an issue-date field exists (Jev 0.14, low); LLP_UnitAllocation_Module has no Issued_On, and the data layer now reads Investment_Date instead.
- [ ] M10-S20-NOTE-2 (M10-S20) HUMAN: Investor_Payouts has no unique field; make Name (<allotmentId>-NN) unique so concurrent schedule runs can never duplicate an instalment.
- [ ] M10-S20-NOTE-3 (M10-S20) FRONT-END LOOP: The Payouts tab and 'payouts due this month' queue use GET /api/payouts/allotments/[id], GET /api/payouts and POST /api/payouts/[id]/paid (Idempotency-Key per press); the issue flow calls POST /api/payouts/schedule.
- [ ] M10-S20-NOTE-4 (M10-S20) HUMAN PROOF: Run scripts/payouts-schedule.cjs without and with --commit on the sandbox and mark one payout paid.
- [ ] M05-S06-NOTE-1 (M05-S06) FRONT-END LOOP: The four tiles, the 'as of HH:MM' line and the stale state read GET /api/numbers/investors-today before TC-IM03-001/002/013 run in the UI.
- [ ] M05-S06-NOTE-2 (M05-S06) HUMAN PROOF: TC-IM03-015 on the sandbox: a cold Today render spends at most five COQL calls and Zoho accepts COQL aggregates grouped by the Allotment lookup on Receipts.
- [ ] M05-S06-NOTE-3 (M05-S06) GAP: server/money/register.ts counts Pending receipts in netBanked and stillDue, so the Payments register disagrees with Today's matched-only figures whenever a receipt is unmatched (D21).
- [ ] M08-S04-NOTE-1 (M08-S04) HUMAN: Build Zoho approval processes on LLP_UnitAllocation_Module for the extend edit (Hold_Until + Hold_Extension_State=Requested) and the lapse edit (Allocation_Status=Cancelled), then set GZ_EXTEND_APPROVAL=on and GZ_RELEASE_APPROVAL=on.
- [ ] M08-S04-NOTE-2 (M08-S04) PROVISIONAL: 'Extend the hold' is one guarded edit of Hold_Until (old deadline + days) with the request fields, held by Zoho's approval process (Jev 0.89).
- [ ] M08-S04-NOTE-3 (M08-S04) GAP: server/money/match.ts writes Hold_Until but emits no hold.changed 'open' (TC-IM05-028); an extension approved later in Zoho emits nothing until a workflow or later read does.
- [ ] M08-S04-NOTE-4 (M08-S04) FACT CHANGE PROPOSED: Receipts.Kind has no Forfeit value, so the lapse carries the forfeit in the Refund receipt's Note; add Forfeit to the picklist to list forfeits as rows.
- [ ] M08-S04-NOTE-5 (M08-S04) HUMAN PROOF: On the sandbox confirm the Pending Refund insert succeeds although Receipts.Name is system-mandatory and neither the replay path nor the lapse sets it.
- [ ] M08-S04-NOTE-6 (M08-S04) FRONT-END LOOP: The Holds running and Land cards, the reservation alert and drawer, and Extend/Release confirmations read /api/holds, /api/holds/land and /api/holds/[id].
- [ ] M08-S08-NOTE-1 (M08-S08) GAP: Leads has no account_opened_at or advance_confirmed_at field (only Reserved_At/Fully_Paid_At); the gate opens through matched Receipts instead.
- [ ] M08-S08-NOTE-2 (M08-S08) HUMAN: Sahil finishes T01 - App_Account_Mark is a plain picklist and there is no permanent_at field; the console sets Tentative on the first match and leaves Permanent to Zoho.
- [ ] M08-S08-NOTE-3 (M08-S08) PROVISIONAL: The first matched money also writes App_Account_Mark=Tentative and App_Mark_At with App_Access=Hold, only when empty, retrying with App_Access alone if Zoho refuses the mark (Jev 0.56); any first matched inbound money opens the account (D10), only an Advance sta
- [ ] M08-S08-NOTE-4 (M08-S08) GAP: server/investors/add-paid.ts sets App_Access=Hold when it creates the Contact before any match - a second opening path to reconcile with 'open on match'.
- [ ] M08-S08-NOTE-5 (M08-S08) FRONT-END LOOP: The app account panel and TC-IM11-005/006 against the stub receiver.
- [ ] M10-S05-NOTE-1 (M10-S05) HUMAN: Create a Statements module (Finance-only, Attachments, fields Name, Period_From, Period_To, Lines, Lines_Matched, Lines_Needs_Owner) and set ZOHO_STATEMENTS_MODULE; until then /api/statements answers 503.
- [ ] M10-S05-NOTE-2 (M10-S05) FRONT-END LOOP: 'Upload the bank statement' plus the matched and 'needs an owner' lists, and TC-IM05-019.
- [ ] M10-S05-NOTE-3 (M10-S05) GAP: The T06 weekly reconciliation runbook belongs in docs/ (outside the backend loop's paths).
- [ ] M10-S05-NOTE-4 (M10-S05) HUMAN PROOF: TC-IM05-026 (KAM token refused on Statements) and TC-IM05-027 (manual 20-line reconciliation) need the live module and profile.
- [ ] M11-S04-NOTE-1 (M11-S04) HUMAN: Install zoho/deluge/take_back_guard.dg as a validation rule function on LLP_Creation_Module.Units_Released (sandbox, then production) with the growize_crm connection per zoho/deluge/README.md.
- [ ] M11-S04-NOTE-2 (M11-S04) HUMAN PROOF: On the sandbox set Block A's Units_Released to 0 while units are held, confirm Zoho refuses it, and save the refusal body as __fixtures__/farms/guard.units-held-refused.response.json to confirm the mapping.
- [ ] M11-S04-NOTE-3 (M11-S04) FRONT-END LOOP: Farms 'Release N' and 'Take it back' call POST/DELETE /api/farms/{id}/release with {version}, show the 422 error in the page, and hide for seats without the farm capability.
- [ ] M11-S04-NOTE-4 (M11-S04) PROVISIONAL: Release and take-back write only Units_Released (Total_Units or 0) and leave LLP_Status untouched (Jev 0.56); Sahil cannot release while his seat is an Administrator profile.
- [ ] M11-S07-NOTE-1 (M11-S07) HUMAN: Install zoho/deluge/oversell_guard.dg as a validation rule function on LLP_UnitAllocation_Module (Reserved_Units, Issued_Units, LLP) with the growize_crm connection (ZohoCRM.coql.READ, modules.READ) and report any compile error (T02).
- [ ] M11-S07-NOTE-2 (M11-S07) HUMAN PROOF: On the sandbox run TC-IM06-017 (a 2-unit Reserved allotment on the full Block B), confirm Zoho refuses it, and save the refusal body so ZOHO_GUARD_RULES can be tightened to the real code.
- [ ] M11-S07-NOTE-3 (M11-S07) GAP: Allotment writers (server/holds, money advance recording, investors/add-paid.ts) must call the oversell guard from server/farms/oversell.ts; not wired yet.
- [ ] M11-S07-NOTE-4 (M11-S07) FRONT-END LOOP: The receipt and allot drawers show the oversell refusal naming the LLP and its free units (TC-IM06-012).
- [ ] M12-S02-NOTE-1 (M12-S02) FRONT-END LOOP: The upload control sends file bytes to POST /api/documents/upload?scope=&id=&slot=&name=&expected= with one Idempotency-Key per chosen file, reused on retry.
- [ ] M12-S02-NOTE-2 (M12-S02) HUMAN PROOF: On the sandbox upload a PDF to an allotment and to the Supplementary_Agreement slot as Harsha and confirm Zoho shows Harsha as uploader.
- [ ] M12-S02-NOTE-3 (M12-S02) PROVISIONAL: Upload seats until OD8 - Finance, Head of Finance and DI on all Investors-side scopes, Compliance on personal papers only, IR/channel partner/IR Manager only the lead NDA on leads they own or cover.
- [ ] M12-S03-NOTE-1 (M12-S03) PROVISIONAL: Jev chose reading Zoho Sign with the service token (0.07), which breaks D53, so rows come from CRM *_Sign_Req_Id/*_Signed_Via/*_Verified_At fields and a per-viewer Sign reader hook is left unwired; Send/Verify only for fin, head, di and ops until OD8.
- [ ] M12-S03-NOTE-2 (M12-S03) GAP: No Documents module and no Sign_Status/Sign_Sent_At fields, so 'sent by', 'sent on', expiry and live Sign status stay empty until they exist or a per-user Zoho Sign client does.
- [ ] M12-S03-NOTE-3 (M12-S03) FRONT-END LOOP: The Documents page reads GET /api/documents/list?cut=out|all; the rail badge is outCount; a 503 carries fresh.at/tone for the stale block.
- [ ] M12-S09-NOTE-1 (M12-S09) FRONT-END LOOP: The Emails tab reads GET /api/emails/{lead|investor|allotment}/{id} and opens /api/emails/{kind}/{id}/{messageId}?owner={ownerId}; a 403 shows the in-page refusal.
- [ ] M12-S09-NOTE-2 (M12-S09) HUMAN PROOF: On the sandbox confirm the v8 Emails list and open responses match the recorded fixtures.
- [ ] M12-S09-NOTE-3 (M12-S09) PROVISIONAL: An IR Manager reads lead emails only on leads they own or cover until a team (subtree) reader exists.
- [ ] M13-S04-NOTE-1 (M13-S04) HUMAN: Create Cases fields Handed_By (user lookup, lookup sharing Read Only) and Handed_At (DateTime) and turn on field history for Owner and Handed_By; the Tickets register already selects both, so the live Tickets read fails until they exist.
- [ ] M13-S04-NOTE-2 (M13-S04) PROVISIONAL: The KAM stays the watcher through Handed_By with lookup sharing; the register reads Owner = me or Handed_By = me (Jev 0.62).
- [ ] M13-S04-NOTE-3 (M13-S04) HUMAN PROOF: On the sandbox confirm change_owner works on a KAM's own token (Change Owner permission on Cases) and that Imran can still read the Case afterwards but cannot close it.
- [ ] M13-S04-NOTE-4 (M13-S04) HUMAN: File the cancelled cheque as a personal document on the Contact (Bank_Proof) with the KAM profile denied access, never on the Case (T02, D70).
- [ ] M13-S04-NOTE-5 (M13-S04) FRONT-END LOOP: Ticket rows show 'handed to <Finance> by <KAM>' and the watched note, no 'Close it' on a watched row; 'Hand it to Finance' posts /api/cases/{id}/handover with expectedModifiedTime.
- [ ] M17-S02-NOTE-1 (M17-S02) FRONT-END LOOP: PUT /api/users/{id} answers 403 {code:'step-up'} until a fresh Zoho sign-in (action 'seat'); lead-side seats send {seat, side:'lead'}; setMgr calls PUT /api/users/{id}/manager and shows 409 loop / would-lose.
- [ ] M17-S02-NOTE-2 (M17-S02) HUMAN PROOF: On the sandbox confirm PUT /users/{id} with Reporting_To changes a manager on a non-admin changer's token, and run TC-E14-004 and TC-E14-022 with a real restricted user.
- [ ] M17-S02-NOTE-3 (M17-S02) PROVISIONAL: A manager change is refused when the new manager is neither the changer nor someone they manage (the prototype only checks that the manager exists).
- [ ] M17-S02-NOTE-4 (M17-S02) GAP: The new Plane C action 'manager-change' has no label in server/logs/reader.ts or server/activity; it should read 'Changed who they report to'.
- [ ] M12-S04-NOTE-1 (M12-S04) HUMAN: Zoho Sign API plan with webhooks on sign.zoho.in (AP3) and ZohoSign.documents scopes added to the staff OAuth client, since send, remind, recall and the status read run on the person's own token.
- [ ] M12-S04-NOTE-2 (M12-S04) HUMAN: Finance's Zoho Sign templates (MA2) each with exactly one SIGN action and Aadhaar eSign set inside the template, because the API has no Aadhaar key and an uploaded PDF with Aadhaar is refused.
- [ ] M12-S04-NOTE-3 (M12-S04) FACT CHANGE PROPOSED: Per D77 only *_Sign_Req_Id and *_Signed_Via are written; status and sent time are read live from Zoho Sign instead of being written to the record.
- [ ] M12-S04-NOTE-4 (M12-S04) FRONT-END LOOP: The send drawer and Send one panel call GET /api/documents/sign/prefill and POST /api/documents/sign/send with an Idempotency-Key per press.
- [ ] M12-S04-NOTE-5 (M12-S04) PROVISIONAL: Send, remind, recall, verify and block seats are fin, head, ops and di on every paper plus comp on the FEMA declaration, until OD8.
- [ ] M12-S05-NOTE-1 (M12-S05) HUMAN PROOF: A sandbox run of a real Zoho Sign webhook (x-zs-webhook-signature, operation_type/performed_at dedupe key) and of the decline-reason key in GET /requests/{id}.
- [ ] M12-S05-NOTE-2 (M12-S05) GAP: server/documents/list.ts should pass createSignStatusReader (server/zoho-sign/status.ts) as signStatus so rows show Viewed/Declined/Recalled and sent dates (also needed by the queues and Numbers paper lists); an ops process-start hook should call ensureSignCheck so the 
- [ ] M12-S05-NOTE-3 (M12-S05) PROVISIONAL: A valid webhook writes nothing for sent/viewed/declined/expired/recalled and runs the filing only on a re-read 'completed' (D77, Jev 0.81).
- [ ] M12-S05-NOTE-4 (M12-S05) FRONT-END LOOP: Status chips, Send a reminder and Recall with an in-page reason call /api/documents/sign/remind and /recall.
- [ ] M12-S06-NOTE-1 (M12-S06) HUMAN: The provider-callback service profile needs write on the slot file fields and *_Verified_At (FLS, T01), and each slot file field must accept the signed PDF.
- [ ] M12-S06-NOTE-2 (M12-S06) FACT CHANGE PROPOSED: Contacts.Agreement_signed (Yes/No picklist) exists but is not written; the signed stamp stays Supplementary_Verified_At - confirm or retire the legacy picklist.
- [ ] M12-S06-NOTE-3 (M12-S06) HUMAN PROOF: On the sandbox prove GET /requests/{id}/pdf returns a single PDF for one-document requests and that automated filing leaving *_Verified_By empty is acceptable.
- [ ] M12-S06-NOTE-4 (M12-S06) FRONT-END LOOP: The manual verify drawer uploads via /api/documents/upload then POSTs /api/documents/sign/verify with method and reference.
- [ ] M12-S07-NOTE-1 (M12-S07) PROVISIONAL: The block reason is a Zoho Note on the record and the slot's request id, method and verified fields are cleared, because no blocked or reason field exists (Jev 0.78).
- [ ] M12-S07-NOTE-2 (M12-S07) FACT CHANGE PROPOSED: Add *_Blocked_At and *_Blocked_Reason per paper slot so the Documents list can show a blocked row and its reason.
- [ ] M12-S07-NOTE-3 (M12-S07) FRONT-END LOOP: 'Nothing has come back' and 'Block it' call POST /api/documents/sign/block.
- [ ] M12-S08-NOTE-1 (M12-S08) PROVISIONAL: Requests are created without is_embedded so the email path always works; embedtoken answers 409 'sign from the email' if Zoho refuses (Jev 0.83); embedtoken and the Contact read run on the provider-callback service credential because the investor has no Zoho tok
- [ ] M12-S08-NOTE-2 (M12-S08) HUMAN: The investor app codebase, CONTRACT_SIGNING_KEY, its origin (INVESTOR_APP_URL or SIGN_EMBED_HOSTS) and its Supabase-user-to-Contact mapping (MA1).
- [ ] M05-S07-NOTE-1 (M05-S07) FRONT-END LOOP: Today (Investors side) reads GET /api/queues/investors (side money: rows with kind/text/urg/action/ref) and renders one control per row; answering a claim stays POST /api/claims/[id].
- [ ] M05-S07-NOTE-2 (M05-S07) GAP: Paper rows cannot say 'sent <n> days ago' or apply the 3-day threshold, and the 'send'/'declined' rows have no source, until the Zoho Sign status reader is wired into documents/list.
- [ ] M05-S07-NOTE-3 (M05-S07) HUMAN PROOF: Live proof of Harsha's, Fahad's and Latha's queues on the sandbox.
- [ ] M05-S08-NOTE-1 (M05-S08) FRONT-END LOOP: The KAM Today tiles and cadence/last-heard cards read GET /api/queues/investors (side am: rows, tiles, accounts, tickets).
- [ ] M05-S08-NOTE-2 (M05-S08) GAP: Contacts has no Tier or Next_Contact_On field; tier is computed from issued units by the front end's tierOf/TIERS and the next contact is cadence after the last Touch.
- [ ] M05-S08-NOTE-3 (M05-S08) FACT CHANGE PROPOSED: Conversations are stored in Touches against the origin Lead, not on the Contact as AC4 says; accept Touches-on-Lead or add a Contact lookup to Touches.
- [ ] M05-S08-NOTE-4 (M05-S08) PROVISIONAL: Tickets open on the KAM are a tile and a separate list, not queue rows, matching the front end's mineQueue (Jev 0.75); the KAM access re-check is copied from server/data/live.ts and should be exported from there.
- [ ] M05-S08-NOTE-5 (M05-S08) HUMAN PROOF: Imran's and Divya's day on staging (T04 UAT).
- [ ] M16-S08-NOTE-1 (M16-S08) FRONT-END LOOP: Investors side sections (Collection, At risk, Paper, Compliance, Service) and TC-IM09-001..003 read /api/numbers/investors-side.
- [ ] M16-S08-NOTE-2 (M16-S08) PROVISIONAL: COQL rejects PAN_Proof/Bank_Proof in criteria, so a proof slot counts as missing while its *_Verified_At is empty (Jev 0.95); Collection counts matched receipts only (D21, as Today) and differs from the register's netBanked until the register follows D21.
- [ ] M16-S09-NOTE-1 (M16-S09) FRONT-END LOOP: TC-IM09-004..007 need Numbers to show only Service for KAM and Head of AM and hide the switch for IRs; the server refuses money sections with 403 money-hidden.
- [ ] M16-S09-NOTE-2 (M16-S09) HUMAN: Confirm whether Sahil (super user) reads Collection (story AC4, which the server does) or has no Insights at all (TC-IM09-006).
- [ ] M16-S09-NOTE-3 (M16-S09) HUMAN PROOF: With Receipts set to none for Account Management profiles (AP2), a live KAM probe of /api/numbers/investors-side?section=cash answers 403 money-hidden.
- [ ] M18-S01-NOTE-1 (M18-S01) HUMAN PROOF: Run node console/scripts/load-test.mjs on staging with 6 lead-side and 15 Investors-side sandbox sessions and --log-dir set to the staging LOG_DIR; attach the report showing p95 <= 2000 ms, no concurrency 429 and in-flight peaks <= 12 overall and 8 complex.
- [ ] M18-S01-NOTE-2 (M18-S01) GAP: Today's lead-side reads cannot be one COQL (COQL queries one module), so Tasks, Calls and Events cost three calls per 100 open leads; only Zoho's Composite API would cut that.
- [ ] M18-S01-NOTE-3 (M18-S01) PROVISIONAL: The daily credit projection assumes the header first appears at half the daily allowance (D47) and projects to Kolkata midnight, an early-warning estimate; the load-test page-to-API map must be checked against the front end's calls.
- [ ] M11-S05-NOTE-1 (M11-S05) HUMAN: Create the Allotment blueprint on LLP_UnitAllocation_Module Allocation_Status Reserved -> Issued (T01) with conditions Alloc_Letter_Verified_At set, balance due 0, KYC Completed and FEMA_Verified_At when FEMA_Applicable; Allocation_Status is still an ordinary editable
- [ ] M11-S05-NOTE-2 (M11-S05) HUMAN PROOF: On the sandbox record the real GET/PUT /actions/blueprint answers to replace the hand-built fixtures under __fixtures__/allot, and confirm a direct PUT of Allocation_Status is refused (TC-IM06-016).
- [ ] M11-S05-NOTE-3 (M11-S05) FRONT-END LOOP: Verify on the Allocation letter row posts /api/investors/{id}/allot {allotmentId, reference, expectedModifiedTime} and shows the 422 facts-missing message.
- [ ] M11-S05-NOTE-4 (M11-S05) FACT CHANGE PROPOSED: The story says rung 7 ticks from the allotment, but journey.ts numbers it rung 8 'Allocated' and its alloc gate does not read Allocation_Status Issued or allotment.done.
- [ ] M11-S05-NOTE-5 (M11-S05) GAP: No field stores the e-Mudhra reference; lapse-release.ts still writes Allocation_Status Cancelled by update(), so Allocation_Status cannot be added to the client's blueprint-owned fields until it moves to a transition.
- [ ] M11-S05-NOTE-6 (M11-S05) PROVISIONAL: The letter's verification stamp is written before the transition because the blueprint condition reads it, so a refused allotment leaves the letter verified.
- [ ] M12-S11-NOTE-1 (M12-S11) HUMAN: Create on Leads the proposed round fields NDA_Told_Via (Call/WhatsApp/Email), NDA_Told_At, NDA_Told_By, NDA_Chase_Count, NDA_Last_Chase_At, NDA_Last_Chase_Via, NDA_Said_At, NDA_Said_By and the same eight with prefix Supp_, IR-editable on these only, plus a sharing rul
- [ ] M12-S11-NOTE-2 (M12-S11) PROVISIONAL: IR chases are a per-round count plus last-chase stamp and channel on the Lead with detail in the Touch and Note (Jev 0.26, low); every IR step of both rounds lives on the Lead (Jev 0.73); the IR's word for Finance is the round's Said_At/Said_By matched by round 
- [ ] M12-S11-NOTE-3 (M12-S11) FRONT-END LOOP: The lead page Paperwork row GETs /api/leads/[id]/paperwork and sends each step's rowToken (plus channel, attachmentId or link) and undoToken back; Finance's queue and verify panel use hints.ts hintForDocument/rankForFinance.
- [ ] M12-S11-NOTE-4 (M12-S11) HUMAN PROOF: TC-E09-001..009 and TC-IM07-008..010 on the sandbox once the fields and sharing rule exist.
- [ ] M12-S11-NOTE-5 (M12-S11) GAP: followup.ts reads Consent_Visit on Leads, which the org does not have.
- [ ] M12-S12-NOTE-1 (M12-S12) HUMAN: Create on Leads Supp_Draft_Version, Supp_Draft_Ref, Supp_Draft_At, Supp_Draft_By, Supp_Agreed_Ref, Supp_Agreed_Version, Supp_Agreed_At, Supp_Agreed_By (proposed; not in the org).
- [ ] M12-S12-NOTE-2 (M12-S12) GAP: Finance's Send on the allotment should offer the agreed draft (Lead.Supp_Agreed_Ref) in the documents send flow.
- [ ] M12-S13-NOTE-1 (M12-S13) HUMAN: Create Leads.Pitch_Deck_Sent_At (datetime, IR-editable) and put the approved pitch deck (MA4) in Zoho so its file id can be attached.
- [ ] M12-S13-NOTE-2 (M12-S13) GAP: lib/zoho/client.ts sendMail has no attachments, so no DeckMailer is wired and Deck follow-up answers deck-not-ready until attachment support and the deck file id exist.
- [ ] M12-S13-NOTE-3 (M12-S13) FRONT-END LOOP: Hide Deck follow-up/Webinar invite and the deck next steps before the NDA is signed, and add the Investor file 'Paperwork & material' tab (T02).
- [ ] M12-S05-NOTE-5 (M12-S05) HUMAN PROOF: Confirm a viewer's own Zoho token carries the ZohoSign scope so Documents rows show Viewed/Declined/Recalled and sent dates, and that one 10-minute sign-check cycle appears in Plane B once ZOHO_SIGN_API_ORIGIN and ZOHO_PROVIDER_CALLBACK_REFRESH_TOKEN are set.
- [ ] M12-S05-NOTE-6 (M12-S05) FRONT-END LOOP: Documents rows carry sign.label and yourMove 'Send a new one' / 'Finance to send a new one', and Numbers Paper rows carry status.
- [ ] M05-S07-NOTE-4 (M05-S07) FRONT-END LOOP: A Declined/Recalled/Expired paper is no longer a Remind row; decide whether the queue needs a 'send a new one' row kind.
- [ ] M10-S01-NOTE-6 (M10-S01) FRONT-END LOOP: Register received/refunded/netBanked/stillDue are now matched-only (D21) and totals.recorded holds Pending money; the Payments page shows 'recorded, not yet matched' separately.
- [ ] M10-S08-NOTE-3 (M10-S08) PROVISIONAL: By-allotment and the investor record count matched money only with a per-block recorded figure for Pending receipts (Jev 0.67).
- [ ] M08-S08-NOTE-6 (M08-S08) PROVISIONAL: Add-paid leaves App_Access empty; the account opens On hold only when a second person matches its Pending receipt (Jev 0.85).
- [ ] M09-S09-NOTE-4 (M09-S09) GAP: Add-paid still writes its own 30-day Hold_Until on a Reserved allotment; match.ts moves it only if the match gives a later day. The add-paid answer now says the app opens when the Head of Finance matches the receipt.
- [ ] M18-S08-NOTE-1 (M18-S08) WAITING: T08 UAT defect fixes start only once exploratory sessions and UAT (T01-T07) run on staging; nothing to build before then.
- [ ] M02-S13-NOTE-1 (M02-S13) FACT CHANGE PROPOSED: M02-S13 acceptance names Contacts KYC_Proof/Nominee_Form and Signed_NDA on the allotment; D79 put FEMA/PAN/bank proofs on the Contact and the NDA on the Lead, and the build follows D79. Rewrite the acceptance to D79's slot list (build audit D109).
- [ ] M03-S05-T02 (M03-S05, Sahil, Before its story (do early)) Digital Infrastructure profile for Sahil (non-admin) — Create profile "Digital Infrastructure" with every module of both sides and no Administrator; move Sahil's user onto it; keep the permanent super admin separate (D110).

# :clipboard: Stories

## M01 · Foundations & the one app shell

|Story|1. Front end on demo data|2. Plug into Zoho|2b. Wire screens to the API|2c. Test contracts and security hardening|3. Test and harden|Screens today|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|---|---|---|
|**M01-S01** One Next.js shell with the rail built from the person's seat|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|To do|—|To do|Built (demo data)|S1|Must|6/10|
|**M01-S02** Sign in with my own Zoho account; signing out or changing person clears everything|—|:hourglass_flowing_sand: Waiting on people|To do|—|To do|Partly built|S1|Must|3/6|
|**M01-S03** Live reads and writes through one Zoho client, gate and scope-keyed cache|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|—|—|To do|Built (demo data)|S1|Must|5/7|
|**M01-S04** Operations and identity logs|—|:hourglass_flowing_sand: Waiting on people|—|—|To do|Not a screen|S1|Must|1/2|
|**M01-S05** Staging and production environments|—|:hourglass_flowing_sand: Waiting on people|—|—|To do|Not a screen|S1|Must|1/2|
|**M01-S06** Pending saves while offline|:white_check_mark: Done|—|—|—|To do|Built (demo data)|S2|Must|1/2|
|**M01-S07** Refusals and confirmations said in the page, never in alert() or confirm()|:white_check_mark: Done|—|—|—|To do|Built (demo data)|S1|Must|4/6|
|**M01-S08** Every write goes through commit(): one press, one record, 'Not saved yet' when it cannot land|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|—|—|To do|Built (demo data)|S1|Must|4/6|
|**M01-S09** Honest connection and freshness line in the top bar|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|To do|—|To do|Built (demo data)|S1|Must|2/4|
|**M01-S10** Step-up before a reveal, an export or money leaving, with a second hand on refunds|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|To do|—|To do|Built (demo data)|S3|Must|3/10|

## M02 · Zoho org build-out

|Story|1. Front end on demo data|2. Plug into Zoho|2b. Wire screens to the API|2c. Test contracts and security hardening|3. Test and harden|Screens today|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|---|---|---|
|**M02-S04** Roles, profiles, Private sharing and the field-level security wall for every seat|:white_check_mark: Done|:eyes: Review|—|—|To do|Not a screen|S0|Must|2/10|
|**M02-S01** Enterprise renewed and seats ordered|—|—|—|—|To do|Not a screen|S0|Must|0/3|
|**M02-S02** Lead fields, rungs and picklists per the mapping|—|:hourglass_flowing_sand: Waiting on people|—|—|To do|Not a screen|S0|Must|3/4|
|**M02-S03** Custom modules for the lead side; LLP modules adopted|—|:white_check_mark: Done|—|—|To do|Not a screen|S0|Must|1/3|
|**M02-S05** Restricted test user and T11|—|:hourglass_flowing_sand: Waiting on people|—|—|To do|Not a screen|S0|Must|1/3|
|**M02-S06** Native Lead conversion stopped|—|—|—|—|To do|Not a screen|S0|Must|0/2|
|**M02-S07** Calls, Meetings and Tasks visible to the seats that schedule, with meetings in Zoho Calendar|—|—|—|—|To do|Not a screen|S0|Should|0/2|
|**M02-S08** Email sent from the person's own mailbox|—|:hourglass_flowing_sand: Waiting on people|—|—|To do|Not a screen|S0|Must|1/2|
|**M02-S09** Cover windows as record-level sharing|—|:hourglass_flowing_sand: Waiting on people|—|—|To do|Not a screen|S0|Must|2/3|
|**M02-S10** Sandbox and the console's OAuth client|—|:hourglass_flowing_sand: Waiting on people|—|—|To do|Not a screen|S0|Must|1/3|
|**M02-S11** Decide the canonical allotment module: LLP_UnitAllocation_Module or LLP_Unit_Allocation|—|:white_check_mark: Done|—|—|To do|Not a screen|S0|Must|3/4|
|**M02-S12** Receipts module linked to the allotment, the Contact and the LLP|—|:white_check_mark: Done|—|—|To do|Not a screen|S0|Must|3/4|
|**M02-S13** Document-slot file-upload fields on the Contact, the allotment and the LLP|—|:white_check_mark: Done|—|—|—|Not a screen|S0|Must|4/4|
|**M02-S14** Zoho Sign request id and status fields on the allotment and the Contact; Zoho Sign plan and webhooks|—|:white_check_mark: Done|—|—|—|Not a screen|S0|Must|4/4|

## M03 · Access, seats & super user

|Story|1. Front end on demo data|2. Plug into Zoho|2b. Wire screens to the API|2c. Test contracts and security hardening|3. Test and harden|Screens today|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|---|---|---|
|**M03-S01** Only people with a seat or a granted page sign in|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|—|—|To do|Built (demo data)|S1|Must|3/4|
|**M03-S02** Sahil grants pages to other people, read-only by default|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|To do|—|To do|Built (demo data)|S1|Must|2/4|
|**M03-S03** Extra pages for IRs, and the IR Manager's limits|—|:hourglass_flowing_sand: Waiting on people|To do|—|To do|Built (demo data)|S1|Must|1/3|
|**M03-S04** Grant and seat changes move the sign-in list, follow the job and are logged|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|To do|—|To do|Built (demo data)|S1|Must|3/6|
|**M03-S05** Zoho users provisioned seat by seat, both sides|—|:hourglass_flowing_sand: Waiting on people|—|—|To do|Not a screen|S1|Must|2/5|
|**M03-S06** The Auditor (viewer) reads and never writes|:white_check_mark: Done|—|—|—|To do|Built (demo data)|S1|Must|1/4|
|**M03-S07** Key account managers see and work only their own accounts|—|:hourglass_flowing_sand: Waiting on people|—|—|To do|Partly built|S1|Must|1/4|
|**M03-S08** Compliance owns KYC|:white_check_mark: Done|—|—|—|To do|Built (demo data)|S1|Must|1/3|
|**M03-S09** An IR sees investor data only for investors from their own leads, enforced at the data layer|—|:hourglass_flowing_sand: Waiting on people|—|—|To do|Partly built|S1|Must|2/4|

## M04 · Lead capture

|Story|1. Front end on demo data|2. Plug into Zoho|2b. Wire screens to the API|2c. Test contracts and security hardening|3. Test and harden|Screens today|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|---|---|---|
|**M04-S01** Add a single lead|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|—|—|To do|Built (demo data)|S2|Must|3/4|
|**M04-S02** Duplicate mobile refused|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|—|—|To do|Built (demo data)|S2|Must|2/3|
|**M04-S03** Contact permission at capture|:white_check_mark: Done|—|—|—|To do|Built (demo data)|S2|Must|1/3|
|**M04-S04** CSV import with preview|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|—|—|To do|Built (demo data)|S2|Should|2/3|

## M05 · Today (both sides)

|Story|1. Front end on demo data|2. Plug into Zoho|2b. Wire screens to the API|2c. Test contracts and security hardening|3. Test and harden|Screens today|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|---|---|---|
|**M05-S04** Call times and reschedule|—|:hourglass_flowing_sand: Waiting on people|—|—|—|Partly built|S2|Should|1/2|
|**M05-S01** My day list (Lead side)|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|—|—|To do|Built (demo data)|S2|Must|2/3|
|**M05-S02** One action per row and the focus panel|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|—|—|To do|Built (demo data)|S2|Must|2/3|
|**M05-S03** Paperwork 'your move' on Today|:white_check_mark: Done|—|—|—|To do|Built (demo data)|S2|Must|1/2|
|**M05-S06** Headline figures on Today (Investors side)|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|To do|—|To do|Built (demo data)|S3|Must|2/4|
|**M05-S07** Waiting on you: the Investors-side queue per seat, including IR payment claims|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|To do|—|To do|Built (demo data)|S3|Must|3/6|
|**M05-S08** Account Management's Today (Investors side)|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|To do|—|To do|Built (demo data)|S2|Must|2/5|

## M06 · Leads book & lead search

|Story|1. Front end on demo data|2. Plug into Zoho|2b. Wire screens to the API|2c. Test contracts and security hardening|3. Test and harden|Screens today|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|---|---|---|
|**M06-S01** Leads list with Personal and Team scope|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|—|—|To do|Built (demo data)|S2|Must|2/3|
|**M06-S02** Filters, sort and the Overdue fix|:white_check_mark: Done|—|—|—|To do|Built (demo data)|S2|Must|1/2|
|**M06-S03** Find a lead in the top bar (leads only, own book)|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|To do|—|To do|Built (demo data)|S2|Must|2/4|
|**M06-S05** Search wall: the lead search never reaches investor data|—|:hourglass_flowing_sand: Waiting on people|To do|—|To do|Built (demo data)|S2|Must|2/4|

## M07 · Lead page

|Story|1. Front end on demo data|2. Plug into Zoho|2b. Wire screens to the API|2c. Test contracts and security hardening|3. Test and harden|Screens today|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|---|---|---|
|**M07-S01** Lead page shell and Next step card|:white_check_mark: Done|—|—|—|To do|Built (demo data)|S2|Must|2/3|
|**M07-S02** Logging flow — one question at a time|:white_check_mark: Done|—|—|—|To do|Built (demo data)|S2|Must|1/2|
|**M07-S03** Save on the last tap, recorded once, with 10-second Undo|—|:hourglass_flowing_sand: Waiting on people|—|—|To do|Built (demo data)|S2|Must|2/3|
|**M07-S04** Call time and Zoho activity mapping|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|—|—|To do|Built (demo data)|S2|Must|2/3|
|**M07-S05** Email composer sent through Zoho send_mail|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|To do|—|To do|Built (demo data)|S2|Must|2/4|
|**M07-S06** Close as lost in one step, undo and re-open|—|:hourglass_flowing_sand: Waiting on people|—|—|To do|Partly built|S2|Must|1/2|
|**M07-S07** Latest note, all notes and inline note|:white_check_mark: Done|—|—|—|To do|Built (demo data)|S2|Should|1/2|

## M08 · Journey, gates & hand-offs between the sides

|Story|1. Front end on demo data|2. Plug into Zoho|2b. Wire screens to the API|2c. Test contracts and security hardening|3. Test and harden|Screens today|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|---|---|---|
|**M08-S01** Journey bar, ticks, un-tick and skip|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|—|—|To do|Built (demo data)|S3|Must|2/3|
|**M08-S02** Finance gates read live from Zoho|—|:hourglass_flowing_sand: Waiting on people|To do|—|To do|Built (demo data)|S3|Must|1/3|
|**M08-S03** Money in: the IR reports a payment, Finance records the receipt|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|To do|—|To do|Built (demo data)|S3|Must|4/8|
|**M08-S04** Reservation hold: clock, balance due, extend and release|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|To do|—|To do|Built (demo data)|S3|Must|5/8|
|**M08-S05** Owners and cover (D44)|—|:hourglass_flowing_sand: Waiting on people|To do|—|To do|Partly built|S3|Must|1/3|
|**M08-S07** 'Said yes' becomes the investor record|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|To do|—|To do|Built (demo data)|S3|Must|2/5|
|**M08-S08** The first matched advance opens the investor app account|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|To do|—|To do|Built (demo data)|S3|Must|2/5|

## M09 · Investors & the investor record

|Story|1. Front end on demo data|2. Plug into Zoho|2b. Wire screens to the API|2c. Test contracts and security hardening|3. Test and harden|Screens today|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|---|---|---|
|**M09-S01** Investors list for Finance|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|—|—|To do|Built (demo data)|S2|Must|2/3|
|**M09-S02** KAM book and Head of AM book|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|To do|—|To do|Built (demo data)|S2|Must|2/5|
|**M09-S03** The investor record — header, banners and sections by seat|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|To do|—|To do|Built (demo data)|S2|Must|2/5|
|**M09-S04** Who looks after the account — KAM ownership|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|To do|—|To do|Built (demo data)|S2|Must|2/5|
|**M09-S07** Investor search on the Investors page|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|To do|—|To do|Built (demo data)|S2|Must|2/4|
|**M09-S08** An IR sees only investors from their own leads|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|To do|—|To do|Built (demo data)|S2|Must|2/5|
|**M09-S09** Add an investor who has already paid, straight from the console|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|To do|—|To do|Built (demo data)|S2|Must|2/4|

## M10 · Payments & receipts

|Story|1. Front end on demo data|2. Plug into Zoho|2b. Wire screens to the API|2c. Test contracts and security hardening|3. Test and harden|Screens today|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|---|---|---|
|**M10-S01** Payments register|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|To do|—|To do|Built (demo data)|S3|Must|3/6|
|**M10-S02** Match a receipt — the second hand|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|To do|—|To do|Built (demo data)|S3|Must|3/6|
|**M10-S03** Answer an IR's payment report|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|To do|—|To do|Built (demo data)|S3|Must|2/4|
|**M10-S05** Weekly bank statement upload and reconciliation|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|To do|—|To do|Built (demo data)|S3|Must|2/7|
|**M10-S07** Receipts belong to the allotment (investor × farm)|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|—|—|To do|Built (demo data)|S3|Must|2/4|
|**M10-S08** Per-farm payment view for an investor with several allotments|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|To do|—|To do|Built (demo data)|S3|Should|2/4|
|**M10-S09** ARL holdings and transactions — read-only panel|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|To do|—|To do|Built (demo data)|S3|Should|2/4|
|**M10-S20** Monthly payouts: 60-month schedule per allotment, Finance due queue|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|To do|—|To do|Built (demo data)|S3|Must|2/4|
|**M10-S21** Unlock the investor app and send the welcome from the console|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|To do|—|To do|Built (demo data)|S3|Must|2/4|
|**M10-S22** Preview the investor's app screens (mock-up with their data)|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|To do|—|To do|Built (demo data)|S4|Should|2/4|
|**M10-S23** Test sign-in link to check the real app on another device|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|To do|—|To do|Built (demo data)|S4|Should|2/4|

## M11 · Farms (the LLP shelf) & allotments

|Story|1. Front end on demo data|2. Plug into Zoho|2b. Wire screens to the API|2c. Test contracts and security hardening|3. Test and harden|Screens today|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|---|---|---|
|**M11-S01** Farms are the LLP shelf|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|To do|—|To do|Built (demo data)|S3|Must|2/5|
|**M11-S02** An allotment links an investor to a farm LLP|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|To do|—|To do|Built (demo data)|S3|Must|2/5|
|**M11-S03** The shelf — released, held and free per farm LLP|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|To do|—|To do|Built (demo data)|S3|Must|2/5|
|**M11-S04** Release a farm LLP's units or take them back|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|To do|—|To do|Built (demo data)|S3|Must|2/4|
|**M11-S05** Allotment on the verified allocation letter|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|To do|—|To do|Built (demo data)|S3|Must|3/7|
|**M11-S07** No unit is sold twice — the oversell guard|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|To do|—|To do|Built (demo data)|S3|Must|2/5|

## M12 · Documents, upload & Zoho Sign

|Story|1. Front end on demo data|2. Plug into Zoho|2b. Wire screens to the API|2c. Test contracts and security hardening|3. Test and harden|Screens today|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|---|---|---|
|**M12-S01** Documents in three scopes, with who sees what|—|:hourglass_flowing_sand: Waiting on people|To do|—|To do|Partly built|S3|Must|1/5|
|**M12-S02** Upload a document straight from the console to Zoho|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|To do|—|To do|Built (demo data)|S3|Must|2/5|
|**M12-S03** Documents page: out for signature and on file, scoped to the seat|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|To do|—|To do|Built (demo data)|S3|Must|2/5|
|**M12-S04** Send a document for signature through Zoho Sign|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|To do|—|To do|Built (demo data)|S3|Must|3/7|
|**M12-S05** Live signature status from Zoho Sign webhooks, with reminders and recall|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|To do|To do|To do|Built (demo data)|S3|Must|3/7|
|**M12-S06** Signed PDF filed to the allotment and Agreement_Signed set|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|To do|—|To do|Built (demo data)|S3|Must|2/5|
|**M12-S07** Block or supersede a document|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|To do|—|To do|Built (demo data)|S3|Must|2/4|
|**M12-S08** The investor signs by email or inside the investor app|—|:hourglass_flowing_sand: Waiting on people|—|—|To do|Partly built|S3|Should|2/3|
|**M12-S09** See a record's emails in the console|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|To do|—|To do|Built (demo data)|S3|Should|2/4|
|**M12-S10** Isolation suite: no user sees another user's leads, investors, documents, sign requests, emails or tickets|—|—|—|—|To do|Partly built|S3|Must|0/8|
|**M12-S11** NDA loop on the lead page, and the IR's word beside Finance's queue|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|To do|—|To do|Built (demo data)|S3|Must|3/6|
|**M12-S12** Supplementary agreement draft loop|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|—|—|To do|Built (demo data)|S3|Must|2/3|
|**M12-S13** Material follows the NDA; deck email marks the deck sent|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|To do|—|To do|Built (demo data)|S3|Must|2/4|
|**M12-S14** 'Your move' on Today and Documents|:white_check_mark: Done|—|—|—|To do|Built (demo data)|S3|Should|1/2|

## M13 · Tickets & investor updates (pushed to the investor app)

|Story|1. Front end on demo data|2. Plug into Zoho|2b. Wire screens to the API|2c. Test contracts and security hardening|3. Test and harden|Screens today|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|---|---|---|
|**M13-S01** Push to the investor app through the signed contracts, with a stub receiver|—|:hourglass_flowing_sand: Waiting on people|—|—|To do|Partly built|S4|Must|3/4|
|**M13-S02** Tickets register scoped by seat|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|To do|—|To do|Built (demo data)|S4|Must|2/5|
|**M13-S03** Open, wait and close a ticket|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|To do|—|To do|Built (demo data)|S4|Must|2/5|
|**M13-S04** A KAM hands a bank or compliance ticket to Finance and keeps watching|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|To do|—|To do|Built (demo data)|S4|Must|2/5|
|**M13-S05** Investor requests arrive as tickets and replies go back to the app|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|To do|—|To do|Built (demo data)|S4|Should|3/5|
|**M13-S06** Publish an investor update to a reconstructable segment|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|To do|—|To do|Built (demo data)|S4|Must|2/5|

## M14 · Events

|Story|1. Front end on demo data|2. Plug into Zoho|2b. Wire screens to the API|2c. Test contracts and security hardening|3. Test and harden|Screens today|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|---|---|---|
|**M14-S01** Events list and event page|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|To do|—|To do|Built (demo data)|S3|Must|2/5|
|**M14-S02** Add, correct and remove an event|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|To do|—|To do|Built (demo data)|S3|Must|2/4|
|**M14-S03** Capture and sheet load tie leads to the event|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|To do|—|To do|Built (demo data)|S3|Must|2/4|

## M15 · Updates & Activity

|Story|1. Front end on demo data|2. Plug into Zoho|2b. Wire screens to the API|2c. Test contracts and security hardening|3. Test and harden|Screens today|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|---|---|---|
|**M15-S01** Updates: what others changed on my book|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|—|—|To do|Built (demo data)|S4|Must|2/3|
|**M15-S03** Activity page: who did what, each seat its own scope, Lead side / Investors side|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|To do|—|To do|Built (demo data)|S4|Must|5/9|
|**M15-S05** Console logs for refusals, reveals and API headroom (Planes B and C), filterable|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|To do|—|To do|Built (demo data)|S4|Must|2/5|

## M16 · Numbers, Plan & Transfers

|Story|1. Front end on demo data|2. Plug into Zoho|2b. Wire screens to the API|2c. Test contracts and security hardening|3. Test and harden|Screens today|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|---|---|---|
|**M16-S01** Assignments by IR report|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|—|—|To do|Built (demo data)|S4|Must|2/3|
|**M16-S02** Open one IR's row and list the leads behind a count|:white_check_mark: Done|—|—|—|To do|Built (demo data)|S4|Should|1/2|
|**M16-S03** Lead-side Numbers sections computed live, one scope at a time|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|—|—|To do|Built (demo data)|S4|Must|2/3|
|**M16-S04** Read the plan|—|:hourglass_flowing_sand: Waiting on people|—|—|To do|Partly built|S4|Must|1/2|
|**M16-S06** Transfers per month: leads that became investors|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|—|—|To do|Built (demo data)|S4|Must|2/3|
|**M16-S07** Open a month to its investors|:white_check_mark: Done|—|—|—|To do|Built (demo data)|S4|Should|1/2|
|**M16-S08** Investors side of Numbers: collection, paper and compliance|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|To do|—|To do|Built (demo data)|S4|Should|2/4|
|**M16-S09** Money figures only to seats that may see them|—|:hourglass_flowing_sand: Waiting on people|To do|—|To do|Partly built|S4|Must|1/3|

## M17 · Teams, Profile & System

|Story|1. Front end on demo data|2. Plug into Zoho|2b. Wire screens to the API|2c. Test contracts and security hardening|3. Test and harden|Screens today|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|---|---|---|
|**M17-S01** Teams: members, seats and what each seat may do, from Zoho|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|To do|—|To do|Built (demo data)|S4|Must|3/5|
|**M17-S02** Grant pages and change seats|—|:hourglass_flowing_sand: Waiting on people|To do|—|To do|Built (demo data)|S4|Must|1/3|
|**M17-S05** My profile|—|:hourglass_flowing_sand: Waiting on people|—|—|To do|Built (demo data)|S4|Must|1/2|
|**M17-S06** System health and administration|—|:hourglass_flowing_sand: Waiting on people|—|—|To do|Partly built|S4|Must|1/2|

## M18 · Hardening, security & release

|Story|1. Front end on demo data|2. Plug into Zoho|2b. Wire screens to the API|2c. Test contracts and security hardening|3. Test and harden|Screens today|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|---|---|---|
|**M18-S01** The app stays fast inside Zoho's API limits|—|:hourglass_flowing_sand: Waiting on people|—|—|To do|Not a screen|S5|Must|3/6|
|**M18-S02** Nothing leaks outside a seat's scope: seat x page x action x field matrix|—|:hourglass_flowing_sand: Waiting on people|—|—|To do|Not a screen|S5|Must|2/6|
|**M18-S03** Every page works on a phone and by keyboard|:white_check_mark: Done|—|—|—|To do|Not a screen|S5|Must|2/4|
|**M18-S04** Errors are captured, visible and alerted|—|:hourglass_flowing_sand: Waiting on people|To do|—|To do|Not a screen|S5|Must|2/4|
|**M18-S05** Data and logs are backed up and restorable|—|—|—|—|To do|Not a screen|S5|Must|0/3|
|**M18-S06** Legacy records carried across without new Deals|—|—|—|—|To do|Not a screen|S5|Must|0/3|
|**M18-S08** Exploratory sessions and UAT signed off on both sides|—|:hourglass_flowing_sand: Waiting on people|—|To do|To do|Not a screen|S5|Must|1/11|
|**M18-S09** Go-live by checklist with a runbook and a rehearsed rollback|—|—|—|—|To do|Not a screen|S5|Must|0/6|
|**M18-S10** Runbook and hypercare|—|—|—|—|To do|Not a screen|S5|Should|0/3|
|**M18-S12** Move the org's old payment columns into Receipts on the allotment|—|:hourglass_flowing_sand: Waiting on people|—|—|To do|Partly built|S5|Must|1/3|
|**M18-S14** Every API route refuses at the door: no session, wrong seat, bad input, masked fields|—|—|—|To do|—|—|S5|Must|0/3|
|**M18-S15** Browser and request hardening: security headers, Origin check, rate limits, upload limits|—|—|—|To do|—|—|S5|Must|0/4|

## M19 · Quality — Jev UI suite

|Story|1. Front end on demo data|2. Plug into Zoho|2b. Wire screens to the API|2c. Test contracts and security hardening|3. Test and harden|Screens today|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|---|---|---|
|**M19-S01** UI test contract|:white_check_mark: Done|—|—|—|To do|Not a screen|S1|Must|1/3|
|**M19-S02** Jev UI runner on staging|—|:hourglass_flowing_sand: Waiting on people|—|—|To do|Not a screen|S1|Must|3/5|
|**M19-S03** Zoho sandbox seed and reset|:white_check_mark: Done|:white_check_mark: Done|—|—|To do|Not a screen|S1|Must|2/3|
|**M19-S07** Smoke suite and production check|—|—|—|—|To do|Not a screen|S5|Should|0/2|
|**M19-S08** Flaky tests and re-baselining|—|—|—|—|To do|Not a screen|S3|Should|0/1|
|**M19-S10** Map the two old suites onto the merged console and retire dead cases|—|—|—|—|To do|Not a screen|S2|Must|0/2|
|**M19-S11** Regenerate the Jev UI cases against the merged console: super user and per seat|—|—|—|—|To do|Not a screen|S2|Must|0/4|
|**M19-S12** The 88 unexplained Jev failures are each a fixed bug or a proposed fact change|—|—|—|To do|—|—|S5|Must|0/3|
|**M19-S13** One Jev layer for the whole build: shared client, grounding, question library, calibration per question type, |—|—|—|To do|—|—|S5|Must|0/6|
|**M19-S04** Judge calibration gate|—|:hourglass_flowing_sand: Waiting on people|—|—|—|Not a screen|S1|Must|1/1|
|**M19-S05** CI pipeline|—|:hourglass_flowing_sand: Waiting on people|—|—|—|Not a screen|S1|Must|1/1|
|**M19-S06** Unit tests for business rules|—|:white_check_mark: Done|—|—|—|Not a screen|S1|Must|1/1|

## M20 · Launch readiness & operations

|Story|1. Front end on demo data|2. Plug into Zoho|2b. Wire screens to the API|2c. Test contracts and security hardening|3. Test and harden|Screens today|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|---|---|---|
|**M20-S01** Product brief and KPIs|—|—|—|—|To do|Not a screen|S0|Must|0/1|
|**M20-S03** Training and quick guides|—|—|—|—|To do|Not a screen|S5|Must|0/2|
|**M20-S04** Support model and issue intake|—|—|—|—|To do|Not a screen|S5|Must|0/1|
|**M20-S05** Stage reviews, status and retrospectives|—|—|—|—|To do|Not a screen|S0|Must|0/6|
|**M20-S06** Change control|—|—|—|—|To do|Not a screen|S0|Must|0/1|
|**M20-S07** Bring the investor app codebase into the repo and wire the contract receivers|—|:hourglass_flowing_sand: Waiting on people|—|To do|To do|Partly built|S4|Must|4/6|
|**M20-S08** Buy the Zoho Sign plan and set up its webhooks|—|:hourglass_flowing_sand: Waiting on people|—|—|To do|Not a screen|S0|Must|1/4|
