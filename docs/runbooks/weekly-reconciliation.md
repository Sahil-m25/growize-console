# Weekly bank statement reconciliation (M10-S05-T06)

The bank statement stands behind every receipt (CLAUDE.md, rule 9 note; D21, D71). Once a week Finance uploads it and the console lists, line by line, what matches a receipt and what has no owner yet. **The upload changes nothing by itself**: it never writes or matches a receipt.

## Who
| Seat | May |
|---|---|
| Finance Operations (Meena) and the Head of Finance (Harsha) | Upload the statement; record receipts; close lines |
| Head of Finance, or the super user | Press "Match it" on a pending receipt, never on one they recorded themselves (D21) |
| KAM, IR, Compliance, Auditor | No upload. The server refuses before reading the file (TC-IM05-026), and the Statements profile in Zoho is Finance-only |

The upload runs on the uploader's own Zoho token (rule 2). Nobody uploads for someone else.

## When
Weekly, for the week just ended. Upload one CSV from net banking, up to 2 MB, covering that week. The console names the Statements record after the ISO week of the last line's date (for example `2026-W39`). The weekday is Finance's to fix; nothing in the build decides it. A late upload is fine: the same rules apply to whatever dates the file holds.

## Steps
1. Download the week's account statement as CSV from net banking. PDF and Excel are refused; convert to CSV first.
2. Sign in to the console, open **Payments**, press **Upload the bank statement**, choose the file.
3. Read the result card: `lines · matched · awaiting the match · need an owner`.
4. Work the lists below. When a list is empty, the week is reconciled.
5. The Payments page now reads "Last reconciled <date>". The file is attached to the Statements record in Zoho, so the original stays with the evidence.

An upload that fails ("Not reconciled yet - Zoho is not answering") keeps nothing. Upload again. An attachment Zoho does not take removes its Statements record, so a half-stored upload does not exist.

## What each list means
**Matched.** The line agrees with a receipt on reference (UTR), amount to the paisa, direction, and a date within 3 days of the receipt's Received_On (India time).
- `matched`: the receipt is already matched. Nothing to do.
- `awaiting match`: a receipt exists, recorded by Finance, and the second hand has not pressed "Match it". The Head of Finance does that on Payments. The recorder cannot.

**Needs an owner.** The line has no clean receipt behind it. Every row names an owner and a reason, and debits are included (bank charges have no receipt).

| Reason | Owner | What closes it |
|---|---|---|
| no receipt records this credit | Finance Operations | Find the investor and allotment, then **Record a receipt** on it (recording is always allowed, D21). Re-upload, or leave it for next week |
| a debit with no refund receipt behind it | Head of Finance | If it is a refund, record the refund receipt. If it is a bank charge or another debit, the console has no action for it today: it stays on the list, and the Head of Finance notes in the week's hand-off that it is the bank's own entry |
| amount, date or kind differs from the receipt | Head of Finance | Check the receipt against the bank. A wrong receipt is reversed and re-recorded, never edited (receipts are create-only; a reversal needs the Head of Finance) |
| only an IR's report so far | Finance Operations | Answer the report on Today or Payments: "Confirm and record it" with the bank reference, or "Not there yet" with a reason |
| the receipt was answered "not found" | Head of Finance | The bank shows money the console said was absent: reopen with the IR and record the receipt |
| the receipt was reversed | Head of Finance | Money moved after a reversal: confirm what the bank shows is the reversal's counterpart, or record the right receipt |
| the same line appears twice | Head of Finance | Check whether the bank repeated a row or two payments share a reference |

A line is closed when it is matched against a receipt a second hand has matched. Bank charges and other debits with no receipt cannot be closed in the console; the Head of Finance accounts for them outside it. Nothing is closed by deleting anything: no receipt is deleted, and the statement file is kept.

## Check before you finish
- The count of `need an owner` is zero, or every remaining row is a bank debit the Head of Finance has accounted for, or has an owner who has been told.
- Every `awaiting match` receipt has been matched by the Head of Finance (or is waiting on her, today).
- Payments reads "Last reconciled" with this week's date.

## Limits
- Matching on UTR needs the reference in the narration; a statement whose narration omits it sends every line to "no receipt".
- Dates are read day first, amounts as whole paise, with no guessing. A row the parser cannot read refuses the whole file and names the row.
- A real-format statement reconciled by hand against 20 lines is the human proof TC-IM05-027 (BLOCKED, M10-S05-NOTE-4); the parser is tested on the HDFC-shaped and ICICI/SBI-shaped CSVs only.
- The Statements module in Zoho must exist (BLOCKED M10-S05-NOTE-1); until it does, the upload answers 503.
