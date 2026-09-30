# D108 — Decisions audit with Jev; superseded rows marked (29 Sep 2026)

**How.** `autopilot/decisions-audit.mjs` judged all 88 rows of docs/DECISIONS.md against the nine rules and up to 8 topic-related decisions (lexical match, later ones dated). Jev: 51 consistent, 37 flagged (10 at ≥0.7). A person then read every flagged row (report: docs/reports/decisions-audit-2026-09-29.md).

**Housekeeping done.** Rows now carry "Superseded by …" where the later decision says so itself: D2→D52, D3/D4→D45, D5→D50, D28→D33 (one-screen half), D74→D75, D83→D84/D85, D62/D65→D66/D98.

**Real conflicts — owner to rule (not edited):**
1. **D68 vs rule 7 / D13 / D53** — Sahil's super-user reveals of PAN/bank, and his Administrator profile, which the console refuses (M03-S05-NOTE-3). The one decision the code does not follow today.
2. **D69 vs D60** — top-bar search: D60 says org-wide with read-only peek; D69 (later) says leads only in the searcher's book. Code follows D69. Mark D60's search clause superseded?
3. **D15 vs D74/D75 and M11** — D15 says nothing farm-related goes to Zoho; farms are now LLP records in Zoho with allotments. Does the FMS-webhook half of D15 still stand?
4. **D10 vs D93** — app account "tentative at first confirmed money" vs "opens On hold, Finance unlocks". Code follows D93. Mark D10 superseded?
5. **D24 vs D53** — read-only staff without a licence vs every human on an Enterprise seat. D53 governs; costs seats. Mark D24 superseded?
6. **D6 / D79 — investors sign in with Supabase** — still the plan, given the investor portal's planned move to Zoho CRM Portals? A decision row is missing either way.
7. **D20 / D23 / D46 / D49** — cheapest-edition-per-org, the sandbox test for one-vs-two orgs, and the cross-org service identities are all moot under D52 (one Enterprise org). Mark superseded?

**Jev's misses, for the M19-S13 calibration set.** D15 scored only 0.23 (found by reading); D33 was called superseded by the earlier D28 (direction reversed). Both go into `jev/calibration/` as controls for the ruling/audit question type.
