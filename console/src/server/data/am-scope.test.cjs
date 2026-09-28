/* M09-S02-T02 — SCOPE KEYS FOR AM READS: a KAM's cache key by user, the Head of AM's by subtree (A-19);
 * no Receipt, money or identity field in the AM projection, and no AM read touches Receipts.
 *
 * Run from console/: node --test src/server/data/am-scope.test.cjs
 * Replays recorded Zoho responses (__fixtures__/kam-book, __fixtures__/data). No request reaches Zoho.
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
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoho-am-'));
process.on('exit', () => fs.rmSync(outDir, { recursive: true, force: true }));
const config = ts.readConfigFile(path.join(consoleRoot, 'tsconfig.json'), ts.sys.readFile);
const project = ts.parseJsonConfigFileContent(config.config, ts.sys, consoleRoot);
const options = { ...project.options, incremental: false, tsBuildInfoFile: undefined, plugins: undefined,
  module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10, noEmit: false, noEmitOnError: true, outDir, rootDir: srcRoot };
const program = ts.createProgram(['server/data/am-scope.ts', 'server/data/live.ts', 'server/data/projections.ts'].map((f) => path.join(srcRoot, f)), options);
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
const { createScopedCache, createMemoryStore } = load('lib/zoho/cache.js');
const { createPlaneCLog, createPlaneCMemorySink } = load('server/identity/plane-c.js');
const { amScopeOf, amKey, isAmSeat } = load('server/data/am-scope.js');
const { PROJECTIONS, checkAmProjection, isAmForbiddenField } = load('server/data/projections.js');
const { createInvestorEvents } = load('server/data/events.js');
const { createLiveDataLayer } = load('server/data/live.js');

const P = '9007199254';
const IMRAN = `${P}740994001`, NEHA = `${P}740994002`, HEAD = `${P}740994003`, FIN = `${P}740993001`, IR = `${P}740995001`;
const SID = 'sid_fixture_am_scope_0000000000000000000';
const NOW = Date.parse('2026-09-28T06:00:00Z');
const SEAT_IDS = {
  roleIds: { 'Key Account Manager': `${P}740998011`, 'Head of Account Management': `${P}740998021` },
  profileIds: { KAM: `${P}740998010`, 'AM Head': `${P}740998020` },
};
const recorded = (dir, name) => JSON.parse(fs.readFileSync(path.join(fx, dir, `${name}.response.json`), 'utf8'));
const toResponse = (r) => new Response(r.status === 204 ? null : JSON.stringify(r.body), { status: r.status, headers: r.headers || {} });
const immediateGate = () => ({ async acquire() { return { waitedMs: 0, release() {} }; }, async run(_c, t) { return t(); }, snapshot() { return {}; } });
const creds = new Map();
before(async () => {
  for (const id of [IMRAN, NEHA, HEAD, FIN, IR]) creds.set(id, await userCredential({ access_token: `synthetic-${id}`, api_domain: 'https://www.zohoapis.in', expires_in: 3_600 },
    { recordIdPrefix: P, gate: immediateGate(), log: createOpsLog(createMemorySink()), clock: () => NOW,
      fetch: async () => toResponse({ status: 200, body: { users: [{ id, status: 'active' }] } }) }));
});

function route(q) {
  if (/from Contacts/.test(q)) {
    if (/where KAM = /.test(q)) return recorded('kam-book', 'coql.contacts.imran');
    if (/where \(id in/.test(q)) return recorded('kam-book', 'coql.contacts.head');
    return recorded('data', 'coql.contact.one-own');
  }
  if (/from LLP_UnitAllocation_Module/.test(q)) {
    if (/Allocation_Status = 'Issued'/.test(q)) return recorded('kam-book', /Customer in/.test(q) ? 'coql.allotments.imran' : 'coql.allotments.all');
    return recorded('data', /740994201/.test(q) ? 'coql.allotments.am-head' : 'coql.allotments.am-imran');
  }
  if (/from LLP_Creation_Module/.test(q)) return recorded('data', 'coql.llps');
  if (/from Cases/.test(q)) return recorded('data', 'coql.none');
  if (/from Receipts/.test(q)) return recorded('data', 'coql.receipts');
  throw new Error('unrouted query: ' + q);
}

function rig({ active } = {}) {
  const queries = [];
  const log = createOpsLog(createMemorySink());
  const events = createInvestorEvents({ log, planeC: createPlaneCLog(createPlaneCMemorySink()), clock: () => NOW });
  const crm = createZohoClient({ recordIdPrefix: P, gate: immediateGate(), log, maxAttempts: 1, clock: () => NOW,
    fetch: async (_u, init) => { const q = JSON.parse(init.body).select_query; queries.push(q); return toResponse(route(q)); } });
  const seats = { [IMRAN]: 'kam', [NEHA]: 'kam', [HEAD]: 'amlead', [FIN]: 'fin', [IR]: 'ir' };
  const store = createMemoryStore({ clock: () => NOW });
  const layer = createLiveDataLayer({ crm, cache: createScopedCache({ store, clock: () => NOW }), log, events, recordIdPrefix: P, seatIds: SEAT_IDS, clock: () => NOW,
    ...(active ? { activeKamUserIds: async () => active } : {}),
    recheck: async (sid) => { const who = Object.keys(seats).find((k) => sid === SID + k.slice(-6)); return who ? { credential: creds.get(who), session: { who, seat: seats[who] } } : null; } });
  return { layer, queries, store };
}
const principal = (id, seat) => ({ credential: creds.get(id), session: { who: id, seat }, sessionId: SID + id.slice(-6) });
const selectOf = (q) => q.split(' from ')[0];

test('A-19: a KAM is keyed by user, the Head of AM by subtree; no other seat has an AM scope', () => {
  assert.deepEqual(amScopeOf('kam', IMRAN), { kind: 'kam', userId: IMRAN });
  assert.deepEqual(amScopeOf('amlead', HEAD), { kind: 'head-am', managerId: HEAD });
  for (const seat of ['fin', 'head', 'ir', 'conv', 'ops', 'stranger']) assert.equal(amScopeOf(seat, FIN), null, seat);
  assert.equal(amScopeOf('kam', 'imran'), null, 'a malformed id has no scope');
  const k = amKey(amScopeOf('kam', IMRAN), 'book.summary');
  assert.deepEqual([k.scope, k.name], [{ kind: 'user', userId: IMRAN }, 'own-book.am.book.summary']);
  const h = amKey(amScopeOf('amlead', HEAD), 'book.summary');
  assert.deepEqual([h.scope, h.name], [{ kind: 'subtree', managerId: HEAD }, 'subtree.am.book.summary']);
  assert.equal(isAmSeat('kam') && isAmSeat('amlead') && !isAmSeat('fin'), true);
});

test('the AM projection carries no Receipt, money or identity field, and one that tries fails at load', () => {
  for (const f of PROJECTIONS.amAllotments) assert.equal(isAmForbiddenField(f), false, f);
  for (const f of ['Unit_Price', 'Total_Amount_Received', 'Total_Amount_Receivable', 'Token_Advance_Amount', 'Capital_Invested', 'UTR', 'Amount', 'PAN_Number', 'KYC']) {
    assert.equal(isAmForbiddenField(f), true, f);
  }
  assert.throws(() => checkAmProjection('LLP_UnitAllocation_Module', ['id', 'Unit_Price']), /money or Receipt/);
  assert.throws(() => checkAmProjection('Contacts', ['id', 'PAN_Number']), /identity fields/);
});

test('TC-IM04-004 (data): Imran\'s load is his four accounts — no Receipts read, no money field selected', async () => {
  const r = rig();
  const res = await r.layer.load(principal(IMRAN, 'kam'));
  assert.deepEqual(res.problems, []);
  assert.equal(res.ds.im.INV.length, 4);
  assert.ok(res.ds.im.INV.every((i) => i.kam === IMRAN && i.pan === null && i.aadh === null));
  assert.equal(r.queries.some((q) => /from Receipts/.test(q)), false, 'an AM read never touches Receipts');
  assert.equal(res.ds.im.TXN.length, 0);
  // the farm shelf (LLP_Creation_Module) is not the investor's money: its list price is on every seat's Farms page
  for (const q of r.queries.filter((x) => !/from LLP_Creation_Module/.test(x))) assert.equal(/Unit_Price|Amount|Token_Advance|PAN|Bank|Aadhaar|KYC/.test(selectOf(q)), false, q);
  assert.equal(res.ds.im.ALLOT.length, 4);
  assert.ok(res.ds.im.ALLOT.every((a) => a.Unit_Price === 0 && a.Ticket_Snapshot === 0 && !('received' in a) && !('holdUntil' in a)));
});

test('TC-IM04-006 (data): the Head of AM reads every allotted account and the pool — no Receipts', async () => {
  const r = rig({ active: [IMRAN, NEHA] });
  const res = await r.layer.load(principal(HEAD, 'amlead'));
  assert.deepEqual(res.problems, []);
  assert.equal(res.ds.im.INV.length, 10, 'allotted accounts only, the pool included');
  assert.equal(res.ds.im.INV.filter((i) => i.kam === null).length, 1);
  assert.equal(r.queries.some((q) => /from Receipts/.test(q)), false);
  assert.ok(r.queries.some((q) => /Allocation_Status = 'Issued'/.test(q)), 'the book is the allotted accounts');
});

test('the AM counts are cached under the AM scope: Imran by user, the Head by subtree, never shared', async () => {
  const r = rig({ active: [IMRAN, NEHA] });
  const a = await r.layer.amSummary(principal(IMRAN, 'kam'));
  assert.deepEqual([a.state, { ...a.value }], ['fresh', { underCare: 4, noManager: 0 }]);
  const h = await r.layer.amSummary(principal(HEAD, 'amlead'));
  assert.deepEqual({ ...h.value }, { underCare: 10, noManager: 2 }, 'no KAM, or a departed KAM, is "No manager"');
  const again = await r.layer.amSummary(principal(IMRAN, 'kam'));
  assert.equal(again.origin, 'cache');
  assert.deepEqual([...(await r.store.keys())].sort(), [`subtree:${HEAD}|subtree.am.book.summary`, `user:${IMRAN}|own-book.am.book.summary`]);
  assert.equal(await r.layer.amSummary(principal(FIN, 'fin')), null, 'Finance has no AM number');
  assert.equal(await r.layer.amSummary(principal(IR, 'ir')), null);
});

test('without the active-KAM reader only an account with no KAM reads as "No manager" (PROVISIONAL)', async () => {
  const r = rig();
  const h = await r.layer.amSummary(principal(HEAD, 'amlead'));
  assert.deepEqual({ ...h.value }, { underCare: 10, noManager: 1 });
});

test('a KAM opening one investor gets its allotments without money and no receipts', async () => {
  const r = rig();
  const one = await r.layer.investor(principal(IMRAN, 'kam'), `${P}740994101`);
  // the one-investor guard reads the Contact by id (data fixture: another KAM's) — refused, never read further
  assert.equal(one.ok, false);
  assert.equal(r.queries.some((q) => /from Receipts|from LLP_UnitAllocation_Module/.test(q)), false);
});
