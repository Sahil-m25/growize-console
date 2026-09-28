#!/usr/bin/env node
/* M19-S04-T01 — JUDGE CALIBRATION GATE. Runs after each suite; exits non-zero when Jev's verdicts cannot be trusted.
 *
 * Reads, never edits, the outputs of pm/jev-ui-runner.mjs (results JSON: results[].{id, story, verdict, expect_fail})
 * and pm/jev-calibrate.mjs (out JSON: summary + all[].{id, how, original, fact, p}). Rule (D63):
 *   1. every seeded-wrong case (expect_fail) must not PASS — one that does marks the run untrusted;
 *      a run with no seeded-wrong case at all cannot be trusted either;
 *   2. near-miss false passes (mutated facts of passing cases judged p ≥ PASS_AT) must be ≤ 1% of mutated facts.
 *      Mutations a person already checked and found still true on screen can be listed in --reviewed.
 *
 * Usage:
 *   node scripts/jev-calibration-gate.mjs --results <ui-results.json> [--results …] --calibration <calibrate-out.json>
 *        [--pass-at 0.80] [--max-false-pass 0.01] [--reviewed <reviewed.json>] [--record <gate-record.json>] [--strict-epics]
 *   node scripts/jev-calibration-gate.mjs --results <r.json> --run-calibrate <path/to/jev-calibrate.mjs> --calibration <out.json>
 *        (runs the calibrator on the results first; needs its Typesafe key)
 * PASS_AT defaults to the PASS_AT env var, else 0.80 (the runner's measured threshold).
 * Exit: 0 trusted · 1 untrusted (gate failed) · 2 bad input.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const DEFAULT_PASS_AT = 0.8;
export const DEFAULT_MAX_FALSE_PASS = 0.01;

const epicOf = (story) => (typeof story === 'string' && /^[A-Z]\d{2}/.test(story) ? story.slice(0, 3) : null);
const keyOf = (x) => `${x.id}\u0000${x.fact}`;

/** Pure: the gate's verdict from parsed inputs. */
export function evaluate({ results, calibration, passAt = DEFAULT_PASS_AT, maxFalsePass = DEFAULT_MAX_FALSE_PASS, reviewed = [], strictEpics = false, date = new Date().toISOString().slice(0, 10) }) {
  const failures = [], warnings = [];
  const rows = results.flatMap((r) => (Array.isArray(r?.results) ? r.results : []));
  if (!rows.length) failures.push('No suite results to judge.');

  // 1. seeded-wrong cases
  const seeded = rows.filter((r) => r.expect_fail === true);
  const passed = seeded.filter((r) => r.verdict === 'PASS');
  const caught = seeded.filter((r) => r.verdict === 'FAIL');
  const review = seeded.filter((r) => r.verdict !== 'PASS' && r.verdict !== 'FAIL');
  if (!seeded.length) failures.push('No seeded-wrong (expect_fail) case ran, so the judge was not checked.');
  for (const r of passed) failures.push(`A calibration case PASSED — the judge is not trustworthy for this run: ${r.id}`);
  for (const r of review) warnings.push(`Seeded-wrong case ${r.id} ended ${r.verdict}, not FAIL.`);
  const epics = new Set(rows.filter((r) => !r.expect_fail).map((r) => epicOf(r.story)).filter(Boolean));
  const covered = new Set(seeded.map((r) => epicOf(r.story)).filter(Boolean));
  const uncovered = [...epics].filter((e) => !covered.has(e)).sort();
  if (uncovered.length) (strictEpics ? failures : warnings).push(`Epics with no seeded-wrong case: ${uncovered.join(', ')}.`);

  // 2. near-miss false passes
  let mutated = 0, falsePasses = 0, excused = 0;
  const skip = new Set(reviewed.map(keyOf));
  if (!calibration || typeof calibration !== 'object') {
    failures.push('No calibration output.');
  } else if (Array.isArray(calibration.all)) {
    const all = calibration.all.filter((x) => typeof x?.p === 'number');
    mutated = all.length;
    for (const x of all) if (x.p >= passAt) { if (skip.has(keyOf(x))) excused++; else falsePasses++; }
    const passing = new Set(rows.filter((r) => r.verdict === 'PASS' && !r.expect_fail).map((r) => r.id));
    const calIds = new Set(all.map((x) => x.id));
    const stale = [...calIds].filter((id) => !passing.has(id));
    if (passing.size && calIds.size && stale.length === calIds.size) failures.push('The calibration was not run on this suite\'s passing cases.');
    else if (stale.length) warnings.push(`Calibration covers ${stale.length} case(s) that did not pass in this run: ${stale.slice(0, 5).join(', ')}.`);
  } else {
    // Summary only: "x/y" at the matching threshold.
    const cell = calibration.summary?.false_pass_at?.[String(passAt)] ?? calibration.summary?.false_pass_at?.[passAt];
    const m = typeof cell === 'string' ? cell.match(/^(\d+)\/(\d+)$/) : null;
    if (m) { falsePasses = +m[1]; mutated = +m[2]; if (reviewed.length) warnings.push('--reviewed ignored: the calibration output has no per-fact list.'); }
    else failures.push(`The calibration output has no per-fact list and no false_pass_at at ${passAt}.`);
  }
  const passingCount = rows.filter((r) => r.verdict === 'PASS' && !r.expect_fail).length;
  if (calibration && passingCount && mutated === 0) failures.push('The calibration measured no mutated facts.');
  const rate = mutated ? falsePasses / mutated : 0;
  if (mutated && rate > maxFalsePass) failures.push(`Near-miss false passes ${falsePasses}/${mutated} (${(rate * 100).toFixed(2)}%) exceed ${(maxFalsePass * 100).toFixed(2)}% at PASS_AT ${passAt}.`);

  const trusted = failures.length === 0;
  return {
    date, pass_at: passAt, max_false_pass: maxFalsePass, trusted,
    seeded_wrong: { total: seeded.length, caught: caught.length, passed: passed.map((r) => r.id), review: review.map((r) => r.id) },
    near_miss: { mutated, false_passes: falsePasses, excused_by_review: excused, rate: Number(rate.toFixed(4)) },
    uncovered_epics: uncovered, failures, warnings,
  };
}

function parseArgs(argv) {
  const a = { results: [], reviewed: null, calibration: null, record: null, runCalibrate: null, strictEpics: false,
    passAt: process.env.PASS_AT ? +process.env.PASS_AT : DEFAULT_PASS_AT, maxFalsePass: DEFAULT_MAX_FALSE_PASS };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], v = () => { const x = argv[++i]; if (x === undefined) throw new Error(`${k} needs a value`); return x; };
    if (k === '--results') a.results.push(v());
    else if (k === '--calibration') a.calibration = v();
    else if (k === '--reviewed') a.reviewed = v();
    else if (k === '--record') a.record = v();
    else if (k === '--run-calibrate') a.runCalibrate = v();
    else if (k === '--pass-at') a.passAt = +v();
    else if (k === '--max-false-pass') a.maxFalsePass = +v();
    else if (k === '--strict-epics') a.strictEpics = true;
    else throw new Error(`unknown argument ${k}`);
  }
  if (!a.results.length || !a.calibration) throw new Error('--results and --calibration are required');
  if (!(a.passAt > 0 && a.passAt <= 1) || !(a.maxFalsePass >= 0 && a.maxFalsePass < 1)) throw new Error('--pass-at is (0,1], --max-false-pass is [0,1)');
  return a;
}

export function main(argv = process.argv.slice(2), out = console) {
  let a;
  try { a = parseArgs(argv); } catch (e) { out.error(`jev-calibration-gate: ${e.message}`); return 2; }
  const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
  if (a.runCalibrate) {
    const r = spawnSync(process.execPath, [a.runCalibrate, a.calibration, ...a.results], { stdio: 'inherit', env: { ...process.env, PASS_AT: String(a.passAt) } });
    if (r.status !== 0) { out.error('jev-calibration-gate: the calibrator failed — the run is not trusted.'); return 1; }
  }
  let results, calibration, reviewed = [];
  try {
    results = a.results.map(read);
    calibration = read(a.calibration);
    if (a.reviewed) { reviewed = read(a.reviewed); if (!Array.isArray(reviewed)) throw new Error('--reviewed is a JSON array of {id, fact}'); }
  } catch (e) { out.error(`jev-calibration-gate: cannot read input: ${e.message}`); return 2; }
  const v = evaluate({ results, calibration, passAt: a.passAt, maxFalsePass: a.maxFalsePass, reviewed, strictEpics: a.strictEpics });
  out.log(`calibration: ${v.seeded_wrong.caught}/${v.seeded_wrong.total} seeded-wrong cases caught`);
  out.log(`near-miss false passes at PASS_AT ${v.pass_at}: ${v.near_miss.false_passes}/${v.near_miss.mutated}${v.near_miss.excused_by_review ? ` (${v.near_miss.excused_by_review} excused by review)` : ''}`);
  for (const w of v.warnings) out.log(`warning: ${w}`);
  for (const f of v.failures) out.log(`!! ${f}`);
  out.log(v.trusted ? `TRUSTED · PASS_AT ${v.pass_at} · ${v.date}` : `UNTRUSTED · the pipeline fails · ${v.date}`);
  if (a.record) fs.writeFileSync(a.record, JSON.stringify(v, null, 1));
  return v.trusted ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main());
