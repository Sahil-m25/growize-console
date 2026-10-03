/* M09-S04-T03 / M09-S02-T03 / M16-S08-T02 — the account-management list: managers, pool, rows and the Service tiles, on recorded Zoho
   answers (__fixtures__/queues touches). The AM book, the Cases register and the user list are fakes of their own tested result shapes.
   No request reaches Zoho.   Run from console/: node --test src/server/investors/am-service.test.cjs */
'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { compile, makeRig, P } = require('../cases/fixture-rig.cjs');

const load = compile(['server/investors/am-service.ts', 'server/queues/rules.ts', 'server/data/events.ts', 'server/identity/plane-c.ts']);
const { createAmService, amServiceView } = load('server/investors/am-service.js');

const IMRAN = `${P}740994002`, NEHA = `${P}740994003`, DIVYA = `${P}740994001`, LATHA = `${P}740993006`, GONE = `${P}740993099`;
const L = [1, 2, 3, 4].map((i) => `${P}74099810${i}`);
const C = (n) => `${P}7409971${String(n).padStart(2, '0')}`;
const NOW = Date.parse('2026-09-28T11:30:00+05:30');
const SECRET_EMAIL = 'synthetic.investor@example.invalid', SECRET_PHONE = '+919800000000';
const entry = (id, first, last, units, kam, lead, extra = {}) => ({
  id, investorCode: `ARL-${id.slice(-3)}`, firstName: first, lastName: last, mobile: SECRET_PHONE, email: SECRET_EMAIL, city: 'Pune', street: null,
  flatOrBuilding: null, postalCode: null, state: null, country: null, residency: 'Resident', nomineeName: null, nomineeRelation: null,
  kamUserId: kam, kamSince: '2026-01-05', introductionAt: kam ? '2026-01-06T10:00:00+05:30' : null, originLeadId: lead, saidYesAt: null,
  modifiedTime: '2026-09-01T10:00:00+05:30', issuedUnits: units, scope: 'own', mayCare: true, mayDetails: true, mayAssignManager: false,
  identity: { pan: 'finance-only', aadhaar: 'finance-only', bank: 'finance-only' }, ...extra,
});
const IMRAN_BOOK = [
  entry(C(1), 'Anil', 'Rao', 4, IMRAN, L[0]),                // Tier A, last heard 19 Aug: 10 days past the 30-day cadence
  entry(C(2), 'Bina', 'Shah', 2, IMRAN, L[1]),               // Tier B, last heard 20 Jun ("A concern"): 10 days past 90
  entry(C(3), 'Chitra', 'Iyer', 1, IMRAN, L[2]),             // Tier C, due in 10 days
  entry(C(4), 'Dev', 'Nair', 2, IMRAN, L[3], { introductionAt: null }),
];
const HEAD_BOOK = [...IMRAN_BOOK, entry(C(30), 'Esha', 'Pai', 2, NEHA, null),
  entry(C(20), 'Vikram', 'Anand', 2, null, null, { scope: 'pool', kamSince: null }), entry(C(21), 'Pooja', 'Menon', 1, null, null, { scope: 'pool', kamSince: null }),
  entry(C(22), 'Gita', 'Rao', 4, GONE, null)];                // handed to a manager Zoho no longer lists
const ticket = (n, own, state = 'open', pri = 'normal', opened = '2026-09-20T10:00') => ({ id: `${P}74099920${n}`, number: `0000${n}`, inv: C(1), t: 'Synthetic', cat: 'Query',
  opened, by: 'staff', own, pri, state, d: 'Synthetic', sla: '2026-09-30T10:00' });
const TICKETS = [ticket(1, IMRAN, 'open', 'high'), ticket(2, IMRAN), ticket(3, IMRAN, 'open', 'normal', '2026-09-27T10:00'), ticket(4, IMRAN, 'closed'), ticket(5, NEHA)];
const NAMES = [{ id: IMRAN, name: 'Imran Sheikh', left: false }, { id: NEHA, name: 'Neha Bhandari', left: false }, { id: LATHA, name: 'Latha Rao', left: false }];

const route = (touches = 'coql.touches.imran') => (q) => { if (/from Touches/.test(q)) return ['queues', touches]; throw new Error('unrouted ' + q); };
async function service(o = {}) {
  const rig = await makeRig(load, route(o.touches));
  const calls = { cases: 0, book: 0, kams: 0 };
  const refusals = [];
  return { rig, calls, refusals, s: createAmService({
    crm: rig.crm, log: { refusal: (e) => refusals.push(e) }, clock: () => NOW,
    amBook: { list: async () => { calls.book++; return o.bookFail ?? { ok: true, value: o.book ?? HEAD_BOOK }; } },
    cases: { list: async () => { calls.cases++; return o.casesFail ?? { ok: true, rows: TICKETS, truncated: false, cuts: { state: 'error' }, mine: 0, readOnly: false, offersMine: false }; } },
    kams: async () => { calls.kams++; return o.kams === undefined ? NAMES : o.kams; },
  }) };
}
const principal = async (rig, id, seat) => ({ credential: await rig.cred(id), sessionId: 'session_fixture_00000042', seat });

test('M09-S04: the Head of AM sees every manager with accounts and gone-quiet counts, the pool apart, a manager Zoho no longer lists with no name', async () => {
  const { rig, s } = await service();
  const r = await s.read(await principal(rig, DIVYA, 'amlead'));
  assert.equal(r.ok, true);
  const v = r.view;
  assert.equal(v.book, 'head');
  const by = Object.fromEntries(v.managers.map((m) => [m.id, m]));
  assert.deepEqual([by[IMRAN].accounts, by[IMRAN].tierA, by[IMRAN].goneQuiet, by[IMRAN].conversations, by[IMRAN].openTickets, by[IMRAN].onConcern], [4, 1, 2, 9, 3, 1]);
  assert.deepEqual([by[NEHA].name, by[NEHA].accounts, by[NEHA].goneQuiet, by[NEHA].conversations, by[NEHA].openTickets], ['Neha Bhandari', 1, 1, 1, 1]);
  assert.deepEqual([by[LATHA].accounts, by[LATHA].goneQuiet], [0, 0], 'a manager with nothing yet still appears: the drawer says "their first"');
  assert.deepEqual([by[GONE].name, by[GONE].accounts, by[GONE].left], [null, 1, false]);
  assert.deepEqual(v.managers.map((m) => m.id).slice(0, 2), [IMRAN, LATHA], 'named people first, by name; unnamed last');
  assert.deepEqual(v.pool, { accounts: 2, tierA: 0, goneQuiet: 0, shouldBeNamed: 1 });
  assert.deepEqual([by[IMRAN].tiers, by[IMRAN].perMonth], [{ A: 1, B: 2, C: 1 }, 1.8], 'what the drawer says they carry today');
  assert.deepEqual([by[LATHA].tiers, by[LATHA].perMonth], [{ A: 0, B: 0, C: 0 }, 0]);
});

test('M09-S02: the AM row list carries tier, manager, last heard and next owed — no money, no mobile, no email', async () => {
  const { rig, s } = await service();
  const v = (await s.read(await principal(rig, DIVYA, 'amlead'))).view;
  assert.equal(v.accounts.length, 8);
  const anil = v.accounts.find((a) => a.id === C(1));
  assert.deepEqual([anil.name, anil.code, anil.units, anil.tier, anil.kamUserId, anil.lastHeardAt, anil.overdue, anil.introduced], ['Anil Rao', 'ARL-' + C(1).slice(-3), 4, 'A', IMRAN, '2026-08-19T11:00', 10, true]);
  assert.equal(v.accounts.find((a) => a.id === C(4)).introduced, false);
  assert.equal(v.accounts.find((a) => a.id === C(20)).kamUserId, null);
  const text = JSON.stringify(v);
  assert.ok(!text.includes(SECRET_EMAIL) && !text.includes(SECRET_PHONE));
  assert.doesNotMatch(text, /"(due|paid|received|amount|amountRupees|banked|outstanding|forfeit|exposure|Unit_Price)":/);
});

test('M16-S08: the Service tiles, tier counts and monthly load of a KAM read only their own book; they get their own row and no pool', async () => {
  const { rig, s, calls } = await service();
  const v = (await s.read(await principal(rig, IMRAN, 'kam'))).view;
  assert.equal(v.book, 'kam');
  assert.deepEqual(v.tiles, { goneQuiet: 2, insideCadencePct: 50, ticketsPastWindow: 2, endedOnConcern: 1 });
  assert.deepEqual(v.tiers, { A: 1, B: 2, C: 1 });
  assert.deepEqual(v.load, { perMonth: 1.8, poolPerMonth: 0 });
  assert.deepEqual(v.managers.map((m) => m.id), [IMRAN]);
  assert.equal(v.pool, null);
  assert.equal(v.accounts.length, 4);
  assert.equal(v.team, 3, 'the team count comes from the user list; the KAM\'s own row stays their own');
  assert.equal(calls.kams, 1);
  assert.ok(!JSON.stringify(v).includes(C(30)), "nobody else's account");
});

test('the Head of AM\'s tiles cover the whole book and the tickets of their managers; the pool load is the pool\'s own', async () => {
  const { rig, s } = await service();
  const v = (await s.read(await principal(rig, DIVYA, 'amlead'))).view;
  assert.equal(v.tiles.goneQuiet, 4, "Imran 2, Neha 1 and the account whose manager has left");
  assert.equal(v.tiles.ticketsPastWindow, 3, 'Imran 2 and Neha 1 are past their windows; the closed one and the one opened yesterday are not');
  assert.deepEqual(v.tiers, { A: 2, B: 4, C: 2 });
  assert.equal(v.load.poolPerMonth, 0.5);
});

test('a refusal for any seat but a KAM or the Head of AM — logged by id, nothing read', async () => {
  for (const seat of ['head', 'fin', 'ir', 'comp']) {
    const { rig, s, calls, refusals } = await service();
    const r = await s.read(await principal(rig, DIVYA, seat));
    assert.deepEqual([r.ok, r.kind, r.reason], [false, 'refused', 'seat-denied'], seat);
    assert.deepEqual([calls.book, calls.cases, calls.kams, rig.queries.length], [0, 0, 0, 0]);
    assert.equal(refusals.length, 1);
    assert.deepEqual(refusals[0].recordIds, []);
  }
});

test('a reader that fails says so by name and the rest is still served: no names (users), no tickets (cases), no conversations (touches)', async () => {
  const { rig, s } = await service({ kams: null, casesFail: { ok: false, kind: 'source-error', errorKind: 'network', retryable: true } });
  const v = (await s.read(await principal(rig, DIVYA, 'amlead'))).view;
  assert.deepEqual([...v.problems].sort(), ['cases:network', 'users:unavailable']);
  assert.equal(v.team, null);
  assert.equal(v.tiles.ticketsPastWindow, null);
  assert.ok(v.managers.every((m) => m.name === null && m.openTickets === null));
  assert.equal(v.managers.find((m) => m.id === IMRAN).accounts, 4, 'managers fall back to the ids on the book');
  const t = await service({ touches: undefined });
  const down = createAmService({ crm: { coql: async () => ({ ok: false, error: { kind: 'network' } }) }, log: { refusal() {} }, clock: () => NOW,
    amBook: { list: async () => ({ ok: true, value: IMRAN_BOOK }) }, cases: { list: async () => ({ ok: true, rows: [], truncated: false }) }, kams: async () => NAMES });
  const w = (await down.read(await principal(t.rig, IMRAN, 'kam'))).view;
  assert.deepEqual(w.problems.length, 1);
  assert.match(w.problems[0], /^touches:/);
  assert.equal(w.managers[0].conversations, null);
});

test('a book that cannot be read is a source error, never an empty list', async () => {
  const { rig, s } = await service({ bookFail: { ok: false, kind: 'source-error', errorKind: 'network', retryable: true } });
  const r = await s.read(await principal(rig, DIVYA, 'amlead'));
  assert.deepEqual([r.ok, r.kind, r.errorKind, r.retryable], [false, 'source-error', 'network', true]);
});

test('the pure view: no accounts → 100% inside cadence, zero load', () => {
  const v = amServiceView({ book: [], last: new Map(), touchesBy: new Map(), tickets: [], kams: [] }, { kind: 'head', me: DIVYA, now: NOW });
  assert.deepEqual([v.tiles.insideCadencePct, v.load.perMonth, v.managers.length, v.pool.accounts], [100, 0, 0, 0]);
});
