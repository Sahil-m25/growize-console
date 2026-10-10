# D138 — IRs see real rupees; conversion waits for the signed supplementary; a KAM asks Finance (10 Oct 2026)

**Status:** decided by the owner (Sahil) on 10 Oct 2026; built on branch `d138-rulings` (from `5b0a262`). Not deployed. No Zoho org
touched by this session: the sandbox changes it relies on were made and recorded earlier the same day (`zoho/changes/2026-10-10-sandbox.md`);
what it still needs from Zoho is proposed in `zoho/changes/2026-10-10-d138-fields.md`.

**Serves:** staging defects B-10 (GC-1475), B-20 (GC-1485), B-22 (GC-1487); workflow gap G4; D137 open questions 1, 2, 3 and 6; the
D136 10 Oct field note. **Amends:** D69 (the IR side reads one money fact now: the allotment's own figures, on the IR's token),
D137 ruling 3 (the KAM no longer stamps "fully paid"; no stamp before the signed supplementary). **Keeps:** rule 1 (Zoho the only
store), rule 2 / D53 (every human on their own token), rule 3 (recording money is always allowed), rule 7 (no identity, no note text,
no full reference in a log), rule 9 (one IST clock), D44 (guarded writes), D122/D123 (Originating_IR's writers, field sharing).

## The rulings (owner, 10 Oct)
1. **B-10 — IRs DO see rupee amounts: they chase the balance.** No rupee figure may come from the prototype's unit price
   (`domain/plan.ts UNIT`). IR rupee figures come only from real Zoho values the IR's own token can read — the allotment's
   `Unit_Price`, `Total_Amount_Receivable`, `Total_Amount_Received` (read-only for IR / IR Manager in the sandbox since 10 Oct). If Zoho
   hides a field, show nothing rather than a guess. The IR's "Balances to chase" shows the amount due (receivable − received).
   **The KAM (W2-KAM-1) was NOT ruled:** KAM money stays hidden; still open.
2. **B-20 — by design.** Finance keeps seeing the receipt UTR in full on the investor record.
3. **B-22 — correct the test matrix, not the app.**
4. **G4 — the 30-day balance deadline starts when Finance matches the 10% / confirms the payment** (the code's current anchor), and
   every screen says which date it counts from: "Balance due 9 Nov — 30 days from Finance confirming the 10% on 10 Oct".
5. **D137 open question 2 — conversion waits for the signed supplementary agreement.** Until `Supplementary_Verified_At` is set the
   lead / allotment does not move forward (no full conversion, no fully-paid stamp, automatic or manual); meanwhile only "Log a
   contact" and notes.
6. **D137 open question 6 — a KAM can NOT mark an allotment fully paid.** The KAM asks Finance to confirm the full payment; Finance and
   Digital Infrastructure keep the manual stamp.
7. **D137 open question 3 — Originating_IR:** no code; the owner asked why it is needed (answered below).
8. **D136 note:** `Leads.NDA_Requested_By` and `LLP_UnitAllocation_Module.Unit_Cert_Verified_By` were deleted in the sandbox on 10 Oct.

## Decision (as built)

### 1. B-10 — the IR's rupees are Zoho's, per field
- **`server/investors/ir-money`** (new): one COQL on the allotments by id, on the IR's own token, selecting `Unit_Price`,
  `Total_Amount_Receivable`, `Total_Amount_Received` (+ `Hold_Extension_State` / `_Days` for G4). It degrades **per field** like
  app-activity (W6-IRA-1): a column Zoho refuses is dropped and the read repeats (Zoho naming none: each column is probed alone);
  a field dropped or absent is `null`. A failed read is `null` for everything. `due` = receivable − received (never below 0) only when
  Zoho showed both. Identity-checked at load; nothing cached; nothing logged.
- **`server/investors/ir-list`**: the chase rows (`GET /api/investors/mine`) carry `due` from that read, `dueReadable` = any shown, and
  `fromDay` / `extendedBy` (G4). A row Zoho says owes nothing (due 0) drops off. The list rows themselves still carry no money.
- **`server/investors/allotments` byContact**: for the IR (own-lead scope) the rows now carry `unitPrice` / `amount` where Zoho shows
  `Unit_Price` to the IR — the API stopped masking it. A KAM's rows stay without (W2-KAM-1 not ruled).
- **`features/today/BalanceChase`**: "₹X due" when Zoho showed it, nothing otherwise (the old "Finance holds the amount due" is gone),
  and the G4 sentence under each row.
- **The prototype unit price is gone from every rupee figure a live screen draws:** lead header and the Today focus card (units only),
  Leads list, Event leads table (Units column), capture form unit picker, call drawer, Finance's lead drawers ("received", no
  "of ₹…"), Payments register ("of" → units), Finance's reservation rows ("₹ in · n units"), Transfers (units only), lead-side Numbers
  (units with a balance outstanding; no "₹ of demand"), the claim block (the IR's reported amount, else "—"), and
  `server/numbers/sections` (forecast `money` is always `null`: a lead has no price in Zoho). On the investor side the record header,
  Money header, the 10% chip and "What they hold" use the record's `money.committed` (server: units × each live allotment's recorded
  `Unit_Price`) or, in the demo book, `lib/im committedOf` (the allotments' recorded amounts) — shown only where the Money section
  shows, so a KAM sees units and no rupees. The claim drawer's "Holding" is Finance's already-in + outstanding; the receipt drawer's
  10% / balance come from the allotments' recorded amounts.
- **What still multiplies by a UNIT, and why it stays:** the BU plan's targets (`lib/selectors/plan planMoney`, `people/reducer planCr` —
  the plan's own stated unit price, not a record's money), the demo book's fixtures and reducers (`lib/im` selectors / reducer / rules,
  `lib/data/endpoints/*` fixtures, `features/pay/reducer` — fixture mode only, never a live figure), and `lib/investor-copy`'s review
  flag (a check, not a figure). Guarded by `d138.test.ts` (no file under features/, server/ or components/ imports the lead UNIT for a
  figure, bar the two reducers).
- Not changed: the lead gate's money facts (`server/leads/gates`, D69: Receipts are still not read on an IR token there), though
  the sandbox now lets the IR read Receipts' UTR / Match_State / Kind / Amount / Mode / Received_On — unruled; see Open.

### 2. B-20 — works as intended
`docs/uat/STAGING-DEFECTS.md` B-20 "Ruled: by design"; `REG-B20` now expects the full reference for Finance on the investor record; the
harness case `W1-FIN-STEPUP-REVEAL-RO` and matrix CM-3363 are to expect the same (outside the repo; listed in the register row). No code
expected a mask for Finance on the record.

### 3. B-22 — the matrix corrected
`docs/uat/STAGING-DEFECTS.md` B-22 "Ruled: matrix corrected" and a new section "B-22 matrix corrections" (rows, old label, new label,
why). `pm/plan-merged/ui-cases.json`: `REG-B22` (IR Investors visible read-only, D113) plus `REG-B22-EV` (Events edit hidden for IR),
`REG-B22-ABS` (absence reason conditional — hidden live), `REG-B22-ACT` (no "All people" for a solo seat), `REG-B22-TEAMS` (Finance Ops
Teams read only, no seat edit). The harness matrix itself lives outside the repo (`report/matrix-corrections.csv`).

### 4. G4 — the deadline says what it counts from
- **`lib/money/balance-clock`** (new, client-safe): `BALANCE_DAYS` = 30 (pinned equal to `money/match HOLD_DAYS` and
  `investors/convert HOLD_DAYS` in `d138.test.ts`, and proved the inverse of both writers' `holdUntilFrom` / `holdFrom` across month and
  year ends); `balanceClock(Hold_Until, extension)` → `{ dueDay, fromDay, extendedBy }` on IST calendar days (rule 9: Hold_Until is
  already an IST date; arithmetic on UTC epoch, host time zone never moves a day); an **approved** extension moves the start back by its
  days and the sentence says "extended by N days"; requested / declined do not.
- Shown on: the IR's Balances to chase, the holds card (Finance's dashboard, "Holds running"), the investor record's hold banner (the
  Money / What they hold view), the lead page's reservation alert, and the "Investor created" result in Finance's convert drawer.
- The anchor is unchanged: conversion writes Hold_Until = Finance's confirmation + 30 (convert), and an older allotment's first matched
  Advance does the same (match). For an IR whose profile hides the extension fields the start assumes no approved extension (the
  extension flow is fail-closed today, `GZ_EXTEND_APPROVAL`).

### 5. Conversion waits for the signed supplementary (D137 Q2)
- **Server:** `server/investors/full-paid` reads `Supplementary_Verified_At` with the allotment. `auto` (after a Finance match, or at the
  end of a conversion that arrives fully paid) answers `waiting-supplementary` (code `supplementary-not-signed`) and writes nothing;
  `manual` refuses `supplementary-not-signed` **before** the Note — the route answers **409**. `server/leads/gates`: the balance gate is
  not met without the supplementary (so no "Fully paid", hence no "Allocated"), and the answer carries `heldFor: "supplementary"` with
  the text "Waiting for the signed supplementary agreement…". The journey's rung writes behind it were already refused (its GateReader
  never opens a money rung on the IR's token).
- **UI:** the lead page under `heldFor` shows the reason and offers only "Log a contact" (Call / WhatsApp open the same log) and notes —
  no milestone, no payment report, no forecast, no Email, no Undo. The investor record's allotment row shows "Waiting for the signed
  supplementary agreement…" in place of "Mark fully paid…" / "Ask Finance…" while `agreementSigned` is false; the convert drawer says
  "fully paid waits for the signed supplementary agreement" when the money already covers it.
- **Reconciled with D137:** recording money stays allowed (rule 3) everywhere. A receipt Finance records on the **lead** before any
  allotment exists is still matched at once and counts toward the 10% (D137 — there is no allotment, so nothing to sign yet); the
  supplementary goes on the allotment created at the 10%, and from then on matching an **allotment** receipt is gated on it
  (`money/match` `supplementary-not-verified`, unchanged) and so is the full conversion (above). What is gated is matching on the
  allotment and conversion; what is never gated is recording.

### 6. A KAM asks Finance (D137 Q6)
- **`server/investors/full-paid-request`** (new) + **`POST /api/investors/[id]/full-paid/request`** `{ allotmentId, note }` (contract-table
  row added; `pm/generated/api-matrix.json` regenerated): KAM seat only (fresh session); the KAM's note (10–500 chars) is written first as
  a Note on the Contact under the KAM's own name (who / when are Zoho's Created_By / Created_Time; the words never reach a log), then
  `Convert_Requested_At` = now (IST) on the allotment, guarded (If-Unmodified-Since); a failed write takes the Note back. A request already
  open answers `already`. Refused: not a KAM (403), another investor's allotment (403), not Reserved / no field yet (422), already
  converted / changed / **supplementary-not-signed** (409). The KAM's read selects no money name (account-management wall).
- **Finance's to-do** (`server/queues/queue.ts`, the G1 pattern): seats with "pay" get one row per allotment with `Convert_Requested_At`
  set, Reserved, not stamped — "Confirm the full payment — the KAM asked n days ago", oldest first, "Open the record"; it is gone once
  the allotment is stamped. A read Zoho refuses records `confirm-requests:<code>` (`fields-missing` until the field exists).
- **The manual stamp** (`/api/investors/[id]/full-paid`) is Finance Operations, Head of Finance and Digital Infrastructure only; the KAM
  seat was removed (Zoho now gives KAM read-only on Converted_*, so a KAM write would fail anyway). The record's allotment row offers a
  KAM "Ask Finance to confirm full payment…" (drawer `fullpaidask`) and Finance / DI "Mark fully paid…".
- Zoho: `LLP_UnitAllocation_Module.Convert_Requested_At` (DateTime, KAM read/write) is **proposed, not created** —
  `zoho/changes/2026-10-10-d138-fields.md` item A (with KAM read on `Supplementary_Verified_At`).

### 7. Why Originating_IR is needed (D137 Q3 — the owner's question)
An IR's view of the investors they brought in is scoped by **Zoho field sharing on `Contacts.Originating_IR`** (D122/D123): Zoho shares
the Contact read-only with the user named there, `gz_sync_ir_access` copies it onto the allotments' `IR_Access` (so the IR can read the
allotment — and now its rupee figures), and every IR read in the console filters on it (the Investors list, Balances to chase, App
activity). **Finance cannot write `Originating_IR`** (D122 keeps its writers to the admin and a workflow), and since D137 it is Finance's
token that creates the investor Contact at the 10%. So without a Zoho workflow that copies the origin lead's Owner into it on Contact
create, **every investor Finance creates is invisible to the IR who brought them in** — absent from their Investors list, their chase
list and app activity, and its allotment never shared to them. Proposed: function `gz_set_originating_ir` (draft at
`zoho/deluge/gz_set_originating_ir.deluge`, in the style of `gz_sync_ir_access`: fills an EMPTY Originating_IR from `Origin_Lead.Owner`,
never overwrites, ids-only log) on a workflow rule "GZ Set Originating IR" (Contacts, on create and when Origin_Lead changes); its
update fires "GZ IR Access Sync", so IR_Access follows. Plus a one-off backfill. The console keeps trying to write it on Finance's token
and reports "filled by Zoho's workflow" when refused (D137, unchanged).

### 8. The deleted fields
`Leads.NDA_Requested_By` and `LLP_UnitAllocation_Module.Unit_Cert_Verified_By` are referenced by no code, fixture or JSON (one comment in
`server/leads/paperwork.ts` records the drop); `d138.test.ts` fails if either name comes back outside a comment. The queue's G1 comment
now names the real fields.

## Open — needs the owner
1. **W2-KAM-1 (the KAM's rupees)** — not ruled. Built: the KAM sees no rupee on the record (the UNIT figure is gone and Money is not a
   KAM section); **Farms still shows the LLP's unit price to a KAM** (the farm API does not mask `Pet_Unit_Price`). Hide it for AM seats,
   or let the KAM see prices?
2. **The IR and Receipts.** The sandbox made Receipts' UTR, Match_State, Kind, Amount, Mode and Received_On read-only for IR / IR Manager
   on 10 Oct. D69 still keeps the console from reading Receipts on an IR token (the lead gate, the claim flow). Was that change meant for
   the IR to see receipt lines (and the masked trail), or only to make the allotment totals consistent? Until ruled, nothing reads them.
3. **Supplementary_Verified_At for KAM.** The KAM's request reads it (refused before the signed supplementary). If the KAM profile hides it,
   the request answers `fields-missing`; make it read-only for KAM (proposed, item A).
4. **IR Manager rights flagged on 10 Oct** — IR read/write on allotment `Total_LLP_Units`, IR Manager read/write on `Unit_Price` look wider
   than intended (sandbox note); not touched here.

**Amendment, 11 Oct 2026 (B-25, settled by Jev under the standing rule).** Ruling 7 said there would be no code for Originating_IR. W7-FIN-2 later added the Digital Infrastructure stopgap button. Question put to Jev: keep the button or remove it? Asked twice, swapping the option order the second time, using jev/questions/decide.mjs with the cache off.
- Run 1: keep 0.98, remove 0.02
- Run 2: keep 0.97, remove 0.03

Outcome: the button stays as a stopgap until the `gz_set_originating_ir` workflow is live in Zoho, and is removed after that.
