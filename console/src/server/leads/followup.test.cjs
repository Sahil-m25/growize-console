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
  'server/leads/journey.ts',
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
const { activityFor, createFollowups, UNDO_WINDOW_MS } = load(path.join('server', 'leads', 'followup.js'));
const { createJourney, doneOf } = load(path.join('server', 'leads', 'journey.js'));

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
      calls.push({ key, search: u.search, headers: init.headers, body: init.body ? JSON.parse(init.body) : null });
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
    Reminder: '15 mins', What_Id: { id: LEAD }, $se_module: 'Leads' });
  assert.ok(!JSON.stringify(r.sink.records()).includes('Synthetic call note'), 'the note never reaches Plane B');
});

test('M12-S11-NOTE-5: the guard read never asks Zoho for Consent_Visit (the org has none), and a visit next step needs no consent flag', async () => {
  now = Date.parse('2026-09-27T15:30:00Z');
  const r = rig({ ...ROUTES(), 'POST /Tasks': 'call.created' });
  const res = await r.svc.save(principal(), { ...CMD, next: { text: 'Book a farm visit', at: '2026-09-29T11:00:00+05:30', channel: 'visit' } });
  assert.equal(res.ok, true, JSON.stringify(res));
  const reads = r.calls.filter((c) => c.key.startsWith('GET /Leads/'));
  assert.ok(reads.length >= 1);
  for (const c of reads) assert.ok(!decodeURIComponent(c.search).includes('Consent_Visit'), c.search);
  assert.ok(decodeURIComponent(reads[0].search).includes('Consent_Call'));
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
    Last_Reply_At: null, First_Touch_At: null, Lost_At: null, Lost_Reason: null });
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

test('D58: call backs and onboarding calls are Calls, office meetings and farm visits Meetings, the rest Tasks on the day', () => {
  const at = '2026-09-29T15:00:00+05:30';
  assert.equal(activityFor({ text: 'Call back', at }, LEAD).module, 'Calls');
  assert.equal(activityFor({ text: 'Onboarding call — app access', at }, LEAD).row.Reminder, '15 mins');
  const visit = activityFor({ text: 'Farm visit', at }, LEAD);
  assert.equal(visit.module, 'Events');
  assert.deepEqual(visit.row.Participants, [{ type: 'lead', participant: LEAD }]);
  assert.equal(visit.row.End_DateTime, '2026-09-29T16:00:00+05:30');
  assert.equal(activityFor({ text: 'Office meeting', at }, LEAD).module, 'Events');
  const task = activityFor({ text: 'Send the yield note', at: '2026-09-29T23:59:00+05:30' }, LEAD);
  assert.deepEqual(task, { module: 'Tasks', row: { Subject: 'Send the yield note', Due_Date: '2026-09-29', Status: 'Not Started', What_Id: { id: LEAD }, $se_module: 'Leads' } });
  assert.equal(activityFor({ text: 'Book a farm visit', at }, LEAD).module, 'Tasks', 'booking a visit is a task; the visit itself is the meeting');
});

// ---------------- M07-S06 close as lost, undo, re-open ----------------

const LOSS = Object.freeze({ ...CMD, contact: { ...CMD.contact, outcome: 'Not interested' }, next: null, lost: { reason: 'Timing — not now' } });

test('the contact and the loss are recorded in one save, the next step cleared, and Undo covers both', async () => {
  now = Date.parse('2026-09-27T15:30:00Z');
  const r = rig(ROUTES());
  const res = await r.svc.save(principal(), LOSS);
  assert.equal(res.ok, true);
  assert.deepEqual(r.writes().map((c) => c.key), [`PUT /Leads/${LEAD}`, 'POST /Touches', `PUT /Tasks/${TASK}`]);
  assert.deepEqual(r.writes()[0].body.data[0], { Next_Step: null, Next_Step_At: null, Next_Step_Channel: null,
    Lost_At: '2026-09-27T21:00:00+05:30', Lost_Reason: 'Timing - not now', First_Touch_At: '2026-09-27T20:30:00+05:30' });
  assert.ok(!('Lead_Status' in r.writes()[0].body.data[0]), 'the blueprint owns Lead_Status');
  const u = rig(ROUTES());
  assert.equal((await u.svc.undo(principal(), res.value.undoToken)).ok, true);
  assert.deepEqual(u.writes()[0].body.data[0].Lost_At, null);
  assert.equal(u.writes()[0].body.data[0].Next_Step, 'Send the deck', 'the next step the loss cleared comes back with Undo');
});

test('loss is offered only after Not interested / Wrong number, with one of the eight reasons, and never once money is in', async () => {
  now = Date.parse('2026-09-27T15:30:00Z');
  let r = rig(ROUTES());
  assert.equal((await r.svc.save(principal(), { ...LOSS, contact: { ...LOSS.contact, outcome: 'Spoke' } })).reasonCode, 'loss-not-offered');
  assert.equal((await r.svc.save(principal(), { ...LOSS, lost: { reason: 'Rude' } })).reasonCode, 'loss-not-offered');
  r = rig({ ...ROUTES(), [`GET /Leads/${LEAD}`]: 'lead.guard-paid' });
  assert.equal((await r.svc.save(principal(), LOSS)).reasonCode, 'money-in');
  assert.equal(r.writes().length, 0);
});

test('a lost lead takes no contact; Re-open clears the loss with a guarded write and brings back a future next step', async () => {
  now = Date.parse('2026-09-27T15:30:00Z');
  let r = rig({ ...ROUTES(), [`GET /Leads/${LEAD}`]: 'lead.guard-lost' });
  assert.equal((await r.svc.save(principal(), CMD)).reasonCode, 'lead-lost');
  r = rig({ ...ROUTES(), [`GET /Leads/${LEAD}`]: 'lead.guard-lost' });
  const res = await r.svc.reopen(principal(), LEAD, LOADED, { text: 'Call back', at: '2026-09-30T10:00:00+05:30', channel: 'call' });
  assert.equal(res.ok, true);
  assert.equal(r.writes()[0].headers['If-Unmodified-Since'], LOADED);
  assert.deepEqual(r.writes()[0].body.data[0], { Lost_At: null, Lost_Reason: null, Next_Step: 'Call back', Next_Step_At: '2026-09-30T10:00:00+05:30', Next_Step_Channel: 'Call' });
  r = rig(ROUTES());
  assert.equal((await r.svc.reopen(principal(), LEAD, LOADED, null)).reasonCode, 'not-lost');
  r = rig({ ...ROUTES(), [`GET /Leads/${LEAD}`]: 'lead.guard-lost' });
  assert.equal((await r.svc.reopen(principal(), LEAD, LOADED, { text: 'Call back', at: '2026-09-20T10:00:00+05:30', channel: 'call' })).reasonCode, 'next-step-in-past');
  assert.equal(r.writes().length, 0);
});

// ---------------- M05-S04 reschedule ----------------

test('Reschedule → Tomorrow moves the lead\'s step and the Call keeping the time; Undo puts both back', async () => {
  now = Date.parse('2026-09-27T09:00:00Z');
  const routes = { ...ROUTES(), [`GET /Calls/${CALL}`]: 'call.scheduled', [`PUT /Calls/${CALL}`]: 'call.updated' };
  const r = rig(routes);
  const res = await r.svc.reschedule(principal(), LEAD, LOADED, { module: 'Calls', id: CALL }, 1);
  assert.equal(res.ok, true);
  assert.equal(res.value.nextStepAt, '2026-09-28T18:00:00+05:30');
  assert.deepEqual(r.writes().map((c) => [c.key, c.body.data[0]]), [
    [`PUT /Leads/${LEAD}`, { Next_Step_At: '2026-09-28T18:00:00+05:30' }],
    [`PUT /Calls/${CALL}`, { Call_Start_Time: '2026-09-28T16:30:00+05:30' }],
  ]);
  assert.equal(r.writes()[0].headers['If-Unmodified-Since'], LOADED);
  const u = rig(routes);
  assert.equal((await u.svc.undo(principal(), res.value.undoToken)).ok, true);
  assert.deepEqual(u.writes().map((c) => c.key), [`PUT /Leads/${LEAD}`, `PUT /Calls/${CALL}`]);
  assert.equal(u.writes()[0].body.data[0].Next_Step_At, '2026-09-27T18:00:00+05:30');
  assert.deepEqual(u.writes()[1].body.data[0], { Call_Start_Time: '2026-09-27T16:30:00+05:30' });
});

test('a task\'s due date moves by whole days; nothing dated means nothing to move', async () => {
  now = Date.parse('2026-09-27T09:00:00Z');
  const task = { ...ROUTES(), [`GET /Tasks/${TASK}`]: 'task.scheduled' };
  let r = rig({ ...task, [`GET /Tasks/${TASK}`]: 'task.due' });
  let res = await r.svc.reschedule(principal(), LEAD, LOADED, { module: 'Tasks', id: TASK }, 2);
  assert.equal(res.ok, true);
  assert.deepEqual(r.writes()[1].body.data[0], { Due_Date: '2026-09-29' });
  r = rig({ ...ROUTES(), [`GET /Leads/${LEAD}`]: 'lead.guard-no-next' });
  res = await r.svc.reschedule(principal(), LEAD, LOADED, null, 1);
  assert.equal(res.reasonCode, 'nothing-to-reschedule');
  assert.equal(r.writes().length, 0);
});

// ---------------- M08-S01 journey ----------------

function journeyRig(get, put = 'lead.updated', gates) {
  const r = rig({ [`GET /Leads/${LEAD}`]: get, [`PUT /Leads/${LEAD}`]: put });
  const access = { async recheck(c) { return { actor: { userId: c.userId, roleId: `${P}740998001`, profileId: `${P}740998002`, seat: 'investor-relations' }, mayRecordFollowup: true, teamOwnerIds: [] }; } };
  const crm = createZohoClient({ recordIdPrefix: P, gate: immediateGate(), log: createOpsLog(r.sink), maxAttempts: 1, clock: () => now,
    fetch: async (url, init) => { const u = new URL(url); const key = `${init.method} ${u.pathname.replace('/crm/v8', '')}`;
      r.calls.push({ key, headers: init.headers, body: init.body ? JSON.parse(init.body) : null });
      return toResponse(recorded(init.method === 'GET' ? get : put)); } });
  return { j: createJourney({ crm, access, log: createOpsLog(r.sink), recordIdPrefix: P, clock: () => now, gates }), ...r };
}

test('the next rung is read from the lead\'s own stamps; a gap is refused', () => {
  const lead = (n) => recorded(n).body.data[0];
  assert.equal(doneOf(lead('journey.at1')), 1);
  assert.equal(doneOf(lead('journey.at3')), 3);
  assert.equal(doneOf(lead('journey.gap')), null);
});

test('Mark done advances one rung with a guarded write; first touch comes only from a follow-up', async () => {
  now = Date.parse('2026-09-27T09:00:00Z');
  let r = journeyRig('journey.at3');
  let res = await r.j.tick(principal(), LEAD, LOADED);
  assert.deepEqual(res.value.rung, 4);
  assert.deepEqual(r.writes()[0].body.data[0], { Engaged_At: '2026-09-27T14:30:00+05:30' });
  assert.equal(r.writes()[0].headers['If-Unmodified-Since'], LOADED);
  r = journeyRig('journey.at1');
  assert.equal((await r.j.tick(principal(), LEAD, LOADED)).reasonCode, 'first-touch-by-followup');
  assert.equal(r.writes().length, 0);
});

test('Qualified needs a dated next step and the stated scorecard; nothing is ticked before', async () => {
  now = Date.parse('2026-09-27T09:00:00Z');
  let r = journeyRig('journey.at2');
  assert.equal((await r.j.tick(principal(), LEAD, LOADED)).reasonCode, 'scorecard-needed');
  assert.equal((await journeyRig('journey.at2-no-next').j.tick(principal(), LEAD, LOADED, true)).reasonCode, 'next-step-needed');
  assert.equal(r.writes().length, 0);
  r = journeyRig('journey.at2');
  assert.equal((await r.j.tick(principal(), LEAD, LOADED, true)).value.rung, 3);
});

test('gated rungs open only on Finance\'s fact, and need a unit intent', async () => {
  now = Date.parse('2026-09-27T09:00:00Z');
  let r = journeyRig('journey.at5');
  assert.equal((await r.j.tick(principal(), LEAD, LOADED)).reasonCode, 'gate-shut', 'no gate reader: shut');
  r = journeyRig('journey.at5', 'lead.updated', { async met(c, id, g) { return g === 'advance'; } });
  assert.equal((await r.j.tick(principal(), LEAD, LOADED)).value.rung, 6);
  assert.equal((await journeyRig('journey.at5-no-units', 'lead.updated', { async met() { return true; } }).j.tick(principal(), LEAD, LOADED)).reasonCode, 'units-needed');
});

test('Undo: one rung back inside 8 hours with a reason; refused when older, twice, or over a payment', async () => {
  now = Date.parse('2026-09-27T09:00:00Z'); // 14:30 IST, 2.5 h after the 12:00 stamps
  let r = journeyRig('journey.at3');
  assert.equal((await r.j.untick(principal(), LEAD, LOADED, 'because')).reasonCode, 'reason-needed');
  const res = await r.j.untick(principal(), LEAD, LOADED, 'Ticked the wrong rung');
  assert.equal(res.value.rung, 2);
  assert.deepEqual(r.writes()[0].body.data[0], { Qualified_At: null, Rung_Undone_At: '2026-09-27T14:30:00+05:30' });
  assert.equal((await journeyRig('journey.at3-old').j.untick(principal(), LEAD, LOADED, 'Ticked the wrong rung')).reasonCode, 'undo-window-closed');
  assert.equal((await journeyRig('journey.at3-undone').j.untick(principal(), LEAD, LOADED, 'Ticked the wrong rung')).reasonCode, 'already-undone');
  assert.equal((await journeyRig('journey.at6').j.untick(principal(), LEAD, LOADED, 'Ticked the wrong rung')).reasonCode, 'payment-stands');
});

test('skip is only for Engagement when it is next, and marks the skip', async () => {
  now = Date.parse('2026-09-27T09:00:00Z');
  let r = journeyRig('journey.at3');
  assert.equal((await r.j.skip(principal(), LEAD, LOADED)).value.rung, 4);
  assert.deepEqual(r.writes()[0].body.data[0], { Engaged_At: '2026-09-27T14:30:00+05:30', Engagement_Skipped: true });
  r = journeyRig('journey.at2');
  assert.equal((await r.j.skip(principal(), LEAD, LOADED)).reasonCode, 'not-skippable');
});

// ---------------- C1: set the next step, close as lost, pull-in, complete without an activity id ----------------

const NEXT = Object.freeze({ leadId: LEAD, expectedModifiedTime: LOADED,
  next: { text: 'Call back after the deck', at: '2026-09-29T11:00:00+05:30', channel: 'call' }, scheduled: { module: 'Tasks', id: TASK } });
const noDelete = (r) => assert.ok(!r.calls.some((c) => c.key.startsWith('DELETE')), 'a human token holds no Delete: nothing is deleted');

test('C1 setNext: the lead is written first (guarded), the open Task is deferred, then the D58 activity; nothing is deleted', async () => {
  now = Date.parse('2026-09-27T15:30:00Z');
  const r = rig(ROUTES());
  const res = await r.svc.setNext(principal(), NEXT);
  assert.equal(res.ok, true);
  assert.equal(res.value.nextId, CALL);
  assert.deepEqual(r.writes().map((c) => c.key), [`PUT /Leads/${LEAD}`, `PUT /Tasks/${TASK}`, 'POST /Calls']);
  const [lead, task, call] = r.writes();
  assert.equal(lead.headers['If-Unmodified-Since'], LOADED);
  assert.deepEqual(lead.body.data[0], { Next_Step: 'Call back after the deck', Next_Step_At: '2026-09-29T11:00:00+05:30', Next_Step_Channel: 'Call' });
  assert.deepEqual(task.body.data[0], { Status: 'Deferred' });
  assert.equal(call.body.data[0].Call_Start_Time, '2026-09-29T11:00:00+05:30');
  noDelete(r);
  // no open activity known (the book carries no id): only the Lead and the new activity are written
  const r2 = rig(ROUTES());
  assert.equal((await r2.svc.setNext(principal(), { ...NEXT, scheduled: null })).ok, true);
  assert.deepEqual(r2.writes().map((c) => c.key), [`PUT /Leads/${LEAD}`, 'POST /Calls']);
});

test('C1 setNext: refused with nothing written when the step is past, has no consent, the lead is lost, changed or not yours', async () => {
  now = Date.parse('2026-09-27T15:30:00Z');
  const cases = [
    [{ next: { ...NEXT.next, at: '2026-09-27T20:00:00+05:30' } }, null, 'next-step-in-past'],
    [{ next: { ...NEXT.next, text: '  ' } }, null, 'invalid-request'],
    [{ next: { ...NEXT.next, channel: 'email' } }, null, 'no-consent'],
    [{ expectedModifiedTime: '2026-09-27T08:00:00+05:30' }, null, 'lead-changed'],
    [{}, 'lead.guard-lost', 'lead-lost'],
    [{}, 'lead.guard-other-owner', 'not-in-book'],
  ];
  for (const [patch, get, code] of cases) {
    const r = rig(get ? { ...ROUTES(), [`GET /Leads/${LEAD}`]: get } : ROUTES());
    const res = await r.svc.setNext(principal(), { ...NEXT, ...patch });
    assert.equal(res.reasonCode, code, code);
    assert.equal(r.writes().length, 0, code);
  }
  const r = rig({ ...ROUTES(), [`PUT /Leads/${LEAD}`]: 'conflict' });
  assert.equal((await r.svc.setNext(principal(), NEXT)).reasonCode, 'lead-changed');
  assert.equal(r.writes().length, 1);
});

test('C1 setNext: when the activity cannot be written the Lead and the Task are written back as they were, never deleted', async () => {
  now = Date.parse('2026-09-27T15:30:00Z');
  const r = rig({ ...ROUTES(), 'POST /Calls': 'server-error' });
  const res = await r.svc.setNext(principal(), NEXT);
  assert.equal(res.ok, false);
  assert.deepEqual(r.writes().map((c) => c.key), [`PUT /Leads/${LEAD}`, `PUT /Tasks/${TASK}`, 'POST /Calls', `PUT /Tasks/${TASK}`, `PUT /Leads/${LEAD}`]);
  assert.deepEqual(r.writes()[3].body.data[0], { Status: 'Not Started' });
  assert.equal(r.writes()[4].body.data[0].Next_Step, 'Send the deck');
  noDelete(r);
});

const CLOSE = Object.freeze({ leadId: LEAD, expectedModifiedTime: LOADED, reason: 'Timing — not now', note: 'Said call in January' });

test('C1 close: Lost_At and Lost_Reason, Next_Step cleared, the note to Notes on the Lead; refused once money is in', async () => {
  now = Date.parse('2026-09-27T15:30:00Z');
  const r = rig({ ...ROUTES(), 'POST /Notes': 'touch.created' });
  const res = await r.svc.close(principal(), CLOSE);
  assert.equal(res.ok, true);
  assert.deepEqual(r.writes().map((c) => c.key), [`PUT /Leads/${LEAD}`, 'POST /Notes']);
  assert.equal(r.writes()[0].headers['If-Unmodified-Since'], LOADED);
  assert.deepEqual(r.writes()[0].body.data[0], { Next_Step: null, Next_Step_At: null, Next_Step_Channel: null,
    Lost_At: '2026-09-27T21:00:00+05:30', Lost_Reason: 'Timing - not now' });
  assert.deepEqual(r.writes()[1].body.data[0], { Note_Title: 'Closed as lost — Timing — not now', Note_Content: 'Said call in January',
    Parent_Id: { module: { api_name: 'Leads' }, id: LEAD } });
  noDelete(r);
  // no note, no Notes row
  const bare = rig(ROUTES());
  assert.equal((await bare.svc.close(principal(), { ...CLOSE, note: '' })).value.noteId, null);
  assert.deepEqual(bare.writes().map((c) => c.key), [`PUT /Leads/${LEAD}`]);
  const refusals = [
    [{}, 'lead.guard-paid', 'money-in'], [{}, 'lead.guard-lost', 'lead-lost'], [{}, 'lead.guard-other-owner', 'not-in-book'],
    [{ reason: 'Rude' }, null, 'loss-not-offered'], [{ reason: 'toString' }, null, 'loss-not-offered'],
    [{ expectedModifiedTime: '2026-09-27T08:00:00+05:30' }, null, 'lead-changed'],
  ];
  for (const [patch, get, code] of refusals) {
    const x = rig(get ? { ...ROUTES(), [`GET /Leads/${LEAD}`]: get } : ROUTES());
    assert.equal((await x.svc.close(principal(), { ...CLOSE, ...patch })).reasonCode, code, code);
    assert.equal(x.writes().length, 0, code);
  }
});

test('C1 close: if the note cannot be written the lead is put back (an update), never deleted', async () => {
  now = Date.parse('2026-09-27T15:30:00Z');
  const r = rig({ ...ROUTES(), 'POST /Notes': 'server-error' });
  assert.equal((await r.svc.close(principal(), CLOSE)).ok, false);
  assert.deepEqual(r.writes().map((c) => c.key), [`PUT /Leads/${LEAD}`, 'POST /Notes', `PUT /Leads/${LEAD}`]);
  assert.equal(r.writes()[2].body.data[0].Lost_At, null);
  assert.equal(r.writes()[2].body.data[0].Next_Step, 'Send the deck');
  noDelete(r);
});

test('C1 pull-in: a negative shift moves the step earlier, to no day that has gone; zero is not a move', async () => {
  now = Date.parse('2026-09-25T09:00:00Z'); // 25 Sep IST; the lead's step is 27 Sep 18:00
  let r = rig(ROUTES());
  const res = await r.svc.reschedule(principal(), LEAD, LOADED, null, -1);
  assert.equal(res.ok, true);
  assert.equal(res.value.nextStepAt, '2026-09-26T18:00:00+05:30');
  assert.deepEqual(r.writes().map((c) => [c.key, c.body.data[0]]), [[`PUT /Leads/${LEAD}`, { Next_Step_At: '2026-09-26T18:00:00+05:30' }]]);
  r = rig(ROUTES());
  assert.equal((await r.svc.reschedule(principal(), LEAD, LOADED, null, -3)).reasonCode, 'next-step-in-past');
  assert.equal(r.writes().length, 0);
  for (const days of [0, -367, 367, 1.5]) assert.equal((await rig(ROUTES()).svc.reschedule(principal(), LEAD, LOADED, null, days)).reasonCode, 'invalid-request', String(days));
});

test('C1 save: completing the scheduled step with no activity id known clears the lead\'s step and closes no activity', async () => {
  now = Date.parse('2026-09-27T15:30:00Z');
  const r = rig(ROUTES());
  const res = await r.svc.save(principal(), { ...CMD, scheduled: null });
  assert.equal(res.ok, true);
  assert.deepEqual(r.writes().map((c) => c.key), [`PUT /Leads/${LEAD}`, 'POST /Touches', 'POST /Calls']);
  const lone = rig({ ...ROUTES(), [`GET /Leads/${LEAD}`]: 'lead.guard-no-next' });
  const done = await lone.svc.save(principal(), { ...CMD, scheduled: null, next: null, complete: true });
  assert.equal(done.reasonCode, 'next-step-needed', 'an active lead still needs a dated next step');
});
