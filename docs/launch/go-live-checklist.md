# Go-live checklist, cutover and rollback (M18-S09)

Written 4 Oct 2026. Status: written, not rehearsed. Hosting (AP4) is open, so there is nothing to deploy to yet.

Go-live date: **OPEN — owner** (OD10). D66 made dates projections. They are not appointments.
Who says go at the go/no-go meeting: **OPEN — owner** to name the person. Sahil owns the checklist and the blocker list.

How to use this page. At go/no-go every line below is ticked with evidence, or it is a blocker. Evidence is a file path, a link, or a dated line in `ops/drills/`. "Looks fine" is not evidence. Never paste a token, secret, PAN, bank number or investor name into evidence.

## 1. Entry gates

| # | Gate | Evidence to attach | Source | State on 4 Oct |
|---|---|---|---|---|
| **A. Zoho and the wall** | | | | |
| A1 | Zoho Enterprise renewed. Expiry is **13 Oct 2026**. Test-user seat bought. | Invoice reference in `ops/`, new expiry date | M02-S01-T01, A-20 | Not done (Sahil task open) |
| A2 | Profiles, field-level security and Private sharing built per `docs/ACCESS-PLAN.md` | Setup exports under `zoho/` | M02-S04-T02/T03/T04 | Not done (Sahil tasks open) |
| A3 | T11 wall test passed on every profile with the restricted test user, before any real seat | T11 result file, status codes only | M02-S05, M03-S05, D54 | Not done |
| A4 | Sahil on the non-admin Digital Infrastructure profile, separate from the super admin | Zoho user screen, no tokens | M03-S05-T02, D110 | Not done |
| A5 | Native Lead conversion removed from every profile | Profile export | M02-S06-T01 | Not done |
| A6 | Zoho setup tasks assigned to Sahil in `autopilot/console/BLOCKED.md` and `autopilot/PEOPLE-CALENDAR.md` are ticked, or each open one is accepted by the owner as a known gap | Ticked lines, or a signed gap list | BLOCKED.md | Open. See the list in section 6 |
| A7 | Zoho Sign on a paid plan with API and HMAC webhooks. One webhook for production, one for staging. | Plan name and renewal date only | M20-S08, AP3, D78 | Not done (Sign is on Free Edition, D78) |
| A8 | Cover-window share and unshare automation in Zoho, proved with the test user | Share proof | M02-S09, A-14, A-17 | Not done |
| **B. Proofs on the sandbox** | | | | |
| B1 | Sandbox live with the seeded book; reset works | Reset log | M02-S10, M19-S03 | Not done |
| B2 | Phase 3 sandbox half done: the units "waiting" on Zoho proof are proved | `autopilot/status.json` shows waiting = 0 for phase 3 | D104, D112 | 47 waiting on 4 Oct |
| B3 | Isolation proof against real Zoho sharing | Isolation suite result | M03-S07, M18-S02 | Local half only (63 cases on fixtures, D112) |
| B4 | Route contract suite, leak matrix and security checks green | CI run link, `check` job | M18-S14, M18-S15 | Green on fixtures |
| B5 | Legacy migration verified: 5 Leads, 4 Contacts, 2 Deals carried, no new Deal. Old payment columns moved to Receipts, totals equal. | Script logs (ids only), counts | M18-S06, M18-S12 | Not run. Dry run on sandbox first, then production with the same script |
| B6 | Load test inside Zoho limits (p95 <= 2 s, no 429) | Load test report | M18-S01 | Not run |
| **C. Pipeline and hosting** | | | | |
| C1 | Hosting chosen (AP4). `HOSTING_READY` is `true`. The placeholder deploy steps in `.github/workflows/pipeline.yml` are replaced. | Workflow diff | AP4, `ops/env/README.md` | **OPEN — owner** |
| C2 | Production secrets in place. Staging and production share no secret value. | Variable list from `ops/env/README.md` ticked, no values | `ops/env/README.md` | Not done |
| C3 | Production has `GZ_SIGNIN_LIST`, `JEV_SEED_TOKEN`, `FIXTURE_MODE`, `ZOHO_STUB_USER` unset. The test API answers 4xx in production. | Pipeline smoke step output | `pipeline.yml` | Not done |
| C4 | Staging green and trusted: Jev suite all PASS, calibration gate passed | Staging job summary | D63, D64 | Not run (no host) |
| C5 | `production` environment has Sahil as required reviewer | GitHub setting | `ops/env/README.md` | Not done |
| C6 | Rate limits are in-process, so run one instance, or move the buckets to a shared store first | Host config | `ops/env/README.md` | Not done |
| **D. Safety nets** | | | | |
| D1 | Backups on and one restore drill passed | `ops/drills/<date>-restore.md` | M18-S05, `docs/launch/backup-restore-plan.md` | Plan written. Storage OPEN — owner |
| D2 | Planes B and C store chosen and in place | Decision record | D47, M18-S05 | **OPEN — owner** |
| D3 | Alerts on: alert email provider chosen, `ALERT_EMAIL_TO` set, a real mailer plugged in. A test alert reached Sahil. | Test alert received | M18-S04, M18-S04-NOTE-1 | Not done. Alerts sit in an in-memory outbox |
| D4 | Step-up redirect URI registered; `STEPUP_ALERT_TO` set (Sahil and Pradeep) | Config check | M01-S10-NOTE-2 | Not done |
| D5 | Hourly read-only production check runs and alerts Sahil | First alert test | M19-S07-T02 | Not done |
| D6 | Runbook walk-through passed by the tester without asking Sahil | TC-E15-036 result | M18-S10 | Not run |
| D7 | Rollback rehearsed: app access withdrawn in 30 minutes | `ops/drills/<date>-rollback.md` | M18-S09-T03, TC-IM12-018 | Not run. Waits for hosting |
| **E. People** | | | | |
| E1 | UAT accepted by Sahil per `docs/uat/README.md` exit rule | Signed `signoff-sheet.csv`, blocker list | M18-S08 | Not started. Projected 4 to 9 Oct |
| E2 | Quick guides issued; 30-minute walkthrough held and attendance recorded | Guides dated; attendance list | M20-S03 | Guides written (`docs/launch/guides/`). Walkthrough not held |
| E3 | Support route live (`docs/launch/support-model.md`) and hypercare rota named (`docs/ops/hypercare.md`) | Names filled | M20-S04, M18-S10 | Names OPEN — owner |
| E4 | KPI targets set and brief signed | `docs/launch/product-brief.md` | M20-S01 | Targets OPEN — owner |
| E5 | Owner answers that change go-live scope are recorded (section 7) | Decision records | D113 | See section 7 |

No gate is waived by the loop finishing. A gate marked "Not done" is not done.

## 2. Go/no-go meeting

Attend: Sahil, the seat holders for every Must scenario, the owner.
Go needs:
- Every line in section 1 ticked with evidence, or named as a blocker with an owner and a date.
- No open P1. Every open P2 has a written workaround (`docs/uat/defect-intake.md`).
- Every Must UAT step passed by its real seat holder.

Record the decision, the time and the names in a dated file `docs/launch/go-no-go-<date>.md`.

## 3. Cutover (go-live day)

Hosting-dependent steps wait for AP4. Order follows M18-S09-T05 and D54.

1. Freeze changes. No merge to `main` that day except the release.
2. Confirm gate A1 to D5 once more on the day. Take a Zoho backup now (`backup-restore-plan.md`) so the pre-cutover state exists.
3. Confirm `ops/` exports under `zoho/` match the live org (no console-only change, CLAUDE.md).
4. Run the migrations (M18-S06, M18-S12) on production with the dry-run script. The run halts and writes nothing more if a payment fits no single allotment. Reconcile counts: 5 Leads, 4 Contacts, 2 Deals, and each investor's Receipts total against the old columns.
5. Deploy the release (the same commit that passed staging). The pipeline's production job needs the manual approval.
6. **Production smoke before any user is added.** Six cases: sign in, Today, open a lead, save a note on a test lead, search, sign out. Under 3 minutes. All must pass (TC-IM12-014, TC-E15-035). If one fails, go to section 4.
7. Enable seats role by role, in the order in `ops/SEAT-PLAN.md` and D54. After each team, run T11 again and smoke as a seat of that team. Only enabled seats can sign in.
8. Check the System page: counts, credits, licence expiry, Zoho Sign webhook, app push.
9. Tell the owner: go-live done, time, anything odd. Start hypercare (`docs/ops/hypercare.md`).

## 4. Rollback plan

**Trigger.** A failed smoke check at cutover, or a P1 in the first 48 hours (M18-S09). Sahil calls it. If Sahil is out, the named deputy calls it: **OPEN — owner** to name the deputy.

**Goal.** App access is withdrawn within 30 minutes. Staff carry on in Zoho. No data is lost.

### 4a. The console
- The console holds no records (D45). Nothing in it needs restoring. Pulling it loses no data.
- Rollback is the previous deploy. Redeploy the last good release from the host. How is **OPEN — owner** until hosting is chosen (AP4). Write the exact command or button in this section when it is.
- If a redeploy would be slower than 30 minutes, withdraw access first: take the app offline or put it behind a maintenance page at the host. Then fix.
- Keep the failing release's logs. Plane B and C day files are kept as they are (append-only).

### 4b. What staff do meanwhile
- Staff carry on in Zoho under their own profiles. Field-level security and Private sharing still hold there (D52).
- Rules that only the console enforces are not enforced in Zoho. D50 lists five. In a rollback, tell staff in writing to follow the rule by hand. The IR and Finance quick guides name their own rules.
- Money entered in Zoho by hand follows the Receipts module rules in Zoho. Finance records, and the weekly statement is still the check (`docs/runbooks/weekly-reconciliation.md`).
- Tell every seat holder at the same time: console is down, work in Zoho, who to call (`docs/launch/support-model.md`).

### 4c. Zoho changes
- Every Zoho change is an export committed under `zoho/` (CLAUDE.md). To roll one back, revert the export commit, then apply the previous configuration in Zoho and export it again in the same commit.
- Zoho API names are permanent. A field cannot be renamed, only hidden or unused (C-12). So rollback of a new field is: hide it, stop the code reading it. Do not delete a field that holds data.
- Whether Zoho can re-import an old export automatically is not verified. Treat a Zoho change as a manual re-apply.
- Never roll back by deleting records. Wrong money, paper or allotment is undone by the reversal events: `money.reversed`, `paper.blocked`, `allotment.reversed` (D19, `contracts/README.md`). Receipts are create-only.

### 4d. Data
- Data written between cutover and rollback is real. A deploy rollback does not remove it.
- A production data restore is the last step and needs the owner's approval (`backup-restore-plan.md` section 7).
- The legacy migration is not undone by a deploy. Its log (ids only) says what it wrote. A halt writes nothing further.

### 4e. Investor app contract version pinning
- Every event carries `schema_version`. It is 1 today (`console/src/server/contracts/events.ts`). An unknown version is dead-lettered, not guessed (`contracts/README.md`).
- Rule: do not change a contract version and ship the console and the app together. Release the receiver first, then the sender.
- A console rollback must go to a build that sends only versions the app accepts, and still accepts the version the app sends.
- Signing uses two live HMAC keys during a rotation. Do not rotate a key in the same window as a rollback.
- The investor app is not in this repo yet (MA1). Its release pinning: **OPEN — owner**.
- After a rollback, push events that failed are retried by the next send. Check System for "not delivered yet" (D73).

### 4f. After a rollback
1. Write what happened in `docs/ops/` as an incident line with date, trigger, time to withdraw, what staff did.
2. Open a defect (`docs/uat/defect-intake.md` shape). P1 stays open until the cause is fixed and retested.
3. Re-run staging green and trusted before the next attempt.

## 5. Rollback rehearsal (steps written; not rehearsed)

When: after hosting exists, on staging, before go-live. Rehearsal waits for AP4. Owner of the rehearsal: Sahil (M18-S09-T03). Write the outcome in `ops/drills/<date>-rollback.md`.

1. Start a stopwatch. Deploy a known good release to staging. Note its commit.
2. Deploy a second release that fails one smoke case on purpose (TC-IM12-018). Use a branch made for the drill. It must not touch Zoho.
3. Run the smoke suite. One case fails. Note the time.
4. Call rollback. Withdraw access (4a). Note the time access went.
5. Redeploy the first release. Run smoke. All six pass.
6. Staff step: a tester signs in to the sandbox Zoho as an IR and as Finance, and does one task there (add a note on a lead; record a receipt). Both work.
7. Stop the stopwatch. **Pass** means the previous state is back and access was withdrawn inside 30 minutes. Write both times.
8. Try a contract check: send one stub-receiver event after the rollback and confirm it is accepted once.
9. Write what was slow or unclear. Fix this page.

## 6. Open Zoho tasks for Sahil (from BLOCKED.md, 4 Oct)

Open task lines with Sahil as doer: M02-S01-T01 (renew, test seat), M02-S04-T02, T03, T04 (profiles, field-level security, sharing), M02-S06-T01 (no Convert), M02-S10-T02 (OAuth clients), M20-S08-T01 and T02 (Zoho Sign plan and secrets), M03-S05-T01 (seats), M03-S05-T02 (Digital Infrastructure profile), M03-S07-T01 (KAM sharing).
The full dated order, including the HUMAN notes, is in `autopilot/PEOPLE-CALENDAR.md` and in the HUMAN lines of `autopilot/console/BLOCKED.md`. Check them again on the day: this list is a copy of one moment.

## 7. Rulings that change go-live scope (D113, 4 Oct)

| Ruling | Effect here |
|---|---|
| Farm ops: not provisioned now, persona kept | No Farm ops seat at go-live. UAT-FARM is not run. See `docs/uat/scenarios/08-farm-ops.md` |
| 401 body stays as built | M18-S14 acceptance 1 now reads: "answers 401 with no session cookie and **no record data** in the body". The body is `{error, code, landing, session, signedOut}` |
| Receipt Finance records is matched, no second person | Several documents still say "second hand". See section 8 |
| `bu` seat is the business owner; roles are assigned by Sahil | Add or change seats through Sahil, later if needed |
| Compliance reads the Finance trail read-only; no separate Auditor profile | One profile for Compliance and Audit |
| Log store (D47) and hosting (AP4) | Still open |

## 8. Conflicts found while writing this page
- `docs/ACCESS-PLAN.md` and `ops/SEAT-PLAN.md` give Sahil the Administrator profile. D110 moves him to a non-admin Digital Infrastructure profile. Follow D110.
- UAT steps FIN-12, FIN-14, HOF-02 and gap 8 in `docs/uat/README.md`, and `docs/runbooks/weekly-reconciliation.md` and `ops/runbooks/money-mismatch.md`, still describe a second person matching a receipt. D113 item 1 says recording by Finance is the match. The tester must follow D113 or ask the owner before UAT.
- `TC-E15-034` is titled "only the three console seats" and then expects six names on the sign-in list. `GZ_SIGNIN_LIST` is unset in production, so production signs in with Zoho only. Settle what the production check reads.
