/* node --test console/scripts/jev-lib.test.cjs — M19-S02 T01/T02/T03 helpers. */
'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const L = require('./jev-lib.cjs');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'jevlib-'));

test('config: env overrides, lane from URL, sessionsDir resolved', () => {
  const d = tmp(); const f = path.join(d, 'c.json');
  fs.writeFileSync(f, JSON.stringify({ baseUrl: 'https://a.example/', sessionsDir: 'sess', seats: { rohit: {} } }));
  const c = L.loadConfig(f, { STAGING_URL: 'https://s.example/?lane=q1' });
  assert.equal(c.baseUrl, 'https://s.example/?lane=q1'); assert.equal(c.lane, 'q1');
  assert.equal(c.sessionsDir, path.join(d, 'sess')); assert.equal(c.signIn.startPath, '/api/auth/zoho');
});

test('T01 seat -> storageState path: default <seat>.json, per-seat override, none/empty seat has none', () => {
  const cfg = { sessionsDir: '/s', seats: { rohit: { storageState: 'r-custom.json' } } };
  assert.equal(L.sessionPath(cfg, 'rohit'), '/s/r-custom.json');
  assert.equal(L.sessionPath(cfg, 'kavya'), '/s/kavya.json');
  assert.equal(L.sessionPath(cfg, 'none'), null); assert.equal(L.sessionPath(cfg, undefined), null);
});

test('T01 sessionLinks splits existing and missing, de-duplicates seats', () => {
  const d = tmp(); fs.writeFileSync(path.join(d, 'rohit.json'), '{}');
  const r = L.sessionLinks({ sessionsDir: d, seats: {} }, ['rohit', 'rohit', 'kavya', 'none']);
  assert.deepEqual(r.links.map(x => x.seat), ['rohit']); assert.deepEqual(r.missing.map(x => x.seat), ['kavya']);
});

test('T02 seedFor: fixtures `seeded`, IM: alias, config seeds override (empty string = no seed)', () => {
  const fix = { A: { seeded: 'seed-a' }, B: { staging: 'text only' }, 'IM:C': { seeded: 'seed-c' } };
  assert.equal(L.seedFor(fix, 'A'), 'seed-a'); assert.equal(L.seedFor(fix, 'B'), null);
  assert.equal(L.seedFor(fix, 'C'), 'seed-c');
  assert.equal(L.seedFor(fix, 'B', { B: 'seed-b' }), 'seed-b'); assert.equal(L.seedFor(fix, 'A', { A: '' }), null);
});

test('T02 preflight refuses a case with an unseeded or unknown fixture, before any step', () => {
  const fix = { A: { seeded: 'seed-a' }, B: {} };
  const cases = [{ id: 'TC-1', fixtures: ['A'] }, { id: 'TC-2', fixtures: ['A', 'B'] }, { id: 'TC-3', fixtures: ['Z'] }, { id: 'TC-4' }];
  const { runnable, refused } = L.preflight(cases, fix);
  assert.deepEqual(runnable.map(c => c.id), ['TC-1', 'TC-4']);
  assert.equal(refused[0].id, 'TC-2'); assert.equal(refused[0].verdict, 'FAIL');
  assert.equal(refused[0].runError, 'fixture B has no staging seed yet'); assert.deepEqual(refused[0].trace, []);
  assert.equal(refused[1].runError, 'unknown fixture Z');
});

test('planRun refuses a seat with no saved session unless allowed; seat none runs', () => {
  const d = tmp(); fs.writeFileSync(path.join(d, 'rohit.json'), '{}');
  const cfg = { sessionsDir: d, seats: {}, seeds: {} };
  const cases = [{ id: 'A', seat: 'rohit' }, { id: 'B', seat: 'kavya' }, { id: 'C', seat: 'none' }];
  const r = L.planRun(cases, {}, cfg);
  assert.deepEqual(r.toRun.map(c => c.id), ['A', 'C']); assert.match(r.refused[0].runError, /no saved session for seat kavya/);
  assert.deepEqual(r.sessions.links.map(x => x.seat), ['rohit']);
  assert.equal(L.planRun(cases, {}, cfg, { allowNoSession: true }).toRun.length, 3);
});

const sample = { ran: '2026-09-28T06:00:00.000Z', target: 'staging', results: [
  { id: 'TC-E03-006', story: 'M03-S05', verdict: 'REVIEW', p: 0.4567, facts: [{ fact: 'The page says "Hi, Rohit"', p: 0.4567 }, { fact: 'Menu shows Today', p: 0.97 }],
    trace: [{ step: "Press 'Leads'", name: 'Leads', p: 0.93 }, { step: 'Look', pick: 'look_only', p: 0.88, problem: 'x' }] },
  { id: 'TC-E16-004', verdict: 'FAIL', runError: 'fixture B has no staging seed yet', trace: [], errors: [] },
] };

test('T03 resultRows: verdict, p to 2dp, only facts below PASS_AT, trace, run date, run error', () => {
  const [a, b] = L.resultRows(sample);
  assert.equal(a.id, 'TC-E03-006'); assert.equal(a.p, '0.46'); assert.equal(a.failing_facts, '0.46 The page says "Hi, Rohit"');
  assert.equal(a.trace, "Press 'Leads' → Leads@0.93 | Look → look_only@0.88 (x)"); assert.equal(a.run_date, '2026-09-28');
  assert.equal(b.p, ''); assert.equal(b.failing_facts, ''); assert.equal(b.run_error, 'fixture B has no staging seed yet');
  assert.equal(L.resultRows(sample, { passAt: 0.99 })[0].failing_facts.split('\n').length, 2);
});

test('T03 CSV: header order, quoting of commas/quotes/newlines, round-trips through the parser', () => {
  const rows = L.resultRows(sample); rows[1].run_error = 'a, b\n"c"';
  const csv = L.toCsv(rows);
  assert.equal(csv.split('\r\n')[0], 'id,story,verdict,p,failing_facts,trace,run_date,run_error');
  assert.match(csv, /"0\.46 The page says ""Hi, Rohit"""/);
  const back = L.parseCsv(csv);
  assert.equal(back.length, 2); assert.deepEqual(back[0], rows[0]); assert.equal(back[1].run_error, 'a, b\n"c"');
  assert.equal(L.csvCell(' lead'), '" lead"'); assert.equal(L.csvCell(null), '');
});

test('mergeResults keeps each part\'s run date and the newest header date', () => {
  const m = L.mergeResults([{ ran: '2026-09-27T01:00:00Z', results: [{ id: 'A' }] }, { ran: '2026-09-28T01:00:00Z', target: 't', results: [{ id: 'B' }] }]);
  assert.equal(m.ran, '2026-09-28T01:00:00Z'); assert.equal(m.target, 't');
  assert.deepEqual(L.resultRows(m).map(r => r.run_date), ['2026-09-27', '2026-09-28']);
});

test('T02 seed adapter: posts the seed id with lane header; refuses unseeded; reset path; non-2xx is an error', async () => {
  const { seed } = await import('./jev-staging-seed.mjs');
  const calls = []; const ok = async (u, o) => { calls.push([u, o]); return { ok: true, status: 200, text: async () => '' }; };
  const cfg = { baseUrl: 'https://s.example/x?lane=L1', lane: 'L1', seeds: {} };
  const fix = { 'IM:ROW A': { seeded: 'seed/a b' }, B: {} };
  assert.equal((await seed('ROW A', { cfg, fix, fetchFn: ok, env: {} })).code, 0);
  assert.equal(calls[0][0], 'https://s.example/api/test/fixture/seed%2Fa%20b'); assert.equal(calls[0][1].headers['x-gz-lane'], 'L1');
  const r = await seed('B', { cfg, fix, fetchFn: ok, env: {} }); assert.equal(r.code, 3); assert.equal(r.msg, 'fixture B has no staging seed yet'); assert.equal(calls.length, 1);
  await seed('--reset', { cfg, fix, fetchFn: ok, env: { JEV_SEED_TOKEN: 't0k' } });
  assert.equal(calls[1][0], 'https://s.example/api/test/reset'); assert.equal(calls[1][1].headers.authorization, 'Bearer t0k');
  const bad = await seed('ROW A', { cfg, fix, fetchFn: async () => ({ ok: false, status: 404, text: async () => 'Not found' }), env: {} });
  assert.equal(bad.code, 1); assert.match(bad.msg, /404 Not found/);
  assert.equal((await seed('ROW A', { cfg: { ...cfg, baseUrl: '' }, fix, fetchFn: ok, env: {} })).code, 2);
});

test('T01 matchesSeat compares the session person with the seat (or its configured who)', async () => {
  const { matchesSeat } = await import('./jev-sessions.mjs');
  assert.equal(matchesSeat({ who: 'rohit' }, 'rohit'), true); assert.equal(matchesSeat({ who: 'kavya' }, 'rohit'), false);
  assert.equal(matchesSeat(null, 'rohit'), false); assert.equal(matchesSeat({ who: 'r1' }, 'rohit', { who: 'r1' }), true);
});
