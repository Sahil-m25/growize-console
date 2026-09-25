# D55 — The lead page answers one question: what happens next

**Date:** 23 Sep 2026 · **Page:** the individual lead (`vLead`) · **File:** `console/prototype/ir-console-redesigned.html` (previous version kept as `ir-console-redesigned.before-D55.html`)

## Why
Owner: "too much to handle and process for one person… I got confused searching for the functions." The old page spread one job — record what happened and set the next step — across a context card, four buttons to four windows (Timeline, Notes, Documents, Details), an Appointment fold, a nine-row Journey fold, a "More investor tools" grid of up to 15 doors, a second "Other contact channels" fold, and a follow-up form of five drop-downs.

## What the page is now
1. **Header** — name, city/phone, value, signal, and one **More** menu.
2. **Journey bar** — nine dots in one line (was a nine-row fold).
3. **Next step card** — Contact now (Call / WhatsApp / Email), then three tap-only rows: *How did you reach them?* → *What happened?* → *What's next?* (3–4 stage-aware step choices + Today / Tomorrow / In 3 days / Next week / Pick a date) → **Save**. Under it, the next milestone with its one button (or who it waits on) and the current paperwork round, only when one is open.
4. **Right column** — five key facts; **Activity** = notes + contacts + changes in one feed, with an inline note box.
5. **More menu** — everything rare: owners & cover, details & permission, full timeline, paperwork, material sent, forecast, payment reported / history, Growize account, reservation clock, produce pack, investor copy, undo last step, close as lost / re-open.

Alerts (lost, no owner, cover, move request, payment reported/not found, no permission) are one line each and only when true.

## What was not changed
No capability removed; every control calls the writer the old page called (`saveFollowup`, `tick`, `untick`, `skipStage`, `addNote`, the drawers), so gates, permissions, validation and the log are unchanged. "More options" still opens the full follow-up form (objections, contact time). The old page survives as `vLeadClassic()`.

## Email: written in the console, approved by pressing Send
The Email button no longer opens `mailto:`. It opens a composer (5 templates, stage-picked default, editable). **Nothing is sent until the owner — or whoever is actively covering, under the same `canWork` gate — presses Send.** In the build Send calls Zoho CRM's Send Mail API (`POST /crm/v8/Leads/{id}/actions/send_mail`) with that user's own token (D53), so it goes from their address and sits on the record's Emails list — no copy (D45). In the prototype it records the email touch and renames the log line "Email approved and sent · From <address> via Zoho". The change applies wherever the contact buttons appear (Today panel too).

## Verified
Every seat × every lead it can open (172 renders), every More-menu item pressed (1,093 presses): zero errors, zero native dialogs. Chip save, email send and inline note tested end to end. No page-level sideways scroll at 390px.

## Open for the owner
- Stage-aware next-step choices are a first guess (`lpNextChoices`) — adjust to the IR team's real vocabulary.
- Email templates are placeholder copy — to be replaced with approved text (and later Zoho CRM templates).
- Whether any More-menu item should be deleted outright rather than tucked away.
