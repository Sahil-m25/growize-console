/* C1 TOUCHES: logTouch (quick log) and saveTouch (a past attempt or a reply)
 *
 * Run from console/: node src/server/leads/touches.test.cjs
 *
 * Same harness as followup.test.cjs: the project's TypeScript compiles the boundary, the real Zoho client runs against
 * sanitized recorded responses only. No request reaches Zoho; every fixture is synthetic.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { before, test } = require('node:test');

const consoleRoot = path.resolve(__dirname, '..', '..', '..');
const srcRoot = path.join(consoleRoot, 'src');
const fixtureRoot = path.join(srcRoot, 'lib', 'zoho', '__fixtures__', 'followup');
const ts = require(path.join(consoleRoot, 'node_modules', 'typescript'));
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoho-touches-'));
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
  'server/leads/capture.ts', 'server/leads/followup.ts', 'server/leads/touches.ts',
].map((file) => path.join(srcRoot, file));
const format = (items) => ts.formatDiagnostics(items, { getCanonicalFileName: (f) => f, getCurrentDirectory: () => consoleRoot, getNewLine: () => '\n' });
const program = ts.createProgram(sources, options);
const diagnostics = ts.getPreEmitDiagnostics(program);
if (diagnostics.length) { console.error(format(diagnostics)); process.exit(1); }
const emitted = program.emit();
if (emitted.diagnostics.length) { console.error(format(emitted.diagnostics)); process.exit(1); }

const load = (file) => require(path.join(outDir, file));
const { createMemorySink, createOpsLog } = load(path.join('lib', 'zoho', 'log.js'));
const { createZohoClient, userCredential } = load(path.join('lib', 'zoho', 'client.js'));
const { createTouches } = load(path.join('server', 'leads', 'touches.js'));

const P = '9007199254';
const IR = `${P}740995001`;
const LEAD = `${P}740996101`;
const TOUCH = `${P}740997701`;
const SESSION = 'session_fixture_touches_1';
const LOADED = '2026-09-27T09:00:00+05:30';
let now = Date.parse('2026-09-27T15:30:00Z'); // 21:00 IST

const recorded = (name) => JSON.parse(fs.readFileSync(path.join(fixtureRoot, `${name}.response.json`), 'utf8'));
const toResponse = (r) => new Response(r.status === 204 ? null : JSON.stringify(r.body), { status: r.status, headers: r.headers || {} });
const immediateGate = () => ({ async acquire() { return { waitedMs: 0, release() {} }; } });
let credential;
before(async () => {
  credential = await userCredential({ access_token: 'synthetic-ir-token-never-live', api_domain: 'https://www.zohoapis.in', expires_in: 3_600 },
    { recordIdPrefix: P, gate: immediateGate(), log: createOpsLog(createMemorySink()), clock: () => now,
      fetch: async () => toResponse({ status: 200, body: { users: [{ id: IR, status: 'active' }] } }) });
});
const principal = () => ({ credential, sessionId: SESSION });

function rig(routes, overrides = {}) {
  const calls = [];
  const sink = createMemorySink();
  const log = createOpsLog(sink);
  const crm = createZohoClient({ recordIdPrefix: P, gate: immediateGate(), log, maxAttempts: 1, clock: () => now,
    fetch: async (url, init) => {
      const u = new URL(url);
      const key = `${init.method} ${u.pathname.replace('/crm/v8', '')}`;
      calls.push({ key, search: u.search, headers: init.headers, body: init.body ? JSON.parse(init.body) : null });
      const name = routes[key];
      if (!name) throw new Error(`unexpected synthetic CRM request ${key}`);
      return toResponse(recorded(name));
    } });
  const access = { async recheck(c) { return overrides.access ? overrides.access() :
    { actor: { userId: c.userId, roleId: `${P}740998001`, profileId: `${P}740998002`, seat: 'investor-relations' }, mayRecordFollowup: true, teamOwnerIds: [] }; } };
  return { svc: createTouches({ crm, access, log, recordIdPrefix: P, clock: () => now }), calls, sink,
    writes: () => calls.filter((c) => c.key.startsWith('PUT') || c.key.startsWith('DELETE') || c.key.startsWith('POST')) };
}
const ROUTES = (guard = 'lead.guard') => ({ [`GET /Leads/${LEAD}`]: guard, [`PUT /Leads/${LEAD}`]: 'lead.updated', 'POST /Touches': 'touch.created' });
const CMD = Object.freeze({ leadId: LEAD, expectedModifiedTime: LOADED, channel: 'msg' });
const noDelete = (r) => assert.ok(!r.calls.some((c) => c.key.startsWith('DELETE')), 'a human token holds no Delete');

test('a quick log of a message: the lead is stamped First touch (guarded) first, then one Touch, at the server\'s clock', async () => {
  now = Date.parse('2026-09-27T15:30:00Z');
  const r = rig(ROUTES());
  const res = await r.svc.record(principal(), CMD);
  assert.equal(res.ok, true);
  assert.equal(res.value.touchId, TOUCH);
  assert.equal(res.value.firstTouch, true);
  assert.deepEqual(r.writes().map((c) => c.key), [`PUT /Leads/${LEAD}`, 'POST /Touches']);
  assert.equal(r.writes()[0].headers['If-Unmodified-Since'], LOADED);
  assert.deepEqual(r.writes()[0].body.data[0], { First_Touch_At: '2026-09-27T21:00:00+05:30' });
  assert.deepEqual(r.writes()[1].body.data[0], { Name: 'WhatsApp 2026-09-27T21:00:00+05:30', Lead: { id: LEAD }, Channel: 'WhatsApp',
    Occurred_At: '2026-09-27T21:00:00+05:30', Is_Reply: false, Note: 'Message sent' });
  noDelete(r);
});

test('a call counts toward First touch only when it reached the investor; an unreached call is still a Touch', async () => {
  now = Date.parse('2026-09-27T15:30:00Z');
  let r = rig(ROUTES());
  let res = await r.svc.record(principal(), { ...CMD, channel: 'call' });
  assert.equal(res.value.firstTouch, false);
  assert.deepEqual(r.writes().map((c) => c.key), ['POST /Touches'], 'no lead write when nothing on the lead changes');
  assert.equal(r.writes()[0].body.data[0].Note, 'No answer');
  assert.equal(r.writes()[0].body.data[0].Channel, 'Call');
  r = rig(ROUTES());
  res = await r.svc.record(principal(), { ...CMD, channel: 'call', reached: true, outcome: 'Spoke', note: 'Wants the deck' });
  assert.equal(res.value.firstTouch, true);
  assert.deepEqual(r.writes()[0].body.data[0], { First_Touch_At: '2026-09-27T21:00:00+05:30' });
  assert.equal(r.writes()[1].body.data[0].Note, 'Spoke — Wants the deck');
  r = rig(ROUTES());
  res = await r.svc.record(principal(), { ...CMD, channel: 'visit', reached: true });
  assert.equal(res.value.firstTouch, true, 'a held visit is a human touch');
  assert.equal(r.writes()[1].body.data[0].Channel, 'Farm visit');
});

test('First touch is stamped once: a lead that has it is not written again', async () => {
  now = Date.parse('2026-09-27T15:30:00Z');
  const r = rig(ROUTES('lead.guard-stamped'));
  const res = await r.svc.record(principal(), CMD);
  assert.equal(res.value.firstTouch, false);
  assert.deepEqual(r.writes().map((c) => c.key), ['POST /Touches']);
});

test('a backdated attempt carries its own time; one before the lead was captured, or in the future, is refused', async () => {
  now = Date.parse('2026-09-27T15:30:00Z');
  const r = rig(ROUTES());
  assert.equal((await r.svc.record(principal(), { ...CMD, occurredAt: '2026-09-25T10:00:00+05:30' })).ok, true);
  assert.equal(r.writes()[0].body.data[0].First_Touch_At, '2026-09-25T10:00:00+05:30');
  assert.equal(r.writes()[1].body.data[0].Occurred_At, '2026-09-25T10:00:00+05:30');
  for (const [patch, code] of [[{ occurredAt: '2026-09-27T22:00:00+05:30' }, 'contact-in-future'], [{ occurredAt: '2026-09-19T10:00:00+05:30' }, 'contact-before-capture']]) {
    const x = rig(ROUTES());
    assert.equal((await x.svc.record(principal(), { ...CMD, ...patch })).reasonCode, code);
    assert.equal(x.writes().length, 0);
  }
});

test('a reply is inbound: it stamps Last_Reply_At (never backwards), is the one touch that needs no consent, and is no First touch', async () => {
  now = Date.parse('2026-09-27T15:30:00Z');
  let r = rig(ROUTES('lead.guard-no-call-consent'));
  const res = await r.svc.record(principal(), { ...CMD, channel: 'reply', occurredAt: '2026-09-27T10:00:00+05:30' });
  assert.equal(res.ok, true);
  assert.equal(res.value.firstTouch, false);
  assert.deepEqual(r.writes()[0].body.data[0], { Last_Reply_At: '2026-09-27T10:00:00+05:30' });
  assert.deepEqual(r.writes()[1].body.data[0], { Name: 'Reply 2026-09-27T10:00:00+05:30', Lead: { id: LEAD }, Occurred_At: '2026-09-27T10:00:00+05:30',
    Is_Reply: true, Note: 'Reply received' });
  assert.ok(!('Channel' in r.writes()[1].body.data[0]), 'a reply has no channel of ours');
  // an older reply than the one on the lead leaves Last_Reply_At alone
  r = rig(ROUTES('lead.guard-stamped'));
  assert.equal((await r.svc.record(principal(), { ...CMD, channel: 'reply', occurredAt: '2026-09-21T10:00:00+05:30' })).ok, true);
  assert.deepEqual(r.writes().map((c) => c.key), ['POST /Touches']);
});

test('consent is per channel, a lead closed as lost takes no touch, and the lead must be fresh and in the book', async () => {
  now = Date.parse('2026-09-27T15:30:00Z');
  const cases = [
    [{ channel: 'email' }, 'lead.guard', 'no-consent'],
    [{}, 'lead.guard-lost', 'lead-lost'],
    [{}, 'lead.guard-other-owner', 'not-in-book'],
    [{ expectedModifiedTime: '2026-09-27T08:00:00+05:30' }, 'lead.guard', 'lead-changed'],
    [{ channel: 'sms' }, 'lead.guard', 'invalid-request'],
    [{ occurredAt: 'yesterday' }, 'lead.guard', 'invalid-request'],
    [{ reached: 'yes' }, 'lead.guard', 'invalid-request'],
    [{ outcome: 'x'.repeat(81) }, 'lead.guard', 'invalid-request'],
  ];
  for (const [patch, guard, code] of cases) {
    const r = rig(ROUTES(guard));
    assert.equal((await r.svc.record(principal(), { ...CMD, ...patch })).reasonCode, code, code);
    assert.equal(r.writes().length, 0, code);
  }
  // a farm visit has no consent flag
  const v = rig(ROUTES('lead.guard-no-call-consent'));
  assert.equal((await v.svc.record(principal(), { ...CMD, channel: 'visit', reached: true })).ok, true);
  assert.equal((await rig(ROUTES(), { access: () => null }).svc.record(principal(), CMD)).reasonCode, 'session-changed');
  assert.equal((await rig(ROUTES(), { access: () => ({ actor: { userId: IR }, mayRecordFollowup: false, teamOwnerIds: [] }) }).svc.record(principal(), CMD)).reasonCode, 'capability-missing');
});

test('a lead edited since the page read it is refused by Zoho\'s guard before any touch is written', async () => {
  now = Date.parse('2026-09-27T15:30:00Z');
  const r = rig({ ...ROUTES(), [`PUT /Leads/${LEAD}`]: 'conflict' });
  assert.equal((await r.svc.record(principal(), CMD)).reasonCode, 'lead-changed');
  assert.deepEqual(r.writes().map((c) => c.key), [`PUT /Leads/${LEAD}`]);
});

test('if the Touch cannot be written the lead\'s stamps are written back as they were (an update, never a delete)', async () => {
  now = Date.parse('2026-09-27T15:30:00Z');
  const r = rig({ ...ROUTES(), 'POST /Touches': 'server-error' });
  const res = await r.svc.record(principal(), CMD);
  assert.equal(res.ok, false);
  assert.deepEqual(r.writes().map((c) => c.key), [`PUT /Leads/${LEAD}`, 'POST /Touches', `PUT /Leads/${LEAD}`]);
  assert.deepEqual(r.writes()[2].body.data[0], { First_Touch_At: null });
  assert.equal(r.writes()[2].headers['If-Unmodified-Since'], '2026-09-27T21:00:00+05:30');
  noDelete(r);
});

test('the notes and outcomes written to Zoho never reach the ops log (Plane B holds ids and codes only)', async () => {
  now = Date.parse('2026-09-27T15:30:00Z');
  const r = rig(ROUTES());
  await r.svc.record(principal(), { ...CMD, note: 'Synthetic private note' });
  assert.ok(!JSON.stringify(r.sink.records()).includes('Synthetic private note'));
});

/* W3-E2E-7: the history reads the lead's touches back (the Investor file forgot them on reload). */
function listRig(rows, { visible = true } = {}) {
  const calls = [];
  const sink = createMemorySink();
  const log = createOpsLog(sink);
  const crm = createZohoClient({ recordIdPrefix: P, gate: immediateGate(), log, maxAttempts: 1, clock: () => now,
    fetch: async (url, init) => {
      const u = new URL(url);
      calls.push({ path: u.pathname, body: init.body ? JSON.parse(init.body) : null });
      if (u.pathname.endsWith('/coql')) return toResponse({ status: 200, body: { data: rows, info: { more_records: false } } });
      if (!visible) return toResponse({ status: 404, body: { code: 'INVALID_DATA', status: 'error' } });
      return toResponse(recorded('lead.guard'));
    } });
  const access = { async recheck(c) { return { actor: { userId: c.userId }, mayRecordFollowup: true, teamOwnerIds: [] }; } };
  return { svc: createTouches({ crm, access, log, recordIdPrefix: P, clock: () => now }), calls };
}
const trow = (o) => ({ id: `${P}74099770${o.n}`, Occurred_At: '2026-10-09T11:53:00+05:30', Is_Reply: false, Owner: { id: IR }, Voided_At: null, ...o });

test('list: touches newest first with the channel the IR picked (WhatsApp stays WhatsApp on "Reply received"), outcome split from words, voided left out', async () => {
  const r = listRig([
    trow({ n: 1, Channel: 'WhatsApp', Is_Reply: true, Note: 'Reply received' }),
    trow({ n: 2, Channel: 'Call', Note: 'Interested \u2014 wants the deck' }),
    trow({ n: 3, Channel: null, Is_Reply: true, Note: 'Reply received' }),
    trow({ n: 4, Channel: 'Email', Note: 'Email sent', Voided_At: '2026-10-09T12:00:00+05:30' }),
  ]);
  const res = await r.svc.list(principal(), LEAD);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.deepEqual(res.value.touches.map((t) => [t.channel, t.outcome, t.note, t.reply]),
    [['msg', 'Reply received', null, true], ['call', 'Interested', 'wants the deck', false], ['reply', 'Reply received', null, true]]);
  assert.equal(res.value.touches[0].byId, IR);
  const q = r.calls.find((c) => c.path.endsWith('/coql')).body.select_query;
  assert.match(q, new RegExp(`from Touches where Lead = '${LEAD}' order by Occurred_At desc`));
});

test('W5-2: two touches in the same minute list the later-entered one first (Created_Time), whatever order Zoho returns', async () => {
  const r = listRig([
    trow({ n: 1, Channel: 'WhatsApp', Is_Reply: true, Note: 'Reply received', Created_Time: '2026-10-09T11:53:10+05:30' }),
    trow({ n: 2, Channel: 'Call', Note: 'Connected', Created_Time: '2026-10-09T11:53:40+05:30' }),
  ]);
  const res = await r.svc.list(principal(), LEAD);
  assert.deepEqual(res.value.touches.map((t) => t.channel), ['call', 'msg']);
});

test('list: a lead this token cannot open is not-visible, and a bad id is refused before any call', async () => {
  const hidden = listRig([], { visible: false });
  const res = await hidden.svc.list(principal(), LEAD);
  assert.deepEqual([res.ok, res.reasonCode], [false, 'not-visible']);
  assert.ok(!hidden.calls.some((c) => c.path.endsWith('/coql')));
  const bad = listRig([]);
  assert.equal((await bad.svc.list(principal(), 'not-an-id')).reasonCode, 'invalid-request');
  assert.equal(bad.calls.length, 0);
});
