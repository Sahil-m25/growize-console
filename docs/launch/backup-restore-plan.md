# Backup and restore plan (M18-S05)

Written 4 Oct 2026. Status: plan only. Nothing here is scheduled or proven yet. The drill waits for hosting (AP4, open) and the Zoho sandbox.

Items marked **OPEN — owner** are not decided. This plan does not choose for the owner.

## 1. What holds data

| What | Where it lives | Backed up by | Source |
|---|---|---|---|
| Leads, investors, allotments, receipts, touches, cases, payouts, events, plans, updates, templates | Zoho CRM (one Enterprise org). Zoho is the only store of records. | Zoho's backup plus our scheduled export (section 2) | D45, D52 |
| Who changed which field (record audit, Plane A) | Zoho. Entries are deleted after 3 years. | Our archive of the org audit export (section 3) | D47 |
| The console's own operational log (Plane B) and identity and authority log (Plane C) | Ours. Store is OPEN (section 4). | Depends on the store chosen | D47 |
| Zoho setup (fields, modules, profiles, roles, workflows, validation rules) | Zoho, and exported files under `zoho/` | Git. Every Zoho change is an export committed under `zoho/`. | CLAUDE.md, `zoho/README.md` |
| Code, contracts, runbooks, decisions | Git | Git remote | CLAUDE.md |
| Secrets | Host secret store and GitHub Environments | Not backed up as files. A lost secret is rotated, not restored. | `ops/env/README.md` |
| Investor sign-in accounts (Supabase) | The investor app's Supabase project | Not covered here. OPEN — owner (MA1: the app codebase is not in this repo yet). | D6, D79, D110 |

No other database of ours holds records. Do not build one to make a backup easier (D45).

## 2. Zoho records

### What is backed up
- The whole org, every module, by Zoho's own data backup. The story names it "Data backup (Enterprise)".
- Modules the console depends on are listed in `docs/zoho-module-register.md`: Leads, Contacts, LLP_Creation_Module, LLP_UnitAllocation_Module, Receipts, Touches, Investor_Updates, Mail_Templates, Investor_Payouts, Sales_Plans, Lead_Events, plus Cases, Tasks, Calls, and Statements once it exists (M10-S05-NOTE-1). Legacy Deals and Accounts ride along.
- A backup file holds identity data (PAN, bank, the full Aadhaar number until it is removed). Treat every backup file as the most sensitive file we own.

### Schedule and retention
- Cadence: weekly (M18-S05 acceptance 1). A backup file must exist in private storage after each week.
- Retention: 8 weeks. Delete older files.
- The exact Zoho screen, the file format and how long Zoho keeps the download link are **not verified in this repo**. Sahil records them in `ops/drills/` when he enables the backup (M18-S05-T01).
- Whether Zoho's backup includes attachments is not verified (Q19 is still an assumption). Until confirmed: attachments are not assumed restorable from this backup. OPEN — owner (Sahil to confirm in the first drill).

### Where the file goes
- "Private storage" means a store that no IR, Finance, KAM or other console seat can open (M18-S05 acceptance 3).
- D14 names AWS S3 with Object Lock in a separate AWS account as the backup target and the exit. `ops/backup/README.md` says the same. Hosting is not chosen (AP4), so no storage account exists yet to confirm this. OPEN — owner (AP4).
- If Object Lock is used, note the same trap as C-07: a locked file cannot be erased until its retention ends. For an 8-week retention that is bounded. It still matters for the full Aadhaar number, which is to be removed with compliance advice (D54). Decide the lock mode with that in mind. OPEN — owner.
- Who may open the files: Sahil (Digital Infrastructure). Anyone else: OPEN — owner.

### Scheduled export (our copy)
- Zoho Bulk Read per module, written to the same private storage, is the second path named in D14, Q19 and `ops/backup/README.md` (there: nightly).
- Cadence conflict: those documents say nightly Bulk Read; M18-S05 says weekly. This plan follows the story (weekly) and lists the conflict. OPEN — owner to choose weekly or nightly.
- Exports run on a service profile with identity fields hidden unless the owner decides the export must carry them. A restore from a file without identity fields cannot refill PAN or bank. Say which in the first drill. OPEN — owner.
- A failed run must call the existing `backup-failed` alert so Sahil hears within minutes (`console/src/server/ops/alerts.ts`). No backup job exists in code yet; whoever writes it wires this.

### Zoho setup
- Fields, modules, profiles, roles and rules are in git under `zoho/` (D5, `zoho/README.md`). Check that the export is current before each deploy and at each hypercare week end.

## 3. The org audit log (Plane A archive)
- Zoho deletes audit entries at 3 years (D47). Our archive is what outlives it.
- The job runs an unfiltered export and filters afterwards (a filtered export reaches back only 180 days). It is skippable: the next run catches up (D47, `ops/runbooks/heartbeat-silent.md`).
- Retention of the archive: OPEN — owner. D47 calls the archive "outside the ban" on copies (closed in D50).
- Where the job is scheduled is not settled (`heartbeat-silent.md`).

## 4. Planes B and C: two candidate stores

The store is still open (D47, AP4; D113 item 4: "open, the owner asked for the options"). Both options are below. **The choice is the owner's.**

What a log line holds: record ids, status codes, actor, route, reason codes. Never a body, name, PAN, bank number or note (D47, D52, M18-S02). Lines are capped at 4 KiB.

| | Option 1: JSONL files under `LOG_DIR` (as built) | Option 2: a managed store |
|---|---|---|
| What it is | Append-only daily files, one per plane per UTC day: `<plane>-<YYYY-MM-DD>.jsonl`. `LOG_STORE=jsonl`. Written with O_APPEND, never truncated or deleted. | A hosted table or object store the console writes to directly. Two shapes are named in the record: a Postgres table, or S3 Object Lock written directly (M01-S04-NOTE-1, C-07). |
| Status | Built. Chosen by Jev (0.93) as PROVISIONAL in M01-S04-NOTE-1. Sahil to confirm. | Not built. |
| Needs | A persistent volume on the host. With `LOG_STORE=memory` logs are lost on restart. | A provider account, credentials, and a migration (D47: once chosen, changes are migrations). |
| Backup | Copy finished day files to a locked archive bucket after the day has been scanned. When to ship them is open (M01-S04-NOTE-1). | The provider's own backup or point-in-time restore. Not verified for any provider. |
| Erasure after a leak | Possible while the file is on our volume. After shipping to a locked bucket, no (C-07). So scan before shipping. | Table: rows can be deleted. Object Lock written directly: lines cannot be removed until retention ends (C-07). |
| Retention | Ours to set. OPEN — owner. | Provider's and ours. OPEN — owner. |
| Risk | One host holds the logs until they are shipped. A lost volume loses unshipped days. Several instances need a shared volume. | A new moving part before the hosting decision. A second place a leaked identity value could land. |
| Fits "no database of ours holds records" (D45) | Yes. Logs hold no records. | Yes by D47's reading, but it adds a database. |

Whichever is chosen, set retention, name who may read the store, and record the choice as a decision.

**Choice: OPEN — owner.** Until it is made, Plane B and C day files are the only logs, and a lost volume is a lost day.

Contradiction to settle with the choice: `ops/env/README.md` says production `LOG_DIR` is "Object Lock bucket mount (AP4)". C-07 and M18-S05-T01 say no Object Lock on Plane B. Do not mount a locked bucket as `LOG_DIR`.

## 5. Who does what

| Task | Who | Source |
|---|---|---|
| Enable Zoho's backup, copy to private storage, set retention | Sahil | M18-S05-T01 |
| Check weekly that a new file exists (proposed: Monday, with the sign-in history check) | Sahil | proposed |
| Run the restore drill | Sahil | M18-S05-T02 |
| Check counts for money modules in the drill | Head of Finance (Harsha) with Sahil (proposed) | proposed |
| Verify drill evidence and that an IR seat cannot reach backup files | Autopilot (Jev) | M18-S05-T03, TC-E15-025, TC-E15-026 |
| Approve any restore into production | Owner. OPEN — owner to name the person. | proposed |

## 6. Restore drill (steps written; not yet run)

When: after hosting (AP4) and the sandbox exist; then quarterly (`ops/drills/README.md`). Write the outcome to `ops/drills/<date>-restore.md`. A drill with no written outcome did not happen.

Use the sandbox only. Never restore into production for a drill.

1. Pick the latest backup file. Write its name, date and size in the outcome file. Do not copy it anywhere but the working folder you control.
2. Write down the production record counts at backup time for Leads, Contacts and LLP_UnitAllocation_Module. Use COQL `COUNT` per module on production, taken on the backup day, or the counts in the file's own manifest if it has one. Add Receipts, Touches and Cases.
3. Check the sandbox is a sandbox: its org id equals `ZOHO_SANDBOX_ORG_ID` (`zoho/sandbox/README.md`).
4. Note that `zoho/sandbox/reset.mjs` deletes only records with `Test_Seed = true`. Restored records have no such flag. Either run the drill on a sandbox you will re-seed afterwards, or set `Test_Seed = true` on what you load.
5. Load Leads, Contacts and allotments from the file into the sandbox. Keep the load order: Contacts and LLPs before allotments, allotments before Receipts.
6. Compare counts, module by module, with step 2. Match means the same number. Write any gap with the module name.
7. Spot check 5 records per module by id: owner, stage, amount, dates agree with the file.
8. Check lookups: allotment to Contact and LLP; Receipt to allotment; Lead `investor_contact_id` to its Contact; Contact `Origin_Lead` to its Lead. Write whether Zoho kept the original record ids on load. This is not known yet and decides how a real restore is done. OPEN — owner (Sahil records the answer in the first drill).
9. Check that identity fields are as the export design says (section 2): present and hidden by field-level security, or absent.
10. Sign in to the console on staging as an IR seat. Try to reach the backup files by any route. It must be refused (TC-E15-026).
11. Write the result: pass or fail per module, time taken, what was learned, who ran it.
12. Delete the restored sandbox records or re-seed (`node zoho/sandbox/reset.mjs`).

Time taken is part of the result. There is no stated target. OPEN — owner (the recovery time the business can accept).

A Plane B or C restore drill (once the store is chosen): copy back one day file (Option 1) or restore one day (Option 2), then open the Logs page and read that day. Write the outcome in the same folder.

## 7. Limits to remember
- A restore into production changes real money records. It needs the owner's approval, Finance's count check, and a pause on writes (rollback steps in `docs/launch/go-live-checklist.md` section 4 apply for staff access).
- Zoho keeps a record audit for 3 years. A restore writes new audit entries; it does not rewrite the old ones.
- The console keeps nothing to restore: its cache is rebuilt from Zoho (D45).

## 8. Open items

| # | Item | Owner |
|---|---|---|
| 1 | Backup storage (D14 names S3 Object Lock; hosting AP4 open) | owner |
| 2 | Weekly (story) or nightly (D14, Q19) export cadence | owner |
| 3 | Planes B/C store: Option 1 or Option 2 (D47) | owner |
| 4 | Planes B/C retention, and when day files ship to an archive | owner |
| 5 | Audit archive retention | owner |
| 6 | Whether exports carry identity fields | owner |
| 7 | Whether Zoho's backup holds attachments (Q19) | Sahil to confirm |
| 8 | Who besides Sahil may open backup files | owner |
| 9 | Who approves a production restore | owner |
| 10 | Acceptable recovery time | owner |
| 11 | Investor app Supabase backup (MA1) | owner |
