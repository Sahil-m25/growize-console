/* Shared, pure helpers for the Jev staging runner (M19-S02). No I/O except loadConfig/readJson.
   T01 seat -> storageState path · T02 fixture -> staging seed id, preflight refusal · T03 results -> CSV rows.
   Used by jev-sessions.mjs, jev-staging-seed.mjs, jev-staging-run.mjs, jev-results-csv.mjs. Tests: jev-lib.test.cjs. */
'use strict';
const fs = require('node:fs'); const path = require('node:path'); const os = require('node:os');

const readJson = (f, dflt) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { if (dflt !== undefined) return dflt; throw e; } };
const expandHome = p => (p && p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p);

/* Config: JEV_STAGING_CONFIG or console/scripts/jev-staging.config.json (see jev-staging.config.example.json).
   STAGING_URL overrides baseUrl; JEV_SESSIONS_DIR overrides sessionsDir. */
function loadConfig(file = process.env.JEV_STAGING_CONFIG || path.join(__dirname, 'jev-staging.config.json'), env = process.env) {
  const c = readJson(file, {});
  const cfgDir = path.dirname(path.resolve(file));
  const cfg = { baseUrl: env.STAGING_URL || c.baseUrl || '', lane: c.lane || '', seats: c.seats || {}, seeds: c.seeds || {},
    sessionsDir: path.resolve(cfgDir, expandHome(env.JEV_SESSIONS_DIR || c.sessionsDir || '~/.growize-jev/sessions')),
    signIn: { startPath: '/api/auth/zoho', timeoutMs: 300000, ...(c.signIn || {}) } };
  if (cfg.baseUrl) { const u = new URL(cfg.baseUrl); if (!cfg.lane) cfg.lane = u.searchParams.get('lane') || ''; }
  return cfg;
}

/* T01: where a seat's saved Playwright session lives. A seat entry may name its own file (absolute or relative to sessionsDir). */
function sessionPath(cfg, seat) {
  if (!seat || seat === 'none') return null;
  const s = cfg.seats[seat]; const f = (s && s.storageState) || seat + '.json';
  return path.resolve(cfg.sessionsDir, expandHome(f));
}
/* The runner (read-only) looks for SESSIONS_DIR/<seat>.json. Map each seat the cases use to its configured file. */
function sessionLinks(cfg, seats) {
  const links = [], missing = [];
  for (const seat of [...new Set(seats)].filter(s => s && s !== 'none')) {
    const p = sessionPath(cfg, seat);
    (fs.existsSync(p) ? links : missing).push({ seat, path: p });
  }
  return { links, missing };
}

/* T02: fixtures file entries may carry `seeded` (the staging seed id); config.seeds overrides per fixture.
   Investors-side fixtures are filed as "IM:<NAME>" and cited bare (same rule as the runner). */
function fixtureEntry(fix, name) { return fix[name] || fix['IM:' + name] || null; }
function seedFor(fix, name, seeds = {}) {
  if (Object.prototype.hasOwnProperty.call(seeds, name)) return seeds[name] || null;
  const e = fixtureEntry(fix, name); return (e && e.seeded) || null;
}
const noSeedMessage = name => `fixture ${name} has no staging seed yet`;
/* Cases whose fixtures all have a seed run; the rest are refused before any step (acceptance 3, TC-E16-004). */
function preflight(cases, fix, seeds = {}) {
  const runnable = [], refused = [];
  for (const c of cases) {
    const unknown = (c.fixtures || []).filter(f => !fixtureEntry(fix, f) && !Object.prototype.hasOwnProperty.call(seeds, f));
    const unseeded = (c.fixtures || []).filter(f => !unknown.includes(f) && !seedFor(fix, f, seeds));
    if (unknown.length || unseeded.length) refused.push({ id: c.id, story: c.story, title: c.title, verdict: 'FAIL',
      runError: [...unknown.map(f => 'unknown fixture ' + f), ...unseeded.map(noSeedMessage)].join('; '), trace: [], errors: [], refused: true });
    else runnable.push(c);
  }
  return { runnable, refused };
}

/* T03: one CSV row per result. failing_facts = facts under PASS_AT, "0.03 <fact>" one per line (the workbook's
   "Facts below 0.80" format); trace = "step → pressed@p" joined by " | ". */
const stripAnsi = s => String(s).replace(/\u001b\[[0-9;]*m/g, '');
const CSV_COLUMNS = ['id', 'story', 'verdict', 'p', 'failing_facts', 'trace', 'run_date', 'run_error'];
function resultRows(json, { passAt = 0.8 } = {}) {
  const runDate = (json.ran || '').slice(0, 10);
  return (json.results || []).map(r => ({
    id: r.id, story: r.story || '', verdict: r.verdict || '', p: typeof r.p === 'number' ? r.p.toFixed(2) : '',
    failing_facts: (r.facts || []).filter(f => typeof f.p === 'number' && f.p < passAt).map(f => `${f.p.toFixed(2)} ${f.fact}`).join('\n'),
    trace: (r.trace || []).map(t => `${t.step} → ${t.name || t.pick || ''}@${t.p ?? ''}${t.problem ? ' (' + t.problem + ')' : ''}`).join(' | '),
    run_date: r.ran ? String(r.ran).slice(0, 10) : runDate, run_error: stripAnsi(r.runError || (r.errors && r.errors.length ? r.errors.join('; ') : '')).trim(),
  }));
}
const csvCell = v => { const s = v == null ? '' : String(v); return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const toCsv = (rows, cols = CSV_COLUMNS) => [cols.join(','), ...rows.map(r => cols.map(c => csvCell(r[c])).join(','))].join('\r\n') + '\r\n';
/* RFC 4180 parser (quoted fields, doubled quotes, embedded newlines). Returns array of objects keyed by header. */
function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; continue; }
    if (ch === '"') q = true; else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows.filter(r => !(r.length === 1 && r[0] === ''));
  return body.map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}
/* Merge several runner result files (per-case runs) into one, newest `ran` wins the header. */
function mergeResults(parts) {
  const ran = parts.map(p => p.ran).filter(Boolean).sort().pop() || new Date().toISOString();
  return { ran, target: (parts.find(p => p.target) || {}).target || '', results: parts.flatMap(p => (p.results || []).map(r => ({ ...r, ran: r.ran || p.ran }))) };
}

/* The whole pre-run decision: fixture refusals (T02) plus seats with no saved session (T01: staging has no
   password-free sign-in without one). Returns the cases to run and the FAIL rows for the rest, before any step. */
function planRun(cases, fix, cfg, { allowNoSession = false } = {}) {
  const { runnable, refused } = preflight(cases, fix, cfg.seeds);
  const toRun = [];
  for (const c of runnable) {
    const p = sessionPath(cfg, c.seat);
    if (p && !fs.existsSync(p) && !allowNoSession) refused.push({ id: c.id, story: c.story, title: c.title, verdict: 'FAIL',
      runError: `no saved session for seat ${c.seat} (run console/scripts/jev-sessions.mjs sign-in ${c.seat})`, trace: [], errors: [], refused: true });
    else toRun.push(c);
  }
  return { toRun, refused, sessions: sessionLinks(cfg, toRun.map(c => c.seat)) };
}

module.exports = { planRun, readJson, loadConfig, sessionPath, sessionLinks, fixtureEntry, seedFor, noSeedMessage, preflight,
  CSV_COLUMNS, resultRows, csvCell, toCsv, parseCsv, mergeResults };
