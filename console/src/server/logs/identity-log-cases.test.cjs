/* R6 M19-S12-NOTE-7 — the identity-log and log-content cases that stories name and no test carried:
 *   TC-E01-010  sign-in and refusals reach the identity log (sign-in, refused page 'numbers', sign-out — Kavya)
 *   TC-E01-011  logs carry no record bodies (a known phone number, PAN and email are not found in Plane B or C)
 *   TC-IM12-006 logs carry IDs, never identity (every seeded name, PAN, bank account and note body, across a whole run)
 *   TC-IM01-019 portal calls log ids and status, never identity values (record GET has no identity fields; the reveal is a
 *               separate GET ?fields=pan; no log line holds the PAN)
 *   TC-E15-024  a server error lands in Plane B with ids only, and the failed-save burst alerts once
 * One run goes through the real session store, guard, Zoho client, error capture, authority events and the shared jsonl
 * log factory; the search is over the day files on disk and through the Logs reader, as a person reading Planes B and C would.
 * The staging halves (the same on a day of real use; the alert reaching Sahil's inbox) are listed in docs/reports/r6-missing-tests.md.
 * Run from console/: node --test src/server/logs/identity-log-cases.test.cjs */
'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const compile = require('./compile.cjs');

const consoleRoot = path.resolve(__dirname, '..', '..', '..');
const fixtureRoot = path.join(consoleRoot, 'src', 'lib', 'zoho', '__fixtures__', 'oauth');
const { outDir, load } = compile([
  'server/logs/factory.ts', 'server/logs/reader.ts', 'server/identity/authority.ts', 'server/oauth/user-session.ts', 'server/oauth/seat.ts',
  'server/oauth/crypto.ts', 'server/oauth/zoho-accounts.ts', 'server/access/guard-core.ts', 'server/data/events.ts', 'server/ops/alerts.ts',
  'server/http/error-capture.ts', 'lib/zoho/client.ts', 'lib/zoho/gate.ts', 'lib/zoho/log.ts', 'app/api/errors/route.ts',
], 'identity-log-cases');
/* user-session asks the front end's own access policy (`@/lib/...`): map `@/` onto the emitted tree (the user-session suite's rule) */
process.env.NODE_PATH = path.join(consoleRoot, 'node_modules'); Module._initPaths();
const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) { return resolveFilename.call(this, request.startsWith('@/') ? path.join(outDir, request.slice(2)) : request, ...rest); };

const { createLogSinks } = load('server/logs/factory.js');
const { queryLogs, logSourceOf } = load('server/logs/reader.js');
const { createOpsLog, createMemorySink } = load('lib/zoho/log.js');
const { createPlaneCLog } = load('server/identity/plane-c.js');
const { createErrorLog } = load('server/http/error-log.js');
const { createErrorCapture, REQUEST_ID_HEADER } = load('server/http/error-capture.js');
const { createGate } = load('lib/zoho/gate.js');
const { createZohoClient, userCredential } = load('lib/zoho/client.js');
const { createZohoSeatDirectory } = load('server/oauth/seat.js');
const { createSealer } = load('server/oauth/crypto.js');
const { createZohoAccounts } = load('server/oauth/zoho-accounts.js');
const { createUserSessions, createMemorySessionStore, NO_GRANTS } = load('server/oauth/user-session.js');
const { createGuard } = load('server/access/guard-core.js');
const { createInvestorEvents } = load('server/data/events.js');
const { createAlertEngine, createOutboxMailer, eventsFromErrors } = load('server/ops/alerts.js');

/* ---- synthetic values that must never reach a log (none is a real person, PAN, account or note) ---- */
const PAN = 'ABCDE1234F';
const BANK = '50100123456789';
const PHONE = '9876543210';
const EMAIL = 'sanjay.menon@example.invalid';
const NAMES = ['Sanjay Menon', 'Menon', 'Sanjay'];
const NOTE = 'Spoke to him about the cheque, he will confirm after the audit';
const NEEDLES = [PAN, BANK, PHONE, '98765 43210', EMAIL, 'example.invalid', NOTE, 'audit', 'cheque', ...NAMES].map((s) => s.toLowerCase());
const DAY = Date.UTC(2026, 8, 28, 10);
const PREFIX = '554023';
const INVESTOR = `${PREFIX}000000527003`;

const readJson = (n) => JSON.parse(fs.readFileSync(path.join(fixtureRoot, n), 'utf8'));
const seats = readJson('current-user.seats.response.json');
const codeGrant = readJson('user-token.code.response.json');
const refreshGrant = readJson('user-token.refresh.response.json');
const revokeOk = readJson('user-token.revoke.response.json');
const reply = (r) => ({ status: r.status, headers: { get: (n) => (r.headers || {})[n.toLowerCase()] || null }, text: async () => JSON.stringify(r.body), body: null });
const streamReply = (status, obj) => {
  const bytes = new TextEncoder().encode(JSON.stringify(obj)); let sent = false;
  return { status, headers: { get: () => null }, body: { getReader: () => ({ read: async () => (sent ? { done: true } : (sent = true, { done: false, value: bytes })), cancel: async () => {}, releaseLock() {} }) },
    text: async () => { throw new Error('the streamed reader is authoritative'); } };
};
const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

/** One run: the shared jsonl sinks, a session store on them, a guard over those sessions, a Zoho client and error capture. */
function run() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gz-idlog-'));
  process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
  let now = DAY; const clock = () => now;
  const shared = createLogSinks({ LOG_STORE: 'jsonl', LOG_DIR: dir }, { clock });
  const log = createOpsLog(shared.ops);
  const planeC = createPlaneCLog(shared.identity);
  /* the user the fixture's CurrentUser answers with, carrying the identity fields we must never keep */
  const user = { users: [{ ...seats.accepted.find((x) => x.seat === 'investor-relations').body.users[0], email: EMAIL, full_name: 'Kavya Nair' }] };
  const accounts = createZohoAccounts({ accountsOrigin: 'https://accounts.zoho.in', clientId: 'synthetic-client-id', clientSecret: 'synthetic-client-secret',
    redirectUri: 'https://console.example.invalid/api/auth/zoho/callback', scopes: ['ZohoCRM.users.READ'], log, clock,
    fetch: async (url, init) => (url.includes('/token/revoke') ? reply(revokeOk) : reply(new URLSearchParams(init.body).get('grant_type') === 'authorization_code' ? codeGrant : refreshGrant)) });
  const sessions = createUserSessions({ accounts, sealer: createSealer(crypto.randomBytes(32).toString('base64')), store: createMemorySessionStore(),
    seats: createZohoSeatDirectory({ recordIdPrefix: seats.recordIdPrefix, roleIds: seats.roleIds, profileIds: seats.profileIds }),
    grants: NO_GRANTS, planeC, gate: createGate(), log, recordIdPrefix: seats.recordIdPrefix, identityFetch: async () => streamReply(200, user), clock });
  let sid = null;
  const guard = createGuard({ mode: () => 'enforce', planeC, clock,
    async readSession() { const r = await sessions.current(sid); return r.ok ? { ok: true, session: r.session } : { ok: false, why: r.why }; } });
  const raw = { identity: shared.identity, ops: shared.ops, errors: shared.errors };
  const dayLines = () => fs.readdirSync(dir).flatMap((f) => fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean));
  const signIn = async () => {
    const { url, flowCookie } = sessions.start();
    const r = await sessions.callback({ code: 'synthetic-code-1000.abc', state: new URL(url).searchParams.get('state'), error: null, accountsServer: 'https://accounts.zoho.in' }, flowCookie);
    assert.equal(r.ok, true); sid = r.sid; return r;
  };
  return { dir, shared, log, planeC, sessions, guard, raw, dayLines, signIn, signOut: () => sessions.signOut(sid), advance: (ms) => { now += ms; }, clock, errorLog: createErrorLog(shared.errors), user: user.users[0] };
}

const leaks = (lines) => lines.flatMap((l) => { const s = (typeof l === 'string' ? l : JSON.stringify(l)).toLowerCase(); return NEEDLES.filter((n) => s.includes(n)).map((n) => `${n} in ${s.slice(0, 200)}`); });

/** Everything a day of use writes that carries a body, a name, a note or an identity value on its way: a Zoho client that
 *  is handed them in URLs, queries and responses, a route that throws with them in its message, a refused page. */
async function useTheAppWithSeededValues(r) {
  const me = r.user.id;
  await r.signIn();
  const cred = await userCredential({ access_token: '1000.aaaabbbbccccddddeeeeffff.1111', api_domain: 'https://www.zohoapis.in', expires_in: 3600, token_type: 'Bearer' }, {
    recordIdPrefix: PREFIX, gate: createGate(), log: r.log, fetch: async () => json(200, { users: [{ id: me, status: 'active', email: EMAIL, full_name: 'Sanjay Menon' }] }) });
  const body = { id: INVESTOR, First_Name: 'Sanjay', Last_Name: 'Menon', Mobile: PHONE, Email: EMAIL, Description: NOTE, pan: PAN, bank_account: BANK };
  const client = createZohoClient({ gate: createGate(), log: r.log, recordIdPrefix: PREFIX, clock: r.clock, sleep: async () => {}, maxAttempts: 1,
    fetch: async (url) => (String(url).includes('/search') ? json(200, { data: [body], info: { more_records: false } }) : json(200, { data: [body] })) });
  await client.search(cred, 'Contacts', { phone: PHONE });
  await client.search(cred, 'Contacts', { email: EMAIL });
  await client.search(cred, 'Contacts', { word: 'Sanjay Menon' });
  await client.getRecord(cred, 'Contacts', INVESTOR);
  await client.update(cred, 'Contacts', INVESTOR, { Description: NOTE, Mobile: PHONE }, { ifUnmodifiedSince: null });
  const bad = createZohoClient({ gate: createGate(), log: r.log, recordIdPrefix: PREFIX, sleep: async () => {}, maxAttempts: 1,
    fetch: async () => json(400, { data: [{ code: 'DUPLICATE_DATA', status: 'error', message: `${PHONE} ${EMAIL} ${PAN} ${NOTE}`, details: { api_name: 'Mobile', value: PHONE } }] }) });
  await bad.insert(cred, 'Contacts', [{ Last_Name: 'Menon', Mobile: PHONE, Email: EMAIL, Description: NOTE }]);
  /* a route that throws with the values in its message, body and URL */
  const wrap = createErrorCapture({ log: r.errorLog, clock: r.clock, newId: () => 'seeded-req-0001' });
  const handler = wrap(async (request) => { await request.text(); throw Object.assign(new TypeError(`failed for ${EMAIL} ${PHONE} ${PAN} ${NOTE}`), { body }); }, '/api/investors/[id]');
  await handler(new Request(`http://x/api/investors/${INVESTOR}?phone=${PHONE}`, { method: 'POST', headers: { cookie: 'gz_session=' + Buffer.from(JSON.stringify({ who: me, seat: 'ir' })).toString('base64url') }, body: JSON.stringify(body) }), {});
  /* the reveal of a PAN by a seat that holds the right, then a refused page for the signed-in IR */
  createInvestorEvents({ log: r.log, planeC: r.planeC, clock: r.clock }).reveal(me, 'head', 'pan', INVESTOR, 'ok', 'tds-filing');
  assert.equal((await r.guard.page('numbers')).ok, false);
  await r.signOut();
}

test('TC-E01-010: Kavya signs in, opens /numbers directly and signs out — Plane C holds a sign-in, a refused page "numbers" and a sign-out, with times', async () => {
  const r = run();
  await r.signIn(); r.advance(60_000);
  const v = await r.guard.page('numbers');                    /* /numbers typed into the address bar: an IR does not hold Numbers */
  assert.equal(v.ok, false); assert.equal(v.status, 403);
  r.advance(60_000); await r.signOut();
  /* read the identity log the way the Logs page does: through the reader, over the day files */
  const res = await queryLogs({ seat: 'di' }, { plane: 'c', from: '2026-09-28', to: '2026-09-28' }, logSourceOf(r.shared), DAY + 3_600_000);
  assert.equal(res.ok, true);
  const mine = res.rows.filter((x) => x.actorId === r.user.id).sort((a, b) => a.at - b.at);
  assert.deepEqual(mine.map((x) => [x.kind, x.outcome, x.reason]), [['sign-in', 'ok', 'zoho'], ['refused-page', 'refused', 'numbers'], ['sign-out', 'ended', 'chose']]);
  assert.ok(mine.every((x) => Number.isFinite(x.at) && /\+05:30$/.test(x.when)), 'each entry has a timestamp');
  assert.ok(mine[0].at < mine[1].at && mine[1].at < mine[2].at, 'in the order they happened');
  assert.ok(mine.every((x) => x.seat === 'ir'), 'the seat token is filed, never a name');
  assert.ok(!JSON.stringify(res).includes('Kavya') && !JSON.stringify(res).includes(EMAIL), 'the identity log names her by id only');
});

test('TC-E01-011: a known phone number, PAN and email are not found in the operations or identity logs after a run that handled them', async () => {
  const r = run();
  await useTheAppWithSeededValues(r);
  const lines = r.dayLines();
  assert.ok(lines.length >= 12, `a run that writes lines (${lines.length})`);
  for (const needle of [PHONE, PAN, EMAIL]) {
    assert.deepEqual(lines.filter((l) => l.toLowerCase().includes(needle.toLowerCase())), [], `${needle} appears in a day file`);
    for (const plane of ['b', 'c']) {
      const res = await queryLogs({ seat: 'di' }, { plane, from: '2026-09-28', to: '2026-09-28', limit: '500' }, logSourceOf(r.shared), DAY + 3_600_000);
      assert.equal(JSON.stringify(res).toLowerCase().includes(needle.toLowerCase()), false, `${needle} is returned by the Logs reader on plane ${plane}`);
    }
  }
});

test('TC-IM12-006: no seeded name, PAN, bank account or note body appears in any log line of the run, in memory or on disk', async () => {
  const r = run();
  await useTheAppWithSeededValues(r);
  const memory = [...r.shared.ops.records(), ...r.shared.identity.events(), ...r.shared.errors.records()];
  const disk = r.dayLines();
  assert.equal(disk.length, memory.length, 'every line reached the day files');
  assert.deepEqual(leaks(memory), []);
  assert.deepEqual(leaks(disk), []);
  const kinds = new Set(memory.map((x) => x.kind ?? x.action));
  for (const k of ['zoho-call', 'route-error', 'sign-in', 'sign-out', 'reveal', 'refused-page']) assert.ok(kinds.has(k), `the run wrote a ${k} line`);
});

test('TC-IM01-019: the record GET never asks for pan or bank_account; the reveal is a separate GET ?fields=pan; no log line holds the PAN', async () => {
  const r = run();
  const me = r.user.id; const urls = [];
  const cred = await userCredential({ access_token: '1000.aaaabbbbccccddddeeeeffff.1111', api_domain: 'https://www.zohoapis.in', expires_in: 3600, token_type: 'Bearer' }, {
    recordIdPrefix: PREFIX, gate: createGate(), log: r.log, fetch: async () => json(200, { users: [{ id: me, status: 'active' }] }) });
  const client = createZohoClient({ gate: createGate(), log: r.log, recordIdPrefix: PREFIX, clock: r.clock, sleep: async () => {}, maxAttempts: 1,
    fetch: async (url) => {
      const u = new URL(String(url)); urls.push(u);
      const asked = (u.searchParams.get('fields') || '').split(',');
      return json(200, { data: [{ id: INVESTOR, ...(asked.includes('pan') ? { pan: PAN } : {}), Last_Name: 'Menon', Stage: 'Reserved' }] });
    } });
  const { safeFields, IDENTITY_FIELDS } = require(path.join(outDir, 'lib', 'zoho', 'identity.js'));
  const wanted = ['id', 'Last_Name', 'Stage', 'pan', 'bank_account', 'Aadhaar_Number'];
  const view = await client.getRecord(cred, 'Contacts', INVESTOR, { fields: safeFields(wanted) });      /* "Open ARL-INV-0208" */
  assert.equal(view.ok, true);
  assert.deepEqual(urls[0].searchParams.get('fields').split(','), ['id', 'Last_Name', 'Stage'], 'the record GET names no identity field');
  assert.ok(!IDENTITY_FIELDS.some((f) => urls[0].search.includes(f)));
  assert.equal(view.value.pan, undefined);
  const revealed = await client.getRecord(cred, 'Contacts', INVESTOR, { fields: ['pan'] });             /* "Reveal the PAN with a reason and step-up" */
  assert.equal(urls[1].searchParams.get('fields'), 'pan', 'the reveal is a separate GET for the one field');
  assert.equal(revealed.value.pan, PAN, 'the person who revealed it gets the value');
  createInvestorEvents({ log: r.log, planeC: r.planeC, clock: r.clock }).reveal(me, 'head', 'pan', INVESTOR, 'ok', 'identity-check');
  const lines = [...r.shared.ops.records(), ...r.shared.identity.events(), ...r.dayLines()];
  assert.deepEqual(lines.filter((l) => JSON.stringify(l).includes(PAN)), [], 'no log entry contains the PAN value');
  const calls = r.shared.ops.records().filter((x) => x.kind === 'zoho-call' && x.op === 'getRecord');
  assert.equal(calls.length, 2); assert.ok(calls.every((c) => c.status === 200 && JSON.stringify(c.recordIds) === JSON.stringify([INVESTOR])), 'the calls log ids and status');
  const rev = r.shared.identity.events().find((e) => e.action === 'reveal');
  assert.deepEqual([rev.reason, rev.why, rev.recordIds], ['pan', 'identity-check', [INVESTOR]], 'the reveal is a Plane C line: the field and a reason code, never the value');
});

test('TC-E15-024: a 500 on the lead read lands in Plane B with ids only, and three failed saves in ten minutes send one alert', async () => {
  const r = run();
  const mailer = createOutboxMailer();
  let now = DAY;
  const engine = createAlertEngine({ mailer, to: 'alerts@example.invalid', clock: () => now });
  const wrap = createErrorCapture({ log: r.errorLog, clock: () => now, newId: () => 'lead-read-500', onRecord: (rec) => { for (const e of eventsFromErrors(rec)) engine.record(e); } });
  const session = 'gz_session=' + Buffer.from(JSON.stringify({ who: 'kavya', seat: 'ir' })).toString('base64url');   /* the person key the error line files (error-capture userIdOf) */
  const leadRead = wrap(async () => { throw Object.assign(new Error(`read failed for ${EMAIL} ${PHONE}`), { body: { Last_Name: 'Menon', pan: PAN } }); }, '/api/leads/[id]');
  const res = await leadRead(new Request(`http://x/api/leads/${INVESTOR}?phone=${PHONE}`, { headers: { cookie: session, [REQUEST_ID_HEADER]: 'req-lead-read-1' } }), {});
  assert.equal(res.status, 500);
  const [line] = r.shared.errors.records();
  assert.deepEqual([line.kind, line.requestId, line.userId, line.route, line.status], ['route-error', 'req-lead-read-1', 'kavya', '/api/leads/[id]', 500], 'request id, user id, route and status');
  assert.deepEqual(leaks([line, ...r.dayLines()]), [], 'no body, name, phone, email, PAN or UTR');
  assert.equal(r.dayLines().length, 1);
  /* three failed saves inside ten minutes: the third fires one alert, which names request ids and a route, nobody */
  const { POST } = load('app/api/errors/route.js');
  const rt = load('server/ops/runtime.js');
  rt.errorLines.clear(); rt.alertOutbox.clear();
  for (let i = 0; i < 3; i++) {
    const b = await POST(new Request('http://x/api/errors', { method: 'POST', headers: { cookie: session, [REQUEST_ID_HEADER]: `beacon-req-${i}0000` }, body: JSON.stringify({ source: 'save-failed', route: '/leads/1', requestId: `save-req-${i}0000`, zohoStatus: 400, zohoCode: 'INVALID_DATA' }) }), {});
    assert.equal(b.status, 204); now += 2 * 60_000;
  }
  await rt.alertEngine().settled();
  assert.equal(rt.alertOutbox.sent().length, 1, 'one alert for the burst');
  const text = rt.alertOutbox.sent()[0].text;
  assert.match(text, /save-req-20000/); assert.ok(!text.includes('kavya') && !text.includes(PHONE));
});

/* GAP found while writing TC-E15-024 (reported, not fixed here: server/http/error-capture is r6-deadlines' file): userIdOf reads the
   fixture-mode cookie gz_session (a person key), and safeUserId refuses an all-digit string — which every Zoho user id is. A live
   session carries gz_zsid, so a live route-error line files userId null, where the case wants the user id. */
test('TC-E15-024 (live half): a route-error line for a Zoho-signed-in person carries their Zoho user id', { todo: 'GAP: live error lines file userId null (userIdOf reads gz_session; safeUserId drops digit-only ids)' }, async () => {
  const r = run();
  const wrap = createErrorCapture({ log: r.errorLog, clock: r.clock, newId: () => 'live-500-0001' });
  const session = 'gz_session=' + Buffer.from(JSON.stringify({ who: r.user.id, seat: 'ir' })).toString('base64url');
  await wrap(async () => { throw new Error('x'); }, '/api/leads/[id]')(new Request('http://x/api/leads/1', { headers: { cookie: session } }), {});
  assert.equal(r.shared.errors.records()[0].userId, r.user.id);
});
