/* M03-S02-T01 GRANT STORE AND API — store (memory + append-only replay), the grant rules (canManage, own
 * people·seats, seatShape, reachCeil, capsBase), the service over recorded Zoho Users answers, Plane C
 * grant-change lines, and the route guard reading the store (Jhalak reaches Leads and Profile, read-only).
 *
 * Run from console/: node --test src/server/access/grants.test.cjs
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const test = require('node:test');

const consoleRoot = path.resolve(__dirname, '..', '..', '..');
const ts = require(path.join(consoleRoot, 'node_modules', 'typescript'));
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'server-grants-'));
process.on('exit', () => fs.rmSync(outDir, { recursive: true, force: true }));

const config = ts.readConfigFile(path.join(consoleRoot, 'tsconfig.json'), ts.sys.readFile);
const project = ts.parseJsonConfigFileContent(config.config, ts.sys, consoleRoot);
const options = {
  ...project.options, incremental: false, tsBuildInfoFile: undefined, plugins: undefined,
  module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10,
  noEmit: false, noEmitOnError: true, outDir, rootDir: consoleRoot,
};
const sources = ['src/server/access/grants.ts', 'src/server/access/grant-service.ts', 'src/server/access/guard-core.ts', 'src/server/identity/users.ts', 'src/server/oauth/seat.ts'].map((f) => path.join(consoleRoot, f));
const program = ts.createProgram(sources, options);
const diagnostics = [...ts.getPreEmitDiagnostics(program), ...program.emit().diagnostics];
if (diagnostics.length) {
  console.error(ts.formatDiagnostics(diagnostics, { getCanonicalFileName: (f) => f, getCurrentDirectory: () => consoleRoot, getNewLine: () => '\n' }));
  process.exit(1);
}
process.env.NODE_PATH = path.join(consoleRoot, 'node_modules');
Module._initPaths();
const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  const r = request.startsWith('@/') ? path.join(outDir, 'src', request.slice(2))
    : request.startsWith('@fixtures/') ? path.join(outDir, 'fixtures', request.slice(10)) : request;
  return resolveFilename.call(this, r, ...rest);
};
const load = (f) => require(path.join(outDir, f));
const FX = (area, name) => JSON.parse(fs.readFileSync(path.join(consoleRoot, 'src', 'lib', 'zoho', '__fixtures__', area, name), 'utf8'));

const { createGrantStore, grantReaderOf } = load('src/server/access/grants.js');
const { decideGrant, GRANT_REFUSALS } = load('src/server/access/grant-rules.js');
const { createGrantService } = load('src/server/access/grant-service.js');
const { createGuard } = load('src/server/access/guard-core.js');
const { seatAccess } = load('src/server/access/policy.js');
const { createZohoUserDirectory } = load('src/server/identity/users.js');
const { createAuthorityEvents } = load('src/server/identity/authority.js');
const { createPlaneCLog, createPlaneCMemorySink } = load('src/server/identity/plane-c.js');
const { createZohoSeatDirectory } = load('src/server/oauth/seat.js');
const { createJsonlStore } = load('src/server/logs/jsonl.js');

const PRADEEP = '554023000000300001', SAHIL = '554023000000300003', TASNEEM = '554023000000300004',
  ROHIT = '554023000000300005', JHALAK = '554023000000300012', HARSHA = '554023000000300007';
const FILES = { [PRADEEP]: 'pradeep-ceo', [SAHIL]: 'sahil-di', [TASNEEM]: 'tasneem-ir-manager', [ROHIT]: 'rohit-ir', [JHALAK]: 'jhalak-exec', [HARSHA]: 'harsha-head-of-finance' };
const seatsFx = FX('oauth', 'current-user.seats.response.json');
const seats = createZohoSeatDirectory({ recordIdPrefix: seatsFx.recordIdPrefix, roleIds: seatsFx.roleIds, profileIds: seatsFx.profileIds });
const person = (who) => { const u = FX('grants', `users.${FILES[who]}.response.json`).users[0]; return { who, seat: seats.resolveDirectoryUser({ users: [u] }).value.seat, mgr: u.Reporting_To ? u.Reporting_To.id : null }; };
const book = (ids, grants = {}) => ({ people: ids.map(person), grants });
const T0 = 1_790_000_000_000;

/* ---- the store --------------------------------------------------------------------------------- */

test('store: set / reset / fresh copies; a malformed line throws and changes nothing', () => {
  const s = createGrantStore();
  s.set({ at: T0, by: SAHIL, whom: JHALAK, page: 'leads', caps: ['view'] });
  const g = s.grantsOf(JHALAK);
  assert.deepEqual(g, { leads: ['view'] });
  g.leads.push('edit');
  assert.deepEqual(s.grantsOf(JHALAK), { leads: ['view'] }, 'callers get a copy');
  assert.throws(() => s.set({ at: T0, by: 'sahil@growize.in', whom: JHALAK, page: 'leads', caps: ['edit'] }));
  assert.throws(() => s.set({ at: T0, by: SAHIL, whom: JHALAK, page: 'Leads Page', caps: ['view'] }));
  assert.deepEqual(s.grantsOf(JHALAK), { leads: ['view'] });
  s.set({ at: T0, by: SAHIL, whom: JHALAK, page: 'leads', caps: null });
  assert.deepEqual(s.grantsOf(JHALAK), {});
  assert.deepEqual(s.holders(), []);
  assert.deepEqual(grantReaderOf(s).grantsOf(ROHIT), {});
});

test('store: the append-only file replays in order on restart; lines hold ids and codes only', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grants-jsonl-'));
  try {
    const a = createGrantStore({ backing: createJsonlStore({ dir, plane: 'grants' }) });
    a.set({ at: T0, by: SAHIL, whom: JHALAK, page: 'leads', caps: ['view'] });
    a.set({ at: T0 + 1, by: SAHIL, whom: JHALAK, page: 'numbers', caps: ['view'] });
    a.set({ at: T0 + 2, by: SAHIL, whom: JHALAK, page: 'numbers', caps: null });
    const b = createGrantStore({ backing: createJsonlStore({ dir, plane: 'grants' }) });
    assert.deepEqual(b.grantsOf(JHALAK), { leads: ['view'] });
    const text = fs.readdirSync(dir).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('');
    assert.equal(text.trim().split('\n').length, 3);
    assert.doesNotMatch(text, /@|Jhalak|Sahil|Mehta/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

/* ---- the rules (capSave, server side) ------------------------------------------------------------ */

test('acceptance: Sahil grants Jhalak Leads — "See it" is granted and she now signs in', () => {
  const v = decideGrant(SAHIL, { op: 'add', whom: JHALAK, page: 'leads', cap: 'view' }, book([SAHIL, PRADEEP, JHALAK]));
  assert.equal(v.ok, true);
  assert.deepEqual([...v.caps], ['view']);
  assert.equal(v.code, 'leads-view-add');
  assert.equal(v.accountBefore, false); assert.equal(v.accountAfter, true);
});

test('acceptance: "edit" or "assign" on Leads for Jhalak is refused — her seat cannot hold it, whoever grants it', () => {
  for (const cap of ['edit', 'assign']) {
    const v = decideGrant(SAHIL, { op: 'add', whom: JHALAK, page: 'leads', cap }, book([SAHIL, PRADEEP, JHALAK], { [JHALAK]: { leads: ['view'] } }));
    assert.equal(v.ok, false, cap); assert.equal(v.refusal, 'seat-cannot-hold');
    assert.equal(v.message, 'Their role cannot hold this, whoever grants it.');
  }
});

test('TC-E03-013: the IR Manager cannot grant the Ops Lead (exec) anything; she may grant her own IR what she holds', () => {
  const b = book([SAHIL, PRADEEP, TASNEEM, ROHIT, JHALAK]);
  const j = decideGrant(TASNEEM, { op: 'add', whom: JHALAK, page: 'leads', cap: 'view' }, b);
  assert.equal(j.ok, false); assert.equal(j.refusal, 'cannot-manage');
  const r = decideGrant(TASNEEM, { op: 'add', whom: ROHIT, page: 'numbers', cap: 'view' }, b);
  assert.equal(r.ok, true); assert.deepEqual([...r.caps], ['view']);
  const sys = decideGrant(TASNEEM, { op: 'add', whom: ROHIT, page: 'system', cap: 'view' }, b);
  assert.equal(sys.ok, false); assert.equal(sys.refusal, 'not-held', 'never hand out what you do not hold');
  const self = decideGrant(TASNEEM, { op: 'add', whom: TASNEEM, page: 'numbers', cap: 'view' }, b);
  assert.equal(self.ok, false); assert.equal(self.refusal, 'cannot-manage');
});

test('rules: Profile is nobody\'s to grant; unknown pages/caps are bad requests; taking "view" takes the page; reset', () => {
  const b = book([SAHIL, PRADEEP, JHALAK], { [JHALAK]: { leads: ['view'] } });
  assert.equal(decideGrant(SAHIL, { op: 'add', whom: JHALAK, page: 'me', cap: 'view' }, b).refusal, 'own-profile');
  assert.equal(decideGrant(SAHIL, { op: 'add', whom: JHALAK, page: 'nope', cap: 'view' }, b).refusal, 'bad-request');
  assert.equal(decideGrant(SAHIL, { op: 'add', whom: JHALAK, page: 'leads', cap: 'fly' }, b).refusal, 'bad-request');
  assert.equal(decideGrant(SAHIL, { op: 'add', whom: JHALAK, page: 'add', cap: 'view' }, b).refusal, 'bad-request', 'a nopage route is not granted');
  const off = decideGrant(SAHIL, { op: 'remove', whom: JHALAK, page: 'leads', cap: 'view' }, b);
  assert.equal(off.ok, true); assert.deepEqual([...off.caps], []); assert.equal(off.accountAfter, false);
  const reset = decideGrant(SAHIL, { op: 'reset', whom: JHALAK, page: 'leads' }, b);
  assert.equal(reset.ok, true); assert.equal(reset.caps, null); assert.equal(reset.code, 'leads-reset');
  /* Finance never signs in here: nothing can be granted to Harsha on the lead side */
  assert.equal(decideGrant(SAHIL, { op: 'add', whom: HARSHA, page: 'leads', cap: 'view' }, book([SAHIL, PRADEEP, HARSHA])).ok, false);
});

test('acceptance: with the grant, Jhalak reaches Leads and Profile only, and cannot edit or assign', async () => {
  const s = createGrantStore();
  s.set({ at: T0, by: SAHIL, whom: JHALAK, page: 'leads', caps: ['view'] });
  const a = seatAccess('viewer', JHALAK, s.grantsOf(JHALAK));
  assert.equal(a.admission.ok, true);
  assert.deepEqual(a.capsFor('leads'), ['view']);
  assert.equal(a.may('leads', 'edit'), false); assert.equal(a.may('leads', 'assign'), false);
  const sink = createPlaneCMemorySink();
  const g = createGuard({ mode: () => 'enforce', planeC: createPlaneCLog(sink), grants: grantReaderOf(s), clock: () => T0,
    readSession: async () => ({ ok: true, session: { who: JHALAK, seat: 'exec' } }) });
  assert.equal((await g.page('leads')).ok, true);
  assert.equal((await g.page('me')).ok, true);
  for (const p of ['today', 'activity', 'events', 'pay', 'docs', 'people', 'numbers', 'system']) assert.equal((await g.page(p)).ok, false, p);
  const lines = sink.events();
  assert.equal(lines[0].action, 'refused-page'); assert.equal(lines[0].reason, 'today'); assert.equal(lines[0].seat, 'exec');
  assert.equal((await g.api('/api/grants')).ok, false, 'a Leads grant is not Teams');
  assert.equal(sink.events().at(-1).action, 'refused-action'); assert.equal(sink.events().at(-1).reason, 'api-grants');
  /* the grant taken back: the door refuses her at once */
  s.set({ at: T0, by: SAHIL, whom: JHALAK, page: 'leads', caps: null });
  const v = await g.page('leads');
  assert.equal(v.ok, false); assert.equal(v.code, 'no-grant');
});

/* ---- the service, over recorded Zoho Users answers ------------------------------------------------ */

function rig({ session = { who: TASNEEM, seat: 'conv' }, missing = [] } = {}) {
  const store = createGrantStore();
  const sink = createPlaneCMemorySink();
  const calls = [];
  const log = { call: (e) => calls.push(e), refusal: () => {} };
  const gate = { acquire: async () => ({ cls: 'simple', waitedMs: 0, release() {} }) };
  const fetch = async (url) => {
    const id = url.split('/').pop();
    const ok = FILES[id] && !missing.includes(id);
    const text = ok ? fs.readFileSync(path.join(consoleRoot, 'src/lib/zoho/__fixtures__/grants', `users.${FILES[id]}.response.json`), 'utf8') : '';
    return { status: ok ? 200 : 204, text: async () => text, headers: { get: () => null } };
  };
  const users = createZohoUserDirectory({ seats, gate, log, fetch, clock: () => T0 });
  const svc = createGrantService({ store, users, events: createAuthorityEvents(createPlaneCLog(sink), () => T0), clock: () => T0 });
  const as = { userId: session.who, apiDomain: 'https://www.zohoapis.in', accessToken: 'redacted' };
  return { store, sink, calls, svc, as, session };
}

test('service: Tasneem grants her IR Numbers — stored, one Plane C grant-change of ids and codes, Plane B lines hold no body', async () => {
  const r = rig();
  const out = await r.svc.change(r.as, r.session, { op: 'add', whom: ROHIT, page: 'numbers', cap: 'view' });
  assert.equal(out.ok, true); assert.deepEqual(out.grants, { numbers: ['view'] });
  assert.deepEqual(r.store.grantsOf(ROHIT), { numbers: ['view'] });
  const lines = r.sink.events();
  assert.equal(lines.length, 1);
  assert.deepEqual({ ...lines[0] }, { at: T0, who: TASNEEM, whom: ROHIT, action: 'grant-change', outcome: 'ok', reason: 'numbers-view-add', seat: 'conv' });
  assert.ok(r.calls.length >= 2);
  assert.ok(r.calls.every((c) => c.endpoint === '/users/{id}' && c.op === 'getUser'));
  assert.doesNotMatch(JSON.stringify([lines, r.calls]), /@|Test User|Manager /);
});

test('service: refusals change nothing and file a refused grant-change (cannot-manage, seat moved, unknown person, a manager Zoho will not show)', async () => {
  const r = rig();
  const j = await r.svc.change(r.as, r.session, { op: 'add', whom: JHALAK, page: 'leads', cap: 'view' });
  assert.equal(j.ok, false); assert.equal(j.status, 403); assert.equal(j.refusal, 'cannot-manage');
  assert.deepEqual(r.store.grantsOf(JHALAK), {});
  assert.equal(r.sink.events()[0].outcome, 'refused'); assert.equal(r.sink.events()[0].reason, 'leads-view-add');
  const moved = rig({ session: { who: TASNEEM, seat: 'ir' } });
  assert.equal((await moved.svc.change(moved.as, moved.session, { op: 'add', whom: ROHIT, page: 'numbers', cap: 'view' })).refusal, 'cannot-manage');
  assert.equal(moved.sink.events()[0].reason, 'seat-moved');
  const nobody = rig();
  const u = await nobody.svc.change(nobody.as, nobody.session, { op: 'add', whom: '554023000000399999', page: 'numbers', cap: 'view' });
  assert.equal(u.status, 404);
  /* Tasneem's own manager unreadable: the chain would lose a bound, so the change is refused (fail closed) */
  const gap = rig({ missing: [SAHIL] });
  assert.equal((await gap.svc.change(gap.as, gap.session, { op: 'add', whom: ROHIT, page: 'numbers', cap: 'view' })).status, 503);
  assert.deepEqual(gap.store.grantsOf(ROHIT), {});
});

test('service: Sahil (Digital Infrastructure) holds no console session token today, so the API refuses him (D80 Administrator profile — a human item)', async () => {
  const r = rig({ session: { who: SAHIL, seat: 'ops' } });
  const out = await r.svc.change(r.as, r.session, { op: 'add', whom: JHALAK, page: 'leads', cap: 'view' });
  assert.equal(out.ok, false); assert.equal(out.refusal, 'cannot-manage');
  assert.equal(r.sink.events()[0].reason, 'seat-moved');
  assert.ok(GRANT_REFUSALS['cannot-manage'].length > 10);
});
