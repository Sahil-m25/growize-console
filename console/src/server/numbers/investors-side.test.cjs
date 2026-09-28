/* M16-S08-T01 / M16-S09-T01 — the Investors side of Numbers on recorded Zoho answers (__fixtures__/today-inv for
   receipts and allotments, documents for the FEMA paper out, numbers/*side* for the programme and Compliance).
   Aggregates are worked out from the recorded ROWS by a small COQL emulator that honours each query's own
   Match_State / Allocation_Status filter and GROUP BY, so matched-only (D21) is proved on what the query asks.
   Run from console/: node --test src/server/numbers/investors-side.test.cjs */
'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { compile, makeRig, recorded, P, NOW } = require('../cases/fixture-rig.cjs');

const load = compile(['server/numbers/investors-side.ts', 'server/data/events.ts', 'server/identity/plane-c.ts', 'server/identity/authority.ts', 'server/data/scope.ts']);
const { createInvestorsSide, investorsSideFor, checkAggregate, BANKED_BY_LLP, COMMITTED_BY_LLP, PROGRAMME, MATCHED_BY_ALLOTMENT_DAY } = load('server/numbers/investors-side.js');
const { scopedKeyString, scopesFor } = load('server/data/scope.js');
const { createMemorySink, createOpsLog } = load('lib/zoho/log.js');
const { createPlaneCLog, createPlaneCMemorySink } = load('server/identity/plane-c.js');
const { createAuthorityEvents } = load('server/identity/authority.js');

const HEAD = `${P}740993002`, AUDIT = `${P}740993009`, COMP = `${P}740993003`, KAM = `${P}740994002`, AMLEAD = `${P}740994001`, IR = `${P}740991001`, DI = `${P}740990001`;
const ok = (data) => ({ status: 200, headers: { 'content-type': 'application/json' }, body: { data, info: { count: data.length, more_records: false } } });
const cr = (n) => (n / 1e7).toFixed(2);
const allotments = () => recorded('today-inv', 'allotments.all').body.data;
const receipts = (name) => recorded('today-inv', name).body.data;

/** GROUP BY over recorded receipt rows, applying the query's Match_State filter; keys as Zoho returns them. */
function receiptsAggregate(q, rowsName) {
  let rows = receipts(rowsName);
  const st = /Match_State = '([^']+)'/.exec(q);
  if (st) rows = rows.filter((r) => r.Match_State === st[1]);
  const llpOf = new Map(allotments().map((a) => [a.id, a.LLP]));
  const byLlp = /group by Allotment\.LLP, Kind/.test(q), byDay = /group by Allotment, Kind, Received_On/.test(q);
  if (!byLlp && !byDay) throw new Error('unrouted receipts aggregate ' + q);
  const g = new Map();
  for (const r of rows) {
    const key = byLlp ? JSON.stringify([llpOf.get(r.Allotment.id) ?? null, r.Kind]) : JSON.stringify([r.Allotment, r.Kind, r.Received_On]);
    g.set(key, (g.get(key) ?? 0) + r.Amount);
  }
  return ok([...g].map(([k, v]) => {
    const f = JSON.parse(k);
    return byLlp ? { 'Allotment.LLP': f[0], Kind: f[1], 'SUM(Amount)': v } : { Allotment: f[0], Kind: f[2] === undefined ? f[1] : f[1], Received_On: f[2], 'SUM(Amount)': v };
  }));
}
function committedAggregate() {
  const g = new Map();
  for (const a of allotments().filter((x) => x.Allocation_Status === 'Reserved' || x.Allocation_Status === 'Issued')) {
    const k = JSON.stringify([a.LLP, a.Allocation_Status, a.Unit_Price]);
    const o = g.get(k) ?? { r: 0, i: 0 }; o.r += a.Reserved_Units; o.i += a.Issued_Units; g.set(k, o);
  }
  return ok([...g].map(([k, o]) => { const [LLP, Allocation_Status, Unit_Price] = JSON.parse(k); return { LLP, Allocation_Status, Unit_Price, 'SUM(Reserved_Units)': o.r, 'SUM(Issued_Units)': o.i }; }));
}
const routeWith = (opts = {}) => (q) => {
  if (/Sign_Req_Id/.test(q)) return /from Contacts/.test(q) ? ['documents', 'coql.sign-fema-out'] : ['numbers', 'coql.side-empty'];
  if (/from Receipts/.test(q)) return opts.receiptsForbidden ? ['numbers', 'forbidden'] : receiptsAggregate(q, opts.rows ?? 'receipts.rows');
  if (/from LLP_UnitAllocation_Module/.test(q) && /group by LLP, Allocation_Status, Unit_Price/.test(q)) return committedAggregate();
  if (/from LLP_UnitAllocation_Module/.test(q) && /order by id asc limit/.test(q)) return ok(allotments().filter((x) => x.Allocation_Status === 'Reserved' || x.Allocation_Status === 'Issued'));
  if (/from LLP_Creation_Module/.test(q)) return ['numbers', 'agg.side-programme'];
  if (/from Contacts/.test(q) && /PAN_Proof_Verified_At is null\) limit/.test(q)) return ['numbers', 'coql.side-empty'];
  if (/from Contacts/.test(q) && /Bank_Proof_Verified_At is null\) limit/.test(q)) return ['numbers', opts.bankMissing ? 'coql.side-comp-bank-missing' : 'coql.side-empty'];
  if (/from Contacts/.test(q)) return ['numbers', 'coql.side-comp'];
  throw new Error('unrouted ' + q);
};

async function rig(opts = {}) {
  const r = await makeRig(load, routeWith(opts));
  const sink = createMemorySink();
  const planeSink = createPlaneCMemorySink();
  const authority = createAuthorityEvents(createPlaneCLog(planeSink), () => NOW);
  const side = createInvestorsSide({ crm: r.crm, cache: r.cache, log: createOpsLog(sink), clock: () => NOW,
    refusedAction: (w, s, a) => authority.refusedAction(w, s, a),
    signStatus: async (_c, ids) => new Map(ids.map((id) => [id, { status: 'inprogress', sentAt: '2026-08-26T10:00:00+05:30', sentBy: 'Meena', expiresAt: '2026-09-09' }])) });
  return { ...r, side, sink, planeSink };
}

test('the aggregates stay inside COQL limits (≤ 4 group fields, ≤ 5 aggregates)', () => {
  for (const q of [BANKED_BY_LLP, COMMITTED_BY_LLP, PROGRAMME, MATCHED_BY_ALLOTMENT_DAY]) assert.equal(checkAggregate(q), q);
  assert.throws(() => checkAggregate('select a, b, c, d, e, COUNT(id) from X where id is not null group by a, b, c, d, e'));
  assert.throws(() => checkAggregate('select a, COUNT(id), SUM(b), SUM(c), SUM(d), SUM(e), SUM(f) from X where id is not null group by a'));
  assert.throws(() => checkAggregate('select a from X'));
});

test('who is offered what: Finance both halves, AM Service only, IR no switch, Auditor and super user Collection', () => {
  assert.deepEqual([...investorsSideFor('head', HEAD).sections], ['cash', 'risk', 'paper', 'comp', 'svc']);
  assert.deepEqual([...investorsSideFor('audit', AUDIT).sections].slice(0, 2), ['cash', 'risk']);
  assert.deepEqual([...investorsSideFor('di', DI).sections].slice(0, 2), ['cash', 'risk']);
  assert.deepEqual([...investorsSideFor('kam', KAM).sections], ['svc']);
  assert.deepEqual([...investorsSideFor('amlead', AMLEAD).sections], ['svc']);
  assert.equal(investorsSideFor('ir', IR), null);
  assert.equal(investorsSideFor('conv', IR), null);
  assert.equal(investorsSideFor('cp', IR), null);
});

test('TC-IM09-001: Collection — ₹8.88 Cr banked (matched only), ₹1.13 Cr committed not yet in, ₹52 Cr programme, 17% collected; split by LLP', async () => {
  const r = await rig();
  const got = await r.side.read({ credential: await r.cred(HEAD), seat: 'head' }, 'cash');
  assert.equal(got.ok, true);
  const c = got.value.collection;
  assert.equal(c.banked, 88_750_000); assert.equal(cr(c.banked), '8.88');
  assert.equal(c.outstanding, 11_250_000); assert.equal(cr(c.outstanding), '1.13');
  assert.equal(c.programme, 520_000_000); assert.equal(c.programmeUnits, 208);
  assert.equal(c.pctOfProgramme, 17);
  assert.equal(c.committed, 100_000_000);   // 29 + 6 + 4 + 1 units × ₹25 L (the Cancelled allotment is not committed)
  assert.equal(c.pctOfCommitted, 89);
  const by = Object.fromEntries(c.byLlp.map((l) => [l.llpId, l]));
  assert.equal(by[`${P}740998301`].banked, 72_500_000);        // 72.5 L Full + (5 L advance − 5 L refund) on the Cancelled one
  assert.equal(by[`${P}740998302`].banked, 16_250_000);
  assert.equal(by[`${P}740998301`].committed, 72_500_000);
  assert.equal(by[`${P}740998302`].committed, 27_500_000);
  assert.equal(by[`${P}740998302`].outstanding, 11_250_000);
  assert.equal(c.byLlp.reduce((s, l) => s + l.banked, 0), c.banked);
  assert.equal(got.value.stale, false); assert.equal(got.value.asOf, NOW);
  assert.ok(r.queries.every((q) => !/Received_On/.test(q) || /group by/.test(q)), 'receipts are only ever read as aggregates');
});

test('D21: a recorded but unmatched receipt moves no Collection figure (the register would count it; this page follows Today)', async () => {
  const a = await rig();
  const b = await rig({ rows: 'receipts.rows-with-pending' });
  const x = (await a.side.read({ credential: await a.cred(HEAD), seat: 'head' }, 'cash')).value.collection;
  const y = (await b.side.read({ credential: await b.cred(HEAD), seat: 'head' }, 'cash')).value.collection;
  assert.deepEqual(y, x);
});

test('Collection is cached as numbers under the money scope; a reload spends no COQL', async () => {
  const r = await rig();
  const cred = await r.cred(HEAD);
  await r.side.read({ credential: cred, seat: 'head' }, 'cash');
  const n = r.queries.length;
  assert.ok(n >= 5 && n <= 6, `cold read spends ${n} COQL calls`);
  const again = await r.side.read({ credential: cred, seat: 'head' }, 'cash');
  assert.equal(again.ok, true);
  assert.equal(r.queries.length, n);
});

test('balance ageing: part-paid allotments with days since their last matched receipt, oldest first (aged in the app)', async () => {
  const r = await rig();
  const got = await r.side.read({ credential: await r.cred(HEAD), seat: 'head' }, 'risk');
  assert.equal(got.ok, true);
  const rows = got.value.rows;
  assert.deepEqual(rows.map((x) => x.allotmentId), [`${P}740996204`, `${P}740996205`]);  // same age → by id
  assert.equal(rows[0].lastReceiptOn, '2026-08-24'); assert.equal(rows[0].days, 35);
  assert.equal(rows[0].due, 9_000_000); assert.equal(rows[1].due, 2_250_000);
  assert.equal(got.value.due, 11_250_000);
  assert.ok(!rows.some((x) => x.allotmentId === `${P}740996202`), 'fully paid is not Partial');
  assert.ok(!r.queries.some((q) => /MAX\(|MIN\(/i.test(q)));
});

test('TC-IM09-002: Paper — the FEMA declaration for Joseph Mathew, sent 26 Aug by Meena, Class 3 DSC, link expires 09 Sep', async () => {
  const r = await rig();
  const got = await r.side.read({ credential: await r.cred(HEAD), seat: 'head' }, 'paper');
  assert.equal(got.ok, true);
  assert.equal(got.value.rows.length, 1);
  const p = got.value.rows[0];
  assert.equal(p.document, 'FEMA declaration'); assert.match(p.party, /Joseph Mathew/);
  assert.equal(p.contactId, `${P}740997209`); assert.equal(p.method, 'Class 3 DSC');
  assert.equal(p.sentBy, 'Meena'); assert.equal(p.sentAt.slice(0, 10), '2026-08-26'); assert.equal(p.expiresAt, '2026-09-09');
  assert.equal(p.daysOut, 33);
});

test('TC-IM09-003: Compliance — Joseph Mathew listed with KYC pending and FEMA outstanding; count 1; no PAN/bank value selected', async () => {
  const r = await rig();
  const got = await r.side.read({ credential: await r.cred(COMP), seat: 'comp' }, 'comp');
  assert.equal(got.ok, true);
  assert.equal(got.value.count, 1);
  const j = got.value.rows[0];
  assert.equal(j.name, 'Joseph Mathew'); assert.equal(j.kyc, 'pending');
  assert.deepEqual([...j.missing], ['kyc', 'fema']); assert.equal(j.blocks, 'allotment');
  for (const q of r.queries.filter((x) => /from Contacts/.test(x))) {
    const sel = /^select (.+?) from/.exec(q)[1];
    assert.ok(!/pan|bank|aadhaar/i.test(sel), `selects no identity field: ${sel}`);
  }
});

test('Compliance: an empty bank-proof slot lists the Contact with that item', async () => {
  const r = await rig({ bankMissing: true });
  const got = await r.side.read({ credential: await r.cred(COMP), seat: 'comp' }, 'comp');
  assert.equal(got.value.count, 2);
  const s = got.value.rows.find((x) => x.contactId === `${P}740997101`);
  assert.deepEqual([...s.missing], ['bank-proof']); assert.equal(s.blocks, null);
});

test('TC-IM09-007: the Auditor reads Collection (₹8.88 Cr banked)', async () => {
  const r = await rig();
  const got = await r.side.read({ credential: await r.cred(AUDIT), seat: 'audit' }, 'cash');
  assert.equal(got.ok, true); assert.equal(cr(got.value.collection.banked), '8.88');
});

test('M16-S09 AC4: the super user reads Collection; the figures carry no PAN, Aadhaar or bank detail', async () => {
  const r = await rig();
  const got = await r.side.read({ credential: await r.cred(DI), seat: 'di' }, 'cash');
  assert.equal(got.ok, true);
  assert.doesNotMatch(JSON.stringify(got.value), /pan|aadhaar|bank_|ifsc|account/i);
});

test('M16-S09 AC5 / TC-IM09-004/005: a KAM or Head of AM token asking for a money section is refused before any read, logged in Plane C', async () => {
  for (const [seat, id] of [['kam', KAM], ['amlead', AMLEAD]]) {
    for (const section of ['cash', 'risk']) {
      const r = await rig();
      const got = await r.side.read({ credential: await r.cred(id), seat }, section);
      assert.deepEqual(got, { ok: false, kind: 'refused', reason: 'money-hidden' });
      assert.equal(r.queries.length, 0, 'no Zoho read');
      const ev = r.planeSink.events();
      assert.equal(ev.length, 1);
      assert.equal(ev[0].action, 'refused-action'); assert.equal(ev[0].outcome, 'refused'); assert.equal(ev[0].who, id);
      assert.equal(ev[0].reason, `numbers-${section}-money-hidden`);
      assert.ok(r.sink.records().some((x) => JSON.stringify(x).includes('money-hidden')), 'Plane B too');
    }
    const r = await rig();
    for (const section of ['paper', 'comp']) assert.equal((await r.side.read({ credential: await r.cred(id), seat }, section)).reason, 'no-book');
  }
});

test('M16-S09 T01: the cache key carries the scope — a KAM never reaches a Finance-cached figure', async () => {
  const r = await rig();
  const f = await r.side.read({ credential: await r.cred(HEAD), seat: 'head' }, 'cash');
  assert.equal(f.ok, true);
  const n = r.queries.length;
  const k = await r.side.read({ credential: await r.cred(KAM), seat: 'kam' }, 'cash');
  assert.equal(k.ok, false); assert.equal(k.reason, 'money-hidden'); assert.equal(r.queries.length, n);
  const finKey = scopedKeyString(scopesFor('head', HEAD).money, 'numbers.investors.cash');
  const kamKey = scopedKeyString(scopesFor('kam', KAM).money, 'numbers.investors.cash');
  assert.equal(finKey, 'role:org|org.numbers.investors.cash');
  assert.notEqual(finKey, kamKey);
});

test('an IR has no Investors side; an unknown section is an invalid request', async () => {
  const r = await rig();
  assert.equal((await r.side.read({ credential: await r.cred(IR), seat: 'ir' }, 'cash')).reason, 'no-book');
  assert.equal((await r.side.read({ credential: await r.cred(HEAD), seat: 'head' }, 'funnel')).reason, 'invalid-request');
  assert.equal(r.queries.length, 0);
});

test('a token Zoho refuses on Receipts (no Receipts read) is refused as money-hidden, not shown as zero', async () => {
  const r = await rig({ receiptsForbidden: true });
  const got = await r.side.read({ credential: await r.cred(HEAD), seat: 'head' }, 'cash');
  assert.deepEqual(got, { ok: false, kind: 'refused', reason: 'money-hidden' });
  assert.equal(r.planeSink.events().length, 1);
});
