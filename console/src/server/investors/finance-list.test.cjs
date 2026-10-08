/* M09-S01 INVESTORS LIST FOR FINANCE + M03-S09-T03 RECORD SHARE AT HAND-OFF.
 *
 * Run from console/: node --test src/server/investors/finance-list.test.cjs
 * Compiles the production modules and replays sanitized recorded Zoho responses
 * (src/lib/zoho/__fixtures__/investors). No request reaches Zoho.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { before, test } = require('node:test');

const consoleRoot = path.resolve(__dirname, '..', '..', '..');
const srcRoot = path.join(consoleRoot, 'src');
const fx = path.join(srcRoot, 'lib', 'zoho', '__fixtures__', 'investors');
const ts = require(path.join(consoleRoot, 'node_modules', 'typescript'));
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoho-finlist-'));
process.on('exit', () => fs.rmSync(outDir, { recursive: true, force: true }));

const config = ts.readConfigFile(path.join(consoleRoot, 'tsconfig.json'), ts.sys.readFile);
const project = ts.parseJsonConfigFileContent(config.config, ts.sys, consoleRoot);
const options = {
  ...project.options, incremental: false, tsBuildInfoFile: undefined, plugins: undefined,
  module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10,
  noEmit: false, noEmitOnError: true, outDir, rootDir: srcRoot,
};
const sources = ['server/investors/finance-list.ts', 'server/data/events.ts', 'server/money/register.ts'].map((f) => path.join(srcRoot, f));
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
const { createZohoClient, createZohoServiceClient, userCredential, serviceCredential } = load('lib/zoho/client.js');
const { createScopedCache, createMemoryStore } = load('lib/zoho/cache.js');
const { createPlaneCLog, createPlaneCMemorySink } = load('server/identity/plane-c.js');
const { createInvestorEvents } = load('server/data/events.js');
const { createFinanceInvestorList, buildFinanceRows, FINANCE_CONTACT_FIELDS, FINANCE_TTL_MS } = load('server/investors/finance-list.js');
const { createPaymentsRegister } = load('server/money/register.js');

const P = '9007199254';
const FIN = `${P}740993001`, ROHIT = `${P}740995001`, KAM = `${P}740994001`, KAVYA = `${P}740995009`;
const NOW = Date.parse('2026-09-28T06:00:00Z');
const recorded = (name) => JSON.parse(fs.readFileSync(path.join(fx, `${name}.response.json`), 'utf8'));
const toResponse = (r) => new Response(r.status === 204 ? null : JSON.stringify(r.body), { status: r.status, headers: r.headers || {} });
const immediateGate = () => ({ async acquire() { return { waitedMs: 0, release() {} }; }, async run(_c, t) { return t(); }, snapshot() { return {}; } });
const creds = new Map();
before(async () => {
  for (const id of [FIN, ROHIT, KAM]) creds.set(id, await userCredential({ access_token: `synthetic-${id}`, api_domain: 'https://www.zohoapis.in', expires_in: 3_600 },
    { recordIdPrefix: P, gate: immediateGate(), log: createOpsLog(createMemorySink()), clock: () => NOW,
      fetch: async () => toResponse({ status: 200, body: { users: [{ id, status: 'active' }] } }) }));
});

function route(q) {
  if (/from Contacts/.test(q)) return recorded('coql.finance-contacts');
  if (/from LLP_UnitAllocation_Module/.test(q)) return recorded('coql.finance-allotments');
  if (/from Receipts/.test(q)) return recorded('coql.finance-receipts');
  if (/from LLP_Creation_Module/.test(q)) return recorded('coql.finance-llps');
  throw new Error('unrouted ' + q);
}
function rig(router = route) {
  const queries = [];
  const sink = createMemorySink();
  const log = createOpsLog(sink);
  const events = createInvestorEvents({ log, planeC: createPlaneCLog(createPlaneCMemorySink()), clock: () => NOW });
  const crm = createZohoClient({ recordIdPrefix: P, gate: immediateGate(), log, maxAttempts: 1, clock: () => NOW,
    fetch: async (_u, init) => { const q = JSON.parse(init.body).select_query; queries.push(q); return toResponse(router(q)); } });
  const store = createMemoryStore({ clock: () => NOW });
  const cache = createScopedCache({ store, clock: () => NOW });
  return { list: createFinanceInvestorList({ crm, cache, events }), queries, sink, store };
}

test('the Finance projection names status fields only — no PAN, bank or Aadhaar', () => {
  for (const f of FINANCE_CONTACT_FIELDS) assert.ok(!/pan|bank|aadhaar|ifsc|isfc/i.test(f), f);
  assert.ok(FINANCE_CONTACT_FIELDS.includes('KYC') && FINANCE_CONTACT_FIELDS.includes('FEMA_Applicable') && FINANCE_CONTACT_FIELDS.includes('Residency'));
});

test('Finance reads every investor with units, farms, state, KYC, NRI, FEMA, paid, due and IR — on its own token', async () => {
  const r = rig();
  const res = await r.list.list(creds.get(FIN), 'fin');
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.deepEqual({ ...res.summary }, { onBook: 4, units: 12, kycNotPassed: 1, balanceOutstanding: 2, nri: 2, femaOutstanding: 1, saidYes: 0 });
  const by = Object.fromEntries(res.rows.map((x) => [x.name, x]));
  assert.deepEqual([by['Prakash Bhat'].paid, by['Prakash Bhat'].due, by['Prakash Bhat'].state], [250000, 2250000, 'reserved'], '₹2.5 L paid, ₹22.5 L due');
  assert.deepEqual([by['Joseph Mathew'].paid, by['Joseph Mathew'].due], [1000000, 9000000], '₹10 L paid, ₹90 L due — the reversed balance does not stand');
  assert.deepEqual([by['Joseph Mathew'].nri, by['Joseph Mathew'].kyc, by['Joseph Mathew'].fema], [true, 'pending', 'outstanding']);
  const asha = by['Asha Rao'];
  assert.equal(asha.units, 5, 'units are the total over both LLPs');
  assert.deepEqual(asha.farms.map((f) => f.name), ['EKA LLP', 'Fixture Two LLP'], 'the Farms column names both LLPs');
  assert.deepEqual([asha.state, asha.kyc, asha.fema, asha.nri], ['allocated', 'na', 'done', true]);
  assert.equal(by['Harish Gowda'].units, 2, 'a cancelled allotment is not counted');
  assert.equal(by['Harish Gowda'].city, 'Mysuru');
  assert.equal(by['Prakash Bhat'].ir, ROHIT);
  const out = JSON.stringify(res);
  assert.ok(!/FXPAN|FXBANK|PAN_Number|Bank_Account/.test(out), 'PAN and bank never come out');
  assert.ok(r.queries.every((q) => !/PAN|Bank|Aadhaar/i.test(q.split(' from ')[0])), 'no query selects them');
  assert.ok(r.queries.some((q) => /from Contacts where \(id is not null\)/.test(q)));
  const balance = res.rows.filter((x) => x.due > 0).map((x) => x.name).sort();
  assert.deepEqual(balance, ['Joseph Mathew', 'Prakash Bhat'], "'Balance outstanding' lists exactly the two reserved investors");
});

test('the list is offered to org and all scopes only; an IR, a KAM or the Head of AM is refused and it is logged', async () => {
  for (const [id, seat] of [[ROHIT, 'ir'], [KAM, 'kam'], [KAM, 'amlead'], [ROHIT, 'cp']]) {
    const r = rig();
    const res = await r.list.list(creds.get(id), seat);
    assert.deepEqual([res.ok, res.reason], [false, 'seat-denied'], seat);
    assert.equal(r.queries.length, 0, 'no Zoho call for a refused seat');
    assert.ok(r.sink.records().some((x) => x.action === 'finance-investors' && x.reason === 'seat-denied'));
  }
  assert.equal((await rig().list.list(creds.get(FIN), 'comp')).ok, true, 'Compliance reads it');
});

test('only the summary counts are cached, keyed by the visibility scope, for 60 s', async () => {
  assert.equal(FINANCE_TTL_MS, 60_000);
  const r = rig();
  const a = await r.list.summary(creds.get(FIN), 'fin');
  assert.equal(a.state, 'fresh');
  assert.deepEqual({ ...a.value }, { onBook: 4, units: 12, kycNotPassed: 1, balanceOutstanding: 2, nri: 2, femaOutstanding: 1, saidYes: 0 });
  const calls = r.queries.length;
  const b = await r.list.summary(creds.get(FIN), 'head');
  assert.equal(b.origin, 'cache', 'Head of Finance shares the org scope');
  assert.equal(r.queries.length, calls);
  assert.deepEqual([...(await r.store.keys())], ['role:org|org.investors.finance.summary']);
  assert.equal(await r.list.summary(creds.get(ROHIT), 'ir'), null, 'an IR gets no Finance number');
});

test('a Zoho failure is an error result, never an empty list passed off as the book', async () => {
  const r = rig((q) => (/from Receipts/.test(q) ? { status: 500, body: { code: 'INTERNAL_ERROR' } } : route(q)));
  const res = await r.list.list(creds.get(FIN), 'fin');
  assert.deepEqual([res.ok, res.kind, res.book], [false, 'source-error', 'receipts']);
});

/* B-02a: Zoho's COQL refuses the whole select (400 INVALID_QUERY) when the profile hides one column — KYC for Finance Ops. */
const hidesKyc = (q) => (/from Contacts/.test(q) && /\bKYC\b/.test(q.split(' from ')[0])
  ? { status: 400, body: { code: 'INVALID_QUERY', message: 'invalid column given', details: { column_name: 'KYC' }, status: 'error' } } : route(q));

test('B-02a: a hidden KYC column does not blank the list — it is re-read once without the status columns and says so', async () => {
  const r = rig(hidesKyc);
  const res = await r.list.list(creds.get(FIN), 'fin');
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.statusHidden, true);
  assert.equal(res.rows.length, 4, 'every investor is still listed');
  assert.ok(res.rows.every((x) => x.kyc === 'hidden' && x.kycOn === null && x.fema === null), 'KYC is "hidden", never passed off as "pending"');
  assert.deepEqual([res.summary.kycNotPassed, res.summary.femaOutstanding, res.summary.balanceOutstanding], [0, 0, 2], 'hidden status is not counted; money still is');
  const contactQs = r.queries.filter((q) => /from Contacts/.test(q));
  assert.equal(contactQs.length, 2, 'one refused read, one retry');
  assert.ok(!/KYC|FEMA/.test(contactQs[1].split(' from ')[0]), 'the retry selects no status column');
  assert.ok(!/PAN|Bank|Aadhaar/i.test(contactQs[1].split(' from ')[0]));
});

test('B-02a: a full read says statusHidden false; a refusal that survives the retry is still an error, not an empty book', async () => {
  const ok = await rig().list.list(creds.get(FIN), 'fin');
  assert.equal(ok.statusHidden, false);
  const bad = rig((q) => (/from Contacts/.test(q) ? { status: 400, body: { code: 'INVALID_QUERY', status: 'error' } } : route(q)));
  const res = await bad.list.list(creds.get(FIN), 'fin');
  assert.deepEqual([res.ok, res.kind, res.book, res.errorKind], [false, 'source-error', 'investors', 'invalid-data']);
  assert.equal(bad.queries.filter((q) => /from Contacts/.test(q)).length, 2, 'retried once only');
  const forbidden = rig((q) => (/from Contacts/.test(q) ? { status: 403, body: { code: 'NO_PERMISSION', status: 'error' } } : route(q)));
  const f = await forbidden.list.list(creds.get(FIN), 'fin');
  assert.deepEqual([f.ok, f.errorKind], [false, 'forbidden']);
  assert.equal(forbidden.queries.filter((q) => /from Contacts/.test(q)).length, 1, 'only invalid-data is retried');
});

/* M03-S09-T03 record share at hand-off: retired (D123) — Zoho field sharing (Originating_IR, IR_Access) grants the IR; the ir-guard re-checks every row. */

/* ---- M01-S08-NOTE-3: the Finance list reads money through money/ledger, so it agrees with the Payments register ---- */
test('NOTE-3: on mixed ledgers (refund, reversal of matched / pending, pending) each row equals the register — matched only (D21)', async () => {
  const U = 2_500_000;
  const id = (n) => `${P}74099${String(n).padStart(4, '0')}`;
  const C1 = id(7001), C2 = id(7002), A1 = id(7101), A2 = id(7102), LLP = id(7201);
  const allots = [
    { id: A1, Customer: C1, LLP_Lookup: LLP, Committed_Units: 1, Issued_Units: 0, Unit_Price: U, Allocation_Status: 'Reserved' },
    { id: A2, Customer: C2, LLP_Lookup: LLP, Committed_Units: 2, Issued_Units: 0, Unit_Price: U, Allocation_Status: 'Reserved' },
  ];
  let n = 0;
  const rc = (allotmentId, kind, amount, matchState, reversalOf = null) => ({ id: id(7300 + (++n)), allotmentId, kind, amount, mode: 'NEFT',
    utr: `SYNTHFIN${n}`, on: '2026-09-01', byId: FIN, matched: matchState === 'Matched', matchState, reversalOf });
  const r = [];
  r.push(rc(A1, 'Advance', 250_000, 'Matched'));               // 0 stands
  r.push(rc(A1, 'Part', 500_000, 'Pending'));                  // 1 pending — not paid (the old list counted it)
  r.push(rc(A1, 'Refund', 50_000, 'Matched'));                 // 2 money out
  r.push(rc(A1, 'Part', 300_000, 'Matched'));                  // 3 …cancelled by 4
  r.push(rc(A1, 'Refund', 300_000, 'Matched', r[3].id));       // 4 matched reversal of a matched receipt
  r.push(rc(A2, 'Advance', 500_000, 'Pending'));               // 5 …cancelled by 6
  r.push(rc(A2, 'Refund', 500_000, 'Matched', r[5].id));       // 6 matched reversal of a pending receipt
  r.push(rc(A2, 'Advance', 400_000, 'Matched'));               // 7 …taken back by 8, in pending only
  r.push(rc(A2, 'Refund', 400_000, 'Pending', r[7].id));       // 8 pending reversal of a matched receipt
  r.push(rc(A2, 'Balance', 100_000, 'Not found'));             // 9 counts nowhere
  const contacts = [{ id: C1, Last_Name: 'One', First_Name: 'Synthetic' }, { id: C2, Last_Name: 'Two', First_Name: 'Synthetic' }];
  const { rows } = buildFinanceRows(contacts, allots, r, new Map([[LLP, { name: 'Block S', block: 'S' }]]));
  const by = Object.fromEntries(rows.map((x) => [x.id, x]));
  assert.deepEqual([by[C1].paid, by[C1].due], [250_000, U - 200_000], 'C1: ₹2.5 L matched; due = ₹25 L − (₹2.5 L − ₹0.5 L); the pending ₹5 L and the reversed ₹3 L are not paid');
  assert.deepEqual([by[C2].paid, by[C2].due], [400_000, 2 * U - 400_000], 'C2: a pending reversal does not unpay a matched receipt; a reversed pending one never paid');

  // the register over the same rows (as Zoho returns them) — per allotment, through the farm filter of one investor's farm
  const zrow = (x) => ({ id: x.id, Allotment: { id: x.allotmentId }, Kind: x.kind, Amount: x.amount, Mode: x.mode, UTR: x.utr, Received_On: x.on,
    Match_State: x.matchState, Reversal_Of: x.reversalOf ? { id: x.reversalOf } : null, Created_By: { id: FIN } });
  const totalsFor = async (rowsFor) => {
    const crm = { async coql(_c, q) {
      const records = /from Receipts/.test(q) ? rowsFor.map(zrow)
        : allots.map((a) => ({ id: a.id, Customer: { id: a.Customer, name: 'x' }, LLP: { id: LLP, name: 'Block S' }, Allocation_Status: a.Allocation_Status,
          Issued_Units: a.Issued_Units, Reserved_Units: a.Committed_Units, Unit_Price: a.Unit_Price })).filter((a) => /Allocation_Status = 'Reserved'/.test(q) || q.includes(a.id));
      return { ok: true, value: { records, moreRecords: false, invalidRecordIds: null } };
    } };
    const reg = createPaymentsRegister({ crm, log: createOpsLog(createMemorySink()), recordIdPrefix: P, clock: () => NOW,
      access: { async recheck(cred) { return { actor: { userId: cred.userId }, seesRegister: true, seesUtr: true, canRecord: true }; } } });
    const out = await reg.read({ credential: creds.get(FIN), sessionId: 'synthetic-session-0001' });
    assert.equal(out.ok, true, JSON.stringify(out));
    return out.value.totals;
  };
  for (const [c, a] of [[C1, A1], [C2, A2]]) {
    const t = await totalsFor(r.filter((x) => x.allotmentId === a));
    const other = allots.find((x) => x.id !== a);
    const otherDue = other.Committed_Units * other.Unit_Price;   // the other allotment has no receipts in this read
    assert.deepEqual([by[c].paid, by[c].due], [t.received, t.stillDue - otherDue], `${c}: the list row equals the register`);
  }
  const all = await totalsFor(r);
  assert.deepEqual([rows.reduce((s, x) => s + x.paid, 0), rows.reduce((s, x) => s + x.due, 0)], [all.received, all.stillDue], 'the book totals agree');
});
