# Jev triage, 2026-09-30 (M19-S12)

Full Jev UI suite on the local fixture build (`pm/jev-ui-runner.mjs`, fixtures-merged.json, seed-local), 337 cases: 319 real plus 18 calibration. Every failing non-calibration case is classified below as bug, stale or flaky, with one evidence line each.

## Result

| | Before | After |
|---|---|---|
| Real cases passing | 213 / 319 | **224 / 319** |
| Calibration cases caught (D63) | 18 / 18 | **18 / 18** |

Reconciliation of the final run: 224 PASS + 82 stale + 8 bug-open + 5 flaky-borderline = 319. Pass + stale is 306; the 13 not covered by either are, by case id:

- bug-open (8): TC-E11-016, TC-E15-009, TC-IM01-008, TC-IM01-009, TC-IM01-016, TC-IM02-019, TC-IM02-021, TC-IM10-008
- flaky-borderline (5): TC-E03-012, TC-E03-019, TC-E03-020, TC-E07-004, TC-IM01-007

## Counts per class

Across the 109 cases that failed at any point today (95 still not PASS, 14 that failed first and pass now):

| Class | Cases |
|---|---|
| bug, fixed (now PASS) | 8 |
| flaky, now PASS | 6 |
| flaky-borderline (2 of 3 re-runs PASS, score 0.69-0.86 around PASS_AT 0.80) | 5 |
| bug-open (feature-sized or already tracked) | 8 |
| stale (fact disagrees with the merged console, D98 and the decisions that follow it) | 82 |
| **Total** | **109** |

How a case was classified: full run, then 3 re-runs, then the same ids against the phase-1 prototype (`growize-console-merged.html`, the D98 authority). Fails identically on app and prototype: stale. Passes 3 of 3 on re-run: flaky. The app differs from the prototype or from the acceptance line: bug. Borderline flaky cases pass in some runs and miss 0.80 by a small margin with the fact true on screen; they are kept apart rather than called flaky. The old 28 Sep run scored 221/319, 8 more than the 213 in the first run today; that difference is load from other agents on the same two cores and the judge margin, not a regression.

## Bugs fixed in the app (on demo data, expected facts untouched)

| Fix | Change | Cases |
|---|---|---|
| F1 | Lead page refuses a next-step time already past, in the flow, saving nothing (`lpStepPast`) | TC-E07-035 (fact still scores 0.65, see stale) |
| F2 | FindBox options are anchors, not `div role=option` | TC-E07-029, E07-030, E06-010 |
| F3 | Shell draws the event page once (EVPEND, like the lead page) so the route landing does not remount it | TC-E10-008, E10-010, E10-013 |
| F4 | 'Why we lose' shows rupees only to seats that may see money | TC-E12-011 |
| F5 | Finishing with 'keep the scheduled step' no longer logs a new call back (`lpNeedsStep`) | TC-E07-013 |
| F6 | Investors receipt recording is no longer refused for an unverified supplementary agreement (D21, rule 3) | TC-IM05-007 fact 1 |

Unit tests added or changed: `lp.test.ts` (M19-S12 block) and `rules.test.ts` (records before the supplementary is verified).

## Cases that failed and now pass

| Case | Story | Class | Evidence | Fix |
|---|---|---|---|---|
| TC-E07-013 | M07-S03 | bug | Keeping the scheduled step on the lead page logged a fresh 'Call back' over it; lpNeedsStep now respects keep | F5 (this commit) |
| TC-E07-029 | M07-S06 | bug | Search options were <div role=option>, invisible to the runner and to keyboard links; FindBox options are now anchors | F2 (this commit) |
| TC-E07-030 | M07-S06 | bug | Same FindBox option markup | F2 (this commit) |
| TC-E06-010 | M06-S03 | bug | Same FindBox option markup | F2 (this commit) |
| TC-E10-008 | M10 | bug | Event page remounted when the route landed (Shell drew it ahead, then again), dropping the focused control | F3 (this commit) |
| TC-E10-010 | M10 | bug | Same Shell event remount | F3 (this commit) |
| TC-E10-013 | M10 | bug | Same Shell event remount | F3 (this commit) |
| TC-E12-011 | M16-S03 | bug | 'Why we lose' printed a rupee figure to a seat that may not see money; now gated by seeMoney | F4 (this commit) |
| TC-E03-007 | M01-S01 | flaky | Sign-in latency under load beat the runner's 300 ms wait; 0.72 REVIEW first run, 0.80 PASS now, 3/3 re-runs passed on an idle machine | none |
| TC-E03-015 | M03-S03 | flaky | Same sign-in latency race; passes on re-run | none |
| TC-E03-011 | M03-S02 | flaky | Load-induced; passes 3/3 on re-run | none |
| TC-E08-018 | M08-S05 | flaky | Load-induced; passes 3/3 on re-run | none |
| TC-E12-010 | M16-S03 | flaky | Load-induced; passes 3/3 on re-run | none |
| TC-IM03-003 | M05-S07 | flaky | Load-induced; passes 3/3 on re-run | none |

## Cases still not PASS (final run)

| Case | Story | Final | Class | Evidence | Fix commit or proposed fact |
|---|---|---|---|---|---|
| TC-E11-016 | M15-S05 | FAIL 0.04 | bug-open | Investors Payments register prints the UTR unmasked to Sahil; M18-S02 AC9 / D13 / rule 7 say it is masked. Feature-sized, touches the shared register [worst fact 0.04: The Activity log lists 'Revealed a bank reference' by Sahil Mohite.] | CARRY-FORWARD proposed |
| TC-E15-009 | M18-S02 | FAIL 0.03 | bug-open | Investors Payments register prints the UTR unmasked to Sahil; M18-S02 AC9 / D13 / rule 7 say it is masked. Feature-sized, touches the shared register [worst fact 0.03: Each payment row offers 'Show the reference'.] | CARRY-FORWARD proposed |
| TC-IM01-008 | M01-S08 | FAIL 0.06 | bug-open | Offline Investors receipts are not queued or held as 'Not saved yet' (M01-S08 AC2-3, BLOCKED M01-S08-NOTE-8) [worst fact 0.06: The 'Record a receipt' panel is still open and says 'Not saved yet'.] | tracked in BLOCKED.md |
| TC-IM01-009 | M01-S08 | FAIL 0.08 | bug-open | Offline Investors receipts are not queued or held as 'Not saved yet' (M01-S08 AC2-3, BLOCKED M01-S08-NOTE-8) [worst fact 0.08: The Money section reads '₹2.5 L of ₹25 L'.] | tracked in BLOCKED.md |
| TC-IM01-016 | M01-S02 | FAIL 0.03 | bug-open | Investors step-up panel is not built (BLOCKED M01-S10-NOTE-5) [worst fact 0.03: The top bar shows Fahad Rizvi, Compliance & KYC.] | tracked in BLOCKED.md |
| TC-IM02-019 | M01-S10 | FAIL 0.05 | bug-open | Investors step-up panel is not built (BLOCKED M01-S10-NOTE-5) [worst fact 0.05: An open panel asks Harsha to confirm it is him with a fresh sign-in co] | tracked in BLOCKED.md |
| TC-IM02-021 | M01-S10 | FAIL 0.03 | bug-open | Investors step-up panel is not built (BLOCKED M01-S10-NOTE-5) [worst fact 0.03: An open panel asks Harsha for a fresh sign-in code before the reservat] | tracked in BLOCKED.md |
| TC-IM10-008 | M15-S03 | FAIL 0.02 | bug-open | Auditor Activity lists 0 entries (M15-S03 AC11, BLOCKED NOTE-4) [worst fact 0.02: The log shows 12 entries by Meena, Fahad and Harsha.] | tracked in BLOCKED.md |
| TC-E01-012 | M01-S06 | REVIEW 0.2 | stale | The text sits in a profile drawer that 'See it' replaces [worst fact 0.2: Jhalak Mehta's access still reads 'No console access — nothing granted] | FACT CHANGE proposed (D98) |
| TC-E03-001 | M03-S01 | FAIL 0.02 | stale | Already recorded as FACT CHANGE lines in autopilot/console/BLOCKED.md [worst fact 0.02: The sign-in screen offers exactly six people: Rohit Deshpande, Kavya N] | already in BLOCKED.md |
| TC-E03-002 | M03-S01 | FAIL 0.03 | stale | Already recorded as FACT CHANGE lines in autopilot/console/BLOCKED.md [worst fact 0.03: The sign-in screen does not offer Harsha Bhat.] | already in BLOCKED.md |
| TC-E03-004 | M03-S01 | FAIL 0.04 | stale | Already recorded as FACT CHANGE lines in autopilot/console/BLOCKED.md [worst fact 0.04: It does not offer Pradeep Ram.] | already in BLOCKED.md |
| TC-E03-008 | M01-S01 | FAIL 0.08 | stale | Facts assume Sahil is restricted like a staff seat; Sahil is super user (D68) so the refusal or restricted view never appears [worst fact 0.08: The Payments page says it is read only, recorded by Finance in the Inv] | FACT CHANGE proposed (D68) |
| TC-E03-010 | M01-S01 | REVIEW 0.72 | stale | Wording differs from the merged console ('Investors pages'; 'Full record' is 'Open the record'; 'Close' is 'OK', D68) [worst fact 0.72: The Documents page says it is read only, sent by Finance from the Inve] | FACT CHANGE proposed (D98, D68) |
| TC-E05-001 | M05-S01 | FAIL 0.02 | stale | Unowned leads live on Leads under 'Needs an owner', not on Today (M15-S01-NOTE-1, D98) [worst fact 0.02: The page shows '4 due now · 5 open' under the heading.] | FACT CHANGE proposed (D98) |
| TC-E05-002 | M05-S01 | FAIL 0.02 | stale | Unowned leads live on Leads under 'Needs an owner', not on Today (M15-S01-NOTE-1, D98) [worst fact 0.02: Ritu Anand's row reads 'No owner yet — added by Tasneem Qureshi'.] | FACT CHANGE proposed (D98) |
| TC-E05-003 | M05-S01 | FAIL 0.03 | stale | Facts assume Sahil is restricted like a staff seat; Sahil is super user (D68) so the refusal or restricted view never appears [worst fact 0.03: The menu does not show Today.] | FACT CHANGE proposed (D68) |
| TC-E05-004 | M05-S02 | FAIL 0.04 | stale | Unowned leads live on Leads under 'Needs an owner', not on Today (M15-S01-NOTE-1, D98) [worst fact 0.04: Harish Kamath's row offers 'Assign to me'.] | FACT CHANGE proposed (D98) |
| TC-E05-006 | M05-S02 | REVIEW 0.64 | stale | Wording differs from the merged console ('Investors pages'; 'Full record' is 'Open the record'; 'Close' is 'OK', D68) [worst fact 0.64: The investor in focus beside the list is Deepa Varghese ('Investor sai] | FACT CHANGE proposed (D98, D68) |
| TC-E05-007 | M05-S02 | FAIL 0.04 | stale | Unowned leads live on Leads under 'Needs an owner', not on Today (M15-S01-NOTE-1, D98) [worst fact 0.04: Harish Kamath's row offers 'Assign owner'.] | FACT CHANGE proposed (D98) |
| TC-E06-006 | M06-S02 | FAIL 0.06 | stale | Already recorded as FACT CHANGE lines in autopilot/console/BLOCKED.md [worst fact 0.06: The page offers 'Clear filters'.] | already in BLOCKED.md |
| TC-E07-003 | M07-S01 | FAIL 0.02 | stale | Facts assume Sahil is restricted like a staff seat; Sahil is super user (D68) so the refusal or restricted view never appears [worst fact 0.02: The only buttons on the lead page are 'Back to leads' and 'Investor fi] | FACT CHANGE proposed (D68) |
| TC-E07-012 | M07-S03 | FAIL 0.04 | stale | No wait step, so the undo expiry cannot be observed [worst fact 0.04: That notice does not offer 'Undo'.] | FACT CHANGE proposed (D63) |
| TC-E07-021 | M07-S05 | REVIEW 0.67 | stale | Negative or absence fact the judge cannot verify from a truncated capture (D63); E12-002 'first "1 not worked"' is ambiguous [worst fact 0.67: There is no 'Send email' button on the page.] | FACT CHANGE proposed (D63) |
| TC-E07-035 | M07-S04 | REVIEW 0.65 | stale | Fixed as F1 (saved-state wording). Still REVIEW 0.65: the negative fact "does not say 'Saved'" collides with hint text 'Saved in Zoho...'; the prototype scores 0.69 too (D63: no negative facts) [worst fact 0.65: The status line does not say 'Saved'.] | F1 commit; FACT CHANGE proposed |
| TC-E08-008 | M08-S02 | FAIL 0.02 | stale | Facts assume the sign-in list of the old console; merged sign-in is the D98/D110 list [worst fact 0.02: The sign-in screen does not offer Harsha Bhat.] | FACT CHANGE proposed (D98, D110) |
| TC-E08-011 | M08-S03 | REVIEW 0.62 | stale | Negative or absence fact the judge cannot verify from a truncated capture (D63); E12-002 'first "1 not worked"' is ambiguous [worst fact 0.62: The page does not show the 'Has the investor paid?' row or an 'Investo] | FACT CHANGE proposed (D63) |
| TC-E09-019 | M12-S14 | REVIEW 0.52 | stale | Already recorded as FACT CHANGE lines in autopilot/console/BLOCKED.md [worst fact 0.52: Meera Krishnan's row on Today shows a 'Call back' step due 28 Aug · 16] | already in BLOCKED.md |
| TC-E10-003 | M14-S01 | REVIEW 0.65 | stale | Negative or absence fact the judge cannot verify from a truncated capture (D63); E12-002 'first "1 not worked"' is ambiguous [worst fact 0.65: The only lead button on the event page is 'Meera Krishnan'.] | FACT CHANGE proposed (D63) |
| TC-E10-007 | M14-S02 | FAIL 0.03 | stale | Already recorded as FACT CHANGE lines in autopilot/console/BLOCKED.md [worst fact 0.03: That line's note says 3 leads stay tagged to it.] | already in BLOCKED.md |
| TC-E10-012 | M14-S03 | FAIL 0.02 | stale | Already recorded as FACT CHANGE lines in autopilot/console/BLOCKED.md [worst fact 0.02: The card says 'Your seat does not load event sheets; the IR team or Ma] | already in BLOCKED.md |
| TC-E11-004 | M15-S01 | FAIL 0.07 | stale | Already recorded as FACT CHANGE lines in autopilot/console/BLOCKED.md [worst fact 0.07: It shows 'Breached in your team — 2 leads' marked 'Needs attention', l] | already in BLOCKED.md |
| TC-E11-010 | M15-S03 | REVIEW 0.22 | stale | Negative or absence fact the judge cannot verify from a truncated capture (D63); E12-002 'first "1 not worked"' is ambiguous [worst fact 0.22: Every row listed is a call ('Call logged' or a call outcome).] | FACT CHANGE proposed (D63) |
| TC-E12-002 | M16-S01 | REVIEW 0.4 | stale | Negative or absence fact the judge cannot verify from a truncated capture (D63); E12-002 'first "1 not worked"' is ambiguous [worst fact 0.4: Under Kavya's row the page shows 'Not yet worked · This week · Kavya N] | FACT CHANGE proposed (D63) |
| TC-E14-002 | M17-S01 | FAIL 0.02 | stale | Facts assume the sign-in list of the old console; merged sign-in is the D98/D110 list [worst fact 0.02: The page reads 10 active members.] | FACT CHANGE proposed (D98, D110) |
| TC-E15-027 | M18-S06 | FAIL 0.03 | stale | Transfers has no legacy section in the merged console [worst fact 0.03: The page lists Meenakshi Sundaram, Abhijit Sen and Radhika Menon as le] | FACT CHANGE proposed (D98) |
| TC-E15-034 | M18-S09 | FAIL 0.03 | stale | Facts assume the sign-in list of the old console; merged sign-in is the D98/D110 list [worst fact 0.03: The sign-in screen does not offer Harsha Bhat.] | FACT CHANGE proposed (D98, D110) |
| TC-IM01-002 | M01-S01 | FAIL 0.04 | stale | Facts name the old Investors portal rail (Signed in as, Transactions, Insights, Team, Activity log, Dashboard); the merged console has none of these (D98, BLOCKED M01-S01-NOTE-1). Prototype fails identically [worst fact 0.04: The top bar offers a 'Toggle theme' button.] | proposed fact change under D98 |
| TC-IM01-003 | M01-S01 | FAIL 0.06 | stale | Facts assume Sahil is restricted like a staff seat; Sahil is super user (D68) so the refusal or restricted view never appears [worst fact 0.06: The menu shows 2 pages: Activity log and Team.] | FACT CHANGE proposed (D68) |
| TC-IM01-004 | M01-S07 | FAIL 0.05 | stale | Wording differs from the merged console ('Investors pages'; 'Full record' is 'Open the record'; 'Close' is 'OK', D68) [worst fact 0.05: The panel offers a 'Close' button.] | FACT CHANGE proposed (D98, D68) |
| TC-IM02-001 | M03-S05 | FAIL 0.04 | stale | Facts name the old Investors portal rail (Signed in as, Transactions, Insights, Team, Activity log, Dashboard); the merged console has none of these (D98, BLOCKED M01-S01-NOTE-1). Prototype fails identically [worst fact 0.04: Pradeep Ram's seat reads 'Super administrator' and Sahil Mohite's read] | proposed fact change under D98 |
| TC-IM02-003 | M01-S01 | REVIEW 0.11 | stale | Facts name the old Investors portal rail (Signed in as, Transactions, Insights, Team, Activity log, Dashboard); the merged console has none of these (D98, BLOCKED M01-S01-NOTE-1). Prototype fails identically [worst fact 0.11: The menu shows 8 pages: Dashboard, Investors, Farms, Tickets, Updates,] | proposed fact change under D98 |
| TC-IM02-004 | M01-S01 | REVIEW 0.11 | stale | Facts name the old Investors portal rail (Signed in as, Transactions, Insights, Team, Activity log, Dashboard); the merged console has none of these (D98, BLOCKED M01-S01-NOTE-1). Prototype fails identically [worst fact 0.11: The menu shows 3 pages: System, Activity log and Team.] | proposed fact change under D98 |
| TC-IM02-005 | M01-S01 | FAIL 0.08 | stale | Facts name the old Investors portal rail (Signed in as, Transactions, Insights, Team, Activity log, Dashboard); the merged console has none of these (D98, BLOCKED M01-S01-NOTE-1). Prototype fails identically [worst fact 0.08: The menu shows 9 pages: Dashboard, Investors, Farms, Documents, Ticket] | proposed fact change under D98 |
| TC-IM02-025 | M03-S04 | FAIL 0.02 | stale | Facts name the old Investors portal rail (Signed in as, Transactions, Insights, Team, Activity log, Dashboard); the merged console has none of these (D98, BLOCKED M01-S01-NOTE-1). Prototype fails identically [worst fact 0.02: The first log row is 'Changed a seat' by Sahil and its detail says '4 ] | proposed fact change under D98 |
| TC-IM02-026 | M03-S04 | REVIEW 0.32 | stale | Facts name the old Investors portal rail (Signed in as, Transactions, Insights, Team, Activity log, Dashboard); the merged console has none of these (D98, BLOCKED M01-S01-NOTE-1). Prototype fails identically [worst fact 0.32: The page offers exactly 8 seat dropdowns, one for every person except ] | proposed fact change under D98 |
| TC-IM02-027 | M03-S04 | FAIL 0.08 | stale | Facts name the old Investors portal rail (Signed in as, Transactions, Insights, Team, Activity log, Dashboard); the merged console has none of these (D98, BLOCKED M01-S01-NOTE-1). Prototype fails identically [worst fact 0.08: Pradeep Ram's row shows 'Super administrator' and offers no seat dropd] | proposed fact change under D98 |
| TC-IM03-001 | M05-S06 | FAIL 0.04 | stale | Other old-portal facts (dashboard or headline strip, Team wording, block-full refusal text); app and prototype fail identically [worst fact 0.04: Units held of released reads 40 / 96.] | FACT CHANGE proposed (D98) |
| TC-IM03-002 | M05-S06 | FAIL 0.06 | stale | Other old-portal facts (dashboard or headline strip, Team wording, block-full refusal text); app and prototype fail identically [worst fact 0.06: Balance outstanding reads ₹1.13 Cr.] | FACT CHANGE proposed (D98) |
| TC-IM03-004 | M05-S07 | REVIEW 0.73 | stale | Other old-portal facts (dashboard or headline strip, Team wording, block-full refusal text); app and prototype fail identically [worst fact 0.73: Besides the role 'Auditor — read only', the top bar carries a separate] | FACT CHANGE proposed (D98) |
| TC-IM03-009 | M08-S04 | FAIL 0.03 | stale | Other old-portal facts (dashboard or headline strip, Team wording, block-full refusal text); app and prototype fail identically [worst fact 0.03: Block C reads 'not released — 54 units off the shelf'.] | FACT CHANGE proposed (D98) |
| TC-IM03-010 | M05-S08 | FAIL 0.02 | stale | Other old-portal facts (dashboard or headline strip, Team wording, block-full refusal text); app and prototype fail identically [worst fact 0.02: The subtitle reads '4 accounts · 5 waiting on you'.] | FACT CHANGE proposed (D98) |
| TC-IM03-012 | M05-S08 | FAIL 0.05 | stale | Other old-portal facts (dashboard or headline strip, Team wording, block-full refusal text); app and prototype fail identically [worst fact 0.05: Vikram Anand's row reads 'Tier B and nobody is looking after them' and] | FACT CHANGE proposed (D98) |
| TC-IM03-013 | M05-S06 | FAIL 0.05 | stale | Other old-portal facts (dashboard or headline strip, Team wording, block-full refusal text); app and prototype fail identically [worst fact 0.05: The dashboard shows the time its figures were last read (for example '] | FACT CHANGE proposed (D98) |
| TC-IM04-021 | M09-S01 | FAIL 0.02 | stale | Facts assume Sahil is restricted like a staff seat; Sahil is super user (D68) so the refusal or restricted view never appears [worst fact 0.02: The menu does not show Investors.] | FACT CHANGE proposed (D68) |
| TC-IM05-001 | M10-S01 | FAIL 0.03 | stale | Facts name the old Investors portal rail (Signed in as, Transactions, Insights, Team, Activity log, Dashboard); the merged console has none of these (D98, BLOCKED M01-S01-NOTE-1). Prototype fails identically [worst fact 0.03: The filters read Everything 15, Advances 2, Full and balance 13, Refun] | proposed fact change under D98 |
| TC-IM05-002 | M10-S01 | FAIL 0.03 | stale | Facts name the old Investors portal rail (Signed in as, Transactions, Insights, Team, Activity log, Dashboard); the merged console has none of these (D98, BLOCKED M01-S01-NOTE-1). Prototype fails identically [worst fact 0.03: T-0030 reads Joseph Mathew, advance, ₹10 L, SWIFT EMIR2608119.] | proposed fact change under D98 |
| TC-IM05-004 | M10-S01 | FAIL 0.03 | stale | Facts name the old Investors portal rail (Signed in as, Transactions, Insights, Team, Activity log, Dashboard); the merged console has none of these (D98, BLOCKED M01-S01-NOTE-1). Prototype fails identically [worst fact 0.03: The list shows 15 transactions.] | proposed fact change under D98 |
| TC-IM05-006 | M10-S02 | FAIL 0.07 | stale | Other old-portal facts (dashboard or headline strip, Team wording, block-full refusal text); app and prototype fail identically [worst fact 0.07: T-0049 is shown as waiting to be matched by a second person.] | FACT CHANGE proposed (D98) |
| TC-IM05-007 | M08-S03 | FAIL 0.03 | stale | F6 now records the receipt (D21, rule 3; fact 1 true on screen). Fact 2 'cannot be matched until supplementary verified' is unreachable: a recorded receipt is rec=matched by design (reducer), the prototype fails it too (D98) [worst fact 0.03: A line says the receipt cannot be matched until the supplementary agre] | F6 commit; FACT CHANGE proposed |
| TC-IM05-009 | M10-S02 | FAIL 0.03 | stale | Already recorded as FACT CHANGE lines in autopilot/console/BLOCKED.md [worst fact 0.03: The list shows 1 transaction: T-0049 for Prakash Bhat, balance, ₹22.5 ] | already in BLOCKED.md |
| TC-IM05-010 | M10-S02 | FAIL 0.03 | stale | Already recorded as FACT CHANGE lines in autopilot/console/BLOCKED.md [worst fact 0.03: The page says a receipt is matched by someone other than the person wh] | already in BLOCKED.md |
| TC-IM05-011 | M10-S03 | FAIL 0.08 | stale | Facts use the persona name 'Rohit Verma'; the console seat is Rohit Deshpande [worst fact 0.08: The panel says Rohit Verma wrote this in the IR console.] | FACT CHANGE proposed (D98) |
| TC-IM05-012 | M10-S03 | FAIL 0.03 | stale | Facts name the old Investors portal rail (Signed in as, Transactions, Insights, Team, Activity log, Dashboard); the merged console has none of these (D98, BLOCKED M01-S01-NOTE-1). Prototype fails identically [worst fact 0.03: T-0049 reads Prakash Bhat, balance, ₹22.5 L.] | proposed fact change under D98 |
| TC-IM05-017 | M08-S04 | FAIL 0.09 | stale | Other old-portal facts (dashboard or headline strip, Team wording, block-full refusal text); app and prototype fail identically [worst fact 0.09: The page offers 'Extend the hold'.] | FACT CHANGE proposed (D98) |
| TC-IM05-019 | M10-S05 | FAIL 0.04 | stale | Facts name the old Investors portal rail (Signed in as, Transactions, Insights, Team, Activity log, Dashboard); the merged console has none of these (D98, BLOCKED M01-S01-NOTE-1). Prototype fails identically [worst fact 0.04: The page shows when the last statement was reconciled.] | proposed fact change under D98 |
| TC-IM06-012 | M11-S07 | FAIL 0.03 | stale | Other old-portal facts (dashboard or headline strip, Team wording, block-full refusal text); app and prototype fail identically [worst fact 0.03: A message on the page says Block B has no free units for Kiran Rao's 2] | FACT CHANGE proposed (D98) |
| TC-IM07-008 | M12-S11 | FAIL 0.05 | stale | Other old-portal facts (dashboard or headline strip, Team wording, block-full refusal text); app and prototype fail identically [worst fact 0.05: The 'From the IR console' list shows 'They say the supplementary is si] | FACT CHANGE proposed (D98) |
| TC-IM07-009 | M12-S11 | REVIEW 0.12 | stale | Facts use the persona name 'Rohit Verma'; the console seat is Rohit Deshpande [worst fact 0.12: The 'Verify the signed copy' panel says Rohit Verma says the investor ] | FACT CHANGE proposed (D98) |
| TC-IM07-010 | M12-S11 | FAIL 0.04 | stale | Facts use the persona name 'Rohit Verma'; the console seat is Rohit Deshpande [worst fact 0.04: The panel shows 'No word from the IR yet' and no note from Rohit Verma] | FACT CHANGE proposed (D98) |
| TC-IM07-015 | M12-S07 | FAIL 0.04 | stale | Other old-portal facts (dashboard or headline strip, Team wording, block-full refusal text); app and prototype fail identically [worst fact 0.04: The signed Supplementary agreement row offers a 'Block it' button.] | FACT CHANGE proposed (D98) |
| TC-IM08-009 | M13-S05 | FAIL 0.03 | stale | Investor-ticket reply row and the KAM publish panel differ from the old Investors portal wording; the prototype fails both too (D98) [worst fact 0.03: The 'Wants the Block A harvest note for her brother' row offers 'Reply] | FACT CHANGE proposed (D98) |
| TC-IM08-012 | M13-S06 | FAIL 0.04 | stale | Investor-ticket reply row and the KAM publish panel differ from the old Investors portal wording; the prototype fails both too (D98) [worst fact 0.04: The 'Publish an update' panel offers the kinds Produce and Notice only] | FACT CHANGE proposed (D98) |
| TC-IM09-001 | M16-S08 | FAIL 0.03 | stale | Facts name the old Investors portal rail (Signed in as, Transactions, Insights, Team, Activity log, Dashboard); the merged console has none of these (D98, BLOCKED M01-S01-NOTE-1). Prototype fails identically [worst fact 0.03: It shows ₹52 Cr the full programme and 17% collected.] | proposed fact change under D98 |
| TC-IM09-002 | M16-S08 | FAIL 0.03 | stale | Facts name the old Investors portal rail (Signed in as, Transactions, Insights, Team, Activity log, Dashboard); the merged console has none of these (D98, BLOCKED M01-S01-NOTE-1). Prototype fails identically [worst fact 0.03: 'Out for signature, oldest first' lists 1 document: the FEMA declarati] | proposed fact change under D98 |
| TC-IM09-003 | M16-S08 | REVIEW 0.11 | stale | Facts name the old Investors portal rail (Signed in as, Transactions, Insights, Team, Activity log, Dashboard); the merged console has none of these (D98, BLOCKED M01-S01-NOTE-1). Prototype fails identically [worst fact 0.11: The Compliance tab shows 1.] | proposed fact change under D98 |
| TC-IM09-004 | M16-S09 | FAIL 0.07 | stale | Facts name the old Investors portal rail (Signed in as, Transactions, Insights, Team, Activity log, Dashboard); the merged console has none of these (D98, BLOCKED M01-S01-NOTE-1). Prototype fails identically [worst fact 0.07: The page shows accounts gone quiet, inside their cadence, tickets past] | proposed fact change under D98 |
| TC-IM09-005 | M16-S09 | FAIL 0.08 | stale | Facts name the old Investors portal rail (Signed in as, Transactions, Insights, Team, Activity log, Dashboard); the merged console has none of these (D98, BLOCKED M01-S01-NOTE-1). Prototype fails identically [worst fact 0.08: The page shows accounts gone quiet, inside their cadence, tickets past] | proposed fact change under D98 |
| TC-IM09-007 | M16-S09 | REVIEW 0.27 | stale | Facts name the old Investors portal rail (Signed in as, Transactions, Insights, Team, Activity log, Dashboard); the merged console has none of these (D98, BLOCKED M01-S01-NOTE-1). Prototype fails identically [worst fact 0.27: The Collection tab shows ₹8.88 Cr banked.] | proposed fact change under D98 |
| TC-IM10-001 | M17-S01 | FAIL 0.09 | stale | Facts name the old Investors portal rail (Signed in as, Transactions, Insights, Team, Activity log, Dashboard); the merged console has none of these (D98, BLOCKED M01-S01-NOTE-1). Prototype fails identically [worst fact 0.09: Under the Team heading the page says 'the only people who sign in here] | proposed fact change under D98 |
| TC-IM10-002 | M17-S01 | FAIL 0.07 | stale | Facts name the old Investors portal rail (Signed in as, Transactions, Insights, Team, Activity log, Dashboard); the merged console has none of these (D98, BLOCKED M01-S01-NOTE-1). Prototype fails identically [worst fact 0.07: Under the Team heading the page says 'the only people who sign in here] | proposed fact change under D98 |
| TC-IM10-003 | M17-S01 | FAIL 0.04 | stale | Facts name the old Investors portal rail (Signed in as, Transactions, Insights, Team, Activity log, Dashboard); the merged console has none of these (D98, BLOCKED M01-S01-NOTE-1). Prototype fails identically [worst fact 0.04: Under the Team heading the page says 'the only people who sign in here] | proposed fact change under D98 |
| TC-IM10-004 | M17-S01 | REVIEW 0.12 | stale | Facts name the old Investors portal rail (Signed in as, Transactions, Insights, Team, Activity log, Dashboard); the merged console has none of these (D98, BLOCKED M01-S01-NOTE-1). Prototype fails identically [worst fact 0.12: The page does not show the rights table with its 8 seat columns.] | proposed fact change under D98 |
| TC-IM10-007 | M15-S03 | FAIL 0.02 | stale | Facts assume Sahil is restricted like a staff seat; Sahil is super user (D68) so the refusal or restricted view never appears [worst fact 0.02: The page says '12 accessible entries · organisation audit with investo] | FACT CHANGE proposed (D68) |
| TC-IM10-011 | M15-S05 | FAIL 0.06 | stale | Facts assume Sahil is restricted like a staff seat; Sahil is super user (D68) so the refusal or restricted view never appears [worst fact 0.06: Every row in the table is by Meena.] | FACT CHANGE proposed (D68) |
| TC-IM10-012 | M15-S05 | REVIEW 0.65 | stale | Other old-portal facts (dashboard or headline strip, Team wording, block-full refusal text); app and prototype fail identically [worst fact 0.65: The header shows '1 identity reveal'.] | FACT CHANGE proposed (D98) |
| TC-IM11-004 | M08-S07 | FAIL 0.04 | stale | Facts use the persona name 'Rohit Verma'; the console seat is Rohit Deshpande [worst fact 0.04: The Journey says Kiran Joshi was brought in by Rohit Verma from Events] | FACT CHANGE proposed (D98) |
| TC-IM11-006 | M08-S08 | FAIL 0.07 | stale | Other old-portal facts (dashboard or headline strip, Team wording, block-full refusal text); app and prototype fail identically [worst fact 0.07: The What they hold tab has no 'The app account' section yet.] | FACT CHANGE proposed (D98) |
| TC-IM12-003 | M18-S02 | FAIL 0.02 | stale | Facts assume Sahil is restricted like a staff seat; Sahil is super user (D68) so the refusal or restricted view never appears [worst fact 0.02: The menu lists exactly two pages: Activity log and Team.] | FACT CHANGE proposed (D68) |
| TC-IM12-004 | M18-S02 | FAIL 0.04 | stale | Facts name the old Investors portal rail (Signed in as, Transactions, Insights, Team, Activity log, Dashboard); the merged console has none of these (D98, BLOCKED M01-S01-NOTE-1). Prototype fails identically [worst fact 0.04: The menu lists exactly 8 pages: Dashboard, Investors, Farms, Tickets, ] | proposed fact change under D98 |
| TC-E03-012 | M03-S02 | REVIEW 0.79 | flaky-borderline | Passed in 8 of 11 runs; three re-runs today gave 2/3 PASS with scores 0.69-0.86 around PASS_AT 0.80; the fact is true on screen [worst fact 0.79: Under Leads, 'See it' is offered.] | none (judge noise; no app change) |
| TC-E03-019 | M03-S04 | REVIEW 0.7 | flaky-borderline | Passed in 8 of 11 runs; three re-runs today gave 2/3 PASS with scores 0.69-0.86 around PASS_AT 0.80; the fact is true on screen [worst fact 0.7: The newest System activity entry is 'Console access granted' by Sahil ] | none (judge noise; no app change) |
| TC-E03-020 | M03-S04 | REVIEW 0.76 | flaky-borderline | Passed in 8 of 11 runs; three re-runs today gave 2/3 PASS with scores 0.69-0.86 around PASS_AT 0.80; the fact is true on screen [worst fact 0.76: The newest System activity entry is 'Console access ended'.] | none (judge noise; no app change) |
| TC-E07-004 | M07-S01 | REVIEW 0.77 | flaky-borderline | Passed in 8 of 11 runs; three re-runs today gave 2/3 PASS with scores 0.69-0.86 around PASS_AT 0.80; the fact is true on screen [worst fact 0.77: The Next step card's only contact button is 'Log a contact': there is ] | none (judge noise; no app change) |
| TC-IM01-007 | M01-S08 | REVIEW 0.79 | flaky-borderline | Passed in 8 of 11 runs; three re-runs today gave 2/3 PASS with scores 0.69-0.86 around PASS_AT 0.80; the fact is true on screen [worst fact 0.79: The ledger shows exactly 2 entries: a balance of '₹22.5 L' with 'RTGS ] | none (judge noise; no app change) |

## Notes

- Fact changes are proposals only; `pm/tests`, `ui-cases.json` and `BLOCKED.md` were not edited. The ten cases already named in BLOCKED.md are marked there.
- TC-IM04-012 (borderline in the 28 Sep report) passed in the final run.
- bug-open items need a feature (offline queue, step-up panel, Auditor Activity, masked UTR on the register); they are outside "small fix" and are tracked in BLOCKED.md or proposed as carry-forward.
- Calibration stays 18/18: no fixture, prompt or runner change was made.
