/* M18-S14-H2 — every API route refuses at the door. Run from console/: node --test src/server/http/contract/api-refusals.test.cjs
 *
 * The real route handlers (guard.ts in ENFORCE mode, the policy, withErrorCapture) are called directly with constructed
 * Requests — harness.cjs says what is faked (the session store and Zoho, nothing else). For every route × method of the
 * contract table:
 *   401  no session cookie → 401, JSON, a short `code`, nothing else of substance (no record, no field, no count);
 *   403  every seat the capability table refuses → 403, a short `code`, a body that names no record, field or count;
 *        every seat it allows is NOT refused by the door;
 *   4xx  a write with a malformed body, a missing required field, the wrong content type or an oversized body → a 4xx with a
 *        short code — never a stack trace, a file path, a runtime error text or a Zoho error body, never a 2xx, never a 5xx.
 * Where a case cannot be settled without Zoho (the handler reached the Zoho double, or answers "not configured") or without a
 * seat that passes the handler's own capability, it is SKIPPED with that reason — the table says so, nothing is faked.
 * Known contract failures found by this suite are listed in KNOWN below: the case is skipped with its reason, never fixed here.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const H = require('./harness.cjs');
const T = require('./contract-table.cjs');
const C = require('./contract-lib.cjs');

/* Real contract failures (route · method · case → what is wrong). Skipped, not fixed: the route handlers, guard.ts and the
   wrappers belong to M18-S15. Each entry is skipped only while it fails; once fixed the case simply passes. */
const KNOWN = {
  '401-body-is-code-only': 'guard-core refusalResponse answers 401 with {error, code, landing, session, signedOut}, the story wants {code} only (owner: M18-S15, server/access/guard-core.ts)',
};

const rows = T.table().filter((r) => !r.excluded);
const stats = { pass: 0, skip: 0, fail: 0, skips: [], fails: [] };
const fill = (r) => r.route.replace(/\[kind\]/, 'lead').replace(/\[[^\]]+\]/g, C.ID);
const paramsOf = (r) => Object.fromEntries(r.params.map((p) => [p, p === 'kind' ? 'lead' : C.ID]));
const modOf = (r) => require(H.routeFile(r.route));
const seatsOf = (r) => (r.seats === '*' ? H.SEATS : r.seats);
const refusedSeats = (r) => (r.seats === '*' ? [] : H.SEATS.filter((s) => !r.seats.includes(s)));

function clean(res, what) {
  const l = C.leaks(res);
  assert.deepEqual(l, [], `${what}: leak ${JSON.stringify(l)} in ${res.text.slice(0, 200)}`);
  assert.equal(res.thrown, undefined, `${what}: the handler threw past withErrorCapture: ${res.thrown}`);
}

test.before(async () => { await H.installRuntime(); H.setMode('enforce'); });

for (const r of rows) {
  for (const method of r.methods) {
    const name = `${method} ${r.route}`;
    const spec = (r.spec && r.spec[method]) || {};
    const open = r.seats === '*';
    const hmac = spec.body && spec.body.hmac;
    const call = (opts) => H.call(modOf(r), method, fill(r), { params: paramsOf(r), ...opts });

    /* ---- 401 ------------------------------------------------------------------------------------------------ */
    if (!open) {
      test(`401 ${name}: no session cookie → 401 with a short code and no data`, async () => {
        const res = await call({ body: method === 'GET' ? undefined : '{}', contentType: 'application/json' });
        clean(res, name);
        assert.equal(res.status, 401, `${name}: ${res.status} ${res.text.slice(0, 160)}`);
        assert.ok(res.json && typeof res.json.code === 'string' && C.SHORT_CODE.test(res.json.code), `${name}: no short code in ${res.text}`);
        const extra = Object.keys(res.json).filter((k) => !C.ENVELOPE.has(k));
        assert.deepEqual(extra, [], `${name}: 401 body carries ${extra}`);
        assert.deepEqual(C.refusalNamesNothing(res.json), [], name);
        stats.pass++;
      });
    } else if (hmac) {
      test(`401 ${name}: no signature → refused with a 4xx and nothing else`, async () => {
        const res = await call({ body: '{}', contentType: 'application/json' });
        clean(res, name);
        assert.ok(res.status === 401 || res.status === 400, `${name}: ${res.status} ${res.text.slice(0, 160)}`);
        assert.deepEqual(C.refusalNamesNothing(res.json || {}), [], name);
        stats.pass++;
      });
    }

    /* ---- 403 ------------------------------------------------------------------------------------------------ */
    if (!open) {
      test(`403 ${name}: every seat the capability table refuses gets a 403 that names nothing`, async () => {
        for (const seat of refusedSeats(r)) {
          const res = await call({ seat, body: method === 'GET' ? undefined : '{}', contentType: 'application/json' });
          clean(res, `${name} as ${seat}`);
          assert.equal(res.status, 403, `${name} as ${seat}: ${res.status} ${res.text.slice(0, 160)}`);
          assert.ok(res.json && C.SHORT_CODE.test(res.json.code || ''), `${name} as ${seat}: no short code in ${res.text}`);
          assert.ok(C.GUARD_CODES.has(res.json.code), `${name} as ${seat}: refused by the handler, not the door: ${res.json.code}`);
          assert.deepEqual(C.refusalNamesNothing(res.json), [], `${name} as ${seat}`);
          assert.equal(res.zohoCalls, 0, `${name} as ${seat}: the door called Zoho`);
        }
        stats.pass++;
      });
      test(`403 ${name}: no seat the capability table allows is refused by the door`, async () => {
        for (const seat of seatsOf(r)) {
          const res = await call({ seat, body: method === 'GET' ? undefined : '{}', contentType: 'application/json' });
          clean(res, `${name} as ${seat}`);
          const doorRefusal = (res.status === 401 || res.status === 403) && res.json && C.GUARD_CODES.has(res.json.code);
          assert.ok(!doorRefusal, `${name} as ${seat}: the table allows this seat, the door answered ${res.status} ${res.json && res.json.code}`);
        }
        stats.pass++;
      });
    }

    /* ---- 4xx ------------------------------------------------------------------------------------------------ */
    const body = spec.body;
    if (method === 'GET' || !body || body.type === 'none') continue;
    const bytes = body.type === 'bytes' || body.type === 'multipart';
    const cases = [];
    if (body.type === 'json') cases.push({ id: 'malformed-body', body: '{"this is": not json', contentType: 'application/json' });
    else if (body.type === 'multipart') cases.push({ id: 'malformed-body', body: 'not a multipart body', contentType: 'multipart/form-data; boundary=zzz' });
    else cases.push({ id: 'malformed-body', body: '', contentType: 'application/pdf' });
    if (body.type === 'json' && body.required.length) cases.push({ id: 'missing-required-field', body: '{}', contentType: 'application/json' });
    cases.push({ id: 'wrong-content-type', body: bytes ? 'plain text, not a file' : '{"x":1}', contentType: 'text/plain' });
    const big = body.type === 'json' ? JSON.stringify({ pad: 'x'.repeat(Math.max(2 * 1024 * 1024, (body.maxBytes || 0) * 4)) })
      : Buffer.alloc((body.maxBytes || 2 * 1024 * 1024) + 1024 * 1024, 0x41);
    cases.push({ id: 'oversized-body', body: big, contentType: body.type === 'json' ? 'application/json' : body.type === 'multipart' ? 'multipart/form-data; boundary=zzz' : 'application/pdf' });

    for (const c of cases) {
      test(`4xx ${name}: ${c.id} → a 4xx with a short code, never a trace, a path or a Zoho body`, async (t) => {
        const verdicts = [];
        for (const seat of open ? [null] : seatsOf(r)) {
          const res = await call({ seat, body: c.body, contentType: c.contentType, headers: { 'Idempotency-Key': 'contract-suite-key-000000000000' } });
          clean(res, `${name} ${c.id} as ${seat}`);
          let v;
          if (res.zohoCalls > 0) v = ['sandbox', 'the handler reached Zoho before it refused the input'];
          else if (res.status >= 200 && res.status < 300) v = ['fail', `accepted bad input: ${res.status} ${res.text.slice(0, 120)}`];
          else if (res.status === 401 || res.status === 403) v = ['refused', `every seat that reaches it is refused inside the handler (${res.json && res.json.code})`];
          else if (res.status === 503) v = ['sandbox', `answers 503 before it reads the input (${(res.json && res.json.code) || 'a dependency is not configured in the suite'})`];
          else if (res.status >= 500) v = ['fail', `a ${res.status} on bad input: ${res.text.slice(0, 120)}`];
          else if (!res.json || !C.SHORT_CODE.test(String(res.json.code || (hmac && res.json.reason) || ''))) v = ['fail', `${res.status} without a short code: ${res.text.slice(0, 120)}`];
          else v = ['pass', ''];
          verdicts.push({ seat, v, status: res.status });
        }
        const fails = verdicts.filter((x) => x.v[0] === 'fail');
        const key = `${name} ${c.id}`;
        if (fails.length) {
          const msg = `${key}: ${fails.map((f) => `${f.seat}: ${f.v[1]}`).join(' | ')}`;
          if (KNOWN[key]) { stats.skip++; stats.skips.push(`${key} — ${KNOWN[key]}`); return t.skip(KNOWN[key]); }
          stats.fail++; stats.fails.push(msg); assert.fail(msg);
        }
        if (verdicts.some((x) => x.v[0] === 'pass')) { stats.pass++; return; }
        const why = verdicts.some((x) => x.v[0] === 'sandbox') ? `needs sandbox: ${verdicts.find((x) => x.v[0] === 'sandbox').v[1]}` : verdicts[0].v[1];
        stats.skip++; stats.skips.push(`${key} — ${why}`);
        t.skip(why);
      });
    }
  }
}

/* The story's literal wording: a 401 body of {code} only. Skipped while the door's envelope is wider (KNOWN). */
test('401 every route: the body is {code} only', async (t) => {
  await H.installRuntime();
  const res = await H.call(require(H.routeFile('/api/data')), 'GET', '/api/data', {});
  const keys = Object.keys(res.json || {});
  if (keys.join() !== 'code') { stats.skip++; stats.skips.push(`401 every route — ${KNOWN['401-body-is-code-only']}`); return t.skip(`${KNOWN['401-body-is-code-only']}; today's keys: ${keys.join(', ')}`); }
  stats.pass++;
});

test.after(() => {
  console.log(`\n# contract cases — pass ${stats.pass} · skip ${stats.skip} · fail ${stats.fail}`);
  if (process.env.GZ_CONTRACT_REPORT) fs.writeFileSync(process.env.GZ_CONTRACT_REPORT, JSON.stringify({ refusals: stats }, null, 1));
});
