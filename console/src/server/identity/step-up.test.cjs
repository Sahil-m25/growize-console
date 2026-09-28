/* M01-S10-T01/T04 STEP-UP AND THE RELEASE OF A LAPSED RESERVATION — the Zoho re-auth round trip (prompt=login,
 * max_age, PKCE, bound to the session), five-minute validity, attempt/success/failure in Plane C, the
 * third failure locking the action and alerting, and the release waiting for Zoho's approval process.
 * Replays recorded answers under lib/zoho/__fixtures__/grants; never calls Zoho.
 *
 * Run from console/: node --test src/server/identity/step-up.test.cjs
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
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'server-stepup-'));
process.on('exit', () => fs.rmSync(outDir, { recursive: true, force: true }));

const config = ts.readConfigFile(path.join(consoleRoot, 'tsconfig.json'), ts.sys.readFile);
const project = ts.parseJsonConfigFileContent(config.config, ts.sys, consoleRoot);
const options = {
  ...project.options, incremental: false, tsBuildInfoFile: undefined, plugins: undefined,
  module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10,
  noEmit: false, noEmitOnError: true, outDir, rootDir: consoleRoot,
};
const sources = ['src/server/identity/step-up.ts', 'src/server/access/lapse-release.ts', 'src/server/oauth/zoho-accounts.ts'].map((f) => path.join(consoleRoot, f));
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

const { createStepUp, STEP_UP_VALID_MS, STEP_UP_LOCK_AT, STEP_UP_MESSAGES, safeBack } = load('src/server/identity/step-up.js');
const { releaseLapsedHold, kolkataDay } = load('src/server/access/lapse-release.js');
const { createZohoAccounts } = load('src/server/oauth/zoho-accounts.js');
const { createSealer, idHash } = load('src/server/oauth/crypto.js');
const { createAuthorityEvents } = load('src/server/identity/authority.js');
const { createPlaneCLog, createPlaneCMemorySink } = load('src/server/identity/plane-c.js');

const HARSHA = '554023000000300007', OTHER = '554023000000300005';
const SID = 'a'.repeat(43), SID2 = 'b'.repeat(43);
const KEY = Buffer.alloc(32, 7).toString('base64');
const T0 = Date.parse('2026-09-28T04:30:00Z');

function accounts(fetch) {
  return createZohoAccounts({
    accountsOrigin: 'https://accounts.zoho.in', clientId: '1000.CLIENTIDXXXX', clientSecret: 'secret-secret-xx',
    redirectUri: 'https://console.example.in/api/auth/zoho/callback', scopes: ['ZohoCRM.modules.ALL'],
    stepUpRedirectUri: 'https://console.example.in/api/auth/step-up/callback',
    log: { call: () => {}, refusal: () => {} }, fetch,
  });
}

function rig({ named = HARSHA, token = 'step-up.token.response.json' } = {}) {
  const now = { t: T0 };
  const sink = createPlaneCMemorySink();
  const posts = [];
  const fetch = async (url, init) => { posts.push({ url, body: String(init.body) }); return { status: 200, text: async () => JSON.stringify(FX('grants', token)), headers: { get: () => null } }; };
  const sessions = { [SID]: { who: HARSHA, seat: 'head' }, [SID2]: { who: HARSHA, seat: 'head' } };
  const locks = [];
  const s = createStepUp({
    accounts: accounts(fetch), sealer: createSealer(KEY),
    current: async (sid) => (sessions[sid] ? { ok: true, session: sessions[sid] } : { ok: false }),
    identify: async () => named, planeC: createPlaneCLog(sink), onLock: (who, action) => locks.push([who, action]), clock: () => now.t,
  });
  return { s, sink, posts, now, locks, sessions };
}

const stateOf = (url) => new URL(url).searchParams.get('state');

test('start: a Zoho re-auth URL with prompt=login, max_age, PKCE and the step-up redirect; no refresh token asked; attempt in Plane C', async () => {
  const { s, sink } = rig();
  const r = await s.start(SID, 'reveal');
  assert.equal(r.ok, true);
  const q = new URL(r.url).searchParams;
  assert.equal(new URL(r.url).origin + new URL(r.url).pathname, 'https://accounts.zoho.in/oauth/v2/auth');
  assert.equal(q.get('prompt'), 'login'); assert.equal(q.get('max_age'), '0'); assert.equal(q.get('access_type'), 'online');
  assert.equal(q.get('redirect_uri'), 'https://console.example.in/api/auth/step-up/callback');
  assert.equal(q.get('code_challenge_method'), 'S256'); assert.equal(q.get('scope'), 'ZohoCRM.users.READ');
  assert.deepEqual({ ...sink.events()[0] }, { at: T0, who: HARSHA, action: 'step-up', outcome: 'ok', reason: 'attempt-reveal', seat: 'head' });
  assert.equal((await s.start(null, 'reveal')).code, 'signed-out');
});

test('finish: the same person signing in again opens the action for five minutes on this session only; "step-up ok · export" in Plane C', async () => {
  const { s, sink, posts, now } = rig();
  assert.equal((await s.valid(SID, 'export')).code, 'step-up');
  const st = await s.start(SID, 'export');
  const f = await s.finish(SID, { code: '1000.code', state: stateOf(st.url), error: null }, st.flowCookie);
  assert.equal(f.ok, true); assert.equal(f.action, 'export'); assert.equal(f.until, T0 + STEP_UP_VALID_MS);
  const form = new URLSearchParams(posts[0].body);
  assert.equal(form.get('redirect_uri'), 'https://console.example.in/api/auth/step-up/callback'); assert.ok(form.get('code_verifier'));
  assert.equal(sink.events().at(-1).reason, 'export'); assert.equal(sink.events().at(-1).outcome, 'ok');
  assert.equal((await s.valid(SID, 'export')).ok, true);
  assert.equal((await s.valid(SID, 'reveal')).ok, false, 'one action, not all');
  assert.equal((await s.valid(SID2, 'export')).ok, false, 'bound to the session that stepped up');
  now.t += STEP_UP_VALID_MS;
  assert.equal((await s.valid(SID, 'export')).code, 'step-up', 'five minutes, then it closes');
  assert.doesNotMatch(JSON.stringify(sink.events()), /1000\.|code|@/);
});

test('finish: a flow from another session, a wrong state or a stale flow is refused and not counted', async () => {
  const { s, now } = rig();
  const st = await s.start(SID, 'reveal');
  assert.equal((await s.finish(SID2, { code: 'c', state: stateOf(st.url), error: null }, st.flowCookie)).ok, false);
  assert.equal((await s.finish(SID, { code: 'c', state: 'x'.repeat(43), error: null }, st.flowCookie)).ok, false);
  now.t += 11 * 60_000;
  assert.equal((await s.finish(SID, { code: 'c', state: stateOf(st.url), error: null }, st.flowCookie)).ok, false);
  assert.equal(s.failures(HARSHA, 'reveal'), 0);
});

test('acceptance: three failed step-ups lock the action for that person and alert; a fourth is refused before Zoho is asked', async () => {
  const { s, sink, locks } = rig({ named: OTHER });   /* somebody else signs in at Zoho */
  for (let i = 1; i <= STEP_UP_LOCK_AT; i++) {
    const st = await s.start(SID, 'reveal');
    const f = await s.finish(SID, { code: 'c', state: stateOf(st.url), error: i === 2 ? 'access_denied' : null }, st.flowCookie);
    assert.equal(f.ok, false);
    assert.equal(f.code, i === STEP_UP_LOCK_AT ? 'locked' : i === 2 ? 'cancelled' : 'failed');
  }
  assert.deepEqual(locks, [[HARSHA, 'reveal']]);
  assert.equal(s.locked(HARSHA, 'reveal'), true);
  const fourth = await s.start(SID, 'reveal');
  assert.equal(fourth.ok, false); assert.equal(fourth.code, 'locked');
  assert.equal((await s.valid(SID, 'reveal')).code, 'locked');
  assert.match(STEP_UP_MESSAGES.locked, /Sahil and Pradeep/);
  const reasons = sink.events().map((e) => e.reason);
  assert.deepEqual(reasons.filter((r) => /^(failed|cancelled|locked)-/.test(r)), ['failed-reveal', 'cancelled-reveal', 'failed-reveal', 'locked-reveal', 'locked-reveal']);
  assert.equal((await s.start(SID, 'export')).ok, true, 'the lock is per action');
  s.unlock(HARSHA, 'reveal');
  assert.equal((await s.start(SID, 'reveal')).ok, true);
});

test('a success clears the count; a code Zoho refuses counts as a failure', async () => {
  const bad = rig({ token: 'step-up.token.response.json' });
  const st = await bad.s.start(SID, 'release');
  await bad.s.finish(SID, { code: '', state: stateOf(st.url), error: null }, st.flowCookie);
  assert.equal(bad.s.failures(HARSHA, 'release'), 1);
  const st2 = await bad.s.start(SID, 'release');
  assert.equal((await bad.s.finish(SID, { code: 'c', state: stateOf(st2.url), error: null }, st2.flowCookie)).ok, true);
  assert.equal(bad.s.failures(HARSHA, 'release'), 0);
});

test('not configured: without a step-up redirect URI nothing starts; safeBack keeps redirects on this site', async () => {
  const a = createZohoAccounts({ accountsOrigin: 'https://accounts.zoho.in', clientId: '1000.CLIENTIDXXXX', clientSecret: 'secret-secret-xx',
    redirectUri: 'https://console.example.in/api/auth/zoho/callback', scopes: ['ZohoCRM.modules.ALL'], log: { call() {}, refusal() {} } });
  const s = createStepUp({ accounts: a, sealer: createSealer(KEY), current: async () => ({ ok: true, session: { who: HARSHA, seat: 'head' } }), identify: async () => HARSHA, planeC: createPlaneCLog(createPlaneCMemorySink()) });
  assert.equal(s.configured, false); assert.equal((await s.start(SID, 'export')).code, 'not-configured');
  assert.equal(safeBack('/investors/123'), '/investors/123');
  for (const bad of ['//evil.example', 'https://evil.example', '/x?y=1', null]) assert.equal(safeBack(bad), '/');
  assert.equal(typeof idHash, 'function');
});

/* ---- M01-S10-T04: the release waits for Zoho's approval process ---------------------------------- */

function crmRig({ record = FX('grants', 'allotment.lapsed.response.json').data[0], conflict = false } = {}) {
  const writes = [];
  const reads = [];
  const crm = {
    async getRecord(as, module, id, o) {
      reads.push(o.fields);
      if (o.fields.includes('$approval_state')) return { ok: true, value: FX('grants', 'allotment.pending-approval.response.json').data[0], status: 200, creditsRemaining: null };
      return { ok: true, value: record, status: 200, creditsRemaining: null };
    },
    async update(as, module, id, fields, o) {
      writes.push({ module, id, fields, o });
      if (conflict) return { ok: false, error: { kind: 'conflict', status: 412, code: 'ALREADY_MODIFIED', recordId: id }, creditsRemaining: null };
      const d = FX('grants', 'allotment.update.response.json').data[0].details;
      return { ok: true, value: { id: d.id, modifiedTime: d.Modified_Time }, status: 200, creditsRemaining: null };
    },
  };
  const sink = createPlaneCMemorySink();
  return { crm, writes, reads, sink, events: createAuthorityEvents(createPlaneCLog(sink), () => T0) };
}
const ALLOT = '554023000000900001';
const release = (r, over = {}) => releaseLapsedHold({ crm: r.crm, as: { userId: HARSHA }, session: { who: HARSHA, seat: 'head' }, allotmentId: ALLOT, events: r.events, approvalConfigured: true, clock: () => T0, ...over });

test('acceptance: Harsha releases a lapsed reservation — one guarded write, then "pending approval"', async () => {
  const r = crmRig();
  const out = await release(r);
  assert.equal(out.ok, true); assert.equal(out.state, 'pending-approval');
  assert.equal(r.writes.length, 1);
  assert.deepEqual(r.writes[0].fields, { Allocation_Status: 'Cancelled' });
  assert.equal(r.writes[0].module, 'LLP_UnitAllocation_Module');
  assert.equal(r.writes[0].o.ifUnmodifiedSince, '2026-09-21T10:00:00+05:30');
  assert.equal(kolkataDay(T0), '2026-09-28');
});

test('acceptance: a seat without the release right is refused; so is a hold still running, a non-reservation, a newer change, and a deployment without the approval process', async () => {
  const cases = [
    [{ session: { who: OTHER, seat: 'fin' } }, {}, 'no-release-right', 403],
    [{ session: { who: OTHER, seat: 'kam' } }, {}, 'no-release-right', 403],
    [{ approvalConfigured: false }, {}, 'approval-not-configured', 503],
    [{}, { record: { ...FX('grants', 'allotment.lapsed.response.json').data[0], Hold_Until: '2026-09-28' } }, 'hold-running', 409],
    [{}, { record: { ...FX('grants', 'allotment.lapsed.response.json').data[0], Allocation_Status: 'Issued' } }, 'not-reserved', 409],
    [{}, { conflict: true }, 'changed', 409],
    [{ allotmentId: 'x' }, {}, 'not-found', 404],
  ];
  for (const [over, rigOver, code, status] of cases) {
    const r = crmRig(rigOver);
    const out = await release(r, over);
    assert.equal(out.ok, false, code); assert.equal(out.refusal, code); assert.equal(out.status, status);
    if (code !== 'changed') assert.equal(r.writes.length, 0, code);
    assert.equal(r.sink.events()[0].action, 'refused-action'); assert.equal(r.sink.events()[0].reason, `release-${code}`);
  }
});
