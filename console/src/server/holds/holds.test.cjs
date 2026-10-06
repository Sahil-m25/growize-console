/* M08-S04-T02 / T04 — the hold clock, the holds and land reads, extend and lapse, and hold.changed against
   contracts/hold.changed.json — on recorded Zoho answers (__fixtures__/holds, today-inv, farms). No request reaches Zoho.
   Run from console/: node --test src/server/holds/holds.test.cjs */
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const { compile, makeRig, makeHttpRig, recorded, receiptRows, P } = require('../cases/fixture-rig.cjs');

const load = compile(['server/holds/holds.ts', 'server/holds/lapse.ts', 'server/holds/extend.ts', 'server/data/events.ts', 'server/identity/plane-c.ts',
  'server/identity/authority.ts', 'server/contracts/events.ts', 'server/contracts/stub.ts', 'server/money/allotment-receipts.ts']);
const rules = load('server/holds/rules.js');
const { createHolds } = load('server/holds/holds.js');
const { createHoldLapse } = load('server/holds/lapse.js');
const { requestHoldExtension } = load('server/holds/extend.js');
const { createAuthorityEvents } = load('server/identity/authority.js');
const { createPlaneCLog, createPlaneCMemorySink } = load('server/identity/plane-c.js');
const { validateEvent } = load('server/contracts/events.js');
const { loadSchemas } = load('server/contracts/stub.js');
const { createAllotmentReceiptWrites } = load('server/money/allotment-receipts.js');
const { createMemorySink, createOpsLog } = load('lib/zoho/log.js');
const schemas = loadSchemas(path.resolve(__dirname, '..', '..', '..', '..', 'contracts'));

const HEAD = `${P}740993002`, FIN = `${P}740993001`, ROHIT = `${P}740995001`, KAM = `${P}740994002`;
const XJ = `${P}740996204`, XK = `${P}740996205`, PRA = `${P}740997102`;
const SEP02 = Date.parse('2026-09-02T10:00:00+05:30'), SEP26 = Date.parse('2026-09-26T10:00:00+05:30');
const ok = (data) => ({ status: 200, headers: { 'content-type': 'application/json' }, body: { data, info: { count: data.length, more_records: false } } });
/** The ledger's row read (holds/rules readLedgerReceipts) over the recorded receipts, Pending rows included. */
const receiptsLedger = (q, extra = []) => receiptRows(q, [...recorded('today-inv', 'receipts.rows-with-pending').body.data, ...extra]);
const readRoute = (one = 'coql.hold-prakash', extra = []) => (q) => {
  if (/from Receipts/.test(q)) return receiptsLedger(q, extra);
  if (/group by LLP, Allocation_Status/.test(q)) return ['farms', 'agg.occupancy'];
  if (/Total_Amount_Receivable = 0/.test(q)) return ['farms', 'agg.occupancy-paid'];
  if (/from LLP_UnitAllocation_Module where \(Allocation_Status in/.test(q)) return ['farms', 'coql.occupants'];
  if (/Hold_Until <= /.test(q)) return ['holds', 'coql.holds'];
  if (/from LLP_UnitAllocation_Module where \(id = /.test(q)) return ['holds', one];
  if (/from LLP_Creation_Module/.test(q)) return ['farms', 'coql.demo-llps'];
  throw new Error('unrouted ' + q);
};
const holdsOn = (rig, now) => createHolds({ ...rig, clock: () => now });

test('the one IST clock: the first matched advance on 24 Aug holds to 23 Sep; days left and the deadline are Kolkata days', () => {
  assert.equal(rules.holdUntilFrom(Date.parse('2026-08-24T10:00:00+05:30')), '2026-09-23');
  assert.equal(rules.holdUntilFrom(Date.parse('2026-08-23T20:00:00Z')), '2026-09-23');   // 01:30 IST on 24 Aug
  assert.equal(rules.daysLeft('2026-09-23', SEP02), 21);
  assert.equal(rules.daysLeft('2026-09-23', Date.parse('2026-09-23T23:00:00+05:30')), 0);   // running through its last day
  assert.equal(rules.daysLeft('2026-09-23', SEP26), -3);
  assert.equal(rules.extendedDeadline('2026-12-28', 7), '2027-01-04');   // across 31 December, from the old deadline
  assert.deepEqual(rules.lapseMoney(1, 250_000), { forfeit: 50_000, refund: 200_000 });
});

test('TC-IM05-028: hold.changed carries an IST deadline and validates against contracts/hold.changed.json', () => {
  const e = rules.holdChangedEvent({ allotmentId: XK, investorId: PRA, holdDay: rules.holdUntilFrom(Date.parse('2026-08-24T10:00:00+05:30')), state: 'open', at: Date.parse('2026-08-24T10:00:00+05:30'), by: HEAD });
  assert.equal(e.payload.state, 'open');
  assert.equal(e.payload.deadline.slice(0, 10), '2026-09-23');
  assert.match(e.payload.deadline, /\+05:30$/);
  assert.deepEqual(validateEvent(schemas, e), { ok: true, type: 'hold.changed' });
  assert.equal(rules.holdChangedEvent({ allotmentId: XK, investorId: PRA, holdDay: '2026-09-23', state: 'open', at: 1, by: HEAD }).event_id, e.event_id, 'the same fact, the same id');
  assert.equal(validateEvent(schemas, { ...e, payload: { ...e.payload, state: 'gone' } }).ok, false);
});

test('TC-IM03-009: Holds running — ₹2,50,000 exposure; Joseph 19d (4 units · ₹90 L due by 21 Sep) then Prakash 21d (1 unit · ₹22.5 L by 23 Sep)', async () => {
  const rig = await makeRig(load, readRoute());
  const r = await holdsOn(rig, SEP02).list({ credential: await rig.cred(FIN), seat: 'fin' });
  assert.equal(r.ok, true);
  assert.equal(r.exposure, 250_000);
  assert.equal(r.through, '2026-09-23');
  assert.deepEqual(r.holds.map((h) => [h.investor.name, h.daysLeft, h.units, h.due, h.holdEnds, h.urgent]),
    [['Joseph Mathew', 19, 4, 9_000_000, '2026-09-21', false], ['Prakash Bhat', 21, 1, 2_250_000, '2026-09-23', false]]);
  assert.ok(rig.queries.some((q) => /where \(\(Allocation_Status = 'Reserved' and Hold_Until is not null\) and Hold_Until <= '2026-09-23'\)/.test(q)));
  // Meena's recorded-but-unmatched ₹22.5 L against Prakash does not reduce what is due (D21)
  assert.ok(rig.queries.some((q) => /^select id, Allotment, Kind, Amount, Match_State, Reversal_Of from Receipts where \(Allotment in/.test(q)), 'the ledger rows, not an aggregate');
});

test('M01-S08-NOTE-3: holds read money through money/ledger — a reversal cancels its target, a refund is money out, Pending never counts', async () => {
  const base = recorded('today-inv', 'receipts.rows-with-pending').body.data;
  const row = (n, allot, Kind, Amount, Match_State, reversalOf = null) => ({ ...base[0], id: `${P}7409954${n}`, Allotment: { id: allot, name: 'x' }, Kind, Amount, Match_State,
    UTR: `SYNTHHOLD${n}`, Reversal_Of: reversalOf ? { id: reversalOf, name: 'x' } : null });
  const pendingPart = base.find((r) => r.Allotment.id === XK && r.Match_State === 'Pending');
  const extra = [
    row(50, XK, 'Refund', pendingPart.Amount, 'Matched', pendingPart.id),   // matched reversal of Prakash's PENDING ₹22.5 L: cancels it, moves nothing matched
    row(51, XJ, 'Part', 500_000, 'Reversed'),                              // Joseph: a receipt flipped to Reversed…
    row(52, XJ, 'Refund', 500_000, 'Matched', `${P}740995451`),            // …and its matched reversal: counted once, nowhere
    row(53, XJ, 'Refund', 100_000, 'Matched'),                             // a plain refund: money out
    row(54, XJ, 'Advance', 300_000, 'Matched'),                            // …a matched advance…
    row(55, XJ, 'Refund', 300_000, 'Pending', `${P}740995454`),            // …with a PENDING reversal: still stands (D21)
  ];
  const rig = await makeRig(load, readRoute('coql.hold-prakash', extra));
  const r = await holdsOn(rig, SEP02).list({ credential: await rig.cred(FIN), seat: 'fin' });
  assert.equal(r.ok, true, JSON.stringify(r));
  // the old Kind aggregate read these as −₹22.5 L (Prakash) and −₹5 L −₹1 L −₹3 L (Joseph)
  assert.deepEqual(r.holds.map((h) => [h.investor.name, h.due, h.received]),
    [['Joseph Mathew', 9_000_000 + 100_000 - 300_000, 1_000_000 - 100_000 + 300_000], ['Prakash Bhat', 2_250_000, 250_000]]);
  // and the arithmetic is the ledger's own (the register's): matchedMoneyOf over the same rows
  const entries = [...base, ...extra].map(rules.ledgerEntryOf).filter(Boolean);
  const m = rules.matchedMoneyOf(entries);
  assert.deepEqual([m.byAllotment.get(XJ), m.byAllotment.get(XK), m.anomalies.length], [1_200_000, 250_000, 0]);
});

test('TC-IM03-009: Land reads 56 free of 208; Block C is not released — 54 units off the shelf', async () => {
  const rig = await makeRig(load, readRoute());
  const r = await holdsOn(rig, SEP02).land({ credential: await rig.cred(FIN), seat: 'fin' });
  assert.equal(r.ok, true);
  assert.equal(`${r.free} free of ${r.total}`, '56 free of 208');
  const c = r.llps.find((l) => l.id === `${P}740998303`);
  assert.equal(c.notReleased, true);
  assert.equal(c.offShelf, 54);
});

test('Holds running is a Money seat on the whole book: a KAM and an IR are refused', async () => {
  const rig = await makeRig(load, readRoute());
  for (const [id, seat] of [[KAM, 'kam'], [ROHIT, 'ir']]) {
    const r = await holdsOn(rig, SEP02).list({ credential: await rig.cred(id), seat });
    assert.equal(r.ok, false, seat); assert.equal(r.reason, 'no-book');
  }
});

test("TC-IM05-014 / -017: Prakash's record — ₹22.5 L due in 21 days, hold ends 23 Sep, ₹50,000 a unit forfeit, 1 unit; Harsha is offered 'Extend the hold'", async () => {
  const rig = await makeRig(load, readRoute());
  const r = await holdsOn(rig, SEP02).one({ credential: await rig.cred(HEAD), seat: 'head', mayRelease: true }, XK);
  assert.equal(r.ok, true);
  const h = r.hold;
  assert.deepEqual([h.due, h.daysLeft, h.holdEnds, h.forfeit, h.forfeitPerUnit, h.units], [2_250_000, 21, '2026-09-23', 50_000, 50_000, 1]);
  assert.deepEqual(h.offers, { release: false, extend: true });
});

test('TC-IM05-015 / -016: run out 3 days ago — Harsha is offered the release (₹50,000 forfeit, ₹2,00,000 refund); Meena is not', async () => {
  const rig = await makeRig(load, readRoute());
  const harsha = await holdsOn(rig, SEP26).one({ credential: await rig.cred(HEAD), seat: 'head', mayRelease: true }, XK);
  assert.deepEqual([harsha.hold.daysLeft, harsha.hold.ranOut, harsha.hold.urgent], [-3, true, true]);
  assert.deepEqual(harsha.hold.onLapse, { forfeit: 50_000, refund: 200_000 });
  assert.deepEqual(harsha.hold.offers, { release: true, extend: false });
  const meena = await holdsOn(rig, SEP26).one({ credential: await rig.cred(FIN), seat: 'fin', mayRelease: false }, XK);
  assert.equal(meena.hold.due, 2_250_000);
  assert.deepEqual(meena.hold.offers, { release: false, extend: false });
});

test('TC-E08-015 / -016: the IR reads the clock of his own lead (days left, hold end, forfeit a unit) and no money; ≤3 days is urgent', async () => {
  const rig = await makeRig(load, readRoute());
  const r = await holdsOn(rig, Date.parse('2026-09-21T10:00:00+05:30')).one({ credential: await rig.cred(ROHIT), seat: 'ir' }, XK);
  assert.equal(r.ok, true);
  assert.deepEqual([r.hold.daysLeft, r.hold.urgent, r.hold.forfeitPerUnit, r.hold.due, r.hold.onLapse, r.money], [2, true, 50_000, null, null, false]);
  assert.ok(!rig.queries.some((q) => /Unit_Price|from Receipts/.test(q)), 'the IR read names no money field');
  const foreign = await makeRig(load, readRoute('coql.hold-joseph-foreign'));
  const f = await holdsOn(foreign, SEP02).one({ credential: await foreign.cred(ROHIT), seat: 'ir' }, XJ);
  assert.equal(f.ok, false); assert.equal(f.reason, 'scope-drift');
});

/* ---- writes: extend and lapse ---- */
async function writeRig(over = {}) {
  let updated = false;
  const rig = await makeHttpRig(load, (c) => {
    if (c.path === '/coql') {
      if (/from Receipts where Allotment =/.test(c.query)) return ['holds', over.receipts ?? 'coql.receipts-prakash'];
      throw new Error('unrouted ' + c.query);
    }
    if (c.method === 'GET' && c.path.startsWith('/LLP_UnitAllocation_Module/')) return ['holds', updated ? over.readback ?? 'allotment.readback-pending' : over.allotment ?? 'allotment.prakash'];
    if (c.method === 'PUT' && c.path.startsWith('/LLP_UnitAllocation_Module/')) { updated = true; return ['holds', 'update.allotment']; }
    if (c.method === 'POST' && c.path === '/Receipts') return ['holds', 'insert.refund'];
    throw new Error('unrouted ' + c.method + ' ' + c.path);
  });
  const sent = [];
  const publish = async (e) => { sent.push(e); const v = validateEvent(schemas, e); return v.ok ? { ok: true, eventId: e.event_id } : { ok: false, reason: v.reason, errors: v.errors }; };
  const events = createAuthorityEvents(createPlaneCLog(createPlaneCMemorySink()), () => SEP26);
  const writes = createAllotmentReceiptWrites({ crm: rig.crm, log: createOpsLog(createMemorySink()), recordIdPrefix: P,
    replay: { async replay() { throw new Error('unused'); } } });
  return { ...rig, sent, publish, events, receiptWrites: writes };
}
const SID = 'session_fixture_00000009';
const muts = (r) => r.writes().filter((c) => c.method !== 'GET');
const lapse = async (r, who = HEAD, seat = 'head', over = {}) =>
  createHoldLapse({ crm: r.crm, writes: r.receiptWrites, publish: r.publish, events: r.events, approvalConfigured: true, clock: () => SEP26, ...over })
    .lapse({ credential: await r.cred(who), sessionId: SID, session: { who, seat } }, XK);
const extend = async (r, body, who = HEAD, seat = 'head', now = SEP02, over = {}) =>
  requestHoldExtension({ crm: r.crm, as: await r.cred(who), session: { who, seat }, allotmentId: XK, body, events: r.events, publish: r.publish,
    approvalConfigured: true, clock: () => now, ...over });

test('TC-IM05-015: releasing a run-out hold goes through lapse-release (one guarded Cancelled), then waits on the approvers — no money moves yet', async () => {
  const r = await writeRig();
  const out = await lapse(r);
  assert.equal(out.ok, true);
  assert.deepEqual([out.value.state, out.value.units, out.value.forfeit, out.value.refund, out.value.refundReceiptId], ['pending-approval', 1, 50_000, 200_000, null]);
  assert.deepEqual(muts(r).map((c) => [c.method, c.path, c.body.data[0]]), [['PUT', `/LLP_UnitAllocation_Module/${XK}`, { Allocation_Status: 'Cancelled' }]]);
  assert.equal(muts(r)[0].headers['if-unmodified-since'] !== undefined, true);
  assert.equal(r.sent.length, 0);
});

test('once the release stands, ONE Pending Refund of ₹2,00,000 is raised and hold.changed "lapsed" is emitted; a re-press raises no second refund', async () => {
  const r = await writeRig({ readback: 'allotment.readback-released' });
  const out = await lapse(r);
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.value.state, 'released');
  const ins = muts(r).filter((c) => c.method === 'POST');
  assert.equal(ins.length, 1);
  assert.deepEqual([ins[0].body.data[0].Kind, ins[0].body.data[0].Amount, ins[0].body.data[0].Match_State, ins[0].body.data[0].Allotment.id], ['Refund', 200_000, 'Pending', XK]);
  assert.equal(out.value.refundReceiptId, `${P}740995411`);
  assert.equal(r.sent.length, 1);
  assert.deepEqual(validateEvent(schemas, r.sent[0]), { ok: true, type: 'hold.changed' });
  assert.equal(r.sent[0].payload.state, 'lapsed');
  assert.equal(r.sent[0].payload.deadline.slice(0, 10), '2026-09-23');

  const again = await writeRig({ allotment: 'allotment.prakash-cancelled', receipts: 'coql.receipts-prakash-refunded' });
  const o2 = await lapse(again);
  assert.equal(o2.ok, true);
  assert.equal(o2.value.refundReceiptId, `${P}740995410`);
  assert.equal(muts(again).length, 0, 'the standing refund is found, nothing written twice');
  assert.equal(again.sent[0].event_id, r.sent[0].event_id);
});

test('a later press after the approvers decided settles the refund; a still-pending approval writes nothing', async () => {
  const r = await writeRig({ allotment: 'allotment.prakash-cancelled' });
  const out = await lapse(r);
  assert.equal(out.value.state, 'released');
  assert.equal(muts(r).filter((c) => c.method === 'POST').length, 1);
  const p = await writeRig({ allotment: 'allotment.prakash-cancelled-pending' });
  const o = await lapse(p);
  assert.equal(o.value.state, 'pending-approval');
  assert.equal(muts(p).length, 0);
});

test('a lapse is refused while nothing is due, while a receipt is unmatched, while an extension waits, while the hold runs, and for Finance Operations', async () => {
  const cases = [
    [{ receipts: 'coql.receipts-prakash-paid' }, [], 'nothing-due', 409],
    [{ receipts: 'coql.receipts-prakash-pending' }, [], 'receipt-unmatched', 409],
    [{ allotment: 'allotment.prakash-requested' }, [], 'extension-waiting', 409],
    [{}, [HEAD, 'head', { clock: () => SEP02 }], 'hold-running', 409],
    [{}, [FIN, 'fin'], 'no-release-right', 403],
    [{}, [HEAD, 'head', { approvalConfigured: false }], 'approval-not-configured', 503],
  ];
  for (const [rigOver, args, code, status] of cases) {
    const r = await writeRig(rigOver);
    const out = await lapse(r, ...args);
    assert.equal(out.ok, false, code); assert.equal(out.refusal, code); assert.equal(out.status, status);
    assert.equal(muts(r).length, 0, code);
  }
});

test("TC-IM05-017: 'Extend the hold' is one guarded edit from the old deadline, held by the approval process; approved → hold.changed 'extended'", async () => {
  const r = await writeRig();
  const out = await extend(r, { days: 7, reason: 'Wire from abroad in transit' });
  assert.equal(out.ok, true);
  assert.deepEqual([out.state, out.from, out.to], ['pending-approval', '2026-09-23', '2026-09-30']);
  const w = muts(r);
  assert.equal(w.length, 1);
  assert.deepEqual(w[0].body.data[0], { Hold_Until: '2026-09-30', Hold_Extension_State: 'Requested', Hold_Extension_Days: 7, Hold_Extension_Reason: 'Wire from abroad in transit', Hold_Extension_Asked_By: { id: HEAD } });
  assert.equal(w[0].headers['if-unmodified-since'] !== undefined, true);
  assert.equal(r.sent.length, 0);

  const a = await writeRig({ readback: 'allotment.readback-extended' });
  const o2 = await extend(a, { days: 7, reason: 'Wire from abroad in transit' });
  assert.equal(o2.state, 'extended');
  assert.deepEqual(validateEvent(schemas, a.sent[0]), { ok: true, type: 'hold.changed' });
  assert.deepEqual([a.sent[0].payload.state, a.sent[0].payload.deadline.slice(0, 10)], ['extended', '2026-09-30']);
});

test('an extension is refused for Finance Operations, a run-out hold, one already waiting, a stale page, bad input, and without the approval process', async () => {
  const cases = [
    [{}, [{ days: 7, reason: 'x' }, FIN, 'fin'], 'no-extend-right'],
    [{}, [{ days: 7, reason: 'x' }, HEAD, 'head', SEP26], 'hold-ran-out'],
    [{ allotment: 'allotment.prakash-requested' }, [{ days: 7, reason: 'x' }], 'already-requested'],
    [{}, [{ days: 7, reason: 'x', expectedModifiedTime: '2026-08-30T10:00:00+05:30' }], 'changed'],
    [{}, [{ days: 0, reason: 'x' }], 'invalid-request'],
    [{}, [{ days: 7 }], 'invalid-request'],
    [{}, [{ days: 7, reason: 'x' }, HEAD, 'head', SEP02, { approvalConfigured: false }], 'approval-not-configured'],
  ];
  for (const [rigOver, args, code] of cases) {
    const r = await writeRig(rigOver);
    const out = await extend(r, ...args);
    assert.equal(out.ok, false, code); assert.equal(out.refusal, code);
    assert.equal(muts(r).length, 0, code);
  }
});
