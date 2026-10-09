/* MONEY — M10-S01-T02/T03 and M18-S12-T01: the legacy-payment migration and the Payments register.
 *
 * Run from console/: node src/server/money/legacy-and-register.test.cjs
 *
 * Compiles the modules with the project's TypeScript and drives them through the real Zoho client
 * with synthetic recorded responses (__fixtures__/receipts/legacy.* and register.*). The migration
 * rig keeps an in-memory Receipts list so a second run can prove idempotency. No request reaches Zoho.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { before, test } = require('node:test');

const consoleRoot = path.resolve(__dirname, '..', '..', '..');
const srcRoot = path.join(consoleRoot, 'src');
const fixtureRoot = path.join(srcRoot, 'lib', 'zoho', '__fixtures__', 'receipts');
const ts = require(path.join(consoleRoot, 'node_modules', 'typescript'));
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoho-money-'));
process.on('exit', () => fs.rmSync(outDir, { recursive: true, force: true }));

const config = ts.readConfigFile(path.join(consoleRoot, 'tsconfig.json'), ts.sys.readFile);
const project = ts.parseJsonConfigFileContent(config.config, ts.sys, consoleRoot);
const options = { ...project.options, incremental: false, tsBuildInfoFile: undefined, plugins: undefined,
  module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10, noEmit: false, noEmitOnError: true, outDir, rootDir: srcRoot };
const sources = ['lib/zoho/errors.ts', 'lib/zoho/gate.ts', 'lib/zoho/log.ts', 'lib/zoho/client.ts', 'server/oauth/seat.ts',
  'server/money/migrate-legacy.ts', 'server/money/register.ts'].map((f) => path.join(srcRoot, f));
const program = ts.createProgram(sources, options);
const diagnostics = [...ts.getPreEmitDiagnostics(program), ...program.emit().diagnostics];
if (diagnostics.length) {
  console.error(ts.formatDiagnostics(diagnostics, { getCanonicalFileName: (f) => f, getCurrentDirectory: () => consoleRoot, getNewLine: () => '\n' }));
  process.exit(1);
}
const load = (file) => require(path.join(outDir, file));
const { createMemorySink, createOpsLog } = load('lib/zoho/log.js');
const { createZohoClient, userCredential } = load('lib/zoho/client.js');
const { createLegacyPaymentMigration, retireLegacyPaymentColumns } = load('server/money/migrate-legacy.js');
const { createPaymentsRegister } = load('server/money/register.js');

const P = '9007199254';
const A1 = `${P}740996001`, A2 = `${P}740996002`, A3 = `${P}740996003`;
const C1 = `${P}740996101`, C2 = `${P}740996102`;
const F1 = `${P}740996201`;
const SAHIL = `${P}740995100`;
const SESSION = 'session_fixture_money_01';
const NOW = Date.parse('2026-09-28T06:00:00Z');
const recorded = (name) => JSON.parse(fs.readFileSync(path.join(fixtureRoot, `${name}.response.json`), 'utf8'));
const toResponse = (r) => new Response(r.body === null ? null : JSON.stringify(r.body), { status: r.status, headers: r.headers || {} });
const immediateGate = () => ({ async acquire() { return { waitedMs: 0, release() {} }; } });
const MODES = { HDFC0000000001: 'NEFT', HDFC0000000002: 'RTGS', SBIN0000000003: 'NEFT' };
const SECRETS = ['HDFC0000000001', 'HDFC0000000002', 'SBIN0000000003', '250000', '750000', '1500000', 'Synthetic Investor', 'Synthetic Farm'];

let cred;
before(async () => {
  cred = await userCredential({ access_token: 'synthetic-sahil', api_domain: 'https://www.zohoapis.in', expires_in: 3_600 },
    { recordIdPrefix: P, gate: immediateGate(), log: createOpsLog(createMemorySink()), clock: () => NOW,
      fetch: async () => toResponse({ status: 200, body: { users: [{ id: SAHIL, status: 'active' }] } }) });
});

/* ---------------- migration rig: fixtures in, an in-memory Receipts module ---------------- */
function migrationRig(opts = {}) {
  const src = { allotments: recorded('legacy.allotments'), contacts: recorded('legacy.contacts'), links: recorded('legacy.contact-allotments') };
  if (opts.mutate) opts.mutate(src);
  const store = opts.store ?? [];
  const queries = [], inserts = [];
  let seq = 740996500;
  const sink = createMemorySink();
  const log = createOpsLog(sink);
  const page = (rows) => rows.length ? { status: 200, body: { data: rows, info: { count: rows.length, more_records: false } } } : recorded('receipts.empty');
  const crm = createZohoClient({ recordIdPrefix: P, gate: immediateGate(), log, maxAttempts: 1, clock: () => NOW,
    fetch: async (url, init) => {
      if (String(url).endsWith('/coql')) {
        const q = JSON.parse(init.body).select_query; queries.push(q);
        if (/from Contacts /.test(q)) return toResponse(src.contacts);
        if (/from LLP_UnitAllocation_Module where Customer in/.test(q)) return toResponse(src.links);
        if (/from LLP_UnitAllocation_Module /.test(q)) return toResponse(src.allotments);
        if (/from Receipts where UTR in/.test(q)) {
          const utrs = [...q.matchAll(/'([^']+)'/g)].map((m) => m[1]);
          return toResponse(page(store.filter((r) => utrs.includes(r.UTR))));
        }
        throw new Error(`unexpected query ${q}`);
      }
      if (init.method === 'POST' && String(url).endsWith('/Receipts')) {
        const data = JSON.parse(init.body).data; inserts.push(data);
        if (opts.failInsert) return toResponse(recorded('receipt.partial-malformed-207'));
        const out = data.map((r) => { const id = `${P}${++seq}`; store.push({ id, Allotment: { id: r.Allotment.id }, Amount: opts.writeAmount ? opts.writeAmount(r) : r.Amount, UTR: r.UTR });
          return { code: 'SUCCESS', details: { id, Modified_Time: '2026-09-28T11:30:00+05:30' }, message: 'record added', status: 'success' }; });
        return toResponse({ status: 201, headers: { 'content-type': 'application/json' }, body: { data: out } });
      }
      throw new Error(`unexpected call ${init.method} ${url}`);
    } });
  return { svc: createLegacyPaymentMigration({ crm, log, recordIdPrefix: P, clock: () => NOW }), queries, inserts, store, sink };
}
const noSecrets = (value) => { const s = JSON.stringify(value); for (const x of SECRETS) assert.ok(!s.includes(x), `leaked ${x}`); };

test('dry run plans, reconciles every investor and writes nothing', async () => {
  const r = migrationRig();
  const res = await r.svc.run(cred, { source: 'allotments', modes: MODES });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.value.mode, 'dry-run');
  assert.equal(res.value.status, 'done');
  assert.equal(res.value.planned, 3);
  assert.equal(r.inserts.length, 0);
  assert.deepEqual(res.value.investors.map((i) => [i.investorId, i.agreed]), [[C1, true], [C2, true]]);
  assert.match(r.queries[0], /^select id, Customer, LLP, .*Amount_1, UTR, Date_1, .*Date_10 from LLP_UnitAllocation_Module where \(+Amount_1 is not null or Amount_2 is not null\)/);
});

test('commit moves each slot into one Receipt on its allotment, with the inferred kind, and totals agree', async () => {
  const r = migrationRig();
  const res = await r.svc.run(cred, { source: 'allotments', modes: MODES, commit: true });
  assert.equal(res.value.status, 'done', JSON.stringify(res.value.halt));
  assert.equal(res.value.created.length, 3);
  const sent = r.inserts.flat();
  assert.deepEqual(sent.map((x) => [x.Allotment.id, x.Kind, x.Amount, x.Mode, x.UTR, x.Received_On, x.Match_State]), [
    [A1, 'Advance', 250000, 'NEFT', 'HDFC0000000001', '2026-06-01T00:00:00+05:30', 'Matched'],
    [A1, 'Full', 750000, 'RTGS', 'HDFC0000000002', '2026-06-20T00:00:00+05:30', 'Matched'],
    [A3, 'Full', 1500000, 'NEFT', 'SBIN0000000003', '2026-07-05T00:00:00+05:30', 'Matched'],
  ]);
  assert.equal(r.inserts.length, 2, 'one write per investor, each verified before the next');
  assert.ok(res.value.investors.every((i) => i.agreed));
  assert.ok(sent.every((x) => !Object.keys(x).some((k) => /^(Amount_|UTR_|Date_)\d/.test(k))), 'never writes the old columns');
});

test('a second run is idempotent: every slot is found by its UTR and skipped', async () => {
  const store = [];
  await migrationRig({ store }).svc.run(cred, { source: 'allotments', modes: MODES, commit: true });
  const again = migrationRig({ store });
  const res = await again.svc.run(cred, { source: 'allotments', modes: MODES, commit: true });
  assert.equal(res.value.status, 'done');
  assert.equal(res.value.skipped, 3);
  assert.equal(res.value.planned, 0);
  assert.equal(again.inserts.length, 0);
  assert.equal(store.length, 3);
});

test('a tampered Amount_2 halts before anything is written and names the record ids (TC-IM12-017)', async () => {
  const r = migrationRig({ mutate: (s) => { s.allotments.body.data[0].Amount_2 = 750001; } });
  const res = await r.svc.run(cred, { source: 'allotments', modes: MODES, commit: true });
  assert.equal(res.value.status, 'halted');
  assert.equal(res.value.halt.reason, 'total-mismatch');
  assert.ok(res.value.halt.recordIds.includes(A1));
  assert.equal(r.inserts.length, 0, 'no Receipt written after the stop');
  const refusal = r.sink.records().find((x) => x.kind === 'refusal');
  assert.equal(refusal.reason, 'total-mismatch');
});

test('a Contact with more than one live allotment halts as ambiguous; nothing written', async () => {
  const r = migrationRig({ mutate: (s) => { s.links.body.data[2].Allocation_Status = 'Reserved'; } });
  const res = await r.svc.run(cred, { source: 'contacts', modes: MODES, commit: true });
  assert.equal(res.value.halt.reason, 'ambiguous-allotment');
  assert.deepEqual(res.value.halt.recordIds.slice(0, 1), [C2]);
  assert.equal(r.inserts.length, 0);
});

test('the Contact source links each slot to the Contact\'s one live allotment (cancelled ones ignored)', async () => {
  const r = migrationRig();
  const res = await r.svc.run(cred, { source: 'contacts', modes: MODES, commit: true });
  assert.equal(res.value.status, 'done', JSON.stringify(res.value.halt));
  assert.deepEqual(r.inserts.flat().map((x) => x.Allotment.id), [A1, A1, A3]);
  assert.match(r.queries[1], /where Customer in \('\d+', '\d+'\)/);
});

test('a slot whose mode Finance has not supplied halts (PROVISIONAL mode list)', async () => {
  const r = migrationRig();
  const res = await r.svc.run(cred, { source: 'allotments', modes: { HDFC0000000001: 'NEFT' }, commit: true });
  assert.equal(res.value.halt.reason, 'mode-unknown');
  assert.equal(r.inserts.length, 0);
});

test('a UTR already on a Receipt for a different allotment halts as a conflict', async () => {
  const store = [{ id: `${P}740996499`, Allotment: { id: A2 }, Amount: 250000, UTR: 'HDFC0000000001' }];
  const r = migrationRig({ store });
  const res = await r.svc.run(cred, { source: 'allotments', modes: MODES, commit: true });
  assert.equal(res.value.halt.reason, 'utr-conflict');
  assert.equal(r.inserts.length, 0);
});

test('a half-filled slot and a repeated UTR both halt', async () => {
  let r = migrationRig({ mutate: (s) => { s.allotments.body.data[1].Date_1 = null; } });
  assert.equal((await r.svc.run(cred, { source: 'allotments', modes: MODES })).value.halt.reason, 'malformed-slot');
  r = migrationRig({ mutate: (s) => { s.allotments.body.data[1].UTR = 'HDFC0000000001'; } });
  assert.equal((await r.svc.run(cred, { source: 'allotments', modes: MODES })).value.halt.reason, 'duplicate-utr');
});

test('a partial write halts and a read-back that does not add up halts before the next investor', async () => {
  let r = migrationRig({ failInsert: true });
  let res = await r.svc.run(cred, { source: 'allotments', modes: MODES, commit: true });
  assert.equal(res.value.halt.reason, 'write-failed');
  assert.equal(r.inserts.length, 1);
  r = migrationRig({ writeAmount: (x) => x.Amount - 1 });
  res = await r.svc.run(cred, { source: 'allotments', modes: MODES, commit: true });
  assert.equal(res.value.halt.reason, 'verify-mismatch');
  assert.equal(r.inserts.length, 1, 'the second investor is not written');
});

test('the run log and the ops log hold record ids and codes only', async () => {
  const r = migrationRig();
  const res = await r.svc.run(cred, { source: 'allotments', modes: MODES, commit: true });
  noSecrets(res.value);
  noSecrets(r.sink.records());
  for (const l of res.value.log) assert.ok(l.recordIds.every((id) => /^\d{15,22}$/.test(id)));
  const t = migrationRig({ mutate: (s) => { s.allotments.body.data[0].Amount_2 = 1; } });
  const halted = await t.svc.run(cred, { source: 'allotments', modes: MODES, commit: true });
  noSecrets(halted.value); noSecrets(t.sink.records());
});

test('the old columns are retired: a write naming one is refused before it leaves', async () => {
  let called = 0;
  const sink = createMemorySink();
  const fake = { insert: async () => { called++; return { ok: true }; }, update: async () => { called++; return { ok: true }; }, upsert: async () => { called++; return { ok: true }; } };
  const guarded = retireLegacyPaymentColumns(fake, createOpsLog(sink));
  const res = await guarded.update(cred, 'LLP_UnitAllocation_Module', A1, { Amount_3: 5 }, { ifUnmodifiedSince: null });
  assert.equal(res.ok, false);
  assert.equal(res.error.reason, 'legacy-payment-column');
  assert.equal((await guarded.insert(cred, 'Contacts', [{ UTR_2: 'X' }])).ok, false);
  assert.equal(called, 0);
  await guarded.update(cred, 'LLP_UnitAllocation_Module', A1, { Hold_Until: '2026-10-01' }, { ifUnmodifiedSince: null });
  await guarded.insert(cred, 'Receipts', [{ UTR: 'X', Amount: 1 }]);
  assert.equal(called, 2);
});

/* ---------------- register ---------------- */
function registerRig(access = {}, mutateReceipts = null, mutateAllotments = null) {
  const queries = [];
  const sink = createMemorySink();
  const log = createOpsLog(sink);
  const crm = createZohoClient({ recordIdPrefix: P, gate: immediateGate(), log, maxAttempts: 1, clock: () => NOW,
    fetch: async (url, init) => {
      const q = JSON.parse(init.body).select_query; queries.push(q);
      if (/from Receipts/.test(q)) { const rc = recorded('register.receipts'); if (mutateReceipts) mutateReceipts(rc.body.data); return toResponse(rc); }
      const all = recorded('register.allotments');
      if (mutateAllotments) mutateAllotments(all.body.data);
      if (/Allocation_Status = 'Reserved'/.test(q)) all.body.data = all.body.data.filter((a) => a.Allocation_Status === 'Reserved');
      else { const ids = [...q.matchAll(/'(\d+)'/g)].map((m) => m[1]); all.body.data = all.body.data.filter((a) => ids.includes(a.id)); }
      return toResponse(all);
    } });
  const authority = { async recheck(c) { return { actor: { userId: c.userId, roleId: `${P}740998001`, profileId: `${P}740998002`, seat: 'finance' },
    seesRegister: true, seesUtr: true, canRecord: true, ...access }; } };
  return { svc: createPaymentsRegister({ crm, access: authority, log, recordIdPrefix: P, clock: () => NOW }), queries, sink };
}
const principal = () => ({ credential: cred, sessionId: SESSION });

test('register totals (D21 — matched money only): received, refunded, net banked, still due; the Pending ₹15 L apart as recorded; and the chip counts', async () => {
  const r = registerRig();
  const res = await r.svc.read(principal());
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.deepEqual({ ...res.value.totals, recorded: { ...res.value.totals.recorded } },
    { received: 1500000, refunded: 100000, netBanked: 1400000, stillDue: 1500000, recorded: { received: 1500000, refunded: 0, net: 1500000 } });
  assert.deepEqual({ ...res.value.counts }, { all: 6, advance: 2, full: 3, out: 1, pending: 2 });
  assert.equal(res.value.rows.length, 6);
  assert.equal(res.value.readOnly, false);
  assert.ok(r.queries.some((q) => /where id in \('\d+', '\d+'\)/.test(q)), 'allotments fetched by id, in one IN');
});

test('register filters by kind, by farm and by reconciliation; every row names investor and farm', async () => {
  const r = registerRig();
  const adv = await r.svc.read(principal(), { kind: 'advance' });
  assert.deepEqual(adv.value.rows.map((x) => x.id), [`${P}740996304`, `${P}740996301`]);
  assert.equal(adv.value.rows[0].investor.name, 'Synthetic Investor Three');
  assert.equal(adv.value.rows[0].farm.id, F1);
  assert.equal(adv.value.counts.all, 6, 'counts ignore the chip that is on');
  const farm = await r.svc.read(principal(), { farm: F1 });
  assert.deepEqual({ ...farm.value.totals, recorded: { ...farm.value.totals.recorded } },
    { received: 1500000, refunded: 0, netBanked: 1500000, stillDue: 1500000, recorded: { received: 0, refunded: 0, net: 0 } });
  assert.deepEqual({ ...farm.value.counts }, { all: 4, advance: 2, full: 2, out: 0, pending: 1 });
  const pend = await r.svc.read(principal(), { reconciled: false });
  assert.deepEqual(pend.value.rows.map((x) => x.matchState), ['Claimed', 'Pending']);
  const out = await r.svc.read(principal(), { kind: 'out' });
  assert.deepEqual(out.value.rows.map((x) => x.kind), ['refund']);
});

test('a seat that records reads every reference masked ("••• 1234") and offered for reveal — never the full UTR (rule 7)', async () => {
  const res = await registerRig().svc.read(principal());
  assert.equal(res.ok, true);
  assert.ok(res.value.rows.every((x) => x.utr === null && !x.utrHidden));
  const withRef = res.value.rows.filter((x) => x.utrMask !== null);
  assert.ok(withRef.length > 0);
  assert.ok(withRef.every((x) => /^••• \S{4}$/.test(x.utrMask) && x.canReveal));
  assert.ok(!JSON.stringify(res).includes('SYNTHNEF0001'), 'the full reference is not in the register answer');
});

test('a non-Finance seat reads the UTR as hidden; a viewer is read-only; a KAM is refused', async () => {
  let res = await registerRig({ seesUtr: false, canRecord: false }).svc.read(principal());
  assert.ok(res.value.rows.every((x) => x.utr === null && x.utrHidden && x.utrMask === null && !x.canReveal));
  assert.ok(!JSON.stringify(res).includes('SYNTHNEF0001'));
  assert.equal(res.value.readOnly, true);
  const kam = registerRig({ seesRegister: false });
  res = await kam.svc.read(principal());
  assert.deepEqual(res, { ok: false, kind: 'refused', reasonCode: 'capability-missing' });
  assert.equal(kam.queries.length, 0);
});

const plainTotals = (v) => ({ ...v.totals, recorded: { ...v.totals.recorded } });
const BASE_TOTALS = { received: 1500000, refunded: 100000, netBanked: 1400000, stillDue: 1500000, recorded: { received: 1500000, refunded: 0, net: 1500000 } };

test('register refuses a bad filter', async () => {
  const r = registerRig();
  assert.equal((await r.svc.read(principal(), { kind: 'everything' })).reasonCode, 'invalid-request');
  assert.equal((await r.svc.read(principal(), { farm: '12345' })).reasonCode, 'invalid-request');
});

test('B-02: one malformed receipt never blanks the register — it is left out, named in problems, its id in the ops log only', async () => {
  const bad = registerRig({}, (rows) => { rows[2].Amount = 1.5; });   // the Matched ₹5 L Advance on the Reserved allotment
  const res = await bad.svc.read(principal());
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.deepEqual([...res.value.problems], ['receipt-unreadable:1']);
  assert.equal(res.value.rows.length, 5);
  assert.ok(!res.value.rows.some((x) => x.id === `${P}740996304`));
  assert.deepEqual(plainTotals(res.value), { received: 1000000, refunded: 100000, netBanked: 900000, stillDue: 2000000,
    recorded: { received: 1500000, refunded: 0, net: 1500000 } }, 'the figures are over what could be read — never the unread ₹5 L');
  const refusal = bad.sink.records().find((x) => x.kind === 'refusal');
  assert.equal(refusal.reason, 'source-invalid.receipt-unreadable');
  assert.deepEqual(refusal.recordIds, [`${P}740996304`]);
  assert.ok(!JSON.stringify(res.value.problems).includes(P), 'record ids stay out of the page');
});

test('B-02: the seed\'s shapes read as legitimate — lower-case Kind and Match_State, whole-number string amounts, a date-only Received_On, a bare-id lookup', async () => {
  const r = registerRig({}, (rows) => {
    for (const x of rows) { x.Kind = x.Kind.toLowerCase(); x.Match_State = x.Match_State.toLowerCase(); }
    rows[2].Amount = '500000';             // a currency as a string
    rows[4].Amount = '750000.00';          // … with its paise
    rows[4].Received_On = '2026-08-20';    // a date, not a datetime
    rows[5].Allotment = rows[5].Allotment.id; // a lookup as a bare id
    rows[0].Match_State = 'CLAIMED';
  });
  const res = await r.svc.read(principal());
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.deepEqual([...res.value.problems], []);
  assert.deepEqual(plainTotals(res.value), BASE_TOTALS, 'the same money as the Title-case fixture');
  assert.deepEqual({ ...res.value.counts }, { all: 6, advance: 2, full: 3, out: 1, pending: 2 });
  assert.deepEqual(res.value.rows.map((x) => x.matchState), ['Claimed', 'Matched', 'Matched', 'Pending', 'Matched', 'Matched'], 'the org\'s spelling goes out');
  assert.deepEqual(res.value.rows.map((x) => x.kind), ['balance', 'refund', 'advance', 'full', 'full', 'advance']);
  assert.ok(res.value.rows.every((x) => /^\d{4}-\d{2}-\d{2}$/.test(x.receivedOn)), 'Received_On goes out as its day');
  assert.equal(res.value.rows[4].receivedOn, '2026-08-20');
});

test('B-02: rows the register cannot place are reported by reason, the rest still reads', async () => {
  const r = registerRig({}, (rows) => {
    rows[0].Allotment = null;              // a Claimed row with no allotment
    rows[3].Kind = 'Bonus';                // a Kind the ledger does not know
    rows.push({ id: `${P}740996307`, Allotment: { id: `${P}740996003` }, Kind: 'Refund', Amount: 999, Mode: 'NEFT', UTR: null,
      Received_On: '2026-09-02T10:00:00+05:30', Match_State: 'Matched', Reversal_Of: { id: `${P}740996302` }, Created_By: null }); // reverses a receipt of another allotment, another amount
  }, (allots) => {
    delete allots[0].LLP;                  // an Issued allotment with no readable farm
    allots[1].Unit_Price = null;           // the Reserved allotment has no price
  });
  const res = await r.svc.read(principal());
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.deepEqual([...res.value.problems], ['receipt-unreadable:1', 'receipt-unlinked:1', 'allotment-unnamed:1', 'price-missing:1', 'reversal-anomaly:1']);
  const a1 = res.value.rows.filter((x) => x.allotmentId === `${P}740996001`);
  assert.equal(a1.length, 2, 'the unnamed allotment\'s receipts still count');
  assert.ok(a1.every((x) => x.farm.id === null && x.farm.name === null && x.investor.id === C1));
  assert.ok(!res.value.farms.some((f) => f.id === null), 'no unknown farm is offered as a filter');
  assert.deepEqual(plainTotals(res.value), { received: 1500000, refunded: 100000, netBanked: 1400000, stillDue: 0,
    recorded: { received: 0, refunded: 0, net: 0 } }, 'the anomalous reversal moves nothing; an unpriced reservation adds no due');
  const reasons = r.sink.records().filter((x) => x.kind === 'refusal').map((x) => x.reason);
  assert.deepEqual(reasons, ['source-invalid.receipt-unreadable', 'source-invalid.receipt-unlinked', 'source-invalid.allotment-unnamed',
    'source-invalid.price-missing', 'source-invalid.reversal-anomaly']);
});

test('B-02: a Zoho failure is still a source error, never an empty register', async () => {
  const sink = createMemorySink();
  const crm = createZohoClient({ recordIdPrefix: P, gate: immediateGate(), log: createOpsLog(sink), maxAttempts: 1, clock: () => NOW,
    fetch: async () => toResponse({ status: 500, body: { code: 'INTERNAL_ERROR', status: 'error' } }) });
  const authority = { async recheck(c) { return { actor: { userId: c.userId }, seesRegister: true, seesUtr: true, canRecord: true }; } };
  const res = await createPaymentsRegister({ crm, access: authority, log: createOpsLog(sink), recordIdPrefix: P, clock: () => NOW }).read(principal());
  assert.equal(res.ok, false);
  assert.equal(res.kind, 'source-error');
});

/* B-02b: a seed (or a hand-made) reservation with no Unit_Price must not blank the whole register. */
test('an unpriced Reserved allotment does not blank the register: still due leaves it out and the answer says so', async () => {
  const whole = await registerRig().svc.read(principal());
  assert.deepEqual([...whole.value.problems], [], 'a whole answer names no problem');
  const r = registerRig({}, null, (rows) => { for (const a of rows) if (a.Allocation_Status === 'Reserved') delete a.Unit_Price; });
  const res = await r.svc.read(principal());
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.deepEqual([...res.value.problems], ['price-missing:1']);
  assert.equal(res.value.totals.stillDue, 0, 'the unpriced reservation is not guessed into still due');
  assert.equal(res.value.totals.received, 1500000, 'matched money is still counted');
  assert.equal(res.value.rows.length, 6, 'every receipt is still listed');
  const zero = await registerRig({}, null, (rows) => { for (const a of rows) if (a.Allocation_Status === 'Reserved') a.Unit_Price = 0; }).svc.read(principal());
  assert.deepEqual([zero.ok, [...zero.value.problems]], [true, []], 'a price of 0 is a price (the seed fix sets it), not a missing one');
});

test('B-02: an allotment with an unreadable investor is kept — its receipts count, the investor reads as unknown, the answer says so', async () => {
  const res = await registerRig({}, null, (rows) => { rows[1].Customer = null; }).svc.read(principal());
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.deepEqual([...res.value.problems], ['allotment-unnamed:1']);
  assert.deepEqual(plainTotals(res.value), BASE_TOTALS);
  const theirs = res.value.rows.filter((x) => x.allotmentId === `${P}740996002`);
  assert.equal(theirs.length, 2);
  assert.ok(theirs.every((x) => x.investor.id === null && x.investor.name === null && x.farm.id === F1));
});

/* W3-1: the register carries the receipt's own reference (Receipts.Name) and the investor's ARL ID, so the page never prints a record id. */
test('W3-1: every row carries ref (Receipts.Name) and the investor code (Customer.ARL_ID); missing ones are null, never the record id', async () => {
  const r = registerRig({}, (rows) => { rows[0].Name = 'T-0027'; rows[1].Name = '-None-'; rows[2].Name = '  '; },
    (allots) => { for (const a of allots) a['Customer.ARL_ID'] = 'ARL-INV-0206'; });
  const res = await r.svc.read(principal());
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.ok(r.queries.some((q) => /^select id, Name, Allotment, Kind/.test(q)), 'Name is asked for');
  assert.ok(r.queries.some((q) => /Customer\.ARL_ID/.test(q)), "the investor's ARL ID is asked for through the lookup");
  assert.equal(res.value.rows[0].ref, 'T-0027');
  assert.equal(res.value.rows[1].ref, null);
  assert.equal(res.value.rows[2].ref, null);
  assert.ok(res.value.rows.filter((x) => x.investor.id).every((x) => x.investor.code === 'ARL-INV-0206'));
  const none = await registerRig().svc.read(principal());
  assert.ok(none.value.rows.every((x) => x.investor.code === null && x.ref === null));
});
