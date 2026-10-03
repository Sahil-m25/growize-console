/* M13-S01-T04 EVERY EVENT IN contracts/ — schema, signature, replay, receiver down.
 *
 * Run from console/: node src/server/contracts/all-events.test.cjs
 * (derived from events.test.cjs: same compile-to-temp approach; synthetic data only, built from the schemas themselves)
 *
 * M20-S07 CONTRACT EVENTS REGRESSION
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

const { createStubReceiver, pushEvent, sign, validateEvent } = require(path.join(outDir, 'server', 'contracts', 'events.js'));

const schemas = Object.fromEntries(fs.readdirSync(contractsRoot).filter((f) => f.endsWith('.json')).map((f) => [f, JSON.parse(fs.readFileSync(path.join(contractsRoot, f), 'utf8'))]));
const types = Object.keys(schemas).filter((f) => f !== '_envelope.json').map((f) => f.replace(/\.json$/, ''));
const KEY = 'synthetic-contract-key-never-live-000000000001';
let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const PATTERNS = { '^ARL-INV-[0-9]{4}$': 'ARL-INV-0001', '^[0-9]{10,25}$': '1234567890123', '^[0-9]{15,22}$': '123456789012345', '^[A-Za-z0-9-]{1,64}$': 'abc-123',
  '^[a-f0-9]{64}$': 'a'.repeat(64), '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?$': 'https://example.invalid' };

/** A value that satisfies the schema node. `all` fills every property, otherwise only the required ones. */
function sample(node, all) {
  if ('const' in node) return node.const;
  if (node.enum) return node.enum[0];
  switch (node.type) {
    case 'string':
      if (node.format === 'uuid') return uuid();
      if (node.format === 'date-time') return '2026-09-27T21:00:00+05:30';
      if (node.pattern) { assert.ok(PATTERNS[node.pattern], `no sample for pattern ${node.pattern}`); return PATTERNS[node.pattern]; }
      return 'synthetic';
    case 'integer': return Math.max(1, node.minimum ?? 1);
    case 'number': return 1.5;
    case 'boolean': return true;
    case 'array': return [sample(node.items ?? { type: 'string' }, all)];
    case 'object': {
      const out = {};
      for (const [k, p] of Object.entries(node.properties ?? {})) if (all || (node.required ?? []).includes(k)) out[k] = sample(p, all);
      return out;
    }
    default: assert.fail(`unhandled schema node ${JSON.stringify(node).slice(0, 80)}`);
  }
}
const payloadSchema = (t) => schemas[`${t}.json`].properties.payload;
function build(t, all) {
  const e = { event_id: uuid(), type: t, schema_version: 1, occurred_at: '2026-09-27T21:00:00+05:30', actor: { kind: 'system' }, ids: { investor_contact_id: '9007199254740994101' },
    payload: sample(payloadSchema(t), all), origin: 'console' };
  // an event may narrow the envelope (actor kind, required ids): fill what its own schema asks for
  for (const k of ['actor', 'ids']) {
    const own = schemas[`${t}.json`].properties[k];
    if (own) e[k] = { ...e[k], ...sample({ ...own, type: 'object' }, false), ...(own.properties?.kind?.const ? { kind: own.properties.kind.const } : {}) };
  }
  return e;
}
const clone = (o) => JSON.parse(JSON.stringify(o));
const wrong = (node) => (node.const !== undefined || node.enum ? '\u0000not-allowed' : node.type === 'string' ? 12345 : node.type === 'array' ? 'x' : node.type === 'object' ? 'x' : 'x');

test('the schema set: at least the 30 planned events plus update.published, each with a payload schema', () => {
  assert.ok(types.length >= 31 && types.includes('update.published') && types.includes('request.raised'));
  for (const t of types) assert.ok(payloadSchema(t) && payloadSchema(t).type === 'object', `${t} has no payload schema`);
});

for (const t of types) {
  test(`${t}: valid built from its schema (required only, and every field); each required field, a wrong type, a wrong enum/const and an extra field fail`, () => {
    for (const all of [false, true]) assert.deepEqual(validateEvent(schemas, build(t, all)), { ok: true, type: t }, `${t} (all=${all})`);
    const ps = payloadSchema(t);
    for (const r of ps.required ?? []) {
      const e = build(t, false); delete e.payload[r];
      assert.ok(validateEvent(schemas, e).errors.includes(`$.payload.${r}: required`), `${t}: missing ${r} must fail`);
    }
    for (const [k, p] of Object.entries(ps.properties ?? {})) {
      const e = build(t, true); e.payload[k] = wrong(p);
      assert.equal(validateEvent(schemas, e).ok, false, `${t}: a wrong ${k} must fail`);
    }
    if (ps.additionalProperties === false) {
      const e = build(t, true); e.payload.pan = 'ABCDE1234F';
      assert.ok(validateEvent(schemas, e).errors.includes('$.payload.pan: not allowed'), `${t}: an extra field must fail`);
    }
    const noEnv = build(t, true); delete noEnv.occurred_at;
    assert.ok(validateEvent(schemas, noEnv).errors.includes('$.occurred_at: required'));
    assert.equal(validateEvent(schemas, { ...build(t, true), type: t === 'case.replied' ? 'farm.progress' : 'case.replied' }).ok, false, `${t}: another type's name must fail on payload or const`);
  });
}

function rig({ down = () => false } = {}) {
  const recorded = [], seen = new Set();
  const r = createStubReceiver({ schemas, keys: [KEY], accepts: types, seen: { async has(id) { return seen.has(id); }, async add(id) { seen.add(id); } },
    record: async (e) => { recorded.push(e); }, newId: uuid, clock: () => Date.parse('2026-09-27T15:30:00Z') });
  const fetch = async (_u, init) => { if (down()) return { status: 503, async text() { return ''; } };
    const out = await r.receive(init.body, init.headers['X-Signature']); return { status: out.status, async text() { return JSON.stringify(out); } }; };
  return { r, recorded, fetch };
}

test('every event: a bad signature is refused (401, nothing applied); signed it is applied once and a replay is a no-op', async () => {
  const { r, recorded } = rig();
  for (const t of types) {
    const e = build(t, true), body = JSON.stringify(e);
    assert.deepEqual(await r.receive(body, 'f'.repeat(64)), { status: 401, reason: 'signature' }, `${t}: bad signature`);
    assert.deepEqual(await r.receive(body + ' ', sign(body, KEY)), { status: 401, reason: 'signature' }, `${t}: body changed after signing`);
    const first = await r.receive(body, sign(body, KEY));
    assert.equal(first.status, 200, `${t}: first`); assert.equal(first.applied, true);
    assert.deepEqual(await r.receive(body, sign(body, KEY)), { status: 200, applied: false, ack: null }, `${t}: replay`);
  }
  assert.equal(recorded.length, types.length, 'each event applied exactly once');
});

test('every event: the receiver down is retried with the same event id and reported not delivered; back up it is delivered once', async () => {
  for (const t of types) {
    let down = true; const sleeps = []; const keys = new Set();
    const { fetch, recorded } = rig({ down: () => down });
    const f = async (u, init) => { keys.add(init.headers['Idempotency-Key']); return fetch(u, init); };
    const e = build(t, true);
    const o = { url: 'https://stub.invalid/events', key: KEY, schemas, fetch: f, sleep: async (ms) => { sleeps.push(ms); }, maxAttempts: 3 };
    const res = await pushEvent(e, o);
    assert.equal(res.delivered, false, `${t}: down`); assert.equal(recorded.length, 0);
    assert.equal(keys.size, 1, `${t}: one idempotency key across every retry`);
    down = false;
    // push.delivered is answered only for events the receiver applies; the ack type itself is checked in events.test.cjs
    const up = await pushEvent(e, o);
    assert.equal(recorded.length, 1, `${t}: applied once after recovery`);
    assert.equal(up.delivered, true, `${t}: delivered once the receiver is back (its push.delivered ack)`);
  }
});
