/* THE GATES, COVER AND THE SEARCH WALL (M08-S02-T01, M08-S05-T01, M06-S05-T01/T02)
 *
 * Run from console/: node --test src/server/leads/wall.test.cjs
 *
 * Compiles the three modules with the project's TypeScript and drives them through the real Zoho client
 * against sanitized recorded responses (lib/zoho/__fixtures__/{gates,cover,search}). No request reaches
 * Zoho; every id, name and number is synthetic.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { before, test } = require('node:test');

const consoleRoot = path.resolve(__dirname, '..', '..', '..');
const srcRoot = path.join(consoleRoot, 'src');
const fixtures = path.join(srcRoot, 'lib', 'zoho', '__fixtures__');
const ts = require(path.join(consoleRoot, 'node_modules', 'typescript'));
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoho-lead-wall-'));
process.on('exit', () => fs.rmSync(outDir, { recursive: true, force: true }));

const config = ts.readConfigFile(path.join(consoleRoot, 'tsconfig.json'), ts.sys.readFile);
const project = ts.parseJsonConfigFileContent(config.config, ts.sys, consoleRoot);
const options = { ...project.options, incremental: false, tsBuildInfoFile: undefined, plugins: undefined,
  module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10, noEmit: false, noEmitOnError: true, outDir, rootDir: srcRoot };
const sources = ['lib/zoho/log.ts', 'lib/zoho/client.ts', 'lib/zoho/cache.ts', 'lib/zoho/cover-window-share.ts', 'server/identity/plane-c.ts',
  'server/leads/cover.ts', 'server/leads/gates.ts', 'server/leads/search.ts'].map((f) => path.join(srcRoot, f));
const program = ts.createProgram(sources, options);
const diagnostics = [...ts.getPreEmitDiagnostics(program), ...program.emit().diagnostics];
if (diagnostics.length) {
  console.error(ts.formatDiagnostics(diagnostics, { getCanonicalFileName: (f) => f, getCurrentDirectory: () => consoleRoot, getNewLine: () => '\n' }));
  process.exit(1);
}
const load = (f) => require(path.join(outDir, f));
const { createMemorySink, createOpsLog } = load('lib/zoho/log.js');
const { createZohoClient, createZohoServiceClient, userCredential, serviceCredential } = load('lib/zoho/client.js');
const { runCoverWindowShare } = load('lib/zoho/cover-window-share.js');
const { createPlaneCLog, createPlaneCMemorySink } = load('server/identity/plane-c.js');
const { createCover, sweepExpiredCovers, activeFor, activeClause } = load('server/leads/cover.js');
const { createGates, GATE_TEXT } = load('server/leads/gates.js');
const { createLeadSearch, searchRequestOf } = load('server/leads/search.js');

const P = '9007199254';
const IR = `${P}740995001`, MANAGER = `${P}740995002`, SEC = `${P}740995005`, SUPER = `${P}740995007`, OTHER = `${P}740995009`;
const L_BAL = `${P}740996301`, L_YES = `${P}740996302`, L_COV = `${P}740996303`, L_OTHER = `${P}740996304`, L_EXP = `${P}740996305`;
const A1 = `${P}740994001`, A9 = `${P}740994009`;
const SESSION = 'session_fixture_wall_0001';
const NOW = Date.parse('2026-09-27T15:30:00Z'); // 21:00 IST, 27 Sep
const MT = '2026-09-27T20:00:00+05:30';

const recorded = (area, name) => JSON.parse(fs.readFileSync(path.join(fixtures, area, `${name}.response.json`), 'utf8'));
const toResponse = (r) => new Response(r.status === 204 ? null : JSON.stringify(r.body), { status: r.status, headers: r.headers || {} });
const immediateGate = () => ({ async acquire() { return { waitedMs: 0, release() {} }; } });

const credentials = new Map();
before(async () => {
  for (const [id, name] of [[IR, 'ir'], [MANAGER, 'manager'], [SEC, 'secondary'], [SUPER, 'super'], [OTHER, 'other']]) {
    credentials.set(id, await userCredential(
      { access_token: `synthetic-${name}-token-never-live`, api_domain: 'https://www.zohoapis.in', expires_in: 3_600 },
      { recordIdPrefix: P, gate: immediateGate(), log: createOpsLog(createMemorySink()), clock: () => NOW,
        fetch: async () => toResponse(recorded('gates', `current-user.${name}`)) }));
  }
});
const principal = (id) => ({ credential: credentials.get(id), sessionId: SESSION });

/** LeadsAccess as the session layer derives it. */
const access = (id) => ({ async recheck(cred) {
  const seat = id === MANAGER ? 'ir-manager' : id === SUPER ? 'digital-infrastructure' : 'investor-relations';
  return { actor: { userId: cred.userId, roleId: '', profileId: '', seat }, mayViewLeads: true,
    teamOwnerIds: id === MANAGER ? [IR] : null, teamOrgWide: id === SUPER, unassignedQueueUserId: null, seesUnassignedInPersonal: id !== MANAGER && id !== SUPER };
} });

/** A client on a recorded router: route(call) → fixture [area, name]. Every call is kept. */
function rig(area, route, service = false) {
  const calls = [];
  const sink = createMemorySink();
  const log = createOpsLog(sink);
  const make = service ? createZohoServiceClient : createZohoClient;
  const crm = make({ recordIdPrefix: P, gate: immediateGate(), log, maxAttempts: 1, clock: () => NOW,
    fetch: async (url, init) => {
      const u = new URL(url);
      const body = init.body ? JSON.parse(init.body) : null;
      const call = { method: init.method, path: u.pathname, url: u, query: body && body.select_query, body, headers: init.headers };
      calls.push(call);
      const r = route(call);
      return toResponse(recorded(area, r));
    } });
  return { crm, calls, sink, log };
}
const noWrites = (calls) => calls.every((c) => c.method === 'GET' || (c.method === 'POST' && c.path === '/crm/v8/coql'));

/* ================= M08-S02 — gates ================= */

function gatesRoute(lead, receipts = 'receipts.balance-reported') {
  return (c) => {
    if (c.method === 'GET' && c.path.startsWith('/crm/v8/Leads/')) return lead;
    if (c.query && c.query.includes('from Contacts')) return lead === 'lead.said-yes' ? 'contacts.said-yes' : 'contacts.balance';
    if (c.query && c.query.includes('from LLP_UnitAllocation_Module')) return lead === 'lead.said-yes' ? 'allotments.said-yes' : 'allotments.balance';
    if (c.query && c.query.includes('from Receipts')) return receipts;
    throw new Error(`unrouted ${c.method} ${c.path}`);
  };
}
const gates = (r, who) => createGates({ crm: r.crm, access: access(who), log: r.log, recordIdPrefix: P, clock: () => NOW });

test('TC-E08-007/024: a reported balance waits on Finance — no Mark done, read-only, nothing written', async () => {
  const r = rig('gates', gatesRoute('lead.balance-reported'));
  const res = await gates(r, IR).read(principal(IR), L_BAL);
  assert.equal(res.ok, true);
  const v = res.value;
  assert.equal(v.done, 6, 'Reserved — 10% in · step 6 of 9');
  assert.equal(v.gate, 'balance');
  assert.equal(v.met, false);
  assert.equal(v.who, 'fin', 'waiting on Finance is honest: the IR has reported it');
  assert.equal(v.says, GATE_TEXT.balance.wait);
  assert.deepEqual(v.payment, { status: 'Partial', reported: true, notFound: false, matchedRupees: 100000, dueRupees: 900000 });
  assert.equal(v.holdUntil, '2026-10-02');
  assert.equal(v.doer, 'finance');
  assert.equal(v.mayConfirm, false);
  assert.ok(noWrites(r.calls), 'no IR path writes a gate field');
  const receipts = r.calls.find((c) => c.query && c.query.includes('from Receipts')).query;
  assert.ok(receipts.includes(`'${A1}'`) && !receipts.includes(A9), 'a Cancelled allotment carries no money');
  assert.match(r.calls.find((c) => c.query && c.query.includes('from Contacts')).query, new RegExp(`where Origin_Lead = '${L_BAL}'`));
});

test('TC-E08-010: once Finance matches the balance the gate has cleared, read live', async () => {
  const r = rig('gates', gatesRoute('lead.balance-reported', 'receipts.balance-matched'));
  const v = (await gates(r, IR).read(principal(IR), L_BAL)).value;
  assert.equal(v.met, true);
  assert.equal(v.who, null);
  assert.equal(v.says, null);
  assert.equal(v.payment.status, 'Full');
  assert.equal(v.payment.dueRupees, 0);
});

test('TC-E08-009: said yes with no payment and no report — it is the IR\'s move, not Finance\'s', async () => {
  const r = rig('gates', gatesRoute('lead.said-yes', 'empty'));
  const v = (await gates(r, IR).read(principal(IR), L_YES)).value;
  assert.equal(v.done, 5);
  assert.equal(v.gate, 'advance');
  assert.equal(v.met, false);
  assert.equal(v.who, 'ir');
  assert.equal(v.says, GATE_TEXT.advance.chase);
  assert.equal(v.payment.status, 'Yet to initiate');
});

test('before "said yes" nothing of Finance\'s is read', async () => {
  const r = rig('gates', gatesRoute('lead.early'));
  const v = (await gates(r, IR).read(principal(IR), L_COV)).value;
  assert.equal(v.gate, null);
  assert.equal(v.payment, null);
  assert.equal(r.calls.length, 1);
});

test('TC-E08-024: the IR Manager reads a team lead\'s payment; no seat is offered confirm or reject', async () => {
  const r = rig('gates', gatesRoute('lead.balance-reported'));
  const v = (await gates(r, MANAGER).read(principal(MANAGER), L_BAL)).value;
  assert.equal(v.payment.reported, true);
  assert.equal(v.mayConfirm, false);
  assert.equal(v.superUser, false);
  assert.ok(noWrites(r.calls));
});

test('the super user sees the gate state, Finance named as the doer, with the super-user mark', async () => {
  const r = rig('gates', gatesRoute('lead.balance-reported'));
  const v = (await gates(r, SUPER).read(principal(SUPER), L_BAL)).value;
  assert.equal(v.who, 'fin');
  assert.equal(v.doer, 'finance');
  assert.equal(v.superUser, true);
  assert.equal(v.mayConfirm, false);
});

test('another IR\'s lead, or a lead naming me only as a dormant secondary, is refused before Finance is read', async () => {
  for (const lead of ['lead.other-ir', 'lead.dormant-secondary']) {
    const r = rig('gates', gatesRoute(lead));
    const res = await gates(r, IR).read(principal(IR), L_OTHER);
    assert.equal(res.reasonCode, 'not-in-book', lead);
    assert.equal(r.calls.length, 1, 'no Contacts, allotments or receipts read');
    assert.deepEqual(r.sink.records().filter((x) => x.kind === 'refusal')[0].recordIds, [L_OTHER]);
  }
});

test('the journey\'s GateReader opens Fully paid only on Finance\'s match', async () => {
  let r = rig('gates', gatesRoute('lead.balance-reported'));
  assert.equal(await gates(r, IR).reader().met(credentials.get(IR), L_BAL, 'balance'), false);
  assert.equal(await gates(r, IR).reader().met(credentials.get(IR), L_BAL, 'advance'), true);
  r = rig('gates', gatesRoute('lead.balance-reported', 'receipts.balance-matched'));
  assert.equal(await gates(r, IR).reader().met(credentials.get(IR), L_BAL, 'balance'), true);
  assert.equal(await gates(r, IR).reader().met(credentials.get(IR), L_BAL, 'alloc'), false, 'the supplementary agreement is not verified');
  r = rig('gates', () => 'source.server-error');
  assert.equal(await gates(r, IR).reader().met(credentials.get(IR), L_BAL, 'balance'), false, 'an unreadable fact keeps the rung shut');
});

test('Zoho failing is a source error, never an open gate', async () => {
  const r = rig('gates', (c) => (c.query ? 'source.server-error' : 'lead.balance-reported'));
  const res = await gates(r, IR).read(principal(IR), L_BAL);
  assert.equal(res.ok, false);
  assert.equal(res.kind, 'source-error');
});

/* ================= M08-S05 — cover ================= */

function coverRig(lead, put = 'lead.updated', shareOk = true) {
  const r = rig('cover', (c) => (c.method === 'GET' ? lead : put));
  const shares = [];
  const planeSink = createPlaneCMemorySink();
  const share = async (windows) => { shares.push(...windows); return windows.map((w) => ({ leadId: w.leadId, state: w.state, ok: shareOk })); };
  const roster = { now: null, async current() { return this.now || { absentOwnerIds: [], covers: [] }; } };
  const make = (who) => createCover({ crm: r.crm, access: access(who), share, log: r.log, planeC: createPlaneCLog(planeSink), recordIdPrefix: P, roster, clock: () => NOW });
  return { ...r, shares, plane: planeSink, roster, make };
}

test('TC-E08-018: the owner hands over for 3 days — the window is written, the share opens, Plane C files the grant', async () => {
  const c = coverRig('lead.handover');
  const res = await c.make(IR).start(principal(IR), L_COV, MT, 'd3');
  assert.equal(res.ok, true);
  assert.deepEqual(res.value, { leadId: L_COV, coverById: SEC, coverUntil: '2026-09-30', modifiedTime: '2026-09-27T21:00:00+05:30', shared: true });
  const put = c.calls.find((x) => x.method === 'PUT');
  assert.equal(put.path, `/crm/v8/Leads/${L_COV}`);
  assert.deepEqual(put.body.data[0], { Cover_By: { id: SEC }, Cover_Until: '2026-09-30' });
  assert.ok(Object.entries(put.headers).some(([k, v]) => /if-unmodified-since/i.test(k) && v), 'a guarded write');
  assert.deepEqual(c.shares, [{ leadId: L_COV, coverUserId: SEC, state: 'open' }]);
  const e = c.plane.events();
  assert.equal(e.length, 1);
  assert.deepEqual({ who: e[0].who, whom: e[0].whom, action: e[0].action, outcome: e[0].outcome, reason: e[0].reason, recordIds: e[0].recordIds },
    { who: IR, whom: SEC, action: 'grant-change', outcome: 'ok', reason: 'cover-open-d3', recordIds: [L_COV] });
});

test('TC-E08-019: a dormant secondary cannot start cover on a healthy owner\'s lead — nothing changes', async () => {
  const c = coverRig('lead.handover');
  const res = await c.make(SEC).start(principal(SEC), L_COV, MT, 'd3');
  assert.equal(res.reasonCode, 'not-yours-to-cover');
  assert.equal(c.calls.filter((x) => x.method !== 'GET').length, 0, 'no write');
  assert.equal(c.shares.length, 0, 'no record share');
  const e = c.plane.events();
  assert.equal(e[0].action, 'refused-action');
  assert.equal(e[0].reason, 'cover-start');
});

test('a secondary may start cover while the roster has the owner away; a manager over the owner may too', async () => {
  let c = coverRig('lead.handover');
  c.roster.now = { absentOwnerIds: [IR], covers: [] };
  assert.equal((await c.make(SEC).start(principal(SEC), L_COV, MT, 'today')).value.coverUntil, '2026-09-28');
  c = coverRig('lead.handover');
  assert.equal((await c.make(MANAGER).start(principal(MANAGER), L_COV, MT, 'w1')).ok, true);
  c = coverRig('lead.handover');
  assert.equal((await c.make(OTHER).start(principal(OTHER), L_COV, MT, 'w1')).reasonCode, 'not-yours-to-cover');
});

test('TC-E08-025: ending the cover clears the window, revokes the share and files the end', async () => {
  const c = coverRig('lead.covering');
  const res = await c.make(SEC).end(principal(SEC), L_COV, MT);
  assert.equal(res.ok, true);
  assert.deepEqual(c.calls.find((x) => x.method === 'PUT').body.data[0], { Cover_By: null, Cover_Until: null });
  assert.deepEqual(c.shares, [{ leadId: L_COV, coverUserId: SEC, state: 'closed' }]);
  const e = c.plane.events()[0];
  assert.equal(e.outcome, 'ended');
  assert.equal(e.whom, SEC);
  const o = coverRig('lead.covering');
  assert.equal((await o.make(OTHER).end(principal(OTHER), L_COV, MT)).reasonCode, 'not-yours-to-end');
  assert.equal(o.shares.length, 0);
  const n = coverRig('lead.handover');
  assert.equal((await n.make(IR).end(principal(IR), L_COV, MT)).reasonCode, 'no-cover');
});

test('a lead changed in Zoho is refused and nothing is shared; a share that fails leaves the window marked unshared', async () => {
  let c = coverRig('lead.handover', 'lead.conflict');
  assert.equal((await c.make(IR).start(principal(IR), L_COV, MT, 'd3')).reasonCode, 'lead-changed');
  assert.equal(c.shares.length, 0);
  c = coverRig('lead.handover', 'lead.updated', false);
  const res = await c.make(IR).start(principal(IR), L_COV, MT, 'd3');
  assert.equal(res.value.shared, false);
  assert.ok(c.sink.records().some((x) => x.kind === 'refusal' && x.reason === 'share-pending'));
  c = coverRig('lead.no-secondary');
  assert.equal((await c.make(IR).start(principal(IR), L_COV, MT, 'd3')).reasonCode, 'no-secondary');
  c = coverRig('lead.handover');
  assert.equal((await c.make(IR).start(principal(IR), L_COV, MT, 'forever')).reasonCode, 'invalid-request');
  assert.equal(c.calls.filter((x) => x.method !== 'GET').length, 0);
});

test('expiry: the sweep revokes each expired window, then clears it, on the cover-window-share job', async () => {
  const r = rig('cover', (c) => (c.path === '/crm/v8/coql' ? 'coql.expired' : c.method === 'DELETE' ? 'unshare.success' : 'lead.updated'), true);
  const as = serviceCredential('cover-window-share', { access_token: 'svc', api_domain: 'https://www.zohoapis.in', expires_in: 3600, token_type: 'Bearer' }, NOW);
  const plane = createPlaneCMemorySink();
  const res = await sweepExpiredCovers(r.crm, as, createPlaneCLog(plane), P, () => NOW);
  assert.deepEqual(res, { ok: true, closed: [L_EXP], failed: [] });
  assert.match(r.calls[0].query, /where \(Cover_By is not null and Cover_Until < '2026-09-27'\)/);
  assert.deepEqual(r.calls.slice(1).map((c) => [c.method, c.path]), [['DELETE', `/crm/v8/Leads/${L_EXP}/actions/share`], ['PUT', `/crm/v8/Leads/${L_EXP}`]]);
  assert.equal(plane.events()[0].reason, 'cover-expired');
  // The existing share job (lib/zoho/cover-window-share) is what the runtime calls on open and close.
  const s = rig('cover', () => 'share.success', true);
  assert.deepEqual(await runCoverWindowShare(s.crm, as, [{ leadId: L_COV, coverUserId: SEC, state: 'open' }]), [{ leadId: L_COV, state: 'open', ok: true }]);
});

test('D44 predicate: a named secondary is dormant; an explicit window admits only its recipient and never falls back', () => {
  const lead = (x) => ({ id: L_COV, Owner: { id: IR }, Secondary_Owner: { id: SEC }, Cover_By: null, Cover_Until: null, ...x });
  const away = { absentOwnerIds: [IR], covers: [] };
  assert.equal(activeFor(lead(), SEC, '2026-09-27'), null, 'healthy owner, no cover');
  assert.equal(activeFor(lead(), SEC, '2026-09-27', away), 'roster');
  assert.equal(activeFor(lead({ Cover_By: { id: SEC }, Cover_Until: '2026-09-27' }), SEC, '2026-09-27'), 'cover', 'the last day counts');
  assert.equal(activeFor(lead({ Cover_By: { id: SEC }, Cover_Until: '2026-09-26' }), SEC, '2026-09-27', away), null, 'expired window: no roster fallback');
  assert.equal(activeFor(lead({ Cover_By: { id: OTHER }, Cover_Until: '2026-09-30' }), SEC, '2026-09-27', away), null, 'another recipient');
  // TC-E08-020: a roster cover works the away owner's leads, and nobody else's.
  const roster = { absentOwnerIds: [IR], covers: [{ ownerId: IR, coverById: OTHER }] };
  assert.equal(activeFor(lead({ Secondary_Owner: null }), OTHER, '2026-09-27', roster), 'roster');
  assert.equal(activeFor({ ...lead(), Owner: { id: MANAGER } }, OTHER, '2026-09-27', roster), null);
  assert.equal(activeClause(SEC, '2026-09-27'), `(Cover_By = '${SEC}' and Cover_Until >= '2026-09-27')`);
});

/* ================= M06-S05 — the search wall ================= */

test('the route accepts a word or a phone only: another module is refused, an owner filter is ignored', () => {
  assert.deepEqual(searchRequestOf(new URLSearchParams('q=Wall')), { ok: true, term: 'Wall' });
  assert.deepEqual(searchRequestOf(new URLSearchParams('q=Wall&module=Contacts')), { ok: false, reasonCode: 'module-refused' });
  assert.deepEqual(searchRequestOf(new URLSearchParams('module=Accounts&q=Wall')), { ok: false, reasonCode: 'module-refused' });
  assert.deepEqual(searchRequestOf(new URLSearchParams(`q=Wall&owner=${OTHER}`)), { ok: true, term: 'Wall' });
  assert.deepEqual(searchRequestOf(new URLSearchParams('q=Wall&module=Leads')), { ok: true, term: 'Wall' });
  for (const bad of ['q=Wall&criteria=(Owner:equals:1)', 'q=Wall&email=x', 'q=a&q=b', 'word=Wall', ''])
    assert.equal(searchRequestOf(new URLSearchParams(bad)).ok, false, bad);
});

function searchRig(who, withCache = true) {
  const r = rig('search', () => 'search.wall');
  const keys = [];
  const cache = { async readSettled(key, load) { const value = await load(); keys.push({ key, value }); return { kind: 'fresh', value }; } };
  const svc = createLeadSearch({ crm: r.crm, access: access(who), log: r.log, recordIdPrefix: P, clock: () => NOW,
    ...(withCache ? { cache, termKey: (t) => `k${t.length}` } : {}) });
  return { ...r, svc, keys };
}

test('an IR finds only their own book on Leads; one Plane B line holds searcher, count and scope, never the term', async () => {
  const s = searchRig(IR);
  const res = await s.svc.find(principal(IR), 'Wall');
  assert.deepEqual(res.value.hits.map((h) => h.id.slice(-2)), ['01', '05']);
  assert.equal(res.value.book, 'yours');
  assert.deepEqual(s.calls.map((c) => c.path), ['/crm/v8/Leads/search'], 'Leads only, never Contacts');
  const done = s.sink.records().filter((x) => x.kind === 'refusal' && x.action === 'lead-search.done');
  assert.equal(done.length, 1);
  assert.deepEqual({ who: done[0].actor.userId, reason: done[0].reason, ids: done[0].recordIds }, { who: IR, reason: 'scope-yours.count-2', ids: [] });
  const logged = JSON.stringify(s.sink.records());
  assert.ok(!/Wall|Synthetic|9000010/.test(logged), 'no search text, name or number in Plane B');
});

test('TC-E08-017: the dormant secondary is not offered the lead; a live cover is', async () => {
  const s = searchRig(SEC);
  const res = await s.svc.find(principal(SEC), 'Wall');
  assert.deepEqual(res.value.hits.map((h) => h.id.slice(-2)), ['03'], '02 dormant, 05 covered by someone else');
});

test('the cache holds the in-book count only, keyed by the caller\'s scope and a hash of the term', async () => {
  let s = searchRig(IR);
  await s.svc.find(principal(IR), 'Wall');
  assert.equal(s.keys.length, 1);
  assert.deepEqual(s.keys[0].key.scope, { kind: 'user', userId: IR });
  assert.equal(s.keys[0].value, 2);
  assert.ok(s.keys[0].key.name.startsWith('user.leads.search.') && !s.keys[0].key.name.includes('Wall'));
  s = searchRig(MANAGER);
  await s.svc.find(principal(MANAGER), 'Wall');
  assert.deepEqual(s.keys[0].key.scope, { kind: 'subtree', managerId: MANAGER });
  s = searchRig(SUPER);
  await s.svc.find(principal(SUPER), 'Wall');
  assert.deepEqual(s.keys[0].key.scope, { kind: 'role', role: 'all' });
});
