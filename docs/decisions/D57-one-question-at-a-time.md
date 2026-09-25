# D57 — Inside the logging flow: one question at a time, nothing asked twice

**Date:** 23 Sep 2026 · **Amends:** D56's logging flow and composer · **File:** `console/prototype/ir-console-redesigned.html` (D56 kept as `ir-console-redesigned.D56.html`)
**Evidence:** `tools/jev-lead-page/flow.mjs`, `flow-d56|d57|d57b|d57c.json`, `out-flow-*.json`, second section of `lead-page-heatmap.html`.

## The owner's report
Once inside a step, the IR saw options unrelated to it. Closing a lead asked for the same fact twice: "What held them back? → Yield", then "Why it is lost → Yield not convincing".

## Method
The page-level analysis (D56) scored where elements live, not what the IR sees at each step. So each logging path was scored at its last step, with Jev given what had already been answered:
- **Choice per item on screen:** ask now / show as a one-line summary / hide / never.
- **Noul per item:** does it ask for a fact already given, or asked elsewhere on screen?
- **Score per screen:** load, from 0 (only the current question) to 4 (the same fact twice, or a search among options).

The paths: interested; no answer; not now; not interested → lost; email.

## Findings on D56
- **Load was 2.44–2.75 on every logging path**, against 0.41 on email.
- **Answered questions should collapse to their answer** (0.84–0.94).
- **Three duplicates:**
  - asking the channel after the IR pressed Call (0.81–0.87);
  - "why it is lost" after "what held them back" (0.72);
  - the outcome, once "close this lead?" is asked (0.80).
- **Found in testing, not by Jev:** the drawer's Close button saved the loss but not the call, so the touch count was wrong.

## What changed
- **Only the current question shows.** Everything answered becomes one summary line ("Call · Not interested · just now") with Change and ×.
- **Opened from Call or WhatsApp, the channel is never asked.** "Log a contact" asks it first.
- **The contact time defaults to "just now".** It is changed from the summary line.
- **The scheduled step is completed by default.** The summary line says "completes “X”", and a tap switches it to "keeps".
- **Not now:** one optional question, "What held them back?" (Skip available), then the next step and its date.
- **Not interested / Wrong number:** one question, "Why are they out?", with the eight loss reasons plus "Keep it open instead". Picking a reason writes the contact and the loss together. No drawer, no objection question.
- **No answer / Call back:** "Call back" is pre-picked and shown in the summary line; only the date is asked.
- **The last tap saves.** Picking a date saves the contact and the next step; picking a loss reason saves and closes. "Saved · Undo" lasts 10 seconds, and Undo restores the lead, interactions, calls, notes, task history and log lines exactly.
  - In the build, Undo deletes the Zoho records created, inside the same window.
- **"Today" carries no clock time.** Before this, a 10:00 default that had already passed made "Today" fail validation.
- **Email:** one summary line (template, recipient, subject) with Edit; the message shows as a preview with "Edit message"; Send.
- **While a flow is open,** the milestone, paperwork and forecast rows, the note line, the journey line and the signal tag are hidden, and the header shows only the name and phone. Leaving them visible scored 0.94–1.05 on load (`flow-d57c`); hidden, the rest of the flow scored 0.04–0.19.
- **The conversation note is no longer inside the flow** (Jev: hidden, 0.80–0.96). The page's own note line takes notes.

## Results (load out of 4, by path: interested / no answer / not now / lost / email)
| Design | P1 | P2 | P3 | P4 | P5 |
|---|---|---|---|---|---|
| D56 as built | 2.65 | 2.44 | 2.65 | 2.75 | 0.41 |
| D57 | 0.15 | 0.84 | 0.31 | 0.13 | 0.68 |
| **D57b (built)** | **0.16** | **0.05** | **0.19** | **0.04** | **0.15** |
| D57b with page rows left visible | 0.94 | 0.99 | 1.00 | 0.96 | 1.05 |

No item on any D57b path is above 0.56 for "asks twice".

## Verified
- Every path driven by real clicks.
- Both Undos restore the prior state exactly; Undo expires after 10 seconds.
- 167 lead pages opened across all seats, 683 flow presses, zero errors.
