/* M18-S02-T01 / NOTE-3 — the per-seat API matrix, run against the real routes.
 * Run from console/: node --test src/server/http/contract/api-matrix.test.cjs        (the cases: pm/generated/api-matrix.json, made by pm/gen-api-matrix.mjs)
 *
 * One test per TC-PM-<SEAT>-<PAGE>-<ACTION> case: every seat x page x action. The expectation of each case was DERIVED by the generator from
 * the access policy and the capability / scope tables (the generator says from which); this file only compares the answer to it:
 *   refuse-door     the page is not the seat's (or the seat is not admitted): 403 with the guard's code (`page` / `no-grant`), a body that names
 *                   nothing, and not one call to Zoho.
 *   refuse-right    the seat reaches the page but not the right the handler applies: a GET is refused 403 with a capability code before any read;
 *                   a write is refused (a 4xx, never a 2xx) and NO write reaches Zoho. A write refused only because its body was invalid is
 *                   counted as "validation first" (it did not reach the authority check with the harness's empty body), never as proof.
 *   refuse-stepup   the route asks step-up before anything: 403 `step-up`, no call to Zoho.
 *   serve           the seat holds the right: the door and the handler do not refuse it for want of the right.
 *   door-only       the handler's own rule is not in the table: the door is held, the rest is judged by the checks below only.
 *   open            no session behind the route by design.
 * On EVERY answer of every case (any status):
 *   identity   no unmasked PAN / Aadhaar / full UTR / account / DOB (leak-matrix names and value shapes); no canary identity value — the Zoho
 *              double ADDS PAN, Aadhaar, bank account, IFSC, holder name and Aadhaar reference to every record it returns, as a profile that
 *              failed to hide them would, so a projection that lets one through shows; a seat without pii has no PAN / Aadhaar / KYC proof /
 *              Aadhaar reference field at all, and a seat without bank has no IFSC / holder / bank name, branch, address or proof field at all
 *              (masked last-four values excepted); no stack trace, path, Zoho error body.
 *   books      a seat whose scope for a book is `none` reads no module of that book; a seat scoped to its own records (user / own-lead /
 *              own-book) lists them only under a filter naming itself; no query of one seat names another seat's user id.
 * Synthetic data only. Known failures are listed in KNOWN with their reason: skipped, never fixed here.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const H = require('./harness.cjs');
const C = require('./contract-lib.cjs');
const L = C.L;

const MATRIX = path.resolve(__dirname, '..', '..', '..', '..', '..', 'pm', 'generated', 'api-matrix.json');
const matrix = JSON.parse(fs.readFileSync(MATRIX, 'utf8'));

const KNOWN = {};

/* codes a handler answers with when it refuses for want of a right or a book (everything else is the validation, scope or Zoho-state answers) */
const RIGHT_CODES = new Set(['seat-denied', 'capability-missing', 'not-finance', 'read-only', 'no-extend-right', 'no-release-right', 'not-matcher',
  'not-approver', 'no-book', 'not-a-log-reader', 'not-a-system-reader', 'not-own-lead', 'step-up', 'not-allowed']);
const DOOR_CODES = new Set(['page', 'no-grant', 'no-seat']);

/* a module -> the book whose scope governs it (server/data/scope.ts BOOKS) */
const MODULE_BOOK = { Leads: 'leads', Contacts: 'investors', LLP_UnitAllocation_Module: 'money', Receipts: 'money', Investor_Payouts: 'money',
  Cases: 'cases', ARL_Holdings: 'holdings', LLP_Creation_Module: 'farms' };
/* By-design reads of a book the seat does not hold, each with its reason (the route comment in guard-core API_ROUTES). */
const BOOK_EXEMPT = {
  '/api/leads/[id]/hints': 'M12-S11-T03: the IR\'s word for Finance beside its queue, read on the viewer\'s own token (D53) — Zoho sharing decides, the reply carries no lead field beyond a hint',
  /* narrowed to one module: every other book of this route is still held to the seat's scope */
  '/api/queues/investors': { modules: ['Leads'], why: 'G1 (D136): Finance\'s to-do reads the IRs\' "send the NDA / supplementary" requests (Leads.*_Requested_*) on the viewer\'s own token (D53) — the Finance sharing rule on Leads decides; a row carries the lead\'s name and the request only' },
  '/api/leads/[id]/conversion': { modules: ['Leads'], why: 'GC-1527 (D137): Finance confirms the 10% on ONE lead by id and creates the investor from it — the lead is read on Finance\'s own token (D53); the Finance sharing rule on Leads decides whether Zoho returns it' },
};
const exemptFor = (route, module) => { const e = BOOK_EXEMPT[route]; return !!e && (typeof e === 'string' || e.modules.includes(module)); };

/* identity the Zoho double adds to every record it returns (synthetic shapes, never a real value) */
const CANARY = { PAN_Number: 'ZZZZZ9999Z', PAN: 'ZZZZZ9998Z', Aadhaar_Number: '234567890123', Aadhaar_Ref: 'UIDAI-ZZ-90123456', Bank_Account_Number: '987654321098',
  ISFC_Code: 'ZZZZ0987654', Account_Holder_Full_name: 'CANARY HOLDER NAME', Bank_Name: 'CANARY BANK NAME', Bank_Proof: 'canary-proof.pdf', PAN_Proof: 'canary-pan.pdf' };
/* the recorded fixtures (src/lib/zoho/__fixtures__) already carry identity values on their Contact rows, as a profile that failed to hide them would */
const FIXTURE_IDENTITY = ['FXPAN1234F', 'FXPAN9999Z', 'FXBANK000999', 'FXBANK123456', 'FXAADHAAR0001'];
const CANARY_VALUES = [...Object.values(CANARY).filter((v) => !/\.pdf$/.test(v)), ...FIXTURE_IDENTITY];
const BANK_NAME = /^(ifsc|isfc)(_?code)?$|account_?holder|^bank_?(name|branch|address|proof|account)|^acct|account_?number/i;
const PII_NAME = /^pan(_?(number|no|proof))?$|aadhaar|aadhar|kyc_?(ref|proof)/i;
const MASKED = L.looksMasked; /* one detector for every mask the console emits (M18-S02-NOTE-4) */
const WHO_VALUES = Object.values(H.WHO);

const calls = []; /* every call to the Zoho double since the last reset */
let seed = null;  /* module -> rows: when set, the double answers every non-aggregate COQL over those modules with ALL of them, whatever the WHERE says (Zoho "slipping" a row of another book), and a GET by id from the same rows */
function installDouble() {
  const base = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url && url.url ? url.url : url);
    if (/^https?:\/\/localhost/.test(u)) return base(url, init);
    let q = null; try { q = init && typeof init.body === 'string' ? JSON.parse(init.body).select_query || null : null; } catch { q = null; }
    calls.push({ method: (init && init.method) || 'GET', url: u, q });
    if (seed) {
      const json = (data) => new Response(JSON.stringify({ data, info: { count: data.length, more_records: false } }), { status: 200, headers: { 'content-type': 'application/json' } });
      const mod = q ? (/\bfrom\s+(\w+)/i.exec(q) || [])[1] : null;
      if (mod && seed[mod] && !/\b(count|sum|max|min|avg)\s*\(/i.test(q)) return json(seed[mod]);
      const g = /\/crm\/v\d+\/(\w+)\/(\d+)(\?|$)/.exec(u);
      if (g && seed[g[1]] && ((init && init.method) || 'GET') === 'GET') { const row = seed[g[1]].find((x) => x.id === g[2]); return row ? json([row]) : new Response(null, { status: 204 }); }
    }
    const r = await base(url, init);
    if (q && r.status === 200) {
      /* the recorded rows carry the fixture id prefix; the routes run on the suite's: re-prefix them so the readers accept the rows and the projections run */
      const j = await r.clone().text().then((t) => JSON.parse(t.replace(/9007199254(\d{9})/g, '554023$1'))).catch(() => null);
      if (j && Array.isArray(j.data)) {
        for (const rec of j.data) if (rec && typeof rec === 'object') for (const [k, v] of Object.entries(CANARY)) if (!(k in rec)) rec[k] = v;
        return new Response(JSON.stringify(j), { status: 200, headers: r.headers });
      }
    }
    return r;
  };
}

const fill = (route) => route.replace(/\[kind\]/, 'lead').replace(/\[[^\]]+\]/g, C.ID);
const paramsOf = (c) => Object.fromEntries(c.params.map((p) => [p, p === 'kind' ? 'lead' : C.ID]));
const mods = new Map();
const modOf = (route) => mods.get(route) || mods.set(route, require(H.routeFile(route))).get(route);

async function run(c, seat) {
  calls.length = 0;
  const res = await H.call(modOf(c.route), c.method, fill(c.route), { seat, params: paramsOf(c), body: c.method === 'GET' ? undefined : {}, contentType: 'application/json',
    headers: { 'Idempotency-Key': 'contract-suite-key-000000000000' } });
  return { res, calls: calls.slice() };
}

const reads = (cs) => cs.filter((x) => x.method === 'GET' || /\/coql(\?|$)/.test(x.url));
const writes = (cs) => cs.filter((x) => !(x.method === 'GET' || /\/coql(\?|$)/.test(x.url)));
const moduleOf = (x) => x.q ? ((/\bfrom\s+([A-Za-z_]+)/i.exec(x.q) || [])[1] || null) : ((/\/crm\/v\d+\/([A-Za-z_]+)(?:\/|\?|$)/.exec(x.url) || [])[1] || null);

/** Walk a JSON body: every key whose value is present and not masked. */
function fieldFindings(json, seat) {
  const out = [];
  (function walk(v, p) {
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${p}[${i}]`));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) {
      const present = x !== null && x !== undefined && x !== '' && typeof x !== 'object';
      if (present && !MASKED(String(x))) {
        if (!seat.identity.bank && BANK_NAME.test(k)) out.push(`${p}.${k} (bank field for a seat without bank)`);
        if (!seat.identity.pii && PII_NAME.test(k)) out.push(`${p}.${k} (identity field for a seat without pii)`);
      }
      walk(x, `${p}.${k}`);
    }
  })(json, '$');
  return out;
}

function identityProblems(c, seat, res) {
  const bad = [];
  const lk = C.leaks(res); if (lk.length) bad.push(`leak ${JSON.stringify(lk)}`);
  const json = res.json;
  for (const f of L.maskedFindings(json, res.text)) bad.push(`${f.kind} unmasked at ${f.path}`);
  for (const v of CANARY_VALUES) if (res.text.includes(v)) bad.push(`canary identity value ${v.slice(0, 4)}… reached the answer`);
  bad.push(...fieldFindings(res.json, seat));
  return bad;
}

function scopeProblems(c, seat, cs) {
  const bad = [];
  for (const x of reads(cs)) {
    const m = moduleOf(x), book = m && MODULE_BOOK[m];
    if (x.q) for (const w of WHO_VALUES) if (w !== H.WHO[seat.token] && x.q.includes(w)) bad.push(`a query names another seat's user id (${m})`);
    if (!book) continue;
    const kind = seat.books[book];
    const aggregate = x.q && /\b(count|sum|max|min|avg)\s*\(/i.test(x.q);
    if (kind === 'none' && !exemptFor(c.route, m)) bad.push(`reads ${m} (${book} book) but the seat's ${book} scope is none`);
    if (x.q && !aggregate && ['user', 'own-lead', 'own-book'].includes(kind) && !/\bid\s*(=|in)\s*[('"]/i.test(x.q) && book !== 'money' && book !== 'farms' && book !== 'holdings') {
      if (!x.q.includes(H.WHO[seat.token])) bad.push(`lists ${m} for a ${kind} seat without a filter naming the seat`);
    }
  }
  return bad;
}

const stats = { pass: 0, skip: 0, fail: 0, byExpect: {}, weak: [], bodies: 0, bodiesByStatus: {}, reached: 0, fails: [], skips: [], lookedAtScope: 0, scopeCases: 0 };
const seatOf = Object.fromEntries(matrix.seats.map((s) => [s.token, s]));

test.before(async () => { await H.installRuntime(); H.setMode('enforce'); installDouble(); });

test('the matrix is current: regenerating it from the policy gives the committed file', () => {
  const { spawnSync } = require('node:child_process');
  const r = spawnSync(process.execPath, [path.resolve(__dirname, '..', '..', '..', '..', '..', 'pm', 'gen-api-matrix.mjs'), '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, `pm/generated/api-matrix.json is stale or the policy and the contract table disagree: ${(r.stderr || r.stdout).slice(0, 400)}`);
});

test('the matrix covers every seat x route x method of the contract table, once', () => {
  const T = require('./contract-table.cjs');
  const rows = T.table().filter((r) => !r.excluded);
  const want = rows.reduce((n, r) => n + r.methods.length, 0) * matrix.seats.length;
  assert.equal(matrix.cases.length, want);
  assert.equal(new Set(matrix.cases.map((c) => c.id)).size, want);
  assert.deepEqual(matrix.seats.map((s) => s.token).sort(), [...H.SEATS].sort());
  for (const c of matrix.cases) assert.match(c.id, /^TC-PM-[A-Z]+-[A-Z]+-(GET|POST|PUT|PATCH|DELETE)-[A-Z0-9-]+$/);
});

for (const c of matrix.cases) {
  test(`${c.id} [${c.expect}] ${c.method} ${c.route} as ${c.seat}`, async (t) => {
    const seat = seatOf[c.seat];
    const isOpen = c.expect === 'open';
    const { res, calls: cs } = await run(c, isOpen ? null : c.seat);
    const problems = [];
    const code = res.json && typeof res.json.code === 'string' ? res.json.code : null;
    const doorRefused = (res.status === 401 || res.status === 403) && code && DOOR_CODES.has(code);
    if (res.thrown !== undefined) problems.push(`threw past withErrorCapture (${res.thrown})`);
    stats.byExpect[c.expect] = (stats.byExpect[c.expect] || 0) + 1;

    switch (c.expect) {
      case 'refuse-door':
        if (res.status !== 403) problems.push(`expected a 403 from the door, got ${res.status} ${res.text.slice(0, 120)}`);
        if (code !== c.doorCode) problems.push(`expected door code ${c.doorCode}, got ${code}`);
        if (res.zohoCalls !== 0) problems.push(`the door called Zoho ${res.zohoCalls}x`);
        for (const b of C.refusalNamesNothing(res.json || {})) problems.push(`refusal names ${b}`);
        break;
      case 'refuse-right': {
        const ok2xx = res.status >= 200 && res.status < 300;
        if (ok2xx) problems.push(`SERVED a seat that lacks the right (${JSON.stringify(c.right.rule)}): ${res.status}`);
        if (doorRefused) problems.push(`expected a handler refusal, the door answered ${code}`);
        if (writes(cs).length) problems.push(`a write reached Zoho for a seat that lacks the right: ${writes(cs).map((x) => x.method + ' ' + x.url.replace(/\d{15,22}/g, ':id')).join(', ')}`);
        if (c.method === 'GET') {
          if (res.status !== 403 || !RIGHT_CODES.has(code)) problems.push(`a GET must be refused 403 with a capability code, got ${res.status} ${code}`);
          if (res.zohoCalls !== 0) problems.push(`the refusal came after ${res.zohoCalls} call(s) to Zoho`);
        } else if (!ok2xx && !(res.status === 403 && RIGHT_CODES.has(code))) {
          if ((res.status >= 400 && res.status < 500) || (res.status === 503 && code === 'not-configured')) stats.weak.push(`${c.id}: ${res.status}/${code} (${res.status === 503 ? 'not-configured' : 'validation'} answered before the right was asked)`);
          else problems.push(`a write by a seat without the right must be refused with a 4xx, got ${res.status} ${code}`);
        }
        for (const b of res.status === 403 ? C.refusalNamesNothing(res.json || {}) : []) problems.push(`refusal names ${b}`);
        break;
      }
      case 'refuse-stepup':
        if (res.status !== 403 || code !== 'step-up') problems.push(`expected 403 step-up, got ${res.status} ${code}`);
        if (res.zohoCalls !== 0) problems.push(`step-up came after ${res.zohoCalls} call(s) to Zoho`);
        break;
      case 'serve':
        if (doorRefused) problems.push(`the seat holds the page and the right, the door refused: ${res.status} ${code}`);
        /* a capability refusal comes before any read (the refuse-right cases prove that); a refusal AFTER Zoho answered is the data's (a row outside the scope, dropped) */
        if (res.status === 403 && RIGHT_CODES.has(code) && res.zohoCalls === 0) problems.push(`refused ${code} before any read although the seat holds the right (${c.right.src})`);
        break;
      case 'door-only':
      case 'open':
        if (!isOpen && doorRefused) problems.push(`the table lets this seat through the door, the door refused: ${res.status} ${code}`);
        break;
      default: problems.push(`unknown expectation ${c.expect}`);
    }

    if (c.expect !== 'refuse-door' && c.expect !== 'open') {
      problems.push(...identityProblems(c, seat, res).map((p) => `identity: ${p}`));
      if (res.zohoCalls > 0) stats.reached++;
      stats.scopeCases++;
      problems.push(...scopeProblems(c, seat, cs).map((p) => `books: ${p}`));
    } else problems.push(...identityProblems(c, seat, res).filter((p) => !/^canary/.test(p)).map((p) => `identity: ${p}`));
    if (res.json !== undefined && res.status >= 200 && res.status < 300) { stats.bodies++; stats.bodiesByStatus[c.route] = (stats.bodiesByStatus[c.route] || 0) + 1; }

    if (problems.length) {
      const k = KNOWN[c.id];
      if (k) { stats.skip++; stats.skips.push(`${c.id} — ${k}`); return t.skip(k); }
      stats.fail++; stats.fails.push(`${c.id}: ${problems.slice(0, 4).join(' | ')}`);
      assert.fail(`${c.id}: ${problems.join(' | ')}`);
    }
    stats.pass++;
  });
}


/* ---- seeded books: one record of the seat's own book and one of another's, both handed to the seat by a Zoho that ignores the filter ---------------- */
const rec = (dir, name) => JSON.parse(fs.readFileSync(path.join(H.FIX, dir, `${name}.response.json`), 'utf8').replace(/9007199254(\d{9})/g, '554023$1')).body.data;
const OTHER_IR = '554023000000199901', OTHER_KAM = '554023000000199902';
const contacts = rec('data', 'coql.contacts.org'), cases0 = rec('data', 'coql.cases');
const OWN = { ...contacts[0], id: '554023740997101', Last_Name: 'Investor OWN', Originating_IR: { id: H.WHO.ir, name: 'x' }, KAM: { id: H.WHO.kam, name: 'x' } };
const FOREIGN = { ...contacts[1], id: '554023740997102', Last_Name: 'Investor FOREIGN-B', Email: 'foreign.b@example.invalid', Originating_IR: { id: OTHER_IR, name: 'x' }, KAM: { id: OTHER_KAM, name: 'x' } };
const OWN_CASE = { ...cases0[0], id: '554023740998401', Subject: 'OWN-CASE', Owner: { id: H.WHO.kam, name: 'x' } };
const FOREIGN_CASE = { ...cases0[0], id: '554023740998402', Subject: 'FOREIGN-CASE', Owner: { id: OTHER_KAM, name: 'x' } };
const hasForeign = (text) => text.includes(FOREIGN.id) || text.includes('FOREIGN') || text.includes('foreign.b@example') || text.includes(OTHER_IR) || text.includes(OTHER_KAM);
const LLP = { ...rec('data', 'coql.llps')[0], id: '554023740998101', PAN: 'ZZZZZ9998Z', GST: '29ZZZZZ9998Z1Z5', SPOC_1_Full_Name: 'Synthetic Spoc', SPOC_1_Contact_No: '+91 90000 00001' };
const seededStats = { cases: 0, refused: 0, served: 0 };

async function seeded(route, seat, rows, { qs = '', params = {}, name } = {}) {
  seed = rows;
  try {
    calls.length = 0;
    const tmpl = Object.keys(params).length ? route.replace(/\/\d{15,22}/, '/[id]') : route;
    const res = await H.call(require(H.routeFile(tmpl)), 'GET', route + qs, { seat, params });
    const seat_ = seatOf[seat];
    const problems = identityProblems({}, seat_, res);
    return { res, problems, code: res.json && res.json.code };
  } finally { seed = null; }
}
const SEEDED = [
  /* own-lead / own-book seats are handed another's investor: the record is refused or dropped, never shown; the body names nothing */
  ['SB-IR-MINE', 'GET /api/investors/mine', '/api/investors/mine', 'ir', { Contacts: [OWN, FOREIGN] }, {}, (r) => r.status === 403 && r.code === 'not-own-lead' ? 'refused' : r.status === 200 && r.res.text.includes(OWN.id) ? 'served' : null],
  ['SB-IR-SEARCH', 'GET /api/investors/search', '/api/investors/search', 'ir', { Contacts: [OWN, FOREIGN] }, { qs: '?q=Investor' }, (r) => r.status === 200 && r.res.text.includes(OWN.id) ? 'served' : null],
  ['SB-KAM-SEARCH', 'GET /api/investors/search', '/api/investors/search', 'kam', { Contacts: [OWN, FOREIGN] }, { qs: '?q=Investor' }, (r) => r.status === 200 && r.res.text.includes(OWN.id) ? 'served' : null],
  ['SB-KAM-CASES', 'GET /api/cases', '/api/cases', 'kam', { Cases: [OWN_CASE, FOREIGN_CASE] }, {}, (r) => r.status === 403 && r.code === 'scope-drift' ? 'refused' : null],
  ['SB-IR-RECORD', 'GET /api/investors/[id]/record', `/api/investors/${FOREIGN.id}/record`, 'ir', { Contacts: [OWN, FOREIGN] }, { params: { id: FOREIGN.id } }, (r) => r.status === 403 && r.code === 'not-own-lead' ? 'refused' : null],
  ['SB-KAM-RECORD', 'GET /api/investors/[id]/record', `/api/investors/${FOREIGN.id}/record`, 'kam', { Contacts: [OWN, FOREIGN] }, { params: { id: FOREIGN.id } }, (r) => r.status === 403 && r.code === 'not-own-lead' ? 'refused' : null],
  ['SB-IR-INVESTOR', 'GET /api/investors/[id]', `/api/investors/${FOREIGN.id}`, 'ir', { Contacts: [OWN, FOREIGN] }, { params: { id: FOREIGN.id } }, (r) => r.status === 403 && r.code === 'not-own-lead' ? 'refused' : null],
  ['SB-KAM-PREVIEW', 'GET /api/investors/[id]/preview', `/api/investors/${FOREIGN.id}/preview`, 'kam', { Contacts: [OWN, FOREIGN] }, { params: { id: FOREIGN.id } }, (r) => r.status === 403 && r.code === 'not-own-lead' ? 'refused' : null],
  ['SB-IR-ALLOTMENTS', 'GET /api/investors/[id]/allotments', `/api/investors/${FOREIGN.id}/allotments`, 'ir', { Contacts: [OWN, FOREIGN] }, { params: { id: FOREIGN.id } }, (r) => r.status === 403 && r.code === 'not-own-lead' ? 'refused' : null],
];
for (const [id, key, url, seat, rows, opts, verdict] of SEEDED) {
  test(`${id}: ${key} as ${seat} — another book's record handed over by Zoho is refused or dropped, the seat's own is served, nothing identity-shaped is shown`, async () => {
    const r = await seeded(url, seat, rows, opts);
    seededStats.cases++;
    assert.equal(r.res.thrown, undefined);
    assert.equal(hasForeign(r.res.text), false, `${key} as ${seat} showed another book's record: ${r.res.text.slice(0, 200)}`);
    assert.deepEqual(r.problems, [], `${key} as ${seat}: ${r.problems.join(' | ')}`);
    const v = verdict(r.res.status === undefined ? r : { ...r, status: r.res.status });
    assert.ok(v, `${key} as ${seat}: neither the seat's own record served nor a scope refusal: ${r.res.status} ${r.res.text.slice(0, 160)}`);
    if (v === 'refused') { seededStats.refused++; assert.deepEqual(C.refusalNamesNothing(r.res.json), [], 'the refusal names nothing'); }
    else seededStats.served++;
  });
}
for (const seat of ['head', 'fin', 'comp', 'amlead', 'kam']) {
  test(`SB-FARM-${seat.toUpperCase()}: GET /api/farms/[id] as ${seat} — the farm's company PAN and GST are on the row Zoho returns, the answer carries them masked`, async () => {
    const r = await seeded(`/api/farms/${LLP.id}`, seat, { LLP_Creation_Module: [LLP] }, { params: { id: LLP.id } });
    assert.equal(r.res.status, 200, `${r.res.status} ${r.res.text.slice(0, 200)}`);
    assert.ok(r.res.json && r.res.text.includes(LLP.id), 'the farm is served');
    assert.equal(r.res.text.includes('ZZZZZ9998Z'), false, 'the PAN is masked');
    assert.equal(r.res.text.includes('29ZZZZZ9998Z1Z5'), false, 'the GST is masked');
    assert.deepEqual(r.problems, []);
    seededStats.cases++; seededStats.served++;
  });
}
test('SB-ORG: the same two records are shown to Finance (org scope): the seeded double really hands both over, so the cases above test the console, not the double', async () => {
  const fin = await seeded('/api/investors/search', 'fin', { Contacts: [OWN, FOREIGN] }, { qs: '?q=Investor' });
  assert.equal(fin.res.status, 200);
  assert.ok(fin.res.text.includes(OWN.id) && fin.res.text.includes(FOREIGN.id), 'Finance sees both');
  assert.deepEqual(fin.problems, []);
  const c = await seeded('/api/cases', 'fin', { Cases: [OWN_CASE, FOREIGN_CASE] });
  assert.equal(c.res.status, 200);
  assert.ok(c.res.text.includes('OWN-CASE') || c.res.text.includes(OWN_CASE.id));
  assert.ok(c.res.text.includes(FOREIGN_CASE.id), 'Finance sees both cases');
  assert.deepEqual(c.problems, []);
});

/* ---- the detectors detect (a green matrix means something) ---------------------------------------------------------------------------------- */
test('matrix detectors: identity names and values, canaries, books', () => {
  const kam = { token: 'kam', identity: { pii: false, bank: false }, books: { investors: 'own-book', leads: 'none', money: 'own-book', cases: 'own-book', holdings: 'none', farms: 'org' } };
  const fin = { token: 'fin', identity: { pii: false, bank: true }, books: { investors: 'org', leads: 'none', money: 'org', cases: 'org', holdings: 'org', farms: 'org' } };
  const hit = (seat, json) => identityProblems({}, seat, { text: JSON.stringify(json), json, headers: {}, status: 200 });
  assert.equal(hit(kam, { x: { ifsc: 'HDFC0001234' } }).length, 1, 'a bank field for a seat without bank');
  assert.equal(hit(fin, { x: { ifsc: 'HDFC0001234' } }).length, 0, 'bank fields are the Finance seat\'s');
  assert.ok(hit(fin, { x: { aadhaar_ref: 'UIDAI-1' } }).length >= 1, 'an identity field for a seat without pii');
  assert.equal(hit(kam, { x: { bank_account: '••••4520', ifsc: 'XXXX' } }).filter((p) => /bank field/.test(p)).length, 0, 'a masked value is not a leak');
  assert.ok(hit(fin, { a: 'FXBANK000999' }).some((p) => /canary/.test(p)), 'a fixture identity value in a body');
  assert.ok(hit(fin, { pan: 'ABCDE1234F' }).some((p) => /pan unmasked/.test(p)));
  const q = (qq) => ({ method: 'POST', url: 'https://www.zohoapis.in/crm/v8/coql', q: qq });
  const bad = (seat, cs) => scopeProblems({ route: '/api/x' }, seat, cs);
  assert.equal(bad(kam, [q('select id from Leads where id is not null')]).length, 1, 'a book the seat does not hold');
  assert.equal(bad(kam, [q(`select id from Contacts where KAM = '${H.WHO.kam}'`)]).length, 0);
  assert.equal(bad(kam, [q('select id from Contacts where id is not null')]).length, 1, 'an own-book seat listing without its own filter');
  assert.equal(bad(kam, [q(`select id from Contacts where KAM = '${H.WHO.ir}'`)]).filter((p) => /another seat/.test(p)).length, 1, 'another seat\'s user id');
  assert.equal(bad(fin, [q('select id from Contacts where id is not null')]).length, 0, 'an org seat lists the org');
  assert.equal(bad(kam, [q('select Allocation_Status, SUM(Issued_Units) from LLP_UnitAllocation_Module group by Allocation_Status')]).length, 0, 'an aggregate (counts only) is not a list');
});

test.after(() => {
  const r = Object.entries(stats.byExpect).map(([k, v]) => `${k} ${v}`).join(' · ');
  console.log(`\n# api matrix — cases ${matrix.cases.length} (${r}) · pass ${stats.pass} · skip ${stats.skip} · fail ${stats.fail}`);
  console.log(`# refusals by write-validation-first (not proof of the authority check): ${stats.weak.length} · answers with a 2xx body judged for identity: ${stats.bodies} across ${Object.keys(stats.bodiesByStatus).length} routes · cases that reached Zoho: ${stats.reached}`);
  console.log(`# seeded books (another book's record handed to the seat by Zoho): ${seededStats.cases} cases · refused ${seededStats.refused} · own served/dropped ${seededStats.served}`);
  if (process.env.GZ_CONTRACT_REPORT) fs.writeFileSync(process.env.GZ_CONTRACT_REPORT + '.matrix', JSON.stringify({ matrix: { ...stats, cases: matrix.cases.length } }, null, 1));
});
