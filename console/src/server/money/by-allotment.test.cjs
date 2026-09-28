/* M10-S08-T01 — money grouped by allotment (per-farm Money blocks), cross-checked against the Payments
 * register and the allotment Payment_Status rule.
 *
 * Run from console/: node --test src/server/money/by-allotment.test.cjs
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
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoho-by-allotment-'));
process.on('exit', () => fs.rmSync(outDir, { recursive: true, force: true }));
const config = ts.readConfigFile(path.join(consoleRoot, 'tsconfig.json'), ts.sys.readFile);
const project = ts.parseJsonConfigFileContent(config.config, ts.sys, consoleRoot);
const options = { ...project.options, incremental: false, tsBuildInfoFile: undefined, plugins: undefined,
  module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10, noEmit: false, noEmitOnError: true, outDir, rootDir: srcRoot };
const program = ts.createProgram(['server/investors/allotments.ts', 'server/money/by-allotment.ts', 'server/money/register.ts', 'server/money/allotment-receipts.ts']
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
const { createMoneyByAllotment, groupByAllotment, moneyOf } = load('server/money/by-allotment.js');
const { createPaymentsRegister } = load('server/money/register.js');
const { createAllotmentReceiptWrites } = load('server/money/allotment-receipts.js');

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
  const allot = createAllotmentReader({ crm, events });
  return { crm, events, calls, refusals, sink, allot, money: createMoneyByAllotment({ allotments: allot }) };
}
const writes = (calls) => calls.filter((c) => /^(POST|PUT|PATCH|DELETE) /.test(c) && !/\/coql/.test(c));


const J1 = `${P}740998411`, J2 = `${P}740998412`, J3 = `${P}740998413`;
const rowsOf = (dir, name) => recorded(dir, name).body.data;
const ok = (records) => ({ ok: true, value: { records, moreRecords: false } });

test('AC1 + AC2: Joseph Mathew (two LLPs) for Finance — one block per allotment, each with only its own receipts', async () => {
  const r = rig();
  const res = await r.money.read(creds.get(HARSHA), 'head', JOSEPH);
  assert.equal(res.ok, true, JSON.stringify(res));
  const m = res.money;
  assert.deepEqual(m.blocks.map((b) => [b.llp.name, b.status, b.units, b.amount, b.paid, b.due, b.paymentStatus, b.countsInTotal, b.receipts.map((x) => x.id.slice(-3))]), [
    ['EKA LLP', 'Reserved', 1, 2500000, 250000, 2250000, 'Partial', true, ['501', '502']],
    ['Block B LLP', 'Issued', 2, 4000000, 4000000, 0, 'Full', true, ['503', '504']],
    ['EKA LLP', 'Cancelled', 1, 2500000, 250000, 0, 'Yet to initiate', false, ['505', '506']],
  ]);
  assert.deepEqual(m.blocks.map((b) => b.recorded), [500000, 0, 0], 'the Pending part is shown apart, never in paid/due (D21)');
  for (const b of m.blocks) assert.ok(b.receipts.every((x) => x.allotmentId === b.allotmentId), 'a block lists only its allotment\'s receipts');
  assert.deepEqual(m.unlinked, []);
  // one read per record: the Contact once, its allotments once, the Receipts once (by allotment id)
  assert.equal(r.calls.filter((c) => /from Contacts/.test(c)).length, 1);
  assert.equal(r.calls.filter((c) => /Customer1\?/.test(c)).length, 1);
  assert.equal(r.calls.filter((c) => /from Receipts/.test(c)).length, 1);
  assert.ok(/Allotment in \(/.test(r.calls.find((c) => /from Receipts/.test(c))));
});

test('AC3: the total sums paid and due over the blocks that count, and equals the Investors row (Cancelled left out)', async () => {
  const res = await rig().money.read(creds.get(FIN), 'fin', JOSEPH);
  assert.deepEqual(res.money.total, { paid: 4250000, due: 2250000 });
  assert.deepEqual(res.money.investorRow, res.money.total);
});

test('totals agree with the Payments register over the same receipts (received, still due)', async () => {
  const receipts = rowsOf('allotments', 'receipts-joseph'), allots = rowsOf('allotments', 'contact-allotments-joseph');
  const register = createPaymentsRegister({
    crm: { coql: async (_c, q) => /from Receipts/.test(q) ? ok(receipts)
      : /Allocation_Status = 'Reserved'/.test(q) ? ok(allots.filter((a) => a.Allocation_Status === 'Reserved')) : ok(allots.filter((a) => q.includes(a.id))) },
    access: { recheck: async (c) => ({ actor: { userId: c.userId }, seesRegister: true, seesUtr: true, canRecord: true }) },
    log: createOpsLog(createMemorySink()), recordIdPrefix: P, clock: () => NOW,
  });
  const reg = await register.read({ credential: creds.get(FIN), sessionId: 'sid_fixture_by_allotment_0000000000' });
  assert.equal(reg.ok, true, JSON.stringify(reg));
  const mine = (await rig().money.read(creds.get(FIN), 'fin', JOSEPH)).money;
  assert.equal(mine.blocks.reduce((t, b) => t + b.paid, 0), reg.value.totals.received, 'received');
  assert.equal(mine.investorRow.due, reg.value.totals.stillDue, 'still due');
  assert.equal(mine.blocks.reduce((t, b) => t + b.recorded, 0), reg.value.totals.recorded.net, 'recorded, not yet matched');
});

test('Payment_Status per block matches money/allotment-receipts for every allotment', async () => {
  const receipts = rowsOf('allotments', 'receipts-joseph'), allots = rowsOf('allotments', 'contact-allotments-joseph');
  const w = createAllotmentReceiptWrites({
    crm: { getRecord: async (_c, _m, id) => ({ ok: true, value: allots.find((a) => a.id === id) }),
      coql: async (_c, q) => ok(receipts.filter((x) => q.includes(`Allotment = '${x.Allotment.id}'`))) },
    replay: { replay: async () => { throw new Error('no writes'); } }, log: createOpsLog(createMemorySink()), recordIdPrefix: P, clock: () => NOW,
  });
  const mine = (await rig().money.read(creds.get(FIN), 'fin', JOSEPH)).money;
  for (const id of [J1, J2, J3]) {
    const ps = await w.paymentStatus({ credential: creds.get(FIN), sessionId: 'sid_fixture_by_allotment_0000000000' }, id);
    assert.equal(ps.ok, true, JSON.stringify(ps));
    const b = mine.blocks.find((x) => x.allotmentId === id);
    assert.deepEqual([b.paymentStatus, b.amount], [ps.value.expected, ps.value.amountRupees], id);
  }
});

test('AC4: an investor with one allotment gets a single block and no total line', () => {
  const one = [{ id: J1, investor: { id: JOSEPH, name: null }, llp: { id: `${P}740998101`, name: 'EKA LLP' }, status: 'Reserved', reservedUnits: 1, issuedUnits: 0,
    committedUnits: 1, unitPrice: 2500000, amount: 2500000, capitalInvested: null, paymentStatus: null, agreementSigned: null, investedOn: null, holdUntil: null, linked: true }];
  const g = groupByAllotment(JOSEPH, one, []);
  assert.deepEqual([g.blocks.length, g.total, g.investorRow], [1, null, { paid: 0, due: 2500000 }]);
  assert.equal(g.blocks[0].paymentStatus, 'Yet to initiate');
});

test('AC5: a KAM or an IR gets no Money section — refused before anything is read', async () => {
  for (const [who, seat, id] of [[IMRAN, 'kam', JOSEPH], [IMRAN, 'amlead', JOSEPH], [ROHIT, 'ir', KIRAN]]) {
    const r = rig();
    const res = await r.money.read(creds.get(who), seat, id);
    assert.deepEqual([res.ok, res.kind, res.reason], [false, 'refused', 'seat-denied'], seat);
    assert.equal(r.calls.length, 0, seat);
    assert.ok(r.refusals.some((x) => x.a === 'investor-money' && x.r === 'seat-denied'));
  }
});

test('moneyOf: only matched money is paid (D21); a Pending receipt is "recorded", a reversed one is nothing', () => {
  const rc = (kind, amount, matchState) => ({ id: 'x', allotmentId: J1, kind, amount, mode: null, utr: null, on: null, byId: null, matched: matchState === 'Matched', matchState, reversalOf: null });
  const a = { id: J1, status: 'Reserved', units: 1, unitPrice: 1000 };
  assert.deepEqual({ ...moneyOf(a, [rc('Advance', 400, 'Pending')]) }, { paid: 0, standing: 0, matchedNet: 0, amount: 1000, due: 1000, recorded: 400, paymentStatus: 'Yet to initiate' });
  assert.deepEqual({ ...moneyOf(a, [rc('Full', 1000, 'Matched'), rc('Advance', 50, 'Reversed')]) }, { paid: 1000, standing: 1000, matchedNet: 1000, amount: 1000, due: 0, recorded: 0, paymentStatus: 'Full' });
});
