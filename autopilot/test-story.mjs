// Run a story's Jev UI cases (plus its epic's calibration cases) against the app, or the whole suite of built stories.
// node autopilot/test-story.mjs <q> <STORY>            exit 0 all pass · 1 something failed · 3 a calibration case passed (untrusted)
// node autopilot/test-story.mjs <q> --regression       every ui case of stories already done/review/waiting
// options: --target <url|html>  (default APP_URL or the queue's url) · --prototype (run against the prototype, as a reference check)
import fs from "node:fs"; import { spawnSync } from "node:child_process";
import { P, Q, queue, progress, write, read, dir, SATISFIED } from "./lib.mjs";
const a = process.argv.slice(2); const [q, which] = a;
const Qd = queue(q), pr = progress(q), cfg = Q[q];
const all = read(cfg.cases, { cases: [] }).cases;
let target = a.includes("--target") ? a[a.indexOf("--target") + 1] : a.includes("--prototype") ? P(cfg.prototype) : (process.env.APP_URL || cfg.url);
let ids;
if (which === "--regression") {
  const done = new Set(Qd.stories.filter(s => SATISFIED.has(pr.stories[s.id]?.status)).map(s => s.id));
  ids = all.filter(c => done.has(c.story) || c.expect_fail).map(c => c.id);
} else {
  const s = Qd.stories.find(x => x.id === which); if (!s) { console.error("unknown story " + which); process.exit(64); }
  ids = [...s.ui_cases, ...s.calibration];
}
if (!ids.length) { console.log(`no ui cases for ${which} — nothing for Jev to run (api/manual cases only)`); process.exit(0); }
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const out = `${dir(q)}/results/${stamp}-${which.replace(/^--/, "")}.json`;
fs.mkdirSync(P(dir(q), "results"), { recursive: true });
const r = spawnSync(process.execPath, [P("pm", "jev-ui-runner.mjs"), P(cfg.cases), target, P(out)], {
  stdio: "inherit", env: { ...process.env, SEED_CMD: process.env.SEED_CMD || "node autopilot/seed-local.mjs", ONLY: ids.join(","), FIXTURES: process.env.FIXTURES || P(cfg.fixtures) } });
const res = read(out, { results: [] }).results;
const cal = res.filter(x => x.expect_fail), real = res.filter(x => !x.expect_fail);
const bad = real.filter(x => x.verdict !== "PASS");
console.log(`\n${which}: ${real.length - bad.length}/${real.length} PASS · calibration ${cal.filter(x => x.verdict === "FAIL").length}/${cal.length} caught · results ${out}`);
for (const x of bad) console.log(`  ${x.verdict} ${x.id} ${x.runError || ""}\n` + (x.facts || []).filter(f => f.p < 0.8).map(f => `     ✗ ${f.p.toFixed(2)} ${f.fact}`).join("\n")
  + "\n     steps: " + (x.trace || []).map(t => `${t.step} → ${t.name || t.pick}@${t.p}${t.problem ? " (" + t.problem + ")" : ""}`).join(" | "));
if (cal.some(x => x.verdict === "PASS")) { console.log("!! a calibration case PASSED — the judge is not trustworthy for this run"); process.exit(3); }
if (which === "--regression") {   // stories whose cases broke go back to the front of the queue
  const broke = new Set(bad.map(x => x.story).filter(Boolean));
  for (const sid of broke) if (pr.stories[sid] && pr.stories[sid].status === "done") pr.stories[sid] = { ...pr.stories[sid], status: "regressed", note: "regression: " + bad.filter(x => x.story === sid).map(x => x.id).join(", ") };
  write(`${dir(q)}/progress.json`, pr);
}
process.exit(bad.length ? 1 : 0);
