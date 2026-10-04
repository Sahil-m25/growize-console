# Quick guide: Digital Infrastructure (Sahil)

Seat: Digital Infrastructure, super user on a non-administrator profile (D68, D110). Both sides. Dated 4 Oct 2026. Screenshots from staging go here when staging exists.

## Your job in one line
Reach every page and action to test and support them, run the system checks, grant pages, and run the runbook. Finance stays the doer of money and paper. Your drawers say so.

## Start of day
1. Sign in with Zoho. In Zoho, check your own profile is **Digital Infrastructure**, not Administrator. The permanent super admin is a separate login.
2. Open **System**. Read the counts: working, needs attention, not working, with the owner and fix on each card. The Investors side shows Zoho Sign webhook health and investor-app push delivery. Zoho API credits and licence expiry come from the log.
3. Check your email for alerts (`docs/ops/runbook.md` section 3).

## Your day
**Every page.** The **Lead side | Investors side** switch on Today shows both halves. Drawers on Finance work carry a "super user" note.

**Search the whole org.** Press Ctrl+K. You find leads and investors from every book, phone to last 4 (D110).

**Grant a page, read only.** **Teams**, pick a person, grant a page. An edit grant is refused if the seat cannot hold it. Removing someone's last page ends their access and logs it.

**Change a seat.** Zoho asks you to sign in again first (step-up). The change is logged with your name. A manager change that would loop is refused.

**Identity values.** On this profile PAN, Aadhaar and bank are hidden in the console and in Zoho. D110 says logged reveals; the older story says no reveal is offered. Write down what the app does. Open question **OPEN — owner**.

**Test flows.** On a spare investor you can press Send for signature, release a farm, add an already-paid investor. Use the sandbox only. Never real investor data.

**Failed-write test.** Arm it, make a save: it fails once, shows Retry, then saves once.

**Logs and refusals.** **Activity** and the log views show refusals with who, what, when, why. Lines hold ids and status, never names, PAN, bank or notes.

**Weekly.** Monday: sign-in history in Zoho Directory (`ops/runbooks/sign-in-history.md`). Weekly: confirm a backup file exists and Zoho exports under `zoho/` are current.

**Smoke suite.** Six cases: sign in, Today, open a lead, save a note on a test lead, search, sign out. Under 3 minutes. Run before and after any change.

**Onboard or remove a person.** `docs/ops/runbook.md` section 11.

## What you will not do
- Use an administrator token in the app. Never.
- Act as another person. Every human reads and writes as themselves.
- Paste a token or secret anywhere.

## Faults
Use `docs/ops/runbook.md`. For a leak go straight to `ops/runbooks/pii-leak.md`.

## If something goes wrong with this guide
Fix it and change the date.

Source: UAT-DI (DI-01 to DI-16).
