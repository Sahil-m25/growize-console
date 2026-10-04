/* M09-S08 — AN IR SEES ONLY INVESTORS FROM THEIR OWN LEADS (D69, D113 ruling 2).
 *
 * Run from console/: node --test src/server/investors/ir-investors.test.cjs
 * Replays recorded Zoho responses (__fixtures__/investors, __fixtures__/data). No request reaches Zoho.
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
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoho-irinv-'));
process.on('exit', () => fs.rmSync(outDir, { recursive: true, force: true }));
const config = ts.readConfigFile(path.join(consoleRoot, 'tsconfig.json'), ts.sys.readFile);
const project = ts.parseJsonConfigFileContent(config.config, ts.sys, consoleRoot);
const options = { ...project.options, incremental: false, tsBuildInfoFile: undefined, plugins: undefined,
  module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10, noEmit: false, noEmitOnError: true, outDir, rootDir: srcRoot };
const program = ts.createProgram(['server/investors/ir-list.ts', 'server/investors/record.ts', 'server/access/guard-core.ts', 'server/data/events.ts']
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
const { createIrInvestorList, IR_LIST_FIELDS, IR_FARM_FIELDS } = load('server/investors/ir-list.js');
const { createInvestorRecordReader, IR_SECTIONS } = load('server/investors/record.js');
const { seatPresets, apiRuleOf, API_ROUTES } = load('server/access/guard-core.js');

const P = '9007199254';
const FIN = `${P}740993001`, ROHIT = `${P}740995001`, OTHER_IR = `${P}740995002`, IMRAN = `${P}740994001`;
const PRAKASH = `${P}740997301`, KIRAN = `${P}740997320`;
const NOW = Date.parse('2026-09-28T06:00:00Z');
const recorded = (dir, name) => JSON.parse(fs.readFileSync(path.join(fx, dir, `${name}.response.json`), 'utf8'));
const toResponse = (r) => new Response(r.status === 204 ? null : JSON.stringify(r.body), { status: r.status, headers: r.headers || {} });
const immediateGate = () => ({ async acquire() { return { waitedMs: 0, release() {} }; }, async run(_c, t) { return t(); }, snapshot() { return {}; } });
const creds = new Map();
before(async () => {
  for (const id of [FIN, ROHIT, OTHER_IR, IMRAN]) creds.set(id, await userCredential({ access_token: `synthetic-${id}`, api_domain: 'https://www.zohoapis.in', expires_in: 3_600 },
    { recordIdPrefix: P, gate: immediateGate(), log: createOpsLog(createMemorySink()), clock: () => NOW,
      fetch: async () => toResponse({ status: 200, body: { users: [{ id, status: 'active' }] } }) }));
});

/* Zoho answers a select by its WHERE: Rohit's own-lead filter returns his two investors, any other IR's filter returns none. */
let contactsFx = 'coql.ir-own-contacts';
function route(url, q) {
  if (!q) {
    const one = String(url).match(/\/Contacts\/(\d+)(\?|$)/);
    if (one && one[1] === KIRAN) return recorded('investors', 'record.contact-kiran');
    if (one && one[1] === PRAKASH) return recorded('investors', 'record.contact-prakash');
    return recorded('data', 'coql.none');
  }
  if (/from Contacts/.test(q)) return q.includes(`Originating_IR = '${ROHIT}'`) ? recorded('investors', contactsFx) : recorded('data', 'coql.none');
  if (/from LLP_UnitAllocation_Module/.test(q)) return q.includes(PRAKASH) ? recorded('investors', 'record.allotments-prakash') : recorded('data', 'coql.none');
  if (/from LLP_Creation_Module/.test(q)) return recorded('investors', 'coql.finance-llps');
  if (/from Receipts|from Cases/.test(q)) return recorded('data', 'coql.none');
  throw new Error('unrouted query: ' + q);
}
function rig(router = route) {
  const calls = [];
  const sink = createMemorySink();
  const log = createOpsLog(sink);
  const events = createInvestorEvents({ log, planeC: createPlaneCLog(createPlaneCMemorySink()), clock: () => NOW });
  const crm = createZohoClient({ recordIdPrefix: P, gate: immediateGate(), log, maxAttempts: 1, clock: () => NOW,
    fetch: async (url, init) => { const q = init && init.body ? JSON.parse(init.body).select_query : null; calls.push(q || `GET ${String(url)}`); return toResponse(router(url, q)); } });
  return { calls, sink, list: createIrInvestorList({ crm, events }), record: createInvestorRecordReader({ crm, events }) };
}
const MONEY = /2500000|250000|2250000|Unit_Price|Ticket|Amount|Token|Receivable|Annual_Rental_Yield|Pet_Unit_Price|yield|receipt/i;
const IDENT = /PAN|Aadhaar|Bank|IFSC|KYC|FEMA|Mobile|Email|Mailing|Nominee|Residency|KAM/;

test('the IR list selects name, ARL code, the lead link and Said_Yes_At only — no identity, no money, checked at load', () => {
  assert.deepEqual([...IR_LIST_FIELDS], ['id', 'ARL_ID', 'First_Name', 'Last_Name', 'Origin_Lead', 'Originating_IR', 'Said_Yes_At']);
  assert.deepEqual([...IR_FARM_FIELDS], ['id', 'Name', 'Block_Code']);
  for (const f of [...IR_LIST_FIELDS, ...IR_FARM_FIELDS]) { assert.ok(!MONEY.test(f), f); assert.ok(!IDENT.test(f), f); }
});

test('AC1: Rohit lists exactly the investors from his own leads — on his own token, with his own filter in the WHERE', async () => {
  const r = rig();
  const res = await r.list.list(creds.get(ROHIT), 'ir');
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.deepEqual(res.rows.map((x) => [x.code, x.name]), [['ARL-INV-0220', 'Kiran Joshi'], ['ARL-INV-0208', 'Prakash Bhat']], 'by name');
  const [kiran, prakash] = res.rows;
  assert.deepEqual([...Object.keys(prakash)].sort(), ['code', 'farms', 'id', 'leadId', 'name', 'state'], 'the NOTE-3 columns and nothing else');
  assert.deepEqual([prakash.state, prakash.leadId, prakash.farms.map((f) => ({ ...f }))], ['reserved', `${P}740996401`, [{ llpId: `${P}740998101`, name: 'EKA LLP', block: 'A', units: 1 }]]);
  assert.deepEqual([kiran.state, kiran.leadId, kiran.farms.length], ['said yes', `${P}740996421`, 0], 'said yes, nothing allotted yet');
  const contactsQ = r.calls.find((c) => /from Contacts/.test(c));
  assert.ok(contactsQ.includes(`Originating_IR = '${ROHIT}' and Origin_Lead is not null`), contactsQ);
  assert.equal(contactsQ.split(' from ')[0], `select ${IR_LIST_FIELDS.join(', ')}`);
});

test('AC4: no price, amount, yield or receipt comes out — and none is selected — though the recorded allotment row carries them', async () => {
  const r = rig();
  const res = await r.list.list(creds.get(ROHIT), 'ir');
  assert.ok(JSON.stringify(recorded('investors', 'record.allotments-prakash')).match(/2500000/), 'the replayed Zoho row does carry a price');
  const out = JSON.stringify(res);
  assert.ok(!MONEY.test(out), out);
  assert.ok(!IDENT.test(out.replace(/ARL_ID/g, '')), out);
  for (const q of r.calls) {
    const sel = q.split(' from ')[0];
    assert.ok(!MONEY.test(sel) && !/PAN|Aadhaar|Bank|IFSC|KYC|FEMA|Mobile|Email|Mailing|Nominee/.test(sel), sel);
  }
  assert.equal(r.calls.some((c) => /from Receipts|from Cases/.test(c)), false, 'no receipt, no case is read for the list');
});

test('AC2: another IR lists none of Rohit\'s investors — Zoho is asked with that IR\'s own filter and returns nothing', async () => {
  const r = rig();
  const res = await r.list.list(creds.get(OTHER_IR), 'ir');
  assert.deepEqual([res.ok, res.rows.length], [true, 0]);
  assert.ok(r.calls[0].includes(`Originating_IR = '${OTHER_IR}'`));
  assert.equal(r.calls.some((c) => /LLP_UnitAllocation_Module/.test(c)), false, 'with nothing admitted, no allotment is read');
});

test('a row Zoho returns that is not the IR\'s refuses the whole read (sharing drift), logged by id, nothing passed on', async () => {
  contactsFx = 'coql.ir-foreign-row';
  try {
    const r = rig();
    const res = await r.list.list(creds.get(ROHIT), 'ir');
    assert.deepEqual([res.ok, res.kind, res.reason], [false, 'refused', 'not-own-lead']);
    assert.equal(r.calls.some((c) => /LLP_UnitAllocation_Module|LLP_Creation_Module/.test(c)), false);
    const line = r.sink.records().find((x) => x.kind === 'refusal' && x.action === 'ir-investors');
    assert.deepEqual([line.reason, line.recordIds], ['not-own-lead', [`${P}740997330`]]);
    assert.ok(!('body' in line));
  } finally { contactsFx = 'coql.ir-own-contacts'; }
});

test('any seat but the IR is refused with no Zoho call, and the refusal is logged', async () => {
  for (const [id, seat] of [[FIN, 'fin'], [IMRAN, 'kam'], [IMRAN, 'amlead'], [ROHIT, 'conv'], [ROHIT, 'cp'], [FIN, 'head'], [FIN, 'ops'], [ROHIT, 'nobody']]) {
    const r = rig();
    const res = await r.list.list(creds.get(id), seat);
    assert.deepEqual([res.ok, res.kind, res.reason], [false, 'refused', 'seat-denied'], seat);
    assert.equal(r.calls.length, 0, seat);
    assert.ok(r.sink.records().some((x) => x.action === 'ir-investors' && x.reason === 'seat-denied'), seat);
  }
});

test('a Zoho failure is an error result, never an empty list passed off as the book', async () => {
  const r = rig((u, q) => (q && /LLP_UnitAllocation_Module/.test(q) ? { status: 500, body: { code: 'INTERNAL_ERROR' } } : route(u, q)));
  const res = await r.list.list(creds.get(ROHIT), 'ir');
  assert.deepEqual([res.ok, res.kind, res.book], [false, 'source-error', 'allotments']);
});

test('the record an IR opens: who, hold and journey only; no money, paper or care, and no price asked of Zoho (AC4)', async () => {
  const r = rig();
  const res = await r.record.read(creds.get(ROHIT), 'ir', PRAKASH);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.deepEqual([...res.record.sections], [...IR_SECTIONS]);
  assert.deepEqual([...IR_SECTIONS], ['who', 'hold', 'jrn']);
  assert.deepEqual([res.record.money, res.record.paper, res.record.kyc, res.record.fema], [null, null, null, null]);
  assert.deepEqual(res.record.holdings.map((h) => [h.committed, h.status, h.paymentStatus, h.agreementSigned]), [[1, 'Reserved', null, null]]);
  const out = JSON.stringify(res.record);
  assert.ok(!/2500000|250000|2250000|Unit_Price|FXPAN|FXBANK/.test(out), 'no price, amount or identity in the record');
  const get = decodeURIComponent(r.calls.find((c) => /\/Contacts\/\d+\?/.test(c)));
  assert.ok(!/Mailing_Street|Mailing_Flat|Mailing_Zip|Nominee|KYC|FEMA|PAN|Bank|Aadhaar/.test(get), 'no street address, nominee or identity asked for: ' + get);
  assert.equal(r.calls.some((c) => /from Receipts|Attachments/.test(c)), false);
  for (const c of r.calls.filter((x) => /from LLP_UnitAllocation_Module/.test(x))) assert.ok(!/Unit_Price|Amount|Token|Yield/.test(c.split(' from ')[0]), c);
});

test('AC2: another IR\'s investor by id does not open and nothing of it is read from Zoho', async () => {
  const r = rig();
  const res = await r.record.read(creds.get(OTHER_IR), 'ir', PRAKASH);
  assert.deepEqual([res.ok, res.kind], [false, 'refused']);
  assert.equal(r.calls.some((c) => /\/Contacts\/\d+\?|from LLP_UnitAllocation_Module|from Receipts|Attachments/.test(c)), false, 'refused before the record GET');
  assert.ok(r.sink.records().some((x) => x.kind === 'refusal' && x.action === 'investor-record'));
});

test('the IR seat reaches the Investors page and the list route; the page is the same one every Investors seat holds', () => {
  const presets = seatPresets();
  assert.ok(presets['investor-relations'].pages.includes('inv'), 'Investors is in the IR rail');
  assert.deepEqual(presets['investor-relations'].pages.filter((p) => ['inv', 'farms', 'tkt', 'invupd'].includes(p)), ['inv'], 'only Investors of the Investors-only band');
  assert.ok(!presets['ir-manager'].pages.includes('inv') && !presets['channel-partner'].pages.includes('inv'), 'the IR Manager and a channel partner get none');
  assert.deepEqual({ ...API_ROUTES['/api/investors/mine'] }, { kind: 'page', page: 'inv' });
  assert.equal(apiRuleOf('/api/investors/mine').key, '/api/investors/mine');
});
