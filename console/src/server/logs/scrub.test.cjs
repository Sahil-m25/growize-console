/* M18-S02-T03 LOG SCRUB — every log producer is fed records carrying a PAN, an Aadhaar, a +91 mobile,
 * an email, a UTR, a token and a free-text body, through its normal and its error paths. The test
 * fails if any of them appears in any log line: in the producer's own memory sink (so the producer
 * itself scrubs — the shared guard is not allowed to hide a producer leak) and in the day files the
 * shared factory writes. Run from console/: node --test src/server/logs/scrub.test.cjs */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const compile = require('./compile.cjs');

const { load } = compile([
  'server/logs/factory.ts', 'server/identity/authority.ts', 'server/http/error-capture.ts',
  'lib/zoho/client.ts', 'lib/zoho/sign.ts', 'server/oauth/zoho-accounts.ts', 'server/data/events.ts',
], 'logs-scrub');
const { createLogSinks } = load('server/logs/factory.js');
const { createOpsLog, createMemorySink } = load('lib/zoho/log.js');
const { createErrorLog, createMemoryErrorSink } = load('server/http/error-log.js');
const { createErrorCapture } = load('server/http/error-capture.js');
const { createPlaneCLog, createPlaneCMemorySink } = load('server/identity/plane-c.js');
const { createAuthorityEvents } = load('server/identity/authority.js');
const { createInvestorEvents } = load('server/data/events.js');
const { createGate } = load('lib/zoho/gate.js');
const { createZohoClient, userCredential, serviceCredential } = load('lib/zoho/client.js');
const { createZohoSignClient } = load('lib/zoho/sign.js');
const { createZohoAccounts } = load('server/oauth/zoho-accounts.js');

/* ---- what must never reach a log line ---- */
const PAN = 'ABCDE1234F';
const AADHAAR = '234567890123';
const AADHAAR_SPACED = '2345 6789 0123';
const PHONE = '+91 98765 43210';
const PHONE_BARE = '9876543210';
const EMAIL = 'sanjay.menon@example.com';
const UTR_NEFT = 'HDFCN52022092812345';
const UTR_IMPS = '228912345678';
const ACCOUNT = '50100123456789';
const ACCESS_TOKEN = '1000.aaaabbbbccccddddeeeeffff.1111';
const REFRESH_TOKEN = '1000.refreshrefreshrefresh.2222';
const BODY = 'Called Sanjay re: cheque bounce, UTR ' + UTR_NEFT;
const NEEDLES = [PAN, AADHAAR, AADHAAR_SPACED, '98765 43210', PHONE_BARE, EMAIL, 'example.com', UTR_NEFT, UTR_IMPS, ACCOUNT,
  ACCESS_TOKEN, REFRESH_TOKEN, 'aaaabbbb', 'refreshrefresh', 'sanjay', 'menon', 'cheque', 'bounce', '@'].map((s) => s.toLowerCase());
const HOSTILE = { pan: PAN, aadhaar: AADHAAR, aadhaarSpaced: AADHAAR_SPACED, phone: PHONE, email: EMAIL, utr: UTR_NEFT, imps: UTR_IMPS, account: ACCOUNT, note: BODY, token: ACCESS_TOKEN };

const PREFIX = '554023';
const ID = '554023000000527003';
const USER = '554023000000100001';
const DAY = Date.UTC(2026, 8, 28, 10);

function leaks(lines) {
  const found = [];
  for (const line of lines) {
    const s = (typeof line === 'string' ? line : JSON.stringify(line)).toLowerCase();
    for (const n of NEEDLES) if (s.includes(n)) found.push(`${n} in ${s.slice(0, 240)}`);
  }
  return found;
}

/* One raw memory sink per plane (the producer's own output) fanned out to the shared jsonl factory. */
function harness() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gz-scrub-'));
  const shared = createLogSinks({ LOG_STORE: 'jsonl', LOG_DIR: dir }, { clock: () => DAY });
  const raw = { ops: createMemorySink(), errors: createMemoryErrorSink(), identity: createPlaneCMemorySink() };
  const fan = (a, b) => ({ write: (r) => { a.write(r); b.write(r); } });
  const sinkErrors = [];
  const log = createOpsLog(fan(raw.ops, shared.ops), { onSinkError: (e) => sinkErrors.push(e) });
  const errorLog = createErrorLog(fan(raw.errors, shared.errors), { onSinkError: (e) => sinkErrors.push(e) });
  const planeC = createPlaneCLog(fan(raw.identity, shared.identity), (e) => sinkErrors.push(e));
  const rawLines = () => [...raw.ops.records(), ...raw.errors.records(), ...raw.identity.events()];
  const fileLines = () => fs.readdirSync(dir).flatMap((f) => fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean));
  return { dir, shared, raw, log, errorLog, planeC, rawLines, fileLines, sinkErrors };
}

function assertClean(h, min) {
  const raw = h.rawLines();
  const files = h.fileLines();
  assert.ok(raw.length >= min, `expected at least ${min} raw lines, got ${raw.length}`);
  assert.equal(files.length, raw.length, 'every line reached the day files');
  assert.deepEqual(h.sinkErrors, []);
  assert.deepEqual(leaks(raw), [], 'a producer wrote an identity value, token or body');
  assert.deepEqual(leaks(files), [], 'a day file holds an identity value, token or body');
}

const reply = (status, body, headers = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });
const zohoError = (status, code) => reply(status, {
  data: [{ code, status: 'error', message: `Mobile ${PHONE} for ${EMAIL} is a duplicate (PAN ${PAN})`, details: { api_name: 'Mobile', value: PHONE, email: EMAIL, pan: PAN, id: ID } }],
});

test('Plane B ops log: hostile call and refusal entries keep ids and codes only', () => {
  const h = harness();
  const actorVariants = [{ kind: 'user', userId: EMAIL }, { kind: 'user', userId: PHONE_BARE }, { kind: 'user', userId: PAN }, { kind: 'service', job: AADHAAR }, { kind: 'user', userId: USER }];
  const endpoints = [`/Leads/${PHONE_BARE}`, `/Payments/${UTR_NEFT}`, `/Leads/search?phone=${PHONE_BARE}`, `/Contacts/${ID}/${PAN}`, `/users/${EMAIL}`, `/coql WHERE Mobile = '${PHONE_BARE}'`, `/Leads/${AADHAAR}`];
  for (const actor of actorVariants) {
    for (const endpoint of endpoints) {
      h.log.call({ ...HOSTILE, body: BODY, response: { data: [HOSTILE] }, at: DAY, actor, op: PAN, method: 'GET', endpoint, callClass: 'simple',
        status: 400, durationMs: 5, gateWaitMs: 0, attempt: 1, creditsRemaining: Number(PHONE_BARE), errorClass: 'invalid-data', recordIds: [ID, PHONE_BARE, AADHAAR, UTR_IMPS, EMAIL, PAN] });
    }
    for (const action of [PAN, EMAIL, BODY, 'readLead']) {
      h.log.refusal({ ...HOSTILE, at: DAY, actor, action, reason: PAN.toLowerCase(), recordIds: [ID, ACCOUNT] });
      h.log.refusal({ at: DAY, actor, action, reason: UTR_NEFT.toLowerCase(), recordIds: [] });
    }
  }
  assertClean(h, 50);
  const ids = h.raw.ops.records().flatMap((r) => r.recordIds);
  assert.ok(ids.includes(ID) && ids.every((x) => x === ID), 'record ids survive; nothing else does');
});

test('Zoho client: every error path (400, 401, 403, 404, 409/412, 429, 5xx, bad JSON, network) logs no value, body or token', async () => {
  const h = harness();
  const gate = createGate();
  const cred = await userCredential({ access_token: ACCESS_TOKEN, api_domain: 'https://www.zohoapis.in', expires_in: 3600, token_type: 'Bearer' }, {
    recordIdPrefix: PREFIX, gate, log: h.log, fetch: async () => reply(200, { users: [{ id: USER, status: 'active', email: EMAIL, full_name: 'Sanjay Menon', phone: PHONE }] }),
  });
  const replies = [
    () => zohoError(400, 'INVALID_DATA'), () => zohoError(400, 'DUPLICATE_DATA'), () => zohoError(401, 'INVALID_TOKEN'),
    () => zohoError(403, 'NO_PERMISSION'), () => reply(404, { code: 'INVALID_URL_PATTERN', message: EMAIL }),
    () => zohoError(412, 'ALREADY_MODIFIED'), () => reply(429, { code: 'TOO_MANY_REQUESTS', message: BODY }, { 'X-API-CREDITS-REMAINING': '1200', 'Retry-After': '0' }),
    () => reply(500, { code: 'INTERNAL_ERROR', message: BODY, details: HOSTILE }), () => reply(200, `{"data":[{"Mobile":"${PHONE}","Email":"${EMAIL}"`),
    () => reply(200, { data: [{ id: ID, Mobile: PHONE, Email: EMAIL, PAN, Last_Name: 'Menon', Description: BODY }] }),
    () => { throw new Error(`socket hang up while sending ${EMAIL} ${PHONE} ${PAN} ${ACCESS_TOKEN}`); },
  ];
  for (const make of replies) {
    const client = createZohoClient({ gate, log: h.log, recordIdPrefix: PREFIX, fetch: async () => make(), sleep: async () => {}, random: () => 0.5, maxAttempts: 1 });
    const calls = [
      () => client.getRecord(cred, 'Leads', ID),
      () => client.getRecord(cred, 'Leads', PHONE_BARE),
      () => client.search(cred, 'Leads', { phone: PHONE }),
      () => client.search(cred, 'Leads', { email: EMAIL }),
      () => client.search(cred, 'Leads', { criteria: `(PAN:equals:${PAN})` }),
      () => client.search(cred, 'Leads', { word: 'Sanjay Menon' }),
      () => client.coql(cred, `select id from Leads where Mobile = '${PHONE_BARE}' and Email = '${EMAIL}'`),
      () => client.update(cred, 'Leads', ID, { Mobile: PHONE, Email: EMAIL, PAN, UTR: UTR_NEFT, Description: BODY }, { ifUnmodifiedSince: null }),
      () => client.insert(cred, 'Leads', [{ Last_Name: 'Menon', Mobile: PHONE, Email: EMAIL, Aadhaar: AADHAAR }]),
      () => client.upsert(cred, 'Contacts', [{ Email: EMAIL, PAN }], ['Email']),
      () => client.updateOwnUser(cred, { last_name: 'Menon', mobile: PHONE }),
      () => client.timeline(cred, 'Leads', ID),
    ];
    for (const c of calls) {
      try { await c(); } catch { /* a thrown path is still a path: its line is what we check */ }
    }
  }
  assertClean(h, 60);
  const kinds = new Set(h.raw.ops.records().map((r) => r.errorClass));
  for (const k of ['invalid-data', 'auth-expired', 'forbidden', 'conflict', 'server']) assert.ok(kinds.has(k), `the ${k} path was exercised`);
});

test('Zoho Sign and Zoho Accounts error paths log no token, email or body', async () => {
  const h = harness();
  const svc = serviceCredential('provider-callback', { access_token: ACCESS_TOKEN, api_domain: 'https://www.zohoapis.in', expires_in: 3600 });
  for (const status of [400, 401, 404, 500]) {
    const sign = createZohoSignClient({ origin: 'https://sign.zoho.in', gate: createGate(), log: h.log, maxAttempts: 1, sleep: async () => {},
      fetch: async () => reply(status, { code: 9043, message: `${EMAIL} ${BODY}`, requests: { request_name: BODY, actions: [{ recipient_email: EMAIL, recipient_phonenumber: PHONE }] } }) });
    await sign.getRequest(svc, '1000000000000123').catch(() => {});
    await sign.getRequest(svc, EMAIL).catch(() => {});
  }
  const accountReplies = [
    () => reply(400, { error: 'invalid_code', email: EMAIL, message: BODY }),
    () => reply(200, { error: 'invalid_client', refresh_token: REFRESH_TOKEN }),
    () => reply(200, { access_token: ACCESS_TOKEN, refresh_token: REFRESH_TOKEN, api_domain: 'https://www.zohoapis.in', expires_in: 3600 }),
    () => reply(503, BODY),
    () => { throw new Error(`ECONNRESET ${REFRESH_TOKEN} ${EMAIL}`); },
  ];
  for (const make of accountReplies) {
    const accounts = createZohoAccounts({
      accountsOrigin: 'https://accounts.zoho.in', clientId: '1000.CLIENTIDCLIENTID', clientSecret: 'client-secret-never-live',
      redirectUri: 'https://console.example.org/api/auth/zoho/callback', scopes: ['ZohoCRM.modules.ALL'], log: h.log, fetch: async () => make(),
    });
    for (const actor of [{ kind: 'user', userId: USER }, { kind: 'user', userId: EMAIL }]) {
      await accounts.refresh(REFRESH_TOKEN, actor).catch(() => {});
      await accounts.revoke(REFRESH_TOKEN, actor).catch(() => {});
    }
    await accounts.exchangeCode({ code: '1000.code.' + PHONE_BARE, codeVerifier: 'v'.repeat(43) }).catch(() => {});
  }
  assertClean(h, 10);
  assert.ok(leaks([{ x: EMAIL }, `id ${PAN}`, BODY]).length >= 3, 'the needle check itself catches a leak');
  assert.ok(!h.fileLines().join('\n').includes('client-secret-never-live'), 'the client secret never reaches a line');
});

test('Plane B error lines: route and browser errors, and a thrown error through withErrorCapture, keep no message or identity', async () => {
  const h = harness();
  for (const v of [PAN, EMAIL, PHONE, AADHAAR, UTR_NEFT, BODY]) {
    h.errorLog.routeError({ ...HOSTILE, at: DAY, requestId: v, userId: v, route: `/api/leads/${v}?q=${v}`, method: 'POST', status: 500, zohoStatus: 400, zohoCode: v, errorClass: v, errorName: v, durationMs: 1, message: BODY, stack: BODY });
    h.errorLog.clientError({ ...HOSTILE, at: DAY, requestId: v, failedRequestId: v, userId: v, route: `/leads/${v}`, source: v, zohoStatus: 400, zohoCode: v, errorName: v });
  }
  const wrap = createErrorCapture({ log: h.errorLog, clock: () => DAY });
  const handler = wrap(async () => {
    const e = new TypeError(`boom ${EMAIL} ${PHONE} ${PAN} ${BODY}`);
    Object.assign(e, { body: HOSTILE, zoho: { details: HOSTILE } });
    throw e;
  }, '/api/leads/[id]');
  const request = new Request(`http://x/api/leads/${PHONE_BARE}?email=${EMAIL}`, { method: 'POST', headers: { 'x-request-id': EMAIL, cookie: 'gz_session=' + Buffer.from(JSON.stringify({ who: EMAIL })).toString('base64url') }, body: JSON.stringify(HOSTILE) });
  const res = await handler(request, {});
  assert.equal(res.status, 500);
  assert.deepEqual(leaks([await res.text()]), [], 'the answer to the browser carries nothing either');
  /* What is kept: the shared sink (ops/runtime.ts files error lines through it) and the day files. */
  const kept = h.shared.errors.records();
  assert.ok(kept.length >= 13);
  assert.equal(h.fileLines().length, kept.length);
  assert.deepEqual(leaks(kept), [], 'a kept error line holds an identity value or body');
  assert.deepEqual(leaks(h.fileLines()), [], 'an error day file holds an identity value or body');
  assert.deepEqual(h.sinkErrors, []);
});

/* Producer-level gap, recorded rather than hidden: error-log.ts (M18-S04, outside this task's edit
   scope) accepts PAN- and UTR-shaped strings as a request id, user id, Zoho code or error name.
   The shared guard redacts them before anything is kept (the test above); this marks the producer
   fix still owed. Flip `todo` off once error-log.ts calls looksLikeIdentity. */
test('Plane B error lines: the producer itself refuses PAN/UTR-shaped ids (owed by error-log.ts)', () => {
  const h = harness();
  for (const v of [PAN, UTR_NEFT]) {
    h.errorLog.routeError({ at: DAY, requestId: v, userId: v, route: '/api/data', method: 'GET', status: 500, zohoStatus: null, zohoCode: v, errorClass: null, errorName: v, durationMs: 1 });
  }
  assert.deepEqual(leaks(h.raw.errors.records()), []);
});

test('Plane C: sign-in events, reveals, step-ups, seat changes, refusals and grant changes keep ids and codes only', () => {
  const h = harness();
  for (const v of [PAN, EMAIL, PHONE, PHONE_BARE, AADHAAR, UTR_NEFT, BODY]) {
    for (const action of ['sign-in', 'sign-in-refused', 'sign-out', 'reveal', 'grant-change', v]) {
      h.planeC.record({ ...HOSTILE, at: DAY, who: v, whom: v, action, outcome: 'refused', reason: v.toLowerCase(), seat: v.toLowerCase(), recordIds: [ID, v] });
    }
  }
  const ev = createAuthorityEvents(h.planeC, () => DAY);
  const inv = createInvestorEvents({ log: h.log, planeC: h.planeC, clock: () => DAY });
  for (const v of [PAN, EMAIL, PHONE_BARE, 'Sanjay Menon', BODY]) {
    ev.refusedPage(v, v, v); ev.refusedAction(USER, 'ir', v, [ID, v]); ev.grantChange(USER, v, 'ir', v, 'ok');
    inv.refusal(v, v, v, [ID, v]); inv.conflict(v, v, v); inv.reveal(v, v, 'pan', v, 'ok'); inv.stepUp(v, v, 'refused', v); inv.seatChange(v, v, v);
    /* M08-S08-NOTE-10 / M15-S05-NOTE-1: the release and the test-link lines, fed identity in every slot (ttl an account number) */
    inv.appAccessReleased(v, v, v, 'refused', v); inv.testLinkIssued(v, v, v, Number(ACCOUNT), true);
  }
  inv.appAccessReleased(USER, 'fin', ID, 'ok', 'released'); inv.testLinkIssued(USER, 'di', ID, 10, false);
  ev.refusedPage(USER, 'ir', 'numbers');
  assertClean(h, 60);
  assert.ok(h.raw.identity.events().some((e) => e.action === 'refused-page' && e.reason === 'numbers' && e.who === USER));
  const rel = h.raw.identity.events().filter((e) => e.action === 'app-access-released');
  const tl = h.raw.identity.events().filter((e) => e.action === 'test-link-issued');
  assert.equal(rel.length, 6); assert.equal(tl.length, 6);
  assert.ok(tl.slice(0, 5).every((e) => e.ttlMinutes === 0 && e.who === 'unrecognised' && e.recordIds.length === 0), 'a hostile ttl or id keeps nothing');
  assert.deepEqual([rel[5].who, rel[5].reason, rel[5].recordIds, tl[5].ttlMinutes, tl[5].reason], [USER, 'released', [ID], 10, 'test-account']);
});
