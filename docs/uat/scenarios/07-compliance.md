# UAT-CMP — Compliance and Audit (KYC)

- **Run by:** Fahad Rizvi (Latha Prabhu shares the profile). The real seat holder runs it, not a stand-in.
- **Second person:** Finance (Meena) to prove 'Work the KYC' is not offered.
- **What this proves:** Compliance owns KYC: pass or fail it, and read identity when there is a reason. Compliance writes no money.
- **Before you start:** Joseph Mathew has KYC pending and FEMA outstanding (seed). One KYC that is already passed.
- **Hand-offs:** No baton.
- **How to mark:** write Pass or Fail for every step in `../signoff-sheet.csv` (same step number). A Fail needs a defect (see `../defect-intake.md`). P1 = go-live blocker if it fails. P2 = needs a written workaround if it fails.
- **Labels:** "Refused check" means the seat must be denied. Passing it means you were stopped, with a sentence on the page and no browser pop-up.

## CMP-01 · Sign in
*Step · P1 · Must · [M03-S01], [M18-S02]*

- **Do:** Sign in.
- **Expect on screen:** Admitted on the Investors side. Rail matches the seat matrix.
- **Expect in Zoho:** Compliance & Audit role under Head of Finance, one profile for the merged seat (D78).

## CMP-02 · Pass a pending KYC
*Step · P1 · Must · [M03-S08]*

- **Do:** Open Joseph Mathew. Press 'Work the KYC'. Press 'Pass it'.
- **Expect on screen:** 'Work the KYC' is offered and the drawer offers 'Pass it' and 'Fail it'. After: KYC reads passed.
- **Expect in Zoho:** Contacts: kyc_status written by the Compliance profile.

## CMP-03 · Fail a passed KYC after a confirm
*Step · P1 · Must · [M03-S08], [M01-S07]*

- **Do:** Open the investor whose KYC is passed. Press Fail it.
- **Expect on screen:** An in-page confirm shows the consequence and runs only on the explicit confirm button.
- **Expect in Zoho:** Contacts: kyc_status = failed.

## CMP-04 · Reveal a PAN with a reason
*Step · P1 · Must · [M01-S10], [M15-S05]*

- **Do:** Open a Contact. Press reveal on PAN. Give a reason. Pass step-up.
- **Expect on screen:** Value shows after step-up and masks again on hide or sign-out. Activity reads 'Revealed a PAN'.
- **Expect in Zoho:** Plane C log holds person, record, field, reason. PAN visible to this profile in Zoho (ACCESS-PLAN section 3).

## CMP-05 · Compliance cannot write money
*Refused check · P1 · Must · [M10-S01], [M10-S02], [M10-S05]*

- **Do:** Open Money on an investor. Open Payments.
- **Expect on screen:** No 'Record a receipt', no 'Match it', no statement upload. Receipts are readable. Bank numbers stay masked or hidden.
- **Expect in Zoho:** Zoho refuses Receipts create and edit for this profile.

## CMP-06 · A Bank ticket has no Close it here
*Refused check · P2 · Must · [M13-S03]*

- **Do:** Open Tickets. Open a Bank ticket.
- **Expect on screen:** Row says it needs a seat that can see bank accounts and offers no Close it.
- **Expect in Zoho:** Cases unchanged.

## CMP-07 · Read your own tickets and the FEMA row
*Step · P2 · Must · [M13-S02], [M12-S06]*

- **Do:** Open Tickets. Open Documents. Open Joseph Mathew's FEMA declaration.
- **Expect on screen:** FIRC (Fahad's) is listed. FEMA outstanding clears once the declaration is completed.
- **Expect in Zoho:** Read; FEMA fields on Contact.

## CMP-08 · Finance cannot work KYC (Meena)
*Refused check · P1 · Must · [M03-S08]*

- **Do:** Ask Meena to open Joseph Mathew.
- **Expect on screen:** 'Work the KYC' is not offered. A KAM or IR sees only 'clear' or 'with Finance'.
- **Expect in Zoho:** Zoho refuses a kyc_status write from any profile but Compliance.

## CMP-09 · Read Activity
*Step · P2 · Must · [M15-S03], [M15-S05]*

- **Do:** Open Activity.
- **Expect on screen:** Actions on investors, allotments, payments, documents and tickets in scope. Identity events show as events; investor details withheld where this seat lacks the right.
- **Expect in Zoho:** Read only.

---
Seat holder sign-off: name ____________  date ________  result: all Must steps passed / not passed
