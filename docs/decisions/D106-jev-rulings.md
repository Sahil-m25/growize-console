# D106 — Jev rulings sheet; decisions and rules ride along on every Jev decide (29 Sep 2026)

**Why.** 110 open PROVISIONAL / FACT CHANGE PROPOSED lines waited on the owner. Each had been a one-off `jev decide` with whatever facts the coding model passed; the governing decisions were often not in the state, so confidence was low by construction.

**Decided.**
- `autopilot/rulings.mjs` re-judges every open P/FC line with the decisions it cites (rows of docs/DECISIONS.md), the nine CLAUDE.md rules and the story's acceptance as state; asks one choice (confirm / reverse / owner) and one cost-if-wrong score; writes `docs/reports/rulings-<date>.md` in tiers: decisive reverse (≥0.7), decisive confirm, needs-you, undecided (sorted by cost). `--render` rebuilds the sheet from the saved JSON; `--limit N`, `--dry`.
- `jev.mjs decide` now attaches every cited decision and the rules to the state automatically.
- First run (29 Sep): 109 items → reverse 15 · confirm 4 · needs you 12 · undecided 78. The owner rules on the first three tiers (31 items); the 78 stay open and are read by cost.
- Reading a P line: confirm = keep what was built. Reading an FC line: confirm = the test case is stale, reverse = the case is right and the build changes.

**Not changed.** BLOCKED.md itself; the loop's tick mechanism (tick = confirmed); the 0.7 threshold in `decide`.
