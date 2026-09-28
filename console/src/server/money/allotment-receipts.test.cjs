/* M10-S07-T02 — allotment-scoped receipt writes.
 *
 * Run from console/: node src/server/money/allotment-receipts.test.cjs
 *
 * Compiles the guard, the M01-S08 replay path and the real Zoho client with the project's TypeScript and
 * drives them with synthetic recorded responses (__fixtures__/receipts/*). No request reaches Zoho.
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
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoho-allotment-receipts-'));
process.on('exit', () => fs.rmSync(outDir, { recursive: true, force: true }));

const config = ts.readConfigFile(path.join(consoleRoot, 'tsconfig.json'), ts.sys.readFile);
const project = ts.parseJsonConfigFileContent(config.config, ts.sys, consoleRoot);
const options = { ...project.options, incremental: false, tsBuildInfoFile: undefined, plugins: undefined,
  module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10, noEmit: false, noEmitOnError: true, outDir, rootDir: srcRoot };
const sources = ['lib/zoho/errors.ts', 'lib/zoho/gate.ts', 'lib/zoho/log.ts', 'lib/zoho/client.ts',
  'server/money/receipt-replay.ts', 'server/money/allotment-receipts.ts'].map((f) => path.join(srcRoot, f));
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
const { createAllotmentReceiptWrites, expectedPaymentStatus } = load('server/money/allotment-receipts.js');

const P = '9007199254';
const ALLOTMENT = '9007199254740993001', CUSTOMER = '9007199254740993002', LLP = '9007199254740993003';
const RECEIPT = '9007199254740993005', ACTOR = '9007199254740993090';
const SESSION = 'session_fixture_00000001';
const NOW = Date.parse('2026-09-02T09:02:00+05:30');
const SECRETS = ['Synthetic Fixture Investor', 'Synthetic Fixture Farm', 'fixture.investor@example.invalid', 'ABCDE1234F',
  '000012341208', 'Synthetic investor note', 'SYNTHADV001', 'HDFC2609001', 'synthetic-user-access-token'];
const recorded = (name) => JSON.parse(fs.readFileSync(path.join(fixtureRoot, `${name}.response.json`), 'utf8'));
const toResponse = (r) => new Response(r.body === null ? null : JSON.stringify(r.body), { status: r.status, headers: r.headers || {} });
const immediateGate = () => ({ async acquire() { return { waitedMs: 0, release() {} }; } });
const noSecrets = (value) => { const s = JSON.stringify(value); for (const x of SECRETS) assert.ok(!s.includes(x), `leaked ${x}`); };

let cred;
before(async () => {
  cred = await userCredential({ access_token: 'synthetic-user-access-token-never-live', api_domain: 'https://www.zohoapis.in', expires_in: 3_600 },
    { recordIdPrefix: P, gate: immediateGate(), log: createOpsLog(createMemorySink()), clock: () => NOW,
      fetch: async () => toResponse(recorded('current-user.finance')) });
  assert.equal(cred.userId, ACTOR);
});
const principal = () => ({ credential: cred, sessionId: SESSION });

/** Real client over recorded replies. `allotment` may be a list: one reply per read, the last repeats. */
function rig(opts = {}) {
  const sink = createMemorySink();
  const log = createOpsLog(sink);
  const allotments = [].concat(opts.allotment ?? 'allotment.current');
  const calls = [];
  let allotmentReads = 0;
  const crm = createZohoClient({ recordIdPrefix: P, gate: immediateGate(), log, maxAttempts: 1, clock: () => NOW,
    fetch: async (url, init) => {
      const u = String(url);
      if (u.endsWith('/coql')) {
        const q = JSON.parse(init.body).select_query; calls.push(['coql', q]);
        if (/where (UTR|Idempotency_Key) = /.test(q)) return toResponse(recorded('receipts.empty'));
        if (/select id, Allotment, Kind, Amount, Match_State from Receipts where Allotment = /.test(q)) return toResponse(recorded(opts.matched ?? 'receipts.matched-mixed'));
        if (/from Receipts where Allotment = /.test(q)) return toResponse(recorded('receipts.empty'));
        throw new Error(`unexpected query ${q}`);
      }
      if (init.method === 'GET' && u.includes(`/LLP_UnitAllocation_Module/${ALLOTMENT}`)) {
        calls.push(['getRecord', ALLOTMENT]);
        const name = allotments[Math.min(allotmentReads++, allotments.length - 1)];
        return toResponse(recorded(name));
      }
      if (init.method === 'POST' && u.endsWith('/Receipts')) {
        calls.push(['insert', JSON.parse(init.body).data]);
        return toResponse(recorded(opts.insert ?? 'receipt.created'));
      }
      throw new Error(`unexpected call ${init.method} ${u}`);
    } });
  const replay = createReceiptReplayService({
    crm, log, recordIdPrefix: P, clock: () => NOW,
    permission: { async recheck() { return true; } },
    session: { async recheck() { return true; } },
    idempotencySecret: 'synthetic-receipt-idempotency-secret-0001',
    contextSigningSecret: 'synthetic-receipt-context-signing-secret-0001',
  });
  const stubWrites = [];
  const stubReplay = { async replay(p, cmd) { stubWrites.push(cmd); return { ok: true, receiptId: RECEIPT, duplicate: false }; } };
  const svc = createAllotmentReceiptWrites({ crm, replay: opts.stub ? stubReplay : replay, log, recordIdPrefix: P, clock: () => NOW });
  return { svc, replay, calls, sink, stubWrites };
}

const intent = (over = {}) => ({ allotmentId: ALLOTMENT, kind: 'Advance', amountRupees: 250000, mode: 'NEFT', utr: 'HDFC2609001',
  receivedOn: '2026-09-02T09:00:00+05:30', ...over });
async function preparedCommand(r, over = {}) {
  const prep = await r.replay.prepare(principal(), ALLOTMENT);
  assert.equal(prep.ok, true, JSON.stringify(prep));
  return { preparedAt: prep.value.preparedAt, queuedAt: prep.value.preparedAt, contextToken: prep.value.contextToken,
    idempotencyKey: 'receipt_session_a_0001', intent: intent(over), expected: prep.value.expected };
}

test('expected Payment_Status: nothing matched, part matched, all matched', () => {
  assert.equal(expectedPaymentStatus(0, 2_500_000), 'Yet to initiate');
  assert.equal(expectedPaymentStatus(200_000, 2_500_000), 'Partial');
  assert.equal(expectedPaymentStatus(2_500_000, 2_500_000), 'Full');
  assert.equal(expectedPaymentStatus(2_600_000, 2_500_000), 'Full', 'an excess credit is still Full');
});

test('a write without an allotment is refused before Zoho is asked', async () => {
  for (const allotmentId of [undefined, null, '', '8007199254740993999', 'abc']) {
    const r = rig({ stub: true });
    const res = await r.svc.record(principal(), { intent: intent({ allotmentId }) });
    assert.deepEqual(res, { ok: false, kind: 'refused', reasonCode: 'allotment-required', retryable: false });
    assert.equal(r.calls.length, 0);
    assert.equal(r.stubWrites.length, 0);
  }
  const r = rig({ stub: true });
  const g = await r.svc.guarded(principal(), undefined, 'Refund', async () => { throw new Error('must not write'); });
  assert.equal(g.reasonCode, 'allotment-required', 'the refund flow needs an allotment too');
});

test('an allotment the person cannot see is refused', async () => {
  const r = rig({ stub: true, allotment: 'receipts.empty' });
  const res = await r.svc.record(principal(), { intent: intent() });
  assert.equal(res.ok, false);
  assert.ok(['allotment-not-visible', 'source-invalid'].includes(res.reasonCode), res.reasonCode);
  assert.equal(r.stubWrites.length, 0);
});

test('a Cancelled allotment refuses a non-refund receipt and writes nothing', async () => {
  for (const kind of ['Advance', 'Part', 'Full', 'Balance', 'Forfeit']) {
    const r = rig({ stub: true, allotment: 'allotment.cancelled' });
    const res = await r.svc.record(principal(), { intent: intent({ kind }) });
    assert.deepEqual(res, { ok: false, kind: 'refused', reasonCode: 'allotment-cancelled', retryable: false }, kind);
    assert.equal(r.stubWrites.length, 0);
    assert.ok(!r.calls.some(([op]) => op === 'insert'));
  }
});

test('a Cancelled allotment lets a refund through to its writer and returns the status', async () => {
  const r = rig({ stub: true, allotment: 'allotment.cancelled' });
  let wrote = 0;
  const res = await r.svc.guarded(principal(), ALLOTMENT, 'Refund', async () => { wrote++; return { ok: true, receiptId: RECEIPT, duplicate: false }; });
  assert.equal(wrote, 1);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.deepEqual(res.link, { allotmentId: ALLOTMENT, investorId: CUSTOMER, farmId: LLP });
  // Cancelled reads Reserved_Units under the register's convention: 1 × 25,00,000; matched net 2,00,000.
  assert.equal(res.paymentStatus.expected, 'Partial');
});

test('through the replay path a refund on a Cancelled allotment reaches the replay rule, not the cancel rule', async () => {
  const r = rig({ allotment: 'allotment.cancelled' });
  const res = await r.svc.record(principal(), { intent: intent({ kind: 'Refund' }) });
  assert.notEqual(res.reasonCode, 'allotment-cancelled');
});

test('a recorded receipt returns the allotment Payment_Status Zoho holds after the write', async () => {
  const r = rig({ allotment: ['allotment.current', 'allotment.current', 'allotment.current', 'allotment.payment-partial'] });
  const cmd = await preparedCommand(r);
  const res = await r.svc.record(principal(), cmd);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.receiptId, RECEIPT);
  assert.equal(res.duplicate, false);
  assert.deepEqual(res.link, { allotmentId: ALLOTMENT, investorId: CUSTOMER, farmId: LLP });
  assert.deepEqual(res.paymentStatus, { live: 'Partial', expected: 'Partial', value: 'Partial', source: 'zoho', mismatch: false,
    receivedRupees: 200000, amountRupees: 2500000 });
  const inserted = r.calls.filter(([op]) => op === 'insert');
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0][1][0].Allotment.id, ALLOTMENT);
  assert.equal(inserted[0][1][0].Match_State, 'Pending', 'recording never matches (D21)');
  const last = r.calls[r.calls.length - 1];
  assert.equal(last[0], 'coql');
  assert.match(last[1], /Match_State from Receipts where Allotment = '9007199254740993001'/);
});

test('without the T01 workflow the status is computed from matched receipts and marked as such', async () => {
  const r = rig({ stub: true });
  const res = await r.svc.record(principal(), { intent: intent() });
  assert.equal(res.paymentStatus.source, 'computed');
  assert.equal(res.paymentStatus.live, null);
  assert.equal(res.paymentStatus.value, 'Partial');
  const none = rig({ stub: true, matched: 'receipts.empty' });
  assert.equal((await none.svc.record(principal(), { intent: intent() })).paymentStatus.value, 'Yet to initiate');
});

test('a stale Payment_Status is flagged as a mismatch and logged by id', async () => {
  const r = rig({ stub: true, allotment: 'allotment.payment-full-stale' });
  const res = await r.svc.record(principal(), { intent: intent() });
  assert.equal(res.paymentStatus.live, 'Full');
  assert.equal(res.paymentStatus.expected, 'Partial');
  assert.equal(res.paymentStatus.mismatch, true);
  const entry = r.sink.records().find((x) => x.kind === 'refusal' && x.reason === 'payment-status-mismatch');
  assert.deepEqual(entry.recordIds, [ALLOTMENT, RECEIPT]);
  const read = await r.svc.paymentStatus(principal(), ALLOTMENT);
  assert.equal(read.ok, true);
  assert.equal(read.value.mismatch, true);
});

test('a 412 on the write is answered as allotment-changed, not as an unknown outcome', async () => {
  const r = rig({ insert: 'receipt.conflict-412' });
  const cmd = await preparedCommand(r);
  const res = await r.svc.record(principal(), cmd);
  assert.deepEqual(res, { ok: false, kind: 'refused', reasonCode: 'allotment-changed', retryable: false });
  assert.equal(r.calls.filter(([op]) => op === 'insert').length, 1, 'never retried');
  const guardedConflict = await rig({ stub: true }).svc.guarded(principal(), ALLOTMENT, 'Advance',
    async () => ({ ok: false, kind: 'source-error', source: 'zoho', errorKind: 'conflict', retryable: false }));
  assert.equal(guardedConflict.reasonCode, 'allotment-changed');
});

test('a failed read-back after a landed write still reports the receipt', async () => {
  const r = rig({ stub: true, allotment: ['allotment.current', 'source.server-error'] });
  const res = await r.svc.record(principal(), { intent: intent() });
  assert.equal(res.ok, true);
  assert.equal(res.receiptId, RECEIPT);
  assert.equal(res.paymentStatus, null);
});

test('a Zoho outage before the write writes nothing and is retryable', async () => {
  const r = rig({ stub: true, allotment: 'source.server-error' });
  const res = await r.svc.record(principal(), { intent: intent() });
  assert.equal(res.kind, 'source-error');
  assert.equal(res.retryable, true);
  assert.equal(r.stubWrites.length, 0);
});

test('an untrusted principal is refused', async () => {
  const r = rig({ stub: true });
  assert.equal((await r.svc.record({ credential: { userId: ACTOR }, sessionId: SESSION }, { intent: intent() })).reasonCode, 'invalid-request');
  assert.equal(r.calls.length, 0);
});

test('results and the ops log carry ids and codes only', async () => {
  const r = rig({ allotment: ['allotment.current', 'allotment.current', 'allotment.current', 'allotment.payment-full-stale'] });
  const ok = await r.svc.record(principal(), await preparedCommand(r));
  const cancelled = rig({ stub: true, allotment: 'allotment.cancelled' });
  const refused = await cancelled.svc.record(principal(), { intent: intent() });
  const outage = rig({ stub: true, allotment: 'source.server-error' });
  const failed = await outage.svc.record(principal(), { intent: intent() });
  noSecrets([ok, refused, failed]);
  for (const s of [r.sink, cancelled.sink, outage.sink]) {
    const records = s.records();
    assert.ok(records.length > 0);
    noSecrets(records);
    assert.ok(!/Amount|Rupees|2500000|200000/.test(JSON.stringify(records)), 'no money values in the ops log');
    for (const x of records) for (const id of x.recordIds) assert.match(id, /^\d{15,22}$/);
  }
});
