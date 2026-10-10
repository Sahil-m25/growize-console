# ponytail-review — rounds 8-9 (10 Oct 2026)

**Change reviewed:** `git diff d5fd738..b2df5c8 -- console/src` — D137 follow-ups, D138, D139, D140 + B-24, the W6/W7/W8 staging fixes
(88 files, +2,549 / −253). Callers read, not only the diff: `money/match` consequences, `investors/convert`, `full-paid`, `ir-list`,
`record`, `allotments`, `leads/gates`, `leads/claim`, `queues/queue`, `farms/occupancy`, the routes and the screens that draw the figures.
**Load assumed:** ~15 staff seats, ~200 investors, a handful of Finance users matching at the same time; Zoho 15 concurrent calls per org,
COQL sub-concurrency 10. **Skill:** `.claude/skills/ponytail-review/SKILL.md`. Branch `lean-review`.

## What this change does

It makes every rupee an IR or a KAM sees come from Zoho's own allotment fields on their own sign-in (`investors/ir-money`), and stops
every live screen multiplying units by the prototype's unit price. It adds the rules the owner gave on 10 Oct: no full conversion before
the signed supplementary, a KAM asks Finance instead of stamping, the 30-day balance clock says which day it counts from, and the IR sees
the state of their own payment reports. It also gives the allotment's two money totals one writer each: `Total_Amount_Received` is
re-summed after every match (`money/received-total`) and `Total_Amount_Receivable` is written once at create.

## Must fix

1. **Two matches at once can leave the allotment's "received" total too low** (`console/src/server/money/received-total.ts:L55-59`)
   - **What this is:** After every Finance match, `syncReceived` adds up the matched receipts on the allotment and writes the total to
     `Total_Amount_Received`. The IR's and KAM's "amount due" is worked out from that total.
   - **Problem:** It read the receipts first and the allotment's `Modified_Time` (the "last changed" stamp the guarded write checks) second.
     Two Finance users match an investor's Advance and a Part within a second: sync A reads the receipts (sees only A's), sync B reads them
     (sees both) and writes the full total, then A reads the allotment — now carrying B's fresh stamp — and its guarded write succeeds
     with the smaller total. The guard never saw the race, because the stamp was read after the stale receipts.
   - **Fix:** Read the allotment first, then the receipts. B's write then moves the stamp A holds, A's write is refused as a conflict, and
     the existing retry re-reads and writes the right total. Two lines swap, nothing else changes.
   - **If we skip it:** The IR chases an investor for money already in, until the next match on that allotment happens to correct it.

## Should fix

2. **The same price merge written twice** (`console/src/server/investors/allotments.ts:L198-206` and `L234-241`)
   - **What this is:** Both allotment reads (by investor, by farm) put the Zoho unit price onto the rows for an IR / KAM.
   - **Problem:** Two identical seven-line blocks. A change to how a hidden price is treated has to be made twice, and one will be missed.
   - **Fix:** One small helper (`withZohoPrice`) used by both reads.
   - **If we skip it:** The two Farms and investor views drift apart the first time one is edited.
3. **No test proves an IR or KAM gets the price only where Zoho shows it** (`console/src/server/investors/allotments.ts:L198-206`)
   - **What this is:** The rule that decides which seats see rupees on allotment rows (D138/D139).
   - **Problem:** Every existing test answers the per-field read with nothing, so a broken merge (wrong row, wrong amount, a price shown to
     a seat that should not get the read) passes.
   - **Fix:** One test: Zoho shows the price on one of three rows; only that row carries price and units × price, no Receipts are read, and
     a Finance seat never makes the read.
   - **If we skip it:** A money display rule can break silently.
4. **No test proves the conversion writes the received total** (`console/src/server/investors/convert.ts:L441`)
   - **What this is:** At Finance's 10%, after the lead's receipts are linked to the new allotment, convert calls `syncReceived` (D140).
   - **Problem:** `match` has a test for its call; convert has none. Removing the line, or moving it before the relink (when the
     allotment has no receipts yet, so the total is 0), passes every test.
   - **Fix:** Two assertions on the existing "two Parts reaching 10%" test: `converted.received` is the matched sum and the allotment holds it.
   - **If we skip it:** A newly converted investor can show the whole ticket as due.
5. **Dead code left by the claim-lines move** (`console/src/server/leads/claim.ts:L40, L75, L290-294`)
   - **What this is:** The lead's claim read moved to `leads/claim-lines`.
   - **Problem:** `CLAIM_READ_FIELDS`, the `fields` option of `claimsOf` (no caller passes it now) and three imports are unused.
   - **Fix:** Delete them; the comment now points at claim-lines for the B-06 reason.
   - **If we skip it:** The next reader thinks the lead page still uses the short field list.
6. **An unreachable fallback in the requester-name read** (`console/src/server/queues/queue.ts:L277-281`)
   - **What this is:** The G1 queue tries first + last name, then full name, then no name.
   - **Problem:** The loop's third try (no name columns) always returns, so the `return pagedSelect(...)` after the loop never runs.
   - **Fix:** Loop over the two named tries; the plain select after the loop is the third.
   - **If we skip it:** Nothing breaks; a reader has to work out which of two identical selects runs.
7. **The IR's claim states vanish once they have more than 200 reports in all** (`console/src/server/leads/claim-lines.ts:L77-86`)
   - **What this is:** For Balances to chase, the IR's own reports are read with `UTR like 'CLAIM-%'` (every lead at once), one page of 200.
   - **Problem:** A page with more is refused as a whole ("never a part"), so every chase row shows no claims — not just the old ones.
     At ~200 investors spread over a few IRs this takes months of reports, but it only ever grows.
   - **Fix (not done):** Page through the IR's reports (offset loop, as `pagedSelect` does), or read only the chased leads' keys.
   - **If we skip it:** One day an IR's Today silently loses every "matched / rejected" line.
8. **Up to ten Zoho calls in a row on every IR Today load** (`console/src/server/leads/claim-lines.ts:L92-104`)
   - **What this is:** To tell matched from rejected, each answered report's Notes are read, one call at a time, up to 10.
   - **Problem:** Nothing is cached (D45), so an IR with many answered reports waits ~10 × a Zoho round trip each time Today opens.
   - **Fix (not done):** Read Notes only for the newest report per lead, or batch them through one COQL on Notes by parent id.
   - **If we skip it:** A slow Today for the busiest IRs; no wrong data.
9. **"Waiting for the signed supplementary" can be said when that is not the reason** (`console/src/features/im/inv/index.tsx:L512`)
   - **What this is:** The record's hold banner says "All money in — waiting for the signed supplementary agreement" when nothing is due.
   - **Problem:** Due 0 and still Reserved also happens when the supplementary IS verified but the automatic stamp failed (Converted_*
     fields missing, a conflict). The banner then blames the paper.
   - **Fix (not done):** Say it only when the allotment's `agreementSigned` is false; otherwise "All money in — mark it fully paid".
   - **If we skip it:** Finance chases a signature that is already in.

## Nice to have

10. **`numbers/sections` returns `money: null` always** (`console/src/server/numbers/sections.ts:L119-122`) — the field, its type and the
    access's `seesMoney` now carry nothing; delete them with the test lines that check null (and the module has no route caller).
11. **Balances to chase re-computes the clock the server already sent** (`console/src/features/today/BalanceChase.tsx:L18-21`) — build
    the sentence from the row's `fromDay` / `extendedBy` instead of re-deriving it.
12. **Claim dates show as `2026-09-20`, D139's example says "paid 20 Sep"** (`BalanceChase.tsx:L40-48`, `lead/drawers/finance.tsx`
    `ClaimStates`) — `shortDay` from `lib/money/balance-clock` is one call.

Verdict: fix 1 first (done, with 2–6; 7–9 listed).
Lean: -20 lines possible.
Not checked: the running app (no Reticle drive — the fixes are server-only and tests); the Zoho side (field sharing, the sandbox fields).

## What was fixed (commit `6b969fb`)

| # | Change | Files |
|---|---|---|
| 1 | `syncReceived` reads the allotment before the receipts; a race test (fails on the old order: 100000 ≠ 150000); D140 text updated | `server/money/received-total.ts`, `.test.ts`, `docs/decisions/D140-…md` |
| 2 | one `withZohoPrice` helper for both allotment reads | `server/investors/allotments.ts` |
| 3 | test: IR/KAM price only where Zoho shows it; Finance never reads it | `server/investors/allotments.test.cjs` |
| 4 | test: convert writes the received total after the relink | `server/investors/d137.test.ts` |
| 5 | `CLAIM_READ_FIELDS`, the dead `fields` option and three imports deleted | `server/leads/claim.ts` |
| 6 | the unreachable third try folded into the trailing select | `server/queues/queue.ts` |

Production code: +28 / −31 (net −3 lines); tests +42.

## ponytail-review of the fix diff (`6b969fb`)

What this change does: it swaps two reads in `syncReceived` so its guarded write catches a concurrent match, merges a duplicated block in
`allotments.ts` into one helper, deletes dead claim/queue code, and adds three tests on money logic.
Looks good. Ship. Checked: every caller of `syncReceived` (match, convert) — the outcome type and codes are unchanged; both `withZohoPrice`
callers keep their seat conditions; `claimsOf` has one caller and it never passed `fields`; the queue still tries first+last, full name,
then none (`queues.test.cjs` W7-FIN-4 case passes).
Lean: -3 lines (net, production).

## Jev build-audit (`jev/client.mjs` + `jev/questions/build-audit.mjs`, cache off, 10 Oct)

State per decision: `story.acceptance` = the decision's rulings as bullets; `decisions` = the decision file; `build` = a summary of what
the code on `lean-review` does, written from reading it; `rules` = the nine rules from `CLAUDE.md`. Run 1 criteria order
aligned, drifted, incomplete, unclear; run 2 reversed. Probabilities as Jev returned them (unclear 0 in every run).

| Decision | Run 1 (choice · aligned / drifted / incomplete) | Run 2, reversed (choice · aligned / drifted / incomplete) | Agreed |
|---|---|---|---|
| D137 | drifted · 0.33 / 0.55 / 0.12 | drifted · 0.38 / 0.49 / 0.13 | **drifted** → located, fixed (doc), re-run below |
| D137 (re-run after the fix) | aligned · 0.58 / 0.29 / 0.13 | aligned · 0.51 / 0.30 / 0.19 | aligned |
| D138 | drifted · 0.46 / 0.52 / 0.02 | aligned · 0.52 / 0.45 / 0.03 | **no** — split → owner |
| D139 | aligned · 0.70 / 0.24 / 0.06 | aligned · 0.71 / 0.23 / 0.06 | aligned |
| D140 | aligned · 0.96 / 0.03 / 0.01 | aligned · 0.97 / 0.03 / 0.00 | aligned |

**Locating the drift** (an ad-hoc choice question, "which acceptance item does the build most clearly drift from, or none", asked twice
with the option order reversed):
- **D137 → item 4** ("the IR chases the balance: a to-do item per Reserved allotment with balance due (amount, deadline)"), p = 0.53 / 0.54
  (none 0.20 / 0.25). Cause: D137's own "Decision (as built)" still said the chase row carries no amount ("Finance holds the amount
  due"), while the code — under D138 §1 — now reads it from Zoho. A stale decision document, not code. **Fixed:** the D137 bullet now
  says it was superseded by D138 §1 and that ruling 3's amount is met. The re-run is aligned in both orders.
- **D138 → item 7** ("Originating_IR: no code"), p = 0.65 / 0.61 (none 0.16 / 0.26). Cause: W7-FIN-2 (after D138) added Digital
  Infrastructure's "Set originating IR from the lead owner" press (`POST /api/investors/[id]/origin`). The two verdict runs disagreed,
  so this is the owner's call, not changed here.

## Owner items

1. **D138 ruling 7 vs the W7-FIN-2 button** (Jev split: drifted 0.52 / aligned 0.52). D138 said "Originating_IR: no code"; W7-FIN-2 then
   built a DI-only stop-gap that writes `Originating_IR = Origin_Lead.Owner` (empty field only, guarded, read back) until the
   `gz_set_originating_ir` workflow is applied (A-32 / A-34 already say "retire the button once the workflow is live"). Keep the stop-gap
   until then, or remove it and wait for the workflow? Carry-forward B-25.
2. Should-fix 7–9 are known, not fixed in this round (not a Must fix, not a missing test, not dead code). Carry-forward C-14.

## Verification (after the fixes)

`npx tsc --noEmit` clean · `npm test`: vitest 157 files / 1,311 tests passed, node runner 106 files / 3,949 passed, 0 failed ·
`npm run test:scripts` 55/55 · `npx next build` built.

## Skipped, and the risk

Skipped: findings 7–12 (listed only); a Reticle drive (no UI change in the fixes). Risk: finding 7 grows with time — an IR with more than 200
reports loses every claim line on Today; finding 9 can send Finance after a signature that is already in.
