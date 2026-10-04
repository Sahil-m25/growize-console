/* "Show the reference" — POST /api/receipts/[id]/reveal's module (rule 7, D13/D22, TC-E11-016).
 *
 * Run from console/: node --test src/server/money/reveal-ref.test.cjs
 * A fake CRM: no request reaches Zoho. The seat check, the Zoho read and the Plane C line are the three things proved.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { before, test } = require('node:test');

const consoleRoot = path.resolve(__dirname, '..', '..', '..');
const srcRoot = path.join(consoleRoot, 'src');
const ts = require(path.join(consoleRoot, 'node_modules', 'typescript'));
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reveal-ref-'));
process.on('exit', () => fs.rmSync(outDir, { recursive: true, force: true }));
const config = ts.readConfigFile(path.join(consoleRoot, 'tsconfig.json'), ts.sys.readFile);
const project = ts.parseJsonConfigFileContent(config.config, ts.sys, consoleRoot);
const options = { ...project.options, incremental: false, tsBuildInfoFile: undefined, plugins: undefined,
  module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10, noEmit: false, noEmitOnError: true, outDir, rootDir: srcRoot };
const program = ts.createProgram(['server/money/reveal-ref.ts', 'server/data/events.ts', 'lib/im/constants.ts'].map((f) => path.join(srcRoot, f)), options);
const diagnostics = [...ts.getPreEmitDiagnostics(program), ...program.emit().diagnostics];
if (diagnostics.length) { console.error(ts.formatDiagnostics(diagnostics, { getCanonicalFileName: (f) => f, getCurrentDirectory: () => consoleRoot, getNewLine: () => '\n' })); process.exit(1); }
const { createRevealRef } = require(path.join(outDir, 'server/money/reveal-ref.js'));
const { userCredential } = require(path.join(outDir, 'lib/zoho/client.js'));
const { createMemorySink, createOpsLog } = require(path.join(outDir, 'lib/zoho/log.js'));
const { createInvestorEvents } = require(path.join(outDir, 'server/data/events.js'));
const { createPlaneCLog, createPlaneCMemorySink } = require(path.join(outDir, 'server/identity/plane-c.js'));
const { REVWHY } = require(path.join(outDir, 'lib/im/constants.js'));

const P = '9007199254';
const ME = '9007199254740994090', RID = `${P}740996304`;
const SESSION = 'session_fixture_00000009';
let cred, principal;
before(async () => {
  cred = await userCredential({ access_token: 'synthetic-test', api_domain: 'https://www.zohoapis.in', expires_in: 3_600 },
    { recordIdPrefix: P, gate: { async acquire() { return { waitedMs: 0, release() {} }; } }, log: createOpsLog(createMemorySink()), clock: () => 1_700_000_000_000,
      fetch: async () => new Response(JSON.stringify({ users: [{ id: ME, status: 'active' }] }), { status: 200 }) });
  principal = { credential: cred, sessionId: SESSION };
});

function rig({ seat = { seat: 'digital-infrastructure', mayReveal: true }, record = { id: RID, Mode: 'SWIFT', UTR: 'SWIFT00008119' }, error = null } = {}) {
  const calls = [], lines = [];
  const crm = { async getRecord(c, module, id, o) { calls.push({ module, id, fields: o.fields }); return error ? { ok: false, error } : { ok: true, value: record }; } };
  const events = { reveal: (...a) => lines.push(a) };
  return { svc: createRevealRef({ crm, events, seatNow: async () => seat }), calls, lines };
}

test('a seat with the reveal right gets the full reference for that one receipt, and one Plane C line is written (receipt id, no value)', async () => {
  const r = rig();
  const res = await r.svc.reveal(principal, RID);
  assert.deepEqual(res, { ok: true, value: { receiptId: RID, mode: 'SWIFT', utr: 'SWIFT00008119' } });
  assert.deepEqual(r.calls, [{ module: 'Receipts', id: RID, fields: ['Mode', 'UTR'] }]);
  assert.deepEqual(r.lines, [[ME, 'digital-infrastructure', 'bank_account', RID, 'ok', undefined]], 'no reason given: the events layer files "unstated"');
  assert.ok(!JSON.stringify(r.lines).includes('8119'), 'the value never reaches the log');
});

test('a seat without the right is refused before Zoho is read, and the refusal is logged', async () => {
  const r = rig({ seat: { seat: 'key-account-manager', mayReveal: false } });
  const res = await r.svc.reveal(principal, RID);
  assert.equal(res.ok, false);
  assert.equal(res.reasonCode, 'not-allowed');
  assert.equal(r.calls.length, 0);
  assert.deepEqual(r.lines, [[ME, 'key-account-manager', 'bank_account', RID, 'refused', undefined]]);
});

test('a receipt Zoho will not show this person is "not visible" (logged refused); a changed session or bad id is invalid-request and reads nothing', async () => {
  let r = rig({ error: { kind: 'refused' } });
  let res = await r.svc.reveal(principal, RID);
  assert.equal(res.reasonCode, 'not-visible');
  assert.equal(r.lines[0][4], 'refused');
  r = rig({ seat: null });
  assert.equal((await r.svc.reveal(principal, RID)).reasonCode, 'invalid-request');
  r = rig();
  assert.equal((await r.svc.reveal(principal, 'not-an-id')).reasonCode, 'invalid-request');
  assert.equal((await r.svc.reveal({ credential: cred, sessionId: 'x' }, RID)).reasonCode, 'invalid-request');
  assert.equal(r.calls.length, 0);
  assert.equal(r.lines.length, 0);
});

test('a record that is not the one asked for, or has no reference, is source-invalid and shows nothing', async () => {
  let r = rig({ record: { id: `${P}740999999`, UTR: 'X1234567' } });
  assert.equal((await r.svc.reveal(principal, RID)).reasonCode, 'source-invalid');
  r = rig({ record: { id: RID, UTR: '' } });
  assert.equal((await r.svc.reveal(principal, RID)).reasonCode, 'source-invalid');
  assert.equal(r.lines.length, 0);
});

test('M15-S05-NOTE-1: the chosen reason rides to the Plane C writer with the reveal, given or refused', async () => {
  let r = rig();
  await r.svc.reveal(principal, RID, undefined, 'payout-refund');
  assert.deepEqual(r.lines, [[ME, 'digital-infrastructure', 'bank_account', RID, 'ok', 'payout-refund']]);
  r = rig({ seat: { seat: 'key-account-manager', mayReveal: false } });
  await r.svc.reveal(principal, RID, undefined, 'cheque-name-match');
  assert.equal(r.lines[0][5], 'cheque-name-match');
});

test('M18-S05-NOTE-3: the Payments register sends the chip\'s words; each bank-account chip lands on the Plane C line as its code, no chip as "unstated"', async () => {
  const sink = createPlaneCMemorySink();
  const events = createInvestorEvents({ log: createOpsLog(createMemorySink()), planeC: createPlaneCLog(sink), clock: () => 1_700_000_000_000 });
  const crm = { async getRecord() { return { ok: true, value: { id: RID, Mode: 'SWIFT', UTR: 'SWIFT00008119' } }; } };
  const svc = createRevealRef({ crm, events, seatNow: async () => ({ seat: 'fin', mayReveal: true }) });
  for (const label of REVWHY.acct) assert.equal((await svc.reveal(principal, RID, undefined, label)).ok, true);
  await svc.reveal(principal, RID, undefined, null);
  assert.deepEqual(sink.events().map((e) => [e.action, e.reason, e.why, e.recordIds]), [
    ['reveal', 'bank-account', 'payout-refund', [RID]], ['reveal', 'bank-account', 'cheque-name-match', [RID]],
    ['reveal', 'bank-account', 'own-record-query', [RID]], ['reveal', 'bank-account', 'unstated', [RID]]]);
  assert.ok(!JSON.stringify(sink.events()).includes('8119'), 'the reference never reaches the line');
});
