// decide "<question>" "a=<meaning>" "b=<meaning>" … [--state "<facts>" | --state-file f] [--story M##-S##] [--bare]
// One either/or build choice, grounded by jev/ground.mjs and passed through jev/policy.mjs (D106, D107).
import fs from "node:fs";
import { jev, spent } from "./common.mjs"; import { q } from "../questions/index.mjs"; import { ground } from "../ground.mjs"; import { apply } from "../policy.mjs";
export function parse(argv) {
  const i = argv.indexOf("--state"), f = argv.indexOf("--state-file"), s = argv.indexOf("--story");
  const facts = i > -1 ? argv[i + 1] : f > -1 ? fs.readFileSync(argv[f + 1], "utf8").slice(0, 12000) : "";
  const drop = new Set([i, f, s].filter(x => x > -1).flatMap(x => [x, x + 1]));
  const rest = argv.filter((_, k) => !drop.has(k) && argv[k] !== "--bare");
  const [question, ...opts] = rest;
  const options = Object.fromEntries(opts.map(o => { const j = o.indexOf("="); return [o.slice(0, j), o.slice(j + 1)]; }));
  return { question, options, facts, story: s > -1 ? argv[s + 1] : undefined, bare: argv.includes("--bare") };
}
/** decideOne({question, options, facts, story, bare}) → { choice, confidence, probabilities, status, reason, jev_choice, cited, related } */
export async function decideOne({ question, options, facts = "", story, bare = false }, client = jev, table) {
  const own = [question, ...Object.values(options), facts].join("\n");
  const state = { facts };
  let g = { cited: [], related: [], state: {} };
  if (!bare) { g = ground(own, { story }); Object.assign(state, g.state); }
  const a = (await client.ask(state, { d: q("decide", { question, options, has: Object.keys(state).filter(k => k !== "facts" || facts) }) }, { caller: "decide" })).d;
  const pol = apply("decide", a, { text: own, grounded: g.cited.length > 0, table });
  return { ...pol, probabilities: a.probabilities, cited: g.cited, related: g.related };
}
export async function run(argv) {
  const x = parse(argv);
  if (!x.question || Object.keys(x.options).length < 2) { console.error('usage: jev/cli.mjs decide "<q>" "a=meaning" "b=meaning" [--state "<facts>"] [--story M##-S##]'); return 64; }
  const r = await decideOne(x);
  console.log(JSON.stringify({ choice: r.choice, confidence: r.confidence, status: r.status, jev_choice: r.jev_choice, probabilities: r.probabilities, cited: r.cited, related: r.related, reason: r.reason || undefined }));
  if (r.status === "OWNER") console.log(`OWNER (${r.reason}): do not pick. Record "PROVISIONAL: ${x.question} → owner to rule (Jev leaned ${r.jev_choice})" with done.mjs --human; if the work cannot wait, build the smallest reversible version of the lean.`);
  else if (r.status === "PROVISIONAL") console.log(`PROVISIONAL (${r.reason}): build "${r.choice}" and record "PROVISIONAL: ${x.question} → ${r.choice}" with done.mjs --human`);
  console.error(spent());
  return 0;
}
