::: {.callout}
**Updated 27 Sep 2026 16:13 IST** from the build itself (autopilot progress). Statuses are not edited here; comment on a row instead.
:::

# :bar_chart: Summary

|Stories in build|Done|Building|Review|Waiting on people|To do|
|---|---|---|---|---|---|
|151|6|0|1|6|138|

# :compass: Goal and forecast

**Goal:** the whole Growize Console (lead side and Investors side, one app on Zoho) built by ![](slack_date:2026-10-03), then tested and hardened, and live when the go-live checks pass.

|Measure|Value|
|---|---|
|Status|:red_circle: Behind|
|Built so far|6 of 151 stories (4%)|
|Pace now|7 stories/day (measured (last 48 h))|
|Pace needed for the target|21.8 stories/day|
|Build target|![](slack_date:2026-10-03)|
|Forecast: everything built|![](slack_date:2026-10-17)|
|Forecast: testing finished (earliest go-live)|![](slack_date:2026-10-23)|

Dates are forecasts from the measured pace, not fixed deadlines (D66). They move every time the build finishes a story.

## Stages

|Stage|What it delivers|Stories|Done|Forecast done|
|---|---|---|---|---|
|S0|Zoho org build-out and access wall|18|5|![](slack_date:2026-09-29)|
|S1|Foundations, access, test suite|23|1|![](slack_date:2026-10-01)|
|S2|Lead side daily work and Investors pages|30|0|![](slack_date:2026-10-16)|
|S3|Journey, gates, money, paper, Zoho Sign, farms|43|0|![](slack_date:2026-10-17)|
|S4|Updates, tickets, app push, activity, numbers, teams|24|0|![](slack_date:2026-10-17)|
|S5|Hardening, UAT, migration, release|13|0|![](slack_date:2026-10-16)|

# :calendar: Month by month

|Month|Stories finished|Forecast to finish|Cumulative forecast|
|---|---|---|---|
|September 2026|6|30|36 of 151|
|October 2026|0|115|151 of 151|

# :spiral_calendar_pad: Week by week

|Week of|Finished|Forecast|Cumulative|Burn-up|
|---|---|---|---|---|
|![](slack_date:2026-09-21) **(this week)**|6|9|15|:large_green_square::white_large_square::white_large_square::white_large_square::white_large_square::white_large_square::white_large_square::white_large_square::white_large_square::white_large_square: 10%|
|![](slack_date:2026-09-28)|0|49|64|:large_green_square::large_green_square::large_green_square::large_green_square::white_large_square::white_large_square::white_large_square::white_large_square::white_large_square::white_large_square: 42%|
|![](slack_date:2026-10-05)|0|49|113|:large_green_square::large_green_square::large_green_square::large_green_square::large_green_square::large_green_square::large_green_square::white_large_square::white_large_square::white_large_square: 75%|
|![](slack_date:2026-10-12)|0|38|151|:large_green_square::large_green_square::large_green_square::large_green_square::large_green_square::large_green_square::large_green_square::large_green_square::large_green_square::large_green_square: 100%|

## This week

**Finished (6):** M02-S03, M02-S11, M02-S12, M02-S13, M02-S14, M19-S03

**Planned by the forecast (9):** M02-S01, M02-S02, M02-S04, M02-S06, M02-S05, M02-S08, M02-S09, M03-S01, M19-S01

**Stuck: review or waiting on people (7):**

- **M02-S01** Enterprise renewed and seats ordered (waiting)
- **M02-S02** Lead fields, rungs and picklists per the mapping (waiting)
- **M02-S04** Roles, profiles, Private sharing and the field-level security wall for every seat (review)
- **M02-S05** Restricted test user and T11 (waiting)
- **M02-S06** Native Lead conversion stopped (waiting)
- **M02-S08** Email sent from the person's own mailbox (waiting)
- **M02-S09** Cover windows as record-level sharing (waiting)

# :mag: Where the build really is (audit 27 Sep)

|Layer|State|
|---|---|
|Front end (screens)|25 stories built, 65 partly, 19 not started, 42 have no screen|
|Lead side screens|Ported from the IR console prototype: Today, Leads, Lead page, Add/CSV, Events, Plan, Numbers, Activity, Teams, System, Profile, Updates, Payments (IR claims), Documents (paperwork), Transfers|
|Investors side screens|Not started: Investors list and record, Farms and allotments, Tickets, Investor updates, Finance receipts and matching, payouts, app access|
|Connected to Zoho|No screen reads or writes Zoho yet; every page runs on demo data (the Zoho adapter is a stub)|
|Zoho org|Modules and fields in place (M02 done items); still open: profiles per seat, field-level security (PAN not encrypted, only Administrator and Standard profiles exist), sharing rules, test user, sandbox and OAuth client|
|Tested by Jev|No story has passed Jev's screen tests yet|

# :dart: Epics

|Epic|Stage|Stories|Done|Progress|Goal|
|---|---|---|---|---|---|
|**M01** Foundations & the one app shell|S1|10|0|:white_large_square::white_large_square::white_large_square::white_large_square::white_large_square: 0%|One Next.js + TypeScript app, one sign-in, one rail built from the seat, live Zoho reads through one client with scope-keyed cache, honest s|
|**M02** Zoho org build-out|S0|14|5|:large_green_square::white_large_square::white_large_square::white_large_square::white_large_square: 36%|The one Enterprise org ready for both sides before any second seat: fields, modules, the FLS wall, Receipts, document slots, Zoho Sign field|
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
|**M19** Quality — Jev UI suite|S1|10|1|:white_large_square::white_large_square::white_large_square::white_large_square::white_large_square: 10%|A Jev UI suite that runs the same plain-language cases against the merged prototype (growize-console-merged.html) and the built app, per sea|
|**M20** Launch readiness & operations|S0|7|0|:white_large_square::white_large_square::white_large_square::white_large_square::white_large_square: 0%|The brief, KPIs, status rhythm and change control that keep the plan honest, the guides and support model for go-live, and the two outside p|

# :hammer_and_wrench: People's to-do (from the build)

- [ ] M02-S01-T01 (M02-S01, Sahil, Before its story (do early)) Renew Enterprise and buy the test-user seat — Renew the Enterprise subscription (annual) before 13 Oct; add one user licence for the restricted test user; save the invoice reference in the ops notes.
- [ ] M02-S04-T02 (M02-S04, Sahil, Before its story (do early)) Profiles per seat — One profile per seat of both sides, module permissions per SEATCAPS (no Convert/Export/Mass delete for IR); API access on (T7); Sahil's profile with every module but identity fields hidden (D68).
- [ ] M02-S04-T03 (M02-S04, Sahil, Before its story (do early)) Field-level security wall — Encrypt pan and bank_account on Contacts; pan readable by Head of Finance and Compliance, bank by Head of Finance and Finance; hide pan, bank, Aadhaar_Number, UTR_n, DOB everywhere else; aadhaar_last4/aadhaar_ref o
- [ ] M02-S04-T04 (M02-S04, Sahil, Before its story (do early)) Private sharing and B-12 rules — Default sharing Private on Leads, Contacts and custom modules; IR Manager read on IR subtree via hierarchy; Finance → Leads sharing rule for gate columns (B-12); document the answer.
- [ ] M02-S06-T01 (M02-S06, Sahil, Before its story (do early)) Remove Convert permission — Untick Convert Leads on every profile; confirm no workflow converts.

# :clipboard: Stories

## M01 · Foundations & the one app shell

|Story|Build status|Front end|On live Zoho|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|
|**M01-S01** One Next.js shell with the rail built from the person's seat|To do|Partly built|No|S1|Must|0/9|
|**M01-S02** Sign in with my own Zoho account; signing out or changing person clears everything|To do|Partly built|No|S1|Must|0/5|
|**M01-S03** Live reads and writes through one Zoho client, gate and scope-keyed cache|To do|Partly built|No|S1|Must|0/7|
|**M01-S04** Operations and identity logs|To do|Not a screen|No|S1|Must|0/2|
|**M01-S05** Staging and production environments|To do|Not a screen|No|S1|Must|0/2|
|**M01-S06** Pending saves while offline|To do|Built (demo data)|No|S2|Must|0/2|
|**M01-S07** Refusals and confirmations said in the page, never in alert() or confirm()|To do|Partly built|No|S1|Must|0/6|
|**M01-S08** Every write goes through commit(): one press, one record, 'Not saved yet' when it cannot land|To do|Partly built|No|S1|Must|0/6|
|**M01-S09** Honest connection and freshness line in the top bar|To do|Partly built|No|S1|Must|0/3|
|**M01-S10** Step-up before a reveal, an export or money leaving, with a second hand on refunds|To do|Partly built|No|S3|Must|0/9|

## M02 · Zoho org build-out

|Story|Build status|Front end|On live Zoho|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|
|**M02-S04** Roles, profiles, Private sharing and the field-level security wall for every seat|Review|Not a screen|No|S0|Must|0/10|
|**M02-S01** Enterprise renewed and seats ordered|Waiting on people|Not a screen|No|S0|Must|2/3|
|**M02-S02** Lead fields, rungs and picklists per the mapping|Waiting on people|Not a screen|No|S0|Must|3/4|
|**M02-S05** Restricted test user and T11|Waiting on people|Not a screen|No|S0|Must|3/3|
|**M02-S06** Native Lead conversion stopped|Waiting on people|Not a screen|No|S0|Must|1/2|
|**M02-S08** Email sent from the person's own mailbox|Waiting on people|Not a screen|No|S0|Must|2/2|
|**M02-S09** Cover windows as record-level sharing|Waiting on people|Not a screen|No|S0|Must|3/3|
|**M02-S07** Calls, Meetings and Tasks visible to the seats that schedule, with meetings in Zoho Calendar|To do|Not a screen|No|S0|Should|0/2|
|**M02-S10** Sandbox and the console's OAuth client|To do|Not a screen|No|S0|Must|0/3|
|**M02-S03** Custom modules for the lead side; LLP modules adopted|Done|Not a screen|Yes|S0|Must|3/3|
|**M02-S11** Decide the canonical allotment module: LLP_UnitAllocation_Module or LLP_Unit_Allocation|Done|Not a screen|Yes|S0|Must|4/4|
|**M02-S12** Receipts module linked to the allotment, the Contact and the LLP|Done|Not a screen|Yes|S0|Must|4/4|
|**M02-S13** Document-slot file-upload fields on the Contact, the allotment and the LLP|Done|Not a screen|Yes|S0|Must|4/4|
|**M02-S14** Zoho Sign request id and status fields on the allotment and the Contact; Zoho Sign plan and webhooks|Done|Not a screen|Yes|S0|Must|4/4|

## M03 · Access, seats & super user

|Story|Build status|Front end|On live Zoho|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|
|**M03-S01** Only people with a seat or a granted page sign in|To do|Built (demo data)|No|S1|Must|0/3|
|**M03-S02** Sahil grants pages to other people, read-only by default|To do|Built (demo data)|No|S1|Must|0/3|
|**M03-S03** Extra pages for IRs, and the IR Manager's limits|To do|Built (demo data)|No|S1|Must|0/2|
|**M03-S04** Grant and seat changes move the sign-in list, follow the job and are logged|To do|Partly built|No|S1|Must|0/5|
|**M03-S05** Zoho users provisioned seat by seat, both sides|To do|Not a screen|No|S1|Must|0/4|
|**M03-S06** The Auditor (viewer) reads and never writes|To do|Partly built|No|S1|Must|0/4|
|**M03-S07** Key account managers see and work only their own accounts|To do|Partly built|No|S1|Must|0/4|
|**M03-S08** Compliance owns KYC|To do|Partly built|No|S1|Must|0/3|
|**M03-S09** An IR sees investor data only for investors from their own leads, enforced at the data layer|To do|Partly built|No|S1|Must|0/4|

## M04 · Lead capture

|Story|Build status|Front end|On live Zoho|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|
|**M04-S01** Add a single lead|To do|Built (demo data)|No|S2|Must|0/4|
|**M04-S02** Duplicate mobile refused|To do|Built (demo data)|No|S2|Must|0/3|
|**M04-S03** Contact permission at capture|To do|Built (demo data)|No|S2|Must|0/3|
|**M04-S04** CSV import with preview|To do|Built (demo data)|No|S2|Should|0/3|

## M05 · Today (both sides)

|Story|Build status|Front end|On live Zoho|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|
|**M05-S01** My day list (Lead side)|To do|Built (demo data)|No|S2|Must|0/3|
|**M05-S02** One action per row and the focus panel|To do|Built (demo data)|No|S2|Must|0/3|
|**M05-S03** Paperwork 'your move' on Today|To do|Built (demo data)|No|S2|Must|0/2|
|**M05-S04** Call times and reschedule|To do|Partly built|No|S2|Should|0/2|
|**M05-S06** Headline figures on Today (Investors side)|To do|Partly built|No|S3|Must|0/3|
|**M05-S07** Waiting on you: the Investors-side queue per seat, including IR payment claims|To do|Partly built|No|S3|Must|0/4|
|**M05-S08** Account Management's Today (Investors side)|To do|Partly built|No|S2|Must|0/4|

## M06 · Leads book & lead search

|Story|Build status|Front end|On live Zoho|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|
|**M06-S01** Leads list with Personal and Team scope|To do|Built (demo data)|No|S2|Must|0/3|
|**M06-S02** Filters, sort and the Overdue fix|To do|Built (demo data)|No|S2|Must|0/2|
|**M06-S03** Find a lead in the top bar (leads only, own book)|To do|Partly built|No|S2|Must|0/3|
|**M06-S05** Search wall: the lead search never reaches investor data|To do|Built (demo data)|No|S2|Must|0/3|

## M07 · Lead page

|Story|Build status|Front end|On live Zoho|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|
|**M07-S01** Lead page shell and Next step card|To do|Built (demo data)|No|S2|Must|0/3|
|**M07-S02** Logging flow — one question at a time|To do|Partly built|No|S2|Must|0/2|
|**M07-S03** Save on the last tap, recorded once, with 10-second Undo|To do|Built (demo data)|No|S2|Must|0/3|
|**M07-S04** Call time and Zoho activity mapping|To do|Partly built|No|S2|Must|0/3|
|**M07-S05** Email composer sent through Zoho send_mail|To do|Partly built|No|S2|Must|0/3|
|**M07-S06** Close as lost in one step, undo and re-open|To do|Partly built|No|S2|Must|0/2|
|**M07-S07** Latest note, all notes and inline note|To do|Partly built|No|S2|Should|0/2|

## M08 · Journey, gates & hand-offs between the sides

|Story|Build status|Front end|On live Zoho|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|
|**M08-S01** Journey bar, ticks, un-tick and skip|To do|Partly built|No|S3|Must|0/3|
|**M08-S02** Finance gates read live from Zoho|To do|Built (demo data)|No|S3|Must|0/2|
|**M08-S03** Money in: the IR reports a payment, Finance records the receipt|To do|Partly built|No|S3|Must|0/7|
|**M08-S04** Reservation hold: clock, balance due, extend and release|To do|Partly built|No|S3|Must|0/7|
|**M08-S05** Owners and cover (D44)|To do|Partly built|No|S3|Must|0/2|
|**M08-S07** 'Said yes' becomes the investor record|To do|Partly built|No|S3|Must|0/4|
|**M08-S08** The first matched advance opens the investor app account|To do|Partly built|No|S3|Must|0/4|

## M09 · Investors & the investor record

|Story|Build status|Front end|On live Zoho|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|
|**M09-S01** Investors list for Finance|To do|Not started|No|S2|Must|0/3|
|**M09-S02** KAM book and Head of AM book|To do|Not started|No|S2|Must|0/4|
|**M09-S03** The investor record — header, banners and sections by seat|To do|Not started|No|S2|Must|0/4|
|**M09-S04** Who looks after the account — KAM ownership|To do|Not started|No|S2|Must|0/4|
|**M09-S07** Investor search on the Investors page|To do|Not started|No|S2|Must|0/3|
|**M09-S08** An IR sees only investors from their own leads|To do|Not started|No|S2|Must|0/4|
|**M09-S09** Add an investor who has already paid, straight from the console|To do|Not started|No|S2|Must|0/0|

## M10 · Payments & receipts

|Story|Build status|Front end|On live Zoho|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|
|**M10-S01** Payments register|To do|Partly built|No|S3|Must|0/5|
|**M10-S02** Match a receipt — the second hand|To do|Partly built|No|S3|Must|0/5|
|**M10-S03** Answer an IR's payment report|To do|Partly built|No|S3|Must|0/3|
|**M10-S05** Weekly bank statement upload and reconciliation|To do|Partly built|No|S3|Must|0/6|
|**M10-S07** Receipts belong to the allotment (investor × farm)|To do|Partly built|No|S3|Must|0/4|
|**M10-S08** Per-farm payment view for an investor with several allotments|To do|Not started|No|S3|Should|0/3|
|**M10-S09** ARL holdings and transactions — read-only panel|To do|Not started|No|S3|Should|0/3|
|**M10-S20** Monthly payouts: 60-month schedule per allotment, Finance due queue|To do|Partly built|No|S3|Must|0/0|
|**M10-S21** Unlock the investor app and send the welcome from the console|To do|Not started|No|S3|Must|0/0|
|**M10-S22** Preview the investor's app screens (mock-up with their data)|To do|Partly built|No|S4|Should|0/0|
|**M10-S23** Test sign-in link to check the real app on another device|To do|Partly built|No|S4|Should|0/0|

## M11 · Farms (the LLP shelf) & allotments

|Story|Build status|Front end|On live Zoho|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|
|**M11-S01** Farms are the LLP shelf|To do|Not started|No|S3|Must|0/4|
|**M11-S02** An allotment links an investor to a farm LLP|To do|Not started|No|S3|Must|0/4|
|**M11-S03** The shelf — released, held and free per farm LLP|To do|Not started|No|S3|Must|0/4|
|**M11-S04** Release a farm LLP's units or take them back|To do|Not started|No|S3|Must|0/3|
|**M11-S05** Allotment on the verified allocation letter|To do|Partly built|No|S3|Must|0/6|
|**M11-S07** No unit is sold twice — the oversell guard|To do|Partly built|No|S3|Must|0/4|

## M12 · Documents, upload & Zoho Sign

|Story|Build status|Front end|On live Zoho|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|
|**M12-S01** Documents in three scopes, with who sees what|To do|Partly built|No|S3|Must|0/4|
|**M12-S02** Upload a document straight from the console to Zoho|To do|Partly built|No|S3|Must|0/4|
|**M12-S03** Documents page: out for signature and on file, scoped to the seat|To do|Partly built|No|S3|Must|0/4|
|**M12-S04** Send a document for signature through Zoho Sign|To do|Partly built|No|S3|Must|0/6|
|**M12-S05** Live signature status from Zoho Sign webhooks, with reminders and recall|To do|Partly built|No|S3|Must|0/4|
|**M12-S06** Signed PDF filed to the allotment and Agreement_Signed set|To do|Partly built|No|S3|Must|0/4|
|**M12-S07** Block or supersede a document|To do|Partly built|No|S3|Must|0/3|
|**M12-S08** The investor signs by email or inside the investor app|To do|Partly built|No|S3|Should|0/3|
|**M12-S09** See a record's emails in the console|To do|Partly built|No|S3|Should|0/3|
|**M12-S10** Isolation suite: no user sees another user's leads, investors, documents, sign requests, emails or tickets|To do|Partly built|No|S3|Must|0/8|
|**M12-S11** NDA loop on the lead page, and the IR's word beside Finance's queue|To do|Partly built|No|S3|Must|0/5|
|**M12-S12** Supplementary agreement draft loop|To do|Partly built|No|S3|Must|0/3|
|**M12-S13** Material follows the NDA; deck email marks the deck sent|To do|Partly built|No|S3|Must|0/3|
|**M12-S14** 'Your move' on Today and Documents|To do|Built (demo data)|No|S3|Should|0/2|

## M13 · Tickets & investor updates (pushed to the investor app)

|Story|Build status|Front end|On live Zoho|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|
|**M13-S01** Push to the investor app through the signed contracts, with a stub receiver|To do|Partly built|No|S4|Must|0/4|
|**M13-S02** Tickets register scoped by seat|To do|Not started|No|S4|Must|0/4|
|**M13-S03** Open, wait and close a ticket|To do|Not started|No|S4|Must|0/4|
|**M13-S04** A KAM hands a bank or compliance ticket to Finance and keeps watching|To do|Not started|No|S4|Must|0/4|
|**M13-S05** Investor requests arrive as tickets and replies go back to the app|To do|Not started|No|S4|Should|0/4|
|**M13-S06** Publish an investor update to a reconstructable segment|To do|Not started|No|S4|Must|0/4|

## M14 · Events

|Story|Build status|Front end|On live Zoho|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|
|**M14-S01** Events list and event page|To do|Built (demo data)|No|S3|Must|0/4|
|**M14-S02** Add, correct and remove an event|To do|Built (demo data)|No|S3|Must|0/3|
|**M14-S03** Capture and sheet load tie leads to the event|To do|Built (demo data)|No|S3|Must|0/3|

## M15 · Updates & Activity

|Story|Build status|Front end|On live Zoho|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|
|**M15-S01** Updates: what others changed on my book|To do|Built (demo data)|No|S4|Must|0/3|
|**M15-S03** Activity page: who did what, each seat its own scope, Lead side / Investors side|To do|Partly built|No|S4|Must|0/8|
|**M15-S05** Console logs for refusals, reveals and API headroom (Planes B and C), filterable|To do|Partly built|No|S4|Must|0/4|

## M16 · Numbers, Plan & Transfers

|Story|Build status|Front end|On live Zoho|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|
|**M16-S01** Assignments by IR report|To do|Partly built|No|S4|Must|0/3|
|**M16-S02** Open one IR's row and list the leads behind a count|To do|Partly built|No|S4|Should|0/2|
|**M16-S03** Lead-side Numbers sections computed live, one scope at a time|To do|Built (demo data)|No|S4|Must|0/3|
|**M16-S04** Read the plan|To do|Partly built|No|S4|Must|0/2|
|**M16-S06** Transfers per month: leads that became investors|To do|Partly built|No|S4|Must|0/3|
|**M16-S07** Open a month to its investors|To do|Partly built|No|S4|Should|0/2|
|**M16-S08** Investors side of Numbers: collection, paper and compliance|To do|Partly built|No|S4|Should|0/3|
|**M16-S09** Money figures only to seats that may see them|To do|Partly built|No|S4|Must|0/2|

## M17 · Teams, Profile & System

|Story|Build status|Front end|On live Zoho|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|
|**M17-S01** Teams: members, seats and what each seat may do, from Zoho|To do|Partly built|No|S4|Must|0/4|
|**M17-S02** Grant pages and change seats|To do|Built (demo data)|No|S4|Must|0/2|
|**M17-S05** My profile|To do|Built (demo data)|No|S4|Must|0/2|
|**M17-S06** System health and administration|To do|Partly built|No|S4|Must|0/2|

## M18 · Hardening, security & release

|Story|Build status|Front end|On live Zoho|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|
|**M18-S01** The app stays fast inside Zoho's API limits|To do|Not a screen|No|S5|Must|0/6|
|**M18-S02** Nothing leaks outside a seat's scope: seat x page x action x field matrix|To do|Not a screen|No|S5|Must|0/6|
|**M18-S03** Every page works on a phone and by keyboard|To do|Not a screen|No|S5|Must|0/4|
|**M18-S04** Errors are captured, visible and alerted|To do|Not a screen|No|S5|Must|0/3|
|**M18-S05** Data and logs are backed up and restorable|To do|Not a screen|No|S5|Must|0/3|
|**M18-S06** Legacy records carried across without new Deals|To do|Not a screen|No|S5|Must|0/3|
|**M18-S08** Exploratory sessions and UAT signed off on both sides|To do|Not a screen|No|S5|Must|0/9|
|**M18-S09** Go-live by checklist with a runbook and a rehearsed rollback|To do|Not a screen|No|S5|Must|0/6|
|**M18-S10** Runbook and hypercare|To do|Not a screen|No|S5|Should|0/3|
|**M18-S12** Move the org's old payment columns into Receipts on the allotment|To do|Partly built|No|S5|Must|0/3|

## M19 · Quality — Jev UI suite

|Story|Build status|Front end|On live Zoho|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|
|**M19-S01** UI test contract|To do|Not a screen|No|S1|Must|0/3|
|**M19-S02** Jev UI runner on staging|To do|Not a screen|No|S1|Must|0/5|
|**M19-S04** Judge calibration gate|To do|Not a screen|No|S1|Must|0/1|
|**M19-S05** CI pipeline|To do|Not a screen|No|S1|Must|0/1|
|**M19-S06** Unit tests for business rules|To do|Not a screen|No|S1|Must|0/1|
|**M19-S07** Smoke suite and production check|To do|Not a screen|No|S5|Should|0/2|
|**M19-S08** Flaky tests and re-baselining|To do|Not a screen|No|S3|Should|0/1|
|**M19-S10** Map the two old suites onto the merged console and retire dead cases|To do|Not a screen|No|S2|Must|0/2|
|**M19-S11** Regenerate the Jev UI cases against the merged console: super user and per seat|To do|Not a screen|No|S2|Must|0/4|
|**M19-S03** Zoho sandbox seed and reset|Done|Not a screen|No|S1|Must|3/3|

## M20 · Launch readiness & operations

|Story|Build status|Front end|On live Zoho|Stage|Priority|Subtasks done|
|---|---|---|---|---|---|---|
|**M20-S01** Product brief and KPIs|To do|Not a screen|No|S0|Must|0/1|
|**M20-S03** Training and quick guides|To do|Not a screen|No|S5|Must|0/2|
|**M20-S04** Support model and issue intake|To do|Not a screen|No|S5|Must|0/1|
|**M20-S05** Stage reviews, status and retrospectives|To do|Not a screen|No|S0|Must|0/6|
|**M20-S06** Change control|To do|Not a screen|No|S0|Must|0/1|
|**M20-S07** Bring the investor app codebase into the repo and wire the contract receivers|To do|Partly built|No|S4|Must|0/5|
|**M20-S08** Buy the Zoho Sign plan and set up its webhooks|To do|Not a screen|No|S0|Must|0/4|

