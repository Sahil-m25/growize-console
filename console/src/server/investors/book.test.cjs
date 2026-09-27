/* M03-S07 KAM BOOK REGRESSION
 *
 * Run from console/: node src/server/investors/book.test.cjs
 *
 * Type-checks the KAM book boundary with the project's TypeScript, then drives it through the real
 * Zoho client with sanitized recorded responses only. No request reaches Zoho; every fixture is
 * synthetic. What this cannot prove — that Zoho sharing itself keeps a KAM's token to their own
 * book — is the M03-S07-T01 human check in autopilot/console/BLOCKED.md.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { before, test } = require('node:test');

const consoleRoot = path.resolve(__dirname, '..', '..', '..');
const srcRoot = path.join(consoleRoot, 'src');
const fixtureRoot = path.join(srcRoot, 'lib', 'zoho', '__fixtures__', 'kam-book');
const ts = require(path.join(consoleRoot, 'node_modules', 'typescript'));
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoho-kam-book-'));
process.on('exit', () => fs.rmSync(outDir, { recursive: true, force: true }));

const config = ts.readConfigFile(path.join(consoleRoot, 'tsconfig.json'), ts.sys.readFile);
const project = ts.parseJsonConfigFileContent(config.config, ts.sys, consoleRoot);
const options = {
  ...project.options,
  incremental: false,
  tsBuildInfoFile: undefined,
  plugins: undefined,
  module: ts.ModuleKind.CommonJS,
  moduleResolution: ts.ModuleResolutionKind.Node10,
  noEmit: false,
  noEmitOnError: true,
  outDir,
  rootDir: srcRoot,
};
const sources = [
  'lib/zoho/errors.ts',
  'lib/zoho/gate.ts',
  'lib/zoho/log.ts',
  'lib/zoho/client.ts',
  'server/oauth/seat.ts',
  'server/investors/book.ts',
].map((file) => path.join(srcRoot, file));
const format = (items) => ts.formatDiagnostics(items, {
  getCanonicalFileName: (file) => file,
  getCurrentDirectory: () => consoleRoot,
  getNewLine: () => '\n',
});
const program = ts.createProgram(sources, options);
const diagnostics = ts.getPreEmitDiagnostics(program);
if (diagnostics.length) {
  console.error(format(diagnostics));
  process.exit(1);
}
const emitted = program.emit();
if (emitted.diagnostics.length) {
  console.error(format(emitted.diagnostics));
  process.exit(1);
}

const load = (file) => require(path.join(outDir, file));
const { createMemorySink, createOpsLog } = load(path.join('lib', 'zoho', 'log.js'));
const { createZohoClient, userCredential } = load(path.join('lib', 'zoho', 'client.js'));
const { SENSITIVE_CONTACT_FIELDS, createKamBookService } = load(path.join('server', 'investors', 'book.js'));

const P = '9007199254';
const IMRAN = `${P}740994001`;
const NEHA = `${P}740994002`;
const HEAD = `${P}740994003`;
const GONE = `${P}740994004`;
const KAM_ROLE = `${P}740998011`;
const KAM_PROFILE = `${P}740998010`;
const HEAD_ROLE = `${P}740998021`;
const HEAD_PROFILE = `${P}740998020`;
const IMRAN_1 = `${P}740994101`;
const NEHA_1 = `${P}740994201`;
const POOL = `${P}740994301`;
const DEPARTED = `${P}740994302`;
const IMRAN_1_LEAD = `${P}740995101`;
const SESSION = 'session_fixture_kam_0001';
const LOADED = '2026-09-20T10:00:00+05:30';
const NOW = Date.parse('2026-09-27T12:00:00+05:30');
const IMRAN_BOOK = [1, 2, 3, 4].map((k) => `${P}74099410${k}`);
const NEHA_BOOK = [1, 2, 3, 4].map((k) => `${P}74099420${k}`);
const IDENTITY_MARKERS = ['FXPAN1234F', 'FXBANK000999', 'FXAADHAAR0001'];

const recorded = (name) => JSON.parse(fs.readFileSync(path.join(fixtureRoot, `${name}.response.json`), 'utf8'));
const toResponse = (recording) => new Response(JSON.stringify(recording.body), {
  status: recording.status,
  headers: recording.headers || {},
});
const immediateGate = () => ({ async acquire() { return { waitedMs: 0, release() {} }; } });

const credentials = new Map();
before(async () => {
  for (const [id, name] of [[IMRAN, 'imran'], [NEHA, 'neha'], [HEAD, 'head']]) {
    const token = `synthetic-${name}-token-never-live`;
    const credential = await userCredential(
      { access_token: token, api_domain: 'https://www.zohoapis.in', expires_in: 3_600 },
      {
        recordIdPrefix: P,
        gate: immediateGate(),
        log: createOpsLog(createMemorySink()),
        fetch: async (url, init) => {
          assert.equal(url, 'https://www.zohoapis.in/crm/v8/users?type=CurrentUser');
          assert.equal(init.headers.Authorization, `Zoho-oauthtoken ${token}`);
          return toResponse(recorded(`current-user.${name}`));
        },
        clock: () => NOW,
      },
    );
    assert.equal(credential.userId, id, 'CurrentUser is the only source of the actor id');
    credentials.set(id, credential);
  }
});
const principal = (id) => ({ credential: credentials.get(id), sessionId: SESSION });

const seatOf = (id) => (id === HEAD
  ? { userId: HEAD, roleId: HEAD_ROLE, profileId: HEAD_PROFILE, seat: 'head-of-account-management' }
  : { userId: id, roleId: KAM_ROLE, profileId: KAM_PROFILE, seat: 'key-account-manager' });
const liveAccess = (overrides = {}) => {
  let calls = 0;
  return {
    calls: () => calls,
    async recheck(credential, sessionId) {
      calls += 1;
      assert.equal(sessionId, SESSION);
      if (overrides.recheck) return overrides.recheck(credential, calls);
      return { actor: seatOf(credential.userId), activeKamUserIds: [IMRAN, NEHA] };
    },
  };
};

/** routes: { coql: (query) => fixture, get: (id) => fixture, put: (id) => fixture, post: (module) => fixture } */
function rig(routes, accessOverrides) {
  const calls = [];
  const sink = createMemorySink();
  const log = createOpsLog(sink);
  const crm = createZohoClient({
    recordIdPrefix: P,
    gate: immediateGate(),
    log,
    maxAttempts: 1,
    clock: () => NOW,
    fetch: async (url, init) => {
      const parsed = new URL(url);
      const body = init.body ? JSON.parse(init.body) : null;
      const call = { method: init.method, pathname: parsed.pathname, search: parsed.search, body, headers: init.headers };
      calls.push(call);
      const segments = parsed.pathname.split('/');
      let name;
      if (init.method === 'POST' && parsed.pathname === '/crm/v8/coql') name = routes.coql?.(body.select_query, calls);
      else if (init.method === 'GET') name = routes.get?.(segments[4], calls);
      else if (init.method === 'PUT') name = routes.put?.(segments[4], calls);
      else if (init.method === 'POST') name = routes.post?.(segments[3], calls);
      if (!name) throw new Error(`unexpected synthetic CRM request ${init.method} ${parsed.pathname}`);
      return toResponse(recorded(name));
    },
  });
  const access = liveAccess(accessOverrides);
  const service = createKamBookService({ crm, access, log, recordIdPrefix: P, clock: () => NOW });
  const coqls = () => calls.filter((c) => c.pathname === '/crm/v8/coql').map((c) => c.body.select_query);
  const writes = () => calls.filter((c) => c.method === 'PUT' || (c.method === 'POST' && c.pathname !== '/crm/v8/coql'));
  const refusals = () => sink.records().filter((r) => r.kind === 'refusal');
  return { service, calls, coqls, writes, refusals, sink, access };
}

const isAllotmentQuery = (q) => q.includes('from LLP_UnitAllocation_Module');
const isContactQuery = (q) => q.includes('from Contacts');
const noIdentity = (value) => {
  const text = JSON.stringify(value);
  for (const marker of IDENTITY_MARKERS) assert.ok(!text.includes(marker), `identity value ${marker} leaked`);
};
const noSensitiveSelect = (queries) => {
  for (const q of queries) for (const field of SENSITIVE_CONTACT_FIELDS) {
    assert.ok(!new RegExp(`\\b${field}\\b`).test(q), `COQL selected ${field}`);
  }
};

const kamRoutes = (who) => ({
  coql: (q) => (isContactQuery(q) ? `coql.contacts.${who}` : isAllotmentQuery(q) ? `coql.allotments.${who}` : null),
});

// ---------------- list: own book ----------------

test('TC-IM02-009: Imran lists exactly his four accounts, never Neha\'s', async () => {
  const r = rig(kamRoutes('imran'));
  const result = await r.service.list(principal(IMRAN));
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.map((e) => e.id).sort(), IMRAN_BOOK);
  for (const id of NEHA_BOOK) assert.ok(!result.value.some((e) => e.id === id));
  for (const entry of result.value) {
    assert.equal(entry.scope, 'own');
    assert.equal(entry.kamUserId, IMRAN);
    assert.equal(entry.mayAssignManager, false);
    assert.equal(entry.issuedUnits, 2);
  }
  const [contactQuery] = r.coqls().filter(isContactQuery);
  assert.match(contactQuery, new RegExp(`where KAM = '${IMRAN}'`), 'the own-book query is scoped by KAM');
  noSensitiveSelect(r.coqls());
  noIdentity(result);
  noIdentity(r.sink.records());
  assert.equal(r.writes().length, 0);
  assert.equal(r.access.calls(), 2, 'seat is re-checked before reading and before returning');
});

test('TC-IM02-010: Neha lists exactly her four accounts, never Imran\'s', async () => {
  const r = rig(kamRoutes('neha'));
  const result = await r.service.list(principal(NEHA));
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.map((e) => e.id).sort(), NEHA_BOOK);
  for (const id of IMRAN_BOOK) assert.ok(!result.value.some((e) => e.id === id));
  noIdentity(result);
});

test('TC-IM02-011: an own account offers details and walls PAN, Aadhaar and Bank as Finance only', async () => {
  const r = rig(kamRoutes('imran'));
  const result = await r.service.list(principal(IMRAN));
  const radhika = result.value.find((e) => e.id === IMRAN_1);
  assert.equal(radhika.mayDetails, true);
  assert.equal(radhika.mayCare, true);
  assert.deepEqual({ ...radhika.identity }, { pan: 'finance-only', aadhaar: 'finance-only', bank: 'finance-only' });
  for (const key of Object.keys(radhika)) {
    assert.ok(!/pan_|aadhaar_|bank_/i.test(key), `entry exposes ${key}`);
  }
});

test('a stale share that returns another KAM\'s contact refuses the whole book', async () => {
  const r = rig({ coql: (q) => (isContactQuery(q) ? 'coql.contacts.imran-foreign' : 'coql.allotments.imran') });
  const result = await r.service.list(principal(IMRAN));
  assert.equal(result.ok, false);
  assert.equal(result.reasonCode, 'scope-drift');
  assert.ok(!('value' in result));
  assert.deepEqual(r.refusals().map((x) => x.recordIds), [[NEHA_1]]);
  noIdentity(result);
});

test('a KAM-held contact without an Issued allotment is left out and logged, not a blank book', async () => {
  const r = rig({ coql: (q) => (isContactQuery(q) ? 'coql.contacts.imran' : 'coql.allotments.imran-three') });
  const result = await r.service.list(principal(IMRAN));
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.map((e) => e.id).sort(), IMRAN_BOOK.slice(0, 3));
  assert.deepEqual(r.refusals().map((x) => [x.reason, x.recordIds]), [['scope-drift', [IMRAN_BOOK[3]]]]);
});

test('a book larger than one bounded page is refused, not truncated', async () => {
  const r = rig({ coql: (q) => (isContactQuery(q) ? 'coql.contacts.more' : null) });
  const result = await r.service.list(principal(IMRAN));
  assert.equal(result.reasonCode, 'book-too-large');
});

// ---------------- list: Head of AM ----------------

test('Head of AM lists allotted accounts and the pool, with Assign manager offered', async () => {
  const r = rig({ coql: (q) => (isAllotmentQuery(q) ? 'coql.allotments.all' : isContactQuery(q) ? 'coql.contacts.head' : null) });
  const result = await r.service.list(principal(HEAD));
  assert.equal(result.ok, true);
  assert.equal(result.value.length, 10);
  const scopeOf = Object.fromEntries(result.value.map((e) => [e.id, e.scope]));
  for (const id of [...IMRAN_BOOK, ...NEHA_BOOK]) assert.equal(scopeOf[id], 'team');
  assert.equal(scopeOf[POOL], 'pool', 'no KAM is pool');
  assert.equal(scopeOf[DEPARTED], 'pool', 'a departed KAM\'s account returns to the pool');
  assert.ok(result.value.every((e) => e.mayAssignManager === true));
  const [contactQuery] = r.coqls().filter(isContactQuery);
  assert.ok(!/KAM =/.test(contactQuery), 'Head of AM is scoped by Zoho sharing, not a KAM filter');
  noSensitiveSelect(r.coqls());
  noIdentity(result);
});

test('Head of AM refuses when Zoho hides an allotted account (sharing drift)', async () => {
  const r = rig({ coql: (q) => (isAllotmentQuery(q) ? 'coql.allotments.all' : 'coql.contacts.head-missing') });
  const result = await r.service.list(principal(HEAD));
  assert.equal(result.reasonCode, 'scope-drift');
});

// ---------------- access ----------------

test('a revoked session, a non-AM seat or a KAM absent from the KAM list is refused before Zoho', async () => {
  const cases = [
    [{ recheck: () => null }, 'session-changed'],
    [{ recheck: (c) => ({ actor: { ...seatOf(c.userId), seat: 'finance-operations' }, activeKamUserIds: [] }) }, 'seat-denied'],
    [{ recheck: (c) => ({ actor: seatOf(c.userId), activeKamUserIds: [NEHA] }) }, 'seat-denied'],
    [{ recheck: (c) => ({ actor: { ...seatOf(c.userId), userId: NEHA }, activeKamUserIds: [IMRAN, NEHA] }) }, 'seat-denied'],
  ];
  for (const [override, code] of cases) {
    const r = rig(kamRoutes('imran'), override);
    const result = await r.service.list(principal(IMRAN));
    assert.equal(result.reasonCode, code);
    assert.equal(r.calls.length, 0, `${code} reached Zoho`);
  }
});

test('a seat change during the read discards the book', async () => {
  const r = rig(kamRoutes('imran'), {
    recheck: (c, n) => ({ actor: seatOf(c.userId), activeKamUserIds: n === 1 ? [IMRAN, NEHA] : [IMRAN] }),
  });
  const result = await r.service.list(principal(IMRAN));
  assert.equal(result.reasonCode, 'session-changed');
  assert.ok(!('value' in result));
});

test('a forged principal is refused without an access check', async () => {
  const r = rig(kamRoutes('imran'));
  const result = await r.service.list({ credential: { kind: 'user', userId: IMRAN }, sessionId: SESSION });
  assert.equal(result.reasonCode, 'invalid-request');
  assert.equal(r.access.calls(), 0);
});

test('a Zoho outage is a retryable source error that carries no response body', async () => {
  const r = rig({ coql: () => 'source.server-error' });
  const result = await r.service.list(principal(IMRAN));
  assert.equal(result.kind, 'source-error');
  assert.equal(result.retryable, true);
  assert.ok(!JSON.stringify(result).includes('example.invalid'));
  noIdentity(result);
  noIdentity(r.sink.records());
});

// ---------------- changeDetails ----------------

const detailsRoutes = (guard, allot, put) => ({
  get: () => guard,
  coql: (q) => (isAllotmentQuery(q) ? allot : null),
  put: () => put,
});

test('Imran changes details on his own account with a guarded, allow-listed write', async () => {
  const r = rig(detailsRoutes('contact.guard.imran-1', 'coql.allotments.one-imran-1', 'contact.updated'));
  const result = await r.service.changeDetails(principal(IMRAN), {
    contactId: IMRAN_1,
    expectedModifiedTime: LOADED,
    fields: { Mobile: '+91 90000 11111', Nominee_Relation: 'Spouse' },
  });
  assert.deepEqual(result, { ok: true, value: { contactId: IMRAN_1, modifiedTime: '2026-09-27T12:00:00+05:30' } });
  const [put] = r.writes();
  assert.equal(put.pathname, `/crm/v8/Contacts/${IMRAN_1}`);
  assert.equal(put.headers['If-Unmodified-Since'], LOADED);
  assert.deepEqual(put.body, { data: [{ Mobile: '+91 90000 11111', Nominee_Relation: 'Spouse' }] });
  const [get] = r.calls.filter((c) => c.method === 'GET');
  assert.ok(!IDENTITY_MARKERS.some((m) => get.search.includes(m)));
  for (const field of SENSITIVE_CONTACT_FIELDS) assert.ok(!get.search.includes(field), `guard read asked for ${field}`);
});

test('identity, unknown and over-long detail writes are refused before any Zoho call', async () => {
  const cases = [
    [{ PAN_Number: 'FXPAN1234F' }, 'identity-field-write'],
    [{ Bank_Account_Number: '1' }, 'identity-field-write'],
    [{ FEMA_Declaration: 'x' }, 'identity-field-write'],
    [{ KAM: IMRAN }, 'details-not-editable'],
    [{ Residency: 'NRI' }, 'details-not-editable'],
    [{ First_Name: 'x'.repeat(41) }, 'details-not-editable'],
    [{ Email: 'not-an-address' }, 'details-not-editable'],
    [{ Last_Name: ' ' }, 'details-not-editable'],
    [{ Nominee_Relation: 'Friend' }, 'details-not-editable'],
    [{}, 'details-not-editable'],
  ];
  for (const [fields, code] of cases) {
    const r = rig({});
    const result = await r.service.changeDetails(principal(IMRAN), { contactId: IMRAN_1, expectedModifiedTime: LOADED, fields });
    assert.equal(result.reasonCode, code, JSON.stringify(fields));
    assert.equal(r.calls.length, 0);
    assert.equal(r.access.calls(), 0);
    noIdentity(r.sink.records());
  }
});

test('Imran cannot write to Neha\'s account even if Zoho lets his token read it', async () => {
  const r = rig(detailsRoutes('contact.guard.neha-1', 'coql.allotments.one-neha-1', 'contact.updated'));
  const result = await r.service.changeDetails(principal(IMRAN), {
    contactId: NEHA_1, expectedModifiedTime: LOADED, fields: { Mobile: '+91 90000 22222' },
  });
  assert.equal(result.reasonCode, 'not-visible');
  assert.equal(r.writes().length, 0);
});

test('a contact changed since it was opened is not overwritten', async () => {
  const r = rig(detailsRoutes('contact.guard.imran-1-changed', 'coql.allotments.one-imran-1', 'contact.updated'));
  const result = await r.service.changeDetails(principal(IMRAN), {
    contactId: IMRAN_1, expectedModifiedTime: LOADED, fields: { Mobile: '+91 90000 11111' },
  });
  assert.equal(result.reasonCode, 'contact-changed');
  assert.equal(r.writes().length, 0);
});

test('Head of AM can change details on a pool account', async () => {
  const r = rig(detailsRoutes('contact.guard.pool', 'coql.allotments.one-pool', 'contact.updated-pool'));
  const result = await r.service.changeDetails(principal(HEAD), {
    contactId: POOL, expectedModifiedTime: LOADED, fields: { Mailing_City: 'Fixture Town' },
  });
  assert.equal(result.ok, true);
  assert.equal(r.writes().length, 1);
});

// ---------------- recordCare (Touches) ----------------

const TOUCH = Object.freeze({
  channel: 'Call', occurredAt: '2026-09-27T11:30:00+05:30', isReply: true, mood: 'Warm', note: 'Synthetic care note',
});

test('Imran logs a care touch on the investor\'s origin lead, with no identity on it', async () => {
  const r = rig({
    get: () => 'contact.guard.imran-1',
    coql: (q) => (isAllotmentQuery(q) ? 'coql.allotments.one-imran-1' : null),
    post: (module) => (module === 'Touches' ? 'touch.created' : null),
  });
  const result = await r.service.recordCare(principal(IMRAN), { contactId: IMRAN_1, expectedModifiedTime: LOADED, touch: TOUCH });
  assert.deepEqual(result, { ok: true, value: { touchId: `${P}740997001` } });
  const [post] = r.writes();
  assert.equal(post.pathname, '/crm/v8/Touches');
  assert.deepEqual(post.body, { data: [{
    Name: 'Call 2026-09-27T11:30:00+05:30',
    Lead: { id: IMRAN_1_LEAD },
    Channel: 'Call',
    Occurred_At: '2026-09-27T11:30:00+05:30',
    Is_Reply: true,
    Mood: 'Warm',
    Note: 'Synthetic care note',
  }] });
  assert.equal(r.calls.filter((c) => c.method === 'GET').length, 2, 'the contact is re-read after the final seat check');
});

test('a touch is not written when the contact changes between the two guard reads', async () => {
  const r = rig({
    get: (id, calls) => (calls.filter((c) => c.method === 'GET').length === 1 ? 'contact.guard.imran-1' : 'contact.guard.imran-1-changed'),
    coql: (q) => (isAllotmentQuery(q) ? 'coql.allotments.one-imran-1' : null),
    post: () => 'touch.created',
  });
  const result = await r.service.recordCare(principal(IMRAN), { contactId: IMRAN_1, expectedModifiedTime: LOADED, touch: TOUCH });
  assert.equal(result.reasonCode, 'contact-changed');
  assert.equal(r.writes().length, 0);
});

test('a touch is refused on another KAM\'s account, without an origin lead, or when malformed', async () => {
  const cases = [
    [IMRAN, NEHA_1, 'contact.guard.neha-1', 'coql.allotments.one-neha-1', TOUCH, 'not-visible'],
    [IMRAN, IMRAN_1, 'contact.guard.imran-1-no-lead', 'coql.allotments.one-imran-1', TOUCH, 'source-invalid'],
    [IMRAN, IMRAN_1, null, null, { ...TOUCH, channel: 'SMS' }, 'invalid-request'],
    [IMRAN, IMRAN_1, null, null, { ...TOUCH, note: '' }, 'invalid-request'],
    [IMRAN, IMRAN_1, null, null, { ...TOUCH, extra: 'x' }, 'invalid-request'],
  ];
  for (const [actor, contactId, guard, allot, touch, code] of cases) {
    const r = rig({ get: () => guard, coql: (q) => (isAllotmentQuery(q) ? allot : null), post: () => 'touch.created' });
    const result = await r.service.recordCare(principal(actor), { contactId, expectedModifiedTime: LOADED, touch });
    assert.equal(result.reasonCode, code);
    assert.equal(r.writes().length, 0);
  }
});
