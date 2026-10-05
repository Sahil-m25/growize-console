# D123 — Cover windows, the roster absence and the IR hand-off run on Zoho field sharing (5 Oct 2026)

**Status:** decided and built in the console; the Zoho side is NOT YET APPLIED in production and only partly in the sandbox (see "What the owner applies"). Jev was stable under both option orderings and an independent reviewer agent checked the findings.

## Zoho facts (verified live)
A user-lookup field with sharing on shares the record with the user named in it; clearing or changing the value revokes; the profile still caps what that user can do. Rulings: Leads.Cover_By sharing read-write; Contacts.Originating_IR read-only (D122 ruling 2); Leads.Secondary_Owner sharing OFF (applied in the sandbox).

## Q1 — IR cover windows: no share API calls
Writing Cover_By/Cover_Until opens a window; clearing closes it. Zoho field sharing does the access.
- Removed: `deps.share`, `shareOk`, the `shared` flag on the response and on `/api/leads/[id]/cover`, `lib/zoho/cover-window-share.ts`, and the "cover-window-share" service job.
- The expiry sweep (`sweepExpiredCovers`) is clear-only (If-Unmodified-Since). It still needs a service token, so its job is renamed **"cover-expiry"** and its env var is **ZOHO_COVER_EXPIRY_REFRESH_TOKEN** (was ZOHO_COVER_WINDOW_SHARE_REFRESH_TOKEN).
- Jev: 0.99 under both option orderings.

## Q3 — Dormant secondary (D44) enforced by Zoho
Secondary_Owner sharing is off, so a secondary reaches a lead only through Cover_By. The reviewer found the gap: the roster "owner absent" path admitted a secondary in the console but Zoho would show them nothing.
- New `cover.absent(principal, personId, backOn)`: on the acting human's own token (rule 2), reads the absent owner's open leads with no Cover_By and a Secondary_Owner, and writes Cover_By = that secondary and Cover_Until with If-Unmodified-Since, one Plane C line each (`cover-open-absence`). Same write helper as `start()`.
- Wired in `POST /api/availability` (response gains `covers: { opened, pending }`). The existing `returned` flow clears them when the owner is marked back.
- Cover_Until = **the day before the roster's first day back** (same rule as `start()` with "until they are back"). An absence always has an end date in the roster (D49 requires one), so no default is needed.
- Only an absence that has started (from <= today) opens covers. A planned future absence opens nothing until someone re-saves it; there is no human token at midnight to write on (carry-forward).
- Leads that already carry an explicit window, have no secondary, or whose secondary is also away are left alone. One page (200 leads); more is logged and reported as pending.
- The console guard (`activeFor`, roster branch) stays as the second layer.
- Jev: 0.85 / 0.93.

## Q2 — IR hand-off
- `server/investors/handoff-share.ts` and the "handoff-share" service job are retired (it had no caller). Zoho grants the IR read-only access to allotments through a new IR_Access field.
- **Receipts: IRs never read receipts (D69 ir-guard).** Nothing replaces the receipt share.
- `ir-guard.ts` header now says access comes from Zoho field sharing (Contacts.Originating_IR; allotments.IR_Access) and the guard still re-checks every row.
- Spec (`zoho/access/spec.json`): IR gets View on LLP_UnitAllocation_Module; money fields stay hidden (group allotment_money); Unit_Price and Annual_Rental_Yield are hidden from IR only (new group allotment_price_ir), so KAM, AM Head, Leadership and others keep seeing them.
- Deluge: `gz_kam_on_allotment` also sets IR_Access from the customer's Originating_IR (one read, one update, only non-empty values); new `gz_sync_ir_access` (contact -> its allotments, writes only differences); `gz_kam_access_check` also compares allotment IR_Access with Originating_IR (sendmail still `from :zoho.loginuserid`). All three marked NOT YET APPLIED.
- Jev: 0.92 / 0.96.

## Reviewer findings
1. **Secondary-owner gap** (Q3 above): the console admitted a secondary on owner absence, Zoho would not.
2. **IR profile had no allotment permission**, so the old hand-off share gave an IR nothing on allotments. Fixed by View on allotments (money hidden).
3. **Drop receipts** from the IR hand-off.
4. **Rule 1:** IR_Access is a derived copy of Contacts.Originating_IR, exactly as KAM_Access is of Contacts.KAM. Originating_IR stays the one writer; IR_Access is read-only for every profile except Administrator and is written only by the workflow function.
5. **Backfill needed:** existing allotments need IR_Access filled once (run the sync function per contact, or a one-off over all contacts) before the nightly check will read clean.

## What the owner applies in Zoho (not in the spec, which has no field-sharing or field-creation support)
1. Leads.Secondary_Owner: field sharing OFF (done in sandbox; do in live).
2. Leads.Cover_By: sharing read-write. Contacts.Originating_IR: sharing read-only.
3. Create LLP_UnitAllocation_Module.IR_Access (userlookup; create it first, then PATCH sharing_properties to read-only); read-only for every profile except Administrator.
4. Apply `zoho/access` for the IR View on allotments and the IR-only hiding of Unit_Price and Annual_Rental_Yield (re-run plan/apply).
5. Deploy `gz_sync_ir_access`; create workflow "GZ IR Access Sync" (Contacts, on edit when Originating_IR is modified, repeat on); update `gz_kam_on_allotment` and `gz_kam_access_check`.
6. Backfill IR_Access on existing allotments.
7. Set ZOHO_COVER_EXPIRY_REFRESH_TOKEN (replaces the cover-window-share grant); remove ZOHO_COVER_WINDOW_SHARE_REFRESH_TOKEN.

## See D123 notes (tracker files not edited here)
- **D74** (record share at hand-off) is superseded for allotments by IR_Access and for the Contact by Originating_IR sharing; receipts are no longer shared. The guard layer of D74 stands.
- **D44** (dormant secondary): now enforced by Zoho as well as the console, through Cover_By written at absence.
- Stale text to reconcile later: docs/ops/runbook.md, ops/runbooks/heartbeat-silent.md and api-budget.md ("cover-window unshare"), catalyst/README.md (env var name), ops/tracker/canvas.md M03-S09-NOTE-2 and M08-S05-NOTE-2.

## Applied in the sandbox (5 Oct, evening)
- Owner: Compliance Contacts rule back to Read Only; guard validation rule off; IR_Access created; IR profile View on allotments.
- **IR_Access is a multi-user field.** Zoho allows at most 5 single-user lookups per module and allotments already had 5. Facts verified live:
  - Deluge `updateRecord` silently ignores multi-user values; writing goes through the field's link table (sandbox: `LLP_UnitA_X_Users`, allotment lookup `userlookup221_4`; live names differ — read `IR_Access.multiuserlookup.linking_details`).
  - List and search reads return IR_Access empty; only a single-record read shows it. The sync, backfill and nightly check read the link table instead.
  - Deluge cannot delete link rows: a changed Originating_IR leaves the old IR until an admin removes it; the sync and nightly check report it.
- Claude tightened IR_Access after creation: record access Read Only (was Read Write); field read-only for every profile except Administrator (6 profiles were read-write). Unit_Price and Annual_Rental_Yield hidden from IR.
- Owner pasted gz_kam_on_allotment, gz_sync_ir_access and ran gz_backfill_ir_access (added 16, already 3). Workflow "GZ IR Access Sync" (Contacts, Originating_IR changed) created by Claude.
- Result: 19/19 allotments carry the right IR and KAM, no duplicate links (API check); nightly check: 80 records, 0 mismatches.
- The safety check blocked Claude from creating the field, granting IR View, and deploying code that grants access; the owner did those.
