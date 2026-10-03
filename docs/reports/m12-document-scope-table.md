# M12-S01-T01 — Document scope and visibility table

Source: D70 (three scopes), D77 (no Documents module; files stay in slots / Attachments), M12-S01 acceptance, `console/src/server/documents/scope.ts`
(the code). **Status: written, not yet confirmed — OD8 is open; the owner confirms or edits the PROVISIONAL cells.**
The table is proved by `console/src/server/http/contract/isolation.test.cjs` (`IS-S01-T04`, one row per seat) and `documents/documents.test.cjs` (T01).

## Scope → record → what lives there

| Scope | Lives on (Zoho record) | Examples | Investor sees |
|---|---|---|---|
| Personal | Contact | KYC, PAN proof, bank proof, nominee | their own (investor app, not the console) |
| Allotment | allotment (investor × LLP) | NDA, supplementary agreement, allocation letter, unit certificate, payment proof | their own allotments' |
| Project | LLP | LLP deed, farm and progress reports, insurance, annual accounts | only LLPs they hold a live (not Cancelled) allotment in |

## Scope → seats (console)

`files` = lists file names; `status` = a count only, never a name or id; `—` = nothing, refused before any read.

| Seat | Personal (Contact) | Allotment | Project (LLP) | Investors it may open |
|---|---|---|---|---|
| Finance (fin), Head of Finance (head), Finance Ops (ops) | files | files | files | all |
| Compliance (comp) — PROVISIONAL, KYC owner | files | files | files | all |
| Sahil / Digital Infrastructure (di) | files (numbers masked) | files | files | all |
| KAM (kam) | files, own book only | files, own book | files | own book (`KAM = me`) |
| Head of AM (amlead) — PROVISIONAL | files, subtree | files, subtree | files | subtree |
| Auditor (audit), exec, business owner (bu) — PROVISIONAL (Jev 0.39) | — | files | files | org (read only) |
| IR (ir) | — never | status only | files | investors from their own leads |
| Channel partner (cp), IR Manager (conv) | — | — | files | none |
| Anyone else / malformed id | — | — | — | none |

Rules that hold for every row: the investor is admitted by the one choke point first (a record the seat may not open is refused and logged by id, nothing listed);
file names show PAN / Aadhaar / account numbers masked, for Sahil too; nothing is cached; every read is on the signed-in person's own Zoho token.

## For the owner to confirm (nothing here is decided by this file)

1. **IR and personal papers.** D70 lists "the originating IR per D69" under personal; M12-S01 AC6 says an IR never sees an investor's personal documents. The code follows AC6 (BLOCKED M12-S01-NOTE-2).
2. **Viewers.** audit, exec and bu read allotment and project files but no personal papers (Jev 0.39, low).
3. **Compliance and Head of AM** read personal papers (PROVISIONAL).
4. Zoho's own profiles and sharing rules (Sahil, T02) must make Attachments follow this table; the restricted-user proof is `needs sandbox` (M12-S10).
