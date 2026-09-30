# UAT defect intake

Use this page when something is wrong, or when a "Refused check" did not refuse. It takes two minutes. One problem, one report. [M18-S08-H6, M20-S04]

## Report it

Send these seven things to Sahil (by the form or by email). Put the defect id in the `defect_id` column of `signoff-sheet.csv` on the failed step.

1. **Step.** The step number, for example `FIN-11`. If it is not from a script, write "exploratory" and the page name.
2. **Seat.** Who you were signed in as (Rohit, Meena, and so on) and the time it happened.
3. **Record id.** The Zoho record id from the address bar or the record page (Lead, Contact, Allotment, Receipt, Case). Ids only. Do not type an investor's name in the report if you can avoid it.
4. **What you expected.** Copy the "Expect on screen" or "Expect in Zoho" line from the step.
5. **What you saw.** One or two short sentences. Include the exact words on the page if there was a message.
6. **Screenshot.** The whole browser window, with the address bar. For a refusal that did not happen, show the page that opened.
7. **Severity.** Your first guess, using the table below. Sahil confirms it.

Never put a PAN, Aadhaar number, bank number, password or token in the report or the screenshot. If your screen showed one and you should not have seen it, say so in words and blur it in the picture. That report is a P1.

## Severity

| Severity | Means | Examples |
|---|---|---|
| **P1** | Go-live blocker. Money, identity or another person's records are at risk, or a Must step cannot be done at all. | A KAM sees a rupee amount, PAN or bank number. An IR opens another IR's lead. Finance matches their own receipt. A receipt is written twice. The Zoho record and the screen disagree on money. |
| **P2** | The step fails or is wrong, but the work can be done another way. Needs a written workaround. | A button is missing but the same thing can be done from another page. Wrong count in a tile. A message is confusing but the outcome is right. |
| **P3** | Wording, layout or a Should step. Fix after go-live if needed. | A typo. A column too narrow on a phone. |

## Where it lands

Sahil turns each report into one line in `autopilot/console/BLOCKED.md`, in the same shape as its other lines, so the tracker counts it:

```
- [ ] UAT-D014 (M18-S08, Sahil, Testing phase) P1 KAM Imran, step KAM-05 — Rupee amount on the investor page — Expected: no amount on any KAM page; saw: an amount under Care. Record: Contact <record id>. Screenshot: uat-evidence/UAT-D014.png. Story M03-S07.
```

- The id is `UAT-D` and a running number, one per defect.
- Tick the box (`[x]`) only when the retest passes (see "After a fix").
- A P2 line ends with `Workaround: …`. No P2 stays open without one.
- If the team uses GitHub issues, open one issue with the same title, the labels `uat` and `P1`, `P2` or `P3`, and the id in the title. The BLOCKED.md line is the record; the issue is a convenience.
- Screenshots go in `uat-evidence/` (or the team's shared folder) named with the defect id. Nothing with identity data in it.
- The fix is a job for the autopilot [M18-S08-T08]; the tester retests it [M18-S08-T09].

## How fast it is looked at

These are proposed for the six UAT days; the owner may change them. The floor comes from the support model: a top-severity report gets a response the same working day [M20-S04].

| Severity | First response | Decision (fix now, workaround, or park) | Fix and retest |
|---|---|---|---|
| **P1** | Within 1 hour in UAT hours | Same day | Fixed and retested before go/no-go |
| **P2** | Same day | By the next morning | Fixed, or workaround written and accepted by the seat holder, before go/no-go |
| **P3** | By the end of UAT | At go/no-go | After go-live, listed |

If a P1 is about identity or money leaking, the tester stops that scenario, tells Sahil at once, and nobody else continues on that seat until Sahil says so.

## After a fix

1. Sahil marks the line "fixed" and names the build.
2. The tester repeats the failed step and the two steps before it. Pass: write Pass in the sheet, put the retest date in `notes`, and tick the line.
3. On Day 6 the regression pack re-runs. If a previously passing case now fails, it is a new defect, one severity higher than you would otherwise give it [M18-S08, TC-E15-033].

## Go/no-go

Held on Day 6 with the seat holders and Sahil. Go needs: no open P1, every open P2 has a workaround, every Must scenario passed by its real seat holder. Any go-live blockers go on a list Sahil signs (see `README.md`).
