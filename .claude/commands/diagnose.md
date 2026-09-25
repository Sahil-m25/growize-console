---
description: Run the daily diagnostic and explain the findings — never fix them
---
Run `python ops/diagnose/run.py --date today --dry-run` and read the report.

For each finding, tell me: what is wrong, why it is happening (with the evidence), who or what it
affects right now, what fixing it would involve, **what that fix would break, replay or make
irreversible**, and what happens if it is ignored.

Do not change anything — not code, not data, not configuration — and do not offer to. If I want a
fix I will ask for it by finding id. If a finding has no established cause, say so rather than
proposing a repair for a guess.
