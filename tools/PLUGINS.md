# Agent tooling (25 Sep 2026)

All five are **project scope**: declared in `.claude/settings.json` or installed by `scripts/setup.sh`,
so every session (owner's PC, the hourly cloud build, a teammate) gets the same tools. Nothing here
depends on a user-level install. Secrets never live in the repo.

| Tool | Job | How it gets here | Source |
|---|---|---|---|
| **Jev** (TypeSafe System One) | The gate: judges each story's UI cases (`autopilot/test-story.mjs` → `pm/jev-ui-runner.mjs`) and design/mapping checks (`pm/plan-merged/jev-batch.mjs`); every build-workflow judgment goes through `node jev/cli.mjs` (D107: one client, grounding, versioned questions, calibrated thresholds) | In repo. Key from `TYPESAFE_API_KEY` (cloud secret) or `.typesafe-key` (gitignored). Never print it | typesafe.ai |
| **reticle** | Runtime perception inside the running dev app: failed requests, state mismatches, console errors that never reach the screen; pass/fail with file locations | Plugin `reticle@reticlehq` (MCP server + skill). The in-app SDK is added once with `npx @reticlehq/server init` and committed (dev-only) | github.com/reticlehq/reticle |
| **graphify** | AST code map; query `tools/graphify/graphify-out/graph.json` instead of re-reading files | `pip install graphifyy` + `graphify extract . --out tools/graphify` in setup; the PostToolUse hook refreshes it after code edits and never blocks | pypi graphifyy |
| **ponytail** | Write-less-code ladder (does it need to exist → already here → stdlib → platform → existing dep → one-liner → minimal code). Also stated in CLAUDE.md | Plugin `ponytail@ponytail` | github.com/DietrichGebert/ponytail |
| **chisle** | Token saving: terse prose, YAGNI-first code, tool-output compression. `/chisle off` to pause | Plugin `chisle@chisle` | github.com/JayPokale/Chisle |


## When each tool runs — decided by Jev (25 Sep 2026)
Jev scored "should the agent use this tool in this phase" (noul, 2 runs each, 96 calls; control tool
'pocket calculator' scored 0.03–0.07 everywhere, so the scale is sound). Used = ≥ 0.65; chisle sat at
0.43–0.55 in the code phases, so it is on there by choice and off wherever the text or data matters.

| Phase | Jev | reticle | graphify | ponytail | chisle | Rule |
|---|---|---|---|---|---|---|
| Orient (read story, find code) | .12 | .09 | **.89** | .35 | .43 | graphify; chisle on |
| Code | .24 | .56 | **.87** | **.84** | .55 | graphify + ponytail; chisle on |
| Unit (typecheck, tests) | .09 | .17 | **.73** | .24 | .50 | graphify; chisle on |
| Runtime check (dev app) | .49 | **.91** | .28 | .11 | .29 | reticle |
| Acceptance (done/review) | **.81** | **.81** | .27 | .10 | .28 | reticle evidence, **Jev decides** |
| Write-ups (decisions, BLOCKED.md, SESSIONS) | .20 | .18 | .35 | .15 | .19 | none — chisle **off**, full sentences |
| Money evidence (receipts, statements, payouts, audit) | .10 | .20 | .26 | .34 | .06 | none — chisle **off**, no compression |
| Zoho setup scripts | .15 | .24 | **.68** | **.68** | .35 | graphify + ponytail |

Raw: `pm/plan-merged/jobs-tools.json`, `out-tools.json`.

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
