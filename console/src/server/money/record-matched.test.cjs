/* D113 ruling 1 — a receipt a Finance seat records IS matched (Finance's own approval, no second person).
 *
 * Run from console/: node --test src/server/money/record-matched.test.cjs
 *
 * Drives the real chain end to end over synthetic Zoho replies: record-receipt.ts → allotment-receipts.ts →
 * receipt-replay.ts (the insert) → match.ts (the match by the recorder, and its consequences: the gate through matched
 * Receipts, money.confirmed, the investor's app account opened On hold at the first matched money, D93).
 * No request reaches Zoho.
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
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'record-matched-'));
process.on('exit', () => fs.rmSync(outDir, { recursive: true, force: true }));

const config = ts.readConfigFile(path.join(consoleRoot, 'tsconfig.json'), ts.sys.readFile);
const project = ts.parseJsonConfigFileContent(config.config, ts.sys, consoleRoot);
const options = { ...project.options, incremental: false, tsBuildInfoFile: undefined, plugins: undefined,
  module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10, noEmit: false, noEmitOnError: true, outDir, rootDir: srcRoot };
const sources = ['lib/zoho/errors.ts', 'lib/zoho/gate.ts', 'lib/zoho/log.ts', 'lib/zoho/client.ts', 'server/money/receipt-replay.ts',
  'server/money/allotment-receipts.ts', 'server/money/record-receipt.ts', 'server/money/match.ts'].map((f) => path.join(srcRoot, f));
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
const { createRecordReceipt, MATCH_BLOCKED_TEXT, NOT_MATCHED_YET_TEXT } = load('server/money/record-receipt.js');
const { createReceiptMatch } = load('server/money/match.js');

const P = '9007199254';
const ALLOTMENT = '9007199254740993001', CUSTOMER = '9007199254740993002';
const RECEIPT = '9007199254740993005', FINANCE = '9007199254740993090';
const SESSION = 'session_fixture_record_0002';
const NOW = Date.parse('2026-09-02T09:02:00+05:30');
const KEY = 'press_record_matched_01';

const recorded = (name) => JSON.parse(fs.readFileSync(path.join(fixtureRoot, `${name}.response.json`), 'utf8'));
const reply = (body, status = 200) => ({ status, headers: { 'content-type': 'application/json' }, body });
const toResponse = (r) => new Response(r.body === null ? null : JSON.stringify(r.body), { status: r.status, headers: r.headers || {} });
const immediateGate = () => ({ async acquire() { return { waitedMs: 0, release() {} }; } });
const updated = (id) => reply({ data: [{ code: 'SUCCESS', details: { id, Modified_Time: '2026-09-02T09:02:00+05:30', Modified_By: { id: FINANCE, name: 'Synthetic Finance' } }, message: 'record updated', status: 'success' }] });

let cred;
before(async () => {
  cred = await userCredential({ access_token: 'synthetic-finance-token-never-live', api_domain: 'https://www.zohoapis.in', expires_in: 3_600 },
    { recordIdPrefix: P, gate: immediateGate(), log: createOpsLog(createMemorySink()), clock: () => NOW,
      fetch: async () => toResponse(recorded('current-user.finance')) });
  assert.equal(cred.userId, FINANCE);
});
const principal = () => ({ credential: cred, sessionId: SESSION });

/** One Zoho behind both services. `o.allotment`: the allotment fixture; `o.mayMatch`: the Finance seat check; `o.put`: the receipt PUT reply. */
function rig(o = {}) {
  const f = { allotment: 'allotment.current', mayMatch: true, ...o };
  const calls = [];
  const events = [];
  const sink = createMemorySink();
  const log = createOpsLog(sink);
  let state = 'Pending';
  const crm = createZohoClient({ recordIdPrefix: P, gate: immediateGate(), log, maxAttempts: 1, clock: () => NOW,
    fetch: async (url, init) => {
      const u = String(url);
      const m = init.method;
      if (u.endsWith('/coql')) {
        const q = JSON.parse(init.body).select_query; calls.push(['coql', q]);
        if (/where Idempotency_Key = /.test(q)) return toResponse(recorded('receipts.empty'));
        if (/where UTR = /.test(q)) return toResponse(recorded('receipts.empty'));
        if (/from LLP_UnitAllocation_Module where Customer = /.test(q)) return toResponse(reply({ data: [{ id: ALLOTMENT, Customer: { id: CUSTOMER } }], info: { more_records: false } }));
        if (/select id, Allotment, Kind, Match_State from Receipts where Allotment in /.test(q)) {
          // the investor's receipts: only the one just recorded (first money)
          return toResponse(reply({ data: [{ id: RECEIPT, Allotment: { id: ALLOTMENT }, Kind: 'Part', Match_State: state }], info: { more_records: false } }));
        }
        if (/from Receipts where Allotment = /.test(q)) return toResponse(recorded('receipts.empty'));
        throw new Error(`unrouted ${q}`);
      }
      if (m === 'GET' && u.includes(`/LLP_UnitAllocation_Module/${ALLOTMENT}`)) { calls.push(['get', 'allotment']); return toResponse(recorded(f.allotment)); }
      if (m === 'POST' && u.endsWith('/Receipts')) { calls.push(['insert', JSON.parse(init.body).data[0]]); return toResponse(recorded('receipt.created')); }
      if (m === 'GET' && u.includes(`/Receipts/${RECEIPT}`)) {
        calls.push(['get', 'receipt']);
        return toResponse(reply({ data: [{ id: RECEIPT, Allotment: { id: ALLOTMENT }, Kind: 'Part', Amount: 2_500_000, Match_State: state,
          Matched_By: state === 'Matched' ? { id: FINANCE } : null, Created_By: { id: FINANCE, name: 'Synthetic Finance' }, Modified_Time: '2026-09-02T09:01:00+05:30' }] }));
      }
      if (m === 'GET' && u.includes(`/Contacts/${CUSTOMER}`)) {
        calls.push(['get', 'contact']);
        return toResponse(reply({ data: [{ id: CUSTOMER, ARL_ID: 'ARL-INV-0230', App_Access: null, App_Account_Mark: null, Modified_Time: '2026-09-01T12:00:00+05:30' }] }));
      }
      if (m === 'PUT') {
        const [, mod, id] = /\/crm\/v8\/([^/]+)\/(\d+)$/.exec(new URL(u).pathname) || [];
        const data = JSON.parse(init.body).data[0];
        calls.push(['put', mod, id, data]);
        if (mod === 'Receipts' && f.put) return toResponse(f.put);
        if (mod === 'Receipts' && data.Match_State === 'Matched') state = 'Matched';
        return toResponse(updated(id));
      }
      throw new Error(`unexpected ${m} ${u}`);
    } });
  const replay = createReceiptReplayService({
    crm, log, recordIdPrefix: P, clock: () => NOW,
    permission: { async recheck() { return true; } }, session: { async recheck() { return true; } },
    idempotencySecret: 'synthetic-receipt-idempotency-secret-0002', contextSigningSecret: 'synthetic-receipt-context-signing-secret-0002',
  });
  const writes = createAllotmentReceiptWrites({ crm, replay, log, recordIdPrefix: P, clock: () => NOW });
  const publish = async (event) => { events.push(event); return { ok: true, eventId: event.event_id }; };
  const match = createReceiptMatch({ crm, writes, publish, log, recordIdPrefix: P, clock: () => NOW,
    authority: { async mayMatch() { return f.mayMatch; }, async mayApproveOutbound() { return false; } } });
  const svc = createRecordReceipt({ replay, writes, log, recordIdPrefix: P, clock: () => NOW, match,
    authority: { async mayRecord() { return true; } } });
  return { svc, match, calls, events, sink, state: () => state };
}
const balance = (over = {}) => ({ allotmentId: ALLOTMENT, kind: 'balance', mode: 'RTGS', ref: 'HDFC2609777', amount: 2_500_000, ...over });

test('D113: Finance records → matched by the recorder; the gate opens through Receipts; first money opens the app account On hold', async () => {
  const r = rig();
  const res = await r.svc.commit(principal(), balance(), KEY);
  assert.equal(res.ok, true, JSON.stringify(res));
  const v = res.value;
  assert.equal(v.state, 'matched');
  assert.equal(v.recordedBy, FINANCE);
  assert.equal(v.matchedBy, FINANCE, 'Finance\'s own approval — no second person');
  assert.equal(v.matchedAt, '2026-09-02T09:02:00+05:30');
  assert.equal(v.matchNote, null);
  // one insert (Pending — the replay key path), then one guarded PUT to Matched with Matched_By = the recorder
  const ins = r.calls.filter((c) => c[0] === 'insert');
  assert.equal(ins.length, 1);
  assert.equal(ins[0][1].Match_State, 'Pending');
  const receiptPuts = r.calls.filter((c) => c[0] === 'put' && c[1] === 'Receipts');
  assert.deepEqual(receiptPuts.map((c) => c.slice(2)), [[RECEIPT, { Match_State: 'Matched', Matched_By: { id: FINANCE }, Matched_At: '2026-09-02T09:02:00+05:30' }]]);
  assert.equal(r.state(), 'Matched');
  // what a match sets moving, exactly as "Match it"
  assert.equal(v.match.gate, 'opens-through-receipts');
  assert.equal(v.match.firstMoney, true);
  assert.equal(v.match.appAccess.value, 'opened-on-hold');
  const contactPuts = r.calls.filter((c) => c[0] === 'put' && c[1] === 'Contacts');
  assert.equal(contactPuts.length, 1);
  assert.equal(contactPuts[0][3].App_Access, 'Hold', 'D93: the account opens On hold — no Invite, no welcome');
  assert.deepEqual(r.events.map((e) => e.type).sort(), ['account.opened', 'money.confirmed']);
  assert.equal(r.events.find((e) => e.type === 'money.confirmed').payload.matched_by, FINANCE);
  assert.ok(!JSON.stringify(r.sink.records()).includes('HDFC2609777'), 'the bank reference is never logged');
});

test('D113 + rule 3: unsigned paper — recorded, never refused, left Pending with the note; no match is tried', async () => {
  const r = rig({ allotment: 'allotment.unsigned' });
  const res = await r.svc.commit(principal(), balance({ amount: undefined, ref: 'HDFC2708994', receivedOn: '2026-08-28' }), KEY);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.value.state, 'unmatched');
  assert.equal(res.value.matchedBy, null);
  assert.equal(res.value.matchNote, MATCH_BLOCKED_TEXT);
  assert.equal(r.calls.filter((c) => c[0] === 'put').length, 0);
  assert.equal(r.events.length, 0);
});

test('D113: when the match does not land the receipt stays recorded and Pending, and the answer says to press Match it', async () => {
  const r = rig({ put: reply({ code: 'INTERNAL_ERROR', message: 'synthetic', status: 'error', details: {} }, 500) });
  const res = await r.svc.commit(principal(), balance(), KEY);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.value.state, 'unmatched');
  assert.equal(res.value.matchNote, NOT_MATCHED_YET_TEXT);
  assert.equal(r.state(), 'Pending');
  assert.equal(r.events.length, 0);
  assert.ok(r.sink.records().some((x) => x.action === 'record-receipt' && /^not-matched\./.test(x.reason)));
  // Finance then confirms it by hand — the recorder may match her own receipt
  const r2 = rig();
  await r2.svc.commit(principal(), balance(), KEY);
  assert.equal(r2.state(), 'Matched');
});
