/* M18-S02-T02 leak-matrix pure parts. Run from console/: node --test scripts/leak-matrix.test.cjs */
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const L = require('./leak-matrix.lib.cjs');

const A = '554023000000527003', B = '554023000000527011', U = '554023000000100001';
const roles = { ir: { scope: { ids: [A], userIds: [U] } }, finance: { scope: { ids: [B], userIds: [U] } } };

test('routes: discovered from src/app/api; test hooks, sign-in, webhooks and the beacon are excluded', () => {
  const routes = L.discoverRoutes(path.join(__dirname, '..', 'src', 'app', 'api'));
  const t = (x) => routes.find((r) => r.template === x);
  assert.deepEqual(t('/api/data').methods, ['GET']);
  assert.equal(t('/api/data').excluded, false);
  assert.deepEqual(t('/api/leads/[id]/email').params, ['id']);
  for (const x of ['/api/test/reset', '/api/auth/zoho', '/api/webhooks/zoho-sign', '/api/errors']) assert.equal(t(x).excluded, true, x);
});

test('ids: every Zoho-shaped id is found with its path; ignored keys and short numbers are not', () => {
  const ids = L.collectIds({ leads: [{ id: A, owner: { id: U }, phone: '9876543210' }], version: B, n: Number('5540230000005270') }, ['version']);
  assert.deepEqual(ids.map((x) => x.id), [A, U, '5540230000005270']);
  assert.equal(ids[0].path, '$.leads[0].id');
});

test('judge: an id outside scope, a 2xx to a foreign id, a cacheable answer and an unmasked PAN each fail', () => {
  const base = { role: 'ir', scope: roles.ir.scope, route: '/api/data', method: 'GET', headers: { 'cache-control': 'no-store' } };
  assert.equal(L.judge({ ...base, probe: 'in-scope', status: 200, body: { id: A, owner: U }, text: '' }).ok, true);
  const leak = L.judge({ ...base, probe: 'cache-recheck', status: 200, body: { id: B }, text: '' });
  assert.deepEqual(leak.failures.map((f) => f.rule), ['id-outside-scope']);
  assert.deepEqual(L.judge({ ...base, probe: 'out-of-scope', status: 200, body: {}, text: '' }).failures.map((f) => f.rule), ['out-of-scope-answered']);
  assert.equal(L.judge({ ...base, probe: 'out-of-scope', status: 404, body: { error: 'x' }, text: '' }).ok, true);
  assert.deepEqual(L.judge({ ...base, headers: {}, probe: 'in-scope', status: 200, body: {}, text: '' }).failures.map((f) => f.rule), ['cacheable-response']);
  assert.deepEqual(L.judge({ ...base, probe: 'in-scope', status: 200, body: {}, text: '{"pan":"ABCDE1234F"}' }).failures.map((f) => f.rule), ['unmasked-identity']);
  assert.equal(L.judge({ ...base, probe: 'in-scope', status: 200, body: {}, text: '{"pan":"XXXXXX234F"}' }).ok, true, 'masked is fine');
  const withHeader = { ...base, scope: { ...roles.ir.scope, scopeKey: 'user:' + U }, cacheScopeHeader: 'X-Cache-Scope' };
  assert.equal(L.judge({ ...withHeader, headers: { 'cache-control': 'no-store', 'x-cache-scope': 'user:' + U }, probe: 'in-scope', status: 200, body: {}, text: '' }).ok, true);
  assert.deepEqual(L.judge({ ...withHeader, headers: { 'cache-control': 'no-store', 'x-cache-scope': 'org' }, probe: 'in-scope', status: 200, body: {}, text: '' }).failures.map((f) => f.rule), ['cache-key-missing-scope']);
});

test('plan: reads for every role, dynamic routes probed with an own and a foreign id; writes only with --probe-writes and only foreign', () => {
  const routes = [{ template: '/api/data', methods: ['GET'], params: [], excluded: false }, { template: '/api/leads/[id]/email', methods: ['POST'], params: ['id'], excluded: false }, { template: '/api/test/reset', methods: ['POST'], params: [], excluded: true }];
  const reads = L.planCalls(routes, roles);
  assert.deepEqual(reads.map((c) => `${c.role} ${c.method} ${c.path} ${c.probe}`), ['ir GET /api/data in-scope', 'finance GET /api/data in-scope']);
  const writes = L.planCalls(routes, roles, { probeWrites: true }).filter((c) => c.method === 'POST');
  assert.deepEqual(writes.map((c) => `${c.role} ${c.path} ${c.probe}`), [`ir /api/leads/${B}/email out-of-scope`, `finance /api/leads/${A}/email out-of-scope`]);
});

test('cookies: a Playwright storageState becomes a Cookie header for the base URL host only', () => {
  const s = { cookies: [{ name: 'gz_sid', value: 'abc', domain: 'staging.growize.example' }, { name: 'other', value: 'x', domain: '.zoho.in' }] };
  assert.equal(L.cookieFromStorageState(s, 'https://staging.growize.example/'), 'gz_sid=abc');
});

test('cli: refuses a placeholder base URL and port 3001; --dry-run plans without network', () => {
  const fs = require('node:fs'); const os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leak-'));
  const cfg = path.join(dir, 'c.json');
  const run = (c, extra = []) => { fs.writeFileSync(cfg, JSON.stringify(c)); return spawnSync(process.execPath, [path.join(__dirname, 'leak-matrix.mjs'), '--config', cfg, ...extra], { encoding: 'utf8', env: { ...process.env, STAGING_URL: '' } }); };
  const r1 = { ir: { cookie: 'gz_sid=a', scope: { ids: [A] } }, finance: { cookie: 'gz_sid=b', scope: { ids: [B] } } };
  assert.equal(run({ baseUrl: 'https://staging.example.invalid/', roles: r1 }).status, 2);
  assert.equal(run({ baseUrl: 'http://localhost:3001/', roles: r1 }).status, 2);
  const dry = run({ baseUrl: 'http://localhost:3002/', roles: r1 }, ['--dry-run']);
  assert.equal(dry.status, 0, dry.stderr);
  const plan = JSON.parse(dry.stdout);
  assert.ok(plan.calls.some((c) => c.path === '/api/data' && c.probe === 'cache-recheck'));
  assert.ok(!plan.calls.some((c) => c.path.startsWith('/api/test')));
});
