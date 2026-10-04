/* M08-S03-T04 — Finance records a receipt through commit(), over recorded Zoho replies.
 *
 * Run from console/: timeout 170 node --test src/server/money/record-receipt.test.cjs
 *
 * Drives the real chain — record-receipt.ts → allotment-receipts.ts → receipt-replay.ts → the Zoho client — with
 * the synthetic fixtures of __fixtures__/receipts/*. No request reaches Zoho.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { before, test } = require('node:test');

const consoleRoot = path.resolve(__dirname, '..', '..', '..');
const srcRoot = path.join(consoleRoot, 'src');
const fixtureRoot = path.join(srcRoot, 'lib', 'zoho', '__fixtures__', 'receipts');
const ts = require(path.join(consoleRoot, 'node_modules', 'typescript'));
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'record-receipt-'));
process.on('exit', () => fs.rmSync(outDir, { recursive: true, force: true }));

const config = ts.readConfigFile(path.join(consoleRoot, 'tsconfig.json'), ts.sys.readFile);
const project = ts.parseJsonConfigFileContent(config.config, ts.sys, consoleRoot);
const options = { ...project.options, incremental: false, tsBuildInfoFile: undefined, plugins: undefined,
  module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10, noEmit: false, noEmitOnError: true, outDir, rootDir: srcRoot };
const sources = ['lib/zoho/errors.ts', 'lib/zoho/gate.ts', 'lib/zoho/log.ts', 'lib/zoho/client.ts', 'server/money/receipt-replay.ts',
  'server/money/allotment-receipts.ts', 'server/money/record-receipt.ts', 'server/state/memory.ts', 'server/state/catalyst.ts',
  'server/state/fake-catalyst.ts'].map((f) => path.join(srcRoot, f));
const program = ts.createProgram(sources, options);
const diagnostics = [...ts.getPreEmitDiagnostics(program), ...program.emit().diagnostics];
if (diagnostics.length) {
  console.error(ts.formatDiagnostics(diagnostics, { getCanonicalFileName: (f) => f, getCurrentDirectory: () => consoleRoot, getNewLine: () => '\n' }));
  process.exit(1);
}
const load = (file) => require(path.join(outDir, file));
const { createMemorySink, createOpsLog } = load('lib/zoho/log.js');
const { createZohoClient, userCredential } = load('lib/zoho/client.js');
const { createReceiptReplayService } = load('server/money/receipt-replay.js');
const { createAllotmentReceiptWrites } = load('server/money/allotment-receipts.js');
const { createRecordReceipt, READ_ONLY_TEXT, MATCH_BLOCKED_TEXT } = load('server/money/record-receipt.js');
const { createMemoryState } = load('server/state/memory.js');
const { createCatalystState } = load('server/state/catalyst.js');
const { createFakeCatalyst, FAKE_CONFIG } = load('server/state/fake-catalyst.js');

const P = '9007199254';
const ALLOTMENT = '9007199254740993001', CUSTOMER = '9007199254740993002', LLP = '9007199254740993003';
const RECEIPT = '9007199254740993005', FINANCE = '9007199254740993090';
const SESSION = 'session_fixture_record_0001';
const NOW = Date.parse('2026-09-02T09:02:00+05:30');
const KEY = 'press_record_000001';

const recorded = (name) => JSON.parse(fs.readFileSync(path.join(fixtureRoot, `${name}.response.json`), 'utf8'));
const toResponse = (r) => new Response(r.body === null ? null : JSON.stringify(r.body), { status: r.status, headers: r.headers || {} });
const immediateGate = () => ({ async acquire() { return { waitedMs: 0, release() {} }; } });

let cred;
before(async () => {
  cred = await userCredential({ access_token: 'synthetic-finance-token-never-live', api_domain: 'https://www.zohoapis.in', expires_in: 3_600 },
    { recordIdPrefix: P, gate: immediateGate(), log: createOpsLog(createMemorySink()), clock: () => NOW,
      fetch: async () => toResponse(recorded('current-user.finance')) });
  assert.equal(cred.userId, FINANCE);
});
const principal = () => ({ credential: cred, sessionId: SESSION });

function rig(o = {}) {
  const f = { allotment: 'allotment.current', context: 'receipts.advance', insert: 'receipt.created', byKey: 'receipts.empty', mayRecord: true, ...o };
  const calls = [];
  const sink = createMemorySink();
  const log = createOpsLog(sink);
  let inserts = 0;
  const crm = createZohoClient({ recordIdPrefix: P, gate: immediateGate(), log, maxAttempts: 1, clock: () => NOW,
    fetch: async (url, init) => {
      const u = String(url);
      if (u.endsWith('/coql')) {
        const q = JSON.parse(init.body).select_query; calls.push({ op: 'coql', q });
        if (/where Idempotency_Key = /.test(q)) return toResponse(recorded(inserts > 0 ? f.byKey : 'receipts.empty'));
        if (/where UTR = /.test(q)) return toResponse(recorded('receipts.empty'));
        if (/select id, Allotment, Kind, Amount, Match_State from Receipts where Allotment = /.test(q)) return toResponse(recorded('receipts.empty'));
        if (/from Receipts where Allotment = /.test(q)) return toResponse(recorded(f.context));
        throw new Error(`unrouted ${q}`);
      }
      if (init.method === 'GET' && u.includes(`/LLP_UnitAllocation_Module/${ALLOTMENT}`)) { calls.push({ op: 'getAllotment' }); return toResponse(recorded(f.allotment)); }
      if (init.method === 'POST' && u.endsWith('/Receipts')) {
        inserts++;
        calls.push({ op: 'insert', data: JSON.parse(init.body).data });
        await new Promise((r) => setTimeout(r, 5));
        return toResponse(recorded(f.insert));
      }
      throw new Error(`unexpected ${init.method} ${u}`);
    } });
  /* one "instance": its own replay service and guards, over the shared Zoho fake (and the shared state, when given) */
  const instance = (state) => {
    const replay = createReceiptReplayService({
      crm, log, recordIdPrefix: P, clock: () => NOW,
      permission: { async recheck() { return true; } }, session: { async recheck() { return true; } },
      idempotencySecret: 'synthetic-receipt-idempotency-secret-0001', contextSigningSecret: 'synthetic-receipt-context-signing-secret-0001',
    });
    const writes = createAllotmentReceiptWrites({ crm, replay, log, recordIdPrefix: P, clock: () => NOW });
    return createRecordReceipt({ replay, writes, log, recordIdPrefix: P, clock: () => NOW, state,
      authority: { async mayRecord() { return f.mayRecord; } } });
  };
  const svc = instance(o.state);
  return { svc, instance, calls, sink, inserts: () => calls.filter((c) => c.op === 'insert') };
}
const balance = (over = {}) => ({ allotmentId: ALLOTMENT, kind: 'balance', mode: 'SWIFT', ref: 'EMIR0209900', ...over });

test('TC-IM05-005: Finance records the balance by SWIFT — one receipt (unmatched here: no match service wired; D113 matching is record-matched.test.cjs), amount computed, by the token user, under the farm', async () => {
  const r = rig();
  const res = await r.svc.commit(principal(), balance(), KEY);
  assert.equal(res.ok, true, JSON.stringify(res));
  const v = res.value;
  assert.equal(v.state, 'unmatched');
  assert.equal(v.kind, 'balance');
  assert.equal(v.mode, 'SWIFT');
  assert.equal(v.ref, 'EMIR0209900');
  assert.equal(v.amountRupees, 2_250_000, 'the balance is what is still due: 25 L less the 2.5 L recorded');
  assert.equal(v.recordedBy, FINANCE);
  assert.deepEqual(v.link, { allotmentId: ALLOTMENT, investorId: CUSTOMER, farmId: LLP });
  assert.equal(v.matchable, true);
  assert.equal(v.matchNote, null);
  assert.equal(v.receiptId, RECEIPT);
  const ins = r.inserts();
  assert.equal(ins.length, 1);
  const row = ins[0].data[0];
  assert.deepEqual({ Allotment: row.Allotment, Kind: row.Kind, Amount: row.Amount, Mode: row.Mode, UTR: row.UTR, Received_On: row.Received_On, Match_State: row.Match_State },
    { Allotment: { id: ALLOTMENT }, Kind: 'Part', Amount: 2_250_000, Mode: 'SWIFT', UTR: 'EMIR0209900', Received_On: '2026-09-02T00:00:00+05:30', Match_State: 'Pending' });
  assert.match(row.Idempotency_Key, /^receipt-v1_/);
  assert.ok(!('Customer' in row) && !('LLP' in row) && !('Contact' in row), 'only the allotment is linked; Contact and LLP follow from it');
  assert.ok(!JSON.stringify(r.sink.records()).includes('EMIR0209900'), 'the bank reference is never logged');
});

test('TC-IM05-007 / TC-IM05-025: a receipt with the supplementary unsigned is recorded, never refused — with the matching note', async () => {
  const r = rig({ allotment: 'allotment.unsigned' });
  const res = await r.svc.commit(principal(), balance({ mode: 'RTGS', ref: 'HDFC2708994', receivedOn: '2026-08-28' }), KEY);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.value.amountRupees, 2_250_000);
  assert.equal(res.value.state, 'unmatched');
  assert.equal(res.value.recordedBy, FINANCE);
  assert.equal(res.value.matchable, false);
  assert.equal(res.value.matchNote, MATCH_BLOCKED_TEXT);
  assert.match(MATCH_BLOCKED_TEXT, /cannot be matched until the supplementary agreement is signed and verified/);
  assert.equal(r.inserts()[0].data[0].Received_On, '2026-08-28T00:00:00+05:30');
  assert.equal(r.inserts()[0].data[0].Match_State, 'Pending');
});

test('TC-IM05-008: a seat that does not record money gets the read-only line and Zoho is not asked', async () => {
  const r = rig({ mayRecord: false });
  const res = await r.svc.commit(principal(), balance(), KEY);
  assert.equal(res.reasonCode, 'read-only');
  assert.equal(res.message, READ_ONLY_TEXT);
  assert.equal(READ_ONLY_TEXT, 'Read only — Finance Operations and the Head of Finance record money.');
  const prep = await r.svc.prepare(principal(), ALLOTMENT);
  assert.equal(prep.reasonCode, 'read-only');
  assert.equal(r.calls.length, 0);
});

test('double press: two presses with one key write exactly one receipt; the same key for another receipt is refused', async () => {
  const r = rig();
  const [a, b] = await Promise.all([r.svc.commit(principal(), balance(), KEY), r.svc.commit(principal(), balance(), KEY)]);
  assert.equal(a.ok && b.ok, true, JSON.stringify([a, b]));
  assert.equal(a.value.receiptId, b.value.receiptId);
  assert.deepEqual([a.value.duplicate, b.value.duplicate].sort(), [false, true]);
  assert.equal(r.inserts().length, 1);
  const later = await r.svc.commit(principal(), balance(), KEY);
  assert.equal(later.ok && later.value.duplicate, true, 'a retry after the answer gets the same record');
  assert.equal(r.inserts().length, 1);
  const other = await r.svc.commit(principal(), balance({ ref: 'EMIR0209901' }), KEY);
  assert.equal(other.reasonCode, 'idempotency-key-reused');
  assert.equal(r.inserts().length, 1);
});

test('a failed save reads "Not saved yet", is not held, and the same key may be pressed again', async () => {
  const r = rig({ insert: 'source.server-error', byKey: 'receipts.empty' });
  const res = await r.svc.commit(principal(), balance(), KEY);
  assert.equal(res.ok, false);
  assert.match(res.message, /^Not saved yet/);
  assert.equal(res.retryable, true);
  assert.ok(!JSON.stringify(res).includes('Synthetic Fixture Investor'), 'no Zoho body reaches the answer');
  assert.ok(r.calls.some((c) => c.q && /where Idempotency_Key = /.test(c.q)), 'the outcome is looked up by the durable key before answering');
  const again = await r.svc.commit(principal(), balance(), KEY);
  assert.equal(again.ok, false);
  assert.equal(r.inserts().length, 2, 'a failure is not held: the second press tries again under the same key');
});

test('the press must carry a key and a well-formed receipt; refunds are not this path', async () => {
  const r = rig();
  assert.equal((await r.svc.commit(principal(), balance(), undefined)).reasonCode, 'idempotency-key-invalid');
  assert.equal((await r.svc.commit(principal(), balance({ mode: 'Cash' }), KEY)).reasonCode, 'fields');
  assert.equal((await r.svc.commit(principal(), balance({ ref: '' }), KEY)).reasonCode, 'fields');
  assert.equal((await r.svc.commit(principal(), balance({ receivedOn: '2026-09-03' }), KEY)).reasonCode, 'fields', 'not in the future');
  assert.equal((await r.svc.commit(principal(), balance({ kind: 'refund' }), KEY)).reasonCode, 'fields');
  assert.equal((await r.svc.commit(principal(), balance({ kind: 'advance' }), KEY)).reasonCode, 'fields', 'an advance names its amount');
  assert.equal((await r.svc.commit(principal(), balance({ allotmentId: undefined }), KEY)).reasonCode, 'allotment-required');
  assert.equal(r.calls.length, 0);
});

test('prepare seals the context for the drawer: amount due and whether matching is blocked', async () => {
  const ok = await rig().svc.prepare(principal(), ALLOTMENT);
  assert.equal(ok.ok, true);
  assert.equal(ok.value.amountDueRupees, 2_250_000);
  assert.equal(ok.value.matchable, true);
  const unsigned = await rig({ allotment: 'allotment.unsigned' }).svc.prepare(principal(), ALLOTMENT);
  assert.equal(unsigned.value.matchable, false);
  assert.equal(unsigned.value.matchNote, MATCH_BLOCKED_TEXT);
  const r = rig();
  const res = await r.svc.commit(principal(), balance({ prepared: ok.value, amount: 2_250_000 }), 'press_record_000002');
  assert.equal(res.ok, true, 'a prepared context from the drawer is replayed unchanged');
});

/* M18-S09-NOTE-2: a double press landing on two instances writes one receipt (the key is claimed in SharedState) */
for (const [name, two] of [
  ['memory', () => { const st = createMemoryState({ clock: () => NOW }); return [st, st]; }],
  ['fake catalyst', () => { const fake = createFakeCatalyst({ seed: 5 }); const mk = () => createCatalystState(FAKE_CONFIG, { fetch: fake.fetch, clock: () => NOW, sleep: async () => undefined }); return [mk(), mk()]; }],
]) {
  test(`two instances (${name}): the same press on both records one receipt; the replay carries the reference back but the stored answer never held it`, async () => {
    const r = rig();
    const [s1, s2] = two();
    const [x, y] = await Promise.all([r.instance(s1).commit(principal(), balance(), KEY), r.instance(s2).commit(principal(), balance(), KEY)]);
    assert.equal(x.ok && y.ok, true, JSON.stringify([x, y]));
    assert.deepEqual([x.value.duplicate, y.value.duplicate].map(Boolean).sort(), [false, true]);
    assert.deepEqual([x.value.ref, y.value.ref], ['EMIR0209900', 'EMIR0209900']);
    assert.equal(r.inserts().length, 1, 'one Receipts insert across both instances');
    const reused = await r.instance(s2).commit(principal(), balance({ ref: 'EMIR0209901' }), KEY);
    assert.equal(reused.reasonCode, 'idempotency-key-reused');
  });
}

test('the stored answer for a press holds no bank reference (rule 7)', async () => {
  const fake = createFakeCatalyst({ seed: 9 });
  const state = createCatalystState(FAKE_CONFIG, { fetch: fake.fetch, clock: () => NOW, sleep: async () => undefined });
  const r = rig({ state });
  const res = await r.svc.commit(principal(), balance(), KEY);
  assert.equal(res.ok, true, JSON.stringify(res));
  const stored = JSON.stringify([...fake.items.values()]);
  assert.ok(stored.length > 0 && !stored.includes('EMIR0209900'), 'the reference never reaches the shared store');
  assert.ok(!stored.includes(KEY) && !stored.includes(SESSION), 'the key and session are hashed');
});
