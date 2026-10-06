# D131 — The sandbox cannot email real people (6 Oct 2026)

**Status:** decided and built on branch `fix/sandbox-mail-sink` (from `test-signin-staging`, 8ac4027). Not deployed.
The owner approved: every seed email goes to one test inbox; automated tests may mutate and reseed sandbox data but must send no real email.

## Why
The seed came from the prototype's demo book, whose addresses look real (gmail, corp domains). Zoho Sign runs on the live `sign.zoho.in`
even from staging, and CRM send_mail goes out from the signed-in person's own mailbox. A UI tester driving Send could mail a real person.

## What
1. **Seed data.** `zoho/sandbox/make-manifest.mjs` rewrites every email-type field (key contains "email") and any address in text to
   `tech+gzseed-<seedkey-slug>@agresearchlabs.com` (deterministic, unique per record, under 100 characters). Mobile/Phone fields become
   `+91 90000 0xxxx`, a reserved-looking fake range, so no SMS reaches a real number either. `zoho/sandbox/mail-sink.test.mjs` asserts zero addresses outside the domain.
2. **Guard.** `console/src/lib/mail-guard.ts`. When `ZOHO_CRM_ENVIRONMENT` is not production (an unknown value fails closed), a message leaves only if
   every recipient matches `GZ_SANDBOX_MAIL_ALLOW` (comma-separated domains and/or exact addresses; unset or empty = `agresearchlabs.com`; exact domain, not subdomains).
   One bad or malformed recipient refuses the whole message before any request. The refusal is `{ kind: "refused", reason: "sandbox-mail-blocked" }`
   (alerts throw `MailBlockedError`, code `sandbox-mail-blocked`). The log line carries a 12-hex SHA-256 of each recipient, never an address.
3. **Where it is wired.** `ZohoClient.sendMail` (also the deck mailer and the lead email composer, which call it); `SignApi.createFromTemplate` and `createFromPdf`
   (checked before the draft is created); the alert mailer via `setAlertMailer` (`guardAlertMailer`). The console has no SMTP and no other mail path.

## Not covered
- Mail sent by Zoho itself: CRM workflow rules, Zoho Sign reminders/templates, notification emails inside the sandbox org. Seed addresses are the sink, so they are safe for seeded records, but a test that types a real address into a lead and triggers a workflow is not stopped here. Review sandbox workflows separately.
- Phones in text fields, and any address a tester creates through Zoho's own UI.
- Existing sandbox records keep their old addresses until the admin reseeds.

## Consequences
Tests may reseed freely (`GZSeed.reset`). To let a second inbox through, set `GZ_SANDBOX_MAIL_ALLOW` (it replaces the default).
