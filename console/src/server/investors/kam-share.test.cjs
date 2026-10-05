/* D121 A — THE KAM SHARE SERVICE: share + revoke sets, the IR's share never revoked, stale refusal, idempotency, the
 * reconcile diff, the queue's states, the drawer status / Retry, the job summary, the client's wire shapes, and no
 * identity in any log line or stored state.
 *
 * Run from console/: node --test src/server/investors/kam-share.test.cjs
 * Compiles the production modules with the project's strict settings. A small in-memory Zoho answers the COQL and the
 * share-list calls; the client test replays v8-shaped replies through fetch. No request reaches Zoho. All ids synthetic.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const consoleRoot = path.resolve(__dirname, '..', '..', '..');
const srcRoot = path.join(consoleRoot, 'src');
const ts = require(path.join(consoleRoot, 'node_modules', 'typescript'));
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoho-kam-share-'));
process.on('exit', () => fs.rmSync(outDir, { recursive: true, force: true }));

const config = ts.readConfigFile(path.join(consoleRoot, 'tsconfig.json'), ts.sys.readFile);
const project = ts.parseJsonConfigFileContent(config.config, ts.sys, consoleRoot);
const options = {
  ...project.options, incremental: false, tsBuildInfoFile: undefined, plugins: undefined,
  module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10,
  noEmit: false, noEmitOnError: true, outDir, rootDir: srcRoot,
};
const sources = ['server/investors/kam-share.ts', 'server/investors/kam-share-queue.ts', 'server/investors/kam-share-status.ts',
  'server/investors/kam-share-job.ts', 'server/state/memory.ts', 'lib/zoho/client.ts', 'lib/zoho/log.ts'].map((f) => path.join(srcRoot, f));
const program = ts.createProgram(sources, options);
const diagnostics = [...ts.getPreEmitDiagnostics(program), ...program.emit().diagnostics];
if (diagnostics.length) {
  console.error(ts.formatDiagnostics(diagnostics, { getCanonicalFileName: (f) => f, getCurrentDirectory: () => consoleRoot, getNewLine: () => '\n' }));
  process.exit(1);
}
const load = (f) => require(path.join(outDir, f));
const { applyKamShare, reconcileKamShares, wantedShares } = load('server/investors/kam-share.js');
const { createKamShareQueue, KAM_SHARE_MAX_ATTEMPTS } = load('server/investors/kam-share-queue.js');
const { createKamShareStatus } = load('server/investors/kam-share-status.js');
const { runKamShareReconcile } = load('server/investors/kam-share-job.js');
const { createMemoryState } = load('server/state/memory.js');
const { createZohoServiceClient, serviceCredential, parseShares } = load('lib/zoho/client.js');
const { createMemorySink, createOpsLog } = load('lib/zoho/log.js');
const { createGate } = load('lib/zoho/gate.js');

const P = '554023';
const id = (n) => `${P}${String(n).padStart(12, '0')}`;
const C = id(400001), C2 = id(400002), LEAD = id(500001), LEAD2 = id(500002);
const A1 = id(600001), A2 = id(600002), T1 = id(700001), T2 = id(700002), T3 = id(700003), R1 = id(800001);
const OLD = id(300011), NEW = id(300013), IR = id(300005), OWNER = id(300020), OTHER = id(300014), HUMAN = id(300030), SVC = id(300099), X = id(300040);
const FAKE_PAN = 'AAAAA0000A'; // synthetic shape, never a real PAN: it must never reach a log, a state value or a result
const T0 = Date.parse('2026-10-05T06:00:00Z');
const svcCred = () => serviceCredential('kam-share', { access_token: 'synthetic-kam-share-token-never-live', api_domain: 'https://www.zohoapis.in', expires_in: 3600 }, T0);

const u = (targetId, permission, sharedBy = null) => ({ kind: 'users', targetId, permission, inherited: false, sharedBy });

/** An in-memory Zoho: records by module and each record's share list. Answers the COQL shapes kam-share sends. */
function fakeZoho({ contacts, allotments = [], touches = [], receipts = [], shares = {}, fail = {} }) {
  const mods = { Contacts: contacts, LLP_UnitAllocation_Module: allotments, Touches: touches, Receipts: receipts };
  const list = new Map(Object.entries(shares).map(([k, v]) => [k, v.slice()]));
  const calls = [];
  const lookup = (v) => (v ? { id: v, name: 'Test Name' } : null);
  return {
    calls, list,
    async coql(_as, q) {
      calls.push(['coql', q]);
      if (fail.coql && fail.coql.test(q)) return { ok: false, error: { kind: 'server' } };
      const m = /from (\w+) where (.+?)(?: order by id asc)? limit (\d+), (\d+)$/.exec(q);
      assert.ok(m, q);
      const [, module, where, off, n] = m;
      let rows = (mods[module] || []).slice().sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
      for (const cond of where.split(' and ')) {
        let k;
        if ((k = /^(\w+) = '(\d+)'$/.exec(cond))) rows = rows.filter((r) => (k[1] === 'id' ? r.id : r[k[1]]) === k[2]);
        else if ((k = /^(\w+) is not null$/.exec(cond))) rows = rows.filter((r) => r[k[1]]);
        else if ((k = /^id >= '(\d+)'$/.exec(cond))) rows = rows.filter((r) => BigInt(r.id) >= BigInt(k[1]));
        else assert.fail(`unexpected where ${cond}`);
      }
      const page = rows.slice(+off, +off + +n).map((r) => ({
        id: r.id, Owner: lookup(r.Owner), KAM: lookup(r.KAM), Originating_IR: lookup(r.Originating_IR), Origin_Lead: lookup(r.Origin_Lead),
        PAN_Number: FAKE_PAN, // a leak from Zoho must not travel past the read
      }));
      return { ok: true, value: { records: page, moreRecords: +off + +n < rows.length } };
    },
    async shares(_as, module, rid) {
      calls.push(['shares', module, rid]);
      if (fail.shares && fail.shares.has(rid)) return { ok: false, error: { kind: 'server' } };
      return { ok: true, value: (list.get(rid) || []).map((s) => ({ ...s })) };
    },
    async setShares(_as, module, rid, entries) {
      calls.push(['setShares', module, rid, entries.map((e) => `${e.targetId}:${e.permission}`)]);
      if (fail.set && fail.set.has(rid)) return { ok: false, error: { kind: 'server' } };
      list.set(rid, entries.map((e) => ({ ...e, inherited: false, sharedBy: SVC })));
      return { ok: true, value: { set: true } };
    },
  };
}
const flat = (z, rid) => (z.list.get(rid) || []).map((s) => `${s.targetId}:${s.permission}`).sort();
const writes = (z) => z.calls.filter((c) => c[0] === 'setShares');

function book(extra = {}) {
  return fakeZoho({
    contacts: [{ id: C, KAM: NEW, Owner: OWNER, Originating_IR: IR, Origin_Lead: LEAD }],
    allotments: [{ id: A1, Customer: C, Owner: OWNER }, { id: A2, Customer: C, Owner: OLD }],
    touches: [{ id: T1, Lead: LEAD, Owner: IR }, { id: T2, Lead: LEAD, Owner: NEW }, { id: T3, Lead: LEAD2, Owner: IR }],
    receipts: [{ id: R1, Allotment: A1, Owner: OWNER }],
    shares: { [C]: [u(IR, 'read_only'), u(OLD, 'read_write')], [A1]: [u(IR, 'read_only'), u(OLD, 'read_write')], [T1]: [u(OLD, 'read_write'), u(X, 'read_only')], [T3]: [u(OLD, 'read_write')] },
    ...extra,
  });
}

test('share + revoke: the new KAM gets read_write on the Contact, its allotments and its origin lead\'s Touches; the old KAM loses theirs; receipts never touched', async () => {
  const z = book();
  const r = await applyKamShare(z, svcCred(), { contactId: C, toKam: NEW, fromKam: OLD });
  assert.equal(r.ok, true); assert.equal(r.complete, true);
  assert.deepEqual(flat(z, C), [`${IR}:read_only`, `${NEW}:read_write`].sort());
  assert.deepEqual(flat(z, A1), [`${IR}:read_only`, `${NEW}:read_write`].sort());
  assert.deepEqual(flat(z, A2), [`${NEW}:read_write`]);            // OLD owns A2: nothing to revoke, no share for an owner
  assert.deepEqual(flat(z, T1), [`${NEW}:read_write`, `${X}:read_only`].sort()); // somebody else's share is kept
  assert.deepEqual(flat(z, T2), []);                                 // NEW owns T2: no share written
  assert.deepEqual(flat(z, T3), [`${OLD}:read_write`]);             // another lead's Touch: untouched
  assert.deepEqual(r.outcomes.map((o) => [o.module, o.id, o.status]), [
    ['Contacts', C, 'updated'], ['LLP_UnitAllocation_Module', A1, 'updated'], ['LLP_UnitAllocation_Module', A2, 'shared'],
    ['Touches', T1, 'updated'], ['Touches', T2, 'unchanged']]);
  assert.ok(!z.calls.some((c) => c.includes(R1) || /Receipts/.test(String(c[1]))), 'money is Finance-only');
  assert.ok(!z.calls.some((c) => c[0] === 'shares' && c[2] === T3));
  assert.doesNotMatch(JSON.stringify(r), new RegExp(`${FAKE_PAN}|Test Name`));
});

test('never revoke the Originating_IR\'s hand-off share, nor anything of the record owner; a pool return revokes only', async () => {
  const z = book({ contacts: [{ id: C, KAM: NEW, Owner: OWNER, Originating_IR: OLD, Origin_Lead: LEAD }] });
  await applyKamShare(z, svcCred(), { contactId: C, toKam: NEW, fromKam: OLD });
  assert.deepEqual(flat(z, C), [`${IR}:read_only`, `${OLD}:read_write`, `${NEW}:read_write`].sort(), 'OLD is the Originating_IR: kept');
  assert.ok(flat(z, T1).includes(`${OLD}:read_write`));
  // pool return: KAM cleared, only the old KAM's shares go; the IR's stays; a record left with nobody is a DELETE (empty list)
  const p = book({ contacts: [{ id: C, KAM: null, Owner: OWNER, Originating_IR: IR, Origin_Lead: LEAD }], shares: { [C]: [u(IR, 'read_only'), u(OLD, 'read_write')], [T1]: [u(OLD, 'read_write')] } });
  const r = await applyKamShare(p, svcCred(), { contactId: C, toKam: null, fromKam: OLD });
  assert.equal(r.ok, true);
  assert.deepEqual(flat(p, C), [`${IR}:read_only`]);
  assert.deepEqual(writes(p).find((c) => c[2] === T1)[3], [], 'nobody left: the empty list (DELETE)');
  assert.ok(!writes(p).some((c) => c[3].some((e) => e.startsWith(String(null)))));
});

test('stale: the Contact must name toKam (or, on a pool return, no longer name fromKam) — nothing is shared or revoked', async () => {
  const z = book({ contacts: [{ id: C, KAM: OTHER, Owner: OWNER, Originating_IR: IR, Origin_Lead: LEAD }] });
  assert.deepEqual(await applyKamShare(z, svcCred(), { contactId: C, toKam: NEW, fromKam: OLD }), { ok: false, reason: 'stale' });
  const z2 = book({ contacts: [{ id: C, KAM: OLD, Owner: OWNER, Originating_IR: IR, Origin_Lead: LEAD }] });
  assert.deepEqual(await applyKamShare(z2, svcCred(), { contactId: C, toKam: null, fromKam: OLD }), { ok: false, reason: 'stale' });
  assert.deepEqual(await applyKamShare(book(), svcCred(), { contactId: id(499999), toKam: NEW, fromKam: null }), { ok: false, reason: 'stale' });
  for (const t of [{ contactId: 'x', toKam: NEW, fromKam: null }, { contactId: C, toKam: null, fromKam: null }, { contactId: C, toKam: 'not-an-id', fromKam: null }]) {
    assert.deepEqual(await applyKamShare(book(), svcCred(), t), { ok: false, reason: 'invalid-request' });
  }
  assert.equal(writes(z).length + writes(z2).length, 0);
  await assert.rejects(applyKamShare(book(), serviceCredential('handoff-share', { access_token: 't', api_domain: 'https://www.zohoapis.in', expires_in: 3600 }, T0), { contactId: C, toKam: NEW, fromKam: null }), /kam-share|credential/i);
});

test('idempotent: a second run writes nothing and answers unchanged everywhere; a cut-short run is finished by a re-run', async () => {
  const z = book();
  await applyKamShare(z, svcCred(), { contactId: C, toKam: NEW, fromKam: OLD });
  const n = writes(z).length;
  const again = await applyKamShare(z, svcCred(), { contactId: C, toKam: NEW, fromKam: OLD });
  assert.equal(writes(z).length, n);
  assert.ok(again.outcomes.every((o) => o.status === 'unchanged'));
  const z2 = book();
  let k = 0;
  const cut = await applyKamShare(z2, svcCred(), { contactId: C, toKam: NEW, fromKam: OLD }, { shouldStop: () => ++k > 2 });
  assert.equal(cut.complete, false); assert.equal(cut.outcomes.length, 2);
  const rest = await applyKamShare(z2, svcCred(), { contactId: C, toKam: NEW, fromKam: OLD });
  assert.deepEqual(rest.outcomes.map((o) => o.status), ['unchanged', 'unchanged', 'shared', 'updated', 'unchanged']);
  // a failing record is reported by id and does not stop the rest
  const z3 = book({ fail: { set: new Set([A1]) } });
  const r3 = await applyKamShare(z3, svcCred(), { contactId: C, toKam: NEW, fromKam: OLD });
  assert.deepEqual(r3.outcomes.filter((o) => o.status === 'failed').map((o) => o.id), [A1]);
  assert.deepEqual(flat(z3, T1), [`${NEW}:read_write`, `${X}:read_only`].sort());
});

test('wantedShares: keeps others, raises the KAM to read_write, never lists the owner, null when nothing changes', () => {
  const base = { ownerId: OWNER, kam: NEW, revoke: new Set([OLD]), keep: new Set([IR]) };
  assert.equal(wantedShares([u(IR, 'read_only'), u(NEW, 'read_write')], base), null);
  assert.deepEqual(wantedShares([u(NEW, 'read_only')], base).list.map((e) => e.permission), ['read_write']);
  assert.deepEqual(wantedShares([u(NEW, 'full_access')], base), null, 'a higher access is left alone');
  assert.equal(wantedShares([], { ...base, kam: OWNER }), null);
  const roles = [{ kind: 'roles', targetId: id(100001), permission: 'read_only', inherited: false, sharedBy: null }];
  assert.deepEqual(wantedShares(roles, base).list.map((e) => e.kind), ['roles', 'users']);
});

test('reconcile: adds a missing KAM share and the IR\'s read, revokes another KAM\'s share, keeps a share a person made by hand; counts and ids only', async () => {
  const z = fakeZoho({
    contacts: [
      { id: C, KAM: NEW, Owner: OWNER, Originating_IR: IR, Origin_Lead: LEAD },
      { id: C2, KAM: OTHER, Owner: OWNER, Originating_IR: null, Origin_Lead: null },
      { id: id(400003), KAM: null, Owner: OWNER, Originating_IR: IR, Origin_Lead: null },
    ],
    allotments: [{ id: A1, Customer: C, Owner: OWNER }, { id: A2, Customer: C2, Owner: OWNER }],
    touches: [{ id: T1, Lead: LEAD, Owner: IR }],
    shares: {
      [C]: [u(OTHER, 'read_write', SVC), u(X, 'read_only', HUMAN)],    // OTHER is a KAM (of C2): extra → revoked; X not a KAM → kept
      [A1]: [u(IR, 'read_only'), u(NEW, 'read_write'), u(OTHER, 'read_write', HUMAN)], // a cover share made by hand: kept
      [A2]: [u(OTHER, 'read_write')], [C2]: [u(OTHER, 'read_write')],
    },
  });
  const r = await reconcileKamShares(z, svcCred(), { serviceUserId: SVC });
  assert.equal(r.contactsChecked, 2); assert.equal(r.recordsChecked, 5); assert.equal(r.continueFrom, null);
  assert.deepEqual(flat(z, C), [`${IR}:read_only`, `${NEW}:read_write`, `${X}:read_only`].sort());
  assert.deepEqual(flat(z, A1), [`${IR}:read_only`, `${NEW}:read_write`, `${OTHER}:read_write`].sort());
  assert.deepEqual(flat(z, T1), [`${NEW}:read_write`], 'Touches: KAM only, no IR read');
  assert.deepEqual([...r.added].sort(), [C, T1].sort());
  assert.deepEqual([...r.revoked], [C]);
  assert.deepEqual([...r.failed], []);
  assert.equal(writes(z).length, 2, 'records already right are not written');
  assert.ok(!z.calls.some((c) => c.includes(id(400003))), 'a Contact without a KAM is not reconciled');
  // a second pass finds nothing to do
  const again = await reconcileKamShares(z, svcCred(), { serviceUserId: SVC });
  assert.deepEqual([again.added.length, again.revoked.length], [0, 0]);
  // cut short: continueFrom is the first Contact not checked; resuming from it checks only the rest
  let k = 0;
  const cut = await reconcileKamShares(book(), svcCred(), { shouldStop: () => ++k > 0 });
  assert.equal(cut.continueFrom, C); assert.equal(cut.contactsChecked, 0);
  const z4 = fakeZoho({ contacts: [{ id: C, KAM: NEW }, { id: C2, KAM: NEW }] });
  const res = await reconcileKamShares(z4, svcCred(), { from: C2 });
  assert.equal(res.contactsChecked, 1);
  assert.equal(await reconcileKamShares(fakeZoho({ contacts: [], fail: { coql: /KAM is not null/ } }), svcCred()), null);
  assert.doesNotMatch(JSON.stringify(r), new RegExp(`${FAKE_PAN}|Test Name`));
});

function queueRig({ z = book(), cred = true, clock } = {}) {
  const state = createMemoryState({ clock: () => T0 });
  const sink = createMemorySink();
  const log = createOpsLog(sink);
  let now = T0;
  const q = createKamShareQueue({ state, client: z, credential: async () => (cred ? svcCred() : null), log, clock: clock ?? (() => now) });
  return { q, z, state, sink, tick: (ms) => { now += ms; } };
}

test('queue: run → shared, one Plane B event with job, a status code and record ids only; status answers state and time', async () => {
  const r = queueRig();
  assert.deepEqual(await r.q.status(C), { state: 'none', lastTriedAt: null });
  assert.equal(await r.q.run({ contactId: C, toKam: NEW, fromKam: OLD }), 'shared');
  assert.deepEqual(await r.q.status(C), { state: 'shared', lastTriedAt: T0 });
  const ev = r.sink.records().filter((x) => x.kind === 'event');
  assert.equal(ev.length, 1);
  assert.deepEqual({ actor: ev[0].actor, action: ev[0].action, reason: ev[0].reason }, { actor: { kind: 'service', job: 'kam-share' }, action: 'kam-share', reason: 'shared.count-5' });
  assert.ok(ev[0].recordIds.every((x) => /^\d{18}$/.test(x)) && ev[0].recordIds.includes(C));
  const stored = await r.state.get(`kamshare|${C}`);
  assert.doesNotMatch(JSON.stringify([r.sink.records(), stored]), new RegExp(`${FAKE_PAN}|Test Name|never-live`));
});

test('queue: past the deadline it stays pending; failures are failed and listed again; the drain finishes them; unconfigured stays pending', async () => {
  const r = queueRig();
  assert.equal(await r.q.run({ contactId: C, toKam: NEW, fromKam: OLD }, { shouldStop: () => true }), 'pending');
  assert.equal(writes(r.z).length, 0, 'the request never waits on Zoho past its stop margin');
  const d = await r.q.drain();
  assert.deepEqual([d.tried, [...d.shared]], [1, [C]]);
  assert.equal((await r.q.drain()).tried, 0, 'a drained Contact is not tried again');

  const f = queueRig({ z: book({ fail: { set: new Set([A1]) } }) });
  assert.equal(await f.q.run({ contactId: C, toKam: NEW, fromKam: OLD }), 'failed');
  const s = JSON.parse(await f.state.get(`kamshare|${C}`));
  assert.deepEqual([s.state, s.attempts, s.reason], ['failed', 1, 'record-failed']);
  // the record keeps failing: each drain retries it until the attempt cap
  for (let i = 0; i < KAM_SHARE_MAX_ATTEMPTS + 2; i++) await f.q.drain();
  assert.equal(JSON.parse(await f.state.get(`kamshare|${C}`)).attempts, KAM_SHARE_MAX_ATTEMPTS, 'gives up after the attempt cap');

  const stale = queueRig({ z: book({ contacts: [{ id: C, KAM: OTHER, Owner: OWNER, Originating_IR: IR, Origin_Lead: LEAD }] }) });
  assert.equal(await stale.q.run({ contactId: C, toKam: NEW, fromKam: OLD }), 'failed');
  assert.equal(stale.sink.records().find((x) => x.kind === 'event').reason, 'stale');

  const off = queueRig({ cred: false });
  assert.equal(await off.q.run({ contactId: C, toKam: NEW, fromKam: OLD }), 'pending');
  assert.equal((await off.q.drain()).notConfigured, true);
  assert.equal((await off.q.status(C)).state, 'pending');
});

test('queue: a newer KAM change owns the key — an older attempt finishing late does not overwrite it', async () => {
  const z = book();
  const r = queueRig({ z });
  const slowZ = { ...z, async shares(...a) { await r.q.enqueue({ contactId: C, toKam: OTHER, fromKam: NEW }); return z.shares(...a); }, coql: z.coql, setShares: z.setShares };
  const q2 = createKamShareQueue({ state: r.state, client: slowZ, credential: async () => svcCred(), log: createOpsLog(createMemorySink()), clock: (() => { let t = T0; return () => (t += 1); })() });
  await q2.run({ contactId: C, toKam: NEW, fromKam: OLD });
  const s = JSON.parse(await r.state.get(`kamshare|${C}`));
  assert.deepEqual([s.toKam, s.fromKam, s.state], [OTHER, NEW, 'pending']);
});

function statusRig({ seat = 'amlead', visible = true, kam = NEW, task = null } = {}) {
  const refusals = [], runs = [];
  const queue = {
    status: async () => ({ state: 'failed', lastTriedAt: T0 }),
    task: async () => task,
    run: async (t) => { runs.push(t); return 'shared'; },
  };
  const crm = { getRecord: async (_as, module, rid, o) => {
    assert.equal(module, 'Contacts'); assert.deepEqual([...o.fields], ['id', 'KAM']);
    return visible ? { ok: true, value: { id: rid, KAM: kam ? { id: kam, name: 'Test Name' } : null } } : { ok: false, error: { kind: 'forbidden' } };
  } };
  const svc = createKamShareStatus({ crm, queue, events: { refusal: (...a) => refusals.push(a) }, authority: { mayAssign: async () => seat } });
  return { svc, refusals, runs, as: { userId: id(300010) } };
}

test('drawer status and Retry: the record must be visible on the person\'s own token; Retry needs the assign right and shares with the KAM named now', async () => {
  const a = statusRig();
  assert.deepEqual(await a.svc.status(a.as, C), { ok: true, value: { state: 'failed', lastTriedAt: T0 } });
  const hidden = statusRig({ visible: false });
  assert.deepEqual(await hidden.svc.status(hidden.as, C), { ok: false, kind: 'refused', reason: 'not-visible' });
  assert.deepEqual(hidden.refusals[0], [id(300010), 'kam-share-status', 'not-visible', [C]]);
  const kam = statusRig({ seat: null });
  assert.deepEqual(await kam.svc.retry(kam.as, 'sid', C), { ok: false, kind: 'refused', reason: 'seat-denied' });
  assert.equal(kam.runs.length, 0);
  // the Contact names NEW now; the last task named OTHER (moved in Zoho since): OTHER loses, NEW gets
  const re = statusRig({ task: { toKam: OTHER, fromKam: OLD } });
  assert.equal((await re.svc.retry(re.as, 'sid', C)).ok, true);
  assert.deepEqual(re.runs, [{ contactId: C, toKam: NEW, fromKam: OTHER }]);
  const same = statusRig({ task: { toKam: NEW, fromKam: OLD } });
  await same.svc.retry(same.as, 'sid', C);
  assert.deepEqual(same.runs, [{ contactId: C, toKam: NEW, fromKam: OLD }]);
  const pool = statusRig({ kam: null, task: null });
  assert.deepEqual(await pool.svc.retry(pool.as, 'sid', C), { ok: true, value: { state: 'none', lastTriedAt: null } });
  assert.deepEqual(await a.svc.status(a.as, 'nope'), { ok: false, kind: 'refused', reason: 'invalid-request' });
});

test('job: drain, then reconcile; summary is counts and record ids; a cut-short run resumes from where it stopped', async () => {
  const z = book();
  const state = createMemoryState({ clock: () => T0 });
  const sink = createMemorySink();
  const log = createOpsLog(sink);
  const queue = createKamShareQueue({ state, client: z, credential: async () => svcCred(), log, clock: () => T0 });
  await queue.enqueue({ contactId: C, toKam: NEW, fromKam: OLD });
  const deps = { queue, client: z, credential: async () => svcCred(), state, log, serviceUserId: SVC, clock: () => T0 };
  const s = await runKamShareReconcile(deps);
  assert.equal(s.drained, 1); assert.deepEqual([...s.drainShared], [C]);
  // A2 lacked the IR's hand-off read: the reconcile restores it (ACCESS-PLAN R3 compares Originating_IR too)
  assert.equal(s.contactsChecked, 1); assert.equal(s.added, 1); assert.deepEqual([...s.addedIds], [A2]); assert.equal(s.revoked, 0); assert.equal(s.continueFrom, null);
  for (const v of Object.values(s)) assert.ok(typeof v === 'number' || typeof v === 'boolean' || v === null || (Array.isArray(v) && v.every((x) => /^\d{18}$/.test(x))), JSON.stringify(v));
  const line = sink.records().find((x) => x.action === 'kam-share-reconcile');
  assert.equal(line.reason, 'added-1.revoked-0.failed-0'); assert.deepEqual([...line.recordIds], [A2]);
  // cut short: the resume point is kept and the next call goes on from it
  const z2 = fakeZoho({ contacts: [{ id: C, KAM: NEW }, { id: C2, KAM: NEW }] });
  let k = 0;
  const cut = await runKamShareReconcile({ ...deps, client: z2, queue: { drain: async () => ({ tried: 0, shared: [], pending: [], failed: [] }) }, shouldStop: () => ++k > 1 });
  assert.equal(cut.continueFrom, C2);
  assert.equal(await state.get('kamshare|reconcile-from'), C2);
  const next = await runKamShareReconcile({ ...deps, client: z2, queue: { drain: async () => ({ tried: 0, shared: [], pending: [], failed: [] }) } });
  assert.equal(next.contactsChecked, 1); assert.equal(next.continueFrom, null);
  assert.equal(await state.get('kamshare|reconcile-from'), '');
  assert.deepEqual(await runKamShareReconcile({ ...deps, credential: async () => null }), { notConfigured: true });
  assert.doesNotMatch(JSON.stringify([s, sink.records()]), new RegExp(`${FAKE_PAN}|Test Name|never-live`));
});

test('client: GET share list parsed to ids and permissions (names, zuids dropped); PUT sends the whole v8 list; an empty list is DELETE', async () => {
  const calls = [];
  const replies = [
    { status: 200, body: { share: [
      { shared_with: { name: 'Test Name', id: NEW, type: 'users', zuid: '679952958' }, share_related_records: false, permission: 'read_write', type: 'private', shared_by: { id: SVC, name: 'Svc' } },
      { user: { id: IR, name: 'Test Name' }, permission: 'read_only' },
      { shared_with: { id: id(100001), type: 'roles' }, permission: 'full_access', shared_through: { module: { name: 'Contacts', id: id(1) }, id: id(400009) } },
      { shared_with: { id: 'junk' }, permission: 'read_write' },
    ] } },
    { status: 200, body: { share: [{ code: 'SUCCESS', status: 'success', message: 'record will be shared successfully' }] } },
    { status: 200, body: { share: { code: 'SUCCESS', status: 'success', details: { id: C }, message: 'Sharing Revoked' } } },
    { status: 204 },
    { status: 400, body: { share: [{ code: 'INVALID_DATA', status: 'error' }] } },
  ];
  const sink = createMemorySink();
  const client = createZohoServiceClient({ gate: createGate(), log: createOpsLog(sink), recordIdPrefix: P, maxAttempts: 1, sleep: async () => {}, random: () => 0.5,
    fetch: async (url, init) => {
      calls.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : undefined });
      const n = replies.shift();
      return new Response(n.status === 204 ? null : JSON.stringify(n.body), { status: n.status });
    } });
  const cred = svcCred();
  const got = await client.shares(cred, 'Contacts', C);
  assert.equal(got.ok, true);
  assert.deepEqual(got.value.map((s) => ({ ...s })), [
    { kind: 'users', targetId: NEW, permission: 'read_write', inherited: false, sharedBy: SVC },
    { kind: 'users', targetId: IR, permission: 'read_only', inherited: false, sharedBy: null },
    { kind: 'roles', targetId: id(100001), permission: 'full_access', inherited: true, sharedBy: null },
  ]);
  assert.doesNotMatch(JSON.stringify(got), /Test Name|679952958/);
  assert.equal(calls[0].method, 'GET'); assert.ok(calls[0].url.endsWith(`/crm/v8/Contacts/${C}/actions/share`));
  assert.equal((await client.setShares(cred, 'Contacts', C, [{ kind: 'users', targetId: NEW, permission: 'read_write' }, { kind: 'users', targetId: IR, permission: 'read_only' }])).ok, true);
  assert.equal(calls[1].method, 'PUT');
  assert.deepEqual(calls[1].body, { share: [
    { shared_with: { id: NEW, type: 'users' }, permission: 'read_write', share_related_records: false, type: 'private' },
    { shared_with: { id: IR, type: 'users' }, permission: 'read_only', share_related_records: false, type: 'private' },
  ], notify_shared_members: false });
  assert.equal((await client.setShares(cred, 'Contacts', C, [])).ok, true);
  assert.equal(calls[2].method, 'DELETE'); assert.equal(calls[2].body, undefined);
  assert.deepEqual((await client.shares(cred, 'Touches', T1)).value, []);
  assert.equal((await client.setShares(cred, 'Contacts', C, [{ kind: 'users', targetId: NEW, permission: 'read_write' }])).ok, false);
  await assert.rejects(client.setShares(cred, 'Contacts', C, [{ kind: 'users', targetId: NEW, permission: 'read' }]), TypeError);
  await assert.rejects(client.setShares(cred, 'Contacts', C, Array.from({ length: 11 }, (_, i) => ({ kind: 'users', targetId: id(310000 + i), permission: 'read_only' }))), RangeError);
  const logged = JSON.stringify(sink.records());
  assert.ok(sink.records().every((x) => x.actor.job === 'kam-share'));
  assert.doesNotMatch(logged, /Test Name|679952958|read_write|never-live/);
  assert.deepEqual(parseShares([{ shared_with: { id: NEW }, permission: 'read' }], C).map((s) => s.permission), ['read_only']);
});
