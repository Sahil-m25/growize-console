# D75 — Allotments live in LLP_UnitAllocation_Module (correction to D74)

**Date:** 25 Sep 2026 · **Decided by:** owner · **Corrects:** D74 point 1 and D70's recommendation · **Restores:** D54 B-18

## Decision
- **`LLP_UnitAllocation_Module` is the allotment module.** It holds the active investors: 2 records, both Issued and fully paid, on EKA LLP.
- **`LLP_Unit_Allocation` is not the allotment module.** It is the Team-module duplicate, to be hidden (D54 A-27).

## What changed
- **Nine fields were created on `LLP_UnitAllocation_Module`** and verified by re-reading them:
  - `Hold_Until`
  - `Hold_Extension_State`, `Hold_Extension_Days`, `Hold_Extension_Reason`, `Hold_Extension_Asked_By`, `Hold_Extension_Decided_At`
  - `Supplementary_Agreement`, `Allocation_Letter`, `Unit_Certificate`
  - Jev passed all nine (normalised 1.12–1.29, "needed" 0.91–0.95).
- **Mapped to fields that already exist** (no new field needed):
  - amount received → `Total_Amount_Received`
  - balance due → `Total_Amount_Receivable`
  - reserved units → `Reserved_Units`
  - exit → `Customer_Status`
  - token → `Token_Advance_Amount`
- **Paid state and "agreement signed" are computed** by the console. Nothing is stored twice.
- **The ten `Amount_n`/`UTR_n`/`Date_n` columns stay as history.** New money goes to the Receipts module (A-24).

## To confirm with Finance
Jev doubted three existing-field meanings:
- whether `Total_Amount_Receivable` is the balance still due or the total ever due (0.18)
- what `Capital_Invested` means next to `Issued_Units` (0.36)
- `Customer_Status` as the exit field (0.75)

## Clean-up
- The 10 fields D74 created on `LLP_Unit_Allocation` are empty and unused. They will be deleted in Zoho Setup, with the owner's OK.
- Contacts (20 fields) and LLP_Creation_Module (6 fields) from D74 stand.
