# Allotment module comparison — for the owner (M02-S11-T02)

_4 Oct 2026. The decision is already taken (D74 first picked `LLP_Unit_Allocation`; **D75 corrected it to `LLP_UnitAllocation_Module`**). This note is the side-by-side that M02-S11 asked for, rebuilt from the decision records because the live metadata read (M02-S11-T01) is not available offline. Columns marked UNVERIFIED need that read. A copy belongs in the project decisions file; that file is the owner's, so this is saved in `docs/` for them to attach._

| | `LLP_UnitAllocation_Module` | `LLP_Unit_Allocation` (Team module) |
|---|---|---|
| Role | **canonical allotment module** (D75) | duplicate, to be hidden (A-27) |
| Records | 2, both Issued and fully paid, on EKA LLP | 1 (UNVERIFIED what it holds) |
| Fields | after D75/D82: the 9 hold/paper fields added, 34 flattened/unused fields deleted (Amount/UTR/Date 1–10, Deal, Capital_Outstanding, Capital_Returns, Next_Payout). Exact count UNVERIFIED | 29, back to its original after D77 deleted the 10 D74 added |
| Lookups | Customer → Contacts, LLP → `LLP_Creation_Module` (UNVERIFIED API names) | UNVERIFIED |
| Receipts | `Receipts.Allotment` → this module (D76) | none |
| Layouts, workflows, reports | UNVERIFIED (the connector cannot read them) | UNVERIFIED |
| Console references | the field map and every allotment adapter point here (D75) | none expected; check `console/src/lib/zoho` for the string `LLP_Unit_Allocation` before hiding it |

## Stray records

The one record in `LLP_Unit_Allocation` is the only possible stray. It was never moved. D74 planned to move the 2 records *into* it; D75 reversed that, so no record needs moving. Someone with the Team-module Admins profile should open it and say whether it duplicates one of the two issued allotments or is a test row.

## Recommendation

1. Keep D75: `LLP_UnitAllocation_Module` is the allotment module. Nothing in this note argues against it.
2. Make `LLP_Unit_Allocation` read-only for every profile and hide its tab (M02-S11-T03). Keep its record. Do not delete.
3. Before hiding, run `grep -rn LLP_Unit_Allocation console/src zoho` (expect no hits other than the spelling with `UnitAllocation_Module`) so nothing still reads the duplicate (M02-S11-T04).
4. Same pass for `LLP_Creation` (A-27): it needs the Team-module Admins profile to be opened at all.

## To confirm with Finance (carried from D75)

Meaning of `Total_Amount_Receivable` (balance still due or total ever due), of `Capital_Invested` next to `Issued_Units`, and `Customer_Status` as the exit field.
