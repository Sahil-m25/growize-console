# D113 — Owner rulings, 4 Oct 2026

1. **A receipt Finance records is matched — no second person.** Recording by a Finance seat is Finance's approval. Where the money can be confirmed from a source automatically (the weekly bank-statement reconciliation, or a Zoho source if one exists), the match is automatic; otherwise the Finance person confirms it by hand. An IR's payment report (a claim) stays pending until Finance confirms it. Supersedes the "matched by a second person" reading of D21/D22 for ordinary receipts; rule 3 holds (recording always allowed; matching gated — the gate is the Finance seat). Refunds and money leaving keep D22's second hand. Closes M10-S02-NOTE-2/-6 (TC-IM05-006 follows this).
2. **M09-S08 — an IR sees investors from their own leads by reusing the Investors page** (same list, record and components, IR-scoped and read-only, no money figures, per D69/D110); if a component cannot be reused, design the nearest equivalent.
3. **All FACT CHANGE PROPOSED test-case changes are approved** (old rail names, persona names, super-user facts, D110 search, D93 app account, stale/negative facts). ui-cases.json may now be edited to apply them; M19-S10/S11 proceed.
4. **Log store (D47) and hosting (AP4):** open — the owner asked for the options (see the D113 reply); no change yet.
5. a. **401 body stays as built** ({error, code, landing, session, signedOut}; no record data) — M18-S14 acceptance 1 changes to "no record data", not "{code} only".
   b. **Farm ops: not provisioned now; keep the persona** (seat definition, UAT script) for later.
   c. **"Business owner" is the `bu` seat.** Seats, roles and responsibilities are assigned by Sahil (admin and Digital Infrastructure) and can be added later.
   d. **M11-S07-NOTE-3 closed** — the oversell guard is on every writer that changes units.
   e. **Compliance (comp, D78) reads the Finance trail read-only**, as built; no separate Auditor profile now.
6. **Zoho fields** (Receipts Claim_Of/Claim_Answer/Claim_Answer_Reason; Lead_Events Sheet_Rows/Sheet_Filled_By/Sheet_Filled_At/Load_Rule; Contacts App_Mark_At) — kept for later; the code reads them when present.
