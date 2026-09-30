# UAT-AUD — Auditor / viewer

- **Run by:** Latha Prabhu (Auditor, M03-S06); Jhalak Mehta (Exec viewer). The real seat holder runs it, not a stand-in.
- **Second person:** none.
- **What this proves:** A viewer reads and never writes. Latha runs the Auditor view; Jhalak checks a granted viewer.
- **Before you start:** Sandbox seeded. Sahil has granted Jhalak Leads (DI-06).
- **Hand-offs:** No baton.
- **How to mark:** write Pass or Fail for every step in `../signoff-sheet.csv` (same step number). A Fail needs a defect (see `../defect-intake.md`). P1 = go-live blocker if it fails. P2 = needs a written workaround if it fails.
- **Labels:** "Refused check" means the seat must be denied. Passing it means you were stopped, with a sentence on the page and no browser pop-up.

## AUD-01 · Sign in read only
*Step · P1 · Must · [M03-S06], [M05-S07]*

- **Do:** Sign in as Latha.
- **Expect on screen:** Top bar shows 'read only'. Waiting on you says nothing is waiting and that the seat is read-only.
- **Expect in Zoho:** Compliance & Audit / Viewer profile.

## AUD-02 · No write control anywhere
*Refused check · P1 · Must · [M03-S06], [M10-S01], [M12-S03], [M13-S02], [M13-S06], [M11-S03]*

- **Do:** Open an investor's Money tab, Tickets, Farms, Documents, Payments, Investor updates.
- **Expect on screen:** No 'Record a receipt', no Send, Verify, Close it, Release, Take it back, Publish, or Waiting on them. Register and Documents are readable.
- **Expect in Zoho:** Nothing changes.

## AUD-03 · A forced write is refused by Zoho
*Refused check · P1 · Must · [M03-S06]*

- **Do:** Ask the tester to send a write with Latha's token (a note on a lead).
- **Expect on screen:** Zoho's profile refuses and the console logs the refusal.
- **Expect in Zoho:** Zoho returns an error. No record changes.

## AUD-04 · Activity shows Finance's entries
*Step · P2 · Must · [M15-S03], [M15-S05]*

- **Do:** Open Activity.
- **Expect on screen:** Every Finance entry is listed, with or without investor ids per the owner's decision. Identity events read 'Identity event' and are counted.
- **Expect in Zoho:** Read only.

## AUD-05 · Read Collection if granted
*Step · P2 · Must · [M16-S09]*

- **Do:** Open Numbers on the Investors side.
- **Expect on screen:** Collection is readable for a viewer granted Finance read.
- **Expect in Zoho:** Read only.

## AUD-06 · Granted viewer reaches only what was granted
*Refused check · P1 · Must · [M03-S02], [M07-S01]*

- **Do:** Sign in as Jhalak. Open a lead. Try edit or assign.
- **Expect on screen:** Jhalak reaches Leads and Profile only. No edit, no assign, no logging buttons.
- **Expect in Zoho:** Nothing changes.

## AUD-07 · Identity is not shown
*Refused check · P1 · Must · [M18-S02], [M12-S10]*

- **Do:** Open a Contact and a document list.
- **Expect on screen:** No PAN, Aadhaar or bank number.
- **Expect in Zoho:** FLS hides the fields for this profile except where D78 gives Compliance & Audit PAN and Aadhaar; the console still masks by default.

---
Seat holder sign-off: name ____________  date ________  result: all Must steps passed / not passed
