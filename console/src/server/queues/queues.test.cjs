/* M05-S07-T01/T03 and M05-S08-T01 — the Investors side of Today per seat, on recorded Zoho answers
   (__fixtures__/queues, holds, today-inv). The holds reader and every COQL the queue makes run for real over the
   recorded replies; the claim, documents, cases and KAM-book services (tested in their own files) are fakes of their
   result shapes. No request reaches Zoho.   Run from console/: node --test src/server/queues/queues.test.cjs */
'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { compile, makeRig, recorded, receiptRows, P } = require('../cases/fixture-rig.cjs');

const load = compile(['server/queues/queue.ts', 'server/queues/rules.ts', 'server/holds/holds.ts', 'server/data/events.ts', 'server/identity/plane-c.ts']);
const { createInvestorQueues } = load('server/queues/queue.js');
const rules = load('server/queues/rules.js');
const { ROLE } = load('lib/im/constants.js');

const IMRAN = `${P}740994002`, NEHA = `${P}740994003`, DIVYA = `${P}740994001`, HARSHA = `${P}740993002`, FAHAD = `${P}740993005`, LATHA = `${P}740993006`, IR = `${P}740995001`;
const L = [1, 2, 3, 4].map((i) => `${P}74099810${i}`);
const C = (n) => `${P}7409971${String(n).padStart(2, '0')}`;
const NOW = Date.parse('2026-09-28T11:30:00+05:30'), SEP02 = Date.parse('2026-09-02T10:00:00+05:30');
const ok = (data) => ({ status: 200, headers: { 'content-type': 'application/json' }, body: { data, info: { count: data.length, more_records: false } } });
const can = (r) => (c) => ROLE[r].can.includes(c);
const SECRET_EMAIL = 'synthetic.investor@example.invalid', SECRET_PHONE = '+919800000000';

const receiptsLedger = (q) => receiptRows(q, recorded('today-inv', 'receipts.rows-with-pending').body.data);
const route = (o = {}) => (q) => {
  /* G1: the IRs' "send it" requests on Leads (none unless a test says so), and the supplementary's investor / allotment */
  if (/from Leads where/.test(q)) {
    const r = /NDA_Requested_At is not null/.test(q) ? o.ndaReq : o.suppReq;
    return typeof r === 'function' ? r(q) : r ?? ok([]);
  }
  /* D138: the KAMs' "confirm the full payment" requests (none unless a test says so) */
  if (/Convert_Requested_At is not null/.test(q)) return o.confirmReq ?? ok([]);
  if (/select id, Origin_Lead, First_Name, Last_Name from Contacts/.test(q)) return o.suppContacts ?? ok([]);
  if (/Supplementary_Sign_Req_Id/.test(q)) return o.suppAllots ?? ok([]);
  if (/from Receipts/.test(q)) return receiptsLedger(q);
  if (/Hold_Until <= /.test(q)) return o.holds ?? ['holds', 'coql.holds'];
  if (/from Touches/.test(q)) return ['queues', o.touches ?? 'coql.touches.imran'];
  if (/from Contacts where \(\(KYC not in/.test(q)) return ['queues', 'coql.kyc-contacts'];
  if (/from LLP_UnitAllocation_Module where \(Customer in .* and Allocation_Status != 'Cancelled'/.test(q)) return ['queues', 'coql.kyc-live-allotments'];
  if (/from LLP_UnitAllocation_Module where \(id in/.test(q)) return ['queues', 'coql.claim-allotments'];
  throw new Error('unrouted ' + q);
};

const entry = (id, first, last, units, kam, lead, extra = {}) => ({
  id, investorCode: `ARL-${id.slice(-3)}`, firstName: first, lastName: last, mobile: SECRET_PHONE, email: SECRET_EMAIL, city: null, street: null,
  flatOrBuilding: null, postalCode: null, state: null, country: null, residency: 'Resident', nomineeName: null, nomineeRelation: null,
  kamUserId: kam, kamSince: '2026-01-05', introductionAt: kam ? '2026-01-06T10:00:00+05:30' : null, originLeadId: lead, saidYesAt: null,
  modifiedTime: '2026-09-01T10:00:00+05:30', issuedUnits: units, scope: 'own', mayCare: true, mayDetails: true, mayAssignManager: false,
  identity: { pan: 'finance-only', aadhaar: 'finance-only', bank: 'finance-only' }, ...extra,
});
const IMRAN_BOOK = [
  entry(C(1), 'Anil', 'Rao', 4, IMRAN, L[0]),                 // Tier A, last heard 19 Aug → 10 days past the 30-day cadence
  entry(C(2), 'Bina', 'Shah', 2, IMRAN, L[1]),                // Tier B, last heard 20 Jun → 10 days past 90
  entry(C(3), 'Chitra', 'Iyer', 1, IMRAN, L[2]),              // Tier C, last heard 11 Apr → due in 10 days
  entry(C(4), 'Dev', 'Nair', 2, IMRAN, L[3], { introductionAt: null }),   // handed over, never introduced
];
const ticket = (n, own, state = 'open') => ({ id: `${P}74099920${n}`, number: `0000${n}`, inv: C(1), t: `Synthetic ticket ${n}`, cat: 'Query', opened: '2026-09-20T10:00',
  by: 'staff', own, pri: n === 1 ? 'high' : 'normal', state, d: 'Synthetic words', sla: '2026-09-30T10:00' });
const TICKETS = [ticket(1, IMRAN), ticket(2, IMRAN), ticket(3, IMRAN), ticket(4, IMRAN, 'closed'), ticket(5, NEHA)];

const claimRow = { claimId: `${P}740994301`, leadId: `${P}740994007`, allotmentId: `${P}740996205`, kind: 'balance', mode: 'RTGS', amountRupees: 2_250_000, saidOn: '2026-08-27', byId: IR };
function queues(rig, o = {}) {
  const calls = { claims: 0, documents: 0, holds: 0, cases: 0, book: 0 };
  const { createHolds } = load('server/holds/holds.js');
  const holds = createHolds({ crm: rig.crm, cache: rig.cache, events: rig.events, clock: () => o.now ?? NOW });
  return { calls, q: createInvestorQueues({
    crm: rig.crm, log: { refusal: (e) => rig.sink.refusals?.push?.(e) ?? rig.refusals.push(e), call() {}, event() {} },
    clock: () => o.now ?? NOW, financeLeadsShared: o.shared,
    holds: { list: (...a) => { calls.holds++; return o.holdsFail ? Promise.resolve({ ok: false, kind: 'source-error', errorKind: 'network', retryable: true }) : holds.list(...a); } },
    claims: { waiting: async () => { calls.claims++; return { ok: true, value: { claims: o.claims ?? [claimRow], superUser: false } }; } },
    documents: { read: async () => { calls.documents++; return { ok: true, page: { side: 'investors', cut: 'out', rows: o.docs ?? [], outCount: 0, files: null, actions: { send: true, verify: true }, truncated: false, fresh: {} } }; } },
    cases: { list: async () => { calls.cases++; return { ok: true, rows: TICKETS, truncated: false, cuts: { state: 'error' }, mine: 3, readOnly: false, offersMine: false }; } },
    amBook: { list: async () => { calls.book++; return { ok: true, value: o.book ?? IMRAN_BOOK }; } },
  }) };
}
const principal = async (rig, id, seat, role) => ({ credential: await rig.cred(id), sessionId: 'session_fixture_00000042', seat, can: can(role) });
const moneyWords = /"(due|paid|received|amount|amountRupees|banked|outstanding|forfeit|exposure|Unit_Price)":/;  // money as a key, never as a row kind

test('the tier is the front end\'s rule (TIERS by issued units) — Contacts has no Tier field', () => {
  assert.deepEqual([4, 7, 2, 3, 1].map((u) => rules.tierFor(u).k), ['A', 'A', 'B', 'B', 'C']);
  assert.deepEqual([4, 2, 1].map((u) => rules.tierFor(u).every), [30, 90, 180]);
});

test('TC-IM03-010: Imran\'s day — 4 accounts you hold, 2 gone quiet, 3 tickets open on you, 9 conversations logged; care rows as the front end words them', async () => {
  const rig = await makeRig(load, route()); rig.refusals = [];
  const { q } = queues(rig);
  const r = await q.today(await principal(rig, IMRAN, 'kam', 'kam'));
  assert.equal(r.ok, true);
  const x = r.queue;
  assert.equal(x.side, 'am'); assert.equal(x.book, 'kam');
  assert.deepEqual(x.tiles, { goneQuiet: 2, accountsHeld: 4, ticketsOpenOnYou: 3, conversationsLogged: 9 });
  assert.deepEqual(x.rows.map((y) => [y.investor.name, y.kind, y.text, y.urg, y.action]), [
    ['Anil Rao', 'due', 'Gone quiet — 10 days past the Tier A cadence', 'now', 'Log a conversation'],
    ['Bina Shah', 'due', 'Gone quiet — 10 days past the Tier B cadence', 'now', 'Log a conversation'],
    ['Dev Nair', 'intro', 'Handed over and never introduced', 'now', 'Record the introduction'],
    ['Chitra Iyer', 'due', 'Due a conversation in 10 days', 'soon', 'Log a conversation'],
  ]);
  assert.equal(x.waiting, 4); assert.equal(x.today, 3);
  assert.deepEqual(x.accounts.map((a) => [a.tier, a.lastHeardAt, a.lastMood]), [['A', '2026-08-19T11:00', 'Warm'], ['B', '2026-06-20T10:00', 'A concern'], ['C', '2026-04-11T10:00', 'Warm'], ['B', '2026-09-01T10:00', 'Warm']]);
  assert.deepEqual(x.tickets.map((t) => t.number), ['00001', '00002', '00003']);
  // TC-IM03-011: no money, no contact details, on the KAM's day
  const s = JSON.stringify(x);
  assert.doesNotMatch(s, moneyWords);
  assert.ok(!s.includes(SECRET_EMAIL) && !s.includes(SECRET_PHONE));
  // KAM-scoped reads: Touches for the book's own leads only, never Receipts
  assert.ok(rig.queries.some((q) => q.includes('from Touches') && L.every((l) => q.includes(l))));
  assert.ok(!rig.queries.some((q) => /Receipts|Unit_Price|Amount/.test(q)));
});

test('a KAM never sees an account named to someone else, even if the book service let one through', async () => {
  const rig = await makeRig(load, route({ touches: 'coql.touches.none' })); rig.refusals = [];
  const { q } = queues(rig, { book: [...IMRAN_BOOK, entry(C(9), 'Other', 'Account', 4, NEHA, null)] });
  const r = await q.today(await principal(rig, IMRAN, 'kam', 'kam'));
  assert.equal(r.queue.tiles.accountsHeld, 4);
  assert.ok(!JSON.stringify(r.queue).includes(C(9)));
});

test('TC-IM03-012: the Head of AM\'s day flags a Tier B account with nobody on it, with "Assign manager"; a Tier C one sits in the pool unflagged', async () => {
  const rig = await makeRig(load, route({ touches: 'coql.touches.none' })); rig.refusals = [];
  const book = [entry(C(20), 'Vikram', 'Anand', 2, null, null, { scope: 'pool', kamSince: null }), entry(C(21), 'Pooja', 'Menon', 1, null, null, { scope: 'pool', kamSince: null }), ...IMRAN_BOOK.slice(0, 1)];
  const { q } = queues(rig, { book });
  const r = await q.today(await principal(rig, DIVYA, 'amlead', 'amlead'));
  assert.equal(r.queue.book, 'head');
  const v = r.queue.rows.filter((y) => y.investor.id === C(20));
  assert.deepEqual(v.map((y) => [y.kind, y.text, y.action, y.urg]), [['nokam', 'Tier B and nobody is looking after them', 'Assign manager', 'now']]);
  assert.ok(!r.queue.rows.some((y) => y.investor.id === C(21)));
  assert.equal(r.queue.tiles.accountsHeld, 3);
  assert.equal(r.queue.tiles.ticketsOpenOnYou, 0, 'tickets on Divya only');
});

test('TC-IM03-003 / T03: Harsha — the IR\'s claim on Prakash Bhat ("Answer it", today), then the two holds by days left; no amount on any row', async () => {
  const rig = await makeRig(load, route()); rig.refusals = [];
  const { q, calls } = queues(rig, { now: SEP02 });
  const r = await q.today(await principal(rig, HARSHA, 'head', 'head'));
  assert.equal(r.ok, true);
  const x = r.queue;
  assert.equal(x.side, 'money'); assert.equal(x.readOnly, false);
  assert.deepEqual(x.rows.map((y) => [y.investor.name, y.kind, y.text, y.action, y.urg]), [
    ['Prakash Bhat', 'claim', 'An IR says the money has arrived — confirm it', 'Answer it', 'now'],
    ['Joseph Mathew', 'hold', 'Balance due — hold ends in 19 days', 'Open the record', 'soon'],
    ['Prakash Bhat', 'hold', 'Balance due — hold ends in 21 days', 'Open the record', 'soon'],
  ]);
  assert.equal(x.waiting, 3); assert.equal(x.today, 1);
  // W6-FIN-1: a hold row carries the ARL ID, so the Today row never falls back to the raw Zoho id
  assert.deepEqual(x.rows.filter((y) => y.kind === 'hold').map((y) => y.investor.code), ['ARL-INV-0209', 'ARL-INV-0208']);
  assert.equal(x.rows[0].ref.claimId, claimRow.claimId);
  assert.doesNotMatch(JSON.stringify(x), moneyWords);
  assert.equal(calls.claims, 1); assert.equal(calls.documents, 1);
  assert.ok(!rig.queries.some((q) => /from Contacts/.test(q)), 'Head of Finance does not own KYC');
  // the claim's investor is read on the AM projection (no price, no amount)
  assert.ok(rig.queries.some((q) => /select id, Customer, Customer.Full_Name, Allocation_Status from LLP_UnitAllocation_Module where \(id in/.test(q)));
});

test('M05-S07 AC2/AC6: an answered claim leaves the queue on the next read (nothing cached)', async () => {
  const rig = await makeRig(load, route()); rig.refusals = [];
  const p = await principal(rig, HARSHA, 'head', 'head');
  const first = await queues(rig, { now: SEP02 }).q.today(p);
  const second = await queues(rig, { now: SEP02, claims: [] }).q.today(p);
  assert.equal(first.queue.rows.filter((y) => y.kind === 'claim').length, 1);
  assert.equal(second.queue.rows.filter((y) => y.kind === 'claim').length, 0);
  assert.equal(second.queue.waiting, 2);
});

test('a reader that fails leaves its rows out and names itself; the claims are still served', async () => {
  const rig = await makeRig(load, route()); rig.refusals = [];
  const r = await queues(rig, { now: SEP02, holdsFail: true }).q.today(await principal(rig, HARSHA, 'head', 'head'));
  assert.deepEqual(r.queue.problems, ['holds:network']);
  assert.deepEqual(r.queue.rows.map((y) => y.kind), ['claim']);
});

test('TC-IM03-005: Fahad (Compliance & KYC) — Joseph\'s "KYC is not passed" with "Check it" and his FEMA row; a lapsed investor and Prakash are not listed; no money readers run', async () => {
  const rig = await makeRig(load, route()); rig.refusals = [];
  const { q, calls } = queues(rig);
  const r = await q.today(await principal(rig, FAHAD, 'comp', 'comp'));
  assert.deepEqual(r.queue.rows.map((y) => [y.investor.name, y.text, y.action]), [
    ['Joseph Mathew', 'KYC is not passed', 'Check it'],
    ['Joseph Mathew', 'FEMA declaration outstanding', 'Open the record'],
  ]);
  assert.equal(calls.claims + calls.holds, 0);
  const kyc = rig.queries.find((q) => /from Contacts/.test(q));
  assert.match(kyc, /^select id, First_Name, Last_Name, KYC, FEMA_Applicable, FEMA_Verified_At from Contacts/);
  assert.doesNotMatch(kyc, /PAN|Aadhaar|Bank/i);
});

test('paper seats: a signed paper is "Verify it" (today); one out 5 days is "Remind"; one out a day is not chased yet; no sent time → "out for signature"', async () => {
  const rig = await makeRig(load, route()); rig.refusals = [];
  const doc = (key, state, sentAt, label = 'Supplementary agreement') => ({ key, paper: 'supplementary', label, scope: 'allotment', module: 'LLP_UnitAllocation_Module',
    recordId: `${P}740996204`, party: 'Joseph Mathew', contactId: C(1), llpId: null, requestId: '1234567890', method: null, state, verifiedAt: null,
    sign: sentAt ? { status: 'inprogress', sentAt, sentBy: null, expiresAt: null } : null, yourMove: null });
  const docs = [doc('a', 'signed', null, 'Allocation letter'), doc('b', 'sent', '2026-09-23T10:00:00+05:30'), doc('c', 'sent', '2026-09-27T10:00:00+05:30'), doc('d', 'sent', null, 'FEMA declaration')];
  const r = await queues(rig, { docs }).q.today(await principal(rig, FAHAD, 'comp', 'comp'));
  const paper = r.queue.rows.filter((y) => y.kind === 'verify' || y.kind === 'remind');
  assert.deepEqual(paper.map((y) => [y.text, y.action, y.urg]), [
    ['Verify the signed allocation letter', 'Verify it', 'now'],
    ['Supplementary agreement · sent 5 days ago', 'Remind', 'soon'],
    ['FEMA declaration · out for signature', 'Remind', 'soon'],
  ]);
});

test('paper reminders run oldest-first (most days out first, no sent time last); a Declined / Recalled request is not chased', async () => {
  const rig = await makeRig(load, route()); rig.refusals = [];
  const doc = (key, sentAt, status = 'sent', label = 'Supplementary agreement') => ({ key, paper: 'supplementary', label, scope: 'allotment', module: 'LLP_UnitAllocation_Module',
    recordId: `${P}740996204`, party: 'Joseph Mathew', contactId: C(1), llpId: null, requestId: '1234567890', method: null, state: 'sent', verifiedAt: null,
    sign: sentAt ? { status, sentAt, sentBy: null, expiresAt: null, label: null } : null, yourMove: null });
  const docs = [doc('n', null, 'sent', 'FEMA declaration'), doc('a', '2026-09-24T10:00+05:30'), doc('o', '2026-09-10T10:00+05:30', 'viewed', 'Allocation letter'),
    doc('x', '2026-09-01T10:00+05:30', 'declined'), doc('y', '2026-09-02T10:00+05:30', 'recalled')];
  const r = await queues(rig, { docs }).q.today(await principal(rig, FAHAD, 'comp', 'comp'));
  assert.deepEqual(r.queue.rows.filter((y) => y.kind === 'remind').map((y) => y.text), [
    'Allocation letter · sent 18 days ago', 'Supplementary agreement · sent 4 days ago', 'FEMA declaration · out for signature',
  ]);
});

test('TC-IM03-004: the Auditor has nothing waiting and is told the seat is read-only — no Zoho read at all', async () => {
  const rig = await makeRig(load, route()); rig.refusals = [];
  const { q, calls } = queues(rig);
  const r = await q.today(await principal(rig, LATHA, 'audit', 'audit'));
  assert.deepEqual({ readOnly: r.queue.readOnly, rows: r.queue.rows.length, waiting: r.queue.waiting }, { readOnly: true, rows: 0, waiting: 0 });
  assert.equal(rig.queries.length + calls.claims + calls.holds + calls.documents, 0);
});

test('an IR has no Investors-side Today: refused, one refusal line with codes only', async () => {
  const rig = await makeRig(load, route()); rig.refusals = [];
  const r = await queues(rig).q.today(await principal(rig, IR, 'ir', 'audit'));
  assert.deepEqual([r.ok, r.reason], [false, 'no-book']);
  assert.equal(rig.queries.length, 0);
});

test('W2-KAM-3 / W2-KAM-4: Last heard counts only the account KAM\'s own touches (another person\'s touch on the origin lead does not), and the queue row carries the ARL code', async () => {
  const rig = await makeRig(load, route()); rig.refusals = [];
  // the recorded touches on these leads are Imran's: the account now held by Latha has none of its own
  const { q } = queues(rig, { book: [entry(C(1), 'Anil', 'Rao', 4, LATHA, L[0]), entry(C(2), 'Bina', 'Shah', 2, IMRAN, L[1])] });
  const r = await q.today(await principal(rig, DIVYA, 'amlead', 'amlead'));
  assert.deepEqual(r.queue.accounts.map((a) => [a.name, a.lastHeardAt]), [['Anil Rao', null], ['Bina Shah', '2026-06-20T10:00']]);
  assert.deepEqual(r.queue.rows.map((y) => y.investor.code), r.queue.rows.map((y) => 'ARL-' + y.investor.id.slice(-3)));
});

/* ---- G1 (D136 proposed): the IRs' "ask Finance to send it" on Finance's to-do ---------------------------------------------------- */

const LEAD_A = `${P}740996101`, LEAD_B = `${P}740996102`, LEAD_C = `${P}740996103`;
const reqLead = (id, first, at, by, extra = {}) => ({ id, First_Name: first, Last_Name: 'Synthetic', NDA_Requested_At: at, Owner: { id: IR, name: by },
  'Owner.full_name': by, NDA_Sign_Req_Id: null, NDA_Verified_At: null, ...extra });
const suppLead = (id, first, at) => ({ id, First_Name: first, Last_Name: 'Synthetic', Supp_Requested_At: at, Owner: { id: IR, name: 'Rohit Iyer' }, 'Owner.full_name': 'Rohit Iyer' });

test('G1: "Send the NDA — requested by <IR> n days ago" for each lead asked for and not yet sent, oldest first, linking to the send panel', async () => {
  const ndaReq = ok([reqLead(LEAD_A, 'Kiran', '2026-09-26T09:00:00+05:30', 'Rohit Iyer'), reqLead(LEAD_B, 'Meera', '2026-09-28T09:00:00+05:30', 'Kavya Rao'),
    reqLead(LEAD_C, 'Out', '2026-09-20T09:00:00+05:30', 'Rohit Iyer', { NDA_Sign_Req_Id: '1234567890123' })]);
  const rig = await makeRig(load, route({ ndaReq })); rig.refusals = [];
  const r = await queues(rig, { now: NOW, claims: [] }).q.today(await principal(rig, HARSHA, 'head', 'head'));
  const send = r.queue.rows.filter((y) => y.kind === 'send');
  assert.deepEqual(send.map((y) => [y.investor.name, y.text, y.action, y.urg, y.days]), [
    ['Kiran Synthetic', 'Send the NDA — requested by Rohit Iyer 2 days ago', 'Send it', 'now', 2],
    ['Meera Synthetic', 'Send the NDA — requested by Kavya Rao today', 'Send it', 'now', 0],
  ], 'a lead whose NDA is already out is not listed');
  assert.deepEqual({ ...send[0].ref }, { leadId: LEAD_A, paper: 'nda' });
  const q = rig.queries.find((x) => /NDA_Requested_At is not null/.test(x));
  assert.match(q, /from Leads where \(\(\(NDA_Requested_At is not null and NDA_Sign_Req_Id is null\) and NDA_Verified_At is null\) and Lost_At is null\)/);
  assert.equal(r.queue.requestsNote, rules.REQUESTS_PARTIAL_TEXT, 'until the Finance sharing rule on Leads is confirmed, the queue says the list may be partial');
  const shared = await queues(await makeRig(load, route({ ndaReq })), { claims: [], shared: true }).q.today(await principal(rig, HARSHA, 'head', 'head'));
  assert.equal(shared.queue.requestsNote, null);
});

test('G1: a Leads read Zoho refuses is said on the queue (requests cannot be read), never an empty "nothing waiting"; the rest is still served', async () => {
  const refused = { status: 403, headers: { 'content-type': 'application/json' }, body: { code: 'NO_PERMISSION', message: 'permission denied', status: 'error', details: {} } };
  const rig = await makeRig(load, route({ ndaReq: refused, suppReq: refused })); rig.refusals = [];
  const r = await queues(rig, { now: SEP02 }).q.today(await principal(rig, HARSHA, 'head', 'head'));
  assert.equal(r.ok, true);
  assert.equal(r.queue.requestsNote, rules.REQUESTS_UNREAD_TEXT);
  assert.ok(r.queue.problems.length >= 1 && r.queue.problems.every((x) => x.startsWith('send-requests:')), JSON.stringify(r.queue.problems));
  assert.ok(r.queue.rows.some((y) => y.kind === 'claim'), 'the claims are still served');
});

test('G1: request fields Zoho does not know yet are named as such; the requester\'s name falls back to "an IR" when Zoho will not give it', async () => {
  const bad = { status: 400, headers: { 'content-type': 'application/json' }, body: { code: 'INVALID_QUERY', message: 'invalid column', status: 'error', details: {} } };
  const rig = await makeRig(load, route({ ndaReq: bad, suppReq: bad })); rig.refusals = [];
  const r = await queues(rig, { claims: [] }).q.today(await principal(rig, HARSHA, 'head', 'head'));
  assert.equal(r.queue.requestsNote, rules.REQUESTS_NO_FIELDS_TEXT);
  // the name column refused, the plain read answers: no name → "an IR"
  const ndaReq = (q) => (/full_name/.test(q) ? bad : ok([{ ...reqLead(LEAD_A, 'Kiran', '2026-09-27T09:00:00+05:30', null) }]));
  const rig2 = await makeRig(load, route({ ndaReq })); rig2.refusals = [];
  const r2 = await queues(rig2, { claims: [] }).q.today(await principal(rig2, HARSHA, 'head', 'head'));
  assert.deepEqual(r2.queue.rows.filter((y) => y.kind === 'send').map((y) => y.text), ['Send the NDA — requested by an IR 1 day ago']);
  assert.equal(r2.queue.requestsNote, rules.REQUESTS_PARTIAL_TEXT);
});

test('W7-FIN-4: the requester is named first + last (COQL full_name gave the last name alone); full_name only when Zoho refuses those', async () => {
  const bad = { status: 400, headers: { 'content-type': 'application/json' }, body: { code: 'INVALID_QUERY', message: 'invalid column', status: 'error', details: {} } };
  const ndaReq = (q) => (/first_name/.test(q)
    ? ok([{ ...reqLead(LEAD_A, 'Kiran', '2026-09-27T09:00:00+05:30', 'Test'), 'Owner.first_name': 'IR A', 'Owner.last_name': 'Test' }])
    : ok([reqLead(LEAD_A, 'Kiran', '2026-09-27T09:00:00+05:30', 'Test')]));
  const rig = await makeRig(load, route({ ndaReq })); rig.refusals = [];
  const r = await queues(rig, { claims: [] }).q.today(await principal(rig, HARSHA, 'head', 'head'));
  assert.deepEqual(r.queue.rows.filter((y) => y.kind === 'send').map((y) => y.text), ['Send the NDA — requested by IR A Test 1 day ago']);
  assert.match(rig.queries.find((x) => /NDA_Requested_At is not null/.test(x)), /Owner\.first_name, Owner\.last_name/);
  const ndaReq2 = (q) => (/first_name/.test(q) ? bad : ok([reqLead(LEAD_A, 'Kiran', '2026-09-27T09:00:00+05:30', 'Rohit Iyer')]));
  const rig2 = await makeRig(load, route({ ndaReq: ndaReq2 })); rig2.refusals = [];
  const r2 = await queues(rig2, { claims: [] }).q.today(await principal(rig2, HARSHA, 'head', 'head'));
  assert.deepEqual(r2.queue.rows.filter((y) => y.kind === 'send').map((y) => y.text), ['Send the NDA — requested by Rohit Iyer 1 day ago']);
});

test('G1: the supplementary asked for is listed against the investor until a Sign request is on a live allotment; no investor yet → the lead', async () => {
  const suppReq = ok([suppLead(LEAD_A, 'Kiran', '2026-09-25T09:00:00+05:30'), suppLead(LEAD_B, 'Meera', '2026-09-27T09:00:00+05:30'), suppLead(LEAD_C, 'Nobody', '2026-09-26T09:00:00+05:30')]);
  const suppContacts = ok([{ id: C(1), Origin_Lead: { id: LEAD_A }, First_Name: 'Kiran', Last_Name: 'Investor' }, { id: C(2), Origin_Lead: { id: LEAD_B }, First_Name: 'Meera', Last_Name: 'Investor' }]);
  const suppAllots = ok([{ id: `${P}740996204`, Customer: { id: C(2) }, Supplementary_Sign_Req_Id: '1234567890123', Supplementary_Verified_At: null }]);
  const rig = await makeRig(load, route({ suppReq, suppContacts, suppAllots })); rig.refusals = [];
  const r = await queues(rig, { claims: [] }).q.today(await principal(rig, FAHAD, 'comp', 'comp'));
  const send = r.queue.rows.filter((y) => y.kind === 'send');
  assert.deepEqual(send.map((y) => [y.investor.id, y.investor.name, y.text, { ...y.ref }]), [
    [C(1), 'Kiran Investor', 'Send the supplementary agreement — requested by Rohit Iyer 3 days ago', { leadId: LEAD_A, contactId: C(1), paper: 'supplementary' }],
    [LEAD_C, 'Nobody Synthetic', 'Send the supplementary agreement — requested by Rohit Iyer 2 days ago', { leadId: LEAD_C, paper: 'supplementary' }],
  ], 'Meera\'s supplementary is out on her allotment');
  assert.ok(rig.queries.some((x) => /Supplementary_Sign_Req_Id.*Allocation_Status != 'Cancelled'/.test(x)), 'only live allotments count as sent');
});

test('D138: a KAM\'s "confirm the full payment" request is a row on Finance\'s to-do (oldest first), opening the record; no money name is selected', async () => {
  const confirmReq = ok([
    { id: `${P}740996301`, Customer: { id: C(1) }, 'Customer.Full_Name': 'Synth One', 'Customer.ARL_ID': 'ARL-INV-0301', Convert_Requested_At: '2026-09-01T10:00:00+05:30' },
    { id: `${P}740996302`, Customer: { id: C(2) }, 'Customer.Full_Name': 'Synth Two', 'Customer.ARL_ID': 'ARL-INV-0302', Convert_Requested_At: '2026-08-30T10:00:00+05:30' },
  ]);
  const rig = await makeRig(load, route({ confirmReq })); rig.refusals = [];
  const r = await queues(rig, { now: SEP02, claims: [] }).q.today(await principal(rig, HARSHA, 'head', 'head'));
  const rows = r.queue.rows.filter((y) => y.kind === 'confirm');
  assert.deepEqual(rows.map((y) => [y.investor.name, y.text, y.action, y.ref.allotmentId]), [
    ['Synth Two', 'Confirm the full payment — the KAM asked 3 days ago', 'Open the record', `${P}740996302`],
    ['Synth One', 'Confirm the full payment — the KAM asked 1 day ago', 'Open the record', `${P}740996301`],
  ]);
  const q = rig.queries.find((x) => /Convert_Requested_At is not null/.test(x));
  assert.match(q, /Allocation_Status = 'Reserved'/);
  assert.match(q, /Converted_At is null/);
  assert.ok(!/Price|Amount|Receivable|Received/.test(q.split(' from ')[0]), q);
});

test('G1: a seat without the paper right (Head of AM, Auditor) never reads the requests', async () => {
  const rig = await makeRig(load, route()); rig.refusals = [];
  await queues(rig).q.today(await principal(rig, LATHA, 'audit', 'audit'));
  assert.ok(!rig.queries.some((x) => /from Leads/.test(x)));
});
