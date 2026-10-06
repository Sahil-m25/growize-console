/* CLUSTER C2 — THE LEAD RECORD (ir-write-map.md): notes, permission, details, forecast, and the journey's field-missing
 *
 * Run from console/: node --test src/server/leads/record.test.cjs
 *
 * Type-checks the services with the project's TypeScript, then drives each through the real Zoho client on a synthetic
 * router: every response below is made up here, no request reaches Zoho, and no real person's data is in it.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { before, test } = require('node:test');

const consoleRoot = path.resolve(__dirname, '..', '..', '..');
const srcRoot = path.join(consoleRoot, 'src');
const ts = require(path.join(consoleRoot, 'node_modules', 'typescript'));
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoho-record-'));
process.on('exit', () => fs.rmSync(outDir, { recursive: true, force: true }));

const config = ts.readConfigFile(path.join(consoleRoot, 'tsconfig.json'), ts.sys.readFile);
const project = ts.parseJsonConfigFileContent(config.config, ts.sys, consoleRoot);
const options = { ...project.options, incremental: false, tsBuildInfoFile: undefined, plugins: undefined, module: ts.ModuleKind.CommonJS,
  moduleResolution: ts.ModuleResolutionKind.Node10, noEmit: false, noEmitOnError: true, outDir, rootDir: srcRoot };
const sources = ['lib/zoho/log.ts', 'lib/zoho/client.ts', 'server/state/memory.ts', 'server/leads/notes.ts', 'server/leads/details.ts',
  'server/leads/forecast.ts', 'server/leads/journey.ts'].map((f) => path.join(srcRoot, f));
const program = ts.createProgram(sources, options);
const diagnostics = [...ts.getPreEmitDiagnostics(program), ...program.emit().diagnostics];
if (diagnostics.length) {
  console.error(ts.formatDiagnostics(diagnostics, { getCanonicalFileName: (f) => f, getCurrentDirectory: () => consoleRoot, getNewLine: () => '\n' }));
  process.exit(1);
}
const load = (f) => require(path.join(outDir, f));
const { createMemorySink, createOpsLog } = load('lib/zoho/log.js');
const { createZohoClient, userCredential } = load('lib/zoho/client.js');
const { createMemoryState } = load('server/state/memory.js');
const { createLeadNotes } = load('server/leads/notes.js');
const { createLeadDetails, preferenceOf } = load('server/leads/details.js');
const { createLeadForecast } = load('server/leads/forecast.js');
const { createJourney } = load('server/leads/journey.js');

const P = '9007199254';
const IR = `${P}740995001`, OTHER = `${P}740995009`;
const LEAD = `${P}740996101`, NOTE = `${P}740997901`;
const SESSION = 'session_fixture_record_0001';
const LOADED = '2026-09-27T09:00:00+05:30';
const NOW = Date.parse('2026-09-27T15:30:00Z'); // 21:00 IST, 27 Sep
const immediateGate = () => ({ async acquire() { return { waitedMs: 0, release() {} }; } });
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let credential;
before(async () => {
  credential = await userCredential({ access_token: 'synthetic-ir-token-never-live', api_domain: 'https://www.zohoapis.in', expires_in: 3_600 },
    { recordIdPrefix: P, gate: immediateGate(), log: createOpsLog(createMemorySink()), clock: () => NOW,
      fetch: async () => json(200, { users: [{ id: IR, status: 'active' }] }) });
});
const principal = () => ({ credential, sessionId: SESSION });

/** A synthetic lead as Zoho answers a getRecord: only the fields asked for, null when empty. */
const leadWith = (extra = {}) => ({ id: LEAD, Modified_Time: LOADED, Owner: { id: IR, name: 'x' }, Cover_By: null, Cover_Until: null, Lost_At: null,
  Email: 'investor@example.invalid', Reserved_At: null, Qualified_At: '2026-09-20T10:00:00+05:30', Fully_Paid_At: null, Forecast: null,
  Forecast_Paid_By: null, ...extra });
const UPDATED = () => json(200, { data: [{ code: 'SUCCESS', details: { id: LEAD, Modified_Time: '2026-09-27T21:00:00+05:30' }, message: 'record updated', status: 'success' }] });
const REJECTED = (field, code = 'INVALID_DATA') => json(400, { data: [{ code, details: { api_name: field }, message: 'invalid data', status: 'error' }] });
const CONFLICT = () => json(412, { code: 'ALREADY_MODIFIED', details: {}, message: 'modified', status: 'error' });

/** The real client on a router: `put` and `post` answer writes; GET answers the lead. Every call is kept. */
function rig({ lead = leadWith(), put = UPDATED, post, access } = {}) {
  const calls = [];
  const sink = createMemorySink();
  const log = createOpsLog(sink);
  const crm = createZohoClient({ recordIdPrefix: P, gate: immediateGate(), log, maxAttempts: 1, clock: () => NOW,
    fetch: async (url, init) => {
      const u = new URL(url);
      const call = { method: init.method, path: u.pathname.replace('/crm/v8', ''), search: u.search, headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : null };
      calls.push(call);
      if (init.method === 'GET') {
        const asked = (u.searchParams.get('fields') || '').split(',');
        const L = typeof lead === 'function' ? lead(asked) : lead;
        if (L instanceof Response) return L;
        return json(200, { data: [Object.fromEntries(Object.entries(L).filter(([k]) => k === 'id' || asked.includes(k)))] });
      }
      if (init.method === 'PUT') return put(call);
      if (init.method === 'POST') return post(call);
      throw new Error(`unexpected synthetic CRM request ${init.method} ${u.pathname}`);
    } });
  const acc = { async recheck(c) { return access ? access(c) : { actor: { userId: c.userId, roleId: '', profileId: '', seat: 'investor-relations' }, mayRecordFollowup: true, teamOwnerIds: [] }; } };
  const deps = { crm, access: acc, log, recordIdPrefix: P, clock: () => NOW };
  return { deps, calls, sink, writes: () => calls.filter((c) => c.method !== 'GET') };
}

// ---------------- notes ----------------

test('addNote: one Zoho Note under the Lead, on the person\'s token, no Modified_Time guard; the text never reaches the log', async () => {
  const r = rig({ post: () => json(201, { data: [{ code: 'SUCCESS', details: { id: NOTE }, message: 'record added', status: 'success' }] }) });
  const notes = createLeadNotes({ ...r.deps, state: createMemoryState() });
  const res = await notes.add(principal(), LEAD, '  They want the yield note first  ', 'press-key-0001');
  assert.deepEqual(res, { ok: true, value: { noteId: NOTE, leadId: LEAD } });
  const w = r.writes();
  assert.equal(w.length, 1);
  assert.equal(w[0].path, '/Notes');
  assert.deepEqual(w[0].body.data[0], { Note_Title: 'Note', Note_Content: 'They want the yield note first', Parent_Id: { module: { api_name: 'Leads' }, id: LEAD } });
  assert.equal(w[0].headers['If-Unmodified-Since'], undefined);
  assert.ok(!JSON.stringify(r.sink.records()).includes('yield note'));
});

test('addNote: a double press with the same Idempotency-Key writes one note; the same key for other text is refused', async () => {
  const r = rig({ post: () => json(201, { data: [{ code: 'SUCCESS', details: { id: NOTE }, message: 'record added', status: 'success' }] }) });
  const notes = createLeadNotes({ ...r.deps, state: createMemoryState() });
  const [a, b] = await Promise.all([notes.add(principal(), LEAD, 'Same note', 'press-key-0002'), notes.add(principal(), LEAD, 'Same note', 'press-key-0002')]);
  assert.equal(a.ok && b.ok, true);
  assert.equal(r.writes().length, 1);
  assert.equal((await notes.add(principal(), LEAD, 'Different', 'press-key-0002')).reasonCode, 'key-reused');
});

test('addNote: empty, too long, or not in my book — refused, nothing written', async () => {
  const r = rig({ lead: leadWith({ Owner: { id: OTHER, name: 'y' } }), post: () => { throw new Error('no write'); } });
  const notes = createLeadNotes({ ...r.deps, state: createMemoryState() });
  assert.equal((await notes.add(principal(), LEAD, '   ')).reasonCode, 'note-empty');
  assert.equal((await notes.add(principal(), LEAD, 'x'.repeat(5_001))).reasonCode, 'note-too-long');
  assert.equal((await notes.add(principal(), LEAD, 'A note')).reasonCode, 'not-in-book');
  assert.equal(r.writes().length, 0);
});

test('notes.list: the lead\'s notes read back on the person\'s token, newest first, blank ones dropped — the page\'s "Latest note"', async () => {
  const NOTES = json(200, { data: [
    { id: `${P}740997902`, Note_Title: 'Note', Note_Content: 'Older note', Created_Time: '2026-09-25T10:00:00+05:30', Owner: { id: IR, name: 'x' } },
    { id: `${P}740997903`, Note_Title: 'Note', Note_Content: '   ', Created_Time: '2026-09-26T10:00:00+05:30', Owner: { id: IR, name: 'x' } },
    { id: NOTE, Note_Title: 'Note', Note_Content: 'Newest note', Created_Time: '2026-09-27T10:00:00+05:30', Owner: { id: OTHER, name: 'y' } },
  ], info: { more_records: false } });
  const r = rig({ lead: (asked) => (asked.includes('Note_Content') ? NOTES : leadWith()) });
  const notes = createLeadNotes(r.deps);
  const res = await notes.list(principal(), LEAD);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.deepEqual(res.value.notes.map((n) => [n.text, n.by, n.at]), [['Newest note', OTHER, '2026-09-27T10:00:00+05:30'], ['Older note', IR, '2026-09-25T10:00:00+05:30']]);
  const get = r.calls.find((c) => /\/Leads\/\d+\/Notes$/.test(c.path));
  assert.ok(get, 'one related read of the lead\'s Notes');
  assert.equal(r.writes().length, 0);
  assert.ok(!JSON.stringify(r.sink.records()).includes('Newest note'), 'a note\'s text never reaches the log');
});

test('notes.list: a lead the token cannot see is not-visible; a changed session is refused before any read', async () => {
  const r = rig({ lead: () => json(404, { code: 'INVALID_URL_PATTERN', status: 'error', message: 'no', details: {} }) });
  assert.equal((await createLeadNotes(r.deps).list(principal(), LEAD)).reasonCode, 'not-visible');
  const s = rig({ access: () => null });
  assert.equal((await createLeadNotes(s.deps).list(principal(), LEAD)).reasonCode, 'session-changed');
  assert.equal(s.calls.length, 0);
  assert.equal((await createLeadNotes(s.deps).list(principal(), 'not-an-id')).reasonCode, 'invalid-request');
});

// ---------------- permission ----------------

test('permission: the three Consent_* flags, How from the picklist, when given, and who recorded it — never Consent_Visit', async () => {
  const r = rig();
  const d = createLeadDetails(r.deps);
  const res = await d.permission(principal(), LEAD, LOADED, { con: { msg: true, email: true, call: false, visit: true }, how: 'call', date: '2026-09-27', time: '18:30' });
  assert.equal(res.ok, true);
  const w = r.writes()[0];
  assert.equal(w.headers['If-Unmodified-Since'], LOADED);
  assert.deepEqual(w.body.data[0], { Consent_WhatsApp: true, Consent_Email: true, Consent_Call: false, Consent_By: { id: IR },
    Consent_How: 'Verbal', Consent_At: '2026-09-27T18:30:00+05:30' });
  assert.ok(!JSON.stringify(r.calls).includes('Consent_Visit'), 'no visit consent is read or written');
});

test('permission: clearing every channel is the withdrawal — How and At cleared', async () => {
  const r = rig();
  await createLeadDetails(r.deps).permission(principal(), LEAD, LOADED, { con: { msg: false, email: false, call: false } });
  assert.deepEqual(r.writes()[0].body.data[0], { Consent_WhatsApp: false, Consent_Email: false, Consent_Call: false, Consent_By: { id: IR }, Consent_How: null, Consent_At: null });
});

test('permission: no how, a future time, email with no address, or a stale page — refused', async () => {
  const d = (o) => createLeadDetails(rig(o).deps);
  assert.equal((await d().permission(principal(), LEAD, LOADED, { con: { call: true }, date: '2026-09-27', time: '10:00' })).reasonCode, 'how-needed');
  assert.equal((await d().permission(principal(), LEAD, LOADED, { con: { call: true }, how: 'person', date: '2026-09-28', time: '10:00' })).reasonCode, 'given-at-invalid');
  assert.equal((await d({ lead: leadWith({ Email: null }) }).permission(principal(), LEAD, LOADED, { con: { email: true }, how: 'form', date: '2026-09-27', time: '10:00' })).reasonCode, 'email-needed');
  assert.equal((await d().permission(principal(), LEAD, '2026-09-26T09:00:00+05:30', { con: { call: true }, how: 'person', date: '2026-09-27', time: '10:00' })).reasonCode, 'lead-changed');
  assert.equal((await d({ put: CONFLICT }).permission(principal(), LEAD, LOADED, { con: { call: false } })).reasonCode, 'lead-changed');
});

// ---------------- profile ----------------

test('details: only what was sent, as standard Lead fields; the preference as Preferred_Communication', async () => {
  const r = rig();
  const res = await createLeadDetails(r.deps).profile(principal(), LEAD, LOADED,
    { name: 'Asha  Rao Kumar', mobile: '98765 43210', email: '', city: 'Pune', units: '3', contactPreference: 'WhatsApp' });
  assert.equal(res.ok, true);
  assert.deepEqual(r.writes()[0].body.data[0], { First_Name: 'Asha Rao', Last_Name: 'Kumar', Mobile: '+919876543210', Email: null, City: 'Pune',
    Units_Interested: 3, Preferred_Communication: 'WhatsApp' });
  assert.equal(r.writes()[0].headers['If-Unmodified-Since'], LOADED);
});

test('details: preference words map to the three channels; anything else is not Zoho\'s to hold', () => {
  assert.equal(preferenceOf('email'), 'Email');
  assert.equal(preferenceOf('Phone call'), 'Phone');
  assert.equal(preferenceOf(''), null);
  assert.equal(preferenceOf('after 6pm only'), undefined);
});

test('details: introducer is field-missing; a free-text preference, units after Reserved, a bad mobile — refused, nothing written', async () => {
  const d = (o) => { const r = rig(o); return { r, d: createLeadDetails(r.deps) }; };
  let x = d();
  let res = await x.d.profile(principal(), LEAD, LOADED, { introducedBy: 'meera' });
  assert.equal(res.reasonCode, 'field-missing');
  assert.equal(res.field, 'Introduced_By');
  assert.equal((await x.d.profile(principal(), LEAD, LOADED, { contactPreference: 'after 6pm only' })).reasonCode, 'preference-unsupported');
  assert.equal((await x.d.profile(principal(), LEAD, LOADED, { mobile: '12' })).reasonCode, 'mobile-invalid');
  assert.equal((await x.d.profile(principal(), LEAD, LOADED, {})).reasonCode, 'nothing-changed');
  assert.equal(x.r.writes().length, 0);
  x = d({ lead: leadWith({ Reserved_At: '2026-09-25T10:00:00+05:30' }) });
  assert.equal((await x.d.profile(principal(), LEAD, LOADED, { units: '4' })).reasonCode, 'units-locked');
});

test('details: Zoho\'s duplicate check on Mobile is a named refusal; a field Zoho rejects is field-missing', async () => {
  const dup = createLeadDetails(rig({ put: () => REJECTED('Mobile', 'DUPLICATE_DATA') }).deps);
  assert.equal((await dup.profile(principal(), LEAD, LOADED, { mobile: '9876543210' })).reasonCode, 'duplicate-mobile');
  const res = await createLeadDetails(rig({ put: () => REJECTED('Preferred_Communication') }).deps).profile(principal(), LEAD, LOADED, { contactPreference: 'email' });
  assert.equal(res.reasonCode, 'field-missing');
  assert.equal(res.field, 'Preferred_Communication');
});

// ---------------- forecast ----------------

test('forecast: the category to the picklist, the date as Forecast_Paid_By, guarded', async () => {
  const r = rig();
  const f = createLeadForecast(r.deps);
  const res = await f.set(principal(), LEAD, LOADED, { category: 'probable' });
  assert.deepEqual(res.value, { leadId: LEAD, modifiedTime: '2026-09-27T21:00:00+05:30', forecast: 'Probable', paidBy: null });
  assert.deepEqual(r.writes()[0].body.data[0], { Forecast: 'Probable' });
  assert.equal(r.writes()[0].headers['If-Unmodified-Since'], LOADED);
  const r2 = rig({ lead: leadWith({ Forecast: 'Commit' }) });
  await createLeadForecast(r2.deps).set(principal(), LEAD, LOADED, { paidBy: '2027-01-15' });
  assert.deepEqual(r2.writes()[0].body.data[0], { Forecast_Paid_By: '2027-01-15' });
});

test('forecast: before Qualified, a past date, no category yet, paid in full, an unknown category — refused, nothing written', async () => {
  const f = (o) => { const r = rig(o); return { r, f: createLeadForecast(r.deps) }; };
  const cases = [
    [{ lead: leadWith({ Qualified_At: null }) }, { category: 'commit' }, 'not-qualified'],
    [{ lead: leadWith({ Forecast: 'Commit' }) }, { paidBy: '2026-09-26' }, 'date-past'],
    [{}, { paidBy: '2026-12-01' }, 'category-needed'],
    [{ lead: leadWith({ Forecast: 'Commit', Fully_Paid_At: '2026-09-26T10:00:00+05:30' }) }, { paidBy: '2026-12-01' }, 'already-paid'],
    [{}, { category: 'certain' }, 'category-invalid'],
  ];
  for (const [o, c, code] of cases) {
    const x = f(o);
    assert.equal((await x.f.set(principal(), LEAD, LOADED, c)).reasonCode, code, code);
    assert.equal(x.r.writes().length, 0);
  }
});

// ---------------- journey: the two sandbox fields ----------------

const RUNGS3 = { Next_Step_At: '2026-09-28T11:00:00+05:30', Units_Interested: 2, Secondary_Owner: null, First_Touch_At: '2026-09-27T12:00:00+05:30',
  Qualified_At: '2026-09-27T12:00:00+05:30', Engaged_At: null, Said_Yes_At: null, Reserved_At: null, Fully_Paid_At: null, Allocated_At: null, Onboarded_At: null };

test('journey: an org without Rung_Undone_At / Engagement_Skipped still ticks; untick and skip answer field-missing, naming the field', async () => {
  // Zoho leaves out a field the org does not have.
  const noFields = leadWith({ ...RUNGS3 });
  let r = rig({ lead: noFields });
  const j = createJourney(r.deps);
  let res = await j.untick(principal(), LEAD, LOADED, 'Ticked the wrong rung');
  assert.equal(res.reasonCode, 'field-missing');
  assert.equal(res.field, 'Rung_Undone_At');
  assert.match(res.reason, /Leads\.Rung_Undone_At/);
  res = await j.skip(principal(), LEAD, LOADED);
  assert.equal(res.reasonCode, 'field-missing');
  assert.equal(res.field, 'Engagement_Skipped');
  assert.equal(r.writes().length, 0);
  // Zoho rejecting the field list on the read: read again without the two; the tick goes through.
  let reads = 0;
  r = rig({ lead: (asked) => (reads++ === 0 && asked.includes('Rung_Undone_At') ? REJECTED('Rung_Undone_At') : leadWith({ ...RUNGS3, Qualified_At: null })) });
  res = await createJourney(r.deps).tick(principal(), LEAD, LOADED, true);
  assert.equal(res.ok, true);
  assert.deepEqual(Object.keys(r.writes()[0].body.data[0]), ['Qualified_At']);
});

test('journey: a write Zoho rejects for Engagement_Skipped is field-missing, not a generic Zoho error', async () => {
  const r = rig({ lead: leadWith({ ...RUNGS3, Engagement_Skipped: false, Rung_Undone_At: null }), put: () => REJECTED('Engagement_Skipped') });
  const res = await createJourney(r.deps).skip(principal(), LEAD, LOADED);
  assert.equal(res.kind, 'refused');
  assert.equal(res.reasonCode, 'field-missing');
  assert.equal(res.field, 'Engagement_Skipped');
});
