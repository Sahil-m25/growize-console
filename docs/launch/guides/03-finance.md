# Quick guide: Finance (Finance Operations)

Seat: Finance Operations, Investors side. Dated 4 Oct 2026. Screenshots from staging go here when staging exists.

## Your job in one line
Send papers for signature, record the money that arrives, answer the IR's payment reports and reconcile the bank statement every week.

## Start of day
1. Sign in with Zoho.
2. **Today** opens on the Investors side. **Waiting on you** lists payment reports from IRs ("Answer it"), balances due, and "Send the supplementary agreement" for new investors. It shows when the figures were last read from Zoho.

## Your day
**Send the NDA.** Open the lead, choose the NDA template with email OTP, check the prefilled name and email, press **Send**. A second send is refused while one is out. For an NRI, Aadhaar eSign says not available: use email OTP. The IR chases the investor. When the IR says it is signed, "Check the signed ..." sits at the top with the note that the IR's word is not a signature. Watch the status move to Viewed, then Signed. You can **Send a reminder** or **Recall** (a reason is asked first).

**Send the supplementary agreement.** Open Send for the allotment. The IR's agreed draft is offered as the PDF. Choose the signing method and send. After signing, the IR's gate opens on their next read.

**Paper signed on paper.** Upload the scanned signed copy, enter a reference, press **The signed copy is here**. It is filed and marked verified.

**Answer an IR's payment report.** Press **Answer it**. If you cannot find the money, press **Not there yet** and give a reason. The IR's words stay as written. If you find it, press **Confirm and record it** with the bank reference.

**Record a receipt.** Open the investor's **Money** and press **Record a receipt** (advance, balance, SWIFT and so on). If the investor has two farms, pick the allotment first. Recording is always allowed. If the supplementary is not verified yet, it says so but still records.
A receipt you record is matched (D113, 4 Oct): automatically from the bank statement where possible, otherwise by you by hand. No second person is needed. An IR's payment report stays pending until you confirm it. Refunds and money leaving need the Head of Finance's second hand (D22).

**No unit is sold twice.** If the farm has no free units, the page refuses and creates nothing.

**Add an investor who already paid.** Press **Add investor**, fill the form, save. The app account opens **On hold**. No email goes to the investor. A repeat email is refused with a link to the existing investor.

**Upload a document.** Open the allotment, upload a PDF into a typed slot. Files over 20 MB and file types like .exe are refused.

**Weekly bank statement.** On **Payments** press **Upload the bank statement** (CSV, up to 2 MB, one week). Each line matches a receipt or shows under "needs an owner", debits included. Work the lists. Full steps: `docs/runbooks/weekly-reconciliation.md`.

**Payouts.** Open the allotment's Payouts tab, mark a payout paid with mode and UTR. TDS is optional and typed by you. The app never calculates it.

**Tickets and updates.** Close Records tickets. A Bank ticket you cannot handle offers no Close. Publish a Statement to everyone on the book from **Investor updates**.

**Offline.** If the network drops, a receipt is not saved. The drawer says "Not saved yet" and the header shows "1 change waiting". Pressing twice still makes one entry. Signing out discards it.

## What you will not see
- You cannot release a reservation, release or take back farm units. Only the Head of Finance.
- You cannot work KYC. Only Compliance.
- PAN is hidden. The bank number is masked until a logged reveal.

## End of day
Sign out. If a save is pending, it is discarded.

## If something goes wrong
Report with `docs/launch/support-model.md`. For a money question call the Head of Finance. Never edit a receipt: a wrong receipt is reversed and re-recorded.

Source: UAT-FIN (FIN-01 to FIN-22).
