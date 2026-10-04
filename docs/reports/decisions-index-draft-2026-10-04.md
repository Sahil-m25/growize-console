# Decisions index rows, draft (4 Oct 2026)

Drafts for the gap listed in `docs/reports/decisions-index-gap.md`. `docs/DECISIONS.md` was not edited: the coordinator pastes the rows in number order (D67 after D66, D86 to D92 after D85, D94 to D103 between D93 and D104). Same columns as the index: `| [Dn](decisions/file.md) | decision | date |`. Superseded rows end the decision cell with `— **Superseded by Dxx**`.

Sources: no D67, D86 to D92 or D94 to D103 file exists in `docs/decisions/`, and `git log -S"D9x"` and `docs/SESSIONS.md` only mention them as gaps (SESSIONS.md:245 gives D67 as "D67 draft + D68"). Every row below is therefore drafted from the claude.ai Growize Business Unit project doc named in the "Source" column (`claude/decisions-and-changes-dNN.md`, the place `docs/launch/stage-reviews.md` line 192 says the texts live). The link target in each row is the proposed repo file name, which does not exist yet; each project doc would be copied to it. Investor names, emails and ids in the sources (D96) are left out of the rows (rule 7).

## Rows

| # | Decision | Date |
|---|---|---|
| [D67](decisions/D67-one-console-ir-base.md) | One console with the IR console as the base: the IM portal folded in as an Investors side in the IR console's style (console/prototype/merge/ build); Jev overlap audit fixed 16 overlaps at ≥0.90 (pm/merge-audit/REPORT.md); Sahil holds every page; 8 owner questions left where Jev stayed below 0.90 — **Draft: concept for review, merge decision was open** | 25 Sep 2026 |
| [D86](decisions/D86-growize-app-audit-and-branded-loading-screen.md) | Growize App (Flutter) audit: one branded loading screen on web, Android and iOS; router, auth-listener, sign-out cache wipe and other code fixes made; 11 items left open (live schema drifted from the migrations, 3 edge-function faults, ROI, photos, crops, PIN lockout, web auth secret, CI pin, realtime, unused routes) | 26 Sep 2026 |
| [D87](decisions/D87-growize-app-decisions-on-the-d86-audit.md) | Owner decisions on the D86 audit: schema to be extracted from the Supabase dashboard (no pg_dump); ROI stays hidden until the first payout lands; crop UI removed; PIN lockout now persistent (3/6/9/10 wrong steps); web auth secret removed; CI moves to Flutter 3.41 with CanvasKit | 26 Sep 2026 |
| [D88](decisions/D88-live-supabase-schema-captured-and-three-production-defects.md) | Live Supabase schema captured as migration 070 (replaces the drifted chain); three production defects found with fixes written as 071 (broken stage trigger, portfolio view leaking across investors, public caller able to post project updates); Jev field-mapping check over 158 reads, 6 real mismatches fixed | 26 Sep 2026 |
| [D89](decisions/D89-zoho-to-supabase-sync-outage-resolved.md) | Zoho to Supabase sync was down 13 Aug to 26 Sep because the integration token belonged to a disabled admin; fixed with a new Self Client (scope ZohoCRM.modules.ALL) and the three sync jobs re-run; the broken health-check cron explains why nobody noticed | 26 Sep 2026 |
| [D90](decisions/D90-test-allocation-removed-and-sync-alerting-rewritten.md) | Test allocation soft-deleted; sync-stale-alert v9 live (alerts on a failed latest run or no success for 26 h, one alert per job per 24 h, by email); 7,999 old alert rows cleared; health-check-daily cron paused | 26 Sep 2026 |
| [D91](decisions/D91-migration-071-applied-and-consultation-alerts-on-slack.md) | Migration 071 applied to production and verified; consultation alerts stay on Slack but are not yet configured (webhook secret unset); app repo branch aligned with origin, work uncommitted | 26 Sep 2026 |
| [D92](decisions/D92-app-access-gate-hold-and-invite.md) | App Access gate: Contacts.App_Access picklist Hold (default) or Invite, so converted investors can be added and checked before any welcome email; Hold creates a suspended login and sends nothing, Invite unsuspends and sends one branded welcome; deploy of 072 and two functions left to the owner | 26 Sep 2026 |
| [D94](decisions/D94-app-access-gate-live-test-results.md) | App Access gate tested live end to end after the owner fixed the Resend key (migration 072, zoho-crm-webhook v36, request-auth-email v11): Hold sends nothing and blocks sign-in, Invite sends the welcome and writes the welcome stamps back to Zoho | 26 Sep 2026 |
| [D95](decisions/D95-investor-app-release-fb95a07-live.md) | Investor app release fb95a07 live on growizefarm.com (push to main, GitHub Actions, Netlify): branded splash, real farm photos, once-only first-payout popup, per-investor 60-month term from the Investment Date, document zoom; branded sign-in and welcome emails; documents synced daily 06:15 IST | 27 Sep 2026 |
| [D96](decisions/D96-twelve-converted-investors-staged-on-hold.md) | Twelve already-converted investors staged in Zoho production on App_Access Hold with Issued allotments on EKA LLP (units issued 4 to 18 of 22); Investment_Date, contact and KYC details still missing before any Invite | 27 Sep 2026 |
| [D97](decisions/D97-investor-app-ui-batch.md) | Investor app UI batch: first payout on the 10th day of the 7th month of the investor's own term, returns read "Yet to begin" until a processed payout, expected annual return from Zoho yield, Home updates feed with per-farm history, tappable notifications, map and History tab, Investment Date taken from the allotment record only | 28 Sep 2026 |
| [D98](decisions/D98-three-phases-honest-baseline-tracker.md) | Console build in three phases in order (front end on demo data, plug into Zoho, test and harden) via autopilot/phases.json; honest test baseline (full suite 1 of 241, lead side 15 of 67); loop-hours forecast; Slack tracker rebuilt after every recorded round | 27 Sep 2026 |
| [D99](decisions/D99-phase-1-front-end-identical-to-the-prototype.md) | Phase 1: the front end matches the merged prototype screen for screen; no demo data in the product (demo records are fixtures loaded only with FIXTURE_MODE=local); one data interface (src/lib/data); business rules as pure unit-tested functions; generic sign-in with a Zoho stub | 27 Sep 2026 |
| [D100](decisions/D100-backend-built-beside-the-front-end.md) | Backend built in a second git worktree (branch autopilot/backend, phase pinned to zoho) while the front end is built; owns server, lib/zoho, api and contracts; tests on recorded Zoho responses; daily merge from the console branch; only the main worktree pushes the tracker | 27 Sep 2026 |
| [D101](decisions/D101-jev-makes-the-autopilots-small-judgments.md) | Jev makes the autopilot's small judgments (autopilot/jev.mjs): context picks what to read per story, triage classes each failed UI case, decide settles either/or choices and records those under 0.7 as PROVISIONAL; npm test added; forecast runs phases 1 and 2 in parallel | 27 Sep 2026 |
| [D102](decisions/D102-growizefarms-com-down-to-a-maintenance-page.md) | growizefarms.com taken down to a maintenance-only page (all 14 pages and the lead function removed) because the owner said the content was not right; previous deploy kept for restore — **Superseded by D103** | 28 Sep 2026 |
| [D103](decisions/D103-growizefarms-com-back-live-with-corrected-claims.md) | growizefarms.com back live with corrected claims: financial numbers and the unit price removed, 60-month tenure kept, "tax-free" became "tax-efficient", guarantee-style wording and an unverifiable press quote removed, EKA location corrected to Talakad, Karnataka; lead function rewritten and not yet tested end to end | 28 Sep 2026 |

## Source map and notes

| D | Source | Notes |
|---|---|---|
| D67 | project doc `claude/decisions-and-changes-d67-draft.md` | Cited in SESSIONS.md:245 and D68 line 3 as "D67 draft". It is a draft concept, so the row says so. |
| D86 | `claude/decisions-and-changes-d86.md` | Growize App (Flutter) work, not the console. |
| D87 | `claude/decisions-and-changes-d87.md` | Owner answers to D86. |
| D88 | `claude/decisions-and-changes-d88.md` | Names a TypeSafe key pasted in chat; the doc says rotate it. |
| D89 | `claude/decisions-and-changes-d89.md` | |
| D90 | `claude/decisions-and-changes-d90.md` | |
| D91 | `claude/decisions-and-changes-d91.md` | |
| D92 | `claude/decisions-and-changes-d92.md` | D93 (console-run app access) builds on this switch. Not marked superseded: D93's Hold default is the same switch. |
| D94 | `claude/decisions-and-changes-d94.md` | Test results for D92. |
| D95 | `claude/decisions-and-changes-d95.md` | |
| D96 | `claude/decisions-and-changes-d96.md` | Source holds investor names and emails; omitted. |
| D97 | `claude/decisions-and-changes-d97.md` | Doc dated 27 to 28 Sep; the row uses 28 Sep, the day it was closed. |
| D98 | `claude/decisions-and-changes-d98.md` | Most-cited gap: `autopilot/phases.json:2`, D104, D105, D108. The three-phase order was later extended by D104 (wire phase) and D105 (harden phase), not superseded. |
| D99 | `claude/decisions-and-changes-d99.md` | |
| D100 | `claude/decisions-and-changes-d100.md` | Cited by D105 line 16. |
| D101 | `claude/decisions-and-changes-d101.md` | Jev tooling later folded into one layer by D107; not marked superseded because D107's row does not say so. Coordinator to decide. |
| D102 | `claude/decisions-and-changes-d102.md` | Marked superseded by D103, which says so in its first line. |
| D103 | `claude/decisions-and-changes-d103.md` | |

Not index gaps: D34 already has a row (marked "No file exists"); D83 to D85 have rows. If the Growize project's D103 doc is right that the 3 Sep deploy had no recoverable source, the `lead` function note in the D103 row stays accurate.
