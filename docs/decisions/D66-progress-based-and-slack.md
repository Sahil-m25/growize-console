# D66 — Progress-based, not calendar-based; tracked in Slack #growize-app-documents

**Date:** 24 Sep 2026 · **Decided by:** owner · **Amends:** D65 (the fixed days go; everything else stays)

## Decision
- **No fixed days.** The autopilot starts now and runs round the clock. It builds the IR console (89 stories) and then the IM portal (56 stories).
- **Target:** everything built by **Sat 3 Oct 2026**. Then a test-and-harden phase: the tester reviews the REVIEW rows and runs the manual and staging cases on the Zoho sandbox, UAT runs, and defects are fixed. Each product goes live when its gates pass.
- **Dates are projections,** not appointments:
  - The pace is measured from the stories built in the last 48 hours.
  - Until 3 stories are built, the forecast uses the pace the target needs.
  - The target can be changed in `autopilot/targets.json`.
- **Everything is tracked in Slack** channel C0AU2BH13SN (#growize-app-documents).

## What changed
- **Forecast:** `autopilot/status.mjs` writes `autopilot/status.json`:
  - pace (measured and needed)
  - projected time for every story, for each product, for the whole build and for the end of testing
  - on track or behind
  - people's items in the order the build will need them
  - It also rewrites `PEOPLE-CALENDAR.md`, now ordered by "needed by (projected)" plus a testing-phase section.
  - It runs after every round.
- **Workbooks:** the Days sheet is replaced by a **Progress** sheet: targets, pace, projected finishes, on track, phases, and the next 25 people items.
  - Stories show **Order** (place in the queue) and **Projected**.
  - Subtasks show **When** (Build / Before its story / Testing phase) and **Needed by**.
  - Stages show their projected start and end.
  - Formulas: IR 3,199, IM 2,471, 0 errors.
- **Plans:**
  - The weekend review tasks are removed. One "Testing phase review" per product replaces them.
  - Tester and business-user work is tagged "Testing phase" and does not hold up the build.
  - Sahil's items are tagged "Before its story (do early)".
- **Slack, per round:**
  - `autopilot/notify.mjs` posts each story's result, each new "needs you" item, a stopped loop, a finished queue, regressions, and "waiting on you".
  - It posts through an incoming webhook in `autopilot/.slack-webhook` (git-ignored). Until that exists, events queue in `autopilot/logs/slack-outbox.log`.
- **Slack tracker canvas:** F0C4ASMBMB3, recorded in `autopilot/slack.json`, lists every epic and story as a checklist, plus the forecast and the people items.
- **Scheduled Cowork task** "Growize autopilot — Slack tracker", 09:00, 14:00 and 20:00 IST:
  - It runs the forecast and rebuilds both workbooks.
  - It posts a summary to the channel and ticks the canvas.
  - It replaces the D65 daily check.
  - It needs "Require this computer" turned on in the desktop app to read the folder.
- **Kickoff** posted to the channel on 24 Sep.

## Honest limits
- **The target means about 16 stories a day,** one every 90 minutes, day and night. Whether the loop reaches that pace is unproven until it runs. The first day's measured pace will show it; the Progress sheet and the Slack summaries turn red when the build is behind.
- **The Zoho admin work comes first in the queue** and is due within hours of starting. Doing it early is what keeps the loop from waiting.
- **Security:** the TypeSafe API key is visible in plain text in this Slack channel (message of 22 Sep) as well as in an earlier screenshot. Rotate it, delete that message, and keep the new key only in `growize/.typesafe-key` and the CI secret.
