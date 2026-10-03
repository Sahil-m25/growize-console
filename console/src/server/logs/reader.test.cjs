/* M15-S05-T01 — PLANES B AND C, READ BACK AND FILTERED: who may read, reveals and withholding, failed
 * step-ups, the person filter, API headroom from X-API-CREDITS-REMAINING, the `event` kind, and the day
 * files replayed from __fixtures__/logs. Run from console/: node --test src/server/logs/reader.test.cjs */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const compile = require('./compile.cjs');

const { load } = compile(['server/logs/reader.ts', 'server/logs/factory.ts'], 'logs-reader');
const { queryLogs, logAccessOf, logSourceOf, planeBBetween, SIGN_IN_HISTORY, MAX_RANGE_DAYS } = load('server/logs/reader.js');
const { createLogSinks } = load('server/logs/factory.js');
const { createOpsLog, createMemorySink } = load('lib/zoho/log.js');
const { createPlaneCLog } = load('server/identity/plane-c.js');

const FX = path.resolve(__dirname, '..', '..', 'lib', 'zoho', '__fixtures__', 'logs');
const HARSHA = '9007199254740993002', ROHIT = '9007199254740995001', MEENA = '9007199254740996001', SAHIL = '9007199254740990001';
const PRAKASH = '9007199254740997301';
const NOW = Date.parse('2026-09-28T10:00:00Z');

/** The recorded day files, copied to a fresh LOG_DIR and read through the real jsonl store. */
function fixtureSinks() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gz-logs-read-'));
  for (const f of fs.readdirSync(FX)) fs.copyFileSync(path.join(FX, f), path.join(dir, f));
  return createLogSinks({ LOG_STORE: 'jsonl', LOG_DIR: dir }, { clock: () => NOW });
}
const q = (seat, p = {}, sinks = fixtureSinks()) => queryLogs({ seat }, p, logSourceOf(sinks), NOW);

test('who may read: Digital Infrastructure (di, ops), Administrator, Super administrator and the Auditor; identity rights only with pii', () => {
  for (const s of ['di', 'ops', 'admin', 'root', 'audit']) assert.equal(logAccessOf(s).read, true, s);
  for (const s of ['head', 'fin', 'comp', 'kam', 'amlead', 'ir', 'conv', 'cp', 'exec', 'bu', 'stranger', '']) assert.equal(logAccessOf(s).read, false, s);
  assert.deepEqual(['di', 'ops', 'root', 'admin', 'audit'].map((s) => logAccessOf(s).identity), [true, true, false, false, false]);
  assert.deepEqual(q('kam'), { ok: false, reason: 'not-a-log-reader' });
});

test('day files replay: torn and foreign lines are skipped; newest first; Planes B and C together; sign-in history points to Zoho Directory', () => {
  const r = q('di');
  assert.equal(r.ok, true);
  assert.deepEqual([r.from, r.to], ['2026-09-28', '2026-09-28']);
  assert.equal(r.total, 7 + 1 + 5, 'seven good Plane B lines (one torn, one foreign skipped), one error line, five Plane C lines');
  assert.ok(r.rows.every((x, i) => i === 0 || r.rows[i - 1].at >= x.at), 'newest first');
  assert.equal(r.signInHistory.where, 'Zoho Directory → Security Control → Login History');
  assert.equal(SIGN_IN_HISTORY.runbook, 'ops/runbooks/sign-in-history.md');
  const rb = fs.readFileSync(path.resolve(__dirname, '..', '..', '..', '..', SIGN_IN_HISTORY.runbook), 'utf8'); // M15-S05-T03: the page the Logs screen points at exists
  assert.ok(rb.includes('Login History') && rb.includes(SIGN_IN_HISTORY.who) && /How often/.test(rb), 'the runbook names where, who and how often');
  assert.equal(r.rows.some((x) => x.kind === 'sign-in' && x.actorId === MEENA), false, "yesterday's file is outside today's range");
  assert.equal(q('di', { from: '2026-09-27' }).total, 14);
});

test('TC-IM10-010: Harsha reveals a PAN — the first row is an Identity entry "Revealed a PAN" on the Contact; 1 identity reveal', () => {
  const r = q('di');
  const first = r.rows[0];
  assert.deepEqual([first.plane, first.group, first.kind, first.label, first.actorId, first.outcome], ['c', 'identity', 'reveal', 'Revealed a PAN', HARSHA, 'ok']);
  assert.deepEqual(first.recordIds, [PRAKASH]);
  assert.equal(first.withheld, false);
  assert.equal(r.identityReveals, 1);
});

test('TC-IM10-012: the Super administrator sees the reveal as "Identity event", investor withheld, still counted', () => {
  const r = q('root');
  const first = r.rows[0];
  assert.deepEqual([first.label, first.actorId, first.withheld, first.reason, first.recordIds.length], ['Identity event', HARSHA, true, null, 0]);
  assert.equal(r.identityReveals, 1);
  assert.equal(r.identity, false);
  assert.ok(!JSON.stringify(r).includes(PRAKASH), 'the Contact id appears nowhere');
  assert.ok(!JSON.stringify(q('audit')).includes(PRAKASH), 'nor for the Auditor');
});

test('a failed step-up is an Identity entry with outcome "failed"; kind=identity keeps reveals and step-ups', () => {
  const r = q('di', { kind: 'identity' });
  assert.deepEqual(r.rows.map((x) => [x.kind, x.outcome, x.label]), [['reveal', 'ok', 'Revealed a PAN'], ['step-up', 'ok', 'Stepped up'], ['step-up', 'failed', 'Step-up failed']]);
  assert.equal(q('di', { outcome: 'failed', plane: 'c' }).total, 1);
});

test('TC-E11-017: a refused action is one Plane B refusal naming Rohit, events-edit and the time', () => {
  const r = q('di', { plane: 'b', actor: ROHIT, outcome: 'refused' });
  assert.equal(r.total, 1);
  assert.deepEqual([r.rows[0].kind, r.rows[0].action, r.rows[0].reason, r.rows[0].when], ['refusal', 'events-edit', 'seat-denied', '2026-09-28T09:30:05+05:30']);
});

test('TC-IM10-011 (data): the person filter shows only that person\'s rows, with their count', () => {
  const all = q('di');
  const r = q('di', { actor: MEENA });
  assert.equal(r.total, all.byActor[MEENA]);
  assert.ok(r.rows.length > 0 && r.rows.every((x) => x.actorId === MEENA));
  assert.equal(r.byActor[SAHIL], 1, 'the chips still count everyone');
});

test('TC-E11-018: X-API-CREDITS-REMAINING read back from Plane B for the headroom check; 429s and failures counted', () => {
  const h = q('di').headroom;
  assert.deepEqual(h, { calls: 4, r429: 1, failed: 1, lastCreditsRemaining: 4500, lowestCreditsRemaining: 4200, creditsWarning: true });
  assert.deepEqual(q('di', { plane: 'c' }).headroom.calls, 0);
});

test('the success kind: a Plane B `event` is ok, never a refusal; kind=event filters it', () => {
  const r = q('di', { kind: 'event' });
  assert.deepEqual(r.rows.map((x) => [x.action, x.outcome, x.reason]), [['lead-search', 'ok', 'scope-user.count-3']]);
});

test('invalid filters are ignored and named; the range is capped at 31 days; paging', () => {
  const r = q('di', { from: '2026-02-30', to: 'soon', plane: 'z', kind: 'DROP TABLE', actor: 'a@b.c', outcome: 'maybe', limit: '2', offset: '1' });
  assert.deepEqual([...r.ignored].sort(), ['actor', 'from', 'kind', 'outcome', 'plane', 'to']);
  assert.equal(r.rows.length, 2);
  assert.equal(r.offset, 1);
  const w = q('di', { from: '2026-01-01', to: '2026-09-28' });
  assert.ok(w.ignored.includes('range'));
  assert.equal((Date.parse(w.to) - Date.parse(w.from)) / 86400000, MAX_RANGE_DAYS - 1);
});

test('written, then read: createOpsLog.event and .call through the memory sinks, filtered by day; headroom ignores events', () => {
  const sinks = createLogSinks({}, { clock: () => NOW });
  const log = createOpsLog(sinks.ops);
  log.event({ at: NOW, actor: { kind: 'user', userId: MEENA }, action: 'lead-search', reason: 'scope-user.count-2', recordIds: [] });
  log.event({ at: NOW, actor: { kind: 'user', userId: MEENA }, action: 'lead search', reason: 'Prakash 9845033021', recordIds: ['9845033021'] });
  log.call({ at: NOW, actor: { kind: 'user', userId: MEENA }, op: 'coql', method: 'POST', endpoint: '/coql', callClass: 'complex', status: 200,
    durationMs: 5, gateWaitMs: 0, attempt: 1, creditsRemaining: 3900, errorClass: null, recordIds: [] });
  createPlaneCLog(sinks.identity).record({ at: NOW, who: HARSHA, action: 'step-up', outcome: 'refused', reason: 'failed', seat: 'head' });
  const recs = sinks.ops.records();
  assert.deepEqual(recs[1], { kind: 'event', at: NOW, actor: { kind: 'user', userId: MEENA }, action: 'unrecognised', reason: 'unrecognised', recordIds: [] }, 'no text or number rides in an event');
  assert.equal(sinks.ops.headroom().calls, 1);
  assert.equal(sinks.ops.headroom().refusals, 0);
  const r = queryLogs({ seat: 'ops' }, {}, logSourceOf(sinks), NOW);
  assert.deepEqual([r.total, r.headroom.lastCreditsRemaining, r.rows.filter((x) => x.outcome === 'failed').length], [4, 3900, 1]);
  assert.equal(queryLogs({ seat: 'ops' }, { to: '2026-09-27' }, logSourceOf(sinks), NOW).total, 0);
  assert.equal(planeBBetween(logSourceOf(sinks), NOW - 1, NOW + 1).length, 3);
  const plain = createMemorySink();
  createOpsLog(plain).event({ at: 1, actor: { kind: 'service', job: 'x' }, action: 'test-link-used', reason: 'first-use', recordIds: [PRAKASH] });
  assert.equal(plain.records()[0].kind, 'event');
});

test('Plane C admin labels: console access granted / ended, a reporting-line change, and a seat change\'s pooled count', () => {
  const sinks = createLogSinks({}, { clock: () => NOW });
  const c = createPlaneCLog(sinks.identity);
  const A = '9007199254740993007', B = '9007199254740993008', X = '9007199254740997101', Y = '9007199254740997102';
  c.record({ at: NOW - 4, who: SAHIL, whom: A, action: 'access-granted', outcome: 'ok', reason: 'payments', seat: 'di' });
  c.record({ at: NOW - 3, who: SAHIL, whom: A, action: 'access-ended', outcome: 'ended', reason: 'no-page-left', seat: 'di' });
  c.record({ at: NOW - 2, who: SAHIL, whom: B, action: 'manager-change', outcome: 'ok', reason: 'moved', seat: 'di' });
  c.record({ at: NOW - 1, who: SAHIL, whom: B, action: 'seat-change', outcome: 'ok', reason: 'kam-to-amlead', seat: 'di', count: 2, recordIds: [X, Y] });
  c.record({ at: NOW, who: SAHIL, whom: A, action: 'seat-change', outcome: 'ok', reason: 'fin-to-head', seat: 'di', count: 1, recordIds: [X] });
  const r = queryLogs({ seat: 'di' }, {}, logSourceOf(sinks), NOW);
  assert.deepEqual(r.rows.map((x) => [x.kind, x.group, x.label]), [
    ['seat-change', 'identity', 'Seat changed · 1 account returned to the pool'],
    ['seat-change', 'identity', 'Seat changed · 2 accounts returned to the pool'],
    ['manager-change', 'access', 'Changed who they report to'],
    ['access-ended', 'access', 'Console access ended'],
    ['access-granted', 'access', 'Console access granted'],
  ]);
});
