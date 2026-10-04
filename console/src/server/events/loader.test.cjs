/* M14-S03-T01 — the event sheet loader on recorded Zoho answers.
 * Run from console/: node --test src/server/events/loader.test.cjs */
'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { compile } = require('../cases/fixture-rig.cjs');
const { makeWriteRig, P } = require('./write-rig.cjs');

const load = compile(['server/events/loader.ts', 'server/data/events.ts', 'server/identity/plane-c.ts', 'server/state/memory.ts']);
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

/* ---- M18-S09-NOTE-3: 2,000 rows inside the request deadline -------------------------------------------- */
const { runWithDeadline } = load('lib/zoho/deadline.js');
const { createMemoryState } = load('server/state/memory.js');
const BIG = 2_000;
const bigRows = () => Array.from({ length: BIG }, (_, i) => ({ name: `Synthetic Person${String.fromCharCode(65 + (i % 26))}`, mobile: `94${String(10_000_000 + i)}`, consent: yes }));
const json = (status, body) => ({ status, headers: { 'content-type': 'application/json' }, body });
/** A stateful Zoho stand-in: the event's claim, one lead per number (a repeat is DUPLICATE_DATA), slow inserts, overlap counted. */
function bigZoho(insertMs = 0) {
  const ev = { Load_State: 'Ready', Loaded_By: null, Modified_Time: '2026-09-25T10:00:00+05:30' };
  const leads = new Map(); const owners = new Map();
  let live = 0, peak = 0, coqls = 0, counts = [];
  const route = async (c) => {
    if (c.method === 'POST' && c.path === '/coql') {
      if (/from Lead_Events_X_Users/.test(c.query)) return 'coql.sheet-staff';
      if (/from Lead_Events where/.test(c.query)) return json(200, { data: [{ id: PRESTIGE, Name: 'Prestige Falcon City', Event_City: 'Bengaluru', Event_State: 'Done', ...ev }], info: { count: 1, more_records: false } });
      if (/from Leads where \(Mobile in/.test(c.query)) { coqls++; return 'coql.none'; }
      return 'coql.none';
    }
    if (c.method === 'PUT' && c.path === `/Lead_Events/${PRESTIGE}`) {
      const f = c.body.data[0];
      if (f.Load_State === 'Loaded') { if (ev.Load_State !== 'Ready') return 'update.conflict'; Object.assign(ev, { Load_State: 'Loaded', Loaded_By: { id: f.Loaded_By.id } }); }
      else counts.push({ ...f, guard: c.headers['If-Unmodified-Since'] });
      return 'update.sheet-claim';
    }
    if (c.method === 'POST' && c.path === '/Leads') {
      live++; peak = Math.max(peak, live);
      if (insertMs) await new Promise((r) => setTimeout(r, insertMs));
      live--;
      return json(201, { data: c.body.data.map((x) => {
        if (leads.has(x.Mobile)) return { code: 'DUPLICATE_DATA', details: { api_name: 'Mobile' }, message: 'duplicate data', status: 'error' };
        const id = `${P}75${String(leads.size).padStart(7, '0')}`; leads.set(x.Mobile, id); owners.set(x.Mobile, x.Owner.id);
        return { code: 'SUCCESS', details: { id, Modified_Time: '2026-09-28T11:30:00+05:30' }, message: 'record added', status: 'success' };
      }) });
    }
    throw new Error(`unrouted ${c.method} ${c.path}`);
  };
  return { route, ev, leads, owners, counts, get peak() { return peak; }, get coqls() { return coqls; } };
}
async function asyncRig(z, extra = {}) {
  // the write rig's route is synchronous: resolve the stand-in's answer inside a fetch wrapper
  const rig = await makeWriteRig(load, () => 'coql.none');
  const { createZohoClient } = load('lib/zoho/client.js');
  const { createOpsLog, createMemorySink } = load('lib/zoho/log.js');
  const { recorded } = require('../cases/fixture-rig.cjs');
  const toResponse = (r) => new Response(r.status === 204 ? null : JSON.stringify(r.body), { status: r.status, headers: r.headers || {} });
  rig.crm = createZohoClient({ recordIdPrefix: P, gate: { async acquire() { return { waitedMs: 0, release() {} }; } }, log: createOpsLog(createMemorySink()), maxAttempts: 1, clock: rig.clock,
    fetch: async (url, init) => {
      const body = init.body ? JSON.parse(init.body) : null;
      const call = { method: init.method, path: new URL(url).pathname.replace(/^\/crm\/v\d+/, ''), query: body && body.select_query, body, headers: init.headers };
      rig.calls.push(call);
      const r = await z.route(call);
      return toResponse(typeof r === 'string' ? recorded('events', r) : r);
    } });
  return Object.assign(rig, extra);
}

test('M18-S09-NOTE-3: 2,000 rows load in one call — book check and inserts 4 at a time, counts written once', async () => {
  const z = bigZoho(2);
  const progress = createMemoryState();
  const rig = await asyncRig(z, { progress });
  const r = await createSheetLoader(rig).load(await rig.cred(ROHIT), PRESTIGE, { kind: 'round-robin' }, intake(bigRows()));
  assert.equal(r.ok, true, JSON.stringify(r).slice(0, 200));
  assert.deepEqual([r.value.inFile, r.value.loaded, r.value.duplicates, r.value.refused, r.value.continuing], [BIG, BIG, 0, 0, null]);
  assert.equal(z.coqls, 80, '25 numbers × 4 spellings per COQL');
  assert.ok(z.peak > 1 && z.peak <= 4, `insert peak ${z.peak}`);
  assert.equal(z.leads.size, BIG);
  assert.deepEqual(z.counts.map((c) => [c.Rows_Loaded, c.Rows_In_File, c.guard]), [[BIG, BIG, '2026-09-28T11:29:00+05:30']]);
  assert.deepEqual(r.value.split.map((x) => ({ ...x })), [{ ownerId: ROHIT, count: 1000 }, { ownerId: KAVYA, count: 1000 }]);
  assert.equal(await progress.get(`event-sheet-load|${PRESTIGE}`), null, 'nothing kept once done');
});

test('M18-S09-NOTE-3: past the deadline the load stops between batches and the same sheet posted again continues — each row once', async () => {
  const z = bigZoho(15);
  const progress = createMemoryState();
  const rig = await asyncRig(z, { progress, stopMarginMs: 40 });
  const loader = createSheetLoader(rig);
  const cred = await rig.cred(ROHIT);
  const rows = bigRows();
  let r, calls = 0;
  const seen = [];
  do {
    const ac = new AbortController();
    r = await runWithDeadline({ signal: ac.signal, at: Date.now() + 110 }, () => loader.load(cred, PRESTIGE, { kind: 'round-robin' }, intake(rows)));
    assert.equal(r.ok, true, JSON.stringify(r).slice(0, 200));
    seen.push(r.value.continuing && r.value.continuing.done);
    calls++;
  } while (r.value.continuing && calls < 40);
  assert.ok(calls > 2, `took ${calls} calls`);
  assert.equal(r.value.continuing, null);
  assert.deepEqual([r.value.loaded, r.value.duplicates, r.value.refused], [BIG, 0, 0]);
  assert.equal(z.leads.size, BIG, 'no number inserted twice (a repeat would have been DUPLICATE_DATA)');
  assert.ok(seen.slice(0, -1).every((d, i, a) => d % 100 === 0 && (i === 0 || d > a[i - 1])), `progress ${seen}`);
  // round-robin holds across calls: row i goes to staff[i % 2]
  rows.forEach((x, i) => assert.equal(z.owners.get(`+91${x.mobile}`), i % 2 === 0 ? ROHIT : KAVYA));
  assert.deepEqual(z.counts.map((c) => c.Rows_Loaded), [BIG], 'the counts are written once, at the end');
  const logs = JSON.stringify(rig.sink.records());
  assert.ok(!/94100|Synthetic Person/.test(logs));
  assert.equal(await progress.get(`event-sheet-load|${PRESTIGE}`), null);
});

test('M18-S09-NOTE-3: only the loader, posting the same sheet, continues; anyone else (or a changed sheet) meets "A sheet loads once"', async () => {
  const z = bigZoho(15);
  const progress = createMemoryState();
  const rig = await asyncRig(z, { progress, stopMarginMs: 40 });
  const loader = createSheetLoader(rig);
  const rows = bigRows();
  const r1 = await runWithDeadline({ signal: new AbortController().signal, at: Date.now() + 110 }, async () => loader.load(await rig.cred(ROHIT), PRESTIGE, { kind: 'round-robin' }, intake(rows)));
  assert.ok(r1.ok && r1.value.continuing, 'stopped part-way');
  const other = await loader.load(await rig.cred(KAVYA), PRESTIGE, { kind: 'round-robin' }, intake(rows));
  assert.equal(other.reasonCode, 'already-loaded');
  const changed = await loader.load(await rig.cred(ROHIT), PRESTIGE, { kind: 'round-robin' }, intake(rows.slice(1)));
  assert.equal(changed.reasonCode, 'already-loaded');
  const done = await loader.load(await rig.cred(ROHIT), PRESTIGE, { kind: 'round-robin' }, intake(rows));
  assert.equal(done.ok && done.value.continuing, null);
  assert.equal(z.leads.size, BIG);
});
