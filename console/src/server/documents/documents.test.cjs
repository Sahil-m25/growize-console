/* M12-S01-T03 (scoped document reads, D70) and the T01 scope table as code.
 *
 * Run from console/: node --test src/server/documents/documents.test.cjs
 * Replays recorded Zoho responses (__fixtures__/documents). No request reaches Zoho.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { before, test } = require('node:test');

const consoleRoot = path.resolve(__dirname, '..', '..', '..');
const srcRoot = path.join(consoleRoot, 'src');
const fx = path.join(srcRoot, 'lib', 'zoho', '__fixtures__', 'documents');
const ts = require(path.join(consoleRoot, 'node_modules', 'typescript'));
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoho-documents-'));
process.on('exit', () => fs.rmSync(outDir, { recursive: true, force: true }));
const config = ts.readConfigFile(path.join(consoleRoot, 'tsconfig.json'), ts.sys.readFile);
const project = ts.parseJsonConfigFileContent(config.config, ts.sys, consoleRoot);
const options = { ...project.options, incremental: false, tsBuildInfoFile: undefined, plugins: undefined,
  module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10, noEmit: false, noEmitOnError: true, outDir, rootDir: srcRoot };
const program = ts.createProgram(['server/documents/reader.ts', 'server/investors/record.ts', 'server/access/guard-core.ts']
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
const { createDocumentsReader } = load('server/documents/reader.js');
const { docAccessFor, holdsLlp, heldLlps } = load('server/documents/scope.js');
const { ATTACHMENT_FIELDS, maskFileName } = load('server/documents/attachments.js');
const record = load('server/investors/record.js');
const guardCore = load('server/access/guard-core.js');

const P = '9007199254';
const HARSHA = `${P}740993002`, ROHIT = `${P}740995001`, OTHER_IR = `${P}740995002`, IMRAN = `${P}740994001`, SAHIL = `${P}740993900`, VIEW = `${P}740993901`;
const PRAKASH = `${P}740997301`, KIRAN = `${P}740997320`, RADHIKA = `${P}740994101`;
const EKA = `${P}740998101`, OTHER_LLP = `${P}740998102`, HIDDEN_LLP = `${P}740998199`;
const NOW = Date.parse('2026-09-28T06:00:00Z');

const recorded = (name) => JSON.parse(fs.readFileSync(path.join(fx, `${name}.response.json`), 'utf8'));
const toResponse = (r) => new Response(r.status === 204 ? null : JSON.stringify(r.body), { status: r.status, headers: r.headers || {} });
const immediateGate = () => ({ async acquire() { return { waitedMs: 0, release() {} }; }, async run(_c, t) { return t(); }, snapshot() { return {}; } });
const creds = new Map();
before(async () => {
  for (const id of [HARSHA, ROHIT, OTHER_IR, IMRAN, SAHIL, VIEW]) creds.set(id, await userCredential({ access_token: `synthetic-${id}`, api_domain: 'https://www.zohoapis.in', expires_in: 3_600 },
    { recordIdPrefix: P, gate: immediateGate(), log: createOpsLog(createMemorySink()), clock: () => NOW,
      fetch: async () => toResponse({ status: 200, body: { users: [{ id, status: 'active' }] } }) }));
});

const CONTACT = { [PRAKASH]: 'coql.contact-prakash', [KIRAN]: 'coql.contact-kiran', [RADHIKA]: 'coql.contact-radhika' };
const ALLOTS = { [PRAKASH]: 'coql.allotments-prakash', [KIRAN]: 'coql.allotments-kiran', [RADHIKA]: 'coql.allotments-radhika' };
/* Zoho's own filter, replayed: an IR's one-Contact read returns only a Contact whose Originating_IR is that IR; a KAM's, only their own. */
const OWNER = { [PRAKASH]: { ir: ROHIT, kam: null }, [KIRAN]: { ir: ROHIT, kam: null }, [RADHIKA]: { ir: null, kam: IMRAN } };
function route(url, q) {
  const u = String(url);
  if (!q) {
    const slot = u.match(/\/(Contacts|LLP_UnitAllocation_Module|LLP_Creation_Module)\/(\d+)\?fields=/);
    if (slot) return slot[1] === 'Contacts' && slot[2] === PRAKASH ? recorded('slots.contact') : { status: 200, headers: {}, body: { data: [{ id: slot[2] }] } };   /* the record's typed-slot fields (M12-S01-W2) */
    const att = u.match(/\/(Contacts|LLP_UnitAllocation_Module|LLP_Creation_Module)\/(\d+)\/Attachments/);
    if (!att) throw new Error('unrouted GET ' + u);
    if (att[1] === 'Contacts') return recorded('attachments.contact');
    if (att[1] === 'LLP_UnitAllocation_Module') return recorded('attachments.allotment');
    return att[2] === HIDDEN_LLP ? recorded('attachments.forbidden') : att[2] === OTHER_LLP ? recorded('attachments.none') : recorded('attachments.llp');
  }
  if (/from Contacts/.test(q)) {
    const one = q.match(/id = '(\d+)'/);
    if (one) {
      const o = OWNER[one[1]], ir = q.match(/Originating_IR = '(\d+)'/), kam = q.match(/KAM = '(\d+)'/);
      if (!o || (ir && o.ir !== ir[1]) || (kam && o.kam !== kam[1])) return { status: 204, headers: {}, body: {} };
      return recorded(CONTACT[one[1]]);
    }
    if (/Originating_IR = /.test(q)) return q.includes(ROHIT) ? recorded('coql.own-lead-book') : { status: 204, headers: {}, body: {} };
    if (/KAM = /.test(q)) return q.includes(IMRAN) ? recorded('coql.own-book') : { status: 204, headers: {}, body: {} };
  }
  if (/from LLP_UnitAllocation_Module/.test(q)) {
    if (/LLP = /.test(q)) return recorded('coql.holders-eka');
    const c = Object.keys(ALLOTS).find((id) => q.includes(id));
    return c ? recorded(ALLOTS[c]) : { status: 204, headers: {}, body: {} };
  }
  throw new Error('unrouted query: ' + q);
}

function rig() {
  const calls = [];
  const sink = createMemorySink();
  const log = createOpsLog(sink);
  const events = createInvestorEvents({ log, planeC: createPlaneCLog(createPlaneCMemorySink()), clock: () => NOW });
  const crm = createZohoClient({ recordIdPrefix: P, gate: immediateGate(), log, maxAttempts: 1, clock: () => NOW,
    fetch: async (url, init) => { const q = init && init.body ? JSON.parse(init.body).select_query : null; calls.push(q || `GET ${decodeURIComponent(String(url))}`); return toResponse(route(url, q)); } });
  return { calls, sink, reader: createDocumentsReader({ crm, events }) };
}
/* measured at R6 on the recorded fixtures: Contact slots, Contact attachments, allotments, allotment attachments, the LLP read and its attachments … held exactly, so an N+1 fails here */
const BUDGET_DOCUMENTS = 8;
const attCalls = (r, mod) => r.calls.filter((c) => new RegExp(`GET .*/${mod}/\\d+/Attachments`).test(c));

/* ---------------- T01: the scope table ---------------- */

test('T01: scope → seats — personal only Finance/Compliance/KAM/Head of AM/Sahil; an IR status only; project for all staff', () => {
  const t = (seat) => { const a = docAccessFor(seat, HARSHA); return [a.personal, a.allotment, a.project]; };
  assert.deepEqual(t('fin'), [true, 'files', true]);
  assert.deepEqual(t('head'), [true, 'files', true]);
  assert.deepEqual(t('comp'), [true, 'files', true], 'PROVISIONAL: Compliance is the KYC owner');
  assert.deepEqual(t('di'), [true, 'files', true], 'Sahil');
  assert.deepEqual(t('kam'), [true, 'files', true], 'their own book only (ir-guard)');
  assert.deepEqual(t('amlead'), [true, 'files', true], 'PROVISIONAL: Head of AM');
  for (const s of ['audit', 'exec', 'bu']) assert.deepEqual(t(s), [false, 'files', true], s);
  assert.deepEqual(t('ir'), [false, 'status', true], 'AC6: paperwork status, never personal');
  for (const s of ['conv', 'cp']) assert.deepEqual(t(s), [false, 'none', true], s);
  assert.deepEqual(t('stranger'), [false, 'none', false]);
  assert.deepEqual(docAccessFor('fin', 'not-an-id').project, false, 'a malformed id gets nothing');
});

test('investor side: a Contact sees project papers only of LLPs they hold a live allotment in', () => {
  const rows = [
    { Customer: PRAKASH, LLP_Lookup: EKA, Allocation_Status: 'Reserved' },
    { Customer: RADHIKA, LLP_Lookup: OTHER_LLP, Allocation_Status: 'Cancelled' },
    { Customer: RADHIKA, LLP_Lookup: EKA, Allocation_Status: 'Issued' },
  ];
  assert.equal(holdsLlp(rows, PRAKASH, EKA), true);
  assert.equal(holdsLlp(rows, PRAKASH, OTHER_LLP), false);
  assert.equal(holdsLlp(rows, RADHIKA, OTHER_LLP), false, 'a cancelled allotment holds nothing');
  assert.deepEqual([...heldLlps(rows, RADHIKA)], [EKA]);
  assert.deepEqual([...heldLlps(rows, KIRAN)], []);
});

test('one lister: record.ts re-exports and uses server/documents/attachments (same ATTACHMENT_FIELDS)', () => {
  assert.deepEqual([...ATTACHMENT_FIELDS], [...record.ATTACHMENT_FIELDS]);
});

test('AC5: PAN, Aadhaar and account numbers in a file name are masked for every seat', () => {
  assert.equal(maskFileName('PAN proof ABCDE1234F.pdf'), 'PAN proof •••••234F.pdf');
  assert.equal(maskFileName('Aadhaar 1234 5678 9012.pdf'), 'Aadhaar •••• •••• 9012.pdf');
  assert.equal(maskFileName('Bank letter 50100123456789.pdf'), 'Bank letter ••••6789.pdf');
  assert.equal(maskFileName('EKA LLP deed 2026.pdf'), 'EKA LLP deed 2026.pdf');
});

/* ---------------- T03: forInvestor ---------------- */

test('AC1-3: Finance reads Prakash in three scopes — personal on the Contact, allotment, project on the LLP held', async () => {
  const r = rig();
  const res = await r.reader.forInvestor(creds.get(HARSHA), 'head', PRAKASH);
  assert.equal(res.ok, true, JSON.stringify(res));
  const d = res.documents;
  assert.deepEqual(d.access, { personal: true, allotment: 'files', project: true });
  assert.deepEqual(d.personal.map((f) => f.name), ['PAN scan •••••234F.jpg', 'Signed NDA.pdf', 'PAN proof •••••234F.pdf', 'Bank letter ••••6789.pdf', 'Aadhaar •••• •••• 9012.pdf']);
  /* M12-S01-W2: a paper filed to a typed slot carries the slot's label; an Attachment carries who uploaded it (a display name) and no slot */
  assert.deepEqual(d.personal.slice(0, 2).map((f) => [f.slot, f.by]), [['PAN proof', null], [null, 'Harsha Bhat']]);
  assert.deepEqual(d.allotments.map((a) => [a.allotmentId, a.contactId, a.llpId, a.count, a.files.length]), [[`${P}740998301`, PRAKASH, EKA, 1, 1]]);
  assert.deepEqual(d.farms.map((f) => [f.llpId, f.files.map((x) => x.name)]), [[EKA, ['EKA LLP deed.pdf']]]);
  for (const c of r.calls.filter((x) => x.startsWith('GET'))) {
    if (/\/\d+\?fields=/.test(c)) { assert.match(c, /fields=[A-Za-z_,]+$/, 'the record read names the typed-slot fields only'); assert.doesNotMatch(c, /Email|Phone|Mobile|PAN_Number|Aadhaar/); continue; }
    assert.match(c, /\/Attachments\?/, 'only attachment metadata is fetched — never a file body');
    assert.match(c, /fields=id,File_Name,Size,Created_Time,Created_By/);
  }
  assert.ok(!/ABCDE1234F|50100123456789|1234 5678 9012/.test(JSON.stringify(d)));
});

test('TC-IM12-001 (Documents): a cold read of one investor spends a fixed number of Zoho calls — never one per file — and a second read re-reads (rows are not cached, D45/D52)', async () => {
  const r = rig();
  const res = await r.reader.forInvestor(creds.get(HARSHA), 'head', PRAKASH);
  assert.equal(res.ok, true);
  const cold = r.calls.length;
  assert.equal(cold, BUDGET_DOCUMENTS, `${cold} calls: raise the budget on purpose, or find the read that became one per file`);
  await r.reader.forInvestor(creds.get(HARSHA), 'head', PRAKASH);
  assert.equal(r.calls.length, cold * 2, 'GAP against the case text: file lists are rows, which D45/D52 never cache, so a warm render re-reads them (proposed fact change in docs/reports/r6-missing-tests.md)');
});

test('AC5: Sahil (di) sees personal papers, numbers masked', async () => {
  const r = rig();
  const res = await r.reader.forInvestor(creds.get(SAHIL), 'di', PRAKASH);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.documents.personal.length, 5, 'four attachments and the PAN proof filed to its slot');
  assert.ok(!/ABCDE1234F|50100123456789|1234 5678 9012/.test(JSON.stringify(res.documents)));
});

test('AC5: the investor\'s KAM sees their personal papers; farms only where the allotment is live', async () => {
  const r = rig();
  const res = await r.reader.forInvestor(creds.get(IMRAN), 'kam', RADHIKA);
  assert.equal(res.ok, true, JSON.stringify(res));
  const d = res.documents;
  assert.equal(d.personal.length, 4);
  assert.deepEqual(d.allotments.map((a) => [a.llpId, a.count]), [[EKA, 1], [OTHER_LLP, 1]], 'allotment papers reachable from the Contact');
  assert.deepEqual(d.farms.map((f) => f.llpId), [EKA], 'the cancelled allotment on the other LLP gives no project papers');
  assert.equal(attCalls(r, 'LLP_Creation_Module').length, 1);
});

test('AC5: a KAM opening another KAM\'s investor is refused before any attachment is listed (logged by id)', async () => {
  const r = rig();
  const res = await r.reader.forInvestor(creds.get(IMRAN), 'kam', PRAKASH);
  assert.deepEqual([res.ok, res.kind, res.reason], [false, 'refused', 'not-visible']);
  assert.equal(r.calls.some((c) => /Attachments|from LLP_UnitAllocation_Module/.test(c)), false);
  const line = r.sink.records().find((x) => x.kind === 'refusal' && x.action === 'documents-investor');
  assert.deepEqual(line.recordIds, [PRAKASH]);
});

test('AC6: an IR on their own lead\'s investor gets paperwork status only — personal never read, no file names', async () => {
  const r = rig();
  const res = await r.reader.forInvestor(creds.get(ROHIT), 'ir', KIRAN);
  assert.equal(res.ok, true, JSON.stringify(res));
  const d = res.documents;
  assert.deepEqual([d.personal, d.access.allotment], [null, 'status']);
  assert.deepEqual(d.allotments.map((a) => [a.llpId, a.count, a.files]), [[EKA, 1, null]]);
  assert.equal(attCalls(r, 'Contacts').length, 0, 'the Contact\'s attachments are never even asked for');
  assert.ok(!/Supplementary agreement/.test(JSON.stringify(d.allotments)));
  assert.deepEqual(d.farms.map((f) => f.llpId), [EKA], 'project papers of the farm held: staff with access to the LLP');
});

test('AC6: an IR opening another IR\'s investor is refused; viewers see no personal papers; a seat without investors is refused', async () => {
  const r = rig();
  const a = await r.reader.forInvestor(creds.get(OTHER_IR), 'ir', KIRAN);
  assert.deepEqual([a.ok, a.reason], [false, 'not-visible']);
  const b = await r.reader.forInvestor(creds.get(VIEW), 'exec', PRAKASH);
  assert.equal(b.ok, true, JSON.stringify(b));
  assert.deepEqual([b.documents.personal, b.documents.allotments.length], [null, 1]);
  const c = await r.reader.forInvestor(creds.get(ROHIT), 'conv', PRAKASH);
  assert.deepEqual([c.ok, c.reason], [false, 'seat-denied']);
  const d = await r.reader.forInvestor(creds.get(HARSHA), 'head', 'not-an-id');
  assert.deepEqual([d.ok, d.reason], [false, 'invalid-request']);
  assert.equal(attCalls(r, 'Contacts').length, 0);
});

/* ---------------- T03: forFarm ---------------- */

test('AC2/AC4: Finance on EKA sees the project papers and every holder\'s allotment papers', async () => {
  const r = rig();
  const res = await r.reader.forFarm(creds.get(HARSHA), 'head', EKA);
  assert.equal(res.ok, true, JSON.stringify(res));
  const d = res.documents;
  assert.deepEqual(d.project.map((f) => f.name), ['EKA LLP deed.pdf']);
  assert.deepEqual(d.allotments.map((a) => a.contactId), [PRAKASH, KIRAN, RADHIKA, `${P}740997399`]);
  assert.ok(d.allotments.every((a) => a.files && a.files.length === 1));
  assert.equal(attCalls(r, 'Contacts').length, 0, 'the farm view never lists personal papers');
  const q = r.calls.find((c) => /from LLP_UnitAllocation_Module/.test(c));
  assert.match(q, new RegExp(`LLP = '${EKA}'`));
  assert.ok(!/Unit_Price|Amount/.test(q), 'no money field asked for');
});

test('a KAM on EKA sees only their own book\'s allotment papers; an IR only counts for their own leads\' investors', async () => {
  const r = rig();
  const k = await r.reader.forFarm(creds.get(IMRAN), 'kam', EKA);
  assert.equal(k.ok, true, JSON.stringify(k));
  assert.deepEqual(k.documents.allotments.map((a) => a.contactId), [RADHIKA]);
  const i = await r.reader.forFarm(creds.get(ROHIT), 'ir', EKA);
  assert.equal(i.ok, true, JSON.stringify(i));
  assert.deepEqual(i.documents.allotments.map((a) => [a.contactId, a.count, a.files]), [[PRAKASH, 1, null], [KIRAN, 1, null]]);
  assert.equal(i.documents.project.length, 1);
});

test('a channel partner gets project papers only; an LLP Zoho refuses is refused, not "not found"', async () => {
  const r = rig();
  const c = await r.reader.forFarm(creds.get(ROHIT), 'cp', EKA);
  assert.equal(c.ok, true, JSON.stringify(c));
  assert.deepEqual([c.documents.project.length, c.documents.allotments.length], [1, 0]);
  assert.equal(r.calls.some((x) => /from LLP_UnitAllocation_Module/.test(x)), false);
  const h = await r.reader.forFarm(creds.get(HARSHA), 'head', HIDDEN_LLP);
  assert.deepEqual([h.ok, h.reason], [false, 'not-visible']);
  const s = await r.reader.forFarm(creds.get(HARSHA), 'stranger', EKA);
  assert.deepEqual([s.ok, s.reason], [false, 'seat-denied']);
  const n = await r.reader.forFarm(creds.get(HARSHA), 'head', OTHER_LLP);
  assert.equal(n.ok, true);
  assert.deepEqual(n.documents.project, []);
});

test('logs carry ids and codes only — never a file name', async () => {
  const r = rig();
  await r.reader.forInvestor(creds.get(HARSHA), 'head', PRAKASH);
  await r.reader.forFarm(creds.get(HARSHA), 'head', EKA);
  await r.reader.forInvestor(creds.get(IMRAN), 'kam', PRAKASH);
  const text = JSON.stringify(r.sink.records());
  assert.ok(!/NDA|PAN proof|deed|Supplementary|ABCDE/.test(text), text.slice(0, 400));
});

test('route: /api/documents is a session route (scopes decided inside) — page "docs" would shut out the KAM seats AC5 names', () => {
  const rule = guardCore.apiRuleOf('/api/documents/investor/[id]');
  assert.deepEqual([rule.key, rule.rule.kind], ['/api/documents', 'session']);
  assert.deepEqual(guardCore.apiRuleOf('/api/documents/farm/[id]').key, '/api/documents');
  const presets = guardCore.seatPresets();
  for (const s of ['key-account-manager', 'head-of-account-management']) assert.ok(presets[s].admitted && !presets[s].pages.includes('docs'), s);
});
