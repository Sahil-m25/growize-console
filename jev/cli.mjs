#!/usr/bin/env node
// D107 — the one Jev CLI for the build workflow (never product runtime). Every command goes through jev/client.mjs
// (key, retry, pool, cache, log), jev/ground.mjs (what governs), jev/questions/ (versioned questions) and jev/policy.mjs.
//   node jev/cli.mjs context <STORY>                          what to read for this story in this phase
//   node jev/cli.mjs triage <ui-results.json>                 why each failed UI case failed, grouped into a fix list
//   node jev/cli.mjs decide "<q>" "a=<meaning>" "b=<meaning>" [--state "<facts>" | --state-file f] [--story M##-S##] [--bare]
//   node jev/cli.mjs rulings [--limit N] [--dry] [--render]   re-judge open PROVISIONAL / FACT CHANGE lines (D106)
//   node jev/cli.mjs decisions-audit [--limit N]              DECISIONS.md rows vs rules and later decisions (D108)
//   node jev/cli.mjs build-audit [--limit N]                  built stories vs acceptance and decisions (D109)
//   node jev/cli.mjs calibrate [type …] [--dry]               control sets → jev/calibration/thresholds.json
// Key: TYPESAFE_API_KEY | TS_KEY_FILE | .typesafe-key (never printed). Log: jev/logs/calls.jsonl. Cache: jev/.cache (JEV_CACHE=0 to skip).
import path from "node:path"; import { fileURLToPath } from "node:url";
const CMDS = ["context", "triage", "decide", "rulings", "decisions-audit", "build-audit", "calibrate"];
export async function main(argv = process.argv.slice(2)) {
  const [cmd, ...args] = argv;
  if (!CMDS.includes(cmd)) { console.error(`usage: node jev/cli.mjs ${CMDS.join("|")} …`); return 64; }
  const m = await import(`./commands/${cmd}.mjs`);
  return (await m.run(args)) ?? 0;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main();
