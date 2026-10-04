/* R6 M19-S12-NOTE-7 — TC-E15-011 (M18-S02-T04): no secrets or identity values in the repo, the client bundle or the logs; the
 * security headers and cookie flags are present; no administrator token is configured anywhere.
 *   repo      every tracked text file is scanned for secret shapes (Zoho token, private key, cloud/chat/VCS keys, a literal secret
 *             of 32+ characters) and for PAN-shaped values. Tests and fixtures may hold synthetic ones; nothing else may.
 *   bundle    the built client bundle (.next-local/static or .next/static, when a build exists) names no server secret and no token.
 *   logs      the log scrub run is scrub.test.cjs (every producer, normal and error paths) and identity-log-cases.test.cjs.
 *   headers   CSP (frame-ancestors, no script 'unsafe-inline'), HSTS, X-Frame-Options … are security-headers.test.ts's job; here the
 *             rules the config serves are checked to carry them all, so this one case fails if either goes missing.
 *   cookies   the session cookie is httpOnly, SameSite=Lax and Secure when the console is served over https.
 *   admin     no environment variable the code reads names an administrator token, and the .env example sets none.
 * Run from console/: node --test src/server/http/secrets-headers.test.cjs */
'use strict';
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const H = require('./contract/harness.cjs');

const consoleRoot = H.consoleRoot;
const repoRoot = path.resolve(consoleRoot, '..');
const SECRETS = [
  ['zoho-token', /\b1000\.[0-9a-f]{32}\.[0-9a-f]{32}\b/],
  ['private-key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['aws-key', /\bAKIA[0-9A-Z]{16}\b/],
  ['slack-token', /\bxox[bapr]-[0-9A-Za-z-]{10,}/],
  ['vcs-token', /\bgh[pousr]_[A-Za-z0-9]{30,}/],
  ['api-key', /\bsk-[A-Za-z0-9_-]{32,}/],
  ['literal-secret', /(?:client_secret|refresh_token|access_token|api[_-]?key|secret)["']?\s*[:=]\s*["'][A-Za-z0-9_\-./+]{32,}["']/i],
];
const PAN = /\b[A-Z]{3}[ABCFGHLJPT][A-Z]\d{4}[A-Z]\b/;
const TEXT = /\.(ts|tsx|js|cjs|mjs|json|md|html|css|yml|yaml|sh|py|csv|txt|dg|env|example|conf|toml)$|Dockerfile$/;
const tracked = () => execFileSync('git', ['ls-files'], { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 << 20 }).split('\n').filter((f) => f && TEXT.test(f));
/* where a synthetic value is allowed: tests, recorded/synthetic fixtures, the demo book and its prototype, the plan and the audit */
const MAY_HOLD_SYNTHETIC = (f) => /\.test\.|(^|\/)__fixtures__\/|(^|\/)fixtures\/|^console\/prototype\/|^pm\/|^docs\/|^autopilot\/|^zoho\/sandbox\//.test(f);

test('TC-E15-011 scanner: the secret patterns match a sample of each shape (so a clean repo means something)', () => {
  /* synthetic samples only — never-live values, one per shape */
  const sample = { 'zoho-token': '1000.' + 'a'.repeat(32) + '.' + 'b'.repeat(32), 'private-key': /* synthetic */ '-----BEGIN RSA PRIVATE KEY-----', 'aws-key': 'AKIA' + 'A'.repeat(16),
    'slack-token': /* synthetic */ 'xoxb-1234567890-abcdef', 'vcs-token': 'ghp_' + 'a'.repeat(36), 'api-key': 'sk-' + 'a'.repeat(40), 'literal-secret': `client_secret: "${'a'.repeat(40)}"` };
  for (const [name, re] of SECRETS) assert.match(sample[name], re, name);
  assert.match('ABCPE1234F', PAN);
});

test('TC-E15-011 repo: no secret shape anywhere; a secret-shaped value in a test or fixture is marked synthetic; no PAN-shaped value outside tests and fixtures', () => {
  const files = tracked();
  assert.ok(files.length > 500, `${files.length} tracked text files scanned`);
  const found = [];
  for (const f of files) {
    let text; try { text = fs.readFileSync(path.join(repoRoot, f), 'utf8'); } catch { continue; }
    for (const [name, re] of SECRETS) {
      const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
      for (const m of text.matchAll(g)) {
        const synthetic = MAY_HOLD_SYNTHETIC(f) && /synthetic|aaaabbbb|example|placeholder|dummy|fixture|never-live|\$\{|process\.env|<[a-z-]+>/i.test(m[0] + text.slice(Math.max(0, m.index - 60), m.index));
        if (!synthetic) found.push(`${f}: ${name}`);        /* the value itself is never printed */
      }
    }
    if (!MAY_HOLD_SYNTHETIC(f) && PAN.test(text)) found.push(`${f}: pan-shaped value`);
  }
  assert.deepEqual(found, [], 'secrets or identity values in the repo');
});

test('TC-E15-011 bundle: the built client bundle names no server secret, key or refresh token', (t) => {
  const dir = ['.next-local/static', '.next/static'].map((d) => path.join(consoleRoot, d)).find((d) => fs.existsSync(d));
  if (!dir) return t.skip('no build on this machine (npm run build / build:local first)');
  const names = ['ZOHO_OAUTH_CLIENT_SECRET', 'ZOHO_SESSION_KEY', 'CONTRACT_SIGNING_KEY', 'RECEIPT_IDEMPOTENCY_SECRET', 'RECEIPT_CONTEXT_SIGNING_SECRET', 'FOLLOWUP_UNDO_SECRET',
    'ZOHO_SIGN_WEBHOOK_SECRET', '_REFRESH_TOKEN', 'client_secret', 'refresh_token'];
  const hits = []; let scanned = 0;
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!/\.(js|css|html|json|map)$/.test(e.name)) continue;
      const s = fs.readFileSync(p, 'utf8'); scanned++;
      for (const n of names) if (s.includes(n)) hits.push(`${path.relative(consoleRoot, p)}: ${n}`);
      for (const [name, re] of SECRETS) if (re.test(s)) hits.push(`${path.relative(consoleRoot, p)}: ${name}`);
    }
  })(dir);
  assert.ok(scanned > 5, `${scanned} bundle files scanned`);
  assert.deepEqual(hits, []);
});

test('TC-E15-011 headers: every response the config serves carries CSP with frame-ancestors, HSTS, X-Frame-Options, nosniff, referrer and permissions policy; a page script has no unsafe-inline', async () => {
  const m = await import(path.join(consoleRoot, 'security-headers.mjs'));
  const served = new Map(m.nextHeaderRules().flatMap((r) => r.headers.map((h) => [`${r.source} ${h.key.toLowerCase()}`, h.value])));
  for (const h of m.SECURITY_HEADERS) assert.ok(served.get(`/:path* ${h.key.toLowerCase()}`), `${h.key} on every path`);
  assert.match(served.get('/:path* strict-transport-security'), /^max-age=\d{7,}/);
  assert.equal(served.get('/:path* x-frame-options'), 'DENY');
  assert.match(served.get('/api/:path* content-security-policy'), /frame-ancestors 'none'/);
  const page = m.pageCsp('abcdefghijklmnopqrstuvwx');
  assert.match(page, /frame-ancestors 'none'/);
  assert.match(page, /object-src 'none'/);
  const script = page.split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src '));
  assert.ok(!script.includes('unsafe-inline') && !script.includes('unsafe-eval'), script);
});

test('TC-E15-011 cookies: the session cookie is httpOnly and SameSite=Lax, and Secure whenever the console is served over https', () => {
  const { cookieBase } = H.load('server/oauth/runtime.ts');
  const live = cookieBase({ ZOHO_OAUTH_REDIRECT_URI: 'https://console.example.invalid/api/auth/zoho/callback' });
  assert.deepEqual([live.httpOnly, live.sameSite, live.secure, live.path], [true, 'lax', true, '/']);
  assert.equal(cookieBase({ ZOHO_OAUTH_REDIRECT_URI: 'http://localhost:3001/api/auth/zoho/callback' }).secure, false, 'only localhost development drops Secure');
  /* every cookie a route sets is either on cookieBase() or one of the two demo-session writes, which cannot run in a live build */
  const apiDir = path.join(consoleRoot, 'src', 'app', 'api');
  const plain = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (e.name !== 'route.ts') continue;
      const src = fs.readFileSync(p, 'utf8');
      for (const line of src.split('\n')) {
        if (!/\bjar\.set\(/.test(line) || line.includes('cookieBase()')) continue;
        const via = /,\s*(\w+)\)\s*;/.exec(line);                                  /* jar.set(NAME, value, opts) with opts built from cookieBase() */
        if (via && new RegExp(`const ${via[1]} = \\{\\s*\\.\\.\\.cookieBase\\(\\)`).test(src)) continue;
        assert.match(line, /httpOnly:\s*true/, `${path.relative(consoleRoot, p)}: a cookie without httpOnly`);
        assert.match(line, /sameSite:\s*"(lax|strict)"/, `${path.relative(consoleRoot, p)}: a cookie without SameSite`);
        plain.push(`${path.relative(apiDir, p)} ${/jar\.set\((\w+)/.exec(line)[1]}`);
      }
    }
  })(apiDir);
  assert.deepEqual(plain.sort(), ['auth/zoho/route.ts SESSION_COOKIE', 'session/route.ts SESSION_COOKIE'],
    'a new cookie that skips cookieBase() must be added here on purpose; SESSION_COOKIE (gz_session) is the demo person key, written only when Zoho sign-in is off or in fixture mode');
});

test('TC-E15-011 admin: no administrator token is read or configured', () => {
  const envNames = new Set();
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!/node_modules|__fixtures__/.test(e.name)) walk(p); continue; }
      if (!/\.(ts|tsx)$/.test(e.name) || /\.test\./.test(e.name)) continue;
      for (const m of fs.readFileSync(p, 'utf8').matchAll(/\benv\.([A-Z][A-Z0-9_]{3,})/g)) envNames.add(m[1]);
    }
  })(path.join(consoleRoot, 'src'));
  assert.ok(envNames.has('ZOHO_OAUTH_CLIENT_SECRET') && envNames.size > 20, `${envNames.size} environment names read`);
  const adminToken = (n) => /ADMIN/.test(n) && /(TOKEN|SECRET|KEY|REFRESH|PASSWORD)/.test(n);
  assert.deepEqual([...envNames].filter(adminToken), []);
  const example = fs.readFileSync(path.join(repoRoot, 'ops', 'env', '.env.example'), 'utf8');
  const set = [...example.matchAll(/^\s*#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]);
  assert.ok(set.length > 5, `${set.length} names in the .env example`);
  assert.deepEqual(set.filter(adminToken), []);
});
