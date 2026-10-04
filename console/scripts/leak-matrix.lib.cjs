/* M18-S02-T02 — pure parts of the route × role leak matrix (scripts/leak-matrix.mjs). No network here.
 * Tested by scripts/leak-matrix.test.cjs. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const ZOHO_ID = /^\d{15,22}$/;
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
/* Routes the matrix never calls: test hooks (fixture mode only), the sign-in redirect dance, signed
   external webhooks and the error beacon (writes Plane B only, returns no record). */
const EXCLUDED = [/^\/api\/test(\/|$)/, /^\/api\/auth(\/|$)/, /^\/api\/webhooks(\/|$)/, /^\/api\/errors$/];

/** Every console API route under src/app/api: its template, dynamic params and exported methods. */
function discoverRoutes(apiDir) {
  const out = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === 'route.ts' || e.name === 'route.js') {
        const rel = path.relative(apiDir, path.dirname(p)).split(path.sep).filter(Boolean);
        const template = '/api' + (rel.length ? '/' + rel.join('/') : '');
        const src = fs.readFileSync(p, 'utf8');
        const methods = METHODS.filter((m) => new RegExp(`export\\s+(?:async\\s+)?(?:function|const)\\s+${m}\\b`).test(src));
        const params = rel.filter((s) => /^\[.+\]$/.test(s)).map((s) => s.slice(1, -1));
        out.push({ template, methods, params, excluded: EXCLUDED.some((re) => re.test(template)) });
      }
    }
  })(apiDir);
  return out.sort((a, b) => a.template.localeCompare(b.template));
}

/** Every Zoho-shaped id in a JSON value, with the key path it sat under. Keys in `ignoreKeys` are skipped. */
function collectIds(value, ignoreKeys = [], at = '$', out = []) {
  const ignore = new Set(ignoreKeys);
  (function walk(v, p, key) {
    if (key !== null && ignore.has(key)) return;
    if (typeof v === 'string' && ZOHO_ID.test(v)) out.push({ id: v, path: p });
    else if (typeof v === 'number' && Number.isInteger(v) && ZOHO_ID.test(String(v))) out.push({ id: String(v), path: p });
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${p}[${i}]`, key));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${p}.${k}`, k);
  })(value, at, null);
  return out;
}

/* Unmasked identity values in a response a role should see only masked (D13, M18-S02: last 4 until a logged reveal). */
const UNMASKED = [
  ['pan', /(?<![A-Za-z0-9])[A-Z]{5}[0-9]{4}[A-Z](?![A-Za-z0-9])/],
  ['aadhaar', /(?<![0-9])[2-9][0-9]{3}[ -]?[0-9]{4}[ -]?[0-9]{4}(?![0-9])/],
  ['utr', /(?<![A-Za-z0-9])[A-Z]{4}[A-Z0-9][0-9]{10,}(?![A-Za-z0-9])/],
];
function unmaskedIdentity(text) {
  const hits = [];
  for (const [kind, re] of UNMASKED) { const m = re.exec(text); if (m) hits.push({ kind, sample: m[0].slice(0, 2) + '…' + m[0].slice(-2) }); }
  return hits;
}


/* ---- M18-S14-H3: the masked-field list by NAME as well as by value shape ------------------------------------ */
/* Field names that never carry their full value in any GET answer, for any seat (D13: a reveal is a second, logged
   call behind step-up; every read shows last four at most). `masked` = only X * • . - and up to four trailing chars. */
const MASKED_NAMES = Object.freeze({
  pan: /^(pan|pan_?number|pan_?no)$/i,
  bank_account: /^(bank_?account(_?number)?|account_?number|acct|acct_?no)$/i,
  Aadhaar_Number: /^(aadhaar(_?number)?|aadhar(_?number)?)$/i,
  utr: /^(utr|payout_?utr|bank_?ref(erence)?_?no)$/i,
  dob: /^(dob|date_?of_?birth|birth_?date)$/i,
});
/* Every mask the console emits (lib/zoho/identity maskPan/maskLast4, lib/im/selectors maskPan/maskAcct/maskRefTail, lib/format maskRef):
   'AFT•••••L' (PAN: first 3 + last 1), '•••• •••• 1208' (account/Aadhaar), '••• 8119' (reference), '••••', '—' (empty), and the
   legacy 'XXXXXX234F'. Shape: at most 3 leading characters, a run of 3+ mask characters, at most 4 trailing. The owner has not ruled
   on the PAN mask, so 3+1 and last-four are both accepted. A value with 4+ leading characters, a short mask run or 5+ trailing
   characters is not masked ('ABCDE1234F', 'ABCDE•••1234F'). */
const MASK_SHAPES = [
  new RegExp(`^[X*•·.\\- ]{2,}[A-Za-z0-9]{0,4}$`),
  new RegExp(`^[A-Za-z0-9]{1,3}[X*•·.\\- ]{3,}[A-Za-z0-9]{0,4}$`),
];
const looksMasked = (v) => typeof v === 'string' && (v.trim() === '—' || MASK_SHAPES.some((re) => re.test(v.trim())));

/** Every masked-by-name field in a JSON body whose value is present and not masked, with its path. Also value shapes of the text. */
function maskedFindings(body, text) {
  const hits = [];
  (function walk(v, p) {
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${p}[${i}]`));
    else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        const kind = Object.keys(MASKED_NAMES).find((n) => MASKED_NAMES[n].test(k));
        if (kind && x !== null && x !== '' && x !== undefined && typeof x !== 'object' && !looksMasked(String(x))) hits.push({ kind, path: `${p}.${k}` });
        else walk(x, `${p}.${k}`);
      }
    }
  })(body, '$');
  if (typeof text === 'string') for (const h of unmaskedIdentity(text)) if (!hits.some((x) => x.kind === h.kind)) hits.push({ kind: h.kind, path: 'text' });
  return hits;
}

const cacheHeaderOk = (headers) => /no-store|private/i.test(headers['cache-control'] || '');

/**
 * The verdict on one response. `probe` is "in-scope" (the role's own id or no id), "out-of-scope" (an
 * id from another role's scope that this role must not reach) or "cache-recheck".
 */
function judge({ role, scope, route, method, probe, status, headers, body, text, ignoreKeys = [], cacheScopeHeader = null }) {
  const failures = [];
  const allow = new Set([...(scope.ids || []), ...(scope.userIds || [])]);
  const ids = body === undefined ? [] : collectIds(body, ignoreKeys);
  const outside = ids.filter((x) => !allow.has(x.id));
  if (outside.length) failures.push({ rule: 'id-outside-scope', count: outside.length, sample: outside.slice(0, 5) });
  if (probe === 'out-of-scope') {
    if (status >= 200 && status < 300) failures.push({ rule: 'out-of-scope-answered', status });
  }
  if (status >= 200 && status < 300 && !cacheHeaderOk(headers)) failures.push({ rule: 'cacheable-response', cacheControl: headers['cache-control'] || null });
  if (cacheScopeHeader && status >= 200 && status < 300) {
    const v = headers[cacheScopeHeader.toLowerCase()];
    if (!v || !scope.scopeKey || !v.includes(scope.scopeKey)) failures.push({ rule: 'cache-key-missing-scope', header: v || null });
  }
  if (!scope.revealAllowed && typeof text === 'string') {
    const hits = unmaskedIdentity(text);
    if (hits.length) failures.push({ rule: 'unmasked-identity', hits });
  }
  return { role, route, method, probe, status, idsReturned: ids.length, ok: failures.length === 0, failures };
}

/** The calls to make: every non-excluded route × method × role, dynamic params filled in and out of scope. */
function planCalls(routes, roles, { probeWrites = false } = {}) {
  const calls = [];
  const names = Object.keys(roles);
  for (const r of routes.filter((x) => !x.excluded)) {
    for (const method of r.methods) {
      const write = method !== 'GET';
      for (const role of names) {
        const scope = roles[role].scope || {};
        const others = names.filter((n) => n !== role).flatMap((n) => (roles[n].scope && roles[n].scope.ids) || []).filter((id) => !(scope.ids || []).includes(id));
        if (!r.params.length) {
          if (!write) calls.push({ role, method, template: r.template, path: r.template, probe: 'in-scope' });
          else if (probeWrites) calls.push({ role, method, template: r.template, path: r.template, probe: 'write-empty-body' });
          continue;
        }
        const fill = (id) => r.template.replace(/\[[^\]]+\]/g, encodeURIComponent(id));
        const mine = (scope.ids || [])[0];
        if (mine && !write) calls.push({ role, method, template: r.template, path: fill(mine), probe: 'in-scope' });
        const foreign = others[0];
        if (foreign && (!write || probeWrites)) calls.push({ role, method, template: r.template, path: fill(foreign), probe: 'out-of-scope' });
      }
    }
  }
  return calls;
}

/** Cookie header from a Playwright storageState file (jev-sessions.mjs) for the base URL's host. */
function cookieFromStorageState(state, baseUrl) {
  const host = new URL(baseUrl).hostname;
  const cookies = (state && state.cookies) || [];
  return cookies
    .filter((c) => { const d = String(c.domain || '').replace(/^\./, ''); return host === d || host.endsWith('.' + d); })
    .map((c) => `${c.name}=${c.value}`).join('; ');
}

module.exports = { looksMasked, MASKED_NAMES, maskedFindings, discoverRoutes, collectIds, unmaskedIdentity, judge, planCalls, cookieFromStorageState, cacheHeaderOk, EXCLUDED, ZOHO_ID };
