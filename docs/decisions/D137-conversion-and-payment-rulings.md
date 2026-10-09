# D137 — The investor is created at Finance's 10%; Parts count; Reserved converts in full when the money is in (9 Oct 2026)

**Status:** decided by the owner (Sahil) on 9 Oct 2026; built on branch `d137-decisions` (from `4cbb1c5`). Not deployed; no Zoho org
touched. The new Zoho fields are listed in `zoho/changes/2026-10-09-d137-fields.md`; until they exist every path degrades and says so.

**Serves:** Jira GC-1527, workflow gaps G3 and G5, D136's two open questions. **Builds on:** D136 (the 10% gate, GC-1526 override),
D113 ruling 1 (a receipt Finance records is matched), D115 ruling 1 (accounts are created On hold), GC-1523 (converted lead
read-only). **Keeps:** rule 2 / D53 (every human writes as themselves), D44 (guarded writes), D69 (the IR side reads no Receipts),
D122 (Originating_IR's writers), rule 7 (no identity or full bank reference in a log or an answer).

## The rulings (owner, 9 Oct)
1. **GC-1527** — the investor Contact is created only AFTER Finance confirms the 10% (Finance-matched money reaching 10% of the
   committed amount), by Finance's own token. G3: Transfers becomes a read-only log of leads that became investors; no manual copy.
   Keep Origin_Lead linking.
2. **D136 open questions** — (a) a Part payment DOES count toward the 10%: the sum of Finance-matched receipts; each part logged
   with date-time (IST), amount, reference (masked, never the full UTR), who matched it, and the running total against the 10%;
   shown on the Money view and in the unlock gate's explanation. (b) Digital Infrastructure also holds the unlock override, logged
   the same way (who, when, reason, which gate was bypassed).
3. **After Reserved** — the IR chases the balance: a to-do item per Reserved allotment with balance due (amount, deadline).
   Conversion to fully converted happens AUTOMATICALLY when Finance confirms the remaining amount (matched total >= committed),
   stamped with who/when; Finance, Digital Infrastructure or KAM may also do it manually (logged). A Reserved allotment is NOT
   "converted" for the lead lists until fully paid.
4. **Amount changes** after Reserved / conversion — no flow today; do NOT build; design it (G5, below).

## What was found
- Nothing in the live console created a Contact from a lead. "The investor record is created at Said yes" (D60) lived only in the
  Transfers page's words and the demo's `copyInvestor` action; `add-paid` creates Contacts only for people who paid before the console.
- The whole money chain hangs off the allotment (Lead ─Origin_Lead─ Contact ─Customer─ allotment ─Allotment─ Receipts), so money
  received before an investor exists had nowhere to live. D137 gives it one: `Receipts.Lead`.
- de4b8ba's Converted view (`lib/selectors/leads.ts converted`) treated Reserved — the stamp, Lead_Status "Reserved - 10% in", or an
  investor record with a live Reserved allotment — as converted. That contradicts ruling 3 and was a defect; fixed.

## Decision (as built)
1. **GC-1527 — `server/investors/convert`, route `GET|POST /api/leads/[id]/conversion`.** Finance Operations / Head of Finance (Digital
   Infrastructure reads) record a receipt against the lead (`Receipts.Lead`, Match_State Matched, Matched_By = them, Matched_At =
   now — D113: Finance recording is Finance's match; UTR-unique, a lost answer is read back by the reference). With the terms (farm,
   units — default the lead's Units_Interested), the committed amount is units × the farm's Pet_Unit_Price and the 10% is
   `lib/money/ten-percent` over the lead's matched receipts. When reached, in the same press and on Finance's token, resumable step by
   step (a second press continues; nothing is rolled back): (1) the Contact — found first by Origin_Lead, else inserted with the
   lead's name/email/mobile, a fresh ARL_ID, App_Access = Hold, Origin_Lead, Said_Yes_At, and Originating_IR = the lead's owner
   (if Zoho refuses that field to Finance — D122 — written without it and reported); (2) the Reserved allotment, through the
   oversell guard, Hold_Until = 30 days from this confirmation; (3) the lead's receipts linked to it (Receipts.Allotment, each
   guarded); (4) if the money already covers the commitment, the full conversion (below). Plane C `investor-converted`
   (`ten-percent-confirmed`), ops log `lead-convert`. Entry: Finance's Investors-side Today rows for a lead with no investor yet
   ("Money and the 10%", drawer `convert`).
   **Add-paid** now refuses an amount under 10% of units × price (`below-ten-percent`): below the 10% there is no investor record.
   **G3:** Transfers is re-dated to the Reserved rung (Finance's 10%) and reads as a log; the investor-copy drawer lost its manual
   "Copy to investor" action. (The reducer's demo `copyInvestor` remains unreferenced plumbing.)
2. **Ruling 2(a)** — `lib/money/ten-percent` (client-safe): COUNTING_KINDS = Advance, Part, Balance, Full; matched refunds subtract;
   10% rounded up to the rupee; each row carries IST date-time (`Receipts.Matched_At`, else the received day marked "(received)"),
   signed amount, reference masked to the last four, matched-by, running total, the row that crossed 10% and the row that crossed
   the full amount. `server/money/matched-receipts` reads it on the person's own token. The unlock gate (`investors/unlock`) is now
   "matched sum >= 10% of the live allotments' units × Unit_Price" and the card carries `tenPercentTrail`, drawn by
   `components/money/TenTrail` on the App access card and in the lead's `convert` drawer. `money/match` writes `Matched_At` on
   every match (retried without it when Zoho lacks the field).
   **Ruling 2(b)** — the override seats are Finance Operations, Head of Finance and Digital Infrastructure (route `OVERRIDE_SEATS`,
   fixture); the Note's title names the bypassed gate ("gate bypassed: ten-percent"); Plane C `app-access-override` /
   `ten-percent-waived` as before.
3. **Ruling 3** — `server/investors/full-paid`:
   - **auto** — `money/match` consequence 6: after an inbound match, when matched money on the allotment covers units × Unit_Price
     and it is Reserved and unstamped, one guarded write on the matcher's token: `Converted_At` = now, `Converted_By` = the matcher,
     `Converted_Via` = "Finance match". Plane C `investor-converted` / `fully-paid-auto`. Also run at the end of a conversion that
     arrives fully paid.
   - **manual** — `POST /api/investors/[id]/full-paid` for Finance Operations, Head of Finance, Digital Infrastructure, KAM: a reason
     of 10–500 characters goes first as a Note on the Contact under their name (no Note, no stamp; a failed stamp takes it back),
     then the stamp with `Converted_Via` = "Manual"; ops log `full-paid` / `manual`, Plane C `fully-paid-manual`. "Mark fully paid…"
     on each Reserved allotment row of the investor record.
   - **lead lists** — `converted()` = Fully paid or beyond (stamps), Lead_Status Converted / Fully paid / Allocated / Onboarded, or the
     investor record paid or allocated. `live.ts` / `record.ts` count a Reserved allotment stamped `Converted_At` as paid for every
     seat (no money read needed), and the Journey's "Fully paid" step takes the stamp.
   - **IR to-do** — `GET /api/investors/mine` carries `chase`: each Reserved allotment of the IR's own-lead investors not stamped,
     with farm, units, Hold_Until and days left (IST). The amount due is NOT read: D69 keeps every amount off the IR side and the
     IR list's own test (AC4) forbids selecting one, so `due` is null, `dueReadable` false and the row says "Finance holds the amount
     due" until the owner answers open question 1. Drawn as "Balances to chase" on the IR's Today.
   "Fully converted" deliberately is a stamp, not `Allocation_Status = Issued`: Issued stays the verified allocation letter's
   blueprint transition (`investors/allot`), and `Payment_Status` stays Zoho's workflow's.

## G5 — amount change after Reserved / conversion (DESIGN ONLY, not built)
An investor raises or lowers what they commit after the 10% is in (or after full conversion). Today nothing models it: the
allotment's units × Unit_Price is the committed amount; a change would have to be a hand edit in Zoho, which silently moves the 10%,
the balance due and Hold_Until, and leaves no record of who agreed to it.

**Option A — a new allotment row per top-up; a decrease is a partial cancellation.**
- Increase: a second `LLP_UnitAllocation_Module` record (same Contact, same or another LLP), Reserved, with its own Unit_Price at today's
  price, its own 10% and its own Hold_Until (30 days from Finance's confirmation of *its* 10%), its own supplementary / allocation letter.
- Decrease: Finance cancels the allotment (Reserved) or reduces units through a cancellation of the surplus (issued units are not
  un-issued); money above the new commitment becomes a Refund receipt (D22 second hand, step-up).
- Fields: none new on the allotment for increases. For a partial cancellation: `Cancelled_Units` (Number), `Cancelled_At` (DateTime),
  `Cancelled_By` (Lookup Users), `Cancel_Reason` (Text 500).
- Pros: zero change to the money arithmetic — every allotment keeps its own 10%, balance, receipts, payouts; the existing oversell guard,
  payout schedule and papers work as they are. Cons: an investor with many small top-ups gets many rows; a decrease on one farm is clumsy.

**Option B — amend the committed amount on the allotment, with an amendment record and a re-signed supplementary / allocation letter.**
- A new module `Allotment_Amendments` (custom module, the allotment as parent): `Allotment` (Lookup), `From_Units`, `To_Units` (Number),
  `From_Amount`, `To_Amount` (Currency), `Unit_Price_Used` (Currency), `Requested_At` (DateTime), `Requested_By` (Lookup Users — the
  IR or KAM who took the request), `Approved_At` (DateTime), `Approved_By` (Lookup Users — Head of Finance), `State` (Picklist: Requested,
  Approved, Paper out, Signed, Applied, Refused), `Sign_Req_Id` (Text), `Reason` (Text 500). On Applied, the console changes the
  allotment's units (guarded) — Reserved_Units for a Reserved allotment; for an issued one only an increase, as a new Issued tranche.
- 10% and Hold_Until: recomputed on the new commitment. Increase on a Reserved allotment: the 10% must be met on the NEW amount
  before the amendment applies (else it waits in Approved); Hold_Until is NOT extended automatically (the balance clock keeps
  running from the original 10%) unless Finance extends the hold through the existing extension flow. Decrease: the threshold
  drops; if matched money now exceeds the new commitment the surplus becomes a Refund (D22 second hand, step-up); a Reserved
  allotment that becomes fully paid by the decrease converts in full automatically (ruling 3, `Converted_Via` "Finance match").
- Pros: one allotment per farm, an auditable history of every change with its paper. Cons: a new module and blueprint; payouts of an
  issued allotment must be re-cut (the 60-month schedule references units); more to build.

**Option C — cancel and re-reserve.** Finance cancels the allotment and creates a fresh one with the new units; receipts are moved
(relinked) to the new allotment. Simple, but loses the allotment's history and dates, breaks payout continuity, and the oversell
guard briefly frees and re-takes the units. Not recommended.

**Who approves (all options):** the request is taken by the IR (before conversion) or the KAM (after); **the Head of Finance approves**;
Finance Operations sends the paper (supplementary for a Reserved allotment, an allocation-letter addendum for an issued one) via
Zoho Sign; the change applies on the verified paper. A decrease that creates a refund needs the D22 second hand as today.

**Recommendation: Option A now, Option B later if top-ups become common.** Option A needs no new arithmetic, no change to payouts,
and only four optional cancellation fields; every number the console already shows stays correct. If the owner sees frequent
top-ups on the same farm, Option B's amendment module is the place to grow into — its fields avoid Leads entirely (no user-lookup
pressure there) and its user lookups live on the new module.

## Zoho fields (proposed) — see `zoho/changes/2026-10-09-d137-fields.md`
| Module | Field | Type | Writers |
|---|---|---|---|
| Receipts | `Lead` | Lookup → Leads | Finance Operations, Head of Finance |
| Receipts | `Matched_At` | DateTime | Finance (the matcher) |
| LLP_UnitAllocation_Module | `Converted_At` | DateTime | Finance (auto); Finance, DI, KAM (manual) |
| LLP_UnitAllocation_Module | `Converted_By` | Lookup (Users) | same |
| LLP_UnitAllocation_Module | `Converted_Via` | Picklist (Finance match, Manual) | same |
Nothing on Leads (at its user-lookup limit). G5's fields are design only and not proposed for creation yet.

## Open — needs the owner
1. **The IR sees the amount due (ruling 3) vs D69** (the IR side reads no money). Built: the chase row carries the deadline and
   units, and `due: null` ("Finance holds the amount due") — the console does not read any amount on an IR's token. If the owner
   confirms the IR should see it: unhide `Total_Amount_Receivable` for the IR profile (`zoho/changes` item E), relax D69 for this one
   field, and read it in `ir-list` (the row's `due` slot is ready). Or keep the deadline only?
2. **The supplementary before the investor exists.** D136's workflow has the supplementary signed before the money; its Finance side
   (`Supplementary_Sign_Req_Id`, `Supplementary_Verified_At`) lives on the allotment, which now exists only after the 10%. Built:
   Finance's receipts on a lead are matched without the supplementary gate (`money/match` keeps the gate for allotment receipts).
   Move the supplementary's Finance fields to the Lead (DateTime/Text — no user lookups), or gate the conversion on it?
3. **Originating_IR on the new Contact.** Finance cannot write it (D122). Built: tried, then written without it, reported. Approve a
   Zoho workflow that fills it from `Origin_Lead.Owner` on create (`zoho/changes` item C)? Until then the IR's Investors list and
   chase (scoped by Originating_IR) do not show investors Finance created.
4. **IR payment reports before the investor exists.** `leads/claim` writes a Claimed receipt against the investor's allotment, so an IR
   cannot report a payment until Finance has converted the lead. Allow claims on `Receipts.Lead` too?
5. **Lead stage stamps.** `Reserved_At` / `Fully_Paid_At` / `Lead_Status` are blueprint-owned and the console does not write them; the
   lead lists read them. Approve the workflows in `zoho/changes` item D, or should the conversion write them on Finance's token?
6. **KAM manual full conversion.** Ruling 3 names KAM; a KAM reads no money (D12/D40), so they stamp "fully paid" without seeing a
   figure. Confirm.
