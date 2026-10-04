/* M09-S09-T02 (add an investor who already paid) and M10-S21-T02 (unlock the investor app / lock it again).
 *
 * Run from console/: node --test src/server/investors/onboarding.test.cjs
 *
 * Compiles the real Zoho client, the allotment receipt guard and both services with the project's TypeScript
 * and drives them with synthetic recorded responses (__fixtures__/onboarding/*). No request reaches Zoho.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { before, test } = require('node:test');

const consoleRoot = path.resolve(__dirname, '..', '..', '..');
const srcRoot = path.join(consoleRoot, 'src');
const fixtureRoot = path.join(srcRoot, 'lib', 'zoho', '__fixtures__', 'onboarding');
const ts = require(path.join(consoleRoot, 'node_modules', 'typescript'));
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoho-onboarding-'));
process.on('exit', () => fs.rmSync(outDir, { recursive: true, force: true }));

const config = ts.readConfigFile(path.join(consoleRoot, 'tsconfig.json'), ts.sys.readFile);
const project = ts.parseJsonConfigFileContent(config.config, ts.sys, consoleRoot);
const options = { ...project.options, incremental: false, tsBuildInfoFile: undefined, plugins: undefined,
  module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10, noEmit: false, noEmitOnError: true, outDir, rootDir: srcRoot };
const sources = ['lib/zoho/errors.ts', 'lib/zoho/gate.ts', 'lib/zoho/log.ts', 'lib/zoho/client.ts', 'server/money/receipt-replay.ts',
  'server/money/allotment-receipts.ts', 'server/investors/add-paid.ts', 'server/investors/unlock.ts', 'server/farms/oversell.ts',
  'server/state/memory.ts', 'server/state/catalyst.ts', 'server/state/fake-catalyst.ts'].map((f) => path.join(srcRoot, f));
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
const load = (file) => require(path.join(outDir, file));
const { createMemorySink, createOpsLog } = load('lib/zoho/log.js');
const { createZohoClient, userCredential } = load('lib/zoho/client.js');
const { createAllotmentReceiptWrites } = load('server/money/allotment-receipts.js');
const { createAddPaid, splitName, nextArlCode, checkForm, kolkataDay } = load('server/investors/add-paid.js');
const { createAppAccess, cardState } = load('server/investors/unlock.js');
const { createOversellGuard } = load('server/farms/oversell.js');

const P = '9007199254';
const CONTACT = '9007199254740994001', LLP = '9007199254740994003', ALLOT = '9007199254740994010', RECEIPT = '9007199254740994020';
const ACTOR = '9007199254740993090', EXISTING = '9007199254740994099';
const SESSION = 'session_fixture_00000001';
const NOW = Date.parse('2026-09-28T10:00:00+05:30');
const T1 = '2026-09-28T09:00:00+05:30';
const IDENTITY = ['Synthetic Paid', 'synthetic.paid@example.invalid', '+91 90000 00001', '9000000001', 'the investor asked us to pause access'];
const recorded = (name) => JSON.parse(fs.readFileSync(path.join(fixtureRoot, `${name}.response.json`), 'utf8'));
const toResponse = (r) => new Response(r.body === null ? null : JSON.stringify(r.body), { status: r.status, headers: r.headers || {} });
const immediateGate = () => ({ async acquire() { return { waitedMs: 0, release() {} }; } });
const noIdentity = (sink) => { const s = JSON.stringify(sink.records()); for (const x of IDENTITY) assert.ok(!s.includes(x), `Plane B leaked ${x}`); };

let cred;
before(async () => {
  cred = await userCredential({ access_token: 'synthetic-user-access-token-never-live', api_domain: 'https://www.zohoapis.in', expires_in: 3_600 },
    { recordIdPrefix: P, gate: immediateGate(), log: createOpsLog(createMemorySink()), clock: () => NOW,
      fetch: async () => toResponse(recorded('current-user.finance')) });
  assert.equal(cred.userId, ACTOR);
});
const principal = () => ({ credential: cred, sessionId: SESSION });
const form = (over = {}) => ({ name: 'Synthetic Paid Investor', email: 'synthetic.paid@example.invalid', mobile: '+91 90000 00001',
  llpId: LLP, units: 2, amountPaid: 5_000_000, investmentDate: '2026-09-01', ...over });

/**
 * The real client over recorded replies. `o` picks a fixture per step; a function value gets the call count.
 * Every call is kept in `calls` as [method, path, body|query].
 */
function rig(o = {}) {
  const sink = createMemorySink();
  const log = createOpsLog(sink);
  const calls = [];
  const state = { contactInserts: 0, allotInserted: false, receiptInserted: false, searches: 0 };
  const pick = (v, n) => (typeof v === 'function' ? v(n) : v);
  const crm = createZohoClient({ recordIdPrefix: P, gate: immediateGate(), log, maxAttempts: 1, clock: () => NOW,
    fetch: async (url, init) => {
      const u = new URL(String(url));
      const p = u.pathname.replace('/crm/v8', '');
      const m = init.method;
      const body = init.body ? JSON.parse(init.body) : null;
      calls.push([m, p, body ?? Object.fromEntries(u.searchParams), init.headers]);
      if (p === '/coql') {
        const q = body.select_query;
        if (/from Contacts where ARL_ID like/.test(q)) return toResponse(recorded(o.highest ?? 'contacts.highest-code'));
        if (/SUM\(Reserved_Units\)/.test(q) && /from LLP_UnitAllocation_Module where LLP = /.test(q)) return toResponse(recorded('agg.held-on-llp'));
        if (/from LLP_Creation_Module where/.test(q)) return toResponse(recorded('guard.llp'));
        if (/from LLP_UnitAllocation_Module where LLP = /.test(q)) throw new Error('the free units are the oversell guard\'s (farms/oversell), never counted inline');
        if (/select id from LLP_UnitAllocation_Module where Customer = /.test(q)) return toResponse(recorded(state.allotInserted ? 'receipts.one-pending' : 'receipts.none'));
        if (/from Receipts where Allotment = /.test(q)) return toResponse(recorded(state.receiptInserted ? 'receipts.one-pending' : 'receipts.none'));
        throw new Error(`unexpected query ${q}`);
      }
      if (m === 'GET' && p === '/Contacts/search') return toResponse(recorded(pick(o.search ?? 'contacts.search-none', state.searches++)));
      if (m === 'GET' && p === `/LLP_Creation_Module/${LLP}`) return toResponse(recorded(o.llp ?? 'llp.open'));
      if (m === 'GET' && p === `/LLP_UnitAllocation_Module/${ALLOT}`) return toResponse(recorded(o.allotment ?? 'allotment.issued'));
      if (m === 'POST' && p === '/Contacts') {
        const n = state.contactInserts++;
        const f = pick(o.contactInsert ?? 'contact.created', n);
        if (f === 'THROW') throw new TypeError('synthetic network drop');
        return toResponse(recorded(f));
      }
      if (m === 'POST' && p === '/LLP_UnitAllocation_Module') {
        const f = o.allotInsert ?? 'allotment.created';
        if (f === 'allotment.created') state.allotInserted = true;
        return toResponse(recorded(f));
      }
      if (m === 'POST' && p === '/Receipts') {
        const f = o.receiptInsert ?? 'receipt.created';
        if (f === 'receipt.created') state.receiptInserted = true;
        return toResponse(recorded(f));
      }
      if (m === 'DELETE') return toResponse(recorded(pick(o.del ?? 'delete.success', p)));
      if (m === 'GET' && p === `/Contacts/${CONTACT}`) return toResponse(recorded(pick(o.contact ?? 'contact.hold', calls.filter((c) => c[0] === 'GET' && c[1] === p).length - 1)));
      if (m === 'GET' && p === `/Contacts/${CONTACT}/__timeline`) return toResponse(recorded(pick(o.timeline ?? 'timeline.opened', calls.filter((c) => c[1] === p).length - 1)));
      if (m === 'PUT' && p === `/Contacts/${CONTACT}`) return toResponse(recorded(o.update ?? 'contact.updated'));
      if (m === 'POST' && p === '/Notes') return toResponse(recorded(o.note ?? 'note.created'));
      throw new Error(`unexpected call ${m} ${p}`);
    } });
  const receipts = createAllotmentReceiptWrites({ crm, replay: { async replay() { throw new Error('the replay path is not used here'); } },
    log, recordIdPrefix: P, clock: () => NOW });
  const allow = { mayAdd: async () => o.finance !== false, mayChange: async () => o.finance !== false };
  const guardRefusals = [];
  const oversell = createOversellGuard({ crm, events: { refusal: (...a) => guardRefusals.push(a) } });
  const addOn = (state) => createAddPaid({ crm, receipts, oversell, authority: allow, log, recordIdPrefix: P, clock: () => NOW, state });
  const add = addOn(undefined);
  const planeC = [];
  const app = createAppAccess({ crm, authority: allow, log, events: { appAccessReleased: (...x) => planeC.push(x) }, recordIdPrefix: P, clock: () => NOW });
  const writes = () => calls.filter((c) => c[0] !== 'GET' && c[1] !== '/coql');
  return { add, addOn, app, calls, sink, writes, guardRefusals, planeC };
}

/* ---- pure pieces ---------------------------------------------------------------------------------- */

test('names split into First/Last (Zoho needs Last_Name); ARL codes count up; the day is Kolkata\'s', () => {
  assert.deepEqual({ ...splitName('Asha K. Menon') }, { first: 'Asha K.', last: 'Menon' });
  assert.deepEqual({ ...splitName('  Menon ') }, { first: null, last: 'Menon' });
  assert.equal(nextArlCode('ARL-INV-0205'), 'ARL-INV-0206');
  assert.equal(nextArlCode(null), 'ARL-INV-0001');
  assert.equal(kolkataDay(Date.parse('2026-09-27T19:00:00Z')), '2026-09-28', '00:30 IST is the next day');
});

test('the form asks for name, email, mobile, farm, units, amount and date — nothing else — with the drawer\'s lines', () => {
  const today = '2026-09-28';
  assert.ok('form' in checkForm(form(), today));
  assert.equal(checkForm({}, today).message, 'Not saved yet — name, email, mobile, farm, investment date, units, amount paid are missing.');
  assert.equal(checkForm(form({ mobile: '' }), today).message, 'Not saved yet — mobile is missing.');
  assert.equal(checkForm(form({ email: 'not-an-email' }), today).code, 'email-invalid');
  assert.equal(checkForm(form({ units: 1.5 }), today).code, 'units-invalid');
  assert.equal(checkForm(form({ investmentDate: '2026-09-29' }), today).code, 'date-invalid');
  assert.equal(checkForm(form({ investmentDate: '2026-02-30' }), today).code, 'date-invalid');
});

/* ---- M09-S09: add an investor who already paid ------------------------------------------------------ */

test('paid in full: one Contact (App_Access = Hold — D115 ruling 1), one Issued allotment, one Pending Full receipt — on the person\'s token, no email', async () => {
  const r = rig();
  const res = await r.add.add(principal(), form());
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.deepEqual({ ...res.value }, { contactId: CONTACT, code: 'ARL-INV-0206', allotmentId: ALLOT, allocationStatus: 'Issued',
    receiptId: RECEIPT, app: 'App: on hold — data synced, sign-in locked, no email sent. It stays locked until Finance presses Send welcome and unlock', replayed: false });
  const w = r.writes();
  assert.deepEqual(w.map((c) => c[0] + ' ' + c[1]), ['POST /Contacts', 'POST /LLP_UnitAllocation_Module', 'POST /Receipts']);
  assert.deepEqual(w[0][2].data[0], { First_Name: 'Synthetic Paid', Last_Name: 'Investor', Email: 'synthetic.paid@example.invalid',
    Mobile: '+91 90000 00001', ARL_ID: 'ARL-INV-0206', App_Access: 'Hold' });
  assert.ok(!w.some((c) => JSON.stringify(c[2]).includes('Invite')), 'D115: nothing add-paid writes opens app access');
  assert.deepEqual(w[1][2].data[0], { Name: 'ARL-INV-0206 — Synthetic Farm LLP', Customer: { id: CONTACT }, LLP: { id: LLP },
    Unit_Price: 2_500_000, Investment_Date: '2026-09-01', Allocation_Status: 'Issued', Issued_Units: 2, Reserved_Units: 0, Capital_Invested: 5_000_000 });
  const rc = w[2][2].data[0];
  assert.equal(rc.Kind, 'Full'); assert.equal(rc.Amount, 5_000_000); assert.equal(rc.Match_State, 'Pending');
  assert.equal(rc.Received_On, '2026-09-01T00:00:00+05:30'); assert.deepEqual(rc.Allotment, { id: ALLOT });
  assert.ok(!r.calls.some((c) => /send_mail|actions\/send/.test(c[1])), 'no mail of any kind');
  for (const c of r.calls) assert.equal(c[3]?.Authorization ?? c[3]?.authorization, 'Zoho-oauthtoken synthetic-user-access-token-never-live');
  noIdentity(r.sink);
});

test('part paid: the allotment is Reserved with a 30-day hold and the receipt is an Advance', async () => {
  const r = rig({ allotment: 'allotment.reserved' });
  const res = await r.add.add(principal(), form({ amountPaid: 1_000_000 }));
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.value.allocationStatus, 'Reserved');
  const w = r.writes();
  assert.deepEqual(w[1][2].data[0], { Name: 'ARL-INV-0206 — Synthetic Farm LLP', Customer: { id: CONTACT }, LLP: { id: LLP },
    Unit_Price: 2_500_000, Investment_Date: '2026-09-01', Allocation_Status: 'Reserved', Reserved_Units: 2, Issued_Units: 0, Hold_Until: '2026-10-28' });
  assert.equal(w[2][2].data[0].Kind, 'Advance');
  assert.equal(w[2][2].data[0].Amount, 1_000_000);
});

test('an email already on a Contact is refused with a link to that investor, and nothing is written', async () => {
  const r = rig({ search: 'contacts.search-existing' });
  const res = await r.add.add(principal(), form({ email: 'SYNTHETIC.EXISTING@example.invalid' }));
  assert.equal(res.reasonCode, 'duplicate-email');
  assert.deepEqual({ ...res.existing }, { contactId: EXISTING, code: 'ARL-INV-0042', name: 'Synthetic Existing Investor' });
  assert.match(res.message, /already belongs to Synthetic Existing Investor \(ARL-INV-0042\)/);
  assert.equal(r.writes().length, 0);
});

test('a duplicate the search could not see is still refused: Zoho\'s unique Email answers', async () => {
  const r = rig({ contactInsert: 'contact.duplicate-email' });
  const res = await r.add.add(principal(), form());
  assert.equal(res.reasonCode, 'duplicate-email');
  assert.deepEqual(r.writes().map((c) => c[1]), ['/Contacts']);
});

test('two adds racing for one ARL code: the second takes the next one', async () => {
  const r = rig({ contactInsert: (n) => (n === 0 ? 'contact.duplicate-arl' : 'contact.created') });
  const res = await r.add.add(principal(), form());
  assert.equal(res.ok, true, JSON.stringify(res));
  const inserts = r.writes().filter((c) => c[1] === '/Contacts').map((c) => c[2].data[0].ARL_ID);
  assert.deepEqual(inserts, ['ARL-INV-0206', 'ARL-INV-0207']);
  assert.equal(res.value.code, 'ARL-INV-0207');
});

test('the farm rules hold on the server: closed farm, too few units free, more money than the units cost', async () => {
  let r = rig({ llp: 'llp.closed' });
  let res = await r.add.add(principal(), form());
  assert.equal(res.reasonCode, 'farm-closed');
  assert.match(res.message, /Synthetic Farm LLP is Fully Subscribed/);
  r = rig();
  res = await r.add.add(principal(), form({ units: 4 }));
  assert.equal(res.reasonCode, 'units-not-free', '10 released, 3 reserved + 4 issued = 3 free (farms/oversell)');
  assert.match(res.message, /^Not saved yet — Synthetic Farm LLP has only 3 free units for Synthetic Paid Investor's 4 units\.$/);
  assert.equal(r.writes().length, 0, 'no Contact is written when the units are not free');
  assert.deepEqual(r.guardRefusals.map((x) => [x[1], x[2]]), [['allotment-oversell', 'no-free-units']]);
  r = rig();
  res = await r.add.add(principal(), form({ amountPaid: 5_000_001 }));
  assert.equal(res.reasonCode, 'overpaid');
  assert.equal(r.writes().length, 0);
});

test('M11-S07: Zoho\'s oversell guard refusing the allotment insert is named with the LLP; the Contact is taken back', async () => {
  const r = rig({ allotInsert: 'allotment.oversell-refused' });
  const res = await r.add.add(principal(), form());
  assert.equal(res.kind, 'refused');
  assert.equal(res.reasonCode, 'units-not-free');
  assert.match(res.message, /^Not saved yet — Synthetic Farm LLP does not have 2 units free — Zoho refused the allotment\.$/);
  assert.deepEqual(r.writes().map((c) => c[0] + ' ' + c[1]), ['POST /Contacts', 'POST /LLP_UnitAllocation_Module', `DELETE /Contacts/${CONTACT}`]);
});

test('an IR or viewer seat is refused before Zoho is asked', async () => {
  const r = rig({ finance: false });
  const res = await r.add.add(principal(), form());
  assert.equal(res.reasonCode, 'not-finance');
  assert.equal(r.calls.length, 0);
});

test('"one commit": the allotment fails, the Contact is taken back, and the answer is Not saved yet', async () => {
  const r = rig({ allotInsert: 'allotment.invalid' });
  const res = await r.add.add(principal(), form());
  assert.equal(res.kind, 'not-saved');
  assert.equal(res.step, 'allotment');
  assert.match(res.message, /^Not saved yet/);
  assert.deepEqual(r.writes().map((c) => c[0] + ' ' + c[1]), ['POST /Contacts', 'POST /LLP_UnitAllocation_Module', `DELETE /Contacts/${CONTACT}`]);
});

test('the receipt fails: allotment then Contact are taken back, newest first', async () => {
  const r = rig({ receiptInsert: 'source.server-error' });
  const res = await r.add.add(principal(), form());
  assert.equal(res.kind, 'not-saved');
  assert.equal(res.step, 'receipt');
  assert.deepEqual(r.writes().map((c) => c[0] + ' ' + c[1]).slice(-2), [`DELETE /LLP_UnitAllocation_Module/${ALLOT}`, `DELETE /Contacts/${CONTACT}`]);
});

test('a clean-up Zoho refuses is reported with what is left, and one Plane B line — never a silent half', async () => {
  const r = rig({ receiptInsert: 'source.server-error', del: 'delete.forbidden' });
  const res = await r.add.add(principal(), form());
  assert.equal(res.kind, 'incomplete');
  assert.deepEqual({ ...res.left }, { contactId: CONTACT, allotmentId: ALLOT, receiptId: null });
  assert.ok(r.sink.records().some((x) => x.kind === 'refusal' && x.reason === 'rollback-incomplete' && x.recordIds.includes(CONTACT)));
  noIdentity(r.sink);
});

test('a lost Contact insert answer is settled by re-reading the email, and the add carries on', async () => {
  const r = rig({ contactInsert: 'THROW', search: (n) => (n === 0 ? 'contacts.search-none' : 'contacts.search-created') });
  const res = await r.add.add(principal(), form());
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.value.contactId, CONTACT);
  assert.equal(r.writes().filter((c) => c[1] === '/Contacts').length, 1, 'the Contact is not written twice');
});

test('the same Idempotency-Key from the same person gets the first answer back and writes nothing new', async () => {
  const r = rig();
  const a = await r.add.add(principal(), form(), 'add-investor-key-0001');
  const n = r.calls.length;
  const b = await r.add.add(principal(), form(), 'add-investor-key-0001');
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(b.value.replayed, true);
  assert.equal(b.value.contactId, a.value.contactId);
  assert.equal(r.calls.length, n);
  const bad = await r.add.add(principal(), form(), 'x');
  assert.equal(bad.reasonCode, 'idempotency-key-invalid');
});

/* M18-S09-NOTE-2: the route builds the service per request, so the replay lived nowhere; now the key is claimed in SharedState */
{
  const { createMemoryState } = load('server/state/memory.js');
  const { createCatalystState } = load('server/state/catalyst.js');
  const { createFakeCatalyst, FAKE_CONFIG } = load('server/state/fake-catalyst.js');
  for (const [name, two] of [
    ['memory', () => { const st = createMemoryState({ clock: () => NOW }); return [st, st]; }],
    ['fake catalyst', () => { const fake = createFakeCatalyst({ seed: 3 }); const mk = () => createCatalystState(FAKE_CONFIG, { fetch: fake.fetch, clock: () => NOW, sleep: async () => undefined }); return [mk(), mk()]; }],
  ]) {
    test(`two instances (${name}): one Idempotency-Key pressed on both at once adds the investor once; the other gets the first answer`, async () => {
      const r = rig();
      const [s1, s2] = two();
      const [a, b] = await Promise.all([r.addOn(s1).add(principal(), form(), 'add-investor-key-0900'), r.addOn(s2).add(principal(), form(), 'add-investor-key-0900')]);
      assert.equal(a.ok && b.ok, true, JSON.stringify([a, b]));
      assert.deepEqual([a.value.replayed, b.value.replayed].sort(), [false, true]);
      assert.equal(a.value.contactId, b.value.contactId);
      assert.equal(r.writes().filter((c) => c[1] === '/Contacts').length, 1, 'one Contact across both instances');
      // a fresh service (a new request on either instance) still replays
      const c = await r.addOn(s2).add(principal(), form(), 'add-investor-key-0900');
      assert.equal(c.ok && c.value.replayed, true);
    });
  }
}

/* ---- M10-S21: the App account card ------------------------------------------------------------------ */

test('what the card reads, from App_Access, the welcome write-back and the history', () => {
  const opened = [{ at: '2026-09-20T11:00:00+05:30', byId: ACTOR }];
  const unlocked = [{ at: '2026-09-28T10:30:00+05:30', byId: ACTOR }, ...opened];
  assert.equal(cardState(null, null, null, []).text, 'No account yet — it is created On hold, and sign-in stays locked until Finance presses Send welcome and unlock');
  assert.equal(cardState('Hold', null, null, opened).text, 'On hold — data synced, sign-in locked, no email sent');
  assert.equal(cardState('Invite', null, null, unlocked).text, 'Welcome sending…');
  assert.equal(cardState('Invite', '2026-09-28T10:32:00+05:30', 'Email', unlocked).text, 'Welcome delivered 28 Sep 10:32 · Email');
  assert.equal(cardState('Invite', '2026-09-01T10:32:00+05:30', 'Email', unlocked).state, 'sending', 'a welcome from before this unlock does not count');
  assert.equal(cardState('Hold', '2026-09-28T10:32:00+05:30', 'Email', unlocked).text, 'Locked — sign-in blocked');
  assert.equal(cardState('Hold', null, null, unlocked).state, 'locked', 'invited then locked before the welcome landed');
});

test('card: an account on hold, with its history, for Finance; read-only for everyone else', async () => {
  let r = rig();
  let res = await r.app.card(principal(), CONTACT);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.value.state, 'hold');
  assert.equal(res.value.modifiedTime, T1);
  assert.equal(res.value.mayChange, true);
  assert.deepEqual(res.value.history.map((h) => ({ ...h })), [{ at: '2026-09-20T11:00:00+05:30', byId: '9007199254740993091' }]);
  r = rig({ finance: false });
  res = await r.app.card(principal(), CONTACT);
  assert.equal(res.value.mayChange, false);
  assert.equal(r.writes().length, 0);
});

test('M08-S08: the card carries the account\'s mark — Tentative from the first matched receipt, Permanent once Zoho says so; opened = the oldest App_Access change', async () => {
  let r = rig({ contact: 'contact.hold-tentative' });
  let res = await r.app.card(principal(), CONTACT);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.deepEqual([res.value.mark, res.value.markAt, res.value.openedAt, res.value.state], ['Tentative', '2026-09-20T11:00:00+05:30', '2026-09-20T11:00:00+05:30', 'hold']);
  const read = r.calls.find((c) => c[0] === 'GET' && c[1] === `/Contacts/${CONTACT}`);
  assert.match(read[2].fields, /App_Account_Mark,App_Mark_At/, 'the mark is read with the card, on the person\'s token');
  r = rig({ contact: 'contact.hold-permanent' });
  res = await r.app.card(principal(), CONTACT);
  assert.deepEqual([res.value.mark, res.value.markAt], ['Permanent', '2026-09-21T10:00:00+05:30']);
  r = rig();
  res = await r.app.card(principal(), CONTACT);
  assert.deepEqual([res.value.mark, res.value.markAt], [null, null], 'no mark on the Contact (empty): the card says none, not tentative');
});

test('M08-S08: a Zoho that refuses a mark field does not take the card down — it is read again without the mark', async () => {
  const r = rig({ contact: (n) => (n === 0 ? 'contact.read-invalid-field' : 'contact.hold') });
  const res = await r.app.card(principal(), CONTACT);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.deepEqual([res.value.state, res.value.mark, res.value.markAt], ['hold', null, null]);
  const reads = r.calls.filter((c) => c[0] === 'GET' && c[1] === `/Contacts/${CONTACT}`);
  assert.equal(reads.length, 2);
  assert.doesNotMatch(reads[1][2].fields, /App_Account_Mark|App_Mark_At/);
});

test('M08-S08: if the card cannot be read even without the mark, it is a source error — never an empty account', async () => {
  const r = rig({ contact: 'contact.read-invalid-field' });
  const res = await r.app.card(principal(), CONTACT);
  assert.deepEqual([res.ok, res.kind], [false, 'source-error']);
  assert.equal(r.calls.filter((c) => c[0] === 'GET' && c[1] === `/Contacts/${CONTACT}`).length, 2, 'asked twice, then the source error stands');
});

test('Send welcome and unlock: App_Access Hold → Invite, guarded by Modified_Time, and nothing mailed from the console', async () => {
  const r = rig({ contact: (n) => (n === 0 ? 'contact.hold' : 'contact.invite'), timeline: 'timeline.unlocked' });
  const res = await r.app.unlock(principal(), CONTACT, T1);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.already, false);
  assert.equal(res.value.state, 'sending');
  assert.equal(res.value.text, 'Welcome sending…');
  const w = r.writes();
  assert.equal(w.length, 1);
  assert.deepEqual(w[0][2].data[0], { App_Access: 'Invite' });
  assert.equal(w[0][3]['If-Unmodified-Since'], T1);
  assert.ok(r.sink.records().some((x) => x.kind === 'refusal' && x.reason === 'unlocked' && x.recordIds.includes(CONTACT)));
});

test('unlocking an unlocked account changes nothing (the welcome goes once)', async () => {
  const r = rig({ contact: 'contact.invite-delivered', timeline: 'timeline.unlocked' });
  const res = await r.app.unlock(principal(), CONTACT);
  assert.equal(res.ok, true);
  assert.equal(res.already, true);
  assert.equal(res.value.text, 'Welcome delivered 28 Sep 10:32 · Email');
  assert.equal(r.writes().length, 0);
});

test('someone else changed the investor: a stale screen and a 412 are both refused as changed', async () => {
  let r = rig();
  let res = await r.app.unlock(principal(), CONTACT, '2026-09-27T09:00:00+05:30');
  assert.equal(res.reasonCode, 'changed');
  assert.equal(r.writes().length, 0);
  r = rig({ update: 'contact.conflict-412' });
  res = await r.app.unlock(principal(), CONTACT, T1);
  assert.equal(res.reasonCode, 'changed');
});

test('no account yet, or not Finance: refused, nothing written', async () => {
  let r = rig({ contact: 'contact.no-access' });
  let res = await r.app.unlock(principal(), CONTACT);
  assert.equal(res.reasonCode, 'no-account');
  r = rig({ finance: false });
  res = await r.app.unlock(principal(), CONTACT);
  assert.equal(res.reasonCode, 'not-finance');
  assert.equal(r.calls.length, 0);
});

test('Lock app access: a reason is required; Invite → Hold, the reason is a Note under the person\'s name, never in the log', async () => {
  let r = rig({ contact: 'contact.invite-delivered' });
  let res = await r.app.lock(principal(), CONTACT, '   ');
  assert.equal(res.reasonCode, 'reason-required');
  assert.equal(r.calls.length, 0);
  r = rig({ contact: (n) => (n === 0 ? 'contact.invite-delivered' : 'contact.hold-locked'), timeline: 'timeline.unlocked' });
  res = await r.app.lock(principal(), CONTACT, 'the investor asked us to pause access');
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.value.text, 'Locked — sign-in blocked');
  assert.equal(res.noteSaved, true);
  const w = r.writes();
  assert.deepEqual(w.map((c) => c[0] + ' ' + c[1]), [`PUT /Contacts/${CONTACT}`, 'POST /Notes']);
  assert.deepEqual(w[0][2].data[0], { App_Access: 'Hold' });
  assert.deepEqual(w[1][2].data[0], { Note_Title: 'App access locked', Note_Content: 'the investor asked us to pause access',
    Parent_Id: { module: { api_name: 'Contacts' }, id: CONTACT } });
  noIdentity(r.sink);
});

/* ---- D115 ruling 1: app access stays Hold until a person with the release right releases it ------------ */

test('D115: add-paid creates the account Hold whether paid in full or reserved; the add answer says it waits for the release', async () => {
  for (const amountPaid of [5_000_000, 500_000]) {
    const r = rig();
    const res = await r.add.add(principal(), form({ amountPaid }));
    assert.equal(res.ok, true, JSON.stringify(res));
    const contact = r.writes().find((c) => c[0] === 'POST' && c[1] === '/Contacts');
    assert.equal(contact[2].data[0].App_Access, 'Hold');
    assert.match(res.value.app, /locked until Finance presses Send welcome and unlock/);
    assert.doesNotMatch(res.value.app, /match/i, 'the answer no longer says a match opens it');
  }
});

test('D115: the release (Send welcome and unlock) is the one Hold → Invite write, logged in the ops log; without the right it is refused before any read', async () => {
  let r = rig({ contact: (n) => (n === 0 ? 'contact.hold' : 'contact.invite'), timeline: 'timeline.unlocked' });
  let res = await r.app.unlock(principal(), CONTACT, T1);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.deepEqual(r.writes().map((c) => [c[0], c[1], c[2].data[0]]), [['PUT', `/Contacts/${CONTACT}`, { App_Access: 'Invite' }]]);
  const line = r.sink.records().find((x) => x.kind === 'refusal' && x.action === 'app-access' && x.reason === 'unlocked');
  assert.ok(line, 'one app-access / unlocked line');
  assert.deepEqual([...line.recordIds], [CONTACT]);
  assert.equal(line.actor.userId, ACTOR, 'under the releaser\'s own id');
  r = rig({ finance: false });
  res = await r.app.unlock(principal(), CONTACT, T1);
  assert.deepEqual([res.ok, res.reasonCode, res.message], [false, 'not-finance', 'Finance controls app access.']);
  assert.equal(r.calls.length, 0, 'no Zoho call at all without the release right');
  assert.ok(r.sink.records().some((x) => x.kind === 'refusal' && x.action === 'app-access' && x.reason === 'not-finance'));
  noIdentity(r.sink);
});

test('M08-S08-NOTE-10: the release is also a Plane C authority line — releaser, seat, Contact id, outcome — beside the Plane B line; refused releases too; a lock and a repeat are not releases', async () => {
  let r = rig({ contact: (n) => (n === 0 ? 'contact.hold' : 'contact.invite'), timeline: 'timeline.unlocked' });
  let res = await r.app.unlock({ ...principal(), seat: 'fin' }, CONTACT, T1);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.deepEqual(r.planeC, [[ACTOR, 'fin', CONTACT, 'ok', 'released']]);
  assert.ok(r.sink.records().some((x) => x.kind === 'refusal' && x.action === 'app-access' && x.reason === 'unlocked'), 'the Plane B line stays');
  r = rig({ finance: false });
  await r.app.unlock({ ...principal(), seat: 'kam' }, CONTACT, T1);
  assert.deepEqual(r.planeC, [[ACTOR, 'kam', CONTACT, 'refused', 'not-finance']]);
  r = rig({ contact: 'contact.invite-delivered', timeline: 'timeline.unlocked' });
  res = await r.app.unlock(principal(), CONTACT);
  assert.equal(res.already, true);
  assert.deepEqual(r.planeC, [], 'already unlocked: nothing released');
  r = rig({ contact: (n) => (n === 0 ? 'contact.invite-delivered' : 'contact.hold-locked'), timeline: 'timeline.unlocked' });
  res = await r.app.lock(principal(), CONTACT, 'Investor asked us to pause access');
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.deepEqual(r.planeC, [], 'a lock is not a release');
  r = rig();
  await r.app.unlock(principal(), 'not-an-id');
  assert.deepEqual(r.planeC, [[ACTOR, null, '', 'refused', 'invalid-request']], 'a bad id is never carried onto the line');
  assert.throws(() => createAppAccess({ crm: r.calls && { getRecord() {}, update() {}, insert() {}, timeline() {} }, authority: { mayChange: async () => true },
    log: createOpsLog(createMemorySink()), recordIdPrefix: P }), /Plane C events/);
});

