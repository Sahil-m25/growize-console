/* M11-S07-T01 — the oversell guard: the console's pre-check and the naming of the Deluge guard's refusal, on recorded
   Zoho answers (never live Zoho). Run from console/: node --test src/server/farms/oversell.test.cjs */
'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { compile, makeHttpRig, P } = require('../cases/fixture-rig.cjs');

const load = compile(['server/farms/oversell.ts', 'server/data/events.ts', 'server/identity/plane-c.ts']);
const { createOversellGuard, oversellMessage } = load('server/farms/oversell.js');
const MEENA = `${P}740993002`;
const B = `${P}740998302`, C = `${P}740998303`, EDITED = `${P}740998777`, KIRAN = `${P}740997220`;

const routeWith = (over = {}) => (c) => {
  if (c.path === '/coql') {
    if (/from LLP_Creation_Module/.test(c.query)) return c.query.includes(C) ? ['farms', 'coql.guard-llp-c'] : ['farms', 'coql.guard-llp-b'];
    if (/group by Allocation_Status/.test(c.query)) return over.held ?? ['farms', 'agg.held-b-full'];
  }
  if (c.method === 'POST' && c.path === '/LLP_UnitAllocation_Module') return over.insert ?? ['farms', 'write.allotment-created'];
  throw new Error(`unexpected ${c.method} ${c.path} ${c.query ?? ''}`);
};
const fields = { Customer: { id: KIRAN }, LLP: { id: B }, Allocation_Status: 'Reserved', Reserved_Units: 2, Issued_Units: 0 };

test("TC-IM06-012: Block B is full — the 10% advance for Kiran Rao's 2 units is refused in-page and no reserved allotment is created", async () => {
  const rig = await makeHttpRig(load, routeWith());
  const r = await createOversellGuard(rig).insertAllotment(await rig.cred(MEENA), { llpId: B, units: 2, investorName: 'Kiran Rao' }, fields);
  assert.deepEqual([r.ok, r.kind, r.reason, r.free, r.by], [false, 'refused', 'no-free-units', 0, 'console']);
  assert.equal(r.message, "Block B has no free units for Kiran Rao's 2 units.");
  assert.equal(rig.writes().length, 0, 'nothing created');
  const logs = rig.sink.records();
  assert.ok(logs.some((x) => x.action === 'allotment-oversell' && x.reason === 'no-free-units'));
  assert.ok(!/Kiran/.test(JSON.stringify(logs)), 'no name in the logs');
});

test('free units are released − every other live allotment; room is allowed and the insert goes through', async () => {
  const rig = await makeHttpRig(load, routeWith({ held: ['farms', 'agg.held-none'] }));
  const g = createOversellGuard(rig);
  const cred = await rig.cred(MEENA);
  const c = await g.check(cred, { llpId: B, units: 2 });
  assert.deepEqual([c.ok, c.free, c.held, c.llp.label], [true, 34, 0, 'Block B']);
  const r = await g.insertAllotment(cred, { llpId: B, units: 2 }, fields);
  assert.deepEqual([r.ok, r.id, r.free], [true, `${P}740998999`, 32]);
});

test('an update is measured without the allotment being edited (id != it in the count)', async () => {
  const rig = await makeHttpRig(load, routeWith());
  await createOversellGuard(rig).check(await rig.cred(MEENA), { llpId: B, units: 1, exceptAllotmentId: EDITED });
  const q = rig.calls.map((c) => c.query).find((x) => x && /group by Allocation_Status/.test(x));
  assert.match(q, new RegExp(`where \\(\\(LLP = '${B}' and Allocation_Status in \\('Reserved', 'Issued'\\)\\) and id != '${EDITED}'\\) group by Allocation_Status`));
});

test('an LLP that is not released has no free units; a partial fit names what is free', async () => {
  const rig = await makeHttpRig(load, routeWith({ held: ['farms', 'agg.held-none'] }));
  const r = await createOversellGuard(rig).check(await rig.cred(MEENA), { llpId: C, units: 2 });
  assert.deepEqual([r.reason, r.label], ['not-released', 'Block C']);
  assert.equal(oversellMessage('Block B', 1, 2), 'Block B has only 1 free unit for 2 units.');
});

test("TC-IM06-017 (console side): Zoho's Deluge refusal of an allotment insert is named 'oversell' with the LLP and its free units", async () => {
  // Our token saw room (a narrower book), Zoho counted the whole org and refused.
  let n = 0;
  const held = () => (n++ === 0 ? ['farms', 'agg.held-none'] : ['farms', 'agg.held-b-full']);
  const route = (c) => (c.path === '/coql' && /group by/.test(c.query) ? held() : routeWith({ insert: ['farms', 'write.guard-oversell-refused'] })(c));
  const rig = await makeHttpRig(load, route);
  const r = await createOversellGuard(rig).insertAllotment(await rig.cred(MEENA), { llpId: B, units: 2 }, fields);
  assert.deepEqual([r.ok, r.reason, r.by, r.free], [false, 'no-free-units', 'zoho', 0]);
  assert.equal(r.message, 'Block B has no free units for 2 units.');
});

test('a write failure that is not the guard (a missing mandatory field) is passed on unnamed', async () => {
  const rig = await makeHttpRig(load, routeWith({ held: ['farms', 'agg.held-none'], insert: ['farms', 'write.mandatory-missing'] }));
  const r = await createOversellGuard(rig).insertAllotment(await rig.cred(MEENA), { llpId: B, units: 2 }, fields);
  assert.deepEqual([r.ok, r.kind, r.error.code], [false, 'write-failed', 'MANDATORY_NOT_FOUND']);
});

test('bad input is refused without a call', async () => {
  const rig = await makeHttpRig(load, routeWith());
  const g = createOversellGuard(rig), cred = await rig.cred(MEENA);
  assert.equal((await g.check(cred, { llpId: "x' or 1=1", units: 2 })).reason, 'invalid-request');
  assert.equal((await g.check(cred, { llpId: B, units: 1.5 })).reason, 'invalid-request');
  assert.equal(rig.calls.length, 0);
});
