#!/usr/bin/env node
// M18-S02-T02 — ROUTE × ROLE LEAK MATRIX. Calls every console API route (discovered from src/app/api,
// less test hooks, the sign-in redirects, signed webhooks and the error beacon) as the restricted test
// user in each role, and fails if any returned Zoho id is outside that role's scope, if an id from
// another role's scope is answered 2xx, if a 2xx is cacheable (no `no-store`/`private`), if the
// optional cache-scope header does not carry the role's scope key, or if an unmasked PAN, Aadhaar or
// UTR appears for a role without reveal. Every route is called twice per role, the second pass in
// reverse role order right after another role warmed the server's cache, so a cache shared across
// scopes shows up as foreign ids. It can only be proven on staging (M02-S10 sandbox + seeded users).
//
// Usage: node console/scripts/leak-matrix.mjs [--config file] [--base-url url] [--out file] [--probe-writes] [--dry-run]
//   --probe-writes  also POST/PUT/PATCH/DELETE with an EMPTY body against out-of-scope ids only (must be refused)
//   --dry-run       print the planned calls and exit; no network
// Exit: 0 all pass · 1 a leak or refusal failure · 2 configuration problem.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { discoverRoutes, judge, planCalls, cookieFromStorageState } = require('./leak-matrix.lib.cjs');
const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const flag = (n) => args.includes(n);
const die = (m) => { console.error('leak-matrix: ' + m); process.exit(2); };
const home = (p) => (p && p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p);

const cfgPath = path.resolve(opt('--config') || process.env.LEAK_MATRIX_CONFIG || path.join(here, 'leak-matrix.config.json'));
if (!fs.existsSync(cfgPath)) die(`no config at ${cfgPath} (copy leak-matrix.config.example.json)`);
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const baseUrl = opt('--base-url') || process.env.STAGING_URL || cfg.baseUrl;
if (!baseUrl || /example\.invalid/.test(baseUrl)) die('set baseUrl (or STAGING_URL) to the staging deployment');
const u = new URL(baseUrl);
if (u.port === '3001') die('port 3001 is the front-end loop\'s; point at staging');
const roles = cfg.roles || {};
if (!Object.keys(roles).length) die('config has no roles');
const sessionsDir = home(cfg.sessionsDir || '~/.growize-jev/sessions');

const cookies = {};
for (const [name, r] of Object.entries(roles)) {
  if (!r.scope || !Array.isArray(r.scope.ids)) die(`role ${name}: scope.ids is required (may be empty only for a role that reads no records)`);
  if (r.cookie) cookies[name] = r.cookie;
  else if (r.storageState) {
    const p = path.resolve(sessionsDir, home(r.storageState));
    if (!flag('--dry-run') && !fs.existsSync(p)) die(`role ${name}: no saved session at ${p} (run jev-sessions.mjs as the restricted user in this role)`);
    cookies[name] = fs.existsSync(p) ? cookieFromStorageState(JSON.parse(fs.readFileSync(p, 'utf8')), baseUrl) : '';
  } else die(`role ${name}: give storageState or cookie`);
}

const routes = discoverRoutes(path.resolve(here, '..', 'src', 'app', 'api'));
const planned = planCalls(routes, roles, { probeWrites: flag('--probe-writes') });
const order = [...planned, ...[...planned].reverse().map((c) => ({ ...c, probe: c.probe === 'in-scope' ? 'cache-recheck' : c.probe }))];
if (flag('--dry-run')) {
  console.log(JSON.stringify({ routes, calls: order.map(({ role, method, path: p, probe }) => ({ role, method, path: p, probe })) }, null, 1));
  process.exit(0);
}

async function call(c) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), cfg.timeoutMs || 20000);
  try {
    const init = { method: c.method, headers: { cookie: cookies[c.role], accept: 'application/json' }, redirect: 'manual', signal: ctl.signal };
    if (c.method !== 'GET') { init.headers['content-type'] = 'application/json'; init.body = '{}'; }
    const res = await fetch(new URL(c.path, baseUrl), init);
    const text = await res.text();
    let body; try { body = text ? JSON.parse(text) : undefined; } catch { body = undefined; }
    const headers = Object.fromEntries([...res.headers.entries()].map(([k, v]) => [k.toLowerCase(), v]));
    return judge({ role: c.role, scope: roles[c.role].scope, route: c.template, method: c.method, probe: c.probe, status: res.status, headers, body, text,
      ignoreKeys: cfg.ignoreKeys || [], cacheScopeHeader: cfg.cacheScopeHeader || null });
  } catch (e) {
    return { role: c.role, route: c.template, method: c.method, probe: c.probe, status: null, ok: false, failures: [{ rule: 'no-answer', error: String(e && e.name) }] };
  } finally { clearTimeout(t); }
}

const results = [];
for (const c of order) results.push(await call(c)); // sequential on purpose: the cache-recheck depends on order
const failed = results.filter((r) => !r.ok);
const summary = { baseUrl: u.origin, at: new Date().toISOString(), roles: Object.keys(roles), routes: routes.filter((r) => !r.excluded).map((r) => r.template), calls: results.length, failed: failed.length };
const out = opt('--out');
if (out) fs.writeFileSync(path.resolve(out), JSON.stringify({ summary, results }, null, 1));
for (const r of failed) console.log(`FAIL ${r.role.padEnd(12)} ${r.method} ${r.route} [${r.probe}] ${r.status} ${r.failures.map((f) => f.rule).join(',')}`);
console.log(`${results.length} calls · ${failed.length} failed · ${summary.routes.length} routes × ${summary.roles.length} roles`);
process.exit(failed.length ? 1 : 0);
