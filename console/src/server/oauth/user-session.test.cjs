/* M01-S02 ZOHO SIGN-IN, SIGN-OUT, EXPIRY, REVOKE AND REFUSAL
 *
 * Run from console/: node --test src/server/oauth/user-session.test.cjs
 *
 * Compiles the production modules with the project's strict settings and replays recorded Zoho
 * Accounts / CurrentUser answers. It never calls Zoho and holds no real identity.
 */
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const consoleRoot = path.resolve(__dirname, '..', '..', '..');
const srcRoot = path.join(consoleRoot, 'src');
const fixtureRoot = path.join(srcRoot, 'lib', 'zoho', '__fixtures__', 'oauth');
const ts = require(path.join(consoleRoot, 'node_modules', 'typescript'));
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoho-user-session-'));
process.on('exit', () => fs.rmSync(outDir, { recursive: true, force: true }));

const config = ts.readConfigFile(path.join(consoleRoot, 'tsconfig.json'), ts.sys.readFile);
const project = ts.parseJsonConfigFileContent(config.config, ts.sys, consoleRoot);
const options = {
  ...project.options, incremental: false, tsBuildInfoFile: undefined, plugins: undefined,
  module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10,
  noEmit: false, noEmitOnError: true, outDir, rootDir: srcRoot,
};
const sources = [
  'lib/zoho/errors.ts', 'lib/zoho/gate.ts', 'lib/zoho/log.ts', 'lib/zoho/client.ts',
  'server/identity/plane-c.ts', 'server/oauth/seat.ts', 'server/oauth/service-token.ts',
  'server/oauth/crypto.ts', 'server/oauth/zoho-accounts.ts', 'server/oauth/user-session.ts',
].map((f) => path.join(srcRoot, f));
const program = ts.createProgram(sources, options);
const diagnostics = [...ts.getPreEmitDiagnostics(program), ...program.emit().diagnostics];
if (diagnostics.length) {
  console.error(ts.formatDiagnostics(diagnostics, { getCanonicalFileName: (f) => f, getCurrentDirectory: () => consoleRoot, getNewLine: () => '\n' }));
  process.exit(1);
}
/* user-session asks the front end's own access policy (../access/policy -> @/lib/...): map `@/` onto the emitted tree */
const Module = require('node:module');
process.env.NODE_PATH = path.join(consoleRoot, 'node_modules');   /* the emitted tree lives in tmp; `react` etc. come from here */
Module._initPaths();
const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  return resolveFilename.call(this, request.startsWith('@/') ? path.join(outDir, request.slice(2)) : request, ...rest);
};
const load = (f) => require(path.join(outDir, f));
const { createMemorySink, createOpsLog } = load('lib/zoho/log.js');
const { createGate } = load('lib/zoho/gate.js');
const { createPlaneCLog, createPlaneCMemorySink } = load('server/identity/plane-c.js');
const { createZohoSeatDirectory } = load('server/oauth/seat.js');
const { createSealer, pkceChallenge } = load('server/oauth/crypto.js');
const { createZohoAccounts, redirectUriOf } = load('server/oauth/zoho-accounts.js');
const {
  createUserSessions, createMemorySessionStore, NO_GRANTS, SIGNIN_REFUSALS, SESSION_ABSOLUTE_MS, FLOW_TTL_MS,
} = load('server/oauth/user-session.js');

const readJson = (n) => JSON.parse(fs.readFileSync(path.join(fixtureRoot, n), 'utf8'));
const seats = readJson('current-user.seats.response.json');
const codeGrant = readJson('user-token.code.response.json');
const refreshGrant = readJson('user-token.refresh.response.json');
const invalidCode = readJson('user-token.invalid-code.response.json');
const revokeOk = readJson('user-token.revoke.response.json');

const CLIENT_ID = 'synthetic-user-client-id';
const CLIENT_SECRET = 'synthetic-user-client-secret';
const CODE = 'synthetic-authorization-code-1000.abc';
const REFRESH = codeGrant.body.refresh_token;
const ACCESS = codeGrant.body.access_token;
const ACCESS2 = refreshGrant.body.access_token;
const EMAIL = 'fixture.person@example.invalid';
const FULL_NAME = 'Fixture Person';
const KEY = crypto.randomBytes(32).toString('base64');
const REDIRECT = 'https://console.example.invalid/api/auth/zoho/callback';

/** A CurrentUser body as Zoho sends it: the recorded seat facts plus the identity fields we must never keep. */
const withIdentity = (body) => ({ users: [{ ...body.users[0], email: EMAIL, full_name: FULL_NAME }] });
const accepted = (seat) => withIdentity(seats.accepted.find((x) => x.seat === seat).body);

const reply = (recording) => ({
  status: recording.status,
  headers: { get: (n) => (recording.headers || {})[n.toLowerCase()] || null },
  text: async () => JSON.stringify(recording.body),
  body: null,
});
const streamReply = (status, obj) => {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let sent = false;
  return {
    status,
    headers: { get: () => null },
    body: { getReader: () => ({ read: async () => (sent ? { done: true } : (sent = true, { done: false, value: bytes })), cancel: async () => {}, releaseLock() {} }) },
    text: async () => { throw new Error('the streamed reader is authoritative'); },
  };
};
const clockAt = (t) => { let now = t; const c = () => now; c.advance = (ms) => { now += ms; }; return c; };

function harness({ user = accepted('ir-manager'), grants = NO_GRANTS, token = {} } = {}) {
  const clock = clockAt(1_800_000_000_000);
  const planeB = createMemorySink();
  const log = createOpsLog(planeB);
  const planeCSink = createPlaneCMemorySink();
  const store = createMemorySessionStore();
  const calls = { token: [], revoke: [], identity: [] };
  const state = { user, identityStatus: 200, answers: { authorization_code: codeGrant, refresh_token: refreshGrant, ...token } };
  const fetch = async (url, init) => {
    if (url.includes('/oauth/v2/token/revoke')) { calls.revoke.push({ url, init }); return reply(revokeOk); }
    const form = new URLSearchParams(init.body);
    calls.token.push({ url, init, form });
    const a = state.answers[form.get('grant_type')];
    if (a instanceof Error) throw a;
    return reply(a);
  };
  const identityFetch = async (url, init) => { calls.identity.push({ url, init }); return streamReply(state.identityStatus, state.user); };
  const accounts = createZohoAccounts({
    accountsOrigin: 'https://accounts.zoho.in', clientId: CLIENT_ID, clientSecret: CLIENT_SECRET,
    redirectUri: REDIRECT, scopes: ['ZohoCRM.users.READ', 'ZohoCRM.modules.ALL'], log, fetch, clock,
  });
  const sessions = createUserSessions({
    accounts, sealer: createSealer(KEY), store,
    seats: createZohoSeatDirectory({ recordIdPrefix: seats.recordIdPrefix, roleIds: seats.roleIds, profileIds: seats.profileIds }),
    grants, planeC: createPlaneCLog(planeCSink), gate: createGate(), log, recordIdPrefix: seats.recordIdPrefix,
    identityFetch, clock,
  });
  return { sessions, store, planeB, planeCSink, calls, clock, state };
}

/** Walks start → callback as the browser would. */
async function signIn(h, over = {}) {
  const { url, flowCookie } = h.sessions.start();
  const u = new URL(url);
  const params = { code: CODE, state: u.searchParams.get('state'), error: null, accountsServer: 'https://accounts.zoho.in', ...over };
  return { result: await h.sessions.callback(params, over.flowCookie !== undefined ? over.flowCookie : flowCookie), url: u };
}

function assertNothingSecret(h) {
  const dump = JSON.stringify([h.planeB.records ? h.planeB.records() : null, h.planeCSink.events(), h.store.raw()]);
  for (const s of [CLIENT_ID, CLIENT_SECRET, CODE, REFRESH, ACCESS, ACCESS2, EMAIL, FULL_NAME]) {
    assert.ok(!dump.includes(s), `logs and store must not contain ${JSON.stringify(s)}`);
  }
}

test('start: Zoho authorize URL on the pinned data centre with state and an S256 PKCE challenge', () => {
  const h = harness();
  const { url, flowCookie } = h.sessions.start();
  const u = new URL(url);
  assert.equal(u.origin + u.pathname, 'https://accounts.zoho.in/oauth/v2/auth');
  const q = u.searchParams;
  assert.equal(q.get('response_type'), 'code');
  assert.equal(q.get('client_id'), CLIENT_ID);
  assert.equal(q.get('redirect_uri'), REDIRECT);
  assert.equal(q.get('access_type'), 'offline');
  assert.equal(q.get('code_challenge_method'), 'S256');
  assert.match(q.get('state'), /^[A-Za-z0-9_-]{43}$/);
  assert.match(q.get('code_challenge'), /^[A-Za-z0-9_-]{43}$/);
  assert.equal(q.get('scope'), 'ZohoCRM.users.READ,ZohoCRM.modules.ALL');
  assert.ok(!flowCookie.includes(q.get('state')), 'the flow cookie is sealed, not plain');
  const second = new URL(h.sessions.start().url).searchParams;
  assert.notEqual(second.get('state'), q.get('state'));
  assert.notEqual(second.get('code_challenge'), q.get('code_challenge'));
});

test('callback: a seated Zoho user gets a server session with the refresh token sealed at rest', async () => {
  const h = harness();
  const { result, url } = await signIn(h);
  assert.equal(result.ok, true);
  assert.deepEqual(result.session, { who: '554023000000300004', seat: 'conv' });
  assert.match(result.sid, /^[A-Za-z0-9_-]{43}$/);

  const t = h.calls.token[0];
  assert.equal(t.url, 'https://accounts.zoho.in/oauth/v2/token');
  assert.equal(t.form.get('grant_type'), 'authorization_code');
  assert.equal(t.form.get('code'), CODE);
  assert.equal(t.form.get('redirect_uri'), REDIRECT);
  assert.equal(pkceChallenge(t.form.get('code_verifier')), url.searchParams.get('code_challenge'), 'the verifier matches the challenge');
  assert.equal(h.calls.identity.length, 1, 'one CurrentUser request resolves both the credential and the seat');
  assert.equal(h.calls.identity[0].url, 'https://www.zohoapis.in/crm/v8/users?type=CurrentUser');

  const [rec] = h.store.raw();
  assert.equal(h.store.size(), 1);
  assert.ok(rec.sealedRefresh.startsWith('v1.'));
  assert.ok(!JSON.stringify(rec).includes(REFRESH));
  assert.ok(!JSON.stringify(rec).includes(result.sid), 'the store is keyed by a hash, never the cookie value');
  assert.equal(rec.expiresAt - rec.createdAt, SESSION_ABSOLUTE_MS);

  const cur = await h.sessions.current(result.sid);
  assert.deepEqual(cur, { ok: true, session: result.session, expiresAt: rec.expiresAt });
  const cred = await h.sessions.credential(result.sid);
  assert.equal(cred.ok, true);
  assert.equal(cred.credential.accessToken, ACCESS);
  assert.equal(cred.credential.userId, '554023000000300004');

  const events = h.planeCSink.events();
  assert.deepEqual(events.map((e) => [e.action, e.outcome, e.who, e.seat]), [['sign-in', 'ok', '554023000000300004', 'conv']]);
  assertNothingSecret(h);
});

test('every accepted non-administrator seat maps to its console seat token', async () => {
  const want = { 'business-unit-owner': 'bu', 'ir-manager': 'conv', 'investor-relations': 'ir', 'channel-partner': 'cp',
    'head-of-finance': 'head', 'finance-operations': 'fin', 'compliance-audit': 'comp', 'head-of-account-management': 'amlead',
    'key-account-manager': 'kam', viewer: 'exec' };
  for (const [zseat, seat] of Object.entries(want)) {
    const h = harness({ user: accepted(zseat), grants: { grantsOf: () => ({ leads: ['view'] }) } });
    const { result } = await signIn(h);
    assert.equal(result.ok, true, zseat);
    assert.equal(result.session.seat, seat, zseat);
  }
});

test('Continue with Zoho with no completed flow never enters a seat', async () => {
  const h = harness();
  for (const over of [
    { flowCookie: null },
    { flowCookie: 'v1.AAAA.BBBB.CCCC' },
    { state: 'x'.repeat(43) },
    { state: null },
  ]) {
    const { result } = await signIn(h, over);
    assert.deepEqual(result, { ok: false, code: 'failed', message: SIGNIN_REFUSALS.failed });
  }
  assert.equal(h.calls.token.length, 0, 'no code is ever traded without the matching state');
  assert.equal(h.store.size(), 0);
});

test('an expired flow, a cancelled consent and a foreign data centre are refused before any token call', async () => {
  const h = harness();
  const { url, flowCookie } = h.sessions.start();
  h.clock.advance(FLOW_TTL_MS + 1);
  const late = await h.sessions.callback({ code: CODE, state: new URL(url).searchParams.get('state'), error: null, accountsServer: null }, flowCookie);
  assert.equal(late.code, 'failed');
  assert.equal((await signIn(h, { error: 'access_denied', code: null })).result.code, 'cancelled');
  assert.equal((await signIn(h, { accountsServer: 'https://accounts.zoho.com' })).result.code, 'failed');
  assert.equal(h.calls.token.length, 0);
  assert.deepEqual(h.planeCSink.events().map((e) => e.reason), ['no-flow', 'denied-at-zoho', 'wrong-dc']);
});

test('a code Zoho refuses (HTTP 200 invalid_code) signs nobody in', async () => {
  const h = harness({ token: { authorization_code: invalidCode } });
  const { result } = await signIn(h);
  assert.equal(result.code, 'failed');
  assert.equal(h.calls.identity.length, 0);
  assert.equal(h.store.size(), 0);
});

test('T03: a Zoho user with no seat is refused by name, their token revoked, and Plane C logs it', async () => {
  for (const c of seats.refused) {
    const h = harness({ user: withIdentity(c.body) });
    const { result } = await signIn(h);
    assert.equal(result.ok, false, c.reason);
    assert.ok(['no-seat', 'failed'].includes(result.code), c.reason);
    assert.equal(h.store.size(), 0);
    assert.equal(h.calls.revoke.length, 1, `${c.reason}: a refused person's token is revoked, never kept`);
    const [e] = h.planeCSink.events();
    assert.equal(e.action, 'sign-in-refused');
    assert.equal(e.outcome, 'refused');
    assertNothingSecret(h);
  }
  const h = harness({ user: withIdentity(seats.refused.find((c) => c.reason === 'unknown-role').body) });
  const { result } = await signIn(h);
  assert.deepEqual(result, { ok: false, code: 'no-seat', message: SIGNIN_REFUSALS['no-seat'] });
  const [e] = h.planeCSink.events();
  assert.deepEqual([e.who, e.reason, e.seat], ['554023000000300020', 'unknown-role', null]);
});

test('T03: an Administrator profile never signs in', async () => {
  for (const c of seats.administratorRefused) {
    const h = harness({ user: withIdentity(c.body) });
    const { result } = await signIn(h);
    assert.equal(result.code, 'no-seat');
    assert.equal(h.planeCSink.events()[0].reason, 'administrator-profile');
    assert.equal(h.store.size(), 0);
  }
});

test('T03: a granted-only seat with no granted page is refused with the grant message', async () => {
  for (const zseat of ['viewer', 'business-unit-owner', 'channel-partner']) {
    const h = harness({ user: accepted(zseat) });
    const { result } = await signIn(h);
    assert.deepEqual(result, { ok: false, code: 'no-grant', message: SIGNIN_REFUSALS['no-grant'] });
    assert.equal(h.planeCSink.events()[0].reason, 'no-grant');
    assert.equal(h.calls.revoke.length, 1);
  }
  const throwing = harness({ user: accepted('viewer'), grants: { grantsOf: () => { throw new Error('store down'); } } });
  assert.equal((await signIn(throwing)).result.code, 'no-grant', 'a grant lookup that fails, fails closed');
});

test('T02: sign-out revokes the refresh token at Zoho, deletes the session and logs it', async () => {
  const h = harness();
  const { result } = await signIn(h);
  await h.sessions.signOut(result.sid);
  assert.equal(h.store.size(), 0);
  assert.equal(h.calls.revoke.length, 1);
  const r = new URL(h.calls.revoke[0].url);
  assert.equal(r.origin + r.pathname, 'https://accounts.zoho.in/oauth/v2/token/revoke');
  assert.equal(r.searchParams.get('token'), REFRESH);
  assert.deepEqual(await h.sessions.current(result.sid), { ok: false, why: null });
  assert.deepEqual(await h.sessions.credential(result.sid), { ok: false, why: null });
  const last = h.planeCSink.events().at(-1);
  assert.deepEqual([last.action, last.reason], ['sign-out', 'chose']);
  await h.sessions.signOut(result.sid);
  assert.equal(h.calls.revoke.length, 1, 'a second sign-out is a no-op');
  assertNothingSecret(h);
});

test('T02: a session is over at 12 hours however busy it was', async () => {
  const h = harness();
  const { result } = await signIn(h);
  h.clock.advance(SESSION_ABSOLUTE_MS - 1);
  assert.equal((await h.sessions.current(result.sid)).ok, true);
  h.clock.advance(1);
  assert.deepEqual(await h.sessions.current(result.sid), { ok: false, why: 'expired' });
  assert.equal(h.store.size(), 0);
  assert.equal(h.calls.revoke.length, 1);
  assert.equal(h.planeCSink.events().at(-1).action, 'session-expired');
  assert.deepEqual(await h.sessions.current(result.sid), { ok: false, why: null });
});

test('T02: a refresh Zoho refuses signs the person out as revoked', async () => {
  const h = harness({ token: { refresh_token: invalidCode } });
  const { result } = await signIn(h);
  h.clock.advance(3_600_000);
  assert.deepEqual(await h.sessions.credential(result.sid), { ok: false, why: 'revoked' });
  assert.equal(h.store.size(), 0);
  assert.equal(h.planeCSink.events().at(-1).action, 'session-revoked');
});

test('T02 (PROVISIONAL): Zoho not answering a refresh fails that request and keeps the session', async () => {
  const h = harness({ token: { refresh_token: new Error('synthetic network down') } });
  const { result } = await signIn(h);
  h.clock.advance(3_600_000);
  assert.deepEqual(await h.sessions.credential(result.sid), { ok: false, why: null, unavailable: true });
  assert.equal(h.store.size(), 1);
  h.state.answers.refresh_token = { status: 503, headers: {}, body: { message: 'down' } };
  assert.equal((await h.sessions.credential(result.sid)).unavailable, true);
  assert.equal(h.store.size(), 1);
});

test('T02: a refresh mints a new credential; a changed seat or person ends the session as revoked', async () => {
  const h = harness();
  const { result } = await signIn(h);
  h.clock.advance(3_600_000 - 30_000);
  const [a, b] = await Promise.all([h.sessions.credential(result.sid), h.sessions.credential(result.sid)]);
  assert.equal(a.credential.accessToken, ACCESS2);
  assert.strictEqual(a.credential, b.credential, 'concurrent requests share one refresh');
  assert.equal(h.calls.token.filter((c) => c.form.get('grant_type') === 'refresh_token').length, 1);
  assert.equal(h.calls.token.at(-1).form.get('refresh_token'), REFRESH);

  const r = harness({ user: withIdentity(seats.roleChange.before) });
  const s = (await signIn(r)).result;
  assert.equal(s.session.seat, 'ir');
  r.state.user = withIdentity(seats.roleChange.after);
  r.clock.advance(3_600_000);
  assert.deepEqual(await r.sessions.credential(s.sid), { ok: false, why: 'revoked' });
  assert.equal(r.calls.revoke.length, 1);
  assertNothingSecret(h);
  assertNothingSecret(r);
});

test('sealer: tampering, another key or another binding opens nothing; the key must be 32 bytes', () => {
  const s = createSealer(KEY);
  const sealed = s.seal('secret-value', 'aad-1');
  assert.equal(s.open(sealed, 'aad-1'), 'secret-value');
  assert.equal(s.open(sealed, 'aad-2'), null);
  assert.equal(createSealer(crypto.randomBytes(32).toString('base64')).open(sealed, 'aad-1'), null);
  const parts = sealed.split('.');
  parts[3] = parts[3].slice(0, -2) + (parts[3].endsWith('AA') ? 'BB' : 'AA');
  assert.equal(s.open(parts.join('.'), 'aad-1'), null);
  assert.throws(() => createSealer(crypto.randomBytes(16).toString('base64')));
  assert.throws(() => createSealer(''));
});

test('Plane C keeps only allow-listed fields; an email is never a who', () => {
  const sink = createPlaneCMemorySink();
  const log = createPlaneCLog(sink);
  log.record({ at: 1, who: EMAIL, action: 'sign-in', outcome: 'ok', reason: 'zoho', seat: 'conv', body: { email: EMAIL }, access_token: ACCESS });
  const [e] = sink.events();
  assert.deepEqual(Object.keys(e).sort(), ['action', 'at', 'outcome', 'reason', 'seat', 'who']);
  assert.equal(e.who, 'unrecognised');
  createPlaneCLog({ write() { throw new Error('sink down'); } }).record({ at: 1, who: 'x', action: 'sign-in', outcome: 'ok', reason: 'zoho', seat: null });
});

test('redirect URI must be exact https (http only on localhost)', () => {
  assert.equal(redirectUriOf(REDIRECT), REDIRECT);
  assert.equal(redirectUriOf('http://localhost:3002/api/auth/zoho/callback'), 'http://localhost:3002/api/auth/zoho/callback');
  for (const bad of ['http://console.example.invalid/cb', 'https://x.invalid/cb?next=/', 'https://u:p@x.invalid/cb', 'not a url', 42]) {
    assert.throws(() => redirectUriOf(bad), String(bad));
  }
});

/* ---- M03-S01-T02: the callback's door is the front end's own rule (signInAdmits via ../access/policy) ---- */

test('M03-S01: every Zoho seat through the callback — admitted, or refused with the named message', async () => {
  const want = {
    'ir-manager': 'conv', 'investor-relations': 'ir',                     /* lead side, by default */
    'head-of-finance': 'head', 'finance-operations': 'fin', 'compliance-audit': 'comp', /* Investors side (Finance lands there) */
    'head-of-account-management': 'amlead', 'key-account-manager': 'kam',
    'business-unit-owner': 'no-grant', 'channel-partner': 'no-grant', viewer: 'no-grant', /* granted-only, no grant yet */
  };
  assert.deepEqual(Object.keys(want).sort(), seats.accepted.map((c) => c.seat).sort(), 'every accepted fixture seat is covered');
  for (const [zseat, expect] of Object.entries(want)) {
    const h = harness({ user: accepted(zseat) });
    const { result } = await signIn(h);
    if (expect === 'no-grant') {
      assert.deepEqual(result, { ok: false, code: 'no-grant', message: SIGNIN_REFUSALS['no-grant'] }, zseat);
      assert.equal(h.calls.revoke.length, 1, zseat);
    } else {
      assert.equal(result.ok, true, zseat);
      assert.equal(result.session.seat, expect, zseat);
    }
  }
  for (const c of seats.administratorRefused) {                         /* CEO, Digital Infrastructure (Administrator) */
    const { result } = await signIn(harness({ user: withIdentity(c.body) }));
    assert.deepEqual(result, { ok: false, code: 'no-seat', message: SIGNIN_REFUSALS['no-seat'] }, c.mappedSeat);
  }
});

test('M03-S01: a grant must be a real screen with See it, inside the seat\'s ceiling', async () => {
  const cases = [
    ['viewer', { leads: ['view'] }, true],
    ['viewer', { leads: ['edit'] }, false],            /* no "See it": not a page */
    ['viewer', { me: ['view'] }, false],               /* Profile alone is never a grant */
    ['channel-partner', { numbers: ['view'] }, false], /* outside a channel partner's ceiling */
    ['channel-partner', { leads: ['view'] }, true],
    ['business-unit-owner', { today: ['view'] }, false], /* seatShape: Today is an IR operator's page only */
    ['business-unit-owner', { pay: ['view'] }, true],
  ];
  for (const [zseat, grid, ok] of cases) {
    const { result } = await signIn(harness({ user: accepted(zseat), grants: { grantsOf: () => grid } }));
    assert.equal(result.ok, ok, `${zseat} ${JSON.stringify(grid)}`);
    if (!ok) assert.equal(result.code, 'no-grant');
  }
});

test('M03-S01: a grant taken back ends the session at the next refresh as revoked', async () => {
  let grid = { leads: ['view'] };
  const h = harness({ user: accepted('viewer'), grants: { grantsOf: () => grid } });
  const { result } = await signIn(h);
  assert.equal(result.ok, true);
  grid = {};
  h.clock.advance(3_600_000);
  assert.deepEqual(await h.sessions.credential(result.sid), { ok: false, why: 'revoked' });
  assert.equal(h.store.size(), 0);
});
