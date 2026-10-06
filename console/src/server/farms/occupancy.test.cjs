/* M11-S03-T02 — the shelf counted off the allotments, and who is on which LLP, on recorded Zoho answers.
   Run from console/: node --test src/server/farms/occupancy.test.cjs */
'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { compile, makeRig, recorded, P } = require('../cases/fixture-rig.cjs');

const load = compile(['server/farms/occupancy.ts', 'server/data/events.ts', 'server/identity/plane-c.ts']);
const { createFarmOccupancy, OCCUPANT_FIELDS } = load('server/farms/occupancy.js');
const FIN = `${P}740993001`, NEHA = `${P}740994002`, ROHIT = `${P}740995001`, CONV = `${P}740995900`, AUD = `${P}740993009`;
const A = `${P}740998301`, B = `${P}740998302`, C = `${P}740998303`;
const ok = (data) => ({ status: 200, headers: { 'content-type': 'application/json' }, body: { data, info: { count: data.length, more_records: false } } });
const routeWith = (over = {}) => (q) => {
  if (/COUNT\(id\)/.test(q)) return ['farms', 'agg.units'];
  if (/group by LLP, Allocation_Status/.test(q)) return over.counts ?? ['farms', 'agg.occupancy'];
  if (/Total_Amount_Receivable = 0/.test(q)) return over.paid ?? ['farms', 'agg.occupancy-paid'];
  if (/from LLP_UnitAllocation_Module where \(/.test(q)) return over.occupants ? over.occupants(q) : ['farms', 'coql.occupants'];
  return ['farms', 'coql.demo-llps'];
};
const read = async (rig, id, seat) => createFarmOccupancy(rig).read({ credential: await rig.cred(id), seat });

test("TC-IM06-001: the demo book reads '8.0 acres · 208 units · 96 released' — 96 released, 35 allotted, 5 reserved or paid, 56 free", async () => {
  const rig = await makeRig(load, routeWith());
  const r = await read(rig, FIN, 'fin');
  assert.equal(r.ok, true);
  assert.deepEqual(r.tiles, { acres: 8, units: 208, released: 96, allotted: 35, reservedOrPaid: 5, free: 56, oversold: false });
  assert.equal(r.tiles.acres.toFixed(1), '8.0');
  assert.equal(r.countsComplete, true);
  assert.equal(r.money, true);
});

test("TC-IM06-002: Block B reads '6 allotted · 5 reserved · 23 free'; Block C is not released", async () => {
  const rig = await makeRig(load, routeWith());
  const r = await read(rig, FIN, 'fin');
  const b = r.llps.find((x) => x.id === B), c = r.llps.find((x) => x.id === C), a = r.llps.find((x) => x.id === A);
  assert.deepEqual([b.allotted, b.reserved, b.paid, b.free, b.oversold], [6, 5, 0, 23, false]);
  assert.deepEqual([a.allotted, a.reservedOrPaid, a.free], [29, 0, 33]);
  assert.equal(c.notReleased, true);
  // The LLP's typed Units_Issued (7) disagrees with the count (6): flagged; the arithmetic stands.
  assert.equal(b.recordedDiffers, true);
  assert.equal(a.recordedDiffers, false);
});

test('who is on which LLP: every live allotment the seat may open, with name and ARL code; nothing cached but counts', async () => {
  const rig = await makeRig(load, routeWith());
  const r = await read(rig, FIN, 'fin');
  assert.deepEqual(r.occupants.map((o) => [o.code, o.llpId === B ? 'B' : 'A', o.status, o.units, o.paid]),
    [['ARL-INV-0208', 'B', 'Reserved', 1, false], ['ARL-INV-0209', 'B', 'Reserved', 4, false], ['ARL-INV-0216', 'B', 'Issued', 2, false], ['ARL-INV-0205', 'A', 'Issued', 4, false]]);
  assert.ok(!/Total_Amount|50000/.test(JSON.stringify(r)));
  await read(rig, FIN, 'fin');
  assert.equal(rig.queries.filter((q) => /group by LLP, Allocation_Status/.test(q)).length, 1);   // counts cached (org)
  assert.equal(rig.queries.filter((q) => /from LLP_UnitAllocation_Module where \(/.test(q) && !/group by/.test(q)).length, 2); // rows re-read
});

test('a paid reservation is split out for a Money seat', async () => {
  const rig = await makeRig(load, routeWith({ paid: ok([{ LLP: { id: B }, 'SUM(Reserved_Units)': 1 }]) }));
  const b = (await read(rig, FIN, 'fin')).llps.find((x) => x.id === B);
  assert.deepEqual([b.reservedOrPaid, b.paid, b.reserved, b.free], [5, 1, 4, 23]);
});

test('more held than released is oversold, never a negative free on the block', async () => {
  const counts = ok([{ LLP: { id: B }, Allocation_Status: 'Reserved', 'SUM(Reserved_Units)': 40, 'SUM(Issued_Units)': 0 }]);
  const rig = await makeRig(load, routeWith({ counts }));
  const b = (await read(rig, FIN, 'fin')).llps.find((x) => x.id === B);
  assert.deepEqual([b.free, b.oversold], [0, true]);
});

test('a KAM: no money field, KAM = me through the lookup, own counts key (not Finance\'s), counts marked incomplete', async () => {
  const mine = (q) => { const r = recorded('farms', 'coql.occupants'); r.body.data = r.body.data.filter((x) => x['Customer.KAM'] && x['Customer.KAM'].id === NEHA); return r; };
  const rig = await makeRig(load, routeWith({ occupants: mine }));
  await read(rig, FIN, 'fin');
  const r = await read(rig, NEHA, 'kam');
  assert.equal(r.money, false);
  assert.equal(r.countsComplete, false);
  assert.ok(r.llps.every((x) => x.paid === null && x.recordedDiffers === false));
  assert.deepEqual(r.occupants.map((o) => o.code), ['ARL-INV-0216']);
  const occ = rig.queries.filter((q) => /from LLP_UnitAllocation_Module where \(/.test(q) && !/group by/.test(q)).pop();
  assert.match(occ, new RegExp(`Customer.KAM = '${NEHA}'`));
  assert.ok(!/Total_Amount/.test(occ));
  assert.equal(rig.queries.filter((q) => /Total_Amount_Receivable = 0/.test(q)).length, 1); // Finance's only
  assert.equal(rig.queries.filter((q) => /group by LLP, Allocation_Status/.test(q)).length, 2); // a KAM never reads Finance's cached count
  assert.ok(!OCCUPANT_FIELDS.some((f) => /amount|price|pan|bank/i.test(f)));
});

test("an IR sees only their own-lead investors on the land; a row from another IR's lead refuses the read (Plane B)", async () => {
  const rig = await makeRig(load, routeWith({ occupants: () => ['farms', 'coql.occupants-ir'] }));
  const r = await read(rig, ROHIT, 'ir');
  assert.deepEqual(r.occupants.map((o) => o.code), ['ARL-INV-0208']);
  assert.match(rig.queries.filter((q) => /from LLP_UnitAllocation_Module where \(/.test(q) && !/group by/.test(q)).pop(), new RegExp(`Customer.Originating_IR = '${ROHIT}'\\) and Customer.Origin_Lead is not null`));
  const leak = await makeRig(load, routeWith());
  const bad = await read(leak, ROHIT, 'ir');
  assert.deepEqual(bad, { ok: false, kind: 'refused', reason: 'scope-drift' });
  assert.ok(leak.sink.records().some((x) => x.kind === 'refusal' && x.action === 'farm-occupancy' && x.reason === 'scope-drift'));
});

test('a seat with no Investors book sees the numbers and no names; the Auditor reads the same shelf as Finance', async () => {
  const rig = await makeRig(load, routeWith());
  const r = await read(rig, CONV, 'conv');
  assert.equal(r.namesShown, false);
  assert.deepEqual(r.occupants, []);
  assert.equal(rig.queries.filter((q) => /from LLP_UnitAllocation_Module where \(/.test(q) && !/group by/.test(q)).length, 0);
  const au = await read(rig, AUD, 'audit');
  assert.equal(au.tiles.free, 56);
});

test('a Zoho failure on the count is a source error, never a zero shelf', async () => {
  const rig = await makeRig(load, routeWith({ counts: { status: 500, body: { code: 'INTERNAL_ERROR' } } }));
  const r = await read(rig, FIN, 'fin');
  assert.equal(r.kind, 'source-error');
});
