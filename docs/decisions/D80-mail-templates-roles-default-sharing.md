# D80 — Mail Templates module; roles and default sharing applied; permission grants left to the owner

**Date:** 25 Sep 2026 · **Decided by:** owner ("sure" to D79)

## Mail Templates
- New `Mail_Templates` module (CustomModule10). Fields: Template_Key (unique), Subject, Body (placeholders `{first}` and `{me}`), Side, Suggested_Stage, Material_Item, Needs_Signed_NDA, Active.
- Seeded with the prototype's 5 templates: intro, deck, webinar, paper, balance. The deck and webinar templates need a signed NDA and carry their material item.
- Default sharing is Public Read Only. Everyone can read and use every template; only the person who created a template, or an administrator, can edit it.

## Access plan: applied so far
- **Role tree:**
  - CEO: BU Owner, Digital Infrastructure. The existing "Manager" role is left untouched.
  - BU Owner: IR Manager, Head of Finance, Head of Account Management, Exec.
  - IR Manager: Investor Relations, Channel Partner.
  - Head of Finance: Finance Operations, Compliance and Audit. "&" is not allowed in role names.
  - Head of Account Management: Key Account Manager.
- **Default sharing:** all Private, except the ones below.
  - LLP Creation Module (farms): Public Read Only.
  - Investor Updates: Public Read Only.
  - Mail Templates: Public Read Only.
  - **Emails: changed from Public (Read/Write/Delete) to Private.** A person now sees only emails on records they can reach (D72).

## Not applied: needs the owner
These steps grant access. The session's safety check stopped at the first sharing rule and did not proceed:
- Sharing rules:
  - Finance roles get read/write on Contacts, allotments and Receipts.
  - Compliance and Audit gets read-only access across the org.
- Profiles and their module permissions.
- Field-level security.
- Record shares, which the console creates in code.

These wait until the owner applies them in Setup, or explicitly lets the session make access-granting changes. The exact settings are in `docs/ACCESS-PLAN.md` §2–§5.
