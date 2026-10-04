/* node --test scripts/smoke.test.cjs — M19-S07 smoke suite helpers (pure). */
'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const { REQUIRED_HEADERS, missingHeaders, cspProblem, parseArgs, isRead, summarise } = require('./smoke.lib.cjs');

test('the required header list is the one the app sends (security-headers.mjs)', async () => {
  const { REQUIRED_SECURITY_HEADERS } = await import('../security-headers.mjs');
  assert.deepEqual([...REQUIRED_HEADERS].sort(), REQUIRED_SECURITY_HEADERS.map(h => h.toLowerCase()).sort());
});
test('missingHeaders is case-blind and accepts a Headers instance', () => {
  assert.deepEqual(missingHeaders({ 'Content-Security-Policy': 'x' }, ['content-security-policy', 'x-frame-options']), ['x-frame-options']);
  assert.deepEqual(missingHeaders(new Headers({ 'X-Frame-Options': 'DENY' }), ['x-frame-options']), []);
  assert.equal(missingHeaders({}).length, REQUIRED_HEADERS.length);
});
test('cspProblem refuses inline, eval and wildcard scripts', async () => {
  const { pageCsp } = await import('../security-headers.mjs');
  assert.equal(cspProblem(pageCsp('abcdefghijklmnopqrstuv==')), '');
  assert.match(cspProblem("default-src 'self'; script-src 'self' 'unsafe-inline'"), /inline/);
  assert.match(cspProblem("script-src 'unsafe-eval'"), /eval/);
  assert.match(cspProblem('script-src *'), /wildcard/);
  assert.equal(cspProblem("default-src 'self'"), 'no script-src');
});
test('parseArgs: url, mode, options, errors', () => {
  const a = parseArgs(['http://x.test/', '--mode', 'production', '--out', 'o.json', '--budget-s', '90'], {});
  assert.equal(a.url, 'http://x.test/'); assert.equal(a.mode, 'production'); assert.equal(a.out, 'o.json'); assert.equal(a.budgetS, 90); assert.deepEqual(a.errors, []);
  assert.equal(parseArgs(['http://x.test', '--production'], {}).mode, 'production');
  assert.ok(parseArgs([], {}).errors.some(e => /URL is required/.test(e)));
  assert.ok(parseArgs(['ftp://x'], {}).errors.some(e => /http/.test(e)));
  assert.ok(parseArgs(['http://x', '--mode', 'prod'], {}).errors.some(e => /--mode/.test(e)));
  assert.ok(parseArgs(['http://x', '--nope'], {}).errors.some(e => /unknown option/.test(e)));
  assert.ok(parseArgs(['http://x', '--out'], {}).errors.some(e => /needs a value/.test(e)));
  assert.ok(parseArgs(['http://x', '--production', '--jev'], {}).errors.some(e => /not allowed in production/.test(e)));
  assert.equal(parseArgs(['http://x'], { SMOKE_ALERT_WEBHOOK: 'https://hook' }).alertWebhook, 'https://hook');
});
test('read-only guard: only GET, HEAD, OPTIONS', () => {
  for (const m of ['GET', 'head', 'Options']) assert.equal(isRead(m), true);
  for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.equal(isRead(m), false);
});
test('summarise: skipped is not a failure, a failure or an overrun is exit 1', () => {
  const ok = { name: 'a', ok: true }, bad = { name: 'b', ok: false }, skip = { name: 'c', ok: false, skipped: true };
  assert.equal(summarise([ok, skip], { elapsedMs: 1000 }).code, 0);
  assert.match(summarise([ok, skip], { elapsedMs: 1000 }).line, /1\/1 pass · 1 skipped/);
  const f = summarise([ok, bad], { elapsedMs: 1000 }); assert.equal(f.code, 1); assert.equal(f.failed.length, 1);
  const slow = summarise([ok], { budgetS: 180, elapsedMs: 181000 }); assert.equal(slow.code, 1); assert.match(slow.line, /OVER/);
});
