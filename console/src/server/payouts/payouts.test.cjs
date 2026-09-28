/* M10-S20-T02 — monthly payouts: the 60-month schedule job (idempotent), the Finance due queue, the Payouts tab
 * read and marking a payout paid (guarded write, UTR masked, never logged).
 *
 * Run from console/: node --test src/server/payouts/payouts.test.cjs
 * Replays recorded Zoho responses (__fixtures__/payouts). No request reaches Zoho.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { before, test } = require('node:test');

const consoleRoot = path.resolve(__dirname, '..', '..', '..');
const srcRoot = path.join(consoleRoot, 'src');
const fx = path.join(srcRoot, 'lib', 'zoho', '__fixtures__', 'payouts');
const ts = require(path.join(consoleRoot, 'node_modules', 'typescript'));
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoho-payouts-'));
process.on('exit', () => fs.rmSync(outDir, { recursive: true, force: true }));
const config = ts.readConfigFile(path.join(consoleRoot, 'tsconfig.json'), ts.sys.readFile);
const project = ts.parseJsonConfigFileContent(config.config, ts.sys, consoleRoot);
const options = { ...project.options, incremental: false, tsBuildInfoFile: undefined, plugins: undefined,
  module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10, noEmit: false, noEmitOnError: true, outDir, rootDir: srcRoot };
const program = ts.createProgram(['server/payouts/schedule.ts', 'server/payouts/queue.ts', 'server/payouts/mark-paid.ts', 'server/payouts/authority.ts']
  .map((f) => path.join(srcRoot, f)), options);
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
const load = (f) => require(path.join(outDir, f));
const { createMemorySink, createOpsLog } = load('lib/zoho/log.js');
const { createZohoClient, userCredential } = load('lib/zoho/client.js');
const { payoutSchedule, PAYOUT_MONTHS } = load('lib/im/money.js');
const S = load('server/payouts/schedule.js');
const { createPayoutReads, maskUtr } = load('server/payouts/queue.js');
const { createMarkPaid } = load('server/payouts/mark-paid.js');
const { payoutCapsOf } = load('server/payouts/authority.js');

const P = '9007199254';
const HARSHA = `${P}740993002`, KAM = `${P}740994001`;
const A1 = `${P}740999101`, A2 = `${P}740999102`, A3 = `${P}740999103`, UNSEEN = `${P}740999108`;
const PO2 = `${P}741000202`;
const NOW = Date.parse('2026-09-28T06:00:00Z'); // 11:30 IST, 28 Sep 2026

const recorded = (name) => JSON.parse(fs.readFileSync(path.join(fx, `${name}.response.json`), 'utf8'));
const toResponse = (r) => new Response(r.status === 204 ? null : JSON.stringify(r.body), { status: r.status, headers: r.headers || {} });
const immediateGate = () => ({ async acquire() { return { waitedMs: 0, release() {} }; }, async run(_c, t) { return t(); }, snapshot() { return {}; } });
let cred;
before(async () => {
  cred = await userCredential({ access_token: 'synthetic-harsha', api_domain: 'https://www.zohoapis.in', expires_in: 3_600 },
    { recordIdPrefix: P, gate: immediateGate(), log: createOpsLog(createMemorySink()), clock: () => NOW,
      fetch: async () => toResponse({ status: 200, body: { users: [{ id: HARSHA, status: 'active' }] } }) });
});

/** A Zoho fake over recorded responses; `route(req)` answers one request ({method, url, q, body, headers}). */
function rig(route) {
  const calls = [], sink = createMemorySink(), log = createOpsLog(sink);
  const crm = createZohoClient({ recordIdPrefix: P, gate: immediateGate(), log, maxAttempts: 1, clock: () => NOW,
    fetch: async (url, init = {}) => {
      const body = init.body ? JSON.parse(init.body) : null;
      const req = { method: init.method || 'GET', url: String(url), q: body && body.select_query, body, headers: new Headers(init.headers || {}) };
      calls.push(req);
      const r = await route(req);
      return r instanceof Response ? r : toResponse(r);
    } });
  return { crm, log, sink, calls, writes: () => calls.filter((c) => c.method !== 'GET' && !/\/coql$/.test(c.url)) };
}
const logText = (sink) => JSON.stringify(sink.records ?? sink.entries ?? sink);

/* ------------------------------ the schedule (pure) ------------------------------ */

const a1 = () => S.allotmentOf(recorded('allotments-schedule').body.data[0]);

test('the 60 records are the front end\'s payoutSchedule mapped onto Investor_Payouts (import, not re-port)', () => {
  const a = a1();
  assert.deepEqual([a.status, a.issuedUnits, a.unitPrice, a.yieldPct, a.issuedOn], ['Issued', 2, 2000000, 20, '2026-08-14']);
  const recs = S.scheduleRecords(a);
  assert.equal(recs.length, PAYOUT_MONTHS);
  assert.equal(PAYOUT_MONTHS, 60);
  const fe = payoutSchedule({ id: A1, Customer: '', LLP_Lookup: '', Committed_Units: 2, Issued_Units: 2, Unit_Price: 2000000, Ticket_Snapshot: 4000000,
    Allocation_Status: 'Issued', Issued_On: '2026-08-14', Annual_Rental_Yield: 20 });
  recs.forEach((r, i) => {
    assert.equal(r.Instalment_No, fe[i].Instalment_No);
    assert.equal(r.Due_On, fe[i].Due_On);
    assert.equal(r.Gross_Amount, fe[i].Gross_Amount);
  });
  assert.deepEqual(recs[0], { Name: `${A1}-01`, Allotment: { id: A1 }, Payout_Kind: 'Rental yield', Instalment_No: 1, Period_Month: '2026-09-01',
    Due_On: '2026-09-10', Gross_Amount: 66667, TDS_Amount: 0, Net_Amount: 66667, Payout_State: 'Scheduled' });
  assert.equal(recs[59].Due_On, '2031-08-10');
  assert.equal(recs[59].Name, `${A1}-60`);
  assert.ok(recs.every((r) => Number.isInteger(r.Gross_Amount) && r.TDS_Amount === 0 && r.Net_Amount === r.Gross_Amount), 'whole rupees; TDS 0; net = gross');
});

test('a Reserved allotment, or one without an issue date, gets no schedule', () => {
  const [, a2, a3] = recorded('allotments-schedule').body.data.map(S.allotmentOf);
  assert.equal(S.unschedulable(a2), 'not-issued');
  assert.equal(S.unschedulable(a3), 'no-issue-date');
  assert.deepEqual(S.scheduleRecords(a2), []);
  assert.deepEqual(S.scheduleRecords(a3), []);
});

test('only missing instalments are planned: any state counts as present, other kinds are ignored, doubles reported', () => {
  const m = S.missingRecords(a1(), recorded('existing-a1-partial').body.data);
  assert.equal(m.present, 3);
  assert.deepEqual(m.doubled, [2]);
  assert.deepEqual(m.records.map((r) => r.Instalment_No), Array.from({ length: 57 }, (_, i) => i + 4));
});

/* ------------------------------ the schedule job ------------------------------ */

/** A stateful Investor_Payouts store: inserts land in it; the payout read replays it as a recorded page. */
function storeRig({ existing = [], loseInsertReply = 0 } = {}) {
  const store = [...existing];
  let n = 0, lost = loseInsertReply;
  const r = rig((req) => {
    if (req.q && /from LLP_UnitAllocation_Module/.test(req.q)) return recorded('allotments-schedule');
    if (req.q && /from Investor_Payouts/.test(req.q)) {
      const rows = store.filter((x) => req.q.includes(`'${x.Allotment.id}'`));
      return rows.length ? { status: 200, headers: {}, body: { data: rows, info: { count: rows.length, more_records: false } } } : recorded('none');
    }
    if (req.method === 'POST' && /\/Investor_Payouts$/.test(req.url)) {
      const out = req.body.data.map((rec) => { const id = `${P}7410${String(5000 + ++n).padStart(5, '0')}`; store.push({ id, ...rec }); return id; });
      if (lost > 0) { lost--; throw new TypeError('fetch failed'); } // the write landed; the reply was lost
      return { status: 201, headers: {}, body: { data: out.map((id) => ({ code: 'SUCCESS', details: { id, Modified_Time: '2026-09-28T11:30:00+05:30' }, message: 'record added', status: 'success' })) } };
    }
    throw new Error(`unrouted ${req.method} ${req.url} ${req.q || ''}`);
  });
  return { ...r, store, job: S.createPayoutScheduleJob({ crm: r.crm, log: r.log, recordIdPrefix: P, clock: () => NOW }) };
}

test('the job creates the 60 instalments of an Issued allotment, skips the rest with a reason, and a second run creates nothing', async () => {
  const r = storeRig();
  const first = await r.job.run(cred, [A1, A2, A3, UNSEEN], { commit: true });
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.deepEqual(first.outcomes.map((o) => [o.allotmentId, o.status, o.created ?? o.reason]),
    [[A1, 'created', 60], [A2, 'skipped', 'not-issued'], [A3, 'skipped', 'no-issue-date'], [UNSEEN, 'skipped', 'not-visible']]);
  assert.equal(r.store.length, 60);
  assert.equal(r.writes().length, 1, 'one insert of 60 (≤100 a call)');
  // the allotment read is one COQL with IN; the payout read names only the schedulable allotment
  const q = r.calls.filter((c) => c.q).map((c) => c.q);
  assert.match(q[0], /from LLP_UnitAllocation_Module where id in \(/);
  assert.match(q[0], /Investment_Date/);
  assert.match(q[1], new RegExp(`from Investor_Payouts where Allotment in \\('${A1}'\\)`));

  const again = await r.job.run(cred, [A1], { commit: true });
  assert.deepEqual(again.outcomes.map((o) => [o.status, o.present]), [['complete', 60]]);
  assert.equal(r.store.length, 60, 'never duplicated');
  assert.equal(r.writes().length, 1, 'the second run wrote nothing');
});

test('existing instalments are kept: a partial schedule is filled with only the missing numbers', async () => {
  const r = storeRig({ existing: recorded('existing-a1-partial').body.data });
  const res = await r.job.run(cred, [A1], { commit: true });
  assert.deepEqual(res.outcomes.map((o) => [o.status, o.created, o.present, o.doubled]), [['created', 57, 3, [2]]]);
  const nos = r.store.filter((x) => x.Payout_Kind === 'Rental yield').map((x) => x.Instalment_No).sort((a, b) => a - b);
  assert.deepEqual([...new Set(nos)], Array.from({ length: 60 }, (_, i) => i + 1));
});

test('a lost insert reply is not retried blindly: the run stops, and the next run re-reads and creates nothing twice', async () => {
  const r = storeRig({ loseInsertReply: 1 });
  const first = await r.job.run(cred, [A1], { commit: true });
  assert.equal(first.outcomes[0].status, 'failed');
  assert.equal(r.writes().length, 1, 'no automatic resend of a non-idempotent insert');
  const again = await r.job.run(cred, [A1], { commit: true });
  assert.equal(again.outcomes[0].status, 'complete');
  assert.equal(r.store.length, 60);
});

test('a dry run plans and writes nothing; bad input is refused before any read; logs carry no amount', async () => {
  const r = storeRig();
  const plan = await r.job.run(cred, [A1], { commit: false });
  assert.deepEqual(plan.outcomes.map((o) => [o.status, o.wouldCreate]), [['planned', 60]]);
  assert.equal(r.writes().length, 0);
  const bad = await r.job.run(cred, ['AL-1'], { commit: true });
  assert.deepEqual(bad, { ok: false, kind: 'refused', reason: 'invalid-request' });
  const created = await r.job.run(cred, [A1], { commit: true });
  assert.equal(created.outcomes[0].status, 'created');
  assert.ok(!/66667|2000000/.test(logText(r.sink)), 'no amount in the logs');
});

/* ------------------------------ reads ------------------------------ */

const reads = (r, may = true) => createPayoutReads({ crm: r.crm, log: r.log, recordIdPrefix: P, clock: () => NOW, mayRead: async () => may });

test('AC2: the due queue lists Scheduled payouts due in this IST month across the allotments the token shows; overdue apart', async () => {
  const r = rig((req) => {
    if (/from Investor_Payouts/.test(req.q)) return recorded('queue');
    if (/from LLP_UnitAllocation_Module/.test(req.q)) return recorded('queue-allotments');
    throw new Error('unrouted ' + req.q);
  });
  const res = await reads(r).dueQueue(cred);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.month, '2026-09');
  assert.deepEqual(res.due.map((l) => [l.id.slice(-3), l.dueOn, l.investor.name, l.farm.name, l.gross, l.net]),
    [['302', '2026-09-10', 'Kiran Rao', 'EKA LLP', 45833, 45833], ['303', '2026-09-10', 'Joseph Mathew', 'EKA LLP', 45833, 45833]]);
  assert.deepEqual(res.overdue.map((l) => l.id.slice(-3)), ['301']);
  const [pq, aq] = r.calls.map((c) => c.q);
  assert.match(pq, /where Payout_State = 'Scheduled' and Due_On <= '2026-09-30' order by Due_On asc, id asc limit 0, 2000/);
  assert.ok(!/Payout_UTR|Payout_Note/.test(pq), 'the queue never selects the UTR or the note');
  assert.match(aq, /from LLP_UnitAllocation_Module where id in \(/);
  assert.ok(!res.due.some((l) => l.allotmentId === `${P}740999109`), 'a payout whose allotment the token does not show is left out');
});

test('a seat without pay/bank reads nothing: refused before any Zoho call', async () => {
  const r = rig(() => { throw new Error('no call expected'); });
  assert.deepEqual(await reads(r, false).dueQueue(cred), { ok: false, kind: 'refused', reason: 'seat-denied' });
  assert.deepEqual(await reads(r, false).scheduleOf(cred, A1), { ok: false, kind: 'refused', reason: 'seat-denied' });
  assert.equal(r.calls.length, 0);
});

test('AC1: the Payouts tab lists an allotment\'s schedule in instalment order with state; the UTR comes back masked only', async () => {
  const r = rig((req) => (/from Investor_Payouts where Allotment = /.test(req.q) ? recorded('schedule-a1') : recorded('none')));
  const res = await reads(r).scheduleOf(cred, A1);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.deepEqual(res.payouts.map((p) => [p.instalment, p.state, p.dueOn, p.month]),
    [[1, 'Paid', '2026-09-10', '2026-09'], [2, 'Scheduled', '2026-10-10', '2026-10'], [3, 'Held', '2026-11-10', '2026-11']]);
  const paid = res.payouts[0];
  assert.deepEqual([paid.paidOn, paid.mode, paid.utrMasked, paid.gross, paid.tds, paid.net, paid.paidBy.name], ['2026-09-10', 'NEFT', '••••2345', 66667, 6667, 60000, 'Harsha Iyer']);
  assert.ok(!JSON.stringify(res).includes('HDFCN52026091012345'), 'the whole UTR never leaves');
  assert.equal(maskUtr(''), null);
  const foreign = rig(() => recorded('schedule-foreign'));
  assert.deepEqual(await reads(foreign).scheduleOf(cred, A1), { ok: false, kind: 'refused', reason: 'source-invalid' });
});

/* ------------------------------ mark paid ------------------------------ */

function payRig(get, { utr = 'none', update = 'update-ok', may = true } = {}) {
  const r = rig((req) => {
    if (req.method === 'GET' && req.url.includes(`/Investor_Payouts/${PO2}`)) return recorded(get);
    if (req.q && /Payout_UTR = /.test(req.q)) return recorded(utr);
    if (req.method === 'PUT' && req.url.includes(`/Investor_Payouts/${PO2}`)) return recorded(update);
    throw new Error(`unrouted ${req.method} ${req.url} ${req.q || ''}`);
  });
  return { ...r, pay: createMarkPaid({ crm: r.crm, log: r.log, recordIdPrefix: P, clock: () => NOW, mayPay: async () => may }) };
}
const BODY = { payoutId: PO2, paidOn: '2026-09-28', mode: 'NEFT', utr: 'utr 2026092800777', tds: 6667, modifiedTime: '2026-09-20T10:00:00+05:30' };

test('AC3: marking paid sets Payout_State Paid, Paid_On, Payout_Mode, Payout_UTR, Paid_By and Net = Gross − TDS, guarded by If-Unmodified-Since', async () => {
  const r = payRig('get-scheduled');
  const res = await r.pay.commit(cred, BODY, 'press-0000000001');
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.deepEqual(res.value, { payoutId: PO2, allotmentId: A1, state: 'Paid', paidOn: '2026-09-28', mode: 'NEFT', utrMasked: '••••0777',
    gross: 66667, tds: 6667, net: 60000, paidBy: HARSHA, modifiedTime: '2026-09-28T11:31:00+05:30', duplicate: false });
  const put = r.writes();
  assert.equal(put.length, 1);
  assert.deepEqual(put[0].body.data[0], { Payout_State: 'Paid', Paid_On: '2026-09-28', Payout_Mode: 'NEFT', Payout_UTR: 'UTR2026092800777',
    Paid_By: { id: HARSHA }, TDS_Amount: 6667, Net_Amount: 60000 });
  assert.equal(put[0].headers.get('If-Unmodified-Since'), '2026-09-20T10:00:00+05:30');
  assert.ok(!/2026092800777/.test(logText(r.sink)), 'the UTR is never logged');
});

test('AC4: TDS is optional and defaults to 0 (net = gross); the console never computes it', async () => {
  const r = payRig('get-scheduled');
  const { tds, ...noTds } = BODY;
  const res = await r.pay.commit(cred, noTds, 'press-0000000002');
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.deepEqual([res.value.tds, res.value.net], [0, 66667]);
  assert.deepEqual([r.writes()[0].body.data[0].TDS_Amount, r.writes()[0].body.data[0].Net_Amount], [0, 66667]);
});

test('the double-press guard: the same key joins the first press (one write); the same key with another payment is refused', async () => {
  const r = payRig('get-scheduled');
  const [x, y] = await Promise.all([r.pay.commit(cred, BODY, 'press-0000000003'), r.pay.commit(cred, BODY, 'press-0000000003')]);
  assert.equal(x.ok && y.ok, true);
  assert.deepEqual([x.value.duplicate, y.value.duplicate], [false, true]);
  assert.equal(r.writes().length, 1);
  const z = await r.pay.commit(cred, { ...BODY, utr: 'OTHER000111' }, 'press-0000000003');
  assert.equal(z.reasonCode, 'idempotency-key-reused');
  assert.equal(r.writes().length, 1);
});

test('a payout is paid once: already Paid is refused with no write; a lost reply to the same payment is answered as its success', async () => {
  const r = payRig('get-paid');
  const res = await r.pay.commit(cred, BODY, 'press-0000000004');
  assert.deepEqual([res.ok, res.reasonCode, res.paidOn], [false, 'already-paid', '2026-09-27']);
  assert.equal(r.writes().length, 0);
  const same = payRig('get-paid-same');
  const again = await same.pay.commit(cred, BODY, 'press-0000000005');
  assert.deepEqual([again.ok, again.value.duplicate, again.value.utrMasked], [true, true, '••••0777']);
  assert.equal(same.writes().length, 0);
});

test('refusals before any write: Cancelled, TDS above gross, a future date, no UTR, a bad mode, a UTR on another payout, a non-pay seat', async () => {
  const cases = [
    ['get-cancelled', {}, 'cancelled', {}],
    ['get-scheduled', { tds: 70000 }, 'tds-out-of-range', {}],
    ['get-scheduled', { tds: -1 }, 'tds-out-of-range', {}],
    ['get-scheduled', { paidOn: '2026-09-29' }, 'paid-on-future', {}],
    ['get-scheduled', { utr: '  ' }, 'utr-required', {}],
    ['get-scheduled', { mode: 'Cash' }, 'fields', {}],
    ['get-scheduled', {}, 'utr-reused', { utr: 'utr-other' }],
    ['get-scheduled', {}, 'read-only', { may: false }],
  ];
  let k = 10;
  for (const [get, patch, code, opts] of cases) {
    const r = payRig(get, opts);
    const res = await r.pay.commit(cred, { ...BODY, ...patch }, `press-00000000${k++}`);
    assert.deepEqual([res.ok, res.reasonCode], [false, code], `${code}: ${JSON.stringify(res)}`);
    assert.equal(r.writes().length, 0, code);
    if (code === 'read-only') assert.equal(r.calls.length, 0, 'a non-pay seat reaches no Zoho call');
  }
});

test('someone else\'s change in between is a 409 "changed", never an overwrite', async () => {
  const r = payRig('get-scheduled', { update: 'update-conflict' });
  const res = await r.pay.commit(cred, BODY, 'press-0000000030');
  assert.deepEqual([res.ok, res.reasonCode], [false, 'changed']);
});

/* ------------------------------ who ------------------------------ */

test('who reads and pays: Head of Finance and Finance Operations; never Compliance, the Auditor, a KAM, an IR — nor an administrator seat', () => {
  const caps = (seat) => { const c = payoutCapsOf(seat, KAM); return [c.read, c.pay]; };
  assert.deepEqual(caps('head'), [true, true]);
  assert.deepEqual(caps('fin'), [true, true]);
  // Digital Infrastructure is an Administrator-profile seat: the policy admits it to no console page (policy.test), so it pays nothing here.
  assert.deepEqual(caps('ops'), [false, false]);
  for (const s of ['comp', 'kam', 'amlead', 'ir', 'conv', 'bu', 'exec', 'nobody']) assert.deepEqual(caps(s), [false, false], s);
});
