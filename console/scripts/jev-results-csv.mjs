// M19-S02-T03 — turn Jev runner result JSON(s) into results.csv for the workbook's Test cases sheet.
// Usage: node console/scripts/jev-results-csv.mjs <results.json> [more.json ...] [--out results.csv] [--pass-at 0.8]
// Columns: id, story, verdict, p, failing_facts, trace, run_date, run_error. The runner itself is not changed:
// this reads the JSON it already writes ({ ran, target, results: [{ id, verdict, p, facts, trace, runError }] }).
import fs from "node:fs"; import { createRequire } from "node:module";
const { readJson, resultRows, toCsv, mergeResults } = createRequire(import.meta.url)("./jev-lib.cjs");
const a = process.argv.slice(2); const opt = k => (a.includes(k) ? a.splice(a.indexOf(k), 2)[1] : undefined);
const out = opt("--out") || "results.csv"; const passAt = +(opt("--pass-at") || process.env.PASS_AT || 0.8);
if (!a.length) { console.error("usage: jev-results-csv.mjs <results.json>... [--out results.csv]"); process.exit(64); }
const rows = resultRows(mergeResults(a.map(f => readJson(f))), { passAt });
fs.writeFileSync(out, toCsv(rows));
console.log(`${rows.length} rows → ${out}`);
