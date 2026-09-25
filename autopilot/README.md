# Autopilot — build the IR console and the IM portal with one command

**D66 — progress-based, not calendar-based.** Nothing waits for a date. The loop runs day and night from the moment you start it, and builds the IR console and then the IM portal. The target is everything built by **Saturday 3 Oct**, followed by the test-and-harden phase; each product goes live when its gates pass.
- **Forecast:** every date you see is a projection from the pace the loop is achieving. `node autopilot/status.mjs --md` prints it, `autopilot/status.json` holds it, and the Progress sheet in both workbooks shows it.
- **Changing the target:** edit `autopilot/targets.json`.

## Slack — #growize-app-documents (C0AU2BH13SN)
- **Every round** posts one line: story → done, waiting, review or regressed, with the Jev result and the commit.
- **Every item that needs you** is posted the moment it appears.
- **Status changes** are posted too: started, waiting on you, stopped, queue finished.
- **One-time setup:** create an incoming webhook for the channel. Go to Slack → Apps → *Incoming Webhooks* (or api.slack.com/apps → your app → Incoming Webhooks), add one for #growize-app-documents, and paste the URL into `autopilot/.slack-webhook`. The file is git-ignored.
- **Without a webhook,** events queue in `autopilot/logs/slack-outbox.log`, and the Cowork check posts them in its summary.
- **Cowork check:** three times a day (09:00, 14:00 and 20:00 IST) it posts the forecast and what you owe next, and refreshes the tracker canvas.


Decisions D65, D66.
Claude Code builds; Jev tests (D64); people do only what needs a person.

## One-time setup
1. **Claude Code** installed and signed in on this PC: `claude --version`.
2. **Node 22 and Python 3 with `openpyxl`**: `pip install openpyxl`.
3. **Playwright's Chromium** for the Jev runner: in `console/`, run `npx playwright install chromium`.
4. **The TypeSafe key** in `growize/.typesafe-key`. It is git-ignored; rotate it first (D63).
5. **Build the queues**: `node autopilot/make-queue.mjs all` writes:
   - `autopilot/ir/queue.json` and `autopilot/im/queue.json`
   - `autopilot/PEOPLE-CALENDAR.md`, which lists every item only you can do, by day
7. **Commit today's work once before the first run.** The repo has about 30 changed and 86 new files from the planning sessions (decisions D45–D65, `pm/`, `autopilot/`): `git add -A && git commit -m "Plans D62–D65 and autopilot"`. The autopilot never stages files outside its story, so anything left uncommitted just sits there.
6. **Permissions** are in `.claude/settings.json`. The autopilot may run node, npm, npx, python and local git commands. Push, production deploys and reading the key are denied.

## Start: one command
- Windows: `powershell -ExecutionPolicy Bypass -File autopilot\run.ps1`
- Mac / Linux / WSL: `bash autopilot/run.sh`

It starts with the IR queue. When IR is finished it moves straight on to the IM queue. Leave the PC on and awake.

**Each round:**
- A fresh `claude -p` session builds exactly one story, following `autopilot/AUTOPILOT.md`.
- It runs that story's Jev UI cases, fixing and retrying up to 3 times, then commits and records the result.
- It rebuilds both workbooks.
- A full regression runs after every 6 stories. A story that broke goes back to the front of the queue.

## What it needs from you
**`autopilot/<queue>/BLOCKED.md`** holds:
- Zoho admin screens, seat purchases and go-live, each with exact steps
- open owner decisions it built a default for (`PROVISIONAL`)
- any change it proposes to a test's expected facts (`FACT CHANGE PROPOSED`)

It never waits for these; it builds around them. When you have done an item, change `- [ ]` to `- [x]`, and the next round picks it up.
`autopilot/PEOPLE-CALENDAR.md` shows everything that is coming, so you can do the Zoho work the day before it is needed.

## Stop, pause, resume
- **Stop:** create the file `autopilot/STOP`, or press Ctrl+C.
- **Resume:** delete `STOP` and run the same command. Progress lives in `autopilot/<queue>/progress.json`.
- **Automatic stop:**
  - If a calibration case ever passes, it writes `STOP` itself: Jev can no longer be trusted until someone looks.
  - If Claude hits a usage limit, it pauses 15 minutes and continues.
  - If only your items are left, it checks again every 30 minutes.

## Where to look
- **Workbooks:** `pm/IR-Console-Delivery-Plan.xlsx` and `pm/IM-Portal-Delivery-Plan.xlsx`, rebuilt every round.
  - The Dashboard and the Days sheet show progress against the plan.
  - Stories → Autopilot shows each story's state.
  - Test cases → Jev result shows the latest verdicts.
- **Round log:** `autopilot/<queue>/logs/rounds.log`, one line per round. Full transcripts are in `autopilot/logs/<date>.log`.
- **Jev evidence:** `autopilot/<queue>/results/*.json`, one file per run, including which control Jev pressed at each step and every fact's score.
- **Code:** branch `autopilot/ir` / `autopilot/im`, one commit per story. It is never pushed; you merge it.

## The daily check (Cowork)
A scheduled Cowork task runs every evening at 20:00 IST. It reads progress, logs and BLOCKED.md on this PC, rebuilds the workbooks, and sends you:
- what moved today
- what is blocked on you tomorrow
- whether the loop stalled (no commit in 24 h)
- whether the calibration held

The Cowork task only reports. Building happens here, in Claude Code, because it needs the local toolchain.

## Scripts
| Script | Does |
|---|---|
| `make-queue.mjs` | plan JSON → queue.json per product, plus PEOPLE-CALENDAR.md |
| `next.mjs <q>` | picks the next story in code, not by model judgement: a fix first, then a regression if one is due, then the earliest ready story |
| `done.mjs <q> …` | the only writer of progress.json and BLOCKED.md |
| `test-story.mjs <q> <story>` | runs the story's UI cases and its epic's calibration cases through `pm/jev-ui-runner.mjs`. Exit 0 = pass, 1 = fail, 3 = untrusted |
| `seed-local.mjs` | applies a named fixture to the app in `FIXTURE_MODE=local` (built in E16-S03-T03) |
| `run.ps1` / `run.sh` | the loop |
