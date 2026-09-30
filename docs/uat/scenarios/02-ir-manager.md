# UAT-IM — IR Manager

- **Run by:** Tasneem Qureshi. The real seat holder runs it, not a stand-in.
- **Second person:** Kavya covers a lead; Rohit for the grant check.
- **What this proves:** The manager runs the team: sees the team's book, deals leads, covers a lead, reads the reports and grants a page. The manager sees no money.
- **Before you start:** Rohit and Kavya each hold leads. A CSV file with 5 good and 3 bad rows (fake names, fake numbers). Sandbox seeded.
- **Hand-offs:** No baton. Can run in parallel with the IR scenario.
- **How to mark:** write Pass or Fail for every step in `../signoff-sheet.csv` (same step number). A Fail needs a defect (see `../defect-intake.md`). P1 = go-live blocker if it fails. P2 = needs a written workaround if it fails.
- **Labels:** "Refused check" means the seat must be denied. Passing it means you were stopped, with a sentence on the page and no browser pop-up.

## IM-01 · Sign in and see the team's book
*Step · P1 · Must · [M06-S01], [M03-S01]*

- **Do:** Sign in. Open Leads.
- **Expect on screen:** Scope is the team's book. An Owner filter shows counts for each IR. Leads that are lost are held back with '<k> closed as lost, held back · Show'. 'Needs an owner' lists unassigned leads. Rows have no action buttons.
- **Expect in Zoho:** IR Manager role, read on the IR subtree through the hierarchy.

## IM-02 · Search the team's leads
*Step · P1 · Must · [M06-S03], [M06-S05]*

- **Do:** Press Ctrl+K. Type a lead's name held by Rohit, then by Kavya.
- **Expect on screen:** Header reads 'Your team's book'. At most 8 rows with name, last 4 of phone, stage and owner, and 'N more - keep typing'. No investor is listed.
- **Expect in Zoho:** No Contacts read.

## IM-03 · Add a lead with no owner and deal it
*Step · P1 · Must · [M04-S01], [M04-S04], [M05-S01]*

- **Do:** Press Add lead, leave Owner blank, add 'UAT Lead M'. Open Leads, 'Needs an owner', press Assign owner and pick Rohit.
- **Expect on screen:** Lead joins 'Needs an owner' with source and capture date. After Assign owner it moves into Rohit's book.
- **Expect in Zoho:** Leads: owner is the unassigned queue user, then Rohit; Owner_Assigned_At set. (Unassigned queue user is still an open owner decision, M04-S01-NOTE-2.)

## IM-04 · Load an event sheet with a preview
*Step · P2 · Must · [M04-S04], [M14-S03], [M14-S01]*

- **Do:** Open Events, open a completed event with staff named. Load the CSV. Read the preview. Choose 'Round-robin'. Load. Load the same sheet again.
- **Expect on screen:** Preview marks each row added or refused with a reason. Round-robin announces the split before it writes. Only good rows are written, with no consent. Second load adds nothing.
- **Expect in Zoho:** Leads: 5 new records tagged Lead_Event, dealt across the event staff, no consent. One 'Loaded the event sheet' log line.

## IM-05 · Cover for a colleague
*Step · P1 · Must · [M08-S05], [M02-S09]*

- **Do:** Hand one of Rohit's leads to Kavya for 3 days. Sign in as Kavya (or ask Kavya) and open it. End the cover.
- **Expect on screen:** Kavya can open and work the lead and sees 'covering until <date>'. Kavya still cannot open other IRs' leads. After the cover ends she can no longer open it.
- **Expect in Zoho:** Leads: a record share to Kavya, read-write, added when the window opens and removed when it closes.

## IM-06 · Cover cannot be forced
*Refused check · P2 · Must · [M08-S05]*

- **Do:** Have a dormant secondary IR try to start cover on a healthy owner's lead.
- **Expect on screen:** Nothing changes.
- **Expect in Zoho:** No share is created.

## IM-07 · Read the Assignments by IR report
*Step · P2 · Must · [M16-S01]*

- **Do:** Open Numbers.
- **Expect on screen:** First section is 'Assignments by IR', one row per IR in the team and a Team total. Columns: This week, Last week, Earlier this month, Before this month, Total, Missed first touch. A lead assigned today is counted 'Not yet worked' until the IR contacts it.
- **Expect in Zoho:** Read only. Counts agree with Leads owner-change records.

## IM-08 · Read the other Numbers sections
*Step · P1 · Must · [M16-S03], [M16-S06]*

- **Do:** Open Funnel, Checks, then tap a Checks figure. Open Transfers.
- **Expect on screen:** Funnel counts come from stage stamps. Tapping a Checks figure opens Leads filtered to exactly those leads. Transfers shows 'N transferred since <month> · median X days'. No rupee amount anywhere.
- **Expect in Zoho:** Read only. Transfers units come from the Contact's allotments.

## IM-09 · Grant a page to an IR
*Step · P2 · Must · [M03-S03], [M17-S01], [M17-S02]*

- **Do:** Open Teams. Open Rohit. Grant Numbers. Ask Rohit to sign in and check the rail.
- **Expect on screen:** Numbers is in Rohit's rail. Teams shows only me and my IRs and a rights grid behind 'What each seat holds'.
- **Expect in Zoho:** Console grant record. No Zoho profile change.

## IM-10 · Grants the manager cannot make
*Refused check · P1 · Must · [M03-S03], [M17-S02]*

- **Do:** Try to grant Rohit the System page. Try to change another manager's access. Try a manager change that would loop.
- **Expect on screen:** Each is refused with an in-page note saying why. Nothing changes.
- **Expect in Zoho:** No change to grants or Zoho users.

## IM-11 · No money, no payment decisions
*Refused check · P1 · Must · [M08-S02], [M16-S03], [M16-S06]*

- **Do:** Open a team lead that has a payment. Look at Numbers and Transfers.
- **Expect on screen:** Payment status is readable. There is no confirm or reject control. No rupee value appears in Numbers, Transfers or the lead.
- **Expect in Zoho:** Read only.

## IM-12 · Updates and Activity for a manager
*Step · P2 · Must · [M15-S01], [M15-S03]*

- **Do:** Open Updates and Activity.
- **Expect on screen:** Updates also shows 'no owner', 'moves waiting for approval' and 'breaches in my team'. Activity shows the team's actions with a Person filter and By person / By day.
- **Expect in Zoho:** Read only.

## IM-13 · Pages a manager must not have
*Refused check · P1 · Must · [M18-S02], [M17-S06], [M16-S09]*

- **Do:** Try Payments, Farms, System, Investors-side Numbers.
- **Expect on screen:** In-page refusal, or not in the rail.
- **Expect in Zoho:** Refusals logged.

---
Seat holder sign-off: name ____________  date ________  result: all Must steps passed / not passed
