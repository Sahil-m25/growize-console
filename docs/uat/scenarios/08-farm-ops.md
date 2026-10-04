# UAT-FARM — Farm operations

> **Persona kept, not provisioned — D113 (4 Oct 2026).** The owner ruled that Farm ops is not provisioned now and the persona (seat definition and this script) is kept for later. Do not run this scenario at go-live. Run it only when the owner names the role, profile, capabilities and parent. The steps below stay as written.

- **Run by:** The person the owner names (open decision). The real seat holder runs it, not a stand-in.
- **Second person:** none.
- **What this proves:** Farm ops has no Zoho role or profile yet and is not provisioned now (D113 5b). Earlier note: it had no role or profile (M03-S05-NOTE-2). ACCESS-PLAN has no Farm-ops row and SEAT-PLAN combines it with Channel Partner. Do not run this scenario until the owner names the role, profile, capabilities and parent. The steps below are what M03-S05, M11 and M17 already say; the owner's answer may add or remove steps.
- **Before you start:** Owner has approved the exact role and profile name and both exist in the sandbox; ids exported; the seat policy updated (M03-S05-NOTE-2).
- **Hand-offs:** No baton.
- **How to mark:** write Pass or Fail for every step in `../signoff-sheet.csv` (same step number). A Fail needs a defect (see `../defect-intake.md`). P1 = go-live blocker if it fails. P2 = needs a written workaround if it fails.
- **Labels:** "Refused check" means the seat must be denied. Passing it means you were stopped, with a sentence on the page and no browser pop-up.

## FARM-01 · Sign in on the approved role
*Step · P1 · Must · [M03-S05], [M03-S01]*

- **Do:** Sign in as the Farm ops person.
- **Expect on screen:** Admitted as the Farm ops seat. Seat shown matches the Zoho role. A role name that is not in the policy is refused at sign-in.
- **Expect in Zoho:** the role and profile the owner approved. Not Channel Partner.

## FARM-02 · Read the farm shelf
*Step · P2 · Must · [M11-S01], [M11-S03]*

- **Do:** Open Farms if the rail offers it.
- **Expect on screen:** One row per farm with acreage, total, reserved, issued, free units and unit price. Read live from the farm records.
- **Expect in Zoho:** LLP_Creation_Module read only.

## FARM-03 · Cannot release or take back units
*Refused check · P1 · Must · [M11-S04]*

- **Do:** Look at the farm rows.
- **Expect on screen:** No 'Release' and no 'Take it back'. Only the Head of Finance has them.
- **Expect in Zoho:** LLP release fields edit refused by Zoho for this profile.

## FARM-04 · No money and no identity
*Refused check · P1 · Must · [M18-S02], [M03-S05]*

- **Do:** Open every page and drawer in the rail.
- **Expect on screen:** No rupee amount, PAN, Aadhaar reference or bank number.
- **Expect in Zoho:** FLS hides the fields.

## FARM-05 · Appears in Teams
*Step · P2 · Must · [M17-S01]*

- **Do:** Ask the Head of Finance to open Teams.
- **Expect on screen:** Farm ops is listed under Investors-side seats with team and seat.
- **Expect in Zoho:** Read from Zoho roles.

---
Seat holder sign-off: name ____________  date ________  result: all Must steps passed / not passed
