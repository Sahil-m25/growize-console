/* M18-S01-T04 — READ BUDGETS: each seat's page read stays within its Zoho call budget.
 *
 * Run from console/: node --test src/server/data/read-budget.test.cjs
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
  'server/data/live.ts', 'server/data/zoho-source.ts', 'server/leads/today.ts'].map((f) => path.join(srcRoot, f));
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
const { createTodayRead } = load('server/leads/today.js');

const P = '9007199254';
const IR = `${P}740995001`;          // Rohit (IR)
const MANAGER = `${P}740995002`;     // Tasneem (IR Manager)
const FIN = `${P}740993001`;         // Finance
const KAM = `${P}740994001`;         // Imran (KAM) — the kam-book fixtures' user
const DIVYA = `${P}740994009`;       // Head of AM
const SID = 'sid_fixture_data_layer_00000000000000000';
const NOW = Date.parse('2026-09-28T06:00:00Z');
/* the Head of AM's role and profile ids are in the table too: without them the AM book's access snapshot carries empty ids and is refused 'seat-denied' (M18-S01-NOTE-4) */
const SEAT_IDS = { roleIds: { 'Key Account Manager': `${P}740998001`, 'Investor Relations': `${P}740998003`, 'Head of Account Management': `${P}740998005` },
  profileIds: { KAM: `${P}740998002`, IR: `${P}740998004`, 'AM Head': `${P}740998006` } };

const recorded = (dir, name) => JSON.parse(fs.readFileSync(path.join(fx, dir, `${name}.response.json`), 'utf8'));
const toResponse = (r) => new Response(r.status === 204 ? null : JSON.stringify(r.body), { status: r.status, headers: r.headers || {} });
const immediateGate = () => ({ async acquire() { return { waitedMs: 0, release() {} }; }, async run(_c, t) { return t(); }, snapshot() { return {}; } });
const creds = new Map();
before(async () => {
  for (const id of [IR, MANAGER, FIN, KAM, DIVYA]) creds.set(id, await userCredential({ access_token: `synthetic-${id}`, api_domain: 'https://www.zohoapis.in', expires_in: 3_600 },
    { recordIdPrefix: P, gate: immediateGate(), log: createOpsLog(createMemorySink()), clock: () => NOW,
      fetch: async () => toResponse({ status: 200, body: { users: [{ id, status: 'active' }] } }) }));
});

/** The Head of AM's book (am-scope.test.cjs): every allotted account by id, and the issued allotments of all KAMs. */
const headRoute = (q) => {
  if (/from Contacts where \(id in/.test(q)) return recorded('kam-book', 'coql.contacts.head');
  if (/from LLP_UnitAllocation_Module/.test(q) && /Allocation_Status = 'Issued'/.test(q)) return recorded('kam-book', 'coql.allotments.all');
  return null;
};

/** Routes a COQL query to a recorded answer. */
function route(q, over = {}) {
  if (over.raw) { const x = over.raw(q); if (x) return x; }
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
  if (/from Touches where Lead in/.test(q)) return recorded('data', 'coql.touches');
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


/* ---------------- budgets ----------------
 * The calls one page read may make on a cold cache, by seat. Measured on the recorded fixtures at M18-S01-T04 and held
 * exactly: a new read added to a page, or one read turned into one-per-row (N+1), fails here until the budget is
 * raised on purpose. Every call counted is a COQL POST (query or aggregate); the gate's per-call cost is separate.
 *   ir   : personal leads (1) + lead detail (1) + touches (1) + own-lead investors (1) + farms (1) + allotments (1)
 *   conv : personal (1) + team (1) + lead detail (1) + touches (1) + farms (1)   — an IR Manager has no investor book
 *   (touches: raised on purpose, 6 Oct — the last contact read back from Touches, one COQL per 100 leads beside the detail read)
 *   fin  : contacts, farms, allotments, receipts, cases, holdings, ARL transactions — one each
 *   kam  : AM book (contacts, allotments) + farms + allotments projection + cases
 *   amlead: the Head of AM, same five: AM book (issued allotments, contacts by id) + farms + allotments projection + cases (measured 4 Oct, M18-S01-NOTE-4)
 */
const BUDGET = { ir: 6, conv: 5, fin: 7, kam: 5, amlead: 5 };
const WHO = { ir: IR, conv: MANAGER, fin: FIN, kam: KAM, amlead: DIVYA };
const kind = (q) => (q.match(/ from (\w+)/) || [])[1];

for (const seat of Object.keys(BUDGET)) {
  test(`${seat}: a cold page read makes at most ${BUDGET[seat]} Zoho calls, one per book`, async () => {
    const r = rig(seat === 'amlead' ? { over: { raw: headRoute } } : {});
    const res = await r.layer.load(principal(WHO[seat], seat));
    assert.deepEqual(res.problems, []);
    assert.ok(r.queries.length <= BUDGET[seat], `${seat}: ${r.queries.length} calls > ${BUDGET[seat]}: ${r.queries.map(kind).join(', ')}`);
    assert.equal(r.queries.length, BUDGET[seat], `${seat} now makes fewer calls than its budget (${r.queries.length}): lower BUDGET.${seat}`);
    // a module is read once per page except where the page has two scopes of the same book (leads: personal + team) or two shapes
    const perModule = {};
    for (const q of r.queries) perModule[kind(q)] = (perModule[kind(q)] || 0) + 1;
    for (const [m, n] of Object.entries(perModule)) assert.ok(n <= (m === 'Leads' ? 3 : m === 'LLP_UnitAllocation_Module' && (seat === 'kam' || seat === 'amlead') ? 2 : 1), `${seat}: ${m} read ${n} times`);
  });
}

test('the same page again makes zero calls when only counts are asked, and the badge is one aggregate per scope', async () => {
  const cache = createScopedCache({ clock: () => NOW });
  const r = rig({ cache });
  for (const [seat, book] of [['ir', 'leads'], ['fin', 'investors']]) {
    const first = await r.layer.count(principal(WHO[seat], seat), book);
    const before = r.queries.length;
    const again = await r.layer.count(principal(WHO[seat], seat), book);
    assert.equal(r.queries.length, before, `${seat}.${book}: a second read inside the cache lifetime must not call Zoho`);
    assert.equal(first.origin, 'live'); assert.equal(again.origin, 'cache');
  }
  assert.ok(r.queries.every((q) => /COUNT\(id\)/.test(q)), 'a badge is a COUNT aggregate, never a row read');
  assert.equal(r.queries.length, 2);
});

test('identical badge reads in flight at once are one Zoho call (coalesced per scope key)', async () => {
  const r = rig({ cache: createScopedCache({ clock: () => NOW }) });
  const reads = await Promise.all([1, 2, 3, 4, 5].map(() => r.layer.count(principal(FIN, 'fin'), 'investors')));
  assert.equal(r.queries.length, 1, `${r.queries.length} calls for five identical reads`);
  assert.ok(reads.every((x) => x.value === reads[0].value));
});

test('GAP (recorded, not asserted green): a full page load is not cached — rows are never cached (D45/D52), so M18-S01 AC2 holds for counts only', async () => {
  const r = rig({ cache: createScopedCache({ clock: () => NOW }) });
  await r.layer.load(principal(FIN, 'fin'));
  const first = r.queries.length;
  await r.layer.load(principal(FIN, 'fin'));
  assert.equal(r.queries.length, first * 2, 'if this fails, load() started caching or coalescing: update the budget story and AC2');
});

test('TC-IM12-001 (investor page): one investor record: the guard read, allotments and receipts, three calls for a seat with money, two without', async () => {
  const OWN = `${P}740997101`;
  const pick = (q) => /from Contacts/.test(q) ? recorded('data', 'coql.contact.one-own') : /from LLP_UnitAllocation_Module/.test(q) ? recorded('data', 'coql.allotments.own-lead')
    : /from Receipts/.test(q) ? recorded('data', 'coql.receipts.own-lead') : recorded('data', 'coql.none');
  const fin = rig({ over: { raw: pick } });
  const a = await fin.layer.investor(principal(FIN, 'fin'), OWN);
  assert.equal(a.ok, true, JSON.stringify(a));
  assert.deepEqual(fin.queries.map(kind), ['Contacts', 'LLP_UnitAllocation_Module', 'Receipts']);
  const ir = rig({ over: { raw: pick } });
  const b = await ir.layer.investor(principal(IR, 'ir'), OWN);
  assert.equal(b.ok, true, JSON.stringify(b));
  assert.deepEqual(ir.queries.map(kind), ['Contacts', 'LLP_UnitAllocation_Module'], 'an IR\'s investor record reads no receipt (D69)');
});

/* ---------------- batching ---------------- */

const leadRows = (n, from = 0) => Array.from({ length: n }, (_, i) => ({ id: `${P}74${String(1000000 + from + i).padStart(7, '0')}`, First_Name: 'Synthetic', Last_Name: `Lead ${from + i}`, Mobile: '+919000000101',
  Owner: { id: IR, name: 'Synthetic Owner' }, Secondary_Owner: null, Cover_By: null, Cover_Until: null, Lead_Source: 'Events', Lead_Status: 'Qualified', Created_Time: '2026-09-20T10:00:00+05:30',
  Lost_At: null, Onboarded_At: null, Units_Interested: 1, Next_Step_At: null, Last_Reply_At: null }));
const ok = (body) => ({ status: 200, headers: { 'content-type': 'application/json' }, body });

test('a book of 450 leads is read in pages of 200 and detail chunks of 100: calls follow the batch size, never the row count', async () => {
  const N = 450;
  const all = leadRows(N);
  const raw = (q) => {
    if (/from Leads where id in/.test(q)) {
      const ids = [...q.matchAll(/'(\d+)'/g)].map((m) => m[1]);
      assert.ok(ids.length <= 100, 'a detail query names at most 100 ids (COQL IN limit)');
      return ok({ data: ids.map((id) => ({ id, First_Touch_At: '2026-09-20T12:00:00+05:30', Modified_Time: '2026-09-25T10:00:00+05:30' })), info: { more_records: false } });
    }
    if (/from Leads/.test(q)) {
      const off = +(q.match(/limit (\d+), (\d+)/) || [])[1], size = +(q.match(/limit (\d+), (\d+)/) || [])[2];
      return ok({ data: all.slice(off, off + size), info: { more_records: off + size < N } });
    }
    return null;
  };
  const r = rig({ over: { raw } });
  const res = await r.layer.load(principal(IR, 'ir'));
  assert.deepEqual(res.problems, []);
  assert.equal(res.ds.LEADS.length, N);
  const lead = r.queries.filter((q) => kind(q) === 'Leads');
  const pages = lead.filter((q) => !/id in/.test(q)).length, details = lead.filter((q) => /id in/.test(q)).length;
  assert.equal(pages, 3, '450 leads at 200 a page');
  assert.equal(details, 5, '450 ids at 100 a query');
  assert.equal(r.queries.filter((q) => kind(q) === 'Touches').length, 5, 'touches follow the same 100-id chunks');
  assert.ok(r.queries.length <= BUDGET.ir + 11, `a 450-lead book took ${r.queries.length} calls`);
  assert.ok(r.queries.length < N / 20, 'never one call per lead');
});

test('Zoho reads for a lead page carry the person\'s own token and no call is made on a refused seat', async () => {
  const r = rig({ seatOf: { [IR]: 'kam' } });
  await r.layer.load(principal(IR, 'ir'));
  assert.ok(!r.queries.some((q) => kind(q) === 'Leads'), 'a seat change at recheck stops the leads read before any COQL');
});

/* ---------------- Today (lead side) ---------------- */

function today(openLeads, pageSize = 200) {
  const calls = [];
  const rows = Array.from({ length: openLeads }, (_, i) => ({ id: `${P}74${String(1000000 + i).padStart(7, '0')}`, lostAt: null, onboardedAt: null }));
  const book = { async list(_p, scope, offset) {
    const next = offset + pageSize;
    return { ok: true, value: { scope, rows: rows.slice(offset, next), nextOffset: next < rows.length ? next : null } };
  } };
  const crm = { async coql(_c, q) { calls.push(q); return { ok: true, value: { records: [], moreRecords: false, invalidRecordIds: false } }; } };
  return { calls, read: () => createTodayRead({ book, crm, clock: () => NOW }).read({ credential: creds.get(IR), sessionId: SID + IR.slice(-6) }, 'personal') };
}

test('Today (lead side): a small book is three activity reads — tasks, calls, meetings — on top of the book itself', async () => {
  const t = today(2);
  const res = await t.read();
  assert.equal(res.ok, true);
  assert.deepEqual(t.calls.map(kind), ['Tasks', 'Calls', 'Events'], 'the book page is the leads book\'s own call; these are the activity reads');
  assert.ok(t.calls.every((q) => /What_Id in/.test(q)), 'every activity read is by lead id, never per lead');
});

test('Today (lead side): 450 open leads cost 3 kinds x ceil(450/100) activity reads, not one per lead', async () => {
  const t = today(450);
  const res = await t.read();
  assert.equal(res.ok, true);
  assert.equal(t.calls.length, 3 * 5);
  for (const q of t.calls) assert.ok([...q.matchAll(/'(\d+)'/g)].length <= 100 + 1, 'at most 100 ids in an IN list');
});

test('GAP (M18-S01-T02 "batch Today\'s reads into one COQL"): Today reads Tasks, Calls and Events as three separate queries', async () => {
  const t = today(2);
  await t.read();
  assert.equal(new Set(t.calls.map(kind)).size, 3, 'Zoho COQL reads one module per query; if this changes, tighten the Today budget to one');
});
