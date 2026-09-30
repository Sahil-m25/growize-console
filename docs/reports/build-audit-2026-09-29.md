# Build audit — 2026-09-29

134 built stories, each judged by Jev: does the recorded build match the acceptance, the cited decisions and the nine rules? Verdicts: aligned · drifted · incomplete · unclear. Jev sorts; a person reads every flagged row. Calls 134, input tokens 239931.

## Drifted, decisive (≥0.7) (1)

| Story | Verdict | Drifts from | Title | Last note |
|---|---|---|---|---|
| M02-S13 | drifted 0.71 | — | Document-slot file-upload fields on the Contact, the allotment and the | [undefined waiting] File-upload slots created: Contacts PAN_Proof/Bank_Proof/FEMA_Declaration; allotment Supplementary_Agreement/Allocation_Letter/Unit_Certificate; LLP LLP_Deed/Insurance_Policy_Docum |

## Incomplete, decisive (≥0.7) (1)

| Story | Verdict | Drifts from | Title | Last note |
|---|---|---|---|---|
| M19-S01 | incomplete 0.71 | D63 0.22 | UI test contract | [fe done] no UI cases; screens built from the acceptance criteria on demo data (unit-tested rules) |

## Flagged, weak (<0.7) or unclear (18)

| Story | Verdict | Drifts from | Title | Last note |
|---|---|---|---|---|
| M02-S11 | drifted 0.67 | — | Decide the canonical allotment module: LLP_UnitAllocation_Module or LL | [undefined waiting] Decided by the owner: LLP_UnitAllocation_Module is canonical (D75); the duplicate LLP_Unit_Allocation's extra fields were removed (D77). |
| M04-S03 | unclear 0.65 | — | Contact permission at capture | [fe done] Jev run 28 Sep: app 2/2 vs prototype 2/2 |
| M02-S03 | drifted 0.5 | — | Custom modules for the lead side; LLP modules adopted | [undefined done] Touches, Investor_Updates, Mail_Templates, Sales_Plans, Lead_Events, Investor_Payouts modules created; LLP_Creation_Module and LLP_UnitAllocation_Module adopted. Applied in Zoho from  |
| M07-S02 | unclear 0.47 | — | Logging flow — one question at a time | [fe done] Jev run 28 Sep: app 6/6 vs prototype 6/6 |
| M16-S07 | unclear 0.46 | — | Open a month to its investors | [fe done] Jev run 28 Sep: app 2/2 vs prototype 2/2 |
| M01-S07 | incomplete 0.43 | — | Refusals and confirmations said in the page, never in alert() or confi | [fe done] Jev run 28 Sep: app 3/4 vs prototype 3/4 |
| M02-S04 | incomplete 0.4 | — | Roles, profiles, Private sharing and the field-level security wall for | [fe done] Jev run 28 Sep: app 6/7 vs prototype 6/7; TC-IM04-012 borderline (0.77-0.8), passed on rerun or fails on the prototype at this hour |
| M20-S08 | incomplete 0.35 | — | Buy the Zoho Sign plan and set up its webhooks | [zoho waiting] Local HMAC, India-DC OAuth refresh, source re-read, request-id binding, callback limits and failure logs pass 74 recorded-response tests plus 3 sandbox-reset tests. Waiting on paid plan |
| M05-S03 | unclear 0.34 | — | Paperwork 'your move' on Today | [fe done] Jev run 28 Sep: app 2/2 vs prototype 2/2 |
| M02-S02 | incomplete 0.33 | — | Lead fields, rungs and picklists per the mapping | [undefined waiting] Lead fields (27), Lead_Event lookup and the 10 ladder values in Lead_Status are live. 6 old default values remain only because the sample Blueprint 'Lead nurturing process' (inacti |
| M09-S04 | incomplete 0.26 | — | Who looks after the account — KAM ownership | [zoho waiting] KAM assign built and tested; waiting on the KAM workflow and field security (T01), the care drawer and sandbox proof. |
| M01-S06 | unclear 0.25 | — | Pending saves while offline | [fe done] Jev run 28 Sep: app 0/1 vs prototype 0/1 |
| M06-S02 | incomplete 0.24 | — | Filters, sort and the Overdue fix | [fe done] Jev run 28 Sep: app 3/4 vs prototype 3/4 |
| M05-S04 | drifted 0.23 | — | Call times and reschedule | [zoho waiting] Reschedule moves the lead step and its Call/Meeting/Task together with 10 s Undo, 2 tests; waits on activity access (M02-S07) and the tester's reminder check. |
| M07-S01 | incomplete 0.23 | — | Lead page shell and Next step card | [fe done] Jev run 28 Sep: app 3/4 vs prototype 3/4 |
| M20-S07 | incomplete 0.23 | — | Bring the investor app codebase into the repo and wire the contract re | [zoho waiting] Contract validation, signing, stub receiver, signed push and request.raised to Case with 5 tests; waits on the app codebase, signing keys, the Plane B/C store and Cases proof. |
| M07-S07 | unclear 0.2 | — | Latest note, all notes and inline note | [fe done] Jev run 28 Sep: app 2/2 vs prototype 2/2 |
| M17-S06 | drifted 0.16 | — | System health and administration | [zoho waiting] System checks computed from Plane B and held facts with owners and fixes, DI only, 3 tests; waits on a licence-expiry source and the Plane B/C store. |

## Aligned (114)

M01-S01 0.46 · M01-S02 0.57 · M01-S03 0.84 · M01-S04 0.74 · M01-S05 0.7 · M01-S08 0.44 · M01-S09 0.62 · M01-S10 0.53 · M02-S05 0.6 · M02-S08 0.67 · M02-S09 0.86 · M02-S10 0.35 · M02-S12 0.23 · M02-S14 0.46 · M03-S01 0.47 · M03-S02 0.77 · M03-S03 0.69 · M03-S04 0.51 · M03-S05 0.53 · M03-S06 0.32 · M03-S07 0.82 · M03-S08 0.2 · M03-S09 0.77 · M04-S01 0.52 · M04-S02 0.53 · M04-S04 0.37 · M05-S01 0.38 · M05-S02 0.59 · M05-S06 0.65 · M05-S07 0.56 · M05-S08 0.71 · M06-S01 0.43 · M06-S03 0.71 · M06-S05 0.95 · M07-S03 0.58 · M07-S04 0.8 · M07-S05 0.65 · M07-S06 0.5 · M08-S01 0.48 · M08-S02 0.52 · M08-S03 0.36 · M08-S04 0.72 · M08-S05 0.79 · M08-S07 0.43 · M08-S08 0.43 · M09-S01 0.55 · M09-S02 0.51 · M09-S03 0.63 · M09-S07 0.54 · M09-S08 0.72 · M09-S09 0.81 · M10-S01 0.38 · M10-S02 0.79 · M10-S03 0.65 · M10-S05 0.51 · M10-S07 0.84 · M10-S08 0.5 · M10-S09 0.54 · M10-S20 0.64 · M10-S21 0.55 · M10-S22 0.5 · M10-S23 0.63 · M11-S01 0.48 · M11-S02 0.5 · M11-S03 0.47 · M11-S04 0.77 · M11-S05 0.78 · M11-S07 0.75 · M12-S01 0.45 · M12-S02 0.62 · M12-S03 0.44 · M12-S04 0.89 · M12-S05 0.75 · M12-S06 0.74 · M12-S07 0.39 · M12-S08 0.56 · M12-S09 0.56 · M12-S11 0.67 · M12-S12 0.68 · M12-S13 0.43 · M12-S14 0.35 · M13-S01 0.87 · M13-S02 0.43 · M13-S03 0.4 · M13-S04 0.62 · M13-S05 0.68 · M13-S06 0.64 · M14-S01 0.3 · M14-S02 0.67 · M14-S03 0.73 · M15-S01 0.38 · M15-S03 0.49 · M15-S05 0.67 · M16-S01 0.55 · M16-S02 0.39 · M16-S03 0.8 · M16-S04 0.24 · M16-S06 0.89 · M16-S08 0.6 · M16-S09 0.77 · M17-S01 0.59 · M17-S02 0.46 · M17-S05 0.71 · M18-S01 0.91 · M18-S02 0.88 · M18-S03 0.11 · M18-S04 0.42 · M18-S08 0.29 · M18-S12 0.84 · M19-S02 0.78 · M19-S03 0.41 · M19-S04 0.43 · M19-S05 0.58 · M19-S06 0.43
