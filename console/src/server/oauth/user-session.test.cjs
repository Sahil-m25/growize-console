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
const baseTest = require('node:test');

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
  'server/state/shared-state.ts', 'server/state/memory.ts', 'server/state/catalyst.ts', 'server/state/fake-catalyst.ts',
  'server/oauth/session-store.ts', 'server/oauth/session-end.ts',
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
const { createMemoryState } = load('server/state/memory.js');
const { createCatalystState } = load('server/state/catalyst.js');
const { createFakeCatalyst, FAKE_CONFIG } = load('server/state/fake-catalyst.js');
const { createSharedSessionStore, sessionSealerFromEnv, sessionStoreStartupCheck } = load('server/oauth/session-store.js');
const { onSessionEnd, notifySessionEnd } = load('server/oauth/session-end.js');

/* M18-S09-NOTE-1: every test runs against each session store — the process-local map (the old behaviour, kept for
   doubles), SessionStore on the memory SharedState, and on the catalyst SharedState over the fake Catalyst REST. */
const KINDS = ['map', 'state-memory', 'state-catalyst'];
let KIND = 'map';
const test = (name, fn) => { for (const k of KINDS) baseTest(`${name} [${k}]`, async (t) => { KIND = k; return fn(t); }); };
const sharedOnly = (name, fn) => { for (const k of KINDS.slice(1)) baseTest(`${name} [${k}]`, async (t) => { KIND = k; return fn(t); }); };
const ENC_KEY = crypto.randomBytes(32).toString('base64');
const RECORD_AAD = 'gz-session-v1|';

/** A SharedState that mirrors what is set/released, so a test can look at what sits in the backend (sync). */
function mirrored(state, mirror) {
  return Object.freeze({
    kind: state.kind,
    claim: (k, t) => state.claim(k, t),
    release: async (k) => { await state.release(k); mirror.delete(k); },
    get: (k) => state.get(k),
    set: async (k, v, t) => { await state.set(k, v, t); mirror.set(k, v); },
    incr: (k, t) => state.incr(k, t),
    take: (k, c, r) => state.take(k, c, r),
  });
}

/** The session store for KIND. `backend` (optional) is a SharedState shared with another harness: a second instance. */
function makeStore(clock, backend) {
  if (KIND === 'map' && !backend) return createMemorySessionStore();
  const fake = KIND === 'state-catalyst' ? createFakeCatalyst() : null;
  const state = backend ?? (fake
    ? createCatalystState(FAKE_CONFIG, { fetch: fake.fetch, clock, sleep: async () => undefined })
    : createMemoryState({ clock }));
  const mirror = new Map();
  const sealer = sessionSealerFromEnv(state.kind === 'memory' ? 'memory' : 'catalyst', { SESSION_ENC_KEY: ENC_KEY });
  const store = createSharedSessionStore(mirrored(state, mirror), sealer, { clock });
  const recs = () => [...mirror].filter(([k]) => k.startsWith('sess|'));
  return {
    ...store,
    state,
    size: () => recs().length,
    raw: () => recs().map(([k, v]) => JSON.parse(sealer.open(v, RECORD_AAD + k.slice(5)))),
    /** what the backend itself holds, ciphertext and all */
    backend: () => (fake ? [...fake.items.values()] : [...mirror.entries()]),
    fake,
    mirror,
  };
}

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

function harness({ user = accepted('ir-manager'), grants = NO_GRANTS, token = {}, backend, clock: sharedClock, onEnd, expectedOrgId, org, testEnrol } = {}) {
  const clock = sharedClock ?? clockAt(1_800_000_000_000);
  const planeB = createMemorySink();
  const log = createOpsLog(planeB);
  const planeCSink = createPlaneCMemorySink();
  const store = makeStore(clock, backend);
  const calls = { token: [], revoke: [], identity: [], org: [] };
  const state = { org: org ?? { org: [{ id: '554023000000000001', zgid: '60090668120' }] }, user, identityStatus: 200, answers: { authorization_code: codeGrant, refresh_token: refreshGrant, ...token } };
  const fetch = async (url, init) => {
    if (url.includes('/oauth/v2/token/revoke')) { calls.revoke.push({ url, init }); return reply(revokeOk); }
    const form = new URLSearchParams(init.body);
    calls.token.push({ url, init, form });
    const a = state.answers[form.get('grant_type')];
    if (a instanceof Error) throw a;
    return reply(a);
  };
  const identityFetch = async (url, init) => {
    if (url.endsWith('/crm/v8/org')) { calls.org.push({ url, init }); return streamReply(200, state.org); }
    calls.identity.push({ url, init }); return streamReply(state.identityStatus, state.user);
  };
  const accounts = createZohoAccounts({
    accountsOrigin: 'https://accounts.zoho.in', clientId: CLIENT_ID, clientSecret: CLIENT_SECRET,
    redirectUri: REDIRECT, scopes: ['ZohoCRM.users.READ', 'ZohoCRM.modules.ALL'], log, fetch, clock,
  });
  const sessions = createUserSessions({
    accounts, sealer: createSealer(KEY), store,
    seats: createZohoSeatDirectory({ recordIdPrefix: seats.recordIdPrefix, roleIds: seats.roleIds, profileIds: seats.profileIds }),
    grants, planeC: createPlaneCLog(planeCSink), gate: createGate(), log, recordIdPrefix: seats.recordIdPrefix,
    identityFetch, clock, ...(onEnd ? { onSessionEnd: onEnd } : {}), ...(expectedOrgId !== undefined ? { expectedOrgId } : {}), ...(testEnrol ? { testEnrol } : {}),
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
  const dump = JSON.stringify([h.planeB.records ? h.planeB.records() : null, h.planeCSink.events(), h.store.raw(), h.store.backend ? h.store.backend() : null]);
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
  assert.deepEqual(cur, { ok: true, session: result.session, expiresAt: rec.expiresAt, name: FULL_NAME }, 'B-15: the display name rides in memory with the session, never in the store');
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

/* ---- M03-S04-T01: access ending ends the session ------------------------------------------------ */

test('M03-S04-T01: a signed-in person who loses their last page is signed out by their next request (Plane C session-revoked · access-ended)', async () => {
  let grid = { leads: ['view'] };
  const h = harness({ user: accepted('viewer'), grants: { grantsOf: () => grid } });
  const { result } = await signIn(h);
  assert.equal(result.ok, true); assert.equal(result.session.seat, 'exec');
  assert.equal((await h.sessions.current(result.sid)).ok, true);
  grid = {};                                   /* Leads taken off: no page left */
  const next = await h.sessions.current(result.sid);
  assert.deepEqual(next, { ok: false, why: 'revoked' });
  assert.equal(h.store.size(), 0, 'the session is gone, not merely refused');
  const last = h.planeCSink.events().at(-1);
  assert.equal(last.action, 'session-revoked'); assert.equal(last.reason, 'access-ended'); assert.equal(last.outcome, 'ended');
  assert.equal(h.calls.revoke.length, 1, 'their refresh token is revoked at Zoho');
  assert.deepEqual(await h.sessions.credential(result.sid), { ok: false, why: null });
  assertNothingSecret(h);
});

test('M03-S04-T01: endSessionsOf ends every session of that person at once, and nobody else\'s', async () => {
  const h = harness({ user: accepted('investor-relations') });
  const a = await signIn(h);
  const b = await signIn(h);
  h.state.user = accepted('ir-manager');
  const other = await signIn(h);
  assert.ok(a.result.ok && b.result.ok && other.result.ok);
  assert.equal(h.store.size(), 3);
  const n = await h.sessions.endSessionsOf('554023000000300005', 'seat-changed');
  assert.equal(n, 2);
  assert.equal(h.store.size(), 1);
  assert.equal((await h.sessions.current(a.result.sid)).ok, false);
  assert.equal((await h.sessions.current(other.result.sid)).ok, true);
  const ended = h.planeCSink.events().filter((e) => e.action === 'session-revoked');
  assert.equal(ended.length, 2); assert.ok(ended.every((e) => e.reason === 'seat-changed' && e.who === '554023000000300005'));
  assert.equal(await h.sessions.endSessionsOf('not-an-id', 'x'), 0);
});

/* ---- M18-S09-NOTE-1: sessions on SharedState ------------------------------------------------------------- */

const sessKeyOf = (h) => [...h.store.mirror.keys()].find((k) => k.startsWith('sess|'));

sharedOnly('shared store: the record is sealed at rest with SESSION_ENC_KEY; who, seat and the session id never sit in the clear', async () => {
  const h = harness();
  const { result } = await signIn(h);
  const dump = JSON.stringify(h.store.backend());
  for (const s of [result.sid, REFRESH, ACCESS, 'conv']) assert.ok(!dump.includes(s), `backend must not hold ${s}`);
  if (KIND === 'state-catalyst') assert.ok(!dump.includes(result.session.who), 'catalyst holds hashed keys and sealed values only');
  const [rec] = h.store.raw();
  assert.deepEqual(Object.keys(rec).sort(), ['createdAt', 'expiresAt', 'sealedRefresh', 'seat', 'who'], 'only what the memory store kept');
  assertNothingSecret(h);
});

sharedOnly('shared store: TTL is the session lifetime (plus the end-processing grace) — the backend forgets it by itself', async () => {
  const { SESSION_TTL_GRACE_S } = load('server/oauth/session-store.js');
  const h = harness();
  await signIn(h);
  const key = sessKeyOf(h);
  h.clock.advance(SESSION_ABSOLUTE_MS + SESSION_TTL_GRACE_S * 1_000 - 1);
  assert.notEqual(await h.store.state.get(key), null);
  h.clock.advance(1);
  assert.equal(await h.store.state.get(key), null);
});

sharedOnly('shared store: a tampered record, or one moved under another key, is treated as signed out and released', async () => {
  const h = harness();
  const { result } = await signIn(h);
  const key = sessKeyOf(h);
  const sealed = await h.store.state.get(key);
  const flipped = sealed.slice(0, -2) + (sealed.at(-2) === 'A' ? 'B' : 'A') + sealed.at(-1);
  await h.store.state.set(key, flipped);
  assert.deepEqual(await h.sessions.current(result.sid), { ok: false, why: null });
  assert.deepEqual(await h.sessions.credential(result.sid), { ok: false, why: null });
  assert.equal(await h.store.state.get(key), null, 'the bad record is released');

  const b = (await signIn(h)).result;
  const c = (await signIn(h)).result;
  const keys = [...h.store.mirror.keys()].filter((k) => k.startsWith('sess|') && h.store.mirror.get(k));
  const kc = await h.store.state.get(keys[1]);
  await h.store.state.set(keys[0], kc);   // c's record copied under b's key
  const answers = [await h.sessions.current(b.sid), await h.sessions.current(c.sid)];
  assert.equal(answers.filter((a) => a.ok).length, 1, 'only the record under its own key opens');
});

sharedOnly('shared store: a record sealed under another SESSION_ENC_KEY does not open (decrypt failure = signed out)', async () => {
  const clock = clockAt(1_800_000_000_000);
  const a = harness({ clock });
  const { result } = await signIn(a);
  const other = createSharedSessionStore(a.store.state, sessionSealerFromEnv('catalyst', { SESSION_ENC_KEY: crypto.randomBytes(32).toString('base64') }), { clock });
  const key = sessKeyOf(a).slice(5);
  assert.equal(await other.get(key), null);
  assert.deepEqual(await a.sessions.current(result.sid), { ok: false, why: null }, 'and the record was released by that read');
});

sharedOnly('two instances share one session: sign in on A, served on B, signed out on B, gone on A', async () => {
  const clock = clockAt(1_800_000_000_000);
  const a = harness({ clock });
  const b = harness({ clock, backend: a.store.state });
  const { result } = await signIn(a);
  const onB = await b.sessions.current(result.sid);
  assert.equal(onB.ok, true);
  assert.deepEqual(onB.session, result.session);
  clock.advance(3_600_000);
  const cred = await b.sessions.credential(result.sid);
  assert.equal(cred.ok, true, 'B mints its own access token from the shared, sealed refresh token');
  assert.equal(cred.credential.accessToken, ACCESS2);
  await b.sessions.signOut(result.sid);
  assert.deepEqual(await a.sessions.current(result.sid), { ok: false, why: null });
  assert.deepEqual(await a.sessions.credential(result.sid), { ok: false, why: null });
  assert.equal(b.calls.revoke.length, 1);
});

sharedOnly('two instances: an instance recycle keeps the session (a fresh process over the same backend)', async () => {
  const clock = clockAt(1_800_000_000_000);
  const a = harness({ clock });
  const { result } = await signIn(a);
  const fresh = harness({ clock, backend: a.store.state });   // nothing in memory: a new process
  assert.equal((await fresh.sessions.current(result.sid)).ok, true);
});

sharedOnly('two instances: endSessionsOf on one ends that person\'s sessions made on any instance', async () => {
  const clock = clockAt(1_800_000_000_000);
  const a = harness({ clock, user: accepted('investor-relations') });
  const b = harness({ clock, user: accepted('investor-relations'), backend: a.store.state });
  const s1 = (await signIn(a)).result, s2 = (await signIn(b)).result, s3 = (await signIn(a)).result;
  a.state.user = accepted('ir-manager');
  const other = (await signIn(a)).result;
  assert.equal(await b.sessions.endSessionsOf('554023000000300005', 'seat-changed'), 3);
  for (const s of [s1, s2, s3]) assert.equal((await a.sessions.current(s.sid)).ok, false);
  assert.equal((await b.sessions.current(other.sid)).ok, true);
});

/* ---- M01-S08-NOTE-6: sign-out tells the replay service before the session is destroyed ---------------------- */

test('sign-out and change of person call onSessionEnd(who, sid) before the record is deleted', async () => {
  const seen = [];
  let h;
  h = harness({ onEnd: (who, sid) => { seen.push({ who, sid, stillStored: h.store.size() }); } });
  const first = (await signIn(h)).result;
  await h.sessions.signOut(first.sid, 'chose');
  assert.deepEqual(seen, [{ who: first.session.who, sid: first.sid, stillStored: 1 }]);
  /* change of person: the callback route signs the prior session out first — the same path */
  const prior = (await signIn(h)).result;
  await h.sessions.signOut(prior.sid, 'chose');
  assert.equal(seen.at(-1).sid, prior.sid);
  assert.equal(h.store.size(), 0);
});

test('expiry and revocation also call onSessionEnd; a throwing listener never blocks the sign-out', async () => {
  const seen = [];
  const h = harness({ onEnd: (who, sid) => { seen.push(sid); throw new Error('listener failed'); } });
  const { result } = await signIn(h);
  h.clock.advance(SESSION_ABSOLUTE_MS);
  assert.deepEqual(await h.sessions.current(result.sid), { ok: false, why: 'expired' });
  assert.deepEqual(seen, [result.sid]);
  assert.equal(h.store.size(), 0);
});

baseTest('session-end registry: listeners hear (who, sid); a throw is swallowed; unregister works', () => {
  const heard = [];
  const off1 = onSessionEnd(() => { throw new Error('x'); });
  const off2 = onSessionEnd((who, sid) => heard.push([who, sid]));
  notifySessionEnd('554023000000300004', 'S'.repeat(43));
  assert.deepEqual(heard, [['554023000000300004', 'S'.repeat(43)]]);
  off1(); off2();
  notifySessionEnd('554023000000300004', 'T'.repeat(43));
  assert.equal(heard.length, 1);
});

baseTest('SESSION_ENC_KEY: required (fail closed) when STATE_STORE=catalyst; 32 bytes; not ZOHO_SESSION_KEY; optional under memory', () => {
  assert.throws(() => sessionStoreStartupCheck('catalyst', {}), /SESSION_ENC_KEY is required/);
  assert.throws(() => sessionStoreStartupCheck('catalyst', { SESSION_ENC_KEY: Buffer.alloc(16).toString('base64') }), /32 random bytes/);
  assert.throws(() => sessionStoreStartupCheck('memory', { SESSION_ENC_KEY: 'short' }), /32 random bytes/);
  assert.throws(() => sessionStoreStartupCheck('catalyst', { SESSION_ENC_KEY: KEY, ZOHO_SESSION_KEY: KEY }), /must differ/);
  assert.doesNotThrow(() => sessionStoreStartupCheck('catalyst', { SESSION_ENC_KEY: ENC_KEY, ZOHO_SESSION_KEY: KEY }));
  assert.doesNotThrow(() => sessionStoreStartupCheck('memory', {}));
});

/* ZOHO_EXPECTED_ORG_ID (sandbox staging): the sign-in proves GET /crm/v8/org's org[0].zgid before anything else. */
test('org check: unset expected org = no /org call, the session is as before (production default)', async () => {
  const h = harness();
  const { result } = await signIn(h);
  assert.equal(result.ok, true);
  assert.equal(h.calls.org.length, 0);
  assert.equal(h.store.raw()[0].orgId, undefined);
});

test('org check: a token for the expected org signs in, once, and the org is kept on the session', async () => {
  const h = harness({ expectedOrgId: '60090668120' });
  const { result } = await signIn(h);
  assert.equal(result.ok, true);
  assert.equal(h.calls.org.length, 1);
  assert.equal(h.calls.org[0].url, 'https://www.zohoapis.in/crm/v8/org');
  assert.equal(h.store.raw()[0].orgId, '60090668120');
  h.clock.advance(2 * 60 * 60 * 1_000);   // past the access token: a refresh does not ask /org again
  assert.equal((await h.sessions.credential(result.sid)).ok, true);
  assert.equal((await h.sessions.current(result.sid)).ok, true);
  assert.equal(h.calls.org.length, 1, 'verified once per session, not per request or refresh');
  assertNothingSecret(h);
});

test('org check: a token for another org (the live one) is refused with the wrong-org message and revoked', async () => {
  const h = harness({ expectedOrgId: '60090668120', org: { org: [{ id: '554023000000000001', zgid: '60061770791' }] } });
  const { result } = await signIn(h);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'wrong-org');
  assert.equal(result.message, SIGNIN_REFUSALS['wrong-org']);
  assert.match(result.message, /This console is connected to a different Zoho org/);
  assert.equal(h.calls.identity.length, 0, 'CurrentUser is never asked of a wrong-org token');
  assert.equal(h.calls.revoke.length, 1);
  assert.equal(h.store.size(), 0);
  assert.deepEqual(h.planeCSink.events().map((e) => [e.action, e.reason]), [['sign-in-refused', 'org-mismatch']]);
  assertNothingSecret(h);
});

test('org check: zgid wins over id; id is used only when zgid is missing; no org id fails closed', async () => {
  const byId = harness({ expectedOrgId: '60090668120', org: { org: [{ id: '60090668120' }] } });
  assert.equal((await signIn(byId)).result.ok, true);
  const zgidWins = harness({ expectedOrgId: '60090668120', org: { org: [{ id: '60090668120', zgid: '60061770791' }] } });
  assert.equal((await signIn(zgidWins)).result.code, 'wrong-org');
  const numeric = harness({ expectedOrgId: '60090668120', org: { org: [{ zgid: 60090668120 }] } });
  assert.equal((await signIn(numeric)).result.ok, true);
  const empty = harness({ expectedOrgId: '60090668120', org: { org: [] } });
  const r = (await signIn(empty)).result;
  assert.equal(r.ok, false);
  assert.equal(r.code, 'failed');
  assert.equal(empty.store.size(), 0);
});

test('GZ_SIGNIN_DEBUG=1 names the refusal step (staging diagnostics); unset, the result is unchanged', async () => {
  const h = harness();
  const prev = process.env.GZ_SIGNIN_DEBUG;
  process.env.GZ_SIGNIN_DEBUG = '1';
  try {
    const { result } = await signIn(h, { flowCookie: null });
    assert.deepEqual(result, { ok: false, code: 'failed', message: SIGNIN_REFUSALS.failed, why: 'no-flow' });
  } finally {
    if (prev === undefined) delete process.env.GZ_SIGNIN_DEBUG; else process.env.GZ_SIGNIN_DEBUG = prev;
  }
  const { result } = await signIn(h, { flowCookie: null });
  assert.equal('why' in result, false);
});

/* ---------------------------------------- D124 staging test sign-in ---------------------------------------- */

/** A TestEnrolHook double: allowlists `ids`, remembers what was saved (the raw token is only ever held here, in the test). */
function enrolDouble(ids) {
  const saved = new Map();
  return { saved, wants: (who) => ids.includes(who), save: async (who, seat, token) => { saved.set(who, { seat, token }); } };
}
const IRM = '554023000000300004';   /* the ir-manager fixture user's id */

test('D124 enrolment: an allowlisted person\'s normal sign-in keeps their token (keepGrant), audits test-signin-enrolled, and sign-out does not revoke it', async () => {
  const enrol = enrolDouble([IRM]);
  const h = harness({ testEnrol: enrol });
  const { result } = await signIn(h);
  assert.equal(result.ok, true);
  assert.deepEqual(enrol.saved.get(IRM), { seat: 'conv', token: REFRESH });
  assert.equal(h.store.raw()[0].keepGrant, true, 'the stored session (any store kind) carries keepGrant');
  assert.deepEqual(h.planeCSink.events().map((e) => [e.action, e.who, e.seat]), [['test-signin-enrolled', IRM, 'conv'], ['sign-in', IRM, 'conv']]);
  await h.sessions.signOut(result.sid);
  assert.equal(h.calls.revoke.length, 0, 'the enrolled token is never revoked by a sign-out');
  /* expiry does not revoke it either */
  const h2 = harness({ testEnrol: enrolDouble([IRM]) });
  const r2 = (await signIn(h2)).result;
  h2.clock.advance(SESSION_ABSOLUTE_MS + 1);
  assert.deepEqual(await h2.sessions.current(r2.sid), { ok: false, why: 'expired' });
  assert.equal(h2.calls.revoke.length, 0);
  assertNothingSecret(h);
});

test('D124 enrolment: a person not on the allowlist is not enrolled, and their sign-out still revokes as before', async () => {
  const enrol = enrolDouble(['554023000000999999']);
  const h = harness({ testEnrol: enrol });
  const { result } = await signIn(h);
  assert.equal(enrol.saved.size, 0);
  assert.equal(h.store.raw()[0].keepGrant, undefined);
  await h.sessions.signOut(result.sid);
  assert.equal(h.calls.revoke.length, 1);
});

test('D124 mint: signInWithRefreshToken refreshes once and runs the callback pipeline — org proof, CurrentUser, admission — into a normal session', async () => {
  let grantReads = 0;
  const h = harness({ expectedOrgId: '60090668120', grants: { grantsOf: () => { grantReads++; return {}; } } });
  const r = await h.sessions.signInWithRefreshToken(REFRESH);
  assert.equal(r.ok, true);
  assert.deepEqual(r.session, { who: IRM, seat: 'conv' });
  assert.equal(h.calls.token.length, 1); assert.equal(h.calls.token[0].form.get('grant_type'), 'refresh_token');
  assert.equal(h.calls.org.length, 1, 'the ZOHO_EXPECTED_ORG_ID proof ran');
  assert.equal(h.calls.identity.length, 1, 'CurrentUser resolved the seat');
  assert.ok(grantReads >= 1, 'the D60 admission (readGrants) was asked');
  assert.equal(h.store.raw()[0].keepGrant, true);
  assert.deepEqual(h.planeCSink.events().map((e) => [e.action, e.outcome, e.who, e.seat]), [['test-signin-used', 'ok', IRM, 'conv']]);
  /* the minted session is an ordinary one: current() and credential() answer for it */
  assert.equal((await h.sessions.current(r.sid)).ok, true);
  assert.equal((await h.sessions.credential(r.sid)).credential.accessToken, ACCESS2);
  await h.sessions.signOut(r.sid);
  assert.equal(h.calls.revoke.length, 0, 'signing a test session out never revokes the enrolled token');
  assertNothingSecret(h);
});

test('D124 mint: the same refusals as the OAuth door — wrong org, no grant, a refused refresh — and the enrolled token is never revoked', async () => {
  const wrong = harness({ expectedOrgId: '60090668120', org: { org: [{ id: '1', zgid: '60061770791' }] } });
  const w = await wrong.sessions.signInWithRefreshToken(REFRESH);
  assert.equal(w.ok, false); assert.equal(w.code, 'wrong-org');
  const viewer = harness({ user: accepted('viewer') });
  const v = await viewer.sessions.signInWithRefreshToken(REFRESH);
  assert.equal(v.code, 'no-grant');
  /* the OAuth door refuses the same person the same way */
  assert.equal((await signIn(harness({ user: accepted('viewer') }))).result.code, 'no-grant');
  for (const x of [wrong, viewer]) { assert.equal(x.calls.revoke.length, 0); assert.equal(x.store.size(), 0); }
  const refused = harness({ token: { refresh_token: invalidCode } });
  const f = await refused.sessions.signInWithRefreshToken(REFRESH);
  assert.equal(f.ok, false); assert.equal(f.code, 'failed');
  assert.equal(refused.calls.revoke.length, 0);
  assert.equal((await harness().sessions.signInWithRefreshToken('')).code, 'failed');
});
