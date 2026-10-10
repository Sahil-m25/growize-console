# D139 — KAMs see rupees; the IR sees the state of their own claims, not receipt lines (10 Oct 2026)

**Status:** decided by the owner (Sahil) on 10 Oct 2026 (round 9); built on branch `d139-kam-money` (from `23222b7`). Not deployed. The Zoho side was
changed and recorded the same day (`zoho/changes/2026-10-10-sandbox.md`, bottom section); this session touched no Zoho org.

**Serves:** staging defect W2-KAM-1 (GC-1493); D138 open questions 1, 2 and 4. **Amends:** D69 / D123 (the KAM money mask), D138 (the KAM stays
without rupees). **Keeps:** D69 for the IR (no receipt lines), rule 2 / D53 (every human on their own token), rule 7 (no identity, no note text, no
reference in a log), rule 9 (one IST clock).

## The rulings (owner, 10 Oct)
1. **W2-KAM-1 — KAMs (and the Head of AM) DO see rupee amounts.** Mirrors D138's IR treatment for the account-management seats: rupee figures only
   from real Zoho values read on the KAM's own token — the allotment's `Unit_Price`, `Total_Amount_Receivable`, `Total_Amount_Received` (read-only for
   KAM and AM Head in the sandbox since 10 Oct) — field by field, empty where Zoho hides one, never the prototype unit price.
2. **IR receipts — the owner asked Jev; verdict: an IR does NOT need individual receipt lines** (p = 1.00, asked twice with the option order swapped, the
   same answer both times: "totals and claim states are enough"). Amount due, total received, the deadline and the state of the IR's OWN claims are
   enough. Receipt lines stay hidden from the IR (D69 stands). The Zoho read of Receipts stays on the IR profile because the IR claim flow needs it.
3. **IR read/write on allotment `Total_LLP_Units` and IR Manager read/write on `Unit_Price` — KEPT.** No change (they had been flagged as wider than
   intended in the 10 Oct sandbox note; the owner ruled to keep them). The "flagged for review" carry-forward line is dropped.

## Decision (as built)

### 1. W2-KAM-1 — the KAM's rupees are Zoho's, per field
- **`server/investors/record`**: for an account-management seat (`isAmSeat`: KAM, Head of AM) the record now reads the per-field money read
  `server/investors/ir-money` (`readIrMoney`, one COQL by allotment id on the seat's own token; a column Zoho refuses is dropped and the read repeats,
  Zoho naming none: each column probed alone; a failed read is null for everything). New on the answer: `holdings[].amounts`
  `{ unitPrice, value, receivable, received, due }` and `amounts` `{ value, received, due }` (totals over the live allotments; a total is null unless Zoho
  showed that field on every live allotment). `value` = committed units x the recorded `Unit_Price`. Null for every other seat. **`money` (the Money
  section: receipts, KYC, paid/due from the ledger) stays Finance's and stays null for a KAM** — the ruling is about rupee figures, not about Receipts.
- **`server/investors/allotments`** (`GET /api/investors/[id]/allotments` and `GET /api/farms/[id]/allotments`): a KAM's / Head of AM's rows now carry
  `unitPrice` / `amount` where Zoho shows `Unit_Price` to them (the API's KAM mask is gone). The list read itself stays on the no-money projection
  (`AM_ALLOTMENT_FIELDS`, `checkAmProjection`): the rupees come from the one per-field read, so a hidden field never fails the list.
- **UI** (`features/im/inv` "What they hold"): Units shows "n · holding value", plus **Received** and **Amount due** rows where Zoho showed them; a figure
  Zoho hides is simply absent. The demo book gives a KAM the allotments' recorded amount (fixture mode only). **Farms** already shows the LLP unit price
  (`Pet_Unit_Price`, readable) — now by design, no change.
- **Not done (kept small):** the KAM's investor *lists* (the AM book) show no per-row rupees — a per-row money read would be one extra Zoho call per list
  page and nothing asked for it; the record and the allotment rows carry the figures.
- **Tests re-labelled to expect rupees:** `W2K-INV-REC-NOMONEY`, `W2K-FARMS-NOMONEY` (harness, outside the repo — listed in the register row),
  `REG-W2KAM1` (`pm/plan-merged/ui-cases.json`), the fixture test in `lib/data/endpoints/invfarms.test.tsx`, the KAM record case in
  `server/investors/record.test.cjs` (plus a new hidden-field case), and `server/investors/d139.test.ts`.

### 2. The IR sees the state of their OWN claims (not receipt lines)
- **`server/leads/claim-lines`** (new): `readClaimLines` — the IR's own `Claimed` receipts only (Receipts sharing is Private: their token returns their own
  rows), selecting `Match_State`, `Amount`, `Received_On`, the `CLAIM-<lead>-<n>` key and the system `Modified_Time`; never the allotment, `Kind`,
  `Mode`, `Matched_By`, `Reversal_Of` or the bank UTR. A refused field repeats the read with the key, state and `Modified_Time` alone (the line then has no
  amount or date said, never a guess). Each line: `state` = **pending** (Claimed) / **matched** (Finance found it and recorded the receipt) / **rejected**
  (Finance did not find it, with the reason) / answered (a Note that cannot be read), `amount`, `claimedOn` (the day the investor said they paid),
  `answeredOn` (the IST day of the report's last write = when Finance answered). Matched vs rejected is told apart by the Note title, as `claim-answer.ts`
  already does (Receipts has no answer field). No reference is returned.
- **`GET /api/leads/[id]/claim`** (`createPaymentClaims.read`) now answers `claims` — all of the IR's reports on the lead, newest first — beside the
  existing latest-report fields (no new route; no contract-table change).
- **`GET /api/investors/mine`** — each *balance to chase* row carries `claims` for its lead (one extra read of the IR's own claims for the chased leads;
  a failed read shows none).
- **UI:** the lead's claim drawer shows "Your payment reports" (amount, state, the date the investor said they paid, the day Finance matched/answered, the
  reason when rejected); Today's "Balances to chase" shows each claim under the row ("You reported Rs 2,50,000 (paid 20 Sep) — matched by Finance on 22 Sep").
  The demo book keeps its own history blocks.
- **Unchanged:** `server/leads/gates` still reads no Receipts on an IR token (D69); the claim flow's own report/double-press reads are as they were.

## Open — needs the owner
1. **`Supplementary_Verified_At` for KAM** — the KAM's "ask Finance to confirm full payment" reads it; if the KAM profile hides it the request answers
   `fields-missing`. Proposed read-only for KAM (`zoho/changes/2026-10-10-d138-fields.md`, item A) — still to apply in Zoho.
2. **Matched date.** "When Finance matched it" is the claim's last write (Finance's answer writes `Match_State`). If Finance later edits the claim row
   for another reason the date moves; a dedicated answered-at field would make it exact (not proposed — the day is right for every normal flow).
