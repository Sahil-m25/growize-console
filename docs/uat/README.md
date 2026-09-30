# Growize Console — UAT pack

This is the user acceptance test (UAT) for the Growize Console. It is the written script that each seat's real holder runs on the sandbox before go-live.
It serves story M18-S08 (subtasks M18-S08-H5 and M18-S08-H6). Every step cites the story it comes from, in square brackets.

## What is in the pack

| File | What it is |
|---|---|
| `scenarios/01-ir.md` … `10-auditor-viewer.md` | One script per seat. Each walks that seat's real day, step by step. |
| `signoff-sheet.csv` | One row per step: expected result, pass/fail, evidence, defect id, notes, tester, date. Open it in Excel or Sheets. |
| `defect-intake.md` | One page: how to report a problem, where it goes, how fast it is looked at. |

## The day the scripts follow

capture → follow-up → said yes → hand-off → money (record, second-hand match, IR claim) → paper (NDA, supplementary, Zoho Sign) → allotment → app access unlock → payout → ticket → numbers.

Two threads run through the scenarios:

- **Thread A, a new lead you create.** `UAT Lead A` is captured by the IR, gets an NDA and a supplementary agreement, says yes, pays the 10% advance, and its app account opens On hold until Finance unlocks it.
- **Thread B, seeded Prakash Bhat.** His balance is reported by the IR, recorded by Finance, matched by the Head of Finance, allotted, and the IR sees the gate clear.

Steps marked BATON need another seat to finish a step first. The scenario says which step and who.

## Entry criteria (all four, before Day 1)

1. **Sandbox live with the seeded demo book.** The Zoho Enterprise sandbox holds the manifest's records (same names as the merged prototype's demo data), and reset works [M19-S03, M02-S10]. Enterprise is renewed (it expires 13 Oct 2026) [M02-S01].
2. **Phase 2b wiring is through.** Every screen is wired to the /api routes and Zoho, not the demo reducer (D104). The front-end loop notes in `autopilot/console/BLOCKED.md` are closed.
3. **Smoke suite green on staging.** The 6 cases (sign in, Today, open a lead, save a note on a test lead, search, sign out) pass in under 3 minutes [M19-S07].
4. **Every seat has signed in once.** The real holder of each seat has signed in to staging with their own Zoho login and reached their Today page. T11 passed on every profile first, so seats exist only after the wall is proved [M02-S05, M03-S05, D54]. Sahil's Zoho profile is the non-admin Digital Infrastructure profile [D110].

If any one is not met, UAT does not start. Sahil records which one and why.

## Exit rule (what "accepted" means)

UAT is accepted only when all of these are true [M18-S08]:

- **No P1 defect is open.**
- **Every open P2 has a written workaround** in its defect line.
- **Every Must step was passed by its real seat holder** (the person named in the scenario, not a stand-in). Steps marked Should do not block go-live; a Fail is logged as P2 or P3.
- **The KAM scenario passed the "no money, no identity" sweep** (KAM-05) [TC-IM12-012].
- **Every Finance Must flow passed or has a logged defect with an owner and a date** [TC-IM12-011].
- **The regression pack was re-run after the fixes and no previously passing case fails** [TC-E15-033].
- **A signed-off list with any go-live blockers exists.** Sahil owns the blocker list and signs UAT [M18-S08-T09, TC-E15-032].

## Who runs what

| Role | Who | Does |
|---|---|---|
| Seat holder | Named in each scenario (Rohit, Tasneem, Meena, Harsha, Imran, Divya, Fahad, Sahil, Latha; Farm ops when named) | Runs their own scenario, marks pass/fail, signs their scenario. |
| Tester | The person running UAT for the team | Runs the lead-side script as each IR seat, the IR Manager and Sahil (T05); sits beside the seat holders; keeps evidence; retests fixes (T09). |
| Second person | Named in each scenario (Kavya, Neha, Meena, Imran and so on) | Does the "other seat" half of a refused check. |
| Observer | One person, during the IR scenario | Times tasks and notes stumbles (IR-23) [TC-E16-016]. |
| Sahil | Digital Infrastructure | Triages defects, owns the blocker list, signs UAT. |
| Autopilot | Automated build loop | Fixes P1 and P2 defects (T08) and re-runs the regression pack. |

## Schedule slot

UAT takes **six days, starting the day the loop finishes** (story M18-S08, day 6). The loop's target is Sat 3 Oct 2026 (D104); people's testing and UAT then run to about Fri 9 Oct. Dates move with the loop's real finish (D66), so treat these as a projection.

| Day | Projected | Who | Scenarios |
|---|---|---|---|
| 1 | Sun 4 Oct | Sahil, tester | Entry check. UAT-DI. UAT-IM. Start UAT-IR (IR-01 to IR-11). |
| 2 | Mon 5 Oct | IR, Finance | Finish UAT-IR up to IR-13. Start UAT-FIN. The two seats hand off to each other. |
| 3 | Tue 6 Oct | Finance, Head of Finance | Finish UAT-FIN. UAT-HOF. IR finishes IR-14 to IR-24. |
| 4 | Wed 7 Oct | Head of AM, KAMs, Compliance | UAT-HAM (before UAT-KAM). UAT-KAM. UAT-CMP. |
| 5 | Thu 8 Oct | Farm ops, viewers, Sahil | UAT-FARM (if the owner has decided). UAT-AUD. Fixes for P1 and P2. |
| 6 | Fri 9 Oct | Tester, Sahil | Retest fixes. Re-run the regression pack. Go/no-go. Sign the list. |

Hours already planned: IR and IR Manager 8 h, Finance 6 h, KAM 5 h [M18-S08-T05, T06, T07].

## Seat sign-off

Each seat holder signs after their last step. Sahil signs the whole pack on Day 6.

| Seat | Holder | Steps | Must steps passed? | Date | Signature |
|---|---|---|---|---|---|
| IR | | 24 | | | |
| IR Manager | | 13 | | | |
| Finance | | 22 | | | |
| Head of Finance | | 15 | | | |
| KAM | | 12 | | | |
| Head of AM | | 8 | | | |
| Compliance and Audit | | 9 | | | |
| Farm ops | | 5 | | | |
| Digital Infrastructure (Sahil) | | 16 | | | |
| Auditor / viewer | | 7 | | | |
| **UAT accepted (Sahil)** | | 131 | | | |

## Rules for testers

- Use the sandbox only. Never use real investor data, a real PAN, a real bank account or a real signature. Use the seeded names and names you make up.
- Sign in as yourself. Do not borrow another person's login.
- Take a screenshot for every Fail, and for every "Refused check" (proof you were stopped). If you saw a PAN, bank number or rupee amount you should not have, that is a P1.
- Do not skip a step to save time. Mark it "skipped" with the reason in the notes.
- A Fail on a step stops only that step. Carry on unless a BATON depends on it.

## Known gaps in the source documents

The pack follows the newest ruling (D110 is the latest on seats and search). Where the documents disagree, the step says so and the tester writes down what the app does. These need an owner answer before go-live:

1. **Farm ops has no Zoho role yet** [M03-S05-NOTE-2]. UAT-FARM is blocked until the owner names it. `docs/ACCESS-PLAN.md` has no Farm-ops row, and `ops/SEAT-PLAN.md` puts Farm ops and Channel Partner on one row.
2. **Sahil and identity reveals.** D110 says he keeps "logged PAN/Aadhaar/bank reveals". M01-S10, M12-S10 and M15-S03 say his PAN stays masked with no reveal, and the plan hides those fields on his profile [M02-S04-T02]. DI-03 records what the app does.
3. **Search scope.** M06-S03 and M03-S02 still say search is "leads only"; D110 makes it org-wide for Digital Infrastructure and the business owner, with wiring units M06-S03-W2 and M06-S05-W2. DI-04 follows D110.
4. **Auditor versus Compliance.** M03-S06 makes Latha a read-only Auditor; D78 merged Compliance and Audit into one seat that passes and fails KYC. AUD-01 and CMP-01 both cover Latha's seat; the owner must say which profile she holds.
5. **Where a payment report is stored.** M08-S03 says a "Payment Claims" record; D82 says there is no such module and uses Receipts.Match_State = Claimed. IR-14 records which exists.
6. **Where NDA status lives.** D79 puts the NDA fields on the Lead; M02-S14 puts NDA_Sign_* on the allotment, which does not exist until the advance. M12-S04 says status is written to the record while D77 and M20-S08-NOTE-2 say it is read live. FIN-06 accepts either and notes which.
7. **Head of Finance versus Finance.** Stories name "Finance (Harsha)" for everything; the access plan has Harsha as Head and Meena as Finance Ops. The documents do not say whether Finance Ops may verify an allocation letter or unlock app access [M11-S05, M10-S21], so the Finance script does not test those for Meena.
8. **Recorded receipts may show as matched.** M10-S02-NOTE-2 says the build still marks a receipt matched by its recorder, against D21. FIN-12 and HOF-02 will show it if so; log it as P1.
9. **Unassigned leads.** The owner of an unassigned lead is still undecided [M04-S01-NOTE-2]; IM-03 depends on it.
10. **No scenario for** the business owner (Arvind), Corporate (Pradeep), Exec beyond Jhalak's grant check, channel partners, or the investor in the app. D110 makes the business owner's search org-wide. The investor app is tested through the stub receiver only [M13-S01].
11. **Not in this pack.** The 2-hour exploratory charters and the usability timing sheet (M18-S08-T02, T03, T04) and the regression re-run (TC-E15-033, automated). IR-23 covers one usability task only.
