# D79 — Integrations corrected; fields to track each paper created

**Date:** 25 Sep 2026

## Paper-tracking fields created (owner's "okay" to D78)
23 fields, created through the API.

| Record | Paper | Fields |
|---|---|---|
| Lead | NDA | `NDA` (file), `NDA_Signed_Via`, `NDA_Sign_Req_Id`, `NDA_Verified_By`, `NDA_Verified_At` |
| Contact | FEMA declaration | `FEMA_Signed_Via`, `FEMA_Sign_Req_Id`, `FEMA_Verified_By`, `FEMA_Verified_At` |
| Contact | PAN proof, bank proof | `PAN_Proof_Verified_By/_At`, `Bank_Proof_Verified_By/_At` |
| Allotment | Supplementary agreement | `Supplementary_Signed_Via`, `_Sign_Req_Id`, `_Verified_By`, `_Verified_At` |
| Allotment | Allocation letter | `Alloc_Letter_Signed_Via`, `_Sign_Req_Id`, `_Verified_By`, `_Verified_At` |
| Allotment | Unit certificate | `Unit_Cert_Verified_By`, `Unit_Cert_Verified_At` |

`Signed_Via` values: Zoho Sign – Aadhaar / Zoho Sign – Email OTP / Class 3 DSC / Wet signature / Uploaded.

## Integrations, as checked
**Staff sign-in: Zoho OAuth.** Correct (D53). Each person signs in with their own Zoho user and token.

**Investor app sign-in: Supabase, not Zoho** (D6). Investors hold no Zoho seat.

**Email: Google Workspace, not Zoho Mail.**
- agresearchlabs.com's MX records point to Google Workspace (aspmx.l.google.com).
- The console sends through Zoho CRM's Send Mail API, from the user's own address, once Gmail is configured in CRM. Replies sync back through CRM's Gmail integration. Every email lands on the record.
- Zoho Mail is not needed unless the company moves its mailboxes.

**Email templates.**
- Zoho CRM's API can read templates and send with a template id. It cannot create or edit templates.
- The org has 1 CRM template ("Big Deal Alert", on Deals). The prototype has 5: Introduction, Deck follow-up, Webinar invite, Paperwork reminder, Balance reminder.
- To let people save templates from the console, the proposal is a small "Mail Templates" module, seeded with the 5.

**Calendar: Google Calendar** (Workspace), using Zoho CRM's Google Calendar sync. Each user connects once. Zoho Calendar is not needed.

**Zoho Sign: yes.** It is on the Free Edition, so the integration needs an upgrade (D78). Manual upload works regardless.

**Also integrated:**
- Zoho CRM (the store)
- the investor app (signed contracts, D73)
- Slack (autopilot notices only)

## Flag: SPF
agresearchlabs.com publishes **3 separate `v=spf1` TXT records**. Under RFC 7208 more than one SPF record is a permanent error, which can send company mail, including mail Zoho sends on your behalf, to spam.

They should be merged into one record that includes Google and Zoho, and whatever the `_spfm` include is. Whoever manages DNS should do this.
