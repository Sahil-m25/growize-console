# D78 — Access plan approved; Zoho Sign plus manual upload into the same slot

**Date:** 25 Sep 2026 · **Decided by:** owner

## Access plan
- **The plan is approved** (`docs/ACCESS-PLAN.md`).
- **R1:** Sahil stays Administrator permanently. He owns and develops the app. The console still logs every reveal.
- **R2 / OD3:** Compliance and Auditor become one seat, Compliance & Audit.

## Documents: two ways into one slot
**Zoho Sign.** The console sends the paper. When signing completes, the webhook files the signed PDF into the paper's slot.

**Manual upload.** Finance uploads the file into the same slot from the console. Use it for:
- wet signatures, Class 3 DSC and power of attorney
- papers signed before the console existed
- receipts and proofs that are never signed
- any time Zoho Sign is down or not bought

**The same after both.** Finance still verifies the paper. How it was signed is recorded, so the Documents queue treats both routes the same.

## Proposed fields per signed or checked paper
These sit next to the paper's slot:

| Field | Type | Holds |
|---|---|---|
| `<Paper>_Signed_Via` | picklist | Zoho Sign – Aadhaar / Zoho Sign – Email OTP / Class 3 DSC / Wet signature / Uploaded (not signed) |
| `<Paper>_Sign_Request_Id` | text | Zoho Sign request id; empty for a manual upload |
| `<Paper>_Verified_By` | user | Who in Finance verified the paper |
| `<Paper>_Verified_At` | datetime | When it was verified |

The NDA comes before an allotment exists, so the proposal is to hold it on the Lead (NDA slot plus the same fields). The investor record reaches it through `Contacts.Origin_Lead`.

These fields are not created yet. They wait for the owner's yes.

## Zoho Sign as found
The built-in browser was used with the owner signed in. The org has a Zoho Sign account (India DC, `sign.zoho.in`) on the **Free Edition**.

The Free Edition has no API and no webhooks, so the console cannot drive signing until the plan is upgraded. The options are Enterprise, or the credit-based API plan. Manual upload works either way.
