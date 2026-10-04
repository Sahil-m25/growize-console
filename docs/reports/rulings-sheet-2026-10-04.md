# Rulings sheet, 4 Oct 2026
File: docs/reports/rulings-sheet-2026-10-04.csv. Fill owner_decision (approve / reject / change) and owner_note; read-only source: autopilot/console/BLOCKED.md.
Rows: 184 = 165 open BLOCKED lines (124 PROVISIONAL, 35 FACT CHANGE PROPOSED, 6 OWNER) + 19 OWNER-INPUT rows. Superseded: 18 (D113, D114, 4 Oct rulings).
Priority 1 (score under 0.6 or blank): 137 rows (13 superseded, 19 owner-input).
Priority 2 (0.6 to 0.85): 34 rows (5 superseded, 0 owner-input).
Priority 3 (above 0.85): 13 rows (0 superseded, 0 owner-input).
Score: taken from the BLOCKED line when it has one (lowest if several); otherwise a fresh Jev ruling (jev/cli.mjs ruling question), score = Jev's probability that the built choice is consistent with the decisions (confirm). 123 fresh calls, 0 failed.
Jev sorts, you decide: a low score means read it first, not that it is wrong. OWNER rows and OWNER-INPUT rows are your values, not Jev's.
Sort: priority, then score ascending (blank first); superseded rows keep their priority, filter on superseded_by to hide them.
