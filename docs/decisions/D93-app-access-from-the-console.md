# D93 — Investor app access is controlled from the console, never the Zoho UI

**Date:** 26 Sep 2026 · **Decided by:** owner (Sahil) · **Changes:** M08-S08 · **Adds:** M09-S09, M10-S21, M10-S22, M10-S23

## Decision
1. Everything about an investor's app account is done in the Growize Console. Zoho stays the
   store (D45 zero copy); nobody enters data or flips switches in the Zoho UI.
2. An investor account opens **On hold**: their data reaches the investor app, sign-in is locked
   and no email is sent. The welcome goes out only when Finance presses **Send welcome and unlock**
   on the investor's App account card. This replaces "the welcome goes out by itself at the first
   matched advance" (M08-S08 now opens the account on hold).
3. Finance (and Sahil as super user) can **add an investor who already paid** straight from the
   Investors page (Contact + allotment written to Zoho, App_Access = Hold, no email).
4. **Preview app** (M10-S22): a phone-sized HTML mock-up of the app screens (from Growize App Design v2)
   filled with that investor's data, labelled as a mock-up — for the team to see and explain what the
   investor sees. Nobody signs in as the investor.
5. **Test sign-in link** (M10-S23): super user only — a one-time, 10-minute sign-in link / QR for checking
   the real app on another device; nothing emailed; warned when used on a real investor; audited.

## Mechanism (already built on the app side, 26 Sep)
- Zoho `Contacts.App_Access` (Hold | Invite, default Hold); the console writes it with the user's token.
- Investor app sync `zoho-crm-webhook` v36 reads it: Hold = login created silently and suspended;
  Invite = unsuspend + one Growize welcome email + `App_Welcome_At` / `App_Welcome_Channel` written back.
- `request-auth-email` v11 gives held investors the generic reply (no code).
- Migration 072 (`investors.app_access`, `invited_at`, self-change guard).
- Deploy steps: `Growize App/supabase/APP_ACCESS_ROLLOUT.md`. App-side record: Claude project docs d86–d92.

## Why
The owner wants to add already-converted investors, check what they will see, and only then tell
them — and wants one place (the console) to view and manage it.
