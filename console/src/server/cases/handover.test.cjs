/* M13-S04-T01 — a KAM hands a Bank or Compliance ticket to Finance and keeps watching, on recorded Zoho answers.
 * Run from console/: node --test src/server/cases/handover.test.cjs */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { compile, makeRig, P: RP } = require('./fixture-rig.cjs');

const load = compile(['server/cases/handover.ts', 'server/cases/register.ts', 'server/data/scope.ts', 'server/data/events.ts',
  'server/identity/plane-c.ts', 'server/oauth/seat.ts']);
const { createCaseHandover, financeTarget, HAND_TEXT } = load('server/cases/handover.js');
const { createCasesRegister, casesWhere } = load('server/cases/register.js');
const { scopesFor } = load('server/data/scope.js');
const { createZohoSeatDirectory } = load('server/oauth/seat.js');
const { createMemorySink, createOpsLog } = load('lib/zoho/log.js');
const { createZohoClient, userCredential } = load('lib/zoho/client.js');
const { createScopedCache } = load('lib/zoho/cache.js');
const { createPlaneCLog, createPlaneCMemorySink } = load('server/identity/plane-c.js');
const { createInvestorEvents } = load('server/data/events.js');

const FXDIR = path.resolve(__dirname, '..', '..', 'lib', 'zoho', '__fixtures__');
const FX = (area, name) => JSON.parse(fs.readFileSync(path.join(FXDIR, area, `${name}.response.json`), 'utf8'));
const seatsFx = JSON.parse(fs.readFileSync(path.join(FXDIR, 'oauth', 'current-user.seats.response.json'), 'utf8'));
const seats = createZohoSeatDirectory({ recordIdPrefix: seatsFx.recordIdPrefix, roleIds: seatsFx.roleIds, profileIds: seatsFx.profileIds });

const P = '554023000000';
const IMRAN = P + '300011', NEHA = P + '300013', MEENA = P + '300008', HARSHA = P + '300007', DIVYA = P + '300010', LATHA = P + '300009';
const CASE = P + '500114';
const NOW = Date.parse('2026-09-28T06:00:00Z');
const gate = () => ({ async acquire() { return { waitedMs: 0, release() {} }; }, async run(_c, t) { return t(); }, snapshot() { return {}; } });
const toResponse = (r) => new Response(r.status === 204 ? null : JSON.stringify(r.body), { status: r.status, headers: r.headers || {} });

/** caseFx: the one Case read; users: the GET /users fixture; owner: the change_owner fixture */
async function rig({ caseFx = 'coql.case.hand-bank', users = 'users.active', owner = 'change-owner.case', put = 'update.case.handed' } = {}) {
  const calls = [];
  const sink = createMemorySink();
  const log = createOpsLog(sink);
  const events = createInvestorEvents({ log, planeC: createPlaneCLog(createPlaneCMemorySink()), clock: () => NOW });
  const crm = createZohoClient({ recordIdPrefix: '554023', gate: gate(), log, maxAttempts: 1, clock: () => NOW,
    fetch: async (url, init) => {
      const u = new URL(String(url));
      const body = init.body ? JSON.parse(init.body) : null;
      const headers = Object.fromEntries(new Headers(init.headers || {}).entries());
      const c = { method: init.method || 'GET', path: u.pathname.replace(/^\/crm\/v\d+/, ''), query: u.searchParams, body, headers };
      calls.push(c);
      if (c.path === '/coql') return toResponse(FX('cases', caseFx));
      if (c.path === '/users') return toResponse(FX('cases', users));
      if (c.method === 'PUT' && c.path.endsWith('/actions/change_owner')) return toResponse(FX('cases', owner));
      if (c.method === 'PUT' && c.path === `/Cases/${CASE}`) return toResponse(put === 'conflict' ? { status: 412, body: { code: 'ALREADY_MODIFIED', status: 'error', message: 'x', details: { id: CASE } } } : FX('cases', put));
      throw new Error(`unrouted ${c.method} ${c.path}`);
    } });
  const cache = createScopedCache({ clock: () => NOW });
  const cred = (id) => userCredential({ access_token: `synthetic-${id}-never-live`, api_domain: 'https://www.zohoapis.in', expires_in: 3_600 },
    { recordIdPrefix: '554023', gate: gate(), log: createOpsLog(createMemorySink()), clock: () => NOW,
      fetch: async () => toResponse({ status: 200, body: { users: [{ id, status: 'active' }] } }) });
  const svc = createCaseHandover({ crm, seats, cache, events, clock: () => NOW });
  return { svc, calls, sink, cache, cred, writes: () => calls.filter((c) => c.method === 'PUT') };
}

test('Finance is Finance Operations, else the Head of Finance, else nobody — active seated users only', () => {
  assert.equal(financeTarget(FX('cases', 'users.active').body.users, seats), MEENA);
  assert.equal(financeTarget(FX('cases', 'users.active.no-ops').body.users, seats), HARSHA);
  assert.equal(financeTarget(FX('cases', 'users.active.no-finance').body.users, seats), null);
  const left = FX('cases', 'users.active').body.users.map((u) => (u.id === MEENA ? { ...u, status: 'disabled' } : u));
  assert.equal(financeTarget(left, seats), HARSHA, 'a leaver is never handed a ticket');
});

test('TC-IM08-007: Imran hands "Change the bank account for payouts" to Finance — watcher written first, then change_owner to Meena, on his own token', async () => {
  const r = await rig();
  const out = await r.svc.handToFinance({ credential: await r.cred(IMRAN), seat: 'kam' }, CASE, '2026-09-27T10:00:00+05:30');
  assert.equal(out.ok, true);
  assert.equal(out.to, MEENA);
  assert.equal(out.already, false);
  assert.equal(out.row.own, MEENA);
  assert.deepEqual({ ...out.row.handed }, { by: IMRAN, at: '2026-09-28T11:30' });
  assert.equal(out.row.watched, true);
  const [coql, users, put, change] = r.calls;
  assert.match(coql.body.select_query, /Handed_By, Handed_At, Modified_Time from Cases where id = '554023000000500114'/);
  assert.equal(users.query.get('type'), 'ActiveUsers');
  assert.equal(put.path, `/Cases/${CASE}`);
  assert.deepEqual(put.body, { data: [{ Handed_By: { id: IMRAN }, Handed_At: '2026-09-28T11:30:00+05:30' }] });
  assert.equal(put.headers['if-unmodified-since'], '2026-09-27T10:00:00+05:30', 'guarded write (D44)');
  assert.equal(change.path, `/Cases/${CASE}/actions/change_owner`);
  assert.deepEqual(change.body, { owner: { id: MEENA }, notify: true });
  for (const c of r.calls) assert.equal(c.headers.authorization, `Zoho-oauthtoken synthetic-${IMRAN}-never-live`, 'D53: his own token');
  assert.doesNotMatch(JSON.stringify(r.sink.records()), /Test User|example\.invalid|payouts/, 'Plane B holds ids and codes only');
});

test('with no Finance Operations the ticket goes to the Head of Finance; with nobody in Finance nothing is written', async () => {
  const a = await rig({ users: 'users.active.no-ops' });
  const out = await a.svc.handToFinance({ credential: await a.cred(IMRAN), seat: 'kam' }, CASE);
  assert.equal(out.to, HARSHA);
  const b = await rig({ users: 'users.active.no-finance' });
  const no = await b.svc.handToFinance({ credential: await b.cred(IMRAN), seat: 'kam' }, CASE);
  assert.equal(no.reason, 'no-finance');
  assert.equal(no.message, HAND_TEXT['no-finance']);
  assert.equal(b.writes().length, 0);
});

test('refused before any write: a Query ticket, someone else\'s ticket, a Finance seat, the Auditor, a bad id', async () => {
  const q = await rig({ caseFx: 'coql.case.hand-query' });
  assert.equal((await q.svc.handToFinance({ credential: await q.cred(IMRAN), seat: 'kam' }, P + '500115')).reason, 'not-finance-work');
  const n = await rig({ caseFx: 'coql.case.hand-neha' });
  assert.equal((await n.svc.handToFinance({ credential: await n.cred(IMRAN), seat: 'kam' }, P + '500116')).reason, 'not-yours');
  const f = await rig({ caseFx: 'coql.case.hand-finance' });
  assert.equal((await f.svc.handToFinance({ credential: await f.cred(MEENA), seat: 'fin' }, P + '500117')).reason, 'not-yours');
  const a = await rig();
  assert.equal((await a.svc.handToFinance({ credential: await a.cred(LATHA), seat: 'audit' }, CASE)).reason, 'read-only');
  assert.equal((await a.svc.handToFinance({ credential: await a.cred(IMRAN), seat: 'kam' }, 'DROP TABLE')).reason, 'invalid-request');
  for (const x of [q, n, f, a]) assert.equal(x.writes().length, 0);
  assert.ok(n.sink.records().some((l) => l.kind === 'refusal' && l.reason === 'not-yours'));
});

test('a repeated press on a ticket already handed is idempotent: no second write', async () => {
  const r = await rig({ caseFx: 'coql.case.hand-handed' });
  const out = await r.svc.handToFinance({ credential: await r.cred(IMRAN), seat: 'kam' }, CASE);
  assert.equal(out.ok, true);
  assert.equal(out.already, true);
  assert.equal(out.row.own, MEENA);
  assert.equal(out.row.watched, true);
  assert.equal(r.writes().length, 0);
});

test('someone changed the ticket since it was loaded: refused as a conflict, their change kept, no owner change', async () => {
  const a = await rig();
  const out = await a.svc.handToFinance({ credential: await a.cred(IMRAN), seat: 'kam' }, CASE, '2026-09-26T09:00:00+05:30');
  assert.equal(out.kind, 'conflict');
  assert.equal(a.writes().length, 0);
  const b = await rig({ put: 'conflict' });
  const z = await b.svc.handToFinance({ credential: await b.cred(IMRAN), seat: 'kam' }, CASE);
  assert.equal(z.kind, 'conflict');
  assert.equal(b.writes().filter((c) => c.path.endsWith('change_owner')).length, 0, 'Zoho\'s 412 stops before the owner moves');
});

test('Zoho refuses change_owner: a source error (not retryable); pressing again repeats both writes', async () => {
  const r = await rig({ owner: 'change-owner.case.no-permission' });
  const out = await r.svc.handToFinance({ credential: await r.cred(IMRAN), seat: 'kam' }, CASE);
  assert.equal(out.ok, false);
  assert.equal(out.kind, 'source-error');
  assert.equal(out.retryable, false);
  assert.deepEqual(r.writes().map((c) => c.path), [`/Cases/${CASE}`, `/Cases/${CASE}/actions/change_owner`]);
});

/* ---- the register: the KAM keeps watching; another KAM never sees it ---- */
const KAM = `${RP}740994001`, KAM2 = `${RP}740994002`, FIN = `${RP}740993001`;

test('TC-IM08-007/015: Imran\'s register reads Owner = me or Handed_By = me; the handed row is watched, not his to work', async () => {
  const rig2 = await makeRig(load, (q) => (/COUNT/.test(q) ? ['cases', 'agg.cuts.kam'] : ['cases', 'coql.cases.kam-handed']));
  const r = await createCasesRegister(rig2).list({ credential: await rig2.cred(KAM), seat: 'kam' });
  assert.equal(r.ok, true);
  assert.match(rig2.queries[0], new RegExp(`where \\(Owner = '${KAM}' or Handed_By = '${KAM}'\\)`));
  const bank = r.rows.find((x) => x.cat === 'Bank');
  assert.equal(bank.own, FIN);
  assert.deepEqual({ ...bank.handed }, { by: KAM, at: '2026-09-28T11:30' });
  assert.equal(bank.watched, true);
  assert.equal(r.rows.find((x) => x.cat === 'Records').watched, undefined);
  assert.equal(r.mine, 1, 'Mine counts only what he owns');
});

test('TC-IM08-015: a row handed by somebody else in an own-book read is scope drift — refused, nothing shown', async () => {
  const rig2 = await makeRig(load, (q) => (/COUNT/.test(q) ? ['cases', 'agg.cuts.kam'] : ['cases', 'coql.cases.kam-handed-by-other']));
  const r = await createCasesRegister(rig2).list({ credential: await rig2.cred(KAM), seat: 'kam' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'scope-drift');
});

test('the predicate: a KAM and the Head of AM\'s subtree include what they handed; Finance reads the org', () => {
  assert.equal(casesWhere(scopesFor('kam', KAM).cases, null), `(Owner = '${KAM}' or Handed_By = '${KAM}')`);
  const head = `${RP}740994009`;
  assert.equal(casesWhere(scopesFor('amlead', head).cases, [KAM, KAM2]),
    `(Owner in ('${head}', '${KAM}', '${KAM2}') or Handed_By in ('${head}', '${KAM}', '${KAM2}'))`);
  assert.equal(casesWhere(scopesFor('fin', FIN).cases, null), 'id is not null');
});
