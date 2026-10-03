/* M14-S03-W2 — the sheet's state on Lead_Events, on recorded Zoho answers.
 * Run from console/: node --test src/server/events/sheet-state.test.cjs */
'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { compile } = require('../cases/fixture-rig.cjs');
const { makeWriteRig, P } = require('./write-rig.cjs');

const load = compile(['server/events/sheet-state.ts', 'server/data/events.ts', 'server/identity/plane-c.ts']);
const { createSheetState } = load('server/events/sheet-state.js');
const ROHIT = `${P}740995001`, KAVYA = `${P}740995003`;
const PRESTIGE = `${P}740997601`;

const route = (sheet) => (c) => {
  if (c.method === 'POST' && c.path === '/coql') {
    if (/from Lead_Events_X_Users/.test(c.query)) return 'coql.sheet-staff';
    if (/from Lead_Events where/.test(c.query)) return sheet;
    throw new Error('unrouted query: ' + c.query);
  }
  throw new Error(`unrouted ${c.method} ${c.path}`);
};
const read = async (sheet, seat = 'ir', access = {}, id = PRESTIGE) => {
  const rig = await makeWriteRig(load, route(sheet), access);
  const r = await createSheetState(rig).forEvent({ credential: await rig.cred(ROHIT), seat }, id);
  return { rig, r };
};

test('a loaded sheet: the counts the loader wrote back, who loaded it and when (IST), and the load log line', async () => {
  const { r, rig } = await read('coql.sheet-state-loaded');
  assert.equal(r.ok, true);
  const s = r.sheet;
  assert.deepEqual([s.state, s.inFile, s.loaded, s.duplicates, s.refused], ['loaded', 38, 31, 4, 3]);
  assert.deepEqual({ ...s.loadedBy }, { id: ROHIT, name: 'Rohit Deshpande' });
  assert.equal(s.loadedAt, '2026-09-28T11:30');
  assert.deepEqual(s.log.map((l) => [l.at, l.what, l.note]), [['2026-09-28T11:30', 'Loaded the event sheet', 'Prestige Falcon City — 31 leads, 4 refused as duplicates']]);
  assert.deepEqual(s.staff.map((x) => x.name), ['Rohit', 'Kavya']);   // named order = the round-robin order
  assert.deepEqual(s.staff.map((x) => x.id), [ROHIT, KAVYA]);
  assert.equal(s.mayLoad, true);
  // two COQL reads on the person's own token, no write, no lead read
  assert.deepEqual(rig.calls.map((c) => `${c.method} ${c.path}`), ['POST /coql', 'POST /coql']);
  assert.ok(!rig.calls.some((c) => /from Leads|Contacts/.test(c.query || '')));
});

test('a ready sheet: Rows_In_File only when set; nothing is invented for the rows that will load, who filled it or the rule', async () => {
  const { r } = await read('coql.sheet-state-ready');
  const s = r.sheet;
  assert.deepEqual([s.state, s.inFile, s.willLoad, s.duplicates, s.refused, s.loaded, s.filledBy, s.filledAt, s.rule, s.loadedBy, s.loadedAt], ['ready', 38, null, null, null, null, null, null, null, null, null]);
  assert.deepEqual(s.log, []);
});

test('an event with no Load_State has no sheet; a seat without the load right reads it but may not load', async () => {
  assert.equal((await read('coql.sheet-state-none')).r.sheet.state, 'none');
  const { r } = await read('coql.sheet-state-ready', 'ir', { mayLoad: false });
  assert.equal(r.sheet.mayLoad, false);
  assert.equal(r.sheet.state, 'ready');
});

test('refused: a seat with no leads book (nothing read, one refusal line), a malformed id (no call), an event that is gone', async () => {
  const fin = await read('coql.sheet-state-ready', 'fin');
  assert.deepEqual(fin.r, { ok: false, kind: 'refused', reason: 'no-book' });
  assert.equal(fin.rig.calls.length, 0);
  const bad = await read('coql.sheet-state-ready', 'ir', {}, 'x');
  assert.equal(bad.r.reason, 'invalid-request');
  assert.equal(bad.rig.calls.length, 0);
  const gone = await read('coql.none');
  assert.equal(gone.r.reason, 'not-found');
});

test('Zoho failing is a source error and carries no body', async () => {
  const rig = await makeWriteRig(load, () => ({ status: 500, body: { code: 'INTERNAL_ERROR', message: 'secret' } }));
  const r = await createSheetState(rig).forEvent({ credential: await rig.cred(ROHIT), seat: 'ir' }, PRESTIGE);
  assert.equal(r.ok, false);
  assert.equal(r.kind, 'source-error');
  assert.ok(!JSON.stringify(r).includes('secret'));
});
