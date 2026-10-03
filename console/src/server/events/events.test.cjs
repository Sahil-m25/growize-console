/* M14-S01-T02 — events list, one event and per-event stats on recorded Zoho answers.
 * Run from console/: node --test src/server/events/events.test.cjs */
'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { compile, makeRig, P } = require('../cases/fixture-rig.cjs');

const load = compile(['server/events/events.ts', 'server/data/events.ts', 'server/identity/plane-c.ts']);
const { createEventsService, stageBuckets, statsOf } = load('server/events/events.js');
const IR = `${P}740995001`, MANAGER = `${P}740995002`, FIN = `${P}740993001`;
const PRESTIGE = `${P}740997301`;

function route(q) {
  if (/COUNT\(id\)/.test(q)) return ['events', 'agg.stages'];
  if (/from Lead_Events_X_Users/.test(q)) return ['events', 'coql.staff'];
  if (/from Lead_Events where \(id = /.test(q)) return ['events', 'coql.event-one'];
  if (/from Lead_Events/.test(q)) return ['events', 'coql.events'];
  if (/from Leads where \(Lead_Event = /.test(q)) return ['events', 'coql.event-leads-mine'];
  throw new Error('unrouted query: ' + q);
}

test('Upcoming: planned events soonest first, with dates, city and team; Completed: the run ones', async () => {
  const rig = await makeRig(load, route);
  const r = await createEventsService(rig).list({ credential: await rig.cred(IR), seat: 'ir' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.upcoming.map((e) => e.name), ['Sobha Dream Acres', 'Bangalore Club', 'Embassy Springs']);
  assert.deepEqual(r.upcoming.map((e) => e.staff.map((s) => s.name).join(', ')), ['Kavya, Nikhil', 'Rohit', 'Nikhil']);
  assert.deepEqual([r.upcoming[0].startsOn, r.upcoming[0].endsOn, r.upcoming[0].city], ['2026-09-05', '2026-09-06', 'Bengaluru']);
  assert.deepEqual(r.completed.map((e) => e.name), ['Koramangala Club', 'Prestige Falcon City']);
  assert.ok(![...r.upcoming, ...r.completed].some((e) => e.name === 'Cancelled Fair'));
});

test('Completed stats come from one group-by: captured, tagged, qualified, reserved; cost per qualified only when all captured are tagged', async () => {
  const rig = await makeRig(load, route);
  const r = await createEventsService(rig).list({ credential: await rig.cred(IR), seat: 'ir' });
  const [kora, prestige] = r.completed;
  assert.deepEqual({ ...prestige.stats }, { captured: 3, tagged: 3, qualified: 2, reserved: 1, paid: 0, investor: 0, costPerQualified: 30000, costHiddenWhy: null });
  assert.deepEqual({ ...kora.stats }, { captured: 5, tagged: 3, qualified: 1, reserved: 0, paid: 0, investor: 0, costPerQualified: null, costHiddenWhy: 'untagged' });
  const aggs = rig.queries.filter((q) => /COUNT\(id\)/.test(q));
  assert.equal(aggs.length, 1);
  assert.match(aggs[0], /from Leads where Lead_Event is not null group by Lead_Event, Lead_Status/);
});

test('stats are cached under the viewer\'s leads scope; another IR has their own key', async () => {
  const rig = await makeRig(load, route);
  const svc = createEventsService(rig);
  await svc.list({ credential: await rig.cred(IR), seat: 'ir' });
  await svc.list({ credential: await rig.cred(IR), seat: 'ir' });
  assert.equal(rig.queries.filter((q) => /COUNT/.test(q)).length, 1);
  await svc.list({ credential: await rig.cred(MANAGER), seat: 'conv' });
  assert.equal(rig.queries.filter((q) => /COUNT/.test(q)).length, 2);
});

test('one event names only the viewer\'s leads and counts the rest as somebody else\'s; no investor record is read (D69)', async () => {
  const rig = await makeRig(load, route);
  const r = await createEventsService(rig).one({ credential: await rig.cred(IR), seat: 'ir' }, PRESTIGE);
  assert.equal(r.ok, true);
  assert.equal(r.event.name, 'Prestige Falcon City');
  assert.deepEqual(r.leads.map((l) => l.name), ['Meera Krishnan']);
  assert.equal(r.othersCount, 2);
  const leadsQ = rig.queries.find((q) => /from Leads where \(Lead_Event = /.test(q));
  assert.match(leadsQ, new RegExp(`Owner = '${IR}' or Secondary_Owner = '${IR}'`));
  assert.ok(!rig.queries.some((q) => /from Contacts|LLP_UnitAllocation|Receipts/.test(q)));
});

test('M14-S02: the list and one event carry Lead_Events.Modified_Time (selected explicitly) for the correction to send back', async () => {
  const rig = await makeRig(load, route);
  const svc = createEventsService(rig);
  const l = await svc.list({ credential: await rig.cred(IR), seat: 'ir' });
  assert.equal(l.ok, true);
  assert.ok([...l.upcoming, ...l.completed].every((e) => typeof e.modifiedTime === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(e.modifiedTime)));
  const o = await svc.one({ credential: await rig.cred(IR), seat: 'ir' }, PRESTIGE);
  assert.equal(o.event.modifiedTime, '2026-09-20T11:00:00+05:30');
  for (const q of rig.queries.filter((x) => /from Lead_Events where/.test(x))) assert.match(q, /, Modified_Time from Lead_Events/);
});

test('M14-S01-W2: Fully paid and Investor (allocated or on) are their own counts, read off the same one group-by', () => {
  const rows = [['Reserved - 10% in', 4], ['Fully paid', 3], ['Allocated', 2], ['Onboarded', 1]].map(([st, n]) => ({ Lead_Event: PRESTIGE, Lead_Status: st, 'COUNT(id)': n }));
  const st = statsOf(PRESTIGE, 10, 100000, stageBuckets(rows));
  assert.deepEqual([st.tagged, st.reserved, st.paid, st.investor], [10, 10, 6, 3]);
});

test('M14-S01-W2: the leads the viewer may open carry their owner and units of interest; no phone, e-mail or other identity field is read or served', async () => {
  const rig = await makeRig(load, route);
  const r = await createEventsService(rig).one({ credential: await rig.cred(IR), seat: 'ir' }, PRESTIGE);
  assert.deepEqual({ ...r.leads[0] }, { id: `${P}740996101`, name: 'Meera Krishnan', status: 'Qualified', ownerId: IR, ownerName: 'Rohit', units: 2 });
  const q = rig.queries.find((x) => /from Leads where \(Lead_Event = /.test(x));
  assert.match(q, /select id, First_Name, Last_Name, Lead_Status, Owner, Units_Interested from Leads/);
  assert.ok(!/Mobile|Phone|Email|PAN|Aadhaar/i.test(q));
});

test('an IR Manager with a subtree reader names the team\'s leads (the shared owner predicate)', async () => {
  const rig = await makeRig(load, route);
  const svc = createEventsService({ ...rig, subtreeOf: async () => [IR] });
  await svc.one({ credential: await rig.cred(MANAGER), seat: 'conv' }, PRESTIGE);
  const leadsQ = rig.queries.find((q) => /from Leads where \(Lead_Event = /.test(q));
  assert.match(leadsQ, new RegExp(`Owner in \\('${MANAGER}', '${IR}'\\)`));
});

test('a seat without the leads book is refused; a malformed id costs no call', async () => {
  const rig = await makeRig(load, route);
  const svc = createEventsService(rig);
  assert.equal((await svc.list({ credential: await rig.cred(FIN), seat: 'fin' })).reason, 'no-book');
  assert.equal((await svc.one({ credential: await rig.cred(IR), seat: 'ir' }, 'x')).reason, 'invalid-request');
  assert.equal(rig.queries.length, 0);
});

test('when the count fails the list still answers, stats are zero and the page is told; others are unknown on the event page', async () => {
  const rig = await makeRig(load, (q) => /COUNT/.test(q) ? { status: 500, body: { code: 'INTERNAL_ERROR' } } : route(q));
  const svc = createEventsService(rig);
  const r = await svc.list({ credential: await rig.cred(IR), seat: 'ir' });
  assert.equal(r.stats.state, 'error');
  const one = await svc.one({ credential: await rig.cred(IR), seat: 'ir' }, PRESTIGE);
  assert.equal(one.othersCount, null);
});

test('stage buckets and stats are pure', () => {
  const b = stageBuckets([{ Lead_Event: PRESTIGE, Lead_Status: 'Allocated', 'COUNT(id)': 2 }, { Lead_Event: null, Lead_Status: 'Qualified', 'COUNT(id)': 9 }]);
  assert.deepEqual(b, [{ key: `${PRESTIGE}|i`, count: 2 }, { key: `${PRESTIGE}|p`, count: 2 }, { key: `${PRESTIGE}|q`, count: 2 }, { key: `${PRESTIGE}|r`, count: 2 }, { key: `${PRESTIGE}|t`, count: 2 }]);
  assert.equal(statsOf(PRESTIGE, null, 100, b).costHiddenWhy, 'no-capture');
  assert.equal(statsOf(PRESTIGE, 2, null, b).costHiddenWhy, 'no-cost');
});
