# D68 — Sahil is the super user; Finance stays the primary doer

**Date:** 25 Sep 2026 · **Decided by:** owner · **Applies to:** the merged Growize Console concept (D67 draft)

## Decision
- **Sahil Mohite (Digital Infrastructure) is the super user.** He holds every page and every action on both sides, including revealing PAN, Aadhaar and bank details. One account can test every feature.
- **The Finance team is the primary doer of financial and paperwork steps.** Harsha Bhat leads recording receipts and sending and verifying documents. Compliance (Fahad Rizvi) passes KYC, and Account Management (Divya Kamath) owns care.
  - Their queues stay theirs.
  - The super user can act on any row for testing, and what he does is recorded under his name.

## What changed (`console/prototype/merge/fixes.py`, D68 functions)
- **Investors side:** new role "Super user — Digital Infrastructure" with every capability. The identity wall lets him through: reveals are allowed, and every reveal is logged with its reason.
- **Lead side:** the Digital Infrastructure seat holds every capability its access grid gives it.
  - He can work any lead, assign owners, and record paper steps and contacts.
  - Finance's own lead-side writes stay behind the Finance seat, because Finance records them on the Investors side.
- **Sahil's Today (Investors):**
  - "Finance's queue · primary: Harsha Bhat" and "Account Management's queue · primary: Divya Kamath".
  - A note that these are other people's queues.
  - The subtitle counts both queues.
- **Every panel he opens** names the primary doer of that step.
- **Hand it to Finance** also works for the super user. The ticket records him as the one who handed it.
- **No browser pop-ups on the Investors side** (18 alerts and 3 confirmations). A refusal is now said on the page; a confirmation is a second press of "Yes, do it" on the page, as on the lead side.
- **His title:** "Super user · Digital Infrastructure".

## Checked (as Sahil only; `pm/merge-audit/super-e2e.*`, `sahil-clicks.json`)
- **15 workflows recorded under his name:**
  - Money: receipt recorded from Rohit's claim.
  - Paper: reminder, "they say it's signed", verify; send confirmed separately.
  - Lead work: KYC pass, assign owner, add event.
  - Care: assign manager, log a conversation, open, hand on and close a ticket.
  - Investors: publish an update, farm progress, release land. Revealing a PAN is logged.
- **Same result for the regular seat:**
  - Add lead needs its event and permission details; the result is the same for Tasneem.
  - Sending a document already out is refused; the result is the same for Harsha.
  - Take land back is refused while investors hold units (the rule, shown on the page).
  - The full contact logger is multi-step; the one-tap contact records for Sahil exactly as for Rohit.
- **171 controls pressed on his 21 page views:** 0 errors and 0 browser dialogs.
