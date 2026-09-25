# Agent tooling (25 Sep 2026)

All five are **project scope**: declared in `.claude/settings.json` or installed by `scripts/setup.sh`,
so every session (owner's PC, the hourly cloud build, a teammate) gets the same tools. Nothing here
depends on a user-level install. Secrets never live in the repo.

| Tool | Job | How it gets here | Source |
|---|---|---|---|
| **Jev** (TypeSafe System One) | The gate: judges each story's UI cases (`autopilot/test-story.mjs` → `pm/jev-ui-runner.mjs`) and design/mapping checks (`pm/plan-merged/jev-batch.mjs`) | In repo. Key from `TYPESAFE_API_KEY` (cloud secret) or `.typesafe-key` (gitignored). Never print it | typesafe.ai |
| **reticle** | Runtime perception inside the running dev app: failed requests, state mismatches, console errors that never reach the screen; pass/fail with file locations | Plugin `reticle@reticlehq` (MCP server + skill). The in-app SDK is added once with `npx @reticlehq/server init` and committed (dev-only) | github.com/reticlehq/reticle |
| **graphify** | AST code map; query `tools/graphify/graphify-out/graph.json` instead of re-reading files | `pip install graphifyy` + `graphify extract . --out tools/graphify` in setup; the PostToolUse hook refreshes it after code edits and never blocks | pypi graphifyy |
| **ponytail** | Write-less-code ladder (does it need to exist → already here → stdlib → platform → existing dep → one-liner → minimal code). Also stated in CLAUDE.md | Plugin `ponytail@ponytail` | github.com/DietrichGebert/ponytail |
| **chisle** | Token saving: terse prose, YAGNI-first code, tool-output compression. `/chisle off` to pause | Plugin `chisle@chisle` | github.com/JayPokale/Chisle |

## How they fit in a build round
1. graphify to find where to change code → ponytail/chisle keep the change minimal.
2. Unit tests + typecheck.
3. **reticle** runs the story's flow in the dev app and must report no failed requests or console errors.
4. **Jev** judges the UI cases; its verdict decides done/review. reticle is extra evidence, not a replacement.

## Limits
- chisle and ponytail overlap on YAGNI; that is fine. chisle's terse prose does **not** apply to decision
  records, BLOCKED.md steps or anything a person must act on — write those in full.
- chisle's tool-output compression must stay off anything reading money, receipts, audit logs or the
  daily diagnostic (same rule as headroom before it): a dropped line there is the defect.
- Install plugins only from the sources above; many copies of reticle exist on GitHub.
