/* NUMBERS REGRESSION (M16-S01 assignments, M16-S03 sections)
 *
 * Run from console/: node src/server/numbers/numbers.test.cjs
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
  'domain/plan.ts',
  'server/numbers/sections.ts',
  'server/numbers/plan.ts',
  'server/numbers/transfers.ts',
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
const { createNumbersSections } = load(path.join('server', 'numbers', 'sections.js'));
const { createPlanRead } = load(path.join('server', 'numbers', 'plan.js'));
const { createTransfers } = load(path.join('server', 'numbers', 'transfers.js'));

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

// ---------------- M16-S03 Numbers sections ----------------

function sectionsRig(overrides = {}) {
  const queries = [];
  const crm = createZohoClient({ recordIdPrefix: P, gate: immediateGate(), log: createOpsLog(createMemorySink()), maxAttempts: 1, clock: () => NOW,
    fetch: async (url, init) => { const q = JSON.parse(init.body).select_query; queries.push(q);
      const name = /group by Lead_Source/.test(q) ? 'agg.sources' : /group by Owner/.test(q) ? 'agg.owners' : /group by Forecast/.test(q) ? 'agg.forecast' : 'agg.count';
      return toResponse(recorded(name)); } });
  const base = (c) => c.userId === MANAGER
    ? { actor: { userId: MANAGER, roleId: `${P}740998001`, profileId: `${P}740998002`, seat: 'ir-manager' }, seesNumbers: true,
        ownerIds: [IR, IR2], orgWide: false, unassignedQueueUserId: null, scope: { kind: 'subtree', managerId: MANAGER } }
    : { actor: { userId: c.userId, roleId: `${P}740998001`, profileId: `${P}740998002`, seat: 'investor-relations' }, seesNumbers: true,
        ownerIds: [IR, IR2], orgWide: false, unassignedQueueUserId: null, scope: { kind: 'subtree', managerId: MANAGER } };
  const access = { async recheck(c) { return overrides.recheck ? overrides.recheck(base(c)) : base(c); } };
  const cache = overrides.cache ?? createScopedCache({ clock: () => NOW });
  return { svc: createNumbersSections({ crm, access, cache, log: createOpsLog(createMemorySink()), recordIdPrefix: P, clock: () => NOW }), queries, cache };
}

test('Funnel is worked out from the stage stamps, one COUNT per rung, in the person\'s scope', async () => {
  const r = sectionsRig();
  const res = await r.svc.read(principal(MANAGER), 'funnel');
  assert.equal(res.ok, true);
  assert.equal(Object.keys(res.value.counts).length, 9);
  assert.equal(r.queries.length, 9);
  assert.match(r.queries[0], new RegExp(`^select COUNT\\(id\\) from Leads where \\(Owner in \\('${IR}', '${IR2}'\\)\\)$`));
  assert.match(r.queries[2], /Qualified_At is not null/);
});

test('Sources, Owners and Why we lose are grouped counts; no name leaves', async () => {
  const r = sectionsRig();
  const s = await r.svc.read(principal(MANAGER), 'sources');
  assert.deepEqual({ ...s.value.counts }, { Events: 4, Website: 2, none: 1 });
  const o = await r.svc.read(principal(MANAGER), 'owners');
  assert.deepEqual({ ...o.value.counts }, { [IR]: 5, [IR2]: 2 });
  assert.ok(!JSON.stringify(o).includes('Synthetic IR'));
});

test('no rupee value for any seat (D138: no prototype unit price); units only', async () => {
  let r = sectionsRig();
  let res = await r.svc.read(principal(MANAGER), 'forecast');
  assert.ok(!('money' in res.value));
  assert.deepEqual({ ...res.value.counts }, { 'leads:Commit': 2, 'units:Commit': 5, 'leads:Pipeline': 3, 'units:Pipeline': 4 });
  r = sectionsRig({ recheck: (b) => ({ ...b, actor: { ...b.actor, seat: 'digital-infrastructure' } }) });
  res = await r.svc.read(principal(MANAGER), 'forecast');
  assert.ok(!('money' in res.value), 'D138: a lead has no Zoho price — no rupee figure');
  assert.deepEqual({ ...res.value.counts }, { 'leads:Commit': 2, 'units:Commit': 5, 'leads:Pipeline': 3, 'units:Pipeline': 4 });
});

test('two seats with different visibility never share cached figures (D53)', async () => {
  const cache = createScopedCache({ clock: () => NOW });
  const m = sectionsRig({ cache });
  await m.svc.read(principal(MANAGER), 'sources');
  const i = sectionsRig({ cache });
  await i.svc.read(principal(IR), 'sources');
  assert.equal(i.queries.length, 1, 'the IR\'s scope is its own key: a fresh load, not the manager\'s figures');
  assert.match(i.queries[0], new RegExp(`Owner in \\('${IR}'\\)`), 'an IR counts only their own book');
  const again = sectionsRig({ cache });
  await again.svc.read(principal(MANAGER), 'sources');
  assert.equal(again.queries.length, 0, 'the manager\'s own key is served from cache');
});

// ---------------- M16-S04 plan read ----------------

function planRig(money, receipts = 'coql.plan-receipts') {
  const queries = [];
  const crm = createZohoClient({ recordIdPrefix: P, gate: immediateGate(), log: createOpsLog(createMemorySink()), maxAttempts: 1, clock: () => NOW,
    fetch: async (url, init) => { const q = JSON.parse(init.body).select_query; queries.push(q);
      return toResponse(recorded(/from Sales_Plans/.test(q) ? 'coql.plans' : /from Receipts/.test(q) ? receipts : 'coql.plan-allotments')); } });
  const access = { async recheck(c) { return { actor: { userId: c.userId, roleId: `${P}740998001`, profileId: `${P}740998002`, seat: 'ir-manager' }, seesPlan: true, seesMoney: money }; } };
  return { svc: createPlanRead({ crm, access, log: createOpsLog(createMemorySink()), recordIdPrefix: P, clock: () => NOW }), queries };
}

test('each period shows its window, target, paid from matched Full receipts, remaining and status', async () => {
  const r = planRig(true);
  const res = await r.svc.read(principal(MANAGER));
  const [aug, sep, oct] = res.value.periods;
  assert.deepEqual([aug.status, sep.status, oct.status], ['done', 'current', 'next']);
  assert.equal(res.value.focus, sep.id);
  assert.equal(sep.paidUnits, 2, 'Full receipt on 10 Sep, allotment of 2 units; the advance is not paid in full');
  assert.equal(sep.remainingUnits, 10);
  assert.equal(aug.paidUnits, 1, 'Reserved units when none issued yet');
  assert.equal(sep.banked, 4750000);
  assert.deepEqual(res.value.total, { targetUnits: 36, paidUnits: 3 });
  assert.match(r.queries[1], /Match_State = 'Matched'/);
});

test('a seat without money sees units only; a token that cannot read Receipts gets "paid" unknown, not zero', async () => {
  let res = await planRig(false).svc.read(principal(MANAGER));
  assert.ok(res.value.periods.every((p) => p.banked === null && p.collectionTarget === null));
  assert.equal(res.value.periods[1].paidUnits, 2);
  res = await planRig(true, 'forbidden').svc.read(principal(MANAGER));
  assert.equal(res.value.paidKnown, false);
  assert.ok(res.value.periods.every((p) => p.paidUnits === null && p.banked === null));
});

// ---------------- M16-S06 Transfers ----------------

function transfersRig(seat, money, legacyField = false) {
  const queries = [];
  const crm = createZohoClient({ recordIdPrefix: P, gate: immediateGate(), log: createOpsLog(createMemorySink()), maxAttempts: 1, clock: () => NOW,
    fetch: async (url, init) => { const q = JSON.parse(init.body).select_query; queries.push(q);
      return toResponse(recorded(/from Leads/.test(q) ? 'coql.tr-leads' : /from Contacts/.test(q) ? 'coql.tr-contacts' : 'coql.tr-allotments')); } });
  const access = { async recheck(c) { return { actor: { userId: c.userId, roleId: `${P}740998001`, profileId: `${P}740998002`, seat },
    seesTransfers: true, seesMoney: money, ownerIds: [IR, IR2], orgWide: false }; } };
  return { svc: createTransfers({ crm, access, log: createOpsLog(createMemorySink()), recordIdPrefix: P, clock: () => NOW, legacyField }), queries };
}

test('Transfers counts leads by their yes month, newest first, with units from the investors\' allotments', async () => {
  const r = transfersRig('ir-manager', false);
  const res = await r.svc.read(principal(MANAGER));
  assert.equal(res.value.since, '2026-04');
  assert.equal(res.value.total, 3);
  assert.deepEqual(res.value.months.slice(0, 2).map((m) => [m.month, m.count, m.units, m.value]), [['2026-09', 1, 2, null], ['2026-08', 2, 5, null]]);
  assert.equal(res.value.months.length, 6);
  assert.equal(res.value.medianDays, 26);
  assert.match(r.queries[0], /Said_Yes_At >= '2026-04-01T00:00:00\+05:30'/);
  assert.ok(!/Legacy_Record/.test(r.queries[0]));
  assert.match(r.queries[2], /Allocation_Status != 'Cancelled'/);
});

test('value only for money seats; legacy rows left out once the field exists; an IR is refused', async () => {
  let res = await transfersRig('head-of-finance', true).svc.read(principal(MANAGER));
  assert.deepEqual(res.value.months.slice(0, 2).map((m) => m.value), [5000000, 12500000]);
  const r = transfersRig('ir-manager', false, true);
  await r.svc.read(principal(MANAGER));
  assert.match(r.queries[0], /Legacy_Record is null or Legacy_Record = false/);
  res = await transfersRig('investor-relations', false).svc.read(principal(IR));
  assert.equal(res.reasonCode, 'capability-missing');
});
