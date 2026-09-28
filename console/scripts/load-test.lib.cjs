/* M18-S01-T01 — LOAD-TEST HARNESS, PURE PARTS (no I/O). The CLI is load-test.mjs; tests: load-test.test.cjs.
 *
 * Seats: 6 lead-side and 15 Investors-side restricted sandbox users (acceptance), each a saved session
 * (jev-sessions.mjs storageState) or a cookie. A seat walks its side's pages — each page is the set of
 * API reads the screen makes, fetched together; "page data time" is the slowest of them — with think
 * time between pages, for the run's duration. Afterwards Plane B (ops-<day>.jsonl under LOG_DIR) is
 * swept for the in-flight peak overall and complex, and every 429 is counted by cause.
 */
'use strict';

const DEFAULTS = Object.freeze({
  durationMs: 20 * 60_000,
  rampMs: 60_000,
  thinkMs: [3_000, 12_000],
  timeoutMs: 20_000,
  expect: { lead: 6, investors: 15 },
  limits: { p95Ms: 2_000, maxInFlight: 12, maxComplex: 8 },
});
const SIDES = ['lead', 'investors'];
const ZOHO_ID = /^\d{15,22}$/;

function fail(msg) { const e = new Error(msg); e.config = true; throw e; }

/** Seats from config: `{ name: { side, storageState | cookie, ids?, copies? } }`. `copies` reuses one
 *  session for several simulated seats (warned: one person's identical reads coalesce, so it under-loads). */
function planSeats(cfg) {
  const seats = [];
  const warnings = [];
  for (const [name, s] of Object.entries(cfg.seats || {})) {
    if (!s || !SIDES.includes(s.side)) fail(`seat ${name}: side must be "lead" or "investors"`);
    if (!s.storageState && !s.cookie) fail(`seat ${name}: give storageState (jev-sessions.mjs) or cookie`);
    const copies = s.copies === undefined ? 1 : s.copies;
    if (!Number.isInteger(copies) || copies < 1 || copies > 50) fail(`seat ${name}: copies must be 1–50`);
    if (copies > 1) warnings.push(`seat ${name}: ${copies} simulated seats share one session — identical reads coalesce, so this under-states load`);
    for (const [k, v] of Object.entries(s.ids || {})) if (!ZOHO_ID.test(String(v))) fail(`seat ${name}: ids.${k} is not a Zoho id`);
    for (let i = 0; i < copies; i++) seats.push({ seat: copies > 1 ? `${name}#${i + 1}` : name, name, side: s.side, ids: s.ids || {} });
  }
  const expect = { ...DEFAULTS.expect, ...(cfg.expect || {}) };
  for (const side of SIDES) {
    const n = seats.filter((x) => x.side === side).length;
    if (n !== expect[side]) warnings.push(`${side} side has ${n} seats; the acceptance run needs ${expect[side]}`);
  }
  if (!seats.length) fail('no seats configured');
  return { seats, warnings };
}

/** Fills `{leadId}`-style placeholders from the seat's ids; a page needing an id the seat lacks is skipped. */
function expandPath(p, ids) {
  let missing = null;
  const out = p.replace(/\{([A-Za-z]+)\}/g, (_, k) => {
    if (ids[k] === undefined) { missing = k; return ''; }
    return encodeURIComponent(String(ids[k]));
  });
  if (missing) return null;
  if (!out.startsWith('/api/')) fail(`page path ${p} must start with /api/`);
  return out;
}

/** The pages a seat can open: `cfg.pages[side] = [{ name, paths: [...] }]`. */
function pagesFor(cfg, seat) {
  const list = (cfg.pages && cfg.pages[seat.side]) || [];
  if (!list.length) fail(`no pages configured for the ${seat.side} side`);
  const out = [];
  for (const pg of list) {
    if (!pg.name || !Array.isArray(pg.paths) || !pg.paths.length) fail(`page ${JSON.stringify(pg.name)}: needs name and paths`);
    const paths = pg.paths.map((p) => expandPath(p, seat.ids));
    if (paths.every((p) => p !== null)) out.push({ name: pg.name, paths });
  }
  if (!out.length) fail(`seat ${seat.seat}: every page needs an id it does not have`);
  return out;
}

function settings(cfg) {
  const s = { ...DEFAULTS, ...cfg, limits: { ...DEFAULTS.limits, ...(cfg.limits || {}) } };
  if (!Number.isFinite(s.durationMs) || s.durationMs < 1_000) fail('durationMs must be at least 1000');
  if (!Array.isArray(s.thinkMs) || s.thinkMs.length !== 2 || !(s.thinkMs[0] >= 0) || !(s.thinkMs[1] >= s.thinkMs[0])) fail('thinkMs is [min, max]');
  return s;
}

const thinkFor = (range, random = Math.random) => Math.round(range[0] + random() * (range[1] - range[0]));

/** Nearest-rank percentile of a list of numbers; null for an empty list. */
function percentile(values, p) {
  const v = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!v.length) return null;
  return v[Math.min(v.length - 1, Math.max(0, Math.ceil((p / 100) * v.length) - 1))];
}

const KIND_CAUSE = Object.freeze({
  'concurrency-exceeded': 'concurrency',
  'credits-exhausted': 'credits',
  'rate-limited-unclassified': 'unclassified',
  busy: 'gate-busy',
});

/** Why a 429 (or a console error carrying a Zoho 429 kind) happened, from the body — never guessed from the status alone. */
function causeOf429(status, body, text = '') {
  const s = typeof text === 'string' && text ? text : (() => { try { return JSON.stringify(body) || ''; } catch { return ''; } })();
  const lower = s.toLowerCase();
  if (/"pool"\s*:\s*"sub"/.test(s) || /sub[\s_-]*concurren/.test(lower)) return 'sub-concurrency';
  for (const [kind, cause] of Object.entries(KIND_CAUSE)) if (s.includes(`"${kind}"`)) return cause;
  if (status !== 429) return null;
  if (/concurren/.test(lower)) return 'concurrency';
  if (/24 ?hour|credits|api limit/.test(lower)) return 'credits';
  return 'unclassified';
}

/** Per-page and overall figures from the page samples `{ seat, side, page, startedAt, ms, statuses, causes }`. */
function summarise(samples) {
  const byPage = {};
  const causes = {};
  let failed = 0;
  for (const s of samples) {
    const key = `${s.side}:${s.page}`;
    (byPage[key] ||= { side: s.side, page: s.page, ms: [], failed: 0 }).ms.push(s.ms);
    const bad = s.statuses.some((st) => st === null || st >= 400);
    if (bad) { byPage[key].failed++; failed++; }
    for (const c of s.causes) if (c) causes[c] = (causes[c] || 0) + 1;
  }
  const pages = Object.values(byPage).map((p) => ({
    side: p.side, page: p.page, n: p.ms.length, failed: p.failed,
    p50: percentile(p.ms, 50), p95: percentile(p.ms, 95), max: Math.max(...p.ms),
  })).sort((a, b) => (b.p95 ?? 0) - (a.p95 ?? 0));
  return { pages: samples.length, failed, p95: percentile(samples.map((s) => s.ms), 95), p50: percentile(samples.map((s) => s.ms), 50), byPage: pages, causes };
}

/** Plane B lines (parsed JSONL) in [from, to]: calls, the in-flight peak overall and complex, and 429s by error class. */
function planeBPeaks(records, from, to) {
  const calls = records.filter((r) => r && r.kind === 'zoho-call' && Number.isFinite(r.at) && Number.isFinite(r.durationMs)
    && r.at + r.durationMs >= from && r.at <= to);
  const edges = [];
  for (const r of calls) {
    const complex = r.callClass === 'complex' ? 1 : 0;
    edges.push([r.at, 1, complex], [r.at + Math.max(0, r.durationMs), -1, -complex]);
  }
  edges.sort((a, b) => a[0] - b[0] || a[1] - b[1]); // ends before starts at the same ms: touching is not overlapping
  let now = 0, cx = 0, peak = 0, peakComplex = 0;
  for (const [, d, c] of edges) { now += d; cx += c; peak = Math.max(peak, now); peakComplex = Math.max(peakComplex, cx); }
  const byClass = {};
  for (const r of calls) if (r.status === 429 || ['concurrency-exceeded', 'credits-exhausted', 'rate-limited-unclassified'].includes(r.errorClass)) {
    const k = r.errorClass || 'status-429';
    byClass[k] = (byClass[k] || 0) + 1;
  }
  const credits = calls.map((r) => r.creditsRemaining).filter(Number.isFinite);
  return { calls: calls.length, peakInFlight: peak, peakComplex, zoho429: byClass, lowestCredits: credits.length ? Math.min(...credits) : null,
    gateWaitP95: percentile(calls.map((r) => r.gateWaitMs), 95) };
}

/** The acceptance checks. Plane B checks are "not measured" (ok: null) without the log directory. */
function verdict(summary, planeB, limits = DEFAULTS.limits) {
  const checks = [];
  const add = (name, ok, value, limit) => checks.push({ name, ok, value, limit });
  add('p95 page data time', summary.p95 === null ? null : summary.p95 <= limits.p95Ms, summary.p95, limits.p95Ms);
  const conc = (summary.causes.concurrency || 0) + (summary.causes['sub-concurrency'] || 0);
  add('no concurrency / sub-concurrency 429 at the screens', conc === 0, conc, 0);
  if (planeB) {
    const z = (planeB.zoho429['concurrency-exceeded'] || 0);
    add('no concurrency 429 from Zoho (Plane B)', z === 0, z, 0);
    add('in-flight peak within the gate', planeB.peakInFlight <= limits.maxInFlight, planeB.peakInFlight, limits.maxInFlight);
    add('complex in-flight peak within the gate', planeB.peakComplex <= limits.maxComplex, planeB.peakComplex, limits.maxComplex);
  } else {
    for (const n of ['no concurrency 429 from Zoho (Plane B)', 'in-flight peak within the gate', 'complex in-flight peak within the gate']) add(n, null, null, null);
  }
  const failedChecks = checks.filter((c) => c.ok === false);
  return { pass: failedChecks.length === 0 && checks.every((c) => c.ok !== null), failed: failedChecks.map((c) => c.name), checks };
}

/** The Plane B day files a window touches ("2026-09-28"): server/logs/jsonl.ts names them by UTC day. */
function logDays(from, to) {
  const day = (ms) => new Date(ms).toISOString().slice(0, 10);
  const out = new Set();
  for (let t = from; t <= to; t += 3_600_000) out.add(day(t));
  out.add(day(to));
  return [...out];
}

module.exports = { DEFAULTS, planSeats, expandPath, pagesFor, settings, thinkFor, percentile, causeOf429, summarise, planeBPeaks, verdict, logDays };
