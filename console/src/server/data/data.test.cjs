/* M01-S03 LIVE DATA LAYER — scope keys, projections, aggregate-only cache, Plane B/C, empty fallback.
 *
 * Run from console/: node --test src/server/data/data.test.cjs
 *
 * Compiles the production modules with the project's strict settings and replays sanitized recorded
 * Zoho responses (src/lib/zoho/__fixtures__/data and kam-book). No request reaches Zoho.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { before, test } = require('node:test');

const consoleRoot = path.resolve(__dirname, '..', '..', '..');
const srcRoot = path.join(consoleRoot, 'src');
const fx = path.join(srcRoot, 'lib', 'zoho', '__fixtures__');
const ts = require(path.join(consoleRoot, 'node_modules', 'typescript'));
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoho-data-'));
process.on('exit', () => fs.rmSync(outDir, { recursive: true, force: true }));

const config = ts.readConfigFile(path.join(consoleRoot, 'tsconfig.json'), ts.sys.readFile);
const project = ts.parseJsonConfigFileContent(config.config, ts.sys, consoleRoot);
const options = {
  ...project.options, incremental: false, tsBuildInfoFile: undefined, plugins: undefined,
  module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10,
  noEmit: false, noEmitOnError: true, outDir, rootDir: srcRoot,
};
const sources = ['server/data/scope.ts', 'server/data/projections.ts', 'server/data/events.ts', 'server/data/adapters.ts',
  'server/data/live.ts', 'server/data/zoho-source.ts'].map((f) => path.join(srcRoot, f));
const program = ts.createProgram(sources, options);
const diagnostics = [...ts.getPreEmitDiagnostics(program), ...program.emit().diagnostics];
if (diagnostics.length) {
  console.error(ts.formatDiagnostics(diagnostics, { getCanonicalFileName: (f) => f, getCurrentDirectory: () => consoleRoot, getNewLine: () => '\n' }));
  process.exit(1);
}
const Module = require('node:module');
process.env.NODE_PATH = path.join(consoleRoot, 'node_modules');
Module._initPaths();
const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  return resolveFilename.call(this, request.startsWith('@/') ? path.join(outDir, request.slice(2)) : request, ...rest);
};
const load = (f) => require(path.join(outDir, f));
const { createMemorySink, createOpsLog } = load('lib/zoho/log.js');
const { createZohoClient, userCredential } = load('lib/zoho/client.js');
const { createScopedCache, createMemoryStore, cacheKey } = load('lib/zoho/cache.js');
const { createGate } = load('lib/zoho/gate.js');
const { createPlaneCLog, createPlaneCMemorySink } = load('server/identity/plane-c.js');
const { scopesFor, scopedKey, scopedKeyString, cacheScopeOf } = load('server/data/scope.js');
const { PROJECTIONS, checkProjection, isForbiddenField } = load('server/data/projections.js');
const { createInvestorEvents, conflictOf } = load('server/data/events.js');
const { createLiveDataLayer } = load('server/data/live.js');
const { loadLiveDataset, mustFail, dataRuntime } = load('server/data/zoho-source.js');

const P = '9007199254';
const IR = `${P}740995001`;          // Rohit (IR)
const MANAGER = `${P}740995002`;     // Tasneem (IR Manager)
const FIN = `${P}740993001`;         // Finance
const KAM = `${P}740994001`;         // Imran (KAM) — the kam-book fixtures' user
const DIVYA = `${P}740994009`;       // Head of AM
const SID = 'sid_fixture_data_layer_00000000000000000';
const NOW = Date.parse('2026-09-28T06:00:00Z');
const SEAT_IDS = { roleIds: { 'Key Account Manager': `${P}740998001`, 'Investor Relations': `${P}740998003` }, profileIds: { KAM: `${P}740998002`, IR: `${P}740998004` } };

const recorded = (dir, name) => JSON.parse(fs.readFileSync(path.join(fx, dir, `${name}.response.json`), 'utf8'));
const toResponse = (r) => new Response(r.status === 204 ? null : JSON.stringify(r.body), { status: r.status, headers: r.headers || {} });
const immediateGate = () => ({ async acquire() { return { waitedMs: 0, release() {} }; }, async run(_c, t) { return t(); }, snapshot() { return {}; } });
const creds = new Map();
before(async () => {
  for (const id of [IR, MANAGER, FIN, KAM, DIVYA]) creds.set(id, await userCredential({ access_token: `synthetic-${id}`, api_domain: 'https://www.zohoapis.in', expires_in: 3_600 },
    { recordIdPrefix: P, gate: immediateGate(), log: createOpsLog(createMemorySink()), clock: () => NOW,
      fetch: async () => toResponse({ status: 200, body: { users: [{ id, status: 'active' }] } }) }));
});

/** Routes a COQL query to a recorded answer. */
function route(q, over = {}) {
  if (/COUNT\(id\)/.test(q)) return recorded('data', over.count || (/from Contacts/.test(q) ? 'agg.count-4' : 'agg.count-9'));
  if (/from Leads where id in/.test(q)) return recorded('data', 'coql.leads-detail');
  if (/from Leads/.test(q)) return recorded('data', over.leads ? over.leads(q) : /Owner in|id is not null/.test(q) ? 'coql.leads-team' : q.includes(`Owner = '${IR}'`) ? 'coql.leads-personal' : 'coql.none');
  if (/from Contacts/.test(q)) {
    if (/where KAM = /.test(q) || /from Contacts where id in/.test(q)) return recorded('kam-book', 'coql.contacts.imran');
    return recorded('data', over.contacts || (/where \(Originating_IR/.test(q) ? 'coql.contacts.own-lead' : 'coql.contacts.org'));
  }
  if (/from LLP_UnitAllocation_Module/.test(q)) {
    if (/Customer in \('9007199254740994/.test(q)) return /LLP,/.test(q) ? recorded('data', 'coql.allotments.own-book') : recorded('kam-book', 'coql.allotments.imran');
    return recorded('data', /Customer in/.test(q) ? 'coql.allotments.own-lead' : 'coql.allotments');
  }
  if (/from LLP_Creation_Module/.test(q)) return recorded('data', 'coql.llps');
  if (/from Receipts where \(Allotment in \('9007199254740996/.test(q)) return recorded('data', 'coql.none');
  if (/from Receipts/.test(q)) return recorded('data', /Allotment in/.test(q) ? 'coql.receipts.own-lead' : 'coql.receipts');
  if (/from Cases where \(Related_To in \('9007199254740994/.test(q)) return recorded('data', 'coql.none');
  if (/from Cases/.test(q)) return recorded('data', 'coql.cases');
  if (/from ARL_Holdings/.test(q)) return recorded('data', 'coql.holdings');
  if (/from ARL_Transactions/.test(q)) return recorded('data', 'coql.arl-transactions');
  throw new Error('unrouted query: ' + q);
}

function rig({ seatOf = {}, over = {}, cache, gate } = {}) {
  const queries = [];
  const sink = createMemorySink();
  const log = createOpsLog(sink);
  const cSink = createPlaneCMemorySink();
  const planeC = createPlaneCLog(cSink);
  const events = createInvestorEvents({ log, planeC, clock: () => NOW });
  const theGate = gate || immediateGate();
  const crm = createZohoClient({ recordIdPrefix: P, gate: theGate, log, maxAttempts: 1, clock: () => NOW,
    fetch: async (url, init) => { const q = JSON.parse(init.body).select_query; queries.push(q); return toResponse(route(q, over)); } });
  const seats = { [IR]: 'ir', [MANAGER]: 'conv', [FIN]: 'fin', [KAM]: 'kam', [DIVYA]: 'amlead', ...seatOf };
  const theCache = cache || createScopedCache({ clock: () => NOW });
  const layer = createLiveDataLayer({ crm, cache: theCache, log, events, recordIdPrefix: P, seatIds: SEAT_IDS, clock: () => NOW,
    recheck: async (sid) => { const who = [...creds.keys()].find((k) => seats[k] && sid === SID + k.slice(-6)); return who ? { credential: creds.get(who), session: { who, seat: seats[who] } } : null; } });
  return { layer, queries, sink, cSink, events, cache: theCache };
}
const principal = (id, seat) => ({ credential: creds.get(id), session: { who: id, seat }, sessionId: SID + id.slice(-6) });

/* ---------------- T03 scope keys ---------------- */

test('every seat gets one scope per book, and the keys name it', () => {
  assert.equal(scopedKeyString(scopesFor('ir', IR).leads, 'leads.count'), `user:${IR}|user.leads.count`);
  assert.equal(scopedKeyString(scopesFor('conv', MANAGER).leads, 'leads.count'), `subtree:${MANAGER}|subtree.leads.count`);
  assert.equal(scopedKeyString(scopesFor('ir', IR).investors, 'investors.count'), `user:${IR}|own-lead.investors.count`);
  assert.equal(scopedKeyString(scopesFor('kam', KAM).investors, 'investors.count'), `user:${KAM}|own-book.investors.count`);
  assert.equal(scopedKeyString(scopesFor('fin', FIN).investors, 'investors.count'), 'role:org|org.investors.count');
  assert.equal(scopedKeyString(scopesFor('head', FIN).investors, 'investors.count'), 'role:org|org.investors.count');
  assert.equal(scopedKeyString(scopesFor('exec', FIN).investors, 'investors.count'), 'role:org|org.investors.count');
  assert.equal(scopedKeyString(scopesFor('amlead', DIVYA).investors, 'investors.count'), `subtree:${DIVYA}|subtree.investors.count`);
  assert.equal(scopedKeyString(scopesFor('ops', FIN).investors, 'investors.count'), 'role:all|all.investors.count');
  assert.equal(scopesFor('kam', KAM).leads.kind, 'none');
  assert.equal(scopesFor('ir', IR).holdings.kind, 'none');
});

test('an unknown seat or a malformed id has no book, and no key can be minted for none', () => {
  for (const s of Object.values(scopesFor('stranger', IR))) assert.equal(s.kind, 'none');
  for (const s of Object.values(scopesFor('ir', 'rohit'))) assert.equal(s.kind, 'none');
  assert.throws(() => scopedKey({ kind: 'none' }, 'leads.count'), /no cache key/);
  assert.throws(() => cacheKey({ kind: 'global' }, 'x'), /visibility scope/);
  assert.deepEqual(cacheScopeOf({ kind: 'own-lead', userId: IR }), { kind: 'user', userId: IR });
});

test('TC-E01-007: Rohit\'s badge and Tasneem\'s team count for the same query name never share a key', async () => {
  const store = createMemoryStore({ clock: () => NOW });
  const cache = createScopedCache({ store, clock: () => NOW });
  const r = rig({ cache });
  const rohit = await r.layer.count(principal(IR, 'ir'), 'leads');
  const tasneem = await r.layer.count(principal(MANAGER, 'conv'), 'leads');
  assert.equal(rohit.state, 'fresh');
  assert.equal(tasneem.state, 'fresh');
  const keys = [...(await store.keys())].sort();
  assert.deepEqual(keys, [`subtree:${MANAGER}|subtree.leads.count`, `user:${IR}|user.leads.count`]);
  assert.equal(r.queries.filter((q) => /COUNT/.test(q)).length, 2, 'the second read did not reuse the first scope');
});

test('TC-IM01-018: a KAM\'s cached investor count is never served to Finance, and back again', async () => {
  const store = createMemoryStore({ clock: () => NOW });
  const cache = createScopedCache({ store, clock: () => NOW });
  const r = rig({ cache });
  await r.layer.count(principal(KAM, 'kam'), 'investors');
  await r.layer.count(principal(FIN, 'fin'), 'investors');
  const again = await r.layer.count(principal(KAM, 'kam'), 'investors');
  assert.equal(again.origin, 'cache');
  const keys = [...(await store.keys())].sort();
  assert.deepEqual(keys, ['role:org|org.investors.count', `user:${KAM}|own-book.investors.count`]);
  assert.match(r.queries[0], new RegExp(`KAM = '${KAM}'`));
  assert.match(r.queries[1], /where \(id is not null\)/);
});

/* ---------------- T02 projections ---------------- */

test('no projection selects pan, bank_account or any identity field, and one that tries fails at load', () => {
  for (const [mod, fields] of Object.entries(PROJECTIONS)) {
    for (const f of fields) assert.equal(isForbiddenField(f), false, `${mod}.${f}`);
    assert.ok(!fields.some((f) => /pan|bank|aadhaar|ifsc|isfc/i.test(f)), mod);
  }
  for (const f of ['pan', 'bank_account', 'PAN_Number', 'Bank_Account_Number', 'Aadhaar_Number', 'ISFC_Code', 'PAN', 'KYC']) assert.equal(isForbiddenField(f), true, f);
  assert.throws(() => checkProjection('Contacts', ['id', 'PAN_Number']), /identity fields/);
});

/* ---------------- T01 live reads ---------------- */

test('a signed-in IR\'s Leads come from COQL with the IR\'s own credential through the shared gate', async () => {
  const gate = createGate();
  const r = rig({ gate });
  const res = await r.layer.load(principal(IR, 'ir'));
  assert.deepEqual(res.problems, []);
  const ds = res.ds;
  assert.deepEqual(ds.LEADS.map((l) => l.id), [`${P}740996201`, `${P}740996202`]);
  const a = ds.LEADS[0];
  assert.equal(a.n, 'Synthetic Lead A');
  assert.equal(a.own, IR);
  assert.equal(a.done, 3, 'captured, first touch, qualified');
  assert.equal(a.at.length, 3);
  assert.deepEqual(a.con, { msg: true, email: false, call: true });
  assert.equal(a.nx.t, 'Call back');
  assert.equal(a.nx.d, '2026-09-29');
  assert.equal(a.src, 'Events');
  const b = ds.LEADS[1];
  assert.equal(b.src, 'Other', 'an unknown source reads as Other');
  assert.equal(b.lost.why, 'Went cold — no reply', 'Zoho\'s picklist value maps back to the console\'s reason');
  assert.equal(b.units, 0);
  assert.equal(b.unitsKnown, false);
  assert.match(r.queries[0], new RegExp(`^select .* from Leads where \\(Owner = '${IR}'`));
  assert.match(r.queries[1], /from Leads where \(id in|from Leads where id in/);
  // the IR's own-lead investors (D69)
  assert.deepEqual(ds.im.INV.map((i) => i.id), [`${P}740997101`]);
  assert.ok(r.queries.some((q) => new RegExp(`from Contacts where \\(Originating_IR = '${IR}' and Origin_Lead is not null\\)`).test(q)));
  const snap = gate.snapshot();
  assert.ok(snap.peakInFlight >= 1 && snap.peakInFlight <= 12 && snap.maxInFlight === 12 && snap.maxComplex === 8, JSON.stringify(snap));
  // every Plane B call line is the IR's, with ids and status only
  const lines = r.sink.records();
  assert.ok(lines.length > 0);
  for (const l of lines) {
    if (l.kind !== 'zoho-call') continue;
    assert.deepEqual(l.actor, { kind: 'user', userId: IR });
    assert.deepEqual(Object.keys(l).sort(), ['actor', 'at', 'attempt', 'callClass', 'creditsRemaining', 'durationMs', 'endpoint', 'errorClass', 'gateWaitMs', 'kind', 'method', 'op', 'recordIds', 'status']);
  }
});

test('an IR Manager reads personal and team leads (team under Zoho\'s role hierarchy, PROVISIONAL)', async () => {
  const r = rig();
  const res = await r.layer.load(principal(MANAGER, 'conv'));
  assert.deepEqual(res.problems, []);
  assert.ok(res.ds.LEADS.some((l) => l.id === `${P}740996203`));
  assert.ok(r.queries.some((q) => /from Leads where \(id is not null\)/.test(q)));
  assert.equal(res.ds.im.INV.length, 0, 'an IR Manager has no investor book');
});

test('Finance reads the org book: investors, LLPs, allotments, receipts, cases, holdings and ARL transactions', async () => {
  const r = rig();
  const res = await r.layer.load(principal(FIN, 'fin'));
  assert.deepEqual(res.problems, []);
  const im = res.ds.im;
  assert.equal(res.ds.LEADS.length, 0);
  assert.equal(im.INV.length, 2);
  const one = im.INV.find((i) => i.id === `${P}740997101`);
  assert.equal(one.units, 2);
  assert.deepEqual(one.blocks, { A: 2 });
  assert.equal(one.st, 'allocated');
  assert.equal(one.pan, null);
  assert.deepEqual(one.bank, { acct: '', ifsc: '', name: '', drop: '' });
  assert.equal(im.INV.find((i) => i.id === `${P}740997102`).nri, true);
  assert.equal(im.LLP[0].LLP_Status, 'Draft', 'the org\'s "Darft" reads as Draft');
  // Field names as the org holds them (getFields, 28 Sep 2026): Pet_Unit_Price, Insurance_Provider,
  // Insurance_expiry_date, the "NN%" yield picklist, and the status picklist mapped as the Farms shelf maps it.
  assert.deepEqual([im.LLP[0].Unit_Price, im.LLP[0].Insurer, im.LLP[0].Insured_Till, im.LLP[0].Annual_Rental_Yield], [250000, 'Fixture Insurer', '2027-03-31', 20]);
  assert.deepEqual(im.LLP.map((l) => [l.LLP_Status, l.farmStatus]), [['Draft', 'Draft'], ['Draft', 'On Hold'], ['Fully Subscribed', 'Fully Subscribed']], 'On Hold is not on sale; "Fully Subscribed / Closed" is Fully Subscribed');
  assert.equal(im.LLP[1].Annual_Rental_Yield, 0, '"-None-" is no yield');
  assert.equal(im.ALLOT.find((a) => a.id === `${P}740998201`).Annual_Rental_Yield, 22, 'the allotment\'s yield picklist "22%" reads as 22');
  assert.equal(im.ALLOT.length, 2);
  assert.ok(!('received' in im.ALLOT[0]));
  assert.deepEqual(im.TXN.map((t) => [t.inv, t.kind, t.rec]), [[`${P}740997101`, 'advance', 'matched'], [`${P}740997102`, 'advance', 'pending']]);
  assert.equal(im.TKT[0].pri, 'high');
  assert.equal(im.TKT[0].by, 'investor', 'Case_Origin Web is the investor\'s app (server/cases/register caseOf)');
  assert.deepEqual([im.TKT[0].inv, im.TKT[0].cat, im.TKT[0].state], [`${P}740997101`, 'Bank', 'waiting'], 'the investor is Related_To, the category Ticket_Category');
  assert.ok(r.queries.filter((q) => /from Cases/.test(q)).every((q) => !/Contact_Name|\bCategory\b/.test(q)), 'no field the org does not have');
  assert.ok(r.queries.filter((q) => /from LLP_Creation_Module/.test(q)).every((q) => /Pet_Unit_Price/.test(q) && !/\bUnit_Price|Insurer|Insured_Till/.test(q)));
  assert.equal(im.HOLDING.length, 1);
  assert.equal(im.ARLTXN[0].Type, 'Interest');
  const text = JSON.stringify(res.ds);
  assert.ok(!text.includes('FXPAN9999Z') && !text.includes('FXBANK123456'), 'no identity value reaches the Dataset');
  for (const q of r.queries) assert.ok(!/PAN|Bank_Account|Aadhaar|ISFC/i.test(q.split(' from ')[0]), q);
});

test('a KAM\'s own book is the existing KAM book service, identity values dropped', async () => {
  const r = rig();
  const res = await r.layer.load(principal(KAM, 'kam'));
  assert.deepEqual(res.problems, []);
  assert.equal(res.ds.im.INV.length, 4);
  assert.equal(res.ds.im.ALLOT.length, 4);
  assert.ok(r.queries.some((q) => /from Cases where \(Related_To in/.test(q)), 'a KAM\'s tickets are their own book\'s (Cases.Related_To)');
  assert.ok(res.ds.im.INV.every((i) => i.kam === KAM && i.pan === null));
  assert.ok(!JSON.stringify(res.ds).includes('FXPAN1234F'));
  assert.ok(r.queries.some((q) => new RegExp(`where KAM = '${KAM}'`).test(q)));
  assert.equal(res.ds.LEADS.length, 0);
});

test('a stale share (an own-lead investor another IR originated) is a Plane B refusal, not a row', async () => {
  const r = rig({ over: { contacts: 'coql.contacts.own-lead-foreign' } });
  const res = await r.layer.load(principal(IR, 'ir'));
  assert.deepEqual(res.problems, ['investors:scope-drift']);
  assert.equal(res.ds.im.INV.length, 0);
  const refusal = r.sink.records().find((x) => x.kind === 'refusal' && x.action === 'investors-book');
  assert.deepEqual(refusal.recordIds, [`${P}740997102`]);
  assert.equal(refusal.reason, 'scope-drift');
  assert.equal(mustFail(res), false, 'a refusal is shown as empty, not as an outage');
});

test('Zoho down with nothing cached: the count is an error, the load fails loud, never old numbers', async () => {
  const r = rig({ over: { count: 'server-error', leads: () => 'server-error' } });
  const count = await r.layer.count(principal(IR, 'ir'), 'leads');
  assert.equal(count.state, 'error');
  const res = await r.layer.load(principal(IR, 'ir'));
  assert.equal(res.ds.LEADS.length, 0);
  assert.ok(res.problems.includes('leads:server'), res.problems.join());
  assert.equal(mustFail(res), true);
});

test('the cache holds only aggregates: a load caches nothing, a count caches a number', async () => {
  const store = createMemoryStore({ clock: () => NOW });
  const cache = createScopedCache({ store, clock: () => NOW });
  const r = rig({ cache });
  await r.layer.load(principal(FIN, 'fin'));
  assert.equal((await store.keys()).length, 0, 'rows are never cached (D52)');
  const c = await r.layer.count(principal(FIN, 'fin'), 'investors');
  assert.equal(typeof c.value, 'number');
  await assert.rejects(() => cache.readSettled(scopedKey({ kind: 'org' }, 'investors.rows'), async () => [{ key: 'x', count: 1, phone: '+91' }]).then((x) => { if (x.state === 'error') throw x.error; }), /aggregates and counts only/);
});

/* ---------------- T05 Plane B / C ---------------- */

test('Plane B/C lines for refusals, reveals, step-ups, seat changes and 412s hold ids and status only', () => {
  const r = rig();
  r.events.refusal(IR, 'investors-book', 'seat-denied', [`${P}740997101`, 'AVRPM4471K']);
  r.events.reveal(FIN, 'fin', 'pan', `${P}740997101`, 'ok');
  r.events.stepUp(FIN, 'fin', 'refused', 'stale-auth');
  r.events.seatChange(KAM, 'kam', 'amlead');
  const conflict = conflictOf(r.events, KAM, 'kam-details', { kind: 'conflict', status: 412, code: 'ALREADY_MODIFIED', recordId: `${P}740994101` });
  assert.equal(conflict.kind, 'conflict');
  assert.match(conflict.reason, /Someone else changed this record/);
  assert.equal(conflictOf(r.events, KAM, 'kam-details', { kind: 'server', status: 500, code: 'x' }), null);
  const b = r.sink.records();
  assert.deepEqual(b.map((x) => [x.action, x.reason, x.recordIds]), [
    ['investors-book', 'seat-denied', [`${P}740997101`]],
    ['kam-details', 'already-modified', [`${P}740994101`]],
  ]);
  const c = r.cSink.events();
  assert.deepEqual(c.map((e) => [e.action, e.outcome, e.reason, e.seat]), [
    ['reveal', 'ok', 'pan', 'fin'], ['step-up', 'refused', 'stale-auth', 'fin'], ['seat-change', 'ok', 'from-kam', 'amlead'],
  ]);
  assert.deepEqual(c[0].recordIds, [`${P}740997101`]);
  for (const e of c) for (const k of Object.keys(e)) assert.ok(['at', 'who', 'action', 'outcome', 'reason', 'seat', 'recordIds'].includes(k), k);
  assert.ok(!JSON.stringify([...b, ...c]).includes('AVRPM4471K'));
});

test('a seat that changes between the load and its recheck is refused and written to Plane C', async () => {
  const r = rig({ seatOf: { [IR]: 'kam' } });
  const res = await r.layer.load(principal(IR, 'ir'));
  assert.deepEqual(res.problems.filter((p) => p.startsWith('leads')), ['leads:session-changed']);
  assert.deepEqual(r.cSink.events().map((e) => [e.action, e.reason, e.seat]), [['seat-change', 'from-ir', 'kam']]);
});

/* ---------------- the source's fallback ---------------- */

test('without Zoho sign-in configured the live source answers null (the empty book is served)', async () => {
  assert.equal(await loadLiveDataset({}), null);
  assert.equal(await loadLiveDataset({ FIXTURE_MODE: 'local', NODE_ENV: 'development' }), null);
  assert.equal(dataRuntime(), dataRuntime(), 'one gate and cache per process');
  assert.equal(dataRuntime().gate.snapshot().maxInFlight, 12);
});
