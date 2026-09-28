/* M08-S03-T01 — the IR's payment report (a Claimed receipt, D82), over recorded Zoho replies.
 *
 * Run from console/: timeout 170 node --test src/server/leads/claim.test.cjs
 *
 * Compiles the real client, the real gates and claim.ts (which imports the front end's claimFieldsError) with the
 * project's TypeScript and replays synthetic fixtures (__fixtures__/claims/*). No request reaches Zoho.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { before, test } = require('node:test');

const consoleRoot = path.resolve(__dirname, '..', '..', '..');
const srcRoot = path.join(consoleRoot, 'src');
const fixtures = path.join(srcRoot, 'lib', 'zoho', '__fixtures__', 'claims');
const ts = require(path.join(consoleRoot, 'node_modules', 'typescript'));
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leads-claim-'));
process.on('exit', () => fs.rmSync(outDir, { recursive: true, force: true }));

const config = ts.readConfigFile(path.join(consoleRoot, 'tsconfig.json'), ts.sys.readFile);
const project = ts.parseJsonConfigFileContent(config.config, ts.sys, consoleRoot);
const options = { ...project.options, incremental: false, tsBuildInfoFile: undefined, plugins: undefined,
  module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10, noEmit: false, noEmitOnError: true, outDir, rootDir: consoleRoot };
const sources = ['src/lib/zoho/log.ts', 'src/lib/zoho/client.ts', 'src/server/leads/gates.ts', 'src/server/leads/claim.ts'].map((f) => path.join(consoleRoot, f));
const program = ts.createProgram(sources, options);
const diagnostics = [...ts.getPreEmitDiagnostics(program), ...program.emit().diagnostics];
if (diagnostics.length) {
  console.error(ts.formatDiagnostics(diagnostics, { getCanonicalFileName: (f) => f, getCurrentDirectory: () => consoleRoot, getNewLine: () => '\n' }));
  process.exit(1);
}
process.env.NODE_PATH = path.join(consoleRoot, 'node_modules');
Module._initPaths();
const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  return resolveFilename.call(this, request.startsWith('@/') ? path.join(outDir, 'src', request.slice(2)) : request, ...rest);
};
const load = (f) => require(path.join(outDir, 'src', f));
const { createMemorySink, createOpsLog } = load('lib/zoho/log.js');
const { createZohoClient, userCredential } = load('lib/zoho/client.js');
const { createGates } = load('server/leads/gates.js');
const { createPaymentClaims, maskRef, CLAIM_WAITING_TEXT, CLAIM_ROW_TEXT } = load('server/leads/claim.js');

const P = '9007199254';
const IR = `${P}740995001`, L7 = `${P}740997007`, A = `${P}740997201`, A2 = `${P}740997202`, R = `${P}740997301`;
const SESSION = 'session_fixture_claim_0001';
const NOW = Date.parse('2026-08-29T10:00:00+05:30');
const REF = 'EMIR2708001';

const recorded = (name) => JSON.parse(fs.readFileSync(path.join(fixtures, `${name}.response.json`), 'utf8'));
const toResponse = (r) => new Response(r.status === 204 ? null : JSON.stringify(r.body), { status: r.status, headers: r.headers || {} });
const immediateGate = () => ({ async acquire() { return { waitedMs: 0, release() {} }; } });

let cred;
before(async () => {
  cred = await userCredential({ access_token: 'synthetic-ir-token-never-live', api_domain: 'https://www.zohoapis.in', expires_in: 3_600 },
    { recordIdPrefix: P, gate: immediateGate(), log: createOpsLog(createMemorySink()), clock: () => NOW,
      fetch: async () => toResponse(recorded('current-user.ir')) });
  assert.equal(cred.userId, IR);
});
const principal = () => ({ credential: cred, sessionId: SESSION });
const access = { async recheck(c) {
  return { actor: { userId: c.userId, roleId: '', profileId: '', seat: 'investor-relations' }, mayViewLeads: true,
    teamOwnerIds: null, teamOrgWide: false, unassignedQueueUserId: null, seesUnassignedInPersonal: true };
} };

/** A client on recorded replies. `o` names the fixture for each read; every call is kept. */
function rig(o = {}) {
  const f = { lead: 'lead.reserved', allotments: 'allotments.verified', receipts: 'receipts.advance-matched', claims: 'claims.none',
    readBack: 'claims.open', insert: 'claim.created', ...o };
  const calls = [];
  const sink = createMemorySink();
  const log = createOpsLog(sink);
  const crm = createZohoClient({ recordIdPrefix: P, gate: immediateGate(), log, maxAttempts: 1, clock: () => NOW,
    fetch: async (url, init) => {
      const u = String(url);
      if (u.endsWith('/coql')) {
        const q = JSON.parse(init.body).select_query; calls.push({ op: 'coql', q });
        if (q.includes('from Contacts')) return toResponse(recorded('contacts.one'));
        if (q.includes('from LLP_UnitAllocation_Module')) return toResponse(recorded(f.allotments));
        if (q.includes('where UTR like')) return toResponse(recorded(f.claims));
        if (q.includes('where UTR =')) return toResponse(recorded(f.readBack));
        if (q.includes('from Receipts where Allotment in')) return toResponse(recorded(f.receipts));
        throw new Error(`unrouted ${q}`);
      }
      if (init.method === 'GET' && u.includes(`/Leads/${L7}`)) { calls.push({ op: 'getLead' }); return toResponse(recorded(f.lead)); }
      if (init.method === 'POST' && u.endsWith('/Receipts')) {
        calls.push({ op: 'insert', data: JSON.parse(init.body).data });
        await new Promise((r) => setTimeout(r, 5));
        return toResponse(recorded(f.insert));
      }
      calls.push({ op: init.method, u });
      throw new Error(`unexpected ${init.method} ${u}`);
    } });
  const gates = createGates({ crm, access, log, recordIdPrefix: P, clock: () => NOW });
  const svc = createPaymentClaims({ crm, gates, log, recordIdPrefix: P, clock: () => NOW,
    authority: { async mayReport() { return o.mayReport ?? true; } } });
  return { svc, calls, sink, inserts: () => calls.filter((c) => c.op === 'insert') };
}
const body = (over = {}) => ({ kind: 'balance', mode: 'SWIFT', amount: '1500000', said_on: '2026-08-27', ref: REF, ...over });
const noRef = (r) => {
  const logged = r.sink.records();
  assert.ok(logged.length > 0, 'the calls are logged');
  const s = JSON.stringify([r.calls.filter((c) => c.op !== 'insert'), logged]);
  assert.ok(!s.includes(REF) && !s.includes('8001'), 'no part of the reference reaches a log or a read');
};

test('TC-E08-011: a balance report writes one Claimed receipt, the stage does not move, the answer is masked', async () => {
  const r = rig();
  const res = await r.svc.report(principal(), L7, body());
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.deepEqual(res.value, { leadId: L7, claimId: R, allotmentId: A, state: 'waiting', kind: 'balance', mode: 'SWIFT', amountRupees: 1500000,
    saidOn: '2026-08-27', ref: '••••8001', says: CLAIM_WAITING_TEXT, row: CLAIM_ROW_TEXT, duplicate: false });
  assert.equal(CLAIM_WAITING_TEXT, 'Payment reported — waiting for Finance to find it in the bank.');
  const ins = r.inserts();
  assert.equal(ins.length, 1, 'exactly one record');
  const [row] = ins[0].data;
  assert.deepEqual({ ...row, Note: undefined }, { Allotment: { id: A }, Kind: 'Part', Amount: 1500000, Mode: 'SWIFT', UTR: `CLAIM-${L7}-1`,
    Received_On: '2026-08-27T00:00:00+05:30', Match_State: 'Claimed', Note: undefined });
  assert.match(row.Note, /••••8001/);
  assert.ok(!JSON.stringify(ins).includes(REF), 'the full reference is never stored');
  assert.ok(!r.calls.some((c) => c.op !== 'insert' && c.op !== 'coql' && c.op !== 'getLead'), 'the lead is never written');
  noRef(r);
});

test('TC-E08-012: a zero or non-numeric amount is refused in claimFieldsError\'s words and nothing is asked of Zoho', async () => {
  for (const amount of ['0', 'abc', '', '-5', '12.345']) {
    const r = rig();
    const res = await r.svc.report(principal(), L7, body({ amount }));
    assert.equal(res.ok, false);
    assert.equal(res.reasonCode, 'fields');
    assert.equal(res.message, 'Enter the amount the investor reported, greater than zero, with at most two decimal places.');
    assert.equal(r.calls.length, 0);
  }
});

test('TC-E08-013: a future payment date is refused (today in IST is the limit)', async () => {
  const r = rig();
  const res = await r.svc.report(principal(), L7, body({ said_on: '2026-08-30', amount: '100000' }));
  assert.equal(res.reasonCode, 'fields');
  assert.equal(res.message, 'Choose the actual payment date, today or earlier.');
  assert.equal(r.calls.length, 0);
  const today = await rig().svc.report(principal(), L7, body({ said_on: '2026-08-29' }));
  assert.equal(today.ok, true, 'today is allowed');
  const bad = await rig().svc.report(principal(), L7, body({ said_on: '2026-02-30' }));
  assert.equal(bad.reasonCode, 'fields', 'an impossible date is refused');
});

test('the other field rules: kind, method, reference shape, paise', async () => {
  assert.equal((await rig().svc.report(principal(), L7, body({ kind: 'refund' }))).message, 'Choose what the payment was for.');
  assert.equal((await rig().svc.report(principal(), L7, body({ mode: 'UPI' }))).message, 'Choose a payment method.');
  assert.match((await rig().svc.report(principal(), L7, body({ ref: 'x' }))).message, /^Use 3–64 letters/);
  const paise = await rig().svc.report(principal(), L7, body({ amount: '1500.50' }));
  assert.equal(paise.reasonCode, 'whole-rupees', 'the ledger holds whole rupees');
  const none = await rig().svc.report(principal(), L7, body({ ref: '' }));
  assert.equal(none.ok, true);
  assert.equal(none.value.ref, null);
});

test('TC-E08-014: with a report already waiting, a second one is refused and nothing is written', async () => {
  const r = rig({ receipts: 'receipts.claimed-open', claims: 'claims.open-other' });
  const res = await r.svc.report(principal(), L7, body());
  assert.equal(res.reasonCode, 'already-waiting');
  assert.equal(r.inserts().length, 0);
});

test('double press: two presses at once write exactly one record; a later retry answers with the same record', async () => {
  const r = rig();
  const [a, b] = await Promise.all([r.svc.report(principal(), L7, body()), r.svc.report(principal(), L7, body())]);
  assert.equal(a.ok && b.ok, true);
  assert.equal(a.value.claimId, b.value.claimId);
  assert.equal(r.inserts().length, 1);
  const other = rig();
  const [x, y] = await Promise.all([other.svc.report(principal(), L7, body()), other.svc.report(principal(), L7, body({ amount: '900000' }))]);
  assert.equal(x.ok, true);
  assert.equal(y.reasonCode, 'in-progress', 'a different report waits its turn');
  const retry = rig({ receipts: 'receipts.claimed-open', claims: 'claims.open' });
  const again = await retry.svc.report(principal(), L7, body());
  assert.equal(again.ok, true);
  assert.equal(again.value.duplicate, true);
  assert.equal(retry.inserts().length, 0);
});

test('a dropped connection that raced past the guard: Zoho\'s unique key refuses the second insert and the first is read back', async () => {
  const r = rig({ insert: 'claim.duplicate-207' });
  const res = await r.svc.report(principal(), L7, body());
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.value.duplicate, true);
  assert.equal(res.value.claimId, R);
  assert.ok(r.calls.some((c) => c.q && c.q.includes(`where UTR = 'CLAIM-${L7}-1'`)));
  const lost = rig({ insert: 'source.server-error', readBack: 'claims.none' });
  const fail = await lost.svc.report(principal(), L7, body());
  assert.equal(fail.ok, false);
  assert.match(fail.message, /^Not saved yet/);
});

test('after Finance could not find it, the IR may ask again: a new claim key', async () => {
  const r = rig({ claims: 'claims.not-found' });
  const res = await r.svc.report(principal(), L7, body());
  assert.equal(res.ok, true);
  assert.equal(r.inserts()[0].data[0].UTR, `CLAIM-${L7}-2`);
});

test('the lead\'s state: lost, fully paid, not yet said yes, supplementary not verified, no allotment — refused, nothing written', async () => {
  const cases = [[{ lead: 'lead.lost' }, 'lost'], [{ lead: 'lead.paid' }, 'already-paid'], [{ lead: 'lead.early' }, 'not-converted'],
    [{ allotments: 'allotments.unverified' }, 'supplementary-not-verified'], [{ receipts: 'receipts.full-matched' }, 'already-paid'],
    [{ allotments: 'allotments.cancelled' }, 'supplementary-not-verified']];
  for (const [o, code] of cases) {
    const r = rig(o);
    const res = await r.svc.report(principal(), L7, body());
    assert.equal(res.reasonCode, code, JSON.stringify(o));
    assert.equal(r.inserts().length, 0);
  }
});

test('two live allotments: the report names one of them', async () => {
  const r = rig({ allotments: 'allotments.two' });
  assert.equal((await r.svc.report(principal(), L7, body())).reasonCode, 'allotment-required');
  const ok = await r.svc.report(principal(), L7, body({ allotmentId: A2 }));
  assert.equal(ok.ok, true);
  assert.deepEqual(r.inserts()[0].data[0].Allotment, { id: A2 });
  assert.equal((await rig({ allotments: 'allotments.two' }).svc.report(principal(), L7, body({ allotmentId: `${P}740997299` }))).reasonCode, 'allotment-required');
});

test('a person who may not report is refused before Zoho is asked', async () => {
  const r = rig({ mayReport: false });
  const res = await r.svc.report(principal(), L7, body());
  assert.equal(res.reasonCode, 'capability-missing');
  assert.equal(r.calls.length, 0);
  assert.equal((await rig().svc.report(principal(), 'not-an-id', body())).reasonCode, 'invalid-request');
});

test('maskRef keeps the last four only', () => {
  assert.equal(maskRef('EMIR 2708 001'), '••••8001');
  assert.equal(maskRef('AB1'), '••••');
  assert.equal(maskRef(''), null);
});
