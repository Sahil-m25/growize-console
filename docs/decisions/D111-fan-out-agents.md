# D111 — Fan-out: parallel agents, Sonnet builders, Opus for design and integration (30 Sep 2026)

**Why.** The laptop loop builds one story per round and stops when its CLI loses the API (round 2 on 30 Sep: `ENOTFOUND`, then a 15-minute pause). Phase 2b alone was 68 units.

**Decided (owner, 30 Sep).**
- Default for a phase with many independent units is **fan-out**: a coordinator plans batches by epic (`autopilot/fanout.mjs plan`), gives each its own git worktree and branch (`worktrees`), spawns builders in parallel, merges with one integrator, and records every result in one pass (`record`) — the only writer of progress.json and BLOCKED.md.
- **Models:** builders, test-writer and verifier run on **Sonnet**. The pattern for a new kind of unit (architect), cross-cutting/security/Jev-layer work, the integration merge, and reviewer/adversary run on **Opus**. Pinned in `.claude/agents/*.md`.
- `/fanout` is the command; AUTOPILOT.md "Fan-out" the reference; `.gitattributes` merges docs/SESSIONS.md by union.
- When the laptop's CLI is unreliable, the fan-out runs in a cloud workspace through a git bundle and the result comes back the same way.

**First run (30 Sep).**
- Wave 1 (8 agents): wiring pattern + 3 pilots (Opus, docs/WIRING.md), M18-S15 security (Opus), M19-S13 Jev layer (Opus), M18-S14 route contracts, M12-S05-H5 webhooks, M19-S12 Jev triage, M18-S08 UAT pack, M20-S07-H7 Portals spike (Sonnet).
- Wave 2 (7 agents): the remaining 65 wiring units by rail area (access/shell on Opus, six on Sonnet), then one Opus integrator.
- Result: phase 2b 44 of 66 done, 22 in review (route gaps named in their notes); phase 2c 7 of 7. next 15.5.4 → 15.5.26 with postcss/sharp overrides (npm audit high clean). Gates on the merged tree: tsc clean, vitest 55 files / 476, node suite 78 files / 1614, lint:a11y, scripts 38/38, jev 31/31, build:local ok; Jev regression over 18 wired stories all pass, calibration caught. Jev suite 213 → 224 of 319 before wiring.
- 60 PROVISIONAL / FACT CHANGE / BLOCK lines filed in BLOCKED.md; 44 FRONT-END LOOP lines ticked.
