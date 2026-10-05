# D122 (draft) — KAM access through Zoho's own user-field sharing, and the sandbox wall test (5 Oct 2026)

**Status:** sandbox findings and prototype. The access choices are the owner's (Jev's policy sends them to the owner). Jev's `decide` flipped on all three questions when they were re-asked fairly, so it was discounted. An independent reviewer agent checked the Zoho docs and the code.

## Wall test, sandbox, 5 Oct
- **IR A and IR B:** see only their own 8 leads, their own investors and their own touches; no receipts, allotments, payouts or tickets. PAN, Aadhaar, KYC and bank are hidden and not returned even when asked for by name. Export is off. They can log a touch; receipt create, investor create, investor edit and lead delete are refused.
- **KAM:** sees its 4 tickets and the 8 investors that name it as KAM; no leads or receipts. Identity is hidden. It can edit its own tickets and cannot delete them.
- **Finance Ops:** sees all 15 investors with bank fields (PAN hidden), all allotments, receipts and payouts with money fields, and its own 3 tickets. It can create receipts and edit investors; delete is refused. A write sent with the hidden PAN field was ignored by Zoho: it reported success but stored nothing.
- **Compliance** (Finance Ops Test switched temporarily): reads everything, sees PAN, Aadhaar last 4 and ref, KYC and FEMA; bank fields and the full Aadhaar_Number are hidden; every money write is refused. **FAIL:** it cannot record KYC, because its sharing rule on Contacts is read-only. That is still open (see below).
- Layouts are assigned to the right profiles.

## Finding: Zoho's user-lookup field sharing
- Every user-lookup field in the org, live included, had `share_preference_enabled` on at `full-access`. Zoho shares the record with whoever is named in that field; the profile still caps what they can do.
- Proven in the sandbox with KAM Test:
  - Naming a user grants access (the KAM field, and the audit stamp FEMA_Verified_By).
  - Switching sharing off on a field **removes access that already exists** once Zoho has recomputed (`scheduler_status` completed).
  - Clearing or changing the value removes the old user's access.
- A new user-lookup field `KAM_Access` on LLP_UnitAllocation_Module and on Touches, with sharing at `read-write`, gives the KAM read/write on those records.
  - API note: on create the `share_permission` values are `full-access`, `read-write` and `read-only`. Create the field first, then PATCH `sharing_properties`.
- Workflow "GZ KAM Access Sync" (Contacts; on edit when KAM is modified to any value; repeats) calls `zoho/deluge/gz_sync_kam_access.deluge`. That function copies Contacts.KAM into KAM_Access on the investor's allotments and on its origin lead's touches.
  - Tested: clearing the KAM removed access from 1 allotment and 7 touches; setting it back restored them about 10–25 seconds later.
  - No app token, no seat, no share job.
- Code fact: the console never writes `Originating_IR` (the hand-off writer isn't built), so locking that field for IRs breaks nothing that exists today.

## Recommendations (owner to rule)
1. **KAM access: Zoho-native** (Contacts.KAM sharing, plus KAM_Access on allotments and touches kept in sync by the workflow). D121's share-service job shrinks to a nightly read-only consistency check. It needs no paid seat or stored token.
   - Still to build: the same sync when an allotment or touch is created.
2. **User-field sharing:**
   - Keep it on, at read-write, for KAM, Secondary_Owner, Cover_By and KAM_Access.
   - Originating_IR on at read-only.
   - Plan_For and Event_Staff on at read-only.
   - Off for all audit stamps: *_Verified_By, Consent_By, Matched_By, Paid_By, Published_By, Loaded_By, Hold_Extension_Asked_By.
   - Lock KAM and Originating_IR edits to Head of AM and Digital Infrastructure through field security.
3. **Compliance KYC: open.**
   - Option A: a read/write sharing rule. Name, email, phone and address stay editable by Compliance, because field security can't lock them; 53 other fields are already read-only for Compliance.
   - Option C: a separate KYC module, recommended by the reviewer.
   - Option B, the console writing on a service credential, was rejected: it breaks rule 2.
   - Next test: whether a Zoho validation-rule function can block Compliance edits to name, email and phone, through both the UI and the API.

## Sandbox changes made today (exclude from any live deploy unless ruled)
- New KAM_Access fields on allotments and touches; the function gz_sync_kam_access; the workflow "GZ KAM Access Sync".
- 53 Contacts fields read-only for the Compliance and Audit profile.
- Investor 0205's Origin_Lead set to L3 for the touch test. Test values from the earlier rounds were cleaned up; resetting the seed clears the rest.

## Test 1 result: Compliance KYC through option A (5 Oct)
- The owner raised "GZ Contacts - Compliance and Audit" to read/write in Setup. My own attempt was stopped by the session's safety check.
- A function validation rule on Contacts.Email (zoho/deluge/gz_compliance_contact_guard.deluge) refuses Compliance changes to name, email, phone and address.
- As the Compliance test user:
  - KYC_Completed_On was saved.
  - **Zoho's own screen blocked an email change** with the guard's message.
  - **API writes went through:** PUT /crm/v8/Contacts changed Email, Last_Name, Mailing_City and Mobile. Validation rules were not applied to these API writes. The values were restored at once.
- Consequence:
  - Option A is airtight only if the Compliance user cannot call the API.
  - The console calls Zoho on each person's own token (D53), so the profile needs "Zoho CRM API Access".
  - So a Compliance user who builds their own OAuth client could change contact details. Zoho field history would record it.
  - **Option C (a separate KYC module) is airtight. Recommended.**
- Sandbox state to undo:
  - Finance Ops Test is still on Compliance and Audit; switch it back.
  - The Compliance read/write rule and the validation rule remain until the owner rules.

## Owner ruling (5 Oct): 1 and 2 accepted, KYC parked
- "kyc is not a priority at all … 1,2 will be enough." Recommendations 1 and 2 are ruled. KYC (item 3) is **parked**; no option chosen.
- **Ruling 2 applied in the sandbox:** user-field sharing set as in recommendation 2; KAM and Originating_IR editable only by Administrator, Head of AM and Digital Infrastructure (read-only for the other 10 profiles).
- **Ruling 1 completed in the sandbox:**
  - Function `gz_kam_on_allotment(allotId)` + workflow "GZ KAM On Allotment" (LLP_UnitAllocation_Module, on create): reads the allotment by id, copies its Customer's KAM into KAM_Access.
  - Function `gz_kam_on_touch(touchId)` + workflow "GZ KAM On Touch" (Touches, on create): finds the Contact whose Origin_Lead is the touch's lead, copies its KAM into KAM_Access.
  - Deluge in `zoho/deluge/`. Both pass: a new allotment and a new touch for investor 0205 carried the KAM within 15 s.
  - Two earlier test records (allotment …7093, touch …7101) were created before the code was in and still have no KAM_Access; a seed reset clears them.
- Zoho fact learned: the v8 functions API (`POST /crm/v8/settings/functions?metadata=…`) creates a function's name, category and arguments but **does not store its code**. Code goes in through the editor. Associations (`POST /crm/v8/settings/automation/functions`, merge-field arguments) and workflow rules (`POST /crm/v8/settings/automation/workflow_rules`) do work through the API.
- Still owed: the D121 share-service job becomes a nightly read-only check (KAM_Access vs Contacts.KAM); owner to set the Compliance sharing rule back to Read Only and deactivate the guard validation rule, since KYC is parked.
