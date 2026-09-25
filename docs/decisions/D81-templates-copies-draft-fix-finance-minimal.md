# D81 — Personal template copies; "Draft" fixed; SPF posted to Slack; minimal money model proposed

**Date:** 25 Sep 2026 · **Decided by:** owner

## Roles
The 11 roles from D80 are in place. The owner assigns people to them later, together with profiles.

## LLP status label
The label now reads "Draft". Zoho keeps the original API value `Darft` and does not allow it to be changed, so the console maps `Darft` to Draft.

## SPF
Posted to #growize-app-documents. The owner will merge the records later.

## Zoho Sign
Both routes stay open: the API or manual upload. The D79 fields support both.

## Mail templates
- New fields: `Template_Scope` (Shared or Personal) and `Copied_From` (a lookup to the template it was copied from). The 5 seeded templates are set to Shared.
- **Shared** templates are the team library. Only the creator or an admin can edit them.
- **Personal** templates are a user's own copy or draft. A user can copy any shared template, edit it and send from it. The shared original never changes.
- **Limit:** 10 personal templates per user, enforced by the console. A count query runs before each save, and the console refuses the save when the user is over the limit.
- **Caveat:** Mail Templates sharing is Public Read Only, so personal templates are readable (not editable) by others in Zoho itself. The console shows each user only their own. Making them private in Zoho needs a sharing rule, which is an access grant and is left to the owner.

## Money model (proposed, not applied)
- **Stored on the allotment:** units and Unit_Price. Everything else is computed.
- **Each payment is one Receipt:** kind, amount, date, mode, UTR, and who matched it.
- **Computed, never typed:**
  - amount due = units × price
  - received = sum of receipts
  - balance = due − received
  - status = none / partial / full
- **Old allotment fields become redundant:** Total_Amount_Received, Total_Amount_Receivable, Capital_Invested, Capital_Outstanding, and the 10 Amount/UTR/Date columns. Keep them as history; stop writing to them.
- **Open:** money out to investors (rental-yield payouts, exits, refunds) and TDS on payouts.
