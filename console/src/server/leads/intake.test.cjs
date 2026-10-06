/* C3 INTAKE — the Add page's idempotent capture and its per-row file import, over the real capture gate and Zoho client
 * with recorded replies only (no request reaches Zoho).
 *
 * Run from console/: node --test src/server/leads/intake.test.cjs
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { before, test } = require('node:test');

const consoleRoot = path.resolve(__dirname, '..', '..', '..');
const srcRoot = path.join(consoleRoot, 'src');
const fixtureRoot = path.join(srcRoot, 'lib', 'zoho', '__fixtures__', 'lead-capture');
const ts = require(path.join(consoleRoot, 'node_modules', 'typescript'));
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoho-lead-intake-'));
process.on('exit', () => fs.rmSync(outDir, { recursive: true, force: true }));

const config = ts.readConfigFile(path.join(consoleRoot, 'tsconfig.json'), ts.sys.readFile);
const project = ts.parseJsonConfigFileContent(config.config, ts.sys, consoleRoot);
const options = {
  ...project.options, incremental: false, tsBuildInfoFile: undefined, plugins: undefined,
  module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10,
  noEmit: false, noEmitOnError: true, outDir, rootDir: srcRoot,
};
const sources = [
  'lib/zoho/errors.ts', 'lib/zoho/gate.ts', 'lib/zoho/log.ts', 'lib/zoho/client.ts', 'server/oauth/seat.ts', 'domain/plan.ts',
  'server/leads/capture.ts', 'server/leads/intake.ts', 'server/state/memory.ts', 'server/state/shared-state.ts',
].map((file) => path.join(srcRoot, file));
const fmt = (items) => ts.formatDiagnostics(items, { getCanonicalFileName: (f) => f, getCurrentDirectory: () => consoleRoot, getNewLine: () => '\n' });
const program = ts.createProgram(sources, options);
const diagnostics = [...ts.getPreEmitDiagnostics(program), ...program.emit().diagnostics];
if (diagnostics.length) { console.error(fmt(diagnostics)); process.exit(1); }

const load = (file) => require(path.join(outDir, file));
const { createMemorySink, createOpsLog } = load(path.join('lib', 'zoho', 'log.js'));
const { createZohoClient, userCredential } = load(path.join('lib', 'zoho', 'client.js'));
const { createLeadCapture } = load(path.join('server', 'leads', 'capture.js'));
const { createIntake, MAX_IMPORT_ROWS } = load(path.join('server', 'leads', 'intake.js'));
const { createMemoryState } = load(path.join('server', 'state', 'memory.js'));
const { SharedStateError } = load(path.join('server', 'state', 'shared-state.js'));

const P = '9007199254';
const IR = `${P}740995001`, VIEWER = `${P}740995003`, OTHER_IR = `${P}740995009`, QUEUE = `${P}740995099`, EVENT = `${P}740997001`;
const SESSION = 'session_fixture_intake_01';
const NOW = Date.parse('2026-09-27T15:30:00Z');

const recorded = (name) => JSON.parse(fs.readFileSync(path.join(fixtureRoot, `${name}.response.json`), 'utf8'));
const toResponse = (r) => new Response(r.status === 204 ? null : JSON.stringify(r.body), { status: r.status, headers: r.headers || {} });
const immediateGate = () => ({ async acquire() { return { waitedMs: 0, release() {} }; } });

const credentials = new Map();
before(async () => {
  for (const [id, name] of [[IR, 'ir'], [VIEWER, 'viewer']]) {
    credentials.set(id, await userCredential(
      { access_token: `synthetic-${name}-token-never-live`, api_domain: 'https://www.zohoapis.in', expires_in: 3_600 },
      { recordIdPrefix: P, gate: immediateGate(), log: createOpsLog(createMemorySink()), clock: () => NOW,
        fetch: async () => toResponse(recorded(`current-user.${name}`)) },
    ));
  }
});
const principal = (id) => ({ credential: credentials.get(id), sessionId: SESSION });

const SEATS = {
  [IR]: { seat: 'investor-relations', mayCapture: true },
  [VIEWER]: { seat: 'viewer', mayCapture: false },
};
const access = {
  async recheck(credential) {
    const s = SEATS[credential.userId];
    return { actor: { userId: credential.userId, roleId: `${P}740998001`, profileId: `${P}740998002`, seat: s.seat },
      mayCapture: s.mayCapture, assignableOwnerIds: [], unassignedQueueUserId: QUEUE };
  },
};

/** `reply(body, n)` answers the nth insert (1-based) with a recorded-shape response; default: a created lead with a fresh id. */
function rig({ reply, state } = {}) {
  const inserts = [];
  const log = createOpsLog(createMemorySink());
  const crm = createZohoClient({
    recordIdPrefix: P, gate: immediateGate(), log, maxAttempts: 1, clock: () => NOW,
    fetch: async (url, init) => {
      const u = new URL(url);
      if (init.method !== 'POST' || u.pathname !== '/crm/v8/Leads') throw new Error(`unexpected synthetic CRM request ${init.method} ${u.pathname}`);
      const body = JSON.parse(init.body);
      inserts.push(body.data[0]);
      const n = inserts.length;
      const custom = reply ? reply(body.data[0], n) : null;
      if (custom) return toResponse(custom);
      return toResponse({ status: 201, headers: { 'content-type': 'application/json' }, body: { data: [{ code: 'SUCCESS', status: 'success', message: 'record added',
        details: { id: `${P}74099${String(6000 + n).padStart(4, '0')}`, Modified_Time: '2026-09-27T21:00:00+05:30' } }] } });
    },
  });
  const capture = createLeadCapture({ crm, access, log, recordIdPrefix: P, clock: () => NOW });
  const st = state ?? createMemoryState({ clock: () => NOW });
  return { intake: createIntake({ capture, state: st, clock: () => NOW }), inserts, state: st };
}

const BASE = Object.freeze({ name: 'Synthetic Fixture Lead', mobile: '98450 33021', source: 'Website' });
const KEY = 'press-key-0001';

test('one press, pressed twice with the same key: one lead, and the second answers what the first did', async () => {
  const r = rig();
  const a = await r.intake.add(principal(IR), KEY, BASE);
  assert.equal(a.ok, true);
  assert.equal(a.replayed, false);
  const b = await r.intake.add(principal(IR), KEY, BASE);
  assert.equal(b.ok, true);
  assert.equal(b.replayed, true);
  assert.deepEqual(b.value, a.value);
  assert.equal(r.inserts.length, 1, 'Zoho saw one insert');
});

test('two presses in flight at once write once', async () => {
  const r = rig();
  const [a, b] = await Promise.all([r.intake.add(principal(IR), KEY, BASE), r.intake.add(principal(IR), KEY, BASE)]);
  assert.equal(a.ok && b.ok, true);
  assert.equal(a.value.leadId, b.value.leadId);
  assert.equal(r.inserts.length, 1);
});

test('the same key with a different lead is refused and writes nothing', async () => {
  const r = rig();
  await r.intake.add(principal(IR), KEY, BASE);
  const res = await r.intake.add(principal(IR), KEY, { ...BASE, name: 'Another Person', mobile: '98450 33022' });
  assert.equal(res.ok, false);
  assert.equal(res.reasonCode, 'key-reused');
  assert.equal(r.inserts.length, 1);
});

test('the key is the person\'s own: another person using it gets their own lead', async () => {
  const r = rig();
  const a = await r.intake.add(principal(IR), KEY, BASE);
  SEATS[VIEWER].mayCapture = true;
  try {
    const b = await r.intake.add(principal(VIEWER), KEY, BASE);
    assert.equal(b.ok, true);
    assert.notEqual(b.value.leadId, a.value.leadId);
  } finally { SEATS[VIEWER].mayCapture = false; }
  assert.equal(r.inserts.length, 2);
});

test('a missing or malformed key is refused before anything is written', async () => {
  const r = rig();
  for (const k of [undefined, null, '', 'short', 'has space in it', 'x'.repeat(200)]) {
    const res = await r.intake.add(principal(IR), k, BASE);
    assert.equal(res.reasonCode, 'invalid-key', String(k));
  }
  assert.equal(r.inserts.length, 0);
});

test('a refusal is not kept: the person corrects the form and presses again with the same key', async () => {
  const r = rig();
  const bad = await r.intake.add(principal(IR), KEY, { ...BASE, name: 'A' });
  assert.equal(bad.reasonCode, 'invalid-name');
  const good = await r.intake.add(principal(IR), KEY, BASE);
  assert.equal(good.ok, true);
  assert.equal(good.replayed, false);
  assert.equal(r.inserts.length, 1);
});

test('a number Zoho already holds is refused as a duplicate, and the key is freed', async () => {
  const dup = recorded('lead.duplicate-mobile');
  const r = rig({ reply: (_row, n) => (n === 1 ? dup : null) });
  const a = await r.intake.add(principal(IR), KEY, BASE);
  assert.equal(a.reasonCode, 'duplicate-mobile');
  assert.equal(a.reason, 'the book already has this number');
  const b = await r.intake.add(principal(IR), KEY, { ...BASE, mobile: '98450 33099' });
  assert.equal(b.ok, true);
});

test('Introduced_By is sent only when an introducer is given', async () => {
  const r = rig();
  await r.intake.add(principal(IR), 'key-no-introducer', { ...BASE, source: 'Referral — investor' });
  assert.ok(!('Introduced_By' in r.inserts[0]), 'a person source with nobody named sends no Introduced_By');
  await r.intake.add(principal(IR), 'key-with-introducer', { ...BASE, mobile: '98450 33022', source: 'Referral — investor', introducedById: OTHER_IR });
  assert.deepEqual(r.inserts[1].Introduced_By, { id: OTHER_IR });
});

test('Zoho has no Introduced_By field: a clear "field missing" refusal, nothing saved, the key freed for a press without it', async () => {
  const missing = { status: 400, headers: { 'content-type': 'application/json' },
    body: { code: 'INVALID_DATA', details: { api_name: 'Introduced_By', json_path: '$.data[0].Introduced_By' }, message: 'invalid data', status: 'error' } };
  const r = rig({ reply: (row) => ('Introduced_By' in row ? missing : null) });
  const a = await r.intake.add(principal(IR), KEY, { ...BASE, source: 'Referral — investor', introducedById: OTHER_IR });
  assert.equal(a.ok, false);
  assert.equal(a.reasonCode, 'introducer-field-missing');
  assert.match(a.reason, /Introduced_By field on Leads/);
  assert.equal(r.inserts.length, 1, 'never retried without the field behind the person\'s back');
  const b = await r.intake.add(principal(IR), KEY, { ...BASE, source: 'Referral — investor' });
  assert.equal(b.ok, true);
});

test('a seat without capture is refused; the shared state failing refuses without writing', async () => {
  let r = rig();
  const res = await r.intake.add(principal(VIEWER), KEY, BASE);
  assert.equal(res.reasonCode, 'capability-missing');
  assert.equal(r.inserts.length, 0);

  const broken = { ...createMemoryState({ clock: () => NOW }), async claim() { throw new SharedStateError('unavailable'); } };
  r = rig({ state: broken });
  const down = await r.intake.add(principal(IR), KEY, BASE);
  assert.equal(down.ok, false);
  assert.equal(down.kind, 'source-error');
  assert.equal(down.source, 'state');
  assert.equal(r.inserts.length, 0, 'a create never runs unguarded');
});

/* ---- the file -------------------------------------------------------------------------------------------- */
const ROWS = [
  { name: 'Asha Rao', mobile: '98450 33021', email: 'asha@example.invalid', units: 2 },
  { name: 'X', mobile: '98450 33022' },
  { name: 'Ravi Menon', mobile: '98450 33023', city: 'Pune' },
  { name: 'Ravi Menon Again', mobile: '+91 98450 33023' },
  { name: 'Kiran Shah', mobile: 'not a number' },
];

test('a file loads row by row, each tagged to the event with no consent, each with its own verdict', async () => {
  const r = rig();
  const res = await r.intake.importRows(principal(IR), 'file-key-0001', { eventId: EVENT, rows: ROWS });
  assert.equal(res.ok, true);
  const v = res.value.rows;
  assert.deepEqual(v.map((x) => [x.row, x.status, x.reason ?? null]), [
    [0, 'added', null], [1, 'refused', 'invalid-name'], [2, 'added', null], [3, 'refused', 'duplicate-in-file'], [4, 'refused', 'invalid-mobile'],
  ]);
  assert.equal(res.value.added, 2);
  assert.equal(res.value.refused, 3);
  assert.equal(r.inserts.length, 2, 'only good rows reach Zoho');
  for (const row of r.inserts) {
    assert.equal(row.Lead_Source, 'Events');
    assert.deepEqual(row.Lead_Event, { id: EVENT });
    assert.deepEqual(row.Owner, { id: IR }, 'an IR\'s import is always their own');
    assert.ok(!Object.keys(row).some((k) => k.startsWith('Consent_')), 'a file never carries consent');
  }
  assert.equal(r.inserts[0].Units_Interested, 2);
  assert.equal(r.inserts[1].City, 'Pune');
});

test('a retried file replays the rows that landed and writes only the rest', async () => {
  // the 2nd insert fails on the first try (Zoho down for that row), the retry carries the same key
  let fail = true;
  const r = rig({ reply: (_row, n) => (n === 2 && fail ? { status: 500, headers: {}, body: { code: 'INTERNAL_ERROR' } } : null) });
  const rows = [{ name: 'Asha Rao', mobile: '98450 33021' }, { name: 'Ravi Menon', mobile: '98450 33023' }];
  const first = await r.intake.importRows(principal(IR), 'file-key-0002', { eventId: EVENT, rows });
  assert.equal(first.value.added, 1);
  assert.equal(first.value.rows[1].reason, 'zoho');
  fail = false;
  const again = await r.intake.importRows(principal(IR), 'file-key-0002', { eventId: EVENT, rows });
  assert.equal(again.value.added, 2);
  assert.equal(again.value.rows[0].replayed, true, 'row 0 answered from the first press');
  assert.equal(again.value.rows[1].replayed, false);
  assert.equal(r.inserts.length, 3, 'row 0 once, row 1 twice (its first try failed)');
  assert.equal(again.value.rows[0].leadId, first.value.rows[0].leadId);
});

test('a refusal that would repeat on every row stops the load instead of asking Zoho again and again', async () => {
  const r = rig();
  const res = await r.intake.importRows(principal(VIEWER), 'file-key-0003', { eventId: EVENT, rows: [ROWS[0], ROWS[2]] });
  assert.equal(res.ok, true);
  assert.equal(res.value.added, 0);
  assert.equal(res.value.rows[0].reason, 'capability-missing');
  assert.equal(res.value.rows[1].reason, 'not-attempted');
  assert.equal(r.inserts.length, 0);
});

test('a file needs its key, an event and at most 200 rows', async () => {
  const r = rig();
  assert.equal((await r.intake.importRows(principal(IR), undefined, { eventId: EVENT, rows: [] })).reasonCode, 'invalid-key');
  assert.equal((await r.intake.importRows(principal(IR), 'file-key-0004', { rows: [] })).reasonCode, 'invalid-request');
  const many = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => ({ name: 'Asha Rao', mobile: `9845${String(100000 + i)}` }));
  assert.equal((await r.intake.importRows(principal(IR), 'file-key-0005', { eventId: EVENT, rows: many })).reasonCode, 'too-many-rows');
  const noEvent = await r.intake.importRows(principal(IR), 'file-key-0006', { eventId: 'nope', rows: [ROWS[0]] });
  assert.equal(noEvent.value.rows[0].reason, 'event-missing', 'capture refuses a row with no real event');
  assert.equal(r.inserts.length, 0);
});
