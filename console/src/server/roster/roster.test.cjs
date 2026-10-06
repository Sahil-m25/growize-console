/* D49 / D44 / M08-S05-NOTE-4 / M14-S02-NOTE-3 — the roster: availability written to Plane C and read back through the log
 * source interface, cover admitted or refused by it, event staff refused when out or without a book, and no identity in
 * any answer (rule 7). Run from console/: node --test src/server/roster/roster.test.cjs */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const compile = require('../logs/compile.cjs');

const { load } = compile(['server/roster/roster.ts', 'server/roster/availability.ts', 'server/roster/staff.ts', 'server/roster/carries.ts',
  'server/leads/cover.ts', 'server/events/writes.ts', 'server/logs/reader.ts', 'server/logs/factory.ts'], 'roster');
const { createRoster, foldAvailability } = load('server/roster/roster.js');
const { createAvailability } = load('server/roster/availability.js');
const { checkStaff } = load('server/roster/staff.js');
const { activeFor, activeClause, createCover, rosterNow } = load('server/leads/cover.js');
const { createEventWrites, staffMessage } = load('server/events/writes.js');
const { logSourceOf } = load('server/logs/reader.js');
const { createLogSinks } = load('server/logs/factory.js');
const { createPlaneCLog } = load('server/identity/plane-c.js');

const P = '9007199254';
const OWNER = `${P}740995001`, SEC = `${P}740995005`, MGR = `${P}740995002`, NEW = `${P}740995006`, OTHER = `${P}740995009`;
const LEAD = `${P}740996303`;
const T0 = Date.parse('2026-10-05T04:30:00Z'); // 10:00 IST, 5 Oct 2026
const DAY = 86_400_000;

function rig(env = {}, start = T0) {
  let now = start;
  const clock = () => now;
  const sinks = createLogSinks(env, { clock });
  const planeC = createPlaneCLog(sinks.identity);
  const roster = createRoster(logSourceOf(sinks), clock);
  const availability = createAvailability({ planeC, roster, clock });
  return { sinks, roster, availability, planeC, set: (ms) => { now = ms; roster.forget(); }, clock, lines: () => sinks.identity.events() };
}
const me = (userId, mayChangeOthers = false) => ({ userId, seat: 'ir', mayChangeOthers });

test('availability written, then read back: who is out on a day, until when, who is available', async () => {
  const r = rig();
  assert.equal(r.availability.set(me(OWNER), { from: '2026-10-06', to: '2026-10-10' }).ok, true);
  const v = await r.roster.view();
  assert.deepEqual(v.outOn('2026-10-06'), [{ id: OWNER, backOn: '2026-10-10' }]);
  assert.deepEqual(v.outOn('2026-10-09'), [{ id: OWNER, backOn: '2026-10-10' }]);
  assert.deepEqual(v.outOn('2026-10-05'), [], 'planned, not yet out');
  assert.deepEqual(v.outOn('2026-10-10'), [], 'the first day back they are in');
  assert.equal(v.backOn(OWNER, '2026-10-07'), '2026-10-10');
  assert.deepEqual(v.availableOn('2026-10-07', [OWNER, SEC]), [SEC], 'someone never on the roster is in');
  assert.equal(v.outDuring(OWNER, '2026-10-09', '2026-10-12'), '2026-10-10', 'an event that touches the window');
  assert.equal(v.outDuring(OWNER, '2026-10-10', '2026-10-12'), null);
  assert.equal(v.outDuring(OWNER, '2026-10-01', '2026-10-05'), null);
});

test('marking back in clears it; a newer window replaces the old; a spent window drops off; a manager records for a team member', async () => {
  const r = rig();
  r.availability.set(me(OWNER), { from: '2026-10-05', to: '2026-10-12' });
  assert.equal((await r.roster.view()).backOn(OWNER, '2026-10-05'), '2026-10-12');
  r.set(T0 + 1000);
  assert.equal(r.availability.clear(me(OWNER), {}).ok, true);
  assert.deepEqual((await r.roster.view()).outOn('2026-10-06'), [], 'back early');
  r.set(T0 + 2000);
  r.availability.set(me(OWNER), { from: '2026-10-06', to: '2026-10-08' });
  r.set(T0 + 3000);
  r.availability.set(me(OWNER), { from: '2026-10-06', to: '2026-10-09' });
  assert.equal((await r.roster.view()).backOn(OWNER, '2026-10-07'), '2026-10-09', 'the latest line wins');
  r.set(T0 + 3000);
  assert.equal(r.availability.set(me(MGR, true), { person: SEC, from: '2026-10-06', to: '2026-10-07' }).ok, true);
  const v = await r.roster.view();
  assert.equal(v.backOn(SEC, '2026-10-06'), '2026-10-07');
  const filed = r.lines().filter((e) => e.action === 'availability').pop();
  assert.equal(filed.who, MGR); assert.equal(filed.whom, SEC);
  r.set(T0 + 12 * DAY);
  assert.equal((await r.roster.view()).windows.size, 0, 'both windows are spent');
});

test('who may write, and what dates: refused with nothing filed', async () => {
  const r = rig();
  const before = () => r.lines().filter((e) => e.action === 'availability').length;
  assert.equal(r.availability.set(me(OWNER), { person: SEC, from: '2026-10-06', to: '2026-10-07' }).reasonCode, 'not-yours-to-change');
  for (const bad of [{ from: '2026-10-04', to: '2026-10-07' }, { from: '2026-10-06', to: '2026-10-06' }, { from: '2026-10-06', to: '2026-12-31' },
    { from: '2026-12-31', to: '2027-01-02' }, { from: '2026-02-30', to: '2026-10-07' }, { from: 'ABCDE1234F', to: '2026-10-07' }, {}]) {
    assert.equal(r.availability.set(me(OWNER), bad).reasonCode, 'bad-dates', JSON.stringify(bad));
  }
  assert.equal(r.availability.set(me('not-an-id'), { from: '2026-10-06', to: '2026-10-07' }).reasonCode, 'invalid-request');
  assert.equal(before(), 0);
  assert.ok(r.lines().some((e) => e.action === 'refused-action' && e.reason === 'availability'), 'refusals are filed too');
  assert.deepEqual((await r.roster.view()).outOn('2026-10-06'), []);
});

test('rule 7: no identity or reason reaches the log line or the roster answer', async () => {
  const r = rig();
  r.availability.set(me(OWNER), { from: '2026-10-06', to: '2026-10-08', why: 'Sick leave', reason: 'Medical', note: 'ABCDE1234F', phone: '9876543210' });
  const line = r.lines().find((e) => e.action === 'availability');
  assert.deepEqual(Object.keys(line).sort(), ['action', 'at', 'from', 'outcome', 'reason', 'seat', 'to', 'who']);
  assert.equal(line.reason, 'out', 'a code, never the private reason');
  // a caller who hands the writer an identity-shaped day gets a null day, which the reader drops
  r.planeC.record({ at: T0 + 5, who: SEC, action: 'availability', outcome: 'ok', reason: 'out', seat: 'ir', from: 'ABCDE1234F', to: '9876543210' });
  const stored = r.lines().filter((e) => e.action === 'availability');
  assert.ok(!JSON.stringify(stored).includes('ABCDE1234F') && !JSON.stringify(stored).includes('9876543210'));
  const v = await r.roster.view();
  assert.equal(v.windows.has(SEC), false);
  const answer = JSON.stringify({ out: v.outOn('2026-10-07'), now: await r.roster.current() });
  assert.deepEqual([...answer.matchAll(/"([^"]+)"/g)].map((m) => m[1]).filter((s) => !/^(out|id|backOn|now|absentOwnerIds|covers|backOn)$/.test(s) && !/^\d{15,22}$/.test(s) && !/^\d{4}-\d{2}-\d{2}$/.test(s)), [],
    'ids and days only: no name, no reason, nothing else');
});

test('foldAvailability: lines are data, not trusted — foreign, torn and refused lines change nothing', () => {
  const base = { at: 1, who: OWNER, action: 'availability', outcome: 'ok', from: '2026-10-06', to: '2026-10-09' };
  const v = foldAvailability([null, 'x', { ...base, action: 'sign-in' }, { ...base, at: 2, outcome: 'refused', to: '2026-10-20' }, { ...base, at: 3, who: 'bad' }, { ...base, at: 4, to: '2026-10-05' }, base,
    { ...base, at: 5, whom: SEC }], '2026-10-05');
  assert.deepEqual([...v.windows.keys()].sort(), [OWNER, SEC]);
  assert.equal(v.windows.get(OWNER).to, '2026-10-09');
});

test('the same answer from a durable store (day files), read through the interface', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gz-roster-'));
  try {
    const r = rig({ LOG_STORE: 'jsonl', LOG_DIR: dir });
    assert.equal(r.sinks.kind, 'jsonl');
    r.availability.set(me(OWNER), { from: '2026-10-06', to: '2026-10-09' });
    assert.ok(fs.readdirSync(dir).some((f) => f.startsWith('identity-')), 'filed to the identity day file, chained');
    const fresh = createRoster(logSourceOf(createLogSinks({ LOG_STORE: 'jsonl', LOG_DIR: dir }, { clock: r.clock })), r.clock);
    assert.deepEqual((await fresh.view()).outOn('2026-10-07'), [{ id: OWNER, backOn: '2026-10-09' }], 'a fresh process reads it back from disk');
    // a window booked 3 days before the read is still found across UTC days
    const later = createRoster(logSourceOf(createLogSinks({ LOG_STORE: 'jsonl', LOG_DIR: dir }, { clock: () => T0 + 3 * DAY })), () => T0 + 3 * DAY);
    assert.equal((await later.view()).backOn(OWNER, '2026-10-07'), '2026-10-09');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

const lead = (o = {}) => ({ id: LEAD, Owner: { id: OWNER }, Secondary_Owner: { id: SEC }, Cover_By: null, Cover_Until: null, ...o });

test('TC-E08-020 (server): roster cover — the secondary works the away owner\'s lead, only while the owner is out and they are in', async () => {
  const r = rig();
  r.availability.set(me(OWNER), { from: '2026-10-05', to: '2026-10-09' });
  const now = await rosterNow(r.roster);
  assert.deepEqual([...now.absentOwnerIds], [OWNER]);
  assert.equal(activeFor(lead(), SEC, '2026-10-06', now), 'roster');
  assert.equal(activeFor(lead(), OTHER, '2026-10-06', now), null, 'not the named secondary');
  assert.equal(activeFor(lead({ Secondary_Owner: null }), SEC, '2026-10-06', now), null, 'dormant label gone');
  assert.equal(activeFor(lead({ Owner: { id: MGR } }), SEC, '2026-10-06', now), null, 'only the away owner\'s leads');
  assert.equal(activeFor(lead({ Cover_By: { id: OTHER }, Cover_Until: '2026-10-08' }), SEC, '2026-10-06', now), null, 'explicit cover to someone else: no fallback');
  assert.match(activeClause(SEC, '2026-10-06', now), new RegExp(`Secondary_Owner = '${SEC}'\\) and Owner in \\('${OWNER}'\\)`));
  // the secondary is away too: not "actively available to cover"
  r.availability.set(me(SEC), { from: '2026-10-05', to: '2026-10-07' });
  const both = await rosterNow(r.roster);
  assert.equal(activeFor(lead(), SEC, '2026-10-06', both), null);
  assert.doesNotMatch(activeClause(SEC, '2026-10-06', both), /Secondary_Owner/);
  // the first day back closes it
  r.set(T0 + 4 * DAY);
  assert.equal(activeFor(lead(), SEC, '2026-10-09', await rosterNow(r.roster)), null);
});

test('no roster, or a failed roster read, admits nobody (fail closed)', async () => {
  assert.equal(activeFor(lead(), SEC, '2026-10-06', await rosterNow(undefined)), null);
  const broken = { async current() { throw new Error('stratus down'); } };
  assert.equal(activeFor(lead(), SEC, '2026-10-06', await rosterNow(broken)), null);
});

test('"until they are back" ends the day before the owner\'s first day back (was 14 days)', async () => {
  const r = rig();
  r.availability.set(me(OWNER), { from: '2026-10-05', to: '2026-10-12' });
  const starts = [];
  const crm = { async getRecord() { return { ok: true, value: { id: LEAD, Modified_Time: '2026-10-05T09:00:00+05:30', Owner: { id: OWNER }, Secondary_Owner: { id: SEC } } }; },
    async update(_c, _m, _id, f) { starts.push(f); return { ok: true, value: { modifiedTime: '2026-10-05T10:00:00+05:30' } }; } };
  const { userCredential } = load('lib/zoho/client.js');
  const cred = await userCredential({ access_token: 'synthetic', api_domain: 'https://www.zohoapis.in', expires_in: 3600 },
    { recordIdPrefix: P, gate: { async acquire() { return { waitedMs: 0, release() {} }; }, async run(_c, t) { return t(); }, snapshot() { return {}; } },
      log: { event() {}, refusal() {}, call() {} }, clock: () => T0, fetch: async () => new Response(JSON.stringify({ users: [{ id: OWNER, status: 'active' }] }), { status: 200 }) });
  const access = { async recheck() { return { actor: { userId: OWNER, seat: 'ir' }, mayViewLeads: true, teamOwnerIds: null, teamOrgWide: false }; } };
  const cover = createCover({ crm, access, log: { refusal() {} }, planeC: r.planeC,
    recordIdPrefix: P, roster: r.roster, clock: r.clock });
  const out = await cover.start({ credential: cred, sessionId: 'session_fixture_roster_0001' }, LEAD, '2026-10-05T09:00:00+05:30', 'back');
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.value.coverUntil, '2026-10-11');
  assert.deepEqual(starts[0].Cover_Until, '2026-10-11');
});

test('M14-S02: event staff must be in on the event dates and carry a book — checkStaff', async () => {
  const r = rig();
  r.availability.set(me(OWNER), { from: '2026-10-06', to: '2026-10-09' });
  const asked = [];
  const crm = { async aggregate(_c, q) {
    asked.push(q);
    return { ok: true, value: /from Leads/.test(q) ? [{ Owner: SEC, 'COUNT(id)': 4 }, { Owner: OWNER, 'COUNT(id)': 9 }] : [{ KAM: NEW, 'COUNT(id)': 2 }] };
  } };
  const v = await checkStaff({ roster: r.roster, crm }, { userId: MGR }, [OWNER, SEC, NEW, OTHER], '2026-10-08', '2026-10-09');
  assert.deepEqual(v.refused, [{ userId: OWNER, why: 'out', backOn: '2026-10-09' }, { userId: OTHER, why: 'no-book', backOn: null }]);
  assert.ok(asked.every((q) => /group by/.test(q) && !/select \*/.test(q)), 'counts only');
  assert.match(asked[0], /Lost_At is null\) and Onboarded_At is null\)/, 'an open book');
  const ok = await checkStaff({ roster: r.roster, crm }, { userId: MGR }, [SEC, NEW], '2026-10-08', '2026-10-09');
  assert.deepEqual(ok.refused, []);
  const down = await checkStaff({ roster: r.roster, crm: { async aggregate() { return { ok: false, error: { kind: 'server' } }; } } }, { userId: MGR }, [SEC], '2026-10-08', '2026-10-09');
  assert.deepEqual(down, { ok: false, errorKind: 'server' }, 'a failed read refuses rather than staffing unchecked');
});

test('M14-S02: the event write refuses staff who are out or carry no book, with a clear message, and writes nothing', async () => {
  const { compile: rigCompile } = require('../cases/fixture-rig.cjs');
  const { makeWriteRig } = require('../events/write-rig.cjs');
  const ld = rigCompile(['server/events/writes.ts', 'server/data/events.ts', 'server/identity/plane-c.ts', 'server/roster/staff.ts']);
  const { createEventWrites: cew } = ld('server/events/writes.js');
  const route = (c) => { if (c.method === 'POST' && c.path === '/Lead_Events') return 'insert.event'; throw new Error(`unrouted ${c.method} ${c.path}`); };
  const draft = (staffIds) => ({ name: 'Adarsh Palm Retreat', startsOn: '2026-10-08', endsOn: '2026-10-09', city: 'Bengaluru', kind: 'Society', channel: 'MyGate', state: 'planned', cost: 70000, staffIds });
  const r = rig();
  r.availability.set(me(OWNER), { from: '2026-10-06', to: '2026-10-09' });
  const crm = { async aggregate(_c, q) { return { ok: true, value: /from Leads/.test(q) ? [{ Owner: SEC, 'COUNT(id)': 4 }, { Owner: OWNER, 'COUNT(id)': 9 }] : [] }; } };
  const ctx = await makeWriteRig(ld, route);
  const authority = { ...ctx.authority, staffCheck: (cred, ids, from, to, s) => checkStaff({ roster: r.roster, crm }, cred, ids, from, to, s) };
  const w = cew({ ...ctx, authority });
  const mgr = await ctx.cred(`${P}740995002`);
  const out = await w.create(mgr, draft([OWNER, SEC]));
  assert.equal(out.reasonCode, 'gaps');
  assert.deepEqual([...out.gaps], ['eligible staff']);
  assert.deepEqual([...out.staff], [{ userId: OWNER, why: 'out', backOn: '2026-10-09' }]);
  assert.equal(out.reason, 'One person named to work this event cannot: 1 is out of office on the event dates. Pick someone who is in and carries a book.');
  const nobook = await w.create(mgr, draft([SEC, OTHER]));
  assert.deepEqual([...nobook.staff], [{ userId: OTHER, why: 'no-book', backOn: null }]);
  assert.match(nobook.reason, /carries no book/);
  assert.equal(ctx.calls.filter((c) => c.method !== 'POST' || c.path !== '/coql').length, 0, 'nothing was written');
  const good = await w.create(mgr, draft([SEC]));
  assert.equal(good.ok, true, JSON.stringify(good));
  assert.equal(staffMessage([{ userId: OWNER, why: 'out', backOn: 'x' }, { userId: OTHER, why: 'no-book', backOn: null }]),
    '2 people named to work this event cannot: 1 is out of office on the event dates and 1 carries no book. Pick someone who is in and carries a book.');
});

/* M08-S05-NOTE-7 / D44 — returning a primary through roster controls clears their explicit cover. */
async function returnRig(who, { conflictOn = null, team = null } = {}) {
  const r = rig();
  const { userCredential } = load('lib/zoho/client.js');
  const cred = await userCredential({ access_token: 'synthetic', api_domain: 'https://www.zohoapis.in', expires_in: 3600 },
    { recordIdPrefix: P, gate: { async acquire() { return { waitedMs: 0, release() {} }; }, async run(_c, t) { return t(); }, snapshot() { return {}; } },
      log: { event() {}, refusal() {}, call() {} }, clock: () => T0, fetch: async () => new Response(JSON.stringify({ users: [{ id: who, status: 'active' }] }), { status: 200 }) });
  const L2 = `${P}740996304`;
  const calls = { coql: [], update: [], refusals: [] };
  const crm = {
    async getRecord() { throw new Error('not read'); },
    async coql(_c, q) { calls.coql.push(q); return { ok: true, value: { moreRecords: false, records: [
      { id: LEAD, Cover_By: { id: SEC }, Modified_Time: '2026-10-05T09:00:00+05:30' },
      { id: L2, Cover_By: { id: NEW }, Modified_Time: '2026-10-05T09:01:00+05:30' }] } }; },
    async update(_c, _m, id, f, o) { calls.update.push({ id, f, ifUnmodifiedSince: o.ifUnmodifiedSince });
      return id === conflictOn ? { ok: false, error: { kind: 'conflict' } } : { ok: true, value: { modifiedTime: '2026-10-05T10:00:00+05:30' } }; },
  };
  const access = { async recheck() { return { actor: { userId: who, seat: team ? 'ir-manager' : 'ir' }, mayViewLeads: true, teamOwnerIds: team, teamOrgWide: false }; } };
  const cover = createCover({ crm, access, log: { refusal(e) { calls.refusals.push(e); } }, planeC: r.planeC, recordIdPrefix: P, roster: r.roster, clock: r.clock });
  return { r, cover, calls, L2, p: { credential: cred, sessionId: 'session_fixture_roster_0002' } };
}

test('D44: the owner marked back in — every explicit cover on their leads ends: guarded write, one Plane C line each', async () => {
  const { r, cover, calls, L2, p } = await returnRig(OWNER);
  const out = await cover.returned(p, OWNER);
  assert.deepEqual(out, { ok: true, value: { personId: OWNER, cleared: [LEAD, L2], failed: [] } });
  assert.match(calls.coql[0], new RegExp(`Owner = '${OWNER}' and Cover_By is not null`));
  assert.deepEqual(calls.update.map((u) => [u.id, u.f, u.ifUnmodifiedSince]), [
    [LEAD, { Cover_By: null, Cover_Until: null }, '2026-10-05T09:00:00+05:30'], [L2, { Cover_By: null, Cover_Until: null }, '2026-10-05T09:01:00+05:30']]);
  const lines = r.lines().filter((e) => e.action === 'grant-change');
  assert.deepEqual(lines.map((e) => [e.who, e.whom, e.outcome, e.reason, e.recordIds]), [
    [OWNER, SEC, 'ended', 'cover-end-returned', [LEAD]], [OWNER, NEW, 'ended', 'cover-end-returned', [L2]]]);
});

test('D44: a manager over the owner may mark them back; a lead Zoho will not clear is reported, not hidden', async () => {
  const { cover, calls, L2, p } = await returnRig(MGR, { conflictOn: `${P}740996304`, team: [OWNER] });
  const out = await cover.returned(p, OWNER);
  assert.deepEqual(out.value, { personId: OWNER, cleared: [LEAD], failed: [L2] });
});

test('D44: someone neither the owner nor over them cannot end the owner\'s covers — refused, nothing read or written', async () => {
  const { r, cover, calls, p } = await returnRig(OTHER);
  const out = await cover.returned(p, OWNER);
  assert.equal(out.reasonCode, 'not-yours-to-end');
  assert.equal(calls.coql.length + calls.update.length, 0);
  const refused = r.lines().find((e) => e.action === 'refused-action');
  assert.deepEqual([refused.who, refused.whom, refused.reason], [OTHER, OWNER, 'cover-return']);
  assert.equal((await cover.returned({ ...p, sessionId: 'x' }, OWNER)).reasonCode, 'invalid-request');
  assert.equal((await cover.returned(p, 'not-an-id')).reasonCode, 'invalid-request');
});

/* D123 Q3 — the owner marked absent: Zoho enforces the dormant secondary, so Cover_By must be written for the secondary to reach the lead. */
test('D123: an absence that starts today writes Cover_By = each lead\'s secondary, Cover_Until = the day before the first day back, on the actor\'s token', async () => {
  const { r, cover, calls, p } = await returnRig(OWNER);
  const L2 = `${P}740996304`, L3 = `${P}740996305`, L4 = `${P}740996306`;
  const crm = { async getRecord() { throw new Error('not read'); }, async coql(_c, q) { calls.coql.push(q); return { ok: true, value: { moreRecords: false, records: [
      { id: LEAD, Secondary_Owner: { id: SEC }, Modified_Time: '2026-10-05T09:00:00+05:30' },
      { id: L2, Secondary_Owner: { id: NEW }, Modified_Time: '2026-10-05T09:01:00+05:30' },
      { id: L3, Secondary_Owner: { id: OWNER }, Modified_Time: '2026-10-05T09:02:00+05:30' },
      { id: L4, Secondary_Owner: { id: SEC }, Modified_Time: '2026-10-05T09:03:00+05:30' }] } }; },
    async update(_c, _m, id, f, o) { calls.update.push({ id, f, ifUnmodifiedSince: o.ifUnmodifiedSince }); return id === L4 ? { ok: false, error: { kind: 'conflict' } } : { ok: true, value: { modifiedTime: 'x' } }; } };
  const access = { async recheck() { return { actor: { userId: OWNER, seat: 'ir' }, mayViewLeads: true, teamOwnerIds: null, teamOrgWide: false }; } };
  const c2 = createCover({ crm, access, log: { refusal() {} }, planeC: r.planeC, recordIdPrefix: P, roster: r.roster, clock: r.clock });
  const out = await c2.absent(p, OWNER, '2026-10-12');
  assert.deepEqual(out, { ok: true, value: { personId: OWNER, opened: [LEAD, L2], failed: [L4] } });
  assert.match(calls.coql[0], new RegExp(`where \\(\\(\\(\\(Owner = '${OWNER}' and Cover_By is null\\) and Secondary_Owner is not null\\) and Lost_At is null\\) and Onboarded_At is null\\)`));
  assert.deepEqual(calls.update.slice(0, 2).map((u) => [u.id, u.f, u.ifUnmodifiedSince]), [
    [LEAD, { Cover_By: { id: SEC }, Cover_Until: '2026-10-11' }, '2026-10-05T09:00:00+05:30'], [L2, { Cover_By: { id: NEW }, Cover_Until: '2026-10-11' }, '2026-10-05T09:01:00+05:30']]);
  assert.deepEqual(r.lines().filter((e) => e.reason === 'cover-open-absence').map((e) => [e.who, e.whom, e.recordIds]), [[OWNER, SEC, [LEAD]], [OWNER, NEW, [L2]]]);
});

test('D123: nobody but the owner or a manager over them may open covers for an absence; a bad date is refused', async () => {
  const { cover, calls, p } = await returnRig(OTHER);
  assert.equal((await cover.absent(p, OWNER, '2026-10-12')).reasonCode, 'not-yours-to-cover');
  assert.equal((await cover.absent(p, OWNER, 'soon')).reasonCode, 'invalid-request');
  assert.equal(calls.coql.length + calls.update.length, 0);
});
