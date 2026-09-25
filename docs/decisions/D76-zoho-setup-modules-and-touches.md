# D76 — Zoho Setup done in the built-in browser; one Touches log for leads and investors

**Date:** 25 Sep 2026 · **Decided by:** owner ("use Jev and do your magic"), with Jev · **Builds on:** D54, D70–D75

## KAM conversation log
**One shared `Touches` module** logs every human contact, from the first IR message to the latest KAM visit. It replaces both the planned IR "Touches" and the planned investor "Care log".
- **Jev choice:**
  - shared Touches 0.64
  - separate Care log 0.30
  - Calls 0.05
  - Notes 0.01
- **Why:** the audit had flagged "two histories for one person".
- **How it links:** each touch links to the **Lead**. An investor's touches are found through `Contacts.Origin_Lead`, so there is no second link to keep in step.

## Created in production (all read back and verified)

| What | How | Fields |
|---|---|---|
| **Cases** enabled (tickets) | Setup, built-in browser | + Ticket_Category (Bank/Query/Records/Access/Compliance), SLA_Due, Closed_At |
| **Receipts** module | Setup + API | Allotment → LLP_UnitAllocation_Module, Kind (Advance/Part/Full/Refund), Amount, Mode (NEFT/RTGS/IMPS/SWIFT/UPI/Cheque), UTR (unique), Received_On, Match_State (Pending/Matched/Not found/Reversed), Matched_By, Reversal_Of → Receipts, Note |
| **Touches** module | Setup + API | Lead → Leads, Channel (WhatsApp/Email/Call/Farm visit/Meeting), Occurred_At, Is_Reply, Mood (Warm/Fine/A concern), Note |
| **Investor Updates** module | Setup + API | Category, Audience (All investors/Allotted only/One farm), LLP → LLP_Creation_Module, Body (rich text), Published_At, Published_By, Sent_Count, Delivered_Count |
| Leads.Lead_Source | Setup | + "Founder network", "Referral — investor" |
| Contacts.App_Account_Mark | Setup | Field history on (who, when, value) |

## Designs trimmed by Jev
Duplicates were removed before anything was built:
- **Receipts:**
  - investor and LLP are read through the allotment
  - "entered by" is Created_By
- **Touches:** no second investor link.
- **Updates:** no state field; an empty Published_At means draft.

On "no duplicate fields", normalised against a known-good and a known-bad design:

| Module | Score |
|---|---|
| Receipts | 0.81 |
| Touches | 0.87 |
| Investor Updates | 0.79 |

All three are below the 0.90 bar. They were built on this run's instruction and have been read back.

## Held
- **Documents module (per-paper state and signing).**
  - Jev's "no duplicate" score stayed at 0.51–0.55 across four redesigns.
  - Zoho already has a standard module called Documents, so the name would clash.
  - Jev does prefer the paper's record holding the file (0.88) over the typed slot fields. So once this module exists, the typed slot fields (D74/D75) become redundant.
  - Needs an owner call before it is built.
- **The "Darft" → "Draft" fix on LLP_Status.** Zoho's editor would not accept the rename from automation. It is a one-minute manual edit: Setup → LLP Creation Module → layout → LLP Status → Edit Properties.
- **Deleting the 10 unused fields on LLP_Unit_Allocation.** Waiting for an explicit yes.
- **Access controls.** The FLS wall, roles, profiles and sharing come as a separate plan. The new modules are Administrator-only until then.
