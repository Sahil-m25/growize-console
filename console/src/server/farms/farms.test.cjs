/* M11-S01-T02 — the LLP shelf on recorded Zoho answers. Run from console/: node --test src/server/farms/farms.test.cjs */
'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { compile, makeRig, P } = require('../cases/fixture-rig.cjs');

const load = compile(['server/farms/shelf.ts', 'server/data/events.ts', 'server/identity/plane-c.ts']);
const { createFarmShelf, farmStatusOf, SHELF_FIELDS } = load('server/farms/shelf.js');
const FIN = `${P}740993001`, SAHIL = `${P}740990001`, IR = `${P}740995001`;
const route = (q) => /COUNT\(id\)/.test(q) ? ['farms', 'agg.units'] : /where \(id = /.test(q) ? ['farms', 'coql.llp-one'] : ['farms', 'coql.llps'];

test('one row per LLP with total, reserved, issued, free (computed on read) and price; statuses as the org holds them', async () => {
  const rig = await makeRig(load, route);
  const shelf = createFarmShelf(rig);
  const r = await shelf.list({ credential: await rig.cred(FIN), seat: 'fin' });
  assert.equal(r.ok, true);
  assert.equal(r.rows.length, 4);
  const [a, b, c, d] = r.rows;
  assert.deepEqual([a.name, a.status, a.totalUnits, a.reservedUnits, a.issuedUnits, a.freeUnits, a.onSale], ['Growize Farm LLP A', 'Fully Subscribed', 62, 0, 62, 0, false]);
  assert.deepEqual([b.status, b.freeUnits, b.unitPrice, b.onSale, b.reservable, b.yieldPct], ['Open for Reservation', 3, 2500000, true, true, null]);
  // "Darft" (the org's typo) reads as Draft: not on sale, no reservation.
  assert.deepEqual([c.status, c.onSale, c.reservable, c.freeUnits, c.yieldPct, c.cropStage], ['Draft', false, false, 35, 20, null]);
  assert.deepEqual([d.status, d.onSale, d.totalUnits, d.freeUnits, d.yieldPct], ['On Hold', false, null, null, null]);
  assert.equal(a.insurance.till, '2027-03-31');
  assert.equal(r.superUser, false);
  assert.equal(r.totals.state, 'fresh');
  assert.deepEqual(r.totals.value, { llps: 4, total: 124, reserved: 5, issued: 81, free: 38 });
  // The list never selects PAN, GST or a SPOC; the query names the org's fields.
  const list = rig.queries.find((q) => /from LLP_Creation_Module where \(id is not null\)/.test(q) && !/COUNT/.test(q));
  assert.ok(!/\bPAN\b|\bGST\b|SPOC/.test(list));
  assert.match(list, /Pet_Unit_Price/);
  assert.ok(!SHELF_FIELDS.includes('PAN'));
});

test('status moves are read, never kept: the next read shows the new status', () => {
  for (const [raw, st] of [['Open for Reservation', 'Open for Reservation'], ['Open for Issuance', 'Open for Issuance'], ['Fully Subscribed / Closed', 'Fully Subscribed'], ['Active', 'Active'], ['Darft', 'Draft'], ['-None-', 'Unknown'], [null, 'Unknown']]) assert.equal(farmStatusOf(raw), st);
});

test('totals are cached under the farms scope: org for Finance, all for the super user — rows are re-read every time', async () => {
  const rig = await makeRig(load, route);
  const shelf = createFarmShelf(rig);
  await shelf.list({ credential: await rig.cred(FIN), seat: 'fin' });
  await shelf.list({ credential: await rig.cred(FIN), seat: 'fin' });
  assert.equal(rig.queries.filter((q) => /COUNT/.test(q)).length, 1);
  assert.equal(rig.queries.filter((q) => !/COUNT/.test(q)).length, 2);
  const s = await shelf.list({ credential: await rig.cred(SAHIL), seat: 'ops' });
  assert.equal(s.superUser, true);
  assert.equal(rig.queries.filter((q) => /COUNT/.test(q)).length, 2); // role:all is its own key
});

test('one LLP: PAN and GST masked before they leave the server, SPOCs and insurance shown', async () => {
  const rig = await makeRig(load, route);
  const r = await createFarmShelf(rig).one({ credential: await rig.cred(SAHIL), seat: 'ops' }, `${P}740998102`);
  assert.equal(r.ok, true);
  assert.equal(r.farm.pan, 'AAZ•••••Q');
  assert.ok(!JSON.stringify(r).includes('AAZFX1234Q'));
  assert.ok(!r.farm.gst.includes('1234'));
  assert.deepEqual(r.farm.spocs, [{ name: 'Fixture Spoc One', phone: '+910000000001' }]);
  assert.equal(r.farm.insurance.provider, 'Fixture Insurer');
  assert.equal(r.superUser, true);
  // Nothing identifying reaches Plane B.
  assert.ok(!JSON.stringify(rig.sink.records()).includes('AAZFX'));
});

test('a malformed id is refused before any call; an LLP the token cannot see is not found and logged by id', async () => {
  const rig = await makeRig(load, (q) => /where \(id = /.test(q) ? { status: 204, body: null } : ['farms', 'coql.llps']);
  const shelf = createFarmShelf(rig);
  const cred = await rig.cred(FIN);
  assert.deepEqual(await shelf.one({ credential: cred, seat: 'fin' }, "1' or 1=1"), { ok: false, kind: 'refused', reason: 'invalid-request' });
  assert.equal(rig.queries.length, 0);
  const r = await shelf.one({ credential: cred, seat: 'fin' }, `${P}740998199`);
  assert.equal(r.reason, 'not-found');
  assert.ok(rig.sink.records().some((x) => x.kind === 'refusal' && x.reason === 'not-visible'));
});

test('an unknown seat has no shelf (the guard refuses IR at the page; the reader refuses a seat without the book too)', async () => {
  const rig = await makeRig(load, route);
  const r = await createFarmShelf(rig).list({ credential: await rig.cred(IR), seat: 'nobody' });
  assert.deepEqual(r, { ok: false, kind: 'refused', reason: 'no-book' });
  assert.equal(rig.queries.length, 0);
});

test('a Zoho failure is a source error, never an empty shelf', async () => {
  const rig = await makeRig(load, () => ({ status: 500, body: { code: 'INTERNAL_ERROR' } }));
  const r = await createFarmShelf(rig).list({ credential: await rig.cred(FIN), seat: 'fin' });
  assert.equal(r.ok, false);
  assert.equal(r.kind, 'source-error');
});
