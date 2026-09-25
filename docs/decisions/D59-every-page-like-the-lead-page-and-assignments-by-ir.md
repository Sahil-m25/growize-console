# D59 — Every page brought in line with the lead page, and the manager's "Assignments by IR" report

**Date:** 24 Sep 2026 · **File:** `console/prototype/ir-console-redesigned.html` (D58 kept as `ir-console-redesigned.D58.html`)
**Evidence:** `tools/jev-lead-page/`
- `inv/` — before inventories; `inv2/` — after inventories
- `out-report.json` — the report decisions
- `before2/` and `after/` — per-page scores
- `pages-before-after.json`
- `lead-page-heatmap.html` — third section

## The ask
1. Make every page work the way the lead page does (D56–D58): little information, what the job needs, nothing twice. Use Jev.
2. The IR manager asked to see, per IR, how many leads were assigned this week, last week, this month and before, how many of those were worked on, and the breakdown inside.

## Method
1. **Inventory.** Seven agents, one per page group, recorded every element of the 15 other pages per seat: 564 elements, each with its jobs and current placement.
2. **Scoring.** Jev answered, for each element: always / when relevant / one tap / another page / remove. It also gave each page a clutter score from 0 to 4.
3. **Rebuild.** Eight agents rebuilt the pages; one of them built the report. Each agent owned only its own functions and returned exact-string patches. All 29 patches applied with no overlap. Writers (commit, log, saveFollowup, assign, loadSheet …) are unchanged.
4. **Re-scoring.** The rebuilt pages were re-inventoried and re-scored.

**Correction made during the work:** the first page scoring reused the lead page's definition of "another page" ("… not on the lead page"). Two agents flagged this. Before and after were both re-scored with page-neutral wording (`context-pages.json`), and the table below uses those scores.

## Results (clutter out of 4; Jev's top pick matching the design)
| Page | Clutter before → after | Top pick = design |
|---|---|---|
| Today | 1.48 → 0.71 | 42/61 → 36/43 |
| Leads | 1.95 → 0.75 | 44/57 → 43/44 |
| Add lead | 0.76 → 0.84 | 49/58 → 51/55 |
| Updates | 1.04 → 0.88 | 29/34 → 33/34 |
| Activity | 1.74 → 0.68 | 23/29 → 26/27 |
| Events | 1.60 → 0.65 | 19/30 → 19/25 |
| One event | 1.32 → 0.40 | 41/48 → 34/43 |
| Payments | 1.05 → 0.15 | 21/32 → 21/21 |
| Documents | 0.25 → 0.16 | 11/13 → 12/15 |
| Investor copies | 1.44 → 0.03 | 12/19 → 13/15 |
| Numbers | 1.26 → 1.30 (1.90 before a second pass) | 33/55 → 40/48 |
| Plan | 0.74 → 0.79 | 35/36 → 30/35 |
| Teams | 1.69 → 0.80 | 39/41 → 40/44 |
| Profile | 1.02 → 0.71 | 21/24 → 15/16 |
| System | 0.88 → 0.92 | 17/27 → 22/27 |

**Average clutter went from 1.21 to 0.69.** Jev's top pick matched the design for 77% of elements before and 88% after (430 of 491).

**Numbers** went up to 1.90 after the first rebuild. A second pass made the Checks tiles appear only when they have a count, cut Review to the worst 5 with "Show all", and removed the stray row "Open" links. That brought it to 1.30, level with before, even though it now also holds the new report. Jev's page-level answer for Numbers is spread across all five levels, so this score is the least certain.

## Main changes, by page
- **Today**
  - One action per row; the in-focus panel follows the lead page and opens its flow.
  - One fold for filters and the week.
  - "Needs a next step", "Reservation clocks" and the book cards were duplicates and are gone.
  - Dead `vToday` removed.
- **Leads**
  - Filters in one place: the Book summary grid and the orphaned rail are removed.
  - The count line names the hidden lost leads and has a Show link.
  - A row opens the lead; "Record follow-up" shows only when the lead is due.
  - The page search takes over Ctrl K on this page.
  - The Add form has about a third fewer words.
- **Updates / Activity**
  - Bell rows open their own group.
  - Groups fold once read.
  - History drawer fixed for managers.
  - Activity no longer asks for Person and Action twice.
  - No Person column for a seat that only sees itself.
  - One Export.
  - Unreachable panels removed.
- **Events**
  - The duplicate stage tiles are removed.
  - One Add event button.
  - The "Name who works it" button that repeated Edit event is removed.
  - The injected "Open" links are removed (74 → 0).
  - The Cost/qual column shows only when it can be computed.
- **Payments / Documents / Investor copies**
  - Banners and tiles that repeated the table are removed.
  - The reservation clock is merged into the payments table.
  - The unreachable Finance "Record a payment" form is removed; Finance records in the IM portal and the save code is unchanged.
  - Documents lists the ones still waiting first.
  - The legacy register is removed (made obsolete by D52).
- **Numbers / Plan**
  - One row of sections instead of dropdown → dropdown → fold → panel; KPI rows went from 3 taps to 1.
  - Demo duplicates of counted figures are removed.
  - Plan's recovery actions sit inline with "Decisions needed".
- **Teams / Profile / System**
  - One way to open a member.
  - Availability and appearance live only in the top-bar menus.
  - System's tools are one row of tiles.
  - The dead 34-row permission table is removed.

## Assignments by IR (Numbers, first section)
Jev's decisions (`out-report.json`):
- **Where:** a Numbers section (0.79).
- **Periods:** four that do not overlap — This week · Last week · Earlier this month · Before this month — plus Total (0.95).
- **Counting unit:** a cohort — the leads assigned in the period, and what happened to them since (0.55; "both views" was 0.43).
- **Worked:** at least one contact attempt by the assigned IR after assignment (0.75).
- **Missed first touch** is shown (0.78).
- **Default row:** Assigned, Not yet worked and Worked % only (0.61–0.73); every other breakdown scored under 0.5.
- **The breakdown** ("the macros inside") opens with one tap on an IR's row: attempted only, reached, qualified+, said yes+, 10% in/paid, lost, no next step, overdue, average touches, and median time to first touch. Tapping a count lists those leads.

How it is computed:
- **Assignment time** is the latest owner-change log line. Older leads have none, so they use the capture date, and a footnote says so.
- Touch stamps with no author count as the owner's, also footnoted.
- A manager sees their team, leadership sees all, and an IR sees their own row.

Demo figures for Tasneem's team: 16 assigned (7 last week, 6 earlier this month, 3 before), all 16 worked, 1 missed first touch (Farida Contractor, Ananya). An independent calculation matched the table.

## Verified
- Every seat × every page × 1440 and 390 wide: 202 page renders and 1,036 control presses, with 0 errors, 0 native dialogs and no page-level sideways scroll.
- The lead-page flows re-tested after the merge (call time, task, today, Undo).

## Open for the owner
1. **Jhalak (Ops Lead)** is described as view-only, but her seat can edit events, people and plan periods. Is that intended?
2. **Marketing and Finance cannot sign in** to this console. The marketing view of Numbers is unreachable, and so are the finance-only Plan inputs.
3. **Investor copies** exists only because of the old two-org transfer. Retire the page? Its nav entry and help text are outside this change.
4. **Leads "Needs attention → Overdue"** counts only dated next steps, so overdue first-touch leads don't appear under it. Surfaced, not changed.
5. **Dead code left behind** because it belongs to shared helpers: `vBookMini`, `xCopy`, `xKeyedIn`, the `NTAB` variable, and some help texts (Numbers, Profile).
6. **The assignment report's "This week" column is 0** on the demo date. That comes from the fixture data, not a fault.
