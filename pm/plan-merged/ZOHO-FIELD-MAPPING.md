# Zoho field mapping — Investors side of the merged console (25 Sep 2026)

Source of truth for how every fact on the Investors-side screens (INV, allotments, FARMS, DOCS, TXN, TKT, UPD, APP, FIELD, CONTACT) lands in the live Zoho org. Machine copy: `zoho-field-mapping.json`.

**Counts:** {'CREATED 25 Sep': 36, 'exists': 26, 'derived': 3, 'setup_edit': 4, 'HELD (below bar)': 2, 'new_module': 3, 'open': 1}

**Jev check:** one job per row, "does this Zoho target hold the prototype fact correctly" + for new fields "is a new field really needed". *Normalised: a deliberately wrong mapping (PAN → Bank_Name) = 0, a plainly right one (email → Email) = 1; runs repeated 3× for borderline rows. Rows created: normalised ≥ 0.90 and needed ≥ 0.80, or decided by the owner (Aadhaar last-4/ref D54; Origin_Lead/Originating_IR D69/D74) where Jev plateaued at 0.79–0.84.

**Written to Zoho (production, additive only, nothing edited or deleted):** 36 custom fields — Contacts 20, LLP_Unit_Allocation 10, LLP_Creation_Module 6. Re-read after writing: all 36 present with the right type, picklist values and lookup.

**Held:** App_Mark_By (0.60) and Hold_Extension_Decided_By (0.81) — likely better taken from Zoho's own approval/field history; decide when the approval process is built.

**Needs Zoho Setup (not possible through the connector):** new modules Receipts, Documents, Investor_Updates; enable Cases (+ Category, SLA_Due, Closed_At); add 'Founder network' and 'Referral — investor' to Leads.Lead_Source; rename LLP_Status 'Darft' → 'Draft'; field history on App_Account_Mark; FLS wall (PAN, bank, Aadhaar); hide Contacts.Aadhaar_Number after back-fill (D54). KAM conversation log (OD6) still open.

| Entity | Prototype key | Meaning | Zoho module | Zoho field | Status | Jev correct* | Jev new-needed |
|---|---|---|---|---|---|---|---|
| Investor | id | ARL investor code, e.g. ARL-INV-0205; the join key with the investor app | Contacts | ARL_ID | CREATED 25 Sep | 1.15 | 0.95 |
| Investor | n | full name | Contacts | First_Name + Last_Name (Full_Name) | exists | 0.95 |  |
| Investor | ph | the investor's mobile number, e.g. +91 98450 33021 (Indian or overseas); the only phone th | Contacts | Mobile | exists | 1.18 |  |
| Investor | em | email | Contacts | Email | exists | 1.06 |  |
| Investor | city | city | Contacts | Mailing_City | exists | 1.05 |  |
| Investor | addr | postal address | Contacts | Mailing_Street / Mailing_Flat_House_No_Building_Apartment_Name / Mailing_Zip / Mailing_Sta | exists | 0.94 |  |
| Investor | nri | true when the investor lives abroad (NRI or OCI), false for residents | Contacts | Residency (Resident / NRI / OCI) | exists | 0.88 |  |
| Investor | fema | FEMA applies (NRI) | Contacts | FEMA_Applicable (boolean) | exists | 1.08 |  |
| Investor | pan | PAN, e.g. AVRPM4471K; masked except for Finance/KYC | Contacts | PAN_Number | exists | 1.12 |  |
| Investor | aadh | the last 4 digits of the investor's Aadhaar, e.g. '7712' — the prototype never holds more  | Contacts | Aadhaar_Last4 | CREATED 25 Sep | 0.84 | 0.70 |
| Investor | aref | the UIDAI reference number that stands in for the full Aadhaar, e.g. UIDAI-2507-889021; no | Contacts | Aadhaar_Ref | CREATED 25 Sep | 0.79 | 0.95 |
| Investor | kyc | passed / pending / failed | Contacts | KYC (Completed / In Progress / Failed / Not Started / NA) | exists | 1.14 |  |
| Investor | kycOn | date KYC passed | Contacts | KYC_Completed_On | CREATED 25 Sep | 1.20 | 0.92 |
| Investor | bank.acct | payout bank account number | Contacts | Bank_Account_Number (encrypted) | exists | 1.00 |  |
| Investor | bank.ifsc | IFSC | Contacts | ISFC_Code | exists | 0.92 |  |
| Investor | bank.name | account holder name | Contacts | Account_Holder_Full_name | exists | 1.05 |  |
| Investor | bank.drop | penny-drop result: matched / pending / mismatch | Contacts | Bank_Verification | CREATED 25 Sep | 1.09 | 0.94 |
| Investor | units | units held across farms | LLP_Unit_Allocation | sum of Issued_Units + Committed_Units per Customer | derived | 0.94 |  |
| Investor | blocks | how many units the investor holds on each farm, e.g. {A:4} = 4 units on farm A | LLP_Unit_Allocation | one LLP_Unit_Allocation row per investor x farm: LLP_Lookup = the farm, Issued_Units/Commi | derived | 1.09 |  |
| Investor | st | reserved until the balance lands, then allocated | LLP_Unit_Allocation | Allocation_Status (Reserved / Issued / Cancelled) | exists | 0.94 |  |
| Investor | ir | IR whose lead became this investor (D69; 'own' = owner at Said yes) | Contacts | Originating_IR | CREATED 25 Sep | 1.06 | 0.95 |
| Investor | lead | link to the lead record this investor came from (e.g. L6); leads are no longer converted ( | Contacts | Origin_Lead | CREATED 25 Sep | 0.83 | 0.93 |
| Investor | since | date the investor said yes | Contacts | Said_Yes_At | CREATED 25 Sep | 1.03 | 0.83 |
| Investor | src | source: Events / Founder network / Referral — investor | Leads | Origin_Lead -> Lead_Source | setup_edit | 1.06 |  |
| Investor | nominee (name) | nominee's name, e.g. 'S. Menon' from 'S. Menon (spouse)' | Contacts | Nominee_Name | CREATED 25 Sep | 1.09 | 0.95 |
| Investor | nominee (relation) | nominee's relation, e.g. spouse | Contacts | Nominee_Relation | CREATED 25 Sep | 1.15 | 0.97 |
| Investor | kam | key account manager | Contacts | KAM | CREATED 25 Sep | 1.05 | 0.94 |
| Investor | kamOn | date the KAM was named | Contacts | KAM_Since | CREATED 25 Sep | 1.03 | 0.93 |
| Investor | intro | introduction call time | Contacts | KAM_Intro_At | CREATED 25 Sep | 1.09 | 0.95 |
| Investor | tier | care tier A/B/C from total units held (A >= 4, B >= 2, C >= 1); sets KAM cadence | LLP_Unit_Allocation | computed in the console from the sum of the investor's units across allotments; no stored  | derived | 0.50 |  |
| Investor app | APP.mark | app account tentative / permanent (Head of Finance may take back within a week) | Contacts | App_Account_Mark | CREATED 25 Sep | 1.03 | 0.92 |
| Investor app | APP.markAt | when the mark was set | Contacts | App_Mark_At | CREATED 25 Sep | 0.94 | 0.90 |
| Investor app | APP.welcome.at | when the welcome was delivered | Contacts | App_Welcome_At | CREATED 25 Sep | 1.09 | 0.92 |
| Investor app | APP.welcome.ch | channel the welcome went by (email / WhatsApp / SMS) | Contacts | App_Welcome_Channel | CREATED 25 Sep | 1.00 | 0.95 |
| Investor app | APP.markBy | the person who last changed the app account mark by hand (Head of Finance); empty when the | Contacts | App_Mark_By | HELD (below bar) | 0.60 | 0.93 |
| Investor app | APP.hist | history of mark changes: to, at, by | Contacts | Zoho field history tracking on App_Account_Mark (records old value, new value, who, when) | setup_edit | 0.49 |  |
| Investor docs | KYC papers | personal scope: PAN proof | Contacts | PAN_Proof | CREATED 25 Sep | 1.15 | 0.94 |
| Investor docs | bank proof | personal scope: the cancelled cheque or bank letter that proves the payout account | Contacts | Bank_Proof | CREATED 25 Sep | 1.10 | 0.95 |
| Investor docs | FEMA declaration | personal scope, NRI only | Contacts | FEMA_Declaration | CREATED 25 Sep | 0.97 | 0.92 |
| Allotment | investor | who holds it | LLP_Unit_Allocation | Customer -> Contacts | exists | 0.98 |  |
| Allotment | farm | which farm LLP | LLP_Unit_Allocation | LLP_Lookup -> LLP_Creation_Module | exists | 1.11 |  |
| Allotment | units reserved | units and amount the investor has committed while the allotment is Reserved (before it is  | LLP_Unit_Allocation | Committed_Units / Committed_Amount | exists | 1.08 |  |
| Allotment | units allotted | units once issued | LLP_Unit_Allocation | Issued_Units / Issued_Amount | exists | 1.02 |  |
| Allotment | unit price | price per unit | LLP_Unit_Allocation | Unit_Price | exists | 1.08 |  |
| Allotment | balance due | amount still receivable | LLP_Unit_Allocation | Reserved_Amt_Receivable | exists | 1.03 |  |
| Allotment | paid state | none / partial / full | LLP_Unit_Allocation | Payment_Status | exists | 1.11 |  |
| Allotment | amount received | sum of confirmed receipts | LLP_Unit_Allocation | Amount_Received | CREATED 25 Sep | 1.08 | 0.90 |
| Allotment | hold | reservation held until, e.g. 23 Sep | LLP_Unit_Allocation | Hold_Until | CREATED 25 Sep | 1.18 | 0.89 |
| Allotment | extension.state | hold extension request: waiting / approved / declined | LLP_Unit_Allocation | Hold_Extension_State | CREATED 25 Sep | 1.06 | 0.94 |
| Allotment | extension.days | days asked for | LLP_Unit_Allocation | Hold_Extension_Days | CREATED 25 Sep | 1.11 | 0.95 |
| Allotment | extension.why | reason given | LLP_Unit_Allocation | Hold_Extension_Reason | CREATED 25 Sep | 1.11 | 0.92 |
| Allotment | extension.by | who asked (the IR) | LLP_Unit_Allocation | Hold_Extension_Asked_By | CREATED 25 Sep | 1.03 | 0.87 |
| Allotment | extension.did | who decided the extension (only the BU Owner may) | LLP_Unit_Allocation | Hold_Extension_Decided_By | HELD (below bar) | 0.81 | 0.92 |
| Allotment | extension.on | when the extension was decided | LLP_Unit_Allocation | Hold_Extension_Decided_At | CREATED 25 Sep | 1.09 | 0.91 |
| Allotment | agreement | supplementary agreement signed (summary) | LLP_Unit_Allocation | Agreement_Signed | exists | 1.00 |  |
| Allotment docs | Supplementary agreement | allotment scope, signed PDF | LLP_Unit_Allocation | Supplementary_Agreement | CREATED 25 Sep | 1.08 | 0.90 |
| Allotment docs | Allocation letter | allotment scope, signed PDF | LLP_Unit_Allocation | Allocation_Letter | CREATED 25 Sep | 1.05 | 0.89 |
| Allotment docs | Unit certificate | allotment scope | LLP_Unit_Allocation | Unit_Certificate | CREATED 25 Sep | 1.17 | 0.93 |
| Allotment | exit | exit requested / in progress / done | LLP_Unit_Allocation | Exit_Status | exists | 1.18 |  |
| Farm | n | farm/block name | LLP_Creation_Module | Name | exists | 0.95 |  |
| Farm | k | short block code, e.g. A | LLP_Creation_Module | Block_Code | CREATED 25 Sep | 1.15 | 0.94 |
| Farm | acres | acreage | LLP_Creation_Module | Acreage_Acres | exists | 1.22 |  |
| Farm | units | total units | LLP_Creation_Module | Total_Units | exists | 1.03 |  |
| Farm | released | units released for sale on the farm, e.g. 62 of 62 on Block A, 0 on Block C | LLP_Creation_Module | Units_Released | CREATED 25 Sep | 0.96 | 0.82 |
| Farm | soil | soil type | LLP_Creation_Module | Soil_Type | CREATED 25 Sep | 1.18 | 0.96 |
| Farm | crop | crop stage | LLP_Creation_Module | Crop_Stage | CREATED 25 Sep | 1.18 | 0.96 |
| Farm docs | LLP deed | project scope | LLP_Creation_Module | LLP_Deed | CREATED 25 Sep | 1.12 | 0.95 |
| Farm docs | Insurance policy | project scope | LLP_Creation_Module | Insurance_Policy_Document | CREATED 25 Sep | 0.98 | 0.93 |
| Farm | status typo | 'Darft' picklist value | LLP_Creation_Module | LLP_Status | setup_edit | 1.23 |  |
| Farm notes | FIELD | dated field note on a farm: headline, text, who, when (the stage shown with it is the farm | LLP_Creation_Module | Notes on the LLP record (Note_Title = headline, Note_Content = text, Created_By = who, Cre | exists | 0.84 |  |
| Payment | TXN | receipt: kind advance/full/refund, amount, mode NEFT/RTGS/SWIFT, UTR, date, entered by, ma | Receipts | new module | new_module | 0.71 |  |
| Document | DOCS | one paper: type, scope, state sent/signed/verified, signing method, Zoho Sign request id,  | Documents | new module | new_module | 0.94 |  |
| Ticket | TKT | investor request: title, category (Bank/Query/Records/Access/Compliance), opened, opened b | Cases | Cases standard fields: Subject=title, Description=text, Contact_Name=investor, Owner=owner | setup_edit | 0.94 |  |
| Update | UPD | investor update: id, title, category (Produce/Statement/Compliance), published on, by, aud | Investor_Updates | new module | new_module | 0.36 |  |
| KAM log | CONTACT | conversation: channel, mood, note | Calls (standard) or Notes | open | open | 0.22 |  |
