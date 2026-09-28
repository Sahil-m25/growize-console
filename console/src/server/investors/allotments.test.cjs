/* M11-S02-T02 (allotment reads by Contact and by LLP) and M10-S09-T01 (ARL holdings, read-only).
 *
 * Run from console/: node --test src/server/investors/allotments.test.cjs
 * Replays recorded Zoho responses (__fixtures__/allotments, __fixtures__/holdings). No request reaches Zoho.
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
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoho-allotments-'));
process.on('exit', () => fs.rmSync(outDir, { recursive: true, force: true }));
const config = ts.readConfigFile(path.join(consoleRoot, 'tsconfig.json'), ts.sys.readFile);
const project = ts.parseJsonConfigFileContent(config.config, ts.sys, consoleRoot);
const options = { ...project.options, incremental: false, tsBuildInfoFile: undefined, plugins: undefined,
  module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10, noEmit: false, noEmitOnError: true, outDir, rootDir: srcRoot };
const program = ts.createProgram(['server/investors/allotments.ts', 'server/investors/holdings.ts', 'server/money/by-allotment.ts']
  .map((f) => path.join(srcRoot, f)), options);
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
const { createPlaneCLog, createPlaneCMemorySink } = load('server/identity/plane-c.js');
const { createInvestorEvents } = load('server/data/events.js');
const { createAllotmentReader, CONTACT_ALLOTMENTS_LIST, LLP_ALLOTMENTS_LIST } = load('server/investors/allotments.js');
const { createHoldingsReader, seesHoldings } = load('server/investors/holdings.js');

const P = '9007199254';
const FIN = `${P}740993001`, HARSHA = `${P}740993002`, ROHIT = `${P}740995001`, OTHER_IR = `${P}740995002`, IMRAN = `${P}740994001`;
const KIRAN = `${P}740997320`, JOSEPH = `${P}740997330`, ASHA = `${P}740997331`, FOREIGN = `${P}740997339`, NOHOLD = `${P}740997320`;
const EKA = `${P}740998101`, BLK = `${P}740998102`, STRAY_LLP = `${P}740998109`, ASHA_H = `${P}740997340`;
const NOW = Date.parse('2026-09-28T06:00:00Z');

const recorded = (dir, name) => JSON.parse(fs.readFileSync(path.join(fx, dir, `${name}.response.json`), 'utf8'));
const toResponse = (r) => new Response(r.status === 204 ? null : JSON.stringify(r.body), { status: r.status, headers: r.headers || {} });
const immediateGate = () => ({ async acquire() { return { waitedMs: 0, release() {} }; }, async run(_c, t) { return t(); }, snapshot() { return {}; } });
const creds = new Map();
before(async () => {
  for (const id of [FIN, HARSHA, ROHIT, OTHER_IR, IMRAN]) creds.set(id, await userCredential({ access_token: `synthetic-${id}`, api_domain: 'https://www.zohoapis.in', expires_in: 3_600 },
    { recordIdPrefix: P, gate: immediateGate(), log: createOpsLog(createMemorySink()), clock: () => NOW,
      fetch: async () => toResponse({ status: 200, body: { users: [{ id, status: 'active' }] } }) }));
});

const CONTACT = { [KIRAN]: 'contact-kiran', [JOSEPH]: 'contact-joseph', [ASHA]: 'contact-asha', [FOREIGN]: 'contact-foreign' };
function route(url, q) {
  const u = String(url);
  if (!q) {
    let m = u.match(/\/Contacts\/(\d+)\/Customer1\?/);
    if (m) return m[1] === KIRAN ? recorded('allotments', 'contact-allotments-kiran') : m[1] === JOSEPH ? recorded('allotments', 'contact-allotments-joseph')
      : m[1] === FOREIGN ? recorded('allotments', 'contact-allotments-foreign') : recorded('allotments', 'none');
    m = u.match(/\/LLP_Creation_Module\/(\d+)\/Customer_List\?/);
    if (m) return m[1] === EKA ? recorded('allotments', 'llp-allotments-eka') : m[1] === STRAY_LLP ? recorded('allotments', 'llp-allotments-stray') : recorded('allotments', 'none');
    m = u.match(/\/Contacts\/(\d+)\/ARL_Holdings\?/);
    if (m) return m[1] === JOSEPH ? recorded('holdings', 'holdings-joseph') : m[1] === ASHA ? recorded('holdings', 'holdings-foreign') : recorded('holdings', 'none');
    m = u.match(/\/ARL_Holdings\/(\d+)\/ARL_Transactions\?/);
    if (m) return m[1] === `${P}740998601` ? recorded('holdings', 'transactions-ccd') : recorded('holdings', 'none');
    throw new Error('unrouted GET ' + u);
  }
  if (/from Contacts/.test(q)) {
    const id = (q.match(/id = '(\d+)'/) || [])[1];
    if (id) return CONTACT[id] ? recorded('allotments', CONTACT[id]) : recorded('allotments', 'none');
    if (q.includes(`KAM = '${IMRAN}'`)) return recorded('allotments', 'contacts-own-book-imran');
    return recorded('allotments', 'none');
  }
  if (/from Receipts/.test(q)) return q.includes(`${P}740998411`) ? recorded('allotments', 'receipts-joseph') : recorded('allotments', 'none');
  throw new Error('unrouted query: ' + q);
}

function rig() {
  const calls = [];
  const sink = createMemorySink();
  const log = createOpsLog(sink);
  const refusals = [];
  const base = createInvestorEvents({ log, planeC: createPlaneCLog(createPlaneCMemorySink()), clock: () => NOW });
  const events = { ...base, refusal: (u, a, r, ids) => { refusals.push({ a, r, ids }); base.refusal(u, a, r, ids); } };
  const crm = createZohoClient({ recordIdPrefix: P, gate: immediateGate(), log, maxAttempts: 1, clock: () => NOW,
    fetch: async (url, init) => { const q = init && init.body ? JSON.parse(init.body).select_query : null; calls.push(q || `${(init && init.method) || 'GET'} ${String(url)}`); return toResponse(route(url, q)); } });
  return { crm, events, calls, refusals, sink, allot: createAllotmentReader({ crm, events }), hold: createHoldingsReader({ crm, events }) };
}
const writes = (calls) => calls.filter((c) => /^(POST|PUT|PATCH|DELETE) /.test(c) && !/\/coql/.test(c));

/* ---------------- M11-S02-T02: by Contact ---------------- */

test('the related-list API names are the org\'s (getRelatedLists, 28 Sep 2026)', () => {
  assert.equal(CONTACT_ALLOTMENTS_LIST, 'Customer1');
  assert.equal(LLP_ALLOTMENTS_LIST, 'Customer_List');
});

test('AC2: Kiran Joshi (two LLPs) for Finance — two rows, one per LLP, units, amount, status, agreement, payment status', async () => {
  const r = rig();
  const res = await r.allot.byContact(creds.get(HARSHA), 'head', KIRAN);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.deepEqual(res.rows.map((a) => [a.llp.id, a.llp.name, a.committedUnits, a.issuedUnits, a.unitPrice, a.amount, a.status, a.agreementSigned, a.paymentStatus, a.linked]), [
    [EKA, 'EKA LLP', 2, 0, 2500000, 5000000, 'Reserved', false, 'Yet to initiate', true],
    [BLK, 'Block B LLP', 3, 3, 2000000, 6000000, 'Issued', true, 'Yet to initiate', true],
  ]);
  assert.equal(r.calls.filter((c) => /\/Contacts\/\d+\/Customer1\?/.test(c)).length, 1, 'one related-list read');
  assert.equal(r.calls.filter((c) => /from Contacts/.test(c)).length, 1, 'one Contact admission');
  const rel = decodeURIComponent(r.calls.find((c) => /Customer1/.test(c)));
  assert.ok(!/Customer_Email|PAN|Bank|Aadhaar/i.test(rel), 'no identity field asked for');
  assert.equal(writes(r.calls).length, 0);
});

test('AC6: unit price and ticket are the allotment\'s as recorded — no LLP price is read', async () => {
  const r = rig();
  const res = await r.allot.byContact(creds.get(FIN), 'fin', KIRAN);
  assert.equal(res.rows[0].unitPrice, 2500000);
  assert.equal(r.calls.some((c) => /LLP_Creation_Module/.test(c)), false, 'the LLP (today\'s price) is never read');
});

test('AC5: a KAM sees only own investors — Joseph (own book) yes, without money; Kiran (not theirs) refused, logged, not read further', async () => {
  const r = rig();
  const own = await r.allot.byContact(creds.get(IMRAN), 'kam', JOSEPH);
  assert.equal(own.ok, true, JSON.stringify(own));
  assert.equal(own.money, false);
  assert.deepEqual(own.rows.map((a) => [a.committedUnits, a.status, a.unitPrice, a.amount, a.paymentStatus, a.agreementSigned]),
    [[1, 'Reserved', null, null, null, null], [2, 'Issued', null, null, null, null], [1, 'Cancelled', null, null, null, null]]);
  const rel = decodeURIComponent(r.calls.find((c) => /Customer1/.test(c)));
  assert.ok(!/Unit_Price|Amount|Capital|Token/.test(rel), 'the AM projection carries no money field: ' + rel);
  assert.equal(r.calls.some((c) => /from Receipts/.test(c)), false, 'no receipts for a KAM');

  const r2 = rig();
  const other = await r2.allot.byContact(creds.get(IMRAN), 'kam', KIRAN);
  assert.deepEqual([other.ok, other.kind, other.reason], [false, 'refused', 'not-own-lead']);
  assert.equal(r2.calls.some((c) => /Customer1/.test(c)), false, 'refused before the allotments are read');
  assert.ok(r2.refusals.some((x) => x.r === 'not-own-lead' && x.ids.includes(KIRAN)));
});

test('an IR reads allotments only for a Contact from their own lead, and never money', async () => {
  const r = rig();
  const own = await r.allot.byContact(creds.get(ROHIT), 'ir', KIRAN);
  assert.equal(own.ok, true, JSON.stringify(own));
  assert.deepEqual([own.money, own.paper, own.rows.length, own.rows[0].amount], [false, false, 2, null]);
  const other = await rig().allot.byContact(creds.get(OTHER_IR), 'ir', KIRAN);
  assert.deepEqual([other.ok, other.reason], [false, 'not-own-lead']);
  const denied = await rig().allot.byContact(creds.get(ROHIT), 'conv', KIRAN);
  assert.deepEqual([denied.ok, denied.reason], [false, 'seat-denied']);
});

test('a related row naming another Contact is scope drift: the read is refused, never trimmed', async () => {
  const r = rig();
  const res = await r.allot.byContact(creds.get(FIN), 'fin', FOREIGN);
  assert.deepEqual([res.ok, res.kind, res.reason], [false, 'refused', 'scope-drift']);
  assert.ok(r.refusals.some((x) => x.r === 'scope-drift'));
});

test('an investor with no allotment: an empty list, no Receipts read', async () => {
  const r = rig();
  const res = await r.allot.byContact(creds.get(FIN), 'fin', ASHA);
  assert.equal(res.ok, true);
  assert.deepEqual([res.rows.length, res.receipts.length], [0, 0]);
  assert.equal(r.calls.some((c) => /from Receipts/.test(c)), false);
});

test('a malformed id is refused without a call', async () => {
  const r = rig();
  const res = await r.allot.byContact(creds.get(FIN), 'fin', "1' or 1=1");
  assert.deepEqual([res.ok, res.reason, r.calls.length], [false, 'invalid-request', 0]);
});

/* ---------------- M11-S02-T02: by LLP ---------------- */

test('AC3 + AC4: Finance opens EKA LLP — every investor with units; the Cancelled allotment is listed but not counted', async () => {
  const r = rig();
  const res = await r.allot.byLlp(creds.get(HARSHA), 'head', EKA);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.deepEqual(res.rows.map((a) => [a.investor.name, a.committedUnits, a.status]),
    [['Kiran Joshi', 2, 'Reserved'], ['Joseph Mathew', 1, 'Reserved'], ['Joseph Mathew', 1, 'Cancelled'], ['Asha Varghese', 1, 'Reserved']]);
  assert.deepEqual(res.units, { reserved: 4, issued: 0 }, 'Cancelled units count as neither reserved nor issued');
  assert.equal(res.scoped, false);
  assert.equal(r.calls.filter((c) => /\/LLP_Creation_Module\/\d+\/Customer_List\?/.test(c)).length, 1);
  assert.equal(writes(r.calls).length, 0);
});

test('AC5 on Farms: a KAM opening EKA LLP sees only the allotments of their own investors, no money', async () => {
  const r = rig();
  const res = await r.allot.byLlp(creds.get(IMRAN), 'kam', EKA);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.deepEqual(res.rows.map((a) => [a.investor.id, a.status, a.amount]), [[JOSEPH, 'Reserved', null], [JOSEPH, 'Cancelled', null]]);
  assert.deepEqual([res.scoped, res.money, res.units.reserved], [true, false, 1]);
  assert.ok(r.calls.some((c) => /from Contacts/.test(c) && c.includes(`KAM = '${IMRAN}'`)), 'the KAM\'s book, read through the same WHERE clause');
});

test('an LLP related row naming another LLP is scope drift', async () => {
  const res = await rig().allot.byLlp(creds.get(FIN), 'fin', STRAY_LLP);
  assert.deepEqual([res.ok, res.reason], [false, 'scope-drift']);
});

/* ---------------- M10-S09-T01: ARL holdings ---------------- */

test('who sees the ARL panel: Finance, the viewers and the super user — never a KAM, the Head of AM, an IR or a lead seat', () => {
  for (const s of ['fin', 'head', 'comp', 'audit', 'exec', 'bu', 'di']) assert.equal(seesHoldings(s, FIN), true, s);
  for (const s of ['kam', 'amlead', 'ir', 'cp', 'conv', 'stranger']) assert.equal(seesHoldings(s, FIN), false, s);
});

test('AC1 + AC2: Joseph\'s holdings with instrument and amount; each with its transactions (type, date, amount), on the viewer token', async () => {
  const r = rig();
  const res = await r.hold.read(creds.get(HARSHA), 'head', JOSEPH);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.readOnly, true);
  assert.deepEqual(res.holdings.map((h) => [h.instrument, h.amount, h.transactions.length, h.conversionStatus]), [['CCD', 1000000, 2, 'Yet to convert'], ['Equity', 500000, 0, null]]);
  assert.deepEqual(res.holdings[0].transactions.map((t) => [t.type, t.date, t.amount]), [['Interest', '2026-03-31', 80000], ['Capital Call', '2025-04-01', 1000000]]);
  assert.equal(r.calls.filter((c) => /\/Contacts\/\d+\/ARL_Holdings\?/.test(c)).length, 1);
  assert.equal(r.calls.filter((c) => /\/ARL_Holdings\/\d+\/ARL_Transactions\?/.test(c)).length, 2, 'one related read per holding');
  const tx = decodeURIComponent(r.calls.find((c) => /ARL_Transactions\?/.test(c)));
  assert.ok(/Txn_Date/.test(tx) && !/fields=[^&]*\bDate\b(?!_)/.test(tx.replace('Txn_Date', '')), 'the org\'s Txn_Date, not Date');
  assert.equal(writes(r.calls).length, 0);
});

test('AC4: an investor with no holdings reads an empty list (the panel says "No ARL holdings")', async () => {
  const r = rig();
  const res = await r.hold.read(creds.get(FIN), 'fin', NOHOLD);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.deepEqual(res.holdings, []);
  assert.equal(r.calls.some((c) => /ARL_Transactions/.test(c)), false);
});

test('AC5: a KAM, the Head of AM and an IR are refused before anything is read', async () => {
  for (const [who, seat, id] of [[IMRAN, 'kam', JOSEPH], [IMRAN, 'amlead', JOSEPH], [ROHIT, 'ir', KIRAN]]) {
    const r = rig();
    const res = await r.hold.read(creds.get(who), seat, id);
    assert.deepEqual([res.ok, res.kind, res.reason], [false, 'refused', 'seat-denied'], seat);
    assert.equal(r.calls.length, 0, seat + ' reads nothing');
  }
});

test('a holding naming another investor is scope drift (refused, logged)', async () => {
  const r = rig();
  const res = await r.hold.read(creds.get(FIN), 'fin', ASHA);
  assert.deepEqual([res.ok, res.reason], [false, 'scope-drift']);
  assert.ok(r.refusals.some((x) => x.a === 'investor-arl-holdings' && x.r === 'scope-drift'));
});

test('AC3: the holdings route is read-only — it exports GET and no write verb, and the module has no write call', () => {
  const routeSrc = fs.readFileSync(path.join(srcRoot, 'app', 'api', 'investors', '[id]', 'holdings', 'route.ts'), 'utf8');
  assert.ok(/export const GET = withErrorCapture\(guardApi\("\/api\/investors"/.test(routeSrc));
  assert.equal(/export\s+(const|async function|function)\s+(POST|PUT|PATCH|DELETE)\b/.test(routeSrc), false);
  const mod = fs.readFileSync(path.join(srcRoot, 'server', 'investors', 'holdings.ts'), 'utf8');
  assert.equal(/\.(insert|update|upsert|delete|share|blueprintTransition)\(/.test(mod), false);
  for (const f of ['allotments', 'money']) {
    const s = fs.readFileSync(path.join(srcRoot, 'app', 'api', 'investors', '[id]', f, 'route.ts'), 'utf8');
    assert.equal(/export\s+(const|async function|function)\s+(POST|PUT|PATCH|DELETE)\b/.test(s), false, f);
  }
});
