# D107 — One Jev layer for the whole build (29 Sep 2026)

**Why.** Jev is called from three copies of the same client (pm/jev-ui-runner.mjs, autopilot/jev.mjs, autopilot/rulings.mjs), each with its own key handling, retry, log and state-building. Only the UI runner's two questions are calibrated (D63, PASS_AT 0.80 measured 24 Sep); `decide` has taken 67 build choices at an arbitrary 0.70 with no measurement, and a control question (D21) showed it answering against a rule it had in front of it.

**Decided (owner, 29 Sep).** Scope: the build workflow only — no Jev at product runtime. Story **M19-S13** (S5, Must, 6 Hardening subtasks, phase 2c in the harden worktree):
1. `jev/client.mjs` — one client: key, retry, pool, content-hash cache, JSONL log with probabilities and tokens.
2. `jev/ground.mjs` — one grounding function: cited decisions, nine rules, story acceptance, seat table.
3. `jev/questions/*` — versioned question library (pick-control, judge-fact, relevance, triage-class, decide, ruling, cost-if-wrong).
4. `jev/policy.mjs` — threshold per type from measurement, below-threshold action, never-list (money, legal/signed paper, FLS, seats/profiles/sharing, licences → owner).
5. Calibration per type with known-answer control sets; `decide`'s set is posed from past DECISIONS.md rulings. A type under its floor is untrusted: answers recorded PROVISIONAL/REVIEW regardless of confidence.
6. Callers migrate, copies retire, AUTOPILOT.md names one CLI. The UI runner may move onto the shared client (exception to the never-edit rule) with questions and PASS_AT unchanged, proven by a before/after full-suite diff with the D63 gate green on both.

**Effect.** Phase 2c: 6 units, 15 loop h (side clock). Main forecast unchanged.
