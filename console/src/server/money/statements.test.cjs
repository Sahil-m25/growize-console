/* M10-S05-T02 — the weekly bank statement: parser (statement-parse.ts) and upload + reconciliation (statements.ts).
 *
 * Run from console/: node --test src/server/money/statements.test.cjs
 * Real Zoho client over recorded synthetic replies (__fixtures__/statements/*). No request reaches Zoho.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { before, test } = require('node:test');

const consoleRoot = path.resolve(__dirname, '..', '..', '..');
const srcRoot = path.join(consoleRoot, 'src');
const fixtureRoot = path.join(srcRoot, 'lib', 'zoho', '__fixtures__', 'statements');
const ts = require(path.join(consoleRoot, 'node_modules', 'typescript'));
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoho-statements-'));
process.on('exit', () => fs.rmSync(outDir, { recursive: true, force: true }));

const config = ts.readConfigFile(path.join(consoleRoot, 'tsconfig.json'), ts.sys.readFile);
const project = ts.parseJsonConfigFileContent(config.config, ts.sys, consoleRoot);
const options = { ...project.options, incremental: false, tsBuildInfoFile: undefined, plugins: undefined,
  module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10, noEmit: false, noEmitOnError: true, outDir, rootDir: srcRoot };
const sources = ['lib/zoho/errors.ts', 'lib/zoho/gate.ts', 'lib/zoho/log.ts', 'lib/zoho/client.ts', 'server/money/receipt-replay.ts',
  'server/money/statement-parse.ts', 'server/money/statements.ts'].map((f) => path.join(srcRoot, f));
const program = ts.createProgram(sources, options);
const diagnostics = [...ts.getPreEmitDiagnostics(program), ...program.emit().diagnostics];
if (diagnostics.length) {
  console.error(ts.formatDiagnostics(diagnostics, { getCanonicalFileName: (f) => f, getCurrentDirectory: () => consoleRoot, getNewLine: () => '\n' }));
  process.exit(1);
}
const load = (file) => require(path.join(outDir, file));
const { createMemorySink, createOpsLog } = load('lib/zoho/log.js');
const { createZohoClient, userCredential } = load('lib/zoho/client.js');
const { parseStatement, csvRows, dayOf, paiseOf, refOf } = load('server/money/statement-parse.js');
const { createStatements, createZohoStatementStore, statementName } = load('server/money/statements.js');

const P = '9007199254';
const HEAD = '9007199254740994090';
const RC = (n) => `90071992547409951${String(n).padStart(2, '0')}`;
const STMT = '9007199254740995200', ATT = '9007199254740995300';
const INV = '9007199254740994500';
const SESSION = 'session_fixture_00000010';
const NOW = Date.parse('2026-09-28T10:00:00+05:30');
const CSV = fs.readFileSync(path.join(fixtureRoot, 'statement-week-39.csv'));
/** Every statement value that must never reach a log: references, narration words, amounts as printed. */
const LINE_SECRETS = ['HDFCN52026092200001', 'ICICR52026092300000002', '526712345678', 'HDFCN52026092400004', 'SBINN52026092500005',
  'HDFCN52026092600007', 'SYNTHETIC PAYER', 'SYNTHETIC UNKNOWN', 'CHRG', 'NEFT', '2,50,000', '22,50,000', '17.70', 'XXXXXXXX0000', 'synthetic-user-access-token'];
const recorded = (name) => JSON.parse(fs.readFileSync(path.join(fixtureRoot, `${name}.response.json`), 'utf8'));
const toResponse = (r) => new Response(r.body === null ? null : JSON.stringify(r.body), { status: r.status, headers: r.headers || {} });
const immediateGate = () => ({ async acquire() { return { waitedMs: 0, release() {} }; } });
const noSecrets = (value, list = LINE_SECRETS) => { const s = JSON.stringify(value); for (const x of list) assert.ok(!s.includes(x), `leaked ${x}`); };

let cred;
before(async () => {
  cred = await userCredential({ access_token: 'synthetic-user-access-token-never-live', api_domain: 'https://www.zohoapis.in', expires_in: 3_600 },
    { recordIdPrefix: P, gate: immediateGate(), log: createOpsLog(createMemorySink()), clock: () => NOW,
      fetch: async () => toResponse(recorded('current-user.head')) });
  assert.equal(cred.userId, HEAD);
});
const principal = () => ({ credential: cred, sessionId: SESSION });
const csvFile = (bytes = CSV, name = 'statement-week-39.csv', type = 'text/csv') => ({ name, type, bytes: new Uint8Array(bytes) });

function rig(f = {}, opts = {}) {
  const sink = createMemorySink();
  const log = createOpsLog(sink);
  const calls = [];
  const crm = createZohoClient({ recordIdPrefix: P, gate: immediateGate(), log, maxAttempts: 1, clock: () => NOW,
    fetch: async (url, init) => {
      const u = new URL(String(url));
      const m = init.method;
      if (u.pathname.endsWith('/coql')) {
        const q = JSON.parse(init.body).select_query; calls.push(['coql', q]);
        if (/from Receipts where UTR in /.test(q)) return toResponse(f.receiptsReply ?? recorded(f.receipts ?? 'coql.receipts-by-utr'));
        if (/from Statements /.test(q)) return toResponse(recorded(f.latest ?? 'statement.latest'));
        if (/^select id, Customer from LLP_UnitAllocation_Module where id in /.test(q)) {
          const ids = [...q.matchAll(/'(\d+)'/g)].map((x) => x[1]);
          return toResponse({ status: 200, body: { data: ids.map((id) => ({ id, Customer: { id: (f.customerOf ?? (() => INV))(id) } })), info: { more_records: false, count: ids.length } } });
        }
        throw new Error(`unexpected query ${q}`);
      }
      if (m === 'POST' && /\/crm\/v8\/Statements$/.test(u.pathname)) { calls.push(['insert', JSON.parse(init.body).data[0]]); return toResponse(recorded(f.insert ?? 'statement.created')); }
      if (m === 'POST' && /\/Statements\/\d+\/Attachments$/.test(u.pathname)) {
        const h = new Headers(init.headers);
        const body = Buffer.from(init.body).toString('utf8');
        calls.push(['attach', u.pathname, { type: h.get('Content-Type').split(';')[0], csvType: /Content-Type: text\/csv/.test(body), carriesFile: body.includes(CSV.toString('utf8')), token: h.get('Authorization') }]);
        return toResponse(recorded('attachment.uploaded'));
      }
      if (m === 'DELETE') { calls.push(['delete', u.pathname]); return toResponse(recorded('statement.deleted')); }
      throw new Error(`unexpected call ${m} ${u.pathname}`);
    } });
  const zoho = createZohoStatementStore({ crm, recordIdPrefix: P });
  const store = opts.failAttach ? { ...zoho, async attach() { return { ok: false, code: 'server', errorKind: 'server' }; } } : zoho;
  const matches = [];
  const match = opts.match ? { async match(p, id, body) { matches.push([p.credential.userId, id, body]); return opts.match(id); } } : undefined;
  const svc = createStatements({ crm, store, log, recordIdPrefix: P, clock: () => NOW, ...(match ? { match } : {}), ...(opts.deps ?? {}),
    authority: { async mayUpload() { return opts.mayUpload ?? true; } } });
  return { svc, calls, sink, matches };
}

/* ---- the parser ------------------------------------------------------------------------------------------ */

test('parser: the HDFC-shaped weekly CSV — preamble and summary skipped, debits kept, whole paise, references', () => {
  const r = parseStatement(new Uint8Array(CSV));
  assert.equal(r.ok, true, JSON.stringify(r));
  const s = r.value;
  assert.equal(s.lines.length, 7);
  assert.equal(s.from, '2026-09-22');
  assert.equal(s.to, '2026-09-26');
  assert.deepEqual(s.lines.map((l) => [l.date, l.direction, l.amountPaise]), [
    ['2026-09-22', 'credit', 25_000_000], ['2026-09-23', 'credit', 225_000_000], ['2026-09-24', 'credit', 25_000_000],
    ['2026-09-24', 'credit', 10_000_000], ['2026-09-25', 'credit', 7_500_000], ['2026-09-26', 'debit', 1_770], ['2026-09-26', 'debit', 5_000_000]]);
  assert.equal(s.lines[0].refs[0], 'HDFCN52026092200001');
  assert.ok(!s.lines[0].refs.includes('HDFC0000123'), 'an IFSC is not a UTR');
  assert.deepEqual(s.lines[4].refs, ['SBINN52026092500005'], 'an all-zero reference column falls back to the narration');
  assert.deepEqual(s.lines[5].refs, [], 'bank charges carry no reference');
  assert.ok(s.skipped >= 3);
});

test('parser: amount + Dr/Cr shape (ICICI/SBI), BOM, quoted commas, tab-separated, month names', () => {
  const icici = '﻿S No.,Value Date,Transaction Date,Cheque Number,Transaction Remarks,Amount (INR),Cr/Dr,Balance\n'
    + '1,01-Sep-2026,01-Sep-2026,-,"NEFT-UTIBR52026090100000011-SYNTH, PAYER",2500000.00,CR,10\n'
    + '2,02 Sep 2026,02 Sep 2026,-,SMS CHARGES,15.00,DR,9\n';
  const r = parseStatement(icici);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.value.lines.map((l) => [l.date, l.direction, l.amountPaise, l.refs[0] ?? null]),
    [['2026-09-01', 'credit', 250_000_000, 'UTIBR52026090100000011'], ['2026-09-02', 'debit', 1_500, null]]);
  const tsv = 'Txn Date\tDescription\tRef No./Cheque No.\tDebit\tCredit\tBalance\n2026-09-03\tUPI-SYNTH\t612345678901\t\t1,000.50\t5\n';
  const t = parseStatement(tsv);
  assert.equal(t.ok, true, JSON.stringify(t));
  assert.deepEqual(t.value.lines.map((l) => [l.date, l.amountPaise, l.refs[0]]), [['2026-09-03', 100_050, '612345678901']]);
  assert.deepEqual(csvRows('a,"b,""c""",d\r\n1,2,3'), [['a', 'b,"c"', 'd'], ['1', '2', '3']]);
});

test('parser: dates, amounts and references are read strictly (day first, no floats, no guesses)', () => {
  assert.equal(dayOf('05/09/26'), '2026-09-05');
  assert.equal(dayOf('05-09-2026'), '2026-09-05');
  assert.equal(dayOf('31/02/2026'), null);
  assert.equal(dayOf('Opening Balance'), null);
  assert.equal(dayOf('5-Sept-2026'), '2026-09-05');
  assert.deepEqual(paiseOf('1,23,456.7'), { paise: 12_345_670, negative: false, suffix: null });
  assert.deepEqual(paiseOf('₹ 500.00 Cr'), { paise: 50_000, negative: false, suffix: 'cr' });
  assert.equal(paiseOf('(10.00)').negative, true);
  assert.equal(paiseOf('12.345'), null);
  assert.equal(paiseOf('abc'), null);
  assert.equal(paiseOf('').paise, 0);
  assert.equal(refOf('HDFC0001234'), null, 'IFSC');
  assert.equal(refOf('0000000000'), null);
  assert.equal(refOf('hdfc-2909001'), 'HDFC2909001');
});

test('parser: refuses what is not a statement — PDF, Excel, no header, an unreadable amount, empty, too large', () => {
  const code = (x) => { const r = parseStatement(x); assert.equal(r.ok, false); return r.reasonCode; };
  assert.equal(code(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])), 'not-text');
  assert.equal(code(new Uint8Array([0x50, 0x4b, 3, 4])), 'not-text');
  assert.equal(code('just,some,words\n1,2,3\n'), 'no-header');
  assert.equal(code('Date,Narration,Withdrawal,Deposit\n01/09/26,X,,12.3.4\n'), 'bad-row');
  assert.equal(code('Date,Narration,Withdrawal,Deposit\n'), 'no-lines');
  assert.equal(code(''), 'empty');
  assert.equal(code(new Uint8Array(2 * 1024 * 1024 + 1).fill(65)), 'too-large');
  const bad = parseStatement('Date,Narration,Withdrawal,Deposit\n01/09/26,X,,12.3.4\n');
  assert.equal(bad.row, 1);
  assert.ok(!/12\.3\.4|X/.test(bad.message), 'the refusal names no value from the file');
});

/* ---- upload and reconciliation --------------------------------------------------------------------------- */

test('upload: every line is matched to a receipt (UTR + amount + date) or listed under "needs an owner", debits included', async () => {
  const r = rig();
  const res = await r.svc.upload(principal(), csvFile());
  assert.equal(res.ok, true, JSON.stringify(res));
  const v = res.value;
  assert.deepEqual(v.counts, { lines: 7, matched: 4, awaitingMatch: 3, autoMatched: 0, needsOwner: 3, debits: 2, skipped: v.counts.skipped });
  assert.deepEqual(v.matched.map((m) => [m.line, m.receiptId, m.state, m.recordedByYou, m.kind]), [
    [1, RC(1), 'matched', false, 'Advance'],
    [2, RC(2), 'awaiting-match', false, 'Part'],
    [3, RC(3), 'awaiting-match', true, 'Advance'],
    [7, RC(7), 'awaiting-match', false, 'Refund'],
  ]);
  assert.equal(v.matched[0].matchedBy, HEAD);
  assert.equal(v.matched[3].utr, 'HDFCN52026092600007', 'the receipt UTR is compared case-insensitively');
  assert.deepEqual(v.needsOwner.map((l) => [l.line, l.direction, l.owner, l.reason, l.receiptId]), [
    [4, 'credit', 'head-of-finance', 'amount-differs', RC(4)],
    [5, 'credit', 'finance-operations', 'no-receipt', null],
    [6, 'debit', 'head-of-finance', 'debit-no-receipt', null],
  ]);
  assert.equal(v.needsOwner[2].amountPaise, 1_770, 'the bank-charges debit is listed');
  assert.equal(v.statementId, STMT);
  assert.equal(v.attachmentId, ATT);
  assert.equal(v.name, statementName('2026-09-22', '2026-09-26'));
});

test('D113: the stored statement auto-matches the pending inbound receipts it confirms, through Match it; a refund keeps its second hand', async () => {
  const ok = (id) => ({ ok: true, value: { receiptId: id, state: 'matched', matchedBy: HEAD, matchedAt: '2026-09-28T10:00:00+05:30' } });
  const r = rig({}, { match: (id) => (id === RC(3)
    ? { ok: false, kind: 'refused', reasonCode: 'supplementary-not-verified', message: 'x', retryable: false } : ok(id)) });
  const res = await r.svc.upload(principal(), csvFile());
  assert.equal(res.ok, true, JSON.stringify(res));
  const v = res.value;
  // only the pending CREDIT lines are offered to the match, on the uploader's own principal, after the statement is stored
  assert.deepEqual(r.matches.map((m) => [m[0], m[1]]), [[HEAD, RC(2)], [HEAD, RC(3)]]);
  // M18-S09-NOTE-3: one batched read of the allotments' investors decides the lanes (one investor's receipts serially)
  assert.deepEqual(r.calls.map((c) => c[0]), ['coql', 'insert', 'attach', 'coql']);
  assert.match(r.calls[3][1], /^select id, Customer from LLP_UnitAllocation_Module where id in \('9007199254740994001'\) limit 0, 100$/);
  assert.deepEqual(v.continueWith, []);
  assert.deepEqual(v.matched.map((m) => [m.line, m.state, m.autoMatched, m.matchNote]), [
    [1, 'matched', false, null],
    [2, 'matched', true, null],
    [3, 'awaiting-match', false, 'It cannot be matched until the supplementary agreement is signed and verified.'],
    [7, 'awaiting-match', false, 'Money leaving — the Head of Finance or an administrator matches it.'],
  ]);
  assert.equal(v.matched[1].matchedBy, HEAD);
  assert.equal(v.counts.autoMatched, 1);
  assert.equal(v.counts.awaitingMatch, 2);
  assert.equal(v.counts.matched, 4, 'Lines_Matched on the record counts lines matched to a receipt either way');
  const ev = r.sink.records().filter((x) => x.action === 'statement-auto-match').map((x) => x.reason);
  assert.deepEqual(ev, ['not-matched.supplementary-not-verified', 'matched-1']);
  noSecrets(r.sink.records());
});

test('D113: a failed store matches nothing (the statement is the source, so it must be kept first)', async () => {
  const r = rig({}, { failAttach: true, match: () => { throw new Error('must not be called'); } });
  const res = await r.svc.upload(principal(), csvFile());
  assert.equal(res.ok, false);
  assert.equal(r.matches.length, 0);
});

test('upload without a match service: suggestions only — no receipt is written; the file goes to Zoho on the Statements record, on the uploader\'s token', async () => {
  const r = rig();
  await r.svc.upload(principal(), csvFile());
  const kinds = r.calls.map((c) => c[0]);
  assert.deepEqual(kinds, ['coql', 'insert', 'attach'], 'one read of Receipts, one Statements record, one attachment; no PUT on any receipt');
  const q = r.calls[0][1];
  assert.match(q, /^select id, Allotment, Kind, Amount, UTR, Received_On, Match_State, Matched_By, Created_By from Receipts where UTR in \('[A-Z0-9]+'(, '[A-Z0-9]+')*\) limit 0, 2000$/);
  assert.ok(!/SYNTHETIC|CHRG/.test(q), 'no narration in the query');
  assert.deepEqual(r.calls[1][1], { Name: statementName('2026-09-22', '2026-09-26'), Period_From: '2026-09-22', Period_To: '2026-09-26', Lines: 7, Lines_Matched: 4, Lines_Needs_Owner: 3 });
  assert.equal(r.calls[2][1], `/crm/v8/Statements/${STMT}/Attachments`);
  assert.deepEqual(r.calls[2][2], { type: 'multipart/form-data', csvType: true, carriesFile: true, token: 'Zoho-oauthtoken synthetic-user-access-token-never-live' },
    'the CSV itself streams to Zoho as the uploader (D71, D53)');
});

test('upload: logs carry the record id and counts only — never a line, a UTR, a narration or an amount', async () => {
  const r = rig();
  await r.svc.upload(principal(), csvFile());
  const recs = r.sink.records();
  noSecrets(recs);
  const ev = recs.filter((x) => x.kind === 'event');
  assert.deepEqual(ev.map((x) => [x.action, x.reason, x.recordIds]), [['statement-upload', 'lines-7.matched-4.owner-3', [STMT]]]);
  const zohoCalls = recs.filter((x) => x.kind === 'zoho-call');
  assert.ok(zohoCalls.length >= 2);
});

test('upload: a KAM (no "pay") is refused before anything is read or stored (TC-IM05-026)', async () => {
  const r = rig({}, { mayUpload: false });
  const res = await r.svc.upload(principal(), csvFile());
  assert.equal(res.ok, false);
  assert.equal(res.reasonCode, 'not-finance');
  assert.equal(r.calls.length, 0);
  const l = await r.svc.latest(principal());
  assert.equal(l.reasonCode, 'not-finance');
});

test('upload: the Statements write refused by Zoho\'s Finance-only profile (a KAM token) stores nothing and attaches nothing', async () => {
  const r = rig({ insert: 'statement.kam-403' });
  const res = await r.svc.upload(principal(), csvFile());
  assert.equal(res.ok, false);
  assert.equal(res.kind, 'source-error');
  assert.equal(res.errorKind, 'forbidden');
  assert.deepEqual(r.calls.map((c) => c[0]), ['coql', 'insert'], 'no attachment after a refused record');
});

test('upload: not a CSV, too large, or unreadable → refused before Zoho is asked', async () => {
  const r = rig();
  assert.equal((await r.svc.upload(principal(), csvFile(CSV, 'statement.pdf', 'application/pdf'))).reasonCode, 'file-type');
  assert.equal((await r.svc.upload(principal(), csvFile(Buffer.from('%PDF-1.7'), 'statement.csv'))).reasonCode, 'unreadable');
  assert.equal((await r.svc.upload(principal(), csvFile(Buffer.alloc(2 * 1024 * 1024 + 1, 65)))).reasonCode, 'too-large');
  assert.equal((await r.svc.upload(principal(), null)).reasonCode, 'invalid-request');
  assert.equal((await r.svc.upload({ credential: cred, sessionId: 'x' }, csvFile())).reasonCode, 'invalid-request');
  assert.equal(r.calls.length, 0);
});

test('upload: Receipts unreadable (403 on the uploader\'s token) → nothing stored, nothing half-done', async () => {
  const r = rig({ receipts: 'coql.receipts.403' });
  const res = await r.svc.upload(principal(), csvFile());
  assert.equal(res.ok, false);
  assert.equal(res.kind, 'source-error');
  assert.deepEqual(r.calls.map((c) => c[0]), ['coql']);
});

test('upload: no receipt on any reference → every credit needs Finance Operations, every debit the Head of Finance', async () => {
  const r = rig({ receipts: 'coql.receipts-none' });
  const res = await r.svc.upload(principal(), csvFile());
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.value.matched.length, 0);
  assert.deepEqual(res.value.needsOwner.map((l) => l.owner), ['finance-operations', 'finance-operations', 'finance-operations', 'finance-operations', 'finance-operations', 'head-of-finance', 'head-of-finance']);
});

test('upload: an attachment Zoho does not take removes the record again — nothing half-stored', async () => {
  const r = rig({}, { failAttach: true });
  const res = await r.svc.upload(principal(), csvFile());
  assert.equal(res.ok, false);
  assert.equal(res.kind, 'source-error');
  assert.deepEqual(r.calls.map((c) => c[0]), ['coql', 'insert', 'delete']);
  assert.deepEqual(r.sink.records().filter((x) => x.kind === 'event').map((x) => x.reason), ['file-not-attached.record-removed']);
});

test('latest: "last reconciled" reads the newest Statements record; none yet reads null', async () => {
  const r = rig();
  const l = await r.svc.latest(principal());
  assert.equal(l.ok, true, JSON.stringify(l));
  assert.deepEqual(l.value, { statementId: STMT, name: 'Statement 2026-W39 (22 Sep–26 Sep)', from: '2026-09-22', to: '2026-09-26', lines: 7, matched: 4, needsOwner: 3, reconciledAt: '2026-09-28T10:00:00+05:30' });
  const none = rig({ latest: 'statement.latest-none' });
  assert.deepEqual(await none.svc.latest(principal()), { ok: true, value: null });
});

test('the statement name is the ISO week of its last day', () => {
  assert.equal(statementName('2026-09-22', '2026-09-26'), 'Statement 2026-W39 (22 Sep–26 Sep)');
  assert.equal(statementName('2026-12-28', '2027-01-01'), 'Statement 2026-W53 (28 Dec–1 Jan)');
  assert.equal(statementName('2027-01-04', '2027-01-08'), 'Statement 2027-W01 (4 Jan–8 Jan)');
});

test('the route: Finance-only page guard, wrapped, and no line data logged', () => {
  const route = fs.readFileSync(path.join(srcRoot, 'app/api/statements/route.ts'), 'utf8');
  assert.match(route, /export const POST = withErrorCapture\(guardApi\("\/api\/statements", post_\), "\/api\/statements"\)/);
  assert.match(route, /export const GET = withErrorCapture\(guardApi\("\/api\/statements", get_\), "\/api\/statements"\)/);
  assert.ok(!/console\.(log|error|warn)/.test(route));
  const guard = fs.readFileSync(path.join(srcRoot, 'server/access/guard-core.ts'), 'utf8');
  assert.match(guard, /"\/api\/statements": \{ kind: "page", page: "pay" \}/);
  for (const f of ['server/money/statements.ts', 'server/money/statement-parse.ts']) {
    const t = fs.readFileSync(path.join(srcRoot, f), 'utf8');
    assert.ok(!/console\.(log|error|warn)|writeFile|createWriteStream|tmpdir/.test(t), `${f}: no console logging, no temp files`);
  }
});

/* ---- M18-S09-NOTE-3: 60 credit lines inside the request deadline ------------------------------------------ */
const { runWithDeadline } = load('lib/zoho/deadline.js');
const { CONTINUE_NOTE } = load('server/money/statements.js');
const N = 60;
const R60 = (i) => `90071992547410${String(i).padStart(5, '0')}`;           // receipt ids
const A60 = (i) => `90071992547420${String(Math.floor(i / 2)).padStart(5, '0')}`;   // 2 receipts per allotment
const C60 = (allot) => `90071992547430${String(Math.floor(Number(allot.slice(-5)) / 2)).padStart(5, '0')}`; // 2 allotments per investor
const UTR60 = (i) => `SYNTN5${String(i).padStart(10, '0')}`;
const sixtyCsv = () => Buffer.from(['Txn Date,Description,Ref No./Cheque No.,Debit,Credit,Balance',
  ...Array.from({ length: N }, (_, i) => `2026-09-${String(22 + (i % 5)).padStart(2, '0')},NEFT SYNTHETIC PAYER ${i},${UTR60(i)},,${1000 + i}.00,5`)].join('\n'));
const sixtyReceipts = () => ({ status: 200, headers: { 'content-type': 'application/json' }, body: { info: { more_records: false, count: N }, data: Array.from({ length: N }, (_, i) => ({
  id: R60(i), Allotment: { id: A60(i) }, Kind: 'Advance', Amount: 1000 + i, UTR: UTR60(i), Received_On: `2026-09-${String(22 + (i % 5)).padStart(2, '0')}T00:00:00+05:30`,
  Match_State: 'Pending', Matched_By: null, Created_By: { id: '9007199254740994091' } })) } });
/** A match.ts stand-in: slow, idempotent (a matched receipt answers the same again), counting overlap per investor. */
function fakeMatch(ms) {
  const state = new Map(), inFlight = new Map();
  let live = 0, peak = 0, sameInvestorOverlap = 0, writes = 0;
  const investorOf = (id) => C60(A60(Number(id.slice(-5))));
  return { state, get peak() { return peak; }, get overlap() { return sameInvestorOverlap; }, get writes() { return writes; },
    async match(id) {
      const inv = investorOf(id);
      if (inFlight.get(inv)) sameInvestorOverlap++;
      inFlight.set(inv, (inFlight.get(inv) ?? 0) + 1); live++; peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, ms));
      live--; inFlight.set(inv, inFlight.get(inv) - 1);
      if (!state.has(id)) { state.set(id, HEAD); writes++; }
      return { ok: true, value: { receiptId: id, state: 'matched', matchedBy: HEAD, duplicate: writes === 0 } };
    } };
}

test('M18-S09-NOTE-3: 60 credit lines are auto-matched 4 at a time, one investor at a time, each exactly once', async () => {
  const fm = fakeMatch(5);
  const r = rig({ receiptsReply: sixtyReceipts(), customerOf: C60 }, { match: (id) => fm.match(id) });
  const res = await r.svc.upload(principal(), csvFile(sixtyCsv(), 'week-60.csv'));
  assert.equal(res.ok, true, JSON.stringify(res).slice(0, 300));
  const v = res.value;
  assert.equal(v.counts.lines, N);
  assert.equal(v.counts.autoMatched, N);
  assert.equal(v.counts.awaitingMatch, 0);
  assert.deepEqual(v.continueWith, []);
  assert.equal(fm.writes, N, 'each receipt matched once');
  assert.equal(r.matches.length, N);
  assert.ok(fm.peak > 1 && fm.peak <= 4, `peak ${fm.peak}`);
  assert.equal(fm.overlap, 0, 'two receipts of one investor never run at once (first money, hold, Contact write stay exact)');
  assert.equal(r.calls.filter((c) => c[0] === 'coql').length, 2, 'one Receipts read + one batched Allotments read for 30 allotments');
  noSecrets(r.sink.records(), [UTR60(0), UTR60(59), 'SYNTHETIC PAYER']);
});

test('M18-S09-NOTE-3: past the stop margin no match starts; the rest come back as continueWith and finish idempotently from the page', async () => {
  const fm = fakeMatch(30);
  const r = rig({ receiptsReply: sixtyReceipts(), customerOf: C60 }, { match: (id) => fm.match(id), deps: { stopMarginMs: 100 } });
  const ac = new AbortController();
  const res = await runWithDeadline({ signal: ac.signal, at: Date.now() + 260 }, () => r.svc.upload(principal(), csvFile(sixtyCsv(), 'week-60.csv')));
  assert.equal(res.ok, true);
  const v = res.value;
  assert.ok(v.counts.autoMatched > 0 && v.counts.autoMatched < N, `matched ${v.counts.autoMatched} inside the deadline`);
  assert.equal(v.continueWith.length, N - v.counts.autoMatched);
  assert.equal(v.counts.awaitingMatch, v.continueWith.length);
  for (const m of v.matched) assert.equal(m.matchNote, m.state === 'matched' ? null : CONTINUE_NOTE);
  assert.ok(r.sink.records().some((x) => x.action === 'statement-auto-match' && x.reason === `continuing-${v.continueWith.length}`));
  // the page: POST /api/receipts/[id]/match per remaining id (the same match.ts call), plus a double press on one already done
  for (const id of [...v.continueWith, v.matched.find((m) => m.autoMatched).receiptId]) assert.equal((await fm.match(id)).ok, true);
  assert.equal(fm.writes, N, 'every receipt matched exactly once across the upload and the continuation');
});
