/* R5 — MOVE A WHOLE KAM BOOK (server/investors/kam-move-book): every Contact goes through kam-assign's guard.
 *
 * Run from console/: node --test src/server/investors/kam-move-book.test.cjs
 * Compiles the production module with the project's strict settings; the Zoho client and the assignment are stubs. No request leaves.
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
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoho-kam-move-book-'));
process.on('exit', () => fs.rmSync(outDir, { recursive: true, force: true }));

const config = ts.readConfigFile(path.join(consoleRoot, 'tsconfig.json'), ts.sys.readFile);
const project = ts.parseJsonConfigFileContent(config.config, ts.sys, consoleRoot);
const options = {
  ...project.options, incremental: false, tsBuildInfoFile: undefined, plugins: undefined,
  module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10,
  noEmit: false, noEmitOnError: true, outDir, rootDir: srcRoot,
};
const sources = ['server/investors/kam-move-book.ts', 'server/investors/kam-share-queue.ts', 'server/state/memory.ts', 'lib/zoho/log.ts'].map((f) => path.join(srcRoot, f));
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
const { createKamMoveBook, parseMoveBook } = load('server/investors/kam-move-book.js');
const { runWithDeadline } = load('lib/zoho/deadline.js');
const { createKamShareQueue } = load('server/investors/kam-share-queue.js');
const { createMemoryState } = load('server/state/memory.js');
const { createOpsLog, createMemorySink } = load('lib/zoho/log.js');

const P = '554023';
const id = (n) => `${P}0000005${String(n).padStart(5, '0')}`;
const DIVYA = `${P}000000300010`, FROM = `${P}000000300011`, TO = `${P}000000300013`, IR = `${P}000000300005`;
const cred = { userId: DIVYA };
const principal = { credential: cred, sessionId: 'sid' };
const MT = '2026-10-04T10:00:00+05:30';

function rig({ book = [], mayAssign = 'amlead', assigneeSeat = 'key-account-manager', refuse = {}, stopAfter = null, pages = null, share = undefined } = {}) {
  const calls = { coql: [], assign: [], refusals: [] };
  const crm = { async coql(_c, q) {
    calls.coql.push(q);
    const m = /limit (\d+), (\d+)/.exec(q); const off = Number(m[1]), n = Number(m[2]);
    const rows = book.slice(off, off + n).map((x) => ({ id: x, Modified_Time: MT }));
    return { ok: true, value: { records: rows, moreRecords: off + n < book.length } };
  } };
  let started = 0;
  const assignment = { async assign(_p, cmd) {
    calls.assign.push(cmd); started++;
    const why = refuse[cmd.contactId];
    if (why === 'conflict') return { ok: false, kind: 'conflict', recordId: cmd.contactId, message: 'x' };
    if (why) return { ok: false, kind: 'refused', reason: why };
    return { ok: true, value: { contactId: cmd.contactId, fromKam: FROM, toKam: cmd.kamUserId, changed: true } };
  } };
  const users = { async lookup(_c, who) { return who === TO ? { who, seat: assigneeSeat } : who === FROM ? { who, seat: 'key-account-manager' } : null; } };
  const events = { refusal(u, action, reason, ids) { calls.refusals.push({ u, action, reason, ids }); } };
  const authority = { async mayAssign() { return mayAssign; } };
  const svc = createKamMoveBook({ crm, assignment, users, events, authority, share, concurrency: 2, stopMarginMs: 8_000 });
  return { svc, calls, started: () => started };
}
const cmd = (over = {}) => ({ fromKamUserId: FROM, toKamUserId: TO, continueFrom: null, ...over });

test('parseMoveBook: only toKamUserId and continueFrom, ids only', () => {
  assert.deepEqual({ ...parseMoveBook(FROM, { toKamUserId: TO }) }, { fromKamUserId: FROM, toKamUserId: TO, continueFrom: null });
  assert.equal(parseMoveBook(FROM, { toKamUserId: TO, continueFrom: id(3) }).continueFrom, id(3));
  for (const bad of [null, [], {}, { toKamUserId: 'x' }, { toKamUserId: TO, extra: 1 }, { toKamUserId: TO, continueFrom: 'abc' }, { toKamUserId: null }]) assert.equal(parseMoveBook(FROM, bad), null);
  assert.equal(parseMoveBook('nope', { toKamUserId: TO }), null);
});

test('moves every Contact of the book through kam-assign, guarded by the Modified_Time just read', async () => {
  const book = [id(1), id(2), id(3)];
  const { svc, calls } = rig({ book });
  const r = await svc.move(principal, cmd());
  assert.equal(r.ok, true);
  assert.deepEqual(r.value.moved, book);
  assert.deepEqual(r.value.notMoved, []);
  assert.equal(r.value.continueFrom, null);
  assert.deepEqual(calls.assign.map((c) => [c.contactId, c.kamUserId, c.expectedModifiedTime]), book.map((b) => [b, TO, MT]));
  assert.match(calls.coql[0], new RegExp(`KAM = '${FROM}' order by id asc`));
});

test('an ask by a seat without the assign right is refused before anything is read', async () => {
  const { svc, calls } = rig({ book: [id(1)], mayAssign: null });
  const r = await svc.move(principal, cmd());
  assert.deepEqual([r.ok, r.reason], [false, 'seat-denied']);
  assert.equal(calls.coql.length + calls.assign.length, 0);
  assert.equal(calls.refusals[0].reason, 'seat-denied');
});

test('the new manager must hold the Key Account Manager seat; same KAM and a malformed ask are refused', async () => {
  assert.equal((await rig({ assigneeSeat: 'ir-manager' }).svc.move(principal, cmd())).reason, 'assignee-not-am');
  assert.equal((await rig().svc.move(principal, cmd({ toKamUserId: FROM }))).reason, 'same-kam');
  assert.equal((await rig().svc.move(principal, null)).reason, 'invalid-request');
  assert.equal((await rig().svc.move(principal, cmd({ toKamUserId: IR }))).reason, 'assignee-not-am');   /* not a Zoho user the person can see */
});

test('a Contact that cannot move is reported with its reason and the rest still move', async () => {
  const book = [id(1), id(2), id(3), id(4)];
  const { svc } = rig({ book, refuse: { [id(2)]: 'not-allotted', [id(4)]: 'conflict' } });
  const r = await svc.move(principal, cmd());
  assert.deepEqual(r.value.moved, [id(1), id(3)]);
  assert.deepEqual(r.value.notMoved, [id(2), id(4)]);
  assert.deepEqual({ ...r.value.reasons }, { 'not-allotted': 1, conflict: 1 });
});

test('a book past one page is read to the end', async () => {
  const book = Array.from({ length: 450 }, (_, i) => id(i + 1));
  const { svc, calls } = rig({ book });
  const r = await svc.move(principal, cmd());
  assert.equal(r.value.moved.length, 450);
  assert.equal(calls.coql.length, 3);
});

test('inside the request deadline: stops before the margin and answers continueFrom; the next ask resumes there', async () => {
  const book = Array.from({ length: 6 }, (_, i) => id(i + 1));
  const r1 = rig({ book });
  const first = await runWithDeadline({ signal: new AbortController().signal, at: Date.now() + 1_000 }, () => r1.svc.move(principal, cmd()));
  assert.equal(first.ok, true);
  assert.equal(first.value.moved.length, 0);
  assert.equal(first.value.continueFrom, id(1));
  const r2 = rig({ book: book.slice(2) });   /* two were moved meanwhile: a re-read no longer lists them */
  const second = await r2.svc.move(principal, cmd({ continueFrom: id(3) }));
  assert.deepEqual(second.value.moved, book.slice(2));
  assert.equal(second.value.continueFrom, null);
  /* one that could not be moved stays in the book but is below continueFrom: not retried */
  const r3 = rig({ book: [id(1), id(2), id(3)] });
  const third = await r3.svc.move(principal, cmd({ continueFrom: id(2) }));
  assert.deepEqual(third.value.moved, [id(2), id(3)]);
});

test('Zoho failing on the book read changes nothing and says so', async () => {
  const { svc } = rig();
  const bad = createKamMoveBook({ crm: { async coql() { return { ok: false, error: { kind: 'server' } }; } }, assignment: { async assign() { throw new Error('no'); } },
    users: { async lookup(_c, who) { return { who, seat: 'key-account-manager' }; } }, events: { refusal() {} }, authority: { async mayAssign() { return 'amlead'; } } });
  const r = await bad.move(principal, cmd());
  assert.deepEqual([r.ok, r.kind, r.errorKind], [false, 'source-error', 'server']);
  void svc;
});

/* ---- D121 A: a moved Contact gets the same kam-share run as PUT /api/investors/[id]/kam ---- */

test('each moved Contact is handed to the kam-share run (to the new KAM, from the old); the answer carries share ids per state', async () => {
  const book = [id(1), id(2), id(3), id(4), id(5)];
  const runs = [];
  const states = { [id(1)]: 'shared', [id(3)]: 'pending', [id(4)]: 'failed', [id(5)]: 'boom' };
  const share = async (t, o) => {
    runs.push({ t, stops: typeof o.shouldStop === 'function' ? o.shouldStop() : 'none' });
    if (states[t.contactId] === 'boom') throw new Error('x');
    return states[t.contactId];
  };
  const { svc } = rig({ book, refuse: { [id(2)]: 'not-allotted' }, share });
  const r = await svc.move(principal, cmd());
  assert.deepEqual(r.value.moved, [id(1), id(3), id(4), id(5)]);
  assert.deepEqual(runs.map((x) => x.t.contactId).sort(), [id(1), id(3), id(4), id(5)], 'a Contact not moved is never shared');
  assert.ok(runs.every((x) => x.t.toKam === TO && x.t.fromKam === FROM && x.stops === false), 'the task and the request-deadline stop');
  assert.deepEqual({ ...r.value.shares, pending: [...r.value.shares.pending].sort() }, { shared: [id(1)], pending: [id(3), id(5)], failed: [id(4)] }, 'a run that throws stays pending');
  assert.ok(JSON.stringify(r.value.shares).match(/^[{}\[\]",:a-z0-9]*$/), 'ids and state names only');
});

test('with the real queue and no share-service credential every moved Contact stays "pending" for the reconcile job', async () => {
  const state = createMemoryState();
  const q = createKamShareQueue({ state, client: { async coql() { throw new Error('not called'); }, async shares() { throw new Error('no'); }, async setShares() { throw new Error('no'); } },
    credential: async () => null, log: createOpsLog(createMemorySink()) });
  const book = [id(1), id(2)];
  const { svc } = rig({ book, share: (t, o) => q.run(t, o) });
  const r = await svc.move(principal, cmd());
  assert.deepEqual({ ...r.value.shares, pending: [...r.value.shares.pending].sort() }, { shared: [], pending: book, failed: [] });
  for (const c of book) {
    assert.equal((await q.status(c)).state, 'pending');
    assert.deepEqual(await q.task(c), { toKam: TO, fromKam: FROM });
  }
});

test('without a share run (not wired) the moved ids are reported pending, never shared', async () => {
  const { svc } = rig({ book: [id(1)] });
  assert.deepEqual((await svc.move(principal, cmd())).value.shares, { shared: [], pending: [id(1)], failed: [] });
});
