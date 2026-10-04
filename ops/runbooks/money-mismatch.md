# The ledger and the bank statement disagree

**23 Sep 2026 — still valid.** Nothing here depended on the mirror: receipts, matching, the reversal
and the two-hands rule all live in Zoho, and one org (D52) makes the reversal an ordinary same-org
write. One line changed — step 1's query pointed at a Supabase table; receipts are the Receipts module
in Zoho, read on your own seat (D53).

**You will see:** the MONEY canary after the weekly statement upload — a line in the statement with no
receipt, or a receipt with no line.

**What it means:** exactly one of four things. Work them in this order; the first two are almost always it.

1. **Timing.** The receipt was recorded on Friday and the statement covers to Thursday. Check dates before anything else.
2. **A typo in the amount or the UTR.** The commonest real defect. The receipt exists, the line exists, they do not match.
3. **A receipt recorded that never arrived** — someone was told money was sent and recorded it as received.
   This is the one that matters. The gate it opened must be closed with `money.reversed`.
4. **Money that arrived and was never recorded.** Record it. It is not a defect, it is a backlog.

**First, in order:**

1. `SELECT ... FROM Receipts WHERE state = 'unmatched'` over COQL — the same read as Finance's queue (`docs/im-portal-zoho-mapping.json`) — anything unmatched older than 48 hours is already a finding.
2. Match by amount ± 0, then by UTR, then by date window. Never by contact name.
3. For case 3: raise the reversal. Two hands, both named, step-up on the second. The app account may
   return to tentative and the shelf may release units — that is correct, and the investor sees it.

**Do not:** edit the amount on a recorded receipt to make it match the statement. The receipt is what
someone recorded; a correction is a new row plus a reversal, never an edit. An edited receipt destroys
the only evidence of what actually happened.

**Do not:** let the person who recorded a refund, or any money leaving, be the one who approves it. The
second hand there is the Head of Finance, Digital Infrastructure or the Corporate root (D22). An ordinary
receipt a Finance seat records is matched by that recording, automatically from the statement where
possible, else by the Finance person by hand (D113); no second person is needed.
