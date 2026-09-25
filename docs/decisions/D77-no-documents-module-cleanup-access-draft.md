# D77 — No Documents module; the duplicate module's fields removed; access plan drafted

**Date:** 25 Sep 2026 · **Decided by:** owner, with Jev

## 1. Clean-up done
The 10 fields D74 had added to `LLP_Unit_Allocation` (the Team-module duplicate) were deleted in Zoho Setup:
- Amount_Received
- Hold_Until
- the 5 Hold_Extension_* fields
- Supplementary_Agreement, Allocation_Letter, Unit_Certificate

How it was checked:
- Before deleting, a query showed all 10 fields empty on the module's one record.
- After deleting, the module is back to its original 29 fields.
- Nothing else in the module changed. Its 4 older unused fields were left alone.

## 2. No Documents module
The owner's point: documents are either per investor (on the Contact) or per farm (on the LLP), and an investor's papers for a farm sit on their allotment inside that LLP. Jev agreed with 0.95 on each of 3 runs, against 0.05 for a separate Papers module.

The model:
- Files stay in the typed upload slots, and in the Attachments list on the Contact, allotment or LLP.
- Signing status is read live from Zoho Sign using the request id.
- For each paper that is signed or checked, a few small fields sit next to its slot on the same record:
  - the Zoho Sign request id
  - verified by, and verified at
  - a blocked reason, where needed

Can Finance's Documents queue be built this way without storing anything twice? Jev 0.78. These fields are proposed only. They wait on the owner's yes and on OD5 (where the NDA lives before an allotment exists).

## 3. Access plan
A draft is in `docs/ACCESS-PLAN.md`:
- 15 people with a role and profile each
- default sharing per module
- field-level security for bank, identity and money fields
- record shares for an IR's own investors and for KAMs
- the maker-checker rule on Receipts
- the order of work, starting with T11 on every profile

Risk R1 needs an owner decision: Zoho's Administrator profile ignores field-level security. The draft proposes that Sahil moves to a custom Digital Infrastructure profile before go-live.
