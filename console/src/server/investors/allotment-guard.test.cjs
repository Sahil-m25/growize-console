/* M11-S02-NOTE-2 — "Refuse to save an allotment without Customer and LLP": the guard, the client belt, and the allot path,
   on recorded Zoho answers (never live Zoho). Run from console/: node --test src/server/investors/allotment-guard.test.cjs */
'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { compile, makeHttpRig, P } = require('../cases/fixture-rig.cjs');

const load = compile(['server/investors/allotment-guard.ts', 'server/investors/allot.ts', 'server/farms/oversell.ts', 'server/data/events.ts', 'server/identity/plane-c.ts']);
const { missingLinks, unlinkedMessage, writeMissing, guardAllotmentWrites, ALLOTMENT_UNLINKED } = load('server/investors/allotment-guard.js');
const { createAllot } = load('server/investors/allot.js');
const { createOversellGuard } = load('server/farms/oversell.js');
const { createOpsLog } = load('lib/zoho/log.js');

const CUST = `${P}740990208`, LLP = `${P}740998302`, AP = `${P}740998208`, HARSHA = `${P}740993003`;
const OK = { status: 200, headers: {}, body: { data: [{ code: 'SUCCESS', details: { id: AP, Modified_Time: '2026-09-28T11:30:00+05:30' }, message: 'ok', status: 'success' }] } };

test('the pure rule: both links must be record ids; a blank, a null or a non-id is missing', () => {
  assert.deepEqual(missingLinks({ id: CUST }, { id: LLP }), []);
  assert.deepEqual(missingLinks(CUST, LLP), []);
  assert.deepEqual(missingLinks(null, { id: LLP }), ['Customer']);
  assert.deepEqual(missingLinks({ id: CUST }, undefined), ['LLP']);
  assert.deepEqual(missingLinks('', { id: 'x' }), ['Customer', 'LLP']);
  assert.match(unlinkedMessage(['LLP']), /^An allotment needs both its Customer and its LLP — this one has no LLP\./);
  assert.match(unlinkedMessage(['Customer', 'LLP']), /no Customer and no LLP/);
  assert.deepEqual(writeMissing('create', { Customer: { id: CUST } }), ['LLP']);
  assert.deepEqual(writeMissing('update', { Hold_Until: '2026-10-30' }), [], 'an update that names neither link leaves them alone');
  assert.deepEqual(writeMissing('update', { LLP: null }), ['LLP'], 'but it may not blank one');
});

test('the belt: an allotment insert or upsert without Customer or LLP never leaves; with both it goes through; other modules are untouched', async () => {
  const rig = await makeHttpRig(load, () => OK);
  const crm = guardAllotmentWrites(rig.crm, createOpsLog(rig.sink));
  const cred = await rig.cred(HARSHA);
  const mod = 'LLP_UnitAllocation_Module';
  for (const rec of [{ Name: 'x' }, { Customer: { id: CUST } }, { LLP: { id: LLP } }, { Customer: null, LLP: { id: LLP } }]) {
    const r = await crm.insert(cred, mod, [rec]);
    assert.deepEqual([r.ok, r.error.kind, r.error.reason], [false, 'refused', ALLOTMENT_UNLINKED]);
  }
  assert.equal((await crm.upsert(cred, mod, [{ Customer: { id: CUST } }], ['Name'])).ok, false);
  assert.equal(rig.calls.length, 0, 'nothing was sent to Zoho');
  assert.equal((await crm.insert(cred, mod, [{ Customer: { id: CUST }, LLP: { id: LLP } }])).ok, true);
  assert.equal((await crm.insert(cred, 'Contacts', [{ Last_Name: 'x' }])).ok, true);
  assert.equal(rig.calls.length, 2);
  const line = rig.sink.records().find((x) => x.reason === ALLOTMENT_UNLINKED);
  assert.ok(line && line.action === 'allotment-insert');
});

test('the belt: an update may not blank Customer or LLP, and may change anything else', async () => {
  const rig = await makeHttpRig(load, () => OK);
  const crm = guardAllotmentWrites(rig.crm, createOpsLog(rig.sink));
  const cred = await rig.cred(HARSHA);
  const r = await crm.update(cred, 'LLP_UnitAllocation_Module', AP, { LLP: { id: '' } }, { ifUnmodifiedSince: null });
  assert.deepEqual([r.ok, r.error.reason], [false, ALLOTMENT_UNLINKED]);
  assert.equal(rig.calls.length, 0);
  assert.equal((await crm.update(cred, 'LLP_UnitAllocation_Module', AP, { Hold_Until: '2026-10-30' }, { ifUnmodifiedSince: null })).ok, true);
  assert.equal(rig.calls.length, 1);
});

/* ---- allot: an unlinked allotment is refused with its own code, before any write ---- */
const allotment = (over) => ({ status: 200, headers: {}, body: { data: [{ id: AP, Name: 'ALT-8208', Customer: { id: CUST, name: 'x' }, LLP: { id: LLP, name: 'Fixture Block B' },
  Allocation_Status: 'Reserved', Reserved_Units: 1, Issued_Units: 0, Unit_Price: 2500000, Allocation_Letter: [{ file_Name: 'a.pdf' }],
  Alloc_Letter_Verified_At: null, Modified_Time: '2026-09-27T16:00:00+05:30', ...over }] } });

const sent = (rig) => rig.calls.filter((c) => c.method !== 'GET').length;

async function allotWith(rec) {
  const rig = await makeHttpRig(load, (c) => {
    if (c.method === 'GET' && c.path === `/LLP_UnitAllocation_Module/${AP}`) return rec;
    throw new Error(`unexpected ${c.method} ${c.path}`);
  });
  const allot = createAllot({ crm: rig.crm, log: createOpsLog(rig.sink), recordIdPrefix: P, clock: () => Date.parse('2026-09-28T06:00:00Z'),
    oversell: createOversellGuard({ crm: rig.crm, events: rig.events }), authority: { async mayVerify() { return true; } },
    publish: async () => ({ ok: true }) });
  const r = await allot.allot({ credential: await rig.cred(HARSHA), sessionId: 'session-harsha-0001' }, CUST, { allotmentId: AP });
  return { rig, r };
}

test('allot: a Reserved allotment with no LLP is refused allotment-unlinked, in page words, and nothing is written', async () => {
  const { rig, r } = await allotWith(allotment({ LLP: null }));
  assert.deepEqual([r.ok, r.kind, r.reasonCode], [false, 'refused', ALLOTMENT_UNLINKED]);
  assert.match(r.message, /^Not allotted — An allotment needs both its Customer and its LLP — this one has no LLP/);
  assert.equal(sent(rig), 0);
  assert.ok(rig.sink.records().some((x) => x.action === 'allotment-allot' && x.reason === ALLOTMENT_UNLINKED));
});

test('allot: no Customer is the same refusal; an Issued unlinked row is not waved through as "already"', async () => {
  const a = await allotWith(allotment({ Customer: null }));
  assert.deepEqual([a.r.reasonCode, sent(a.rig)], [ALLOTMENT_UNLINKED, 0]);
  assert.match(a.r.message, /no Customer/);
  const b = await allotWith(allotment({ LLP: null, Allocation_Status: 'Issued' }));
  assert.equal(b.r.ok, false);
  assert.equal(b.r.reasonCode, ALLOTMENT_UNLINKED);
});
