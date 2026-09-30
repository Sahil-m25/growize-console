---
description: Fan-out build — plan batches, run several builder agents at once, integrate, record (D111)
argument-hint: "[phase] [agents, default 7]"
---
You are the coordinator. Builders are Sonnet; the pattern, cross-cutting/security/Jev-layer work and the integration merge are Opus (autopilot/AUTOPILOT.md "Fan-out").

1. `node autopilot/fanout.mjs plan --phase <phase> --agents <n> > /tmp/plan.json`. Read the gate for the phase. If the units are a new kind with no pattern doc, spawn ONE `architect` first to design and pilot it and write the doc; wait for it.
2. `node autopilot/fanout.mjs worktrees /tmp/plan.json <parent-dir> <base-branch>` — one worktree and branch `agent/<batch>` per batch.
3. Spawn one `builder` per batch in a single message (they run in parallel). Each brief: its worktree, its unit ids, the pattern doc, its port range (e.g. 3101–3109, 3201–3209, …).
4. When all have reported, spawn one `integrator` to merge `agent/*` into the integration branch and run the full gate once.
5. Write one results file (story, phase, status done|review|waiting, one-line note naming what was built, acceptance met and decisions applied, commits, the builder's PROVISIONAL / FACT CHANGE lines) and record everything in ONE pass: `node autopilot/fanout.mjs record <results.json>`. You are the only writer of progress.json and BLOCKED.md.
6. `python3 ops/tracker/canvas.py --push`; append one line to docs/SESSIONS.md; commit.

If the laptop's CLI keeps dropping (ENOTFOUND), run the fan-out in a cloud workspace: `git bundle create` the branch on the laptop, clone it there, build, `git bundle` the result back and fetch it on the laptop.
