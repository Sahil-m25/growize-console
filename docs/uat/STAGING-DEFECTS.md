# Staging defect register — 6–9 Oct 2026 test waves

_One row per defect found on staging (Zoho sandbox "Growize Staging") in wave 1a (6–7 Oct), wave 1b (8 Oct) and wave 2 (8–9 Oct): 36 defects, B-01…B-27 and the nine wave-2 ones. Jira project GC. Written 9 Oct 2026 on `qa-register`, from `fix/wave1` at 8471c5d._

Sources (outside the repo, kept with the harness): `report/bugs.md`, `harness/bugs/*.md`, `report/results-w2.csv`, `report/fixplans-all.md`. D133 is the wave-1 fix decision, D134 the sandbox seed. How a new defect is reported: `defect-intake.md`.

## How to read it

| Column | Meaning |
|---|---|
| Sev | S1 blocks money or the day's work · S2 a core step fails · S3 wrong but workable · S4 cosmetic, seed or matrix |
| Status | **Fixed+verified** retested on staging · **Fixed in code** on `fix/wave1`, not yet deployed or retested · **Seed** needs the sandbox seed fixed, no code · **Ruling** the owner decides first · **Env** needs a variable or a job on staging |
| Fix | `9628d67` wave-1 (D133) · `555ed7b` wave-2 big three (B-02, B-06, W2-KAM-6) · `8471c5d` wave-2 small defects · `e581ef7` sandbox seed prices (D134). `e04f5a8` (fake Zoho Sign for staging) fixes no defect. |
| Cases | Harness cases first (outside the repo in `harness/cases/`; the new `W3-REG-*` ones are copied to `jev/regression/w3-regress.json`), then the repo catalogue case `REG-*` in `pm/plan-merged/ui-cases.json` |

## Register

| ID | Jira | Sev | Seat | Area / route | What | Root cause | Status | Fix | Regression cases |
|---|---|---|---|---|---|---|---|---|---|
| B-01 | GC-1466 | S1 | IR A | Lead page: Log a contact / Set the next step | Saving a follow-up or next step answered 502; orphan 'Reply received' touch left; Qualified could not be ticked. | Activities modules hidden and no Tasks/Calls/Meetings create right for the IR profile; write order left a half-written contact; error text said 'not answering'. | **Fixed+verified** | 9628d67 | `W1B-LB-W-FU-SAVE`, `W1B-LB-W-NEXT-SAVE`, `W2-IRB-W-FU-SAVE`, `W2-IRB-W-NEXT-SAVE`, `REG-B01` |
| B-02 | GC-1467 | S1 | Finance Ops | /inv /pay /tkt /numbers lists | Investors, Payments, Tickets and Numbers lists never loaded ('Could not refresh'). | (a) KYC fields hidden by FLS broke the investors read; (b) seed allotments had no Unit_Price so the register refused rows; (c) Cases lacked Handed_By/At; (d) Numbers read the same sources. | **Fixed in code** | 9628d67, 555ed7b | `W1-FIN-INV-LIST`, `W1-FIN-PAY-REGISTER`, `W1B-FIN-TKT-PAGE`, `W1B-FIN-NUMBERS-BLOCKED (B-02)`, `W1B-FIN-PAY-DIRECT`, `REG-B02` |
| B-03 | GC-1468 | S2 | IR A | Lead page > Contact permission; Today > Record permission | Permission saved (200) but never read back: 'No contact permission yet' stayed, Call/WhatsApp/Email never offered. | Consent_* booleans and Consent_By/How not mapped on read; 'Call' value missing from Consent_How picklist; drawer did not preload ticks. | **Fixed+verified** | 9628d67 | `W1IR-W-G-PERM`, `W1-PERMISSION-RECORD`, `W1B-TODAY-ACTIONS-MASKED-B03`, `REG-B03` |
| B-04 | GC-1469 | S2 | IR A | Lead page and top bar: Undo the rung | Un-tick refused: 'Zoho has no field for this yet (Leads.Rung_Undone_At)'. | Leads.Rung_Undone_At missing in the sandbox (and live). | **Fixed+verified** | 9628d67 | `W1IR-W-G-UNTICK`, `REG-B04` |
| B-05 | GC-1470 | S2 | IR A, Finance Ops | /updates and /add cold load | Opening the route directly intermittently replaced the app with 'Application error: a client-side exception'. | Init-order cycle through the shell barrel ('Cannot access sb before initialization'). | **Fixed+verified** | 9628d67 | `W1-IRA-ADD-URL`, `W1-UPD-EMPTY`, `W3-REG-B05`, `REG-B05` |
| B-06 | GC-1471 | S2 | IR A, Finance Ops | Every IR lead open; Finance Today and claims queue | Claim reads failed: IR lead open fired a 502 'Not saved yet' on a read; Finance Today 'Could not refresh'. | IR token had no Receipts access / claim COQL selected a hidden field; /api/claims 503 not-configured (receipt secrets missing on staging); wrong error words. | **Fixed in code** | 9628d67, 555ed7b | `W1-IRA-CLAIM-READ`, `W1-FIN-CLAIMS-QUEUE`, `W1B-FIN-CLAIMS-TODAY`, `REG-B06` |
| B-07 | GC-1472 | S2 | IR A (safety) | Sandbox data, all leads | Sandbox seed not regenerated after D131: leads still carried pre-sink phone numbers and emails. | Data, not code: sandbox not reseeded (zoho/sandbox README step 4). | **Seed** | - | `W3-REG-B07`, `REG-B07` |
| B-08 | GC-1473 | S3 | Finance Ops | Investor record > What they hold; Holds | Holdings stuck on 'Reading the allotments'; hold controls never rendered. | Finance Ops had no ARL_Holdings permission; hold read failed on seeds with no Hold_Until/Unit_Price. | **Fixed+verified** | 9628d67 | `W1-FIN-HOLD-READ`, `W1B-FIN-HOLD-JOSEPH`, `W1FIN-REC-MONEY`, `REG-B08` |
| B-09 | GC-1474 | S3 | IR A | API walls: /api/statements, /api/claims | Investors-side endpoints answered an IR without a seat refusal. | No seat check on statements; claims checked configuration before seat. | **Fixed+verified** | 9628d67 | `W1-IRA-CLAIMS-WALL`, `W1-IRA-STATEMENTS-WALL`, `REG-B09` |
| B-10 | GC-1475 | S3 | IR A | Lead header; Today focus card | IR sees rupee figures (Rs 1 Cr, Rs 25 L) from a hard-coded prototype unit price although price is hidden from IR. | Client multiplies units by plan.ts UNIT; API masks Unit_Price. | **Ruled: fixed in code** (D138, 10 Oct: IRs DO see rupees, only real Zoho values on their own token; no UNIT figure anywhere on the lead side; amount due on Balances to chase) | d138-rulings | `W1-IRA-LEAD-NO-RUPEE`, `W3-REG-B10`, `REG-B10` |
| B-11 | GC-1476 | S3 | IR A | Lead > Profile tab | Free-text contact preference invited but refused; the whole save (city, units) lost. | Zoho keeps the preference as Email/WhatsApp/Phone only; field copy invited text. | **Fixed+verified** | 9628d67 | `W1IR-W-S-PREF-FREETEXT`, `REG-B11` |
| B-12 | GC-1477 | S3 | IR A | Add lead > mobile duplicate hint | Own-book duplicate mobile reported as 'No existing record with this number' while the blocker said it was on the book. | Client duplicate hint ignored own-book matches. | **Fixed+verified** | 9628d67 | `W1-IRA-DUP-OWNBOOK`, `REG-B12` |
| B-13 | GC-1478 | S3 | IR A | Profile > Badge | Badge colour change acknowledged (200) but never showed or persisted. | Style write dropped or roster read ignored it. | **Fixed+verified** | 9628d67 | `W1-W-ME-BADGE-CHANGE-AND-RESTORE`, `REG-B13` |
| B-14 | GC-1479 | S3 | IR A | Lead page banner and notes | 'No contact permission yet' banner unreadable (white on pale pink); note author blank. | Banner CSS contrast; note author not resolved while names were empty (B-15). | **Fixed+verified** | 9628d67 | `W3-REG-B14`, `REG-B14` |
| B-15 | GC-1480 | S3 | Finance Ops, IR A | /today greeting; session; /me | Signed-in person had no name: greeting read "'s day"; session access.lead.n empty. | Name not resolved from the Zoho user on D124 test sessions; /api/session did not carry CurrentUser. | **Fixed in code** | 9628d67, 8471c5d | `SMK-FIN-DATA-HEALTH`, `W3-REG-B15-FIN`, `W3-REG-B15-IRA`, `REG-B15` |
| B-16 | GC-1481 | S3 | Finance Ops | Investor record > Journey | Journey showed a raw Zoho user id, ISO timestamps and a dangling 'from'. | Journey formatting used raw fields. | **Fixed in code** | 8471c5d | `W1FIN-REC-JOURNEY`, `REG-B16` |
| B-17 | GC-1482 | S3 | Finance Ops | Shell: Collapse the sidebar | Collapse button did nothing for Finance Ops. | Rail dispatch lost while data reads failed (B-02/B-06). | **Fixed+verified** | 9628d67 | `W1FIN-RAIL-COLLAPSE`, `REG-B17` |
| B-18 | GC-1483 | S3 | Finance Ops | Investor record > Identity and contact | Residency 'Resident' but Aadhaar line said 'not applicable - non-resident'. | Residency to Aadhaar mapping. | **Fixed+verified** | 9628d67 | `W1FIN-REC-RESIDENCY`, `REG-B18` |
| B-19 | GC-1484 | S3 | Finance Ops | Documents > Send one | Opening the send panel called a prefill that returned a bodiless 500 (templates and NDA prefill too). | /api/documents/sign/{prefill,templates} threw on the Sign config; Sign 503 not worded as not-configured. | **Fixed in code** | 8471c5d | `W1FIN-DOCS-SEND-PANEL`, `W3-REG-B19`, `REG-B19` |
| B-20 | GC-1485 | S4 | Finance Ops | Investor record > Money > Receipts | Receipt reference (UTR) shown in clear with no step-up. | Open question whether the D119 mask covers the investor record. | **Ruled: by design** (D138, 10 Oct: Finance keeps seeing the UTR in full on the investor record; the D119 mask stays on /pay and for non-Finance seats). Cases expecting a mask for Finance re-labelled: CM-3363 "visible to Finance", `REG-B20`; harness `W1-FIN-STEPUP-REVEAL-RO` to expect the full reference | - | `W1-FIN-STEPUP-REVEAL-RO`, `REG-B20` |
| B-21 | GC-1486 | S4 | Finance Ops | Teams (read only) | Dead 'Edit what a seat may do' button on a read-only page; banner said IRs hold no Investors pages, against D113. | Edit control not gated on the assign right; banner copy stale. | **Fixed+verified** | 9628d67 | `W1-FIN-TEAMS-RO`, `W3-REG-B21`, `REG-B21` |
| B-22 | GC-1487 | S4 | IR A/B, Finance Ops | Events edit, absence reason, Activity filter, IR Investors, Finance Teams | Matrix expected controls the app hides by design and contradicted itself for Finance Ops. | Not an app defect: matrix rows to re-label (or grant events:edit). | **Ruled: matrix corrected** (D138, 10 Oct: correct the matrix, not the app; rows re-labelled below, "B-22 matrix corrections") | - | `W1-IRA-INV-D113`, `W1-FIN-TEAMS-RO`, `W1-EV-NOEDIT-DETAIL`, `REG-B22`, `REG-B22-EV`, `REG-B22-ABS`, `REG-B22-ACT`, `REG-B22-TEAMS` |
| B-23 | GC-1488 | S3 | Finance Ops | /inv > Add investor | Farm list empty, so an already-paid investor could never be added. | Add-paid read Unit_Price from the LLP (it is Pet_Unit_Price); seed LLPs had no price/status. | **Fixed in code** | 9628d67, e581ef7 | `W3-REG-B23`, `REG-B23` |
| B-24 | GC-1489 | S3 | Finance Ops | Shell: Help | Help could not be opened ('?' did nothing; no Help row in the account drawer). | account.tsx drew Profile/Availability/Help only for lead seats. | **Fixed+verified** | 9628d67 | `W1B-FIN-SH-HELP-OPENS (new bug w1b-fin-rest-1)`, `REG-B24` |
| B-25 | GC-1490 | S3 | IR A | Lead > Set the next step | Opened with 'Call - permission needed' pre-selected; Save gave 403. | Default channel ignored permission. | **Fixed+verified** | 9628d67 | `W1B-LB-NEXT-DEFAULT-CHANNEL`, `REG-B25` |
| B-26 | GC-1491 | S3 | IR A | /me | Mobile/Initials not saved while display name blank (PATCH /api/me 422). | Whole profile saved; name empty (B-15). | **Fixed+verified** | 9628d67 | `W1B-ME-MOBILE-PERSIST`, `REG-B26` |
| B-27 | GC-1492 | S3 | IR A | /activity | Activity showed 0 actions after notes, lost/re-open, forecast, absence; export unusable. | Lead actions not written to the activity log; nightly Zoho audit export job not scheduled. | **Env** | 9628d67 | `W1B-WF-LOST-AUDIT`, `W2K-ACT-AFTER-WRITES (B-27)`, `W3-REG-B27`, `REG-B27` |
| W2-KAM-1 | GC-1493 | S3 | KAM | /inv record > What they hold; /farms | KAM sees unit price and holding value in rupees on the record and Farms. | SecHold and Farms render unit price unconditionally; farm API did not mask Unit_Price. | **Ruling** (NOT ruled on 10 Oct — still open, D138; KAM money stays hidden. The record's "What they hold" no longer shows a rupee figure to a KAM since the UNIT figure went (d138-rulings); Farms still shows the LLP price) | - | `W2K-INV-REC-NOMONEY (bug W2-KAM-1)`, `W2K-FARMS-NOMONEY (bug W2-KAM-1)`, `REG-W2KAM1` |
| W2-KAM-2 | GC-1494 | S3 | KAM | /tkt; record > Tickets | Ticket rows read 'opened 2026-1 - null days old, SLA' (live ISO dates parsed as demo dates). | day6()/aged()/when() parse only demo date formats. | **Fixed in code** | 8471c5d | `W2K-TKT-DATES (bug W2-KAM-2)`, `REG-W2KAM2` |
| W2-KAM-3 | GC-1495 | S3 | KAM | /today Last heard; /inv My accounts; Care | 'Last heard' disagreed across screens and was printed as a raw timestamp; lead-side touches reset the KAM cadence. | Today read the latest touch on the origin lead (any IR); My accounts and Care read the empty demo book. | **Fixed in code** | 8471c5d | `W2K-DASH-LASTHEARD-FORMAT (bug W2-KAM-3)`, `W2K-DASH-LASTHEARD-AGREE (bug W2-KAM-3)`, `REG-W2KAM3` |
| W2-KAM-4 | GC-1496 | S4 | KAM | /inv ARL ID column, record header, Today rows | ARL ID showed the Zoho record id instead of the ARL code. | Row and header printed x.id rather than x.code. | **Fixed in code** | 8471c5d | `W2K-INV-ARLID (bug W2-KAM-4)`, `REG-W2KAM4` |
| W2-KAM-5 | GC-1497 | S2 | KAM | Record > Care > Log a conversation | KAM could not log a conversation on 7 of 8 accounts: 'this investor has no origin lead'. | Sandbox seed Contacts lack Origin_Lead; design: an investor added without a lead can never have a conversation filed. | **Seed** | - | `W2K-W-TALK (bug W2-KAM-5)`, `REG-W2KAM5` |
| W2-KAM-6 | GC-1498 | S2 | KAM | Record > Tickets; /tkt | 'Hand it to Finance' failed 502 invalid-data; ticket never reached Finance (Handed_By half-written). | Hand-over was two writes (fields, then change_owner on the KAM token); a refused owner change left the first write. | **Fixed in code** | 555ed7b | `W2K-W-TKT-HANDOVER (bug W2-KAM-6)`, `REG-W2KAM6` |
| W2-IRB-1 | GC-1499 | S4 | IR B | /inv (D113) | IR B Investors page empty; the IR B half of D113 was proven only vacuously. | Seed IR B contacts carry Originating_IR but no Origin_Lead. | **Seed** | - | `W3-REG-W2-IRB-1`, `REG-W2IRB1` |
| W2-IRB-2 | GC-1500 | S4 | IR B (and IR A) | Lead page after Record follow-up | A follow-up saved as 'Interested' showed 'Reply received' on the lead; the outcome was lost. | Outcome had no field; read back from the Touch subject only. | **Fixed in code** | 8471c5d | `W1IR-W-D-LOG-REPLY`, `W1IR-W-G-LOGNOTNOW`, `W3-REG-W2-IRB-2`, `REG-W2IRB2` |
| W2-REG-1 | GC-1501 | S4 | IR A | Top bar: Undo the rung | Top-bar 'Undo the rung' never offered after a live tick. | TJUST set only by the fixture reducer's tick; live tick only reloaded data. | **Fixed in code** | 8471c5d | `W1-W-TOPBAR-UNDO-RUNG`, `REG-W2REG1` |


## B-22 matrix corrections (owner ruling 10 Oct 2026, D138: correct the matrix, not the app)

The coverage matrix (harness, outside the repo: `report/matrix-corrections.csv`) is re-labelled as below; the repo's catalogue
carries one case per area (`pm/plan-merged/ui-cases.json` REG-B22, REG-B22-EV, REG-B22-ABS, REG-B22-ACT, REG-B22-TEAMS).

| Area | Matrix rows | Matrix said | Re-labelled | Why (as built) |
|---|---|---|---|---|
| Events edit (IR) | CM-0575..0614, CM-0623, CM-0626, CM-0647, CM-0656, CM-3493, CM-3496 | IR may Add / Edit an event | **hidden** for IR seats | IR holds `events: ["view", "load"]`; only an editor (IR Manager) adds or edits events. No events:edit for IR. |
| Absence reason | CM-0242 | "Choose a reason" offered | **conditional — hidden in live mode** | The reason select is the demo book's; live availability writes dates only. |
| Team availability | CM-0227, CM-0230 | other members' availability / details visible | **conditional — needs roster rights** | A solo IR sees only their own. |
| Activity person filter | CM-0440 | "All people" offered | **conditional — hidden for a solo seat** | Shown to a manager with a team; an IR's Activity is their own actions. |
| IR Investors page | CM-3166, CM-3182 | hidden for IR | **visible, read-only, own-lead only** | D113: the IR reads the investors that came from their own leads. |
| Finance Ops contradictions | CM-1903, CM-1911, CM-3535 (visible) vs CM-1935, CM-1943 (hidden); CM-1322 / CM-0895 vs CM-3789; CM-1490 vs CM-3795; CM-1656 vs CM-3794 | both | **hidden / refused** (the "visible" rows re-labelled) | The server policy refuses them for Finance Ops; Teams is read only and offers no seat edit (B-21). |

## Totals

| Status | Count | Defects |
|---|---|---|
| Fixed+verified | 16 | B-01, 03, 04, 05, 08, 09, 11, 12, 13, 14, 17, 18, 21, 24, 25, 26 |
| Fixed in code | 12 | B-02 (remainder), B-06, B-15 (remainder), B-16, B-19, B-23, W2-KAM-2, 3, 4, 6, W2-IRB-2, W2-REG-1 |
| Seed | 3 | B-07, W2-KAM-5, W2-IRB-1 |
| Ruled 10 Oct (D138) | 3 | B-10 (fixed in code on `d138-rulings`), B-20 (by design), B-22 (matrix corrected) |
| Ruling | 1 | W2-KAM-1 |
| Env | 1 | B-27 |

D138 (10 Oct) split what was one ruling: B-10 — IRs DO see rupee amounts, only real Zoho values their own token reads (never the
prototype unit price); W2-KAM-1 (the KAM) was not ruled and stays open — KAM money stays hidden. B-22 is a matrix correction, not an
app defect. The status words added: **Ruled: fixed in code**, **Ruled: by design**, **Ruled: matrix corrected**.

## Notes on individual rows

- **B-02** (Fixed in code): Wave-1 part verified on staging; 555ed7b (register never blanks on one row) not yet deployed.
- **B-06** (Fixed in code): IR claim read (555ed7b) and the receipt-config secrets are not yet deployed or set.
- **B-07** (Seed): Reseed then run W3-REG-B07. The UI case also passes on the demo build.
- **B-09** (Fixed+verified): The refusal itself is an API fact; the harness case asserts 403. The UI case only keeps the IR menu honest.
- **B-10** (Ruling): Owner ruling pending (D69/D123): remove the figure, or accept an indicative display and change the cases.
- **B-15** (Fixed in code): Main fix verified on staging; session display name from Zoho CurrentUser (8471c5d) not yet deployed.
- **B-20** (Ruling): Owner ruling pending; apply it to CM-3363, CM-2036, CM-3680.
- **B-21** (Fixed+verified): W1B-FIN-TEAMS-EDIT-BTN (B-21) asserts the old behaviour (button shown); retire it, W3-REG-B21 replaces it.
- **B-22** (Ruling): Cases assert the server-policy side (hidden/refused). Owner to confirm per the ruling list.
- **B-23** (Fixed in code): Not in the verified list handed over; classed Fixed in code (code 9628d67, sandbox seed e581ef7).
- **B-27** (Env): Code in 9628d67 (POST /api/jobs/audit-export); `LOG_SINK=state` (b27-archive) keeps the archive and Plane C in the existing NoSQL store. Owner steps: `docs/runbooks/b27-activity-archive-staging.md`.
- **W2-KAM-1** (Ruling): Same ruling as B-10.
- **W2-KAM-5** (Seed): Fails on staging until seed contacts get Origin_Lead.
- **W2-KAM-6** (Fixed in code): Needs Change Owner on Cases for the KAM/AM Head profiles in Zoho (not made).
- **W2-IRB-1** (Seed): W2-IRB-INV-D113 asserts '0 from your leads'; flip it when the seed is fixed.

## Keeping it honest

- A defect closes only when its harness case passes on staging after the fix is deployed, and the status here changes in the same commit. A case is never weakened to get there (harness guide: leave it failing, name the bug in its title).
- The `REG-*` catalogue cases are plain words and have **not yet been run** through Jev. First run: `ONLY=REG-B01,… node pm/jev-ui-runner.mjs …` (`docs/UI-TEST-CONTRACT.md`), then re-baseline any that come back borderline or stale (`docs/runbooks/jev-rebaseline.md`). They cite only fixtures that already exist.
- Open items are tracked once, here. `docs/CARRY-FORWARD.md` section C points to this file and does not repeat the table.
- A new staging defect gets, in the same change: a row here, a Jira key, a harness case and a `REG-*` case.
