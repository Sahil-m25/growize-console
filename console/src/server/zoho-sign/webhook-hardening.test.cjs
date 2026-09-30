/* M12-S05-H5 WEBHOOK HARDENING: HMAC, replay, dead-letter and the 5-second budget, at the route boundary.
 *
 * Run from console/: node --test src/server/zoho-sign/webhook-hardening.test.cjs
 *
 * Compiles the two inbound webhook routes (Zoho Sign, investor app) and drives them with real Request objects.
 * The access guard, the ops wrapper and the server runtimes are replaced by fakes (their own tests cover them);
 * the route code, the handlers behind it and the HMAC checks are the production files. No network.
 *
 * Two tests are named EXPECTED-TO-CHANGE: they document today's inline processing (BLOCKED.md M20-S08-NOTE-3)
 * and must be rewritten when the durable worker replaces it.
 */
'use strict';

const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { mock, test } = require('node:test');

const consoleRoot = path.resolve(__dirname, '..', '..', '..');
const srcRoot = path.join(consoleRoot, 'src');
const fx = path.join(srcRoot, 'lib', 'zoho', '__fixtures__', 'sign');
const contractsFx = path.join(srcRoot, 'lib', 'zoho', '__fixtures__', 'contracts');
const ts = require(path.join(consoleRoot, 'node_modules', 'typescript'));
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webhook-hardening-'));
process.on('exit', () => fs.rmSync(outDir, { recursive: true, force: true }));
const config = ts.readConfigFile(path.join(consoleRoot, 'tsconfig.json'), ts.sys.readFile);
const project = ts.parseJsonConfigFileContent(config.config, ts.sys, consoleRoot);
const options = { ...project.options, incremental: false, tsBuildInfoFile: undefined, plugins: undefined,
  module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10, noEmit: false, noEmitOnError: true, outDir, rootDir: srcRoot };
const roots = ['app/api/webhooks/zoho-sign/route.ts', 'app/api/webhooks/investor-app/route.ts', 'server/contracts/stub.ts', 'lib/zoho/log.ts'].map((f) => path.join(srcRoot, f));
const program = ts.createProgram(roots, options);
const diagnostics = [...ts.getPreEmitDiagnostics(program), ...program.emit().diagnostics];
if (diagnostics.length) {
  console.error(ts.formatDiagnostics(diagnostics, { getCanonicalFileName: (f) => f, getCurrentDirectory: () => consoleRoot, getNewLine: () => '\n' }));
  process.exit(1);
}

/* Fakes for the edges: the guard and ops wrapper pass through; the runtimes hand back whatever the test set. */
const Module = require('node:module');
process.env.NODE_PATH = path.join(consoleRoot, 'node_modules');
Module._initPaths();
const held = { signDeps: null, inbound: null, dead: [], boundary: [] };
const fakes = new Map([
  ['server/access/guard.js', { guardApi: (_path, handler) => handler }],
  ['server/ops/runtime.js', { withErrorCapture: (handler) => handler }],
  ['server/zoho-sign/runtime.js', {
    ensureSignCheck() {},
    zohoSignWebhookDeps: () => { if (!held.signDeps) throw new Error('not configured'); return held.signDeps; },
    deadLetterBoundary: (reason) => held.dead.push({ reason, requestId: null, boundary: true }),
    logProviderCallbackBoundary: (reason) => held.boundary.push(reason),
  }],
  ['server/contracts/runtime.js', { investorAppInbound: () => { if (!held.inbound) throw new Error('not configured'); return held.inbound; } }],
]);
const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  return resolveFilename.call(this, request.startsWith('@/') ? path.join(outDir, request.slice(2)) : request, ...rest);
};
const realLoad = Module._load;
Module._load = function (request, parent, ...rest) {
  if (request.startsWith('.') || request.startsWith('@/')) {
    const file = path.relative(outDir, Module._resolveFilename(request, parent)).split(path.sep).join('/');
    for (const [suffix, fake] of fakes) if (file === suffix || file === suffix.replace(/\.js$/, '/index.js')) return fake;
  }
  return realLoad.call(this, request, parent, ...rest);
};
const load = (f) => require(path.join(outDir, f));
const zohoRoute = load('app/api/webhooks/zoho-sign/route.js');
const appRoute = load('app/api/webhooks/investor-app/route.js');
const { createMemorySink, createOpsLog } = load('lib/zoho/log.js');
const { serviceCredential } = load('lib/zoho/client.js');
const { loadSchemas } = load('server/contracts/stub.js');
const { createInboundEndpoint } = load('server/contracts/inbound.js');
const { sign: hmacHex } = load('server/contracts/events.js');

/* ================================ Zoho Sign ================================ */
const SECRET = 'synthetic-webhook-secret-2026';
const REQ = '90071992547409981', ALLOT = '9007199254740999401';
const HEADER = 'x-zs-webhook-signature';
const b64 = (body, secret = SECRET) => createHmac('sha256', secret).update(body, 'utf8').digest('base64');
const bodyOf = (name) => fs.readFileSync(path.join(fx, name), 'utf8');
const svc = serviceCredential('provider-callback', { access_token: 'synthetic-service-token', api_domain: 'https://www.zohoapis.in', expires_in: 3_600 }, Date.now());
const post = (url, body, headers = {}) => new Request(`http://console.test${url}`, { method: 'POST', body, headers });
const zoho = (body, signature, extra = {}) => post('/api/webhooks/zoho-sign', body, { ...(signature === null ? {} : { [HEADER]: signature }), ...extra });

/* One rig per test: counts every read and write, keeps the seen set and the dead-letter list. */
function rig(o = {}) {
  const sink = createMemorySink();
  const c = { credential: 0, sign: 0, search: 0, update: 0, file: 0, signals: [] };
  const seenKeys = new Set();
  const seenAdds = [];
  held.dead = []; held.boundary = [];
  held.signDeps = {
    secrets: [SECRET], log: createOpsLog(sink),
    credential: async () => { c.credential++; return svc; }, invalidateCredential() {},
    sign: { async getRequest(_c, _id, opts) {
      c.sign++; c.signals.push(opts && opts.signal);
      if (o.signImpl) return o.signImpl(opts);
      if (o.signFails) return { ok: false, error: { kind: 'server' }, creditsRemaining: null };
      return { ok: true, value: { requestId: REQ, status: o.status ?? 'declined', actionTime: null, modifiedTime: null, documentIds: [] }, status: 200, creditsRemaining: null };
    } },
    crm: {
      async search(_c, module, q) {
        c.search++;
        if (o.searchDelayMs) await new Promise((r) => setTimeout(r, o.searchDelayMs));
        const hit = o.linked !== false && module === 'LLP_UnitAllocation_Module' && q.criteria.includes('Supplementary_Sign_Req_Id');
        return { ok: true, value: { records: hit ? [{ id: ALLOT, Supplementary_Sign_Req_Id: REQ }] : [], moreRecords: false }, status: 200, creditsRemaining: null };
      },
      async update() { c.update++; throw new Error('the webhook must not write status'); },
    },
    seen: { has: async (k) => seenKeys.has(k), add: async (k) => { seenAdds.push(k); seenKeys.add(k); } },
    deadLetter: (e) => held.dead.push(e),
    file: async () => { c.file++; return { ok: true, outcome: 'filed' }; },
  };
  return { c, sink, seenKeys, seenAdds };
}
const untouched = (r) => { assert.deepEqual([r.c.credential, r.c.sign, r.c.search, r.c.update, r.c.file], [0, 0, 0, 0, 0], 'no credential, provider read, CRM call or write'); assert.equal(r.seenKeys.size, 0, 'nothing stored as seen'); };
const json = async (res) => res.json();

test('Zoho Sign bad HMAC: 401, nothing read, written or stored, one dead letter with no request id', async (t) => {
  const body = bodyOf('webhook.declined.json');
  const cases = [
    ['wrong secret', b64(body, 'another-synthetic-secret-2026')],
    ['body altered after signing', b64(body.replace('declined', 'completed'))],
    ['not base64 of a 32-byte MAC', 'AAAA'],
    ['scheme prefix', `sha256=${b64(body)}`],
  ];
  for (const [name, signature] of cases) {
    await t.test(name, async () => {
      const r = rig();
      const res = await zohoRoute.POST(zoho(name === 'body altered after signing' ? body.replace('declined', 'completed') : body, name === 'body altered after signing' ? b64(body) : signature));
      assert.equal(res.status, 401);
      assert.deepEqual(await json(res), { accepted: false, reason: 'invalid-signature' });
      untouched(r);
      assert.deepEqual(held.dead.map((d) => [d.reason, d.requestId, d.retryable]), [['invalid-signature', null, false]]);
      assert.ok(!JSON.stringify(held.dead).includes(REQ), 'an unverified body never names its request id');
      assert.match(JSON.stringify(r.sink.records()), /invalid-signature/, 'refusal is in Plane B');
    });
  }
});

test('Zoho Sign missing signature header: 401 and nothing stored or processed', async () => {
  const r = rig();
  const res = await zohoRoute.POST(zoho(bodyOf('webhook.declined.json'), null));
  assert.equal(res.status, 401);
  untouched(r);
  assert.equal(held.dead.length, 1);
  assert.equal(held.dead[0].reason, 'invalid-signature');
});

test('Zoho Sign oversize body: 413 by Content-Length and by stream, dead-lettered, never read or verified', async () => {
  const r = rig();
  const big = 'x'.repeat(256 * 1024 + 1);
  const declared = await zohoRoute.POST(zoho('{}', b64('{}'), { 'content-length': String(big.length) }));
  assert.equal(declared.status, 413);
  const streamed = await zohoRoute.POST(zoho(big, b64(big)));
  assert.equal(streamed.status, 413);
  untouched(r);
  assert.deepEqual(held.dead.map((d) => d.reason), ['payload-too-large', 'payload-too-large']);
});

test('Zoho Sign valid HMAC but an unusable body: 400 and a dead letter, no provider read', async () => {
  const r = rig();
  for (const body of ['not json', '{"requests":{"request_id":90071992547409981}}', '{"requests":{}}']) {
    const res = await zohoRoute.POST(zoho(body, b64(body)));
    assert.equal(res.status, 400, body);
  }
  untouched(r);
  assert.deepEqual(held.dead.map((d) => d.reason), ['invalid-payload', 'invalid-payload', 'invalid-payload']);
});

test('Zoho Sign duplicate event: both deliveries answered 200, processed and marked seen exactly once', async () => {
  const r = rig();
  const body = bodyOf('webhook.declined.json');
  const first = await zohoRoute.POST(zoho(body, b64(body)));
  const second = await zohoRoute.POST(zoho(body, b64(body)));
  assert.equal(first.status, 200);
  assert.deepEqual(await json(first), { accepted: true, outcome: 'observed' });
  assert.equal(second.status, 200);
  assert.deepEqual(await json(second), { accepted: true, outcome: 'duplicate' });
  assert.equal(r.c.sign, 1, 'the source was re-read once');
  assert.equal(r.c.search, 4);
  assert.equal(r.seenAdds.length, 1);
  assert.equal(held.dead.length, 0);
});

test('Zoho Sign duplicate event delivered concurrently: processed once', async () => {
  const r = rig({ searchDelayMs: 20 });
  const body = bodyOf('webhook.declined.json');
  const [a, b] = await Promise.all([zohoRoute.POST(zoho(body, b64(body))), zohoRoute.POST(zoho(body, b64(body)))]);
  assert.deepEqual([a.status, b.status], [200, 200]);
  assert.equal(r.c.sign, 1, 'the second concurrent delivery must not repeat the re-read');
  assert.deepEqual([(await json(a)).outcome, (await json(b)).outcome].sort(), ['duplicate', 'observed']);
});

test('Zoho Sign completed event filed once; the duplicate does not file again', async () => {
  const r = rig({ status: 'completed' });
  const body = bodyOf('webhook.completed.json');
  assert.equal((await json(await zohoRoute.POST(zoho(body, b64(body))))).outcome, 'filed');
  assert.equal((await json(await zohoRoute.POST(zoho(body, b64(body))))).outcome, 'duplicate');
  assert.equal(r.c.file, 1);
});

test('Zoho Sign failed processing is not marked seen: 503, dead letter marked retryable, and the redelivery is processed', async () => {
  const r = rig({ signFails: true });
  const body = bodyOf('webhook.declined.json');
  const res = await zohoRoute.POST(zoho(body, b64(body)));
  assert.equal(res.status, 503);
  assert.deepEqual(await json(res), { accepted: false, reason: 'provider-failed' });
  assert.equal(r.seenKeys.size, 0);
  assert.deepEqual(held.dead.map((d) => [d.reason, d.requestId, d.retryable]), [['provider-failed', REQ, true]]);
  const healed = rig();
  const again = await zohoRoute.POST(zoho(body, b64(body)));
  assert.equal(again.status, 200);
  assert.equal(healed.c.sign, 1);
});

test('Zoho Sign unlinked event (request id bound to no record): 200, no write, and a dead-letter entry rather than silence', async () => {
  const r = rig({ linked: false });
  const body = bodyOf('webhook.declined.json');
  const res = await zohoRoute.POST(zoho(body, b64(body)));
  assert.equal(res.status, 200, 'Zoho gets its ack; a retry cannot create the binding');
  assert.deepEqual(await json(res), { accepted: true, outcome: 'unlinked' });
  assert.equal(r.c.update, 0);
  assert.equal(r.c.file, 0);
  assert.deepEqual(held.dead.map((d) => [d.reason, d.requestId, d.retryable]), [['unlinked', REQ, false]]);
  assert.match(JSON.stringify(r.sink.records()), /target-not-found/, 'and the Plane B line');
});

test('Zoho Sign stale timestamp: the protocol carries performed_at but HMAC covers the body only, so a validly signed old event is not refused (by design: the status is re-read, nothing is written from the body)', async () => {
  const r = rig();
  const stale = JSON.stringify({ ...JSON.parse(bodyOf('webhook.declined.json')), notifications: { operation_type: 'RequestRejected', performed_at: Date.parse('2020-01-01T00:00:00Z') } });
  const res = await zohoRoute.POST(zoho(stale, b64(stale)));
  assert.equal(res.status, 200);
  assert.deepEqual(await json(res), { accepted: true, outcome: 'observed' });
  assert.equal(r.c.sign, 1, 'the consequence comes from the live re-read');
  assert.equal(r.c.update, 0);
  const replay = await zohoRoute.POST(zoho(stale, b64(stale)));
  assert.equal((await json(replay)).outcome, 'duplicate', 'and an exact replay of it is still ignored');
  const noTime = JSON.stringify({ requests: { request_id: REQ, request_status: 'declined' } });
  await zohoRoute.POST(zoho(noTime, b64(noTime)));
  assert.equal((await json(await zohoRoute.POST(zoho(noTime, b64(noTime))))).outcome, 'duplicate', 'no operation or time: the dedupe key is the exact body');
});

test('Zoho Sign not configured (no secret store): 503, nothing processed', async () => {
  rig(); held.signDeps = null;
  const body = bodyOf('webhook.declined.json');
  const res = await zohoRoute.POST(zoho(body, b64(body)));
  assert.equal(res.status, 503);
  assert.deepEqual(await json(res), { accepted: false, reason: 'unavailable' });
  assert.deepEqual(held.boundary, ['callback-unavailable']);
});

test('EXPECTED-TO-CHANGE (M20-S08-NOTE-3) Zoho Sign acknowledges only after the inline re-fetch and CRM resolution; the 4 s route deadline is the only bound', async (t) => {
  // TODAY: the 200 is sent after credential + Sign re-read + four CRM searches. The target design (BLOCKED.md NOTE-3) is
  // verify -> dedupe -> enqueue -> 200 at once, with the re-read in a durable worker. When that lands, replace this test.
  const r = rig({ searchDelayMs: 150 });
  const body = bodyOf('webhook.declined.json');
  const started = Date.now();
  const res = await zohoRoute.POST(zoho(body, b64(body)));
  assert.equal(res.status, 200);
  assert.ok(Date.now() - started >= 140, 'the ack waited for the CRM lookup (inline heavy work)');
  assert.equal(r.c.sign, 1);
  assert.equal(r.c.search, 4);

  await t.test('a provider that never answers is cut off by the 4 s abort, so the reply still lands inside Zoho\'s 5 s window', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const slow = rig({ signImpl: (opts) => new Promise((resolve) => { opts.signal.addEventListener('abort', () => resolve({ ok: false, error: { kind: 'network' }, creditsRemaining: null })); }) });
      const pending = zohoRoute.POST(zoho(body, b64(body)));
      await new Promise((r2) => setImmediate(r2));
      assert.equal(slow.c.signals.length, 1);
      assert.equal(slow.c.signals[0].aborted, false);
      mock.timers.tick(3_999);
      assert.equal(slow.c.signals[0].aborted, false, 'not before 4 s');
      mock.timers.tick(1);
      assert.equal(slow.c.signals[0].aborted, true, 'aborted at 4 s, one second inside the 5 s budget');
      const res2 = await pending;
      assert.equal(res2.status, 503, 'a timeout is a redelivery, never a silent 200');
      assert.equal(slow.seenKeys.size, 0);
      assert.equal(held.dead.at(-1).reason, 'provider-failed');
    } finally { mock.timers.reset(); }
  });
});

/* ================================ Investor app inbound ================================ */
const KEY = 'synthetic-contract-key-never-live-000000000001';
const schemas = loadSchemas(path.resolve(consoleRoot, '..', 'contracts'));
const NOW = Date.parse('2026-09-27T15:30:00Z');
const fxApp = (n) => fs.readFileSync(path.join(contractsFx, n), 'utf8');
const SIG = 'x-signature';
const appPost = (body, signature, extra = {}) => post('/api/webhooks/investor-app', body, { ...(signature === null ? {} : { [SIG]: signature }), ...extra });

function appRig(o = {}) {
  const sink = createMemorySink();
  const requests = [], delivered = [], seen = new Set();
  let failNext = !!o.failOnce, n = 0;
  held.inbound = createInboundEndpoint({
    schemas, keys: [KEY], log: createOpsLog(sink), clock: () => NOW, newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
    seen: { has: async (id) => seen.has(id), add: async (id) => { seen.add(id); } },
    onRequest: async (e) => {
      if (o.delayMs) await new Promise((r) => setTimeout(r, o.delayMs));
      if (failNext) { failNext = false; throw new Error('zoho down'); }
      if (o.refuse) return { refused: 'contact-mismatch' };
      requests.push(e.event_id); return { caseId: '9007199254740999001' };
    },
    onDelivered: (e) => { delivered.push(e.payload.message_id); },
  });
  return { sink, requests, delivered, seen };
}
const refusals = (r) => r.sink.records().filter((l) => l.kind === 'refusal').map((l) => l.reason);

test('investor-app bad or missing HMAC: 401, nothing applied or stored, refusal in Plane B without the body', async () => {
  const r = appRig();
  for (const name of ['request.raised.event.json', 'push.delivered.event.json']) {
    const body = fxApp(name);
    for (const signature of [hmacHex(body, 'another-key-that-is-long-enough-to-count-00'), null, hmacHex(body + ' ', KEY), 'zz']) {
      const res = await appRoute.POST(appPost(body, signature));
      assert.equal(res.status, 401);
      assert.deepEqual(await json(res), { accepted: false, reason: 'signature' });
    }
  }
  assert.deepEqual([r.requests.length, r.delivered.length, r.seen.size], [0, 0, 0]);
  assert.equal(refusals(r).length, 8);
  assert.ok(refusals(r).every((x) => x === 'inbound-signature'));
  assert.ok(!JSON.stringify(r.sink.records()).includes('APP-REQ-SYN-1'));
});

test('investor-app valid HMAC on a malformed or invalid body: 400 and a Plane B refusal; an oversize body is 413', async () => {
  const r = appRig();
  const notJson = 'nope';
  assert.equal((await appRoute.POST(appPost(notJson, hmacHex(notJson, KEY)))).status, 400);
  const lead = JSON.stringify({ ...JSON.parse(fxApp('request.raised.event.json')), type: 'case.replied', payload: {} });
  const res = await appRoute.POST(appPost(lead, hmacHex(lead, KEY)));
  assert.equal(res.status, 400);
  assert.deepEqual(await json(res), { accepted: false, reason: 'invalid' });
  assert.equal((await appRoute.POST(appPost('x'.repeat(64 * 1024 + 1), 'a'))).status, 413);
  assert.equal(r.requests.length, 0);
  assert.deepEqual(refusals(r), ['inbound-json', 'inbound-invalid']);
});

test('investor-app duplicate event_id: acknowledged twice, applied once, the replay answers the same Case id', async () => {
  const r = appRig();
  const body = fxApp('request.raised.event.json');
  const first = await appRoute.POST(appPost(body, hmacHex(body, KEY)));
  const again = await appRoute.POST(appPost(body, hmacHex(body, KEY)));
  assert.equal(first.status, 200); assert.equal(again.status, 200);
  const [f, a] = [await json(first), await json(again)];
  assert.equal(f.applied, true);
  assert.equal(a.applied, false);
  assert.equal(r.requests.length, 1);
  assert.equal(f.caseId, '9007199254740999001');
});

test('investor-app duplicate event_id delivered concurrently: applied once', async () => {
  const r = appRig({ delayMs: 20 });
  const body = fxApp('request.raised.event.json');
  const [a, b] = await Promise.all([appRoute.POST(appPost(body, hmacHex(body, KEY))), appRoute.POST(appPost(body, hmacHex(body, KEY)))]);
  assert.deepEqual([a.status, b.status], [200, 200]);
  assert.equal(r.requests.length, 1, 'one Case, not two');
});

test('investor-app stale timestamp: occurred_at is not a replay window (dedupe by event_id is); an old signed event applies once', async () => {
  const r = appRig();
  const old = JSON.parse(fxApp('request.raised.event.json')); old.occurred_at = '2020-01-01T00:00:00+05:30';
  const body = JSON.stringify(old);
  const res = await appRoute.POST(appPost(body, hmacHex(body, KEY)));
  assert.equal(res.status, 200);
  assert.equal((await json(res)).applied, true);
  assert.equal((await json(await appRoute.POST(appPost(body, hmacHex(body, KEY))))).applied, false);
  assert.equal(r.requests.length, 1);
});

test('investor-app refused event (unlinked Contact): 422 with a code, Plane B line, not marked seen so a corrected resend is judged again', async () => {
  const r = appRig({ refuse: true });
  const body = fxApp('request.raised.event.json');
  const res = await appRoute.POST(appPost(body, hmacHex(body, KEY)));
  assert.equal(res.status, 422);
  assert.deepEqual(await json(res), { accepted: false, reason: 'contact-mismatch' });
  assert.deepEqual(refusals(r), ['inbound-contact-mismatch']);
  assert.equal(r.seen.size, 0);
  assert.equal(r.requests.length, 0);
});

test('investor-app apply failure: 503, not marked seen, and the redelivery applies', async () => {
  const r = appRig({ failOnce: true });
  const body = fxApp('request.raised.event.json');
  const res = await appRoute.POST(appPost(body, hmacHex(body, KEY)));
  assert.equal(res.status, 503);
  assert.deepEqual(await json(res), { accepted: false, reason: 'unavailable' });
  assert.equal(r.seen.size, 0);
  const redelivered = await appRoute.POST(appPost(body, hmacHex(body, KEY)));
  assert.equal((await json(redelivered)).applied, true);
  assert.equal(r.requests.length, 1);
});

test('investor-app not configured: 503', async () => {
  held.inbound = null;
  const body = fxApp('request.raised.event.json');
  const res = await appRoute.POST(appPost(body, hmacHex(body, KEY)));
  assert.equal(res.status, 503);
  assert.deepEqual(await json(res), { accepted: false, reason: 'not-configured' });
});
