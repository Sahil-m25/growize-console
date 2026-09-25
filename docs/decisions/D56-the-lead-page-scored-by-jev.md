# D56 — The lead page, scored element by element by Jev

**Date:** 23 Sep 2026 · **Supersedes:** D55's layout (D55's email approval rule stands) · **File:** `console/prototype/ir-console-redesigned.html` (D55 kept as `ir-console-redesigned.D55.html`)
**Evidence:** `tools/jev-lead-page/` — `context.json` (fixed state), `r1..r5.json` (designs), `out-r1..r5.json` (answers), `lead-page-heatmap.html`, `score.mjs`.

## Method
One Choice per element, same wording every round: *where should it live* — always / only when relevant / one tap away / another page / remove. Jev (jev-1.13.0) also scored the whole page for clutter, 0 (focused) to 4 (overwhelming). The question text and the context stayed fixed; only the design changed between rounds.

| Round | Design | Clutter | ≥0.90 | Top pick = design |
|---|---|---|---|---|
| 1 | D55 as built | 3.43 | 13/56 | 29/56 |
| 2 | Progressive disclosure | 0.40 | 31/51 | 51/51 |
| 3 | Consolidated | 0.29 | 33/46 | 46/46 |
| 4 | Objections and time inline | 0.35 | 34/48 | 47/48 |
| 5 | One Investor file (built) | 0.47 | 34/45 | 44/45 |

## What the page is now
- Header: back, name, one subtitle line (city · phone · value when known · NRI), signal tag only when amber/red, **Investor file**.
- One journey line ("First touch made · step 2 of 9"); tapping it shows the nine stages; **Undo** beside it only while allowed.
- Alerts only when true (now including the reservation clock).
- **Next step card:** step and due date; last contact, preference and owner lines only when they say something; the permitted contact buttons plus **Log a contact**. About six controls before the IR taps anything.
- Tapping Call, WhatsApp or Log a contact opens the flow **inside the card**, one question at a time: channel → outcome → when (Just now / Earlier) and, after a hesitant outcome, objections → next step and date → Save / Cancel. After "Not interested" or "Wrong number" it offers Close as lost or Keep it open. Email opens the composer in the same place; Send is still the owner's approval.
- Rows only while they apply: next milestone (only when it can be confirmed now, or is waiting on Finance), investor says they paid, open paperwork round, forecast.
- A one-line **Add a note** at the bottom.
- **Investor file** drawer, four tabs: History (notes + timeline), People & details, Material (+ produce pack for event leads), Payments (+ Growize account, only once money exists).

## Changes that came from Jev
- The whole logging form showing at all times → shown only while logging (0.93–0.99 on each step).
- The "More options" form → contact-time chips (0.97) and objection chips shown only after a hesitant outcome (0.98).
- Close as lost → moved into the flow after a "no" (0.90+).
- Activity feed, source, email and the duplicate timeline link → moved into the Investor file.
- Value tag and NRI tag → plain text in the subtitle line.
- "Investor copy" dropped from the lead page: it reported the two-org transfer, which D52 removed.

## Where 0.90 was not reached, and why this was accepted
Eleven elements stayed between 0.64 and 0.89 across four different designs. For every one of them except the drawer button, Jev's top pick already matches the design. Their scores moved by about ±0.05 between runs even when the element itself did not change:

- the Back button
- the subtitle line
- the journey line
- the note line
- the last-contact, owner and preference lines
- the People, Material and Payments tabs

TypeSafe's confidence guidance says several acceptable answers spread the probability, and low confidence does not by itself make a choice wrong. The questions were not reworded to lift these scores.

The one mismatch is the **Investor file** button itself. Jev put 0.58 on "one tap away" for the button that *is* the one tap, so the question doesn't fit a trigger. Kept.

## Verified
- 167 lead pages opened across every seat, and 1,344 presses on every page control and file tab: zero errors, zero native dialogs.
- Logging (with an objection), email send, the lost offer and the file tabs tested end to end.
- No sideways scroll at 390px.

## Open
- The stage-aware next-step chips and the email copy are drafts.
- The key lives in `growize/.typesafe-key` (gitignored). It was briefly pasted into `.gitignore` and appeared in a chat screenshot. It was never committed, but **rotate it**.
