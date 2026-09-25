# D72 — Zoho Sign inside the console, isolated per user

**Date:** 25 Sep 2026 · **Decided by:** owner (question 9) · **Replaces:** eMudhra in the old Investors-side plan

## Is it possible? Yes, through the Zoho Sign API (India DC `sign.zoho.in`)
- **Send:** create a request from a template (`/templates/{id}/createdocument`) or from an uploaded PDF (`/requests`). Recipients are prefilled from the Zoho record.
- **Signing method:** Aadhaar eSign or email OTP. Signing uses credits.
- **Staff UI:** either our own "Send for signature" drawer driven by the API, or Zoho's embedded sending page in an iframe.
  - For embedded sending: `embedsendtoken`, a link that is valid for 2 minutes, then a 1-hour session. Our domain must be registered as trusted.
- **Investor signs** in one of two ways:
  - By the Zoho Sign email.
  - Embedded in the investor app: `is_embedded: true`, then `/actions/{id}/embedtoken?host=…`. The URL can be used once and is valid for 2 minutes. No email is sent in this case.
- **Status:** Zoho Sign webhooks deliver sent, viewed, signed, completed, declined, expired and recalled.
  - Webhooks are HMAC-signed and verified on our server.
  - The limit is 2 webhooks per account.
- **On completion:** the server downloads the signed PDF, attaches it to the allotment (D71), and sets `Agreement_Signed`.
- **Storage:** the request id and status live on the Zoho record, not in a console database.

## UI/UX (to prototype next)
- **Documents tab on the investor record,** grouped by scope: Personal, then one group per allotment/farm, then Project.
  - Each row shows the file, its state and who uploaded it.
- **"Send for signature" drawer:**
  1. Pick a template or an uploaded PDF.
  2. Recipients are prefilled and locked to the record.
  3. Pick the signing method.
  4. Preview, then Send. An in-page confirm replaces the browser dialog.
- **Signature timeline** on the document: sent → viewed → signed / declined / expired, with Remind and Recall. Finance is the primary doer; Sahil sees a super-user note.
- **Signed PDF viewer:** streamed from Zoho, never cached.
- **Emails tab on each record.** It is read through the Zoho CRM Emails API (`/{module}/{id}/Emails`, then View Email) with the viewer's own token. A person sees only emails on records they can open. Zoho returns 403 otherwise, and the console gate checks first.

## Security: no cross-contamination
- Every call is made with the signed-in person's own Zoho token (D53). The server re-checks record access before any sign, upload, download or email read.
- An embedded signing URL is generated only for a signed-in investor whose Contact matches the recipient. It is never stored and never logged.
- The webhook receiver trusts only HMAC-valid payloads. It writes to the record named in the request's own stored id, never to one named by a caller.
- The M12-S10 isolation suite uses two users per seat and two investors in different LLPs. It proves that nobody sees another person's documents, requests or emails.

## Needs (owner)
- **AP3:** a Zoho Sign plan with API and webhooks. API and webhooks come only with Enterprise or the API plan. The CRM connector shows no Zoho Sign integration today.
- **MA2:** templates from Finance.
- **OD8:** the signing method per investor type.
- **Cost:** the API plan is credit-based, about 5 credits per request.

Sources: [Embedded signing](https://www.zoho.com/sign/api/embedded-signing.html) · [Embedded sending](https://zoho.com/sign/api/embedded-sending.html) · [Webhooks](https://help.zoho.com/portal/en/kb/zoho-sign/admin-guide/articles/webhooks-management) · [OAuth scopes](https://www.zoho.com/sign/api/oauth.html) · [Root endpoints](https://www.zoho.com/sign/api/api-endpoint.html) · [Emails of a record](https://www.zoho.com/crm/developer/docs/api/v8/get-email-rel-list.html) · [Pricing review](https://verdocs.com/blog/zoho-sign-pricing)
