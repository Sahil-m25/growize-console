/* node --test console/scripts/jev-calibration-gate.test.cjs — M19-S04-T01 gate, on sample runner/calibrator outputs. */
'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { spawnSync } = require('node:child_process');
const GATE = path.join(__dirname, 'jev-calibration-gate.mjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jev-gate-'));
process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
const put = (name, v) => { const f = path.join(dir, name); fs.writeFileSync(f, JSON.stringify(v)); return f; };
const gate = (...args) => spawnSync(process.execPath, [GATE, ...args], { encoding: 'utf8', env: { ...process.env, PASS_AT: '' } });
let evaluate;
test.before(async () => { ({ evaluate } = await import(GATE)); });

// Sample outputs in the exact shapes pm/jev-ui-runner.mjs and pm/jev-calibrate.mjs write.
const run = (seededVerdict = 'FAIL') => ({ ran: '2026-09-28T06:00:00.000Z', target: 'staging', results: [
  { id: 'TC-E07-020', story: 'M07-S05', title: 'Composer', verdict: 'PASS', p: 0.93, facts: [], expect_fail: false },
  { id: 'TC-E07-021', story: 'M07-S05', title: 'Send', verdict: 'PASS', p: 0.9, facts: [], expect_fail: false },
  { id: 'TC-E08-001', story: 'M08-S01', title: 'Journey', verdict: 'REVIEW', p: 0.5, facts: [], expect_fail: false },
  { id: 'CAL-M07-1', story: 'M07-S05', title: 'Composer check', verdict: seededVerdict, p: seededVerdict === 'PASS' ? 0.91 : 0.04, facts: [], expect_fail: true },
  { id: 'CAL-M08-1', story: 'M08-S01', title: 'Journey check', verdict: 'FAIL', p: 0.02, facts: [], expect_fail: true },
] });
const cal = (ps) => ({ summary: { mutated_facts: ps.length, from_passing_cases: 2, false_pass_at: { 0.8: `${ps.filter((p) => p >= 0.8).length}/${ps.length}` } },
  all: ps.map((p, i) => ({ id: i % 2 ? 'TC-E07-021' : 'TC-E07-020', how: 'number', original: `Shows ${i} rows`, fact: `Shows ${i + 1} rows`, p })), worst: [] });
const hundred = (hits) => Array.from({ length: 100 }, (_, i) => (i < hits ? 0.85 : 0.1));

test('every seeded-wrong case caught and false passes ≤ 1%: trusted, exit 0, record carries PASS_AT and date', () => {
  const rec = path.join(dir, 'record.json');
  const r = gate('--results', put('r1.json', run()), '--calibration', put('c1.json', cal(hundred(1))), '--record', rec);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /calibration: 2\/2 seeded-wrong cases caught/);
  assert.match(r.stdout, /TRUSTED · PASS_AT 0.8/);
  const v = JSON.parse(fs.readFileSync(rec, 'utf8'));
  assert.equal(v.pass_at, 0.8);
  assert.match(v.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(v.near_miss, { mutated: 100, false_passes: 1, excused_by_review: 0, rate: 0.01 });
});

test('a seeded-wrong case that PASSES fails the pipeline and says so', () => {
  const r = gate('--results', put('r2.json', run('PASS')), '--calibration', put('c2.json', cal(hundred(0))));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /A calibration case PASSED/);
  assert.match(r.stdout, /UNTRUSTED/);
});

test('near-miss false passes above 1% fail the pipeline; reviewed still-true mutations are excused', () => {
  const c = cal(hundred(2));
  const bad = gate('--results', put('r3.json', run()), '--calibration', put('c3.json', c));
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /2\/100 \(2.00%\) exceed 1.00%/);
  const ok = gate('--results', put('r4.json', run()), '--calibration', put('c4.json', c), '--reviewed', put('rv.json', [{ id: c.all[0].id, fact: c.all[0].fact }]));
  assert.equal(ok.status, 0, ok.stdout);
  assert.match(ok.stdout, /1 excused by review/);
});

test('--pass-at moves the threshold', () => {
  const r = gate('--results', put('r5.json', run()), '--calibration', put('c5.json', cal(hundred(3))), '--pass-at', '0.9');
  assert.equal(r.status, 0, r.stdout);
});

test('no seeded-wrong case, an empty calibration, or a calibration from another run is untrusted', () => {
  const noSeeded = { ...run(), results: run().results.filter((x) => !x.expect_fail) };
  assert.equal(evaluate({ results: [noSeeded], calibration: cal(hundred(0)) }).trusted, false);
  assert.equal(evaluate({ results: [run()], calibration: cal([]) }).trusted, false);
  const other = cal(hundred(0)); for (const x of other.all) x.id = 'TC-OLD-999';
  const v = evaluate({ results: [run()], calibration: other });
  assert.equal(v.trusted, false);
  assert.match(v.failures.join(' '), /not run on this suite/);
});

test('a seeded-wrong REVIEW warns but does not fail; epic coverage warns, and fails with --strict-epics', () => {
  const v = evaluate({ results: [run('REVIEW')], calibration: cal(hundred(0)) });
  assert.equal(v.trusted, true);
  assert.equal(v.seeded_wrong.caught, 1);
  assert.match(v.warnings.join(' '), /CAL-M07-1 ended REVIEW/);
  const extra = run(); extra.results.push({ id: 'TC-E09-001', story: 'M09-S01', verdict: 'FAIL', expect_fail: false });
  assert.match(evaluate({ results: [extra], calibration: cal(hundred(0)) }).warnings.join(' '), /M09/);
  assert.equal(evaluate({ results: [extra], calibration: cal(hundred(0)), strictEpics: true }).trusted, false);
});

test('a summary-only calibration is read from false_pass_at', () => {
  const c = cal(hundred(2)); delete c.all;
  const v = evaluate({ results: [run()], calibration: c, passAt: 0.8 });
  assert.deepEqual([v.near_miss.false_passes, v.near_miss.mutated, v.trusted], [2, 100, false]);
});

test('bad input exits 2', () => {
  assert.equal(gate('--results', put('r6.json', run())).status, 2);
  assert.equal(gate('--results', path.join(dir, 'missing.json'), '--calibration', put('c6.json', cal([0.1]))).status, 2);
  assert.equal(gate('--results', put('r7.json', run()), '--calibration', put('c7.json', cal([0.1])), '--pass-at', '2').status, 2);
});
