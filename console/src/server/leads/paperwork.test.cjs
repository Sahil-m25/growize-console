/* M12-S11 / M12-S12 / M12-S13 — THE LEAD PAGE PAPERWORK ROW, THE IR'S WORD FOR FINANCE, AND MATERIAL AFTER THE NDA
 *
 * Run from console/: node --test src/server/leads/paperwork.test.cjs
 *
 * Compiles the paperwork writer (with the front end's own prNext), the hint reader, the email sender and the real
 * Zoho client, then drives them against synthetic recorded responses only (__fixtures__/paperwork). No request
 * reaches Zoho. The round fields are PROPOSED (M12-S11-T01, Sahil); whether live Zoho takes them is the sandbox's.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { before, test } = require('node:test');

const consoleRoot = path.resolve(__dirname, '..', '..', '..');
const fixtureRoot = path.join(consoleRoot, 'src', 'lib', 'zoho', '__fixtures__', 'paperwork');
const emailFixtures = path.join(consoleRoot, 'src', 'lib', 'zoho', '__fixtures__', 'email');
const ts = require(path.join(consoleRoot, 'node_modules', 'typescript'));
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoho-paperwork-'));
process.on('exit', () => fs.rmSync(outDir, { recursive: true, force: true }));

const config = ts.readConfigFile(path.join(consoleRoot, 'tsconfig.json'), ts.sys.readFile);
const project = ts.parseJsonConfigFileContent(config.config, ts.sys, consoleRoot);
const options = { ...project.options, incremental: false, tsBuildInfoFile: undefined, plugins: undefined,
  module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10, noEmit: false, noEmitOnError: true, outDir, rootDir: consoleRoot };
const sources = ['lib/zoho/errors.ts', 'lib/zoho/gate.ts', 'lib/zoho/log.ts', 'lib/zoho/client.ts', 'server/oauth/seat.ts', 'domain/plan.ts',
  'server/leads/capture.ts', 'server/leads/followup.ts', 'server/leads/email.ts', 'server/leads/journey.ts', 'server/leads/paperwork.ts',
  'server/leads/hints.ts', 'server/documents/queue.ts', 'lib/selectors/finance-rank.ts'].map((f) => path.join(consoleRoot, 'src', f));
const program = ts.createProgram(sources, options);
const diags = [...ts.getPreEmitDiagnostics(program), ...program.emit().diagnostics];
if (diags.length) {
  console.error(ts.formatDiagnostics(diags, { getCanonicalFileName: (f) => f, getCurrentDirectory: () => consoleRoot, getNewLine: () => '\n' }));
  process.exit(1);
}
process.env.NODE_PATH = path.join(consoleRoot, 'node_modules');
Module._initPaths();
const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  const r = request.startsWith('@/') ? path.join(outDir, 'src', request.slice(2)) : request;
  return resolveFilename.call(this, r, ...rest);
};
const load = (file) => require(path.join(outDir, 'src', file));
const { createMemorySink, createOpsLog } = load('lib/zoho/log.js');
const { createZohoClient, userCredential } = load('lib/zoho/client.js');
const { createPaperwork, PROPOSED_LEAD_FIELDS, PAPER_UNDO_MS, backOf, BACK_FIELDS } = load('server/leads/paperwork.js');
const { createPaperworkQueue } = load('server/documents/queue.js');
const { createHintReader, hintForDocument, rankForFinance, NOT_A_SIGNATURE } = load('server/leads/hints.js');
const { createFollowups } = load('server/leads/followup.js');
const { createEmailSender, createLeadNdaReader, EMAIL_REASON } = load('server/leads/email.js');

const P = '9007199254';
const IR = `${P}740995001`, LEAD = `${P}740996101`, TOUCH = `${P}740997701`, NOTE = `${P}740997801`, ATT = `${P}740999502`;
const CONTACT = `${P}740996201`, L2 = `${P}740996102`, L3 = `${P}740996103`;
const SESSION = 'session_fixture_paper_0001';
const SECRET = 'synthetic-undo-secret-never-live-0000000001';
const TOKEN = 'synthetic-ir-token-never-live';
const LOADED = '2026-09-27T09:00:00+05:30';
let now = Date.parse('2026-09-28T05:30:00Z'); // 11:00 IST
const clock = () => now;

const recorded = (dir, name) => JSON.parse(fs.readFileSync(path.join(dir, `${name}.response.json`), 'utf8'));
const toResponse = (r) => new Response(r.status === 204 ? null : JSON.stringify(r.body), { status: r.status, headers: r.headers || {} });
const immediateGate = () => ({ async acquire() { return { waitedMs: 0, release() {} }; } });
let credential;
before(async () => {
  credential = await userCredential({ access_token: TOKEN, api_domain: 'https://www.zohoapis.in', expires_in: 3_600 },
    { recordIdPrefix: P, gate: immediateGate(), log: createOpsLog(createMemorySink()), clock: () => now,
      fetch: async () => toResponse({ status: 200, body: { users: [{ id: IR, status: 'active' }] } }) });
});
const principal = (sessionId = SESSION) => ({ credential, sessionId });

/** routes: "METHOD /path" → fixture name (or a list, served in order); "COQL <substring>" → fixture for a COQL query. */
function rig(routes, opts = {}) {
  const calls = [];
  const sink = createMemorySink();
  const log = createOpsLog(sink);
  const crm = createZohoClient({ recordIdPrefix: P, gate: immediateGate(), log, maxAttempts: 1, clock, sleep: async () => {},
    fetch: async (url, init) => {
      const u = new URL(url);
      const key = `${init.method} ${u.pathname.replace('/crm/v8', '')}`;
      const body = init.body && typeof init.body === 'string' ? JSON.parse(init.body) : null;
      calls.push({ key, headers: init.headers, body });
      let name = routes[key];
      if (key === 'POST /coql') {
        const q = body.select_query;
        const hit = Object.keys(routes).find((k) => k.startsWith('COQL ') && q.includes(k.slice(5)));
        name = hit ? routes[hit] : undefined;
        // W3-E2E-4: Finance's supplementary side is read whenever the row is; nothing sent unless a test says so.
        if (!name && /^select id, Origin_Lead from Contacts where Origin_Lead/.test(q)) name = 'coql.contact-of-lead';
        if (!name && /from LLP_UnitAllocation_Module where Customer/.test(q)) name = 'coql.empty';
        if (!name) throw new Error(`unexpected synthetic COQL ${q}`);
      }
      if (Array.isArray(name)) name = name.shift();
      if (!name) throw new Error(`unexpected synthetic CRM request ${key}`);
      return toResponse(recorded(opts.dir || fixtureRoot, name));
    } });
  const access = { async recheck(c, sid) { return opts.access ? opts.access(c, sid) :
    { actor: { userId: c.userId, roleId: `${P}740998001`, profileId: `${P}740998002`, seat: 'investor-relations' }, mayRecordFollowup: true, teamOwnerIds: [] }; } };
  const svc = createPaperwork({ crm, access, log, recordIdPrefix: P, undoSecret: SECRET, clock });
  return { svc, crm, log, access, calls, sink,
    writes: () => calls.filter((c) => /^(PUT|DELETE)/.test(c.key) || (c.key.startsWith('POST') && c.key !== 'POST /coql')),
    events: () => sink.records().filter((r) => r.kind === 'event'),
    refusals: () => sink.records().filter((r) => r.kind === 'refusal') };
}
const LEAD_GET = `GET /Leads/${LEAD}`, LEAD_PUT = `PUT /Leads/${LEAD}`;
const offer = (row, round, beat) => row.offers.find((o) => o.round === round && o.beat === beat);
async function tokenFor(fixture, round, beat) {
  const r = rig({ [LEAD_GET]: fixture });
  const row = await r.svc.read(principal(), LEAD);
  assert.equal(row.ok, true, JSON.stringify(row));
  const o = offer(row.value, round, beat);
  assert.ok(o, `${fixture} offers ${round}/${beat}`);
  return o.rowToken;
}
const noText = (sink, words) => { const t = JSON.stringify(sink.records()); for (const w of words) assert.ok(!t.includes(w), `Plane B must not carry ${w}`); };

/* ---- M12-S11-T02: the NDA loop -------------------------------------------------------------------- */

test('field contract: every IR beat field is on the Lead and PROPOSED (none exist in the org yet)', () => {
  assert.equal(PROPOSED_LEAD_FIELDS.length, 24);
  assert.ok(PROPOSED_LEAD_FIELDS.every((f) => /^(NDA|Supp)_/.test(f)));
  assert.equal(PAPER_UNDO_MS, 10_000);
});

test('TC-E09-001: NDA sent by Finance → the IR\'s move is "told", one chip per consented channel; supplementary waits', async () => {
  const r = rig({ [LEAD_GET]: 'lead.nda-sent' });
  const res = await r.svc.read(principal(), LEAD);
  assert.equal(res.ok, true, JSON.stringify(res));
  const nda = res.value.rounds.find((x) => x.round === 'nda');
  assert.deepEqual({ ...nda.next }, { k: 'told', t: 'Tell them it is there', who: 'IR' });
  assert.equal(nda.sent, true);
  assert.deepEqual(res.value.offers.map((o) => [o.round, o.beat, [...o.channels]]), [['nda', 'told', ['call', 'msg', 'email']]]);
  assert.equal(res.value.rounds.find((x) => x.round === 'supp').next.k, 'wait');
  assert.equal(r.writes().length, 0);
});

test('Finance has not sent the NDA → the move is Finance\'s; the IR is offered only G1\'s "ask Finance to send it"', async () => {
  const r = rig({ [LEAD_GET]: 'lead.nda-not-sent' });
  const res = await r.svc.read(principal(), LEAD);
  const nda = res.value.rounds.find((x) => x.round === 'nda');
  assert.equal(nda.next.k, 'sent');
  assert.equal(nda.next.who, 'Finance');
  assert.equal(nda.requested, null);
  assert.deepEqual(res.value.offers.map((o) => [o.round, o.beat, o.channels.length]), [['nda', 'request', 0]]);
});

test('TC-E09-002: told by WhatsApp writes told (channel, by, at) guarded, one log line, and a 10 s Undo restores it', async () => {
  const rowToken = await tokenFor('lead.nda-sent', 'nda', 'told');
  const r = rig({ [LEAD_GET]: 'lead.nda-sent', [LEAD_PUT]: ['lead.updated', 'lead.restored'] });
  const res = await r.svc.step(principal(), { leadId: LEAD, round: 'nda', beat: 'told', channel: 'msg', rowToken });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.deepEqual(r.writes().map((c) => c.key), [LEAD_PUT]);
  const put = r.writes()[0];
  assert.equal(put.headers['If-Unmodified-Since'] ?? put.headers['if-unmodified-since'], LOADED);
  assert.deepEqual(put.body.data[0], { NDA_Told_Via: 'WhatsApp', NDA_Told_At: '2026-09-28T11:00:00+05:30', NDA_Told_By: { id: IR } });
  assert.equal(r.events().length, 1);
  assert.equal(r.events()[0].reason, 'nda-told');
  assert.equal(res.value.undoUntil - now, 10_000);

  const u = await r.svc.undo(principal(), res.value.undoToken);
  assert.equal(u.ok, true, JSON.stringify(u));
  const back = r.writes()[1];
  assert.equal(back.key, LEAD_PUT);
  assert.deepEqual(back.body.data[0], { NDA_Told_Via: null, NDA_Told_At: null, NDA_Told_By: null });
  assert.equal(back.headers['If-Unmodified-Since'] ?? back.headers['if-unmodified-since'], '2026-09-28T11:00:00+05:30');
});

test('TC-E09-003: a reminder by call writes the chase, one Touch and one Note (one contact), and one log line', async () => {
  const rowToken = await tokenFor('lead.nda-told', 'nda', 'chase');
  const r = rig({ [LEAD_GET]: 'lead.nda-told', [LEAD_PUT]: 'lead.updated', 'POST /Touches': 'touch.created', 'POST /Notes': 'note.created' });
  const res = await r.svc.step(principal(), { leadId: LEAD, round: 'nda', beat: 'chase', channel: 'call', rowToken });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.deepEqual(r.writes().map((c) => c.key), [LEAD_PUT, 'POST /Touches', 'POST /Notes']);
  assert.deepEqual(r.writes()[0].body.data[0], { NDA_Chase_Count: 1, NDA_Last_Chase_At: '2026-09-28T11:00:00+05:30', NDA_Last_Chase_Via: 'Call' });
  const touch = r.writes()[1].body.data[0];
  assert.equal(touch.Channel, 'Call');
  assert.deepEqual(touch.Lead, { id: LEAD });
  assert.equal(touch.Is_Reply, false);
  assert.equal(r.writes()[2].body.data[0].Parent_Id.id, LEAD);
  assert.equal(res.value.touchId, TOUCH);
  assert.equal(res.value.noteId, NOTE);
  assert.equal(r.events().length, 1);
  noText(r.sink, ['NDA reminder by Call', 'asked for the signed copy']);
});

test('TC-E09-004: Undo of a reminder restores the count and deletes the Note and the Touch', async () => {
  const rowToken = await tokenFor('lead.nda-told', 'nda', 'chase');
  const r = rig({ [LEAD_GET]: 'lead.nda-told', [LEAD_PUT]: ['lead.updated', 'lead.restored'], 'POST /Touches': 'touch.created', 'POST /Notes': 'note.created',
    [`DELETE /Notes/${NOTE}`]: 'note.deleted', [`DELETE /Touches/${TOUCH}`]: 'touch.deleted' });
  const res = await r.svc.step(principal(), { leadId: LEAD, round: 'nda', beat: 'chase', channel: 'call', rowToken });
  const u = await r.svc.undo(principal(), res.value.undoToken);
  assert.equal(u.ok, true, JSON.stringify(u));
  assert.deepEqual(r.writes().slice(3).map((c) => c.key), [LEAD_PUT, `DELETE /Notes/${NOTE}`, `DELETE /Touches/${TOUCH}`]);
  assert.deepEqual(r.writes()[3].body.data[0], { NDA_Chase_Count: null, NDA_Last_Chase_At: null, NDA_Last_Chase_Via: null });
});

test('a reminder whose Note fails takes back the Touch and the lead; nothing half-written stays', async () => {
  const rowToken = await tokenFor('lead.nda-told', 'nda', 'chase');
  const r = rig({ [LEAD_GET]: 'lead.nda-told', [LEAD_PUT]: ['lead.updated', 'lead.restored'], 'POST /Touches': 'touch.created', 'POST /Notes': 'server-error',
    [`DELETE /Touches/${TOUCH}`]: 'touch.deleted' });
  const res = await r.svc.step(principal(), { leadId: LEAD, round: 'nda', beat: 'chase', channel: 'call', rowToken });
  assert.equal(res.ok, false);
  assert.equal(res.kind, 'source-error');
  assert.deepEqual(r.writes().map((c) => c.key), [LEAD_PUT, 'POST /Touches', 'POST /Notes', `DELETE /Touches/${TOUCH}`, LEAD_PUT]);
});

test('TC-E09-005: "They say it\'s signed" stamps said; the row is then Finance\'s with nothing offered', async () => {
  const rowToken = await tokenFor('lead.nda-chased-once', 'nda', 'said');
  const r = rig({ [LEAD_GET]: 'lead.nda-chased-once', [LEAD_PUT]: 'lead.updated' });
  const res = await r.svc.step(principal(), { leadId: LEAD, round: 'nda', beat: 'said', rowToken });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.deepEqual(r.writes()[0].body.data[0], { NDA_Said_At: '2026-09-28T11:00:00+05:30', NDA_Said_By: { id: IR } });
  const after = rig({ [LEAD_GET]: 'lead.nda-said' });
  const row = await after.svc.read(principal(), LEAD);
  const nda = row.value.rounds.find((x) => x.round === 'nda');
  assert.deepEqual({ ...nda.next }, { k: 'ok', t: 'Verify the signed copy', who: 'Finance' });
  assert.equal(row.value.offers.filter((o) => o.round === 'nda').length, 0);
});

test('TC-E09-006: a write without the row\'s token, or with another beat\'s, is refused and nothing reaches Zoho', async () => {
  const r = rig({});
  const none = await r.svc.step(principal(), { leadId: LEAD, round: 'nda', beat: 'said', rowToken: '' });
  assert.equal(none.reasonCode, 'not-from-row');
  const chase = await tokenFor('lead.nda-chased-once', 'nda', 'chase');
  const other = await r.svc.step(principal(), { leadId: LEAD, round: 'nda', beat: 'said', rowToken: chase });
  assert.equal(other.reasonCode, 'not-from-row');
  const forged = chase.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'));
  assert.equal((await r.svc.step(principal(), { leadId: LEAD, round: 'nda', beat: 'chase', channel: 'call', rowToken: forged })).reasonCode, 'not-from-row');
  const s2 = await r.svc.step(principal('session_fixture_paper_0002'), { leadId: LEAD, round: 'nda', beat: 'chase', channel: 'call', rowToken: chase });
  assert.equal(s2.reasonCode, 'not-from-row');
  now += 16 * 60_000;
  assert.equal((await r.svc.step(principal(), { leadId: LEAD, round: 'nda', beat: 'chase', channel: 'call', rowToken: chase })).reasonCode, 'not-from-row');
  now -= 16 * 60_000;
  assert.equal(r.calls.length, 0);
  assert.ok(r.refusals().every((x) => x.reason === 'not-from-row'));
});

test('TC-E05-010: paperwork cannot be written from Today — a direct "they say it\'s signed" with no row token is refused, nothing reaches Zoho, the NDA still waits', async () => {
  const r = rig({});
  for (const rowToken of [undefined, '', 'today', null]) {
    const res = await r.svc.step(principal(), { leadId: LEAD, round: 'nda', beat: 'said', rowToken });
    assert.equal(res.ok, false);
    assert.equal(res.reasonCode, 'not-from-row');
  }
  assert.equal(r.calls.length, 0);
  const after = rig({ [LEAD_GET]: 'lead.nda-told' });
  const row = await after.svc.read(principal(), LEAD);
  const nda = row.value.rounds.find((x) => x.round === 'nda');
  assert.equal(nda.said, null);
  assert.equal(nda.next.k, 'said');
  assert.equal(after.writes().length, 0);
});

test('TC-E09-007: Finance beats (send, verify…) are refused with a Plane B line; nothing is read or written', async () => {
  const r = rig({});
  for (const beat of ['sent', 'send', 'ok', 'verify', 'bounce']) {
    const res = await r.svc.step(principal(), { leadId: LEAD, round: 'nda', beat, rowToken: 'x' });
    assert.equal(res.reasonCode, 'finance-beat', beat);
  }
  assert.equal(r.calls.length, 0);
  assert.equal(r.refusals().filter((x) => x.reason === 'finance-beat' && x.action === 'lead-paperwork').length, 5);
});

test('order: a token for "said" is refused once the lead is back at "told"; a changed lead is refused before any write', async () => {
  const said = await tokenFor('lead.nda-told', 'nda', 'said');
  const r = rig({ [LEAD_GET]: 'lead.nda-sent' });
  assert.equal((await r.svc.step(principal(), { leadId: LEAD, round: 'nda', beat: 'said', rowToken: said })).reasonCode, 'out-of-order');
  const r2 = rig({ [LEAD_GET]: 'lead.nda-told', [LEAD_PUT]: 'conflict' });
  assert.equal((await r2.svc.step(principal(), { leadId: LEAD, round: 'nda', beat: 'said', rowToken: said })).reasonCode, 'lead-changed');
  assert.deepEqual(r2.writes().map((c) => c.key), [LEAD_PUT]);
  const r3 = rig({ [LEAD_GET]: 'lead.nda-verified' });
  assert.equal((await r3.svc.step(principal(), { leadId: LEAD, round: 'nda', beat: 'said', rowToken: said })).reasonCode, 'out-of-order');
  assert.equal(r.writes().length + r3.writes().length, 0);
});

test('TC-E09-008: no email consent → no email chip, and a reminder by email is refused', async () => {
  const r = rig({ [LEAD_GET]: 'lead.nda-told-no-email' });
  const row = await r.svc.read(principal(), LEAD);
  assert.deepEqual([...offer(row.value, 'nda', 'chase').channels], ['call', 'msg']);
  const res = await r.svc.step(principal(), { leadId: LEAD, round: 'nda', beat: 'chase', channel: 'email', rowToken: offer(row.value, 'nda', 'chase').rowToken });
  assert.equal(res.reasonCode, 'no-consent');
  assert.equal(r.writes().length, 0);
});

test('TC-E09-009: a lead not in the book offers nothing and refuses the write; a lost lead too', async () => {
  const r = rig({ [LEAD_GET]: 'lead.other-owner' });
  const row = await r.svc.read(principal(), LEAD);
  assert.deepEqual(row.value.offers, []);
  const tok = await tokenFor('lead.nda-told', 'nda', 'said');
  assert.equal((await r.svc.step(principal(), { leadId: LEAD, round: 'nda', beat: 'said', rowToken: tok })).reasonCode, 'not-in-book');
  const lost = rig({ [LEAD_GET]: 'lead.lost' });
  assert.equal((await lost.svc.step(principal(), { leadId: LEAD, round: 'nda', beat: 'said', rowToken: tok })).reasonCode, 'lead-lost');
  assert.equal(r.writes().length + lost.writes().length, 0);
});

test('Zoho Sign reports the NDA signed → the round reads done whatever the IR said', async () => {
  const r = rig({ [LEAD_GET]: 'lead.nda-verified' });
  const row = await r.svc.read(principal(), LEAD);
  const nda = row.value.rounds.find((x) => x.round === 'nda');
  assert.equal(nda.next.k, 'done');
  assert.equal(nda.verified, true);
  assert.equal(row.value.offers.filter((o) => o.round === 'nda').length, 0);
});

test('Undo: expired after 10 s, and refused for another sign-in', async () => {
  const rowToken = await tokenFor('lead.nda-sent', 'nda', 'told');
  const r = rig({ [LEAD_GET]: 'lead.nda-sent', [LEAD_PUT]: 'lead.updated' });
  const res = await r.svc.step(principal(), { leadId: LEAD, round: 'nda', beat: 'told', channel: 'call', rowToken });
  assert.equal((await r.svc.undo(principal('session_fixture_paper_0002'), res.value.undoToken)).reasonCode, 'undo-invalid');
  assert.equal((await r.svc.undo(principal(), rowToken)).reasonCode, 'undo-invalid', 'a row token is not an Undo');
  now += 10_001;
  assert.equal((await r.svc.undo(principal(), res.value.undoToken)).reasonCode, 'undo-expired');
  now -= 10_001;
  assert.equal(r.writes().length, 1);
});

/* ---- M12-S12-T01: the supplementary draft loop --------------------------------------------------- */

test('TC-E09-010: NDA verified at "said yes" → "send the draft" is offered; no file or link → draft-needed', async () => {
  const r = rig({ [LEAD_GET]: 'lead.supp-start' });
  const row = await r.svc.read(principal(), LEAD);
  const supp = row.value.rounds.find((x) => x.round === 'supp');
  assert.deepEqual({ ...supp.next }, { k: 'draft', t: 'Send the draft', who: 'IR' });
  const o = offer(row.value, 'supp', 'draft');
  const res = await r.svc.step(principal(), { leadId: LEAD, round: 'supp', beat: 'draft', rowToken: o.rowToken });
  assert.equal(res.reasonCode, 'draft-needed');
});

test('TC-E09-011: Draft sent with a pasted Zoho link records version 1 with its link', async () => {
  const rowToken = await tokenFor('lead.supp-start', 'supp', 'draft');
  const r = rig({ [LEAD_GET]: 'lead.supp-start', [LEAD_PUT]: 'lead.updated' });
  const res = await r.svc.step(principal(), { leadId: LEAD, round: 'supp', beat: 'draft', link: 'https://writer.zoho.in/SUPP-L5-v1', rowToken });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.value.draftVersion, 1);
  assert.deepEqual(r.writes()[0].body.data[0], { Supp_Draft_Version: 1, Supp_Draft_Ref: 'https://writer.zoho.in/SUPP-L5-v1',
    Supp_Draft_At: '2026-09-28T11:00:00+05:30', Supp_Draft_By: { id: IR } });
  noText(r.sink, ['SUPP-L5-v1']);
  const bad = await r.svc.step(principal(), { leadId: LEAD, round: 'supp', beat: 'draft', link: 'https://example.com/x', rowToken });
  assert.equal(bad.reasonCode, 'invalid-request');
});

test('Draft sent with a file uploaded through M12-S02: the attachment must be on this lead', async () => {
  const rowToken = await tokenFor('lead.supp-start', 'supp', 'draft');
  const r = rig({ [LEAD_GET]: 'lead.supp-start', [`GET /Leads/${LEAD}/Attachments`]: 'attachments.lead', [LEAD_PUT]: 'lead.updated' });
  const res = await r.svc.step(principal(), { leadId: LEAD, round: 'supp', beat: 'draft', attachmentId: ATT, rowToken });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(r.writes()[0].body.data[0].Supp_Draft_Ref, `attachment:${ATT}`);
  const r2 = rig({ [LEAD_GET]: 'lead.supp-start', [`GET /Leads/${LEAD}/Attachments`]: 'attachments.lead' });
  const no = await r2.svc.step(principal(), { leadId: LEAD, round: 'supp', beat: 'draft', attachmentId: `${P}740999999`, rowToken });
  assert.equal(no.reasonCode, 'draft-not-on-lead');
  assert.equal(r2.writes().length, 0);
});

test('TC-E09-012: New draft increments the version (earlier files stay on the lead)', async () => {
  const rowToken = await tokenFor('lead.supp-draft-v1', 'supp', 'redraft');
  const r = rig({ [LEAD_GET]: 'lead.supp-draft-v1', [LEAD_PUT]: 'lead.updated' });
  const res = await r.svc.step(principal(), { leadId: LEAD, round: 'supp', beat: 'redraft', link: 'https://writer.zoho.in/SUPP-L5-v2', rowToken });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.value.draftVersion, 2);
  assert.equal(r.writes()[0].body.data[0].Supp_Draft_Version, 2);
  assert.ok(!r.writes().some((c) => c.key.startsWith('DELETE')));
});

test('TC-E09-013: Final draft agreed marks the agreed version and link; Undo restores the draft state', async () => {
  const rowToken = await tokenFor('lead.supp-draft-v1', 'supp', 'agreed');
  const r = rig({ [LEAD_GET]: 'lead.supp-draft-v1', [LEAD_PUT]: ['lead.updated', 'lead.restored'] });
  const res = await r.svc.step(principal(), { leadId: LEAD, round: 'supp', beat: 'agreed', link: 'https://workdrive.zoho.in/SUPP-L5-final', rowToken });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.deepEqual(r.writes()[0].body.data[0], { Supp_Agreed_At: '2026-09-28T11:00:00+05:30', Supp_Agreed_By: { id: IR },
    Supp_Agreed_Version: 1, Supp_Agreed_Ref: 'https://workdrive.zoho.in/SUPP-L5-final' });
  const u = await r.svc.undo(principal(), res.value.undoToken);
  assert.equal(u.ok, true);
  assert.deepEqual(r.writes()[1].body.data[0], { Supp_Agreed_At: null, Supp_Agreed_By: null, Supp_Agreed_Version: null, Supp_Agreed_Ref: null });
});

test('after agreement the row is Finance\'s (read from the allotment); once Finance sends, telling is the IR\'s again', async () => {
  const notSent = rig({ [LEAD_GET]: 'lead.supp-agreed', 'COQL from Contacts': 'coql.contact-of-lead', 'COQL from LLP_UnitAllocation_Module': 'coql.empty' });
  const a = await notSent.svc.read(principal(), LEAD);
  assert.deepEqual({ ...a.value.rounds.find((x) => x.round === 'supp').next }, { k: 'sent', t: 'Send it for signature', who: 'Finance' });
  assert.deepEqual(a.value.offers.map((o) => [o.round, o.beat]), [['supp', 'request']], 'G1: the agreed supplementary can be asked for');
  const sent = rig({ [LEAD_GET]: 'lead.supp-agreed', 'COQL from Contacts': 'coql.contact-of-lead', 'COQL from LLP_UnitAllocation_Module': 'coql.allotment-supp-sent' });
  const b = await sent.svc.read(principal(), LEAD);
  assert.equal(b.value.rounds.find((x) => x.round === 'supp').next.k, 'told');
  assert.ok(offer(b.value, 'supp', 'told'));
  const failed = rig({ [LEAD_GET]: 'lead.supp-agreed', 'COQL from Contacts': 'server-error' });
  const c = await failed.svc.read(principal(), LEAD);
  assert.equal(c.value.suppUnread, true);
  assert.equal(c.value.offers.length, 0);
});

test('TC-E09-014: before the NDA is signed no supplementary step is offered, and a supplementary write is refused', async () => {
  const r = rig({ [LEAD_GET]: 'lead.nda-said' });
  const row = await r.svc.read(principal(), LEAD);
  assert.equal(row.value.rounds.find((x) => x.round === 'supp').next.k, 'wait');
  assert.equal(row.value.offers.filter((o) => o.round === 'supp').length, 0);
  const tok = await tokenFor('lead.supp-start', 'supp', 'draft');
  const res = await r.svc.step(principal(), { leadId: LEAD, round: 'supp', beat: 'draft', link: 'https://writer.zoho.in/SUPP-L5-v1', rowToken: tok });
  assert.equal(res.reasonCode, 'out-of-order');
  assert.equal(r.writes().length, 0);
  // the NDA round never takes draft beats
  const n = await r.svc.step(principal(), { leadId: LEAD, round: 'nda', beat: 'draft', link: 'https://writer.zoho.in/x', rowToken: tok });
  assert.equal(n.reasonCode, 'out-of-order');
});

/* ---- M12-S11-T03: the IR's word, matched per document -------------------------------------------- */

test('TC-IM07-008/009: hints read by lead; a verified NDA carries none; the note is "not a signature"', async () => {
  const r = rig({ 'COQL from Leads': 'coql.hints' });
  const h = createHintReader({ crm: r.crm, log: r.log, recordIdPrefix: P, clock });
  const res = await h.byLeads(credential, [LEAD, L2, L3, 'junk']);
  assert.equal(res.ok, true);
  assert.deepEqual(res.hints.get(LEAD).map((x) => [x.paper, x.by.name, x.words]), [['supplementary', 'Rohit Verma', 'They say the supplementary is signed and sent']]);
  assert.deepEqual(res.hints.get(L2).map((x) => x.paper), ['nda']);
  assert.equal(res.hints.has(L3), false, 'NDA already verified: no hint');
  const q = r.calls.find((c) => c.key === 'POST /coql').body.select_query;
  assert.match(q, new RegExp(`where id in \\('${LEAD}', '${L2}', '${L3}'\\) limit 0, 100`));
  assert.equal(NOT_A_SIGNATURE, 'That is what they were told, not a signature.');
});

test('TC-IM07-010: a hint about the supplementary never shows on another document of the same investor', async () => {
  const r = rig({ 'COQL from Leads': 'coql.hints', 'COQL from Contacts': 'coql.contacts-origin' });
  const h = createHintReader({ crm: r.crm, log: r.log, recordIdPrefix: P, clock });
  const res = await h.byLeads(credential, [LEAD]);
  const leads = await h.leadsForContacts(credential, [CONTACT]);
  const leadId = leads.leads.get(CONTACT);
  assert.equal(leadId, LEAD);
  assert.equal(hintForDocument({ paper: 'supplementary', leadId }, res.hints).paper, 'supplementary');
  assert.equal(hintForDocument({ paper: 'allocation-letter', leadId }, res.hints), null);
  assert.equal(hintForDocument({ paper: 'nda', leadId }, res.hints), null);
  assert.equal(hintForDocument({ paper: 'fema', leadId }, res.hints), null);
  assert.equal(hintForDocument({ paper: 'supplementary', leadId: L2 }, res.hints), null);
});

test('Finance queue: the IR\'s word first, then age; a failed hint read falls back to age order and says so', async () => {
  const r = rig({ 'COQL from Leads': 'coql.hints' });
  const h = createHintReader({ crm: r.crm, log: r.log, recordIdPrefix: P, clock });
  const res = await h.byLeads(credential, [LEAD, L2]);
  const items = [
    { id: 'old-alloc', paper: 'allocation-letter', leadId: LEAD, sentAt: '2026-08-01T10:00:00+05:30' },
    { id: 'kiran-supp', paper: 'supplementary', leadId: LEAD, sentAt: '2026-09-10T10:00:00+05:30' },
    { id: 'mid-nda', paper: 'nda', leadId: `${P}740996109`, sentAt: '2026-08-15T10:00:00+05:30' },
  ];
  const ranked = rankForFinance(items, res);
  assert.deepEqual(ranked.items.map((x) => x.id), ['kiran-supp', 'old-alloc', 'mid-nda']);
  assert.equal(ranked.irSideRead, true);
  const bad = rig({ 'COQL from Leads': 'server-error' });
  const failed = await createHintReader({ crm: bad.crm, log: bad.log, recordIdPrefix: P, clock }).byLeads(credential, [LEAD]);
  assert.equal(failed.ok, false);
  const fb = rankForFinance(items, failed);
  assert.deepEqual(fb.items.map((x) => x.id), ['old-alloc', 'mid-nda', 'kiran-supp']);
  assert.equal(fb.irSideRead, false);
  assert.match(fb.note, /could not be read/);
  assert.ok(bad.refusals().some((x) => x.action === 'lead-hints'));
});

/* ---- M12-S11-NOTE-3: Finance's queue route, in the order to work it ------------------------------- */

const docRow = (o) => ({ key: `${o.paper}:${o.id}`, label: o.paper, scope: 'allotment', module: 'LLP_UnitAllocation_Module', recordId: o.id, party: 'Synthetic', llpId: null,
  requestId: '90071992547409981', method: null, state: 'sent', verifiedAt: null, yourMove: null, sign: { status: 'sent', sentAt: o.sentAt, sentBy: null, expiresAt: null }, ...o });
const pageOf = (rows, over = {}) => ({ ok: true, page: { side: 'investors', cut: 'out', rows, outCount: rows.length, files: null, actions: { send: true, verify: true }, truncated: false, ...over } });
const queueRows = () => [
  docRow({ id: 'old-alloc', paper: 'allocation-letter', contactId: `${P}740996209`, sentAt: '2026-08-01T10:00:00+05:30' }),
  docRow({ id: 'kiran-supp', paper: 'supplementary', contactId: CONTACT, sentAt: '2026-09-10T10:00:00+05:30' }),
  docRow({ id: 'mid-fema', paper: 'fema', contactId: `${P}740996208`, sentAt: '2026-08-15T10:00:00+05:30' }),
];

test('M12-S11-NOTE-3: the queue puts the IR\'s word first (supplementary of that lead only), then age; the other papers carry no hint', async () => {
  const r = rig({ 'COQL from Leads': 'coql.hints', 'COQL from Contacts': 'coql.contacts-origin' });
  const reads = [];
  const q = createPaperworkQueue({ documents: { read: async (cred, seat, cut) => { reads.push([seat, cut]); return pageOf(queueRows()); } },
    hints: createHintReader({ crm: r.crm, log: r.log, recordIdPrefix: P, clock }) });
  const res = await q.read(credential, 'fin');
  assert.equal(res.ok, true);
  assert.deepEqual(reads, [['fin', 'out']], 'one Documents read, cut "out", as the viewer\'s seat');
  assert.deepEqual(res.queue.rows.map((x) => x.recordId), ['kiran-supp', 'old-alloc', 'mid-fema']);
  assert.equal(res.queue.rows[0].hint.paper, 'supplementary');
  assert.equal(res.queue.rows[0].leadId, LEAD);
  assert.deepEqual(res.queue.rows.slice(1).map((x) => x.hint), [null, null]);
  assert.equal(res.queue.irSideRead, true);
  assert.equal(res.queue.note, null);
  assert.equal(res.queue.outCount, 3);
  assert.equal('sentAt' in res.queue.rows[0], false, 'ranking scaffolding is not part of the answer');
  assert.equal(r.calls.filter((c) => c.key === 'POST /coql').every((c) => !/PAN|Bank|Aadhaar/i.test(c.body.select_query)), true, 'no identity field is read');
});

test('M12-S11-NOTE-3: a failed IR-side read says so and the queue is in age order; no supplementary row means no extra reads', async () => {
  const bad = rig({ 'COQL from Leads': 'server-error', 'COQL from Contacts': 'coql.contacts-origin' });
  const q = createPaperworkQueue({ documents: { read: async () => pageOf(queueRows()) }, hints: createHintReader({ crm: bad.crm, log: bad.log, recordIdPrefix: P, clock }) });
  const res = await q.read(credential, 'fin');
  assert.equal(res.ok, true);
  assert.deepEqual(res.queue.rows.map((x) => x.recordId), ['old-alloc', 'mid-fema', 'kiran-supp']);
  assert.equal(res.queue.irSideRead, false);
  assert.match(res.queue.note, /could not be read/);
  assert.ok(bad.refusals().some((x) => x.action === 'lead-hints'));
  const none = rig({});
  const plain = createPaperworkQueue({ documents: { read: async () => pageOf(queueRows().filter((x) => x.paper !== 'supplementary')) }, hints: createHintReader({ crm: none.crm, log: none.log, recordIdPrefix: P, clock }) });
  const p = await plain.read(credential, 'fin');
  assert.deepEqual(p.queue.rows.map((x) => x.recordId), ['old-alloc', 'mid-fema']);
  assert.equal(none.calls.length, 0);
});

test('M12-S11-NOTE-3: only Finance seats get the queue; a refusal or a Zoho failure of the Documents read passes through', async () => {
  const none = rig({});
  const hints = createHintReader({ crm: none.crm, log: none.log, recordIdPrefix: P, clock });
  const leadSide = await createPaperworkQueue({ documents: { read: async () => pageOf([], { side: 'lead' }) }, hints }).read(credential, 'ir');
  assert.deepEqual([leadSide.ok, leadSide.kind, leadSide.reason], [false, 'refused', 'seat-denied']);
  const viewer = await createPaperworkQueue({ documents: { read: async () => pageOf(queueRows(), { actions: { send: false, verify: false } }) }, hints }).read(credential, 'audit');
  assert.equal(viewer.reason, 'seat-denied');
  const denied = await createPaperworkQueue({ documents: { read: async () => ({ ok: false, kind: 'refused', reason: 'seat-denied' }) }, hints }).read(credential, 'kam');
  assert.equal(denied.reason, 'seat-denied');
  const down = await createPaperworkQueue({ documents: { read: async () => ({ ok: false, kind: 'source-error', errorKind: 'server-error', fresh: {} }) }, hints }).read(credential, 'fin');
  assert.deepEqual([down.ok, down.kind, down.errorKind], [false, 'source-error', 'server-error']);
  assert.equal(none.calls.length, 0, 'refused before any hint read');
});

/* ---- M12-S11-NOTE-6: Finance's "not signed after all" on the round ---------------------------------- */

test('M12-S11-NOTE-6: the round carries Finance\'s bounce until the IR says it again or the paper is verified; the fields are read-only here', () => {
  const L = { id: LEAD, NDA_Back_At: '2026-09-27T10:00:00+05:30', NDA_Back_By: { id: IR, name: 'Synthetic' }, NDA_Back_Why: 'Nothing has come back signed' };
  assert.deepEqual(backOf(L, 'nda', false), { by: IR, at: '2026-09-27T10:00:00+05:30', why: 'Nothing has come back signed' });
  assert.equal(backOf({ ...L, NDA_Said_At: '2026-09-26T10:00:00+05:30' }, 'nda', false).why, 'Nothing has come back signed', 'an older word does not clear it');
  assert.equal(backOf({ ...L, NDA_Said_At: '2026-09-28T10:00:00+05:30' }, 'nda', false), null, 'the IR said it again, later');
  assert.equal(backOf(L, 'nda', true), null, 'verified: nothing to note');
  assert.equal(backOf({ id: LEAD }, 'nda', false), null);
  assert.equal(backOf({ ...L, NDA_Back_At: 'yesterday' }, 'nda', false), null, 'a malformed stamp is not a bounce');
  assert.equal(backOf(L, 'supp', false), null, 'a bounce on one round is not on the other');
  assert.deepEqual(Object.values(BACK_FIELDS.supp), ['Supp_Back_At', 'Supp_Back_By', 'Supp_Back_Why']);
  assert.equal(PROPOSED_LEAD_FIELDS.some((f) => /_Back_/.test(f)), false, 'the IR never writes them');
});

/* ---- M12-S13-T01: material follows the NDA --------------------------------------------------------- */

function emailRig(leadGets, extra = {}, deck) {
  const routes = { [LEAD_GET]: leadGets, 'GET /settings/emails/actions/from_addresses': 'email:from-addresses',
    [`POST /Leads/${LEAD}/actions/send_mail`]: 'email:send.ok', [LEAD_PUT]: ['email.deck-marked', 'lead.updated'], 'POST /Touches': 'touch.created',
    'POST /Tasks': 'email:task.created', ...extra };
  const calls = [];
  const sink = createMemorySink();
  const log = createOpsLog(sink);
  const crm = createZohoClient({ recordIdPrefix: P, gate: immediateGate(), log, maxAttempts: 1, clock, sleep: async () => {},
    fetch: async (url, init) => {
      const u = new URL(url);
      const key = `${init.method} ${u.pathname.replace('/crm/v8', '')}`;
      calls.push({ key, body: init.body ? JSON.parse(init.body) : null });
      let name = routes[key];
      if (Array.isArray(name)) name = name.shift();
      if (!name) throw new Error(`unexpected synthetic CRM request ${key}`);
      return toResponse(name.startsWith('email:') ? recorded(emailFixtures, name.slice(6)) : recorded(fixtureRoot, name));
    } });
  const access = { async recheck(c) { return { actor: { userId: c.userId, roleId: '', profileId: '', seat: 'investor-relations' }, mayRecordFollowup: true, teamOwnerIds: [] }; } };
  const followups = createFollowups({ crm, access, log, recordIdPrefix: P, undoSecret: SECRET, clock });
  const deckSends = [];
  const deckMailer = deck === false ? null : { async send(c, lead, mail, signal) { deckSends.push({ lead, mail }); return crm.sendMail(c, 'Leads', lead, mail, { signal }); } };
  const svc = createEmailSender({ crm, followups, access, log, recordIdPrefix: P, orgDomains: ['agresearchlabs.com'], nda: createLeadNdaReader(crm), deck: deckMailer, clock });
  return { svc, calls, sink, deckSends, puts: () => calls.filter((c) => c.key === LEAD_PUT) };
}
const DECK = { leadId: LEAD, expectedModifiedTime: LOADED, template: 'deck', subject: 'Growize — the deck', message: 'Synthetic deck note', to: 'synthetic.lead@example.com' };

test('TC-E09-015: before the NDA is signed the Deck follow-up and Webinar invite are refused by the Lead\'s own NDA stamp', async () => {
  for (const template of ['deck', 'webinar']) {
    const r = emailRig(['email.lead', 'email.nda-not-back']);
    const res = await r.svc.send(principal(), { ...DECK, template });
    assert.equal(res.reasonCode, 'nda-not-back', template);
    assert.equal(res.reason, EMAIL_REASON['nda-not-back']);
    assert.ok(!r.calls.some((c) => c.key.endsWith('send_mail')));
  }
});

test('NDA signed but no deck mailer wired → Deck follow-up is refused, never sent bare', async () => {
  const r = emailRig(['email.lead', 'email.nda-back'], {}, false);
  const res = await r.svc.send(principal(), DECK);
  assert.equal(res.reasonCode, 'deck-not-ready');
  assert.ok(!r.calls.some((c) => c.key.endsWith('send_mail')));
});

test('TC-E09-017: Deck follow-up after the NDA goes through the deck mailer and sets Pitch deck sent once, with one log line', async () => {
  const r = emailRig(['email.lead', 'email.nda-back', 'email.after-send.deck-unset', 'email.lead-after-mark']);
  const res = await r.svc.send(principal(), DECK);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.value.materialMarked, true);
  assert.equal(r.deckSends.length, 1);
  assert.deepEqual(r.puts()[0].body.data[0], { Pitch_Deck_Sent_At: '2026-09-28T11:00:00+05:30' });
  assert.equal(r.sink.records().filter((x) => x.kind === 'event' && x.action === 'material-sent').length, 1);
  assert.equal(res.value.touchRecorded, true);
});

test('Deck email again when Pitch deck is already sent → still exactly one material record (no second write, no second line)', async () => {
  const r = emailRig(['email.lead', 'email.nda-back', 'email.after-send.deck-set', 'email.lead'], { [LEAD_PUT]: 'lead.updated' });
  const res = await r.svc.send(principal(), DECK);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.value.materialMarked, false);
  assert.ok(!r.puts().some((c) => 'Pitch_Deck_Sent_At' in c.body.data[0]));
  assert.equal(r.sink.records().filter((x) => x.kind === 'event' && x.action === 'material-sent').length, 0);
});

test('an Introduction email is untouched by the material rule (no deck mailer, no Pitch deck field read)', async () => {
  const r = emailRig(['email.lead', 'email.lead', 'email.lead'], { [LEAD_PUT]: 'lead.updated' }, false);
  const res = await r.svc.send(principal(), { ...DECK, template: 'intro' });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal('materialMarked' in res.value, false);
  assert.ok(!r.puts().some((c) => 'Pitch_Deck_Sent_At' in c.body.data[0]));
});

test('W3-E2E-4: a supplementary Finance sent before the NDA came back and before the draft was agreed still shows as out on the IR\'s lead', async () => {
  const r = rig({ [LEAD_GET]: 'lead.nda-sent', 'COQL from Contacts': 'coql.contact-of-lead', 'COQL from LLP_UnitAllocation_Module': 'coql.allotment-supp-sent' });
  const row = await r.svc.read(principal(), LEAD);
  const supp = row.value.rounds.find((x) => x.round === 'supp');
  assert.equal(supp.sent, true, 'the lead shows it went out');
  assert.equal(supp.verified, false);
  assert.equal(supp.next.k, 'told', 'the IR can tell and chase: the investor holds a live link');
  const nda = row.value.rounds.find((x) => x.round === 'nda');
  assert.equal(nda.verified, false, 'the NDA is still not back');
  const unsent = await rig({ [LEAD_GET]: 'lead.nda-sent' }).svc.read(principal(), LEAD);
  assert.equal(unsent.value.rounds.find((x) => x.round === 'supp').sent, false);
  assert.notEqual(unsent.value.rounds.find((x) => x.round === 'supp').next.k, 'told');
});

/* ---- G1 (D136 proposed): the IR asks Finance to send the NDA / the supplementary ------------------------------------------- */

test('G1: "Ask Finance to send the NDA" writes NDA_Requested_At only (the requester is the lead Owner) on the IR\'s token, guarded, one log line, and Undo takes it back', async () => {
  const rowToken = await tokenFor('lead.nda-not-sent', 'nda', 'request');
  const r = rig({ [LEAD_GET]: 'lead.nda-not-sent', [LEAD_PUT]: ['lead.updated', 'lead.restored'] });
  const res = await r.svc.step(principal(), { leadId: LEAD, round: 'nda', beat: 'request', rowToken });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.value.already, undefined);
  assert.deepEqual(r.writes().map((c) => c.key), [LEAD_PUT], 'the Lead only: no Touch, no Note, nothing of Finance\'s');
  const put = r.writes()[0];
  assert.equal(put.headers['If-Unmodified-Since'] ?? put.headers['if-unmodified-since'], LOADED);
  assert.deepEqual(put.body.data[0], { NDA_Requested_At: '2026-09-28T11:00:00+05:30' });
  assert.deepEqual(r.events().map((e) => e.reason), ['nda-request']);
  const u = await r.svc.undo(principal(), res.value.undoToken);
  assert.equal(u.ok, true, JSON.stringify(u));
  assert.deepEqual(r.writes()[1].body.data[0], { NDA_Requested_At: null });
});

test('G1: a round already asked for answers `already` and writes nothing — even on a token read before the first press', async () => {
  const rowToken = await tokenFor('lead.nda-not-sent', 'nda', 'request');
  const r = rig({ [LEAD_GET]: 'lead.nda-requested' });
  const res = await r.svc.step(principal(), { leadId: LEAD, round: 'nda', beat: 'request', rowToken });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.value.already, true);
  assert.equal(res.value.undoToken, null);
  assert.deepEqual(r.writes(), []);
  const row = await rig({ [LEAD_GET]: 'lead.nda-requested' }).svc.read(principal(), LEAD);
  assert.deepEqual({ ...row.value.rounds.find((x) => x.round === 'nda').requested }, { at: '2026-09-26T10:30:00+05:30' });
  assert.equal(offer(row.value, 'nda', 'request'), undefined, 'asked once: no second offer');
});

test('G1: sent or verified already → refused (already-sent), nothing written; the sent row never offers it', async () => {
  const rowToken = await tokenFor('lead.nda-not-sent', 'nda', 'request');
  for (const fx of ['lead.nda-sent', 'lead.nda-verified']) {
    const r = rig({ [LEAD_GET]: fx });
    const res = await r.svc.step(principal(), { leadId: LEAD, round: 'nda', beat: 'request', rowToken });
    assert.equal(res.ok, false, fx);
    assert.equal(res.reasonCode, 'already-sent', fx);
    assert.deepEqual(r.writes(), [], fx);
  }
  const row = await rig({ [LEAD_GET]: 'lead.nda-sent' }).svc.read(principal(), LEAD);
  assert.equal(offer(row.value, 'nda', 'request'), undefined);
});

test('G1: the request takes no channel, needs its own row token, and a 412 is "lead changed"; a lead outside the book is refused', async () => {
  const rowToken = await tokenFor('lead.nda-not-sent', 'nda', 'request');
  const a = rig({ [LEAD_GET]: 'lead.nda-not-sent' });
  assert.equal((await a.svc.step(principal(), { leadId: LEAD, round: 'nda', beat: 'request', channel: 'call', rowToken })).reasonCode, 'invalid-request');
  assert.equal((await a.svc.step(principal(), { leadId: LEAD, round: 'nda', beat: 'request', rowToken: 'forged' })).reasonCode, 'not-from-row');
  const told = await tokenFor('lead.nda-sent', 'nda', 'told');
  assert.equal((await a.svc.step(principal(), { leadId: LEAD, round: 'nda', beat: 'request', rowToken: told })).reasonCode, 'not-from-row');
  assert.deepEqual(a.writes(), []);
  const b = rig({ [LEAD_GET]: 'lead.nda-not-sent', [LEAD_PUT]: 'conflict' });
  assert.equal((await b.svc.step(principal(), { leadId: LEAD, round: 'nda', beat: 'request', rowToken })).reasonCode, 'lead-changed');
  const c = rig({ [LEAD_GET]: 'lead.other-owner' });
  assert.equal((await c.svc.step(principal(), { leadId: LEAD, round: 'nda', beat: 'request', rowToken })).reasonCode, 'not-in-book');
});

test('G1: "Ask Finance to send the supplementary" once the final draft is agreed writes Supp_Requested_At; once sent it is refused', async () => {
  const routes = { [LEAD_GET]: 'lead.supp-agreed', 'COQL from Contacts': 'coql.contact-of-lead', 'COQL from LLP_UnitAllocation_Module': 'coql.empty' };
  const row = await rig(routes).svc.read(principal(), LEAD);
  const o = offer(row.value, 'supp', 'request');
  assert.ok(o);
  const r = rig({ ...routes, [LEAD_PUT]: 'lead.updated' });
  const res = await r.svc.step(principal(), { leadId: LEAD, round: 'supp', beat: 'request', rowToken: o.rowToken });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.deepEqual(r.writes()[0].body.data[0], { Supp_Requested_At: '2026-09-28T11:00:00+05:30' });
  const sent = rig({ ...routes, 'COQL from LLP_UnitAllocation_Module': 'coql.allotment-supp-sent' });
  assert.equal((await sent.svc.step(principal(), { leadId: LEAD, round: 'supp', beat: 'request', rowToken: o.rowToken })).reasonCode, 'already-sent');
});
