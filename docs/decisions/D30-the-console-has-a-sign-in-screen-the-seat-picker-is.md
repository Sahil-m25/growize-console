# D30 — The console has a sign-in screen; the seat picker is gone

_10 Sep 2026 · implements D06 in the UI · replaces the prototype's `<select id="role">`_

The top bar carried a picker listing all ten people. It was a demo device with a product-shaped
consequence: it said the console is one view that everybody shares. It is not — each seat reaches a
different set of pages, and the whole access model exists to keep them apart.

**The console renders nothing until somebody is signed in.** `AUTHED` gates `draw()`: when it is
false the app element is hidden and `#signin` is what the page contains, so no count, name or lead
is on the glass behind the door.

**The screen is one button.** `Continue with Zoho` (D06: staff sign in with Zoho OAuth 2.0,
per-user tokens; there is no password field of ours). Under it, `You finish signing in on zoho.in.
This console never sees your password.` — the domain is named before the click, which is what
separates a one-button sign-in from a phishing page. The footer names a person, not a helpdesk,
because there isn't one.

**The prototype keeps the ten seats behind that door.** Below a rule marked
`Prototype — sign in as anybody`, each person is a row with their avatar, their seat and how many
pages they reach — 6 for Gokul, 7 for an IR, 14 for Sahil. A demo is still givable, and the row
count makes the point the picker obscured: these are different products.

**Sign-out lives in an account menu** on the avatar, opened as a drawer — the pattern the console
already has, so it is keyboard-safe and becomes a bottom sheet on a phone. It holds the profile,
who is in today, the theme (which leaves the toolbar), and `Sign out`. Three signed-out states are
written: chosen, expired at 12 hours, revoked.

**Not built here, and named so the next session does not have to re-derive it:** step-up
authentication on the eight authoritative actions (D22) is a modal, not this screen; session expiry
must keep a half-typed note in the tab and return to it; `View as <person>` — read-only, 15 minutes,
loudly banded, logged twice and visible on the subject's own profile — is what an admin debugging a
permission complaint gets, and it is not "log in as".
