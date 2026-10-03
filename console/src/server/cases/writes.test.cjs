/* M13-S03-T02 — open, wait, close and reply on recorded Zoho answers. Run from console/: node --test src/server/cases/writes.test.cjs */
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const { compile, makeHttpRig, P, NOW } = require('./fixture-rig.cjs');

const load = compile(['server/cases/writes.ts', 'server/data/scope.ts', 'server/data/events.ts', 'server/identity/plane-c.ts',
  'server/contracts/events.ts', 'server/contracts/stub.ts']);
const { createCaseWrites, slaDue, REFUSAL_TEXT } = load('server/cases/writes.js');
const { imRightsOf } = load('server/cases/rights.js');
const { scopedKey, scopesFor } = load('server/data/scope.js');
const { validateEvent } = load('server/contracts/events.js');
const { loadSchemas } = load('server/contracts/stub.js');
const schemas = loadSchemas(path.resolve(__dirname, '..', '..', '..', '..', 'contracts'));

const HARSHA = `${P}740993002`, MEENA = `${P}740993001`, FAHAD = `${P}740993003`, KAM = `${P}740994001`, LATHA = `${P}740993009`;
const ABHIJIT = `${P}740997206`;

/* one recorded answer per call: COQL by what it reads, writes by method and path */
const route = (c) => {
  if (c.path === '/coql') {
    if (/from Contacts/.test(c.query)) return /740997206/.test(c.query) ? ['cases', 'coql.contact.in-book'] : { status: 204 };
    const id = (c.query.match(/id = '\d+(\d{3})'/) || [])[1];
    return ['cases', `coql.case.${id}`];
  }
  if (c.method === 'POST' && c.path === '/Cases') return ['cases', 'insert.case'];
  if (c.method === 'POST' && c.path === '/Notes') return ['cases', 'insert.note'];
  if (c.method === 'PUT') return ['cases', 'update.case'];
  throw new Error(`unrouted ${c.method} ${c.path}`);
};
const refusals = (rig) => rig.sink.records().filter((x) => x.kind === 'refusal');

test('the rights come from the one model: Finance holds bank, Compliance and a KAM do not; the Auditor holds nothing', () => {
  assert.deepEqual({ ...imRightsOf('head', HARSHA) }, { tkt: true, bank: true, assign: true, upd: true, team: 'fin' });
  assert.equal(imRightsOf('fin', MEENA).bank, true);
  assert.equal(imRightsOf('comp', FAHAD).bank, false);
  assert.deepEqual({ ...imRightsOf('kam', KAM) }, { tkt: true, bank: false, assign: false, upd: true, team: 'am' });
  assert.equal(imRightsOf('audit', LATHA).tkt, false);
  assert.equal(imRightsOf('exec', LATHA).tkt, false);
});

test('Harsha opens a Records ticket for Abhijit Sen: one Case owned by her, SLA five working days, the number is Zoho\'s', async () => {
  const rig = await makeHttpRig(load, route);
  const key = scopedKey(scopesFor('head', HARSHA).cases, 'cases.cuts');
  let loads = 0;
  await rig.cache.readSettled(key, async () => { loads++; return { open: 6, high: 2, waiting: 1, closed: 1, all: 7 }; });
  const r = await createCaseWrites({ ...rig, clock: () => NOW }).open({ credential: await rig.cred(HARSHA), seat: 'head' },
    { investorId: ABHIJIT, category: 'Records', subject: 'Wants a copy of the allocation letter' });
  assert.equal(r.ok, true);
  assert.equal(r.row.number, 'TK-0118');
  assert.equal(r.row.own, HARSHA);
  assert.equal(r.row.cat, 'Records');
  assert.equal(r.row.inv, ABHIJIT);
  assert.equal(r.row.state, 'open');
  const [ins] = rig.writes();
  assert.equal(ins.path, '/Cases');
  assert.deepEqual(ins.body.data[0], {
    Subject: 'Wants a copy of the allocation letter', Description: '', Related_To: { id: ABHIJIT }, Owner: { id: HARSHA },
    Priority: 'Medium', Status: 'New', Case_Origin: 'Phone', Ticket_Category: 'Records', SLA_Due: '2026-10-05T11:30:00+05:30',
  });
  assert.match(rig.calls[0].query, /from Contacts where \(id is not null\) and id = '9007199254740997206'/);
  // the cached Open count is dropped: the next read of the cuts goes back to Zoho
  await rig.cache.readSettled(key, async () => { loads++; return { open: 7, high: 2, waiting: 1, closed: 1, all: 8 }; });
  assert.equal(loads, 2);
});

test('SLA: high priority is two working days, and a weekend does not count', () => {
  assert.equal(slaDue(NOW, 2), '2026-09-30T11:30:00+05:30');
  assert.equal(slaDue(Date.parse('2026-10-02T06:00:00Z'), 2), '2026-10-06T11:30:00+05:30'); // Friday → Tuesday
});

test('refused before any write: an investor outside the book, a KAM naming another owner, the Auditor, a bad category', async () => {
  const rig = await makeHttpRig(load, route);
  const out = await createCaseWrites(rig).open({ credential: await rig.cred(KAM), seat: 'kam' }, { investorId: `${P}740997299`, category: 'Query', subject: 'x' });
  assert.equal(out.reason, 'not-in-book');
  assert.match(rig.calls[0].query, new RegExp(`KAM = '${KAM}'`));
  const as = await createCaseWrites(rig).open({ credential: await rig.cred(KAM), seat: 'kam' }, { investorId: ABHIJIT, category: 'Query', subject: 'x', ownerId: MEENA });
  assert.equal(as.reason, 'cannot-assign');
  const ro = await createCaseWrites(rig).open({ credential: await rig.cred(LATHA), seat: 'audit' }, { investorId: ABHIJIT, category: 'Query', subject: 'x' });
  assert.equal(ro.reason, 'read-only');
  const bad = await createCaseWrites(rig).open({ credential: await rig.cred(HARSHA), seat: 'head' }, { investorId: ABHIJIT, category: 'Payout', subject: 'x' });
  assert.equal(bad.reason, 'invalid-request');
  assert.equal(rig.writes().length, 0);
  assert.equal(refusals(rig).length, 4);
});

test('Meena closes "Add a nominee": Status Closed and Closed_At, conditional on the time the screen loaded', async () => {
  const rig = await makeHttpRig(load, route);
  const r = await createCaseWrites({ ...rig, clock: () => NOW }).move({ credential: await rig.cred(MEENA), seat: 'fin' }, `${P}740998406`, 'closed', '2026-09-20T09:00:00+05:30');
  assert.equal(r.ok, true);
  assert.equal(r.already, false);
  assert.equal(r.row.state, 'closed');
  assert.equal(r.row.closed, '2026-09-28T11:30');
  assert.equal(r.modifiedTime, '2026-09-28T11:31:00+05:30');
  assert.equal(r.row.version, '2026-09-28T11:31:00+05:30', 'the answered row carries the new version');
  assert.ok(rig.calls.filter((c) => c.path === '/coql').every((c) => (c.query.match(/Modified_Time/g) || []).length === 1), 'Modified_Time selected once');
  const [put] = rig.writes();
  assert.equal(put.method, 'PUT');
  assert.equal(put.path, `/Cases/${P}740998406`);
  assert.deepEqual(put.body.data[0], { Status: 'Closed', Closed_At: '2026-09-28T11:30:00+05:30' });
  assert.equal(put.headers['if-unmodified-since'], '2026-09-20T09:00:00+05:30');
});

test('waiting on them is On Hold; a ticket already waiting is not written again', async () => {
  const rig = await makeHttpRig(load, route);
  const w = await createCaseWrites(rig).move({ credential: await rig.cred(MEENA), seat: 'fin' }, `${P}740998406`, 'waiting');
  assert.equal(w.row.state, 'waiting');
  assert.deepEqual(rig.writes()[0].body.data[0], { Status: 'On Hold' });
  const again = await createCaseWrites(rig).move({ credential: await rig.cred(KAM), seat: 'kam' }, `${P}740998403`, 'waiting');
  assert.equal(again.already, true);
  assert.equal(rig.writes().length, 1);
});

test('a Bank ticket and a seat that cannot see bank accounts: refused with the named reason, nothing written', async () => {
  const rig = await makeHttpRig(load, route);
  const r = await createCaseWrites(rig).move({ credential: await rig.cred(FAHAD), seat: 'comp' }, `${P}740998401`, 'closed');
  assert.deepEqual(r, { ok: false, kind: 'refused', reason: 'bank-seat', message: REFUSAL_TEXT['bank-seat'] });
  const k = await createCaseWrites(rig).move({ credential: await rig.cred(KAM), seat: 'kam' }, `${P}740998401`, 'closed');
  assert.equal(k.reason, 'bank-seat'); // the KAM owns it but cannot see the account
  assert.equal(rig.writes().length, 0);
  assert.deepEqual([...refusals(rig)[0].recordIds], [`${P}740998401`]);
  const ok = await createCaseWrites(rig).move({ credential: await rig.cred(MEENA), seat: 'fin' }, `${P}740998401`, 'closed');
  assert.equal(ok.ok, true);
});

test('a KAM closing a ticket that is not theirs is refused through every path (close, park, reply)', async () => {
  const rig = await makeHttpRig(load, route);
  const w = createCaseWrites(rig);
  const cred = await rig.cred(KAM);
  for (const r of [await w.move({ credential: cred, seat: 'kam' }, `${P}740998406`, 'closed'),
    await w.move({ credential: cred, seat: 'kam' }, `${P}740998406`, 'waiting'),
    await w.reply({ credential: cred, seat: 'kam' }, `${P}740998406`, 'Done from my side.')]) {
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'not-yours');
  }
  assert.equal(rig.writes().length, 0);
  assert.equal(refusals(rig).length, 3);
  assert.ok(!JSON.stringify(rig.sink.records()).includes('nominee'));
});

test('someone else changed the ticket: a stale screen and Zoho\'s 412 both come back as conflict, never an overwrite', async () => {
  const rig = await makeHttpRig(load, route);
  const stale = await createCaseWrites(rig).move({ credential: await rig.cred(MEENA), seat: 'fin' }, `${P}740998406`, 'closed', '2026-09-19T09:00:00+05:30');
  assert.equal(stale.kind, 'conflict');
  assert.equal(rig.writes().length, 0);
  const z = await makeHttpRig(load, (c) => c.method === 'PUT' ? ['cases', 'update.case.conflict'] : route(c));
  const r = await createCaseWrites(z).move({ credential: await z.cred(MEENA), seat: 'fin' }, `${P}740998406`, 'closed');
  assert.equal(r.kind, 'conflict');
});

test('a reply is a Note on the Case, then case.replied to the app, built to its schema; an identity value never leaves', async () => {
  const rig = await makeHttpRig(load, route);
  const sent = [];
  const push = async (e) => { sent.push(e); return { ok: true, eventId: e.event_id, state: { label: 'Not delivered yet', status: 'queued' } }; };
  const r = await createCaseWrites({ ...rig, push, clock: () => NOW }).reply({ credential: await rig.cred(MEENA), seat: 'fin' }, `${P}740998406`, 'The nominee form is in the app now.');
  assert.equal(r.ok, true);
  assert.equal(r.noteId, `${P}740998501`);
  assert.equal(r.delivery.label, 'Not delivered yet');
  const [note] = rig.writes();
  assert.equal(note.path, '/Notes');
  assert.deepEqual(note.body.data[0].Parent_Id, { module: { api_name: 'Cases' }, id: `${P}740998406` });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, 'case.replied');
  assert.equal(sent[0].ids.investor_contact_id, `${P}740997101`);
  assert.deepEqual(validateEvent(schemas, sent[0]), { ok: true, type: 'case.replied' });
  const bad = await createCaseWrites({ ...rig, push }).reply({ credential: await rig.cred(MEENA), seat: 'fin' }, `${P}740998406`, 'Your PAN ABCDE1234F is on file.');
  assert.equal(bad.reason, 'identity-in-reply');
  assert.equal(rig.writes().length, 1);
  assert.equal(sent.length, 1);
});

test('a Zoho failure on the write is a source error, and the cuts are not dropped', async () => {
  const rig = await makeHttpRig(load, (c) => c.method === 'PUT' ? { status: 500, body: { code: 'INTERNAL_ERROR' } } : route(c));
  const r = await createCaseWrites(rig).move({ credential: await rig.cred(MEENA), seat: 'fin' }, `${P}740998406`, 'closed');
  assert.equal(r.kind, 'source-error');
  assert.equal(r.retryable, true);
});
