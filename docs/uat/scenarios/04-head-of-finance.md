# UAT-HOF — Head of Finance

- **Run by:** Harsha Bhat. The real seat holder runs it, not a stand-in.
- **Second person:** Meena (Finance) for the refund second-hand steps.
- **What this proves:** The Head of Finance is the second hand on refunds and money leaving (D22), the one who matches what is still pending, the only one who releases holds and farm units, and the one who issues the allotment and unlocks the app. Every reveal needs step-up and is logged.
- **Before you start:** Meena's receipts (FIN-11, FIN-12) are recorded and already matched by her (D113). Add a pending item to work: an IR claim not yet confirmed, or a statement line that did not auto-match (FIN-17). The seed has one hold that ran out 3 days ago. The Zoho approval process for forfeit and refund is on (M01-S10-T03). Prakash Bhat's allocation letter is on his allotment.
- **Hand-offs:** BATON in: FIN-11, FIN-12. BATON out: HOF-02 and HOF-07 (for IR-17), HOF-11 (app unlocked).
- **How to mark:** write Pass or Fail for every step in `../signoff-sheet.csv` (same step number). A Fail needs a defect (see `../defect-intake.md`). P1 = go-live blocker if it fails. P2 = needs a written workaround if it fails.
- **Labels:** "Refused check" means the seat must be denied. Passing it means you were stopped, with a sentence on the page and no browser pop-up.

## HOF-01 · Sign in and read the figures
*Step · P1 · Must · [M03-S01], [M05-S06], [M05-S07]*

- **Do:** Sign in. Open Today.
- **Expect on screen:** Today reads "Harsha's day". Banked to date, balance outstanding, units reserved of released and tickets open agree with the seed. Recorded-but-unmatched money is not counted. No lead-side switch unless she also holds a lead seat.
- **Expect in Zoho:** Read only.

## HOF-02 · Match what is still pending
*Step · P1 · Must · [M10-S02], [M08-S02], [M10-S07]*

- **Do:** Open Payments, Not reconciled. Match what is still pending: IR claims and statement lines that did not auto-match. Meena's own receipts (Prakash Bhat ₹22.5 L, UAT Lead A advance) are already matched and show no 'Match it'. Then try a refund you raised yourself: it needs a second hand, not you (D22).
- **Expect on screen:** Each pending row offers 'Match it'. After matching: banked to date rises by the amount, the allotment's Payment_Status is recomputed, the lead's gate opens on the IR's next read.
- **Expect in Zoho:** Receipts: Match_State = Matched, Matched_By = Harsha, Matched_At set (on the items you matched; Meena's stay Matched_By = Meena). Allotment: Payment_Status = Partial or Full. Lead gate fields set. money.confirmed sent.

## HOF-03 · First matched advance opens the app account on hold
*Step · P1 · Must · [M08-S08], [M10-S02], [M10-S21]*

- **Do:** Open UAT Lead A's investor. Read What they hold and the app card.
- **Expect on screen:** App account shows tentative and the header shows reserved. Hold runs 30 days out (Asia/Kolkata). App card reads 'On hold - data synced, sign-in locked'. No welcome email is sent. A receipt that is only recorded opens nothing.
- **Expect in Zoho:** Lead: account_opened_at and advance_confirmed_at in the same save. Contact: App_Access = Hold. account.opened pushed to the app; delivery result logged.

## HOF-04 · Read holds and the farm shelf
*Step · P2 · Must · [M08-S04], [M11-S03]*

- **Do:** Open Today's 'Holds running' and the Land card. Open Prakash Bhat.
- **Expect on screen:** Holds by days left with units, farm and balance due, and total forfeit exposure. Each farm shows free units of total. Banner reads '₹22.5 L due in 21 days. The hold ends 23 Sep. A lapse forfeits ₹50,000 and puts 1 unit back on the farm.' (before the match).
- **Expect in Zoho:** Read only. Deadline computed once in Asia/Kolkata from the advance receipt.

## HOF-05 · Extend a running hold
*Step · P2 · Must · [M08-S04], [M01-S10]*

- **Do:** Open a running hold. Press 'Extend the hold'. Pass step-up.
- **Expect on screen:** The extension goes to the Zoho approval process and shows as pending approval.
- **Expect in Zoho:** Hold: extension pending in the approval process. hold.changed 'extended' sent.

## HOF-06 · Release a lapsed reservation
*Step · P1 · Must · [M08-S04], [M01-S10], [M10-S07]*

- **Do:** Open the hold that ran out 3 days ago. Press 'Release the reservation'. Pass step-up. Confirm.
- **Expect on screen:** In-page confirm states the forfeit and the refund. On confirm the allotment becomes Cancelled; the refund waits for the Zoho approval as 'pending approval'. Units return to the farm.
- **Expect in Zoho:** Allotment: Allocation_Status = Cancelled. Receipts: refund pending, Reversal_Of set. A Cancelled allotment takes no new receipt except a refund.

## HOF-07 · Allot on the verified allocation letter (Prakash Bhat)
*Step · P1 · Must · [M11-S05]*

- **Do:** After his balance is matched, open Prakash Bhat. Verify the allocation letter with reference EMU-2808-99001. BATON out: tell Rohit.
- **Expect on screen:** Allotment reads Issued: 'Allotted. The units are theirs and the allocation letter is on file.' Farms shows the new allotted count. The IR's lead shows rung 7 on its next read.
- **Expect in Zoho:** Allotment: Allocation_Status = Issued by the lifecycle transition (a direct write is refused). allotment.done sent.

## HOF-08 · Allotment refused while money is outstanding
*Refused check · P1 · Must · [M11-S05], [M01-S07]*

- **Do:** Open Joseph Mathew (balance due, KYC pending). Verify his allocation letter. Then try to mark an allotment Issued with money outstanding.
- **Expect on screen:** In-page refusal: he cannot be allotted yet because the balance is still outstanding. Marking Issued asks on screen and names the amount. He stays reserved.
- **Expect in Zoho:** Allotment unchanged. Zoho refuses a direct write of Allocation_Status.

## HOF-09 · Block a signed paper
*Step · P2 · Must · [M12-S07]*

- **Do:** Open a signed supplementary. Press 'Block it' with a reason.
- **Expect on screen:** Reason is mandatory. Agreement_Signed and the IR's gate clear together. The IR's paperwork row shows the block and reason.
- **Expect in Zoho:** Allotment: Agreement_Signed = false; block reason recorded.

## HOF-10 · Release units and refuse a take-back
*Step · P1 · Must · [M11-S04], [M01-S07]*

- **Do:** Open Farms. On the unreleased farm press 'Release 54'. On a farm with 29 units held press 'Take it back'.
- **Expect on screen:** Release: the farm reads more released, all free. Take back: in-page refusal names the 29 units held; the farm stays released.
- **Expect in Zoho:** LLP_Creation_Module: released units updated by Harsha only. No change on the refusal.

## HOF-11 · Send welcome and unlock the app
*Step · P1 · Must · [M10-S21], [M08-S08]*

- **Do:** Open the investor whose card reads 'On hold'. Press 'Send welcome and unlock'. Confirm in the page. Later press 'Lock app access' and give a reason.
- **Expect on screen:** Card reads 'Welcome sending...' then 'Welcome delivered <time> · Email'. After lock: 'Locked - sign-in blocked'. The welcome never goes out on its own.
- **Expect in Zoho:** Contact: App_Access = Invite, App_Welcome_At set; then Hold again. Zoho field history shows who and when. Activity shows it.

## HOF-12 · Reveal an identity value with step-up
*Step · P1 · Must · [M01-S10], [M15-S05]*

- **Do:** Open a Contact. Press reveal on the PAN. Give a reason. Pass the Zoho sign-in prompt. Hide it. Fail step-up three times on another reveal.
- **Expect on screen:** First asks 'Why do you need it?' with the three reasons. The value shows only after step-up and masks again on hide, sign-out or change of person. After 3 failures the fourth is locked and Sahil and Pradeep are alerted.
- **Expect in Zoho:** Plane C log: person, record, field, reason, outcome. Activity first row reads 'Revealed a PAN' with the value masked. No PAN in any other log.

## HOF-13 · Read Activity and Investors-side Numbers
*Step · P2 · Must · [M15-S03], [M16-S09]*

- **Do:** Open Activity, then Numbers, Collection.
- **Expect on screen:** Activity lists actions on investors, allotments, payments, documents and tickets in her scope. Collection shows the money figures.
- **Expect in Zoho:** Read only.

## HOF-14 · Read the Investors-side seats in Teams
*Step · P2 · Must · [M17-S01]*

- **Do:** Open Teams.
- **Expect on screen:** Investors-side seats section lists Finance, Account Management, Farm ops and viewer seats with team and seat.
- **Expect in Zoho:** Read from Zoho roles.

## HOF-15 · Close a ticket handed over by a KAM
*Step · P2 · Must · [M13-S04], [M13-S03]*

- **Do:** After KAM-08, open Tickets, Mine. Close the bank ticket.
- **Expect on screen:** Ticket is listed with Close it.
- **Expect in Zoho:** Cases: owner = Harsha; status Closed.

---
Seat holder sign-off: name ____________  date ________  result: all Must steps passed / not passed
