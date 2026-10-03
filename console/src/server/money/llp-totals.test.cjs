/* M10-S07-T04 — "the sum of an LLP's allotments' matched receipts equals the Payments register filtered by that
 * farm" (M10-S07 AC5), one and two allotments per investor, and a Cancelled allotment.
 *
 * Run from console/: node --test src/server/money/llp-totals.test.cjs
 * Replays the recorded register fixtures (__fixtures__/receipts/register.*). No request reaches Zoho.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { before, test } = require('node:test');

const consoleRoot = path.resolve(__dirname, '..', '..', '..');
const srcRoot = path.join(consoleRoot, 'src');
const fixtureRoot = path.join(srcRoot, 'lib', 'zoho', '__fixtures__', 'receipts');
const ts = require(path.join(consoleRoot, 'node_modules', 'typescript'));
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoho-llp-totals-'));
process.on('exit', () => fs.rmSync(outDir, { recursive: true, force: true }));
const config = ts.readConfigFile(path.join(consoleRoot, 'tsconfig.json'), ts.sys.readFile);
const project = ts.parseJsonConfigFileContent(config.config, ts.sys, consoleRoot);
const options = { ...project.options, incremental: false, tsBuildInfoFile: undefined, plugins: undefined,
  module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10, noEmit: false, noEmitOnError: true, outDir, rootDir: srcRoot };
const program = ts.createProgram(['server/money/by-allotment.ts', 'server/money/register.ts'].map((f) => path.join(srcRoot, f)), options);
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
const { userCredential } = load('lib/zoho/client.js');
const { moneyOf } = load('server/money/by-allotment.js');
const { createPaymentsRegister } = load('server/money/register.js');

const P = '9007199254';
const NOW = Date.parse('2026-09-28T06:00:00Z');
const recorded = (name) => JSON.parse(fs.readFileSync(path.join(fixtureRoot, `${name}.response.json`), 'utf8'));
const toResponse = (r) => new Response(JSON.stringify(r.body), { status: r.status, headers: r.headers || {} });
const immediateGate = () => ({ async acquire() { return { waitedMs: 0, release() {} }; }, async run(_c, t) { return t(); }, snapshot() { return {}; } });
const idOf = (v) => (v && typeof v === 'object' ? v.id : v);

let cred;
before(async () => {
  cred = await userCredential({ access_token: 'synthetic-finance-token', api_domain: 'https://www.zohoapis.in', expires_in: 3_600 },
    { recordIdPrefix: P, gate: immediateGate(), log: createOpsLog(createMemorySink()), clock: () => NOW,
      fetch: async () => toResponse({ status: 200, body: { users: [{ id: `${P}740996900`, status: 'active' }] } }) });
});

/** The register over (receipts, allotments) as Finance reads it. */
function registerOver(receipts, allots) {
  const ok = (records) => ({ ok: true, value: { records, moreRecords: false } });
  return createPaymentsRegister({
    crm: { coql: async (_c, q) => /from Receipts/.test(q) ? ok(receipts)
      : /Allocation_Status = 'Reserved'/.test(q) ? ok(allots.filter((a) => a.Allocation_Status === 'Reserved'))
        : ok(allots.filter((a) => q.includes(a.id))) },
    access: { recheck: async (c) => ({ actor: { userId: c.userId }, seesRegister: true, seesUtr: true, canRecord: true }) },
    log: createOpsLog(createMemorySink()), recordIdPrefix: P, clock: () => NOW,
  });
}
const rowOf = (r) => ({ id: r.id, allotmentId: idOf(r.Allotment), kind: r.Kind, amount: r.Amount, mode: r.Mode ?? null, utr: r.UTR ?? null, on: r.Received_On ?? null,
  byId: idOf(r.Created_By), matched: r.Match_State === 'Matched', matchState: r.Match_State, reversalOf: idOf(r.Reversal_Of) });
const allotOf = (a) => ({ id: a.id, status: a.Allocation_Status, units: Math.max(a.Issued_Units ?? 0, a.Reserved_Units ?? 0), unitPrice: a.Unit_Price });

/** The investor-side view of one farm: every allotment of the LLP, the money of each, summed. */
function llpSide(allots, receipts, farmId) {
  const rows = receipts.map(rowOf);
  const mine = allots.filter((a) => idOf(a.LLP) === farmId);
  const per = mine.map((a) => moneyOf(allotOf(a), rows));
  const refunded = per.reduce((t, m) => t + (m.paid - m.standing), 0);
  return { paid: per.reduce((t, m) => t + m.paid, 0), refunded, standing: per.reduce((t, m) => t + m.standing, 0),
    due: per.reduce((t, m) => t + m.due, 0), recorded: per.reduce((t, m) => t + m.recorded, 0), n: mine.length };
}

test('TC-M10-S07-LLP: each LLP\'s matched receipts equal the Payments register filtered by that farm (received, refunded, net, still due, recorded)', async () => {
  const receipts = recorded('register.receipts').body.data, allots = recorded('register.allotments').body.data;
  const svc = registerOver(receipts, allots);
  const farms = [...new Set(allots.map((a) => idOf(a.LLP)))];
  assert.ok(farms.length >= 2, 'the fixture holds more than one farm');
  for (const farm of farms) {
    const res = await svc.read({ credential: cred, sessionId: 'sid_fixture_llp_totals_000000000000' }, { farm });
    assert.equal(res.ok, true, JSON.stringify(res));
    const t = res.value.totals, mine = llpSide(allots, receipts, farm);
    assert.deepEqual([mine.paid, mine.refunded, mine.standing, mine.due, mine.recorded],
      [t.received, t.refunded, t.netBanked, t.stillDue, t.recorded.net], `farm …${farm.slice(-4)}`);
  }
});

test('TC-M10-S07-LLP: the farms add up to the whole register (one allotment on one farm, two on another)', async () => {
  const receipts = recorded('register.receipts').body.data, allots = recorded('register.allotments').body.data;
  const all = await registerOver(receipts, allots).read({ credential: cred, sessionId: 'sid_fixture_llp_totals_000000000000' });
  const farms = [...new Set(allots.map((a) => idOf(a.LLP)))];
  const sides = farms.map((f) => llpSide(allots, receipts, f));
  assert.deepEqual(sides.map((x) => x.n).sort(), [1, 2], 'one farm holds one allotment, the other two');
  assert.equal(sides.reduce((t, x) => t + x.paid, 0), all.value.totals.received);
  assert.equal(sides.reduce((t, x) => t + x.refunded, 0), all.value.totals.refunded);
});

test('TC-M10-S07-LLP: a Cancelled allotment owes nothing and its matched money still sits on its farm in both views', async () => {
  const receipts = recorded('register.receipts').body.data, allots = structuredClone(recorded('register.allotments').body.data);
  const reserved = allots.find((a) => a.Allocation_Status === 'Reserved');
  reserved.Allocation_Status = 'Cancelled';
  const farm = idOf(reserved.LLP);
  const res = await registerOver(receipts, allots).read({ credential: cred, sessionId: 'sid_fixture_llp_totals_000000000000' }, { farm });
  assert.equal(res.ok, true, JSON.stringify(res));
  const mine = llpSide(allots, receipts, farm);
  assert.equal(mine.due, 0, 'nothing is due on a Cancelled allotment');
  assert.deepEqual([mine.paid, mine.refunded, mine.due], [res.value.totals.received, res.value.totals.refunded, res.value.totals.stillDue]);
});
