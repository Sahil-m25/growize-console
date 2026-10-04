/* LEADS REGRESSION (M04-S01 capture, M04-S02 duplicates, M06-S01 book)
 *
 * Run from console/: node src/server/leads/leads.test.cjs
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
  'server/leads/cover.ts',
  'server/leads/book.ts',
  'server/leads/today.ts',
  'server/leads/assign.ts',
  'server/leads/focus.ts',
  'server/leads/search.ts',
  'server/leads/import.ts',
  'server/leads/updates.ts',
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
const { createLeadCapture, mobileToE164, splitName, CONSENT_HOW, CONSENT_HOW_PICKLIST } = load(path.join('server', 'leads', 'capture.js'));
const { createDuplicateCheck, mobileClause } = load(path.join('server', 'leads', 'duplicate.js'));
const { createLeadsBook } = load(path.join('server', 'leads', 'book.js'));
const { createTodayRead } = load(path.join('server', 'leads', 'today.js'));
const { createLeadAssign } = load(path.join('server', 'leads', 'assign.js'));
const { createFocusRead } = load(path.join('server', 'leads', 'focus.js'));
const { createLeadSearch, searchQueryFor } = load(path.join('server', 'leads', 'search.js'));
const { createLeadImport, checkRows } = load(path.join('server', 'leads', 'import.js'));
const { createUpdates, kindOf } = load(path.join('server', 'leads', 'updates.js'));

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
    Consent_WhatsApp: true, Consent_Call: true, Consent_How: 'Verbal', Consent_At: AT, Consent_By: { id: IR },
  }] });
  assert.ok(!('Lead_Status' in r.calls[0].body.data[0]), 'the blueprint owns Lead_Status');
  assert.deepEqual(r.invalidated, [{ scope: { kind: 'user', userId: IR } }]);
  assert.equal(r.access.calls(), 2, 'the seat is re-read before the write');
  noPii(r.sink.records());
});

test('M14-S03-NOTE-5: every Consent_How the capture writes is on the org picklist, for every source, and Consent_Visit is never written', async () => {
  assert.deepEqual([...CONSENT_HOW_PICKLIST], ['Form', 'Verbal', 'Email reply', 'Event sheet']); // Leads.Consent_How, live metadata 4 Oct 2026
  assert.equal(CONSENT_HOW.event, 'Event sheet');
  for (const [k, v] of Object.entries(CONSENT_HOW)) assert.ok(CONSENT_HOW_PICKLIST.includes(v), `${k} -> ${v}`);
  for (const how of Object.keys(CONSENT_HOW)) {
    const r = rig();
    const res = await r.service.createLead(principal(IR), { ...BASE, consent: { msg: true, visit: true }, consentHow: how });
    assert.equal(res.ok, true, how);
    const row = r.calls[0].body.data[0];
    assert.ok(CONSENT_HOW_PICKLIST.includes(row.Consent_How), `${how} wrote ${row.Consent_How}`);
    assert.ok(!('Consent_Visit' in row));
  }
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

test('TC-E04-005/006: +91, leading 0, 91 prefix and spaces all find the same own-book lead; a number outside the book answers nothing but a refusal', async () => {
  for (const typed of ['9845033021', '+91 98450 33021', '098450 33021', '91 98450 33021', '+91 98450-33021']) {
    const r = rig('coql.duplicate-own');
    const res = await r.dupes.lookup(principal(IR), typed);
    assert.deepEqual(res.value, { status: 'own', leadId: `${P}740996002`, firstName: 'Synthetic' }, typed);
    assert.match(r.calls[0].body.select_query, /'\+919845033021'/, typed);
  }
  const out = rig('lead.duplicate-mobile');
  const res = await out.service.createLead(principal(IR), { ...BASE, Mobile: '098450 33021' });
  assert.equal(res.reasonCode, 'duplicate-mobile');
  assert.ok(!/Synthetic|740996444/.test(JSON.stringify(res)), 'out-of-book duplicate hides name and id');
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

// ---------------- M06-S01 Leads list ----------------

const leadsAccess = (id, overrides = {}) => {
  let n = 0;
  return { calls: () => n, async recheck(credential) {
    n += 1;
    const base = id === MANAGER
      ? { actor: { userId: MANAGER, roleId: `${P}740998001`, profileId: `${P}740998002`, seat: 'ir-manager' }, mayViewLeads: true,
          teamOwnerIds: [IR, OTHER_IR], teamOrgWide: false, unassignedQueueUserId: QUEUE, seesUnassignedInPersonal: false }
      : { actor: { userId: credential.userId, roleId: `${P}740998001`, profileId: `${P}740998002`, seat: 'investor-relations' }, mayViewLeads: true,
          teamOwnerIds: null, teamOrgWide: false, unassignedQueueUserId: QUEUE, seesUnassignedInPersonal: true };
    return overrides.recheck ? overrides.recheck(base, n) : base;
  } };
};
function bookRig(reply, id, overrides) {
  const calls = [];
  const sink = createMemorySink();
  const log = createOpsLog(sink);
  const crm = createZohoClient({ recordIdPrefix: P, gate: immediateGate(), log, maxAttempts: 1, clock: () => NOW,
    fetch: async (url, init) => { calls.push(JSON.parse(init.body).select_query); return toResponse(recorded(reply)); } });
  const access = leadsAccess(id, overrides);
  return { book: createLeadsBook({ crm, access, log, recordIdPrefix: P, clock: () => NOW, ...(overrides && overrides.roster ? { roster: overrides.roster } : {}) }), calls, sink, access };
}

test('an IR\'s book is owner, an ACTIVE secondary (roster absence), live cover and the unassigned queue — lost leads come back marked', async () => {
  // D44: row 02 names the IR secondary on OTHER_IR's lead; the roster says OTHER_IR is away today.
  const roster = { async current() { return { absentOwnerIds: [OTHER_IR], covers: [] }; } };
  const r = bookRig('coql.book-personal', IR, { roster });
  const res = await r.book.list(principal(IR), 'personal');
  assert.equal(res.ok, true);
  assert.deepEqual(res.value.rows.map((x) => [x.id.slice(-2), x.why, x.ownerId]),
    [['01', 'owner', IR], ['02', 'secondary', OTHER_IR], ['03', 'cover', OTHER_IR], ['04', 'unassigned', null], ['05', 'owner', IR]]);
  assert.equal(res.value.rows[4].lostAt, '2026-09-25T10:00:00+05:30');
  assert.equal(res.value.rows[0].unitsInterested, 2);
  assert.equal(res.value.nextOffset, null);
  assert.equal(r.calls[0], `select id, First_Name, Last_Name, Mobile, Owner, Secondary_Owner, Cover_By, Cover_Until, Lead_Source, Lead_Status, Created_Time, Lost_At, Onboarded_At, Units_Interested, Next_Step_At, Last_Reply_At from Leads where (Owner = '${IR}' or (Cover_By = '${IR}' and Cover_Until >= '2026-09-27') or (Cover_By is null and Secondary_Owner = '${IR}' and Owner in ('${OTHER_IR}')) or Owner = '${QUEUE}') order by id asc limit 0, 200`);
  assert.equal(r.access.calls(), 2);
});

test('D44: a named secondary alone is dormant — never asked for, and refused if sharing lets one through', async () => {
  const r = bookRig('coql.book-personal', IR);
  const res = await r.book.list(principal(IR), 'personal');
  assert.equal(res.reasonCode, 'scope-drift');
  assert.ok(!r.calls[0].includes(`Secondary_Owner = '${IR}' or`), 'no unconditional secondary clause');
  assert.match(r.calls[0], new RegExp(`where \\(Owner = '${IR}' or \\(Cover_By = '${IR}' and Cover_Until >= '2026-09-27'\\) or Owner = '${QUEUE}'\\)`));
  const drift = r.sink.records().filter((x) => x.kind === 'refusal');
  assert.deepEqual(drift[0].recordIds.map((x) => x.slice(-2)), ['02']);
});

test('a row outside the book (expired cover, stale share) refuses the page', async () => {
  const r = bookRig('coql.book-personal-drift', IR);
  const res = await r.book.list(principal(IR), 'personal');
  assert.equal(res.reasonCode, 'scope-drift');
  assert.ok(!('value' in res));
});

test('the IR Manager\'s team scope filters by the owners they manage and pages by 200', async () => {
  const r = bookRig('coql.book-team', MANAGER);
  const res = await r.book.list(principal(MANAGER), 'team');
  assert.equal(res.ok, true);
  assert.deepEqual(res.value.rows.map((x) => x.why), ['team', 'team', 'team']);
  assert.equal(res.value.rows[2].ownerId, null, 'the queue user reads as unassigned');
  assert.equal(res.value.nextOffset, 200);
  assert.match(r.calls[0], new RegExp(`where \\(Owner in \\('${IR}', '${OTHER_IR}', '${QUEUE}'\\)\\) order by id asc limit 0, 200$`));
  const next = await bookRig('coql.book-team', MANAGER).book.list(principal(MANAGER), 'team', 200);
  assert.equal(next.ok, true);
  const bad = await bookRig('coql.book-team', MANAGER).book.list(principal(MANAGER), 'team', 150);
  assert.equal(bad.reasonCode, 'invalid-request');
});

test('team scope: a foreign owner is drift; an IR has no team scope; org-wide seats read without an owner filter', async () => {
  let res = await bookRig('coql.book-team-foreign', MANAGER).book.list(principal(MANAGER), 'team');
  assert.equal(res.reasonCode, 'scope-drift');
  let r = bookRig('coql.book-team', IR);
  res = await r.book.list(principal(IR), 'team');
  assert.equal(res.reasonCode, 'no-team-scope');
  assert.equal(r.calls.length, 0);
  r = bookRig('coql.book-team-foreign', MANAGER, { recheck: (b) => ({ ...b, teamOrgWide: true, teamOwnerIds: null }) });
  res = await r.book.list(principal(MANAGER), 'team');
  assert.equal(res.ok, true);
  assert.match(r.calls[0], /where \(id is not null\)/);
});

test('no leads view, or a scope changed during the read, returns nothing', async () => {
  let r = bookRig('coql.book-personal', IR, { recheck: (b) => ({ ...b, mayViewLeads: false }) });
  let res = await r.book.list(principal(IR), 'personal');
  assert.equal(res.reasonCode, 'capability-missing');
  assert.equal(r.calls.length, 0);
  r = bookRig('coql.book-team', MANAGER, { recheck: (b, n) => ({ ...b, teamOwnerIds: n === 1 ? [IR, OTHER_IR] : [IR] }) });
  res = await r.book.list(principal(MANAGER), 'team');
  assert.equal(res.reasonCode, 'session-changed');
  assert.ok(!('value' in res));
});

// ---------------- M05-S01 Today (Lead side) ----------------

function todayRig(routes) {
  const queries = [];
  const sink = createMemorySink();
  const log = createOpsLog(sink);
  const crm = createZohoClient({ recordIdPrefix: P, gate: immediateGate(), log, maxAttempts: 1, clock: () => NOW,
    fetch: async (url, init) => {
      const q = JSON.parse(init.body).select_query; queries.push(q);
      const m = / from (\w+) /.exec(q)[1];
      return toResponse(recorded(routes[m]));
    } });
  // D44: lead 02 names the IR secondary; the roster has its owner away, so it is in the book.
  const roster = { async current() { return { absentOwnerIds: [OTHER_IR], covers: [] }; } };
  const book = createLeadsBook({ crm, access: leadsAccess(IR), log, recordIdPrefix: P, clock: () => NOW, roster });
  return { today: createTodayRead({ book, crm, clock: () => NOW }), queries };
}

test('Today reads the open book and its open Tasks, Calls and Meetings; lost leads are left out', async () => {
  const r = todayRig({ Leads: 'coql.book-personal', Tasks: 'coql.today-tasks', Calls: 'coql.today-calls', Events: 'coql.today-meetings' });
  const res = await r.today.read(principal(IR), 'personal');
  assert.equal(res.ok, true);
  assert.deepEqual(res.value.leads.map((l) => l.id.slice(-2)), ['01', '02', '03', '04'], 'the lost lead 05 is not listed');
  assert.ok(res.value.leads.some((l) => l.why === 'unassigned'), 'unassigned leads come through for No owner yet');
  assert.deepEqual(res.value.activities.map((a) => [a.kind, a.leadId.slice(-2), a.when]),
    [['task', '01', '2026-09-26'], ['call', '02', '2026-09-27T16:00:00+05:30']]);
  const ids = ['01', '02', '03', '04'].map((k) => `'${P}74099610${k.slice(-1)}'`).join(', ');
  assert.equal(r.queries[1], `select id, Subject, Due_Date, Status, What_Id from Tasks where (What_Id in (${ids}) and Status != 'Completed') order by id asc limit 0, 2000`);
  assert.match(r.queries[3], /from Events where \(What_Id in \(.*\) and End_DateTime >= '2026-09-27T21:00:00\+05:30'\)/);
});

test('an activity on a lead outside the book refuses Today', async () => {
  const r = todayRig({ Leads: 'coql.book-personal', Tasks: 'coql.today-foreign', Calls: 'coql.today-calls', Events: 'coql.today-meetings' });
  const res = await r.today.read(principal(IR), 'personal');
  assert.equal(res.reasonCode, 'scope-drift');
});

test('a Leads refusal passes straight through Today', async () => {
  const r = todayRig({ Leads: 'coql.book-personal-drift' });
  const res = await r.today.read(principal(IR), 'personal');
  assert.equal(res.reasonCode, 'scope-drift');
  assert.equal(r.queries.length, 1);
});

// ---------------- M05-S02 Assign to me ----------------

const UNOWNED = `${P}740996104`;
function assignRig(get, put, id = IR, overrides = {}) {
  const calls = [];
  const sink = createMemorySink();
  const log = createOpsLog(sink);
  const crm = createZohoClient({ recordIdPrefix: P, gate: immediateGate(), log, maxAttempts: 1, clock: () => NOW,
    fetch: async (url, init) => {
      const u = new URL(url);
      calls.push({ method: init.method, path: u.pathname, search: u.search, headers: init.headers, body: init.body ? JSON.parse(init.body) : null });
      return toResponse(recorded(init.method === 'GET' ? get : put));
    } });
  let n = 0;
  const access = { async recheck(credential) {
    n += 1;
    const base = id === MANAGER
      ? { actor: { userId: MANAGER, roleId: `${P}740998001`, profileId: `${P}740998002`, seat: 'ir-manager' }, mayTakeUnowned: false, mayAssignOthers: true, assignableOwnerIds: [IR, OTHER_IR], unassignedQueueUserId: QUEUE }
      : { actor: { userId: credential.userId, roleId: `${P}740998001`, profileId: `${P}740998002`, seat: 'investor-relations' }, mayTakeUnowned: true, mayAssignOthers: false, assignableOwnerIds: [], unassignedQueueUserId: QUEUE };
    return overrides.recheck ? overrides.recheck(base, n) : base;
  } };
  return { svc: createLeadAssign({ crm, access, log, recordIdPrefix: P, clock: () => NOW }), calls, sink };
}

test('Assign to me: an IR takes an unowned lead with a guarded write of Owner and its time', async () => {
  const r = assignRig('lead.get-unowned', 'lead.updated');
  const res = await r.svc.assign(principal(IR), UNOWNED, IR);
  assert.deepEqual(res, { ok: true, value: { leadId: UNOWNED, ownerId: IR, modifiedTime: '2026-09-27T21:00:00+05:30' } });
  assert.equal(r.calls[0].method, 'GET');
  assert.equal(r.calls[1].method, 'PUT');
  assert.equal(r.calls[1].headers['If-Unmodified-Since'], '2026-09-26T10:00:00+05:30');
  assert.deepEqual(r.calls[1].body, { data: [{ Owner: { id: IR }, Owner_Assigned_At: AT }] });
});

test('a lead that already has an owner is not taken, and an IR cannot give a lead to somebody else', async () => {
  let r = assignRig('lead.get-owned', 'lead.updated');
  let res = await r.svc.assign(principal(IR), UNOWNED, IR);
  assert.equal(res.reasonCode, 'already-owned');
  assert.equal(r.calls.filter((c) => c.method === 'PUT').length, 0);
  r = assignRig('lead.get-unowned', 'lead.updated');
  res = await r.svc.assign(principal(IR), UNOWNED, OTHER_IR);
  assert.equal(res.reasonCode, 'capability-missing');
  assert.equal(r.calls.length, 0);
});

test('two IRs pressing at once: the second write loses to If-Unmodified-Since', async () => {
  const r = assignRig('lead.get-unowned', 'lead.conflict');
  const res = await r.svc.assign(principal(IR), UNOWNED, IR);
  assert.equal(res.reasonCode, 'lead-changed');
  assert.equal(r.calls.filter((c) => c.method === 'PUT').length, 1, 'never retried');
});

test('a manager assigns an unowned lead to one of their IRs, never outside the list', async () => {
  let r = assignRig('lead.get-unowned', 'lead.updated', MANAGER);
  let res = await r.svc.assign(principal(MANAGER), UNOWNED, OTHER_IR);
  assert.equal(res.value.ownerId, OTHER_IR);
  r = assignRig('lead.get-unowned', 'lead.updated', MANAGER);
  res = await r.svc.assign(principal(MANAGER), UNOWNED, `${P}740995555`);
  assert.equal(res.reasonCode, 'owner-not-assignable');
  assert.equal(r.calls.length, 0);
});

test('the right withdrawn between the read and the write stops the write', async () => {
  const r = assignRig('lead.get-unowned', 'lead.updated', IR, { recheck: (b, n) => ({ ...b, mayTakeUnowned: n === 1 }) });
  const res = await r.svc.assign(principal(IR), UNOWNED, IR);
  assert.equal(res.reasonCode, 'capability-missing');
  assert.equal(r.calls.filter((c) => c.method === 'PUT').length, 0);
});

// ---------------- M05-S02 focus panel ----------------

function focusRig(routes) {
  const calls = [];
  const sink = createMemorySink();
  const log = createOpsLog(sink);
  const crm = createZohoClient({ recordIdPrefix: P, gate: immediateGate(), log, maxAttempts: 1, clock: () => NOW,
    fetch: async (url, init) => {
      const u = new URL(url); calls.push(u.pathname + u.search + (init.body ? ' ' + init.body : ''));
      const key = u.pathname.endsWith('/Notes') ? 'notes' : u.pathname.endsWith('/coql') ? 'touch' : 'lead';
      return toResponse(recorded(routes[key]));
    } });
  return { svc: createFocusRead({ crm, access: leadsAccess(IR), log, recordIdPrefix: P, clock: () => NOW }), calls };
}

test('the focus panel carries next step, last contact and the latest note', async () => {
  const r = focusRig({ lead: 'lead.get-focus', touch: 'coql.touch-latest', notes: 'notes.related' });
  const res = await r.svc.read(principal(IR), `${P}740996101`);
  assert.deepEqual(res.value, {
    leadId: `${P}740996101`,
    nextStep: { text: 'Call back about the deck', channel: 'Call', at: '2026-09-28T11:00:00+05:30' },
    lastReplyAt: '2026-09-25T18:00:00+05:30',
    lastContact: { channel: 'WhatsApp', at: '2026-09-26T12:00:00+05:30', isReply: false },
    latestNote: { text: 'Synthetic latest note', at: '2026-09-26T09:00:00+05:30' },
  });
  assert.match(r.calls[1], /order by Occurred_At desc limit 0, 1/);
});

test('a lead with no touches or notes shows none; a lead Zoho hides is unavailable', async () => {
  let r = focusRig({ lead: 'lead.get-focus', touch: 'coql.today-meetings', notes: 'coql.today-meetings' });
  let res = await r.svc.read(principal(IR), `${P}740996101`);
  assert.equal(res.value.lastContact, null);
  assert.equal(res.value.latestNote, null);
  r = focusRig({ lead: 'coql.today-meetings' });
  res = await r.svc.read(principal(IR), `${P}740996101`);
  assert.equal(res.reasonCode, 'not-visible');
  assert.equal(r.calls.length, 1);
});

// ---------------- M06-S03 Find a lead ----------------

function searchRig(reply, id = IR, overrides) {
  const calls = [];
  const sink = createMemorySink();
  const log = createOpsLog(sink);
  const crm = createZohoClient({ recordIdPrefix: P, gate: immediateGate(), log, maxAttempts: 1, clock: () => NOW,
    fetch: async (url) => { const u = new URL(url); calls.push(u); return toResponse(recorded(reply)); } });
  return { svc: createLeadSearch({ crm, access: leadsAccess(id, overrides), log, recordIdPrefix: P, clock: () => NOW }), calls, sink };
}

test('search terms: 3+ digits search the phone, 2+ letters a word, anything shorter nothing', () => {
  assert.deepEqual(searchQueryFor(' 98450 '), { phone: '98450' });
  assert.deepEqual(searchQueryFor('+91 98-450'), { phone: '9198450' });
  assert.deepEqual(searchQueryFor('Asha (Rao)'), { word: 'Asha Rao' });
  assert.equal(searchQueryFor('a'), null);
  assert.equal(searchQueryFor('12'), null);
});

test('an IR finds only their own book — never another IR\'s lead, an expired cover or the queue', async () => {
  const r = searchRig('search.mixed');
  const res = await r.svc.find(principal(IR), 'Match');
  assert.equal(res.value.book, 'yours');
  assert.deepEqual(res.value.hits.map((h) => h.id.slice(-2)), ['01', '03'], 'D44: 05 names the IR secondary only — dormant');
  assert.deepEqual(res.value.hits[0], { id: `${P}740996201`, name: 'Synthetic Match 1', phoneLast4: '0001', stage: 'Lead captured', ownerId: IR });
  assert.equal(r.calls[0].pathname, '/crm/v8/Leads/search', 'Leads only, never Contacts');
  assert.equal(r.calls[0].searchParams.get('word'), 'Match');
  assert.ok(!JSON.stringify(res).includes('+91 90000'), 'the full number never leaves');
  const dropped = r.sink.records().filter((x) => x.kind === 'refusal');
  assert.deepEqual(dropped[0].recordIds.map((x) => x.slice(-2)), ['02', '04', '05', '06']);
});

test('the IR Manager sees the team\'s book; an org-wide seat sees every book, masked to the last four', async () => {
  let res = await searchRig('search.mixed', MANAGER).svc.find(principal(MANAGER), 'Match');
  assert.equal(res.value.book, 'team');
  assert.deepEqual(res.value.hits.map((h) => [h.id.slice(-2), h.ownerId === null ? 'queue' : 'owner']),
    [['01', 'owner'], ['02', 'owner'], ['03', 'owner'], ['04', 'owner'], ['05', 'owner'], ['06', 'queue']]);
  res = await searchRig('search.mixed', MANAGER, { recheck: (b) => ({ ...b, teamOrgWide: true, teamOwnerIds: null }) }).svc.find(principal(MANAGER), '0003');
  assert.equal(res.value.book, 'all');
  assert.ok(res.value.hits.every((h) => /^\d{4}$/.test(h.phoneLast4)));
});

test('at most eight rows show, with how many more to keep typing for', async () => {
  const r = searchRig('search.many');
  const res = await r.svc.find(principal(IR), '90000');
  assert.equal(r.calls[0].searchParams.get('phone'), '90000');
  assert.equal(res.value.hits.length, 8);
  assert.equal(res.value.more, 3, 'two over the eight plus a further page');
});

test('no Zoho call for a short term or a seat without Leads', async () => {
  let r = searchRig('search.mixed');
  let res = await r.svc.find(principal(IR), 'a');
  assert.equal(res.reasonCode, 'term-too-short');
  r = searchRig('search.mixed', IR, { recheck: (b) => ({ ...b, mayViewLeads: false }) });
  res = await r.svc.find(principal(IR), 'Match');
  assert.equal(res.reasonCode, 'capability-missing');
  assert.equal(r.calls.length, 0);
});

// ---------------- M04-S04 CSV import ----------------

const EVENT_ID = `${P}740997001`;
const FILE = Object.freeze([
  { name: 'Synthetic Alpha', mobile: '9000000101', email: '' },
  { name: 'Synthetic Beta', mobile: '9000000102' },
  { name: 'Synthetic Gamma', mobile: '9000000103', city: 'Pune', units: 2 },
  { name: 'A', mobile: '9000000104' },
  { name: 'Synthetic Delta', mobile: '12345' },
  { name: 'Synthetic Eps', mobile: '9000000105', email: 'bad' },
  { name: 'Synthetic Alpha Again', mobile: '+91 90000 00101' },
]);
function importRig(reply, id = MANAGER) {
  const calls = [];
  const sink = createMemorySink();
  const log = createOpsLog(sink);
  const crm = createZohoClient({ recordIdPrefix: P, gate: immediateGate(), log, maxAttempts: 1, clock: () => NOW,
    fetch: async (url, init) => { calls.push(JSON.parse(init.body)); return toResponse(recorded(reply)); } });
  return { svc: createLeadImport({ crm, access: accessFor(), log, recordIdPrefix: P, clock: () => NOW }), calls };
}

test('the preview refuses rows by the file alone: short name, bad mobile, bad email, a number twice', () => {
  const { good, refused } = checkRows(FILE);
  assert.deepEqual(good.map((g) => g.row), [0, 1, 2]);
  assert.deepEqual(refused.map((r) => [r.row, r.reason]), [[3, 'name'], [4, 'mobile'], [5, 'email'], [6, 'duplicate-in-file']]);
});

test('no event, nothing written', async () => {
  const r = importRig('import.partial');
  const res = await r.svc.load(principal(MANAGER), '', { kind: 'me' }, FILE);
  assert.equal(res.reasonCode, 'event-missing');
  assert.equal(r.calls.length, 0);
});

test('good rows land tagged to the event, round-robin across its staff, with no consent whatever the file says', async () => {
  const r = importRig('import.partial');
  const res = await r.svc.load(principal(MANAGER), EVENT_ID, { kind: 'round-robin', staffIds: [IR, OTHER_IR] },
    FILE.map((x) => ({ ...x, consent: 'yes', Consent_WhatsApp: true })));
  assert.equal(r.calls.length, 1);
  const rows = r.calls[0].data;
  assert.deepEqual(rows.map((x) => x.Owner.id), [IR, OTHER_IR, IR]);
  for (const x of rows) {
    assert.equal(x.Lead_Source, 'Events');
    assert.deepEqual(x.Lead_Event, { id: EVENT_ID });
    assert.ok(!Object.keys(x).some((k) => /consent/i.test(k)), 'no consent from a file');
  }
  assert.equal(res.value.added, 2);
  assert.deepEqual(res.value.rows.map((v) => [v.row, v.status, v.reason ?? '']),
    [[0, 'added', ''], [1, 'refused', 'duplicate-on-book'], [2, 'added', ''], [3, 'refused', 'name'], [4, 'refused', 'mobile'], [5, 'refused', 'email'], [6, 'refused', 'duplicate-in-file']]);
});

const SAMPLE = Object.freeze([ // leads.csv: good, 1-char name, dup on book, dup in file, bad email, intl mobile (TC-E04-010)
  { name: 'Asha Rao', mobile: '9000000201', email: 'asha@example.com', consent: 'yes' },
  { name: 'K', mobile: '9000000202' },
  { name: 'Sanjay Menon', mobile: '9000000203' },
  { name: 'Asha Again', mobile: '+91 90000 00201' },
  { name: 'Bad Email', mobile: '9000000204', email: 'bad@' },
  { name: 'OK Two', mobile: '+919000000205' },
]);

test('TC-E04-010: each sample row gets its own verdict; the consent column is ignored; 2 of 6 are added', async () => {
  const pre = checkRows(SAMPLE);
  assert.deepEqual(pre.refused.map((r) => [r.row, r.reason]), [[1, 'name'], [3, 'duplicate-in-file'], [4, 'email']]);
  const r = importRig('import.partial');
  const res = await r.svc.load(principal(MANAGER), EVENT_ID, { kind: 'me' }, SAMPLE);
  assert.deepEqual(res.value.rows.map((v) => [v.row, v.status, v.reason ?? '']),
    [[0, 'added', ''], [1, 'refused', 'name'], [2, 'refused', 'duplicate-on-book'], [3, 'refused', 'duplicate-in-file'], [4, 'refused', 'email'], [5, 'added', '']]);
  assert.equal(res.value.added, 2);
  assert.equal(res.value.rows.length, 6);
  assert.ok(r.calls[0].data.every((x) => !Object.keys(x).some((k) => /consent/i.test(k))));
});

test('TC-E04-011: no event, nothing is added; with an event the two good rows are tagged Events and split between two people', async () => {
  const none = importRig('import.partial');
  assert.equal((await none.svc.load(principal(MANAGER), '', { kind: 'me' }, SAMPLE)).reasonCode, 'event-missing');
  assert.equal(none.calls.length, 0);
  const r = importRig('import.partial');
  const res = await r.svc.load(principal(MANAGER), EVENT_ID, { kind: 'round-robin', staffIds: [IR, OTHER_IR] }, SAMPLE);
  assert.equal(res.value.added, 2);
  assert.deepEqual(r.calls[0].data.map((x) => x.Owner.id), [IR, OTHER_IR, IR]);
  assert.ok(r.calls[0].data.every((x) => x.Lead_Source === 'Events' && x.Lead_Event.id === EVENT_ID));
  assert.ok(r.calls[0].data.every((x) => !('Consent_Call' in x) && !('Consent_WhatsApp' in x) && !('Consent_Email' in x)));
});

test('a retry after a part-way failure writes no row twice: Zoho returns the landed rows as duplicates', async () => {
  const r = importRig('import.retry');
  const res = await r.svc.load(principal(MANAGER), EVENT_ID, { kind: 'me' }, FILE);
  assert.equal(res.value.added, 0);
  assert.ok(res.value.rows.filter((v) => v.row < 3).every((v) => v.reason === 'duplicate-on-book'));
});

test('owner rules: leave unassigned uses the queue; one person must be assignable; an IR always keeps the load', async () => {
  let r = importRig('import.partial');
  await r.svc.load(principal(MANAGER), EVENT_ID, { kind: 'unassigned' }, FILE);
  assert.ok(r.calls[0].data.every((x) => x.Owner.id === QUEUE && !('Owner_Assigned_At' in x)));
  r = importRig('import.partial');
  assert.equal((await r.svc.load(principal(MANAGER), EVENT_ID, { kind: 'one', ownerId: `${P}740995555` }, FILE)).reasonCode, 'owner-not-assignable');
  assert.equal((await r.svc.load(principal(MANAGER), EVENT_ID, { kind: 'round-robin', staffIds: [] }, FILE)).reasonCode, 'owner-not-assignable');
  r = importRig('import.partial', IR);
  await r.svc.load(principal(IR), EVENT_ID, { kind: 'one', ownerId: OTHER_IR }, FILE);
  assert.ok(r.calls[0].data.every((x) => x.Owner.id === IR));
  r = importRig('import.partial', VIEWER);
  assert.equal((await r.svc.load(principal(VIEWER), EVENT_ID, { kind: 'me' }, FILE)).reasonCode, 'capability-missing');
  assert.equal(r.calls.length, 0);
});

// ---------------- M15-S01 Updates ----------------

function updatesRig(seenAt = {}) {
  const calls = [];
  const sink = createMemorySink();
  const log = createOpsLog(sink);
  const crm = createZohoClient({ recordIdPrefix: P, gate: immediateGate(), log, maxAttempts: 1, clock: () => NOW,
    fetch: async (url, init) => {
      const u = new URL(url); calls.push(u.pathname + (init.body ? ' ' + init.body : ''));
      if (u.pathname.endsWith('/coql')) return toResponse(recorded('coql.updates-leads'));
      return toResponse(recorded(u.pathname.includes('740996101') ? 'timeline.lead1' : 'timeline.lead2'));
    } });
  const marks = [];
  const seen = { async lastSeen(u, k) { return seenAt[k] ?? null; }, async markSeen(u, k, at) { marks.push([u, k, at]); } };
  return { svc: createUpdates({ crm, access: leadsAccess(IR), seen, log, recordIdPrefix: P, clock: () => NOW }), calls, sink, marks };
}

test('Updates groups other people\'s changes on my book in the last 7 days, never mine, never a value', async () => {
  const r = updatesRig({ owner: '2026-09-27T11:00:00+05:30', stage: '2026-09-27T11:00:00+05:30' });
  const res = await r.svc.read(principal(IR));
  assert.equal(res.ok, true);
  const g = Object.fromEntries(res.value.groups.map((x) => [x.kind, x]));
  assert.deepEqual(Object.keys(g).sort(), ['added', 'owner', 'stage']);
  assert.equal(g.owner.unread, 1);
  assert.equal(g.stage.unread, 0, 'seen at 11:00, changed at 10:00');
  assert.equal(g.added.leadCount, 1);
  assert.ok(!JSON.stringify(res).includes('FXPAN'), 'no old or new value leaves');
  assert.ok(!JSON.stringify(r.sink.records()).includes('FXPAN'));
  assert.match(r.calls[0], /Modified_Time >= '2026-09-20T21:00:00\+05:30' and Modified_By != '9007199254740995001'/);
  assert.equal(r.calls.filter((c) => c.includes('__timeline')).length, 2);
});

test('kinds, and marking read', async () => {
  assert.equal(kindOf('updated', ['Lost_Reason']), 'lost');
  assert.equal(kindOf('updated', ['Next_Step_At']), 'next-step');
  assert.equal(kindOf('updated', ['Consent_Call']), 'consent');
  assert.equal(kindOf('updated', ['City']), 'details');
  const r = updatesRig();
  assert.deepEqual(await r.svc.markRead(principal(IR), ['owner', 'stage']), { ok: true });
  assert.deepEqual(r.marks.map((m) => m[1]), ['owner', 'stage']);
  assert.deepEqual(await r.svc.markRead(principal(IR), ['everything']), { ok: false });
});
