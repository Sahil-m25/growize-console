/* M14-S02-T01 — add, correct and remove an event, on recorded Zoho answers.
 * Run from console/: node --test src/server/events/writes.test.cjs */
'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { compile } = require('../cases/fixture-rig.cjs');
const { makeWriteRig, P } = require('./write-rig.cjs');

const load = compile(['server/events/writes.ts', 'server/data/events.ts', 'server/identity/plane-c.ts', 'server/events/caps.ts']);
const { createEventWrites, eventGaps, isoDay } = load('server/events/writes.js');
const { eventCaps } = load('server/events/caps.js');
const MGR = `${P}740995002`, IR = `${P}740995001`, NIKHIL = `${P}740995004`, KAVYA = `${P}740995003`;
const KORA = `${P}740997501`, EMBASSY = `${P}740997502`;

const draft = (o = {}) => ({ name: 'Adarsh Palm Retreat', startsOn: '2026-10-03', endsOn: '2026-10-04', city: 'Bengaluru', kind: 'Society',
  channel: 'MyGate', state: 'planned', cost: 70000, staffIds: [IR], ...o });
const kora = (o = {}) => draft({ name: 'Koramangala Club', startsOn: '2026-08-15', endsOn: '2026-08-15', kind: 'Club', channel: 'Direct', state: 'done', cost: 96000, namesTaken: 5, staffIds: [IR, NIKHIL], ...o });

function route(c) {
  if (c.method === 'POST' && c.path === '/coql') {
    const q = c.query;
    if (/COUNT\(id\)/.test(q)) return 'agg.edit-tagged';
    if (/from Lead_Events_X_Users/.test(q)) return 'coql.edit-staff';
    if (new RegExp(`from Lead_Events where \\(id = '${KORA}'\\)`).test(q)) return 'coql.edit-event';
    if (new RegExp(`from Lead_Events where \\(id = '${EMBASSY}'\\)`).test(q)) return 'coql.edit-planned';
    if (/from Leads where \(Lead_Event = /.test(q)) return 'coql.edit-tagged-leads';
    return 'coql.none';
  }
  if (c.method === 'POST' && c.path === '/Lead_Events') return 'insert.event';
  if (c.method === 'PUT' && c.path.startsWith('/Lead_Events/')) return 'update.event';
  if (c.method === 'PUT' && c.path.startsWith('/Leads/')) return 'update.lead';
  if (c.method === 'DELETE' && c.path.startsWith('/Lead_Events/')) return 'delete.event';
  throw new Error(`unrouted ${c.method} ${c.path}`);
}
const writes = (c) => c.filter((x) => x.method !== 'POST' || x.path !== '/coql');

test('the policy (front end\'s own rule): an IR may load but not edit; the IR Manager and the super user may edit (D68); a viewer neither', () => {
  const c = (seat) => ({ ...eventCaps(seat, 'x', {}) });
  assert.deepEqual(c('ir'), { edit: false, load: true });
  assert.deepEqual(c('conv'), { edit: true, load: true });
  assert.equal(c('ops').edit, true);
  assert.deepEqual(c('exec'), { edit: false, load: false });
});

test('an IR is refused with a reason and nothing is written', async () => {
  const rig = await makeWriteRig(load, route, { mayEdit: false });
  const w = createEventWrites(rig);
  const r = await w.create(await rig.cred(IR), draft());
  assert.equal(r.reasonCode, 'capability-missing');
  assert.match(r.reason, /cannot add or change events/);
  assert.equal((await w.update(await rig.cred(IR), KORA, kora())).reasonCode, 'capability-missing');
  assert.equal((await w.remove(await rig.cred(IR), KORA, true)).reasonCode, 'capability-missing');
  assert.equal(rig.calls.length, 0);
  assert.ok(rig.sink.records().some((x) => x.kind === 'refusal' && x.action === 'event-add' && x.reason === 'capability-missing'));
});

test('the IR Manager adds an event: one insert with the real field names and staff on Event_Staff; the answer names it, the dates, city and who works it', async () => {
  const rig = await makeWriteRig(load, route);
  const r = await createEventWrites(rig).create(await rig.cred(MGR), draft());
  assert.equal(r.ok, true);
  assert.deepEqual({ ...r.value, staffIds: [...r.value.staffIds] }, { eventId: `${P}740997701`, name: 'Adarsh Palm Retreat', startsOn: '2026-10-03', endsOn: '2026-10-04', city: 'Bengaluru', staffIds: [IR], state: 'planned' });
  const [ins] = writes(rig.calls);
  assert.equal(ins.path, '/Lead_Events');
  assert.deepEqual(ins.body.data[0], { Name: 'Adarsh Palm Retreat', Starts_On: '2026-10-03', Ends_On: '2026-10-04', Event_City: 'Bengaluru', Event_Type: 'Society',
    Event_Channel: 'MyGate', Event_State: 'Planned', Event_Cost: 70000, Event_Staff: [{ userlookup221_3: { id: IR } }] });
  // Plane B holds ids and status only: no event name or city in any log line.
  assert.ok(!JSON.stringify(rig.sink.records()).includes('Adarsh'));
});

test('gaps: end before start, negative cost, bad kind, duplicate staff; nothing is written', async () => {
  const rig = await makeWriteRig(load, route);
  const r = await createEventWrites(rig).create(await rig.cred(MGR), draft({ startsOn: '2026-10-10', endsOn: '2026-10-08', cost: -1, kind: 'Fair', staffIds: [IR, IR] }));
  assert.equal(r.reasonCode, 'gaps');
  assert.deepEqual([...r.gaps], ['end date on or after start', 'event kind', 'non-negative cost', 'eligible staff']);
  assert.equal(rig.calls.length, 0);
  assert.deepEqual(eventGaps(draft({ startsOn: '2026-02-30', name: 'x', city: ' ' }), null, null), ['event name', 'valid start date', 'city']);
  assert.deepEqual(eventGaps(draft({ staffIds: [KAVYA] }), null, [IR]), ['eligible staff']);
  assert.deepEqual(eventGaps(draft({ staffIds: [KAVYA] }), { state: 'planned', staff: [{ userId: KAVYA, linkId: 'x' }] }, [IR]), []);
  assert.equal(isoDay('2026-10-03'), '2026-10-03');
});

test('a run event cannot go back to planned (refused before any write)', async () => {
  const rig = await makeWriteRig(load, route);
  const r = await createEventWrites(rig).update(await rig.cred(MGR), KORA, kora({ state: 'planned', cost: 99000 }));
  assert.equal(r.reasonCode, 'gaps');
  assert.deepEqual([...r.gaps], ['valid run status']);
  assert.equal(writes(rig.calls).length, 0);
});

test('a correction writes with If-Unmodified-Since and answers exactly what moved: cost only, 3 leads stay tagged, dates untouched', async () => {
  const rig = await makeWriteRig(load, route);
  const r = await createEventWrites(rig).update(await rig.cred(MGR), KORA, kora({ cost: 99000 }));
  assert.equal(r.ok, true);
  assert.deepEqual(r.value.moved.map((m) => ({ ...m })), [{ field: 'cost', from: 96000, to: 99000 }]);
  assert.equal(r.value.taggedStay, 3);
  const [up] = writes(rig.calls);
  assert.equal(up.method, 'PUT');
  assert.equal(up.path, `/Lead_Events/${KORA}`);
  assert.equal(up.headers['If-Unmodified-Since'], '2026-09-20T10:00:00+05:30');
  assert.equal(up.body.data[0].Event_State, 'Done');
  assert.equal(up.body.data[0].Event_Staff, undefined);
});

test('staff changes add the new user and delete the dropped link row; planned → done says it has run', async () => {
  const rig = await makeWriteRig(load, route);
  const r = await createEventWrites(rig).update(await rig.cred(MGR), KORA, kora({ staffIds: [IR, KAVYA] }));
  assert.deepEqual(r.value.moved.map((m) => m.field), ['staff']);
  assert.deepEqual(writes(rig.calls)[0].body.data[0].Event_Staff, [{ userlookup221_3: { id: KAVYA } }, { id: `${P}740997512`, _delete: null }]);
  const rig2 = await makeWriteRig(load, route);
  const r2 = await createEventWrites(rig2).update(await rig2.cred(MGR), EMBASSY, draft({ name: 'Embassy Springs', startsOn: '2026-10-10', endsOn: '2026-10-11', state: 'done', staffIds: [IR, NIKHIL] }));
  assert.ok(r2.value.moved.some((m) => m.field === 'state' && m.to === 'done'));
});

test('nothing moved → no write; a stale page or a 412 is refused as a conflict, never overwritten', async () => {
  const rig = await makeWriteRig(load, route);
  const w = createEventWrites(rig);
  const same = await w.update(await rig.cred(MGR), KORA, kora());
  assert.deepEqual([...same.value.moved], []);
  assert.equal(writes(rig.calls).length, 0);
  assert.equal((await w.update(await rig.cred(MGR), KORA, kora({ cost: 1 }), '2026-09-01T10:00:00+05:30')).reasonCode, 'conflict');
  const rig412 = await makeWriteRig(load, (c) => c.method === 'PUT' ? 'update.conflict' : route(c));
  assert.equal((await createEventWrites(rig412).update(await rig412.cred(MGR), KORA, kora({ cost: 1 }))).reasonCode, 'conflict');
  assert.ok(rig412.sink.records().some((x) => x.kind === 'refusal' && x.reason === 'already-modified'));
});

test('remove without confirmation writes nothing and answers the tagged count for the in-page confirmation', async () => {
  const rig = await makeWriteRig(load, route);
  const r = await createEventWrites(rig).remove(await rig.cred(MGR), KORA, false);
  assert.equal(r.reasonCode, 'confirm-needed');
  assert.equal(r.taggedLeads, 3);
  assert.equal(r.eventName, 'Koramangala Club');
  assert.equal(writes(rig.calls).length, 0);
});

test('remove, confirmed: every tagged lead loses only Lead_Event (guarded), then the event is deleted', async () => {
  const rig = await makeWriteRig(load, route);
  const r = await createEventWrites(rig).remove(await rig.cred(MGR), KORA, true);
  assert.equal(r.ok, true);
  assert.deepEqual({ ...r.value }, { eventId: KORA, name: 'Koramangala Club', leadsUntagged: 3 });
  const w = writes(rig.calls);
  assert.deepEqual(w.map((c) => `${c.method} ${c.path}`), [`PUT /Leads/${P}740996401`, `PUT /Leads/${P}740996402`, `PUT /Leads/${P}740996403`, `DELETE /Lead_Events/${KORA}`]);
  for (const c of w.slice(0, 3)) {
    assert.deepEqual(c.body.data[0], { Lead_Event: null });
    assert.ok(c.headers['If-Unmodified-Since']);
  }
});

test('remove stops before deleting the event when a lead could not be cleared (a retry finishes it)', async () => {
  let n = 0;
  const rig = await makeWriteRig(load, (c) => c.method === 'PUT' && c.path.startsWith('/Leads/') && n++ === 1 ? 'update.conflict' : route(c));
  const r = await createEventWrites(rig).remove(await rig.cred(MGR), KORA, true);
  assert.equal(r.kind, 'incomplete');
  assert.deepEqual([r.cleared, r.left], [2, 1]);
  assert.ok(!rig.calls.some((c) => c.method === 'DELETE'));
});

test('a malformed id costs no call; an event that is not visible is not-found', async () => {
  const rig = await makeWriteRig(load, route);
  const w = createEventWrites(rig);
  assert.equal((await w.update(await rig.cred(MGR), 'x', kora())).reasonCode, 'invalid-request');
  assert.equal(rig.calls.length, 0);
  assert.equal((await w.remove(await rig.cred(MGR), `${P}740997999`, true)).reasonCode, 'not-found');
});
