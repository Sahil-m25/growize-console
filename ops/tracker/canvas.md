::: {.callout}
**Updated 27 Sep 2026 16:04 IST** from the build itself (autopilot progress). Statuses are not edited here; comment on a row instead.
:::

# :bar_chart: Summary

|Stories in build|Done|Building|Review|Waiting on people|To do|
|---|---|---|---|---|---|
|151|9|0|1|3|138|

# :compass: Goal and forecast

**Goal:** the whole Growize Console (lead side and Investors side, one app on Zoho) built by ![](slack_date:2026-10-03), then tested and hardened, and live when the go-live checks pass.

|Measure|Value|
|---|---|
|Status|:red_circle: Behind|
|Built so far|9 of 151 stories (6%)|
|Pace now|7 stories/day (measured (last 48 h))|
|Pace needed for the target|21.8 stories/day|
|Build target|![](slack_date:2026-10-03)|
|Forecast: everything built|![](slack_date:2026-10-17)|
|Forecast: testing finished (earliest go-live)|![](slack_date:2026-10-23)|

Dates are forecasts from the measured pace, not fixed deadlines (D66). They move every time the build finishes a story.

## Stages

|Stage|What it delivers|Stories|Done|Forecast done|
|---|---|---|---|---|
|S0|Zoho org build-out and access wall|18|8|![](slack_date:2026-09-29)|
|S1|Foundations, access, test suite|23|1|![](slack_date:2026-10-01)|
|S2|Lead side daily work and Investors pages|30|0|![](slack_date:2026-10-16)|
|S3|Journey, gates, money, paper, Zoho Sign, farms|43|0|![](slack_date:2026-10-17)|
|S4|Updates, tickets, app push, activity, numbers, teams|24|0|![](slack_date:2026-10-17)|
|S5|Hardening, UAT, migration, release|13|0|![](slack_date:2026-10-16)|

# :calendar: Month by month

|Month|Stories finished|Forecast to finish|Cumulative forecast|
|---|---|---|---|
|September 2026|9|27|36 of 151|
|October 2026|0|115|151 of 151|

# :spiral_calendar_pad: Week by week

|Week of|Finished|Forecast|Cumulative|Burn-up|
|---|---|---|---|---|
|![](slack_date:2026-09-21) **(this week)**|9|6|15|:large_green_square::white_large_square::white_large_square::white_large_square::white_large_square::white_large_square::white_large_square::white_large_square::white_large_square::white_large_square: 10%|
|![](slack_date:2026-09-28)|0|49|64|:large_green_square::large_green_square::large_green_square::large_green_square::white_large_square::white_large_square::white_large_square::white_large_square::white_large_square::white_large_square: 42%|
|![](slack_date:2026-10-05)|0|49|113|:large_green_square::large_green_square::large_green_square::large_green_square::large_green_square::large_green_square::large_green_square::white_large_square::white_large_square::white_large_square: 75%|
|![](slack_date:2026-10-12)|0|38|151|:large_green_square::large_green_square::large_green_square::large_green_square::large_green_square::large_green_square::large_green_square::large_green_square::large_green_square::large_green_square: 100%|

## This week

**Finished (9):** M02-S03, M02-S05, M02-S08, M02-S09, M02-S11, M02-S12, M02-S13, M02-S14, M19-S03

**Planned by the forecast (6):** M02-S01, M02-S02, M02-S04, M02-S06, M03-S01, M19-S01

**Stuck: review or waiting on people (4):**

- **M02-S01** Enterprise renewed and seats ordered (waiting)
- **M02-S02** Lead fields, rungs and picklists per the mapping (waiting)
- **M02-S04** Roles, profiles, Private sharing and the field-level security wall for every seat (review)
- **M02-S06** Native Lead conversion stopped (waiting)

# :dart: Epics

|Epic|Stage|Stories|Done|Progress|Goal|
|---|---|---|---|---|---|
|**M01** Foundations & the one app shell|S1|10|0|:white_large_square::white_large_square::white_large_square::white_large_square::white_large_square: 0%|One Next.js + TypeScript app, one sign-in, one rail built from the seat, live Zoho reads through one client with scope-keyed cache, honest s|
|**M02** Zoho org build-out|S0|14|8|:large_green_square::large_green_square::white_large_square::white_large_square::white_large_square: 57%|The one Enterprise org ready for both sides before any second seat: fields, modules, the FLS wall, Receipts, document slots, Zoho Sign field|
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

|Story|Status|Stage|Priority|Subtasks done|People steps|
|---|---|---|---|---|---|
|**M01-S01** One Next.js shell with the rail built from the person's seat|:white_circle: To do|S1|Must|0/9|1|
|**M01-S02** Sign in with my own Zoho account; signing out or changing person clears everything|:white_circle: To do|S1|Must|0/5|0|
|**M01-S03** Live reads and writes through one Zoho client, gate and scope-keyed cache|:white_circle: To do|S1|Must|0/7|0|
|**M01-S04** Operations and identity logs|:white_circle: To do|S1|Must|0/2|0|
|**M01-S05** Staging and production environments|:white_circle: To do|S1|Must|0/2|0|
|**M01-S06** Pending saves while offline|:white_circle: To do|S2|Must|0/2|0|
|**M01-S07** Refusals and confirmations said in the page, never in alert() or confirm()|:white_circle: To do|S1|Must|0/6|0|
|**M01-S08** Every write goes through commit(): one press, one record, 'Not saved yet' when it cannot land|:white_circle: To do|S1|Must|0/6|1|
|**M01-S09** Honest connection and freshness line in the top bar|:white_circle: To do|S1|Must|0/3|0|
|**M01-S10** Step-up before a reveal, an export or money leaving, with a second hand on refunds|:white_circle: To do|S3|Must|0/9|3|

## M02 · Zoho org build-out

|Story|Status|Stage|Priority|Subtasks done|People steps|
|---|---|---|---|---|---|
|**M02-S04** Roles, profiles, Private sharing and the field-level security wall for every seat|:eyes: Review|S0|Must|0/10|4|
|**M02-S01** Enterprise renewed and seats ordered|:hourglass_flowing_sand: Waiting on people|S0|Must|2/3|1|
|**M02-S02** Lead fields, rungs and picklists per the mapping|:hourglass_flowing_sand: Waiting on people|S0|Must|3/4|1|
|**M02-S06** Native Lead conversion stopped|:hourglass_flowing_sand: Waiting on people|S0|Must|1/2|1|
|**M02-S07** Calls, Meetings and Tasks visible to the seats that schedule, with meetings in Zoho Calendar|:white_circle: To do|S0|Should|0/2|1|
|**M02-S10** Sandbox and the console's OAuth client|:white_circle: To do|S0|Must|0/3|1|
|**M02-S03** Custom modules for the lead side; LLP modules adopted|:white_check_mark: Done|S0|Must|3/3|0|
|**M02-S05** Restricted test user and T11|:white_check_mark: Done|S0|Must|3/3|0|
|**M02-S08** Email sent from the person's own mailbox|:white_check_mark: Done|S0|Must|2/2|0|
|**M02-S09** Cover windows as record-level sharing|:white_check_mark: Done|S0|Must|3/3|0|
|**M02-S11** Decide the canonical allotment module: LLP_UnitAllocation_Module or LLP_Unit_Allocation|:white_check_mark: Done|S0|Must|4/4|1|
|**M02-S12** Receipts module linked to the allotment, the Contact and the LLP|:white_check_mark: Done|S0|Must|4/4|2|
|**M02-S13** Document-slot file-upload fields on the Contact, the allotment and the LLP|:white_check_mark: Done|S0|Must|4/4|2|
|**M02-S14** Zoho Sign request id and status fields on the allotment and the Contact; Zoho Sign plan and webhooks|:white_check_mark: Done|S0|Must|4/4|3|

## M03 · Access, seats & super user

|Story|Status|Stage|Priority|Subtasks done|People steps|
|---|---|---|---|---|---|
|**M03-S01** Only people with a seat or a granted page sign in|:white_circle: To do|S1|Must|0/3|0|
|**M03-S02** Sahil grants pages to other people, read-only by default|:white_circle: To do|S1|Must|0/3|0|
|**M03-S03** Extra pages for IRs, and the IR Manager's limits|:white_circle: To do|S1|Must|0/2|0|
|**M03-S04** Grant and seat changes move the sign-in list, follow the job and are logged|:white_circle: To do|S1|Must|0/5|0|
|**M03-S05** Zoho users provisioned seat by seat, both sides|:white_circle: To do|S1|Must|0/4|1|
|**M03-S06** The Auditor (viewer) reads and never writes|:white_circle: To do|S1|Must|0/4|2|
|**M03-S07** Key account managers see and work only their own accounts|:white_circle: To do|S1|Must|0/4|2|
|**M03-S08** Compliance owns KYC|:white_circle: To do|S1|Must|0/3|1|
|**M03-S09** An IR sees investor data only for investors from their own leads, enforced at the data layer|:white_circle: To do|S1|Must|0/4|1|

## M04 · Lead capture

|Story|Status|Stage|Priority|Subtasks done|People steps|
|---|---|---|---|---|---|
|**M04-S01** Add a single lead|:white_circle: To do|S2|Must|0/4|0|
|**M04-S02** Duplicate mobile refused|:white_circle: To do|S2|Must|0/3|0|
|**M04-S03** Contact permission at capture|:white_circle: To do|S2|Must|0/3|1|
|**M04-S04** CSV import with preview|:white_circle: To do|S2|Should|0/3|0|

## M05 · Today (both sides)

|Story|Status|Stage|Priority|Subtasks done|People steps|
|---|---|---|---|---|---|
|**M05-S01** My day list (Lead side)|:white_circle: To do|S2|Must|0/3|0|
|**M05-S02** One action per row and the focus panel|:white_circle: To do|S2|Must|0/3|0|
|**M05-S03** Paperwork 'your move' on Today|:white_circle: To do|S2|Must|0/2|0|
|**M05-S04** Call times and reschedule|:white_circle: To do|S2|Should|0/2|1|
|**M05-S06** Headline figures on Today (Investors side)|:white_circle: To do|S3|Must|0/3|0|
|**M05-S07** Waiting on you: the Investors-side queue per seat, including IR payment claims|:white_circle: To do|S3|Must|0/4|0|
|**M05-S08** Account Management's Today (Investors side)|:white_circle: To do|S2|Must|0/4|1|

## M06 · Leads book & lead search

|Story|Status|Stage|Priority|Subtasks done|People steps|
|---|---|---|---|---|---|
|**M06-S01** Leads list with Personal and Team scope|:white_circle: To do|S2|Must|0/3|0|
|**M06-S02** Filters, sort and the Overdue fix|:white_circle: To do|S2|Must|0/2|0|
|**M06-S03** Find a lead in the top bar (leads only, own book)|:white_circle: To do|S2|Must|0/3|0|
|**M06-S05** Search wall: the lead search never reaches investor data|:white_circle: To do|S2|Must|0/3|0|

## M07 · Lead page

|Story|Status|Stage|Priority|Subtasks done|People steps|
|---|---|---|---|---|---|
|**M07-S01** Lead page shell and Next step card|:white_circle: To do|S2|Must|0/3|0|
|**M07-S02** Logging flow — one question at a time|:white_circle: To do|S2|Must|0/2|0|
|**M07-S03** Save on the last tap, recorded once, with 10-second Undo|:white_circle: To do|S2|Must|0/3|0|
|**M07-S04** Call time and Zoho activity mapping|:white_circle: To do|S2|Must|0/3|0|
|**M07-S05** Email composer sent through Zoho send_mail|:white_circle: To do|S2|Must|0/3|0|
|**M07-S06** Close as lost in one step, undo and re-open|:white_circle: To do|S2|Must|0/2|0|
|**M07-S07** Latest note, all notes and inline note|:white_circle: To do|S2|Should|0/2|0|

## M08 · Journey, gates & hand-offs between the sides

|Story|Status|Stage|Priority|Subtasks done|People steps|
|---|---|---|---|---|---|
|**M08-S01** Journey bar, ticks, un-tick and skip|:white_circle: To do|S3|Must|0/3|0|
|**M08-S02** Finance gates read live from Zoho|:white_circle: To do|S3|Must|0/2|0|
|**M08-S03** Money in: the IR reports a payment, Finance records the receipt|:white_circle: To do|S3|Must|0/7|2|
|**M08-S04** Reservation hold: clock, balance due, extend and release|:white_circle: To do|S3|Must|0/7|1|
|**M08-S05** Owners and cover (D44)|:white_circle: To do|S3|Must|0/2|0|
|**M08-S07** 'Said yes' becomes the investor record|:white_circle: To do|S3|Must|0/4|1|
|**M08-S08** The first matched advance opens the investor app account|:white_circle: To do|S3|Must|0/4|1|

## M09 · Investors & the investor record

|Story|Status|Stage|Priority|Subtasks done|People steps|
|---|---|---|---|---|---|
|**M09-S01** Investors list for Finance|:white_circle: To do|S2|Must|0/3|0|
|**M09-S02** KAM book and Head of AM book|:white_circle: To do|S2|Must|0/4|1|
|**M09-S03** The investor record — header, banners and sections by seat|:white_circle: To do|S2|Must|0/4|1|
|**M09-S04** Who looks after the account — KAM ownership|:white_circle: To do|S2|Must|0/4|1|
|**M09-S07** Investor search on the Investors page|:white_circle: To do|S2|Must|0/3|0|
|**M09-S08** An IR sees only investors from their own leads|:white_circle: To do|S2|Must|0/4|1|
|**M09-S09** Add an investor who has already paid, straight from the console|:white_circle: To do|S2|Must|0/0|0|

## M10 · Payments & receipts

|Story|Status|Stage|Priority|Subtasks done|People steps|
|---|---|---|---|---|---|
|**M10-S01** Payments register|:white_circle: To do|S3|Must|0/5|1|
|**M10-S02** Match a receipt — the second hand|:white_circle: To do|S3|Must|0/5|1|
|**M10-S03** Answer an IR's payment report|:white_circle: To do|S3|Must|0/3|0|
|**M10-S05** Weekly bank statement upload and reconciliation|:white_circle: To do|S3|Must|0/6|2|
|**M10-S07** Receipts belong to the allotment (investor × farm)|:white_circle: To do|S3|Must|0/4|1|
|**M10-S08** Per-farm payment view for an investor with several allotments|:white_circle: To do|S3|Should|0/3|0|
|**M10-S09** ARL holdings and transactions — read-only panel|:white_circle: To do|S3|Should|0/3|0|
|**M10-S20** Monthly payouts: 60-month schedule per allotment, Finance due queue|:white_circle: To do|S3|Must|0/0|0|
|**M10-S21** Unlock the investor app and send the welcome from the console|:white_circle: To do|S3|Must|0/0|0|
|**M10-S22** Preview the investor's app screens (mock-up with their data)|:white_circle: To do|S4|Should|0/0|0|
|**M10-S23** Test sign-in link to check the real app on another device|:white_circle: To do|S4|Should|0/0|0|

## M11 · Farms (the LLP shelf) & allotments

|Story|Status|Stage|Priority|Subtasks done|People steps|
|---|---|---|---|---|---|
|**M11-S01** Farms are the LLP shelf|:white_circle: To do|S3|Must|0/4|1|
|**M11-S02** An allotment links an investor to a farm LLP|:white_circle: To do|S3|Must|0/4|1|
|**M11-S03** The shelf — released, held and free per farm LLP|:white_circle: To do|S3|Must|0/4|1|
|**M11-S04** Release a farm LLP's units or take them back|:white_circle: To do|S3|Must|0/3|0|
|**M11-S05** Allotment on the verified allocation letter|:white_circle: To do|S3|Must|0/6|2|
|**M11-S07** No unit is sold twice — the oversell guard|:white_circle: To do|S3|Must|0/4|1|

## M12 · Documents, upload & Zoho Sign

|Story|Status|Stage|Priority|Subtasks done|People steps|
|---|---|---|---|---|---|
|**M12-S01** Documents in three scopes, with who sees what|:white_circle: To do|S3|Must|0/4|1|
|**M12-S02** Upload a document straight from the console to Zoho|:white_circle: To do|S3|Must|0/4|1|
|**M12-S03** Documents page: out for signature and on file, scoped to the seat|:white_circle: To do|S3|Must|0/4|1|
|**M12-S04** Send a document for signature through Zoho Sign|:white_circle: To do|S3|Must|0/6|2|
|**M12-S05** Live signature status from Zoho Sign webhooks, with reminders and recall|:white_circle: To do|S3|Must|0/4|0|
|**M12-S06** Signed PDF filed to the allotment and Agreement_Signed set|:white_circle: To do|S3|Must|0/4|1|
|**M12-S07** Block or supersede a document|:white_circle: To do|S3|Must|0/3|0|
|**M12-S08** The investor signs by email or inside the investor app|:white_circle: To do|S3|Should|0/3|0|
|**M12-S09** See a record's emails in the console|:white_circle: To do|S3|Should|0/3|0|
|**M12-S10** Isolation suite: no user sees another user's leads, investors, documents, sign requests, emails or tickets|:white_circle: To do|S3|Must|0/8|2|
|**M12-S11** NDA loop on the lead page, and the IR's word beside Finance's queue|:white_circle: To do|S3|Must|0/5|1|
|**M12-S12** Supplementary agreement draft loop|:white_circle: To do|S3|Must|0/3|0|
|**M12-S13** Material follows the NDA; deck email marks the deck sent|:white_circle: To do|S3|Must|0/3|0|
|**M12-S14** 'Your move' on Today and Documents|:white_circle: To do|S3|Should|0/2|0|

## M13 · Tickets & investor updates (pushed to the investor app)

|Story|Status|Stage|Priority|Subtasks done|People steps|
|---|---|---|---|---|---|
|**M13-S01** Push to the investor app through the signed contracts, with a stub receiver|:white_circle: To do|S4|Must|0/4|0|
|**M13-S02** Tickets register scoped by seat|:white_circle: To do|S4|Must|0/4|1|
|**M13-S03** Open, wait and close a ticket|:white_circle: To do|S4|Must|0/4|1|
|**M13-S04** A KAM hands a bank or compliance ticket to Finance and keeps watching|:white_circle: To do|S4|Must|0/4|1|
|**M13-S05** Investor requests arrive as tickets and replies go back to the app|:white_circle: To do|S4|Should|0/4|0|
|**M13-S06** Publish an investor update to a reconstructable segment|:white_circle: To do|S4|Must|0/4|1|

## M14 · Events

|Story|Status|Stage|Priority|Subtasks done|People steps|
|---|---|---|---|---|---|
|**M14-S01** Events list and event page|:white_circle: To do|S3|Must|0/4|1|
|**M14-S02** Add, correct and remove an event|:white_circle: To do|S3|Must|0/3|0|
|**M14-S03** Capture and sheet load tie leads to the event|:white_circle: To do|S3|Must|0/3|0|

## M15 · Updates & Activity

|Story|Status|Stage|Priority|Subtasks done|People steps|
|---|---|---|---|---|---|
|**M15-S01** Updates: what others changed on my book|:white_circle: To do|S4|Must|0/3|0|
|**M15-S03** Activity page: who did what, each seat its own scope, Lead side / Investors side|:white_circle: To do|S4|Must|0/8|1|
|**M15-S05** Console logs for refusals, reveals and API headroom (Planes B and C), filterable|:white_circle: To do|S4|Must|0/4|0|

## M16 · Numbers, Plan & Transfers

|Story|Status|Stage|Priority|Subtasks done|People steps|
|---|---|---|---|---|---|
|**M16-S01** Assignments by IR report|:white_circle: To do|S4|Must|0/3|0|
|**M16-S02** Open one IR's row and list the leads behind a count|:white_circle: To do|S4|Should|0/2|0|
|**M16-S03** Lead-side Numbers sections computed live, one scope at a time|:white_circle: To do|S4|Must|0/3|0|
|**M16-S04** Read the plan|:white_circle: To do|S4|Must|0/2|0|
|**M16-S06** Transfers per month: leads that became investors|:white_circle: To do|S4|Must|0/3|0|
|**M16-S07** Open a month to its investors|:white_circle: To do|S4|Should|0/2|0|
|**M16-S08** Investors side of Numbers: collection, paper and compliance|:white_circle: To do|S4|Should|0/3|0|
|**M16-S09** Money figures only to seats that may see them|:white_circle: To do|S4|Must|0/2|0|

## M17 · Teams, Profile & System

|Story|Status|Stage|Priority|Subtasks done|People steps|
|---|---|---|---|---|---|
|**M17-S01** Teams: members, seats and what each seat may do, from Zoho|:white_circle: To do|S4|Must|0/4|0|
|**M17-S02** Grant pages and change seats|:white_circle: To do|S4|Must|0/2|0|
|**M17-S05** My profile|:white_circle: To do|S4|Must|0/2|0|
|**M17-S06** System health and administration|:white_circle: To do|S4|Must|0/2|0|

## M18 · Hardening, security & release

|Story|Status|Stage|Priority|Subtasks done|People steps|
|---|---|---|---|---|---|
|**M18-S01** The app stays fast inside Zoho's API limits|:white_circle: To do|S5|Must|0/6|1|
|**M18-S02** Nothing leaks outside a seat's scope: seat x page x action x field matrix|:white_circle: To do|S5|Must|0/6|2|
|**M18-S03** Every page works on a phone and by keyboard|:white_circle: To do|S5|Must|0/4|1|
|**M18-S04** Errors are captured, visible and alerted|:white_circle: To do|S5|Must|0/3|0|
|**M18-S05** Data and logs are backed up and restorable|:white_circle: To do|S5|Must|0/3|2|
|**M18-S06** Legacy records carried across without new Deals|:white_circle: To do|S5|Must|0/3|2|
|**M18-S08** Exploratory sessions and UAT signed off on both sides|:white_circle: To do|S5|Must|0/9|6|
|**M18-S09** Go-live by checklist with a runbook and a rehearsed rollback|:white_circle: To do|S5|Must|0/6|3|
|**M18-S10** Runbook and hypercare|:white_circle: To do|S5|Should|0/3|2|
|**M18-S12** Move the org's old payment columns into Receipts on the allotment|:white_circle: To do|S5|Must|0/3|1|

## M19 · Quality — Jev UI suite

|Story|Status|Stage|Priority|Subtasks done|People steps|
|---|---|---|---|---|---|
|**M19-S01** UI test contract|:white_circle: To do|S1|Must|0/3|0|
|**M19-S02** Jev UI runner on staging|:white_circle: To do|S1|Must|0/5|1|
|**M19-S04** Judge calibration gate|:white_circle: To do|S1|Must|0/1|0|
|**M19-S05** CI pipeline|:white_circle: To do|S1|Must|0/1|0|
|**M19-S06** Unit tests for business rules|:white_circle: To do|S1|Must|0/1|0|
|**M19-S07** Smoke suite and production check|:white_circle: To do|S5|Should|0/2|1|
|**M19-S08** Flaky tests and re-baselining|:white_circle: To do|S3|Should|0/1|0|
|**M19-S10** Map the two old suites onto the merged console and retire dead cases|:white_circle: To do|S2|Must|0/2|0|
|**M19-S11** Regenerate the Jev UI cases against the merged console: super user and per seat|:white_circle: To do|S2|Must|0/4|1|
|**M19-S03** Zoho sandbox seed and reset|:white_check_mark: Done|S1|Must|3/3|0|

## M20 · Launch readiness & operations

|Story|Status|Stage|Priority|Subtasks done|People steps|
|---|---|---|---|---|---|
|**M20-S01** Product brief and KPIs|:white_circle: To do|S0|Must|0/1|0|
|**M20-S03** Training and quick guides|:white_circle: To do|S5|Must|0/2|1|
|**M20-S04** Support model and issue intake|:white_circle: To do|S5|Must|0/1|0|
|**M20-S05** Stage reviews, status and retrospectives|:white_circle: To do|S0|Must|0/6|0|
|**M20-S06** Change control|:white_circle: To do|S0|Must|0/1|0|
|**M20-S07** Bring the investor app codebase into the repo and wire the contract receivers|:white_circle: To do|S4|Must|0/5|0|
|**M20-S08** Buy the Zoho Sign plan and set up its webhooks|:white_circle: To do|S0|Must|0/4|2|

