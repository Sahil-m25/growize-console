/* M01-S04-T01 PLANES B AND C STORE — append-only daily JSONL, the env switch, the shared factory and
 * Plane C's authority writer. Run from console/: node --test src/server/logs/store.test.cjs */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const test = require('node:test');
const compile = require('./compile.cjs');

const { outDir, load } = compile(['server/logs/factory.ts', 'server/logs/jsonl.ts', 'server/logs/guard.ts', 'server/identity/authority.ts'], 'logs-store');
const { createJsonlStore, dayOf, MAX_LINE_BYTES } = load('server/logs/jsonl.js');
const { createLogSinks, logStoreKind } = load('server/logs/factory.js');
const { createAuthorityEvents } = load('server/identity/authority.js');
const { createPlaneCLog } = load('server/identity/plane-c.js');
const { createOpsLog } = load('lib/zoho/log.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gz-logs-'));
const DAY1 = Date.UTC(2026, 8, 28, 23, 59, 59);
const DAY2 = Date.UTC(2026, 8, 29, 0, 0, 1);
const ID = '554023000000527003';
const USER = '554023000000100001';

test('jsonl: one file per plane per UTC day; a new day rotates to a new file; the old file is untouched', () => {
  const dir = tmp();
  let now = DAY1;
  const s = createJsonlStore({ dir, plane: 'ops', clock: () => now });
  s.append({ n: 1 });
  s.append({ n: 2 });
  now = DAY2;
  s.append({ n: 3 });
  assert.deepEqual(s.days(), ['2026-09-28', '2026-09-29']);
  assert.deepEqual(s.read('2026-09-28'), [{ n: 1 }, { n: 2 }]);
  assert.deepEqual(s.read('2026-09-29'), [{ n: 3 }]);
  assert.equal(dayOf(DAY1), '2026-09-28');
  const st = fs.statSync(path.join(dir, 'ops-2026-09-28.jsonl'));
  assert.equal(st.mode & 0o777, 0o600, 'day files are owner-only');
});

test('jsonl: no overwrite — a second store on the same directory appends after what is there', () => {
  const dir = tmp();
  createJsonlStore({ dir, plane: 'identity', clock: () => DAY1 }).append({ n: 1 });
  createJsonlStore({ dir, plane: 'identity', clock: () => DAY1 }).append({ n: 2 });
  assert.deepEqual(createJsonlStore({ dir, plane: 'identity' }).read('2026-09-28'), [{ n: 1 }, { n: 2 }]);
});

test('jsonl: append-only surface — no update, rewrite, truncate or delete is exposed; the object is frozen', () => {
  const s = createJsonlStore({ dir: tmp(), plane: 'ops' });
  assert.deepEqual(Object.keys(s).sort(), ['append', 'days', 'dir', 'plane', 'read']);
  assert.ok(Object.isFrozen(s));
  assert.throws(() => { s.remove = () => {}; });
});

test('jsonl: a line over the cap is refused; a relative dir and a bad plane name are refused; a symlinked day file is not followed', () => {
  const dir = tmp();
  const s = createJsonlStore({ dir, plane: 'ops', clock: () => DAY1 });
  assert.throws(() => s.append({ x: 'a'.repeat(MAX_LINE_BYTES) }), RangeError);
  assert.throws(() => createJsonlStore({ dir: 'relative/logs', plane: 'ops' }));
  assert.throws(() => createJsonlStore({ dir, plane: '../etc' }));
  const target = path.join(dir, 'elsewhere.txt');
  fs.writeFileSync(target, 'keep\n');
  fs.symlinkSync(target, path.join(dir, 'errors-2026-09-28.jsonl'));
  assert.throws(() => createJsonlStore({ dir, plane: 'errors', clock: () => DAY1 }).append({ n: 1 }));
  assert.equal(fs.readFileSync(target, 'utf8'), 'keep\n');
});

test('jsonl: a torn final line (crash mid-write) is skipped on read, and the next append still lands', () => {
  const dir = tmp();
  const s = createJsonlStore({ dir, plane: 'ops', clock: () => DAY1 });
  s.append({ n: 1 });
  fs.appendFileSync(path.join(dir, 'ops-2026-09-28.jsonl'), '{"n":');
  s.append({ n: 2 });
  assert.deepEqual(s.read('2026-09-28').map((r) => r.n), [1]);
  assert.equal(s.read('../../etc/passwd').length, 0);
});

test('jsonl: concurrent appenders in four processes lose and interleave nothing', async () => {
  const dir = tmp();
  const mod = path.join(outDir, 'server', 'logs', 'jsonl.js');
  const PER = 300;
  const script = `const { createJsonlStore } = require(${JSON.stringify(mod)});
    const s = createJsonlStore({ dir: ${JSON.stringify(dir)}, plane: 'ops', clock: () => ${DAY1} });
    const w = process.argv[1]; for (let i = 0; i < ${PER}; i++) s.append({ w, i, pad: 'x'.repeat(200 + (i % 50)) });`;
  await Promise.all([0, 1, 2, 3].map((w) => new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ['-e', script, String(w)], { stdio: 'inherit' });
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('worker ' + w + ' exited ' + code))));
  })));
  const text = fs.readFileSync(path.join(dir, 'ops-2026-09-28.jsonl'), 'utf8');
  const lines = text.split('\n').filter(Boolean);
  assert.equal(lines.length, 4 * PER);
  const seen = new Set(lines.map((l) => { const r = JSON.parse(l); return r.w + ':' + r.i; }));
  assert.equal(seen.size, 4 * PER, 'every line parses and is unique');
});

test('factory: memory by default and always in fixture mode; jsonl needs LOG_DIR; anything else is refused', () => {
  assert.equal(logStoreKind({}), 'memory');
  assert.equal(logStoreKind({ LOG_STORE: 'memory' }), 'memory');
  assert.equal(logStoreKind({ LOG_STORE: 'jsonl', LOG_DIR: '/x', FIXTURE_MODE: 'local', NODE_ENV: 'test' }), 'memory');
  assert.equal(logStoreKind({ LOG_STORE: 'jsonl' }), 'jsonl');
  assert.throws(() => logStoreKind({ LOG_STORE: 's3' }));
  assert.throws(() => createLogSinks({ LOG_STORE: 'jsonl' }), /LOG_DIR/);
  const mem = createLogSinks({});
  assert.equal(mem.kind, 'memory'); assert.equal(mem.stores, null);
});

test('factory (jsonl): every sink is a tee — the ring the checks read, plus the day file — and every record is guarded', () => {
  const dir = tmp();
  const sinks = createLogSinks({ LOG_STORE: 'jsonl', LOG_DIR: dir }, { clock: () => DAY1 });
  const ops = createOpsLog(sinks.ops);
  ops.call({ at: DAY1, actor: { kind: 'user', userId: USER }, op: 'getRecord', method: 'GET', endpoint: '/Leads/' + ID, callClass: 'simple', status: 200, durationMs: 12, gateWaitMs: 0, attempt: 1, creditsRemaining: 21000, errorClass: null, recordIds: [ID] });
  ops.refusal({ at: DAY1, actor: { kind: 'user', userId: USER }, action: 'readLead', reason: 'not-visible', recordIds: [ID] });
  assert.equal(sinks.ops.records().length, 2);
  assert.equal(sinks.ops.headroom().lastCreditsRemaining, 21000);
  const onDisk = sinks.stores.ops.read('2026-09-28');
  assert.deepEqual(onDisk, JSON.parse(JSON.stringify(sinks.ops.records())));
  assert.equal(onDisk[0].endpoint, '/Leads/{id}');
  assert.deepEqual(onDisk[0].recordIds, [ID]);
  sinks.ops.clear();
  assert.equal(sinks.ops.records().length, 0);
  assert.equal(sinks.stores.ops.read('2026-09-28').length, 2, 'clear() empties the view, never the file');

  sinks.errors.write({ kind: 'route-error', at: DAY1, requestId: '3f2a9c1e-4b5d-4e6f-8a9b-0c1d2e3f4a5b', userId: null, route: '/api/data', method: 'GET', status: 500, zohoStatus: null, zohoCode: null, errorClass: 'exception', errorName: 'TypeError', durationMs: 3, note: 'Called 9876543210' });
  const [e] = sinks.stores.errors.read('2026-09-28');
  assert.equal(e.requestId, '3f2a9c1e-4b5d-4e6f-8a9b-0c1d2e3f4a5b', 'a request UUID passes the guard');
  assert.equal(e.note, 'redacted', 'the shared guard catches what a producer let through');
});

test('factory: a file that cannot be written never fails the caller — the ring still has the line', () => {
  const dir = tmp();
  const sinks = createLogSinks({ LOG_STORE: 'jsonl', LOG_DIR: dir }, { clock: () => DAY1 });
  fs.symlinkSync(path.join(dir, 'nowhere'), path.join(dir, 'identity-2026-09-28.jsonl'));
  const errors = [];
  const planeC = createPlaneCLog(sinks.identity, (e) => errors.push(e));
  assert.doesNotThrow(() => planeC.record({ at: DAY1, who: USER, action: 'sign-in', outcome: 'ok', reason: 'zoho', seat: 'ir' }));
  assert.equal(sinks.identity.events().length, 1);
  assert.equal(errors.length, 1);
});

test('authority: refused page, refused action and grant change are filed as who, what, whom, when, outcome', () => {
  const dir = tmp();
  const sinks = createLogSinks({ LOG_STORE: 'jsonl', LOG_DIR: dir }, { clock: () => DAY1 });
  const ev = createAuthorityEvents(createPlaneCLog(sinks.identity), () => DAY1);
  const WHOM = '554023000000100002';
  ev.refusedPage(USER, 'ir', 'numbers');
  ev.refusedAction(USER, 'ir', 'readLead', [ID, '9876543210']);
  ev.grantChange(USER, WHOM, 'ir-manager', 'numbers-view', 'ok');
  ev.grantChange(USER, 'anand.pillai@gmail.com', 'ir-manager', 'Sanjay Menon', 'refused');
  const lines = sinks.stores.identity.read('2026-09-28');
  assert.deepEqual(lines[0], { at: DAY1, who: USER, action: 'refused-page', outcome: 'refused', reason: 'numbers', seat: 'ir' });
  assert.deepEqual(lines[1].recordIds, [ID], 'a phone never passes for a record id');
  assert.equal(lines[1].reason, 'readlead');
  assert.deepEqual([lines[2].action, lines[2].whom, lines[2].reason, lines[2].outcome], ['grant-change', WHOM, 'numbers-view', 'ok']);
  assert.equal(lines[3].whom, 'unrecognised');
  assert.ok(!JSON.stringify(lines).toLowerCase().includes('anand'));
  assert.equal(lines[3].reason, 'unrecognised', 'a name is never slugged into a code');
  assert.ok(!JSON.stringify(lines).toLowerCase().includes('menon'));
});
