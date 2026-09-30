# UAT-HAM — Head of Account Management

- **Run by:** Divya Kamath. The real seat holder runs it, not a stand-in.
- **Second person:** Imran and Neha, to check the change of manager.
- **What this proves:** The Head of AM assigns each investor to a KAM and watches the book. No money.
- **Before you start:** Vikram Anand is seeded as Tier B with no manager. KAM scenario ready to receive the new investor from IR-12.
- **Hand-offs:** BATON out: HAM-04 (investor assigned to Imran, for KAM-02).
- **How to mark:** write Pass or Fail for every step in `../signoff-sheet.csv` (same step number). A Fail needs a defect (see `../defect-intake.md`). P1 = go-live blocker if it fails. P2 = needs a written workaround if it fails.
- **Labels:** "Refused check" means the seat must be denied. Passing it means you were stopped, with a sentence on the page and no browser pop-up.

## HAM-01 · Sign in and read Today
*Step · P1 · Must · [M03-S01], [M05-S08]*

- **Do:** Sign in. Open Today.
- **Expect on screen:** Vikram Anand is listed 'Tier B and nobody is looking after them' with 'Assign manager'. No banked or outstanding figure.
- **Expect in Zoho:** AM Head role and profile under BU Owner.

## HAM-02 · Read the whole book
*Step · P1 · Must · [M09-S02]*

- **Do:** Open Investors. Press 'No manager'.
- **Expect on screen:** 13 allotted accounts including the pool are listed. 'No manager' lists only Vikram Anand. No Paid, Due or KYC column.
- **Expect in Zoho:** Read on Contacts through the role tree.

## HAM-03 · Name a manager
*Step · P1 · Must · [M09-S04], [M03-S07]*

- **Do:** Open Vikram Anand. Press Assign manager. Look at the dropdown, then pick Neha Bhandari.
- **Expect on screen:** Each KAM is shown with account count and how many have gone quiet. After: Manager reads Neha Bhandari and Handed over reads 'never introduced'. Move is logged with both names.
- **Expect in Zoho:** Contacts: KAM = Neha, intro_at cleared. Record shares: Neha gets Contact, allotments and Touches read-write; the old KAM's share is removed.

## HAM-04 · Assign the new investor to Imran
*Step · P1 · Must · [M09-S04]*

- **Do:** Open the investor created in IR-12. Assign Imran.
- **Expect on screen:** Manager reads Imran Sheikh. Imran sees the investor on his next sign-in (KAM-02).
- **Expect in Zoho:** Contacts: KAM = Imran. Shares as above.

## HAM-05 · Move an account and check the old KAM loses it
*Step · P1 · Must · [M09-S04], [M03-S07]*

- **Do:** Move one of Imran's accounts to Neha. Ask Imran to reload Investors.
- **Expect on screen:** Imran's list drops to the remaining accounts. Neha's list gains it, with the history from lead to investor.
- **Expect in Zoho:** Old KAM share removed; new KAM share added; Touches follow the share.

## HAM-06 · Read tickets and Numbers
*Step · P1 · Must · [M13-S02], [M16-S09]*

- **Do:** Open Tickets, then Numbers on the Investors side.
- **Expect on screen:** Tickets in the team's scope. Numbers offers only the Service section, no rupee amount.
- **Expect in Zoho:** Read only.

## HAM-07 · Publish a Produce or Notice update
*Step · P2 · Must · [M13-S06]*

- **Do:** Open Investor updates. Press Publish.
- **Expect on screen:** Only Produce and Notice kinds are offered. Statements and compliance are Finance's.
- **Expect in Zoho:** Investor_Updates: record with kind and audience.

## HAM-08 · No money, no paper, no seat changes
*Refused check · P1 · Must · [M10-S01], [M09-S03], [M17-S01]*

- **Do:** Look at the rail. Open an investor. Open Teams.
- **Expect on screen:** No Payments page. Investor page shows no Money or Paper. Teams says read only and offers no seat control.
- **Expect in Zoho:** Zoho refuses receipt and sign writes.

---
Seat holder sign-off: name ____________  date ________  result: all Must steps passed / not passed
