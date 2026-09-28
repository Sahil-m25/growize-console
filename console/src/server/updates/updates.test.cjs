/* M13-S06-T02 — publish an investor update to a reconstructable segment, on recorded Zoho answers.
   Run from console/: node --test src/server/updates/updates.test.cjs */
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const { compile, makeHttpRig, P, NOW } = require('../cases/fixture-rig.cjs');

const load = compile(['server/updates/publish.ts', 'server/data/scope.ts', 'server/data/events.ts', 'server/identity/plane-c.ts',
  'server/contracts/events.ts', 'server/contracts/stub.ts', 'server/contracts/outbox.ts']);
const { createInvestorUpdates, kindsFor, predicateOf, REFUSAL_TEXT } = load('server/updates/publish.js');
const { imRightsOf } = load('server/cases/rights.js');
const { validateEvent } = load('server/contracts/events.js');
const { loadSchemas, createInProcessStub } = load('server/contracts/stub.js');
const { createOutbox } = load('server/contracts/outbox.js');
const schemas = loadSchemas(path.resolve(__dirname, '..', '..', '..', '..', 'contracts'));

const HARSHA = `${P}740993002`, MEENA = `${P}740993001`, KAM = `${P}740994001`, LATHA = `${P}740993009`;
const BLOCK_A = `${P}740996001`;
const BOOK = Array.from({ length: 15 }, (_, i) => `${P}7409971${String(i + 1).padStart(2, '0')}`);

const route = (c) => {
  if (c.path === '/coql') {
    if (/from Investor_Updates/.test(c.query)) return ['updates', 'coql.updates.list'];
    if (/from LLP_UnitAllocation_Module/.test(c.query)) return ['updates', /LLP = /.test(c.query) ? 'coql.allot.block-a' : 'coql.allot.issued'];
    if (/from Contacts/.test(c.query)) return ['updates', / in \(/.test(c.query) ? (/740997105/.test(c.query) ? 'coql.contacts.allotted' : 'coql.contacts.block-a') : 'coql.contacts.book'];
  }
  if (c.method === 'POST' && c.path === '/Investor_Updates') return ['updates', 'insert.update'];
  throw new Error(`unrouted ${c.method} ${c.path}`);
};
const pushInto = (sent) => async (e) => { sent.push(e); return { ok: true }; };
const STATEMENT = { headline: 'Quarterly statement — Oct to Dec', kind: 'Statement', audience: 'all', body: 'Statements for the quarter will be issued on 5 January.' };

test('kinds by seat: Finance publishes all four; a KAM Produce and Notice only; the Auditor none (read only)', () => {
  assert.deepEqual([...kindsFor(imRightsOf('head', HARSHA))], ['Produce', 'Statement', 'Compliance', 'Notice']);
  assert.deepEqual([...kindsFor(imRightsOf('fin', MEENA))], ['Produce', 'Statement', 'Compliance', 'Notice']);
  assert.deepEqual([...kindsFor(imRightsOf('kam', KAM))], ['Produce', 'Notice']);
  assert.deepEqual([...kindsFor(imRightsOf('audit', LATHA))], []);
});

test('Harsha publishes a Statement to everyone on the book: 15 investors resolved by COQL, stored with the count, pushed to exactly those 15', async () => {
  const rig = await makeHttpRig(load, route);
  const sent = [];
  const r = await createInvestorUpdates({ ...rig, push: pushInto(sent), clock: () => NOW }).publish({ credential: await rig.cred(HARSHA), seat: 'head' }, STATEMENT);
  assert.equal(r.ok, true);
  assert.equal(r.count, 15);
  assert.equal(r.row.n, 15);
  assert.equal(r.row.toText, 'everyone on the book');
  assert.equal(r.row.kind, 'Statement');
  assert.equal(r.row.by, HARSHA);
  assert.equal(r.predicate, 'select id from Contacts where (id is not null)');
  assert.match(rig.calls[0].query, /^select id from Contacts where \(id is not null\) order by id asc limit 0, 200$/);
  const [ins] = rig.writes();
  assert.deepEqual(ins.body.data[0], {
    Name: 'Quarterly statement — Oct to Dec', Category: 'Statement', Audience: 'All investors',
    Body: 'Statements for the quarter will be issued on 5 January.', Published_At: '2026-09-28T11:30:00+05:30',
    Published_By: { id: HARSHA }, Sent_Count: 15,
  });
  assert.deepEqual(r.pushed, { queued: 15, refused: 0 });
  assert.deepEqual(sent.map((e) => e.ids.investor_contact_id).sort(), [...BOOK].sort());
  for (const e of sent) {
    assert.deepEqual(validateEvent(schemas, e), { ok: true, type: 'update.published' });
    assert.equal(e.payload.update_id, `${P}740994801`);
    assert.equal(e.payload.body, STATEMENT.body); // the same text the investor reads
  }
});

test('allotted only: Customers of Issued allotments, intersected with the book — a duplicate and an outsider do not count', async () => {
  const rig = await makeHttpRig(load, route);
  const sent = [];
  const r = await createInvestorUpdates({ ...rig, push: pushInto(sent) }).publish({ credential: await rig.cred(MEENA), seat: 'fin' }, { ...STATEMENT, audience: 'allotted' });
  assert.equal(r.count, 9);
  assert.equal(sent.length, 9);
  assert.match(rig.calls[0].query, /from LLP_UnitAllocation_Module where \(Allocation_Status = 'Issued'\)/);
  assert.match(rig.calls[1].query, /from Contacts where \(id is not null\) and id in \(/);
  assert.ok(rig.calls[1].query.includes(`${P}740997999`)); // asked, and the book answered without it
  assert.equal(r.predicate, "select id from Contacts where (id is not null) and id in (select Customer from LLP_UnitAllocation_Module where Allocation_Status = 'Issued')");
  assert.equal(rig.writes()[0].body.data[0].Audience, 'Allotted only');
});

test('a KAM publishes a produce note to the holders of Block A: their own book only, the LLP stored on the record', async () => {
  const rig = await makeHttpRig(load, route);
  const sent = [];
  const r = await createInvestorUpdates({ ...rig, push: pushInto(sent) }).publish({ credential: await rig.cred(KAM), seat: 'kam' },
    { headline: 'Block A — flowering', kind: 'Produce', audience: 'farm', llpId: BLOCK_A, body: 'Flowering is ahead of schedule.' });
  assert.equal(r.count, 4);
  assert.match(rig.calls[0].query, new RegExp(`LLP = '${BLOCK_A}'`));
  assert.match(rig.calls[1].query, new RegExp(`from Contacts where \\(KAM = '${KAM}'\\) and id in`));
  assert.deepEqual(rig.writes()[0].body.data[0].LLP, { id: BLOCK_A });
  assert.equal(r.predicate, predicateOf(`KAM = '${KAM}'`, 'farm', BLOCK_A));
  assert.equal(sent.length, 4);
});

test('a Notice is stored as Other (PROVISIONAL) and read back as Notice', async () => {
  const rig = await makeHttpRig(load, route);
  const r = await createInvestorUpdates(rig).publish({ credential: await rig.cred(KAM), seat: 'kam' }, { headline: 'Office closed', kind: 'Notice', audience: 'all', body: 'Closed on Friday.' });
  assert.equal(r.ok, true);
  assert.equal(rig.writes()[0].body.data[0].Category, 'Other');
  assert.equal(r.row.kind, 'Notice');
});

test('refused before Zoho: a KAM\'s statement, the Auditor, NRI-only, an identity value, a farm with no LLP', async () => {
  const rig = await makeHttpRig(load, route);
  const u = createInvestorUpdates(rig);
  const kam = await u.publish({ credential: await rig.cred(KAM), seat: 'kam' }, STATEMENT);
  assert.deepEqual(kam, { ok: false, kind: 'refused', reason: 'kind-not-yours', message: REFUSAL_TEXT['kind-not-yours'] });
  assert.equal((await u.publish({ credential: await rig.cred(LATHA), seat: 'audit' }, STATEMENT)).reason, 'read-only');
  assert.equal((await u.publish({ credential: await rig.cred(HARSHA), seat: 'head' }, { ...STATEMENT, audience: 'nri' })).reason, 'audience-not-in-zoho');
  assert.equal((await u.publish({ credential: await rig.cred(HARSHA), seat: 'head' }, { ...STATEMENT, body: 'Account 123456789012 updated.' })).reason, 'identity-in-text');
  assert.equal((await u.publish({ credential: await rig.cred(HARSHA), seat: 'head' }, { ...STATEMENT, audience: 'farm' })).reason, 'invalid-request');
  assert.equal(rig.calls.length, 0);
  assert.equal(rig.sink.records().filter((x) => x.kind === 'refusal').length, 5);
});

test('an empty segment publishes nothing; a Zoho failure while resolving writes nothing and pushes nothing', async () => {
  const empty = await makeHttpRig(load, (c) => c.path === '/coql' ? { status: 204 } : route(c));
  const sent = [];
  const r = await createInvestorUpdates({ ...empty, push: pushInto(sent) }).publish({ credential: await empty.cred(HARSHA), seat: 'head' }, STATEMENT);
  assert.equal(r.reason, 'empty-segment');
  const down = await makeHttpRig(load, (c) => c.path === '/coql' ? { status: 500, body: { code: 'INTERNAL_ERROR' } } : route(c));
  const f = await createInvestorUpdates({ ...down, push: pushInto(sent) }).publish({ credential: await down.cred(HARSHA), seat: 'head' }, STATEMENT);
  assert.equal(f.kind, 'source-error');
  assert.equal(empty.writes().length + down.writes().length, 0);
  assert.equal(sent.length, 0);
});

test('a segment larger than one bounded read is refused rather than counted short', async () => {
  const big = await makeHttpRig(load, (c) => c.path === '/coql'
    ? { status: 200, body: { data: [{ id: `${P}740997101` }], info: { count: 1, more_records: true } } } : route(c));
  const r = await createInvestorUpdates({ ...big, maxPages: 2 }).publish({ credential: await big.cred(HARSHA), seat: 'head' }, STATEMENT);
  assert.equal(r.reason, 'segment-too-large');
  assert.equal(big.writes().length, 0);
});

test('the list: newest first, who wrote it, who it went to and how many; read only for the Auditor', async () => {
  const rig = await makeHttpRig(load, route);
  const r = await createInvestorUpdates(rig).list({ credential: await rig.cred(LATHA), seat: 'audit' });
  assert.equal(r.ok, true);
  assert.equal(r.readOnly, true);
  assert.equal(r.rows.length, 3);
  assert.deepEqual(r.rows.map((x) => [x.t, x.kind, x.n, x.toText]), [
    ['Block A — year-3 flowering ahead of schedule', 'Produce', 4, 'the holders of one farm'],
    ['Quarterly statement — Jul to Sep', 'Statement', 14, 'everyone on the book'],
    ['FEMA declarations — NRI investors', 'Compliance', 3, 'allotted investors only'],
  ]);
  assert.equal(r.rows[0].llp.id, BLOCK_A);
  assert.equal(r.rows[1].by, HARSHA);
  assert.match(rig.calls[0].query, /order by Published_At desc/);
  const k = await createInvestorUpdates(rig).list({ credential: await rig.cred(KAM), seat: 'kam' });
  assert.deepEqual([...k.kinds], ['Produce', 'Notice']);
});

test('through the real outbox and the stub: every event verifies, validates and is recorded once per investor', async () => {
  const rig = await makeHttpRig(load, route);
  const KEY = 'k'.repeat(40);
  const stub = createInProcessStub({ schemas, keys: [KEY], clock: () => NOW });
  const outbox = createOutbox({ schemas, target: () => ({ url: 'stub://app', key: KEY }), fetch: stub.fetch, clock: () => NOW });
  const push = async (e) => { const q = outbox.enqueue(e); await outbox.drain(); return { ok: q.ok }; };
  const r = await createInvestorUpdates({ ...rig, push }).publish({ credential: await rig.cred(HARSHA), seat: 'head' }, STATEMENT);
  assert.deepEqual(r.pushed, { queued: 15, refused: 0 });
  assert.equal(stub.recorded().length, 15);
  assert.equal(outbox.forRecord(`${P}740994801`).filter((d) => d.status === 'delivered').length, 15); // the page asks "how many reached the app?" by the update id
});
