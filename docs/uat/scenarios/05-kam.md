# UAT-KAM — Key Account Manager (KAM)

- **Run by:** Imran Sheikh. The real seat holder runs it, not a stand-in.
- **Second person:** Neha Bhandari, the other KAM, for the refused checks.
- **What this proves:** A KAM looks after their own investors: logs conversations, answers tickets, hands bank and compliance tickets to Finance. A KAM never sees a rupee amount, a PAN, an Aadhaar reference or a bank number, on any page or drawer.
- **Before you start:** Sandbox seeded (Imran holds Radhika Menon, Sanjay Kulkarni, Fatima Zaidi, Deepak Chandra). Head of AM has assigned the new investor to Imran (HAM-04). The app stub receiver is up.
- **Hand-offs:** BATON out: KAM-08 (bank ticket handed to Finance). BATON in: HAM-04 (investor assigned to Imran).
- **How to mark:** write Pass or Fail for every step in `../signoff-sheet.csv` (same step number). A Fail needs a defect (see `../defect-intake.md`). P1 = go-live blocker if it fails. P2 = needs a written workaround if it fails.
- **Labels:** "Refused check" means the seat must be denied. Passing it means you were stopped, with a sentence on the page and no browser pop-up.

## KAM-01 · Sign in and read Today
*Step · P1 · Must · [M03-S01], [M05-S08]*

- **Do:** Sign in. Open Today.
- **Expect on screen:** Today reads "Imran's day" with '4 accounts · 5 waiting on you'. Tiles: gone quiet, accounts you hold, tickets open on you, conversations logged. No banked or outstanding figure. No Lead side switch.
- **Expect in Zoho:** KAM role and profile, under Head of AM.

## KAM-02 · See only your own accounts
*Step · P1 · Must · [M09-S02], [M03-S07]*

- **Do:** Open Investors.
- **Expect on screen:** Heading 'My accounts', '4 under care', exactly the 4 seeded names. No Paid, Due or KYC column.
- **Expect in Zoho:** Contacts: Zoho returns only Contacts where KAM = Imran (Private sharing plus record share).

## KAM-03 · Another KAM's accounts and unallotted investors do not appear
*Refused check · P1 · Must · [M09-S02], [M09-S07], [M03-S07]*

- **Do:** Search 'Prakash'. Search a name that belongs to Neha. Paste the address of one of Neha's investors.
- **Expect on screen:** Nobody matches. The address does not open. Nothing is read from Zoho for it.
- **Expect in Zoho:** No read. Refusal logged.

## KAM-04 · Open an account: care sections only
*Step · P1 · Must · [M09-S03], [M03-S07], [M09-S04]*

- **Do:** Open Radhika Menon.
- **Expect on screen:** Sections: Who they are, What they hold, Care, Journey, Tickets. No Money, no Paper. 'Change their details' is offered. Offered 'Log a conversation', not 'Name a manager' or 'Move the account'.
- **Expect in Zoho:** Read on Contact and allotment through the record share.

## KAM-05 · No money, no identity: sweep every page and drawer
*Refused check · P1 · Must · [TC-IM12-012], [M03-S07], [M03-S08], [M10-S01], [M16-S09]*

- **Do:** Open Today, Investors, the investor page and each drawer, Tickets, Documents, Updates, Numbers, Activity, Teams, Profile. Use the browser's Find for '₹', 'Rs', 'PAN', 'Aadhaar', 'account'.
- **Expect on screen:** No rupee amount, PAN, Aadhaar reference or bank number anywhere. PAN, Aadhaar and Bank read 'Finance only'. KYC reads only 'clear' or 'with Finance'. UTR reads 'Finance only'.
- **Expect in Zoho:** Zoho FLS hides the fields from the KAM profile. Tester also opens the same Contact in Zoho as Imran and confirms the fields are not shown.

## KAM-06 · Log a conversation
*Step · P1 · Must · [M05-S08], [M09-S04]*

- **Do:** On an account press 'Log a conversation'. Save.
- **Expect on screen:** Saved and counted on the next read (the 'conversations logged' tile goes up).
- **Expect in Zoho:** Touches: one record on the Contact by Imran (channel, time, note).

## KAM-07 · Read your tickets
*Step · P1 · Must · [M13-S02]*

- **Do:** Open Tickets.
- **Expect on screen:** Exactly Imran's 3 tickets. FIRC (Compliance's) is not listed. Neha's are not listed.
- **Expect in Zoho:** Cases: read through the hierarchy predicate.

## KAM-08 · Hand a bank ticket to Finance and keep watching
*Step · P1 · Must · [M13-S04]*

- **Do:** Open 'Change the bank account for payouts'. Press Hand it to Finance. Add the new cancelled cheque.
- **Expect on screen:** Row reads 'handed to Harsha by Imran' and offers no Close it. The cheque is filed as a personal document on the Contact and Imran cannot open it.
- **Expect in Zoho:** Cases: owner = Harsha, handed-by = Imran. Contact personal slot holds the cheque, not the Case.

## KAM-09 · Cannot close a ticket that is not yours
*Refused check · P1 · Must · [M13-S03], [M13-S02]*

- **Do:** Try Close on a ticket owned by someone else, by the button and by the address.
- **Expect on screen:** Refused on screen. Ticket unchanged.
- **Expect in Zoho:** Cases unchanged. Refusal logged.

## KAM-10 · Investor request arrives as a ticket and gets a reply
*Step · P2 · Must · [M13-S05], [M13-S01]*

- **Do:** Have the tester raise a request in the app (stub). Open the new ticket. Press 'Reply to the investor'. Save.
- **Expect on screen:** One ticket appears, owned by Imran. The thread shows. The reply is stored; if the app does not acknowledge, it reads 'Reply not delivered yet'.
- **Expect in Zoho:** Cases: one record (idempotent on app_request_id). case.replied pushed via the contract.

## KAM-11 · Pages and buttons a KAM must not have
*Refused check · P1 · Must · [M10-S01], [M12-S03], [M12-S04], [M13-S06], [M16-S09], [M10-S21]*

- **Do:** Look at the rail. Open Payments and Farms. Open Documents. Open Investor updates and press Publish. Open Numbers. Open an investor's app-access card.
- **Expect on screen:** No Payments page. No Send or Verify on documents; documents only for investors Imran manages. Publish offers only Produce and Notice. Numbers offers only Service and no rupee amount. App-access card is read-only and says Finance controls app access.
- **Expect in Zoho:** Zoho refuses KAM writes to Receipts, statements and sign fields. A KAM token on a money Numbers route is refused and logged.

## KAM-12 · Own Activity only
*Step · P2 · Must · [M15-S03]*

- **Do:** Open Activity.
- **Expect on screen:** Only Imran's own entries.
- **Expect in Zoho:** Read only.

---
Seat holder sign-off: name ____________  date ________  result: all Must steps passed / not passed
