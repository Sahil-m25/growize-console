/* M03-S09 IR INVESTOR SCOPE + M01-S09 FRESHNESS — the data layer's single choke point and /api/data's honesty line.
 *
 * Run from console/: node --test src/server/data/ir-guard.test.cjs
 * Compiles the production modules with the project's strict settings and replays sanitized recorded Zoho
 * responses (src/lib/zoho/__fixtures__/data). No request reaches Zoho.
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
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoho-irguard-'));
process.on('exit', () => fs.rmSync(outDir, { recursive: true, force: true }));

const config = ts.readConfigFile(path.join(consoleRoot, 'tsconfig.json'), ts.sys.readFile);
const project = ts.parseJsonConfigFileContent(config.config, ts.sys, consoleRoot);
const options = {
  ...project.options, incremental: false, tsBuildInfoFile: undefined, plugins: undefined,
  module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10,
  noEmit: false, noEmitOnError: true, outDir, rootDir: srcRoot,
};
const sources = ['server/data/ir-guard.ts', 'server/data/adapters.ts', 'server/data/live.ts', 'server/data/freshness.ts', 'server/data/events.ts']
  .map((f) => path.join(srcRoot, f));
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
const { createScopedCache, createMemoryStore } = load('lib/zoho/cache.js');
const { createPlaneCLog, createPlaneCMemorySink } = load('server/identity/plane-c.js');
const { scopesFor, scopedKeyString } = load('server/data/scope.js');
const { createInvestorEvents } = load('server/data/events.js');
const { createInvestorsAdapters, IN_CHUNK } = load('server/data/adapters.js');
const { admitContact, contactsWhere, investorsKey, mayServeKey, createInvestorGuard } = load('server/data/ir-guard.js');
const { createLiveDataLayer } = load('server/data/live.js');
const { freshnessOf, serveWithFreshness, noteLiveRead, noteLiveFailure, isSourceFailure, CEILING_MS } = load('server/data/freshness.js');

const P = '9007199254';
const ROHIT = `${P}740995001`;
const KAVYA = `${P}740995009`;
const FIN = `${P}740993001`;
const KAM = `${P}740994001`;
const OWN = `${P}740997101`, KAVYAS = `${P}740997102`, NO_ORIGIN = `${P}740997103`;
const NOW = Date.parse('2026-09-28T06:00:00Z');

const recorded = (name) => JSON.parse(fs.readFileSync(path.join(fx, 'data', `${name}.response.json`), 'utf8'));
const toResponse = (r) => new Response(r.status === 204 ? null : JSON.stringify(r.body), { status: r.status, headers: r.headers || {} });
const immediateGate = () => ({ async acquire() { return { waitedMs: 0, release() {} }; }, async run(_c, t) { return t(); }, snapshot() { return {}; } });
const creds = new Map();
before(async () => {
  for (const id of [ROHIT, KAVYA, FIN, KAM]) creds.set(id, await userCredential({ access_token: `synthetic-${id}`, api_domain: 'https://www.zohoapis.in', expires_in: 3_600 },
    { recordIdPrefix: P, gate: immediateGate(), log: createOpsLog(createMemorySink()), clock: () => NOW,
      fetch: async () => toResponse({ status: 200, body: { users: [{ id, status: 'active' }] } }) }));
});

function rig(router) {
  const queries = [];
  const sink = createMemorySink();
  const log = createOpsLog(sink);
  const cSink = createPlaneCMemorySink();
  const planeC = createPlaneCLog(cSink);
  const events = createInvestorEvents({ log, planeC, clock: () => NOW });
  const planeCRefusals = [];
  const crm = createZohoClient({ recordIdPrefix: P, gate: immediateGate(), log, maxAttempts: 1, clock: () => NOW,
    fetch: async (_url, init) => { const q = JSON.parse(init.body).select_query; queries.push(q); return toResponse(router(q)); } });
  const cache = createScopedCache({ store: createMemoryStore({ clock: () => NOW }), clock: () => NOW });
  const layer = createLiveDataLayer({ crm, cache, log, events, recordIdPrefix: P, clock: () => NOW, planeCRefusal: (e) => planeCRefusals.push(e),
    recheck: async () => null });
  const guard = createInvestorGuard({ events, planeCRefusal: (e) => planeCRefusals.push(e) });
  return { crm, layer, guard, queries, sink, events, planeCRefusals, cache };
}
const principal = (id, seat) => ({ credential: creds.get(id), session: { who: id, seat }, sessionId: 'sid_fixture_ir_guard_000000000000000' + id.slice(-3) });
const refusals = (sink) => sink.records().filter((x) => x.kind === 'refusal' || x.reason);

/* ---- the rule itself ---- */

test('an IR is admitted only to a Contact with Origin_Lead and Originating_IR = me; everything else is denied', () => {
  const ir = scopesFor('ir', ROHIT).investors;
  assert.equal(ir.kind, 'own-lead');
  assert.deepEqual(admitContact(ir, { originLeadId: `${P}740996201`, originatingIrId: ROHIT, kamId: null }), { ok: true });
  assert.deepEqual(admitContact(ir, { originLeadId: `${P}740996201`, originatingIrId: KAVYA, kamId: null }), { ok: false, reason: 'not-own-lead' });
  assert.deepEqual(admitContact(ir, { originLeadId: null, originatingIrId: ROHIT, kamId: null }), { ok: false, reason: 'no-origin' });
  assert.deepEqual(admitContact(ir, { originLeadId: `${P}740996201`, originatingIrId: null, kamId: null }), { ok: false, reason: 'no-origin' });
  assert.deepEqual(admitContact({ kind: 'none' }, { originLeadId: 'x', originatingIrId: ROHIT, kamId: null }), { ok: false, reason: 'seat-denied' });
  assert.equal(contactsWhere(ir), `Originating_IR = '${ROHIT}' and Origin_Lead is not null`);
  assert.equal(contactsWhere({ kind: 'none' }), null);
  assert.equal(contactsWhere(scopesFor('cp', ROHIT).investors), null, 'a channel partner has no Investors side');
});

test('the IR list read names its own filter in COQL and a Contact with no Origin_Lead refuses the read (default deny)', async () => {
  const r = rig((q) => (/from Contacts/.test(q) ? recorded('coql.contacts.own-lead-no-origin') : recorded('coql.none')));
  const adapters = createInvestorsAdapters({ crm: r.crm, events: r.events });
  const res = await adapters.contacts(creds.get(ROHIT), scopesFor('ir', ROHIT).investors);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'scope-drift');
  assert.match(r.queries[0], new RegExp(`where \\(Originating_IR = '${ROHIT}' and Origin_Lead is not null\\)`));
  const line = r.sink.records().find((x) => x.action === 'investors-book');
  assert.ok(line, 'Plane B holds the refusal');
  assert.deepEqual(line.recordIds, [NO_ORIGIN], 'the refused id only');
});

test('Rohit opens his own investor: status and allotments, no money, no receipts, PII masked (M09-S08 AC4)', async () => {
  const r = rig((q) => {
    if (/from Contacts/.test(q)) return recorded('coql.contact.one-own');
    if (/from LLP_UnitAllocation_Module/.test(q)) return recorded('coql.allotments.own-lead');
    if (/from Receipts/.test(q)) return recorded('coql.receipts.own-lead');
    return recorded('coql.none');
  });
  const res = await r.layer.investor(principal(ROHIT, 'ir'), OWN);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.investor.id, OWN);
  assert.equal(res.investor.ir, ROHIT);
  assert.equal(res.investor.pan, null);
  assert.equal(res.investor.bank.acct, '');
  assert.ok(res.allotments.length >= 1);
  assert.ok(res.allotments.every((a) => a.Customer === OWN));
  const text = JSON.stringify(res);
  assert.ok(!/FXPAN|FXBANK/.test(text), 'the fixture carries PAN/bank; none of it comes out');
  assert.ok(r.queries.every((q) => !/PAN|Bank|Aadhaar/i.test(q.split(' from ')[0])), 'no query selects an identity field');
  assert.ok(r.queries.filter((q) => /LLP_UnitAllocation_Module/.test(q)).every((q) => q.includes(`Customer in ('${OWN}')`)));
  assert.deepEqual(res.receipts, [], 'an IR is never handed a Receipt');
  assert.equal(r.queries.some((q) => /from Receipts/.test(q)), false, 'no Receipt is even read for an IR');
  assert.ok(res.allotments.every((a) => a.Unit_Price === null && a.Ticket_Snapshot === null && a.Annual_Rental_Yield === null), 'no price, ticket or yield (null, never a 0 that reads as a figure — W8-IRA-1), though the recorded row carried one');
  for (const q of r.queries.filter((x) => /from (Contacts|LLP_UnitAllocation_Module)/.test(x))) {
    assert.equal(/Unit_Price|Amount|Token|Capital|Yield|Mailing_Street|Nominee/.test(q.split(' from ')[0]), false, q);
  }
});

test('Rohit asks for Kavya\'s investor by URL/API: refused, Plane B and the Plane C hook log the id', async () => {
  const r = rig((q) => (/from Contacts/.test(q) ? recorded('coql.contact.one-kavya') : recorded('coql.none')));
  const res = await r.layer.investor(principal(ROHIT, 'ir'), KAVYAS);
  assert.deepEqual({ ...res }, { ok: false, kind: 'refused', reason: 'not-own-lead' });
  assert.ok(!r.queries.some((q) => /LLP_UnitAllocation_Module|Receipts/.test(q)), 'nothing past the Contact is read');
  const b = r.sink.records().find((x) => x.action === 'investor-open');
  assert.equal(b.reason, 'not-own-lead');
  assert.deepEqual(b.recordIds, [KAVYAS]);
  assert.deepEqual(r.planeCRefusals, [{ who: ROHIT, seat: 'ir', action: 'investor-open', reason: 'not-own-lead', recordIds: [KAVYAS] }]);
});

test('a Contact with no Origin_Lead is refused to any IR, including the one it names', async () => {
  for (const who of [ROHIT, KAVYA]) {
    const r = rig((q) => (/from Contacts/.test(q) ? recorded('coql.contact.one-no-origin') : recorded('coql.none')));
    const res = await r.layer.investor(principal(who, 'ir'), NO_ORIGIN);
    assert.equal(res.reason, 'no-origin', who);
  }
});

test('an id the token cannot see is refused, not "not found"; a malformed id costs no call; a seat without Investors is refused', async () => {
  const r = rig(() => recorded('coql.none'));
  assert.equal((await r.layer.investor(principal(ROHIT, 'ir'), OWN)).reason, 'not-visible');
  const before = r.queries.length;
  assert.equal((await r.layer.investor(principal(ROHIT, 'ir'), "1' or id is not null")).reason, 'invalid-request');
  assert.equal(r.queries.length, before);
  assert.equal((await r.layer.investor(principal(ROHIT, 'cp'), OWN)).reason, 'seat-denied');
  assert.equal(r.queries.length, before);
});

test('Finance opens any investor on the book (org scope) — the guard admits it', async () => {
  const r = rig((q) => (/from Contacts/.test(q) ? recorded('coql.contact.one-kavya') : recorded('coql.none')));
  const res = await r.layer.investor(principal(FIN, 'fin'), KAVYAS);
  assert.equal(res.ok, true);
  assert.ok(r.queries.filter((q) => /LLP_UnitAllocation_Module/.test(q)).every((q) => q.includes(`Customer in ('${KAVYAS}')`)), 'one investor\'s allotments only, not the whole book');
});

/* ---- cache ---- */

test('an IR\'s investor count is keyed by that IR; a Finance or KAM key is never served to an IR', async () => {
  const ir = scopesFor('ir', ROHIT).investors;
  assert.equal(scopedKeyString(ir, 'investors.count'), `user:${ROHIT}|own-lead.investors.count`);
  const k = investorsKey(ir, 'count');
  assert.deepEqual(k.scope, { kind: 'user', userId: ROHIT });
  assert.equal(mayServeKey(ir, scopesFor('fin', FIN).investors), false);
  assert.equal(mayServeKey(ir, scopesFor('kam', KAM).investors), false);
  assert.equal(mayServeKey(ir, scopesFor('ir', KAVYA).investors), false);
  assert.equal(mayServeKey(ir, scopesFor('ir', ROHIT).investors), true);

  const store = createMemoryStore({ clock: () => NOW });
  const cache = createScopedCache({ store, clock: () => NOW });
  const r = rig((q) => recorded(/from Contacts/.test(q) && /Originating_IR/.test(q) ? 'agg.count-4' : 'agg.count-9'));
  const layer = createLiveDataLayer({ crm: r.crm, cache, log: createOpsLog(createMemorySink()), events: r.events, recordIdPrefix: P, clock: () => NOW, recheck: async () => null });
  await layer.count(principal(FIN, 'fin'), 'investors');
  await layer.count(principal(KAM, 'kam'), 'investors');
  const rohit = await layer.count(principal(ROHIT, 'ir'), 'investors');
  const kavya = await layer.count(principal(KAVYA, 'ir'), 'investors');
  assert.equal(rohit.origin, 'live', 'Rohit\'s count was not served from Finance\'s or the KAM\'s entry');
  assert.equal(kavya.origin, 'live', 'Kavya\'s count was not served from Rohit\'s');
  assert.deepEqual([...(await store.keys())].sort(), ['role:org|org.investors.count', `user:${KAM}|own-book.investors.count`, `user:${KAVYA}|own-lead.investors.count`, `user:${ROHIT}|own-lead.investors.count`].sort());
  assert.ok(r.queries.some((q) => q.includes(`Originating_IR = '${ROHIT}' and Origin_Lead is not null`)));
});

/* ---- IN batching ---- */

test('allotments for 150 own-lead contacts go out as two COQL calls, IN ≤ 100 each', async () => {
  const r = rig(() => recorded('coql.none'));
  const adapters = createInvestorsAdapters({ crm: r.crm, events: r.events });
  const ids = Array.from({ length: 150 }, (_, i) => `${P}74${String(1000000 + i).padStart(7, '0')}`);
  const res = await adapters.allotments(creds.get(ROHIT), scopesFor('ir', ROHIT).money, ids);
  assert.equal(res.ok, true);
  const qs = r.queries.filter((q) => /LLP_UnitAllocation_Module/.test(q));
  assert.equal(qs.length, 2);
  for (const q of qs) assert.ok((q.match(/'\d+'/g) || []).length <= IN_CHUNK, 'IN capped at 100');
  assert.equal(qs.reduce((t, q) => t + (q.match(/'\d+'/g) || []).length, 0), 150);
});

/* ---- M01-S09 freshness ---- */

test('freshness: a full read is live; a failed read under five minutes is stale; past the ceiling it is an error', () => {
  const t0 = NOW;
  assert.equal(CEILING_MS, 300_000);
  const live = freshnessOf({ source: 'zoho', userId: ROHIT, problems: [], threw: false, now: t0, lastGoodAt: t0 });
  assert.deepEqual([live.tone, live.failed, live.at], ['live', false, t0]);
  const stale = freshnessOf({ source: 'zoho', userId: ROHIT, problems: ['allotments:network'], threw: false, now: t0 + 60_000, lastGoodAt: t0 });
  assert.deepEqual([stale.tone, stale.failed, stale.at], ['stale', true, t0]);
  const past = freshnessOf({ source: 'zoho', userId: ROHIT, problems: [], threw: true, now: t0 + 5 * 60_000 + 1, lastGoodAt: t0 });
  assert.deepEqual([past.tone, past.failed, past.at], ['error', true, t0]);
  const never = freshnessOf({ source: 'zoho', userId: ROHIT, problems: ['investors:server'], threw: true, now: t0, lastGoodAt: null });
  assert.equal(never.tone, 'error');
  assert.equal(freshnessOf({ source: 'none', userId: null, problems: [], threw: false, now: t0 }).at, null, 'no live source: no made-up read time');
  assert.equal(freshnessOf({ source: 'fixtures', userId: null, problems: [], threw: false, now: t0 }).tone, 'live');
  assert.equal(isSourceFailure('investors:truncated'), false);
  assert.equal(isSourceFailure('investors:not-own-lead'), false);
  assert.equal(isSourceFailure('receipts:server'), true);
});

test('/api/data: a good read carries fresh.at; a primary failure later is a 503 with the last good time, never old counts', async () => {
  let clock = NOW;
  const good = await serveWithFreshness(async () => { noteLiveRead(KAVYA, [], clock); return { ds: {}, actions: [], version: 0, fixtures: false }; }, () => false, () => clock);
  assert.equal(good.status, 200);
  assert.deepEqual([good.body.fresh.source, good.body.fresh.tone, good.body.fresh.at, good.body.fresh.failed], ['zoho', 'live', NOW, false]);

  class LiveReadError extends Error { constructor() { super('x'); this.name = 'LiveReadError'; } }
  const isLive = (e) => e instanceof Error && e.name === 'LiveReadError';
  clock = NOW + 2 * 60_000;
  const soon = await serveWithFreshness(async () => { noteLiveFailure(KAVYA, ['investors:server']); throw new LiveReadError(); }, isLive, () => clock);
  assert.equal(soon.status, 503);
  assert.equal(soon.body.ds, undefined, 'no book rides on a failure');
  assert.deepEqual([soon.body.fresh.tone, soon.body.fresh.at, soon.body.fresh.failed], ['stale', NOW, true]);
  clock = NOW + 6 * 60_000;
  const late = await serveWithFreshness(async () => { noteLiveFailure(KAVYA, ['investors:server']); throw new LiveReadError(); }, isLive, () => clock);
  assert.deepEqual([late.status, late.body.fresh.tone, late.body.fresh.at], [503, 'error', NOW]);

  const partial = await serveWithFreshness(async () => { noteLiveRead(KAVYA, ['receipts:network'], clock); return { ds: {}, actions: [], version: 0, fixtures: false }; }, isLive, () => clock);
  assert.equal(partial.status, 200);
  assert.deepEqual([partial.body.fresh.failed, partial.body.fresh.tone, partial.body.fresh.at], [true, 'error', NOW], 'a lost secondary book is flagged, and the last full read is still the old one');
  assert.deepEqual(partial.body.fresh.problems, ['receipts:network']);

  await assert.rejects(serveWithFreshness(async () => { throw new TypeError('bug'); }, isLive), TypeError, 'other errors reach the route\'s capture');
  const fx = await serveWithFreshness(async () => ({ ds: {}, actions: [], version: 3, fixtures: true }), isLive, () => clock);
  assert.equal(fx.body.fresh.source, 'fixtures');
  const none = await serveWithFreshness(async () => ({ ds: {}, actions: [], version: 0, fixtures: false }), isLive, () => clock);
  assert.deepEqual([none.body.fresh.source, none.body.fresh.at], ['none', null]);
});

/* ---------------- M09-S08-T02 — an IR sees only investors from their own leads ---------------- */

const { contactsKeyFor, oneContactWhere } = load('server/data/ir-guard.js');
const { PROJECTIONS, isAmForbiddenField } = load('server/data/projections.js');

test('M09-S08 AC1: Rohit\'s Investors list asks Zoho only for Contacts whose Originating_IR is Rohit, on the IR projection', async () => {
  const r = rig((q) => (/from Contacts/.test(q) ? recorded('coql.contacts.own-lead') : /from LLP_UnitAllocation_Module/.test(q) ? recorded('coql.allotments.own-lead') : recorded('coql.none')));
  const res = await r.layer.load(principal(ROHIT, 'ir'));
  assert.deepEqual(res.ds.im.INV.map((i) => [i.id, i.ir]), [[OWN, ROHIT]]);
  const cq = r.queries.filter((q) => /from Contacts/.test(q));
  assert.equal(cq.length, 1);
  assert.match(cq[0], new RegExp(`where \\(Originating_IR = '${ROHIT}' and Origin_Lead is not null\\)`));
  assert.equal(cq[0].split(' from ')[0], `select ${PROJECTIONS.irContacts.join(', ')}`);
  assert.equal(contactsKeyFor(scopesFor('ir', ROHIT).investors), 'irContacts');
  assert.equal(contactsKeyFor(scopesFor('fin', FIN).investors), 'contacts');
  for (const f of PROJECTIONS.irContacts) assert.equal(isAmForbiddenField(f), false, `${f} is neither money nor identity`);
});

test('M09-S08 AC4: an IR\'s investor list carries no Paid, Due, PAN, Aadhaar or bank — and no Receipt is read', async () => {
  const r = rig((q) => (/from Contacts/.test(q) ? recorded('coql.contacts.own-lead') : /from LLP_UnitAllocation_Module/.test(q) ? recorded('coql.allotments.own-lead')
    : /from Receipts/.test(q) ? recorded('coql.receipts.own-lead') : recorded('coql.none')));
  const res = await r.layer.load(principal(ROHIT, 'ir'));
  const im = res.ds.im;
  assert.equal(r.queries.some((q) => /from Receipts/.test(q)), false);
  assert.deepEqual(im.TXN, []);
  assert.ok(im.ALLOT.length >= 1 && im.ALLOT.every((a) => a.Unit_Price === 0 && a.Ticket_Snapshot === 0));
  const inv = im.INV[0];
  assert.equal(inv.units > 0, true, 'farms and units still show');
  assert.deepEqual([inv.pan, inv.aadh, inv.bank.acct, inv.bank.ifsc, inv.bank.name], [null, null, '', '', '']);
  assert.notEqual(inv.st, 'paid', 'no paid state derived without money');
  const text = JSON.stringify(res.ds);
  assert.ok(!/FXPAN|FXBANK|250000/.test(text), 'no identity value and no price reaches the IR');
  for (const q of r.queries.filter((x) => /from LLP_UnitAllocation_Module/.test(x))) assert.equal(/Unit_Price|Amount|Token|Yield/.test(q.split(' from ')[0]), false, q);
});

test('M09-S08 AC2: another IR\'s investor by address — Zoho is asked with Rohit\'s filter, returns nothing, nothing further is read', async () => {
  const r = rig(() => recorded('coql.none'));
  const res = await r.layer.investor(principal(ROHIT, 'ir'), KAVYAS);
  assert.deepEqual({ ...res }, { ok: false, kind: 'refused', reason: 'not-visible' });
  assert.equal(r.queries.length, 1, 'one scoped Contact query, then nothing');
  assert.equal(r.queries[0], `select ${PROJECTIONS.irContacts.join(', ')} from Contacts where (id = '${KAVYAS}') and (Originating_IR = '${ROHIT}' and Origin_Lead is not null) limit 0, 1`);
  assert.equal(oneContactWhere(scopesFor('fin', FIN).investors, KAVYAS), `(id = '${KAVYAS}')`, 'Finance keeps the plain id read');
  assert.equal(oneContactWhere(scopesFor('ir', ROHIT).investors, "1' or 1=1"), null);
  const b = r.sink.records().find((x) => x.action === 'investor-open');
  assert.deepEqual([b.reason, b.recordIds], ['not-visible', [KAVYAS]]);
});

test('M09-S08 AC3: the investor belongs to the IR who owned the lead at Said yes (Originating_IR), not the lead\'s owner now', async () => {
  // coql.contact.one-own: Originating_IR = Rohit (stamped at Said yes). Whoever owns the lead today, the guard
  // reads only the Contact's stamp — it never looks the lead's current owner up.
  for (const [who, ok] of [[ROHIT, true], [KAVYA, false]]) {
    const r = rig((q) => (/from Contacts/.test(q) ? recorded('coql.contact.one-own') : recorded('coql.none')));
    const res = await r.layer.investor(principal(who, 'ir'), OWN);
    assert.equal(res.ok, ok, who);
    if (!ok) assert.equal(res.reason, 'not-own-lead');
    assert.equal(r.queries.some((q) => /from Leads/.test(q)), false, 'no lead-owner lookup decides the IR');
  }
});
