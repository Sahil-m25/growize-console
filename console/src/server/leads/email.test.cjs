/* M07-S05-T02 EMAIL SEND THROUGH ZOHO send_mail
 *
 * Run from console/: node --test src/server/leads/email.test.cjs
 *
 * Compiles the sender, the follow-up writer and the real Zoho client with the project's TypeScript,
 * then drives Send against synthetic recorded responses only (__fixtures__/email). No request reaches
 * Zoho. Whether live send_mail takes this body and files it on the Lead's Emails list is TC-E07-024 (sandbox).
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { before, test } = require('node:test');

const consoleRoot = path.resolve(__dirname, '..', '..', '..');
const srcRoot = path.join(consoleRoot, 'src');
const fixtureRoot = path.join(srcRoot, 'lib', 'zoho', '__fixtures__', 'email');
const ts = require(path.join(consoleRoot, 'node_modules', 'typescript'));
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoho-email-'));
process.on('exit', () => fs.rmSync(outDir, { recursive: true, force: true }));

const config = ts.readConfigFile(path.join(consoleRoot, 'tsconfig.json'), ts.sys.readFile);
const project = ts.parseJsonConfigFileContent(config.config, ts.sys, consoleRoot);
const options = { ...project.options, incremental: false, tsBuildInfoFile: undefined, plugins: undefined,
  module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10, noEmit: false, noEmitOnError: true, outDir, rootDir: srcRoot };
const sources = ['lib/zoho/errors.ts', 'lib/zoho/gate.ts', 'lib/zoho/log.ts', 'lib/zoho/client.ts', 'server/oauth/seat.ts', 'domain/plan.ts',
  'server/leads/capture.ts', 'server/leads/followup.ts', 'server/leads/email.ts'].map((f) => path.join(srcRoot, f));
const program = ts.createProgram(sources, options);
const diags = [...ts.getPreEmitDiagnostics(program), ...program.emit().diagnostics];
if (diags.length) {
  console.error(ts.formatDiagnostics(diags, { getCanonicalFileName: (f) => f, getCurrentDirectory: () => consoleRoot, getNewLine: () => '\n' }));
  process.exit(1);
}
const load = (file) => require(path.join(outDir, file));
const { createMemorySink, createOpsLog } = load('lib/zoho/log.js');
const { createZohoClient, userCredential } = load('lib/zoho/client.js');
const { createFollowups } = load('server/leads/followup.js');
const { createEmailSender, createDeckMailer, EMAIL_REASON, EMAIL_MAX_SUBJECT, EMAIL_MAX_MESSAGE } = load('server/leads/email.js');

const P = '9007199254';
const IR = `${P}740995001`;
const LEAD = `${P}740996101`;
const TASK = `${P}740997601`;
const SESSION = 'session_fixture_email_0001';
const SECRET = 'synthetic-undo-secret-never-live-0000000001';
const LOADED = '2026-09-27T09:00:00+05:30';
const TOKEN = 'synthetic-ir-token-never-live';
const SUBJECT = 'Growize — managed aeroponic farm units';
const MESSAGE = 'Dear Synthetic,\n\nA synthetic message body that must never reach a log.\n\nRegards';
const LEAD_EMAIL = 'synthetic.lead@example.com';
const FROM = 'synthetic.ir@agresearchlabs.com';
const now = Date.parse('2026-09-28T05:30:00Z'); // 11:00 IST

const recorded = (name) => JSON.parse(fs.readFileSync(path.join(fixtureRoot, `${name}.response.json`), 'utf8'));
const toResponse = (r) => new Response(r.status === 204 ? null : JSON.stringify(r.body), { status: r.status, headers: r.headers || {} });
const immediateGate = () => ({ async acquire() { return { waitedMs: 0, release() {} }; } });
let credential;
before(async () => {
  credential = await userCredential({ access_token: TOKEN, api_domain: 'https://www.zohoapis.in', expires_in: 3_600 },
    { recordIdPrefix: P, gate: immediateGate(), log: createOpsLog(createMemorySink()), clock: () => now,
      fetch: async () => toResponse({ status: 200, body: { users: [{ id: IR, status: 'active' }] } }) });
});
const principal = () => ({ credential, sessionId: SESSION });

const ROUTES = () => ({
  [`GET /Leads/${LEAD}`]: 'lead.guard',
  'GET /settings/emails/actions/from_addresses': 'from-addresses',
  [`POST /Leads/${LEAD}/actions/send_mail`]: 'send.ok',
  [`PUT /Leads/${LEAD}`]: 'lead.updated',
  'POST /Touches': 'touch.created',
  'POST /Tasks': 'task.created',
  [`GET /Tasks/${TASK}`]: 'task.scheduled',
  [`PUT /Tasks/${TASK}`]: 'task.updated',
});

function rig(overrides = {}, opts = {}) {
  const routes = { ...ROUTES(), ...overrides };
  const calls = [];
  const sink = createMemorySink();
  const log = createOpsLog(sink);
  const crm = createZohoClient({ recordIdPrefix: P, gate: immediateGate(), log, maxAttempts: opts.maxAttempts ?? 1, clock: () => now,
    sleep: async () => {}, fetch: async (url, init) => {
      const u = new URL(url);
      const key = `${init.method} ${u.pathname.replace('/crm/v8', '')}`;
      calls.push({ key, headers: init.headers, body: init.body ? JSON.parse(init.body) : null });
      if (opts.gateOn && key.includes('send_mail')) await opts.gateOn;
      let name = routes[key];
      if (Array.isArray(name)) name = name.shift();
      if (!name) throw new Error(`unexpected synthetic CRM request ${key}`);
      return toResponse(recorded(name));
    } });
  const access = { async recheck(c) { return opts.access ? opts.access(c) :
    { actor: { userId: c.userId, roleId: `${P}740998001`, profileId: `${P}740998002`, seat: 'investor-relations' }, mayRecordFollowup: true, teamOwnerIds: [] }; } };
  const followups = opts.followups ?? createFollowups({ crm, access, log, recordIdPrefix: P, undoSecret: SECRET, clock: () => now });
  const svc = createEmailSender({ crm, followups, access, log, recordIdPrefix: P, orgDomains: ['agresearchlabs.com'], nda: opts.nda ?? null, deck: createDeckMailer(crm, opts.deckFileId), clock: () => now });
  return { svc, calls, sink,
    sends: () => calls.filter((c) => c.key.endsWith('/actions/send_mail')),
    writes: () => calls.filter((c) => c.key.startsWith('PUT') || c.key.startsWith('DELETE') || (c.key.startsWith('POST') && !c.key.endsWith('send_mail'))) };
}
const CMD = Object.freeze({ leadId: LEAD, expectedModifiedTime: LOADED, template: 'intro', subject: SUBJECT, message: MESSAGE, to: LEAD_EMAIL });
const noSecrets = (sink) => {
  const text = JSON.stringify(sink.records());
  for (const s of [SUBJECT, 'synthetic message body', LEAD_EMAIL, FROM, 'Synthetic Lead', 'Synthetic IR', TOKEN]) {
    assert.ok(!text.includes(s), `Plane B must not carry ${s}`);
  }
};

test('Send goes to send_mail on the lead with the IR\'s own token, from their org address, to the lead only; then exactly one touch', async () => {
  const r = rig();
  const res = await r.svc.send(principal(), CMD);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.deepEqual({ ...res.value }, { sent: true, messageId: 'synthetic-message-id-0001', from: FROM, touchRecorded: true,
    touchId: `${P}740997701`, notice: 'Email sent' });
  const keys = r.calls.map((c) => c.key);
  assert.ok(keys.indexOf('GET /settings/emails/actions/from_addresses') < keys.indexOf(`POST /Leads/${LEAD}/actions/send_mail`));
  assert.equal(r.sends().length, 1);
  const [send] = r.sends();
  assert.equal(send.headers.Authorization, `Zoho-oauthtoken ${TOKEN}`);
  assert.deepEqual(send.body, { data: [{ from: { user_name: 'Synthetic IR', email: FROM }, to: [{ user_name: 'Synthetic Lead', email: LEAD_EMAIL }],
    subject: SUBJECT, content: MESSAGE, mail_format: 'text', consent_email: false }] });
  assert.ok(keys.indexOf(`POST /Leads/${LEAD}/actions/send_mail`) < keys.indexOf('POST /Touches'), 'the touch is recorded after Zoho accepts');
  // The planned step is a WhatsApp one, so it is kept: the lead write, then one touch, nothing else.
  assert.deepEqual(r.writes().map((c) => c.key), [`PUT /Leads/${LEAD}`, 'POST /Touches']);
  const touch = r.writes()[1].body.data[0];
  assert.equal(touch.Channel, 'Email');
  assert.equal(touch.Note, `Email approved and sent — From ${FROM} via Zoho · “${SUBJECT}”`);
  assert.equal(touch.Occurred_At, '2026-09-28T11:00:00+05:30');
  noSecrets(r.sink);
});

test('when the email was the planned step, the scheduled task is completed and a nurture step is set in 3 days', async () => {
  const r = rig({ [`GET /Leads/${LEAD}`]: 'lead.guard-email-step' });
  const res = await r.svc.send(principal(), { ...CMD, scheduled: { module: 'Tasks', id: TASK } });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.deepEqual(r.writes().map((c) => c.key), [`PUT /Leads/${LEAD}`, `PUT /Tasks/${TASK}`, 'POST /Tasks', 'POST /Touches']);
  assert.equal(r.writes().filter((c) => c.key === 'POST /Touches').length, 1);
  assert.equal(r.writes()[2].body.data[0].Subject, 'Nurture — check back');
  assert.equal(r.writes()[2].body.data[0].Due_Date, '2026-10-01');
});

test('Zoho refusing the mail means Not sent and no touch', async () => {
  for (const [fixture, code] of [['send.refused', 'not-sent'], ['send.limit', 'daily-limit'], ['send.opted-out', 'zoho-consent']]) {
    const r = rig({ [`POST /Leads/${LEAD}/actions/send_mail`]: fixture });
    const res = await r.svc.send(principal(), CMD);
    assert.equal(res.ok, false);
    assert.equal(res.reasonCode, code);
    assert.match(res.reason, /^Not sent/);
    assert.equal(r.sends().length, 1);
    assert.deepEqual(r.writes(), [], 'no touch, no lead write');
    noSecrets(r.sink);
  }
});

test('a 5xx on send is never retried and is reported as unconfirmed, with no touch', async () => {
  const r = rig({ [`POST /Leads/${LEAD}/actions/send_mail`]: ['server-error', 'send.ok'] }, { maxAttempts: 4 });
  const res = await r.svc.send(principal(), CMD);
  assert.equal(res.reasonCode, 'send-unconfirmed');
  assert.equal(r.sends().length, 1);
  assert.deepEqual(r.writes(), []);
});

test('TC-E07-022: a seat that cannot work the lead sends nothing and is told why', async () => {
  const other = rig({ [`GET /Leads/${LEAD}`]: 'lead.guard-other-owner' });
  const res = await other.svc.send(principal(), CMD);
  assert.equal(res.reasonCode, 'not-in-book');
  assert.match(res.reason, /not the owner, and no active cover/);
  assert.equal(other.sends().length, 0);
  assert.deepEqual(other.writes(), []);

  const viewer = rig({}, { access: (c) => ({ actor: { userId: c.userId, roleId: '', profileId: '', seat: 'digital-infrastructure' }, mayRecordFollowup: false, teamOwnerIds: [] }) });
  const v = await viewer.svc.send(principal(), CMD);
  assert.equal(v.reasonCode, 'capability-missing');
  assert.equal(viewer.calls.length, 0);

  const gone = rig({}, { access: () => null });
  assert.equal((await gone.svc.send(principal(), CMD)).reasonCode, 'session-changed');
  assert.equal(gone.calls.length, 0);
});

test('no email permission, opted out, lost, changed lead or a different recipient: nothing is sent', async () => {
  for (const [fixture, cmd, code] of [
    ['lead.guard-no-consent', CMD, 'no-consent'],
    ['lead.guard-opted-out', CMD, 'no-consent'],
    ['lead.guard-lost', CMD, 'lead-lost'],
    ['lead.guard', { ...CMD, expectedModifiedTime: '2026-09-27T08:00:00+05:30' }, 'lead-changed'],
    ['lead.guard', { ...CMD, to: 'someone.else@example.com' }, 'recipient-changed'],
  ]) {
    const r = rig({ [`GET /Leads/${LEAD}`]: fixture });
    const res = await r.svc.send(principal(), cmd);
    assert.equal(res.reasonCode, code, fixture);
    assert.equal(r.sends().length, 0);
    assert.deepEqual(r.writes(), []);
  }
});

test('input limits: empty, too long, header injection, unknown template or malformed activity never reach Zoho', async () => {
  const cases = [
    [{ ...CMD, subject: '   ' }, 'empty'],
    [{ ...CMD, message: '' }, 'empty'],
    [{ ...CMD, subject: 'x'.repeat(EMAIL_MAX_SUBJECT + 1) }, 'too-long'],
    [{ ...CMD, message: 'x'.repeat(EMAIL_MAX_MESSAGE + 1) }, 'too-long'],
    [{ ...CMD, subject: 'Hi\r\nBcc: someone@example.com' }, 'invalid-request'],
    [{ ...CMD, template: 'custom' }, 'unknown-template'],
    [{ ...CMD, template: '__proto__' }, 'unknown-template'],
    [{ ...CMD, leadId: '123' }, 'invalid-request'],
    [{ ...CMD, expectedModifiedTime: 'yesterday' }, 'invalid-request'],
    [{ ...CMD, to: 42 }, 'invalid-request'],
    [{ ...CMD, scheduled: { module: 'Deals', id: TASK } }, 'invalid-request'],
  ];
  for (const [cmd, code] of cases) {
    const r = rig();
    const res = await r.svc.send(principal(), cmd);
    assert.equal(res.reasonCode, code, JSON.stringify(cmd).slice(0, 80));
    assert.equal(r.calls.length, 0);
    noSecrets(r.sink);
  }
  const r = rig();
  assert.equal((await r.svc.send(principal(), { ...CMD, subject: '' })).reason, 'Add a subject and a message.');
});

test('deck and webinar are refused before the NDA is back, and sent once it is', async () => {
  for (const template of ['deck', 'webinar']) {
    const shut = rig();
    const res = await shut.svc.send(principal(), { ...CMD, template });
    assert.equal(res.reasonCode, 'nda-not-back');
    assert.equal(res.reason, EMAIL_REASON['nda-not-back']);
    assert.equal(shut.sends().length, 0);
  }
  const open = rig({}, { nda: { async signed(c, id) { return id === LEAD; } } });
  assert.equal((await open.svc.send(principal(), { ...CMD, template: 'webinar' })).ok, true);
  assert.equal(open.sends().length, 1);
  // M12-S13: the deck goes only with the deck attached — no deck mailer wired, so it is refused, never sent bare
  const noDeck = rig({}, { nda: { async signed(c, id) { return id === LEAD; } } });
  assert.equal((await noDeck.svc.send(principal(), { ...CMD, template: 'deck' })).reasonCode, 'deck-not-ready');
  assert.equal(noDeck.sends().length, 0);
});

const DECK_FILE = 'synthetic-deck-file-id-0001';
const SIGNED = { async signed(c, id) { return id === LEAD; } };

test('M12-S13 deck follow-up attaches the configured deck file by id, only once the NDA is back; no id configured keeps deck-not-ready', async () => {
  const open = rig({}, { nda: SIGNED, deckFileId: DECK_FILE });
  const res = await open.svc.send(principal(), { ...CMD, template: 'deck' });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(open.sends().length, 1);
  assert.deepEqual(open.sends()[0].body.data[0].attachments, [{ id: DECK_FILE }]);
  // other templates never carry the deck
  const intro = rig({}, { nda: SIGNED, deckFileId: DECK_FILE });
  await intro.svc.send(principal(), CMD);
  assert.equal(intro.sends()[0].body.data[0].attachments, undefined);
  // NDA gate intact even with a deck configured
  const shut = rig({}, { deckFileId: DECK_FILE });
  assert.equal((await shut.svc.send(principal(), { ...CMD, template: 'deck' })).reasonCode, 'nda-not-back');
  assert.equal(shut.sends().length, 0);
  // blank id behaves as unset
  const blank = rig({}, { nda: SIGNED, deckFileId: '  ' });
  assert.equal((await blank.svc.send(principal(), { ...CMD, template: 'deck' })).reasonCode, 'deck-not-ready');
  assert.equal(blank.sends().length, 0);
});

test('the client refuses malformed or too many attachment ids before calling Zoho', async () => {
  const r = rig();
  const crm = createZohoClient({ recordIdPrefix: P, gate: immediateGate(), log: createOpsLog(createMemorySink()), fetch: async () => { throw new Error('no call'); } });
  const base = { from: { email: FROM }, to: [{ email: LEAD_EMAIL }], subject: 'S', content: 'C', format: 'text' };
  await assert.rejects(() => crm.sendMail(credential, 'Leads', LEAD, { ...base, attachmentFileIds: ['short'] }), TypeError);
  await assert.rejects(() => crm.sendMail(credential, 'Leads', LEAD, { ...base, attachmentFileIds: Array(6).fill(DECK_FILE) }), TypeError);
  assert.equal(r.calls.length, 0);
});

test('a sender whose own mailbox is not on the org domain is refused before sending (never the shared org address)', async () => {
  const r = rig({ 'GET /settings/emails/actions/from_addresses': 'from-addresses-personal' });
  const res = await r.svc.send(principal(), CMD);
  assert.equal(res.reasonCode, 'no-org-address');
  assert.equal(r.sends().length, 0);
});

test('sent but the touch fails: still sent, one Plane B line for repair, and a notice to log it by hand', async () => {
  const r = rig({ 'POST /Touches': 'conflict' });
  const res = await r.svc.send(principal(), CMD);
  assert.equal(res.ok, true);
  assert.equal(res.value.touchRecorded, false);
  assert.match(res.value.notice, /Log a contact/);
  const lines = r.sink.records().filter((x) => x.reason === 'touch-not-recorded');
  assert.equal(lines.length, 1);
  assert.deepEqual(lines[0].recordIds, [LEAD]);
  noSecrets(r.sink);
});

test('the same press while the first is in flight joins it; a different email to that lead is refused: one press, one email', async () => {
  let release;
  const gateOn = new Promise((ok) => { release = ok; });
  const r = rig({}, { gateOn });
  const first = r.svc.send(principal(), CMD);
  await new Promise((ok) => setTimeout(ok, 20));
  const same = r.svc.send(principal(), CMD);
  const other = await r.svc.send(principal(), { ...CMD, subject: `${CMD.subject} again` });
  assert.equal(other.reasonCode, 'sending');
  release();
  assert.equal((await first).ok, true);
  assert.equal((await same).ok, true);
  assert.equal(r.sends().length, 1);
});

test('the client refuses a send_mail with no recipient or a malformed address before calling Zoho', async () => {
  const r = rig();
  const crm = createZohoClient({ recordIdPrefix: P, gate: immediateGate(), log: createOpsLog(createMemorySink()), fetch: async () => { throw new Error('no call'); } });
  const base = { from: { email: FROM }, to: [{ email: LEAD_EMAIL }], subject: 'S', content: 'C', format: 'text' };
  await assert.rejects(() => crm.sendMail(credential, 'Leads', LEAD, { ...base, to: [] }), TypeError);
  await assert.rejects(() => crm.sendMail(credential, 'Leads', LEAD, { ...base, to: [{ email: 'not an address' }] }), TypeError);
  await assert.rejects(() => crm.sendMail(credential, 'Leads', LEAD, { ...base, format: 'rtf' }), TypeError);
  assert.equal(r.calls.length, 0);
});
