::: {.callout}
**Updated 28 Sep 2026 11:14 IST** from the build itself (autopilot progress). Statuses are not edited here; comment on a row instead.
:::

# :compass: Where we are

**Goal:** the whole Growize Console (lead side and Investors side, one app on Zoho), built in three phases: **front end first, then plug into Zoho, then test**. Owner's build target ![](slack_date:2026-10-03).

**Now working on:** 2. Plug into Zoho — The same screens read and write Zoho through src/lib/zoho (as the signed-in person), unit and API tests pass, and the UI cases still pass on demo data.

::: {.callout}
:warning: The build loop has not run for 7 hours. Nothing moves until /build runs on the laptop again.
:::

|Phase|Done|Review|Left|Loop hours left|Forecast finish|Pace|
|---|---|---|---|---|---|---|
|**1. Front end on demo data**|92 of 92 (100%)|0|0|0|done|0 min/unit measured|
|**2. Plug into Zoho** :arrow_left:|35 of 119 (29%)|1|84|14.6|![](slack_date:2026-09-29)|10.4 min/unit measured|
|**3. Test and harden**|0 of 145 (0%)|0|145|36.3|![](slack_date:2026-10-02)|assumed until 5 rounds|

|Forecast|Date|
|---|---|
|All three phases through the loop|![](slack_date:2026-10-02)|
|People's testing and UAT finished (earliest go-live)|![](slack_date:2026-10-08)|
|Status|:large_green_circle: On track|

::: {.callout}
**What each phase needs from people.** Phase 1 needs nothing. Phase 2 cannot be tested without the Zoho **sandbox**, an **OAuth client** for the console and a licensed **test user** (Sahil, in BLOCKED.md); the autopilot writes the code meanwhile. Phase 3 needs the tester's weekend reviews and UAT by the business users.
:::

Forecast = loop hours left ÷ 14 loop hours a day. Minutes per unit are assumptions until each phase has 5 measured rounds; then the measured pace takes over. Stories count once per phase they have work in.

## Stages

|Stage|What it delivers|Stories|Done|Forecast done|
|---|---|---|---|---|
|S0|Zoho org build-out and access wall|18|2|![](slack_date:2026-09-29)|
|S1|Foundations, access, test suite|23|0|![](slack_date:2026-09-30)|
|S2|Lead side daily work and Investors pages|30|0|![](slack_date:2026-10-02)|
|S3|Journey, gates, money, paper, Zoho Sign, farms|43|0|![](slack_date:2026-10-02)|
|S4|Updates, tickets, app push, activity, numbers, teams|24|0|![](slack_date:2026-10-02)|
|S5|Hardening, UAT, migration, release|13|0|![](slack_date:2026-10-02)|

# :calendar: Month by month

|Month|Stories finished|Forecast to finish|Cumulative forecast|
|---|---|---|---|
|September 2026|2|86|88 of 151|
|October 2026|0|62|150 of 151|

# :spiral_calendar_pad: Week by week

|Week of|Finished|Forecast|Cumulative|Burn-up|
|---|---|---|---|---|
|![](slack_date:2026-09-21)|2|0|2|:white_large_square::white_large_square::white_large_square::white_large_square::white_large_square::white_large_square::white_large_square::white_large_square::white_large_square::white_large_square: 1%|
|![](slack_date:2026-09-28) **(this week)**|0|148|150|:large_green_square::large_green_square::large_green_square::large_green_square::large_green_square::large_green_square::large_green_square::large_green_square::large_green_square::white_large_square: 99%|

## This week

**Finished (0):** none yet

**Planned by the forecast (148):** M19-S06, M19-S04, M19-S05, M03-S01, M19-S01, M19-S02, M19-S03, M02-S01, M02-S02, M02-S03, M02-S04, M02-S05, M02-S06, M02-S08, M02-S09, M02-S10, M02-S11, M02-S12, M20-S01, M20-S05, M20-S06, M20-S08, M02-S07, M01-S01, M01-S02, M01-S03, M01-S04, M01-S05, M01-S07, M01-S08, M01-S09, M03-S02, M03-S03, M03-S04, M03-S05, M03-S06, M03-S07, M03-S08, M03-S09, M01-S06, M04-S01, M04-S02, M04-S03, M05-S01, M05-S02, M05-S03, M05-S08, M06-S01, M06-S02, M06-S03, M06-S05, M07-S01, M07-S02, M07-S03, M07-S04, M07-S05, M07-S06, M09-S01, M09-S02, M09-S03, M09-S04, M09-S07, M09-S08, M19-S10, M19-S11, M04-S04, M07-S07, M01-S10, M05-S06, M05-S07, M08-S01, M08-S02, M08-S03, M08-S04, M08-S05, M08-S07, M08-S08, M10-S01, M10-S02, M10-S03, M10-S05, M10-S07, M11-S01, M11-S02, M11-S03, M11-S04, M11-S05, M11-S07, M12-S01, M12-S02, M12-S03, M12-S04, M12-S05, M12-S06, M12-S07, M12-S10, M12-S11, M12-S12, M12-S13, M14-S01, M14-S02, M14-S03, M10-S08, M10-S09, M12-S08, M12-S09, M12-S14, M19-S08, M13-S01, M13-S02, M13-S03, M13-S04, M13-S06, M15-S01, M15-S03, M15-S05, M16-S01, M16-S03, M16-S04, M16-S06, M16-S09, M17-S01, M17-S02, M17-S05, M17-S06, M20-S07, M13-S05, M16-S02, M16-S07, M16-S08, M18-S01, M18-S02, M18-S03, M18-S04, M18-S05, M18-S06, M18-S08, M18-S09, M18-S12, M20-S03, M20-S04, M18-S10, M19-S07, M09-S09, M10-S20, M10-S21, M10-S22, M10-S23

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
|**M18** Hardening, security & release|S5|10|0|:white_large_square::white_large_square::white_large_square::white_large_square::white_large_square: 0%|Prove the one app is fast inside Zoho's limits, leaks nothing across seats or users, works on a phone and by keyboard, fails visibly, can be|
|**M19** Quality — Jev UI suite|S1|10|0|:white_large_square::white_large_square::white_large_square::white_large_square::white_large_square: 0%|A Jev UI suite that runs the same plain-language cases against the merged prototype (growize-console-merged.html) and the built app, per sea|
|**M20** Launch readiness & operations|S0|7|0|:white_large_square::white_large_square::white_large_square::white_large_square::white_large_square: 0%|The brief, KPIs, status rhythm and change control that keep the plan honest, the guides and support model for go-live, and the two outside p|

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
- [ ] M03-S05-NOTE-3 (M03-S05) ADMINISTRATOR TOKEN CONFLICT: D78 keeps Sahil on the Administrator profile and the existing CEO/root seat is also Administrator, while `CLAUDE.md` rule 2 says no administrator token is used by the application at all. The resolver records both exact role-to-seat mappings but 
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

# :clipboard: Stories

## M01 · Foundations & the one app shell

|Story|1 Front end|2 Zoho|3 Test|Screens today|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|---|
|**M01-S01** One Next.js shell with the rail built from the person's seat|:white_check_mark: Done|To do|To do|Built (demo data)|S1|Must|4/9|
|**M01-S02** Sign in with my own Zoho account; signing out or changing person clears everything|—|To do|To do|Partly built|S1|Must|0/5|
|**M01-S03** Live reads and writes through one Zoho client, gate and scope-keyed cache|:white_check_mark: Done|To do|To do|Built (demo data)|S1|Must|1/7|
|**M01-S04** Operations and identity logs|—|To do|To do|Not a screen|S1|Must|0/2|
|**M01-S05** Staging and production environments|—|To do|To do|Not a screen|S1|Must|0/2|
|**M01-S06** Pending saves while offline|:white_check_mark: Done|—|To do|Built (demo data)|S2|Must|1/2|
|**M01-S07** Refusals and confirmations said in the page, never in alert() or confirm()|:white_check_mark: Done|—|To do|Built (demo data)|S1|Must|4/6|
|**M01-S08** Every write goes through commit(): one press, one record, 'Not saved yet' when it cannot land|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|To do|Built (demo data)|S1|Must|4/6|
|**M01-S09** Honest connection and freshness line in the top bar|:white_check_mark: Done|To do|To do|Built (demo data)|S1|Must|1/3|
|**M01-S10** Step-up before a reveal, an export or money leaving, with a second hand on refunds|:white_check_mark: Done|To do|To do|Built (demo data)|S3|Must|1/9|

## M02 · Zoho org build-out

|Story|1 Front end|2 Zoho|3 Test|Screens today|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|---|
|**M02-S04** Roles, profiles, Private sharing and the field-level security wall for every seat|:white_check_mark: Done|:eyes: Review|To do|Not a screen|S0|Must|2/10|
|**M02-S01** Enterprise renewed and seats ordered|—|—|To do|Not a screen|S0|Must|0/3|
|**M02-S02** Lead fields, rungs and picklists per the mapping|—|:hourglass_flowing_sand: Waiting on people|To do|Not a screen|S0|Must|3/4|
|**M02-S03** Custom modules for the lead side; LLP modules adopted|—|:white_check_mark: Done|To do|Not a screen|S0|Must|1/3|
|**M02-S05** Restricted test user and T11|—|:hourglass_flowing_sand: Waiting on people|To do|Not a screen|S0|Must|1/3|
|**M02-S06** Native Lead conversion stopped|—|—|To do|Not a screen|S0|Must|0/2|
|**M02-S07** Calls, Meetings and Tasks visible to the seats that schedule, with meetings in Zoho Calendar|—|—|To do|Not a screen|S0|Should|0/2|
|**M02-S08** Email sent from the person's own mailbox|—|:hourglass_flowing_sand: Waiting on people|To do|Not a screen|S0|Must|1/2|
|**M02-S09** Cover windows as record-level sharing|—|:hourglass_flowing_sand: Waiting on people|To do|Not a screen|S0|Must|2/3|
|**M02-S10** Sandbox and the console's OAuth client|—|:hourglass_flowing_sand: Waiting on people|To do|Not a screen|S0|Must|1/3|
|**M02-S11** Decide the canonical allotment module: LLP_UnitAllocation_Module or LLP_Unit_Allocation|—|:white_check_mark: Done|To do|Not a screen|S0|Must|3/4|
|**M02-S12** Receipts module linked to the allotment, the Contact and the LLP|—|:white_check_mark: Done|To do|Not a screen|S0|Must|3/4|
|**M02-S13** Document-slot file-upload fields on the Contact, the allotment and the LLP|—|:white_check_mark: Done|—|Not a screen|S0|Must|4/4|
|**M02-S14** Zoho Sign request id and status fields on the allotment and the Contact; Zoho Sign plan and webhooks|—|:white_check_mark: Done|—|Not a screen|S0|Must|4/4|

## M03 · Access, seats & super user

|Story|1 Front end|2 Zoho|3 Test|Screens today|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|---|
|**M03-S01** Only people with a seat or a granted page sign in|:white_check_mark: Done|To do|To do|Built (demo data)|S1|Must|1/4|
|**M03-S02** Sahil grants pages to other people, read-only by default|:white_check_mark: Done|To do|To do|Built (demo data)|S1|Must|1/3|
|**M03-S03** Extra pages for IRs, and the IR Manager's limits|—|To do|To do|Built (demo data)|S1|Must|0/2|
|**M03-S04** Grant and seat changes move the sign-in list, follow the job and are logged|:white_check_mark: Done|To do|To do|Built (demo data)|S1|Must|1/5|
|**M03-S05** Zoho users provisioned seat by seat, both sides|—|:hourglass_flowing_sand: Waiting on people|To do|Not a screen|S1|Must|1/4|
|**M03-S06** The Auditor (viewer) reads and never writes|:white_check_mark: Done|—|To do|Built (demo data)|S1|Must|1/4|
|**M03-S07** Key account managers see and work only their own accounts|—|:hourglass_flowing_sand: Waiting on people|To do|Partly built|S1|Must|1/4|
|**M03-S08** Compliance owns KYC|:white_check_mark: Done|—|To do|Built (demo data)|S1|Must|1/3|
|**M03-S09** An IR sees investor data only for investors from their own leads, enforced at the data layer|—|To do|To do|Partly built|S1|Must|0/4|

## M04 · Lead capture

|Story|1 Front end|2 Zoho|3 Test|Screens today|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|---|
|**M04-S01** Add a single lead|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|To do|Built (demo data)|S2|Must|3/4|
|**M04-S02** Duplicate mobile refused|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|To do|Built (demo data)|S2|Must|2/3|
|**M04-S03** Contact permission at capture|:white_check_mark: Done|—|To do|Built (demo data)|S2|Must|1/3|
|**M04-S04** CSV import with preview|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|To do|Built (demo data)|S2|Should|2/3|

## M05 · Today (both sides)

|Story|1 Front end|2 Zoho|3 Test|Screens today|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|---|
|**M05-S04** Call times and reschedule|—|:hourglass_flowing_sand: Waiting on people|—|Partly built|S2|Should|1/2|
|**M05-S01** My day list (Lead side)|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|To do|Built (demo data)|S2|Must|2/3|
|**M05-S02** One action per row and the focus panel|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|To do|Built (demo data)|S2|Must|2/3|
|**M05-S03** Paperwork 'your move' on Today|:white_check_mark: Done|—|To do|Built (demo data)|S2|Must|1/2|
|**M05-S06** Headline figures on Today (Investors side)|:white_check_mark: Done|To do|To do|Built (demo data)|S3|Must|1/3|
|**M05-S07** Waiting on you: the Investors-side queue per seat, including IR payment claims|:white_check_mark: Done|To do|To do|Built (demo data)|S3|Must|1/4|
|**M05-S08** Account Management's Today (Investors side)|:white_check_mark: Done|To do|To do|Built (demo data)|S2|Must|1/4|

## M06 · Leads book & lead search

|Story|1 Front end|2 Zoho|3 Test|Screens today|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|---|
|**M06-S01** Leads list with Personal and Team scope|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|To do|Built (demo data)|S2|Must|2/3|
|**M06-S02** Filters, sort and the Overdue fix|:white_check_mark: Done|—|To do|Built (demo data)|S2|Must|1/2|
|**M06-S03** Find a lead in the top bar (leads only, own book)|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|To do|Built (demo data)|S2|Must|2/3|
|**M06-S05** Search wall: the lead search never reaches investor data|—|To do|To do|Built (demo data)|S2|Must|0/3|

## M07 · Lead page

|Story|1 Front end|2 Zoho|3 Test|Screens today|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|---|
|**M07-S01** Lead page shell and Next step card|:white_check_mark: Done|—|To do|Built (demo data)|S2|Must|2/3|
|**M07-S02** Logging flow — one question at a time|:white_check_mark: Done|—|To do|Built (demo data)|S2|Must|1/2|
|**M07-S03** Save on the last tap, recorded once, with 10-second Undo|—|:hourglass_flowing_sand: Waiting on people|To do|Built (demo data)|S2|Must|2/3|
|**M07-S04** Call time and Zoho activity mapping|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|To do|Built (demo data)|S2|Must|2/3|
|**M07-S05** Email composer sent through Zoho send_mail|:white_check_mark: Done|To do|To do|Built (demo data)|S2|Must|1/3|
|**M07-S06** Close as lost in one step, undo and re-open|—|:hourglass_flowing_sand: Waiting on people|To do|Partly built|S2|Must|1/2|
|**M07-S07** Latest note, all notes and inline note|:white_check_mark: Done|—|To do|Built (demo data)|S2|Should|1/2|

## M08 · Journey, gates & hand-offs between the sides

|Story|1 Front end|2 Zoho|3 Test|Screens today|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|---|
|**M08-S01** Journey bar, ticks, un-tick and skip|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|To do|Built (demo data)|S3|Must|2/3|
|**M08-S02** Finance gates read live from Zoho|—|To do|To do|Built (demo data)|S3|Must|0/2|
|**M08-S03** Money in: the IR reports a payment, Finance records the receipt|:white_check_mark: Done|To do|To do|Built (demo data)|S3|Must|2/7|
|**M08-S04** Reservation hold: clock, balance due, extend and release|:white_check_mark: Done|To do|To do|Built (demo data)|S3|Must|3/7|
|**M08-S05** Owners and cover (D44)|—|To do|To do|Partly built|S3|Must|0/2|
|**M08-S07** 'Said yes' becomes the investor record|:white_check_mark: Done|To do|To do|Built (demo data)|S3|Must|1/4|
|**M08-S08** The first matched advance opens the investor app account|:white_check_mark: Done|To do|To do|Built (demo data)|S3|Must|1/4|

## M09 · Investors & the investor record

|Story|1 Front end|2 Zoho|3 Test|Screens today|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|---|
|**M09-S01** Investors list for Finance|:white_check_mark: Done|To do|To do|Built (demo data)|S2|Must|1/3|
|**M09-S02** KAM book and Head of AM book|:white_check_mark: Done|To do|To do|Built (demo data)|S2|Must|1/4|
|**M09-S03** The investor record — header, banners and sections by seat|:white_check_mark: Done|To do|To do|Built (demo data)|S2|Must|1/4|
|**M09-S04** Who looks after the account — KAM ownership|:white_check_mark: Done|To do|To do|Built (demo data)|S2|Must|1/4|
|**M09-S07** Investor search on the Investors page|:white_check_mark: Done|To do|To do|Built (demo data)|S2|Must|1/3|
|**M09-S08** An IR sees only investors from their own leads|:white_check_mark: Done|To do|To do|Built (demo data)|S2|Must|1/4|
|**M09-S09** Add an investor who has already paid, straight from the console|:white_check_mark: Done|To do|To do|Built (demo data)|S2|Must|1/3|

## M10 · Payments & receipts

|Story|1 Front end|2 Zoho|3 Test|Screens today|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|---|
|**M10-S01** Payments register|:white_check_mark: Done|To do|To do|Built (demo data)|S3|Must|1/5|
|**M10-S02** Match a receipt — the second hand|:white_check_mark: Done|To do|To do|Built (demo data)|S3|Must|1/5|
|**M10-S03** Answer an IR's payment report|:white_check_mark: Done|To do|To do|Built (demo data)|S3|Must|1/3|
|**M10-S05** Weekly bank statement upload and reconciliation|:white_check_mark: Done|To do|To do|Built (demo data)|S3|Must|1/6|
|**M10-S07** Receipts belong to the allotment (investor × farm)|:white_check_mark: Done|To do|To do|Built (demo data)|S3|Must|1/4|
|**M10-S08** Per-farm payment view for an investor with several allotments|:white_check_mark: Done|To do|To do|Built (demo data)|S3|Should|1/3|
|**M10-S09** ARL holdings and transactions — read-only panel|:white_check_mark: Done|To do|To do|Built (demo data)|S3|Should|1/3|
|**M10-S20** Monthly payouts: 60-month schedule per allotment, Finance due queue|:white_check_mark: Done|To do|To do|Built (demo data)|S3|Must|1/3|
|**M10-S21** Unlock the investor app and send the welcome from the console|:white_check_mark: Done|To do|To do|Built (demo data)|S3|Must|1/3|
|**M10-S22** Preview the investor's app screens (mock-up with their data)|:white_check_mark: Done|To do|To do|Built (demo data)|S4|Should|1/3|
|**M10-S23** Test sign-in link to check the real app on another device|:white_check_mark: Done|To do|To do|Built (demo data)|S4|Should|1/3|

## M11 · Farms (the LLP shelf) & allotments

|Story|1 Front end|2 Zoho|3 Test|Screens today|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|---|
|**M11-S01** Farms are the LLP shelf|:white_check_mark: Done|To do|To do|Built (demo data)|S3|Must|1/4|
|**M11-S02** An allotment links an investor to a farm LLP|:white_check_mark: Done|To do|To do|Built (demo data)|S3|Must|1/4|
|**M11-S03** The shelf — released, held and free per farm LLP|:white_check_mark: Done|To do|To do|Built (demo data)|S3|Must|1/4|
|**M11-S04** Release a farm LLP's units or take them back|:white_check_mark: Done|To do|To do|Built (demo data)|S3|Must|1/3|
|**M11-S05** Allotment on the verified allocation letter|:white_check_mark: Done|To do|To do|Built (demo data)|S3|Must|1/6|
|**M11-S07** No unit is sold twice — the oversell guard|:white_check_mark: Done|To do|To do|Built (demo data)|S3|Must|1/4|

## M12 · Documents, upload & Zoho Sign

|Story|1 Front end|2 Zoho|3 Test|Screens today|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|---|
|**M12-S01** Documents in three scopes, with who sees what|—|To do|To do|Partly built|S3|Must|0/4|
|**M12-S02** Upload a document straight from the console to Zoho|:white_check_mark: Done|To do|To do|Built (demo data)|S3|Must|1/4|
|**M12-S03** Documents page: out for signature and on file, scoped to the seat|:white_check_mark: Done|To do|To do|Built (demo data)|S3|Must|1/4|
|**M12-S04** Send a document for signature through Zoho Sign|:white_check_mark: Done|To do|To do|Built (demo data)|S3|Must|1/6|
|**M12-S05** Live signature status from Zoho Sign webhooks, with reminders and recall|:white_check_mark: Done|To do|To do|Built (demo data)|S3|Must|1/4|
|**M12-S06** Signed PDF filed to the allotment and Agreement_Signed set|:white_check_mark: Done|To do|To do|Built (demo data)|S3|Must|1/4|
|**M12-S07** Block or supersede a document|:white_check_mark: Done|To do|To do|Built (demo data)|S3|Must|1/3|
|**M12-S08** The investor signs by email or inside the investor app|—|To do|To do|Partly built|S3|Should|0/3|
|**M12-S09** See a record's emails in the console|:white_check_mark: Done|To do|To do|Built (demo data)|S3|Should|1/3|
|**M12-S10** Isolation suite: no user sees another user's leads, investors, documents, sign requests, emails or tickets|—|—|To do|Partly built|S3|Must|0/8|
|**M12-S11** NDA loop on the lead page, and the IR's word beside Finance's queue|:white_check_mark: Done|To do|To do|Built (demo data)|S3|Must|1/5|
|**M12-S12** Supplementary agreement draft loop|:white_check_mark: Done|To do|To do|Built (demo data)|S3|Must|1/3|
|**M12-S13** Material follows the NDA; deck email marks the deck sent|:white_check_mark: Done|To do|To do|Built (demo data)|S3|Must|1/3|
|**M12-S14** 'Your move' on Today and Documents|:white_check_mark: Done|—|To do|Built (demo data)|S3|Should|1/2|

## M13 · Tickets & investor updates (pushed to the investor app)

|Story|1 Front end|2 Zoho|3 Test|Screens today|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|---|
|**M13-S01** Push to the investor app through the signed contracts, with a stub receiver|—|To do|To do|Partly built|S4|Must|0/4|
|**M13-S02** Tickets register scoped by seat|:white_check_mark: Done|To do|To do|Built (demo data)|S4|Must|1/4|
|**M13-S03** Open, wait and close a ticket|:white_check_mark: Done|To do|To do|Built (demo data)|S4|Must|1/4|
|**M13-S04** A KAM hands a bank or compliance ticket to Finance and keeps watching|:white_check_mark: Done|To do|To do|Built (demo data)|S4|Must|1/4|
|**M13-S05** Investor requests arrive as tickets and replies go back to the app|:white_check_mark: Done|To do|To do|Built (demo data)|S4|Should|1/4|
|**M13-S06** Publish an investor update to a reconstructable segment|:white_check_mark: Done|To do|To do|Built (demo data)|S4|Must|1/4|

## M14 · Events

|Story|1 Front end|2 Zoho|3 Test|Screens today|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|---|
|**M14-S01** Events list and event page|:white_check_mark: Done|To do|To do|Built (demo data)|S3|Must|1/4|
|**M14-S02** Add, correct and remove an event|:white_check_mark: Done|To do|To do|Built (demo data)|S3|Must|1/3|
|**M14-S03** Capture and sheet load tie leads to the event|:white_check_mark: Done|To do|To do|Built (demo data)|S3|Must|1/3|

## M15 · Updates & Activity

|Story|1 Front end|2 Zoho|3 Test|Screens today|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|---|
|**M15-S01** Updates: what others changed on my book|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|To do|Built (demo data)|S4|Must|2/3|
|**M15-S03** Activity page: who did what, each seat its own scope, Lead side / Investors side|:white_check_mark: Done|To do|To do|Built (demo data)|S4|Must|2/8|
|**M15-S05** Console logs for refusals, reveals and API headroom (Planes B and C), filterable|:white_check_mark: Done|To do|To do|Built (demo data)|S4|Must|1/4|

## M16 · Numbers, Plan & Transfers

|Story|1 Front end|2 Zoho|3 Test|Screens today|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|---|
|**M16-S01** Assignments by IR report|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|To do|Built (demo data)|S4|Must|2/3|
|**M16-S02** Open one IR's row and list the leads behind a count|:white_check_mark: Done|—|To do|Built (demo data)|S4|Should|1/2|
|**M16-S03** Lead-side Numbers sections computed live, one scope at a time|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|To do|Built (demo data)|S4|Must|2/3|
|**M16-S04** Read the plan|—|:hourglass_flowing_sand: Waiting on people|To do|Partly built|S4|Must|1/2|
|**M16-S06** Transfers per month: leads that became investors|:white_check_mark: Done|:hourglass_flowing_sand: Waiting on people|To do|Built (demo data)|S4|Must|2/3|
|**M16-S07** Open a month to its investors|:white_check_mark: Done|—|To do|Built (demo data)|S4|Should|1/2|
|**M16-S08** Investors side of Numbers: collection, paper and compliance|:white_check_mark: Done|To do|To do|Built (demo data)|S4|Should|1/3|
|**M16-S09** Money figures only to seats that may see them|—|To do|To do|Partly built|S4|Must|0/2|

## M17 · Teams, Profile & System

|Story|1 Front end|2 Zoho|3 Test|Screens today|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|---|
|**M17-S01** Teams: members, seats and what each seat may do, from Zoho|:white_check_mark: Done|To do|To do|Built (demo data)|S4|Must|2/4|
|**M17-S02** Grant pages and change seats|—|To do|To do|Built (demo data)|S4|Must|0/2|
|**M17-S05** My profile|—|:hourglass_flowing_sand: Waiting on people|To do|Built (demo data)|S4|Must|1/2|
|**M17-S06** System health and administration|—|:hourglass_flowing_sand: Waiting on people|To do|Partly built|S4|Must|1/2|

## M18 · Hardening, security & release

|Story|1 Front end|2 Zoho|3 Test|Screens today|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|---|
|**M18-S01** The app stays fast inside Zoho's API limits|—|To do|To do|Not a screen|S5|Must|0/6|
|**M18-S02** Nothing leaks outside a seat's scope: seat x page x action x field matrix|—|To do|To do|Not a screen|S5|Must|0/6|
|**M18-S03** Every page works on a phone and by keyboard|:white_check_mark: Done|—|To do|Not a screen|S5|Must|2/4|
|**M18-S04** Errors are captured, visible and alerted|—|To do|To do|Not a screen|S5|Must|0/3|
|**M18-S05** Data and logs are backed up and restorable|—|—|To do|Not a screen|S5|Must|0/3|
|**M18-S06** Legacy records carried across without new Deals|—|—|To do|Not a screen|S5|Must|0/3|
|**M18-S08** Exploratory sessions and UAT signed off on both sides|—|To do|To do|Not a screen|S5|Must|0/9|
|**M18-S09** Go-live by checklist with a runbook and a rehearsed rollback|—|—|To do|Not a screen|S5|Must|0/6|
|**M18-S10** Runbook and hypercare|—|—|To do|Not a screen|S5|Should|0/3|
|**M18-S12** Move the org's old payment columns into Receipts on the allotment|—|To do|To do|Partly built|S5|Must|0/3|

## M19 · Quality — Jev UI suite

|Story|1 Front end|2 Zoho|3 Test|Screens today|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|---|
|**M19-S01** UI test contract|:white_check_mark: Done|—|To do|Not a screen|S1|Must|1/3|
|**M19-S02** Jev UI runner on staging|—|To do|To do|Not a screen|S1|Must|0/5|
|**M19-S03** Zoho sandbox seed and reset|:white_check_mark: Done|:white_check_mark: Done|To do|Not a screen|S1|Must|2/3|
|**M19-S04** Judge calibration gate|—|To do|—|Not a screen|S1|Must|0/1|
|**M19-S05** CI pipeline|—|To do|—|Not a screen|S1|Must|0/1|
|**M19-S06** Unit tests for business rules|—|To do|—|Not a screen|S1|Must|0/1|
|**M19-S07** Smoke suite and production check|—|—|To do|Not a screen|S5|Should|0/2|
|**M19-S08** Flaky tests and re-baselining|—|—|To do|Not a screen|S3|Should|0/1|
|**M19-S10** Map the two old suites onto the merged console and retire dead cases|—|—|To do|Not a screen|S2|Must|0/2|
|**M19-S11** Regenerate the Jev UI cases against the merged console: super user and per seat|—|—|To do|Not a screen|S2|Must|0/4|

## M20 · Launch readiness & operations

|Story|1 Front end|2 Zoho|3 Test|Screens today|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|---|
|**M20-S01** Product brief and KPIs|—|—|To do|Not a screen|S0|Must|0/1|
|**M20-S03** Training and quick guides|—|—|To do|Not a screen|S5|Must|0/2|
|**M20-S04** Support model and issue intake|—|—|To do|Not a screen|S5|Must|0/1|
|**M20-S05** Stage reviews, status and retrospectives|—|—|To do|Not a screen|S0|Must|0/6|
|**M20-S06** Change control|—|—|To do|Not a screen|S0|Must|0/1|
|**M20-S07** Bring the investor app codebase into the repo and wire the contract receivers|—|:hourglass_flowing_sand: Waiting on people|To do|Partly built|S4|Must|4/5|
|**M20-S08** Buy the Zoho Sign plan and set up its webhooks|—|:hourglass_flowing_sand: Waiting on people|To do|Not a screen|S0|Must|1/4|
