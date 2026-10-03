# Zoho module register — as built (M02-S03-T02)

_4 Oct 2026. Replaces the "Org as found" sheet of the mapping workbook for module API names (the workbook lives under `pm/plan-merged/`, which this task may not edit). Built from `docs/zoho-org-as-found-2026-09-23.md` and decisions D74–D85. **Nothing here was re-read from live Zoho today** — every API name below is as the decision records state it, and rows marked UNVERIFIED need one `GET /crm/v8/settings/modules` read in the sandbox (M02-S10) to confirm._

## Modules the console reads or writes

| Module | API name | Origin | Console role | Source |
|---|---|---|---|---|
| Leads | `Leads` | standard | the Lead, seven-rung ladder, gate columns | org-as-found, D82 |
| Contacts | `Contacts` | standard | the investor; identity block behind FLS | org-as-found, D52 |
| LLP Creation Module | `LLP_Creation_Module` | adopted (existing) | Projects / the shelf (farm LLP) | D54, org-as-found |
| LLP Unit Allocation Module | `LLP_UnitAllocation_Module` | adopted (existing) | **the allotment module** (canonical) | D75 |
| Receipts | `Receipts` | created 25 Sep | one record per payment; also claims (`Match_State` = Claimed) | D76, D82 |
| Touches | `Touches` | created 25 Sep | every human contact, lead and investor | D76 |
| Investor Updates | `Investor_Updates` | created 25 Sep | what the investor app shows | D76 |
| Mail Templates | `Mail_Templates` (CustomModule10) | created | saved templates | D80 |
| Investor Payouts | `Investor_Payouts` (CustomModule11) | created | one record per payout | D82 |
| Sales Plans | `Sales_Plans` (CustomModule12) | created | the Plan page | D82 |
| Lead Events | `Lead_Events` (CustomModule13) | created | the Events page | D85 |
| ARL Holdings / ARL Transactions | `ARL_Holdings`, `ARL_Transactions` | existing | corporate-instrument ledger, not read by the console | org-as-found |
| Deals, Accounts | `Deals`, `Accounts` | standard | legacy of native conversion; not used | D54 |

UNVERIFIED: the exact API names of Receipts, Touches and Investor_Updates (D76 gives display names; the `Investor_Payouts`/`Sales_Plans`/`Lead_Events`/`Mail_Templates` names are quoted in D80/D82/D85).

## Where the story's five modules went (TC-E02-005 is stale)

M02-S03-T01 listed Touches, Events, Paper, Payment_Claims, Plan. Later decisions changed three of the five:

| Story name | What exists | Decision |
|---|---|---|
| Touches | `Touches` | D76 |
| Events | `Lead_Events` | D85 (Campaigns tried and switched off, D82) |
| Paper | no module; paper-tracking fields on Lead, Contact and the allotment | D77 (no Documents module), D79 |
| Payment_Claims | no module; claims are Receipts with `Match_State` = Claimed | D82 |
| Plan | `Sales_Plans` | D82 |

FACT CHANGE PROPOSED (M02-S03): TC-E02-005 "Five console modules exist" should read: Touches, Lead_Events, Sales_Plans, Investor_Payouts and Receipts exist; Touches, Receipts and Lead_Events carry a lookup to Leads (Receipts reaches Leads through its allotment, not directly). Not applied: test cases are not edited here.

## Duplicates to flag for the owner (no delete, D54 A-27)

| Module | What it is | Records | State |
|---|---|---|---|
| `LLP_Unit_Allocation` (Team module) | duplicate of the allotment module | 1 | not canonical (D75). The 10 fields D74 added were deleted empty (D77); back to its original 29 fields. **Still to do: hide it** |
| `LLP_Creation` (Team module, hidden) | duplicate of the LLP module | unknown | the super admin gets NO_PERMISSION on it. Someone on the Team-module **Admins** profile must open it, say what it holds, then hide it |

Nothing is to be deleted without the owner. No new shelf or allotment module was created (TC-E02-006 holds as of D75/D77: only the two real modules and the two Team duplicates carry LLP/Allot in the name — UNVERIFIED against a live module list).
