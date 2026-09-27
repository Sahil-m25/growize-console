/* M07-S03 FOLLOW-UP SAVE AND UNDO
 *
 * Run from console/: node src/server/leads/followup.test.cjs
 *
 * Type-checks the capture boundary with the project's TypeScript, then drives it through the real
 * Zoho client with sanitized recorded responses only. No request reaches Zoho; every fixture is
 * synthetic. Whether live Zoho accepts the new picklist values and fields is M04-S01-T01's check.
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
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoho-followup-'));
process.on('exit', () => fs.rmSync(outDir, { recursive: true, force: true }));

const config = ts.readConfigFile(path.join(consoleRoot, 'tsconfig.json'), ts.sys.readFile);
const project = ts.parseJsonConfigFileContent(config.config, ts.sys, consoleRoot);
const options = {
  ...project.options,
  incremental: false,
  tsBuildInfoFile: undefined,
  plugins: undefined,
  module: ts.ModuleKind.CommonJS,
  moduleResolution: ts.ModuleResolutionKind.Node10,
  noEmit: false,
  noEmitOnError: true,
  outDir,
  rootDir: srcRoot,
};
const sources = [
  'lib/zoho/errors.ts',
  'lib/zoho/gate.ts',
  'lib/zoho/log.ts',
  'lib/zoho/client.ts',
  'server/oauth/seat.ts',
  'domain/plan.ts',
  'server/leads/capture.ts',
  'server/leads/followup.ts',
].map((file) => path.join(srcRoot, file));
const format = (items) => ts.formatDiagnostics(items, {
  getCanonicalFileName: (file) => file,
  getCurrentDirectory: () => consoleRoot,
  getNewLine: () => '\n',
});
const program = ts.createProgram(sources, options);
const diagnostics = ts.getPreEmitDiagnostics(program);
if (diagnostics.length) {
  console.error(format(diagnostics));
  process.exit(1);
}
const emitted = program.emit();
if (emitted.diagnostics.length) {
  console.error(format(emitted.diagnostics));
  process.exit(1);
}



const load = (file) => require(path.join(outDir, file));
const { createMemorySink, createOpsLog } = load(path.join('lib', 'zoho', 'log.js'));
const { createZohoClient, userCredential } = load(path.join('lib', 'zoho', 'client.js'));
const { createFollowups, UNDO_WINDOW_MS } = load(path.join('server', 'leads', 'followup.js'));

const P = '9007199254';
const IR = `${P}740995001`;
const LEAD = `${P}740996101`;
const TASK = `${P}740997601`;
const TOUCH = `${P}740997701`;
const CALL = `${P}740997801`;
const SESSION = 'session_fixture_followup_1';
const SECRET = 'synthetic-undo-secret-never-live-0000000001';
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

/** routes: key "METHOD /Module[/id]" → fixture name, or an array consumed in order. */
function rig(routes, overrides = {}) {
  const calls = [];
  const sink = createMemorySink();
  const log = createOpsLog(sink);
  const crm = createZohoClient({ recordIdPrefix: P, gate: immediateGate(), log, maxAttempts: 1, clock: () => now,
    fetch: async (url, init) => {
      const u = new URL(url);
      const key = `${init.method} ${u.pathname.replace('/crm/v8', '')}`;
      calls.push({ key, headers: init.headers, body: init.body ? JSON.parse(init.body) : null });
      let name = routes[key] ?? routes[`${init.method} /${u.pathname.split('/')[3]}`];
      if (Array.isArray(name)) name = name.shift();
      if (!name) throw new Error(`unexpected synthetic CRM request ${key}`);
      return toResponse(recorded(name));
    } });
  const access = { async recheck(c) { return overrides.access ? overrides.access() :
    { actor: { userId: c.userId, roleId: `${P}740998001`, profileId: `${P}740998002`, seat: 'investor-relations' }, mayRecordFollowup: true, teamOwnerIds: [] }; } };
  return { svc: createFollowups({ crm, access, log, recordIdPrefix: P, undoSecret: SECRET, clock: () => now }), calls, sink,
    writes: () => calls.filter((c) => c.key.startsWith('PUT') || c.key.startsWith('DELETE') || (c.key.startsWith('POST') && !c.key.includes('coql'))) };
}

const CMD = Object.freeze({
  leadId: LEAD, expectedModifiedTime: LOADED,
  contact: { channel: 'call', outcome: 'Spoke', occurredAt: '2026-09-27T20:30:00+05:30', reached: true, note: 'Synthetic call note' },
  scheduled: { module: 'Tasks', id: TASK }, complete: true, keep: false,
  next: { text: 'Call back after the deck', at: '2026-09-29T11:00:00+05:30', channel: 'call' },
});
const ROUTES = () => ({
  [`GET /Leads/${LEAD}`]: 'lead.guard', [`GET /Tasks/${TASK}`]: 'task.scheduled',
  [`PUT /Leads/${LEAD}`]: 'lead.updated', 'POST /Touches': 'touch.created', [`PUT /Tasks/${TASK}`]: 'task.updated', 'POST /Calls': 'call.created',
  'DELETE /Touches': 'deleted', 'DELETE /Calls': 'deleted',
});

test('one tap writes the lead (guarded) first, then exactly one touch, the completed task and one next step', async () => {
  now = Date.parse('2026-09-27T15:30:00Z');
  const r = rig(ROUTES());
  const res = await r.svc.save(principal(), CMD);
  assert.equal(res.ok, true);
  assert.equal(res.value.touchId, TOUCH);
  assert.equal(res.value.nextId, CALL);
  assert.equal(res.value.undoUntil, now + UNDO_WINDOW_MS);
  assert.deepEqual(r.writes().map((c) => c.key), [`PUT /Leads/${LEAD}`, 'POST /Touches', `PUT /Tasks/${TASK}`, 'POST /Calls']);
  const [lead, touch, task, call] = r.writes();
  assert.equal(lead.headers['If-Unmodified-Since'], LOADED);
  assert.deepEqual(lead.body.data[0], { Next_Step: 'Call back after the deck', Next_Step_At: '2026-09-29T11:00:00+05:30', Next_Step_Channel: 'Call',
    First_Touch_At: '2026-09-27T20:30:00+05:30' });
  assert.deepEqual(touch.body.data[0], { Name: 'Call 2026-09-27T20:30:00+05:30', Lead: { id: LEAD }, Channel: 'Call',
    Occurred_At: '2026-09-27T20:30:00+05:30', Is_Reply: false, Note: 'Spoke — Synthetic call note' });
  assert.deepEqual(task.body.data[0], { Status: 'Completed' });
  assert.deepEqual(call.body.data[0], { Subject: 'Call back after the deck', Call_Type: 'Outbound', Call_Start_Time: '2026-09-29T11:00:00+05:30',
    What_Id: { id: LEAD }, $se_module: 'Leads' });
  assert.ok(!JSON.stringify(r.sink.records()).includes('Synthetic call note'), 'the note never reaches Plane B');
});

test('Undo within ten seconds restores the lead and deletes what the save created; after ten seconds it is refused', async () => {
  now = Date.parse('2026-09-27T15:30:00Z');
  const saved = await rig(ROUTES()).svc.save(principal(), CMD);
  now += 9_000;
  const r = rig({ ...ROUTES(), [`PUT /Leads/${LEAD}`]: 'lead.updated' });
  const undone = await r.svc.undo(principal(), saved.value.undoToken);
  assert.deepEqual(undone, { ok: true, value: { undone: true } });
  assert.deepEqual(r.writes().map((c) => c.key), [`PUT /Leads/${LEAD}`, `DELETE /Calls/${CALL}`, `DELETE /Touches/${TOUCH}`, `PUT /Tasks/${TASK}`]);
  assert.equal(r.writes()[0].headers['If-Unmodified-Since'], '2026-09-27T21:00:00+05:30', 'restored only if nobody changed it since the save');
  assert.deepEqual(r.writes()[0].body.data[0], { Next_Step: 'Send the deck', Next_Step_At: '2026-09-27T18:00:00+05:30', Next_Step_Channel: 'WhatsApp',
    Last_Reply_At: null, First_Touch_At: null });
  assert.deepEqual(r.writes()[3].body.data[0], { Status: 'Not Started' });

  now += 2_000;
  const late = rig(ROUTES());
  const expired = await late.svc.undo(principal(), saved.value.undoToken);
  assert.equal(expired.reasonCode, 'undo-expired');
  assert.equal(late.calls.length, 0);
});

test('a tampered or someone else\'s Undo token is refused before Zoho', async () => {
  now = Date.parse('2026-09-27T15:30:00Z');
  const saved = await rig(ROUTES()).svc.save(principal(), CMD);
  const [body, mac] = saved.value.undoToken.split('.');
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url')), created: [] })).toString('base64url') + '.' + mac;
  const r = rig(ROUTES());
  assert.equal((await r.svc.undo(principal(), forged)).reasonCode, 'undo-invalid');
  assert.equal((await r.svc.undo({ credential, sessionId: 'session_fixture_other_22' }, saved.value.undoToken)).reasonCode, 'undo-invalid');
  assert.equal(r.calls.length, 0);
});

test('a lead changed in Zoho since it was read is refused and nothing is written twice', async () => {
  now = Date.parse('2026-09-27T15:30:00Z');
  let r = rig({ ...ROUTES(), [`PUT /Leads/${LEAD}`]: 'conflict' });
  let res = await r.svc.save(principal(), CMD);
  assert.equal(res.reasonCode, 'lead-changed');
  assert.deepEqual(r.writes().map((c) => c.key), [`PUT /Leads/${LEAD}`], 'the 412 comes before any create');
  r = rig(ROUTES());
  res = await r.svc.save(principal(), { ...CMD, expectedModifiedTime: '2026-09-26T09:00:00+05:30' });
  assert.equal(res.reasonCode, 'lead-changed');
  assert.equal(r.writes().length, 0);
});

test('keep: the existing next step is unchanged', async () => {
  now = Date.parse('2026-09-27T15:30:00Z');
  const r = rig(ROUTES());
  const res = await r.svc.save(principal(), { ...CMD, contact: { ...CMD.contact, channel: 'msg', outcome: 'Sent' }, complete: false, keep: true, next: null });
  assert.equal(res.ok, true);
  assert.equal(res.value.nextId, null);
  assert.deepEqual(r.writes()[0].body.data[0], { Next_Step: 'Send the deck', First_Touch_At: '2026-09-27T20:30:00+05:30' });
  assert.deepEqual(r.writes().map((c) => c.key), [`PUT /Leads/${LEAD}`, 'POST /Touches']);
});

test('the save is refused, with nothing written, when a rule of the flow is broken', async () => {
  now = Date.parse('2026-09-27T15:30:00Z');
  const cases = [
    [{ contact: { ...CMD.contact, occurredAt: '2026-09-27T22:00:00+05:30' } }, 'contact-in-future'],
    [{ contact: { ...CMD.contact, occurredAt: '2026-09-19T10:00:00+05:30' } }, 'contact-before-capture'],
    [{ next: { ...CMD.next, at: '2026-09-27T20:00:00+05:30' } }, 'next-step-in-past'],
    [{ complete: false }, 'choose-complete-or-keep'],
    [{ complete: false, scheduled: null, next: null }, 'next-step-needed'],
    [{ contact: { ...CMD.contact, channel: 'email', outcome: 'Sent' } }, 'no-consent'],
    [{ contact: { ...CMD.contact, outcome: '' } }, 'invalid-request'],
    [{ keep: true }, 'invalid-request'],
  ];
  for (const [patch, code] of cases) {
    const r = rig(ROUTES());
    const res = await r.svc.save(principal(), { ...CMD, ...patch });
    assert.equal(res.reasonCode, code, JSON.stringify(patch));
    assert.equal(r.writes().length, 0);
  }
  let r = rig({ ...ROUTES(), [`GET /Leads/${LEAD}`]: 'lead.guard-other-owner' });
  assert.equal((await r.svc.save(principal(), CMD)).reasonCode, 'not-in-book');
  r = rig({ ...ROUTES(), [`GET /Leads/${LEAD}`]: 'lead.guard-no-call-consent' });
  assert.equal((await r.svc.save(principal(), CMD)).reasonCode, 'no-consent');
  r = rig({ ...ROUTES(), [`GET /Leads/${LEAD}`]: 'lead.guard-no-next' });
  assert.equal((await r.svc.save(principal(), { ...CMD, complete: false, scheduled: null, keep: true, next: null })).reasonCode, 'nothing-to-keep');
  r = rig(ROUTES(), { access: () => null });
  assert.equal((await r.svc.save(principal(), CMD)).reasonCode, 'session-changed');
});

test('a failure after the lead write takes back everything already written', async () => {
  now = Date.parse('2026-09-27T15:30:00Z');
  const r = rig({ ...ROUTES(), 'POST /Calls': 'server-error', [`PUT /Leads/${LEAD}`]: ['lead.updated', 'lead.updated'] });
  const res = await r.svc.save(principal(), CMD);
  assert.equal(res.kind, 'source-error');
  assert.deepEqual(r.writes().map((c) => c.key), [`PUT /Leads/${LEAD}`, 'POST /Touches', `PUT /Tasks/${TASK}`, 'POST /Calls',
    `DELETE /Touches/${TOUCH}`, `PUT /Tasks/${TASK}`, `PUT /Leads/${LEAD}`]);
  assert.equal(r.writes()[6].headers['If-Unmodified-Since'], '2026-09-27T21:00:00+05:30');
});

test('if taking back fails too, the refusal names every record for repair', async () => {
  now = Date.parse('2026-09-27T15:30:00Z');
  const r = rig({ ...ROUTES(), 'POST /Calls': 'server-error', 'DELETE /Touches': 'server-error', [`PUT /Leads/${LEAD}`]: ['lead.updated', 'lead.updated'] });
  const res = await r.svc.save(principal(), CMD);
  assert.equal(res.reasonCode, 'followup-partial');
  const line = r.sink.records().filter((x) => x.kind === 'refusal').pop();
  assert.deepEqual(line.recordIds, [LEAD, TOUCH]);
});

test('if the touch cannot be written, the lead is put back and nothing else is created', async () => {
  now = Date.parse('2026-09-27T15:30:00Z');
  const r = rig({ ...ROUTES(), 'POST /Touches': 'server-error', [`PUT /Leads/${LEAD}`]: ['lead.updated', 'lead.updated'] });
  const res = await r.svc.save(principal(), CMD);
  assert.equal(res.kind, 'source-error');
  assert.deepEqual(r.writes().map((c) => c.key), [`PUT /Leads/${LEAD}`, 'POST /Touches', `PUT /Leads/${LEAD}`]);
});
