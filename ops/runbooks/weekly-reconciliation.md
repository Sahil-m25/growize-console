# Weekly money reconciliation (T06)

**4 Oct 2026.** Written for M10-S05-T06 under D21, D22 and D113. The screen-by-screen detail (every "needs an owner" reason and its owner) is in [docs/runbooks/weekly-reconciliation.md](../../docs/runbooks/weekly-reconciliation.md); this page is the routine and the escalation. Nothing here asks you to decide a rule: the rules are below, decided.

**Who:** Finance Operations runs it. The Head of Finance checks it (reads the result, works the lines marked for the Head, signs the hand-off). Nobody else uploads: the server refuses a KAM, IR, Compliance or Auditor seat before it reads the file (TC-IM05-026).

**When:** weekly, **Monday, India time (Asia/Kolkata)**, for the week that ended Sunday. A late upload is fine; the same rules apply to whatever dates the file holds.

**You will see:** the Payments page saying "Last reconciled <date>" older than 7 days, or the MONEY canary after an upload.

**The rules in force:**

1. Recording money is always allowed; matching is what the rules gate (D21).
2. The bank statement stands behind every receipt. The upload matches lines to receipts on UTR, amount to the paisa, direction and a date within 3 days; it never writes or matches a receipt by itself (D113: statement auto-match).
3. A receipt a Finance seat recorded is matched by that recording; where the statement did not confirm it, the recorder may match it by hand. No second person (D113).
4. A receipt anyone else reported (IR, claim) waits for Finance to match it, never by the person who recorded it.
5. A refund, or any money leaving, needs a second hand: the Head of Finance, Digital Infrastructure or the Corporate root, never the person who recorded it (D22).

**First, in order (Finance Operations):**

1. Download the week's statement as CSV from net banking (PDF and Excel are refused). Up to 2 MB, one week.
2. Console, **Payments**, **Upload the bank statement**, choose the file. Read the card: lines, matched, awaiting match, need an owner.
3. Work **awaiting match** on Payments: confirm each receipt you recorded against its line. A refund waits for the Head of Finance.
4. Work **needs an owner**: record the receipt for money that arrived and was never recorded (a backlog, not a defect); answer an IR's report ("Confirm and record it" with the bank reference, or "Not there yet" with a reason).
5. Hand the rest to the Head of Finance by name, in the week's hand-off.

**Check (Head of Finance), before you sign:** every list is empty, or each remaining row is a bank charge or debit you have accounted for outside the console, or has a named owner who has been told. Refunds pending the second hand are with you. Payments reads this week's date.

**If it does not match:** follow [money-mismatch.md](money-mismatch.md). Check timing first (a Friday receipt against a Thursday statement), then a typo in amount or UTR, then money recorded that never arrived (reverse it: two hands, both named, step-up on the second), then money that arrived unrecorded (record it). Never edit a recorded receipt to fit the statement: a correction is a new receipt plus a reversal. Anything unmatched older than 48 hours is already a finding: tell the Head of Finance the same day, not at the next Monday.

**If the upload fails:** "Not reconciled yet, Zoho is not answering" keeps nothing; upload again. A 503 on /api/statements means the Statements module is not created yet (BLOCKED M10-S05-NOTE-1): stop and tell Digital Infrastructure.

**Where it is logged:** the file is attached to a record in the Statements module in Zoho, named for the ISO week (for example `2026-W41`), with lines, lines matched and lines needing an owner. Each receipt match and reversal is a Zoho write on the person's own seat, so Zoho's audit trail names who did it. The Head of Finance's hand-off note carries the week's open items. No identity field (bank account, PAN) goes in the note.

**Do not:** let the person who recorded a refund approve it; delete a receipt or a statement; match by contact name.
