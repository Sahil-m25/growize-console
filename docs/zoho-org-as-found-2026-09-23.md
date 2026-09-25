# The Zoho org as found — 23 Sep 2026

_First read of the real org through the Zoho CRM connector. Read-only: nothing in the org was created, changed or deleted. Metadata and aggregate counts only; no record bodies were copied into this repo. The structured version is `docs/zoho-org-snapshot-2026-09-23.json`._

**Whose eyes these are.** The connector is signed in as the Tech Team user, which holds the Administrator profile and the CEO role. The Administrator profile bypasses field-level security, so everything below is what an admin sees. Nothing here proves what a restricted user would see; that is still A-12 and T11.

---

## The org

| | |
|---|---|
| Company | Growize, org id `1169101000000020813`, domain `org60061770791`, production |
| Edition | **Enterprise, paid** (D51/D52's assumption holds) |
| Paid until | **13 Oct 2026** — twenty days from this read |
| User licences purchased | **1** |
| Portal licences | 0 |
| Lite users | not enabled |
| Hierarchy | Role hierarchy |
| Currency / time zone | INR / Asia/Kolkata. Country code on the org record is `US` — it says nothing reliable about the data centre, so take the API host from the token's `api_domain` (as `client.ts` already does) and do not assume `.in` |

## Users, roles, profiles

| User | Status | Profile | Role |
|---|---|---|---|
| Tech Team (tech@) | active — the super admin and the connector's identity | Administrator | CEO |
| Pradeep Ram | disabled 12 Aug 2026 (created the org) | Administrator | CEO |
| Sales ARL | disabled, never confirmed | Administrator | CEO |

One role exists (CEO). Two profiles exist on the standard modules (Administrator, Standard) and nobody holds Standard. Team modules carry their own five profiles (Admins, Managers, Members, Participants, Requesters). No assignment rules. The connector has no tools for sharing settings, profile permissions, blueprints or workflow rules, so those were **not read** — see C-10.

## What is in it

| Module | Records | What it is today | Maps to in our design |
|---|---|---|---|
| Leads | 5, **all natively converted** | Zoho's generic sales picklists; nine custom fields (Customer_Group, Brand_Area_of_Interest, Residency, High_Level_Product_Interest, Lead_Nature, **PAN**, Preferred_Communication, FEMA_Applicable, KYC_Status) | The console's Lead, all seven rungs. **No rung fields yet**; `Lead_Status` still has Zoho's default values |
| Contacts | 4 | Investors. Ten Yes/No lifecycle picklists (Profile_verified → Account_closed), Residency, FEMA, KYC, bank block, **PAN_Number (plain)**, **Bank_Account_Number (encrypted)**, **Aadhaar_Number (full number, encrypted)** | The investor (D52). Lifecycle belongs in a blueprint (B41), not ten picklists |
| Deals | 2, both *Proposal/Price Quote* | The investment deal: Advance_Paid, Units_Allotted, LLP_Name, Structure, Receivable, Customer_Name → Contacts | Not in the design at all. Created by native conversion |
| Accounts | 0 | PAN, GST, SPOC → Contacts | Corporate investors (Lead_Nature = Company/Trust/Family Office) — undecided |
| LLP_Creation_Module | 1, *Open for Reservation* | The farm LLP: total/issued/reserved/available units, Tier, LLP_Status, yield, PAN, GST, insurance, two addresses | **Projects/shelf (B38)** — near-exact |
| LLP_UnitAllocation_Module | 2, *Issued* | Allocation: Customer, Deal, LLP, units, unit price, capital invested/returns/outstanding, **and receipts flattened into Amount_1..10, UTR…UTR_10, Date_1..10** | **Allotments (B41)**; the flattened columns are **Receipts (B32)** in the wrong shape |
| ARL_Holdings | 5 | Corporate instruments (CCD / Equity / Preference) per investor: invested, current value, interest, maturity, conversion | Not in the design. ARL-level, not LLP units |
| ARL_Transactions | 1 | Capital Call / Interest / Distribution / Conversion / Fee against a holding | Not in the design. The ARL-side ledger |
| LLP_Unit_Allocation *(Team module)* | 1 | Duplicate of the allocation module | Retire after checking the record |
| LLP_Creation *(Team module, hidden)* | ? | Duplicate of the LLP module; **the super admin cannot read it** (NO_PERMISSION) | Retire after someone with the Team-module Admins profile checks it |

## Identity fields — where the wall is today

Every field below is **read_write to both profiles**. There is no field-level security wall yet; with only admins in the org it has not mattered, and it matters the day a second human gets a seat.

| Module | Field | Stored as |
|---|---|---|
| Contacts | Aadhaar_Number | **full number**, encrypted |
| Contacts | Bank_Account_Number | encrypted |
| Contacts | PAN_Number | plain text |
| Contacts | Date_of_Birth, Bank_Name, Bank_Branch, ISFC_Code (sic), Bank_Address_line_1/2 | plain text |
| Leads | PAN | plain text |
| Accounts | PAN, GST | plain text |
| LLP_Creation_Module | PAN, GST | plain text (the LLP's own — not personal) |
| LLP_UnitAllocation_Module | UTR, UTR_2 … UTR_10 | plain text |

The design (B26, B29) has PAN and bank account encrypted behind field-level security, and KYC holding only `aadhaar_last4` and `aadhaar_ref`. Holding a full Aadhaar number is also something to check with a compliance adviser: Indian rules restrict which entities may store it and how. That is a flag, not legal advice.

## Where this meets the decisions

_23 Sep 2026 — points 2, 4, 5 and 7 (and the order behind 8) were put to the owner as multiple choice the same day and decided as recommended: **D54**._

1. **Edition: confirmed.** Enterprise, paid. D51/D52 stand.
2. **Seats: one.** D53 needs a full Enterprise seat for every human. Nobody else can be added — and T11's restricted test user cannot exist — until more are bought.
3. **Renewal: 13 Oct.** If Enterprise lapses, field-level security, sandbox, approvals and the concurrency figures D46/D53 rely on go with it.
4. **Native conversion is in use.** D52 scored it zero. Jev 0.97: hold D52 — stop converting from today, leave the five converted Leads and their Contacts/Deals as legacy history (a converted Lead cannot be un-converted). This also answers C-08.
5. **The investor side is half-built already, under other names.** Jev 0.99: adopt and extend rather than build fresh — LLP_Creation_Module becomes Projects/shelf, LLP_UnitAllocation_Module becomes Allotments, ARL_Holdings/ARL_Transactions stay as the corporate-instrument ledger, and only the modules with no existing home are created (Receipts, Documents, Holds, KYC Files, FEMA, Requests, Care log). API names are permanent, so adopting keeps the names the live records already sit under and migrates almost nothing. The IM mapping workbook's "proposed" rows for these objects now point at the existing modules (sheet *Org as found*).
6. **The flattened receipt columns cannot carry maker-checker or reversals** (Jev 0.06 that they can). Receipts become one record each; the two issued allocations' payments move into it.
7. **Aadhaar.** Jev 0.99: move to `aadhaar_last4` + `aadhaar_ref`, hide the full-number field from every profile now, and let the owner decide with compliance advice when to clear and remove it. Clearing is a destructive change and is not done here.
8. **The wall before the second user.** Jev 0.86 against giving anyone a seat before the D52 profiles, roles and field-level security exist — every field is currently open to every profile.
9. **B-12** cannot be tested yet: one role, one active user. It stays a T11 item.

## Not read, and why

Blueprints, workflow rules, validation rules, sharing settings, profile module permissions, the audit log and API usage have no tool in this connector. They need either the Zoho UI or the app's own OAuth client calling the settings APIs. **Q32/T2, answered for this org:** COQL ran against the org — plain `COUNT(id)` and `GROUP BY` — through the connector's v8 COQL call. Edition limits apply to the org, not to the calling client, so on Enterprise the COQL endpoint is not gated. Q32 was a Professional-edition worry and closes under D51. What the connector cannot show is the app's own OAuth client and scopes; that is still the first thing T1 checks.
