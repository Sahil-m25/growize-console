# D82 — Payouts module, claims in Receipts, events on Campaigns, Sales Plans, Lead_Status ladder

**Date:** 25 Sep 2026 · **Decided by:** owner (asks) + Jev (design checks) · **Applied in Zoho:** yes, except field clean-up

## Payouts (owner: monthly for 5 years)
- New module **Investor Payouts** (`Investor_Payouts`, CustomModule11). "Payouts" is a Zoho reserved name.
- One record per payout. A 5-year allotment gets 60 records, created by the console when the allotment is issued. No 60 columns on the allotment. Jev: module 0.91 vs 60 fields 0.
- Fields: Allotment (lookup to LLP_UnitAllocation_Module), Payout_Kind (Rental yield/Exit/Refund/Other), Instalment_No, Period_Month, Due_On, Gross_Amount, TDS_Amount, Net_Amount, Payout_State (Scheduled/Paid/Held/Failed/Cancelled), Paid_On, Payout_Mode (NEFT/RTGS/IMPS/UPI), Payout_UTR, Paid_By (user), Payout_Note.
- Annual_Rental_Yield stays on the allotment. It is the contract rate that the schedule is built from.
- **Screens:** no new rail page. There is a Payouts tab on each investor's page (per allotment), where it is tracked today, plus a "payouts due this month" queue on Payments for Finance. Jev: 0.90 vs separate page 0.09.
- Open with owner: TDS rules (rate, 194-series section, PAN-missing rate).

## Claims
- Receipts.Match_State gains **Claimed** (an investor says they paid and Finance has not yet matched it). There is no separate Payment_Claims module. Jev: 1.0.

## Events
- Zoho **Campaigns** module activated and used for events (Jev 0.78 vs a custom module).
- New Campaigns fields: Event_Channel, Event_City, Event_Starts_At, Event_Host (user), Leads_Offered, Event_LLP (lookup to farm).
- New Leads field: `Event` (lookup to Campaigns).

## Plan
- New module **Sales Plans** (`Sales_Plans`, CustomModule12): Period_From, Period_To, Plan_Scope (Team/Person/Farm), Plan_For (user), Plan_LLP, Target_Units, Target_Leads, Collection_Target, Plan_Notes.

## Lead_Status ladder (M02-S02)
- Added the 10 console values: Lead captured, First touch made, Qualified, Engagement done, Investor said yes, Reserved - 10% in, Fully paid, Allocated, Onboarded, Lost.
- Moved to unused (reversible): Not Interested, Not Qualified, New/, Proposal Shared, Converted.
- **Blocked:** Attempted to Contact, Contacted, Junk Lead, Lost Lead, Not Contacted and Pre-Qualified cannot be removed yet. The active Blueprint "Lead nurturing process" uses them. The owner decides whether to retire that blueprint, since the console's ladder replaces it.
- The picklist history tracking related list is now on ("Lead Status History").
- The display order still puts Qualified before Lead captured. The console orders the rungs itself.

## Lead fields (27 new)
Secondary_Owner, Units_Interested, Next_Step(+Channel/At), Forecast, Forecast_Paid_By, Consent_WhatsApp/Email/Call/How/At/By, Lost_Reason, Lost_At, Owner_Assigned_At, Last_Reply_At, eight ladder timestamps, Cover_By, Cover_Until. Verified by COQL. Touches per channel live in the Touches module, by design.

## Field clean-up (owner: "reduce … only which is extra")
- Verified empty by COQL today:
  - LLP_UnitAllocation_Module: Amount 1–10, UTR 1–10, Date 1–10, Deal, Capital_Outstanding, Capital_Returns, Next_Payout (34 fields).
  - Contacts: Account_closed, Approved, Payment_processed, Request_Received, Under_review, Bank_Address_line_1, Bank_Address_line_2 (7 fields).
- **Not removed.** The action was blocked by the session's safety check as a change to a shared resource. The owner removes these fields (Layout → field menu → Remove Field, then Unused Items → Delete) or approves the removal explicitly.
- Kept as history (they hold data, and nothing writes to them any more): Total_Amount_Received, Total_Amount_Receivable, Capital_Invested, Units_Available, Total_LLP_Units, Customer_Email, Token_Advance_Amount; Contacts Yes/No lifecycle picklists.
- Kept: all Leads custom fields (ARL multi-brand), LLP legal/insurance/SPOC fields, Lock_in_Period, Preferred_Communication.

---
# D83 — Events are fields on the lead; leads come in from a Google Sheet (25 Sep 2026, owner)
- No Events/Campaigns page. The Campaigns module was switched off again (its 7 D82 event fields sit dormant, unused). The Leads.Event lookup was deleted (it was created today and was empty).
- New Leads fields: Event_Name (text), Event_Date (date), Event_Channel (Webinar / Farm visit / Office meet / VR session / Expo / roadshow / Partner event / Online campaign).
- Leads come from a Google Sheet. The console loads the sheet (link shared with a service account, or CSV) with a preview: per-row verdict, duplicates by phone/email, owner rule, then a batch write to Zoho (M04-S04, now In plan).
- Plan: M14-S01 is now "Events as a filter and grouping on Leads"; M14-S03 tags leads with their event; M14-S02 and M04-S05 are Dropped. Totals: 146 In plan / 23 After go-live / 8 Dropped.

---
# D84 — Back to the portal: events are records; CSV load + portal owner rules; TDS not computed (25 Sep 2026, owner)
- Owner: "it needs to be as per the portal we are building". The merged portal has an Events page with event records (name, type Society/Club/Partner, channel MyGate/Direct/Partner, dates, city, cost, staff, planned/done, names taken). D83's "events as three lead fields, no page" is withdrawn.
- Plan restored to the portal's stories: M14-S01 Events list and event page, M14-S02 add/correct/remove an event, M14-S03 capture and load tie leads to the event (all In plan). M04-S04 CSV import with preview is In plan (S2).
- Lead owner on load follows the portal exactly: Round-robin across who staffed the event / All to me / All to one person / Leave unassigned. After that, unowned leads sit in "Needs an owner": a manager uses Assign owner, an IR can only Assign to me.
- Zoho storage for the event record is open (module creation was blocked by the session's safety check): reuse Zoho Campaigns as the store (it already has name, type, status, start/end dates, cost, plus our channel/city/host/offered fields) or a new custom module "Lead Events". Leads then get one lookup to it.
- The 3 D83 lead fields (Event_Name, Event_Date, Event_Channel) become redundant once the event record exists; they are empty and can be deleted then.
- TDS: not computed. TDS_Amount stays optional (Finance enters it, default 0); Net = Gross − TDS.
- Blueprint "Lead nurturing process" is Zoho's sample, already deactivated; it only still references 6 old Lead_Status values.

---
# D85 — Lead Events module created; 41 empty fields removed (25 Sep 2026, owner)
- New module **Lead Events** (`Lead_Events`, CustomModule13), matching the portal's event: Name, Event_Type (Society/Club/Partner), Event_Channel (MyGate/Direct/Partner), Starts_On, Ends_On, Event_City, Event_Cost, Event_State (Planned/Done/Cancelled), Names_Taken, Event_Staff (multi-user; the round-robin roster), and the intake-load log: Load_State (Not loaded/Ready/Loaded), Rows_In_File, Rows_Loaded, Rows_Duplicate, Rows_Refused, Loaded_At, Loaded_By.
- Leads get `Lead_Event` (lookup → Lead_Events; related list "Leads from event"). The D83 fields Event_Name/Event_Date/Event_Channel were deleted (empty).
- Owner-approved clean-up done: 34 fields deleted from LLP_UnitAllocation_Module (Amount/UTR/Date 1–10, Deal, Capital_Outstanding, Capital_Returns, Next_Payout) and 7 from Contacts (Account_closed, Approved, Payment_processed, Request_Received, Under_review, Bank_Address_line_1/2). Checked empty by COQL beforehand; confirmed gone by field metadata afterwards. The allotment module now has 52 fields; its 2 live allotments are intact.
- Zoho Campaigns stays switched off; its 7 D82 fields remain dormant there.
