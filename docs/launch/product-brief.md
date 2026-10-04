# Product brief and KPIs (M20-S01)

Written 4 Oct 2026. Status: **NOT SIGNED OFF.** Every KPI target below is blank on purpose. A brief with a blank target is not signed off (M20-S01 acceptance 3). The owner fills the targets (OD10).

## 1. The problem
Before the console, the Growize unit's work was spread over separate tools and separate portals. Leads, paper, money and investor care were handled in different places by different people. Two hundred investors' money runs through this (CLAUDE.md). The goal is to run the whole ecosystem of the unit from one place (project brief).

The Growize Console is that place. It sits on top of one Zoho CRM Enterprise org (D52). Zoho is the only store. The console holds no records of its own (D45). Every person reads and writes as themselves, so Zoho's roles, sharing and field-level security decide what each person sees (D53).

What it must do:
- Move a lead from first contact to said yes, with the IR owning the lead and Finance confirming money (D9).
- Run paper (NDA, supplementary agreement, allocation letter) through Zoho Sign or by manual upload (D72, D78).
- Record money, match it against the bank statement, and allot units only when the money is in (D21, D113).
- Open the investor's app account on hold and let Finance unlock it (D93).
- Care for investors: tickets, conversations, updates.
- Keep PAN, Aadhaar and bank numbers behind the wall (D13, D52).

## 2. Users
Every seat, both sides. Names are from `ops/SEAT-PLAN.md` and `docs/ACCESS-PLAN.md`. Seats are assigned by Sahil and can be added later (D113 5c).

| Side | Seat | Who | What they do in one line |
|---|---|---|---|
| Lead | Investor Relations (IR) | Rohit, Kavya, Nikhil, Ananya | Capture and follow up leads, paper steps, report payments |
| Lead | IR Manager | Tasneem Qureshi | Team's book, deal leads, cover, reports, grants |
| Lead | Channel partners | As named by the owner | Own-assigned leads. Not provisioned yet |
| Investors | Finance Operations | Meena Raghavan | Send paper, record receipts, reconcile the bank statement |
| Investors | Head of Finance | Harsha Bhat | Match money, release holds and units, allot, unlock app access |
| Investors | Compliance and Audit (one seat, D78) | Fahad Rizvi, Latha Prabhu | KYC pass or fail, read the Finance trail read-only |
| Investors | Key Account Manager (KAM) | Imran Sheikh, Neha Bhandari | Care for assigned investors, tickets. No money, no identity |
| Investors | Head of Account Management | Divya Kamath | Assign investors to KAMs, watch the book |
| Both | Digital Infrastructure (super user, D68, D110) | Sahil Mohite | Test every page, system health, grants, runbook |
| Both | Business owner (`bu` seat, D113) | Arvind Menon | Reads org-wide |
| Both | Corporate, root | Pradeep Ram | Existing owner seat |
| Read | Exec viewer | Jhalak Mehta | Reads granted pages only |
| Later | Farm ops | As named by the owner | Persona kept, not provisioned (D113 5b) |
| Outside | Investors in the app | About 200 | See their own holdings, papers, updates, tickets in the investor app |
| System | App integration | Service identity | Creates Cases from app requests only |

## 3. Scope

### In
- The lead side: Today, Leads, lead page, Add lead, Events, Activity, Updates, Teams and access, Profile, System, Numbers, Plan, Transfers (D55, D59, D60).
- The investors side: Investors, investor record, Payments, Documents, Tickets, Farms, Payouts, app access, investor updates (D93).
- Zoho Sign inside the console; uploads straight to Zoho (D71, D72).
- Signed events to the existing investor app, through a stub receiver until the app code is added (D73, MA1).
- The access wall: profiles, field-level security, Private sharing, step-up before reveals (D13, D22, D52).
- Moving the legacy records and old payment columns into the new structure (M18-S06, M18-S12).
- Backups, alerts, runbooks, hypercare (`docs/ops/`, `docs/launch/`).

### Out
- The master dashboard (D25). Its own project later.
- The FMS stays a separate system (D110).
- Farm ops seat now (D113 5b).
- Computing TDS (D84).
- Renewal tracking on our list (D74).
- Reading ARL holdings and transactions in the console (A-28, later).
- A second database of ours (D45).
- Replacing Supabase sign-in for investors. The Portals spike says no direct path for now (`docs/reports/portals-spike.md`, D110).

### Not decided
- Whether refunds are in the plan: **OPEN — owner** (OD10).
- Go-live date: **OPEN — owner** (OD10, D66).
- Hosting (AP4) and the Planes B/C log store (D47): **OPEN — owner**.

## 4. KPIs

Proposed by the build team. Five to seven, each with a definition, a formula and a data source. **Targets are blank. The owner sets them.** "Owner" is the seat that should answer for the number. All times use Asia/Kolkata (CLAUDE.md rule 9). No KPI needs a new store: each is read from Zoho (D45).

| # | KPI | Definition | Formula | Data source | KPI owner (proposed) | Target |
|---|---|---|---|---|---|---|
| K1 | First-touch speed | How fast a new lead is first worked by its owner | Median hours from `Owner_Assigned_At` to the first Touch by the owner. Also: count of leads with no touch by the deadline ("Missed first touch") | Leads, Touches. Console: Numbers, Assignments by IR (D59) | IR Manager | |
| K2 | Lead to said-yes rate | Share of leads in a cohort that reached "Investor said yes" | Leads created in the period that now have `Said_Yes_At` set, divided by leads created in the period. By month and by source | Leads, Contacts (`Said_Yes_At`, `Origin_Lead`). Console: Numbers, Funnel and Transfers | IR Manager | |
| K3 | Said-yes to allotted time | How long an investor waits from yes to units issued | Median days from `Said_Yes_At` to the allotment's `Allocation_Status` = Issued. Also: share allotted within the target days | Contacts, LLP_UnitAllocation_Module. Console: Numbers, Transfers (median days) | Head of Finance | |
| K4 | Money banked against plan | Matched money against the sales plan for the period | Sum of matched Receipts in the period divided by the plan's value for the period. Also units paid against plan units | Receipts (`Match_State` = Matched), Sales_Plans. Console: Numbers, Plan and Collection | Business owner | |
| K5 | Reconciliation health | How clean the weekly bank statement check is | Statement lines needing an owner at week end, and count of unmatched receipts older than 48 hours | Statements, Receipts. Console: Payments page, weekly reconciliation (`docs/runbooks/weekly-reconciliation.md`) | Head of Finance | |
| K6 | Investor service speed | How fast investors get answers | Median hours from a ticket (Case) being opened to the first reply; median days open to closed. Also: accounts gone quiet (no conversation logged) | Cases, Touches. Console: Numbers, Service | Head of Account Management | |
| K7 | Console reliability | The console is up and doing its job | Share of hourly production checks that passed in the period (M19-S07). Also: count of P1 defects and of identity-leak incidents (the target for leaks is expected to be zero, but the owner states it) | Hourly check results in Plane B; defect lines; `ops/runbooks/pii-leak.md` incident lines | Sahil | |

Notes:
- K1 to K3 and K6 depend on dates being stamped. The stamps are in the build (stage stamps, `Said_Yes_At`, Cases times). Whether the live Zoho fields exist and are filled is proved on the sandbox (phase 3 waiting units).
- K4 needs the plan values in Sales_Plans. Who enters them: **OPEN — owner**.
- K7 needs the hourly production check (M19-S07-T02), which needs hosting.
- Baselines: none exist today. The first two weeks of hypercare give the first readings (`docs/ops/hypercare.md`). No target is set from a single reading.
- The Jev UI suite pass rate and UAT results measure build quality. They are not product KPIs and are not listed here.

## 5. Sign-off

| | |
|---|---|
| All seven targets filled | No |
| Owner | **OPEN — owner** to name the person who signs |
| Sign-off date | blank |
| Status | **Not signed off** |

Test TC-E17-001 passes only when every KPI row has a target and the sign-off date is filled.

## 6. Open items
| # | Item | Owner |
|---|---|---|
| 1 | Seven KPI targets | owner |
| 2 | Whether refunds are in plan | owner |
| 3 | Go-live date | owner |
| 4 | Who enters Sales_Plans values | owner |
| 5 | Who signs the brief | owner |
