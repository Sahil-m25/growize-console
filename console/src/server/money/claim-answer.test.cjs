/* M10-S03-T01 — Finance answers an IR's payment report: the drawer, "Confirm and record it", "Not there yet".
 *
 * Run from console/: node --test src/server/money/claim-answer.test.cjs
 * Real Zoho client over recorded synthetic replies (__fixtures__/claim-answers/*). record-receipt's commit() is a
 * recording fake here (it has its own tests); everything else is the real code. No request reaches Zoho.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { before, test } = require('node:test');

const consoleRoot = path.resolve(__dirname, '..', '..', '..');
const srcRoot = path.join(consoleRoot, 'src');
const fixtureRoot = path.join(srcRoot, 'lib', 'zoho', '__fixtures__', 'claim-answers');
const contractsDir = path.resolve(consoleRoot, '..', 'contracts');
const ts = require(path.join(consoleRoot, 'node_modules', 'typescript'));
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoho-claim-answer-'));
process.on('exit', () => fs.rmSync(outDir, { recursive: true, force: true }));

const config = ts.readConfigFile(path.join(consoleRoot, 'tsconfig.json'), ts.sys.readFile);
const project = ts.parseJsonConfigFileContent(config.config, ts.sys, consoleRoot);
const options = { ...project.options, incremental: false, tsBuildInfoFile: undefined, plugins: undefined,
  module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10, noEmit: false, noEmitOnError: true, outDir, rootDir: srcRoot };
const sources = ['lib/zoho/errors.ts', 'lib/zoho/gate.ts', 'lib/zoho/log.ts', 'lib/zoho/client.ts', 'server/money/receipt-replay.ts',
  'server/money/allotment-receipts.ts', 'server/money/claim-answer.ts', 'server/contracts/events.ts', 'server/contracts/outbox.ts', 'server/contracts/stub.ts']
  .map((f) => path.join(srcRoot, f));
const program = ts.createProgram(sources, options);
const diagnostics = [...ts.getPreEmitDiagnostics(program), ...program.emit().diagnostics];
if (diagnostics.length) {
  console.error(ts.formatDiagnostics(diagnostics, { getCanonicalFileName: (f) => f, getCurrentDirectory: () => consoleRoot, getNewLine: () => '\n' }));
  process.exit(1);
}
const load = (file) => require(path.join(outDir, file));
const { createMemorySink, createOpsLog } = load('lib/zoho/log.js');
const { createZohoClient, userCredential } = load('lib/zoho/client.js');
const { createReceiptReplayService } = load('server/money/receipt-replay.js');
const { createAllotmentReceiptWrites } = load('server/money/allotment-receipts.js');
const { createClaimAnswers, SUPER_USER_NOTE, ANSWERED_STATE } = load('server/money/claim-answer.js');
const { factEventId } = load('server/money/match.js');
const { validateEvent } = load('server/contracts/events.js');
const { identityPaths } = load('server/contracts/outbox.js');
const { loadSchemas } = load('server/contracts/stub.js');

const P = '9007199254';
const HEAD = '9007199254740994090', IR = '9007199254740994095';
const A = '9007199254740994001', C = '9007199254740994002', CL = '9007199254740994301', LEAD = '9007199254740994007', NEWR = '9007199254740994060';
const SESSION = 'session_fixture_00000010';
const NOW = Date.parse('2026-09-02T09:03:00+05:30');
const REASON = 'Nothing from HDFC yet in the collection account';
const SECRETS = ['Synthetic Rohit IR', 'Synthetic IR words', 'Synthetic Fixture Investor', 'fixture.investor@example.invalid',
  'synthetic.user@example.invalid', 'ABCDE1234F', 'HDFC2708994', REASON, 'synthetic-user-access-token'];
const schemas = loadSchemas(contractsDir);
const recorded = (name) => JSON.parse(fs.readFileSync(path.join(fixtureRoot, `${name}.response.json`), 'utf8'));
const toResponse = (r) => new Response(r.body === null ? null : JSON.stringify(r.body), { status: r.status, headers: r.headers || {} });
const immediateGate = () => ({ async acquire() { return { waitedMs: 0, release() {} }; } });
const noSecrets = (value) => { const s = JSON.stringify(value); for (const x of SECRETS) assert.ok(!s.includes(x), `leaked ${x}`); };

let cred;
before(async () => {
  cred = await userCredential({ access_token: 'synthetic-user-access-token-never-live', api_domain: 'https://www.zohoapis.in', expires_in: 3_600 },
    { recordIdPrefix: P, gate: immediateGate(), log: createOpsLog(createMemorySink()), clock: () => NOW,
      fetch: async () => toResponse(recorded('current-user.head')) });
  assert.equal(cred.userId, HEAD);
});
const principal = () => ({ credential: cred, sessionId: SESSION });

function rig(f = {}, opts = {}) {
  const sink = createMemorySink();
  const log = createOpsLog(sink);
  const calls = [], events = [], commits = [];
  const notes = { [CL]: [].concat(f.claimNotes ?? 'notes.none'), [NEWR]: ['notes.none'] };
  const crm = createZohoClient({ recordIdPrefix: P, gate: immediateGate(), log, maxAttempts: 1, clock: () => NOW,
    fetch: async (url, init) => {
      const u = new URL(String(url));
      const m = init.method;
      if (u.pathname.endsWith('/coql')) {
        const q = JSON.parse(init.body).select_query; calls.push(['coql', q]);
        if (/from Receipts where Match_State = 'Claimed'/.test(q)) return toResponse(recorded('claims.waiting'));
        if (/from Receipts where Allotment = /.test(q)) return toResponse(recorded('receipts.advance-matched'));
        throw new Error(`unexpected query ${q}`);
      }
      const rel = /\/crm\/v8\/Receipts\/(\d+)\/Notes$/.exec(u.pathname);
      if (m === 'GET' && rel) { calls.push(['notes', rel[1]]); const l = notes[rel[1]]; return toResponse(recorded(l.length > 1 ? l.shift() : l[0])); }
      if (m === 'POST' && u.pathname.endsWith('/Notes')) { calls.push(['note', JSON.parse(init.body).data[0]]); return toResponse(recorded('note.created')); }
      const [, mod, id] = /\/crm\/v8\/([^/]+)\/(\d+)$/.exec(u.pathname) || [];
      if (m === 'GET' && mod === 'Receipts') { calls.push(['get', mod, id]); return toResponse(recorded(f.claim ?? 'claim.open')); }
      if (m === 'GET' && mod === 'LLP_UnitAllocation_Module') { calls.push(['get', mod, id]); return toResponse(recorded('allotment.reserved')); }
      if (m === 'PUT') {
        calls.push(['put', mod, id, JSON.parse(init.body).data[0], new Headers(init.headers).get('If-Unmodified-Since')]);
        return toResponse(recorded(f.put ?? 'claim.updated'));
      }
      throw new Error(`unexpected call ${m} ${u.pathname}`);
    } });
  const replay = createReceiptReplayService({ crm, log, recordIdPrefix: P, clock: () => NOW,
    permission: { async recheck() { return false; } }, session: { async recheck() { return false; } },
    idempotencySecret: 'synthetic-receipt-idempotency-secret-0010', contextSigningSecret: 'synthetic-receipt-context-signing-secret-0010' });
  const writes = createAllotmentReceiptWrites({ crm, replay, log, recordIdPrefix: P, clock: () => NOW });
  const record = { async commit(p, body, key) {
    commits.push({ body, key });
    // D113: record-receipt matches a Finance seat's receipt as it is recorded (the recorder is the matcher)
    return opts.commit ?? { ok: true, value: { receiptId: NEWR, duplicate: false, state: 'matched', matchedBy: p.credential.userId, matchedAt: '2026-09-02T09:02:00+05:30', match: null, kind: body.kind, mode: body.mode, amountRupees: body.amount,
      ref: body.ref, receivedOn: body.receivedOn, recordedBy: p.credential.userId, link: { allotmentId: body.allotmentId, investorId: C, farmId: '9007199254740994003' },
      matchable: true, matchNote: null, paymentStatus: null } };
  } };
  const publish = async (event) => { events.push(event); const v = validateEvent(schemas, event); return v.ok ? { ok: true, eventId: event.event_id } : { ok: false, reason: v.reason }; };
  const seat = opts.seat ?? { mayAnswer: true, superUser: false };
  const svc = createClaimAnswers({ crm, record, writes, publish, log, recordIdPrefix: P, clock: () => NOW,
    authority: { async seatOf() { return seat; } } });
  return { svc, calls, events, commits, sink };
}
const puts = (calls) => calls.filter((c) => c[0] === 'put');

test('the drawer: the IR\'s words and name, already in ₹2.5 L, outstanding ₹22.5 L, hold ends 23 Sep, both answers offered', async () => {
  const r = rig();
  const res = await r.svc.detail(principal(), CL);
  assert.equal(res.ok, true, JSON.stringify(res));
  const v = res.value;
  assert.equal(v.byName, 'Synthetic Rohit IR');
  assert.equal(v.byId, IR);
  assert.match(v.words, /IR's note: Synthetic IR words/);
  assert.equal(v.refLastFour, '8994');
  assert.equal(v.leadId, LEAD);
  assert.equal(v.kind, 'balance');
  assert.equal(v.amountRupees, 2_250_000);
  assert.equal(v.alreadyInRupees, 250_000);
  assert.equal(v.outstandingRupees, 2_250_000);
  assert.equal(v.holdUntil, '2026-09-23');
  assert.deepEqual(v.offers, ['confirm', 'not-there']);
  assert.equal(v.doer, 'Finance');
  assert.equal(v.superUser, false);
  assert.equal(v.superUserNote, null);
  assert.equal(puts(r.calls).length, 0, 'reading writes nothing');
  noSecrets(r.sink.records());
});

test('the super user sees Finance named as the doer and a super-user note', async () => {
  const r = rig({}, { seat: { mayAnswer: true, superUser: true } });
  const v = (await r.svc.detail(principal(), CL)).value;
  assert.equal(v.doer, 'Finance');
  assert.equal(v.superUserNote, SUPER_USER_NOTE);
});

test('a KAM (no "pay") gets no report and no answer — refused before Zoho is asked', async () => {
  const r = rig({}, { seat: { mayAnswer: false, superUser: false } });
  for (const res of [await r.svc.waiting(principal()), await r.svc.detail(principal(), CL), await r.svc.confirm(principal(), CL, { ref: 'HDFC2708994' }, 'press_key_000001'),
    await r.svc.notThere(principal(), CL, { reason: REASON })]) {
    assert.equal(res.ok, false);
    assert.equal(res.reasonCode, 'not-finance');
  }
  assert.equal(r.calls.length, 0);
  assert.equal(r.commits.length, 0);
});

test('the reports waiting on Finance — an IR\'s report stays pending (Claimed) until Finance confirms it; reading writes nothing', async () => {
  const r = rig();
  const res = await r.svc.waiting(principal());
  assert.equal(res.ok, true);
  assert.equal(r.commits.length, 0, 'nothing is recorded or matched until Finance presses Confirm');
  assert.equal(puts(r.calls).length, 0);
  assert.deepEqual(res.value.claims, [{ claimId: CL, leadId: LEAD, allotmentId: A, kind: 'balance', mode: 'RTGS', amountRupees: 2_250_000, saidOn: '2026-08-27', byId: IR }]);
  noSecrets(res.value);
});

test('"Confirm and record it": one receipt from the report\'s fields on its allotment, linked both ways, the report answered and otherwise untouched', async () => {
  const r = rig();
  const res = await r.svc.confirm(principal(), CL, { ref: 'hdfc 2708994' }, 'press_key_000001');
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.deepEqual(r.commits, [{ key: 'press_key_000001', body: { allotmentId: A, kind: 'balance', mode: 'RTGS', ref: 'HDFC2708994', amount: 2_250_000, receivedOn: '2026-08-27' } }]);
  assert.equal(res.value.receipt.recordedBy, HEAD, 'recorded by the person pressing');
  assert.equal(res.value.receipt.state, 'matched', 'D113: Finance\'s confirmation records it, and the record is matched — no second hand');
  assert.equal(res.value.receipt.matchedBy, HEAD);
  assert.equal(res.value.answered, true);
  assert.equal(res.value.linked, true);
  const notes = r.calls.filter((c) => c[0] === 'note').map((c) => c[1]);
  assert.deepEqual(notes, [
    { Note_Title: "Answers an IR's report", Note_Content: `Report ${CL}`, Parent_Id: { module: { api_name: 'Receipts' }, id: NEWR } },
    { Note_Title: 'Finance found it', Note_Content: `Recorded as receipt ${NEWR}`, Parent_Id: { module: { api_name: 'Receipts' }, id: CL } },
  ]);
  const p = puts(r.calls);
  assert.equal(p.length, 1);
  assert.deepEqual(p[0].slice(1, 4), ['Receipts', CL, { Match_State: ANSWERED_STATE }], 'only Match_State: the IR\'s fields are never edited');
  assert.equal(p[0][4], '2026-08-27T11:00:00+05:30');
  assert.equal(r.events.length, 0, 'recording is not matching: no money.confirmed here');
  noSecrets(r.sink.records());
});

test('confirm needs the bank reference, and it must end the way the investor\'s did', async () => {
  let r = rig();
  assert.equal((await r.svc.confirm(principal(), CL, {}, 'press_key_000001')).reasonCode, 'reference-required');
  r = rig();
  assert.equal((await r.svc.confirm(principal(), CL, { ref: 'HDFC2700000' }, 'press_key_000001')).reasonCode, 'reference-differs');
  assert.equal(r.commits.length, 0);
  assert.equal(puts(r.calls).length, 0);
  noSecrets(r.sink.records());
});

test('an answered report is not answered again; a receipt is not a report', async () => {
  let r = rig({ claim: 'claim.answered', claimNotes: 'notes.found' });
  assert.equal((await r.svc.confirm(principal(), CL, { ref: 'HDFC2708994' }, 'press_key_000001')).reasonCode, 'already-answered');
  assert.equal((await r.svc.notThere(principal(), CL, { reason: REASON })).reasonCode, 'already-answered');
  assert.equal(r.commits.length, 0);
  r = rig({ claim: 'receipt.not-a-claim' });
  assert.equal((await r.svc.detail(principal(), CL)).reasonCode, 'not-a-claim');
});

test('a failed record answers "Not saved yet" and leaves the report as it was', async () => {
  const r = rig({}, { commit: { ok: false, kind: 'unknown-outcome', message: 'Not saved yet — Zoho has not confirmed it. Press again; it will not be recorded twice.', retryable: true } });
  const res = await r.svc.confirm(principal(), CL, { ref: 'HDFC2708994' }, 'press_key_000001');
  assert.equal(res.ok, false);
  assert.match(res.message, /^Not saved yet/);
  assert.equal(puts(r.calls).length, 0);
  assert.equal(r.calls.filter((c) => c[0] === 'note').length, 0);
});

test('"Not there yet": the reason as a Note, the report answered (Match_State only), money.not_found out, the lead reads it', async () => {
  const r = rig();
  const res = await r.svc.notThere(principal(), CL, { reason: `  ${REASON}  ` });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.value.says, `Finance did not find it: ${REASON}`);
  assert.equal(res.value.duplicate, false);
  assert.deepEqual(r.calls.filter((c) => c[0] === 'note').map((c) => c[1]),
    [{ Note_Title: 'Finance did not find it', Note_Content: REASON, Parent_Id: { module: { api_name: 'Receipts' }, id: CL } }]);
  const p = puts(r.calls);
  assert.deepEqual(p.map((c) => c.slice(1, 4)), [['Receipts', CL, { Match_State: 'Not found' }]]);
  assert.equal(r.events.length, 1);
  const e = r.events[0];
  assert.equal(e.type, 'money.not_found');
  assert.deepEqual(e.payload, { reason: REASON, claim_id: CL, at: '2026-09-02T09:03:00+05:30' });
  assert.deepEqual(e.ids, { investor_contact_id: C });
  assert.equal(e.event_id, factEventId(`money.not_found:${CL}`));
  assert.deepEqual(validateEvent(schemas, e), { ok: true, type: 'money.not_found' });
  assert.deepEqual(identityPaths({ ...e, event_id: undefined, occurred_at: undefined }), []);
  noSecrets(r.sink.records());
});

test('"Not there yet" needs a reason; a retry of the same answer is answered the same and writes nothing again', async () => {
  let r = rig();
  assert.equal((await r.svc.notThere(principal(), CL, { reason: '   ' })).reasonCode, 'reason-required');
  assert.equal((await r.svc.notThere(principal(), CL, { reason: 'x'.repeat(501) })).reasonCode, 'reason-required');
  assert.equal(r.calls.length, 0);
  r = rig({ claim: 'claim.answered', claimNotes: 'notes.not-found' });
  const res = await r.svc.notThere(principal(), CL, { reason: REASON });
  assert.equal(res.ok, true);
  assert.equal(res.value.duplicate, true);
  assert.equal(puts(r.calls).length, 0);
  assert.equal(r.calls.filter((c) => c[0] === 'note').length, 0);
  assert.equal(r.events[0].event_id, factEventId(`money.not_found:${CL}`));
});

test('a report changed under the answer (412) is "reload"', async () => {
  const r = rig({ put: 'claim.conflict-412' });
  assert.equal((await r.svc.notThere(principal(), CL, { reason: REASON })).reasonCode, 'claim-changed');
  assert.equal(r.events.length, 0);
});
