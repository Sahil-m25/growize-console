/* C4 / Me — my badge (shared state store, not Zoho) and the activity export's log line (no Zoho, no values).
 * Run from console/: node --test src/server/me/me.test.cjs */
'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const compile = require('../logs/compile.cjs');

const { load } = compile(['server/me/style.ts', 'server/me/export-audit.ts', 'server/state/memory.ts', 'lib/zoho/log.ts'], 'me');
const { createStyle } = load('server/me/style.js');
const { createExportAudit } = load('server/me/export-audit.js');
const { createMemoryState } = load('server/state/memory.js');

const P = '9007199254';
const ME = `${P}740995001`, OTHER = `${P}740995002`;

const styleRig = () => { const state = createMemoryState(); return { state, svc: createStyle({ state }) }; };

test('my badge is kept per person, merged field by field, and read back', async () => {
  const { svc } = styleRig();
  assert.deepEqual(await svc.get(ME), {});
  assert.deepEqual((await svc.set(ME, { c: 3, sq: true })).value, { c: 3, sq: true });
  assert.deepEqual((await svc.set(ME, { i: 'ab' })).value, { c: 3, sq: true, i: 'AB' }, 'initials are upper-cased and merged in');
  assert.deepEqual(await svc.get(ME), { c: 3, sq: true, i: 'AB' });
  assert.deepEqual(await svc.get(OTHER), {}, 'only my entry changed');
  assert.deepEqual(await svc.getMany([ME, OTHER]), { [ME]: { c: 3, sq: true, i: 'AB' } });
});

test('a colour outside 1-8, blank initials, a non-boolean shape or an empty change is refused and nothing is kept', async () => {
  const { svc } = styleRig();
  assert.equal((await svc.set(ME, { c: 9 })).reasonCode, 'invalid-colour');
  assert.equal((await svc.set(ME, { c: 'red' })).reasonCode, 'invalid-colour');
  assert.equal((await svc.set(ME, { i: '--' })).reasonCode, 'invalid-initials');
  assert.equal((await svc.set(ME, { sq: 'yes' })).reasonCode, 'invalid-request');
  assert.equal((await svc.set(ME, {})).reasonCode, 'invalid-request');
  assert.equal((await svc.set('not-a-user-id', { c: 2 })).reasonCode, 'invalid-request');
  assert.deepEqual(await svc.get(ME), {});
});

test('a store that cannot answer is "unavailable" on a write and nothing on a read, never a guess', async () => {
  const broken = { async get() { throw new Error('down'); }, async set() { throw new Error('down'); } };
  const svc = createStyle({ state: broken });
  assert.equal((await svc.set(ME, { c: 2 })).reasonCode, 'unavailable');
  assert.deepEqual(await svc.get(ME), {});
});

test('a stored value that is not our three fields is dropped when read', async () => {
  const { state, svc } = styleRig();
  await state.set(`me-style|${ME}`, JSON.stringify({ c: 99, sq: 'x', i: 'toolong', extra: 'y' }));
  assert.deepEqual(await svc.get(ME), {});
});

const auditRig = () => {
  const lines = [];
  const state = createMemoryState();
  return { lines, svc: createExportAudit({ state, log: { call() {}, refusal() {}, event: (e) => lines.push(e) }, clock: () => 1_700_000_000_000 }) };
};

test('an export writes one server log line: who, when, view and row count — no values', async () => {
  const { lines, svc } = auditRig();
  const r = await svc.record({ userId: ME, seat: 'ir' }, { view: 'person', rows: 42 });
  assert.deepEqual(r, { ok: true, replayed: false });
  assert.deepEqual(lines, [{ at: 1_700_000_000_000, actor: { kind: 'user', userId: ME }, action: 'activity-export', reason: 'person.rows-42', recordIds: [] }]);
});

test('the same Idempotency-Key logs once; a new key logs again', async () => {
  const { lines, svc } = auditRig();
  const who = { userId: ME, seat: 'ir' }, body = { view: 'log', rows: 5 };
  assert.equal((await svc.record(who, body, 'key-aaaaaaaa')).replayed, false);
  assert.equal((await svc.record(who, body, 'key-aaaaaaaa')).replayed, true);
  assert.equal(lines.length, 1);
  await svc.record(who, body, 'key-bbbbbbbb');
  assert.equal(lines.length, 2);
});

test('an unknown view, a bad row count, a bad key or a seat with no Activity page logs nothing', async () => {
  const { lines, svc } = auditRig();
  const who = { userId: ME, seat: 'ir' };
  assert.equal((await svc.record(who, { view: 'raw', rows: 1 })).reasonCode, 'invalid-request');
  assert.equal((await svc.record(who, { view: 'log', rows: -1 })).reasonCode, 'invalid-request');
  assert.equal((await svc.record(who, { view: 'log', rows: 1.5 })).reasonCode, 'invalid-request');
  assert.equal((await svc.record(who, { view: 'log', rows: 10_000_000 })).reasonCode, 'invalid-request');
  assert.equal((await svc.record(who, { view: 'log', rows: 1 }, 'x')).reasonCode, 'invalid-request');
  assert.equal((await svc.record({ userId: 'nope', seat: 'ir' }, { view: 'log', rows: 1 })).reasonCode, 'invalid-request');
  assert.equal((await svc.record({ userId: ME, seat: 'nobody' }, { view: 'log', rows: 1 })).reasonCode, 'no-activity');
  assert.equal(lines.length, 0);
});

test('through the real ops log the line survives its own allow-list: action, reason code and actor, nothing else', async () => {
  const { createOpsLog, createMemorySink } = load('lib/zoho/log.js');
  const sink = createMemorySink();
  const svc = createExportAudit({ state: createMemoryState(), log: createOpsLog(sink), clock: () => 1_700_000_000_000 });
  await svc.record({ userId: ME, seat: 'ir' }, { view: 'day', rows: 7 });
  const rec = sink.records().find((r) => r.kind === 'event');
  assert.ok(rec, 'an event record was written');
  assert.equal(rec.action, 'activity-export');
  assert.equal(rec.reason, 'day.rows-7');
  assert.equal(rec.actor.userId, ME);
  assert.deepEqual(rec.recordIds, []);
});
