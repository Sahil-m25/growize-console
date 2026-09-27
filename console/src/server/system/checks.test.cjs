/* M17-S06 SYSTEM CHECKS REGRESSION — Run from console/: node src/server/system/checks.test.cjs */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const consoleRoot = path.resolve(__dirname, '..', '..', '..');
const srcRoot = path.join(consoleRoot, 'src');
const ts = require(path.join(consoleRoot, 'node_modules', 'typescript'));
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'system-checks-'));
process.on('exit', () => fs.rmSync(outDir, { recursive: true, force: true }));
const config = ts.readConfigFile(path.join(consoleRoot, 'tsconfig.json'), ts.sys.readFile);
const project = ts.parseJsonConfigFileContent(config.config, ts.sys, consoleRoot);
const options = { ...project.options, incremental: false, tsBuildInfoFile: undefined, plugins: undefined, module: ts.ModuleKind.CommonJS,
  moduleResolution: ts.ModuleResolutionKind.Node10, noEmit: false, noEmitOnError: true, outDir, rootDir: srcRoot };
const program = ts.createProgram(['lib/zoho/errors.ts', 'lib/zoho/gate.ts', 'lib/zoho/log.ts', 'server/oauth/seat.ts', 'server/system/checks.ts'].map((f) => path.join(srcRoot, f)), options);
const diags = ts.getPreEmitDiagnostics(program);
if (diags.length) { console.error(ts.formatDiagnostics(diags, { getCanonicalFileName: (f) => f, getCurrentDirectory: () => consoleRoot, getNewLine: () => '\n' })); process.exit(1); }
program.emit();
const { systemChecks, systemPage } = require(path.join(outDir, 'server', 'system', 'checks.js'));

const NOW = Date.parse('2026-09-27T15:30:00Z');
const H = 3_600_000, D = 24 * H;
const call = (at, over = {}) => ({ kind: 'zoho-call', at, actor: { kind: 'user', userId: '9007199254740995001' }, op: 'coql', method: 'POST', endpoint: '/coql',
  callClass: 'simple', status: 200, durationMs: 100, gateWaitMs: 0, attempt: 1, creditsRemaining: null, errorClass: null, recordIds: [], ...over });
const HEALTHY = Object.freeze({
  ops: [call(NOW - H, { creditsRemaining: 42_000 }), call(NOW - 2 * H)],
  serviceTokenExpiry: { 'audit-archive': NOW + 20 * H },
  cache: { reads: 1000, errors: 2 },
  auditArchiveLastRun: NOW - D, licenceExpiry: NOW + 200 * D,
  sign: { lastEventAt: NOW - 3 * H, failedHmac24h: 0 },
  push: { lastDeliveredAt: NOW - H, failures24h: 0 },
});
const DI = { userId: '9007199254740995010', roleId: '9007199254740998001', profileId: '9007199254740998002', seat: 'digital-infrastructure' };

test('every check comes from the operational log and held facts; all working when healthy', () => {
  const page = systemPage(DI, HEALTHY, NOW);
  assert.equal(page.ok, true);
  assert.deepEqual([page.value.working, page.value.attention, page.value.down], [page.value.all.length, 0, 0]);
  assert.deepEqual(page.value.all.map((c) => c.key), ['credits', '429s', 'errors', 'token:audit-archive', 'cache', 'archive', 'licence', 'sign', 'push']);
  assert.equal(page.value.all[0].figure, '42000');
});

test('trouble shows as cards, not-working first, each with an owner and a fix', () => {
  const bad = { ...HEALTHY,
    ops: [call(NOW - H, { creditsRemaining: 800, status: 429, errorClass: 'concurrency-exceeded' }), call(NOW - 30 * H, { status: 429 })],
    serviceTokenExpiry: { 'audit-archive': NOW - 1 }, licenceExpiry: NOW + 10 * D,
    sign: { lastEventAt: NOW - H, failedHmac24h: 2 }, push: { lastDeliveredAt: null, failures24h: 1 } };
  const page = systemPage(DI, bad, NOW);
  const state = Object.fromEntries(page.value.all.map((c) => [c.key, c.state]));
  assert.equal(state.credits, 'down');
  assert.equal(state['429s'], 'attention', 'only the 429 inside 24 hours counts');
  assert.equal(state['token:audit-archive'], 'down');
  assert.equal(state.licence, 'attention');
  assert.equal(state.sign, 'down');
  assert.equal(state.push, 'attention');
  assert.equal(page.value.cards[0].state, 'down');
  assert.ok(page.value.cards.every((c) => c.owner && c.fix));
});

test('only Digital Infrastructure opens System', () => {
  assert.deepEqual(systemPage({ ...DI, seat: 'ir-manager' }, HEALTHY, NOW), { ok: false, kind: 'refused', reasonCode: 'not-digital-infrastructure' });
  assert.equal(systemPage(null, HEALTHY, NOW).ok, false);
});
