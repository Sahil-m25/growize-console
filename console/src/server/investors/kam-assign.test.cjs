/* M09-S04-T02 — NAME OR MOVE A KEY ACCOUNT MANAGER: one guarded PUT of KAM / KAM_Since on the person's own token.
 *
 * Run from console/: node --test src/server/investors/kam-assign.test.cjs
 * Compiles the production modules with the project's strict settings and replays sanitized recorded Zoho
 * responses (src/lib/zoho/__fixtures__/kam, the seat ids of __fixtures__/oauth). No request reaches Zoho.
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
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoho-kam-assign-'));
process.on('exit', () => fs.rmSync(outDir, { recursive: true, force: true }));

const config = ts.readConfigFile(path.join(consoleRoot, 'tsconfig.json'), ts.sys.readFile);
const project = ts.parseJsonConfigFileContent(config.config, ts.sys, consoleRoot);
const options = {
  ...project.options, incremental: false, tsBuildInfoFile: undefined, plugins: undefined,
  module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10,
  noEmit: false, noEmitOnError: true, outDir, rootDir: srcRoot,
};
const sources = ['server/investors/kam-assign.ts', 'server/identity/users.ts', 'server/oauth/seat.ts', 'server/data/events.ts', 'server/identity/plane-c.ts']
  .map((f) => path.join(srcRoot, f));
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
const { createMemorySink, createOpsLog } = load('lib/zoho/log.js');
const { createZohoClient, userCredential } = load('lib/zoho/client.js');
const { createPlaneCLog, createPlaneCMemorySink } = load('server/identity/plane-c.js');
const { createInvestorEvents } = load('server/data/events.js');
const { createZohoUserDirectory } = load('server/identity/users.js');
const { createZohoSeatDirectory } = load('server/oauth/seat.js');
const { createKamAssignment, parseKamCommand, istDay, KAM_CONTACT_FIELDS } = load('server/investors/kam-assign.js');

const P = '554023';
const DIVYA = `${P}000000300010`, NEHA = `${P}000000300011`, IMRAN = `${P}000000300013`, ROHIT = `${P}000000300005`;
const VIKRAM = `${P}000000400001`, RADHIKA = `${P}000000400002`, UNALLOTTED = `${P}000000400003`, UNKNOWN = `${P}000000400099`;
const USERS = { [NEHA]: 'users.neha-kam', [IMRAN]: 'users.imran-kam', [ROHIT]: 'users.rohit-ir', [DIVYA]: 'users.divya-head-am' };
const CONTACT = { [VIKRAM]: 'contact.vikram', [RADHIKA]: 'contact.radhika', [UNALLOTTED]: 'contact.unallotted' };
const NOW = Date.parse('2026-09-28T06:00:00Z');
const SID = 'sid_fixture_kam_assign_0000000000000000';

const seatsFx = JSON.parse(fs.readFileSync(path.join(fx, 'oauth', 'current-user.seats.response.json'), 'utf8'));
const seats = createZohoSeatDirectory({ recordIdPrefix: seatsFx.recordIdPrefix, roleIds: seatsFx.roleIds, profileIds: seatsFx.profileIds });
const recorded = (name) => JSON.parse(fs.readFileSync(path.join(fx, 'kam', `${name}.response.json`), 'utf8'));
const toResponse = (r) => new Response(r.status === 204 ? null : JSON.stringify(r.body), { status: r.status, headers: r.headers || {} });
const immediateGate = () => ({ async acquire() { return { waitedMs: 0, release() {} }; }, async run(_c, t) { return t(); }, snapshot() { return {}; } });
const creds = new Map();
before(async () => {
  for (const id of [DIVYA, IMRAN]) creds.set(id, await userCredential({ access_token: `synthetic-${id}`, api_domain: 'https://www.zohoapis.in', expires_in: 3_600 },
    { recordIdPrefix: P, gate: immediateGate(), log: createOpsLog(createMemorySink()), clock: () => NOW,
      fetch: async () => toResponse({ status: 200, body: { users: [{ id, status: 'active' }] } }) }));
});

/** One rig: the Zoho client and the Users directory over recorded answers; `seatOf` is the live session's seat. */
function rig({ seatOf = { [DIVYA]: 'amlead', [IMRAN]: 'kam' }, conflict = false } = {}) {
  const calls = [];
  const sink = createMemorySink();
  const log = createOpsLog(sink);
  const cSink = createPlaneCMemorySink();
  const events = createInvestorEvents({ log, planeC: createPlaneCLog(cSink), clock: () => NOW });
  const crm = createZohoClient({ recordIdPrefix: P, gate: immediateGate(), log, maxAttempts: 1, clock: () => NOW,
    fetch: async (url, init) => {
      const u = String(url), method = (init && init.method) || 'GET';
      const body = init && init.body ? JSON.parse(init.body) : null;
      calls.push({ method, url: u, body });
      if (body && body.select_query) {
        const q = body.select_query;
        if (/from LLP_UnitAllocation_Module/.test(q)) return toResponse(recorded(q.includes(VIKRAM) ? 'coql.allotments.vikram-issued' : q.includes(RADHIKA) ? 'coql.allotments.radhika-issued' : 'coql.none'));
        throw new Error('unrouted query: ' + q);
      }
      const one = u.match(/\/Contacts\/(\d+)/);
      if (one && method === 'GET') return toResponse(CONTACT[one[1]] ? recorded(CONTACT[one[1]]) : { status: 204, body: {} });
      if (one && method === 'PUT') return toResponse(recorded(conflict ? 'contact.conflict' : one[1] === VIKRAM ? 'contact.updated.vikram' : 'contact.updated.radhika'));
      throw new Error('unrouted ' + method + ' ' + u);
    } });
  const usersFetch = async (url) => {
    const id = url.split('/').pop();
    calls.push({ method: 'GET', url, body: null });
    const text = USERS[id] ? fs.readFileSync(path.join(fx, 'kam', `${USERS[id]}.response.json`), 'utf8') : '';
    return { status: USERS[id] ? 200 : 204, text: async () => text, headers: { get: () => null } };
  };
  const users = createZohoUserDirectory({ seats, gate: immediateGate(), log, fetch: usersFetch, clock: () => NOW });
  const svc = createKamAssignment({ crm, users, events, clock: () => NOW,
    // The route re-derives this from the live session with seatAccess(...).imCan("assign"): Head of AM yes, a KAM no.
    authority: { async mayAssign(cred) { const s = seatOf[cred.userId]; return s === 'amlead' ? s : null; } } });
  return { svc, calls, sink, cSink };
}
const p = (id) => ({ credential: creds.get(id), sessionId: SID });
const puts = (r) => r.calls.filter((c) => c.method === 'PUT');

test('TC-IM04-014 (data): Divya names Neha for Vikram Anand — one guarded PUT of KAM and KAM_Since, the move logged by ids', async () => {
  const r = rig();
  const res = await r.svc.assign(p(DIVYA), parseKamCommand(VIKRAM, { kamUserId: NEHA, expectedModifiedTime: '2026-09-26T10:00:00+05:30' }));
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.deepEqual({ ...res.value }, { contactId: VIKRAM, fromKam: null, toKam: NEHA, kamSince: '2026-09-28', modifiedTime: '2026-09-28T11:30:00+05:30', changed: true });
  const [put] = puts(r);
  assert.equal(puts(r).length, 1);
  assert.match(put.url, new RegExp(`/Contacts/${VIKRAM}$`));
  assert.deepEqual(put.body, { data: [{ KAM: { id: NEHA }, KAM_Since: '2026-09-28' }] }, 'KAM_Intro_At is left to the Zoho workflow (PROVISIONAL)');
  // the PUT carried If-Unmodified-Since = the version read (checked by the client; the header is not in `calls`)
  const c = r.cSink.events();
  assert.equal(c.length, 1);
  assert.deepEqual([c[0].action, c[0].reason, c[0].who, c[0].whom, c[0].seat, c[0].recordIds], ['grant-change', 'kam-named', DIVYA, NEHA, 'amlead', [VIKRAM]]);
  assert.ok(!/Test User|Neha|Vikram|example\.invalid/i.test(JSON.stringify([...r.sink.records(), ...c])), 'logs hold ids, never names');
});

/* D122: the Zoho workflow on Contacts.KAM is what grants the KAM access, so the write must never suppress workflows. */
test('D122: the KAM write leaves Zoho workflows on — no trigger key in the body, no trigger query on the URL (assign, move, pool return)', async () => {
  const r = rig();
  const V = '2026-09-26T10:00:00+05:30', W = '2026-09-20T10:00:00+05:30';
  assert.equal((await r.svc.assign(p(DIVYA), parseKamCommand(VIKRAM, { kamUserId: NEHA, expectedModifiedTime: V }))).ok, true); // name
  assert.equal((await r.svc.assign(p(DIVYA), parseKamCommand(RADHIKA, { kamUserId: NEHA, expectedModifiedTime: W }))).ok, true); // move
  assert.equal((await r.svc.assign(p(DIVYA), parseKamCommand(RADHIKA, { kamUserId: null, expectedModifiedTime: W }))).ok, true); // pool
  const ps = puts(r);
  assert.equal(ps.length, 3);
  for (const put of ps) {
    assert.ok(!('trigger' in put.body), 'no body.trigger (trigger: [] would switch workflows off)');
    assert.ok(!('trigger' in put.body.data[0]), 'no per-record trigger');
    assert.ok(!/trigger/i.test(put.url), 'no trigger query parameter');
    assert.deepEqual(Object.keys(put.body), ['data']);
  }
});

test('a move names both managers by id: Radhika from Imran to Neha', async () => {
  const r = rig();
  const res = await r.svc.assign(p(DIVYA), parseKamCommand(RADHIKA, { kamUserId: NEHA, expectedModifiedTime: '2026-09-20T10:00:00+05:30' }));
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.deepEqual([res.value.fromKam, res.value.toKam], [IMRAN, NEHA]);
  const [e] = r.cSink.events();
  assert.deepEqual([e.reason, e.whom, e.recordIds], ['kam-moved', NEHA, [RADHIKA, IMRAN]], 'the previous manager and the new one, both by id');
});

test('returning an account to the pool clears KAM and KAM_Since; naming the manager it already has writes nothing', async () => {
  const r = rig();
  const back = await r.svc.assign(p(DIVYA), parseKamCommand(RADHIKA, { kamUserId: null, expectedModifiedTime: '2026-09-20T10:00:00+05:30' }));
  assert.equal(back.ok, true, JSON.stringify(back));
  assert.deepEqual(puts(r)[0].body, { data: [{ KAM: null, KAM_Since: null }] });
  assert.deepEqual([r.cSink.events()[0].reason, r.cSink.events()[0].whom], ['kam-returned', IMRAN]);
  const r2 = rig();
  const same = await r2.svc.assign(p(DIVYA), parseKamCommand(RADHIKA, { kamUserId: IMRAN, expectedModifiedTime: '2026-09-20T10:00:00+05:30' }));
  assert.deepEqual([same.ok, same.value.changed], [true, false]);
  assert.equal(puts(r2).length, 0);
  assert.equal(r2.cSink.events().length, 0);
});

test('TC-IM04-015 (data): a KAM cannot name or move a manager — refused before anything is read', async () => {
  const r = rig();
  const res = await r.svc.assign(p(IMRAN), parseKamCommand(RADHIKA, { kamUserId: IMRAN, expectedModifiedTime: '2026-09-20T10:00:00+05:30' }));
  assert.deepEqual({ ...res }, { ok: false, kind: 'refused', reason: 'seat-denied' });
  assert.equal(r.calls.length, 0);
  const line = r.sink.records().find((x) => x.kind === 'refusal');
  assert.deepEqual([line.action, line.reason, line.recordIds], ['kam-assign', 'seat-denied', [RADHIKA]]);
});

test('an assignee outside Account Management (an IR, the Head of AM, an unknown user) is refused; nothing is written', async () => {
  for (const who of [ROHIT, DIVYA, `${P}000000300099`]) {
    const r = rig();
    const res = await r.svc.assign(p(DIVYA), parseKamCommand(VIKRAM, { kamUserId: who, expectedModifiedTime: '2026-09-26T10:00:00+05:30' }));
    assert.deepEqual([res.ok, res.reason], [false, 'assignee-not-am'], who);
    assert.equal(puts(r).length, 0);
    assert.equal(r.calls.some((c) => /\/Contacts\//.test(c.url)), false, 'the Contact is not even read');
  }
});

test('a stale version is a conflict before the write; a 412 from Zoho is the same in-page refusal; neither logs a move', async () => {
  const r = rig();
  const stale = await r.svc.assign(p(DIVYA), parseKamCommand(VIKRAM, { kamUserId: NEHA, expectedModifiedTime: '2026-09-25T10:00:00+05:30' }));
  assert.deepEqual([stale.ok, stale.kind, stale.message], [false, 'conflict', 'Changed by someone else — reload.']);
  assert.equal(puts(r).length, 0);
  const r2 = rig({ conflict: true });
  const lost = await r2.svc.assign(p(DIVYA), parseKamCommand(VIKRAM, { kamUserId: NEHA, expectedModifiedTime: '2026-09-26T10:00:00+05:30' }));
  assert.deepEqual([lost.ok, lost.kind], [false, 'conflict']);
  assert.equal(r2.cSink.events().length, 0);
  assert.ok(r2.sink.records().some((x) => x.kind === 'refusal' && x.reason === 'already-modified' && x.recordIds[0] === VIKRAM));
});

test('an account with no Issued allotment has no manager to name (D12); an unseen Contact is refused, not "not found"', async () => {
  const r = rig();
  const a = await r.svc.assign(p(DIVYA), parseKamCommand(UNALLOTTED, { kamUserId: NEHA, expectedModifiedTime: '2026-09-26T10:00:00+05:30' }));
  assert.deepEqual([a.ok, a.reason], [false, 'not-allotted']);
  const q = r.calls.find((c) => c.body && c.body.select_query).body.select_query;
  assert.equal(q, `select id, Customer from LLP_UnitAllocation_Module where (Customer = '${UNALLOTTED}' and Allocation_Status = 'Issued') limit 0, 1`);
  const b = await r.svc.assign(p(DIVYA), parseKamCommand(UNKNOWN, { kamUserId: NEHA, expectedModifiedTime: '2026-09-26T10:00:00+05:30' }));
  assert.deepEqual([b.ok, b.reason], [false, 'not-visible']);
  assert.equal(puts(r).length, 0);
  const get = r.calls.find((c) => c.method === 'GET' && /\/Contacts\//.test(c.url));
  assert.equal(decodeURIComponent(new URL(get.url).searchParams.get('fields')), KAM_CONTACT_FIELDS.join(','), 'only the ownership fields are read');
});

test('the command is strict: ids, a Zoho datetime and nothing else; KAM_Since is the IST day', () => {
  const ok = { kamUserId: NEHA, expectedModifiedTime: '2026-09-26T10:00:00+05:30' };
  assert.ok(parseKamCommand(VIKRAM, ok));
  assert.ok(parseKamCommand(VIKRAM, { ...ok, kamUserId: null }));
  assert.equal(parseKamCommand("1' or 1=1", ok), null);
  assert.equal(parseKamCommand(VIKRAM, { ...ok, kamUserId: 'Neha Bhandari' }), null);
  assert.equal(parseKamCommand(VIKRAM, { ...ok, KAM_Intro_At: null }), null, 'no other field rides along');
  assert.equal(parseKamCommand(VIKRAM, { ...ok, expectedModifiedTime: 'yesterday' }), null);
  assert.equal(parseKamCommand(VIKRAM, null), null);
  assert.equal(istDay(Date.parse('2026-09-27T19:00:00Z')), '2026-09-28', 'after 18:30 UTC it is already tomorrow in Kolkata');
});
