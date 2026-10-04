/* M18-S04-T01 ERROR CAPTURE TO PLANE B — request id, user id, route, Zoho status/code; never a body or identity.
 * Run from console/: node --test src/server/http/error-capture.test.cjs
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const consoleRoot = path.resolve(__dirname, '..', '..', '..');
const srcRoot = path.join(consoleRoot, 'src');
const ts = require(path.join(consoleRoot, 'node_modules', 'typescript'));
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'error-capture-'));
process.on('exit', () => fs.rmSync(outDir, { recursive: true, force: true }));

const config = ts.readConfigFile(path.join(consoleRoot, 'tsconfig.json'), ts.sys.readFile);
const project = ts.parseJsonConfigFileContent(config.config, ts.sys, consoleRoot);
const options = {
  ...project.options, incremental: false, tsBuildInfoFile: undefined, plugins: undefined,
  module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10,
  noEmit: false, noEmitOnError: true, outDir, rootDir: srcRoot,
};
const roots = [
  path.join(srcRoot, 'server', 'http', 'error-capture.ts'),
  path.join(srcRoot, 'app', 'api', 'errors', 'route.ts'),
  path.join(srcRoot, 'lib', 'zoho', 'error-beacon.ts'),
];
const program = ts.createProgram(roots, options);
const format = (items) => ts.formatDiagnostics(items, { getCanonicalFileName: (f) => f, getCurrentDirectory: () => consoleRoot, getNewLine: () => '\n' });
const diagnostics = ts.getPreEmitDiagnostics(program);
if (diagnostics.length) { console.error(format(diagnostics)); process.exit(1); }
const emitted = program.emit();
if (emitted.diagnostics.length) { console.error(format(emitted.diagnostics)); process.exit(1); }

const out = (...p) => require(path.join(outDir, ...p));
const { createErrorCapture, ZohoRouteError, noteZohoFailure, currentRequestId, REQUEST_ID_HEADER } = out('server', 'http', 'error-capture.js');
const { createErrorLog, createMemoryErrorSink, routeTemplate } = out('server', 'http', 'error-log.js');
const { beaconPayload } = out('lib', 'zoho', 'error-beacon.js');

const PHONE = '9876543210';
const EMAIL = 'sanjay.menon@example.com';
const PAN = 'ABCDE1234F';
const session = (who) => 'gz_session=' + Buffer.from(JSON.stringify({ who, seat: 'ir' })).toString('base64url');

function rig() {
  const sink = createMemorySink();
  let n = 0;
  const seen = [];
  const wrap = createErrorCapture({ log: createErrorLog(sink), onRecord: (r) => seen.push(r), clock: () => 1_000 + n, newId: () => `generated-id-${++n}` });
  return { sink, seen, wrap };
}
const createMemorySink = () => createMemoryErrorSink();
const req = (headers = {}, method = 'POST', url = 'http://x/api/leads?phone=' + PHONE) =>
  new Request(url, { method, headers, body: method === 'GET' ? undefined : JSON.stringify({ phone: PHONE, email: EMAIL, pan: PAN }) });
const ALLOWED_ROUTE_KEYS = ['at', 'durationMs', 'errorClass', 'errorName', 'kind', 'method', 'requestId', 'route', 'status', 'userId', 'zohoCode', 'zohoStatus'];

function assertNoIdentity(record) {
  const s = JSON.stringify(record);
  for (const v of [PHONE, EMAIL, PAN, 'Sanjay', 'boom']) assert.ok(!s.includes(v), `record leaked ${v}: ${s}`);
}

test('a thrown error becomes a 500 and one Plane B line with ids only — no body, message or identity', async () => {
  const { sink, seen, wrap } = rig();
  const handler = wrap(async (request) => {
    await request.text();
    const e = new TypeError(`boom for ${EMAIL} ${PHONE} ${PAN}`);
    Object.assign(e, { body: { phone: PHONE } });
    throw e;
  }, '/api/leads/[id]');
  const res = await handler(req({ cookie: session('rohit'), [REQUEST_ID_HEADER]: 'abc12345-req' }), {});
  assert.equal(res.status, 500);
  assert.equal(res.headers.get(REQUEST_ID_HEADER), 'abc12345-req');
  const body = await res.json();
  assert.equal(body.requestId, 'abc12345-req');
  assert.ok(!JSON.stringify(body).includes('boom'));
  const [r] = sink.records();
  assert.equal(sink.records().length, 1);
  assert.equal(seen.length, 1);
  assert.deepEqual(Object.keys(r).sort(), ALLOWED_ROUTE_KEYS);
  assert.equal(r.kind, 'route-error');
  assert.equal(r.requestId, 'abc12345-req');
  assert.equal(r.userId, 'rohit');
  assert.equal(r.route, '/api/leads/[id]');
  assert.equal(r.method, 'POST');
  assert.equal(r.status, 500);
  assert.equal(r.errorClass, 'exception');
  assert.equal(r.errorName, 'TypeError');
  assert.equal(r.zohoStatus, null);
  assertNoIdentity(r);
});

test('request id: a safe caller id is propagated; a phone, email or junk id is replaced; the handler sees the same id', async () => {
  for (const [incoming, expectKept] of [['req-0001-abcd', true], [PHONE, false], [EMAIL, false], ['x', false], [null, false]]) {
    const { wrap } = rig();
    let inside = null;
    const h = wrap(async () => { inside = currentRequestId(); return Response.json({ ok: true }); }, '/api/data');
    const res = await h(req(incoming ? { [REQUEST_ID_HEADER]: incoming } : {}, 'GET', 'http://x/api/data'), {});
    const id = res.headers.get(REQUEST_ID_HEADER);
    assert.equal(inside, id);
    if (expectKept) assert.equal(id, incoming);
    else assert.match(id, /^generated-id-\d+$/);
  }
});

test('a 2xx answer with no Zoho failure files nothing', async () => {
  const { sink, wrap } = rig();
  const res = await wrap(async () => Response.json({ ok: 1 }), '/api/data')(req({}, 'GET', 'http://x/api/data'), {});
  assert.equal(res.status, 200);
  assert.equal(sink.records().length, 0);
});

test('ZohoRouteError carries Zoho status and code into the line and maps to the console status', async () => {
  const { sink, wrap } = rig();
  const failure = { kind: 'conflict', status: 412, code: 'ALREADY_MODIFIED', recordId: '4876876000001234567' };
  const res = await wrap(async () => { throw new ZohoRouteError(failure); }, '/api/leads/[id]')(req({ cookie: session('priya') }), {});
  assert.equal(res.status, 409);
  const [r] = sink.records();
  assert.equal(r.zohoStatus, 412);
  assert.equal(r.zohoCode, 'ALREADY_MODIFIED');
  assert.equal(r.errorClass, 'conflict');
  assert.equal(r.status, 409);
  assert.equal(r.errorName, 'ZohoRouteError');

  const rate = await wrap(async () => { throw new ZohoRouteError({ kind: 'credits-exhausted', status: 429, code: 'LIMIT_EXCEEDED', retryAfterMs: null }); }, '/api/x')(req(), {});
  assert.equal(rate.status, 503);
  assert.equal(sink.records()[1].zohoStatus, 429);
});

test('noteZohoFailure attaches Zoho status/code to a handled 5xx and to a handled 4xx', async () => {
  const { sink, wrap } = rig();
  const h = wrap(async () => {
    noteZohoFailure({ kind: 'server', status: 500, code: 'INTERNAL_ERROR' });
    return Response.json({ error: 'try again' }, { status: 503 });
  }, '/api/webhooks/zoho-sign');
  assert.equal((await h(req(), {})).status, 503);
  const r = sink.records()[0];
  assert.deepEqual([r.status, r.zohoStatus, r.zohoCode, r.errorClass], [503, 500, 'INTERNAL_ERROR', 'server']);

  const h2 = wrap(async () => { noteZohoFailure({ kind: 'invalid-data', status: 400, code: 'INVALID_DATA', field: 'Mobile', records: null }); return new Response(null, { status: 422 }); }, '/api/x');
  await h2(req(), {});
  assert.equal(sink.records()[1].zohoCode, 'INVALID_DATA');
  assert.ok(!('field' in sink.records()[1]));
});

test('a 5xx answer without a throw is filed; a malformed Zoho code is dropped', async () => {
  const { sink, wrap } = rig();
  await wrap(async () => { noteZohoFailure({ kind: 'server', status: 502, code: `bad ${EMAIL}` }); return new Response('x', { status: 502 }); }, '/api/data')(req(), {});
  assert.equal(sink.records()[0].zohoCode, null);
  assertNoIdentity(sink.records()[0]);
});

test('user id: only a safe person key — an email, a phone or a malformed cookie is filed as null', async () => {
  for (const [cookie, expected] of [[session('rohit'), 'rohit'], [session(EMAIL), null], [session(PHONE), null], ['gz_session=%%%', null], ['', null]]) {
    const { sink, wrap } = rig();
    await wrap(async () => { throw new Error('x'); }, '/api/x')(req(cookie ? { cookie } : {}), {});
    assert.equal(sink.records()[0].userId, expected, cookie);
  }
});

test('the writer rebuilds from the allow-list: extra fields, bad routes and bad statuses do not survive', () => {
  const sink = createMemoryErrorSink();
  const log = createErrorLog(sink);
  const r = log.routeError({ at: 1, requestId: 'abcdefgh1', userId: 'rohit', route: `/api/leads/${PHONE}?q=${EMAIL}`, method: 'POST', status: 9999, zohoStatus: 'x', zohoCode: 'INVALID_DATA', errorClass: 'server', errorName: 'Error', durationMs: 3, body: { PHONE }, message: EMAIL, stack: 'at x' });
  assert.deepEqual(Object.keys(r).sort(), ALLOWED_ROUTE_KEYS);
  assert.equal(r.route, '/api/leads/{id}');
  assert.equal(r.status, 500);
  assert.equal(r.zohoStatus, null);
  assertNoIdentity(r);
  assert.equal(routeTemplate('/leads/4876876000001234567/notes#x'), '/leads/{id}/notes');
  assert.equal(routeTemplate(`/people/${EMAIL}`), '/people/{id}');
  assert.equal(routeTemplate('https://evil/x'), '/unrecognised');
});

test('a sink that throws never fails the request', async () => {
  const wrap = createErrorCapture({ log: createErrorLog({ write() { throw new Error('disk'); } }), onRecord() { throw new Error('alert'); } });
  const res = await wrap(async () => { throw new Error('x'); }, '/api/x')(req(), {});
  assert.equal(res.status, 500);
});

test('beacon payload builder copies only the allowed fields', () => {
  const p = JSON.parse(beaconPayload({ source: 'onerror', route: `/leads/1?phone=${PHONE}`, errorName: 'TypeError', message: EMAIL, stack: PHONE }));
  assert.deepEqual(p, { source: 'onerror', route: '/leads/1', errorName: 'TypeError' });
});

test('POST /api/errors: a beacon is filed as a client-error line with ids only; 3 failed saves in 10 min alert', async () => {
  const { POST } = out('app', 'api', 'errors', 'route.js');
  const rt = out('server', 'ops', 'runtime.js');
  rt.errorLines.clear(); rt.alertOutbox.clear();
  const beacon = (payload, cookie = session('rohit')) => POST(new Request('http://x/api/errors', { method: 'POST', headers: { cookie, [REQUEST_ID_HEADER]: 'beacon-req-1' }, body: JSON.stringify(payload) }), {});

  const r1 = await beacon({ source: 'onerror', route: `/leads/4876876000001234567?phone=${PHONE}`, errorName: 'TypeError', message: `boom ${EMAIL}`, stack: PHONE });
  assert.equal(r1.status, 204);
  assert.equal(r1.headers.get(REQUEST_ID_HEADER), 'beacon-req-1');
  const line = rt.errorLines.records()[0];
  assert.equal(line.kind, 'client-error');
  assert.equal(line.route, '/leads/{id}');
  assert.equal(line.userId, 'rohit');
  assert.equal(line.requestId, 'beacon-req-1');
  assertNoIdentity(line);

  assert.equal((await beacon({ source: 'bogus' })).status, 400);
  assert.equal((await POST(new Request('http://x/api/errors', { method: 'POST', body: 'x'.repeat(5000) }), {})).status, 413);

  for (let i = 0; i < 2; i++) await beacon({ source: 'save-failed', route: '/leads/1', requestId: `save-req-${i}0000`, zohoStatus: 400, zohoCode: 'INVALID_DATA' });
  await rt.alertEngine().settled();
  assert.equal(rt.alertOutbox.sent().length, 0);
  await beacon({ source: 'save-failed', route: '/leads/1', requestId: 'save-req-20000', zohoStatus: 412, zohoCode: 'ALREADY_MODIFIED' });
  await rt.alertEngine().settled();
  const mail = rt.alertOutbox.sent();
  assert.equal(mail.length, 1);
  assert.match(mail[0].subject, /saves are failing/);
  assert.match(mail[0].text, /save-req-20000/);
  assert.ok(!mail[0].text.includes(PHONE) && !mail[0].text.includes('rohit'));
  const saved = rt.errorLines.records().filter((r) => r.source === 'save-failed');
  assert.deepEqual([saved[2].zohoStatus, saved[2].zohoCode, saved[2].failedRequestId], [412, 'ALREADY_MODIFIED', 'save-req-20000']);
});

/* ---- M18-S09-NOTE-3: the request deadline ---------------------------------------------------------------- */
const { currentDeadline, remainingMs } = out('lib', 'zoho', 'deadline.js');
const { DEADLINE_STATUS, DEADLINE_CODE } = out('server', 'http', 'error-capture.js');

test('deadline: a handler past REQUEST_DEADLINE_MS is answered 503 "deadline" (retry same-key) and filed without identity', async () => {
  const sink = createMemoryErrorSink();
  const wrap = createErrorCapture({ log: createErrorLog(sink), newId: () => 'deadline-req-0001', deadlineMs: () => 60 });
  let seenSignal = null, sameAsAls = false, reason = null, left = null;
  const handler = wrap(async (request) => {
    seenSignal = request.signal;
    sameAsAls = currentDeadline() !== null && currentDeadline().signal === request.signal;
    left = remainingMs();
    await new Promise((resolve) => request.signal.addEventListener('abort', resolve, { once: true }));
    reason = request.signal.reason;
    return Response.json({ late: true });
  }, '/api/statements');
  const t0 = Date.now();
  const res = await handler(req({ cookie: session('meena') }), {});
  assert.ok(Date.now() - t0 < 1_000);
  assert.equal(res.status, DEADLINE_STATUS);
  assert.equal(DEADLINE_STATUS, 503);
  const body = await res.json();
  assert.equal(body.code, DEADLINE_CODE);
  assert.equal(body.retry, 'same-key');
  assert.equal(body.requestId, 'deadline-req-0001');
  assert.equal(res.headers.get(REQUEST_ID_HEADER), 'deadline-req-0001');
  assert.ok(seenSignal.aborted, 'the handler saw the combined signal abort');
  assert.equal(reason && reason.name, 'DeadlineExceeded');
  assert.ok(sameAsAls, 'request.signal is the deadline carried in AsyncLocalStorage');
  assert.ok(left > 0 && left <= 60);
  const [line] = sink.records();
  assert.equal(line.status, 503);
  assert.equal(line.errorClass, 'deadline');
  assert.equal(line.errorName, 'DeadlineExceeded');
  assert.equal(line.userId, null, 'a deadline line carries no user id');
  assert.equal(line.route, '/api/statements');
  assertNoIdentity(line);
});

test('deadline: the caller hanging up aborts the same combined signal; a quick handler is untouched', async () => {
  const sink = createMemoryErrorSink();
  const wrap = createErrorCapture({ log: createErrorLog(sink), newId: () => 'deadline-req-0002', deadlineMs: () => 5_000 });
  const ac = new AbortController();
  let aborted = null;
  const h = wrap(async (request) => {
    setTimeout(() => ac.abort(), 10);
    await new Promise((resolve) => request.signal.addEventListener('abort', resolve, { once: true }));
    aborted = request.signal.aborted;
    return new Response(null, { status: 204 });
  }, '/api/leads');
  const res = await h(new Request('http://x/api/leads', { method: 'GET', signal: ac.signal }), {});
  assert.equal(res.status, 204);
  assert.equal(aborted, true);
  const fast = wrap(async () => Response.json({ ok: true }), '/api/leads');
  const r2 = await fast(req({}, 'GET'), {});
  assert.equal(r2.status, 200);
  assert.equal(sink.records().length, 0);
  assert.equal(currentDeadline(), null, 'no deadline leaks outside the request');
});

test('deadline: REQUEST_DEADLINE_MS and ZOHO_ATTEMPT_TIMEOUT_MS read with sane bounds', () => {
  const { requestDeadlineMs, zohoAttemptTimeoutMs } = out('lib', 'zoho', 'deadline.js');
  assert.equal(requestDeadlineMs({}), 25_000);
  assert.equal(requestDeadlineMs({ REQUEST_DEADLINE_MS: '12000' }), 12_000);
  assert.equal(requestDeadlineMs({ REQUEST_DEADLINE_MS: '45000' }), 25_000, 'never past AppSail 30 s');
  assert.equal(requestDeadlineMs({ REQUEST_DEADLINE_MS: 'soon' }), 25_000);
  assert.equal(zohoAttemptTimeoutMs({}), 10_000);
  assert.equal(zohoAttemptTimeoutMs({ ZOHO_ATTEMPT_TIMEOUT_MS: '2500' }), 2_500);
});

test('runBounded: never more than the limit at once, stops starting work when told, returns the rest in order', async () => {
  const { runBounded } = out('lib', 'zoho', 'deadline.js');
  let live = 0, peak = 0;
  const r = await runBounded([...Array(20).keys()], 4, async (x) => { live++; peak = Math.max(peak, live); await new Promise((s) => setTimeout(s, 2)); live--; return x * 2; });
  assert.equal(peak, 4);
  assert.deepEqual(r.done.map((d) => d.value), [...Array(20).keys()].map((x) => x * 2));
  assert.deepEqual(r.notStarted, []);
  let started = 0;
  const r2 = await runBounded([...Array(10).keys()], 3, async (x) => { started++; return x; }, () => started >= 5);
  assert.equal(r2.done.length, 5);
  assert.deepEqual(r2.notStarted, [5, 6, 7, 8, 9]);
});
