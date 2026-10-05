/* M03-S04-T02 SEAT CHANGE THROUGH THE GRANTS ENGINE — maySeat server-side over recorded Zoho Users answers,
 * PUT /users/{id} role+profile on the changer's own token, the KAM book listed by the "kam-pool-return"
 * org-scope read and returned to the pool with guarded writes, Plane C seat-change (who, whom, from, to, count).
 *
 * Run from console/: node --test src/server/access/seat-change.test.cjs
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
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'server-seat-change-'));
process.on('exit', () => fs.rmSync(outDir, { recursive: true, force: true }));
const config = ts.readConfigFile(path.join(consoleRoot, 'tsconfig.json'), ts.sys.readFile);
const project = ts.parseJsonConfigFileContent(config.config, ts.sys, consoleRoot);
const options = {
  ...project.options, incremental: false, tsBuildInfoFile: undefined, plugins: undefined,
  module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10,
  noEmit: false, noEmitOnError: true, outDir, rootDir: consoleRoot,
};
const sources = ['src/server/access/seat-change.ts', 'src/server/identity/users.ts', 'src/server/identity/authority.ts', 'src/lib/zoho/client.ts'].map((f) => path.join(consoleRoot, f));
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
const FXDIR = path.join(consoleRoot, 'src', 'lib', 'zoho', '__fixtures__');
const FX = (area, name) => JSON.parse(fs.readFileSync(path.join(FXDIR, area, name), 'utf8'));

const { createSeatChangeService, kamBookOrgRead, IM_SEAT_TO_ZOHO, SEAT_REFUSALS } = load('src/server/access/seat-change.js');
const { createZohoUserDirectory } = load('src/server/identity/users.js');
const { createAuthorityEvents } = load('src/server/identity/authority.js');
const { createPlaneCLog, createPlaneCMemorySink } = load('src/server/identity/plane-c.js');
const { createZohoSeatDirectory } = load('src/server/oauth/seat.js');
const { createZohoClient, createZohoServiceClient, userCredential, serviceCredential } = load('src/lib/zoho/client.js');
const { createMemorySink, createOpsLog } = load('src/lib/zoho/log.js');

const P = '554023000000';
const PRADEEP = P + '300001', SAHIL = P + '300003', HARSHA = P + '300007', MEENA = P + '300008',
  DIVYA = P + '300010', IMRAN = P + '300011', NEHA = P + '300013', ROHIT = P + '300005';
const FILES = { [PRADEEP]: 'pradeep-ceo', [SAHIL]: 'sahil-di', [HARSHA]: 'harsha-head-of-finance', [MEENA]: 'meena-finance-ops',
  [DIVYA]: 'divya-head-am', [IMRAN]: 'imran-kam', [NEHA]: 'neha-kam' };
const BOOK = ['554023000000400205', '554023000000400212', '554023000000400213', '554023000000400214'];
const T0 = Date.parse('2026-09-28T12:00:00+05:30');
const seatsFx = FX('oauth', 'current-user.seats.response.json');
const seats = createZohoSeatDirectory({ recordIdPrefix: seatsFx.recordIdPrefix, roleIds: seatsFx.roleIds, profileIds: seatsFx.profileIds });
const gate = () => ({ async acquire() { return { waitedMs: 0, release() {} }; } });
const toResponse = (rec) => new Response(JSON.stringify(rec.body), { status: rec.status, headers: rec.headers || {} });
const userFile = (id) => (FILES[id] ? path.join(FXDIR, 'users', `users.${FILES[id]}.response.json`)
  : id === ROHIT ? path.join(FXDIR, 'grants', 'users.rohit-ir.response.json') : null);

async function credentialOf(who) {
  const name = who === DIVYA ? 'divya' : 'harsha';
  return userCredential({ access_token: `synthetic-${name}-token-never-live`, api_domain: 'https://www.zohoapis.in', expires_in: 3600 },
    { recordIdPrefix: '554023', gate: gate(), log: createOpsLog(createMemorySink()), clock: () => T0,
      fetch: async () => toResponse(FX('users', `current-user.${name}.response.json`)) });
}

/** put: fixture for PUT /users/{id}; contact: (id) => fixture for PUT /Contacts/{id}; book: coql fixture or null (unreadable) */
async function rig({ who = DIVYA, seat = 'amlead', put = 'put.seat.success', contact = () => 'contact.pool.success', book = 'coql.kam-book.imran', poolGrant = true, kamShares } = {}) {
  const calls = [];
  const planeB = createMemorySink();
  const log = createOpsLog(planeB);
  const crm = createZohoClient({ recordIdPrefix: '554023', gate: gate(), log, maxAttempts: 1, clock: () => T0,
    fetch: async (url, init) => {
      const u = new URL(url); const seg = u.pathname.split('/');
      calls.push({ method: init.method, path: u.pathname, body: init.body ? JSON.parse(init.body) : null, headers: init.headers });
      if (init.method === 'PUT' && seg[3] === 'users') return toResponse(FX('users', `${put}.response.json`));
      if (init.method === 'PUT' && seg[3] === 'Contacts') return toResponse(FX('users', `${contact(seg[4])}.response.json`));
      throw new Error(`unexpected ${init.method} ${u.pathname}`);
    } });
  const serviceCalls = [];
  const service = createZohoServiceClient({ recordIdPrefix: '554023', gate: gate(), log, maxAttempts: 1, clock: () => T0,
    fetch: async (url, init) => {
      serviceCalls.push({ path: new URL(url).pathname, q: JSON.parse(init.body).select_query, auth: init.headers.Authorization });
      if (!book) return toResponse({ status: 500, body: { code: 'INTERNAL_ERROR' } });
      return toResponse(FX('users', `${book}.response.json`));
    } });
  const svcCred = serviceCredential('kam-pool-return', { access_token: 'synthetic-pool-token-never-live', api_domain: 'https://www.zohoapis.in', expires_in: 3600 }, T0);
  const users = createZohoUserDirectory({ seats, gate: gate(), log, clock: () => T0,
    fetch: async (url) => { const f = userFile(url.split('/').pop()); return { status: f ? 200 : 204, text: async () => (f ? fs.readFileSync(f, 'utf8') : ''), headers: { get: () => null } }; } });
  const sink = createPlaneCMemorySink();
  const ended = [];
  const svc = createSeatChangeService({
    users, seats, crm, kamBook: kamBookOrgRead(service, async () => (poolGrant ? svcCred : null)),
    events: createAuthorityEvents(createPlaneCLog(sink), () => T0), clock: () => T0,
    sessions: { endSessionsOf: async (w, r) => { ended.push([w, r]); return 1; } },
    kamShares,
  });
  const as = await credentialOf(who);
  return { svc, as, session: { who, seat }, calls, serviceCalls, sink, ended, planeB };
}

test('the Investors seats a seat change can write: only non-Administrator Zoho roles (never super admin or super user)', () => {
  assert.deepEqual({ ...IM_SEAT_TO_ZOHO }, { head: 'head-of-finance', ops: 'finance-operations', comp: 'compliance-audit', amlead: 'head-of-account-management', kam: 'key-account-manager' });
  assert.equal(seats.seatWrite('digital-infrastructure'), null);
  assert.deepEqual({ ...seats.seatWrite('head-of-account-management') }, { roleId: P + '100010', roleName: 'Head of Account Management', profileId: P + '200009', profileName: 'AM Head' });
});

test('TC-IM02-024: Divya moves Imran (KAM) to Head of AM — Zoho role+profile written on her token, 4 accounts back to the pool, Plane C who/whom/from/to/count', async () => {
  const r = await rig();
  const out = await r.svc.change(r.as, r.session, { whom: IMRAN, to: 'amlead' });
  assert.equal(out.ok, true);
  assert.deepEqual([out.from, out.to], ['kam', 'amlead']);
  assert.deepEqual([...out.returned], BOOK); assert.deepEqual([...out.notReturned], []);
  /* the book was listed by the org-scope service read, not Divya's own book */
  assert.equal(r.serviceCalls.length, 1);
  assert.match(r.serviceCalls[0].q, new RegExp(`^select id, Modified_Time from Contacts where KAM = '${IMRAN}' order by id asc limit 0, 200$`));
  assert.equal(r.serviceCalls[0].auth, 'Zoho-oauthtoken synthetic-pool-token-never-live');
  const [put, ...clears] = r.calls;
  assert.equal(put.method, 'PUT'); assert.equal(put.path, `/crm/v8/users/${IMRAN}`);
  assert.deepEqual(put.body, { users: [{ id: IMRAN, role: { id: P + '100010', name: 'Head of Account Management' }, profile: { id: P + '200009', name: 'AM Head' } }] });
  assert.equal(put.headers.Authorization, 'Zoho-oauthtoken synthetic-divya-token-never-live', 'D53: on the changer\'s own token');
  assert.deepEqual(clears.map((c) => c.path), BOOK.map((id) => `/crm/v8/Contacts/${id}`));
  for (const c of clears) {
    assert.deepEqual(c.body, { data: [{ KAM: null, KAM_Since: null, KAM_Intro_At: null }] });
    assert.equal(c.headers['If-Unmodified-Since'], '2026-09-20T10:00:00+05:30', 'guarded write');
    assert.equal(c.headers.Authorization, 'Zoho-oauthtoken synthetic-divya-token-never-live');
  }
  const [line] = r.sink.events();
  assert.deepEqual({ ...line, recordIds: [...line.recordIds] }, { at: T0, who: DIVYA, whom: IMRAN, action: 'seat-change', outcome: 'ok', reason: 'kam-to-amlead', seat: 'amlead', count: 4, recordIds: BOOK });
  assert.deepEqual(r.ended, [[IMRAN, 'seat-changed']], 'the moved person\'s sessions end at once');
  assert.doesNotMatch(JSON.stringify([r.sink.events(), r.planeB.records()]), /Test User|@example|never-live/);
});

test('D121 A: a KAM moved off the seat — the share service revokes their shares on every Contact returned to the pool', async () => {
  const ran = [], queued = [];
  const r = await rig({ kamShares: { run: async (t) => { ran.push(t); return 'shared'; }, enqueue: async (t) => { queued.push(t); return true; } } });
  const out = await r.svc.change(r.as, r.session, { whom: IMRAN, to: 'amlead' });
  assert.equal(out.ok, true);
  assert.deepEqual(ran, BOOK.map((contactId) => ({ contactId, toKam: null, fromKam: IMRAN })));
  assert.deepEqual(queued, []);
  /* a share service that throws never fails the seat change */
  const r2 = await rig({ kamShares: { run: async () => { throw new Error('boom'); }, enqueue: async () => true } });
  assert.equal((await r2.svc.change(r2.as, r2.session, { whom: IMRAN, to: 'amlead' })).ok, true);
});

test('TC-IM02-025: Head of Finance (may move any seat) moving a KAM also returns the book to the pool', async () => {
  const r = await rig({ who: HARSHA, seat: 'head' });
  const out = await r.svc.change(r.as, r.session, { whom: IMRAN, to: 'amlead' });
  assert.equal(out.ok, true); assert.equal(out.returned.length, 4);
  assert.equal(r.sink.events()[0].count, 4);
});

test('TC-IM02-023: the Head of AM may seat her own team only as Head of AM or KAM; another team\'s seat is refused and nothing is written', async () => {
  for (const to of ['head', 'ops', 'comp']) {
    const r = await rig();
    const out = await r.svc.change(r.as, r.session, { whom: IMRAN, to });
    assert.equal(out.ok, false, to); assert.equal(out.refusal, 'cannot-seat'); assert.equal(out.status, 403);
    assert.equal(r.calls.length, 0); assert.equal(r.serviceCalls.length, 0);
  }
  const fin = await rig();
  const x = await fin.svc.change(fin.as, fin.session, { whom: MEENA, to: 'kam' });
  assert.equal(x.refusal, 'cannot-seat', 'Finance Operations is another team\'s seat');
  assert.equal(fin.sink.events()[0].outcome, 'refused'); assert.equal(fin.sink.events()[0].reason, 'ops-to-kam');
  /* KAM → KAM between her own people is allowed by the rule but is no change */
  const same = await rig();
  assert.equal((await same.svc.change(same.as, same.session, { whom: NEHA, to: 'kam' })).refusal, 'same-seat');
});

test('own row, the super admin\'s row and "super admin" as a target are refused by everyone', async () => {
  const own = await rig();
  assert.equal((await own.svc.change(own.as, own.session, { whom: DIVYA, to: 'kam' })).refusal, 'own-seat');
  const h = await rig({ who: HARSHA, seat: 'head' });
  for (const [whom, to] of [[PRADEEP, 'head'], [SAHIL, 'ops'], [IMRAN, 'root'], [IMRAN, 'di']]) {
    const out = await h.svc.change(h.as, h.session, { whom, to });
    assert.equal(out.refusal, 'super-admin', `${whom} → ${to}`); assert.equal(out.status, 403);
  }
  /* seats with no Zoho role (Auditor, Administrator) and people with no Investors seat (an IR) */
  assert.equal((await h.svc.change(h.as, h.session, { whom: IMRAN, to: 'audit' })).refusal, 'cannot-seat');
  assert.equal((await h.svc.change(h.as, h.session, { whom: IMRAN, to: 'admin' })).refusal, 'cannot-seat');
  assert.equal((await h.svc.change(h.as, h.session, { whom: ROHIT, to: 'kam' })).refusal, 'cannot-seat');
  assert.equal((await h.svc.change(h.as, h.session, { whom: IMRAN, to: 'nope' })).refusal, 'bad-request');
  assert.equal(h.calls.length, 0);
  assert.ok(SEAT_REFUSALS['super-admin'].length > 10);
});

test('the changer\'s session seat must still be their Zoho seat; an unknown person is 404', async () => {
  const moved = await rig({ seat: 'kam' });
  assert.equal((await moved.svc.change(moved.as, moved.session, { whom: IMRAN, to: 'amlead' })).refusal, 'seat-moved');
  const r = await rig();
  const u = await r.svc.change(r.as, r.session, { whom: P + '399999', to: 'kam' });
  assert.equal(u.status, 404);
  const forged = await rig();
  assert.equal((await forged.svc.change(forged.as, { who: HARSHA, seat: 'head' }, { whom: IMRAN, to: 'amlead' })).refusal, 'seat-moved');
});

test('the KAM\'s book unreadable (Zoho error, or the kam-pool-return grant missing) — the seat is not changed', async () => {
  for (const o of [{ book: null }, { poolGrant: false }]) {
    const r = await rig(o);
    const out = await r.svc.change(r.as, r.session, { whom: IMRAN, to: 'amlead' });
    assert.equal(out.ok, false); assert.equal(out.refusal, 'book-unreadable'); assert.equal(out.status, 503);
    assert.equal(r.calls.length, 0, 'no Users PUT, no Contact write');
  }
});

test('Zoho refuses the Users PUT: nothing returned to the pool, refused seat-change line', async () => {
  const r = await rig({ put: 'put.seat.no-permission' });
  const out = await r.svc.change(r.as, r.session, { whom: IMRAN, to: 'amlead' });
  assert.equal(out.ok, false); assert.equal(out.refusal, 'zoho-refused');
  assert.equal(r.calls.length, 1);
  assert.equal(r.sink.events()[0].outcome, 'refused'); assert.deepEqual(r.ended, []);
});

test('a Contact changed since it was listed is not overwritten: reported as not returned; the count is what was returned', async () => {
  const r = await rig({ contact: (id) => (id === BOOK[1] ? 'contact.pool.already-modified' : 'contact.pool.success') });
  const out = await r.svc.change(r.as, r.session, { whom: IMRAN, to: 'amlead' });
  assert.equal(out.ok, true);
  assert.deepEqual([...out.notReturned], [BOOK[1]]); assert.equal(out.returned.length, 3);
  assert.equal(r.sink.events()[0].count, 3);
});

test('a non-KAM move (Head of AM → KAM) lists no book', async () => {
  const r = await rig({ who: HARSHA, seat: 'head' });
  const out = await r.svc.change(r.as, r.session, { whom: DIVYA, to: 'kam' });
  assert.equal(out.ok, true); assert.deepEqual([...out.returned], []);
  assert.equal(r.serviceCalls.length, 0); assert.equal(r.calls.length, 1);
  assert.equal(r.sink.events()[0].reason, 'amlead-to-kam'); assert.equal(r.sink.events()[0].count, 0);
});

test('client: updateUserSeat is a user-token write only, never to oneself', async () => {
  const crm = createZohoClient({ recordIdPrefix: '554023', gate: gate(), log: createOpsLog(createMemorySink()), fetch: async () => { throw new Error('no call'); } });
  const svcCred = serviceCredential('kam-pool-return', { access_token: 'x-never-live', api_domain: 'https://www.zohoapis.in', expires_in: 3600 }, T0);
  const w = { roleId: P + '100011', roleName: 'Key Account Manager', profileId: P + '200010', profileName: 'KAM' };
  await assert.rejects(() => crm.updateUserSeat(svcCred, IMRAN, w));
  const as = await credentialOf(DIVYA);
  await assert.rejects(() => crm.updateUserSeat(as, DIVYA, w));
  await assert.rejects(() => crm.updateUserSeat(as, IMRAN, { ...w, roleId: 'x' }));
});

/* ---- M18-S09-NOTE-3: a KAM book of 200 inside the request deadline ---------------------------------------- */
const { runWithDeadline } = load('src/lib/zoho/deadline.js');
const BIG = 200;
const CID = (i) => `5540230000005${String(i).padStart(5, '0')}`;
/** Imran's book of 200 in a stateful stand-in: KAM cleared per Contact (slow), his seat flips on the Users PUT. */
async function bigRig({ putMs = 0, refuse = () => false, deps = {} } = {}) {
  const kam = new Map(Array.from({ length: BIG }, (_, i) => [CID(i), true]));
  let moved = false, live = 0, peak = 0, seatPuts = 0;
  const writes = new Map();
  const log = createOpsLog(createMemorySink());
  const crm = createZohoClient({ recordIdPrefix: '554023', gate: gate(), log, maxAttempts: 1, clock: () => T0,
    fetch: async (url, init) => {
      const seg = new URL(url).pathname.split('/');
      if (init.method === 'PUT' && seg[3] === 'users') { seatPuts++; moved = true; return toResponse(FX('users', 'put.seat.success.response.json')); }
      if (init.method === 'PUT' && seg[3] === 'Contacts') {
        live++; peak = Math.max(peak, live);
        if (putMs) await new Promise((r) => setTimeout(r, putMs));
        live--;
        writes.set(seg[4], (writes.get(seg[4]) ?? 0) + 1);
        if (refuse(seg[4])) return toResponse(FX('users', 'contact.pool.already-modified.response.json'));
        kam.set(seg[4], false);
        return toResponse(FX('users', 'contact.pool.success.response.json'));
      }
      throw new Error(`unexpected ${init.method}`);
    } });
  const service = createZohoServiceClient({ recordIdPrefix: '554023', gate: gate(), log, maxAttempts: 1, clock: () => T0,
    fetch: async (url, init) => {
      const q = JSON.parse(init.body).select_query;
      const [, off, n] = /limit (\d+), (\d+)$/.exec(q).map(Number);
      const all = [...kam].filter(([, k]) => k).map(([id]) => id);
      const page = all.slice(off, off + n);
      return toResponse({ status: 200, body: { data: page.map((id) => ({ id, Modified_Time: '2026-09-20T10:00:00+05:30' })), info: { count: page.length, more_records: off + n < all.length } } });
    } });
  const svcCred = serviceCredential('kam-pool-return', { access_token: 'synthetic-pool-token-never-live', api_domain: 'https://www.zohoapis.in', expires_in: 3600 }, T0);
  const asAmLead = () => fs.readFileSync(userFile(DIVYA), 'utf8').replaceAll(DIVYA, IMRAN);
  const users = createZohoUserDirectory({ seats, gate: gate(), log, clock: () => T0,
    fetch: async (url) => {
      const id = url.split('/').pop();
      const text = id === IMRAN && moved ? asAmLead() : fs.readFileSync(userFile(id), 'utf8');
      return { status: 200, text: async () => text, headers: { get: () => null } };
    } });
  const sink = createPlaneCMemorySink();
  const svc = createSeatChangeService({ users, seats, crm, kamBook: kamBookOrgRead(service, async () => svcCred),
    events: createAuthorityEvents(createPlaneCLog(sink), () => T0), clock: () => T0, sessions: { endSessionsOf: async () => 1 }, ...deps });
  return { svc, as: await credentialOf(DIVYA), session: { who: DIVYA, seat: 'amlead' }, kam, writes, sink,
    get peak() { return peak; }, get seatPuts() { return seatPuts; } };
}

test('M18-S09-NOTE-3: 200 investors go back to the pool 4 at a time in one call when time allows', async () => {
  const r = await bigRig({ putMs: 1 });
  const out = await r.svc.change(r.as, r.session, { whom: IMRAN, to: 'amlead' });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.returned.length, BIG);
  assert.equal(out.continueFrom, null);
  assert.ok(r.peak > 1 && r.peak <= 4, `peak ${r.peak}`);
  assert.ok([...r.kam.values()].every((k) => !k));
  assert.deepEqual([...out.returned], Array.from({ length: BIG }, (_, i) => CID(i)), 'reported in book order');
});

test('M18-S09-NOTE-3: past the stop margin the clears stop; the page continues with continueFrom until done — each Contact written once, the seat once', async () => {
  const bad = CID(7);
  const r = await bigRig({ putMs: 10, refuse: (id) => id === bad, deps: { stopMarginMs: 30 } });
  let out = await runWithDeadline({ signal: new AbortController().signal, at: Date.now() + 90 }, () => r.svc.change(r.as, r.session, { whom: IMRAN, to: 'amlead' }));
  assert.equal(out.ok, true);
  assert.ok(out.continueFrom, 'stopped part-way');
  const returned = [...out.returned], notReturned = [...out.notReturned];
  let calls = 1;
  while (out.ok && out.continueFrom && calls < 60) {
    const from = out.continueFrom;
    out = await runWithDeadline({ signal: new AbortController().signal, at: Date.now() + 90 },
      () => r.svc.change(r.as, r.session, { whom: IMRAN, to: 'amlead', continueFrom: from }));
    assert.equal(out.ok, true, JSON.stringify(out));
    returned.push(...out.returned); notReturned.push(...out.notReturned);
    calls++;
  }
  assert.ok(calls > 2, `${calls} calls`);
  assert.equal(out.continueFrom, null);
  assert.equal(r.seatPuts, 1, 'the seat is written once');
  assert.deepEqual(notReturned, [bad], 'the refused Contact is reported, and not retried by a continuation');
  assert.equal(returned.length, BIG - 1);
  assert.ok([...r.writes.values()].every((n) => n === 1), 'no Contact written twice');
  const lines = r.sink.events().filter((x) => x.action === 'seat-change');
  assert.equal(lines[0].reason, 'kam-to-amlead');
  assert.ok(lines.slice(1).every((x) => x.reason === 'kam-to-amlead-continued' && x.outcome === 'ok'));
  assert.equal(lines.reduce((t, x) => t + x.count, 0), BIG - 1);
});

test('M18-S09-NOTE-3: a continuation for someone still a KAM, or with a bad cursor, is refused and writes nothing', async () => {
  const r = await bigRig();
  const a = await r.svc.change(r.as, r.session, { whom: IMRAN, to: 'kam', continueFrom: CID(0) });
  assert.equal(a.ok, false); assert.equal(a.refusal, 'bad-request');
  const b = await r.svc.change(r.as, r.session, { whom: IMRAN, to: 'amlead', continueFrom: 'x' });
  assert.equal(b.ok, false); assert.equal(b.refusal, 'bad-request');
  assert.equal(r.writes.size, 0); assert.equal(r.seatPuts, 0);
});
