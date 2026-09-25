# D74 — Owner answers to OD1, OD2, AP1, AP2; first Zoho fields written

**Date:** 25 Sep 2026 · **Decided by:** owner · **Closes:** OD1, OD2, AP1 · **Narrows:** AP2

## Answers
1. **OD1 — the allotment module is `LLP_Unit_Allocation`.** Improve it and add whatever is missing. `LLP_UnitAllocation_Module` is legacy. Its 2 records move over later, and then it goes read-only.
2. **OD2 — an IR's "own" investors.**
   - Enforcement is a Zoho record share to the originating IR at hand-off.
   - "Own" means the IR who owned the lead at the moment it said yes, and it stays that way after.
   - Stored in `Contacts.Originating_IR`, `Contacts.Said_Yes_At` and `Contacts.Origin_Lead`.
3. **AP1 — the renewal and seats are not ours to track.** Removed from the plan's blockers.
4. **AP2 — Zoho production changes are approved, on one condition:** everything must map correctly to the fields the Investors-side screens use.

## What was done
- **Mapping:** every Investors-side fact was mapped to the live org, 75 rows (`pm/plan-merged/ZOHO-FIELD-MAPPING.md`).
- **Jev check:** each row was checked against a calibrated right/wrong control, over 4 rounds with 3 repeats for borderline rows. Weak mappings were fixed:
  - the nominee was split into name and relation
  - a welcome channel field was added
  - the hold extension became a request with its own fields
  - `Units_Released` was added
- **Written to production:** 36 custom fields, additive only. Each was re-read and matched its specification.

| Module | Fields |
|---|---|
| Contacts | ARL_ID (unique), Aadhaar_Last4, Aadhaar_Ref, KYC_Completed_On, Bank_Verification, Originating_IR, Origin_Lead → Leads, Said_Yes_At, Nominee_Name, Nominee_Relation, KAM, KAM_Since, KAM_Intro_At, App_Account_Mark, App_Mark_At, App_Welcome_At, App_Welcome_Channel, PAN_Proof, Bank_Proof, FEMA_Declaration |
| LLP_Unit_Allocation | Amount_Received, Hold_Until, Hold_Extension_State, Hold_Extension_Days, Hold_Extension_Reason, Hold_Extension_Asked_By, Hold_Extension_Decided_At, Supplementary_Agreement, Allocation_Letter, Unit_Certificate |
| LLP_Creation_Module | Block_Code, Units_Released, Soil_Type, Crop_Stage, LLP_Deed, Insurance_Policy_Document |

## Not done, and why
- **Two fields held below the bar:** App_Mark_By and Hold_Extension_Decided_By. They are better taken from Zoho's approval and field history.
- **Modules and admin settings the connector cannot create:**
  - Receipts, Documents and Investor_Updates modules
  - enabling Cases
  - Lead_Source picklist values
  - the 'Darft' typo in LLP_Status
  - field history
  - the FLS wall
  - hiding the full Aadhaar field
- **Still open:** the KAM conversation log (OD6).
- **Field-level security is not set yet.** The new fields are visible to the org's single user, as are all existing fields. The access wall (M02-S04) sets it.
