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
/* after: the read-back once the write is answered (W3-KAM-3) — a fixture name or 'empty' (204: no longer visible);
   undo: the answer to a second PUT (the take-back of a hand-over mark Zoho stored without the owner) */
async function rig({ caseFx = 'coql.case.hand-bank', users = 'users.active', owner = 'change-owner.case', put = 'update.case.handed',
  after = 'coql.case.hand-after-handed', undo = 'update.case.handed' } = {}) {
  let coqls = 0, puts = 0;
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
      if (c.path === '/coql') {
        if (coqls++ === 0) return toResponse(FX('cases', caseFx));
        return toResponse(after === 'empty' ? { status: 204 } : FX('cases', after));
      }
      if (c.path === '/users') return toResponse(FX('cases', users));
      if (c.method === 'PUT' && c.path.endsWith('/actions/change_owner')) return toResponse(FX('cases', owner));
      if (c.method === 'PUT' && c.path === `/Cases/${CASE}`) {
        const which = puts++ === 0 ? put : undo;
        return toResponse(which === 'conflict' ? { status: 412, body: { code: 'ALREADY_MODIFIED', status: 'error', message: 'x', details: { id: CASE } } } : FX('cases', which));
      }
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

test('TC-IM08-007: Imran hands "Change the bank account for payouts" to Finance — owner and watcher in ONE guarded write to Meena, on his own token', async () => {
  const r = await rig();
  const out = await r.svc.handToFinance({ credential: await r.cred(IMRAN), seat: 'kam' }, CASE, '2026-09-27T10:00:00+05:30');
  assert.equal(out.ok, true);
  assert.equal(out.to, MEENA);
  assert.equal(out.already, false);
  assert.equal(out.row.own, MEENA);
  assert.deepEqual({ ...out.row.handed }, { by: IMRAN, at: '2026-09-28T11:30' });
  assert.equal(out.row.watched, true);
  assert.equal(out.row.version, '2026-09-28T11:30:00+05:30', 'the one write\'s Modified_Time');
  const [coql, users, put, ...rest] = r.calls;
  assert.match(coql.body.select_query, /Handed_By, Handed_At, Modified_Time from Cases where id = '554023000000500114'/);
  assert.equal(users.query.get('type'), 'ActiveUsers');
  assert.equal(put.path, `/Cases/${CASE}`);
  // W2-KAM-6: the owner and the watcher move together or not at all; user lookups are { id }.
  assert.deepEqual(put.body, { data: [{ Owner: { id: MEENA }, Handed_By: { id: IMRAN }, Handed_At: '2026-09-28T11:30:00+05:30' }] });
  assert.equal(put.headers['if-unmodified-since'], '2026-09-27T10:00:00+05:30', 'guarded write (D44)');
  assert.deepEqual(rest.map((c) => [c.method, c.path]), [['POST', '/coql']], 'no second write (no actions/change_owner); one read-back (W3-KAM-3)');
  assert.match(rest[0].body.select_query, /from Cases where id = '554023000000500114'/);
  for (const c of r.calls) assert.equal(c.headers.authorization, `Zoho-oauthtoken synthetic-${IMRAN}-never-live`, 'D53: his own token');
  assert.doesNotMatch(JSON.stringify(r.sink.records()), /Test User|example\.invalid|payouts/, 'Plane B holds ids and codes only');
});

test('with no Finance Operations the ticket goes to the Head of Finance; with nobody in Finance nothing is written', async () => {
  const a = await rig({ users: 'users.active.no-ops', after: 'coql.case.hand-after-handed-hof' });
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
  assert.equal(b.writes().length, 1, 'Zoho\'s 412 refuses the one write: the owner does not move');
});

/* W2-KAM-6: staging answered the KAM's owner change with a per-record NO_PERMISSION inside a 400 (our invalid-data),
 * after Handed_By had been written by a first PUT — half-written, and "Zoho is not answering" on screen. */
test('W2-KAM-6: Zoho refuses the owner change — said as a refusal, and nothing is half-written (one write, refused whole)', async () => {
  const r = await rig({ put: 'update.case.owner-no-permission' });
  const out = await r.svc.handToFinance({ credential: await r.cred(IMRAN), seat: 'kam' }, CASE);
  assert.deepEqual([out.ok, out.kind, out.reason], [false, 'refused', 'owner-change-refused']);
  assert.equal(out.message, HAND_TEXT['owner-change-refused']);
  assert.match(out.message, /Nothing was changed — it is still yours/);
  assert.doesNotMatch(out.message, /not answering/);
  assert.deepEqual(r.writes().map((c) => c.path), [`/Cases/${CASE}`], 'one write; no change_owner after a written watcher');
  assert.ok(r.sink.records().some((l) => l.kind === 'refusal' && l.reason === 'owner-change-refused'), 'a Plane B line, ids and codes only');
  const owner = await rig({ put: 'update.case.owner-invalid' });
  const o = await owner.svc.handToFinance({ credential: await owner.cred(IMRAN), seat: 'kam' }, CASE);
  assert.equal(o.reason, 'owner-change-refused', 'Zoho naming the Owner field is the same refusal');
});

test('W2-KAM-6: Zoho refusing a hand-over field (Handed_By missing or hidden) is a refusal too, never "Zoho is not answering"', async () => {
  const r = await rig({ put: 'update.case.handed-by-invalid' });
  const out = await r.svc.handToFinance({ credential: await r.cred(IMRAN), seat: 'kam' }, CASE);
  assert.deepEqual([out.ok, out.kind, out.reason], [false, 'refused', 'handover-refused']);
  assert.equal(r.writes().length, 1);
});

test('W2-KAM-6: a ticket left half-written by the old two-step (Handed_By = me, still mine) is handed on whole by the next press', async () => {
  const r = await rig({ caseFx: 'coql.case.hand-half-written' });
  const out = await r.svc.handToFinance({ credential: await r.cred(IMRAN), seat: 'kam' }, CASE);
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.already, false);
  assert.deepEqual(r.writes()[0].body.data[0].Owner, { id: MEENA });
});

/* W3-KAM-3 (9 Oct): Zoho answered the one PUT SUCCESS and silently kept the KAM as owner (no Change Owner on the
 * profile); the server answered 200 "Finance has it" from what it had sent. Success is now what Zoho holds afterwards. */
test('W3-KAM-3: Owner silently dropped by Zoho — 403 owner-change-refused, the stored Handed_By/Handed_At taken back, guarded', async () => {
  const r = await rig({ after: 'coql.case.hand-after-owner-dropped' });
  const out = await r.svc.handToFinance({ credential: await r.cred(IMRAN), seat: 'kam' }, CASE, '2026-09-27T10:00:00+05:30');
  assert.deepEqual([out.ok, out.kind, out.reason], [false, 'refused', 'owner-change-refused'], JSON.stringify(out));
  assert.match(out.message, /Nothing was changed — it is still yours/);
  const w = r.writes();
  assert.equal(w.length, 2, 'the hand-over, then its take-back');
  assert.deepEqual(w[1].body, { data: [{ Handed_By: null, Handed_At: null }] });
  assert.equal(w[1].headers['if-unmodified-since'], '2026-09-28T11:30:00+05:30', 'guarded by the version just read back');
  assert.ok(r.sink.records().some((l) => l.kind === 'refusal' && l.reason === 'owner-change-refused'));
});
test('W3-KAM-3: Owner and the hand-over fields all dropped — refused, nothing to take back (no second write)', async () => {
  const r = await rig({ after: 'coql.case.hand-after-all-dropped' });
  const out = await r.svc.handToFinance({ credential: await r.cred(IMRAN), seat: 'kam' }, CASE);
  assert.equal(out.reason, 'owner-change-refused');
  assert.equal(r.writes().length, 1);
});
test('W3-KAM-3: the take-back itself refused (a newer change) — said as owner-change-half, never success', async () => {
  const r = await rig({ after: 'coql.case.hand-after-owner-dropped', undo: 'conflict' });
  const out = await r.svc.handToFinance({ credential: await r.cred(IMRAN), seat: 'kam' }, CASE);
  assert.deepEqual([out.ok, out.reason], [false, 'owner-change-half']);
  assert.match(out.message, /still yours/);
});
test('W3-KAM-3: success is the read-back row (Zoho\'s owner, marker and version); a ticket gone from sight moved owner — success, not watched', async () => {
  const r = await rig();
  const out = await r.svc.handToFinance({ credential: await r.cred(IMRAN), seat: 'kam' }, CASE);
  assert.deepEqual([out.ok, out.row.own, out.row.handed.by, out.row.version, out.row.watched], [true, MEENA, IMRAN, '2026-09-28T11:30:00+05:30', true]);
  const g = await rig({ after: 'empty' });
  const gone = await g.svc.handToFinance({ credential: await g.cred(IMRAN), seat: 'kam' }, CASE);
  assert.deepEqual([gone.ok, gone.row.own, gone.row.watched], [true, MEENA, false]);
  const fail = await rig({ after: 'coql.case.403' });
  const f = await fail.svc.handToFinance({ credential: await fail.cred(IMRAN), seat: 'kam' }, CASE);
  assert.equal(f.ok, false, 'an unreadable answer is never reported as success');
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
