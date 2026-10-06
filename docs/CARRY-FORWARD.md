# Carry-forward — what has been decided and not yet built, and what is waiting on somebody

_Started 22 Sep 2026, because a decision written here does not reliably get picked back up._

The evidence for why this file exists: `D34` is cited by D35, by D45 and by the session log, and
**the file has never existed**. D34, D35 and D36 are all absent from the `DECISIONS.md` index.
`graph.json` — which `CLAUDE.md` instructs every agent to query before opening a file — **contains
zero nodes** and has since the port was built. `STAGE-1.md` still says *build the webhook* four days
after D45 abolished the mirror. None of that was noticed by anybody reading `SESSIONS.md`, because
a session log records what happened, not what is still owed.

**The rule.** `/resume` reads this file. Anything finished is struck through with the date and the
session that did it — never deleted, because the history of what was owed is the point. Anything new
that is decided-but-unbuilt is added in the same session that decides it. A decision file that
creates work and does not add a line here has not finished.

---

## A · Decided, not built

| # | What | From | Blocks |
|---|---|---|---|
| A-01 | The cache does not exist. The prototype is in-memory mock data; there is no caching machinery at all | D45 | Everything. D46 makes the server-side shared cache the thing that keeps the team inside the sub-concurrency 10 |
| A-02 | Stale/error state on a failed live fetch with an expired cache entry; cache private to the request path; a hard 5-minute TTL ceiling | D45 TypeSafe pass | Whether the cache can silently become the copy D45 forbids |
| A-03 | The modified-time check before a write on a lead under an active D44 cover window — now known to be `If-Unmodified-Since`, returning 412 `ALREADY_MODIFIED` | D45 TypeSafe pass, refined by the Zoho mapping | Two people working one lead, which D44 creates deliberately |
| A-04 | The five stage sheets still describe the mirror. ~66 sentences. **STAGE-1 reads "build the webhook" at 1.6** | D46 | Week one. Run STAGE-1 as written and it builds what D45 deleted |
| A-05 | Planes B and C do not exist — no operational log, no identity/authority log | D47 | D22's step-up lock, D13's reveal log, every runbook, and the only possible record of a refused read |
| A-06 | The ops and audit console screens are specified and unbuilt | D47, `ops-audit-console.md` | Any debugging that does not involve opening Zoho |
| A-07 | Step-up authentication is not implemented anywhere. The portal's `reveal()` asks a reason and logs it, with no code, no failure count, no lock | D22, D13 | Eight authoritative actions, two of which are reads Zoho cannot gate |
| A-08 | B36, the statement upload, does not exist in the portal prototype | D21, D22 | Maker-checker on every ordinary receipt |
| A-09 | The portal's `allot()` sets state as a field and will be refused — blueprint-controlled fields reject an ordinary PUT | IM portal mapping | Every lifecycle move in the portal |
| A-10 | The IM portal is not on the console's design architecture. Quirks mode, Google-hosted font, 18 native `alert()`, no `commit()`, no freshness | D48 | Stage 3, and any claim that the two products are one system |
| A-12 | **A restricted test user, before any permission-sensitive code.** The super admin bypasses field-level security, profile and role scoping, so every permission defect stays invisible to it (Jev 0.93). Also: the super admin must never double as a service identity or the integration user (Jev 0.87) | D51 | Every permission path — D13, D40, D44 — goes untested until this exists |
| A-13 | Manager approval and extension decisions move back into Zoho as approval processes | D51 | Reverses part of D50's drift |
| A-14 | D44 cover windows move back into Zoho as record-level sharing, with automation adding the share when a window opens and removing it when it closes | D51 | Closes the bypass D49 accepted — an IR opening Zoho directly |
| A-15 | **The application-side half of the identity wall**, resized by D53. With every human on their own token, the service-token guard applies only to background jobs and inbound callbacks. Remaining guards: the cache keyed by visibility scope (A-19); logs carry IDs and status, never bodies; callbacks re-fetch and never log payloads; exports run on the requester's own token; the reveal is a second call; new Contact fields created hidden; no admin token anywhere in the app; investor-portal isolation tested | D52, D53 | The owner's bar: field-level security is enough unless it leaks through the app |
| A-16 | The Lost guard returns to Zoho as a blueprint condition or validation rule on the Lead's confirmed-money gate column | D52 | D5's count |
| A-17 | Record-level sharing for D44 cover windows: add the share when a window opens, remove it when it closes (custom functions carry the automation) | D52, D51 | Cover access without a service token |
| A-18 | **One-org pass — mostly done 23 Sep.** Both mapping workbooks and their JSON sources revised (IR 129 cells, IM 308; the IM seams sheet renamed *Module seams (one org)*); `CLAUDE.md`'s nine rules rewritten (rules 1, 2, 7, 8); `ops-audit-console.md` and D47 revised; all seven runbooks dispositioned (outbox-stuck void, pii-leak rewritten, four re-scoped, money-mismatch valid); stage-sheet banners extended. **Still stale:** `db-leads/README.md`, `db-investors/README.md`, `ops/diagnose/README.md` (Supabase, reconcile, outbox), `.claude/commands/resume.md` (tells agents to query the empty graph), and ~190 lines inside the stage sheets, which is A-04 | D52 | Anyone reading the stale files builds the wrong seam |
| A-19 | **The cache keyed by visibility scope — code written 23 Sep, not wired.** `console/src/lib/zoho/cache.ts`: scope is a required discriminated union (user, subtree, role), so an unscoped key does not compile; 5-minute ceiling; values restricted to aggregates by type; reads return fresh / stale-once / miss / error. Also written: `gate.ts` (12 overall, 8 complex), `errors.ts` (three kinds of 429, 412 conflict, 207 parsed per record), `client.ts` (v8, `api_domain` from the token, `If-Unmodified-Since`, blueprint transitions, `wasDeleted`), `log.ts` (IDs never bodies), `adapter.ts` (fixture implementation; live implementation stubbed). 30/30 tests, `tsc` clean. **Not wired into any screen; live adapter, token refresh and a durable log store remain** | D53 | Every cached screen |
| A-20 | **Renew Enterprise before 13 Oct 2026.** Read from the org 23 Sep: Enterprise, paid, one user licence, expiry 13 Oct. If it lapses, field-level security, sandbox, approvals and the concurrency figures D46/D53 rest on go with it | Org as found | Everything D51-D53 assume |
| A-21 | **Build D52's wall in the real org before any second seat.** Today: one role (CEO), two profiles (Administrator, Standard), every identity field read_write to both, PAN plain on Leads, Contacts and Accounts. Needed: the roles and profiles, field-level security on every identity field, Private default sharing, PAN encrypted on Contacts, and a decision on PAN on Leads (the design keeps identity on the Contact). The Zoho connector has no profile, role or sharing tools, so this is the UI or the app's own OAuth client. Jev 0.86 against adding any user first. **Order (D54):** A-20 → A-22 → this and A-23 → buy the test seat → T11 → A-24 to A-26, each re-checked with the test user → the team's seats | D52, D53, D54, Org as found | Every seat after the super admin; T11 |
| A-22 | **Stop native Lead conversion.** The org has converted 5 of 5 Leads, which D52 scored zero. Remove Convert from IR profiles; replace `Lead_Status`'s generic values with the rung vocabulary and add the gate columns | D52, Org as found | The console's live adapter for rungs 4-7 |
| A-23 | **Aadhaar to last-4 + reference.** Add `aadhaar_last4` and `aadhaar_ref` to Contacts; a one-off job run by the super admin fills them from the existing values (four Contacts), logging record IDs only; hide `Aadhaar_Number` from every profile Zoho allows. Removal of the full field is not scheduled | D54 | Any seat that could otherwise read the number |
| A-24 | **Receipts module**, one record per money movement (state, recorded_by, matched_by, UTR, amount, date, reversal link); move the two issued allocations' payments out of `Amount_n`/`UTR_n`/`Date_n`; stop writing those columns (not deleted) | D54, B32 | D21 maker-checker, D19 reversals, B36 statement match |
| A-25 | **Adopt the shelf and Allotments.** `LLP_Creation_Module`: released units, `available` as a formula over Allotments and Holds. `LLP_UnitAllocation_Module`: a lifecycle blueprint (A-09's `allot()` targets it). Contacts: the ten Yes/No lifecycle picklists folded into one field under a blueprint | D54, B38, B41 | Portal Farms and allotment screens |
| A-26 | **Create the modules with no home.** Portal: Documents, Templates, Holds, KYC Files, FEMA, Requests, Care log, Statements, Updates. Console: Touches, Events, Paper, Payment Claims, Plan. T4 counts the six custom modules already in the org | D54, D49 | The screens that write them |
| A-27 | **The Team-module duplicates.** Someone on the Team-module Admins profile checks `LLP_Creation` (unreadable to the super admin) and `LLP_Unit_Allocation`, then both are hidden. No delete without the owner | D54 | Nothing, but two copies of the same fact invite a second writer |
| A-28 | **ARL instruments, later pass.** A read-only panel on the investor page for `ARL_Holdings`/`ARL_Transactions`, under the same field-level security and step-up rules. The modules stay managed in Zoho as today | D54 | Nothing in the first portal build |
| A-11 | No reversal ledger. Gates cannot be certified across reversals | D19, B19, B22 | Numbers net of refunds; the gate model itself |

## B · Waiting on the owner

| # | What | From |
|---|---|---|
| ~~B-01~~ | ~~Where availability, cover windows, read-state and the LOG live~~ — **closed 22 Sep, D49.** Split by what each is: cover windows and availability to Plane C, read-state to browser storage, the LOG to Plane A's archive. Nothing new in Zoho. Price accepted: the cover window is an application-layer gate, and an IR who opens Zoho directly is not bound by it | O-02, D49 |
| ~~B-02~~ | ~~Whether touches need their own object~~ — **closed 22 Sep, D49.** A dedicated custom module, written only by explicit human action, so rule 6 holds by construction. Module budget now five; T4 must confirm the allowance | O-05, D49 |
| ~~B-03~~ | ~~D24's licence-free viewers~~ — **closed 22 Sep, D50.** Service token, scoped by our layer, with Plane B logging which human read. Viewers stay licence-free; Zoho's sharing rules never see these reads | O-06, D50 |
| ~~B-04~~ | ~~The fifteen-minute undo on handover~~ — **closed 22 Sep, D49: the window is dropped.** The typed confirmation is the guard; a mistake goes through D19's reversal path. Changes B20's stated requirement — the workbook row and the *Said yes handover* acceptance path both need the undo line struck | O-07, D49 |
| ~~B-05~~ | ~~Who writes into the other org~~ — **closed 22 Sep, D49.** Two bounded service identities, one per org, each on a profile permitted to write only the named fields. Attribution lives in the org where the human acted; the cross-write is a projection of that act. Third correction to D46 | O-08, contracts, D49 |
| ~~B-06~~ | ~~The portal has no Leads-org credential~~ — **withdrawn 22 Sep, this was my error.** `contracts/` answers it: every fact Finance's queue consumes is directed `leads → investor` and is *delivered into* the Investor org, not read out of the Leads org. Finance needs no Leads-org access at all. The real item is B-05, restated below | Cross-product seams |
| ~~B-07~~ | ~~Whether the audit archive is an exception~~ — **closed 22 Sep, D50: outside the ban, not an exception.** It holds audit entries, not records, and no screen reads a record from it. *Not archiving* scored 0.00 | D47, D50 |
| ~~B-08~~ | ~~Approval steps on Professional~~ — **closed 22 Sep, D50.** Enforced in the console: a request record, a decision, the guard in our layer | O-09, D50 |
| ~~B-10~~ | ~~The edition question, reopened as a measurement~~ — **closed 23 Sep, D51: Enterprise, production included.** T14 superseded. Approval and cover windows return to Zoho; viewer scoping does not, see B-11 | D50, D51 |
| ~~B-11~~ | ~~Viewer scoping~~ — **closed 23 Sep, D53: every human holds a full Enterprise seat**, viewers included. Every read is scoped and attributed by Zoho natively. D5's count is now one | D52, D53 |
| B-12 | **Who can read and write across record owners under Private sharing.** D52 set Private default sharing but did not say what lets Finance write gate columns on IR-owned Leads, lets an IR read Finance-owned receipts and documents for a lead they hold (D42), or lets an IR search Contacts for duplicates. Candidate mechanisms on Enterprise: data-sharing rules role-to-role (Finance read-write on Leads, with field-level security keeping Finance to gate fields); automation-managed record sharing for held leads, like cover windows. **Must be proved in T11** | Workbook agent, O-13 |
| B-13 | **KAMs.** D53 said everyone holds a full Enterprise seat; D12/D20 had KAMs as Team users. Read as full seats under 'everyone' — confirm | D53, D12 |
| B-14 | **What D43's investor copy means in one org**, now that the Contact exists from 'said yes' | Workbook agent |
| ~~B-15~~ | ~~Seats.~~ — **closed 23 Sep, D54: the wall first, then one seat for the restricted test user and T11, then the team's seats role by role (Jev 0.75, confidence 0.62). T11 runs before any real user; every later module is re-checked with the test user** | Org as found |
| ~~B-16~~ | ~~The full Aadhaar number is stored~~ — **closed 23 Sep, D54: add `aadhaar_last4` + `aadhaar_ref`, fill from the existing values, hide the full field now (Jev 0.99). Clearing and removing it stays the owner's call with compliance advice — not scheduled. Work is A-23** | Org as found, B29 |
| ~~B-17~~ | ~~The five converted Leads and the two Deals.~~ — **closed 23 Sep, D54: native conversion stops (A-22); the five converted Leads, four Contacts and two Deals stay as legacy; no new Deals; allotments link to the Contact and the LLP directly (Jev 0.97 / 0.82)** | Org as found, D52, C-08 |
| ~~B-18~~ | ~~The investor side already exists under other names.~~ — **closed 23 Sep, D54: adopt and extend (Jev 0.99). `LLP_Creation_Module` = shelf, `LLP_UnitAllocation_Module` = Allotments, a new Receipts module takes the flattened payments, ARL modules untouched with a read-only investor-page panel later (Jev 1.00), only homeless modules created. Work is A-24 to A-28** | Org as found; both workbooks, sheet *Org as found* |
| B-19 | **Staging test sign-in (D124): set the variables and enrol.** In the Catalyst console set `GZ_TEST_SIGNIN_SECRET` (48 random chars) and `GZ_TEST_SIGNIN_USERS` (the sandbox test users' Zoho ids), deploy branch `test-signin-staging`, then sign in once as each test user. Under `STATE_STORE=memory` the enrolment dies with the instance — move staging to `STATE_STORE=catalyst` (+ `SESSION_ENC_KEY`, `CATALYST_*`) or paste `GZ_TEST_REFRESH_<id>` | D124 |
| B-09 | The 160 ASK items in `repo-cleanup-proposal.md`. Nothing has been deleted | Repo audit |

## C · Known defects

| # | What |
|---|---|
| C-01 | **`graph.json` contains zero nodes.** `CLAUDE.md` tells every agent to query it before opening a file. It has been empty since the port |
| C-02 | **D34 does not exist**, though D35, D45 and the session log all cite it. *(Index half fixed 22 Sep: D35 and D36 now indexed, and D34 has a row stating plainly that no file exists. The missing file itself remains — nobody has written down what D34 decided.)* |
| C-03 | `console.css`'s PORT-ONLY appendix is no longer verbatim — 2,379 lines against the prototype's 2,343, 38 lines added |
| C-04 | D27 specifies 33 icon glyphs; the prototypes carry 29 and 24, and 14 `d-*` door keys are absent from `ICONS`, so `ic("d-history")` returns empty |
| C-06 | **Read attribution is narrower than D53 says.** Zoho scopes every read to the user's token, but the audit log records changes, not reads, and the per-user API dashboard is UI-only and keeps 30 days. 'Every read attributed' holds only via Plane B | Docs agent |
| C-07 | Plane B on S3 Object Lock (D47's suggestion) would make an identity field that leaked into the log **unerasable**. Resolve before choosing Plane B's store | Docs agent, pii-leak.md |
| C-08 | STAGE-2's week-5 'if one org' branch assumes native Lead-to-Contact conversion, which D52 scored zero. **23 Sep: the real org has been doing exactly this — 5 of 5 Leads converted.** See A-22, B-17 | Docs agent |
| C-09 | The Zoho connector in claude.ai is signed in as the super admin. Fine for inspection; never the app's identity, and never evidence of what a restricted user sees (FLS is bypassed) | D51, Org as found |
| C-10 | Blueprints, workflow and validation rules, sharing settings, profile permissions and the audit log cannot be read through the connector — the 23 Sep read did not see them | Org as found |
| C-11 | Tasks, Events, Calls and Cases are `user_hidden` in the org, though the console uses Tasks for follow-ups (B05, B10). The API still answers; IRs opening Zoho would not see them | Org as found |
| C-12 | Permanent-name quirks in the org: `FEMA_Applicable` is a picklist on Leads and a boolean on Contacts; `ISFC_Code` (sic, IFSC) on Contacts; `LLP_Creation_Module.Pet_Unit_Price`; `LLP_Status` value `Darft`. API names cannot be changed — map them, do not fight them | Org as found |
| C-05 | `console-src-backup-2026-09-17/` is not a clean duplicate — 93 files differ, 22,969 lines of churn. Neither side is in git |

## D · Unverified, settle in the trial org

**23 Sep, from the real org:** T1 answered — Enterprise, paid, not a trial, expires 13 Oct (A-20). T2 answered for this org — COQL `COUNT` and `GROUP BY` ran; Q32 closes under D51. See `zoho-org-as-found-2026-09-23.md`.

**Updated 23 Sep (D52).** One Enterprise org is decided. T1: the owner confirms Enterprise — check the subscription's end date in case it is a trial. **T11 is now the attack, not the decider**: the wall from four doors plus D52's application-side leak guards, before real investor data enters. Then T2 and T6.

All thirteen tests are in `trial-org-tests.md`. The ones that change the design if they come back
wrong: **T2** (does the Queries allowance gate COQL — if it does, the read layer has no path),
**T3/T4** (custom field and module ceilings, which decide what the data model may contain), **T6**
(field-level security, which D13 rests on entirely), and **T7** (whether the per-profile API access
toggle exists at this edition, which per-user OAuth depends on).

Open questions with a stated default are in `OPEN-QUESTIONS.md` and are not duplicated here.
Q30, Q31, Q15 and (23 Sep, from the real org) Q32 are closed.

## E · Not in git

Nothing in this repo from D26 onward is committed — the Next.js port, decisions D26 to D48, the
stage sheets, both mapping workbooks. `.gitignore` was corrected on 22 Sep so that `.next/` and
`*.tsbuildinfo` stop being offered, which took the git-visible tree from 882 MiB to about 15 MB.
**No file has been deleted.** Committing remains the one action that would make every later mistake
recoverable.

- **D121 (5 Oct 2026) KAM share service: retired by D122 (5 Oct 2026).** The console no longer shares anything; it writes Contacts.KAM only, and Zoho-native sharing (KAM_Access, workflows, nightly Deluge check) does the rest.
  - The owner no longer needs the Share Service role or its seat (no "Share Service" profile or role is created; ZOHO_KAM_SHARE_REFRESH_TOKEN, ZOHO_SHARE_SERVICE_USER_ID and the kam-share-reconcile schedule are not needed).
  - Still open from D121: P14 (IR Manager View on allotments for Share), the Originating_IR share restore owner, and seating a person with no Investors seat.
  - Docs still describing the old share/unshare shape: docs/ops/runbook.md, ops/runbooks/api-budget.md, ops/runbooks/heartbeat-silent.md, docs/launch/go-live-checklist.md.

- **D123 (5 Oct 2026) cover, absence and IR hand-off on Zoho field sharing: console done, Zoho not applied.** The owner applies the list in docs/decisions/D123-field-sharing-cover-handoff.md: Cover_By/Originating_IR sharing, Secondary_Owner off in live, the IR_Access field, the IR allotment View (zoho/access), the three Deluge functions and "GZ IR Access Sync", the IR_Access backfill, and ZOHO_COVER_EXPIRY_REFRESH_TOKEN.
  - Open: an absence planned to start later opens no Cover_By until re-saved on or after its first day (no scheduled human token); the sweep service job was renamed "cover-expiry".
  - Stale docs: docs/ops/runbook.md, ops/runbooks/heartbeat-silent.md, ops/runbooks/api-budget.md, catalyst/README.md still describe the cover-window share/unshare.
