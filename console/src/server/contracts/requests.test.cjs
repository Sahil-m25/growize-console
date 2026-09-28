/* M13-S05 — request.raised → one Case (T01), the reply → case.replied with its delivery state (T03), and the
 * round trip against the stub (T04), on recorded Zoho answers. No network.
 * Run from console/: node --test src/server/contracts/requests.test.cjs */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { compile, makeHttpRig, recorded, P, NOW } = require('../cases/fixture-rig.cjs');

const load = compile(['server/contracts/requests.ts', 'server/contracts/inbound.ts', 'server/contracts/outbox.ts', 'server/contracts/stub.ts',
  'server/cases/writes.ts', 'server/cases/deliveries.ts', 'server/logs/jsonl.ts', 'server/data/scope.ts', 'server/data/events.ts', 'server/identity/plane-c.ts']);
const { createRequestIntake, createRequestIndex, contactCheck, CASE_MARKER } = load('server/contracts/requests.js');
const { createInboundEndpoint, createSeenEvents } = load('server/contracts/inbound.js');
const { createOutbox, deliveriesForRecord } = load('server/contracts/outbox.js');
const { createInProcessStub, loadSchemas } = load('server/contracts/stub.js');
const { validateEvent, sign } = load('server/contracts/events.js');
const { createCaseWrites } = load('server/cases/writes.js');
const { createCaseDeliveries } = load('server/cases/deliveries.js');
const { createJsonlStore } = load('server/logs/jsonl.js');
const { createZohoServiceClient, serviceCredential } = load('lib/zoho/client.js');
const { createOpsLog, createMemorySink } = load('lib/zoho/log.js');

const consoleRoot = path.resolve(__dirname, '..', '..', '..');
const schemas = loadSchemas(path.resolve(consoleRoot, '..', 'contracts'));
const FX = path.join(consoleRoot, 'src', 'lib', 'zoho', '__fixtures__', 'contracts');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'requests-'));
process.on('exit', () => fs.rmSync(scratch, { recursive: true, force: true }));
const KEY = 'synthetic-contract-key-never-live-000000000001';
const CONTACT = `${P}740994101`, KAM = `${P}740995020`, CASE = `${P}740998410`, OTHER_KAM = `${P}740995021`;
const fx = (n) => JSON.parse(fs.readFileSync(path.join(FX, n), 'utf8'));
const MATCHED = () => fx('request.raised.matched.event.json');
const gate = () => ({ async acquire() { return { waitedMs: 0, release() {} }; }, async run(_c, t) { return t(); }, snapshot() { return {}; } });
const toResponse = (r) => new Response(r.status === 204 ? null : JSON.stringify(r.body), { status: r.status, headers: r.headers || {} });
const cred = () => serviceCredential('provider-callback', { access_token: 'synthetic-service', api_domain: 'https://www.zohoapis.in', expires_in: 3600 }, NOW);
let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

/* Zoho on recorded answers: the marker COQL, the Contact read and the Case insert. */
function zoho(o = {}) {
  const calls = [];
  const sink = createMemorySink();
  const log = createOpsLog(sink);
  const crm = createZohoServiceClient({ recordIdPrefix: P, gate: gate(), log, maxAttempts: 1, clock: () => NOW,
    fetch: async (url, init) => {
      const u = new URL(String(url));
      const body = init.body ? JSON.parse(init.body) : null;
      const c = { method: init.method || 'GET', path: u.pathname.replace(/^\/crm\/v\d+/, ''), body, query: body && body.select_query };
      calls.push(c);
      if (c.path === '/coql') return toResponse(o.coql ?? recorded('contracts', 'coql.cases-marker.empty'));
      if (c.method === 'GET' && c.path === `/Contacts/${CONTACT}`) return toResponse(o.contact ?? recorded('contracts', 'record.contact-kam'));
      if (c.method === 'POST' && c.path === '/Cases') return toResponse(o.insert ?? recorded('contracts', 'insert.case-request'));
      throw new Error(`unrouted ${c.method} ${c.path}`);
    } });
  return { crm, calls, sink, log, writes: () => calls.filter((c) => c.method === 'POST' && c.path !== '/coql') };
}

function world(o = {}) {
  const z = zoho(o);
  const stub = createInProcessStub({ schemas, keys: [KEY], clock: () => NOW, down: () => !!o.down });
  const ledger = [];
  const outbox = createOutbox({ schemas, target: () => ({ url: 'stub://investor-app/events', key: KEY }), fetch: stub.fetch, clock: () => NOW, ledger: { append: (l) => ledger.push(l) } });
  const publish = async (e) => { const r = outbox.enqueue(e); if (r.ok) await outbox.drain(); return r.ok ? { ok: true, eventId: r.eventId, state: outbox.state(r.eventId) } : r; };
  const intake = createRequestIntake({ crm: z.crm, log: z.log, credential: async () => (o.credential ?? cred()), index: o.index ?? createRequestIndex(), contactIdPrefix: P, publish, clock: () => NOW });
  const seen = new Set();
  const ep = createInboundEndpoint({ schemas, keys: [KEY], log: z.log, newId: uuid, clock: () => NOW, caseFor: intake.caseFor,
    seen: { has: async (id) => seen.has(id), add: async (id) => { seen.add(id); } },
    onRequest: async (e) => { const r = await intake.handle(e); return r.ok ? { caseId: r.caseId } : { refused: r.refused }; },
    onDelivered: (e) => { outbox.acknowledge(e.payload.message_id, e.payload.status || 'delivered'); } });
  const post = (event) => { const b = JSON.stringify(event); return ep.handle(b, sign(b, KEY)); };
  return { ...z, stub, outbox, ledger, publish, intake, ep, post };
}

test('the Contact check: the sender must be the investor the request names; the request id is safe to query', () => {
  assert.equal(contactCheck(MATCHED(), P).ok, true);
  assert.deepEqual(contactCheck(fx('request.raised.mismatch.event.json'), P), { ok: false, refused: 'contact-mismatch' });
  assert.deepEqual(contactCheck({ ...MATCHED(), actor: { kind: 'user', zoho_user_id: KAM } }, P), { ok: false, refused: 'contact-mismatch' });
  assert.deepEqual(contactCheck(fx('request.raised.event.json'), P), { ok: false, refused: 'contact-mismatch' }, 'no actor.investor_contact_id → refused');
  const inj = MATCHED(); inj.payload.app_request_id = "R-1' or id != '0";
  assert.deepEqual(contactCheck(inj, P), { ok: false, refused: 'bad-request-id' });
  assert.deepEqual(contactCheck({ ...MATCHED(), ids: { investor_contact_id: '1234567890123456789' }, actor: { kind: 'investor', investor_contact_id: '1234567890123456789' } }, P), { ok: false, refused: 'no-contact' });
});

test('TC-IM08-016: request.raised makes exactly one Case owned by the KAM; twice (same or new event id) answers the same case id', async () => {
  const w = world();
  const first = await w.post(MATCHED());
  assert.equal(first.status, 200);
  assert.equal(first.applied, true);
  assert.equal(first.caseId, CASE);
  const [ins] = w.writes();
  const row = ins.body.data[0];
  assert.deepEqual(row.Related_To, { id: CONTACT });
  assert.deepEqual(row.Owner, { id: KAM }, "owned by the investor's KAM");
  assert.ok(row.Subject.endsWith(CASE_MARKER('R-1')));
  assert.equal(row.Case_Origin, 'Web');
  assert.equal(row.Ticket_Category, 'Records');
  assert.equal(row.Status, 'New');
  assert.ok(!JSON.stringify(ins.body).includes('FY2025-26'), 'the masked payload is never written to the Case');
  const replay = await w.post(MATCHED());
  assert.deepEqual({ status: replay.status, applied: replay.applied, caseId: replay.caseId }, { status: 200, applied: false, caseId: CASE });
  const again = { ...MATCHED(), event_id: uuid() };
  const second = await w.post(again);
  assert.equal(second.caseId, CASE);
  assert.equal(w.writes().length, 1, 'one Case for R-1');
  // request.executed { received, case_id } reached the app once, to its schema
  const told = w.stub.recorded().filter((e) => e.type === 'request.executed');
  assert.equal(told.length, 1);
  assert.deepEqual(told[0].payload.state, 'received');
  assert.equal(told[0].payload.case_id, CASE);
  assert.equal(told[0].payload.app_request_id, 'R-1');
  assert.deepEqual(validateEvent(schemas, told[0]), { ok: true, type: 'request.executed' });
  assert.ok(!JSON.stringify(w.sink.records()).includes('FY2025-26'), 'no body in Plane B');
});

test('a request naming a Contact that is not the sender is refused (422), logged by id, and never touches Zoho', async () => {
  const w = world();
  const r = await w.post(fx('request.raised.mismatch.event.json'));
  assert.deepEqual(r, { status: 422, reason: 'contact-mismatch' });
  assert.equal(w.calls.length, 0);
  const refs = w.sink.records().filter((l) => l.kind === 'refusal');
  assert.ok(refs.some((l) => l.reason === 'contact-mismatch' && l.action === 'request-to-case' && l.recordIds.includes(CONTACT)));
  assert.ok(refs.some((l) => l.reason === 'inbound-contact-mismatch'));
  assert.deepEqual(await w.post(fx('request.raised.mismatch.event.json')), { status: 422, reason: 'contact-mismatch' }, 'not marked applied');
  // an ARL code that is not the Contact's, and a Contact Zoho does not return
  const coded = MATCHED(); coded.ids.arl_code = 'ARL-INV-0999';
  assert.equal((await world().post(coded)).reason, 'contact-mismatch');
  assert.equal((await world({ contact: { status: 204 } }).post(MATCHED())).reason, 'no-contact');
});

test('idempotency without an app_request_id field: the index survives a restart, and a lost index is covered by the Subject marker', async () => {
  const dir = path.join(scratch, 'requests');
  const a = world({ index: createRequestIndex(createJsonlStore({ dir, plane: 'requests', clock: () => NOW })) });
  assert.equal((await a.post(MATCHED())).caseId, CASE);
  const b = world({ index: createRequestIndex(createJsonlStore({ dir, plane: 'requests', clock: () => NOW })) });
  assert.equal((await b.post({ ...MATCHED(), event_id: uuid() })).caseId, CASE);
  assert.equal(b.calls.length, 0, 'answered from the index after a restart');
  // index lost: COQL finds R-1 (not R-10) on the same Contact → no insert
  const c = world({ coql: recorded('contracts', 'coql.cases-marker.found') });
  const r = await c.post(MATCHED());
  assert.equal(r.caseId, CASE);
  assert.equal(c.writes().length, 0);
  assert.match(c.calls[0].query, /Subject like '%· ref R-1' limit 0, 5$/);
  // the same app_request_id from another Contact is refused
  const other = MATCHED(); other.event_id = uuid(); other.ids.investor_contact_id = `${P}740994102`; other.actor.investor_contact_id = `${P}740994102`; delete other.ids.arl_code;
  assert.deepEqual(await c.post(other), { status: 422, reason: 'request-id-reused' });
});

test('Zoho down is not a refusal: the event is not applied and the app redelivers; a COQL the org refuses does not block the Case', async () => {
  const down = world({ coql: { status: 500, body: { code: 'INTERNAL_ERROR', status: 'error' } } });
  await assert.rejects(down.post(MATCHED()));
  assert.equal(down.writes().length, 0);
  const syntax = world({ coql: recorded('contracts', 'coql.cases-marker.syntax') });
  assert.equal((await syntax.post(MATCHED())).caseId, CASE);
  assert.equal(syntax.writes().length, 1);
  const other = serviceCredential('audit-archive', { access_token: 'synthetic-service-2', api_domain: 'https://www.zohoapis.in', expires_in: 3600 }, NOW);
  assert.deepEqual(await world({ credential: other }).post(MATCHED()), { status: 422, reason: 'wrong-identity' });
});

/* ---- T03/T04: the reply goes back, with an honest delivery state ---- */

const caseRoute = (c) => {
  if (c.path === '/coql') return ['cases', 'coql.case.owner-kam'];
  if (c.method === 'POST' && c.path === '/Notes') return ['cases', 'insert.note'];
  throw new Error(`unrouted ${c.method} ${c.path}`);
};

test('T04 round trip: request.raised → Case → the KAM replies → case.replied received by the stub; "Delivered" only after its ack', async () => {
  let down = true;
  const w = world({ get down() { return down; } });
  assert.equal((await w.post(MATCHED())).caseId, CASE);
  const rig = await makeHttpRig(load, caseRoute);
  const kam = { credential: await rig.cred(KAM), seat: 'kam' };
  const r = await createCaseWrites({ ...rig, push: w.publish, clock: () => NOW }).reply(kam, CASE, 'Your FY statement is in the app now.');
  assert.equal(r.ok, true);
  assert.equal(r.delivery.label, 'Not delivered yet', 'the app did not acknowledge: never "delivered"');
  const view = createCaseDeliveries({ crm: rig.crm, events: rig.events, deliveries: (id, type) => deliveriesForRecord(w.outbox.forRecord(id), [], id, type) });
  let d = await view.forCase(kam, CASE);
  assert.equal(d.ok, true);
  assert.equal(d.label, 'Not delivered yet');
  assert.deepEqual(Object.keys(d.replies[0]).sort(), ['attempts', 'deliveredAt', 'eventId', 'label', 'reason', 'status']);
  assert.equal(w.stub.recorded().filter((e) => e.type === 'case.replied').length, 0);
  // the app comes back and answers push.delivered for that event through the inbound endpoint
  down = false;
  const ack = fx('push.delivered.event.json'); ack.event_id = uuid(); ack.payload.message_id = r.delivery.eventId;
  assert.equal((await w.post(ack)).status, 200);
  d = await view.forCase(kam, CASE);
  assert.equal(d.label, 'Delivered');
  assert.equal(d.replies[0].status, 'delivered');
  // a second reply that the stub receives directly
  const r2 = await createCaseWrites({ ...rig, push: w.publish, clock: () => NOW }).reply(kam, CASE, 'And the Q2 one too.');
  assert.equal(r2.delivery.label, 'Delivered');
  const replied = w.stub.recorded().filter((e) => e.type === 'case.replied');
  assert.equal(replied.length, 1);
  assert.equal(replied[0].payload.case_id, CASE);
  assert.deepEqual(validateEvent(schemas, replied[0]), { ok: true, type: 'case.replied' });
  // another KAM cannot read this ticket's delivery
  const foreign = await view.forCase({ credential: await rig.cred(OTHER_KAM), seat: 'kam' }, CASE);
  assert.deepEqual({ ok: foreign.ok, reason: foreign.reason }, { ok: false, reason: 'not-found' });
});

test('delivery states survive a restart from the ledger: delivered stays delivered, an unsent reply reads as needing attention', () => {
  const lines = [
    { at: NOW, eventId: 'e-1', type: 'case.replied', status: 'queued', attempts: 0, reason: null, recordIds: [CASE, CONTACT] },
    { at: NOW + 1, eventId: 'e-1', type: 'case.replied', status: 'delivered', attempts: 1, reason: null, recordIds: [CASE, CONTACT] },
    { at: NOW, eventId: 'e-2', type: 'case.replied', status: 'retrying', attempts: 2, reason: 'unreachable', recordIds: [CASE, CONTACT] },
    { at: NOW, eventId: 'e-3', type: 'request.executed', status: 'delivered', attempts: 1, reason: null, recordIds: [CASE, CONTACT] },
    { at: NOW, eventId: 'e-4', type: 'case.replied', status: 'delivered', attempts: 1, reason: null, recordIds: [`${P}740998499`] },
  ];
  const d = deliveriesForRecord([], lines, CASE, 'case.replied');
  assert.deepEqual(d.map((x) => [x.eventId, x.status, x.label, x.lastReason]), [
    ['e-1', 'delivered', 'Delivered', null],
    ['e-2', 'dead', 'Not delivered — needs attention', 'restarted'],
  ]);
});
