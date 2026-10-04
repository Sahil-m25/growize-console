# UAT-FIN — Finance (Finance Operations)

- **Run by:** Meena Raghavan. The real seat holder runs it, not a stand-in.
- **Second person:** Harsha (Head of Finance) does the release and unlock steps, and the second hand on any refund.
- **What this proves:** Finance does the money and paper work the IR hands over: send papers for signature, record what arrives, answer IR payment reports, reconcile the bank. A receipt Finance records is matched by that recording (D113): automatically from the bank statement where possible, else by the Finance person by hand.
- **Before you start:** Sandbox seeded (Prakash Bhat and Joseph Mathew have balances due; Rohit has a payment report waiting on Prakash). Zoho Sign live on the sandbox with NDA and Supplementary templates (M12-S04-T02). A sample bank statement CSV (MA3, still owed by Finance).
- **Hand-offs:** BATON in: IR-05 (send NDA), IR-08 (says signed), IR-13 (final draft), IR-14 (report). BATON out: FIN-06 (NDA sent), FIN-09 (supplementary), FIN-11, FIN-12 and FIN-13 (receipts are matched by Meena, D113).
- **How to mark:** write Pass or Fail for every step in `../signoff-sheet.csv` (same step number). A Fail needs a defect (see `../defect-intake.md`). P1 = go-live blocker if it fails. P2 = needs a written workaround if it fails.
- **Labels:** "Refused check" means the seat must be denied. Passing it means you were stopped, with a sentence on the page and no browser pop-up.

## FIN-01 · Sign in and read Today
*Step · P1 · Must · [M03-S01], [M05-S07]*

- **Do:** Sign in. Open Today.
- **Expect on screen:** Today opens on the Investors side. 'Waiting on you' lists payment claims with 'Answer it', balances due, and 'Send the supplementary agreement' for the new investor. Shows when figures were last read from Zoho.
- **Expect in Zoho:** Finance Ops role and profile. Read only.

## FIN-02 · Check the seeded book
*Seeded data check · P1 · Must · [M09-S01], [M09-S03], [M11-S02]*

- **Do:** Open Investors. Press 'Balance outstanding'. Open Prakash Bhat.
- **Expect on screen:** List reads '15 on the book · 40 units'. 'Balance outstanding' lists exactly Prakash Bhat and Joseph Mathew. Prakash's banner reads '₹22.5 L due in 21 days...'. Sections: Who they are, What they hold, Money, Paper, Journey, Tickets. One row per farm allotment. PAN and Aadhaar hidden; bank masked.
- **Expect in Zoho:** Contacts and allotments read live.

## FIN-03 · Add an investor who has already paid
*Step · P1 · Must · [M09-S09], [M01-S08]*

- **Do:** Press Add investor. Fill name, email, mobile, farm, units, amount paid, investment date. Save. Then try the same email again.
- **Expect on screen:** One Contact with 'App: on hold - data synced, sign-in locked'. No email is sent to the investor. The second try is refused with a link to the existing investor.
- **Expect in Zoho:** Contacts: App_Access = Hold. Allotment created in LLP_UnitAllocation_Module in one save. If the connection drops: 'Not saved yet'.

## FIN-04 · Upload a document to an allotment
*Step · P1 · Must · [M12-S02], [M12-S01]*

- **Do:** Open the allotment. Upload a PDF into a typed slot. Then try a 25 MB file and a .exe.
- **Expect on screen:** The PDF appears in the list on the next read. The big file and the .exe are refused in the page, nothing sent.
- **Expect in Zoho:** Slot file field holds the PDF; Zoho shows Meena as uploader. No copy kept by the console.

## FIN-05 · Check paper by scope
*Step · P2 · Must · [M12-S03], [M12-S01]*

- **Do:** Open Documents and an investor's Paper section.
- **Expect on screen:** Grouped Personal (Contact), per allotment (per farm), Farm documents (LLP). 'Out for signature' shows a count and the Zoho Sign status.
- **Expect in Zoho:** Read only.

## FIN-06 · Send the NDA for signature
*Step · P1 · Must · [M12-S04]*

- **Do:** BATON in: IR-05. Open UAT Lead A. Choose the NDA template with email OTP. Check the prefilled name and email. Send. Press Send again.
- **Expect on screen:** Round reads 'Out for signature - the IR is chasing'. The second send is refused naming the request already out. For an NRI, Aadhaar eSign says not available and offers email OTP.
- **Expect in Zoho:** NDA sign request id, status Sent, sent time and method in one save (NDA fields on the Lead per D79; on the allotment once it exists per M02-S14).

## FIN-07 · Read the IR's word beside the queue
*Step · P2 · Must · [M12-S11]*

- **Do:** BATON in: IR-08. Open Today.
- **Expect on screen:** 'Check the signed ...' is at the top, tagged 'check it', saying what the IR said and that it is not a signature. A different document for the same investor says 'no word from the IR yet'.
- **Expect in Zoho:** No change. The IR's word is not a signature.

## FIN-08 · Watch the signature come back
*Step · P1 · Must · [M12-S05], [M12-S06]*

- **Do:** Have the tester sign as the investor. Refresh. On a spare request press Send a reminder. Recall another with a reason.
- **Expect on screen:** Row moves to Viewed, then Signed. Reminder shows its time. Recall asks a reason first, then reads Recalled. A declined request goes to the top of the queue with its reason.
- **Expect in Zoho:** Status read from Zoho Sign and written once. Signed PDF and certificate filed to the slot. NDA-signed set in the same action.

## FIN-09 · Send the supplementary agreement
*Step · P1 · Must · [M12-S12], [M12-S04], [M12-S06]*

- **Do:** BATON in: IR-13. Open Send for the allotment. The agreed draft is offered as the PDF. Choose Aadhaar eSign. Send. Have the tester sign.
- **Expect on screen:** The agreed draft is offered. After signing, Agreement_Signed is set and the lead's supplementary gate opens on the IR's next read. BATON out: tell the IR.
- **Expect in Zoho:** Allotment: Agreement_Sign_Request_Id, Agreement_Sign_Status = Sent then Signed, Agreement_Signed = true, signed PDF attached.

## FIN-10 · Verify a paper signed on paper
*Step · P2 · Must · [M12-S06]*

- **Do:** On a spare allotment upload a scanned signed copy. Enter a reference. Press 'The signed copy is here'.
- **Expect on screen:** Filed in the slot and marked verified by Meena. Joseph Mathew's FEMA row clears once his declaration is completed.
- **Expect in Zoho:** Slot file present; verification fields = Meena and time. Same checks as a Zoho Sign paper.

## FIN-11 · Answer IR payment reports
*Step · P1 · Must · [M10-S03], [M05-S07]*

- **Do:** Open 'Waiting on you'. On UAT Lead A's report press Answer it, then 'Not there yet' with a reason. On Prakash Bhat's report (from Rohit) press Answer it, then 'Confirm and record it'.
- **Expect on screen:** Drawer shows the IR's words, already paid, outstanding and hold end. 'Not there yet' leaves the IR's report as written. 'Confirm and record it' lists a balance receipt for Prakash Bhat of ₹22.5 L, RTGS HDFC2708994, by Meena, linked to the report and the allotment.
- **Expect in Zoho:** Receipts: new record, Created_By = Meena, Match_State = Matched, Matched_By = Meena (D113; the IR's claim stayed pending until Meena confirmed it). The claim is linked. UAT Lead A's report stays as written.

## FIN-12 · Record the advance for UAT Lead A
*Step · P1 · Must · [M08-S03], [M10-S07], [M01-S08]*

- **Do:** Open the investor's Money. Press Record a receipt for the 10% advance. On an investor with two farms, first try to save without picking an allotment.
- **Expect on screen:** Save is refused until an allotment is picked. The receipt lists as advance, by Meena, under that farm, and shows matched (D113). If the supplementary is not verified it says 'cannot be matched until the supplementary is verified' but is recorded, never refused.
- **Expect in Zoho:** Receipts: linked to the allotment (Contact and LLP follow it). One record on a double press.

## FIN-13 · Record a balance by SWIFT
*Step · P2 · Must · [M08-S03]*

- **Do:** Open Money on another investor's allotment. Record a balance by SWIFT with reference EMIR0209900.
- **Expect on screen:** Listed as balance, SWIFT EMIR0209900, by Meena, under that farm.
- **Expect in Zoho:** Receipts: one record, linked to the allotment.

## FIN-14 · A recorded receipt is already matched
*Step · P1 · Must · [M10-S02], [M01-S08]*

- **Do:** Open Payments. Open the receipt Meena recorded in FIN-12 or FIN-13.
- **Expect on screen:** It shows matched, by Meena, and offers no 'Match it'. No second person is asked. (An IR's payment report, a claim, stays pending until Finance confirms it.)
- **Expect in Zoho:** Receipts: Match_State = Matched, Matched_By = Meena (D113 item 1).

## FIN-15 · Work offline
*Step · P2 · Must · [M01-S08], [M01-S09]*

- **Do:** Turn the network off in the browser. Press Record it on a receipt. Press it twice. Sign out with the save pending.
- **Expect on screen:** Ledger unchanged. Drawer stays open saying 'Not saved yet'. Header says '1 change waiting'. Twice still means one pending entry. After sign-out the pending save is discarded.
- **Expect in Zoho:** No Receipts record until Zoho acknowledges.

## FIN-16 · No unit is sold twice
*Refused check · P1 · Must · [M11-S07]*

- **Do:** Record a 10% advance for a 2-unit investor on a farm with no free units.
- **Expect on screen:** In-page refusal says the farm has no free units. No reserved allotment is created.
- **Expect in Zoho:** LLP_UnitAllocation_Module: no new record. The Zoho guard refuses too.

## FIN-17 · Upload the weekly bank statement
*Step · P1 · Must · [M10-S05], [M10-S01]*

- **Do:** On Payments press 'Upload the bank statement' with the sample file.
- **Expect on screen:** Each line is matched to a receipt (UTR, amount, date) or listed under 'needs an owner', debits included. A line matching a receipt recorded by someone else sets matched by and matched at.
- **Expect in Zoho:** Statement file stored in Zoho. Receipts: Matched_By and Matched_At set on matched ones.

## FIN-18 · Read the payments register
*Step · P2 · Must · [M10-S01]*

- **Do:** Open Payments.
- **Expect on screen:** Register shows received, refunded, net banked and still due. Filters: Everything, Advances, Full and balance, Refunds and forfeits, Not reconciled. UTR reads masked unless revealed.
- **Expect in Zoho:** Read only.

## FIN-19 · Mark a monthly payout paid
*Step · P1 · Must · [M10-S20]*

- **Do:** Open an allotment, Payouts tab. Also open 'payouts due this month' on Payments. Mark one payout paid with mode and UTR.
- **Expect on screen:** Schedule shows Scheduled/Paid/Held/Failed/Cancelled. Marked payout reads Paid. TDS is optional, typed by Finance; the app never computes it.
- **Expect in Zoho:** Investor Payouts: Payout_State = Paid, Paid_On, Payout_Mode, Payout_UTR, Paid_By = Meena, Net = Gross - TDS. Double press writes once.

## FIN-20 · Tickets: open and close
*Step · P2 · Must · [M13-S02], [M13-S03]*

- **Do:** Open Tickets. Open a Records ticket for a seeded investor. Close 'Add a nominee'. Open a Bank ticket.
- **Expect on screen:** Open shows 7 after the new ticket; closed lists 3. A Bank ticket this seat cannot handle says it needs such a seat and offers no Close it.
- **Expect in Zoho:** Cases: new record owned by Meena; closed one has status Closed.

## FIN-21 · Publish an investor update
*Step · P2 · Must · [M13-S06], [M13-S01]*

- **Do:** Open Investor updates. Publish a Statement to everyone on the book.
- **Expect on screen:** New update is first in the list and reads 'Sent to <n> investors - everyone on the book'. Screen says the audience and the count at publish time.
- **Expect in Zoho:** Investor_Updates: audience stored as the rule plus count. Push to the app is logged as sent or 'not delivered yet'.

## FIN-22 · Things Finance must not do
*Refused check · P1 · Must · [M08-S04], [M11-S04], [M03-S08]*

- **Do:** Open a lapsed reservation. Open Farms. Open a pending KYC. Open a PAN.
- **Expect on screen:** 'Release the reservation' is not offered. 'Release' and 'Take it back' are not offered. 'Work the KYC' is not offered. PAN is hidden from this profile; bank number masked until a logged reveal.
- **Expect in Zoho:** Zoho refuses the writes too: farm release fields (Head of Finance only), KYC (Compliance only).

---
Seat holder sign-off: name ____________  date ________  result: all Must steps passed / not passed
