# Growize Console — one plan, and how certain it is (25 Sep 2026)

**Plan:** `pm/plan-merged/growize-console-plan.json`
- 20 epics (M01–M20), 170 live stories: 145 in plan and 25 after go-live. 6 are dropped.
- 586 subtasks and 543 tests, carried over via `id_map`.
- Built from the IR plan (104 stories) and the IM plan (74 stories).

**Queue:** `autopilot/console/queue.json` holds 145 stories. It is ordered by stage (S0 → S5), then priority. The old `ir`/`im` queues are retired (`Q_RETIRED` in `autopilot/lib.mjs`).

**Judge:** Jev (jev-latest), run on this PC.
- 175 jobs, 8 questions each: valid, duplicate, ready, certain, and need decision / material / approval / context / plan.
- Two calibration controls were included: a clear story and a vague one.
- Scores marked * are normalised so that the vague control = 0 and the clear control = 1. Jev's raw ceiling on these questions is low; the clear control only reaches 0.77 on "valid" and 0.50 on "certain".

## What changed
| | Before (two plans) | Now (one plan) |
|---|---|---|
| Stories | 178 | 170 live |
| Stories Jev called not valid as written | 46 | 5 below 0.5 raw; normalised mean 0.93 (133 ≥ 0.90) |
| Duplicate pairs (p ≥ 0.5) | 35 | 12. Three real ones were merged in round 2 and re-scored as "none". The rest pair a feature with its Zoho build-out prerequisite (for example M10-S07 ↔ M02-S12). |
| Ready / testable (0–4) | 3.34 | 3.57 (163 stories ≥ 3) |
| New stories for D69–D73 | — | 24 |

Merges: 17 groups of duplicates became single stories. 35 were rewritten for the one app. IM07-S02 and S06 were moved from eMudhra to Zoho Sign.

## Score: how certain we are of how to build it
- **Is the plan correct for the one app?** Yes, 0.93*. This passes the 0.90 bar.
- **Is it clear and testable?** Yes, 3.57 / 4.
- **Do we know how to build each story without guessing?** Only partly: 0.57*, and 18 stories are ≥ 0.90.
  - The guessing is almost entirely about decisions and Zoho objects that don't exist yet. It is not about code.
- **What is still needed?** The stories themselves list 158 open items. They collapse into **19 owner items** (table below).
  - 54 of the 145 in-plan stories need nothing from anyone and can be coded now: the shell, UI on fixtures, the test suite, lead-side screens and hardening.
  - The other 91 wait on at least one owner item.
- Jev's "needs" questions agree: decision 0.75, material 0.78, approval 0.69, context 0.82, more planning 0.72.
  - The clear control scored 0.27 / 0.42 / 0.31 / 0.65 / 0.52 on the same questions, so read these relative to that.

**Verdict:** the plan is settled enough to **start coding now** on the 54 free stories. The Zoho-dependent half needs four answers first: OD1, OD2, AP1 and AP2. After those, the next blockers are AP3, MA1 and MA2 for Zoho Sign and the investor app.

**Timeline (D66):** 145 stories by Sat 3 Oct is about 18 a day. That is only reachable if AP1 and AP2 land within a day. The forecast (`status.mjs`) will show this after the first rounds.

## Per epic
| Epic | Stories (in plan) | Valid for one app* | Ready (0–4) | How-to certainty* | Stories free of owner items | Owner items blocking |
|---|---|---|---|---|---|---|
| M01 Foundations & the one app shell | 11 (10) | 0.98 | 3.75 | 0.67 | 8 | AP4, OD10, OD2, OD4 |
| M02 Zoho org build-out | 14 (14) | 0.97 | 3.70 | 0.68 | 1 | AP1, AP2, AP3, AP4, MA2, MA3, OD1, OD3, OD4, OD5, OD8, OD9 |
| M03 Access, seats & super user | 9 (9) | 0.95 | 3.49 | 0.48 | 2 | AP1, AP2, CX1, OD2, OD3, OD6, OD9 |
| M04 Lead capture | 5 (3) | 0.97 | 3.70 | 0.87 | 3 | AP2, MA4 |
| M05 Today (both sides) | 8 (7) | 0.82 | 3.54 | 0.46 | 6 | AP2, OD4, OD6 |
| M06 Leads book & lead search | 4 (4) | 1.00 | 3.75 | 0.83 | 1 | AP1, OD2 |
| M07 Lead page | 7 (7) | 0.83 | 3.64 | 0.64 | 5 | AP1, AP2 |
| M08 Journey, gates & hand-offs between the sides | 10 (7) | 0.91 | 3.63 | 0.50 | 2 | AP1, AP2, MA1, OD1, OD4, OD5 |
| M09 Investors & the investor record | 8 (6) | 0.91 | 3.59 | 0.54 | 2 | AP1, AP2, OD1, OD2, OD6 |
| M10 Payments & receipts | 9 (7) | 0.88 | 3.52 | 0.44 | 1 | AP2, MA1, OD1, OD3, OD4 |
| M11 Farms (the LLP shelf) & allotments | 8 (6) | 0.97 | 3.58 | 0.49 | 1 | AP2, CX1, OD1, OD7 |
| M12 Documents, upload & Zoho Sign | 14 (14) | 0.90 | 3.75 | 0.57 | 2 | AP1, AP2, AP3, MA1, MA2, MA4, OD5, OD6, OD8 |
| M13 Tickets & investor updates (pushed to the investor app) | 8 (6) | 0.83 | 3.59 | 0.48 | 1 | AP2, MA1 |
| M14 Events | 4 (3) | 0.93 | 3.60 | 0.53 | 3 | AP2, CX1 |
| M15 Updates & Activity | 5 (3) | 0.91 | 3.44 | 0.56 | 4 | — |
| M16 Numbers, Plan & Transfers | 10 (8) | 0.94 | 3.54 | 0.45 | 4 | AP2, MA4, OD1, OD6 |
| M17 Teams, Profile & System | 7 (4) | 0.94 | 3.47 | 0.45 | 3 | AP1, AP4, OD3, OD4 |
| M18 Hardening, security & release | 10 (10) | 0.98 | 3.46 | 0.59 | 4 | AP1, AP2, AP3, MA3, OD1, OD10, OD6 |
| M19 Quality — Jev UI suite | 11 (10) | 0.99 | 3.57 | 0.58 | 9 | AP1, AP4 |
| M20 Launch readiness & operations | 8 (7) | 1.00 | 2.95 | 0.76 | 5 | AP2, AP3, MA1, MA2, OD10, OD5 |

## The 19 owner items, ranked by stories they unblock
| Id | Kind | Stories | Epics | What |
|---|---|---|---|---|
| AP2 | Owner approval | 61 | M02, M03, M04, M05, M07, M08, M09, M10, M11, M12, M13, M14, M16, M18, M20 | Zoho production writes for the S0 build-out (fields, modules, roles, profiles, FLS, sharing, workflows, Cases, Calendar sync, mailbox). |
| AP1 | Owner approval | 18 | M02, M03, M06, M07, M08, M09, M12, M17, M18, M19 | Renew Zoho Enterprise before 13 Oct and buy the restricted test-user seat; team seats after T11. |
| OD1 | Owner decision | 12 | M02, M08, M09, M10, M11, M16, M18 | Canonical allotment module: LLP_Unit_Allocation (lookups to Contact + LLP, Allocation/Payment status, 1 record) vs LLP_UnitAllocation_Module (receipts flattened in 10 columns, 2 records). Recommended: LLP_Unit_Allocation; move the 2 records, make the other read-only. |
| OD6 | Owner decision | 9 | M03, M05, M09, M12, M16, M18 | Where KAM conversations, tier and cadence live (Calls/Notes on the Contact vs a Touches module). |
| OD3 | Owner decision | 8 | M02, M03, M10, M17 | Seat roster: are Compliance & KYC and Auditor separate seats; who owns KYC; Head of Finance named as second hand for receipt matching and reversals; names per Investors-side seat. |
| MA1 | Material | 8 | M08, M10, M12, M13, M20 | Investor app codebase, its staging URL, the contract signing secret, and how a Supabase user maps to a Zoho Contact. |
| OD4 | Owner decision | 6 | M01, M02, M05, M08, M10, M17 | Reservation hold: its own Holds module or fields on the allotment; hold length and the 'soon' window (21 days in prototype). |
| OD5 | Owner decision | 6 | M02, M08, M12, M20 | Where the NDA round lives before an allotment exists (on the Lead, the Contact, or a Reserved allotment). |
| AP3 | Owner approval | 6 | M02, M12, M18, M20 | Zoho Sign plan with API + webhooks (Enterprise or API plan, India DC). |
| AP4 | Owner approval | 6 | M01, M02, M17, M19 | Zoho sandbox + OAuth client; hosting account for staging/production; Object Lock log bucket; service credential for background jobs. |
| OD2 | Owner decision | 5 | M01, M03, M06, M09 | D69 details: IR sees own investors via Zoho record share at hand-off (recommended) or server filter; 'own' = IR who owned the lead at Said yes (recommended); which investor sections an IR sees; whether an IR gets the Investors page. |
| OD8 | Owner decision | 5 | M02, M12 | Documents: who-sees-what per seat and scope; the typed slot list per scope; LLP papers to the app by read or push; signing method per investor type. |
| OD10 | Owner decision | 4 | M01, M18, M20 | Dates and targets: go-live once gates pass, UAT people, KPI targets, whether refunds are in plan. |
| MA2 | Material | 4 | M02, M12, M20 | Zoho Sign templates (NDA, supplementary agreement, allocation letter, FEMA declaration) from Finance. |
| MA4 | Material | 3 | M04, M12, M16 | Plan targets and periods; approved pitch deck and yield note; a sample intake sheet. |
| CX1 | Context | 3 | M03, M11, M14 | Which existing Contacts came from which IR (backfill); Block A–F vs the real LLPs (production has one: EKA LLP, 22 units, Open for Reservation). |
| OD7 | Owner decision | 2 | M11 | Farm data: farm progress as Notes on the LLP or a module; 'released' as a field or the LLP status. |
| OD9 | Owner decision | 2 | M02, M03 | Grants storage under zero copy (Zoho vs app store); Payment_Status kept by Zoho workflow or console commit (Sahil). |
| MA3 | Material | 2 | M02, M18 | Finance: receipt field list and picklists, a sample bank statement CSV, old payments per allotment. |

## Zoho build-out
Nothing was written to Zoho, for three reasons:
- OD1 decides which module the allotment, receipt, document-slot and sign fields go on.
- D54's order puts the renewal and the access wall before any new module.
- The connector can create fields and records but not modules, roles, profiles or sharing rules. Those need Setup, done by Sahil or through the browser.
