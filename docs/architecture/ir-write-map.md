# IR write map: wiring the local-only lead-side writes to Zoho

_6 Oct 2026. Design only: no source changed. Branch `diag-signin-reason`._

**Why.** On staging (Zoho sandbox), most IR-seat writes change only the browser reducer and are gone on reload. This breaks D45 (zero copy: Zoho is the only store) and D53 (each human writes on their own token).

**The pattern every row follows** is the one already wired for paperwork, email, cover and claim:
1. a `WriteEndpoint` in `src/lib/data/endpoints/*.ts`;
2. `useApiWrite` in `src/lib/data/api.ts` (fixture mode still runs the reducer);
3. a route under `src/app/api/...` that wraps a `server/leads/*` service.

**Rules that apply to every write.** The service re-checks the session, the seat and the book (owner, or an active `Cover_By` window; `cover.ts activeFor`). A Lead update carries `If-Unmodified-Since` = `l.mt` (the `Modified_Time` the page loaded), and a mismatch gets `409 lead-changed`. An insert (Touch, Note, Task, Lead) carries an `Idempotency-Key` (`newIdempotencyKey`, `server/state/idempotent`).

## Field sources (how "exists" was decided)

| Source | Used for |
|---|---|
| **Live read of production Leads and Touches metadata, 6 Oct 2026** (`getFields`, org 60061770791, read-only) | "exists" means exists in production |
| `zoho/access/spec.json` | profile module permissions: IR has Leads/Touches/Tasks/Calls/Notes `vce`, no Receipts, no Delete anywhere (P1); Finance has Leads `v` |
| `zoho/field-register.json`; D74/D76/D79/D82/D85/D123; `server/leads/*` field lists | where fields were planned and where the code already uses them |

**The sandbox could not be read from here.** Fields that wired code already writes on staging but that production lacks are marked **sandbox?**. These include `NDA_Told_*` and `Supp_*`, which the paperwork route uses.

### Production Leads custom fields today

Next_Step, Next_Step_At, Next_Step_Channel (WhatsApp/Email/Call/Farm visit), Forecast (Commit/Probable/Pipeline), Forecast_Paid_By, Consent_WhatsApp/Email/Call, Consent_How (Form/Verbal/Email reply/Event sheet), Consent_At, Consent_By, Lost_At, Lost_Reason (the 8), Last_Reply_At, First_Touch_At…Onboarded_At (8 stamps), Owner_Assigned_At, Secondary_Owner, Cover_By, Cover_Until, Units_Interested, Lead_Event, Preferred_Communication (Email/WhatsApp/Phone), NDA, NDA_Signed_Via, NDA_Sign_Req_Id, NDA_Verified_By, NDA_Verified_At, plus the ARL brand picklists.

### Production Touches fields today

Lead, Channel, Occurred_At, Is_Reply, Mood, Note, Name, Owner.

## Jev picks

`node jev/cli.mjs decide`, 6 Oct. Jev's policy sends every one of these to the owner (its never-list flags `access`/`money`/`fls`), so each pick below is **Jev's lean**. The `conf` column is its calibrated confidence. Picks under 0.7 are **PROVISIONAL** and need an owner ruling.

| # | Question | Pick | p | conf | Status |
|---|---|---|---|---|---|
| J1 | Where the IR's payment report lives (no Receipts) | a: a Task to Finance, plus Lead status fields split by writer | 0.73 | 0.46 | **PROVISIONAL** (money) |
| J2 | How Finance reaches the Lead it answers | a: a Leads sharing rule to the two Finance roles, FLS read-only except Finance's fields | 0.79 | 0.58 | **PROVISIONAL** |
| J3 | Call outcome and objections | a: on the call's Touch (new Outcome and Objections fields) | 0.91 | 0.82 | lean accepted |
| J4 | Forecast evidence | b: a Zoho Note on the Lead | 0.65 | 0.30 | **PROVISIONAL** |
| J5 | Material sent | a: one `*_Sent_At` Lead field per item | 0.51 | 0.03 | **PROVISIONAL** (coin flip) |
| J6 | Produce pack | a: `Produce_Pack_Week` and `Produce_Pack_At` on the Lead | 0.94 | 0.87 | lean accepted |
| J7 | Ask to reassign (askMove) | b: `Move_Request_*` Lead fields | 0.72 | 0.45 | **PROVISIONAL** |
| J8 | Ask for a hold extension (askExt) | a: a Task to the Head of Finance on the Lead | 0.75 | 0.49 | **PROVISIONAL** |
| J9 | Flag a duplicate | a: a Task to the manager, not linked to the lead, mobile shown as last four only | 0.84 | 0.69 | **PROVISIONAL** (0.69) |
| J10 | Permission and profile history | a: Zoho field history (Plane A) | 1.00 | 0.99 | lean accepted |
| J11 | Contact preference and introducer | a: new Lead fields `Contact_Preference` (text) and `Introduced_By` (user) | 0.71 | 0.42 | **PROVISIONAL** |
| J12 | Remove a touch | a: a `Touches.Voided_At` field, no delete | 0.98 | 0.96 | lean accepted |
| J13 | What clearNext does to the open activity | b: clear the Lead fields only and leave the activity | 0.55 | 0.10 | **PROVISIONAL**. Caution: this leaves an orphan call reminder; the alternative was to defer the Task and cancel the Call |
| J14 | Activity CSV export | a: a route on the person's own token plus a Plane C line | 0.99 | 0.98 | lean accepted |
| J15 | Badge colour and initials | a: the console access store (Plane C), shared | 0.90 | 0.80 | lean accepted |

## The map

Abbreviations: **M** = `Modified_Time` guard (If-Unmodified-Since); **Idem** = Idempotency-Key needed; **Book** = the lead is in the actor's book (owner, or an active cover); **Mgr** = assign capability.

### Cluster C1: contact and next step

| Action (UI) | Business meaning | Zoho target (API fields) | Exists? | Service | Route | Idem | M | Seat check |
|---|---|---|---|---|---|---|---|---|
| lpFinish (LeadPage finish flow) | One press records the contact, closes the scheduled step, and sets the next step (D57/D58) | `Touches` {Lead, Channel, Occurred_At, Is_Reply, Note}; `Tasks`/`Calls`/`Events` with What_Id=Lead (D58 `activityFor`); Leads Next_Step, Next_Step_At, Next_Step_Channel, First_Touch_At, Last_Reply_At | yes | `createFollowups.save` (exists; used only inside email) | POST `/api/leads/[id]/followup` | yes (inserts) | yes | Book + `mayRecordFollowup` |
| lpRestore (10-second Undo) | Puts back every fact the press wrote | deletes the records this save created, restores the Lead stamps | yes | `followups.undo` (signed token) | POST `/api/leads/[id]/followup` {undoToken} | token | n/a | same actor and session |
| lpLose (finish flow, "they're out") | The contact plus the loss, in one write | as lpFinish, plus Lost_At and Lost_Reason, with Next_Step* cleared | yes | `followups.save` with `lost` | same route | yes | yes | Book + canLose (no money in) |
| saveFollowup (follow-up drawers) | A full follow-up form | same as lpFinish | yes | `followups.save` | same route | yes | yes | Book |
| logTouch (Today/Leads quick log) | "I messaged/called them now"; the first one ticks First touch | `Touches` insert; Leads First_Touch_At if empty | yes | **new** `touches.record` in `server/leads/touches.ts`. followup.save refuses when no next step is set (`next-step-needed`), which logTouch must not do | POST `/api/leads/[id]/touches` | yes | yes (Lead stamp) | Book + consent for the channel (Consent_*; there is no visit consent) |
| saveTouch (touch drawer, backdated) | A past attempt or an inbound reply | `Touches` (Is_Reply for a reply); Leads Last_Reply_At or First_Touch_At (not before Created_Time) | yes | `touches.record` | same route | yes | yes | Book |
| dropTouch (touch drawer, TopBar undo) | Take back a touch logged by mistake, within 8 hours | `Touches.Voided_At` (J12); readers skip voided rows; recompute First_Touch_At/Last_Reply_At | **MISSING** Touches.Voided_At | `touches.void` | DELETE `/api/leads/[id]/touches/[touchId]` (an edit, not a delete) | no | yes (Touch Modified_Time) | the touch's creator, within the window |
| saveNext (next drawer, Today) | Set or replace the next step with no contact | Leads Next_Step, Next_Step_At, Next_Step_Channel; a D58 activity; the old open Task deferred | yes | **new** `followups.setNext` | PUT `/api/leads/[id]/next` | yes (activity insert) | yes | Book + canPlan |
| clearNext (next drawer) | No next step for now | Leads Next_Step* = null; the activity is left as is (J13, PROVISIONAL) | yes | `followups.clearNext` | DELETE `/api/leads/[id]/next` | no | yes | Book + canPlan |
| pullIn (Today, Horizon) | Bring the step forward to before the owner's leave | Leads Next_Step_At; the activity's start or due date | yes | `followups.reschedule` (exists) | POST `/api/leads/[id]/next/move` {days} | token | yes | Book + canPlan |
| moveNextTo (Today) | Move the step by n days, keeping the hour | same | yes | `followups.reschedule` | same | token | yes | same |
| closeLost (lost drawer) | Close as lost with a reason and no contact | Leads Lost_At, Lost_Reason; Next_Step* = null; the note goes to `Notes` | yes | **new** `followups.close` | POST `/api/leads/[id]/lost` | Note insert | yes | Book + canLose |
| reopenLost (lost drawer, LeadPage) | Re-open; the old close stays in the audit | Leads Lost_At/Lost_Reason = null; restores a future next step | yes | `followups.reopen` (exists) | DELETE `/api/leads/[id]/lost` | no | yes | canReopen |

### Cluster C2: ladder and the lead record

| Action (UI) | Business meaning | Zoho target | Exists? | Service | Route | Idem | M | Seat check |
|---|---|---|---|---|---|---|---|---|
| tick / tickCommit (LeadPage, Leads, WorkAction, Today, lpdrawers) | Stamp the next rung | Leads `<Rung>_At` (journey `RUNGS`); the money rungs open only on Finance's fact (gates) | yes | `createJourney.tick` (exists, unrouted) | POST `/api/leads/[id]/journey` {op:"tick"} | no (the stamp is the key) | yes | Book + stepOwner |
| recordRung (lpdrawers) | Tick Qualified with the IR's stated scorecard | Leads Qualified_At | yes | `journey.tick(…, scorecardStated=true)` | same, {scorecard:true} | no | yes | same |
| skipStage (LeadPage) | Skip Engagement (it is not a gate) | Leads Engaged_At, Engagement_Skipped | **MISSING** Leads.Engagement_Skipped (in code, not in production; sandbox?) | `journey.skip` | same, {op:"skip"} | no | yes | canEdit + stepOwner |
| untick / undoRung (Leads actions, TopBar, lpdrawers) | Take one rung back, within 8 hours, with one of 5 reasons, never once money is in | Leads `<Rung>_At` = null, Rung_Undone_At | **MISSING** Leads.Rung_Undone_At (sandbox?) | `journey.untick` | same, {op:"untick", reason} | no | yes | Book. TopBar and Leads undo must now collect a reason |
| addNote (history drawer, LeadPage) | A free note on the investor | `Notes` {Note_Title, Note_Content, Parent_Id=Lead, $se_module:"Leads"} | yes (standard) | **new** `server/leads/notes.ts` | POST `/api/leads/[id]/notes` | yes | no (insert) | Book + canNote |
| setCall (call drawer) | Outcome of the call just made | the newest call Touch by me today: `Touches.Outcome` (J3), else a new call Touch | **MISSING** Touches.Outcome (picklist: CALLOUT) | **new** `touches.callOutcome` | PATCH `/api/leads/[id]/touches/call` | yes (on create) | Touch MT | Book |
| toggleObj (call drawer) | Objections heard on that call | `Touches.Objections` (multi-select: OBJS) | **MISSING** Touches.Objections | same | same | same | Touch MT | Book |
| saveContactPermission (call drawer) | Record or withdraw per-channel permission and how it was given | Leads Consent_WhatsApp/Email/Call, Consent_How, Consent_At, Consent_By; history from field history (J10) | yes; **MISSING** Consent_Visit (proposed, `followup.ts:38`); field history must be switched on for Consent_* | **new** `server/leads/details.ts` `permission` | PUT `/api/leads/[id]/permission` | no | yes | Book |
| saveProfileDetails (call drawer) | Correct name, mobile, email, city, introducer, preference, units | Leads First_Name, Last_Name, Mobile, Email, City, Units_Interested (before Reserved), Contact_Preference, Introduced_By (J11) | standard ones yes; **MISSING** Contact_Preference, Introduced_By | `details.profile` + `createDuplicateCheck` on Mobile | PUT `/api/leads/[id]/details` | no | yes | Book |
| setFc (forecast drawer) | Forecast category | Leads Forecast (Commit/Probable/Pipeline match FCATT) | yes | **new** `server/leads/forecast.ts` | PUT `/api/leads/[id]/forecast` | no | yes | canPlan, Qualified or later |
| setFcDate / setFcBy (forecast drawer) | Expected full-payment date | Leads Forecast_Paid_By (date) | yes | same | same | no | yes | same, not paid |
| setFcEv (forecast drawer) | Why they believe it | `Notes`, titled "Forecast evidence" (J4, PROVISIONAL) | yes | same → notes.ts | same | yes (Note) | no | same |
| mat (material drawer) | Material sent, gated on NDA and consent; un-tick within the window | Leads Pitch_Deck_Sent_At, Farm_Profile_Sent_At, Yield_Note_Sent_At, Webinar_Invite_Sent_At (J5, PROVISIONAL) | **MISSING** all four (Pitch_Deck_Sent_At is only "PROPOSED" in `email.ts:77`) | **new** `server/leads/material.ts` | PUT `/api/leads/[id]/material` {item, sent} | no | yes | Book + NDA verified + consent |
| pack (material drawer) | Produce-pack week n of 4 | Leads Produce_Pack_Week (int), Produce_Pack_At (J6) | **MISSING** both | same | PUT `/api/leads/[id]/material` {pack} | no | yes | Book + consent |

### Cluster C3: intake, ownership and updates

| Action (UI) | Business meaning | Zoho target | Exists? | Service | Route | Idem | M | Seat check |
|---|---|---|---|---|---|---|---|---|
| addLead (Add page) | Capture one lead as me; owner from my seat | `Leads` insert (First/Last_Name, Mobile, Email, City, Lead_Source, Lead_Event, Units_Interested, Consent_*, Consent_How/At/By, Owner); the note goes to `Notes` | yes (Consent_How maps "WhatsApp reply" to "Email reply": a PROVISIONAL already in capture.ts) | `createLeadCapture` (exists, unrouted) | POST `/api/leads` | yes; Zoho's duplicate check on Mobile also guards | n/a | `add.capture` |
| (duplicate lookup while typing) | "Is this number already in my book?" | COQL on Leads, own token | yes | `createDuplicateCheck` (exists, unrouted) | POST `/api/leads/duplicate` (mobile in the body, never the URL) | no | n/a | `add.capture` |
| flagDupe (Add page) | Ask my manager about a number held in a book I cannot see | `Tasks` {Owner=manager, Subject "Possible duplicate at capture", Description: last four of the mobile and who offered it}, no What_Id (J9) | yes | **new** `server/leads/requests.ts` `flagDuplicate` | POST `/api/leads/flags` | yes | n/a | `add.capture`; one flag per number per actor |
| csvImport (Add bulk) | Load a file tagged to an event, with no consent, under the owner rule | `Leads` batch insert (100 per call), Lead_Event; Owner by rule | yes | `createLeadImport` (exists, unrouted) | POST `/api/leads/import` | Mobile-duplicate makes a retry safe | n/a | `add.capture`; an IR's import is always the IR's own |
| assign (owner drawer, Leads, Today, WorkAction, LeadPage) | Give an unowned lead an owner ("Assign to me" for an IR) | Leads Owner, Owner_Assigned_At | yes | `createLeadAssign` (exists, unrouted) | POST `/api/leads/[id]/assign` | no | yes | IR: self only; Mgr: assignable list |
| askMove (owner drawer) | An IR asks for a lead to move to someone else, with a reason | Leads Move_Request_To (user), Move_Request_Why (picklist REASONS), Move_Request_At (J7, PROVISIONAL); the manager's decideMove clears them | **MISSING** all three | `requests.askMove` | POST `/api/leads/[id]/move-request` | no | yes | owner of record only |
| markRead (Updates drawer and page) | Mark a group of updates as seen | Plane C SeenStore (not business data, D47) | n/a | `createUpdates.markRead` (exists, unrouted) | POST `/api/lead-updates/read` {kinds} (`/api/updates` is already the investor updates route) | no | no | self |

### Cluster C4: money-adjacent, and Me

| Action (UI) | Business meaning | Zoho target | Exists? | Service | Route | Idem | M | Seat check |
|---|---|---|---|---|---|---|---|---|
| claimPaid (finance drawer) | "The investor says they've paid": the report reaches Finance | see the claim redesign below | **MISSING** fields | `server/leads/claim.ts` rewritten | POST `/api/leads/[id]/claim` (same path) | yes (Task) | yes | Book + canClaim |
| reopenClaim (finance drawer, LeadPage, ClaimBlock) | Ask Finance to look again after "not found" | a new report: Leads Payment_Reported_At = now, plus a new Task | as above | `claims.report` | same route | yes | yes | Book + canReopenClaim |
| startPaymentReport (finance drawer) | Open a fresh draft for a second payment | **stays local**: it only opens a draft; the earlier report's answer stays in Zoho | n/a | none | none | | | |
| askExt (hold drawer) | An IR asks for more time on a reservation hold | `Tasks` {Owner=Head of Finance, What_Id=Lead, Subject "Hold extension: N days"} (J8, PROVISIONAL); Finance then uses the existing `/api/holds/[id]/extend` | yes | **new** `server/leads/hold-ask.ts` | POST `/api/leads/[id]/hold-request` | yes | no | Book + inReservation (read from Lead Reserved_At, not from the allotment's money) |
| lapse (hold drawer) | Release a run-out hold (Finance only, isFin) | LLP_UnitAllocation_Module Allocation_Status=Cancelled plus a Refund receipt | yes | `server/holds/lapse.ts` (exists) | existing POST `/api/holds/[id]/release`: wire `holdRelease` into hold.tsx | existing | existing | Finance refund right; **an IR never** |
| setMe (Me page) n, ph | My display name and mobile | Zoho Users (updateOwnUser) | yes | `createProfile` (exists, unrouted) | PATCH `/api/me` | no | no | self |
| setMe i / setMyStyle (Me page) | My initials and badge colour | console access store (Plane C) (J15) | n/a | **new** `server/people/style.ts` | PUT `/api/me/style` | no | no | self |
| log (activity CSV) | Record that I exported the activity log | Plane C line {who, when, scope, rows}, no values (J14) | n/a | **new** `server/activity/export-audit.ts` | POST `/api/activity/export` | yes | no | `activity.view` |
| setOutWhy (absence drawer) | Change the reason someone is away | **no write**: `server/roster/availability.ts` says the reason "is private and is never taken or filed" | n/a | none | none | | | Drop the control in live mode, or label it local-only |
| useTemp / dropTemp (Me page) | Switch a borrowed grant on or off for this session | **stays local** (session UI state). In live mode `server/access/policy.ts` sets `TEMP: []`, so there is nothing to switch on until grantTemp is built | n/a | none | none | | | |

**Writes that should stay local (pure UI):** startPaymentReport, useTemp/dropTemp, setOutWhy (by rule 7 and the roster's own rule), and EventEditor's echo `log` lines (the events route already wrote the fact). Take these out of `BUSINESS_WRITES` in `lib/console-save.ts` so they never queue as saves.

## Claim redesign (owner ruling, 6 Oct: keep D69, the IR never touches Receipts)

**Today.** `server/leads/claim.ts` reads the allotments and Receipts on the IR's token, then inserts a Receipts row with `Match_State=Claimed`, which returns 403. `GET /api/leads/[id]/claim` and `server/leads/gates.ts` (lines 49 and 205) also read Receipts with the IR token. That is the same breach on the read side.

**Proposed** (J1 a, J2 a; both PROVISIONAL):

1. **Report.** On the IR's token, one Lead update (M-guarded) plus one Task insert (Idem):
   - Lead update: `Leads.Payment_Reported_At` = now. The IR is the single writer of this field.
   - Task insert: `Tasks` {Owner = the Finance Ops queue user (env `GZ_FINANCE_DESK_USER`), What_Id = Lead, $se_module "Leads", Subject "Payment report: <Advance|Part|Full> ₹<amount>", Due_Date = today, Status "Not Started", Description = kind, mode, amount (whole rupees), said-on date, ref **last four only**, and the key `CLAIM-<leadId>-<n>`}.
   - Idempotency: the key in the Subject or Description, plus `createIdempotency`, so a double press finds and returns the first Task.
2. **Finance's queue.** `GET /api/claims` lists open `Tasks` owned by the Finance users whose Subject starts "Payment report". It no longer lists Receipts in Claimed.
3. **Finance answers** (`server/money/claim-answer.ts`), on Finance's token:
   - confirm: record the real receipt (`record-receipt.ts`, unchanged; Finance's own module) and set `Leads.Advance_Confirmed_At` or `Balance_Confirmed_At` when it matches;
   - not found: no receipt.
   - Both: write Finance-only `Payment_Report_Answer` (Found/Not found), `Payment_Report_Answered_At` and `Payment_Report_Reason`, then mark the Task Completed.
4. **What the IR sees.** `GET /api/leads/[id]/claim` reads only Lead fields: `Payment_Reported_At`, `Payment_Report_Answer`, `Payment_Report_Answered_At`, `Payment_Report_Reason`.
   - Reported after answered (or never answered): "Waiting on Finance".
   - Otherwise: the answer.
   - One open report per lead = reported after answered.
5. **Gates.** `gates.ts` reads `Advance_Confirmed_At` / `Balance_Confirmed_At` on the Lead in place of Receipts, which closes the read-side breach too.
6. **Zoho access** (`zoho/access/spec.json` change):
   - Finance profiles: Leads `v` → `ve`, with FLS read-only on every Lead field except the five Finance-writer fields.
   - The IR gets those five read-only.
   - A Leads sharing rule to Head of Finance and Finance Operations, read-write (J2).
   - Activities: Finance must see Tasks it owns. That is default, but **UNVERIFIED** that an IR may create a Task owned by another user; probe in the sandbox.

**Supersedes:**
- the **D82 "Claims" section** ("Receipts.Match_State gains Claimed … no separate Payment_Claims module");
- the claim key in `UTR` (claim.ts header, Jev 0.73);
- `claim-answer.ts`'s Claimed → "Not found" handling;
- D113 ruling 6's Receipts `Claim_Of`/`Claim_Answer`/`Claim_Answer_Reason`, which are no longer needed.

The `Claimed` picklist value stays dormant. Nothing is deleted.

## MISSING in Zoho (create in sandbox first, export under `zoho/`)

| Module | Field | Type | Writer | Rows | Note |
|---|---|---|---|---|---|
| Leads | Payment_Reported_At | datetime | IR | claimPaid, reopenClaim | |
| Leads | Payment_Report_Answer | picklist Found/Not found | Finance | claim | |
| Leads | Payment_Report_Answered_At | datetime | Finance | claim | |
| Leads | Payment_Report_Reason | text 255 | Finance | claim | |
| Leads | Advance_Confirmed_At | datetime | Finance | gates | already in `field-register.json` |
| Leads | Balance_Confirmed_At | datetime | Finance | gates | already in `field-register.json` |
| Leads | Engagement_Skipped | boolean | IR | skipStage | in journey.ts; sandbox? |
| Leads | Rung_Undone_At | datetime | IR | untick, undoRung | in journey.ts; sandbox? |
| Leads | Consent_Visit | boolean | IR | permission | proposed in followup.ts |
| Leads | Contact_Preference | text 255 | IR | saveProfileDetails | J11 |
| Leads | Introduced_By | user lookup | IR | saveProfileDetails | J11. Zoho caps single-user lookups at 5 per module, and Leads has 4 (Consent_By, Cover_By, NDA_Verified_By, Secondary_Owner): this takes the last one |
| Leads | Pitch_Deck_Sent_At, Farm_Profile_Sent_At, Yield_Note_Sent_At, Webinar_Invite_Sent_At | datetime | IR | mat | J5 |
| Leads | Produce_Pack_Week, Produce_Pack_At | integer, datetime | IR | pack | J6 |
| Leads | Move_Request_To, Move_Request_Why, Move_Request_At | user lookup, picklist, datetime | IR (the manager clears) | askMove | J7. Move_Request_To would be a sixth single-user lookup: **over the cap**. Use a text user id, or switch to the Task form (J7 option a) |
| Touches | Outcome | picklist (CALLOUT) | IR | setCall | J3 |
| Touches | Objections | multi-select (OBJS) | IR | toggleObj | J3 |
| Touches | Voided_At | datetime | IR | dropTouch | J12 |
| (production only) | NDA_Told_*, NDA_Said_*, NDA_Chase_Count, Supp_* used by paperwork.ts | | | | not in production: confirm they exist in the sandbox, then promote |

**Field history** must be switched on for Leads Consent_* and the detail fields (J10).

**Access spec changes:**
- Finance Leads `ve` plus the sharing rule (J2);
- IR read-only on the Finance-writer Lead fields;
- `field-register.json` rows for every new field above;
- the register's lowercase names must be reconciled to API names.

## Build clusters (parallel agents, minimal overlap)

| Cluster | Actions | Files it owns |
|---|---|---|
| **C1: contact and next step** | lpFinish, lpLose, lpRestore, saveFollowup, logTouch, saveTouch, dropTouch, saveNext, clearNext, pullIn, moveNextTo, closeLost, reopenLost | `server/leads/followup.ts` (add setNext, clearNext, close), new `server/leads/touches.ts`, new `server/leads/followup-runtime.ts`; `app/api/leads/[id]/{followup,touches,touches/[touchId],next,next/move,lost}/route.ts`; new `lib/data/endpoints/followup.ts`; UI `features/lead/LeadPage.tsx` (the **integration owner**), `features/lead/drawers/{touch,next,followup,lost}.tsx`, `features/leads/{followupDrawer,actions}.ts(x)`, `features/today/{TodayPage,Horizon}.tsx`, `components/shell/TopBar.tsx` |
| **C2: ladder and lead record** | tick, tickCommit, recordRung, skipStage, untick, undoRung, addNote, setCall, toggleObj, saveContactPermission, saveProfileDetails, setFc, setFcDate, setFcEv, mat, pack | `server/leads/journey.ts`, new `server/leads/{notes,details,forecast,material,journey-runtime}.ts`, a call-outcome method in a **separate** `server/leads/touch-call.ts` (so C1's touches.ts stays C1's); `app/api/leads/[id]/{journey,notes,permission,details,forecast,material,touches/call}/route.ts`; new `lib/data/endpoints/{journey,record}.ts`; UI `features/lead/drawers/{lpdrawers,history,call,forecast,material}.tsx`, `features/leads/WorkAction.tsx` |
| **C3: intake, ownership, updates** | addLead, duplicate lookup, flagDupe, csvImport, assign, askMove, markRead | `server/leads/{capture,duplicate,import,assign,updates}.ts`, new `server/leads/{requests,intake-runtime}.ts`; `app/api/leads/route.ts`, `app/api/leads/{duplicate,import,flags}/route.ts`, `app/api/leads/[id]/{assign,move-request}/route.ts`, `app/api/lead-updates/read/route.ts`; new `lib/data/endpoints/{intake,ownership}.ts`; UI `features/add/{AddPage,AddBulk}.tsx`, `features/lead/drawers/owner.tsx`, `features/leads/LeadsPage.tsx`, `features/updates/{drawer,UpdatesPage}.tsx` |
| **C4: claim, holds, Me** | claimPaid, reopenClaim, startPaymentReport (local), askExt, lapse, setMe, setMyStyle, log, setOutWhy (local), useTemp/dropTemp (local) | `server/leads/{claim,gates}.ts`, `server/money/claim-answer.ts`, new `server/leads/hold-ask.ts`, `server/people/{profile,style}.ts`, new `server/activity/export-audit.ts`; `app/api/leads/[id]/{claim,hold-request}/route.ts`, `app/api/claims/**`, `app/api/me/{,style}/route.ts`, `app/api/activity/export/route.ts`; `lib/data/endpoints/{claims,holds}.ts`, new `lib/data/endpoints/me.ts`; UI `features/lead/drawers/{finance,hold}.tsx`, `features/pay/ClaimBlock.tsx`, `features/me/{ProfilePage,drawers}.tsx`, `features/activity/csv.ts`, `components/shell/drawers/absence.tsx`; `lib/console-save.ts` (the one edit: drop the local-only actions from BUSINESS_WRITES); `zoho/access/spec.json`, `zoho/field-register.json` |

**Overlap rules:**
- No cluster edits `server/leads/runtime.ts`, `lib/state.ts` or `lib/data/api.ts`; each adds its own `*-runtime.ts`.
- tick, assign and addNote are also dispatched from C1-owned pages (LeadPage, TodayPage, `leads/actions.ts`, TopBar). C2 and C3 **export hooks** from their endpoint files, and C1 swaps those call sites in last.
- C4's `gates.ts` edit keeps the `GateReader` interface that C2's journey consumes.
- The Zoho field creation (the MISSING table) is one owner-run step before C2, C3 and C4 can pass on staging.
