/* Pure helpers for the smoke suite (M19-S07): header checks, argument parsing, the read-only guard, result summary.
   No I/O. Used by smoke.mjs; tests in smoke.test.cjs. */
'use strict';

/* The names a response must carry. Kept in step with security-headers.mjs by smoke.test.cjs (which imports both). */
const REQUIRED_HEADERS = ['content-security-policy', 'strict-transport-security', 'x-frame-options', 'x-content-type-options', 'referrer-policy', 'permissions-policy'];

/* Names missing from a headers object (any casing) or a Headers instance. */
function missingHeaders(headers, required = REQUIRED_HEADERS) {
  const have = new Set(); const names = typeof headers.keys === 'function' ? [...headers.keys()] : Object.keys(headers || {});
  for (const n of names) have.add(String(n).toLowerCase());
  return required.filter(n => !have.has(n));
}

/* A page's CSP must not allow inline or eval scripts (M18-S15-H1). Returns a problem string or ''. */
function cspProblem(csp) {
  const script = String(csp || '').split(';').map(x => x.trim()).find(x => x.startsWith('script-src ')) || '';
  if (!script) return 'no script-src';
  if (/'unsafe-inline'|'unsafe-eval'|\s\*(\s|$)/.test(script)) return 'script-src allows inline, eval or a wildcard: ' + script;
  return '';
}

/* node smoke.mjs <url> [--mode deploy|production] [--out f.json] [--jev] [--budget-s 180]
   [--ir "Rohit Deshpande"] [--inv "Meena Raghavan"] [--storage-ir f] [--storage-inv f] [--alert-webhook url] [--json] */
function parseArgs(argv, env = process.env) {
  const o = { url: '', mode: 'deploy', out: '', jev: false, budgetS: 180, ir: 'Rohit Deshpande', inv: 'Meena Raghavan', storageIr: '', storageInv: '', alertWebhook: env.SMOKE_ALERT_WEBHOOK || '', json: false, errors: [] };
  const a = [...argv]; const val = k => { const v = a[++i]; if (v === undefined || v.startsWith('--')) { o.errors.push(k + ' needs a value'); i--; return ''; } return v; }; let i = -1;
  while (++i < a.length) {
    const k = a[i];
    if (k === '--mode') o.mode = val(k); else if (k === '--out') o.out = val(k); else if (k === '--budget-s') o.budgetS = +val(k);
    else if (k === '--ir') o.ir = val(k); else if (k === '--inv') o.inv = val(k);
    else if (k === '--storage-ir') o.storageIr = val(k); else if (k === '--storage-inv') o.storageInv = val(k);
    else if (k === '--alert-webhook') o.alertWebhook = val(k);
    else if (k === '--production') o.mode = 'production'; else if (k === '--jev') o.jev = true; else if (k === '--json') o.json = true;
    else if (k.startsWith('--')) o.errors.push('unknown option ' + k);
    else if (!o.url) o.url = k; else o.errors.push('unexpected argument ' + k);
  }
  if (!o.url) o.errors.push('a URL is required');
  else { try { const u = new URL(o.url); if (!/^https?:$/.test(u.protocol)) o.errors.push('URL must be http(s)'); } catch { o.errors.push('not a URL: ' + o.url); } }
  if (!['deploy', 'production'].includes(o.mode)) o.errors.push('--mode must be deploy or production');
  if (!(o.budgetS > 0)) o.errors.push('--budget-s must be a positive number');
  if (o.mode === 'production' && o.jev) o.errors.push('--jev writes a note on a test lead; it is not allowed in production mode');
  return o;
}

/* The read-only guard for production mode: only these methods may leave the browser or the checker. */
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const isRead = method => READ_METHODS.has(String(method).toUpperCase());

/* results: [{ name, ok, ms, detail, skipped }] → one line and the exit code (0 all pass, 1 any failure). */
function summarise(results, { mode = 'deploy', budgetS = 180, elapsedMs = 0 } = {}) {
  const failed = results.filter(r => !r.ok && !r.skipped), skipped = results.filter(r => r.skipped);
  const over = elapsedMs > budgetS * 1000;
  const ok = !failed.length && !over;
  return { ok, code: ok ? 0 : 1, failed, over, line: `smoke (${mode}): ${results.length - failed.length - skipped.length}/${results.length - skipped.length} pass${skipped.length ? ` · ${skipped.length} skipped` : ''} · ${(elapsedMs / 1000).toFixed(1)} s` + (over ? ` · OVER the ${budgetS} s budget` : '') };
}

module.exports = { REQUIRED_HEADERS, missingHeaders, cspProblem, parseArgs, isRead, summarise };
