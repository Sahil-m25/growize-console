# D58 — Latest note on the card, a time for calls and meetings, and which Zoho record each next step becomes

**Date:** 24 Sep 2026 · **Amends:** D57 · **File:** `console/prototype/ir-console-redesigned.html` (D57 kept as `ir-console-redesigned.D57.html`)

## Why
The owner asked three things: how to see previous notes, how to set the time of a call, and whether Zoho Calendar can be used.
- **Notes** were one tap away (Investor file → History), but nothing on the page pointed to them.
- **Call times** had no control at all. D57 removed the full follow-up form, which had been the only place to set one; "Today" saved with no time, and every other date defaulted to 10:00.

## What changed
- **Latest note on the Next step card.** One line when a note exists: the note, who wrote it and when, and **All notes**, which opens the Investor file on History.
- **Time question for calls and meetings.** After the day is picked, a call or meeting asks one more question:
  - Morning 10:00 · Afternoon 15:00 · Evening 18:00 · Pick a time · Any time that day.
  - Picking a time saves, with the same 10-second Undo.
  - Slots already past are hidden when the day is today.
  - If the investor's preference field or latest note says evening, morning or afternoon, that slot is highlighted and labelled "their note" or "their preference". Example: Sanjay Menon's note "not before 6pm".
- **Tasks still save on the day.** Send the deck, send the yield note, chase the paperwork, chase the balance, book a webinar, book a farm visit, nurture.

## Zoho mapping (for the build; the prototype records it in the log)
| Next step | Zoho CRM record | Visible in |
|---|---|---|
| Call back, Onboarding call | Calls module, scheduled call on the Lead, reminder 15 min before | CRM calendar and the call reminder; **not** Zoho Calendar |
| Office meeting, Farm visit | Meetings module on the Lead | CRM calendar **and Zoho Calendar, two-way**, once the org admin enables CRM–Calendar sync |
| Everything else | Tasks module, due date | CRM calendar |

Sources:
- Zoho Calendar help, *Zoho CRM Sync*: only Meetings sync; "The tasks created and call scheduled using the Tasks and Call modules in Zoho CRM will not be updated in your Zoho Calendar grid"; the admin must enable the sync.
- Zoho CRM help, *Using Calendar*: the CRM calendar shows calls, meetings and tasks.
- Zoho CRM FAQ, *Calls module*: call reminders at 5, 10, 15 or 30 minutes, or 1 hour.

Callbacks stay as Calls rather than Meetings, so that Zoho's call reporting counts them.

## Jev check (`flow-d58.json`, `out-flow-d58.json`)
- Time step: load 0.08 / 4; time chips "ask now" 0.98; nothing likely asked twice (≤0.24).
- Latest-note line: "one-line summary" 0.82.

## Verified
- Call → Tomorrow → Evening saves "Call back · 29 Aug 18:00" as a scheduled call; Undo restores the prior state.
- A task saves on the day with no time.
- Today hides past slots; "Any time that day" saves with no time.
- Office meeting on a said-yes lead (Kavya, L5) saves as a meeting at 15:00.
- 172 lead pages opened across all seats: zero errors.

## Open for the owner
- Turn on the CRM ↔ Zoho Calendar sync in the org (admin setting) for meetings to appear in Zoho Calendar.
- The 15-minute call reminder is a default; change it if the team prefers another.
