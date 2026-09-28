/* M13-S01 CONTRACT PUSH, INBOUND AND STUB (T01–T04)
 *
 * Run from console/: node --test src/server/contracts/push.test.cjs
 *
 * Every event against its JSON schema in contracts/, bad signature, replay, receiver down, identity guard,
 * the dead-letter shelf, the inbound endpoint's Plane B refusal and the stub/app switch. No network.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const consoleRoot = path.resolve(__dirname, '..', '..', '..');
const srcRoot = path.join(consoleRoot, 'src');
const contractsRoot = path.resolve(consoleRoot, '..', 'contracts');
const fixtures = path.join(srcRoot, 'lib', 'zoho', '__fixtures__', 'contracts');
const ts = require(path.join(consoleRoot, 'node_modules', 'typescript'));
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contracts-push-'));
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'contracts-push-data-'));
process.on('exit', () => { fs.rmSync(outDir, { recursive: true, force: true }); fs.rmSync(scratch, { recursive: true, force: true }); });
const config = ts.readConfigFile(path.join(consoleRoot, 'tsconfig.json'), ts.sys.readFile);
const project = ts.parseJsonConfigFileContent(config.config, ts.sys, consoleRoot);
const options = { ...project.options, incremental: false, tsBuildInfoFile: undefined, plugins: undefined, module: ts.ModuleKind.CommonJS,
  moduleResolution: ts.ModuleResolutionKind.Node10, noEmit: false, noEmitOnError: true, outDir, rootDir: srcRoot };
const program = ts.createProgram(['server/contracts/outbox.ts', 'server/contracts/inbound.ts', 'server/contracts/stub.ts', 'server/logs/jsonl.ts', 'lib/zoho/log.ts'].map((f) => path.join(srcRoot, f)), options);
const diags = ts.getPreEmitDiagnostics(program);
if (diags.length) { console.error(ts.formatDiagnostics(diags, { getCanonicalFileName: (f) => f, getCurrentDirectory: () => consoleRoot, getNewLine: () => '\n' })); process.exit(1); }
program.emit();
const load = (f) => require(path.join(outDir, f));
const { validateEvent, sign } = load('server/contracts/events.js');
const { createOutbox, caseReplied, farmProgress, identityPaths, DELIVERY_LABEL } = load('server/contracts/outbox.js');
const { createInboundEndpoint, createSeenEvents } = load('server/contracts/inbound.js');
const { createInProcessStub, investorAppMode, contractKeys, loadSchemas } = load('server/contracts/stub.js');
const { createJsonlStore } = load('server/logs/jsonl.js');
const { createOpsLog, createMemorySink } = load('lib/zoho/log.js');

const schemas = loadSchemas(contractsRoot);
const KEY = 'synthetic-contract-key-never-live-000000000001';
const OLD = 'synthetic-contract-key-never-live-000000000000';
const NOW = Date.parse('2026-09-27T15:30:00Z');
const CONTACT = '9007199254740994101', CASE = '9007199254740999001', KAM = '9007199254740995020';
const reply = (message = 'Your statement is attached in the app.') => caseReplied({ caseId: CASE, contactId: CONTACT, message, byUserId: KAM, at: NOW }, () => NOW);

function rig(o = {}) {
  let now = NOW, down = !!o.down;
  const stub = createInProcessStub({ schemas, keys: [KEY], clock: () => now, down: () => down });
  const failures = [], ledger = [];
  const outbox = createOutbox({ schemas, target: () => ({ url: 'stub://investor-app/events', key: KEY }), fetch: o.fetch ?? stub.fetch,
    clock: () => now, maxAttempts: o.maxAttempts ?? 4, baseDelayMs: 1000, ledger: { append: (l) => ledger.push(l) }, onFailure: (c) => failures.push(c) });
  return { stub, outbox, failures, ledger, tick: (ms) => { now += ms; }, setDown: (v) => { down = v; } };
}

test('T04: every outbound event is built to its schema, with the envelope and a sent_at the receiver accepts', async () => {
  const r = rig();
  for (const e of [reply(), farmProgress({ contactId: CONTACT, project: 'Synthetic Farm 1', phase: 'Sowing', note: 'Trays planted', at: NOW }, () => NOW)]) {
    assert.deepEqual(validateEvent(schemas, e), { ok: true, type: e.type });
    assert.equal(r.outbox.enqueue(e).ok, true);
  }
  assert.equal(await r.outbox.drain(), 2);
  const got = r.stub.recorded();
  assert.equal(got.length, 2);
  for (const e of got) {
    assert.match(e.sent_at, /\+05:30$/);
    for (const k of ['event_id', 'schema_version', 'occurred_at', 'actor', 'ids', 'payload']) assert.ok(k in e, k);
    assert.equal(validateEvent(schemas, e).ok, true);
  }
  assert.equal(validateEvent(schemas, { ...reply(), sent_at: 'yesterday' }).ok, false);
});

test('AC6: an event carrying a PAN, Aadhaar, account number or IFSC is refused before it is queued', () => {
  const r = rig();
  for (const bad of ['PAN ABCPE1234F on file', 'Aadhaar 1234 5678 9012', 'Account 123456789012', 'IFSC HDFC0001234', 'UTR ICIC2508430123']) {
    const x = r.outbox.enqueue(reply(bad));
    assert.equal(x.ok, false, bad);
    assert.equal(x.reason, 'identity-in-event');
    assert.deepEqual(x.errors, ['$.payload.message']);
  }
  assert.deepEqual(identityPaths(reply()), []);
  assert.equal(r.outbox.stats().open, 0);
});

test('AC3: receiver down → retried with backoff and shown "Not delivered yet", never delivered; back up → delivered', async () => {
  const r = rig({ down: true });
  const e = reply();
  r.outbox.enqueue(e);
  await r.outbox.drain();
  let s = r.outbox.state(e.event_id);
  assert.equal(s.status, 'retrying'); assert.equal(s.label, 'Not delivered yet'); assert.equal(s.attempts, 1); assert.equal(s.lastReason, 'unreachable');
  assert.equal(s.nextAt, NOW + 1000);
  assert.equal(await r.outbox.drain(), 0, 'not due yet');
  r.tick(1000); await r.outbox.drain();
  s = r.outbox.state(e.event_id);
  assert.equal(s.attempts, 2); assert.equal(s.nextAt, NOW + 1000 + 2000, 'backoff doubles');
  assert.equal(r.stub.recorded().length, 0);
  r.setDown(false); r.tick(2000); await r.outbox.drain();
  s = r.outbox.state(e.event_id);
  assert.equal(s.status, 'delivered'); assert.equal(s.label, DELIVERY_LABEL.delivered); assert.equal(s.attempts, 3);
  assert.deepEqual(r.outbox.forRecord(CASE).map((x) => x.status), ['delivered']);
  assert.equal(r.stub.recorded().length, 1);
  assert.equal(r.outbox.stats().lastDeliveredAt, NOW + 3000);
  assert.equal(r.outbox.stats().failures24h, 2);
  assert.ok(r.ledger.every((l) => !('payload' in l) && !JSON.stringify(l).includes('statement')), 'the ledger holds ids and status only');
});

test('T01: the last attempt dead-letters once and alerts; a 4xx dead-letters at once; replay re-queues', async () => {
  const r = rig({ down: true, maxAttempts: 3 });
  const e = reply();
  r.outbox.enqueue(e);
  for (let i = 0; i < 5; i++) { await r.outbox.drain(); r.tick(60_000); }
  assert.equal(r.outbox.state(e.event_id).status, 'dead');
  assert.equal(r.outbox.state(e.event_id).attempts, 3);
  assert.deepEqual(r.failures, ['unreachable']);
  r.setDown(false);
  assert.equal(r.outbox.replay(e.event_id), true);
  await r.outbox.drain();
  assert.equal(r.outbox.state(e.event_id).status, 'delivered');

  const refused = rig({ fetch: async () => ({ status: 422, text: async () => '' }) });
  const e2 = reply();
  refused.outbox.enqueue(e2);
  await refused.outbox.drain();
  assert.equal(refused.outbox.state(e2.event_id).status, 'dead');
  assert.deepEqual(refused.failures, ['refused-422']);
});

test('AC5 (outbound): the same event queued twice is sent once; the receiver applies an event_id once', async () => {
  const r = rig();
  const e = reply();
  r.outbox.enqueue(e); r.outbox.enqueue({ ...e });
  await r.outbox.drain();
  assert.equal(r.stub.recorded().length, 1);
  const body = JSON.stringify(e);
  assert.deepEqual(await r.stub.receiver.receive(body, sign(body, KEY)), { status: 200, applied: false, ack: null });
});

test('T01: a 200 with no push.delivered stays "Not delivered yet" until the app acknowledges it inbound', async () => {
  const r = rig({ fetch: async () => ({ status: 200, text: async () => '{"accepted":true}' }) });
  const e = reply();
  r.outbox.enqueue(e);
  await r.outbox.drain();
  assert.equal(r.outbox.state(e.event_id).label, 'Not delivered yet');
  assert.equal(r.outbox.state(e.event_id).lastReason, 'no-ack');
  assert.equal(r.outbox.acknowledge(e.event_id, 'delivered'), true);
  assert.equal(r.outbox.state(e.event_id).status, 'delivered');
});

function inbound(o = {}) {
  const lines = createMemorySink();
  const log = createOpsLog(lines);
  const requests = [], delivered = [];
  let n = 0;
  const seen = new Set();
  const ep = createInboundEndpoint({ schemas, keys: [KEY, OLD], log, clock: () => NOW, newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
    seen: { has: async (id) => seen.has(id), add: async (id) => { seen.add(id); } },
    onRequest: async (e) => { if (o.failOnce && !requests.length && !o.failed) { o.failed = true; throw new Error('zoho down'); } requests.push(e.event_id); },
    onDelivered: (e) => { delivered.push(e.payload.message_id); } });
  return { ep, lines, requests, delivered };
}
const fx = (name) => fs.readFileSync(path.join(fixtures, name), 'utf8');

test('AC4: an inbound request.raised or push.delivered with a bad signature is refused and logged in Plane B, body never', async () => {
  const i = inbound();
  for (const name of ['request.raised.event.json', 'push.delivered.event.json']) {
    const body = fx(name);
    const r = await i.ep.handle(body, sign(body, 'another-key-that-is-long-enough-to-count-00'));
    assert.deepEqual(r, { status: 401, reason: 'signature' });
  }
  const recs = i.lines.records().filter((l) => l.kind === 'refusal');
  assert.equal(recs.length, 2);
  assert.ok(recs.every((l) => l.reason === 'inbound-signature' && l.action === 'investorAppWebhook'));
  assert.ok(!JSON.stringify(i.lines.records()).includes('APP-REQ-SYN-1'));
  assert.equal(i.requests.length, 0);
  const lead = JSON.stringify({ ...JSON.parse(fx('request.raised.event.json')), type: 'case.replied', payload: { case_id: CASE, message: 'x' } });
  assert.deepEqual(await i.ep.handle(lead, sign(lead, KEY)), { status: 400, reason: 'not-accepted' });
});

test('T02/AC5: inbound events verify under either live key, apply once per event_id, and a failed apply is redelivered', async () => {
  const i = inbound({ failOnce: true });
  const body = fx('request.raised.event.json');
  await assert.rejects(i.ep.handle(body, sign(body, KEY)));
  assert.equal((await i.ep.handle(body, sign(body, OLD))).applied, true, 'the redelivery applies');
  assert.equal((await i.ep.handle(body, sign(body, KEY))).applied, false, 'the replay does not');
  assert.deepEqual(i.requests, ['00000000-0000-4000-8000-00000000a001']);
  const ack = JSON.parse(fx('push.delivered.event.json')); ack.payload.message_id = 'evt-1';
  const ab = JSON.stringify(ack);
  assert.equal((await i.ep.handle(ab, sign(ab, KEY))).status, 200);
  assert.deepEqual(i.delivered, ['evt-1']);
});

test('T02: applied event ids survive a restart through the append-only file', async () => {
  const store = createJsonlStore({ dir: path.join(scratch, 'inbound'), plane: 'inbound', clock: () => NOW });
  const a = createSeenEvents(store);
  await a.add('00000000-0000-4000-8000-00000000b001');
  const b = createSeenEvents(createJsonlStore({ dir: path.join(scratch, 'inbound'), plane: 'inbound', clock: () => NOW }));
  assert.equal(await b.has('00000000-0000-4000-8000-00000000b001'), true);
  assert.equal(await b.has('00000000-0000-4000-8000-00000000b002'), false);
});

test('T03: the stub/app switch is configuration only', () => {
  assert.deepEqual(investorAppMode({}), { kind: 'stub' });
  assert.deepEqual(investorAppMode({ INVESTOR_APP_URL: 'stub', NODE_ENV: 'production' }), { kind: 'stub' });
  assert.deepEqual(investorAppMode({ NODE_ENV: 'production' }), { kind: 'off' });
  assert.deepEqual(investorAppMode({ INVESTOR_APP_URL: 'https://app.example.invalid/events' }), { kind: 'app', url: 'https://app.example.invalid/events' });
  assert.throws(() => investorAppMode({ INVESTOR_APP_URL: 'http://app.example.invalid/events' }));
  const stubKeys = contractKeys({}, { kind: 'stub' });
  assert.ok(stubKeys.current && stubKeys.current.length >= 32);
  assert.equal(contractKeys({}, { kind: 'app', url: 'https://x.invalid' }).current, null, 'the real app never gets an invented key');
  assert.deepEqual(contractKeys({ CONTRACT_SIGNING_KEY: KEY, CONTRACT_SIGNING_KEY_PREVIOUS: OLD }, { kind: 'off' }), { current: KEY, all: [KEY, OLD] });
});
