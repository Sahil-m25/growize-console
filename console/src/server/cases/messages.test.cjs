/* M13-S05-W1 — the ticket thread and the list of deliveries on recorded Zoho answers.
 * Run from console/: node --test src/server/cases/messages.test.cjs */
'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { compile, makeHttpRig, P } = require('./fixture-rig.cjs');

const load = compile(['server/cases/messages.ts', 'server/cases/deliveries.ts', 'server/data/scope.ts', 'server/data/events.ts', 'server/identity/plane-c.ts']);
const { createCaseMessages, maskIdentity } = load('server/cases/messages.js');
const { createCaseDeliveries } = load('server/cases/deliveries.js');
const KAM = `${P}740994001`, HARSHA = `${P}740993002`, IR = `${P}740995001`;
const MINE = `${P}740998401`, FOREIGN = `${P}740998405`;

const route = (notes = 'related.notes') => (c) => {
  if (c.path === '/coql') return ['cases', /id in \(/.test(c.query) || /id = /.test(c.query) ? 'coql.cases.kam-foreign' : 'coql.cases.org'];
  if (c.method === 'GET' && /^\/Cases\/\d+\/Notes$/.test(c.path)) return ['cases', notes];
  throw new Error(`unrouted ${c.method} ${c.path}`);
};
const refusals = (rig) => rig.sink.records().filter((x) => x.kind === 'refusal');
const p = async (rig, id, seat) => ({ credential: await rig.cred(id), seat });

test('the thread is the Notes on the Case, oldest first; a "Reply to the investor" note is a reply, the rest are notes', async () => {
  const rig = await makeHttpRig(load, route());
  const r = await createCaseMessages(rig).forCase(await p(rig, KAM, 'kam'), MINE);
  assert.equal(r.ok, true);
  assert.deepEqual(r.messages.map((m) => [m.id.slice(-3), m.kind, m.at]), [
    ['501', 'note', '2026-09-28T10:05'], ['502', 'note', '2026-09-28T10:30'], ['503', 'reply', '2026-09-28T11:40']]);   // 504 has no text: not a message
  assert.deepEqual({ ...r.messages[2].by }, { id: KAM, name: 'Imran Sheikh' });
  assert.equal(r.messages[1].by, null);
  assert.equal(r.truncated, false);
  const reads = rig.calls.filter((c) => c.method === 'GET');
  assert.equal(reads.length, 1);
  assert.equal(reads[0].path, `/Cases/${MINE}/Notes`);
  assert.match(new URL('http://x' + reads[0].path).pathname, /Notes$/);
});

test('an identity-shaped value in a note is masked before it leaves (rule 7)', async () => {
  const rig = await makeHttpRig(load, route());
  const r = await createCaseMessages(rig).forCase(await p(rig, KAM, 'kam'), MINE);
  const t = r.messages[0].text;
  assert.ok(!t.includes('ABCDE1234F') && !t.includes('123456789012'), t);
  assert.match(t, /Spoke to her at 10; she will send the new proof\./);
  assert.equal(maskIdentity('nothing here'), 'nothing here');
  assert.ok(!JSON.stringify(rig.sink.records()).includes('Spoke to her'));   // no body in Plane B
});

test('a KAM is refused a ticket that is not theirs (404, one refusal line by id); a seat without Tickets is refused; a malformed id costs no call', async () => {
  const rig = await makeHttpRig(load, route());
  const svc = createCaseMessages(rig);
  const r = await svc.forCase(await p(rig, KAM, 'kam'), FOREIGN);
  assert.deepEqual(r, { ok: false, kind: 'refused', reason: 'not-found' });
  assert.deepEqual([...refusals(rig)[0].recordIds], [FOREIGN]);
  assert.equal(rig.calls.filter((c) => c.method === 'GET').length, 0);   // the thread was never read
  assert.equal((await svc.forCase(await p(rig, IR, 'ir'), MINE)).reason, 'no-book');
  const before = rig.calls.length;
  assert.equal((await svc.forCase(await p(rig, KAM, 'kam'), 'x')).reason, 'invalid-request');
  assert.equal(rig.calls.length, before);
});

test('a Case with no notes has an empty thread; a Zoho error is a source error, never a body', async () => {
  const rig = await makeHttpRig(load, route('related.notes-none'));
  const r = await createCaseMessages(rig).forCase(await p(rig, HARSHA, 'head'), MINE);
  assert.deepEqual([r.ok, r.messages.length], [true, 0]);
  const bad = await makeHttpRig(load, (c) => (c.path === '/coql' ? ['cases', 'coql.cases.org'] : { status: 500, body: { code: 'INTERNAL_ERROR' } }));
  const e = await createCaseMessages(bad).forCase(await p(bad, HARSHA, 'head'), MINE);
  assert.equal(e.ok, false);
  assert.equal(e.kind, 'source-error');
});

test('deliveries as a list: one Cases read for every id asked, a Case the person may not read is absent, no per-row call', async () => {
  const rig = await makeHttpRig(load, route());
  const seen = [];
  const deliveries = (id, type) => { seen.push([id, type]); return id === MINE ? [{ eventId: 'e1', type, status: 'delivered', label: 'Delivered', attempts: 1, lastReason: null, nextAt: null, deliveredAt: 5, recordIds: [id] }] : []; };
  const svc = createCaseDeliveries({ crm: rig.crm, events: rig.events, deliveries });
  const r = await svc.forCases(await p(rig, KAM, 'kam'), [MINE, FOREIGN]);
  assert.equal(r.ok, true);
  assert.deepEqual(Object.keys(r.cases), [MINE]);
  assert.equal(r.cases[MINE].label, 'Delivered');
  assert.equal(r.cases[MINE].replies[0].eventId, 'e1');
  assert.deepEqual(seen, [[MINE, 'case.replied']]);
  const reads = rig.calls.filter((c) => c.path === '/coql');
  assert.equal(reads.length, 1);
  assert.match(reads[0].query, new RegExp(`from Cases where id in \\('${MINE}', '${FOREIGN}'\\)`));
  assert.ok(!JSON.stringify(r).includes('"text"'));
});

test('the delivery list refuses an empty list, a malformed id and a seat without Tickets; one ticket still answers as before', async () => {
  const rig = await makeHttpRig(load, route());
  const svc = createCaseDeliveries({ crm: rig.crm, events: rig.events, deliveries: () => [] });
  assert.equal((await svc.forCases(await p(rig, KAM, 'kam'), [])).reason, 'invalid-request');
  assert.equal((await svc.forCases(await p(rig, KAM, 'kam'), ['12'])).reason, 'invalid-request');
  assert.equal((await svc.forCases(await p(rig, IR, 'ir'), [MINE])).reason, 'no-book');
  assert.deepEqual(rig.calls.length, 0);
  const one = await svc.forCase(await p(rig, KAM, 'kam'), MINE);
  assert.deepEqual([one.ok, one.label, one.replies.length], [true, null, 0]);
  assert.equal((await svc.forCase(await p(rig, KAM, 'kam'), FOREIGN)).reason, 'not-found');
});
