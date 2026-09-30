// Seed of M19-S13-H5: run jev/calibration/decide.json through `jev decide`, grounded and bare, and report accuracy.
import { spawnSync } from "node:child_process"; import fs from "node:fs";
const set = JSON.parse(fs.readFileSync("jev/calibration/decide.json", "utf8"));
const run = (q, bare) => { const args = ["autopilot/jev.mjs", "decide", `${q.question} (${q.cite})`, ...Object.entries(q.options).map(([k, v]) => `${k}=${v}`), "--state", `Decision ${q.cite} governs.`]; if (bare) args.push("--bare");
  const r = spawnSync(process.execPath, args, { encoding: "utf8" }); try { return JSON.parse(r.stdout.split("\n")[0]); } catch { return { choice: "?", confidence: 0 }; } };
for (const mode of ["bare", "grounded"]) {
  let ok = 0, okHi = 0, hi = 0, conf = 0; const wrong = [];
  for (const q of set) { const a = run(q, mode === "bare"); conf += a.confidence; const right = a.choice === q.answer; if (right) ok++; if (a.confidence >= 0.7) { hi++; if (right) okHi++; } if (!right) wrong.push(`${q.cite} → ${a.choice} ${a.confidence} (expected ${q.answer})`); }
  console.log(`${mode}: ${ok}/${set.length} right · mean confidence ${(conf / set.length).toFixed(2)} · at ≥0.7: ${okHi}/${hi} right${wrong.length ? "\n  wrong: " + wrong.join("; ") : ""}`);
}
