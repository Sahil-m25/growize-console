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
  const contactPuts = [...(f.contactPuts ?? [])];
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
        const name = mod === 'Receipts' ? (f.put ?? 'receipt.updated') : mod === 'Contacts' ? (contactPuts.shift() ?? 'contact.updated') : 'allotment.updated';
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
    ['Contacts', { App_Access: 'Hold', App_Account_Mark: 'Tentative', App_Mark_At: '2026-09-02T09:02:00+05:30' }],
    ['LLP_UnitAllocation_Module', { Hold_Until: '2026-10-02' }],
  ]);
  assert.equal(p[1][4], '2026-09-01T12:00:00+05:30');
  assert.equal(p[2][4], '2026-09-02T07:00:00+05:30');
  assert.deepEqual(r.events.map((e) => e.type), ['money.confirmed', 'account.opened', 'hold.changed']);
  const held = r.events[2];
  assert.deepEqual(held.payload, { deadline: '2026-10-02T23:59:59+05:30', state: 'open', by: HEAD }, 'TC-IM05-028: the hold opens on the investor app');
  assert.deepEqual(held.ids, { investor_contact_id: C2 });
  assert.equal(held.event_id, factEventId(`hold.changed:${A2}:open:2026-10-02`));
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
  assert.deepEqual(all.map((e) => e.type).sort(), ['account.opened', 'hold.changed', 'money.confirmed', 'money.confirmed']);
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
  const stub = createInProcessStub({ schemas, keys, accepts: ['money.confirmed', 'account.opened', 'money.not_found', 'hold.changed'] });
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
  assert.deepEqual(types, ['money.confirmed', 'account.opened', 'hold.changed', 'money.confirmed'], 'a retried event is applied once');
});

/* ---- M08-S08-T02: open on match, not on record ------------------------------------------------------ */

const FIRST = { receipt: 'receipt.pending-advance', allotment: 'allotment.first-advance', investorAllotments: 'allotments.investor-first',
  investorReceipts: 'receipts.first-advance', allotmentReceipts: 'receipts.first-advance' };

test('M08-S08: the first matched advance opens the account On hold AND tentative in one guarded Contacts write; no welcome, no Invite', async () => {
  const r = rig(FIRST);
  const res = await r.svc.match(principal(), RADV);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.deepEqual(res.value.appAccess, { ok: true, value: 'opened-on-hold', code: null });
  assert.deepEqual(res.value.appMark, { ok: true, value: 'tentative-set', code: null });
  const contact = puts(r.calls).filter((c) => c[1] === 'Contacts');
  assert.equal(contact.length, 1, 'one write on the Contact');
  assert.equal(contact[0][4], '2026-09-01T12:00:00+05:30', 'guarded on the Contact as read (D44)');
  assert.equal('App_Mark_By' in contact[0][3], false, 'App_Mark_By stays empty: the system set it');
  const s = JSON.stringify(r.calls);
  assert.ok(!s.includes('Invite'), 'the welcome waits for "Send welcome and unlock" (D93)');
  assert.ok(!/Welcome/.test(s), 'the console never writes App_Welcome_*');
  assert.deepEqual(r.events.map((e) => e.type), ['money.confirmed', 'account.opened', 'hold.changed'], 'no welcome event');
});

test('M08-S08: every contract publish logs its delivery result (type + status + ids, never the payload)', async () => {
  const r = rig(FIRST);
  await r.svc.match(principal(), RADV);
  const ev = r.sink.records().filter((x) => x.kind === 'event' && x.action === 'contract-publish');
  assert.deepEqual(ev.map((x) => x.reason), ['money.confirmed.queued', 'account.opened.queued', 'hold.changed.queued']);
  for (const x of ev) assert.deepEqual([...x.recordIds].sort(), [C2, RADV].sort());
  noSecrets(r.sink.records(), ['ARL-INV-0212', 'SYNTH048']);
  const failed = rig(FIRST, { publish: async () => ({ ok: false, reason: 'queue-full' }) });
  await failed.svc.match(principal(), RADV);
  assert.deepEqual(failed.sink.records().filter((x) => x.kind === 'event').map((x) => x.reason), ['money.confirmed.not-sent', 'account.opened.not-sent', 'hold.changed.not-sent']);
});

test('M08-S08: through the stub receiver the log reads delivered', async () => {
  const keys = ['synthetic-contract-signing-key-0000000000000009'];
  const stub = createInProcessStub({ schemas, keys, accepts: ['money.confirmed', 'account.opened', 'hold.changed'] });
  const outbox = createOutbox({ schemas, target: () => ({ url: 'stub://investor-app/events', key: keys[0] }), fetch: stub.fetch, clock: () => NOW });
  const publish = async (event) => { const q = outbox.enqueue(event); if (!q.ok) return q; await outbox.drain(); return { ok: true, eventId: q.eventId, state: outbox.state(q.eventId) }; };
  const r = rig(FIRST, { publish });
  await r.svc.match(principal(), RADV);
  assert.deepEqual(r.sink.records().filter((x) => x.kind === 'event').map((x) => x.reason), ['money.confirmed.delivered', 'account.opened.delivered', 'hold.changed.delivered']);
  const opened = stub.recorded().find((e) => e.type === 'account.opened');
  assert.equal(opened.payload.state, 'tentative');
});

test('M08-S08: an account already On hold (added as paid) gets only the mark; Hold/Invite are never rewritten', async () => {
  const r = rig({ ...FIRST, contact: 'contact.hold-no-mark' });
  const res = await r.svc.match(principal(), RADV);
  assert.deepEqual(res.value.appAccess, { ok: true, value: 'already-set', code: null });
  assert.deepEqual(res.value.appMark, { ok: true, value: 'tentative-set', code: null });
  assert.deepEqual(puts(r.calls).filter((c) => c[1] === 'Contacts').map((c) => c[3]),
    [{ App_Account_Mark: 'Tentative', App_Mark_At: '2026-09-02T09:02:00+05:30' }]);
  const both = rig({ ...FIRST, contact: 'contact.hold-tentative' });
  const b = await both.svc.match(principal(), RADV);
  assert.equal(b.value.appMark.value, 'already-set');
  assert.equal(puts(both.calls).filter((c) => c[1] === 'Contacts').length, 0, 'nothing to write');
  assert.equal(b.value.accountOpened.ok, true, 'account.opened is still (re)sent — same event id, the app applies it once');
});

test('M08-S08: if Zoho refuses the mark (T01 made it a formula), App_Access is still opened alone', async () => {
  const r = rig({ ...FIRST, contactPuts: ['contact.validation-mark', 'contact.updated'] });
  const res = await r.svc.match(principal(), RADV);
  assert.deepEqual(res.value.appAccess, { ok: true, value: 'opened-on-hold', code: null });
  assert.deepEqual(res.value.appMark, { ok: true, value: 'left-to-zoho', code: null });
  const c = puts(r.calls).filter((x) => x[1] === 'Contacts');
  assert.equal(c.length, 2);
  assert.deepEqual(c[1][3], { App_Access: 'Hold' });
  assert.equal(c[1][4], c[0][4], 'the retry is guarded on the same Modified_Time');
});

test('M08-S08: not only an Advance — any first matched inbound money opens; a Refund never does; later money does not re-open', async () => {
  const first = rig({ receipt: 'receipt.pending-balance', investorReceipts: 'receipts.first-part', allotmentReceipts: 'receipts.first-part', contact: 'contact.no-app-kiran' });
  const fp = await first.svc.match(principal(), R);
  assert.equal(fp.ok, true, JSON.stringify(fp));
  assert.equal(fp.value.firstMoney, true, 'a Part/Full as the first confirmed money opens (D10)');
  assert.equal(fp.value.appAccess.value, 'opened-on-hold');
  assert.equal(first.events.find((e) => e.type === 'account.opened').payload.state, 'tentative');
  assert.equal(fp.value.hold.value, null, 'only an Advance starts the hold');
  const part = rig({ receipt: 'receipt.pending-balance', investorReceipts: 'receipts.first-advance', contact: 'contact.no-app' });
  const pending = await part.svc.match(principal(), R);
  assert.equal(pending.ok, true, JSON.stringify(pending));
  // receipts.first-advance lists the advance as Matched → this Part is NOT first money
  assert.equal(pending.value.firstMoney, false);
  assert.equal(pending.value.accountOpened, null);
  assert.equal(puts(part.calls).filter((c) => c[1] === 'Contacts').length, 0, 'second money never re-opens');
  // A refund: no account, no App_Access, no event beyond the receipt write.
  const refund = rig({ ...FIRST, receipt: 'receipt.pending-refund' });
  const rf = await refund.svc.match(principal(), RADV);
  assert.equal(rf.ok, true, JSON.stringify(rf));
  assert.equal(rf.value.firstMoney, false);
  assert.equal(rf.value.accountOpened, null);
  assert.deepEqual(puts(refund.calls).map((c) => c[1]), ['Receipts']);
  assert.equal(refund.events.length, 0);
});

test('M08-S08: recording alone never opens — one opening path on money (match.ts); unlock only moves Hold ↔ Invite', () => {
  const src = (f) => fs.readFileSync(path.join(srcRoot, f), 'utf8');
  const recordSide = ['server/money/record-receipt.ts', 'server/money/allotment-receipts.ts', 'server/money/receipt-replay.ts',
    'app/api/receipts/route.ts', 'app/api/receipts/compose.ts'];
  for (const f of recordSide) {
    const t = src(f);
    assert.ok(!/account\.opened/.test(t), `${f} publishes no account.opened`);
    assert.ok(!/App_Access|App_Account_Mark/.test(t), `${f} writes no app access or mark`);
  }
  const moneyOpeners = fs.readdirSync(__dirname).filter((f) => f.endsWith('.ts') && /type: "account\.opened"/.test(fs.readFileSync(path.join(__dirname, f), 'utf8')));
  assert.deepEqual(moneyOpeners, ['match.ts']);
  const unlock = src('server/investors/unlock.ts');
  assert.match(unlock, /"no-account"/, 'unlock refuses an account that was never opened');
  assert.ok(!/account\.opened/.test(unlock));
});

test('M08-S08: an unmatched (pending) receipt never reaches the consequences — a refused match writes nothing on the Contact', async () => {
  for (const f of [{ ...FIRST, receipt: 'receipt.pending-own' }, { ...FIRST, allotment: 'allotment.unverified' }, { ...FIRST, put: 'receipt.conflict-412' }]) {
    const r = rig(f);
    const res = await r.svc.match(principal(), f.receipt === 'receipt.pending-own' ? R : RADV);
    assert.equal(res.ok, false);
    assert.equal(puts(r.calls).filter((c) => c[1] === 'Contacts').length, 0);
    assert.equal(r.events.length, 0);
  }
});
