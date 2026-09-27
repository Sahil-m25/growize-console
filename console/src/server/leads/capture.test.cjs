/* M04-S01 LEAD CAPTURE REGRESSION
 *
 * Run from console/: node src/server/leads/capture.test.cjs
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
const fixtureRoot = path.join(srcRoot, 'lib', 'zoho', '__fixtures__', 'lead-capture');
const ts = require(path.join(consoleRoot, 'node_modules', 'typescript'));
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoho-lead-capture-'));
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
  'server/leads/duplicate.ts',
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
const { createLeadCapture, mobileToE164, splitName } = load(path.join('server', 'leads', 'capture.js'));
const { createDuplicateCheck, mobileClause } = load(path.join('server', 'leads', 'duplicate.js'));

const P = '9007199254';
const IR = `${P}740995001`;
const MANAGER = `${P}740995002`;
const VIEWER = `${P}740995003`;
const PARTNER = `${P}740995004`;
const OTHER_IR = `${P}740995009`;
const QUEUE = `${P}740995099`;
const EVENT = `${P}740997001`;
const LEAD = `${P}740996001`;
const SESSION = 'session_fixture_capture_01';
const NOW = Date.parse('2026-09-27T15:30:00Z'); // 21:00 IST
const AT = '2026-09-27T21:00:00+05:30';

const recorded = (name) => JSON.parse(fs.readFileSync(path.join(fixtureRoot, `${name}.response.json`), 'utf8'));
const toResponse = (r) => new Response(r.status === 204 ? null : JSON.stringify(r.body), { status: r.status, headers: r.headers || {} });
const immediateGate = () => ({ async acquire() { return { waitedMs: 0, release() {} }; } });

const credentials = new Map();
before(async () => {
  for (const [id, name] of [[IR, 'ir'], [MANAGER, 'manager'], [VIEWER, 'viewer'], [PARTNER, 'partner']]) {
    const token = `synthetic-${name}-token-never-live`;
    credentials.set(id, await userCredential(
      { access_token: token, api_domain: 'https://www.zohoapis.in', expires_in: 3_600 },
      { recordIdPrefix: P, gate: immediateGate(), log: createOpsLog(createMemorySink()), clock: () => NOW,
        fetch: async () => toResponse(recorded(`current-user.${name}`)) },
    ));
  }
});
const principal = (id) => ({ credential: credentials.get(id), sessionId: SESSION });

const SEATS = {
  [IR]: { seat: 'investor-relations', mayCapture: true, assignableOwnerIds: [] },
  [MANAGER]: { seat: 'ir-manager', mayCapture: true, assignableOwnerIds: [IR, OTHER_IR] },
  [VIEWER]: { seat: 'viewer', mayCapture: false, assignableOwnerIds: [] },
  [PARTNER]: { seat: 'channel-partner', mayCapture: true, assignableOwnerIds: [] },
};
const accessFor = (overrides = {}) => {
  let n = 0;
  return {
    calls: () => n,
    async recheck(credential) {
      n += 1;
      const s = SEATS[credential.userId];
      const base = { actor: { userId: credential.userId, roleId: `${P}740998001`, profileId: `${P}740998002`, seat: s.seat },
        mayCapture: s.mayCapture, assignableOwnerIds: s.assignableOwnerIds, unassignedQueueUserId: QUEUE };
      return overrides.recheck ? overrides.recheck(base, n) : base;
    },
  };
};

function rig(reply = 'lead.created', accessOverrides) {
  const calls = [];
  const sink = createMemorySink();
  const log = createOpsLog(sink);
  const crm = createZohoClient({
    recordIdPrefix: P, gate: immediateGate(), log, maxAttempts: 1, clock: () => NOW,
    fetch: async (url, init) => {
      const u = new URL(url);
      calls.push({ method: init.method, pathname: u.pathname, body: init.body ? JSON.parse(init.body) : null });
      if (init.method === 'POST' && u.pathname === '/crm/v8/Leads') return toResponse(recorded(reply));
      if (init.method === 'POST' && u.pathname === '/crm/v8/coql') return toResponse(recorded(reply));
      throw new Error(`unexpected synthetic CRM request ${init.method} ${u.pathname}`);
    },
  });
  const invalidated = [];
  const cache = { async invalidate(sel) { invalidated.push(sel); return 0; } };
  const access = accessFor(accessOverrides);
  const service = createLeadCapture({ crm, access, log, cache, recordIdPrefix: P, clock: () => NOW });
  const dupes = createDuplicateCheck({ crm, access, log, recordIdPrefix: P, clock: () => NOW });
  return { service, dupes, calls, sink, access, invalidated, refusals: () => sink.records().filter((r) => r.kind === 'refusal') };
}

const BASE = Object.freeze({ name: 'Synthetic Fixture Lead', mobile: '98450 33021', source: 'Website' });
const PII = ['Synthetic Fixture Lead', '9845033021', 'fixture.lead@example.invalid'];
const noPii = (records) => { const t = JSON.stringify(records); for (const m of PII) assert.ok(!t.includes(m), `${m} reached the ops log`); };

test('mobile rule and E.164 normalisation match the capture form', () => {
  const cases = [
    ['9845033021', '+919845033021'], ['098450 33021', '+919845033021'], ['91 98450 33021', '+919845033021'],
    ['+91 98450-33021', '+919845033021'], ['+44 20 7946 0958', '+442079460958'], ['(+1) 415 555 0100', '+14155550100'],
    ['984503302', null], ['+91 98450 3302', null], ['+0 123456789', null], ['phone', null], ['', null], [9845033021, null],
  ];
  for (const [raw, want] of cases) assert.equal(mobileToE164(raw), want, String(raw));
  assert.deepEqual(splitName('  Asha   K  Rao '), { First_Name: 'Asha K', Last_Name: 'Rao' });
  assert.deepEqual(splitName('Madonna'), { Last_Name: 'Madonna' });
  assert.equal(splitName('A'), null);
});

test('an IR adds a lead: created in Zoho with their token, owned by them, cache busted', async () => {
  const r = rig();
  const res = await r.service.createLead(principal(IR), { ...BASE, email: ' fixture.lead@example.invalid ', city: 'Pune', units: 2,
    ownerId: OTHER_IR, consent: { msg: true, call: true }, consentHow: 'person' });
  assert.deepEqual(res, { ok: true, value: { leadId: LEAD, ownerId: IR } }, 'an IR always keeps what they add, whatever the request says');
  assert.equal(r.calls.length, 1);
  assert.deepEqual(r.calls[0].body, { data: [{
    First_Name: 'Synthetic Fixture', Last_Name: 'Lead', Mobile: '+919845033021', Lead_Source: 'Website',
    Email: 'fixture.lead@example.invalid', City: 'Pune', Units_Interested: 2,
    Owner: { id: IR }, Owner_Assigned_At: AT,
    Consent_WhatsApp: true, Consent_Call: true, Consent_How: 'In person', Consent_At: AT, Consent_By: { id: IR },
  }] });
  assert.ok(!('Lead_Status' in r.calls[0].body.data[0]), 'the blueprint owns Lead_Status');
  assert.deepEqual(r.invalidated, [{ scope: { kind: 'user', userId: IR } }]);
  assert.equal(r.access.calls(), 2, 'the seat is re-read before the write');
  noPii(r.sink.records());
});

test('Events needs the event; person sources need who introduced them', async () => {
  let r = rig();
  let res = await r.service.createLead(principal(IR), { ...BASE, source: 'Events' });
  assert.equal(res.reasonCode, 'event-missing');
  assert.equal(res.reason, 'which event it came from');
  assert.equal(r.calls.length, 0);

  r = rig();
  res = await r.service.createLead(principal(IR), { ...BASE, source: 'Events', eventId: EVENT, introducedById: OTHER_IR });
  assert.equal(res.ok, true);
  assert.deepEqual(r.calls[0].body.data[0].Lead_Event, { id: EVENT });
  assert.ok(!('Introduced_By' in r.calls[0].body.data[0]), 'an introducer is only kept for person sources');

  r = rig();
  res = await r.service.createLead(principal(IR), { ...BASE, source: 'Referral — investor' });
  assert.equal(res.reasonCode, 'introducer-missing');
  r = rig();
  res = await r.service.createLead(principal(IR), { ...BASE, source: 'Referral — investor', introducedById: OTHER_IR });
  assert.deepEqual(r.calls[0].body.data[0].Introduced_By, { id: OTHER_IR });
});

test('invalid fields are refused before Zoho, each with the form\'s words', async () => {
  const cases = [
    [{ name: 'A' }, 'invalid-name'],
    [{ mobile: '12345' }, 'invalid-mobile'],
    [{ email: 'not-an-address' }, 'invalid-email'],
    [{ source: 'Instagram' }, 'invalid-source'],
    [{ units: 1.5 }, 'invalid-units'],
    [{ consent: { msg: true } }, 'consent-how-missing'],
    [{ consent: { msg: true }, consentHow: 'telepathy' }, 'consent-how-missing'],
    [{ consent: { email: true }, consentHow: 'form' }, 'email-consent-without-email'],
    [{ consent: { sms: true }, consentHow: 'form' }, 'invalid-request'],
  ];
  for (const [patch, code] of cases) {
    const r = rig();
    const res = await r.service.createLead(principal(IR), { ...BASE, ...patch });
    assert.equal(res.reasonCode, code, JSON.stringify(patch));
    assert.equal(r.calls.length, 0);
    noPii(r.sink.records());
  }
  const r = rig();
  const res = await r.service.createLead(principal(IR), { ...BASE, mobile: '12345' });
  assert.equal(res.reason, 'write the mobile as ten Indian digits, or + and the country code');
});

test('an IR Manager may name an owner from their list, or leave it to the unassigned queue', async () => {
  let r = rig();
  let res = await r.service.createLead(principal(MANAGER), { ...BASE, ownerId: OTHER_IR });
  assert.deepEqual(res.value, { leadId: LEAD, ownerId: OTHER_IR });
  assert.deepEqual(r.calls[0].body.data[0].Owner, { id: OTHER_IR });
  assert.deepEqual(r.invalidated.map((s) => s.scope.userId).sort(), [MANAGER, OTHER_IR].sort());

  r = rig();
  res = await r.service.createLead(principal(MANAGER), { ...BASE, ownerId: null });
  assert.deepEqual(res.value, { leadId: LEAD, ownerId: null });
  assert.deepEqual(r.calls[0].body.data[0].Owner, { id: QUEUE });
  assert.ok(!('Owner_Assigned_At' in r.calls[0].body.data[0]), 'an unassigned lead has no assignment time');

  r = rig();
  res = await r.service.createLead(principal(MANAGER), { ...BASE, ownerId: `${P}740995777` });
  assert.equal(res.reasonCode, 'owner-not-assignable');
  assert.equal(r.calls.length, 0);

  r = rig('lead.created', { recheck: (b) => ({ ...b, unassignedQueueUserId: null }) });
  res = await r.service.createLead(principal(MANAGER), { ...BASE });
  assert.equal(res.reasonCode, 'unassigned-queue-missing', 'no queue user set up: refuse rather than guess an owner');
});

test('a Channel Partner\'s capture is theirs: source, owner and introducer are forced', async () => {
  const r = rig();
  const res = await r.service.createLead(principal(PARTNER), { ...BASE, source: 'Website', ownerId: IR, introducedById: IR });
  assert.equal(res.ok, true);
  const row = r.calls[0].body.data[0];
  assert.equal(row.Lead_Source, 'Channel partner');
  assert.deepEqual(row.Owner, { id: PARTNER });
  assert.deepEqual(row.Introduced_By, { id: PARTNER });
});

test('a seat without add capture writes nothing and the refusal names the capability', async () => {
  const r = rig();
  const res = await r.service.createLead(principal(VIEWER), { ...BASE });
  assert.equal(res.ok, false);
  assert.equal(res.reasonCode, 'capability-missing');
  assert.equal(res.missingCapability, 'capture');
  assert.match(res.reason, /capture/);
  assert.equal(r.calls.length, 0);
  assert.deepEqual(r.refusals().map((x) => [x.action, x.reason]), [['capture-lead', 'capability-missing']]);
});

test('capture revoked or owner list changed during the checks: nothing is written', async () => {
  let r = rig('lead.created', { recheck: (b, n) => ({ ...b, mayCapture: n === 1 }) });
  let res = await r.service.createLead(principal(IR), { ...BASE });
  assert.equal(res.reasonCode, 'capability-missing');
  assert.equal(r.calls.length, 0);

  r = rig('lead.created', { recheck: (b, n) => ({ ...b, assignableOwnerIds: n === 1 ? [IR, OTHER_IR] : [IR] }) });
  res = await r.service.createLead(principal(MANAGER), { ...BASE, ownerId: OTHER_IR });
  assert.equal(res.reasonCode, 'session-changed');
  assert.equal(r.calls.length, 0);

  r = rig('lead.created', { recheck: () => null });
  res = await r.service.createLead(principal(IR), { ...BASE });
  assert.equal(res.reasonCode, 'session-changed');
});

test('a forged principal is refused without an access check', async () => {
  const r = rig();
  const res = await r.service.createLead({ credential: { kind: 'user', userId: IR }, sessionId: SESSION }, { ...BASE });
  assert.equal(res.reasonCode, 'invalid-request');
  assert.equal(r.access.calls(), 0);
});

test('Zoho rejecting the row or failing is reported, never retried, and leaks nothing', async () => {
  let r = rig('lead.invalid-source');
  let res = await r.service.createLead(principal(IR), { ...BASE, source: 'Other' });
  assert.equal(res.kind, 'source-error');
  assert.equal(res.retryable, false);
  assert.equal(r.calls.length, 1);
  assert.deepEqual(r.invalidated, []);

  r = rig('source.server-error');
  res = await r.service.createLead(principal(IR), { ...BASE });
  assert.equal(res.kind, 'source-error');
  assert.equal(res.retryable, false, 'a create that may have landed is never resent');
  assert.equal(r.calls.length, 1);
  assert.ok(!JSON.stringify(res).includes('example.invalid'));
  noPii(r.sink.records());
});

// ---------------- M04-S02 duplicate mobile ----------------

test('the lookup matches every stored spelling of the number, with the person\'s own token', async () => {
  assert.equal(mobileClause('+919845033021'),
    "(Mobile in ('+919845033021', '919845033021', '9845033021', '09845033021') or Mobile like '%9845033021')");
  assert.equal(mobileClause('+442079460958'), "Mobile in ('+442079460958', '442079460958')");
  const r = rig('coql.duplicate-none');
  const res = await r.dupes.lookup(principal(IR), '098450 33021');
  assert.deepEqual(res, { ok: true, value: { status: 'none' } });
  assert.equal(r.calls.length, 1);
  assert.match(r.calls[0].body.select_query, /^select id, First_Name, Owner from Leads where \(Mobile in/);
  assert.ok(!/Last_Name|Email|Full_Name/.test(r.calls[0].body.select_query), 'only id and first name are asked for');
  noPii(r.sink.records());
});

test('a duplicate in the IR\'s own book offers Open <first name>', async () => {
  const r = rig('coql.duplicate-own');
  const res = await r.dupes.lookup(principal(IR), '+91 98450 33021');
  assert.deepEqual(res, { ok: true, value: { status: 'own', leadId: `${P}740996002`, firstName: 'Synthetic' } });
});

test('a lead the manager sees in their team is "visible", not "own"', async () => {
  const r = rig('coql.duplicate-team');
  const res = await r.dupes.lookup(principal(MANAGER), '9845033021');
  assert.equal(res.value.status, 'visible');
});

test('the lookup is refused for a bad number or a seat that cannot add', async () => {
  let r = rig('coql.duplicate-none');
  let res = await r.dupes.lookup(principal(IR), '12345');
  assert.equal(res.reasonCode, 'invalid-mobile');
  assert.equal(r.calls.length, 0);
  r = rig('coql.duplicate-none');
  res = await r.dupes.lookup(principal(VIEWER), '9845033021');
  assert.equal(res.reasonCode, 'capability-missing');
  assert.equal(r.calls.length, 0);
});

test('a number held outside the book is stopped by Zoho\'s duplicate check, without a name or id', async () => {
  const r = rig('lead.duplicate-mobile');
  const res = await r.service.createLead(principal(IR), { ...BASE });
  assert.equal(res.ok, false);
  assert.equal(res.reasonCode, 'duplicate-mobile');
  assert.equal(res.reason, 'the book already has this number');
  assert.ok(!JSON.stringify(res).includes('740996444'), 'the other record\'s id is not passed on');
  assert.deepEqual(r.invalidated, []);
  assert.deepEqual(r.refusals().map((x) => x.reason), ['duplicate-mobile']);
});
