/* M17-S02-T01 — grant pages and change seats and managers: the Leads-side seat change (setSeat), the manager
 * change (setMgr) with loop detection, and step-up on a seat change — over recorded Zoho Users answers.
 * Run from console/: node --test src/server/access/teams-writes.test.cjs */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { compile } = require('../cases/fixture-rig.cjs');

const load = compile(['server/access/manager-change.ts', 'server/access/seat-change.ts', 'server/access/grants.ts',
  'server/identity/users.ts', 'server/identity/authority.ts', 'server/identity/step-up.ts', 'server/oauth/seat.ts']);
const { decideManager, createManagerChangeService, MANAGER_REFUSALS } = load('server/access/manager-change.js');
const { decideLeadSeat, createSeatChangeService, LEAD_SEAT_TO_ZOHO, SEAT_REFUSALS } = load('server/access/seat-change.js');
const { createGrantStore } = load('server/access/grants.js');
const { createZohoUserDirectory } = load('server/identity/users.js');
const { createAuthorityEvents } = load('server/identity/authority.js');
const { STEP_UP_ACTIONS } = load('server/identity/step-up.js');
const { createPlaneCLog, createPlaneCMemorySink } = load('server/identity/plane-c.js');
const { createZohoSeatDirectory } = load('server/oauth/seat.js');
const { createZohoClient, userCredential } = load('lib/zoho/client.js');
const { createMemorySink, createOpsLog } = load('lib/zoho/log.js');

const FXDIR = path.resolve(__dirname, '..', '..', 'lib', 'zoho', '__fixtures__');
const read = (area, name) => fs.readFileSync(path.join(FXDIR, area, `${name}.response.json`), 'utf8');
const seatsFx = JSON.parse(read('oauth', 'current-user.seats'));
const seats = createZohoSeatDirectory({ recordIdPrefix: seatsFx.recordIdPrefix, roleIds: seatsFx.roleIds, profileIds: seatsFx.profileIds });

const P = '554023000000';
const PRADEEP = P + '300001', SAHIL = P + '300003', TASNEEM = P + '300004', ROHIT = P + '300005', JHALAK = P + '300012', KAVYA = P + '300014';
const PEOPLE = { [PRADEEP]: ['grants', 'users.pradeep-ceo'], [SAHIL]: ['grants', 'users.sahil-di'], [TASNEEM]: ['grants', 'users.tasneem-ir-manager'],
  [ROHIT]: ['grants', 'users.rohit-ir'], [JHALAK]: ['grants', 'users.jhalak-exec'], [KAVYA]: ['users', 'users.kavya-ir'] };
const T0 = Date.parse('2026-09-28T12:00:00+05:30');
const gate = () => ({ async acquire() { return { waitedMs: 0, release() {} }; }, async run(_c, t) { return t(); }, snapshot() { return {}; } });
const toResponse = (r) => new Response(JSON.stringify(r.body), { status: r.status, headers: r.headers || {} });

const fileOf = (id, kavya) => (id === KAVYA ? ['users', `users.${kavya}`] : PEOPLE[id]);
const person = (id, kavya = 'kavya-ir') => {
  const [a, n] = fileOf(id, kavya);
  const u = JSON.parse(read(a, n)).users[0];
  return { who: id, seat: seats.resolveDirectoryUser({ users: [u] }).value.seat, mgr: u.Reporting_To ? u.Reporting_To.id : null };
};
const book = (ids, kavya) => ({ people: ids.map((id) => person(id, kavya)), grants: {} });

function rig({ who = TASNEEM, seat = 'conv', kavya = 'kavya-ir', put = 'put.manager.success' } = {}) {
  const calls = [];
  const planeB = createMemorySink();
  const log = createOpsLog(planeB);
  const users = createZohoUserDirectory({ seats, gate: gate(), log, clock: () => T0,
    fetch: async (url) => {
      const f = fileOf(url.split('/').pop(), kavya);
      return { status: f ? 200 : 204, text: async () => (f ? read(f[0], f[1]) : ''), headers: { get: () => null } };
    } });
  const crm = createZohoClient({ recordIdPrefix: '554023', gate: gate(), log, maxAttempts: 1, clock: () => T0,
    fetch: async (url, init) => {
      calls.push({ method: init.method, path: new URL(url).pathname, body: init.body ? JSON.parse(init.body) : null, headers: init.headers });
      return toResponse(JSON.parse(read('users', put)));
    } });
  const sink = createPlaneCMemorySink();
  const events = createAuthorityEvents(createPlaneCLog(sink), () => T0);
  const store = createGrantStore();
  const managers = createManagerChangeService({ users, crm, events, store, clock: () => T0 });
  const ended = [];
  const seatSvc = createSeatChangeService({ users, seats, crm, events, store, clock: () => T0, kamBook: async () => [],
    sessions: { endSessionsOf: async (w, r) => { ended.push([w, r]); return 1; } } });
  const as = userCredential({ access_token: `synthetic-${who}-never-live`, api_domain: 'https://www.zohoapis.in', expires_in: 3_600 },
    { recordIdPrefix: '554023', gate: gate(), log: createOpsLog(createMemorySink()), clock: () => T0,
      fetch: async () => toResponse({ status: 200, body: { users: [{ id: who, status: 'active' }] } }) });
  return { calls, planeB, sink, store, managers, seatSvc, ended, as, session: { who, seat } };
}

/* ---- setMgr ---------------------------------------------------------------------------------------- */

test('TC-E14-007: making Tasneem report to Rohit (who reports to her) is refused as a loop; nothing changes', () => {
  const b = book([PRADEEP, SAHIL, TASNEEM, ROHIT]);
  const v = decideManager(SAHIL, TASNEEM, ROHIT, b);
  assert.deepEqual({ ...v }, { ok: false, refusal: 'loop' });
  assert.match(MANAGER_REFUSALS.loop, /^That would make a loop/);
  assert.equal(decideManager(SAHIL, TASNEEM, TASNEEM, b).refusal, 'loop', 'reporting to oneself is the smallest loop');
  assert.equal(decideManager(SAHIL, TASNEEM, SAHIL, b).refusal, 'same-manager');
  assert.equal(decideManager(SAHIL, ROHIT, SAHIL, b).ok, true, 'Digital Infrastructure may put an IR directly under themselves');
});

test('service: Tasneem moves Kavya under Rohit — Reporting_To written on her own token, Plane C manager-change of ids only', async () => {
  const r = rig();
  const out = await r.managers.change(await r.as, r.session, { whom: KAVYA, manager: ROHIT });
  assert.equal(out.ok, true);
  assert.deepEqual([out.from, out.to], [TASNEEM, ROHIT]);
  assert.equal(r.calls.length, 1);
  assert.equal(r.calls[0].method, 'PUT');
  assert.equal(r.calls[0].path, `/crm/v8/users/${KAVYA}`);
  assert.deepEqual(r.calls[0].body, { users: [{ id: KAVYA, Reporting_To: { id: ROHIT } }] });
  assert.equal(r.calls[0].headers.Authorization, `Zoho-oauthtoken synthetic-${TASNEEM}-never-live`, 'D53: her own token');
  const [line] = r.sink.events();
  assert.deepEqual({ ...line, recordIds: [...line.recordIds] }, { at: T0, who: TASNEEM, whom: KAVYA, action: 'manager-change', outcome: 'ok', reason: 'set', seat: 'conv', recordIds: [TASNEEM, ROHIT] });
  assert.doesNotMatch(JSON.stringify([r.sink.events(), r.planeB.records()]), /Test User|example\.invalid|never-live/);
});

test('service: a loop through Zoho\'s own chains (Kavya already under Rohit) is refused and nothing is written', async () => {
  const r = rig({ kavya: 'kavya-ir-under-rohit' });
  const out = await r.managers.change(await r.as, r.session, { whom: ROHIT, manager: KAVYA });
  assert.equal(out.ok, false);
  assert.equal(out.refusal, 'loop');
  assert.equal(out.status, 409);
  assert.equal(r.calls.length, 0);
  assert.equal(r.sink.events()[0].outcome, 'refused');
  assert.equal(r.sink.events()[0].reason, 'loop');
});

test('service: the IR Manager cannot move someone outside her IRs, nor put her IR under someone she does not manage, nor herself', async () => {
  const r = rig();
  assert.equal((await r.managers.change(await r.as, r.session, { whom: JHALAK, manager: TASNEEM })).refusal, 'cannot-manage');
  assert.equal((await r.managers.change(await r.as, r.session, { whom: ROHIT, manager: PRADEEP })).refusal, 'manager-out-of-reach');
  assert.equal((await r.managers.change(await r.as, r.session, { whom: TASNEEM, manager: ROHIT })).refusal, 'own-row');
  assert.equal((await r.managers.change(await r.as, r.session, { whom: ROHIT, manager: 'x' })).refusal, 'bad-request');
  assert.equal((await r.managers.change(await r.as, { who: TASNEEM, seat: 'ir' }, { whom: KAVYA, manager: ROHIT })).refusal, 'seat-moved');
  assert.equal(r.calls.length, 0);
});

test('service: Zoho refuses the Users PUT — refused, a refused manager-change line', async () => {
  const r = rig({ put: 'put.seat.no-permission' });
  const out = await r.managers.change(await r.as, r.session, { whom: KAVYA, manager: ROHIT });
  assert.equal(out.refusal, 'zoho-refused');
  assert.equal(r.sink.events().at(-1).outcome, 'refused');
});

/* ---- setSeat, Leads side --------------------------------------------------------------------------- */

test('the Leads seats a seat change can write: IR, IR Manager, Channel Partner, BU Owner, Exec — never an Administrator one', () => {
  assert.deepEqual({ ...LEAD_SEAT_TO_ZOHO }, { bu: 'business-unit-owner', conv: 'ir-manager', ir: 'investor-relations', cp: 'channel-partner', exec: 'viewer' });
});

test('TC-E14-005: the IR Manager may give only "ir", only to her own IRs; Digital Infrastructure may seat anyone in reach', () => {
  const b = book([PRADEEP, SAHIL, TASNEEM, ROHIT, JHALAK, KAVYA]);
  assert.equal(decideLeadSeat(TASNEEM, KAVYA, 'conv', b), 'ir-seat-only');
  assert.match(SEAT_REFUSALS['ir-seat-only'], /only the Investor Relations seat/);
  assert.equal(decideLeadSeat(TASNEEM, JHALAK, 'ir', b), 'cannot-seat', 'Jhalak is not one of her IRs');
  assert.equal(decideLeadSeat(TASNEEM, ROHIT, 'ir', b), 'same-seat');
  assert.equal(decideLeadSeat(TASNEEM, SAHIL, 'ir', b), 'super-admin');
  assert.equal(decideLeadSeat(SAHIL, JHALAK, 'ir', b), null);
  assert.equal(decideLeadSeat(SAHIL, KAVYA, 'conv', b), null);
  assert.equal(decideLeadSeat(SAHIL, ROHIT, 'fin', b), 'bad-request', 'Finance is never a Leads seat handed out here');
});

test('service: Tasneem\'s attempts change nothing — no Users PUT, a refused seat-change line each, Kavya stays "ir"', async () => {
  const r = rig();
  const a = await r.seatSvc.change(await r.as, r.session, { whom: KAVYA, to: 'conv', side: 'lead' });
  assert.deepEqual([a.ok, a.refusal, a.status], [false, 'ir-seat-only', 403]);
  const b = await r.seatSvc.change(await r.as, r.session, { whom: JHALAK, to: 'ir', side: 'lead' });
  assert.equal(b.refusal, 'cannot-seat');
  assert.equal(r.calls.length, 0);
  assert.deepEqual(r.sink.events().map((l) => [l.action, l.outcome, l.reason]), [['seat-change', 'refused', 'ir-to-conv'], ['seat-change', 'refused', 'exec-to-ir']]);
});

test('service: Digital Infrastructure holds no console session seat today (Administrator profile, D80) — refused as seat-moved', async () => {
  const r = rig({ who: SAHIL, seat: 'ops' });
  const out = await r.seatSvc.change(await r.as, r.session, { whom: JHALAK, to: 'ir', side: 'lead' });
  assert.equal(out.refusal, 'seat-moved');
  assert.equal(r.calls.length, 0);
});

test('D22: a seat change asks a live step-up first — "seat" is a step-up action and the route is wrapped in requireStepUp', () => {
  assert.ok(STEP_UP_ACTIONS.includes('seat'));
  const route = fs.readFileSync(path.resolve(__dirname, '..', '..', 'app', 'api', 'users', '[id]', 'route.ts'), 'utf8');
  assert.match(route, /guardApi\("\/api\/users", requireStepUp\("seat", put\)\)/);
});
