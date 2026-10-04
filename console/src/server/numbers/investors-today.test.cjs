/* M05-S06-T01 — the headline figures on Today (Investors side), on recorded Zoho answers (__fixtures__/today-inv,
   farms). The money ledger's receipt rows come from a small COQL emulator over the recorded rows (fixture-rig
   receiptRows: it honours the query's filters and fields), so "only matched money counts" is proved on what the
   ledger reads, and the same rows feed money/register.ts to prove the two agree. Run from console/: node --test src/server/numbers/investors-today.test.cjs */
'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { compile, makeRig, recorded, receiptRows, P, NOW } = require('../cases/fixture-rig.cjs');

const load = compile(['server/numbers/investors-today.ts', 'server/money/register.ts', 'server/data/events.ts', 'server/identity/plane-c.ts']);
const { createInvestorsToday, TODAY_TTL_MS } = load('server/numbers/investors-today.js');
const { createPaymentsRegister } = load('server/money/register.js');
const { createMemorySink, createOpsLog } = load('lib/zoho/log.js');
const FIN = `${P}740993001`, HEAD = `${P}740993002`, KAM = `${P}740994002`;
const ok = (data) => ({ status: 200, headers: { 'content-type': 'application/json' }, body: { data, info: { count: data.length, more_records: false } } });

const routeWith = (rowsName = 'receipts.rows', extra = []) => (q) => {
  const rows = [...recorded('today-inv', rowsName).body.data, ...extra];
  if (/^select id, Allotment, Kind, Amount, Match_State, Reversal_Of/.test(q)) return receiptRows(q, rows);
  if (/from Receipts/.test(q)) return extra.length ? ok(rows) : ['today-inv', rowsName];
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
  assert.ok(rig.queries.some((q) => /^select id, Allotment, Kind, Amount, Match_State, Reversal_Of from Receipts where \(id is not null\)/.test(q)),
    'the ledger rows (M01-S08-NOTE-3) — every state read, only Matched counted');
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

test('D21: with a Pending receipt on the book, Today and the register still agree — the Pending money is the register\'s "recorded", in neither figure', async () => {
  const rig = await makeRig(load, routeWith('receipts.rows-with-pending'));
  const cred = await rig.cred(HEAD);
  const today = (await createInvestorsToday(rig).read({ credential: cred, seat: 'head' })).value.money.value;
  const reg = createPaymentsRegister({ crm: rig.crm, log: createOpsLog(createMemorySink()), recordIdPrefix: P, clock: () => NOW,
    access: { async recheck(c) { return { actor: { userId: c.userId }, seesRegister: true, seesUtr: false, canRecord: true }; } } });
  const out = await reg.read({ credential: cred, sessionId: 'session_fixture_00000001' });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.value.totals.netBanked, today.banked);
  assert.equal(out.value.totals.stillDue, today.outstanding);
  assert.ok(out.value.totals.recorded.net > 0, 'the Pending receipt is shown as recorded, not yet matched');
});

test('TC-IM12-001 (Dashboard) / TC-IM03-015: a cold render spends at most five COQL calls; a reload inside the TTL spends none and reads the same', async () => {
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

test('M01-S08-NOTE-3: on a mixed ledger (refund, reversal of matched / pending / flipped, pending reversal) Today equals the register', async () => {
  const base = recorded('today-inv', 'receipts.rows-with-pending').body.data;
  const XJ = `${P}740996204`, XK = `${P}740996205`;
  const row = (n, allot, Kind, Amount, Match_State, reversalOf = null) => ({ ...base[0], id: `${P}7409954${n}`, Allotment: { id: allot, name: 'x' }, Kind, Amount, Match_State,
    UTR: `SYNTHTODAY${n}`, Reversal_Of: reversalOf ? { id: reversalOf, name: 'x' } : null });
  const pendingPart = base.find((r) => r.Allotment.id === XK && r.Match_State === 'Pending');
  const extra = [
    row(60, XK, 'Refund', pendingPart.Amount, 'Matched', pendingPart.id),   // matched reversal of a pending receipt
    row(61, XJ, 'Part', 500_000, 'Reversed'), row(62, XJ, 'Refund', 500_000, 'Matched', `${P}740995461`),   // flipped + its reversal
    row(63, XJ, 'Part', 400_000, 'Matched'), row(64, XJ, 'Refund', 400_000, 'Matched', `${P}740995463`),    // matched reversal of a matched one
    row(65, XJ, 'Refund', 100_000, 'Matched'),                                                             // a refund
    row(66, XJ, 'Advance', 300_000, 'Matched'), row(67, XJ, 'Refund', 300_000, 'Pending', `${P}740995466`), // a pending reversal
  ];
  const rig = await makeRig(load, routeWith('receipts.rows-with-pending', extra));
  const cred = await rig.cred(HEAD);
  const today = (await createInvestorsToday(rig).read({ credential: cred, seat: 'head' })).value.money.value;
  const reg = createPaymentsRegister({ crm: rig.crm, log: createOpsLog(createMemorySink()), recordIdPrefix: P, clock: () => NOW,
    access: { async recheck(c) { return { actor: { userId: c.userId }, seesRegister: true, seesUtr: false, canRecord: true }; } } });
  const out = await reg.read({ credential: cred, sessionId: 'session_fixture_00000001' });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.deepEqual([today.banked, today.outstanding], [out.value.totals.netBanked, out.value.totals.stillDue]);
  assert.deepEqual([today.banked, today.outstanding], [88_750_000 - 100_000 + 300_000, 11_250_000 + 100_000 - 300_000], 'only the refund and the standing advance move a figure');
});
