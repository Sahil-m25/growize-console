/* M09-S03-T01 (the investor record) and M08-S07-T02 ("said yes" on Investors).
 *
 * Run from console/: node --test src/server/investors/record.test.cjs
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
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoho-record-'));
process.on('exit', () => fs.rmSync(outDir, { recursive: true, force: true }));
const config = ts.readConfigFile(path.join(consoleRoot, 'tsconfig.json'), ts.sys.readFile);
const project = ts.parseJsonConfigFileContent(config.config, ts.sys, consoleRoot);
const options = { ...project.options, incremental: false, tsBuildInfoFile: undefined, plugins: undefined,
  module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10, noEmit: false, noEmitOnError: true, outDir, rootDir: srcRoot };
const program = ts.createProgram(['server/investors/record.ts', 'server/investors/finance-list.ts', 'server/investors/lifecycle.ts', 'server/data/live.ts']
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
const { createScopedCache, createMemoryStore } = load('lib/zoho/cache.js');
const { createPlaneCLog, createPlaneCMemorySink } = load('server/identity/plane-c.js');
const { createInvestorEvents } = load('server/data/events.js');
const { createLiveDataLayer } = load('server/data/live.js');
const { createInvestorRecordReader, recordConflict, sectionsFor, RECORD_CONFLICT_MESSAGE } = load('server/investors/record.js');
const { createFinanceInvestorList } = load('server/investors/finance-list.js');
const { stateLabel } = load('server/investors/lifecycle.js');

const P = '9007199254';
const FIN = `${P}740993001`, HARSHA = `${P}740993002`, ROHIT = `${P}740995001`, OTHER_IR = `${P}740995002`, IMRAN = `${P}740994001`;
const PRAKASH = `${P}740997301`, KIRAN = `${P}740997320`, MEERA = `${P}740997321`, RADHIKA = `${P}740994101`, NEHA_ACCOUNT = `${P}740994201`;
const NOW = Date.parse('2026-09-28T06:00:00Z');
const SID = 'sid_fixture_record_000000000000000000000';

const recorded = (dir, name) => JSON.parse(fs.readFileSync(path.join(fx, dir, `${name}.response.json`), 'utf8'));
const toResponse = (r) => new Response(r.status === 204 ? null : JSON.stringify(r.body), { status: r.status, headers: r.headers || {} });
const immediateGate = () => ({ async acquire() { return { waitedMs: 0, release() {} }; }, async run(_c, t) { return t(); }, snapshot() { return {}; } });
const creds = new Map();
before(async () => {
  for (const id of [FIN, HARSHA, ROHIT, OTHER_IR, IMRAN]) creds.set(id, await userCredential({ access_token: `synthetic-${id}`, api_domain: 'https://www.zohoapis.in', expires_in: 3_600 },
    { recordIdPrefix: P, gate: immediateGate(), log: createOpsLog(createMemorySink()), clock: () => NOW,
      fetch: async () => toResponse({ status: 200, body: { users: [{ id, status: 'active' }] } }) }));
});

const CONTACT = { [PRAKASH]: 'record.contact-prakash', [KIRAN]: 'record.contact-kiran', [RADHIKA]: 'record.contact-radhika', [NEHA_ACCOUNT]: 'record.contact-neha-account' };
function route(url, q) {
  const u = String(url);
  if (!q) {
    const att = u.match(/\/(Contacts|LLP_UnitAllocation_Module|LLP_Creation_Module)\/(\d+)\/Attachments/);
    if (att) return recorded('investors', att[1] === 'Contacts' ? 'record.attachments-contact' : att[1] === 'LLP_Creation_Module' ? 'record.attachments-llp' : 'record.attachments-allotment');
    const one = u.match(/\/Contacts\/(\d+)(\?|$)/);
    if (one) return CONTACT[one[1]] ? recorded('investors', CONTACT[one[1]]) : recorded('data', 'coql.none');
    throw new Error('unrouted GET ' + u);
  }
  if (/from Leads/.test(q)) return recorded('investors', 'coql.said-yes-leads');
  if (/from Contacts/.test(q)) return /Originating_IR = /.test(q) ? recorded('investors', 'coql.said-yes-own-lead') : recorded('investors', 'coql.said-yes-contacts');
  if (/from LLP_UnitAllocation_Module/.test(q)) {
    if (q.includes(PRAKASH)) return recorded('investors', 'record.allotments-prakash');
    if (q.includes(RADHIKA)) return recorded('investors', 'record.allotments-radhika');
    return recorded('data', 'coql.none');
  }
  if (/from Receipts/.test(q)) return q.includes(`${P}740998301`) ? recorded('investors', 'record.receipts-prakash') : recorded('data', 'coql.none');
  if (/from LLP_Creation_Module/.test(q)) return recorded('investors', 'coql.finance-llps');
  if (/from Cases/.test(q)) return recorded('data', 'coql.none');
  throw new Error('unrouted query: ' + q);
}

function rig() {
  const calls = [];
  const sink = createMemorySink();
  const log = createOpsLog(sink);
  const events = createInvestorEvents({ log, planeC: createPlaneCLog(createPlaneCMemorySink()), clock: () => NOW });
  const crm = createZohoClient({ recordIdPrefix: P, gate: immediateGate(), log, maxAttempts: 1, clock: () => NOW,
    fetch: async (url, init) => { const q = init && init.body ? JSON.parse(init.body).select_query : null; calls.push(q || `GET ${String(url)}`); return toResponse(route(url, q)); } });
  const cache = createScopedCache({ store: createMemoryStore({ clock: () => NOW }), clock: () => NOW });
  return { crm, events, sink, calls, cache, reader: createInvestorRecordReader({ crm, events }) };
}

/* ---------------- M09-S03-T01 ---------------- */

test('sections by seat: Finance has Money and Paper; an AM seat has Care instead; an IR neither', () => {
  assert.deepEqual([...sectionsFor('fin', FIN)], ['who', 'hold', 'money', 'paper', 'jrn', 'tkt']);
  assert.deepEqual([...sectionsFor('head', HARSHA)], ['who', 'hold', 'money', 'paper', 'jrn', 'tkt']);
  assert.deepEqual([...sectionsFor('kam', IMRAN)], ['who', 'hold', 'care', 'jrn', 'tkt']);
  assert.deepEqual([...sectionsFor('amlead', IMRAN)], ['who', 'hold', 'care', 'jrn', 'tkt']);
  assert.deepEqual([...sectionsFor('ir', ROHIT)], ['who', 'hold', 'jrn']);
  assert.equal(sectionsFor('conv', ROHIT), null);
  assert.equal(sectionsFor('stranger', ROHIT), null);
});

test('TC-IM04-007 (data): Prakash Bhat for Finance — one GET, allotment with LLP, receipts, D70 paper, version kept', async () => {
  const r = rig();
  const res = await r.reader.read(creds.get(HARSHA), 'head', PRAKASH);
  assert.equal(res.ok, true, JSON.stringify(res));
  const x = res.record;
  assert.equal(r.calls.filter((c) => /GET .*\/Contacts\/\d+\?/.test(c)).length, 1, 'one GET per Contact');
  assert.equal(x.version, '2026-09-21T09:30:00+05:30', 'Modified_Time kept for If-Unmodified-Since');
  assert.deepEqual([x.investor.n, x.state, x.kyc.status, x.investor.kyc, x.investor.units], ['Prakash Bhat', 'reserved', 'passed', 'passed', 1]);
  assert.deepEqual(x.holdings.map((h) => [h.llpName, h.committed, h.issued, h.status, h.agreementSigned, h.paymentStatus]),
    [['EKA LLP', 1, 0, 'Reserved', false, 'Partial']]);
  assert.deepEqual([x.money.paid, x.money.due, x.money.receipts.length], [250000, 2250000, 1], '₹22.5 L due');
  assert.deepEqual(x.hold, { until: '2026-09-23', extension: null }, 'the hold ends 23 Sep');
  assert.deepEqual([x.paper.personal.length, x.paper.allotments.length, x.paper.allotments[0].files.length, x.paper.farms.length, x.paper.farms[0].files.length], [1, 1, 1, 1, 1]);
  assert.equal(x.paper.personal[0].name, 'Signed NDA.pdf');
  assert.deepEqual(x.origin, { leadId: `${P}740996401`, irId: ROHIT, irVia: 'contact', saidYesAt: '2026-08-20T11:00' });
  const get = r.calls.find((c) => /\/Contacts\/\d+\?/.test(c));
  assert.ok(!/PAN|Bank|Aadhaar|ISFC/i.test(decodeURIComponent(get)), 'no identity field asked for');
  assert.ok(!JSON.stringify(x).includes('FXPAN'), 'no identity value');
});

test('TC-IM04-008 (data): a KAM\'s record of Radhika has Care, no Money, no Paper — neither is even read', async () => {
  const r = rig();
  const res = await r.reader.read(creds.get(IMRAN), 'kam', RADHIKA);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.deepEqual([...res.record.sections], ['who', 'hold', 'care', 'jrn', 'tkt']);
  assert.deepEqual([res.record.money, res.record.paper, res.record.kyc], [null, null, null]);
  assert.deepEqual(res.record.holdings.map((h) => [h.committed, h.status, h.paymentStatus, h.agreementSigned]), [[2, 'Issued', null, null]]);
  assert.equal(r.calls.some((c) => /from Receipts|Attachments/.test(c)), false);
  for (const c of r.calls.filter((x) => /from LLP_UnitAllocation_Module/.test(x))) assert.ok(!/Unit_Price|Amount|Token/.test(c.split(' from ')[0]), c);
  assert.ok(!/KYC|FEMA/.test(decodeURIComponent(r.calls.find((c) => /\/Contacts\/\d+\?/.test(c)))), 'no Finance status for a KAM');
});

test('a KAM opening another KAM\'s account, or an IR another IR\'s investor, is refused (logged), never read further', async () => {
  const r = rig();
  const a = await r.reader.read(creds.get(IMRAN), 'kam', NEHA_ACCOUNT);
  assert.deepEqual([a.ok, a.kind, a.reason], [false, 'refused', 'not-own-lead']);
  const b = await r.reader.read(creds.get(OTHER_IR), 'ir', KIRAN);
  assert.deepEqual([b.ok, b.reason], [false, 'not-own-lead']);
  const c = await r.reader.read(creds.get(FIN), 'fin', `${P}740997399`);
  assert.deepEqual([c.ok, c.reason], [false, 'not-visible'], 'a record Zoho does not return is refused, not "not found"');
  assert.equal(r.calls.some((x) => /from LLP_UnitAllocation_Module|from Receipts|Attachments/.test(x)), false);
  const refusals = r.sink.records().filter((x) => x.kind === 'refusal' && x.action === 'investor-record');
  assert.equal(refusals.length, 3);
  assert.ok(refusals.every((x) => !('body' in x)));
});

test('AC6: an IR opening an investor from their own lead gets only the IR sections, PII masked', async () => {
  const r = rig();
  const res = await r.reader.read(creds.get(ROHIT), 'ir', KIRAN);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.deepEqual([...res.record.sections], ['who', 'hold', 'jrn']);
  assert.deepEqual([res.record.investor.pan, res.record.investor.aadh, res.record.investor.bank.acct, res.record.money, res.record.paper], [null, null, '', null, null]);
  assert.equal(r.calls.some((c) => /from Receipts|Attachments/.test(c)), false);
});

test('AC7: a write\'s 412 is the in-page refusal "Changed by someone else — reload", logged by id', () => {
  const r = rig();
  const out = recordConflict(r.events, FIN, 'investor-record-write', { kind: 'conflict', status: 412, code: 'ALREADY_MODIFIED', recordId: PRAKASH });
  assert.deepEqual({ ...out }, { ok: false, kind: 'conflict', recordId: PRAKASH, message: 'Changed by someone else — reload.' });
  assert.equal(RECORD_CONFLICT_MESSAGE, 'Changed by someone else — reload.');
  assert.equal(recordConflict(r.events, FIN, 'x', { kind: 'server', status: 500, code: 'INTERNAL_ERROR' }), null);
  const line = r.sink.records().find((x) => x.reason === 'already-modified');
  assert.deepEqual(line.recordIds, [PRAKASH]);
});

/* ---------------- M08-S07-T02 ---------------- */

test('the state label: the blueprint\'s when read, else the allotments\', else "said yes"', () => {
  assert.equal(stateLabel({ blueprint: 'Said yes', derived: null, saidYesAt: null }), 'said yes');
  assert.equal(stateLabel({ blueprint: 'Allotted', derived: 'reserved', saidYesAt: null }), 'allocated');
  assert.equal(stateLabel({ blueprint: 'Unknown', derived: 'paid', saidYesAt: '2026-09-01' }), 'paid');
  assert.equal(stateLabel({ derived: null, saidYesAt: '2026-09-27T16:00' }), 'said yes');
  assert.equal(stateLabel({ derived: null, saidYesAt: null }), null);
});

test('TC-IM11-004 (data): said-yes Contacts are on Finance\'s list, the IR resolved through the Lead when missing', async () => {
  const r = rig();
  const list = createFinanceInvestorList({ crm: r.crm, cache: r.cache, events: r.events });
  const res = await list.list(creds.get(FIN), 'fin');
  assert.equal(res.ok, true, JSON.stringify(res));
  const by = Object.fromEntries(res.rows.map((x) => [x.name, x]));
  assert.deepEqual([by['Kiran Joshi'].code, by['Kiran Joshi'].stateLabel, by['Kiran Joshi'].state, by['Kiran Joshi'].ir, by['Kiran Joshi'].lead],
    ['ARL-INV-0220', 'said yes', null, ROHIT, `${P}740996421`]);
  assert.deepEqual([by['Meera Iyer'].stateLabel, by['Meera Iyer'].ir], ['said yes', ROHIT], 'no Originating_IR → the Origin_Lead\'s owner');
  assert.equal(res.summary.saidYes, 2);
  const leadsQ = r.calls.filter((c) => /from Leads/.test(c));
  assert.equal(leadsQ.length, 1, 'only the Contact without Originating_IR is looked up');
  assert.match(leadsQ[0], new RegExp(`id in \\('${P}740996422'\\)`));
});

test('TC-IM11-004 (data): Kiran\'s record for Finance reads "said yes" and names Rohit and the lead on the Journey', async () => {
  const r = rig();
  const res = await r.reader.read(creds.get(FIN), 'fin', KIRAN);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.deepEqual([res.record.investor.n, res.record.state, res.record.holdings.length], ['Kiran Joshi', 'said yes', 0]);
  assert.deepEqual(res.record.origin, { leadId: `${P}740996421`, irId: ROHIT, irVia: 'contact', saidYesAt: '2026-09-27T16:00' });
});

test('D69: Rohit\'s own-lead Investors book lists Kiran, from his lead', async () => {
  const r = rig();
  const layer = createLiveDataLayer({ crm: r.crm, cache: r.cache, log: createOpsLog(createMemorySink()), events: r.events, recordIdPrefix: P, clock: () => NOW,
    recheck: async () => ({ credential: creds.get(ROHIT), session: { who: ROHIT, seat: 'ir' } }) });
  const scoped = r.calls.length;
  const one = await layer.investor({ credential: creds.get(ROHIT), session: { who: ROHIT, seat: 'ir' }, sessionId: SID }, KIRAN);
  assert.equal(one.ok, true, JSON.stringify(one));
  assert.equal(one.investor.n, 'Kiran Joshi');
  assert.equal(one.investor.ir, ROHIT);
  assert.ok(r.calls.slice(scoped).some((q) => new RegExp(`from Contacts where \\(id = '${KIRAN}'\\)`).test(q)), 'the guard reads the Contact by id');
});
