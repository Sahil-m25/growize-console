# D60 — Three seats, organisation search, Transfers analytics, and paperwork on the lead page

**Date:** 24 Sep 2026 · **File:** `console/prototype/ir-console-redesigned.html` (D59 kept as `ir-console-redesigned.D59.html`)
**Evidence:** `tools/jev-lead-page/`
- `flow-paper-now.json` / `flow-paper-new.json` and their `out-flow-paper-*.json` scores
- `d60q.mjs` / `out-d60q.json`

## Owner decisions
- Only three seats use the console: IR, IR Manager, and Digital Infrastructure (all pages; grants access to others).
- Finance and Marketing never sign in; Finance works in the IM portal.
- Organisation-wide search for the IR Manager, Digital Infrastructure and anyone above who has been granted access.
- Investor copies becomes Transfers analytics: which leads were transferred, how many, how, when.
- Fix the Leads Overdue filter.
- Paperwork, NDA and material must stop looping back to the page you are on.

## What Jev found and decided
- **Paperwork on the lead page (per step, load 0–4):**
  - D59 scored 1.62–3.65. The worst was emailing the deck and then ticking it again in Material (3.65; "asks twice" 0.82).
  - Cause: the IR's paperwork writers had no screen at all (`roundBlock` was never called), and three of their guards were hard-wired to refuse.
  - "Open" led to a read-only history drawer whose only button was "Open lead", which reloaded the same page.
  - The proposal scored 0.05–0.27. The one residual duplicate (a signature reminder is also a contact, 0.69) is resolved by writing both in one tap.
- **Search:** in the top-bar box (0.66). An out-of-book lead opens read-only with its owner and team shown (0.70).
- **Transfers:**
  - "Transferred" means reaching "Investor said yes" (0.73), which is when the investor record is created.
  - The page leads with a monthly view (0.64).
  - Count (0.64) and units/value (0.50) are shown by default; the per-investor list (how and when) is one tap away.

## Built (four agents, 47 patches, no overlaps)
- **Access**
  - Default console seats: IR, IR Manager, Digital Infrastructure. `ALL` is now `["ops"]` only.
  - Ops Lead, BU Owner, Corporate Ops and channel partners cannot sign in until Digital Infrastructure grants them a page. They then reach only what was granted, plus Profile.
  - Finance and Marketing are removed from every seat picker; their records are kept.
  - The IR Manager adjusts only the IRs under them, within her own access.
  - The sign-in screen lists only people who can sign in right now.
  - "Investor copies" is renamed "Transfers" and is reachable by the IR Manager and Digital Infrastructure.
- **Search**
  - The top-bar "Find investor" box (Ctrl/Cmd+K on every page) is live: up to 8 results showing name, phone last 4, stage and owner, with keyboard navigation.
  - An IR searches their own book. The IR Manager, Digital Infrastructure and granted people above search the whole organisation.
  - A lead outside the viewer's book opens read-only for that visit, with a "View only — found in search" banner and no write controls.
  - The Leads page box is now labelled "Filter this list".
- **Overdue filter:** it now uses the same rule as Today (a dated step overdue, otherwise a missed first-touch service level). Result: Rohit 1 (Sanjay Menon), Tasneem 2 (was 0).
- **Transfers analytics**
  - Transfers per month (latest 6 months): count, plus units, plus value for seats that may see money.
  - Tap a month to see each investor with the date they transferred, how they came in (source/event), owner IR, days from capture, and what happened next (10% in / fully paid / allocated / lost after yes).
  - The summary line: 4 transferred since July, median 9.5 days.
  - The old copy-status UI is gone.
- **Paperwork and material on the lead page**
  - **Paperwork row:** it now carries the IR's one next step, each saved in one tap with a 10-second Undo that restores paperwork, material and produce-pack state:
    - NDA told: "how did you tell them?" with Call / WhatsApp / Email.
    - Chasing: "Reminded by call / WhatsApp / email", each writing both the chase and the contact; plus "They say it's signed".
    - Supplementary: paste the link → Draft sent / Final draft agreed / New draft.
    - With Finance: status only.
  - **Guards turned back on, IR steps only:** `prMine`, `prRow` and `paperSave` had disabled the IR's writers. Finance's steps are still never written here.
  - **Before the NDA is signed:** the deck and yield note are not offered as next steps, the deck and webinar templates are hidden, and the row says "Deck goes after the NDA is signed".
  - **Deck email:** the "Deck follow-up" email attaches the deck and marks Pitch deck as sent in the same press, once.
  - **Loops removed:** no "Open lead" or "Open paperwork" appears inside the lead page's drawers.
  - **Investor file tab** "Material" → "Paperwork & material": round status, Finance document history, material, produce pack.

## Verified
- Merged file:
  - Sweep: 224 page renders and 1,252 presses, 0 errors, 0 dialogs, no sideways scroll at 390 and 1440.
  - Paperwork tests: 40/40 by real clicks.
  - Lead-page flows: pass.
- Integration:
  - Sign-in shows exactly the 4 IRs, Tasneem and Sahil.
  - Tasneem and Sahil search org-wide; Rohit does not.
  - A Leads grant to Jhalak lets her sign in to Leads + Profile only, org-wide search, no editing.

## Open for the owner
1. Digital Infrastructure can grant IRs pages beyond their default (e.g. Numbers). Keep that, or cap IRs at their seat?
2. Whether Today and Documents should also show IR paperwork steps as "your move". For now only the lead page does.
3. In the demo, three of the old portal-copy records (L09, L08, L05) have no lead behind them, so they don't appear in Transfers.
