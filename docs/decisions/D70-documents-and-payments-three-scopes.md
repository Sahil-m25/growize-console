# D70 — Documents and payments have three scopes, mapped to the real Zoho model

**Date:** 25 Sep 2026 · **Decided by:** owner (question 7), assessed against the live org · **Builds on:** D54

## Is the current approach correct?
Partly.
- The prototype keys every document and payment to the investor alone (`DOCS[].inv`, `TXN[].inv`).
- It shows farms as "Block A–F".
- The live Zoho org is already project-scoped:
  - `LLP_Creation_Module` is the farm/project LLP. Production holds one: EKA LLP, 22 units, Open for Reservation.
  - The allotment module links Contact ↔ LLP, with `Agreement_Signed` and `Payment_Status`.
  - `ARL_Holdings` and `ARL_Transactions` hold corporate instruments per Contact.
- Personal papers are right as they are. Agreements, receipts and farm papers are not.

## Decision: three scopes
| Scope | Lives on | Examples | Who sees it |
|---|---|---|---|
| Personal | Contact | KYC, PAN proof, bank proof, nominee | That investor; Finance and KYC owner; KAM (masked PII); the originating IR per D69 |
| Allotment (investor × LLP) | Allotment record | NDA, supplementary agreement, allocation letter, unit certificate, payment proofs, **receipts** | That investor; Finance; KAM; staff with access to that LLP |
| Project / farm | LLP record | LLP deed, farm and progress reports, insurance, annual accounts | Every investor holding an allotment in that LLP; staff with access to that LLP |

## Payments
- A **Receipt** (a new module, per D54) links to the allotment, and through it to the Contact and the LLP.
- `Payment_Status` on the allotment follows from the receipts.
- An investor with several farms sees payments per farm.
- ARL holdings and transactions stay a read-only panel.

## Still open
- **OD1: which allotment module is canonical.**
  - `LLP_Unit_Allocation`: lookups to Contact and LLP, Allocation/Payment status, 1 record.
  - `LLP_UnitAllocation_Module`: receipts flattened into 10 columns, 2 records.
  - **Recommended:** `LLP_Unit_Allocation`. Move the 2 records into it and make the other read-only.
- **OD8:** the who-sees-what table and the slot list.
