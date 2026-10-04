// M19-S02 — run Jev UI cases against staging, as each case's seat, with seeded fixtures, and write results.csv.
// Usage: node console/scripts/jev-staging-run.mjs [cases.json] [--only TC-E03-006,...] [--story M03-S05] [--out-dir dir] [--allow-no-session]
// Needs: STAGING_URL (or baseUrl in console/scripts/jev-staging.config.json), a TypeSafe key (as the runner),
// saved sessions from jev-sessions.mjs, fixtures with `seeded` ids. pm/jev-ui-runner.mjs is used as-is:
//  T01  each seat's configured storageState is linked into a temp SESSIONS_DIR as <seat>.json (the runner's hook);
//  T02  per case: POST /api/test/reset, then the runner seeds the case's fixtures through SEED_CMD=jev-staging-seed.mjs;
//       a case with an unseeded fixture or no saved session is FAIL before any step;
//  T03  per-case result JSONs are merged into results.json and results.csv (jev-results-csv.mjs format).
// M19-S08: --retry-review is passed to the runner (a REVIEW is run once more, the better-evidenced result kept); cases on jev/quarantine.json
// still run and print as failing, but do not make the job fail (TC-E16-014). Calibration cases are never excused.
// Exit: 0 all PASS (quarantined cases excepted) · 1 something not PASS · 3 a calibration case passed (judge untrusted) · 2 setup error.
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import { spawnSync } from "node:child_process";
import { createRequire } from "node:module"; import { fileURLToPath } from "node:url";
import { seed } from "./jev-staging-seed.mjs";
import { gate } from "../../jev/flake.mjs";
const { loadConfig, readJson, planRun, mergeResults, resultRows, toCsv } = createRequire(import.meta.url)("./jev-lib.cjs");
const here = path.dirname(fileURLToPath(import.meta.url)); const ROOT = path.resolve(here, "..", "..");
const a = process.argv.slice(2); const opt = k => (a.includes(k) ? a.splice(a.indexOf(k), 2)[1] : undefined); const flag = k => (a.includes(k) ? (a.splice(a.indexOf(k), 1), true) : false);
const only = (opt("--only") || process.env.ONLY || "").split(",").filter(Boolean), story = opt("--story");
const allowNoSession = flag("--allow-no-session"), retryReview = flag("--retry-review"); const outDirArg = opt("--out-dir");
const casesFile = path.resolve(a[0] || path.join(ROOT, "pm/plan-merged/ui-cases.json"));
const fixFile = path.resolve(process.env.FIXTURES || path.join(ROOT, "pm/merge-audit/ui-sahil/fixtures-merged.json"));
const cfg = loadConfig();
if (!cfg.baseUrl) { console.error("no staging URL: set STAGING_URL or baseUrl in console/scripts/jev-staging.config.json"); process.exit(2); }
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outDir = path.resolve(outDirArg || path.join(os.homedir(), ".growize-jev", "results", "staging-" + stamp));
fs.mkdirSync(path.join(outDir, "cases"), { recursive: true });

const cases = readJson(casesFile).cases.filter(c => (!only.length || only.includes(c.id)) && (!story || c.story === story));
if (!cases.length) { console.error("no cases selected"); process.exit(2); }
const { toRun, refused, sessions } = planRun(cases, readJson(fixFile, {}), cfg, { allowNoSession });
const sessDir = fs.mkdtempSync(path.join(os.tmpdir(), "jev-sessions-"));
for (const { seat, path: p } of sessions.links) fs.symlinkSync(p, path.join(sessDir, seat + ".json"));

const parts = [{ ran: new Date().toISOString(), target: cfg.baseUrl, results: refused }];
const seedCmd = `"${process.execPath}" "${path.join(here, "jev-staging-seed.mjs")}"`;
for (const c of toRun) {
  const out = path.join(outDir, "cases", c.id + ".json");
  const reset = await seed("--reset", { cfg });
  if (reset.code) { parts.push({ ran: new Date().toISOString(), results: [{ id: c.id, story: c.story, title: c.title, verdict: "FAIL", runError: "reset failed: " + reset.msg, trace: [], errors: [] }] }); continue; }
  spawnSync(process.execPath, [path.join(ROOT, "pm/jev-ui-runner.mjs"), ...(retryReview ? ["--retry-review"] : []), casesFile, cfg.baseUrl, out], { cwd: ROOT, stdio: "inherit",
    env: { ...process.env, ONLY: c.id, SESSIONS_DIR: sessDir, SEED_CMD: seedCmd, FIXTURES: fixFile, STAGING_URL: cfg.baseUrl } });
  const r = readJson(out, null);
  parts.push(r && r.results?.length ? r : { ran: new Date().toISOString(), results: [{ id: c.id, story: c.story, title: c.title, verdict: "FAIL", runError: "runner wrote no result", trace: [], errors: [] }] });
}
fs.rmSync(sessDir, { recursive: true, force: true });
const merged = mergeResults(parts); merged.target = cfg.baseUrl;
const g = gate(merged.results);   // quarantine: listed as failing, never blocking; the fix-by date goes into the workbook's run_error note
for (const x of g.quarantined) { const r = merged.results.find(y => y.id === x.id); r.runError = `QUARANTINED (fix by ${x.fix_by}${x.overdue ? ", OVERDUE" : ""}) ` + (r.runError || ""); }
fs.writeFileSync(path.join(outDir, "results.json"), JSON.stringify(merged, null, 1));
fs.writeFileSync(path.join(outDir, "results.csv"), toCsv(resultRows(merged, { passAt: +(process.env.PASS_AT || 0.8) })));
const res = merged.results, cal = res.filter(x => x.expect_fail), bad = g.blocking, quar = g.quarantined;
console.log(`\nstaging: ${res.length - cal.length - bad.length - quar.length}/${res.length - cal.length} PASS${quar.length ? ` · ${quar.length} quarantined (failing, not blocking)` : ""} · refused ${refused.length} · calibration ${cal.filter(x => x.verdict === "FAIL").length}/${cal.length} caught · ${outDir}/results.csv`);
for (const x of quar) console.log(`  QUARANTINED ${x.verdict} ${x.id} fix by ${x.fix_by}${x.overdue ? " (OVERDUE)" : ""}`);
for (const x of bad) console.log(`  ${x.verdict} ${x.id} ${x.runError || ""}`);
process.exit(cal.some(x => x.verdict === "PASS") ? 3 : bad.length ? 1 : 0);
