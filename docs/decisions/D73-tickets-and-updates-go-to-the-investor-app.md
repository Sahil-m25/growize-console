# D73 — Tickets and updates are pushed to the investor app

**Date:** 25 Sep 2026 · **Decided by:** owner (question 6)

## Decision
- The console is where tickets (cases) and investor updates are written.
- Investors receive them in the existing investor app, which uses Supabase sign-in (D6).
- The push goes through the signed event contracts in `contracts/`:
  - `case.replied`, `farm.progress`, `push.delivered`, `request.raised` and related events.
  - Each is an HMAC-SHA256-signed HTTPS POST, deduplicated on `event_id`.
- Until the app's codebase is in the repo, the push is built against the contracts and a stub receiver (M13, M20-S07).

## Needs (owner)
- **MA1:**
  - The app codebase added to this folder.
  - The app's staging URL.
  - The contract signing secret.
  - How a Supabase user maps to a Zoho Contact.
- **AP2:** enabling Cases in Zoho for tickets.
