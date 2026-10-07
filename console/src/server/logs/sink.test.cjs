/* THE LOG SINK INTERFACE, THE STRATUS ADAPTER AND PLANE C'S HASH CHAIN (docs/architecture/log-sink.md).
 * A fake Stratus bucket (no request leaves the process): segments and manifests, fail-closed configuration,
 * scrubbed lines only, the chain catching edit / deletion / reorder, the same reader results from every sink,
 * the reveal reason on Plane C (M15-S05-NOTE-1) and the success kind on lead search (M06-S05-NOTE-3).
 * Run from console/: node --test src/server/logs/sink.test.cjs */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const compile = require('./compile.cjs');

const { load } = compile(['server/logs/factory.ts', 'server/logs/runtime.ts', 'server/logs/reader.ts', 'server/logs/stratus.ts',
  'server/activity/archive.ts', 'server/data/events.ts', 'server/leads/search.ts', 'server/system/checks.ts', 'lib/im/constants.ts'], 'logs-sink');
const { createLogSinks, logStoreKind } = load('server/logs/factory.js');
const { auditChain } = load('server/logs/runtime.js');
const { queryLogs, logSourceOf } = load('server/logs/reader.js');
const { createChainLinker, verifyChain, genesis } = load('server/logs/chain.js');
const { stratusConfig, createStratusClient, createStratusAuditArchive } = load('server/logs/stratus.js');
const { cleanRow } = load('server/activity/archive.js');
const { createOpsLog } = load('lib/zoho/log.js');
const { createPlaneCLog, REVEAL_WHY_LABEL, revealWhyOf } = load('server/identity/plane-c.js');
const { createInvestorEvents } = load('server/data/events.js');
const { createLeadSearch } = load('server/leads/search.js');
const { systemChecks } = load('server/system/checks.js');
const { REVWHY } = load('lib/im/constants.js');

const NOW = Date.parse('2026-10-03T06:00:00Z');
const DAY = '2026-10-03';
const U1 = '9007199254740993002', U2 = '9007199254740995001', REC = '9007199254740997301';
/* synthetic, shaped like identity values (never real) */
const FAKE_PAN = 'ABCDE1234F', FAKE_MOBILE = '9876500000', FAKE_MAIL = 'someone@example.test';

const STRATUS_ENV = Object.freeze({
  LOG_SINK: 'stratus', STRATUS_BUCKET_URL: 'https://gz-logs.zohostratus.in', GZ_STATE_PROJECT_ID: '10108000003823392',
  STRATUS_CLIENT_ID: '1000.SYNTHETICCLIENT', STRATUS_CLIENT_SECRET: 'synthetic-secret-0001', STRATUS_REFRESH_TOKEN: '1000.synthetic.refresh',
});

/** An in-memory Stratus: token, PUT/GET on the bucket URL, the list API with paging. */
function fakeStratus({ pageSize = 3 } = {}) {
  const objects = new Map();
  const puts = [];
  let failPuts = 0, version = 0, tokens = 0;
  const res = (status, body = '') => ({ status, text: async () => body });
  const fetch = async (url, init) => {
    const u = new URL(url);
    if (u.host === 'accounts.zoho.in' && u.pathname === '/oauth/v2/token') { tokens++; return res(200, JSON.stringify({ access_token: 'synthetic-access', expires_in: 3600 })); }
    assert.equal(init.headers.Authorization, 'Zoho-oauthtoken synthetic-access');
    if (u.host === 'gz-logs.zohostratus.in') {
      const key = decodeURIComponent(u.pathname.slice(1));
      if (init.method === 'PUT') {
        if (failPuts > 0) { failPuts--; return res(503); }
        puts.push({ key, body: init.body, type: init.headers['Content-Type'] });
        objects.set(key, { body: init.body, version: `v${++version}` });
        return res(200);
      }
      const o = objects.get(key);
      return o ? res(200, o.body) : res(404);
    }
    if (u.host === 'api.catalyst.zoho.in' && u.pathname === '/baas/v1/project/10108000003823392/bucket/objects') {
      assert.equal(u.searchParams.get('bucket_name'), 'gz-logs');
      const all = [...objects.keys()].filter((k) => k.startsWith(u.searchParams.get('prefix') ?? '')).sort();
      const start = Number(u.searchParams.get('continuation_token') ?? 0);
      const page = all.slice(start, start + pageSize);
      const truncated = start + pageSize < all.length;
      return res(200, JSON.stringify({ status: 'success', data: { truncated, next_continuation_token: truncated ? String(start + pageSize) : undefined,
        contents: page.map((key) => ({ key, version_id: objects.get(key).version, key_type: 'file' })) } }));
    }
    return res(404);
  };
  return { fetch, objects, puts, failNext: (n) => { failPuts = n; }, tokens: () => tokens };
}

const stratusSinks = (bucket, extra = {}, clock = () => NOW) =>
  createLogSinks({ ...STRATUS_ENV, LOG_FLUSH_LINES: '10', ...extra }, { clock, fetch: bucket.fetch, timer: false, onFlushError: () => {} });

/** The same handful of events, through any set of sinks. */
function writeSample(sinks, at = NOW) {
  const ops = createOpsLog(sinks.ops);
  ops.call({ at, actor: { kind: 'user', userId: U1 }, op: 'getRecord', method: 'GET', endpoint: '/Contacts/' + REC, callClass: 'simple', status: 200, durationMs: 9, gateWaitMs: 0, attempt: 1, creditsRemaining: 4100, errorClass: null, recordIds: [REC] });
  ops.refusal({ at: at + 1, actor: { kind: 'user', userId: U2 }, action: 'events-edit', reason: 'seat-denied', recordIds: [] });
  ops.event({ at: at + 2, actor: { kind: 'user', userId: U2 }, action: 'lead-search', reason: 'scope-yours.count-2', recordIds: [] });
  const c = createPlaneCLog(sinks.identity);
  const ev = createInvestorEvents({ log: ops, planeC: c, clock: () => at + 3 });
  ev.reveal(U1, 'head', 'pan', REC, 'ok', 'A filing or a TDS check');
  c.record({ at: at + 4, who: U1, action: 'step-up', outcome: 'ok', reason: 'fresh', seat: 'head' });
  c.record({ at: at + 5, who: U2, action: 'sign-in', outcome: 'ok', reason: 'zoho', seat: 'ir' });
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gz-sink-'));
const stripChain = ({ ch, n, prev, h, ...rest }) => rest;

/* ---- configuration ----------------------------------------------------------------------------- */

test('LOG_SINK selects the adapter; file stays the default; misconfiguration fails closed and names the variables, never a value', () => {
  assert.equal(logStoreKind({}), 'memory');
  assert.equal(logStoreKind({ LOG_SINK: 'file', LOG_STORE: 'jsonl' }), 'jsonl');
  assert.equal(logStoreKind({ LOG_SINK: 'stratus' }), 'stratus');
  assert.equal(logStoreKind({ LOG_SINK: 'stratus', FIXTURE_MODE: 'local', NODE_ENV: 'test' }), 'memory', 'fixture mode never writes anywhere');
  assert.throws(() => logStoreKind({ LOG_SINK: 's3' }), /LOG_SINK must be "file" or "stratus"/);
  assert.throws(() => logStoreKind({ LOG_SINK: 'stratus', LOG_STORE: 'jsonl' }), /unset LOG_STORE/);
  assert.equal(stratusConfig({ ...STRATUS_ENV, GZ_STATE_PROJECT_ID: undefined, CATALYST_PROJECT_ID: '10108000003823392' }).projectId, '10108000003823392', 'legacy fallback');
  assert.throws(() => createLogSinks({ LOG_SINK: 'stratus' }), /missing: STRATUS_BUCKET_URL, GZ_STATE_PROJECT_ID, STRATUS_CLIENT_ID, STRATUS_CLIENT_SECRET, STRATUS_REFRESH_TOKEN/);
  let msg = '';
  try { stratusConfig({ ...STRATUS_ENV, STRATUS_BUCKET_URL: 'https://gz-logs.zohostratus.com', GZ_STRATUS_API_DOMAIN: 'https://api.catalyst.zoho.com', LOG_FLUSH_SECONDS: '1' }); } catch (e) { msg = e.message; }
  assert.match(msg, /malformed: STRATUS_BUCKET_URL, GZ_STRATUS_API_DOMAIN, LOG_FLUSH_SECONDS/, 'India buckets only');
  assert.ok(!msg.includes('synthetic'), 'no secret in the message');
  const c = stratusConfig({ ...STRATUS_ENV, STRATUS_BUCKET_URL: 'https://gz-logs-development.zohostratus.in/' });
  assert.deepEqual([c.bucketName, c.development, c.apiDomain, c.flushLines, c.flushMs], ['gz-logs', true, 'https://api.catalyst.zoho.in', 500, 30000]);
  assert.match(c.instance, /^i-[0-9a-f]{12}$/);
});

/* ---- the chain ---------------------------------------------------------------------------------- */

function chainOf(k) {
  const l = createChainLinker('p-test');
  const out = [];
  for (let i = 0; i < k; i++) { const line = l.link({ at: NOW + i, who: U1, action: 'sign-in', outcome: 'ok', reason: 'zoho', seat: 'ir' }, DAY); l.commit(line, DAY); out.push(line); }
  return out;
}
const seg = (lines) => [{ key: 'x', manifest: null, lines, problem: null }];
const kinds = (v) => v.problems.map((p) => `${p.kind}@${p.at}`);

test('chain: an untouched day verifies; an edit, a deletion, a reorder and an inserted unchained line are each caught', () => {
  const lines = chainOf(5);
  assert.equal(lines[0].prev, genesis('p-test', DAY));
  assert.equal(lines[1].prev, lines[0].h);
  const good = verifyChain(seg(lines), { day: DAY });
  assert.deepEqual([good.ok, good.lines, good.chains, good.heads['p-test'].n], [true, 5, 1, 4]);

  const edited = lines.map((l, i) => (i === 2 ? { ...l, who: U2 } : l));
  assert.deepEqual(kinds(verifyChain(seg(edited), { day: DAY })), ['edited@2']);
  const deleted = lines.filter((_, i) => i !== 2);
  assert.deepEqual(kinds(verifyChain(seg(deleted), { day: DAY })), ['deleted@2']);
  const swapped = [lines[0], lines[2], lines[1], lines[3], lines[4]];
  assert.deepEqual(kinds(verifyChain(seg(swapped), { day: DAY })), ['reordered@1', 'reordered@1']);
  const forged = [...lines.slice(0, 2), { at: NOW, who: U2, action: 'reveal', outcome: 'ok', reason: 'pan', seat: 'head' }, ...lines.slice(2)];
  assert.deepEqual(kinds(verifyChain(seg(forged), { day: DAY })), ['unchained@null']);
  /* a rewritten line that also rewrites its own h still breaks the next line's prev */
  const rehashed = lines.map((l) => ({ ...l }));
  rehashed[2] = { ...rehashed[2], who: U2 }; delete rehashed[2].h;
  rehashed[2].h = require('node:crypto').createHash('sha256').update(load('server/logs/chain.js').canonical(rehashed[2])).digest('hex');
  assert.deepEqual(kinds(verifyChain(seg(rehashed), { day: DAY })), ['broken-link@3']);
});

test('chain: losing the tail is invisible to the chain alone and caught by the anchor kept for the closed day', () => {
  const lines = chainOf(4);
  const anchor = verifyChain(seg(lines), { day: DAY }).anchor;
  const cut = verifyChain(seg(lines.slice(0, 3)), { day: DAY });
  assert.equal(cut.ok, true, 'a truncated chain is still a valid chain');
  assert.deepEqual(kinds(verifyChain(seg(lines.slice(0, 3)), { day: DAY, anchor })), ['anchor-mismatch@null']);
  assert.equal(verifyChain(seg(lines), { day: DAY, anchor }).ok, true);
});

/* ---- the file adapter --------------------------------------------------------------------------- */

test('file adapter: Plane C day file is chained after the guard; auditChain().verify catches edit, deletion and reorder on disk', async () => {
  const dir = tmp();
  const sinks = createLogSinks({ LOG_STORE: 'jsonl', LOG_DIR: dir }, { clock: () => NOW });
  writeSample(sinks);
  assert.deepEqual(sinks.identity.events().map((e) => Object.keys(e).includes('h')), [false, false, false], 'the ring keeps the plain record');
  const v = await auditChain(sinks).verify(DAY);
  assert.deepEqual([v.ok, v.lines, v.chains], [true, 3, 1]);
  const file = path.join(dir, `identity-${DAY}.jsonl`);
  const original = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  const put = (ls) => fs.writeFileSync(file, ls.join('\n') + '\n');
  put(original.map((l, i) => (i === 1 ? l.replace('"fresh"', '"chose"') : l)));
  assert.deepEqual(kinds(await auditChain(sinks).verify(DAY)), ['edited@1']);
  put([original[0], original[2]]);
  assert.deepEqual(kinds(await auditChain(sinks).verify(DAY)), ['deleted@1']);
  put([original[1], original[0], original[2]]);
  assert.equal((await auditChain(sinks).verify(DAY)).problems[0].kind, 'reordered');
  assert.deepEqual(await auditChain(createLogSinks({})).verify(DAY), { ok: null, day: DAY, reason: 'not-durable' });
});

/* ---- the Stratus adapter ------------------------------------------------------------------------ */

test('stratus: lines are buffered and cut into segment objects with a manifest each; a day lists across instances and pages', async () => {
  const b = fakeStratus();
  const a = stratusSinks(b, { LOG_INSTANCE_ID: 'i-aaaa' });
  const z = stratusSinks(b, { LOG_INSTANCE_ID: 'i-zzzz' });
  writeSample(a);
  assert.equal(b.puts.length, 0, 'nothing is uploaded on the request path');
  assert.equal((await a.stores.identity.read(DAY)).length, 3, "this instance's unflushed lines are in its own reads");
  await a.flush();
  writeSample(z, NOW + 100);
  await z.flush();
  const keys = [...b.objects.keys()].filter((k) => k.startsWith('growize-logs/identity/')).sort();
  assert.deepEqual(keys, [
    `growize-logs/identity/${DAY}/i-aaaa/000000.jsonl`, `growize-logs/identity/${DAY}/i-aaaa/000000.manifest.json`,
    `growize-logs/identity/${DAY}/i-zzzz/000000.jsonl`, `growize-logs/identity/${DAY}/i-zzzz/000000.manifest.json`,
  ]);
  const m = JSON.parse(b.objects.get(`growize-logs/identity/${DAY}/i-aaaa/000000.manifest.json`).body);
  const segLines = b.objects.get(`growize-logs/identity/${DAY}/i-aaaa/000000.jsonl`).body.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.deepEqual([m.v, m.plane, m.day, m.instance, m.seq, m.lines, m.prevLast], [1, 'identity', DAY, 'i-aaaa', 0, 3, null]);
  assert.deepEqual([m.first, m.last], [segLines[0].h, segLines[2].h]);
  assert.equal(b.puts.find((p) => p.key.endsWith('000000.jsonl')).type, 'application/x-ndjson');
  /* another instance reads both instances' segments (list paged three at a time) */
  const fresh = stratusSinks(b, { LOG_INSTANCE_ID: 'i-read' });
  assert.equal((await fresh.stores.identity.read(DAY)).length, 6);
  assert.deepEqual(await fresh.stores.ops.days(), [DAY]);
  const v = await auditChain(fresh).verify(DAY);
  assert.deepEqual([v.ok, v.chains, v.lines], [true, 2, 6]);
  assert.equal(b.tokens(), 3, 'one token per instance, cached');
});

test('stratus: LOG_FLUSH_LINES cuts a segment on its own; a failed upload keeps the lines and the next flush retries in order', async () => {
  const b = fakeStratus();
  const s = stratusSinks(b, { LOG_INSTANCE_ID: 'i-flush' });
  const c = createPlaneCLog(s.identity);
  b.failNext(2); // the automatic flush at the 10th line, then the explicit one
  for (let i = 0; i < 10; i++) c.record({ at: NOW + i, who: U1, action: 'sign-in', outcome: 'ok', reason: 'zoho', seat: 'ir' });
  await s.stores.identity.flush();
  assert.equal(b.objects.size, 0, 'the first PUT failed: nothing half-written');
  assert.equal(s.stores.identity.pending(), 10);
  assert.equal((await s.stores.identity.read(DAY)).length, 10, 'still readable from the buffer');
  for (let i = 10; i < 12; i++) c.record({ at: NOW + i, who: U1, action: 'sign-out', outcome: 'ok', reason: 'chose', seat: 'ir' });
  await s.flush();
  assert.equal(s.stores.identity.pending(), 0);
  const ms = [...b.objects.keys()].filter((k) => k.endsWith('.manifest.json')).sort().map((k) => JSON.parse(b.objects.get(k).body));
  assert.deepEqual(ms.map((m) => [m.seq, m.lines]), [[0, 10], [1, 2]]);
  assert.equal(ms[1].prevLast, ms[0].last, 'segments of one instance are linked');
  assert.equal((await auditChain(s).verify(DAY)).ok, true);
});

test('stratus: an edited segment, a deleted segment and a deleted manifest are each reported; an edited segment is never read as data', async () => {
  const b = fakeStratus({ pageSize: 50 });
  const s = stratusSinks(b, { LOG_INSTANCE_ID: 'i-tamp', LOG_FLUSH_LINES: '1000' });
  const c = createPlaneCLog(s.identity);
  for (let seg = 0; seg < 3; seg++) {
    for (let i = 0; i < 2; i++) c.record({ at: NOW + seg * 10 + i, who: U1, action: 'step-up', outcome: 'ok', reason: 'fresh', seat: 'head' });
    await s.flush();
  }
  const reader = () => stratusSinks(b, { LOG_INSTANCE_ID: 'i-read' });
  assert.equal((await auditChain(reader()).verify(DAY)).ok, true);
  const k = (seq, kind) => `growize-logs/identity/${DAY}/i-tamp/00000${seq}.${kind}`;
  const keep = new Map(b.objects);
  b.objects.set(k(1, 'jsonl'), { body: b.objects.get(k(1, 'jsonl')).body.replace('"fresh"', '"chose"'), version: 'v-edit' });
  let v = await auditChain(reader()).verify(DAY);
  assert.ok(kinds(v).includes('segment-edited@1'));
  assert.equal((await reader().stores.identity.read(DAY)).length, 4, 'the edited segment is left out of reads');
  b.objects.clear(); for (const [kk, vv] of keep) b.objects.set(kk, vv);
  b.objects.delete(k(1, 'jsonl')); b.objects.delete(k(1, 'manifest.json'));
  v = await auditChain(reader()).verify(DAY);
  assert.deepEqual(kinds(v), ['deleted@2', 'deleted@3', 'segment-missing@1']);
  b.objects.clear(); for (const [kk, vv] of keep) b.objects.set(kk, vv);
  b.objects.delete(k(2, 'manifest.json'));
  assert.deepEqual(kinds(await auditChain(reader()).verify(DAY)), ['unsealed@null']);
});

test('rule 7: the Stratus adapter receives scrubbed lines only — the guard runs before any sink', async () => {
  const b = fakeStratus();
  const s = stratusSinks(b, { LOG_INSTANCE_ID: 'i-rule7' });
  /* producers rebuild from allow-lists; these go straight at the shared sinks to prove the last lock holds */
  s.ops.write({ kind: 'refusal', at: NOW, actor: { kind: 'user', userId: U1 }, action: 'update', reason: FAKE_PAN, recordIds: [FAKE_MOBILE], note: `call ${FAKE_MOBILE}` });
  s.identity.write({ at: NOW, who: U1, action: 'reveal', outcome: 'ok', reason: FAKE_MAIL, seat: 'head', why: 'unstated', extra: FAKE_PAN });
  s.errors.write({ kind: 'route-error', at: NOW, requestId: '3f2a9c1e-4b5d-4e6f-8a9b-0c1d2e3f4a5b', route: '/api/x', status: 500, note: FAKE_MAIL });
  await s.flush();
  const uploaded = b.puts.map((p) => p.body).join('\n');
  assert.ok(b.puts.length >= 6);
  for (const secret of [FAKE_PAN, FAKE_MOBILE, FAKE_MAIL]) assert.ok(!uploaded.includes(secret), `${secret.slice(0, 3)}… never reaches Stratus`);
  assert.ok(uploaded.includes('"redacted"'));
  assert.ok(uploaded.includes('3f2a9c1e-4b5d-4e6f-8a9b-0c1d2e3f4a5b'), 'a request UUID passes');
});

test('readers return the same results from memory, file and Stratus sinks', async () => {
  const mem = createLogSinks({}, { clock: () => NOW });
  const file = createLogSinks({ LOG_STORE: 'jsonl', LOG_DIR: tmp() }, { clock: () => NOW });
  const b = fakeStratus();
  const strat = stratusSinks(b, { LOG_INSTANCE_ID: 'i-same' });
  for (const s of [mem, file, strat]) writeSample(s);
  await strat.flush();
  const later = stratusSinks(b, { LOG_INSTANCE_ID: 'i-other' });
  const results = [];
  for (const s of [mem, file, strat, later]) {
    for (const seat of ['di', 'root']) results.push(JSON.stringify(await queryLogs({ seat }, {}, logSourceOf(s), NOW)));
  }
  assert.equal(new Set(results.filter((_, i) => i % 2 === 0)).size, 1, 'di: identical');
  assert.equal(new Set(results.filter((_, i) => i % 2 === 1)).size, 1, 'root: identical');
  const ex = JSON.parse(results[0]);
  assert.equal(ex.total, 6);
  assert.deepEqual((await file.stores.identity.read(DAY)).map(stripChain), JSON.parse(JSON.stringify(mem.identity.events())));
});

test('stratus audit archive: a day is sealed once, read back by hash, a second write refused, an edit reads as tampered', async () => {
  const b = fakeStratus({ pageSize: 50 });
  const client = createStratusClient(stratusConfig(STRATUS_ENV), { token: async () => 'synthetic-access', invalidate() {} }, b.fetch);
  const ar = createStratusAuditArchive({ client, clean: cleanRow, clock: () => NOW });
  const rows = [{ at: '2026-10-02T10:00:00+05:30', byId: U1, action: 'Edited', module: 'Contacts', recordId: REC, name: 'never kept' }];
  assert.equal(ar.kind, 'stratus');
  const expected = require('node:crypto').createHash('sha256').update(JSON.stringify(cleanRow(rows[0])) + '\n').digest('hex');
  assert.deepEqual(await ar.write('2026-10-02', rows), { rows: 1, sha256: expected });
  assert.equal(await ar.has('2026-10-02'), true);
  assert.deepEqual(await ar.days(), ['2026-10-02']);
  assert.deepEqual((await ar.read('2026-10-02')).map((r) => r.action), ['edited']);
  assert.ok(!JSON.stringify(await ar.read('2026-10-02')).includes('never kept'));
  await assert.rejects(ar.write('2026-10-02', rows), /never rewritten/);
  assert.equal(await ar.lastRun(), NOW);
  const dataKey = [...b.objects.keys()].find((k) => /^growize-audit\/2026-10-02-[0-9a-f]{12}\.jsonl$/.test(k));
  b.objects.set(dataKey, { body: b.objects.get(dataKey).body.replace('edited', 'deleted'), version: 'v-x' });
  await assert.rejects(ar.read('2026-10-02'), /tampered/);
});

/* ---- the two log GAPs --------------------------------------------------------------------------- */

test('M15-S05-NOTE-1: a reveal line carries the chosen reason as a code; every on-screen chip maps to one; the reason shows only to identity readers', async () => {
  for (const label of [...REVWHY.pan, ...REVWHY.acct]) assert.ok(revealWhyOf(label), `"${label}" has a code`);
  assert.equal(revealWhyOf('because I can'), null);
  const sinks = createLogSinks({}, { clock: () => NOW });
  const ev = createInvestorEvents({ log: createOpsLog(sinks.ops), planeC: createPlaneCLog(sinks.identity), clock: () => NOW });
  ev.reveal(U1, 'head', 'pan', REC, 'ok', 'A filing or a TDS check');
  ev.reveal(U1, 'fin', 'bank_account', REC, 'ok', 'payout-refund');
  ev.reveal(U1, 'fin', 'bank_account', REC, 'refused');
  ev.reveal(U1, 'fin', 'bank_account', REC, 'ok', `see ${FAKE_PAN}`);
  assert.deepEqual(sinks.identity.events().map((e) => [e.reason, e.why]), [['pan', 'tds-filing'], ['bank-account', 'payout-refund'], ['bank-account', 'unstated'], ['bank-account', 'unstated']]);
  assert.ok(Object.keys(REVEAL_WHY_LABEL).every((k) => /^[a-z][a-z-]{2,31}$/.test(k)));
  const di = await queryLogs({ seat: 'di' }, { kind: 'reveal' }, logSourceOf(sinks), NOW);
  assert.deepEqual(di.rows.map((r) => r.why).sort(), ['payout-refund', 'tds-filing', 'unstated', 'unstated'].sort());
  const root = await queryLogs({ seat: 'root' }, { kind: 'reveal' }, logSourceOf(sinks), NOW);
  assert.ok(root.rows.every((r) => r.why === null), 'no reason for a reader without pii');
});

test('M08-S08-NOTE-10 / M15-S05-NOTE-1: app-access-released and test-link-issued are chained on disk after the guard, read back labelled, with the expiry; an edit is caught', async () => {
  const dir = tmp();
  const sinks = createLogSinks({ LOG_STORE: 'jsonl', LOG_DIR: dir }, { clock: () => NOW });
  const ev = createInvestorEvents({ log: createOpsLog(sinks.ops), planeC: createPlaneCLog(sinks.identity), clock: () => NOW });
  ev.appAccessReleased(U1, 'fin', REC, 'ok', 'released');
  ev.appAccessReleased(U1, 'kam', REC, 'refused', 'not-finance');
  ev.testLinkIssued(U2, 'di', REC, 10, true);
  const file = path.join(dir, `identity-${DAY}.jsonl`);
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((l) => [l.action, l.outcome, l.reason, l.who, l.seat, l.recordIds, l.ttlMinutes, l.n]), [
    ['app-access-released', 'ok', 'released', U1, 'fin', [REC], undefined, 0],
    ['app-access-released', 'refused', 'not-finance', U1, 'kam', [REC], undefined, 1],
    ['test-link-issued', 'ok', 'real-investor', U2, 'di', [REC], 10, 2],
  ], 'ttlMinutes survives the guard (a 9+ digit expiry timestamp would not)');
  assert.deepEqual([...Object.keys(lines[2])].sort(), ['action', 'at', 'ch', 'h', 'n', 'outcome', 'prev', 'reason', 'recordIds', 'seat', 'ttlMinutes', 'who'].sort(), 'nothing but ids, codes and the chain');
  const v = await auditChain(sinks).verify(DAY);
  assert.deepEqual([v.ok, v.lines], [true, 3]);
  const di = await queryLogs({ seat: 'di' }, { plane: 'c' }, logSourceOf(sinks), NOW);
  assert.deepEqual(di.rows.map((r) => [r.kind, r.group, r.label, r.outcome, r.expiresAt]).sort(), [
    ['app-access-released', 'access', 'App access release refused', 'refused', null],
    ['app-access-released', 'access', 'App access released', 'ok', null],
    ['test-link-issued', 'access', 'Test sign-in link issued', 'ok', NOW + 600_000],
  ].sort());
  const audit = await queryLogs({ seat: 'audit' }, { kind: 'access' }, logSourceOf(sinks), NOW);
  assert.equal(audit.total, 3, 'the Auditor reads them');
  assert.ok(audit.rows.every((r) => r.recordIds.length === 0 && r.withheld), 'without pii the Contact id is withheld');
  const original = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  fs.writeFileSync(file, original.map((l, i) => (i === 2 ? l.replace('"ttlMinutes":10', '"ttlMinutes":600') : l)).join('\n') + '\n');
  assert.deepEqual(kinds(await auditChain(sinks).verify(DAY)), ['edited@2'], 'a stretched expiry breaks the chain');
});

test('M06-S05-NOTE-3: lead search refuses an ops log without the success kind, so a search that went through is never filed as a refusal', () => {
  const deps = { crm: { search: async () => ({ ok: true, value: { records: [] } }) }, access: { recheck: async () => null }, recordIdPrefix: '9007199254' };
  assert.throws(() => createLeadSearch({ ...deps, log: { call() {}, refusal() {} } }), /ops log/);
  assert.doesNotThrow(() => createLeadSearch({ ...deps, log: { call() {}, refusal() {}, event() {} } }));
});

test('System page: the audit-chain card is working when intact, down when broken, attention when logs are memory only', () => {
  const facts = { ops: [], serviceTokenExpiry: {}, cache: { reads: 0, errors: 0 }, auditArchiveLastRun: NOW, licenceExpiry: NOW + 90 * 864e5,
    sign: { lastEventAt: NOW, failedHmac24h: 0 }, push: { lastDeliveredAt: NOW, failures24h: 0 } };
  const card = (a) => systemChecks({ ...facts, auditChain: a }, NOW).find((c) => c.key === 'audit-chain');
  assert.equal(card(undefined), undefined);
  assert.equal(card({ day: DAY, ok: true, problems: [] }).state, 'working');
  const broken = card({ day: DAY, ok: false, problems: [{ kind: 'deleted' }, { kind: 'deleted' }, { kind: 'edited' }] });
  assert.deepEqual([broken.state, broken.figure], ['down', 'broken — deleted, edited']);
  assert.equal(card({ day: DAY, ok: null }).state, 'attention');
});

test('scripts/verify-audit-chain.mjs: intact exits 0; an edited line or a deleted segment exits 1 and names it; content is never printed', async () => {
  const { spawnSync } = require('node:child_process');
  const script = path.resolve(__dirname, '..', '..', '..', 'scripts', 'verify-audit-chain.mjs');
  const run = (...a) => spawnSync(process.execPath, [script, ...a], { encoding: 'utf8' });
  const dir = tmp();
  writeSample(createLogSinks({ LOG_STORE: 'jsonl', LOG_DIR: dir }, { clock: () => NOW }));
  let r = run('--dir', dir, '--day', DAY);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /INTACT — 3 lines in 1 chain/);
  const anchor = /anchor ([0-9a-f]{64})/.exec(r.stdout)[1];
  const f = path.join(dir, `identity-${DAY}.jsonl`);
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('"fresh"', '"chose"'));
  r = run('--dir', dir, '--day', DAY, '--anchor', anchor);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /BROKEN[\s\S]*edited chain p-[0-9a-f]+ at 1/);
  assert.ok(!r.stdout.includes(U1) && !r.stdout.includes('chose'), 'ids and content stay out of the output');
  /* a mirror of the bucket */
  const b = fakeStratus({ pageSize: 50 });
  const s = stratusSinks(b, { LOG_INSTANCE_ID: 'i-mirror', LOG_FLUSH_LINES: '1000' });
  const c = createPlaneCLog(s.identity);
  for (let k = 0; k < 3; k++) { c.record({ at: NOW + k, who: U1, action: 'step-up', outcome: 'ok', reason: 'fresh', seat: 'head' }); await s.flush(); }
  const mirror = tmp();
  for (const [key, o] of b.objects) { const p = path.join(mirror, ...key.split('/')); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, o.body); }
  assert.equal(run('--segments', mirror, '--day', DAY).status, 0);
  fs.rmSync(path.join(mirror, 'growize-logs', 'identity', DAY, 'i-mirror', '000001.jsonl'));
  fs.rmSync(path.join(mirror, 'growize-logs', 'identity', DAY, 'i-mirror', '000001.manifest.json'));
  r = run('--segments', mirror, '--day', DAY);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /deleted chain i-mirror at 1[\s\S]*segment-missing chain i-mirror at 1/);
  assert.equal(run('--day', DAY).status, 2);
});
