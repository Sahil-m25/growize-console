/* M20-S07 CONTRACT EVENTS REGRESSION
 *
 * Run from console/: node src/server/contracts/events.test.cjs
 *
 * Validates synthetic events against the real schemas in contracts/, signs and verifies them, and
 * drives the stub receiver and the signed push with no network at all (request.raised → Case: requests.test.cjs).
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
const ts = require(path.join(consoleRoot, 'node_modules', 'typescript'));
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'contracts-'));
process.on('exit', () => fs.rmSync(outDir, { recursive: true, force: true }));
const config = ts.readConfigFile(path.join(consoleRoot, 'tsconfig.json'), ts.sys.readFile);
const project = ts.parseJsonConfigFileContent(config.config, ts.sys, consoleRoot);
const options = { ...project.options, incremental: false, tsBuildInfoFile: undefined, plugins: undefined, module: ts.ModuleKind.CommonJS,
  moduleResolution: ts.ModuleResolutionKind.Node10, noEmit: false, noEmitOnError: true, outDir, rootDir: srcRoot };
const program = ts.createProgram(['lib/zoho/errors.ts', 'lib/zoho/gate.ts', 'lib/zoho/log.ts', 'lib/zoho/client.ts', 'server/contracts/events.ts'].map((f) => path.join(srcRoot, f)), options);
const diags = ts.getPreEmitDiagnostics(program);
if (diags.length) { console.error(ts.formatDiagnostics(diags, { getCanonicalFileName: (f) => f, getCurrentDirectory: () => consoleRoot, getNewLine: () => '\n' })); process.exit(1); }
program.emit();
const { createStubReceiver, pushEvent, sign, validateEvent, verify } = require(path.join(outDir, 'server', 'contracts', 'events.js'));

const schemas = Object.fromEntries(fs.readdirSync(contractsRoot).filter((f) => f.endsWith('.json')).map((f) => [f, JSON.parse(fs.readFileSync(path.join(contractsRoot, f), 'utf8'))]));
const KEY = 'synthetic-contract-key-never-live-000000000001';
const OLD_KEY = 'synthetic-contract-key-never-live-000000000000';
let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const NOW = Date.parse('2026-09-27T15:30:00Z');
const event = (type, payload, extra = {}) => ({ event_id: uuid(), type, schema_version: 1, occurred_at: '2026-09-27T21:00:00+05:30',
  actor: { kind: 'user', zoho_user_id: '9007199254740995001' }, ids: { investor_contact_id: '9007199254740994101' }, payload, origin: 'console', ...extra });
const REPLY = () => event('case.replied', { case_id: '9007199254740999001', message: 'Synthetic reply', at: '2026-09-27T21:00:00+05:30' });

function stub() {
  const recorded = [];
  const seen = new Set();
  const r = createStubReceiver({ schemas, keys: [KEY, OLD_KEY], accepts: ['case.replied', 'farm.progress', 'push.delivered', 'request.raised'],
    seen: { async has(id) { return seen.has(id); }, async add(id) { seen.add(id); } }, record: async (e) => { recorded.push(e); }, newId: uuid, clock: () => NOW });
  return { r, recorded };
}

test('events are checked against contracts/: type, version, required, extra fields and formats', () => {
  assert.deepEqual(validateEvent(schemas, REPLY()), { ok: true, type: 'case.replied' });
  assert.equal(validateEvent(schemas, { ...REPLY(), schema_version: 2 }).reason, 'unknown-version');
  assert.equal(validateEvent(schemas, { ...REPLY(), type: 'case.deleted' }).reason, 'unknown-type');
  const extra = REPLY(); extra.payload.phone = '+91 90000 00000';
  assert.ok(validateEvent(schemas, extra).errors.includes('$.payload.phone: not allowed'));
  const noMsg = REPLY(); delete noMsg.payload.message;
  assert.ok(validateEvent(schemas, noMsg).errors.includes('$.payload.message: required'));
  assert.ok(validateEvent(schemas, { ...REPLY(), event_id: 'not-a-uuid' }).errors.some((e) => e.includes('uuid')));
  assert.ok(validateEvent(schemas, { ...REPLY(), surprise: 1 }).errors.includes('$.surprise: not allowed'));
});

test('the signature is HMAC-SHA256 over the exact body, with two keys live during rotation', () => {
  const body = JSON.stringify(REPLY());
  assert.ok(verify(body, sign(body, KEY), [KEY, OLD_KEY]));
  assert.ok(verify(body, sign(body, OLD_KEY), [KEY, OLD_KEY]));
  assert.ok(!verify(body + ' ', sign(body, KEY), [KEY]));
  assert.ok(!verify(body, sign(body, 'another-key-that-is-long-enough-to-count-00'), [KEY]));
});

test('the stub receiver refuses a bad signature, applies each event once and answers push.delivered', async () => {
  const { r, recorded } = stub();
  const e = REPLY(), body = JSON.stringify(e);
  assert.deepEqual(await r.receive(body, 'f'.repeat(64)), { status: 401, reason: 'signature' });
  const first = await r.receive(body, sign(body, KEY));
  assert.equal(first.status, 200);
  assert.equal(first.applied, true);
  assert.equal(first.ack.type, 'push.delivered');
  assert.equal(first.ack.payload.message_id, e.event_id);
  assert.deepEqual(validateEvent(schemas, first.ack), { ok: true, type: 'push.delivered' });
  const again = await r.receive(body, sign(body, KEY));
  assert.deepEqual(again, { status: 200, applied: false, ack: null });
  assert.equal(recorded.length, 1, 'the same event delivered twice is applied once');
  const lead = event('lead.lost', { reason: 'x' });
  const lb = JSON.stringify(lead);
  assert.equal((await r.receive(lb, sign(lb, KEY))).status, 400);
});

test('the console\'s push signs, uses the event id as idempotency key, retries 5xx and is delivered only on push.delivered', async () => {
  const { r } = stub();
  const seenHeaders = [];
  let fail = 2;
  const res = await pushEvent(REPLY(), { url: 'https://stub.invalid/events', key: KEY, schemas, sleep: async () => {},
    fetch: async (url, init) => { seenHeaders.push(init.headers);
      if (fail-- > 0) return { status: 503, async text() { return ''; } };
      const out = await r.receive(init.body, init.headers['X-Signature']);
      return { status: out.status, async text() { return JSON.stringify(out); } }; } });
  assert.deepEqual(res, { delivered: true, attempts: 3 });
  assert.ok(seenHeaders.every((h) => h['Idempotency-Key'] === seenHeaders[0]['Idempotency-Key']), 'the same key on every retry');
  const invalid = REPLY(); invalid.payload.extra = true;
  assert.deepEqual(await pushEvent(invalid, { url: 'x', key: KEY, schemas, fetch: async () => { throw new Error('never sent'); } }), { delivered: false, attempts: 0, reason: 'invalid:invalid' });
});
