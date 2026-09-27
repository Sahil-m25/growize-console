/* M16-S01 ASSIGNMENTS BY IR
 *
 * Run from console/: node src/server/numbers/assignments.test.cjs
 *
 * Type-checks the capture boundary with the project's TypeScript, then drives it through the real
 * Zoho client with sanitized recorded responses only. No request reaches Zoho; every fixture is
 * synthetic. Whether live Zoho accepts the new picklist values and fields is M04-S01-T01's check.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { before, test } = require('node:test');

const consoleRoot = path.resolve(__dirname, '..', '..', '..');
const srcRoot = path.join(consoleRoot, 'src');
const fixtureRoot = path.join(srcRoot, 'lib', 'zoho', '__fixtures__', 'numbers');
const ts = require(path.join(consoleRoot, 'node_modules', 'typescript'));
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoho-numbers-'));
process.on('exit', () => fs.rmSync(outDir, { recursive: true, force: true }));

const config = ts.readConfigFile(path.join(consoleRoot, 'tsconfig.json'), ts.sys.readFile);
const project = ts.parseJsonConfigFileContent(config.config, ts.sys, consoleRoot);
const options = {
  ...project.options,
  incremental: false,
  tsBuildInfoFile: undefined,
  plugins: undefined,
  module: ts.ModuleKind.CommonJS,
  moduleResolution: ts.ModuleResolutionKind.Node10,
  noEmit: false,
  noEmitOnError: true,
  outDir,
  rootDir: srcRoot,
};
const sources = [
  'lib/zoho/errors.ts',
  'lib/zoho/gate.ts',
  'lib/zoho/log.ts',
  'lib/zoho/client.ts',
  'lib/zoho/cache.ts',
  'server/oauth/seat.ts',
  'server/numbers/assignments.ts',
].map((file) => path.join(srcRoot, file));
const format = (items) => ts.formatDiagnostics(items, {
  getCanonicalFileName: (file) => file,
  getCurrentDirectory: () => consoleRoot,
  getNewLine: () => '\n',
});
const program = ts.createProgram(sources, options);
const diagnostics = ts.getPreEmitDiagnostics(program);
if (diagnostics.length) {
  console.error(format(diagnostics));
  process.exit(1);
}
const emitted = program.emit();
if (emitted.diagnostics.length) {
  console.error(format(emitted.diagnostics));
  process.exit(1);
}



const load = (file) => require(path.join(outDir, file));
const { createMemorySink, createOpsLog } = load(path.join('lib', 'zoho', 'log.js'));
const { createZohoClient, userCredential } = load(path.join('lib', 'zoho', 'client.js'));
const { createScopedCache } = load(path.join('lib', 'zoho', 'cache.js'));
const { computeAssignments, createAssignmentsReport, periodBounds } = load(path.join('server', 'numbers', 'assignments.js'));

const P = '9007199254';
const IR = `${P}740995001`;
const IR2 = `${P}740995009`;
const MANAGER = `${P}740995002`;
const SESSION = 'session_fixture_numbers_01';
const NOW = Date.parse('2026-09-27T15:30:00Z'); // Sunday 21:00 IST
const recorded = (name) => JSON.parse(fs.readFileSync(path.join(fixtureRoot, `${name}.response.json`), 'utf8'));
const toResponse = (r) => new Response(JSON.stringify(r.body), { status: r.status, headers: r.headers || {} });
const immediateGate = () => ({ async acquire() { return { waitedMs: 0, release() {} }; } });
const creds = new Map();
before(async () => {
  for (const id of [IR, MANAGER]) creds.set(id, await userCredential({ access_token: `synthetic-${id}`, api_domain: 'https://www.zohoapis.in', expires_in: 3_600 },
    { recordIdPrefix: P, gate: immediateGate(), log: createOpsLog(createMemorySink()), clock: () => NOW,
      fetch: async () => toResponse({ status: 200, body: { users: [{ id, status: 'active' }] } }) }));
});
const principal = (id) => ({ credential: creds.get(id), sessionId: SESSION });

function rig(id) {
  const calls = [];
  const crm = createZohoClient({ recordIdPrefix: P, gate: immediateGate(), log: createOpsLog(createMemorySink()), maxAttempts: 1, clock: () => NOW,
    fetch: async (url, init) => { const q = JSON.parse(init.body).select_query; calls.push(q);
      return toResponse(recorded(q.includes('from Touches') ? 'coql.ar-touches' : 'coql.ar-leads')); } });
  const access = { async recheck(c) { return id === MANAGER
    ? { actor: { userId: MANAGER, roleId: `${P}740998001`, profileId: `${P}740998002`, seat: 'ir-manager' }, seesAssignments: true, irIds: [IR, IR2], scope: { kind: 'subtree', managerId: MANAGER } }
    : { actor: { userId: c.userId, roleId: `${P}740998001`, profileId: `${P}740998002`, seat: 'investor-relations' }, seesAssignments: true, irIds: [IR, IR2], scope: { kind: 'subtree', managerId: MANAGER } }; } };
  const cache = createScopedCache({ clock: () => NOW });
  return { svc: createAssignmentsReport({ crm, access, cache, log: createOpsLog(createMemorySink()), recordIdPrefix: P, clock: () => NOW }), calls };
}

test('periods: the week starts on Monday in IST; before-this-month is before both the month and last week', () => {
  const b = periodBounds(NOW);
  assert.equal(new Date(b.w0).toISOString(), '2026-09-20T18:30:00.000Z', 'Mon 21 Sep 00:00 IST');
  assert.equal(new Date(b.w1).toISOString(), '2026-09-13T18:30:00.000Z');
  assert.equal(new Date(b.m0).toISOString(), '2026-08-31T18:30:00.000Z', '1 Sep 00:00 IST');
});

test('the IR Manager sees one row per IR and a team total, with worked, reached, missed and the capture fallback', async () => {
  const r = rig(MANAGER);
  const res = await r.svc.report(principal(MANAGER));
  assert.equal(res.ok, true, JSON.stringify(res));
  const c = res.value.cells;
  assert.deepEqual(res.value.irIds, [IR, IR2]);
  assert.equal(c[`${IR}|tw|assigned`], 2);
  assert.equal(c[`${IR}|tw|notWorked`], 1, 'assigned today, not yet worked');
  assert.equal(c[`${IR}|tw|worked`], 1);
  assert.equal(c[`${IR}|tw|rch`], 1, 'Connected counts as reached');
  assert.equal(c[`${IR}|tw|touches`], 2, 'the second WhatsApp inside 15 minutes is the same attempt');
  assert.equal(c[`${IR}|lw|missed`], 1, 'first touch after the WhatsApp same-day deadline');
  assert.equal(c[`${IR}|lw|att`], 1, 'No answer is attempted, not reached');
  assert.equal(c[`${IR}|bm|capFallback`], 1);
  assert.equal(c[`${IR}|bm|lost`], 1);
  assert.equal(c[`${IR}|all|assigned`], 4);
  assert.equal(c[`${IR2}|tw|assigned`], 1);
  assert.equal(c[`team|all|assigned`], 5);
  assert.equal(c[`${IR}|tw|fstHours`], 1);
  assert.ok(Object.values(c).every((v) => typeof v === 'number'), 'counts only — cacheable (D52)');
});

test('an IR\'s token gets only their own row, whatever the session layer lists', async () => {
  const r = rig(IR);
  const res = await r.svc.report(principal(IR));
  assert.deepEqual(res.value.irIds, [IR]);
  assert.ok(!Object.keys(res.value.cells).some((k) => k.startsWith(IR2)));
  assert.match(r.calls[0], new RegExp(`Owner in \\('${IR}'\\)`));
});

test('a second read inside five minutes is served from the scope-keyed cache', async () => {
  const r = rig(MANAGER);
  await r.svc.report(principal(MANAGER));
  const n = r.calls.length;
  const again = await r.svc.report(principal(MANAGER));
  assert.equal(r.calls.length, n);
  assert.equal(again.value.stale, false);
});
