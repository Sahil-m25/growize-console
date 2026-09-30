# UAT-DI — Digital Infrastructure (Sahil)

- **Run by:** Sahil Mohite. The real seat holder runs it, not a stand-in.
- **Second person:** Rohit or Tasneem, for the grant checks.
- **What this proves:** Sahil is the super user on a non-administrator Digital Infrastructure profile (D68, D110). He can reach every page and action to test them, and he runs the system checks. Finance stays the doer of money and paper; his drawers say so.
- **Before you start:** Owner has created the Digital Infrastructure profile and moved Sahil to it (M03-S05-T02, D110). Sandbox seeded. Smoke suite green.
- **Hand-offs:** No baton.
- **How to mark:** write Pass or Fail for every step in `../signoff-sheet.csv` (same step number). A Fail needs a defect (see `../defect-intake.md`). P1 = go-live blocker if it fails. P2 = needs a written workaround if it fails.
- **Labels:** "Refused check" means the seat must be denied. Passing it means you were stopped, with a sentence on the page and no browser pop-up.

## DI-01 · Sign in on the non-admin profile
*Step · P1 · Must · [M03-S05], [M03-S01], [M02-S04]*

- **Do:** Sign in. In Zoho open Setup, Users and read your own profile.
- **Expect on screen:** Console admits Digital Infrastructure. Your Zoho profile is the Digital Infrastructure profile, not Administrator. Marketing, an inactive person and an unknown role are refused at the sign-in list.
- **Expect in Zoho:** user Sahil, profile = Digital Infrastructure (least privilege), role under CEO. Administrator only on Pradeep and the super admin.

## DI-02 · Every page and both sides
*Step · P1 · Must · [M18-S02], [M05-S06], [M08-S02]*

- **Do:** Read the rail. Open each page. On Today use the 'Lead side | Investors side' switch.
- **Expect on screen:** Every page of both sides is reachable. The switch shows both halves. Drawers on Finance work carry a 'super user' note naming Finance as the doer.
- **Expect in Zoho:** Read/write as allowed by the profile.

## DI-03 · Identity stays hidden from Sahil
*Refused check · P1 · Must · [M01-S10], [M12-S10], [M15-S03]*

- **Do:** Open a Contact, a document list and Activity. Then open the same Contact in Zoho.
- **Expect on screen:** PAN, Aadhaar and bank numbers are masked or hidden on every page and in Zoho. OWNER TO CONFIRM: D110 says 'including logged reveals'; M01-S10 says 'no reveal is offered' and the profile hides the fields. Tester records what the app does.
- **Expect in Zoho:** Zoho FLS: identity fields hidden on the DI profile (M02-S04-T02).

## DI-04 · Search the whole org
*Step · P1 · Must · [M06-S03], [M06-S05], [M03-S02]*

- **Do:** Press Ctrl+K. Type a lead name from any IR. Type an investor name.
- **Expect on screen:** Per D110: leads and investors from every book, phone shown to last 4. The IR wall is unchanged for IR seats (checked in IR-18). NOTE: M06-S03 text still reads 'leads only'; wiring units M06-S03-W2 and M06-S05-W2 carry the D110 change.
- **Expect in Zoho:** Search runs on Sahil's own token. One Plane B line: searcher, count, scope, no text.

## DI-05 · Read the team's leads and the report
*Step · P2 · Must · [M06-S01], [M16-S01]*

- **Do:** Open Leads, then Numbers, Assignments by IR.
- **Expect on screen:** Leads scope is the whole team's book with an Owner filter. Every IR is listed in the report.
- **Expect in Zoho:** Read only.

## DI-06 · Grant a page, read only
*Step · P1 · Must · [M03-S02], [M17-S02]*

- **Do:** Open Teams. Grant Jhalak Leads. Ask Jhalak to sign in. Try to grant her 'edit' on Leads.
- **Expect on screen:** Jhalak reaches only Leads and Profile. She cannot edit or assign. The edit grant is refused because her seat cannot hold it. Removing her last page ends her access and logs it.
- **Expect in Zoho:** Console grant record. Log line with Sahil's name.

## DI-07 · Change a seat with step-up
*Step · P1 · Must · [M17-S02], [M01-S10]*

- **Do:** Change a test person's seat. Cancel the Zoho sign-in prompt, then pass it.
- **Expect on screen:** Step-up is asked first. The change is logged with Sahil's name. A manager change that would loop is refused.
- **Expect in Zoho:** Zoho user manager or role updated by Sahil's token; log line.

## DI-08 · Test the money and paper flows as super user
*Step · P2 · Must · [M12-S04], [M11-S04], [M09-S09]*

- **Do:** On a spare investor press Send for signature. Press Release on a farm. Add an already-paid investor.
- **Expect on screen:** Each works for testing and the drawer says Finance is the primary doer.
- **Expect in Zoho:** Records written by Sahil's own token.

## DI-09 · System health
*Step · P1 · Must · [M17-S06], [M15-S05], [M01-S04]*

- **Do:** Open System.
- **Expect on screen:** Counts of working, needs attention and not working, with owner and fix per card. Investors side shows Zoho Sign webhook health and investor-app push delivery. Zoho API credits and licence expiry come from the log.
- **Expect in Zoho:** Read from the operational log.

## DI-10 · Failed-write test
*Step · P2 · Must · [M17-S06], [M01-S08]*

- **Do:** Arm the failed-write test. Make a save.
- **Expect on screen:** The save fails once, shows the retry state, and the retry saves. Exactly one record.
- **Expect in Zoho:** One record only.

## DI-11 · Read the refusals and logs
*Step · P1 · Must · [M15-S05], [M15-S03], [M18-S02]*

- **Do:** Open Activity and the log views. Filter by a refused person.
- **Expect on screen:** Refusals from earlier scenarios appear with who, what, when, why. No names, PAN, bank or notes in the log lines.
- **Expect in Zoho:** Plane B and C hold ids and status only.

## DI-12 · Non-Digital seats cannot open System
*Refused check · P1 · Must · [M17-S06]*

- **Do:** Ask an IR Manager to open System.
- **Expect on screen:** In-page refusal.
- **Expect in Zoho:** Refusal logged.

## DI-13 · Isolation spot check
*Step · P1 · Must · [M12-S10], [M18-S02]*

- **Do:** Ask IR A for IR B's lead documents by address. Ask a KAM for an investor they do not manage. Read one page as two users inside five minutes.
- **Expect on screen:** Each is refused and logged. The second user's page carries no record from the first user's scope.
- **Expect in Zoho:** No cross-scope read.

## DI-14 · Preview and test link (optional)
*Step · P2 · Should · [M10-S22], [M10-S23]*

- **Do:** Press Preview on an investor. Press 'Create test sign-in link' with a reason on a test account.
- **Expect on screen:** Preview is labelled 'Preview - mock-up, not the live app'. The link is one-time, expires in 10 minutes, nothing is emailed. Audit row appears on System.
- **Expect in Zoho:** Audit row: who, whom, when, why, when used.

## DI-15 · Push to the app
*Step · P1 · Must · [M13-S01], [M17-S06]*

- **Do:** Trigger an account.opened or an update. Read System.
- **Expect on screen:** Event is signed and reaches the stub receiver. If the receiver is down it reads 'not delivered yet', never 'delivered'. The same event twice is processed once.
- **Expect in Zoho:** Delivery result logged. No identity in the payload.

## DI-16 · Run the smoke suite before and after
*Step · P1 · Should · [M19-S07]*

- **Do:** Run the smoke suite on staging at the start and again after the last fix.
- **Expect on screen:** All 6 cases (sign in, Today, open a lead, save a note on a test lead, search, sign out) pass in under 3 minutes.
- **Expect in Zoho:** Test lead only.

---
Seat holder sign-off: name ____________  date ________  result: all Must steps passed / not passed
