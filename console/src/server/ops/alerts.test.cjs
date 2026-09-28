/* M18-S04-T02 ALERTS — each rule's threshold, window, cool-down; Plane B taps; delivery never throws.
 * Run from console/: node --test src/server/ops/alerts.test.cjs
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const consoleRoot = path.resolve(__dirname, '..', '..', '..');
const srcRoot = path.join(consoleRoot, 'src');
const ts = require(path.join(consoleRoot, 'node_modules', 'typescript'));
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alerts-'));
process.on('exit', () => fs.rmSync(outDir, { recursive: true, force: true }));
const config = ts.readConfigFile(path.join(consoleRoot, 'tsconfig.json'), ts.sys.readFile);
const project = ts.parseJsonConfigFileContent(config.config, ts.sys, consoleRoot);
const options = {
  ...project.options, incremental: false, tsBuildInfoFile: undefined, plugins: undefined,
  module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10,
  noEmit: false, noEmitOnError: true, outDir, rootDir: srcRoot,
};
const program = ts.createProgram([path.join(srcRoot, 'server', 'ops', 'alerts.ts'), path.join(srcRoot, 'lib', 'zoho', 'log.ts')], options);
const format = (items) => ts.formatDiagnostics(items, { getCanonicalFileName: (f) => f, getCurrentDirectory: () => consoleRoot, getNewLine: () => '\n' });
const diagnostics = ts.getPreEmitDiagnostics(program);
if (diagnostics.length) { console.error(format(diagnostics)); process.exit(1); }
const emitted = program.emit();
if (emitted.diagnostics.length) { console.error(format(emitted.diagnostics)); process.exit(1); }

const { createAlertEngine, createOutboxMailer, eventsFromOps, eventsFromErrors, tapOpsSink, ALERT_RULES, projectCredits, creditProjectionLine, creditProjectionCode, kolkataDayStart } = require(path.join(outDir, 'server', 'ops', 'alerts.js'));
const { createOpsLog, createMemorySink } = require(path.join(outDir, 'lib', 'zoho', 'log.js'));

const MIN = 60_000;
// 2026-09-28 10:00 Asia/Kolkata
const T0 = Date.UTC(2026, 8, 28, 4, 30);

function rig() {
  const mailer = createOutboxMailer();
  const engine = createAlertEngine({ mailer, to: 'alerts@example.invalid', clock: () => T0 });
  return { mailer, engine };
}
const save = (at, i = 0) => ({ kind: 'save-failed', at, requestId: `save-req-${i}0000`, route: '/leads/{id}' });
const s5xx = (at, i = 0) => ({ kind: 'server-error', at, requestId: `srv-req-${i}0000`, route: '/api/data' });

test('failed saves: 2 in 10 min is quiet, the 3rd fires; 3 spread past 10 min do not', async () => {
  const { mailer, engine } = rig();
  assert.equal(engine.record(save(T0, 1)).length, 0);
  assert.equal(engine.record(save(T0 + 4 * MIN, 2)).length, 0);
  const [a] = engine.record(save(T0 + 9 * MIN, 3));
  assert.equal(a.rule, 'failed-saves');
  assert.equal(a.count, 3);
  await engine.settled();
  assert.equal(mailer.sent().length, 1);
  assert.equal(mailer.sent()[0].to, 'alerts@example.invalid');

  const b = rig();
  b.engine.record(save(T0, 1));
  b.engine.record(save(T0 + 5 * MIN, 2));
  assert.equal(b.engine.record(save(T0 + 10 * MIN, 3)).length, 0, 'the first save is exactly 10 min old — out of the window');
});

test('failed saves: cool-down of 30 min after firing', () => {
  const { engine } = rig();
  for (let i = 0; i < 3; i++) engine.record(save(T0 + i * MIN, i));
  for (let i = 0; i < 3; i++) assert.equal(engine.record(save(T0 + (5 + i) * MIN, i)).length, 0);
  const again = [];
  for (let i = 0; i < 3; i++) again.push(...engine.record(save(T0 + (31 + i) * MIN, i)));
  assert.equal(again.length, 1);
});

test('5xx spike: 4 in 5 min quiet, 5th fires; 5 spread over 6 min do not', () => {
  const { engine } = rig();
  for (let i = 0; i < 4; i++) assert.equal(engine.record(s5xx(T0 + i * MIN, i)).length, 0);
  const [a] = engine.record(s5xx(T0 + 4 * MIN + 59_000, 4));
  assert.equal(a.rule, 'server-error-spike');
  assert.ok(a.refs.includes('/api/data srv-req-40000'));

  const b = rig();
  for (let i = 0; i < 5; i++) assert.equal(b.engine.record(s5xx(T0 + i * 90_000, i)).length, 0);
});

test('credits header: fires on the first sighting of the Kolkata day only, and again the next day', () => {
  const { engine } = rig();
  assert.equal(engine.record({ kind: 'credits-header', at: T0, creditsRemaining: 24_000 }).length, 1);
  assert.equal(engine.record({ kind: 'credits-header', at: T0 + 3 * 60 * MIN, creditsRemaining: 20_000 }).length, 0);
  // 2026-09-28 23:59 IST is still the same day; 00:01 IST on the 29th is not.
  assert.equal(engine.record({ kind: 'credits-header', at: Date.UTC(2026, 8, 28, 18, 29), creditsRemaining: 100 }).length, 0);
  assert.equal(engine.record({ kind: 'credits-header', at: Date.UTC(2026, 8, 28, 18, 31), creditsRemaining: 49_000 }).length, 1);
});

test('token refresh, Sign webhook, push and backup failures fire on the first event', () => {
  for (const e of [
    { kind: 'token-refresh-failed', at: T0, job: 'provider-callback' },
    { kind: 'sign-webhook-failed', at: T0, reason: 'crm-failed' },
    { kind: 'push-failed', at: T0, reason: 'investor-app-5xx' },
    { kind: 'backup-failed', at: T0, reason: 'bulk-read-failed' },
  ]) {
    const { engine } = rig();
    const fired = engine.record(e);
    assert.equal(fired.length, 1, e.kind);
    assert.equal(engine.record({ ...e, at: T0 + MIN }).length, 0, `${e.kind} cool-down`);
  }
  assert.deepEqual(ALERT_RULES.map((r) => r.key).sort(), ['backup-failed', 'credits-header', 'failed-saves', 'push-failed', 'server-error-spike', 'sign-webhook-failed', 'token-refresh-failed']);
});

test('Plane B taps: credits header, failed refreshToken and Sign-webhook failures become events; a forged signature does not', () => {
  const { mailer, engine } = rig();
  const inner = createMemorySink();
  const log = createOpsLog(tapOpsSink(inner, () => engine));
  const call = { at: T0, actor: { kind: 'service', job: 'provider-callback' }, method: 'POST', endpoint: '/oauth/v2/token', callClass: 'simple', durationMs: 1, gateWaitMs: 0, attempt: 1, recordIds: [] };
  log.call({ ...call, op: 'refreshToken', status: 200, creditsRemaining: null, errorClass: null });
  assert.equal(engine.fired().length, 0);
  log.call({ ...call, op: 'refreshToken', status: 500, creditsRemaining: null, errorClass: 'server' });
  log.call({ ...call, op: 'getRecord', endpoint: '/Deals/{id}', status: 200, creditsRemaining: 12_000, errorClass: null });
  log.refusal({ at: T0, actor: { kind: 'service', job: 'provider-callback' }, action: 'signWebhook', reason: 'invalid-signature', recordIds: [] });
  log.refusal({ at: T0, actor: { kind: 'service', job: 'provider-callback' }, action: 'signWebhook', reason: 'callback-unavailable', recordIds: [] });
  assert.deepEqual(engine.fired().map((a) => a.rule).sort(), ['credits-header', 'sign-webhook-failed', 'token-refresh-failed']);
  assert.equal(inner.records().length, 7, 'the inner sink still receives every line, plus the two credits-alarm event lines (M18-S01-T03)');
  assert.equal(eventsFromOps({ kind: 'refusal', at: 0, actor: { kind: 'user', userId: 'x' }, action: 'update', reason: 'crm-failed', recordIds: [] }).length, 0);
  void mailer;
});

test('error lines: a route 5xx is a server-error event, a 4xx is not; a client save-failed is a save event', () => {
  assert.equal(eventsFromErrors({ kind: 'route-error', status: 503, at: 1, requestId: 'r-00000001', route: '/api/x' })[0].kind, 'server-error');
  assert.equal(eventsFromErrors({ kind: 'route-error', status: 409, at: 1, requestId: 'r-00000001', route: '/api/x' }).length, 0);
  assert.equal(eventsFromErrors({ kind: 'client-error', source: 'save-failed', at: 1, failedRequestId: null, route: '/leads' })[0].kind, 'save-failed');
  assert.equal(eventsFromErrors({ kind: 'client-error', source: 'onerror', at: 1, failedRequestId: null, route: '/leads' }).length, 0);
});

test('a mailer that throws never throws into the caller; the alert text holds no identity', async () => {
  const errors = [];
  const engine = createAlertEngine({ mailer: { send: async () => { throw new Error('smtp down'); } }, onDeliveryError: (e) => errors.push(e) });
  assert.equal(engine.record({ kind: 'backup-failed', at: T0, reason: 'bulk-read-failed' }).length, 1);
  await engine.settled();
  assert.equal(errors.length, 1);

  const { mailer, engine: e2 } = rig();
  e2.record({ kind: 'push-failed', at: T0, reason: 'sanjay@example.com' });
  await e2.settled();
  assert.ok(!mailer.sent()[0].text.includes('sanjay'), 'a reason that is not a code is not quoted');
  assert.match(mailer.sent()[0].text, /2026-09-28T10:00/);
});

/* ===== M18-S01-T03 — API-credits alarm: Plane B event + daily projection ===== */
const HOUR = 60 * MIN;
const MIDNIGHT = Date.UTC(2026, 8, 27, 18, 30); // 2026-09-28 00:00 Asia/Kolkata

test('T03 projection: one reading uses the half-allowance basis (spent ≈ left, since Kolkata midnight)', () => {
  assert.equal(kolkataDayStart(T0), MIDNIGHT);
  // 10:00 IST, 20,000 left → spent ~20,000 in 10 h → 2,000/h → 14,000 more by midnight → runs out at 20:00.
  const p = projectCredits([{ at: T0, creditsRemaining: 20_000 }]);
  assert.equal(p.basis, 'half-allowance');
  assert.equal(p.usedPerHour, 2_000);
  assert.equal(p.projectedAtDayEnd, 20_000 - 2_000 * 14);
  assert.equal(p.exhaustsAt, T0 + 10 * HOUR);
  assert.equal(creditProjectionCode(p), 'exhausts-2000');
  assert.match(creditProjectionLine(p), /^Credits projection 2026-09-28: 20000 left at 10:00 Asia\/Kolkata; about 2000\/h \(half-allowance basis\); runs out about 20:00 at this rate\.$/);
});

test('T03 projection: two readings 10+ min apart use the trend; yesterday\'s readings are ignored', () => {
  const p = projectCredits([
    { at: MIDNIGHT - HOUR, creditsRemaining: 1 }, // yesterday
    { at: T0, creditsRemaining: 30_000 },
    { at: T0 + 2 * HOUR, creditsRemaining: 29_000 }, // 500/h
  ]);
  assert.equal(p.basis, 'trend');
  assert.equal(p.usedPerHour, 500);
  assert.equal(p.projectedAtDayEnd, 29_000 - 500 * 12);
  assert.equal(p.exhaustsAt, null);
  assert.equal(creditProjectionCode(p), 'end-of-day-23000');
  assert.equal(projectCredits([]), null);
  assert.equal(creditProjectionCode(null), 'no-rate');
  assert.match(creditProjectionLine(null), /no X-API-CREDITS-REMAINING reading yet/);
});

test('T03 alarm: the first header of the day writes credits-alarm + credits-projection to Plane B and mails the projection; later headers do not', async () => {
  const { mailer, engine } = rig();
  const inner = createMemorySink();
  const log = createOpsLog(tapOpsSink(inner, () => engine));
  const call = { actor: { kind: 'user', userId: '554023000000100001' }, op: 'coql', method: 'POST', endpoint: '/coql', callClass: 'complex', status: 200, durationMs: 40, gateWaitMs: 0, attempt: 1, errorClass: null, recordIds: [] };
  log.call({ ...call, at: T0 - HOUR, creditsRemaining: null });
  assert.equal(inner.records().filter((r) => r.kind === 'event').length, 0, 'no header, no alarm');
  log.call({ ...call, at: T0, creditsRemaining: 20_000 });
  log.call({ ...call, at: T0 + MIN, creditsRemaining: 19_990 });
  const events = inner.records().filter((r) => r.kind === 'event');
  assert.deepEqual(events.map((e) => [e.action, e.reason, e.actor.job]), [
    ['credits-alarm', 'remaining-20000', 'ops-alerts'],
    ['credits-projection', 'exhausts-2000', 'ops-alerts'],
  ]);
  assert.equal(events[0].at, T0);
  await engine.settled();
  assert.equal(mailer.sent().length, 1, 'one alert for the day');
  assert.match(mailer.sent()[0].text, /credits=20000/);
  assert.match(mailer.sent()[0].text, /Credits projection 2026-09-28: 20000 left at 10:00/);
  assert.equal(engine.creditProjection().remaining, 19_990, 'later readings still feed the projection');
  for (const r of inner.records()) assert.doesNotMatch(JSON.stringify(r), /@/);
});
