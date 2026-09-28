/* M14-S03-T01 — the event sheet loader on recorded Zoho answers.
 * Run from console/: node --test src/server/events/loader.test.cjs */
'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { compile } = require('../cases/fixture-rig.cjs');
const { makeWriteRig, P } = require('./write-rig.cjs');

const load = compile(['server/events/loader.ts', 'server/data/events.ts', 'server/identity/plane-c.ts']);
const { createSheetLoader, spellings, phoneKey } = load('server/events/loader.js');
const ROHIT = `${P}740995001`, KAVYA = `${P}740995003`, MGR = `${P}740995002`;
const PRESTIGE = `${P}740997601`;
const yes = { msg: true, call: true };
const ROWS = [
  { name: 'Asha Kulkarni', mobile: '9400000001', consent: yes },
  { name: 'Bad Number', mobile: '12', consent: yes },
  { name: 'Ravi Rao', mobile: '9400000002', consent: { msg: true, call: false } },
  { name: 'Meena Iyer', mobile: '9400000003', consent: yes },          // already on the book (COQL)
  { name: 'Asha Again', mobile: '+91 94000 00001', consent: yes },     // twice in the sheet
  { name: 'Kiran Shah', mobile: '9400000005', consent: yes },
  { name: 'Lata Menon', mobile: '9400000006', consent: yes },          // Zoho says DUPLICATE_DATA (another book)
  { name: 'Arjun Das', mobile: '9400000007', email: 'arjun@example.com', consent: { ...yes, email: true } },
];
const intake = (rows = ROWS) => ({ rows: async () => rows });

function route(sheet = 'coql.sheet-ready') {
  return (c) => {
    if (c.method === 'POST' && c.path === '/coql') {
      if (/from Lead_Events_X_Users/.test(c.query)) return 'coql.sheet-staff';
      if (/from Lead_Events where/.test(c.query)) return sheet;
      if (/from Leads where \(Mobile in/.test(c.query)) return 'coql.sheet-onbook';
      return 'coql.none';
    }
    if (c.method === 'PUT' && c.path === `/Lead_Events/${PRESTIGE}`) return 'update.sheet-claim';
    if (c.method === 'POST' && c.path === '/Leads') return 'insert.sheet-leads';
    throw new Error(`unrouted ${c.method} ${c.path}`);
  };
}
const writes = (calls) => calls.filter((c) => !(c.method === 'POST' && c.path === '/coql'));

test('round-robin: new rows become leads dealt across the event staff in named order; duplicates skipped by the book and by Zoho', async () => {
  const rig = await makeWriteRig(load, route());
  const r = await createSheetLoader(rig).load(await rig.cred(ROHIT), PRESTIGE, { kind: 'round-robin' }, intake());
  assert.equal(r.ok, true);
  const v = r.value;
  assert.deepEqual([v.inFile, v.loaded, v.duplicates, v.refused], [8, 3, 2, 3]);
  assert.deepEqual(v.split.map((s) => ({ ...s })), [{ ownerId: ROHIT, count: 1 }, { ownerId: KAVYA, count: 2 }]);
  assert.deepEqual(v.assigned.map((a) => ({ ...a })), [{ leadId: `${P}740996601`, ownerId: ROHIT }, { leadId: `${P}740996602`, ownerId: KAVYA }, { leadId: `${P}740996604`, ownerId: KAVYA }]);
  assert.deepEqual(v.rows.map((x) => x.status === 'refused' ? x.reason : x.status), ['added', 'mobile', 'consent', 'duplicate', 'duplicate-in-file', 'added', 'duplicate', 'added']);
  assert.equal(v.countsSaved, true);

  const w = writes(rig.calls);
  assert.deepEqual(w.map((c) => `${c.method} ${c.path}`), [`PUT /Lead_Events/${PRESTIGE}`, 'POST /Leads', `PUT /Lead_Events/${PRESTIGE}`]);
  // the claim first, guarded, so a second load cannot pass
  assert.deepEqual(w[0].body.data[0], { Load_State: 'Loaded', Loaded_By: { id: ROHIT }, Loaded_At: '2026-09-28T11:30:00+05:30' });
  assert.equal(w[0].headers['If-Unmodified-Since'], '2026-09-25T10:00:00+05:30');
  const recs = w[1].body.data;
  assert.equal(recs.length, 4);
  assert.deepEqual(recs[0], { First_Name: 'Asha', Last_Name: 'Kulkarni', Mobile: '+919400000001', City: 'Bengaluru', Lead_Source: 'Events',
    Lead_Event: { id: PRESTIGE }, Owner: { id: ROHIT }, Owner_Assigned_At: '2026-09-28T11:30:00+05:30', Consent_WhatsApp: true, Consent_Call: true,
    Consent_How: 'Event sheet', Consent_At: '2026-09-28T11:30:00+05:30', Consent_By: { id: ROHIT } });
  assert.deepEqual(recs.map((x) => x.Owner.id), [ROHIT, KAVYA, ROHIT, KAVYA]);
  assert.equal(recs[3].Consent_Email, true);
  assert.deepEqual(w[2].body.data[0], { Rows_In_File: 8, Rows_Loaded: 3, Rows_Duplicate: 2, Rows_Refused: 3 });
  assert.equal(w[2].headers['If-Unmodified-Since'], '2026-09-28T11:29:00+05:30');
  // one COQL for the book check, ≤100 values; no number and no name in any log line
  const q = rig.calls.find((c) => /Mobile in/.test(c.query || '')).query;
  assert.ok((q.match(/'/g).length / 2) <= 100);
  const logs = JSON.stringify(rig.sink.records());
  assert.ok(!/9400000|Asha|Kulkarni/.test(logs));
});

test('a sheet loads once: a loaded event is refused before anything is read or written', async () => {
  const rig = await makeWriteRig(load, route('coql.sheet-loaded'));
  const r = await createSheetLoader(rig).load(await rig.cred(ROHIT), PRESTIGE, { kind: 'round-robin' }, intake());
  assert.equal(r.reasonCode, 'already-loaded');
  assert.equal(r.reason, 'A sheet loads once.');
  assert.equal(writes(rig.calls).length, 0);
});

test('two loads racing: the second claim meets a 412 and is told the sheet is loaded; no lead is written', async () => {
  const rig = await makeWriteRig(load, (c) => c.method === 'PUT' ? 'update.conflict' : route()(c));
  const r = await createSheetLoader(rig).load(await rig.cred(ROHIT), PRESTIGE, { kind: 'round-robin' }, intake());
  assert.equal(r.reasonCode, 'already-loaded');
  assert.ok(!rig.calls.some((c) => c.path === '/Leads'));
});

test('a seat without the load right is refused with the card\'s words and costs no call', async () => {
  const rig = await makeWriteRig(load, route(), { mayLoad: false });
  const r = await createSheetLoader(rig).load(await rig.cred(MGR), PRESTIGE, { kind: 'round-robin' }, intake());
  assert.equal(r.reasonCode, 'capability-missing');
  assert.equal(r.reason, 'Your seat does not load event sheets; the IR team or Marketing do.');
  assert.equal(rig.calls.length, 0);
});

test('"All to one person" without the person is refused (Load is disabled); a person off the event is not assignable', async () => {
  const rig = await makeWriteRig(load, route());
  const l = createSheetLoader(rig);
  assert.equal((await l.load(await rig.cred(MGR), PRESTIGE, { kind: 'one', ownerId: null }, intake())).reasonCode, 'owner-missing');
  assert.equal(rig.calls.length, 0);
  assert.equal((await l.load(await rig.cred(MGR), PRESTIGE, { kind: 'one', ownerId: `${P}740995999` }, intake())).reasonCode, 'owner-not-assignable');
  const ok = await l.load(await rig.cred(MGR), PRESTIGE, { kind: 'one', ownerId: KAVYA }, intake());
  assert.equal(ok.ok, true);
  assert.deepEqual([...ok.value.assigned], []);
});

test('unassigned needs the queue user; when every insert fails the claim is handed back (Ready)', async () => {
  const rig = await makeWriteRig(load, route());
  assert.equal((await createSheetLoader(rig).load(await rig.cred(ROHIT), PRESTIGE, { kind: 'unassigned' }, intake())).reasonCode, 'unassigned-queue-missing');
  const rig2 = await makeWriteRig(load, (c) => c.method === 'POST' && c.path === '/Leads' ? 'source.server-error' : route()(c));
  const r = await createSheetLoader(rig2).load(await rig2.cred(ROHIT), PRESTIGE, { kind: 'me' }, intake());
  assert.equal(r.kind, 'source-error');
  const last = writes(rig2.calls).pop();
  assert.deepEqual(last.body.data[0], { Load_State: 'Ready', Loaded_By: null, Loaded_At: null });
});

test('number spellings and keys', () => {
  assert.deepEqual(spellings('+919400000001'), ['+919400000001', '919400000001', '9400000001', '09400000001']);
  assert.equal(phoneKey('+91 94000 00001'), '9400000001');
});
