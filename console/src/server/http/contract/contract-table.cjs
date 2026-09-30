/* M18-S14-H1 — the API contract table: one row per route × method.
 *
 *   GENERATED (from src/app/api and the capability tables, every run):
 *     route, methods (scripts/leak-matrix.lib.cjs discoverRoutes), the guard rule each handler names
 *     (`guardApi("<route>")` → server/access/guard-core API_ROUTES) and from it the SEATS ALLOWED: the console seats
 *     whose page reach (seatPresets, built from SEATCAPS through navFor) holds the rule's page, or every admitted seat
 *     for a `session` rule.
 *   HAND-KEPT (contract-table.json — the part a route author must add): the body schema (type, required fields,
 *     where the schema is written), extra masked names for that route's answer, and, for a GET the suite cannot get a
 *     body out of without Zoho, the reason ("needs sandbox").
 *
 * The suite (api-contract-table.test.cjs) FAILS naming any route or method that discovery finds and the JSON lacks,
 * and any JSON row for a route that no longer exists. Print the table:  node src/server/http/contract/contract-table.cjs
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const L = require('../../../../scripts/leak-matrix.lib.cjs');

const consoleRoot = path.resolve(__dirname, '..', '..', '..', '..');
const apiDir = path.join(consoleRoot, 'src', 'app', 'api');
const TABLE_FILE = path.join(__dirname, 'contract-table.json');

/** The masked-field list every answer is held to (leak matrix M18-S02 + D13/D52): value shapes in L.unmaskedIdentity, names in L.maskedFindings. */
const MASKED = L.MASKED_NAMES;

/** Routes with no session behind them by design (guard rule `open`, or no guard at all): still in the table, not in the 401 rule. */
const OPEN = (rule) => !rule || rule.kind === 'open';

function guardedAs(file) {
  const src = fs.readFileSync(file, 'utf8');
  const m = /guardApi\(\s*"([^"]+)"/.exec(src);
  return m ? m[1] : null;
}

/** Generated part: every non-excluded route with its methods, guard string, guard rule and allowed seats. */
function generate({ ts } = {}) {
  const core = require(path.join(consoleRoot, 'src', 'server', 'access', 'guard-core.ts'));
  const { CONSOLE_SEAT } = require(path.join(consoleRoot, 'src', 'server', 'oauth', 'user-session.ts'));
  const presets = core.seatPresets();
  const tokenOf = Object.entries(CONSOLE_SEAT).filter(([, t]) => t !== null);
  const admitted = tokenOf.filter(([z]) => presets[z] && presets[z].admitted).map(([, t]) => t);
  const rows = [];
  for (const r of L.discoverRoutes(apiDir)) {
    const file = path.join(apiDir, r.template.replace(/^\/api\//, ''), 'route.ts');
    const guard = fs.existsSync(file) ? guardedAs(file) : null;
    const hit = core.apiRuleOf(guard || r.template);
    const rule = hit ? hit.rule : null;
    let seats;
    if (r.excluded) seats = null;
    else if (OPEN(rule)) seats = '*';
    else if (rule.kind === 'session') seats = admitted.slice();
    else seats = tokenOf.filter(([z]) => presets[z] && presets[z].pages.includes(rule.page)).map(([, t]) => t);
    rows.push({ route: r.template, methods: r.methods, params: r.params, excluded: r.excluded, guard, guarded: guard !== null, rule, seats });
  }
  return rows;
}

/** What is wrong with the table, by name: a route (or method) discovery finds that the JSON lacks, a row for a route that is gone,
 *  a write with no body schema, a route neither wrapped by guardApi nor named `open`. [] = the table is complete. */
function problems(rows, kept) {
  const out = []; const have = (kept && kept.routes) || {};
  const live = rows.filter((r) => !r.excluded);
  for (const r of live) {
    const row = have[r.route];
    if (!row) { out.push(`route missing from the contract table: ${r.route} (${r.methods.join(',')})`); continue; }
    for (const m of r.methods) {
      if (!row[m]) out.push(`method missing from the contract table: ${m} ${r.route}`);
      else if (m !== 'GET' && !row[m].body) out.push(`no body schema for ${m} ${r.route}`);
    }
    for (const m of Object.keys(row)) if (!r.methods.includes(m)) out.push(`contract table lists ${m} ${r.route}, the route does not export it`);
    if (!r.guarded && !(r.rule && r.rule.kind === 'open')) out.push(`route is neither wrapped by guardApi nor named open in API_ROUTES: ${r.route}`);
  }
  const liveSet = new Set(live.map((r) => r.route));
  for (const k of Object.keys(have)) if (!liveSet.has(k)) out.push(`contract table has a row for a route that does not exist (or is excluded): ${k}`);
  return out;
}

const read = () => JSON.parse(fs.readFileSync(TABLE_FILE, 'utf8'));

/** The joined table the suites iterate: generated rows + the hand-kept spec for each method. */
function table() {
  const kept = read();
  return generate().map((g) => ({ ...g, spec: (kept.routes || {})[g.route] || null }));
}

module.exports = { table, generate, problems, read, MASKED, TABLE_FILE, apiDir };

if (require.main === module) {
  require('../contract/harness.cjs');
  const t = table().filter((r) => !r.excluded);
  const pad = (s, n) => String(s).padEnd(n);
  console.log(pad('route', 40), pad('methods', 20), pad('guard', 22), 'seats');
  for (const r of t) console.log(pad(r.route, 40), pad(r.methods.join(','), 20), pad(r.rule ? (r.rule.kind === 'page' ? 'page:' + r.rule.page : r.rule.kind) : 'none', 22), r.seats === '*' ? '*' : r.seats.join(','));
}
