# Support model and issue intake (M20-S04)

Written 4 Oct 2026. It reuses `docs/uat/defect-intake.md`. That page stays the source for the seven things a report carries. Times marked **proposed** are mine. The owner may change them.

## 1. One way to report a problem

Send one report to Sahil, by the form or by email. One problem, one report. Both land in the same place.

- The form link or mailbox address: **OPEN — owner** (the story says "a form or email to Sahil"). Put it in every guide when set.
- Do not report in chat, by phone, or in a hallway only. If someone tells Sahil that way, Sahil writes it up as a report himself.

### What a report carries (from `defect-intake.md`)
1. **Page and step.** The page name, or the step number if it came from a script.
2. **Seat and time.** Who you were signed in as and when it happened.
3. **Record id.** The Zoho id from the address bar or the record page. Ids only. Avoid typing an investor's name.
4. **What you expected.**
5. **What you saw.** One or two short sentences, with the exact words on the page.
6. **Screenshot.** Whole browser window with the address bar.
7. **Severity.** Your first guess. Sahil confirms.

Never put a PAN, Aadhaar, bank number, password or token in a report or screenshot. If the screen showed you one and it should not have, say so in words and blur it in the picture. That report is the top severity.

## 2. Where it lands

Sahil logs each report as one line with a severity in the defects list, in the same shape as `defect-intake.md`:

```
- [ ] D-014 (support, Sahil) S1 KAM, page Investors - Rupee amount on the investor page - Expected: none; saw: an amount. Record: <id>. Screenshot: <file>.
```

- During UAT the list is `autopilot/console/BLOCKED.md` (UAT-D ids). After go-live the home of the list is **OPEN — owner** (BLOCKED.md or the tracker). The report shape does not change.
- A line is ticked only when the retest passes.
- A report that is a question, not a fault, gets an answer and no defect line.

Test TC-E17-004 passes when a Defects row appears with page, time, reporter and severity.

## 3. Severity and response (proposed)

Support uses S1 to S4. UAT uses P1 to P3 (`defect-intake.md`). They map like this so no report is lost:

| Support | UAT | Means | Examples |
|---|---|---|---|
| **S1** | P1 | Money, identity or another person's records are at risk, or a seat cannot do a Must task at all | A KAM sees a rupee amount, PAN or bank number. An IR opens another IR's lead. A receipt written twice. Zoho and the screen disagree on money. Nobody can sign in. |
| **S2** | P2 | The task fails or is wrong but can be done another way | Button missing but the same thing can be done from another page. Wrong count in a tile. |
| **S3** | P3 | Wording, layout, a Should step | A typo. A column too narrow on a phone. |
| **S4** | none | A question, a request or a wish. Not a fault. | "How do I move an account?" "Can we add a column?" |

Response clocks. The floor is fixed by the story: **an S1 gets a response the same working day** (M20-S04 acceptance 3). The rest is proposed.

| | First response | Decision (fix now, workaround, or park) | Fix |
|---|---|---|---|
| S1 | Same working day. During hypercare, within 1 hour in working hours | Same day | Fixed and retested, or rollback (`go-live-checklist.md` section 4) |
| S2 | Same working day | Next working day | Fixed, or a written workaround the seat holder accepts |
| S3 | Within 3 working days | At the weekly review | Batched after go-live, listed |
| S4 | Within 3 working days | n/a | Answer given. A request goes to change control |

Working days and hours: **OPEN — owner** (assumed Monday to Friday). These are proposed, not agreed.

If an S1 is about identity or money leaking: stop that work, tell Sahil at once, nobody else continues on that seat until Sahil says so (`defect-intake.md`). Then `ops/runbooks/pii-leak.md`.

## 4. Tiers

| Tier | Who | Does | Hands on when |
|---|---|---|---|
| 0 | The person, with their quick guide (`docs/launch/guides/`) | Tries the guide's "if something goes wrong" step. Retry once. Reload on a conflict. | It is not solved in a few minutes |
| 1 | The seat's lead: IR Manager for IRs, Head of Finance for Finance, Head of AM for KAMs (proposed). Compliance and Digital Infrastructure go straight to tier 2. | Answers how-to questions, checks the person did the step as written, confirms whether it is a real fault | Not a how-to, or any S1 |
| 2 | Sahil, Digital Infrastructure | Confirms severity, logs the line, reads Plane B for the page and time, decides fix, workaround or park | A code fix or a Zoho setup change is needed |
| 3 | The build (the autopilot loop or a developer) for code. Sahil or the owner for Zoho setup. Zoho or the Sign provider for a vendor fault. | Fixes, tests, releases through the pipeline | Fix released and retested by tier 2 |

Rule from CLAUDE.md: nobody fixes a problem by acting as the integration user or by editing a record by hand.

## 5. Escalation to Sahil and beyond

- **Everything that is not solved at tier 0 or tier 1 goes to Sahil.** Any S1 goes to Sahil immediately, whatever the tier.
- **If Sahil does not respond** within the S1 clock: the deputy. **OPEN — owner** to name the deputy and the phone number.
- **Beyond Sahil:** the owner decides rollback, restore, investor notice. **OPEN — owner** to name the person.
- **Leak that reached someone not entitled to it:** it may be a notifiable event. Counsel is the next call, not a later one (`ops/runbooks/pii-leak.md`, Q20). Name: **OPEN — owner**.
- **Vendor faults** (Zoho, Zoho Sign): Sahil opens the vendor ticket. How to reach each vendor's support: **OPEN — owner** (accounts are owner-controlled).

## 6. During UAT and hypercare

- UAT: use `defect-intake.md` as written. Its clocks are for the six UAT days.
- Hypercare (first two weeks): Sahil triages new reports twice a day and at the daily review (`docs/ops/hypercare.md`). Each day's new reports are counted in the log.
- After hypercare: the weekly review of S3 and S4, once a week. Day of the week: **OPEN — owner**.

## 7. Open items

| # | Item | Owner |
|---|---|---|
| 1 | Form link or mailbox | owner |
| 2 | Where the defects list lives after go-live | owner |
| 3 | Working days and hours | owner |
| 4 | Deputy for Sahil and phone numbers | owner |
| 5 | Who decides rollback, restore, investor notice | owner |
| 6 | Counsel's name | owner |
| 7 | Vendor support contacts | owner |
| 8 | Agreement to the proposed response times | owner |
