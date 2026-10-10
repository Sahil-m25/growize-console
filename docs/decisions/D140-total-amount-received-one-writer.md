# D140 — The allotment's Total_Amount_Received has one writer: Finance's match path (10 Oct 2026)

**Status:** built on branch `w8-fixes` (from `23a8fa1`) to fix staging defect W8-IRA-1 (S2). Not deployed. No Zoho schema change;
the existing sandbox allotments need the one-off backfill below (a data fix, run by the sandbox admin).

**Serves:** W8-IRA-1. **Keeps:** rule 1 (one fact, one writer; Zoho the only store), rule 2 / D53 (Finance writes on Finance's own
token), D44 (guarded writes), D69 / D139 (the IR reads no receipt lines), D138 / D139 (the IR's and KAM's amount due is
`Total_Amount_Receivable − Total_Amount_Received` as Zoho returns them on their own token).

## What was found
`server/investors/ir-money` computes the IR's (and, since D139, the KAM's) amount due from the allotment's `Total_Amount_Receivable`
and `Total_Amount_Received`. **Nothing wrote `Total_Amount_Received`** — no console path, no Zoho workflow known to the repo (in the
live org's field metadata, read 10 Oct, both totals are plain editable currency fields, not formulas or roll-ups; the sandbox was
copied from it and was not read). Every allotment therefore read 0: Joseph Mathew's chase row said ₹1 Cr due while
Finance, summing his matched receipts, said ₹90 L (₹10 L advance matched). Verified read-only on staging 77a679d: IR A
`GET /api/investors/mine` → `due: 10000000`; Finance's allotment read → Partial with ₹10 L matched.

## Decision
1. **One writer.** `server/money/received-total.ts` `syncReceived` is the only code that writes `Total_Amount_Received`. Value =
   matched inbound receipts on the allotment (Advance / Part / Balance / Full) − matched refunds, never below 0 — the same arithmetic
   as the 10% trail and the full conversion (`lib/money/ten-percent`). It reads the receipts (one page; a page cut short writes
   nothing), reads the allotment's value and `Modified_Time`, and only when they differ makes ONE guarded PUT (If-Unmodified-Since);
   a conflict re-reads and tries once more. Reported, never thrown; logs carry ids and a code only.
2. **Called on Finance's own token** after every change to what is matched on an allotment: `money/match` consequences (every match:
   inbound, a refund's second hand, a repeated press — idempotent; after the hold write, before the conversion) and
   `investors/convert` (after the lead's receipts are linked to the allotment — the 10% press and the lead-route balance). The console
   has no unmatch path; a future one calls the same function. `received-total.test.ts` fails if any other server file writes the field.
3. **Backfill** for existing allotments: `zoho/sandbox/backfill-received.mjs` (browser IIFE over `window.__z`, refuses unless the org
   zgid is 60090668120; `plan()` is a dry run; `apply(plan)` re-reads each row's `Modified_Time` and skips one that moved).
4. **IR investor record, Unit_Price 0** (same report): `GET /api/investors/[id]` for a seat without money returned `Unit_Price: 0`,
   `Ticket_Snapshot: 0` — the adapter's "no money" placeholder, not a Zoho value. It now answers `null` for both and for the yield
   (`live.ts withoutMoney`). The IR's rupees still come only from Zoho per field (`/api/investors/[id]/allotments` already carried the
   real `Unit_Price`); the record header stays units-only for the IR, as D138 ruled.

## Why not a Zoho Rollup Summary field
A Rollup Summary on the allotment (SUM of `Receipts.Amount` where `Match_State = Matched` and Kind inbound, minus refunds) would be
cleaner — Zoho would keep it with no console writer and no backfill. Two catches: a roll-up cannot subtract refunds in one field
(it needs two roll-ups and a formula), and it is computed on Zoho's schedule, not at the match. If Digital Infrastructure adds it,
`ir-money` reads the formula field and `received-total` is deleted — the console path ships now so the IR is right today.

## Open
- **`Total_Amount_Receivable` has no writer either.** `investors/convert` creates an allotment with `Unit_Price` and units but no
  receivable, so for a newly converted investor the IR's due is empty ("no amount") until someone sets it; the seeded ones carry a
  value. D75 left open whether it is the total ever due or the balance still due, and the code reads it both ways (`ir-money`: total;
  `farms/occupancy` "paid" = receivable 0). Owner to rule; then either the convert path writes it (units × Unit_Price) or a Zoho
  formula does.
