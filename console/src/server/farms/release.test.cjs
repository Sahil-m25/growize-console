/* M11-S04-T01 — release a farm LLP's units or take them back, on recorded Zoho answers (never live Zoho).
   Run from console/: node --test src/server/farms/release.test.cjs */
'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { compile, makeHttpRig, P } = require('../cases/fixture-rig.cjs');

const load = compile(['server/farms/release.ts', 'server/farms/occupancy.ts', 'server/data/events.ts', 'server/identity/plane-c.ts']);
const { createFarmRelease, mayReleaseLand, heldMessage } = load('server/farms/release.js');
const { guardRefusalOf } = load('lib/zoho/client.js');
const HARSHA = `${P}740993001`, MEENA = `${P}740993002`;
const A = `${P}740998301`, C = `${P}740998303`;
const VA = '2026-09-27T10:00:00+05:30', VC = '2026-09-27T10:10:00+05:30';

/** LLP read by id, the held count by LLP, and the write's answer. */
const routeWith = (over = {}) => (c) => {
  if (c.path === '/coql') {
    const q = c.query;
    if (/from LLP_Creation_Module/.test(q)) return q.includes(A) ? ['farms', 'coql.guard-llp-a'] : ['farms', 'coql.guard-llp-c'];
    if (/group by Allocation_Status/.test(q)) return over.held ?? (q.includes(A) ? ['farms', 'agg.held-a'] : ['farms', 'agg.held-none']);
    throw new Error(`unexpected query ${q}`);
  }
  if (c.method === 'PUT') return over.write ?? (c.path.endsWith(A) ? ['farms', 'write.llp-a-taken-back'] : ['farms', 'write.llp-c-released']);
  throw new Error(`unexpected ${c.method} ${c.path}`);
};
const as = async (rig, id, seat) => ({ credential: await rig.cred(id), seat });

test('only the Head of Finance holds the farm capability (the one policy); Finance Operations, KAM, IR and the rest do not', () => {
  assert.equal(mayReleaseLand('head', HARSHA), true);
  for (const s of ['fin', 'comp', 'kam', 'amlead', 'ir', 'conv', 'exec', 'bu', 'cp', 'nonsense']) assert.equal(mayReleaseLand(s, HARSHA), false, s);
  // The super user's Zoho seat is an Administrator profile: the policy admits it to no console write.
  assert.equal(mayReleaseLand('di', HARSHA), false);
});

test("TC-IM06-004: Harsha releases Block C — Units_Released = 54, guarded with the LLP's version", async () => {
  const rig = await makeHttpRig(load, routeWith());
  const r = await createFarmRelease(rig).release(await as(rig, HARSHA, 'head'), C, VC);
  assert.equal(r.ok, true);
  assert.deepEqual([r.label, r.released, r.version], ['Block C', 54, '2026-09-28T11:30:00+05:30']);
  const [w] = rig.writes();
  assert.equal(w.method, 'PUT');
  assert.equal(w.path, `/LLP_Creation_Module/${C}`);
  assert.deepEqual(w.body, { data: [{ Units_Released: 54 }] });
  assert.equal(w.headers['if-unmodified-since'], VC);
  // 96 released before + 54 = the page's "150 released" (the shelf re-reads Units_Released).
  assert.equal(96 + r.released, 150);
});

test("TC-IM06-005: 'Take it back' on Block A with 29 units held is refused in-page, naming 29 — nothing written", async () => {
  const rig = await makeHttpRig(load, routeWith());
  const r = await createFarmRelease(rig).takeBack(await as(rig, HARSHA, 'head'), A, VA);
  assert.deepEqual([r.ok, r.kind, r.reason, r.held], [false, 'refused', 'units-held', 29]);
  assert.match(r.message, /^Block A has 29 units held by investors and cannot be taken back/);
  assert.equal(rig.writes().length, 0);
  const q = rig.calls.map((c) => c.query).filter(Boolean).find((x) => /group by Allocation_Status/.test(x));
  assert.match(q, new RegExp(`LLP = '${A}' and Allocation_Status in \\('Reserved', 'Issued'\\)`));
  const line = rig.sink.records().find((x) => x.action === 'farm-take-back');
  assert.ok(line && line.reason === 'units-held');
  assert.ok(!/29 units|Block A/.test(JSON.stringify(rig.sink.records())), 'logs hold ids and codes only');
});

test('take back with nothing held writes Units_Released = 0', async () => {
  const rig = await makeHttpRig(load, routeWith({ held: ['farms', 'agg.held-none'] }));
  const r = await createFarmRelease(rig).takeBack(await as(rig, HARSHA, 'head'), A, VA);
  assert.equal(r.ok, true);
  assert.deepEqual(rig.writes()[0].body, { data: [{ Units_Released: 0 }] });
});

test("the Deluge guard's refusal (another door raced us) is named 'units-held' with the units counted again", async () => {
  let n = 0;
  const held = () => (n++ === 0 ? ['farms', 'agg.held-none'] : ['farms', 'agg.held-a']);
  const route = (c) => (c.path === '/coql' && /group by/.test(c.query) ? held() : routeWith({ write: ['farms', 'write.guard-units-held-refused'] })(c));
  const rig = await makeHttpRig(load, route);
  const r = await createFarmRelease(rig).takeBack(await as(rig, HARSHA, 'head'), A, VA);
  assert.deepEqual([r.kind, r.reason, r.held], ['refused', 'units-held', 29]);
  assert.equal(r.message, heldMessage('Block A', 29));
  assert.ok(!JSON.stringify(r).includes('Fixture Block A has'), "Zoho's message is not passed through");
});

test('TC-IM06-006: Finance Operations (Meena) cannot release or take back — refused before any read', async () => {
  const rig = await makeHttpRig(load, routeWith());
  const svc = createFarmRelease(rig);
  for (const r of [await svc.release(await as(rig, MEENA, 'fin'), C, VC), await svc.takeBack(await as(rig, MEENA, 'fin'), A, VA)]) {
    assert.deepEqual([r.ok, r.kind, r.reason], [false, 'refused', 'read-only']);
  }
  assert.equal(rig.calls.length, 0);
});

test('a stale version is a conflict before the write; a 412 from Zoho is a conflict too', async () => {
  const rig = await makeHttpRig(load, routeWith());
  const r = await createFarmRelease(rig).release(await as(rig, HARSHA, 'head'), C, '2026-09-20T10:00:00+05:30');
  assert.deepEqual([r.ok, r.kind, r.recordId], [false, 'conflict', C]);
  assert.equal(rig.writes().length, 0);
  const rig2 = await makeHttpRig(load, routeWith({ write: ['farms', 'write.llp-modified'], held: ['farms', 'agg.held-none'] }));
  const r2 = await createFarmRelease(rig2).takeBack(await as(rig2, HARSHA, 'head'), A, VA);
  assert.equal(r2.kind, 'conflict');
});

test('already released / not released / bad ids are named refusals', async () => {
  const rig = await makeHttpRig(load, routeWith());
  const svc = createFarmRelease(rig), h = await as(rig, HARSHA, 'head');
  assert.equal((await svc.release(h, A, VA)).reason, 'already-released');
  assert.equal((await svc.takeBack(h, C, VC)).reason, 'not-released');
  assert.equal((await svc.release(h, "1' or '1'='1", null)).reason, 'invalid-request');
  assert.equal((await svc.release(h, C, 'yesterday')).reason, 'invalid-request');
});

test('guardRefusalOf: a record-level refusal on the rule field is the named guard; a missing field is not', () => {
  const rec = (code, field) => ({ kind: 'invalid-data', status: 400, code, field, records: [{ index: 0, ok: false, id: null, code, field, action: null, modifiedTime: null }] });
  assert.deepEqual(guardRefusalOf('LLP_Creation_Module', rec('INVALID_DATA', 'Units_Released')), { name: 'units-held', code: 'INVALID_DATA', field: 'Units_Released' });
  assert.deepEqual(guardRefusalOf('LLP_UnitAllocation_Module', rec('INVALID_DATA', 'Reserved_Units')).name, 'oversell');
  assert.equal(guardRefusalOf('LLP_UnitAllocation_Module', rec('MANDATORY_NOT_FOUND', 'Reserved_Units')), null);
  assert.equal(guardRefusalOf('LLP_Creation_Module', rec('INVALID_DATA', 'Name')), null);
  assert.equal(guardRefusalOf('Contacts', rec('INVALID_DATA', 'Units_Released')), null);
  assert.equal(guardRefusalOf('LLP_Creation_Module', { kind: 'conflict', status: 412, code: 'ALREADY_MODIFIED', recordId: null }), null);
});
