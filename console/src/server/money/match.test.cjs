/* M10-S02-T02 / T04 — "Match it" (the second hand) and its consequences; contract tests for money.confirmed and
 * account.opened against contracts/*.json and the envelope.
 *
 * Run from console/: node --test src/server/money/match.test.cjs
 * Real Zoho client over recorded synthetic replies (__fixtures__/match/*). No request reaches Zoho.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { before, test } = require('node:test');

const consoleRoot = path.resolve(__dirname, '..', '..', '..');
const srcRoot = path.join(consoleRoot, 'src');
const fixtureRoot = path.join(srcRoot, 'lib', 'zoho', '__fixtures__', 'match');
const contractsDir = path.resolve(consoleRoot, '..', 'contracts');
const ts = require(path.join(consoleRoot, 'node_modules', 'typescript'));
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoho-match-'));
process.on('exit', () => fs.rmSync(outDir, { recursive: true, force: true }));

const config = ts.readConfigFile(path.join(consoleRoot, 'tsconfig.json'), ts.sys.readFile);
const project = ts.parseJsonConfigFileContent(config.config, ts.sys, consoleRoot);
const options = { ...project.options, incremental: false, tsBuildInfoFile: undefined, plugins: undefined,
  module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10, noEmit: false, noEmitOnError: true, outDir, rootDir: srcRoot };
const sources = ['lib/zoho/errors.ts', 'lib/zoho/gate.ts', 'lib/zoho/log.ts', 'lib/zoho/client.ts', 'server/money/receipt-replay.ts',
  'server/money/allotment-receipts.ts', 'server/money/match.ts', 'server/contracts/events.ts', 'server/contracts/outbox.ts', 'server/contracts/stub.ts']
  .map((f) => path.join(srcRoot, f));
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
const { createReceiptMatch, holdUntilFrom, factEventId, SAME_HAND_TEXT } = load('server/money/match.js');
const { validateEvent } = load('server/contracts/events.js');
const { createOutbox, identityPaths } = load('server/contracts/outbox.js');
const { loadSchemas, createInProcessStub } = load('server/contracts/stub.js');

const P = '9007199254';
const HEAD = '9007199254740994090', MEENA = '9007199254740994091';
const A = '9007199254740994001', C = '9007199254740994002', R = '9007199254740994049';
const A2 = '9007199254740994011', C2 = '9007199254740994012', RADV = '9007199254740994048';
const SESSION = 'session_fixture_00000009';
const NOW = Date.parse('2026-09-02T09:02:00+05:30');
const SECRETS = ['Synthetic Meena Recorder', 'Synthetic Fixture Investor', 'fixture.investor@example.invalid', 'synthetic.user@example.invalid',
  'ABCDE1234F', 'HDFC2708994', 'HDFC2609001', 'synthetic-user-access-token'];
const schemas = loadSchemas(contractsDir);
const recorded = (name) => JSON.parse(fs.readFileSync(path.join(fixtureRoot, `${name}.response.json`), 'utf8'));
const toResponse = (r) => new Response(r.body === null ? null : JSON.stringify(r.body), { status: r.status, headers: r.headers || {} });
const immediateGate = () => ({ async acquire() { return { waitedMs: 0, release() {} }; } });
const noSecrets = (value, extra = []) => { const s = JSON.stringify(value); for (const x of [...SECRETS, ...extra]) assert.ok(!s.includes(x), `leaked ${x}`); };

let cred;
before(async () => {
  cred = await userCredential({ access_token: 'synthetic-user-access-token-never-live', api_domain: 'https://www.zohoapis.in', expires_in: 3_600 },
    { recordIdPrefix: P, gate: immediateGate(), log: createOpsLog(createMemorySink()), clock: () => NOW,
      fetch: async () => toResponse(recorded('current-user.head')) });
  assert.equal(cred.userId, HEAD);
});
const principal = () => ({ credential: cred, sessionId: SESSION });

/** Real client over recorded replies. `f` names the fixture for each kind of call. */
function rig(f = {}, opts = {}) {
  const sink = createMemorySink();
  const log = createOpsLog(sink);
  const calls = [];
  const events = [];
  const crm = createZohoClient({ recordIdPrefix: P, gate: immediateGate(), log, maxAttempts: 1, clock: () => opts.now ?? NOW,
    fetch: async (url, init) => {
      const u = new URL(String(url));
      const m = init.method;
      if (u.pathname.endsWith('/coql')) {
        const q = JSON.parse(init.body).select_query; calls.push(['coql', q]);
        if (/from LLP_UnitAllocation_Module where Customer = /.test(q)) return toResponse(recorded(f.investorAllotments ?? 'allotments.investor'));
        if (/from Receipts where Allotment in /.test(q)) return toResponse(recorded(f.investorReceipts ?? 'receipts.balance-after-match'));
        if (/from Receipts where Allotment = /.test(q)) return toResponse(recorded(f.allotmentReceipts ?? 'receipts.balance-after-match'));
        throw new Error(`unexpected query ${q}`);
      }
      const [, mod, id] = /\/crm\/v8\/([^/]+)\/(\d+)$/.exec(u.pathname) || [];
      if (m === 'GET' && mod === 'Receipts') { calls.push(['get', mod, id]); return toResponse(recorded(f.receipt ?? 'receipt.pending-balance')); }
      if (m === 'GET' && mod === 'LLP_UnitAllocation_Module') { calls.push(['get', mod, id]); return toResponse(recorded(f.allotment ?? 'allotment.reserved')); }
      if (m === 'GET' && mod === 'Contacts') { calls.push(['get', mod, id]); return toResponse(recorded(f.contact ?? 'contact.no-app')); }
      if (m === 'PUT') {
        const h = new Headers(init.headers);
        calls.push(['put', mod, id, JSON.parse(init.body).data[0], h.get('If-Unmodified-Since')]);
        const name = mod === 'Receipts' ? (f.put ?? 'receipt.updated') : mod === 'Contacts' ? 'contact.updated' : 'allotment.updated';
        return toResponse(recorded(name));
      }
      throw new Error(`unexpected call ${m} ${u.pathname}`);
    } });
  const replay = createReceiptReplayService({ crm, log, recordIdPrefix: P, clock: () => NOW,
    permission: { async recheck() { return false; } }, session: { async recheck() { return false; } },
    idempotencySecret: 'synthetic-receipt-idempotency-secret-0009', contextSigningSecret: 'synthetic-receipt-context-signing-secret-0009' });
  const writes = createAllotmentReceiptWrites({ crm, replay, log, recordIdPrefix: P, clock: () => NOW });
  const publish = opts.publish ?? (async (event) => { events.push(event); const v = validateEvent(schemas, event); return v.ok ? { ok: true, eventId: event.event_id } : { ok: false, reason: v.reason, errors: v.errors }; });
  const svc = createReceiptMatch({ crm, writes, publish, log, recordIdPrefix: P, clock: () => opts.now ?? NOW,
    authority: { async mayMatch() { return opts.mayMatch ?? true; } } });
  return { svc, calls, events, sink };
}
const puts = (calls) => calls.filter((c) => c[0] === 'put');

test('the Head of Finance matches Meena\'s pending balance: one guarded PUT, money.confirmed, Payment_Status recomputed', async () => {
  const r = rig();
  const res = await r.svc.match(principal(), R, { expectedModifiedTime: '2026-09-02T08:00:00+05:30' });
  assert.equal(res.ok, true, JSON.stringify(res));
  const v = res.value;
  assert.equal(v.state, 'matched');
  assert.equal(v.duplicate, false);
  assert.equal(v.matchedBy, HEAD);
  assert.equal(v.matchedAt, '2026-09-02T09:02:00+05:30');
  assert.equal(v.gate, 'opens-through-receipts');
  const p = puts(r.calls);
  assert.equal(p.length, 1, 'only the receipt is written: not the first money, not an advance');
  assert.deepEqual(p[0].slice(1, 4), ['Receipts', R, { Match_State: 'Matched', Matched_By: { id: HEAD } }]);
  assert.equal(p[0][4], '2026-09-02T08:00:00+05:30', 'If-Unmodified-Since is the receipt as it was read (D44)');
  // banked to date rises by ₹22.5 L: 2.5 L before → 25 L after; Zoho's workflow value is absent, so computed.
  assert.equal(v.paymentStatus.receivedRupees, 2_500_000);
  assert.equal(v.paymentStatus.expected, 'Full');
  assert.equal(v.paymentStatus.source, 'computed');
  assert.equal(v.firstMoney, false);
  assert.equal(v.accountOpened, null);
  assert.equal(v.hold.value, null);
  assert.equal(r.events.length, 1);
  const e = r.events[0];
  assert.equal(e.type, 'money.confirmed');
  assert.deepEqual(e.payload, { kind: 'balance', amount: 2_250_000, at: '2026-09-02T09:02:00+05:30', matched_by: HEAD, receipt_id: R });
  assert.deepEqual(e.ids, { investor_contact_id: C });
  assert.equal(e.event_id, factEventId(`money.confirmed:${R}`));
  assert.deepEqual(v.moneyConfirmed, { ok: true, eventId: e.event_id });
  noSecrets(r.sink.records());
  noSecrets(e);
});

test('the recorder cannot match her own receipt: refused before any write, with the prototype\'s words', async () => {
  const r = rig({ receipt: 'receipt.pending-own' });
  const res = await r.svc.match(principal(), R);
  assert.equal(res.ok, false);
  assert.equal(res.reasonCode, 'same-hand');
  assert.equal(res.message, SAME_HAND_TEXT);
  assert.match(res.message, /matched by someone other than the person who recorded it/);
  assert.equal(puts(r.calls).length, 0);
  assert.equal(r.events.length, 0);
  assert.deepEqual(r.sink.records().filter((x) => x.kind === 'refusal').map((x) => [x.action, x.reason]), [['receipt-match', 'same-hand']]);
});

test('Zoho\'s validation rule refusing Matched_By (TC-IM05-024) is answered as the same hand; nothing follows', async () => {
  const r = rig({ put: 'receipt.validation-matched-by' });
  const res = await r.svc.match(principal(), R);
  assert.equal(res.ok, false);
  assert.equal(res.reasonCode, 'same-hand');
  assert.equal(r.events.length, 0);
  assert.equal(puts(r.calls).length, 1);
  noSecrets(r.sink.records());
});

test('a seat that is not the Head of Finance or the super user is refused before Zoho is asked', async () => {
  const r = rig({}, { mayMatch: false });
  const res = await r.svc.match(principal(), R);
  assert.equal(res.reasonCode, 'not-matcher');
  assert.match(res.message, /Waiting for the Head of Finance/);
  assert.equal(r.calls.length, 0);
});

test('a 412 is "changed, reload"; a stale page is refused before the PUT; a report is not a receipt', async () => {
  let r = rig({ put: 'receipt.conflict-412' });
  assert.equal((await r.svc.match(principal(), R)).reasonCode, 'receipt-changed');
  assert.equal(r.events.length, 0);
  r = rig();
  assert.equal((await r.svc.match(principal(), R, { expectedModifiedTime: '2026-09-01T08:00:00+05:30' })).reasonCode, 'receipt-changed');
  assert.equal(puts(r.calls).length, 0);
  r = rig({ receipt: 'receipt.claimed' });
  assert.equal((await r.svc.match(principal(), R)).reasonCode, 'is-claim');
  assert.equal(puts(r.calls).length, 0);
});

test('inbound money on an unverified supplementary is not matched', async () => {
  const r = rig({ allotment: 'allotment.unverified' });
  const res = await r.svc.match(principal(), R);
  assert.equal(res.reasonCode, 'supplementary-not-verified');
  assert.equal(puts(r.calls).length, 0);
});

test('an investor\'s first matched money: account.opened tentative, App_Access opened on Hold, the advance starts the hold 30 days out', async () => {
  const r = rig({ receipt: 'receipt.pending-advance', allotment: 'allotment.first-advance', investorAllotments: 'allotments.investor-first',
    investorReceipts: 'receipts.first-advance', allotmentReceipts: 'receipts.first-advance' });
  const res = await r.svc.match(principal(), RADV);
  assert.equal(res.ok, true, JSON.stringify(res));
  const v = res.value;
  assert.equal(v.firstMoney, true);
  assert.deepEqual(v.appAccess, { ok: true, value: 'opened-on-hold', code: null });
  assert.deepEqual(v.hold, { ok: true, value: { until: '2026-10-02', written: true }, code: null });
  const p = puts(r.calls);
  assert.deepEqual(p.map((c) => [c[1], c[3]]), [
    ['Receipts', { Match_State: 'Matched', Matched_By: { id: HEAD } }],
    ['Contacts', { App_Access: 'Hold' }],
    ['LLP_UnitAllocation_Module', { Hold_Until: '2026-10-02' }],
  ]);
  assert.equal(p[1][4], '2026-09-01T12:00:00+05:30');
  assert.equal(p[2][4], '2026-09-02T07:00:00+05:30');
  assert.deepEqual(r.events.map((e) => e.type), ['money.confirmed', 'account.opened']);
  const opened = r.events[1];
  assert.deepEqual(opened.payload, { arl_code: 'ARL-INV-0212', at: '2026-09-02T09:02:00+05:30', state: 'tentative' });
  assert.deepEqual(opened.ids, { investor_contact_id: C2, arl_code: 'ARL-INV-0212' });
  assert.equal(opened.event_id, factEventId(`account.opened:${C2}`));
  assert.equal(r.events[0].payload.kind, 'advance');
  noSecrets(r.sink.records());
  noSecrets(r.events);
});

test('the hold is one IST function: a match at 01:30 IST counts from the IST day, and never shortens a hold', () => {
  assert.equal(holdUntilFrom(Date.parse('2026-09-01T20:00:00Z')), '2026-10-02', '01:30 IST on 2 Sep');
  assert.equal(holdUntilFrom(Date.parse('2026-09-01T18:00:00Z')), '2026-10-01', '23:30 IST on 1 Sep');
  assert.equal(holdUntilFrom(Date.parse('2026-12-15T06:00:00Z')), '2027-01-14');
});

test('a longer hold already on the allotment is kept (nothing written on the allotment)', async () => {
  const r = rig({ receipt: 'receipt.pending-advance', allotment: 'allotment.first-advance-long-hold', investorAllotments: 'allotments.investor-first',
    investorReceipts: 'receipts.first-advance', allotmentReceipts: 'receipts.first-advance' });
  const res = await r.svc.match(principal(), RADV);
  assert.equal(res.ok, true);
  assert.deepEqual(res.value.hold, { ok: true, value: { until: '2026-11-30', written: false }, code: null });
  assert.equal(puts(r.calls).filter((c) => c[1] === 'LLP_UnitAllocation_Module').length, 0);
});

test('pressing again on a matched receipt re-runs the consequences with the same event ids and writes nothing new on the receipt', async () => {
  const first = rig();
  const a = await first.svc.match(principal(), R);
  const again = rig({ receipt: 'receipt.matched' });
  const b = await again.svc.match(principal(), R);
  assert.equal(b.ok, true);
  assert.equal(b.value.duplicate, true);
  assert.equal(puts(again.calls).length, 0);
  assert.equal(again.events[0].event_id, first.events[0].event_id);
  assert.deepEqual(again.events[0].payload, first.events[0].payload, 'the fact\'s time, not the retry\'s');
  assert.equal(a.value.matchedAt, b.value.matchedAt);
});

test('a failed push never un-does the match: the answer says the event did not leave', async () => {
  const r = rig({}, { publish: async () => ({ ok: false, reason: 'queue-full', errors: [] }) });
  const res = await r.svc.match(principal(), R);
  assert.equal(res.ok, true);
  assert.deepEqual(res.value.moneyConfirmed, { ok: false, reason: 'queue-full', errors: [] });
  assert.equal(puts(r.calls).length, 1);
});

/* ---- T04 contract tests ------------------------------------------------------------------------ */

test('T04: every emitted money.confirmed / account.opened validates against contracts/*.json and the envelope, and carries no identity value', async () => {
  const r = rig({ receipt: 'receipt.pending-advance', allotment: 'allotment.first-advance', investorAllotments: 'allotments.investor-first',
    investorReceipts: 'receipts.first-advance', allotmentReceipts: 'receipts.first-advance' });
  await r.svc.match(principal(), RADV);
  const r2 = rig();
  await r2.svc.match(principal(), R);
  const all = [...r.events, ...r2.events];
  assert.deepEqual(all.map((e) => e.type).sort(), ['account.opened', 'money.confirmed', 'money.confirmed']);
  for (const e of all) {
    assert.deepEqual(validateEvent(schemas, e), { ok: true, type: e.type }, e.type);
    assert.deepEqual(identityPaths({ ...e, event_id: undefined, occurred_at: undefined }), [], `${e.type} carries no identity value`);
    assert.match(e.occurred_at, /\+05:30$/);
    assert.equal(e.origin, 'console');
    assert.equal(e.schema_version, 1);
  }
  // The schemas bite: a float amount, a string amount, an unknown kind, a missing state, an extra field, a bad code.
  const mc = r2.events[0];
  for (const bad of [{ amount: 2250000.5 }, { amount: '2250000' }, { kind: 'part' }, { extra: 1 }]) {
    assert.equal(validateEvent(schemas, { ...mc, payload: { ...mc.payload, ...bad } }).ok, false, JSON.stringify(bad));
  }
  const ao = r.events[1];
  const { state, ...noState } = ao.payload;
  assert.equal(validateEvent(schemas, { ...ao, payload: noState }).ok, false);
  assert.equal(validateEvent(schemas, { ...ao, payload: { ...ao.payload, arl_code: 'ARL-0212' } }).ok, false);
  assert.equal(validateEvent(schemas, { ...ao, payload: { ...ao.payload, state: 'open' } }).ok, false);
  const { actor, ...noActor } = mc;
  assert.equal(validateEvent(schemas, noActor).ok, false, 'the envelope is required');
  // Why the bank reference is left out: the outbox refuses an event carrying one.
  assert.notDeepEqual(identityPaths({ ...mc.payload, utr: 'UTIBR52026090200001234' }), []);
  assert.equal('utr' in mc.payload, false, 'the bank reference never leaves the console');
});

test('T04: the events go through the signed outbox to the stub receiver and are delivered once', async () => {
  const keys = ['synthetic-contract-signing-key-0000000000000009'];
  const stub = createInProcessStub({ schemas, keys, accepts: ['money.confirmed', 'account.opened', 'money.not_found'] });
  const outbox = createOutbox({ schemas, target: () => ({ url: 'stub://investor-app/events', key: keys[0] }), fetch: stub.fetch, clock: () => NOW });
  const publish = async (event) => { const q = outbox.enqueue(event); if (!q.ok) return q; await outbox.drain(); return { ok: true, eventId: q.eventId, state: outbox.state(q.eventId) }; };
  const r = rig({ receipt: 'receipt.pending-advance', allotment: 'allotment.first-advance', investorAllotments: 'allotments.investor-first',
    investorReceipts: 'receipts.first-advance', allotmentReceipts: 'receipts.first-advance' }, { publish });
  const res = await r.svc.match(principal(), RADV);
  assert.equal(res.value.moneyConfirmed.state.status, 'delivered');
  assert.equal(res.value.accountOpened.state.status, 'delivered');
  const again = rig({ receipt: 'receipt.matched' }, { publish });
  await again.svc.match(principal(), R);
  await again.svc.match(principal(), R);
  const types = stub.recorded().map((e) => e.type);
  assert.deepEqual(types, ['money.confirmed', 'account.opened', 'money.confirmed'], 'a retried event is applied once');
});
