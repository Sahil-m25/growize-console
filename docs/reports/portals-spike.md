# Spike M20-S07-H7 — Can the Growize investor app connect directly to Zoho CRM Portals? (D110)

Date 30 Sep 2026 · Documentation-level only, no sandbox. Sources are numbered [n] below. Anything not confirmed in official Zoho docs is marked **unverified**.

> **VERDICT: PARTIAL, leaning NO for a direct connection.**
> Zoho CRM Portals is a Zoho-hosted web portal (sign-in by email/password, phone OTP in India, or SAML SSO). No official doc describes a token or API that lets a portal user, as themselves, call CRM data from another app. The documented Portal APIs are admin-only (create portal, list user types, invite users) [4][5].
> So the Flutter app cannot drop Supabase and read allotments, receipts or payouts as the investor. Keep Supabase for app sign-in (D6/D79 stand). Portals stays a possible separate web view for investors, not a replacement.
> **MA1 changes: nothing in M12-S08, the M13 contracts or M10-S23.** The console remains the only caller of Zoho, on service or staff tokens (D45/D53).

## 1. Portal user model
- A portal user is an invited record in a "primary module": Contacts, Leads, Vendors or a custom module. Up to 5 user types (groups) per org [1][2].
- Related data (Deals, Invoices, custom modules) is reached through lookup fields and/or criteria to the primary record [1]. Portal permissions: create/edit/delete own records; "Edit (Shared)" for records added by CRM users; per-field read-only; subforms need separate permission [1].
- Custom and plugin modules can appear in the portal's related-modules section [3]. So LLP_UnitAllocation_Module, Receipts, Investor Payouts and Cases can in principle be exposed if each has a lookup to Contact. **Unverified:** that row-level scoping to "only my records" works across a two-hop chain (Contact → Allotment → Receipt), and how attachments/Notes are exposed. This needs a sandbox test.
- Fit with ACCESS-PLAN (PAN/bank/Aadhaar wall): field-level permission per user type is documented [1][6]; combined behaviour with CRM field-level security is **unverified**.

## 2. Authentication for a native app
- Portal sign-in: email invite then password; phone/SMS login is India-only (DLT approval needed); SAML SSO on Enterprise/Ultimate [1][7]. No OAuth client flow for portal users is documented. The OAuth overview covers CRM "end-users of your account" only and says nothing of portal users [8].
- Zoho's own CRM mobile app has "Sign in to a portal" (portal domain + email + password) [9]. That is Zoho's app, not an SDK for ours. **Unverified:** any Flutter SDK, deep-link or embeddable-widget option; none found. A WebView of the portal URL is technically possible but is the Zoho web UI, not the Growize app design, and the app would not hold a token to call APIs.

## 3. API surface for the app's needs
- Documented portal APIs are admin-scoped (`ZohoCRM.settings.clientportal.*`): create/update/get portals, get user types, invite users (`POST /crm/v4/{module}/{id}/actions/portal_invite`), list users of a type [4][5]. None reads data as a portal user.
- Reading allotments/receipts/payouts/documents and creating a Case as the investor therefore has **no documented direct path**. The only documented consumers are the Zoho-hosted portal pages [1].
- Updates: the portal is pull (the user logs in). Push notification to a Flutter app is **unverified**/not documented; the current console→app signed push (case.replied, farm.progress, update.published) has no Portals equivalent.

## 4. Limits and cost
- Enterprise and Ultimate only. 1,000 portal users free across user types; paid slabs above that are quoted in USD: $3 (1,001–2,000), $2 (2,001–11,000), $1 above [1]. Older posts say $5/user/month and 10,000 free [3]; the slab-pricing announcement says 1,000 free [10]. **India ₹ price for portal licences: unverified** (the pricing table is an image; CRM Enterprise is listed at ₹2,400/user/month [11]). Likely free at ARL's investor count, if under 1,000, to be confirmed with Zoho.
- API credits (Enterprise): 50,000 + 1,000 × licences per 24 h, 20 concurrent calls [12]. Whether portal-user activity consumes these credits is not stated: **unverified**.

## 5. Zoho Sign
- Embedded signing is a server call: `POST .../requests/{id}/actions/{action_id}/embedtoken`, URL valid 2 minutes, one-time, open in a new window or an iframe with `host` set [13]. This is what M12-S08 already specifies and it is independent of Portals.
- The Zoho Sign–CRM integration page does not mention portal users or embedded signing [14]. Signing inside the portal: **unverified**. Sign plan requirement for embedded signing: not stated in [13] (AP3 stays open).

## What MA1 changes if the owner still wants Portals
| Item | Effect |
|---|---|
| M12-S08 | Unchanged. Contact-to-recipient match still done by the console; the Supabase user to Contact mapping is still needed. |
| M13-S01/S05 push contracts | Unchanged. request.raised / case.replied / push.delivered need an app-side receiver; Portals offers none. |
| M10-S23 | Unchanged (Supabase admin generate-link). A Portals-only path would have no equivalent one-time link (**unverified**). |
| Optional add-on | Console could invite an investor to a read-only web portal via `portal_invite` [4]. Sandbox test needed first (two-hop scoping, PAN/bank wall, cost in ₹). It would be a second sign-in identity for investors, against D6's "one identity per human". |

## Sources
1. https://help.zoho.com/portal/en/kb/crm/connect-with-customers/portals/articles/setting-up-portal
2. https://help.zoho.com/portal/en/kb/crm-nextgen/connect-with-customers/portals/articles/nextgen-setting-up-portal
3. https://help.zoho.com/portal/en/community/topic/crm-portal-updates-revised-pricing-and-support-for-plugin-modules (community, secondary)
4. https://help.zoho.com/portal/en/community/topic/kaizen-72-portal-apis-part-i (Zoho Kaizen series, secondary)
5. https://www.zoho.com/crm/developer/docs/api/v8/get-portals.html
6. https://www.zoho.com/crm/developer/docs/api/v8/get-user-types.html
7. https://help.zoho.com/portal/en/community/topic/enable-saml-based-sso-to-simplify-the-login-process-for-crm-portal-users?page=1 (community, secondary)
8. https://www.zoho.com/crm/developer/docs/api/v8/oauth-overview.html
9. https://help.zoho.com/portal/en/kb/crm/crm-mobile/android/getting-started/articles/portals-in-the-zoho-crm-android-app
10. https://help.zoho.com/portal/en/community/topic/weve-revised-the-pricing-model-of-crm-portal-user-licenses (community, secondary)
11. https://www.zoho.com/crm/pricing/
12. https://www.zoho.com/crm/developer/docs/api/v8/api-limits.html
13. https://www.zoho.com/sign/api/embedded-signing.html
14. https://help.zoho.com/portal/en/kb/zoho-sign/integrations/zoho-apps/zoho-crm/articles/sign-crm-integration

Method note: pages were read through a summarising fetch tool, not verbatim; the absence of a portal-user API is "not found in the pages read", not proof it does not exist. Re-check with Zoho support before closing MA1.
