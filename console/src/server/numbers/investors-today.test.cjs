/* M05-S06-T01 — the headline figures on Today (Investors side), on recorded Zoho answers (__fixtures__/today-inv,
   farms). The receipts aggregate is worked out from recorded receipt ROWS by a small COQL emulator that applies the
   query's own Match_State filter, so "only matched money counts" is proved on what the query asks, and the same rows
   feed money/register.ts to prove the two agree. Run from console/: node --test src/server/numbers/investors-today.test.cjs */
'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { compile, makeRig, recorded, P, NOW } = require('../cases/fixture-rig.cjs');

const load = compile(['server/numbers/investors-today.ts', 'server/money/register.ts', 'server/data/events.ts', 'server/identity/plane-c.ts']);
const { createInvestorsToday, TODAY_TTL_MS } = load('server/numbers/investors-today.js');
const { createPaymentsRegister } = load('server/money/register.js');
const { createMemorySink, createOpsLog } = load('lib/zoho/log.js');
const FIN = `${P}740993001`, HEAD = `${P}740993002`, KAM = `${P}740994002`;
const ok = (data) => ({ status: 200, headers: { 'content-type': 'application/json' }, body: { data, info: { count: data.length, more_records: false } } });

/** Zoho's GROUP BY Allotment, Kind over recorded rows, honouring the query's Match_State and Allotment IN filters. */
function receiptsAggregate(q, rowsName) {
  let rows = recorded('today-inv', rowsName).body.data;
  const st = /Match_State = '([^']+)'/.exec(q);
  if (st) rows = rows.filter((r) => r.Match_State === st[1]);
  const ins = /Allotment in \(([^)]*)\)/.exec(q);
  if (ins) { const ids = ins[1].split(',').map((s) => s.trim().replace(/'/g, '')); rows = rows.filter((r) => ids.includes(r.Allotment.id)); }
  const g = new Map();
  for (const r of rows) { const k = `${r.Allotment.id}|${r.Kind}`; g.set(k, (g.get(k) ?? 0) + r.Amount); }
  return ok([...g].map(([k, v]) => ({ Allotment: { id: k.split('|')[0], name: 'x' }, Kind: k.split('|')[1], 'SUM(Amount)': v })));
}
const routeWith = (rowsName = 'receipts.rows') => (q) => {
  if (/from Receipts/.test(q) && /SUM\(Amount\)/.test(q)) return receiptsAggregate(q, rowsName);
  if (/from Receipts/.test(q)) return ['today-inv', rowsName];
  if (/group by LLP, Allocation_Status/.test(q)) return ['farms', 'agg.occupancy'];
  if (/SUM\(Units_Released\)/.test(q)) return ['today-inv', 'agg.llp-units'];
  if (/from Cases/.test(q)) return ['today-inv', 'agg.cases'];
  if (/Allocation_Status = 'Reserved' order by id asc limit/.test(q) && /Reserved_Units, Unit_Price from/.test(q) && !/Customer/.test(q)) return ['today-inv', 'allotments.reserved'];
  if (/from LLP_UnitAllocation_Module/.test(q)) {
    const all = recorded('today-inv', 'allotments.all').body.data;
    if (/Allocation_Status = 'Reserved'/.test(q)) return ok(all.filter((x) => x.Allocation_Status === 'Reserved'));
    const ins = /id in \(([^)]*)\)/.exec(q); const ids = ins ? ins[1].split(',').map((s) => s.trim().replace(/'/g, '')) : [];
    return ok(all.filter((x) => ids.includes(x.id)));
  }
  throw new Error('unrouted ' + q);
};
const cr = (n) => (n / 1e7).toFixed(2);

test("TC-IM03-001: Harsha's day — ₹8.88 Cr banked, ₹1.13 Cr outstanding, 40 / 96 units held of released, 6 tickets open", async () => {
  const rig = await makeRig(load, routeWith());
  const r = await createInvestorsToday(rig).read({ credential: await rig.cred(HEAD), seat: 'head' });
  assert.equal(r.ok, true);
  const v = r.value;
  assert.equal(v.money.state, 'fresh'); assert.equal(v.units.state, 'fresh'); assert.equal(v.tickets.state, 'fresh');
  assert.equal(cr(v.money.value.banked), '8.88'); assert.equal(v.money.value.banked, 88_750_000);
  assert.equal(cr(v.money.value.outstanding), '1.13'); assert.equal(v.money.value.outstanding, 11_250_000);
  assert.equal(`${v.units.value.held} / ${v.units.value.released}`, '40 / 96');
  assert.equal(v.tickets.value.open, 6);
  assert.equal(v.stale, false);
  assert.equal(v.asOf, NOW);   // TC-IM03-013: the time the figures were read ("as of 11:30")
});

test('TC-IM03-002: a receipt recorded but not matched moves neither banked nor outstanding (MEENA_RECORDED_PRAKASH_BALANCE)', async () => {
  const rig = await makeRig(load, routeWith('receipts.rows-with-pending'));
  const v = (await createInvestorsToday(rig).read({ credential: await rig.cred(HEAD), seat: 'head' })).value;
  assert.equal(v.money.value.banked, 88_750_000);
  assert.equal(v.money.value.outstanding, 11_250_000);
  assert.ok(rig.queries.some((q) => /from Receipts where Match_State = 'Matched'/.test(q)));
});

test('agrees with money/register.ts on the same receipts once every one is matched (banked = net banked, outstanding = still due)', async () => {
  const rig = await makeRig(load, routeWith());
  const cred = await rig.cred(HEAD);
  const today = (await createInvestorsToday(rig).read({ credential: cred, seat: 'head' })).value.money.value;
  const reg = createPaymentsRegister({ crm: rig.crm, log: createOpsLog(createMemorySink()), recordIdPrefix: P, clock: () => NOW,
    access: { async recheck(c) { return { actor: { userId: c.userId }, seesRegister: true, seesUtr: false, canRecord: true }; } } });
  const out = await reg.read({ credential: cred, sessionId: 'session_fixture_00000001' });
  assert.equal(out.ok, true);
  assert.equal(out.value.totals.netBanked, today.banked);
  assert.equal(out.value.totals.stillDue, today.outstanding);
});

test('TC-IM03-015: a cold render spends at most five COQL calls; a reload inside the TTL spends none and reads the same', async () => {
  const rig = await makeRig(load, routeWith());
  const cred = await rig.cred(HEAD);
  const reader = createInvestorsToday(rig);
  const first = await reader.read({ credential: cred, seat: 'head' });
  assert.ok(rig.queries.length <= 5, `${rig.queries.length} calls`);
  const n = rig.queries.length;
  const second = await reader.read({ credential: cred, seat: 'head' });
  assert.equal(rig.queries.length, n, 'no COQL inside the TTL');
  assert.deepEqual(second.value.money.value, first.value.money.value);
  assert.deepEqual(second.value.units.value, first.value.units.value);
  assert.ok(TODAY_TTL_MS >= 30_000 && TODAY_TTL_MS <= 60_000);
});

test('the cache holds aggregates only, keyed by scope: Finance and Head (both org) share; a KAM never reads the money tile', async () => {
  const rig = await makeRig(load, routeWith());
  await createInvestorsToday(rig).read({ credential: await rig.cred(HEAD), seat: 'head' });
  const n = rig.queries.length;
  await createInvestorsToday(rig).read({ credential: await rig.cred(FIN), seat: 'fin' });
  assert.equal(rig.queries.length, n, 'the org scope is one key');
  const kam = await createInvestorsToday(rig).read({ credential: await rig.cred(KAM), seat: 'kam' });
  assert.equal(kam.ok, true);
  assert.equal(kam.value.money.state, 'hidden');
  assert.ok(!/banked|outstanding/.test(JSON.stringify(kam.value)));
});

test('D41: a failed read is an error tile, not an old number; the page reads stale', async () => {
  const rig = await makeRig(load, (q) => (/from Receipts/.test(q) ? { status: 500, headers: {}, body: { code: 'INTERNAL_ERROR' } } : routeWith()(q)));
  const v = (await createInvestorsToday(rig).read({ credential: await rig.cred(HEAD), seat: 'head' })).value;
  assert.equal(v.money.state, 'error');
  assert.equal(v.units.state, 'fresh');
  assert.equal(v.stale, true);
  assert.ok(!('value' in v.money));
});

test('a seat with no Investors book is refused', async () => {
  const rig = await makeRig(load, routeWith());
  const r = await createInvestorsToday(rig).read({ credential: await rig.cred(`${P}740995001`), seat: 'cp' });
  assert.equal(r.ok, false);
});
