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
const sources = ['server/investors/finance-list.ts', 'server/investors/handoff-share.ts', 'server/data/events.ts'].map((f) => path.join(srcRoot, f));
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
const { createFinanceInvestorList, FINANCE_CONTACT_FIELDS, FINANCE_TTL_MS } = load('server/investors/finance-list.js');
const { shareAtHandOff } = load('server/investors/handoff-share.js');

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
  assert.deepEqual({ ...res.summary }, { onBook: 4, units: 12, kycNotPassed: 1, balanceOutstanding: 2, nri: 2, femaOutstanding: 1 });
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
  assert.deepEqual({ ...a.value }, { onBook: 4, units: 12, kycNotPassed: 1, balanceOutstanding: 2, nri: 2, femaOutstanding: 1 });
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

/* ---- M03-S09-T03 record share at hand-off ---- */

test('hand-off shares the Contact, its allotments and receipts read-only with the originating IR, on the service credential', async () => {
  const calls = [];
  const sink = createMemorySink();
  const client = createZohoServiceClient({ recordIdPrefix: P, gate: immediateGate(), log: createOpsLog(sink), maxAttempts: 1, clock: () => NOW,
    fetch: async (url, init) => {
      const body = init.body ? JSON.parse(init.body) : null;
      calls.push({ url: String(url), method: init.method, body });
      if (body && body.select_query) {
        const q = body.select_query;
        return toResponse(recorded(/from Contacts/.test(q) ? 'coql.share-contact' : /from LLP_UnitAllocation_Module/.test(q) ? 'coql.share-allotments' : 'coql.share-receipts'));
      }
      return toResponse(recorded('share.success'));
    } });
  const job = serviceCredential('handoff-share', { access_token: 'svc', api_domain: 'https://www.zohoapis.in', expires_in: 3600, token_type: 'Bearer' }, NOW);
  const res = await shareAtHandOff(client, job, { contactId: `${P}740997101`, irUserId: ROHIT });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.deepEqual(res.shared.map((x) => `${x.module}/${x.id}`), [
    `Contacts/${P}740997101`, `LLP_UnitAllocation_Module/${P}740998201`, `Receipts/${P}740999201`, `Receipts/${P}740999202`]);
  assert.equal(res.failed.length, 0);
  const shares = calls.filter((c) => c.url.includes('/actions/share'));
  assert.equal(shares.length, 4);
  for (const s of shares) assert.deepEqual(s.body, { share: [{ share_related_records: false, user: { id: ROHIT }, permission: 'read' }] });
  const logged = JSON.stringify(sink.records());
  assert.ok(sink.records().every((x) => !x.actor || x.actor.job === 'handoff-share'), 'the job is named');
  assert.ok(!/svc|Bearer/.test(logged), 'no token in the log');

  const wrong = await shareAtHandOff(client, job, { contactId: `${P}740997101`, irUserId: KAVYA });
  assert.deepEqual(wrong, { ok: false, reason: 'not-the-originating-ir' }, 'never shared with anybody but the Contact\'s Originating_IR');
  const other = serviceCredential('cover-window-share', { access_token: 'svc', api_domain: 'https://www.zohoapis.in', expires_in: 3600, token_type: 'Bearer' }, NOW);
  await assert.rejects(shareAtHandOff(client, other, { contactId: `${P}740997101`, irUserId: ROHIT }), TypeError, 'only the handoff-share job may');
});
