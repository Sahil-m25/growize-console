/* M18-S14 — what every answer at the door is held to (used by the refusals and leak suites). */
'use strict';
const L = require('../../../../scripts/leak-matrix.lib.cjs');

const ID = '554023000000527003';
const SHORT_CODE = /^[a-z][a-z0-9_-]{0,39}$/i;

/* What must never appear in any body: a stack, a file path, a Zoho error body, a runtime's own error text. */
const LEAKS = [
  ['stack-trace', /\n\s+at\s+\S+.*(:\d+:\d+|\(<anonymous>\)|\(node:)/],
  ['stack-trace', /\bat\s+(?:async\s+)?[\w$.<>]+\s+\((?:\/|file:|node:|[A-Za-z]:\\)/],
  ['file-path', /(?:\/home\/|\/Users\/|\/usr\/|\/var\/|\/tmp\/|node_modules|\.next\/|[A-Za-z]:\\\\|src\/(?:server|lib|app)\/)/],
  ['source-file', /\b[\w-]+\.(?:ts|tsx|cjs|mjs)(?::\d+)?\b/],
  ['zoho-error-body', /ZOHO_CANARY|NO_PERMISSION|INVALID_DATA|MANDATORY_NOT_FOUND|"api_name"|"details"\s*:|zohoapis\.|accounts\.zoho\./i],
  ['runtime-error-text', /\b(?:TypeError|ReferenceError|SyntaxError|RangeError|ZohoRouteError)\b|Unexpected token|is not a function|Cannot read propert|is not defined|JSON\.parse|ECONNREFUSED|ENOENT/],
];

/** Every leak in a response (status text, headers, body): [{rule}] — empty is clean. */
function leaks(res) {
  const hay = res.text + '\n' + Object.entries(res.headers || {}).map(([k, v]) => `${k}: ${v}`).join('\n');
  const out = [];
  for (const [rule, re] of LEAKS) { const m = re.exec(hay); if (m && !out.some((x) => x.rule === rule)) out.push({ rule, sample: m[0].slice(0, 40) }); }
  return out;
}

/** A refusal body names no record, field or count: no Zoho-shaped id, no email, no number, no list. */
function refusalNamesNothing(json) {
  const bad = [];
  (function walk(v, p) {
    if (Array.isArray(v)) bad.push(`${p} is a list`);
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${p}.${k}`);
    else if (typeof v === 'number') bad.push(`${p} is a number`);
    else if (typeof v === 'string' && (/\d{9,}/.test(v) || /@[\w-]+\.\w+/.test(v))) bad.push(`${p} carries an id or an email`);
  })(json, '$');
  return bad;
}

/* The refusal envelope the door answers with today (server/access/guard-core refusalResponse). */
const ENVELOPE = new Set(['error', 'code', 'landing', 'session', 'signedOut']);
const GUARD_CODES = new Set(['signed-out', 'no-seat', 'no-grant', 'page', 'not-configured']);

module.exports = { ID, SHORT_CODE, leaks, refusalNamesNothing, ENVELOPE, GUARD_CODES, L };
