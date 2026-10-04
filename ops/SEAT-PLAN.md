# Seat plan (M02-S01-T02; D51, D53, D54; roles from docs/ACCESS-PLAN.md §1)

One Enterprise org. Everyone, viewers included, holds a full seat (D53). Renewal is due before **13 Oct 2026**.
**Only the test-user seat is bought in S0.** Every other seat is added after T11 passes (D54), in the order below.

| Order | Seat | Who | Zoho role | Zoho profile | Added |
|---|---|---|---|---|---|
| 1 | Restricted test user | T11 Test | IR (then each role in turn) | IR (then each profile in turn) | S0, the one bought seat |
| 2 | Digital Infrastructure, split from the permanent super admin | Sahil Mohite | Digital Infrastructure, under CEO | Digital Infrastructure (non-administrator, least privileges; D110) | after T11 |
| 3 | IR Manager | Tasneem Qureshi | IR Manager, under BU Owner | IR Manager | after T11 |
| 4 | Investor Relations (4) | Rohit, Kavya, Nikhil, Ananya | IR, under IR Manager | IR | after T11 |
| 5 | Finance | Meena Raghavan | Finance Ops, under Head of Finance | Finance Ops | after T11 |
| 5 | Head of Finance | Harsha Bhat | Head of Finance, under BU Owner | Finance Head | after T11 |
| 5 | Compliance & Audit | Fahad Rizvi, Latha Prabhu | Compliance & Audit, under Head of Finance | Compliance & Audit | after T11 |
| 6 | KAMs | Imran Sheikh, Neha Bhandari | KAM, under Head of AM | KAM | after T11 |
| 6 | Head of Account Management | Divya Kamath | Head of AM, under BU Owner | AM Head | after T11 |
| 7 | Viewers | Jhalak Mehta (Exec) | Exec, under BU Owner | Viewer | after T11 |
| 7 | Farm ops, channel partners | as named by the owner | Partner, under IR Manager (partners) | Channel Partner | after T11 |

Business owner = the `bu` seat. Seats and roles are assigned by Sahil and can be added later (D113 5c). Farm ops is not provisioned now; the persona is kept for later (D113 5b).

Seats already in the org: Tech Team (the permanent super admin). Pradeep Ram and Arvind Menon are existing owner seats (Administrator, Leadership) and are not bought.

## Gate
T11 (the restricted test user cannot read PAN or bank on any screen, in the console or in Zoho) must pass before rows 2–7 are created. Until then Setup → Users → Active Users lists only Tech Team and the restricted test user (TC-E02-002).

## Owner steps (BLOCKED.md, Sahil)
1. Setup → Subscription: renew Enterprise (annual) before 13 Oct; add one user licence; note the invoice reference in `ops/`.
2. Setup → Users: create the restricted test user, role IR, profile IR.
