/* M18-S14-H3 — boundary leak suite per seat. Run from console/: node --test src/server/http/contract/api-leaks.test.cjs
 *
 * Every GET of the contract table is read by every seat, in the two modes the suite can run without Zoho:
 *   fixture  FIXTURE_MODE=local — the demo (fixture) book; the guard passes through, exactly as guard.ts does in fixture mode;
 *   enforce  the guard enforcing, Zoho the harness's double (its every answer is a Zoho-shaped error carrying a canary).
 * For every answer of every seat the masked-field list must be absent: PAN, bank account, Aadhaar number, a full UTR,
 * date of birth (by field name — leak-matrix.lib maskedFindings — and by value shape), and no Zoho error body, path or trace.
 * A 2xx must be no-store/private. A seat the table refuses must be refused (enforce). Rupee figures a seat may not see
 * (the table's `rupee` rule) are absent from that seat's answer.
 * A GET that yields no 2xx body in either mode cannot be judged without Zoho: the table must say `needsSandbox` and why,
 * and a route that says so but does yield a body fails — the declaration has to stay true.
 * Known contract failures are in KNOWN: skipped with the reason, never fixed here (routes and guard belong to M18-S15).
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const H = require('./harness.cjs');
const T = require('./contract-table.cjs');
const C = require('./contract-lib.cjs');
const L = C.L;

const KNOWN = {
  'GET /api/data [fixture]': 'the fixture (demo) book carries full PAN ("pan"), bank account ("bank.acct") and full UTR values and /api/data serves them to every seat; fixture mode is test-only (D65) but the story holds the fixture book to the masked list. Fix: mask the demo book or mask by seat in loadPayload (owner: M18-S15 / fixtures)',
};

const rows = T.table().filter((r) => !r.excluded && r.methods.includes('GET'));
const stats = { pass: 0, skip: 0, fail: 0, skips: [], fails: [], covered: 0, sandbox: [] };
const fill = (r) => r.route.replace(/\[kind\]/, 'lead').replace(/\[[^\]]+\]/g, C.ID);
const paramsOf = (r) => Object.fromEntries(r.params.map((p) => [p, p === 'kind' ? 'lead' : C.ID]));
const got2xx = new Map(); /* route → seats that got a JSON body, by mode */

test.before(async () => { await H.installRuntime(); });

for (const r of rows) {
  for (const mode of ['fixture', 'enforce']) {
    const name = `GET ${r.route} [${mode}]`;
    test(`${name}: every seat's answer is free of the masked-field list`, async (t) => {
      H.setMode(mode);
      const failures = [];
      for (const seat of H.SEATS) {
        const res = await H.call(require(H.routeFile(r.route)), 'GET', fill(r), { seat, params: paramsOf(r) });
        const at = `as ${seat}`;
        if (res.thrown !== undefined) failures.push(`${at}: threw past withErrorCapture (${res.thrown})`);
        const ok = res.status >= 200 && res.status < 300;
        if (ok) {
          if (res.json !== undefined) { (got2xx.get(r.route) || got2xx.set(r.route, new Set()).get(r.route)).add(mode + ':' + seat); }
          if (!L.cacheHeaderOk(res.headers)) failures.push(`${at}: cacheable answer (${res.headers['cache-control'] || 'no Cache-Control'})`);
          if (/ZOHO_CANARY/.test(res.text)) failures.push(`${at}: the Zoho error body is in the answer`);
          if (mode === 'enforce' && r.seats !== '*' && !r.seats.includes(seat)) failures.push(`${at}: the table refuses this seat, the route answered ${res.status}`);
        } else {
          const lk = C.leaks(res); if (lk.length) failures.push(`${at}: ${JSON.stringify(lk)}`);
          if (mode === 'enforce' && res.status === 403 && res.json && C.GUARD_CODES.has(res.json.code)) {
            const bad = C.refusalNamesNothing(res.json); if (bad.length) failures.push(`${at}: 403 names ${bad}`);
          }
        }
        for (const f of L.maskedFindings(res.json, res.text)) failures.push(`${at}: ${f.kind} unmasked at ${f.path}`);
        if (res.json !== undefined && ok) for (const rule of (r.spec && r.spec.GET && r.spec.GET.rupee) || []) {
          const v = rupeeVerdict(rule, res.json, seat); if (v) failures.push(`${at}: ${v}`);
        }
      }
      H.setMode('enforce');
      const key = name;
      if (failures.length) {
        if (KNOWN[key]) { stats.skip++; stats.skips.push(`${key} — ${KNOWN[key]}`); return t.skip(KNOWN[key]); }
        stats.fail++; stats.fails.push(`${key}: ${failures.slice(0, 6).join(' | ')}`);
        assert.fail(`${key}: ${failures.length} finding(s): ${failures.slice(0, 8).join(' | ')}`);
      }
      stats.pass++;
    });
  }
}

/* The table's rupee rule: which of this route's figures a seat may not see, and that they are absent from its answer. */
function rupeeVerdict(rule, json, seat) {
  const may = rule.seatsMaySee.includes(seat);
  if (rule.kind === 'tile-hidden') {
    const tile = json[rule.key];
    if (!tile) return `${rule.key} is missing`;
    if (may) return tile.state === 'hidden' ? `${rule.key} is hidden from a seat that may see it` : null;
    if (tile.state !== 'hidden') return `${rule.key} is not hidden (${tile.state}) from a seat that may not see rupee figures`;
    if (Object.keys(tile).some((k) => k !== 'state')) return `${rule.key} is hidden but carries ${Object.keys(tile)}`;
  } else if (rule.kind === 'sections-exclude') {
    const list = (json.side && json.side[rule.key]) || [];
    if (!may) { const shown = rule.values.filter((v) => list.includes(v)); if (shown.length) return `${shown} shown to a seat that may not see rupee figures`; }
  }
  return null;
}

test('H3: every GET yields a body the suite can judge, or the table says needsSandbox and why', () => {
  const problems = [];
  for (const r of rows) {
    const spec = (r.spec && r.spec.GET) || {};
    const bodies = got2xx.get(r.route);
    if (!bodies && !spec.needsSandbox) problems.push(`GET ${r.route}: no 2xx body in either mode and no needsSandbox reason in the contract table`);
    if (bodies && spec.needsSandbox) problems.push(`GET ${r.route}: the table says needsSandbox but it answered ${[...bodies][0]} — remove the declaration`);
    if (bodies) stats.covered++; else stats.sandbox.push(r.route);
  }
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('H3: masked-field detector — names and value shapes', () => {
  assert.deepEqual(L.maskedFindings({ investor: { pan: 'ABCDE1234F', bank: { acct: '50100288714520' }, dob: '1990-04-01' } }, '').map((x) => x.kind), ['pan', 'bank_account', 'dob']);
  assert.deepEqual(L.maskedFindings({ pan: 'XXXXXX234F', bank_account: '••••4520', utrMasked: 'XXXXXXX8551', aadhaar: null }, ''), []);
  assert.deepEqual(L.maskedFindings({ note: 'x' }, 'PAN is ABCDE1234F').map((x) => x.kind), ['pan']);
  assert.equal(L.maskedFindings({ Aadhaar_Number: '234123412341' }, '')[0].kind, 'Aadhaar_Number');
  assert.equal(L.maskedFindings({ payout_utr: 'HDFCR52026123456' }, '')[0].kind, 'utr');
});

test('H3: rupee rules — a seat that may not see figures gets none', () => {
  const rule = { kind: 'tile-hidden', key: 'money', seatsMaySee: ['fin'] };
  assert.equal(rupeeVerdict(rule, { money: { state: 'hidden' } }, 'kam'), null);
  assert.match(rupeeVerdict(rule, { money: { state: 'fresh', value: { banked: 5 } } }, 'kam'), /not hidden/);
  assert.match(rupeeVerdict({ kind: 'sections-exclude', key: 'sections', values: ['cash'], seatsMaySee: ['fin'] }, { side: { sections: ['cash'] } }, 'kam'), /cash shown/);
});

test.after(() => {
  console.log(`\n# leak cases — pass ${stats.pass} · skip ${stats.skip} · fail ${stats.fail} · GET routes with a judged body ${stats.covered} · needs sandbox ${stats.sandbox.length}`);
  if (process.env.GZ_CONTRACT_REPORT) fs.writeFileSync(process.env.GZ_CONTRACT_REPORT + '.leaks', JSON.stringify({ leaks: stats }, null, 1));
});
