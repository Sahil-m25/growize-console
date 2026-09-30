# Decisions audit — 2026-09-29

88 decisions from docs/DECISIONS.md, each judged by Jev against the nine rules and up to 8 topic-related decisions (lexical match; later ones marked by date). Verdicts: consistent · superseded (a later decision replaced it but the row does not say so) · contradicts_rule · contradicts_decision. Jev sorts; a person reads every flagged row. Calls 88, input tokens 178910.

## Flagged, decisive (≥0.7) (10)

| D | Date | Verdict | With | Text |
|---|---|---|---|---|
| D49 | 22 Sep 2026 | superseded 0.94 | D52 0.87 | Four blockers closed — two bounded cross-org service identities, console state split by what it actually is, a dedicated touch object, and the fifteen-minute undo dropped |
| D74 | 25 Sep 2026 | superseded 0.94 | D75 1 | Owner answers: allotments live in LLP_Unit_Allocation (extend it); an IR's own investors = the lead owner at Said yes, enforced by a Zoho record share; renewal off our list; Zoho writes approved if th |
| D83 | 25 Sep 2026 | superseded 0.85 | D85 0.66 | Events become 3 fields on the lead (Event_Name/Date/Channel), no Events page, Campaigns switched off again; leads come in from a Google Sheet loaded in the console with preview + duplicate check (M04- |
| D4 | 4 Sep 2026 | superseded 0.77 | D45 1 | Write-through: the portal writes the mirror from Zoho’s answer in the same request |
| D23 | 7 Sep 2026 | superseded 0.76 | D52 0.41 | Whether Leads and Investor share one Zoho org is decided by a sandbox test in week one, not by argument |
| D33 | 11 Sep 2026 | superseded 0.76 | D28 0.78 | Every page is one screen; what left it opens from a door |
| D68 | 25 Sep 2026 | contradicts_rule 0.76 | D60 0.62 | Sahil is the super user of the merged console: every page and action of both sides (incl. PAN/Aadhaar/bank reveals, logged) so one account tests every feature; Finance (Harsha) stays the primary doer  |
| D17 | 4 Sep 2026 | superseded 0.75 | D79 0.9 | Email is sent from the portal as the person through Zoho’s Send Mail API with Zoho email templates; uploads attach to the Zoho record (KYC files in a restricted module); approvals are Zoho approval pr |
| D3 | 4 Sep 2026 | superseded 0.74 | D45 0.97 | Supabase is the read model — two projects, leads and investors |
| D5 | 4 Sep 2026 | superseded 0.7 | D50 0.92 | Business rules are enforced in Zoho (blueprints, validation rules, custom functions, field-level security) |

## Flagged, weak (<0.7) (27)

| D | Date | Verdict | With | Text |
|---|---|---|---|---|
| D24 | 7 Sep 2026 | contradicts_rule 0.68 | — | A Zoho seat is required to write, never to read — read-only staff hold a portal login and no CRM licence |
| D50 | 22 Sep 2026 | contradicts_rule 0.65 | D5 0.7 | The last three blockers closed, and the drift they revealed — five business rules now enforced outside Zoho; D5 amended; the edition question reopened as a measurement (T14) |
| D29 | 10 Sep 2026 | superseded 0.63 | D33 0.27 | Every door on the lead page opens in its own browser window; the short forms stay in the drawer |
| D62 | 24 Sep 2026 | superseded 0.59 | D66 0.48 | IR console delivery plan replaces plan.xlsx: 15 epics, 86 stories, 229 subtasks, 310 test cases (247 automated, judged by Jev: 232 PASS · 12 REVIEW · 3 FAIL = real prototype gaps); waterfall S0–S5 28  |
| D20 | 7 Sep 2026 | superseded 0.57 | D52 0.54 | Seats are bought per org at the cheapest edition that carries the features that org actually uses — Professional for Leads if the trial confirms it, Enterprise for Investor, Team users for KAMs; Zoho  |
| D65 | 24 Sep 2026 | superseded 0.57 | D66 0.94 | IR console in three weeks (28 Sep – 16 Oct, live Mon 19 Oct), IM portal in two (19 – 30 Oct, live Mon 2 Nov), built by a hands-off autopilot: one command loops Claude Code one story per round, Jev tes |
| D43 | 16 Sep 2026 | contradicts_rule 0.52 | — | Investor copy at signed agreements and Finance-confirmed 10%, retained lead/IR ownership and guarded manual recovery |
| D61 | 24 Sep 2026 | superseded 0.52 | D77 0.92 | Paperwork shows as the IR's move on Today (button or chip) and Documents, and opens the lead's paperwork row; writes stay on the lead page. Digital Infrastructure may grant IRs extra pages (confirmed) |
| D13 | 4 Sep 2026 | contradicts_rule 0.5 | D68 0.46 | Sensitive data: encrypted fields in Zoho behind field-level security; masked only in the mirror; Aadhaar never stored; reveals logged; bank beneficiary via the bank where possible |
| D28 | 10 Sep 2026 | superseded 0.5 | D33 0.96 | The console is a page that scrolls, styled on shadcn/ui's tokens and components — the fixed one-screen frame is gone; the workflow is untouched |
| D31 | 10 Sep 2026 | superseded 0.46 | D35 0.54 | Updates moves into a bell; People becomes Team & access and stays |
| D6 | 4 Sep 2026 | contradicts_rule 0.44 | — | Staff sign in with Zoho (OAuth 2.0, per-user tokens); investors sign in with Supabase |
| D10 | 3 Sep 2026 | superseded 0.43 | D93 0.89 | The app account opens at the first confirmed money, tentative; permanent at full payment; locked seven days later |
| D82 | 25 Sep 2026 | superseded 0.42 | D83 0.57 | Investor Payouts module (one record per monthly payout, 60 per 5-yr allotment; tab on investor page + Finance due queue, no new page); "Claimed" added to Receipts.Match_State; Campaigns activated for  |
| D79 | 25 Sep 2026 | contradicts_rule 0.39 | D17 0.61 | 23 paper-tracking fields created (NDA on Lead; FEMA/PAN/bank on Contact; supplementary/allocation letter/unit certificate on allotment). Integrations corrected: staff Zoho OAuth; investors Supabase; m |
| D27 | 10 Sep 2026 | superseded 0.37 | D28 0.73 | The console looks like a product: Inter embedded, an icon set, one control family, Airtable-style pills and tabs — UI only, the UX untouched |
| D76 | 25 Sep 2026 | superseded 0.34 | D77 0.93 | One shared Touches module for IR touches and KAM conversations (Jev 0.64 vs 0.30); Cases enabled + 3 fields; Receipts, Touches, Investor Updates modules created with Jev-trimmed fields; Lead_Source va |
| D2 | stated earlier | contradicts_rule 0.33 | D45 0.41 | Two Zoho orgs — Leads and Investor |
| D77 | 25 Sep 2026 | contradicts_rule 0.32 | D78 0.54 | No Documents module (owner + Jev 0.95): files stay in slots/Attachments per investor, allotment, LLP; signing read live from Zoho Sign; 10 unused LLP_Unit_Allocation fields deleted after an emptiness  |
| D44 | 16 Sep 2026 | superseded 0.31 | D60 0.39 | Dormant secondary privacy, active leave/handover access and read-only IR-manager team Finance oversight |
| D69 | 25 Sep 2026 | contradicts_decision 0.28 | D60 0.85 | Search stays separate: top-bar search = leads only in the searcher's book; investor search on the Investors page; an IR sees investor data only for investors from their own lead (mechanism open, OD2) |
| D80 | 25 Sep 2026 | contradicts_rule 0.28 | — | Mail Templates module + 5 seeded templates; role tree (11 roles) and default sharing applied (Emails now Private; farms, updates, templates Public Read Only); sharing rules, profiles and field-level s |
| D55 | 23 Sep 2026 | superseded 0.25 | D79 0.63 | The lead page answers one question — what happens next: tap-only log (reach · what happened · what's next), one Activity feed, one More menu; email composed in the console, sent via Zoho only when the |
| D1 | 4 Sep 2026 | superseded 0.24 | D24 0.57 | Zoho CRM is the primary system of record, on per-user seats |
| D15 | 4 Sep 2026 | superseded 0.23 | — | The FMS stays a separate vertical; farm progress arrives by webhook into the investors project; nothing farm-related goes to Zoho |
| D46 | 22 Sep 2026 | contradicts_rule 0.19 | D49 0.24 | Q30 and Q31 answered from Zoho's documentation: concurrency binds, not credits; no token reads two orgs, so the cross-org read moves to a second server-held credential and costs an Investor-org seat;  |
| D66 | 24 Sep 2026 | superseded 0.14 | D65 0.79 | Progress-based, not calendar-based: the autopilot runs round the clock from 24 Sep, target everything (IR then IM) built by Sat 3 Oct, then test & harden; dates are projections from measured pace (aut |

## Consistent (51)

D7 0.71 · D8 0.58 · D9 0.52 · D11 0.62 · D12 0.72 · D14 0.65 · D16 0.44 · D18 0.23 · D19 0.71 · D21 0.43 · D22 0.7 · D25 0.92 · D26 0.9 · D30 0.43 · D32 0.64 · D35 0.24 · D36 0.79 · D37 0.63 · D38 0.83 · D39 0.59 · D40 0.67 · D41 0.78 · D42 0.43 · D45 0.72 · D47 0.77 · D48 0.7 · D51 0.67 · D52 0.55 · D53 0.87 · D54 0.48 · D56 0.62 · D57 0.83 · D58 0.51 · D59 0.77 · D60 0.4 · D63 0.47 · D64 0.82 · D70 0.66 · D71 0.52 · D72 0.42 · D73 0.32 · D75 0.32 · D78 0.18 · D81 0.79 · D84 0.41 · D85 0.49 · D93 0.33 · D104 0.72 · D105 0.61 · D106 0.9 · D107 0.82
