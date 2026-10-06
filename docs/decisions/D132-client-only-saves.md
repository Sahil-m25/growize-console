# D132 — Client-only saves reach Zoho, and a guard keeps them from coming back (7 Oct 2026)

**Status:** built on branch `fix/client-only-saves` (from `test-signin-staging`, 8ac4027). Not deployed. No live Zoho org touched.

## Why
A reducer action changes only the browser's copy (`lib/console-save` `createConsoleWriter`: live, a dispatched business write is
applied locally, never queued, never sent). The IR A UI test and the 6 Oct coverage analysis found screens whose save button
looked saved and vanished on reload, for seats that have staging users (`coverage-matrix.csv`, `blocked-client-only`). D45 says
Zoho is the only store, so a save that does not reach Zoho is a defect, not a feature gap.

## Decision
Every live write goes WriteEndpoint + `useApiWrite` (D104) to a route on the person's own token (D53), and the page shows what
Zoho holds afterwards (`bumpLive` re-reads, or `reloadData` on the lead side). Where no Zoho field exists in the sandbox, the
control stays disabled live with the existing "Not available yet" pattern — no field is invented.

| # | Control | Route | Zoho write |
|---|---|---|---|
| 1 | Leads/Today "Record follow-up" drawer (`p:followup`): Save follow-up, Save and next investor; also the lead page's "Mark first contact made" path | `POST /api/leads/[id]/followup` (C1's route, reused) | Touches row + Leads stamps / Next_Step* (C1 `followup.save`) |
| 2a | KAM: Log a conversation → Record it | `POST /api/investors/[id]/contact` (new; Idempotency-Key) | `Touches` {Lead = Contacts.Origin_Lead, Channel, Occurred_At, Is_Reply false, Note = mood — words} (D76); `Contacts.KAM_Intro_At` the first time the account's own KAM logs one (written first, guarded, taken back if the insert fails) |
| 2b | KAM: Change their details → Save the changes | `PUT /api/investors/[id]/details` (new) | `Contacts.Mobile`, `Email`, `Mailing_City`, `Nominee_Name` (+ `Nominee_Relation` from "Name (Relation)") |
| 3 | Compliance: KYC Pass it / Fail it | `POST /api/investors/[id]/kyc` (new) | `Contacts.KYC` = Completed / Failed + `KYC_Completed_On` (Compliance's own FLS group, zoho/access/spec.json); a failure's reason as a `Notes` row on the Contact |
| 4 | Investor record ticket buttons (Hand it to Finance, Waiting on them, Close it) | `POST /api/cases/[id]/handover`, `PATCH /api/cases/[id]` (the Tickets page's, reused) | Cases (unchanged services) |

Rules kept: the right is re-derived from the live session before anything is read (`server/investors/care-runtime` `mayCare`:
the Investors capability `care` / `details` / `kyc`; an IR is never admitted; a KAM only on an account whose `Contacts.KAM` is
them); the Contact's `Modified_Time` (the record's `version`) is sent as `expectedModifiedTime` and every Contact update carries
If-Unmodified-Since (409 on a newer change). KYC pass needs a PAN and, for a resident, an Aadhaar reference; both are asked as COQL
presence tests (`… is not null`), so no identity value is read, logged or returned (rule 7). Refusal lines carry ids and codes only.
D69 untouched: nothing here reads Receipts.

The live drawers (talk / details / kyc) now read the investor from `GET /api/investors/[id]/record` (the demo book is empty
live, so before this they did not open at all); the record page offers the buttons by `mayCareOn` / `mayDetailsOn`; the record's
Tickets section live lists the seat's register rows (`GET /api/cases`) for that investor.

## Not built — owner or schema decision owed
- **Record farm progress** (`logField`): no Zoho module holds a field note. Disabled live, "Not available yet".
- **Next-contact override** in Log a conversation: no Contacts next-contact field. Live offers only "On the cadence".
- **Conversation mood** as its own field: no verified `Touches.Mood`; it rides in the Touch's Note (as C1 does with objections).
- **Name change** in investor details: the prototype also opens a bank re-match ticket for Finance — who receives it is not
  decided. Disabled live.
- **Address** in investor details: six `Mailing_*` fields; one free-text line cannot be split back without inventing a parse.
  Disabled live.
- `sandbox-schema-2026-10-05.json` is cited by `zoho/sandbox/README.md` but is not in the repo; fields were taken from
  `zoho/access/spec.json`, `zoho/sandbox/manifest.json` and what the server already reads. Picklist value `KYC = "Failed"` is read
  by `server/investors/record.ts` but unverified in the sandbox.

## The guard
`console/src/lib/client-only-saves.test.ts` scans every `dispatch({ type })` in `src/features` and `src/components`, classifies
it (lead side `BUSINESS_WRITES`; Investors side every ImAction not in `IM_LOCAL`; explicit `LEAD_LOCAL` / `IM_LOCAL` allow-lists
for UI state — an unclassified type fails) and fails when a persistent action is dispatched outside a live-mode guard and is not
listed in `KNOWN` (still client-only, below) or `HAND_CHECKED` (guarded in a way the scan cannot see). A listed entry that no longer
occurs also fails. Proved against the pre-fix code: it flags exactly the nine original sites (followupDrawer.tsx:341,
drawers/index.tsx:166/576/577/704/734, TkRow.tsx:30/39/40).

`KNOWN` today (no route; none of these seats has a staging user except where noted): Plan page and its drawers (setPeriodDate,
setGrain, addPeriod, setNum, setBaseline, setReleased, dropPeriod, bump), Numbers recovery (setRecov, clearRecov), People
(grantTemp, revokeTemp, addPerson, removePerson), lead Investor copy (copyInvestor), Payments "Show the reference" (showRef,
IR seat, likely unreachable live).
