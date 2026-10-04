/* M15-S03 ACTIVITY: THE AUDIT ARCHIVE, THE NIGHTLY EXPORT, THE SCOPED QUERY AND THE SOURCES BY PLANE
 *
 * Run from console/: node --test src/server/activity/activity.test.cjs
 *
 * Replays the recorded audit-export responses under lib/zoho/__fixtures__/activity (request, poll,
 * a zipped CSV, the Users list); the archive writes to a temp directory. No network, no live Zoho.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const consoleRoot = path.resolve(__dirname, '..', '..', '..');
const srcRoot = path.join(consoleRoot, 'src');
const fixtures = path.join(srcRoot, 'lib', 'zoho', '__fixtures__', 'activity');
const ts = require(path.join(consoleRoot, 'node_modules', 'typescript'));
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'activity-'));
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'activity-data-'));
process.on('exit', () => {
  for (const d of [outDir, scratch]) { try { (function unlock(p) { for (const f of fs.readdirSync(p, { withFileTypes: true })) { const q = path.join(p, f.name); if (f.isDirectory()) unlock(q); else fs.chmodSync(q, 0o600); } })(d); } catch {} fs.rmSync(d, { recursive: true, force: true }); }
});
const config = ts.readConfigFile(path.join(consoleRoot, 'tsconfig.json'), ts.sys.readFile);
const project = ts.parseJsonConfigFileContent(config.config, ts.sys, consoleRoot);
const options = { ...project.options, incremental: false, tsBuildInfoFile: undefined, plugins: undefined, module: ts.ModuleKind.CommonJS,
  moduleResolution: ts.ModuleResolutionKind.Node10, noEmit: false, noEmitOnError: true, outDir, rootDir: srcRoot };
const program = ts.createProgram(['lib/zoho/client.ts', 'server/activity/archive.ts', 'server/activity/export-job.ts', 'server/activity/query.ts', 'server/activity/sources.ts'].map((f) => path.join(srcRoot, f)), options);
const diags = ts.getPreEmitDiagnostics(program);
if (diags.length) { console.error(ts.formatDiagnostics(diags, { getCanonicalFileName: (f) => f, getCurrentDirectory: () => consoleRoot, getNewLine: () => '\n' })); process.exit(1); }
program.emit();
const load = (f) => require(path.join(outDir, f));
const { createLocalAuditArchive } = load('server/activity/archive.js');
const { createZohoAuditExportSource, runAuditExport, fetchUserDirectory, auditTime, auditRowsFromCsv, previousIstDay } = load('server/activity/export-job.js');
const { queryActivity, activitySides } = load('server/activity/query.js');
const { recordHistory, planeCBetween } = load('server/activity/sources.js');
const { serviceCredential } = load('lib/zoho/client.js');

const NOW = Date.parse('2026-09-03T01:00:00+05:30');
const U = { rohit: '9007199254740995001', tasneem: '9007199254740995002', kavya: '9007199254740995003', harsha: '9007199254740995010', meena: '9007199254740995011', imran: '9007199254740995020', sahil: '9007199254740995099', latha: '9007199254740995030' };
const L5_CALL = '9007199254740992005';
const cred = serviceCredential('audit-archive', { access_token: 'synthetic-audit-token', api_domain: 'https://www.zohoapis.in', expires_in: 3600 }, NOW);
const fx = (n) => fs.readFileSync(path.join(fixtures, n));
const res = (status, body) => ({ status, text: async () => (Buffer.isBuffer(body) ? body.toString('utf8') : JSON.stringify(body)), arrayBuffer: async () => { const b = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); } });

function zohoFetch(o = {}) {
  const calls = [];
  let polls = 0;
  const fetch = async (url, init) => {
    calls.push({ url, method: init.method, auth: init.headers.Authorization });
    if (url.includes('/users')) return res(200, JSON.parse(fx('users.response.json')));
    if (init.method === 'POST') return o.requestStatus ? res(o.requestStatus, {}) : res(201, JSON.parse(fx('audit-export.request.response.json')));
    if (url.includes('/settings/audit_log_export/')) return res(200, JSON.parse(fx(o.fail ? 'audit-export.status-failed.response.json' : polls++ < 1 ? 'audit-export.status-pending.response.json' : 'audit-export.status-done.response.json')));
    if (url.startsWith('https://download-accl.zoho.in/')) return res(200, fx('audit-export.2026-09-02.zip'));
    return res(404, {});
  };
  return { fetch, calls };
}

async function archived() {
  const dir = fs.mkdtempSync(path.join(scratch, 'arch-'));
  const archive = createLocalAuditArchive({ dir, clock: () => NOW });
  const z = zohoFetch();
  const source = createZohoAuditExportSource({ credential: cred, fetch: z.fetch });
  const userIdOf = await fetchUserDirectory({ credential: cred, fetch: z.fetch });
  const run = await runAuditExport({ source, archive, userIdOf, clock: () => NOW, sleep: async () => {} });
  return { dir, archive, run, calls: z.calls, source, userIdOf };
}

test('T01: nightly export → poll → download the zip → one sealed, append-only day with ids and codes only', async () => {
  assert.equal(previousIstDay(NOW), '2026-09-02');
  const a = await archived();
  assert.deepEqual(a.run, { ok: true, day: '2026-09-02', rows: 7, skipped: false });
  assert.deepEqual(await a.archive.days(), ['2026-09-02']);
  assert.equal(await a.archive.lastRun(), NOW);
  const rows = await a.archive.read('2026-09-02');
  assert.deepEqual(rows[0], { at: '2026-09-02T10:15:00+05:30', day: '2026-09-02', byId: U.rohit, action: 'added', module: 'Calls', recordId: '9007199254740992001' });
  assert.equal(rows.find((r) => r.module === 'Contacts').byId, 'unrecognised');
  assert.equal(rows.find((r) => r.module === 'Leads').byId, U.kavya, 'a full name resolves through the Users list');
  const files = fs.readdirSync(a.dir);
  const text = files.map((f) => fs.readFileSync(path.join(a.dir, f), 'utf8')).join('\n');
  assert.ok(!/@|Synthetic|comma/.test(text), 'no email, name or record name is archived');
  const dayFile = files.find((f) => f.startsWith('audit-'));
  assert.equal(fs.statSync(path.join(a.dir, dayFile)).mode & 0o222, 0, 'the sealed file is read-only');
  assert.ok(a.calls.filter((c) => c.url.includes('audit_log_export')).every((c) => c.auth === 'Zoho-oauthtoken synthetic-audit-token'));
  const again = await runAuditExport({ source: a.source, archive: a.archive, userIdOf: a.userIdOf, clock: () => NOW, sleep: async () => {} });
  assert.deepEqual(again, { ok: true, day: '2026-09-02', rows: 0, skipped: true });
  await assert.rejects(a.archive.write('2026-09-02', []), /never rewritten/);
});

test('T01: a failed, refused or stuck export alerts and leaves the day unsealed; a foreign download link never gets the token', async () => {
  for (const [o, code] of [[{ fail: true }, 'export-failed'], [{ requestStatus: 500 }, 'http-500']]) {
    const archive = createLocalAuditArchive({ dir: fs.mkdtempSync(path.join(scratch, 'f-')) });
    const alerts = [];
    const r = await runAuditExport({ source: createZohoAuditExportSource({ credential: cred, fetch: zohoFetch(o).fetch }), archive, userIdOf: () => null,
      day: '2026-09-02', sleep: async () => {}, onFailure: (c) => alerts.push(c) });
    assert.deepEqual(r, { ok: false, day: '2026-09-02', code });
    assert.deepEqual(alerts, [code]);
    assert.deepEqual(await archive.days(), []);
  }
  const stuck = { request: async () => '1', status: async () => ({ state: 'pending', links: [] }), download: async () => { throw new Error('x'); } };
  const alerts = [];
  assert.equal((await runAuditExport({ source: stuck, archive: createLocalAuditArchive({ dir: fs.mkdtempSync(path.join(scratch, 's-')) }), userIdOf: () => null, day: '2026-09-02', maxPolls: 3, sleep: async () => {}, onFailure: (c) => alerts.push(c) })).code, 'export-timeout');
  const calls = [];
  const src = createZohoAuditExportSource({ credential: cred, fetch: async (u) => { calls.push(u); return res(200, {}); } });
  await assert.rejects(src.download('https://evil.example.invalid/x.zip'), /bad-link/);
  await assert.rejects(src.download('http://download-accl.zoho.in/x.zip'), /bad-link/);
  assert.equal(calls.length, 0);
  assert.throws(() => createZohoAuditExportSource({ credential: serviceCredential('provider-callback', { access_token: 't', api_domain: 'https://www.zohoapis.in', expires_in: 60 }, NOW), fetch: async () => res(200, {}) }));
});

test('T01: an edited archive file reads as tampered, never as data', async () => {
  const a = await archived();
  const f = path.join(a.dir, fs.readdirSync(a.dir).find((x) => x.startsWith('audit-')));
  fs.chmodSync(f, 0o600); fs.appendFileSync(f, '{"at":"2026-09-02T09:00:00+05:30","byId":"9007199254740995001","action":"added","module":"Calls","recordId":null}\n');
  await assert.rejects(a.archive.read('2026-09-02'), /tampered/);
});

test('T01: Zoho times are read in Asia/Kolkata; CSV quoting holds', () => {
  assert.equal(auditTime('2026-09-02 10:15:00'), '2026-09-02T10:15:00+05:30');
  assert.equal(auditTime('2026-09-02T04:45:00Z'), '2026-09-02T10:15:00+05:30');
  assert.equal(auditTime('Sep 2, 2026 10:15 PM'), '2026-09-02T22:15:00+05:30');
  assert.equal(auditTime('02/Sep/2026 12:05 AM'), '2026-09-02T00:05:00+05:30');
  assert.equal(auditTime('yesterday'), null);
  const rows = auditRowsFromCsv('Date & Time,User ID,Action,Module\n"2026-09-02 10:00",9007199254740995001,Deleted,Leads\n', () => null);
  assert.deepEqual(rows, [{ at: '2026-09-02T10:00:00+05:30', day: '2026-09-02', byId: U.rohit, action: 'deleted', module: 'Leads', recordId: null }]);
});

/* ---- the query ---------------------------------------------------------------------------------- */

function deps(archive, o = {}) {
  const visCalls = [];
  const hidden = new Set(o.hidden ?? [L5_CALL]);
  return {
    visCalls,
    d: {
      archive, clock: () => NOW,
      planeC: () => o.planeC ?? [],
      subtreeOf: async (m) => (m === U.tasneem ? [U.rohit, U.kavya] : []),
      financeUserIds: async () => o.finance ?? [U.harsha, U.meena],
      visible: async (module, ids) => { visCalls.push({ module, n: ids.length }); if (o.visFail === module) return null; return new Set(ids.filter((x) => !hidden.has(x))); },
    },
  };
}
const SEP = { month: '2026-09' };

test('TC-E11-008/011: an IR sees only their own actions, with no person view, and not those on a lead they cannot open', async () => {
  const a = await archived();
  const { d, visCalls } = deps(a.archive);
  const r = await queryActivity({ seat: 'ir', userId: U.rohit }, SEP, d);
  assert.equal(r.ok, true);
  assert.deepEqual(r.sides, ['lead'], 'no Investors side switch');
  assert.equal(r.solo, true);
  assert.deepEqual(r.byPerson, []);
  assert.deepEqual(r.rows.map((x) => x.recordId), ['9007199254740992001'], 'the call on L5 is not listed');
  assert.ok(r.rows.every((x) => x.byId === U.rohit));
  assert.equal(r.rows[0].what, 'Call logged');
  assert.deepEqual(visCalls, [{ module: 'Calls', n: 2 }], 'one batched check on the reader token, not a per-record fan-out');
});

test('TC-E11-009/010/012: the IR Manager sees the team, by person; the kind filter narrows; invalid filters are ignored', async () => {
  const a = await archived();
  const { d } = deps(a.archive);
  const all = await queryActivity({ seat: 'conv', userId: U.tasneem }, SEP, d);
  assert.equal(all.solo, false);
  assert.deepEqual(all.people, [U.rohit, U.tasneem, U.kavya].sort());
  assert.deepEqual(all.byPerson.map((t) => [t.key, t.total]), [[U.rohit, 1], [U.tasneem, 1], [U.kavya, 1]]);
  assert.equal(all.byDay[0].key, '2026-09-02');
  const calls = await queryActivity({ seat: 'conv', userId: U.tasneem }, { ...SEP, kind: 'call' }, d);
  assert.equal(calls.total, 1); assert.ok(calls.rows.every((x) => x.kind === 'call'));
  const bad = await queryActivity({ seat: 'conv', userId: U.tasneem }, { month: '2026-13', person: 'harsha', kind: 'bogus' }, d);
  assert.deepEqual(bad.ignored, ['month', 'person', 'kind']);
  assert.equal(bad.month, '2026-09', 'the current month');
  assert.equal(bad.total, all.total, 'the unfiltered month');
  const ir = await queryActivity({ seat: 'ir', userId: U.rohit }, { ...SEP, person: U.kavya }, d);
  assert.deepEqual(ir.ignored, ['person'], 'a solo seat has no person filter');
});

test('TC-IM10-006/008/009: Finance reads their own work; the Auditor the Finance trail; a KAM only their own (none)', async () => {
  const a = await archived();
  const { d } = deps(a.archive);
  const harsha = await queryActivity({ seat: 'head', userId: U.harsha }, SEP, d);
  assert.deepEqual(harsha.sides, ['investors']);
  assert.deepEqual(harsha.rows.map((x) => [x.byId, x.kind, x.recordId]), [[U.harsha, 'money', '9007199254740996001']]);
  const latha = await queryActivity({ seat: 'audit', userId: U.latha }, SEP, d);
  assert.deepEqual(latha.rows.map((x) => x.byId).sort(), [U.harsha, U.meena].sort());
  assert.equal(latha.solo, false);
  const imran = await queryActivity({ seat: 'kam', userId: U.imran }, SEP, d);
  assert.equal(imran.total, 0);
});

test('TC-IM10-008 (D78): the merged Compliance & Audit seat (`comp`) reads the Finance trail, read only, and never someone else\'s', async () => {
  const a = await archived();
  const { d } = deps(a.archive);
  const comp = await queryActivity({ seat: 'comp', userId: U.latha }, SEP, d);
  assert.deepEqual(comp.rows.map((x) => x.byId).sort(), [U.harsha, U.meena].sort(), 'Finance people, not self-only (was 0 rows)');
  assert.equal(comp.solo, false);
  assert.deepEqual(comp.sides, ['investors']);
  const other = await queryActivity({ seat: 'comp', userId: U.latha }, SEP, deps(a.archive, { finance: [U.meena] }).d);
  assert.ok(other.rows.every((x) => x.byId === U.meena), 'only the configured Finance ids (plus self)');
  const unset = await queryActivity({ seat: 'comp', userId: U.latha }, SEP, { ...d, financeUserIds: async () => null });
  assert.ok(unset.rows.every((x) => ['money', 'doc', 'kyc'].includes(x.kind)), 'Finance kinds stand in when ZOHO_FINANCE_USER_IDS is unset');
});

test('TC-IM10-007 / AC: Digital Infrastructure sees both sides on one page; the Investors side withholds investor details', async () => {
  const a = await archived();
  const { d, visCalls } = deps(a.archive);
  assert.deepEqual(activitySides('di'), ['lead', 'investors']);
  const inv = await queryActivity({ seat: 'di', userId: U.sahil }, { ...SEP, side: 'investors' }, d);
  assert.equal(inv.adminView, true);
  assert.equal(inv.total, 3);
  assert.ok(inv.rows.every((x) => x.recordId === null && x.withheld));
  assert.deepEqual(inv.rows.map((x) => x.what).sort(), ['Account care event', 'Money event', 'Tickets event']);
  const lead = await queryActivity({ seat: 'di', userId: U.sahil }, { ...SEP, side: 'lead' }, d);
  assert.equal(lead.adminView, false);
  assert.equal(lead.total, 4, 'the lead side shows everything, including the call on L5');
  assert.equal(visCalls.length, 0);
  assert.equal((await queryActivity({ seat: 'nobody', userId: U.sahil }, SEP, d)).ok, false);
});

test('T05: Plane C reveals, step-ups and seat changes join the Investors side, scoped like the rest; a failed check fails closed', async () => {
  const a = await archived();
  const planeC = [
    { at: Date.parse('2026-09-02T12:00:00+05:30'), who: U.harsha, action: 'reveal', outcome: 'ok', reason: 'chose', seat: 'head', recordIds: ['9007199254740994101'] },
    { at: Date.parse('2026-09-02T12:01:00+05:30'), who: U.harsha, action: 'step-up', outcome: 'ok', reason: 'chose', seat: 'head' },
    { at: Date.parse('2026-09-02T12:02:00+05:30'), who: U.meena, action: 'sign-in', outcome: 'ok', reason: 'chose', seat: 'fin' },
    { at: Date.parse('2026-08-31T12:00:00+05:30'), who: U.harsha, action: 'reveal', outcome: 'ok', reason: 'chose', seat: 'head', recordIds: ['9007199254740994101'] },
  ];
  const { d } = deps(a.archive, { planeC });
  const r = await queryActivity({ seat: 'head', userId: U.harsha }, { ...SEP, kind: 'pii' }, d);
  assert.deepEqual(r.rows.map((x) => [x.what, x.source, x.recordId]), [['Stepped up', 'plane-c', null], ['Identity revealed', 'plane-c', '9007199254740994101']]);
  const failing = deps(a.archive, { planeC, visFail: 'Contacts' });
  const f = await queryActivity({ seat: 'head', userId: U.harsha }, { ...SEP, kind: 'pii' }, failing.d);
  assert.equal(f.partial, true);
  assert.deepEqual(f.rows.map((x) => x.what), ['Stepped up'], 'the reveal is left out rather than shown unchecked');
  const ring = await planeCBetween({ store: null, ring: () => planeC }, Date.parse('2026-09-01T00:00:00+05:30'), Date.parse('2026-10-01T00:00:00+05:30'));
  assert.equal(ring.length, 3);
});

test('Plane C admin rows: console access granted / ended, a reporting-line change, and the seat change\'s pooled count', async () => {
  const a = await archived();
  const at = (m) => Date.parse(`2026-09-03T12:0${m}:00+05:30`);
  const planeC = [
    { at: at(1), who: U.sahil, whom: U.meena, action: 'access-granted', outcome: 'ok', reason: 'payments', seat: 'di' },
    { at: at(2), who: U.sahil, whom: U.meena, action: 'access-ended', outcome: 'ended', reason: 'no-page-left', seat: 'di' },
    { at: at(3), who: U.sahil, whom: U.meena, action: 'manager-change', outcome: 'ok', reason: 'moved', seat: 'di' },
    { at: at(4), who: U.sahil, whom: U.meena, action: 'seat-change', outcome: 'ok', reason: 'kam-to-amlead', seat: 'di', count: 3 },
    { at: at(5), who: U.sahil, whom: U.meena, action: 'seat-change', outcome: 'refused', reason: 'kam-to-amlead', seat: 'di' },
  ];
  const { d } = deps(a.archive, { planeC });
  const r = await queryActivity({ seat: 'di', userId: U.sahil }, { ...SEP, side: 'investors', kind: 'admin' }, d);
  const pc = r.rows.filter((x) => x.source === 'plane-c').map((x) => x.what);
  assert.deepEqual(pc, ['Seat changed (refused)', 'Seat changed · 3 accounts returned to the pool', 'Changed who they report to', 'Console access ended', 'Console access granted']);
});

test('T05 / TC-E11-013: a record history is one live __timeline call on the reader token, values never returned', async () => {
  const calls = [];
  const crm = { async timeline(as, module, id, o) { calls.push({ as, module, id, perPage: o.perPage });
    return { ok: true, value: { entries: [{ at: '2026-09-02T04:45:00Z', action: 'updated', byId: U.rohit, fields: ['Lead_Status'] }], moreRecords: false }, status: 200, creditsRemaining: null }; } };
  const me = { kind: 'user', userId: U.rohit };
  const r = await recordHistory(crm, me, 'Leads', '9007199254740991003');
  assert.deepEqual(r, { ok: true, more: false, entries: [{ at: '2026-09-02T10:15:00+05:30', byId: U.rohit, action: 'updated', fields: ['Lead_Status'] }] });
  assert.equal(calls.length, 1); assert.equal(calls[0].as, me);
  const no = await recordHistory({ timeline: async () => ({ ok: false, error: { kind: 'not-found', status: 404, code: 'x' }, creditsRemaining: null }) }, me, 'Leads', '9007199254740991005');
  assert.deepEqual(no, { ok: false, error: 'not-found' });
});
