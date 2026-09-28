/* M18-S01-T01 load-test pure parts + one short end-to-end run against a local stub. Run from console/: node --test scripts/load-test.test.cjs */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawn } = require('node:child_process');
const L = require('./load-test.lib.cjs');

const A = '554023000000527003';

test('seats: 6 + 15 expected; copies expand and warn; bad side, missing session and non-Zoho ids refuse', () => {
  const { seats, warnings } = L.planSeats({ seats: {
    ir: { side: 'lead', cookie: 'sid=1', copies: 6, ids: { leadId: A } },
    kam: { side: 'investors', storageState: 'k.json', copies: 15 },
  } });
  assert.equal(seats.filter((s) => s.side === 'lead').length, 6);
  assert.equal(seats.filter((s) => s.side === 'investors').length, 15);
  assert.equal(seats[0].seat, 'ir#1');
  assert.equal(warnings.filter((w) => /under-states load/.test(w)).length, 2);
  assert.equal(warnings.some((w) => /acceptance run needs/.test(w)), false);
  assert.match(L.planSeats({ seats: { a: { side: 'lead', cookie: 'x' } } }).warnings.join('|'), /lead side has 1 seats; the acceptance run needs 6/);
  assert.throws(() => L.planSeats({ seats: { a: { side: 'finance', cookie: 'x' } } }), /side must be/);
  assert.throws(() => L.planSeats({ seats: { a: { side: 'lead' } } }), /storageState/);
  assert.throws(() => L.planSeats({ seats: { a: { side: 'lead', cookie: 'x', ids: { leadId: '9876543210' } } } }), /not a Zoho id/);
  assert.throws(() => L.planSeats({ seats: {} }), /no seats/);
});

test('pages: placeholders fill from the seat ids; a page needing a missing id is skipped; paths must be /api/', () => {
  const cfg = { pages: { lead: [{ name: 'Today', paths: ['/api/data'] }, { name: 'Lead page', paths: ['/api/leads/{leadId}/gate'] }] } };
  assert.deepEqual(L.pagesFor(cfg, { seat: 'a', side: 'lead', ids: { leadId: A } }).map((p) => p.paths[0]), ['/api/data', `/api/leads/${A}/gate`]);
  assert.deepEqual(L.pagesFor(cfg, { seat: 'b', side: 'lead', ids: {} }).map((p) => p.name), ['Today']);
  assert.throws(() => L.pagesFor({ pages: { lead: [{ name: 'X', paths: ['/leads'] }] } }, { seat: 'a', side: 'lead', ids: {} }), /must start with \/api\//);
  assert.throws(() => L.pagesFor({ pages: {} }, { seat: 'a', side: 'investors', ids: {} }), /no pages configured/);
});

test('percentile, think time and settings', () => {
  assert.equal(L.percentile([], 95), null);
  assert.equal(L.percentile([5], 95), 5);
  assert.equal(L.percentile(Array.from({ length: 100 }, (_, i) => i + 1), 95), 95);
  assert.equal(L.percentile([1, 2, 3, 4, 1000], 95), 1000);
  assert.equal(L.thinkFor([100, 200], () => 0.5), 150);
  assert.throws(() => L.settings({ thinkMs: [5, 1] }), /thinkMs/);
  assert.equal(L.settings({}).limits.maxInFlight, 12);
  assert.equal(L.settings({ limits: { p95Ms: 2500 } }).limits.maxComplex, 8);
});

test('429 cause is read from the body: sub-concurrency, concurrency, credits, unclassified, our gate', () => {
  assert.equal(L.causeOf429(429, { code: 'TOO_MANY_REQUESTS', message: 'sub-concurrency limit exceeded' }), 'sub-concurrency');
  assert.equal(L.causeOf429(503, { error: 'x', errorKind: 'concurrency-exceeded', pool: 'sub' }), 'sub-concurrency');
  assert.equal(L.causeOf429(503, { errorKind: 'concurrency-exceeded', pool: 'org' }), 'concurrency');
  assert.equal(L.causeOf429(429, undefined, 'You have reached the concurrency limit'), 'concurrency');
  assert.equal(L.causeOf429(429, { message: 'You have exceeded the 24 hour API limit' }), 'credits');
  assert.equal(L.causeOf429(502, { code: 'credits-exhausted' }, '{"code":"credits-exhausted"}'), 'credits');
  assert.equal(L.causeOf429(503, { kind: 'busy' }), 'gate-busy');
  assert.equal(L.causeOf429(429, { message: 'slow down' }), 'unclassified');
  assert.equal(L.causeOf429(500, { message: 'boom' }), null, 'not every failure is a 429');
});

test('summary: p95 over pages, failures and causes counted per page', () => {
  const s = (page, ms, statuses = [200], causes = [null]) => ({ seat: 'a', side: 'lead', page, startedAt: 0, ms, statuses, causes });
  const out = L.summarise([s('Today', 100), s('Today', 300), s('Leads', 2500, [200, 429], [null, 'sub-concurrency']), s('Leads', 50, [null])]);
  assert.equal(out.pages, 4); assert.equal(out.failed, 2); assert.equal(out.p95, 2500);
  assert.deepEqual(out.causes, { 'sub-concurrency': 1 });
  assert.equal(out.byPage[0].page, 'Leads'); assert.equal(out.byPage[0].failed, 2);
});

test('Plane B sweep: overlapping calls give the peak overall and complex; touching calls do not overlap; 429s by class', () => {
  const c = (at, durationMs, callClass = 'simple', extra = {}) => ({ kind: 'zoho-call', at, durationMs, callClass, status: 200, errorClass: null, creditsRemaining: null, gateWaitMs: 0, ...extra });
  const recs = [
    c(0, 100, 'complex'), c(10, 100, 'complex'), c(20, 100), c(100, 50, 'complex'), // at 100 the first ends as the fourth starts
    c(500, 10, 'simple', { status: 429, errorClass: 'concurrency-exceeded', creditsRemaining: 9000 }),
    c(600, 10, 'complex', { status: 429, errorClass: 'rate-limited-unclassified', creditsRemaining: 8000 }),
    { kind: 'refusal', at: 5 }, c(10_000, 5), // out of the window
  ];
  const p = L.planeBPeaks(recs, 0, 1_000);
  assert.equal(p.calls, 6); assert.equal(p.peakInFlight, 3); assert.equal(p.peakComplex, 2);
  assert.deepEqual(p.zoho429, { 'concurrency-exceeded': 1, 'rate-limited-unclassified': 1 });
  assert.equal(p.lowestCredits, 8000);
});

test('verdict: every acceptance check must pass; without Plane B the gate checks are not measured, so no pass', () => {
  const good = { p95: 1800, causes: {} };
  const pb = { peakInFlight: 12, peakComplex: 8, zoho429: {} };
  assert.equal(L.verdict(good, pb).pass, true);
  assert.deepEqual(L.verdict({ p95: 2100, causes: {} }, pb).failed, ['p95 page data time']);
  assert.deepEqual(L.verdict(good, { ...pb, peakComplex: 9 }).failed, ['complex in-flight peak within the gate']);
  assert.deepEqual(L.verdict({ p95: 100, causes: { 'sub-concurrency': 1 } }, pb).failed, ['no concurrency / sub-concurrency 429 at the screens']);
  assert.deepEqual(L.verdict(good, { ...pb, zoho429: { 'concurrency-exceeded': 2 } }).failed, ['no concurrency 429 from Zoho (Plane B)']);
  const blind = L.verdict(good, null);
  assert.equal(blind.pass, false); assert.equal(blind.failed.length, 0);
  assert.equal(blind.checks.filter((c) => c.ok === null).length, 3);
});

test('log days are UTC (jsonl.ts dayOf), spanning midnight', () => {
  assert.deepEqual(L.logDays(Date.UTC(2026, 8, 27, 23, 50), Date.UTC(2026, 8, 28, 0, 10)), ['2026-09-27', '2026-09-28']);
});

test('the example config plans cleanly', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'load-test.config.example.json'), 'utf8'));
  const { seats } = L.planSeats(cfg);
  assert.equal(seats.filter((s) => s.side === 'lead').length, 6);
  assert.equal(seats.filter((s) => s.side === 'investors').length, 15);
  for (const s of seats) assert.ok(L.pagesFor(cfg, s).length > 0);
  for (const side of ['lead', 'investors']) for (const pg of cfg.pages[side]) for (const p of pg.paths) {
    const tpl = p.split('?')[0].replace(/\{[A-Za-z]+\}/g, '[id]');
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'src', 'app', tpl, 'route.ts')), `${p} is a real route`);
  }
});

test('end to end: the CLI drives a stub for ~1.5 s, reads a Plane B day file and reports the verdict', async () => {
  let hits = 0; let cookieSeen = null;
  const server = http.createServer((req, res) => {
    hits++; cookieSeen = req.headers.cookie;
    if (req.url.startsWith('/api/slow')) { res.writeHead(429, { 'content-type': 'application/json' }); res.end('{"errorKind":"concurrency-exceeded","pool":"sub"}'); return; }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'load-test-'));
  const now = Date.now();
  fs.writeFileSync(path.join(dir, `ops-${new Date(now).toISOString().slice(0, 10)}.jsonl`),
    [{ kind: 'zoho-call', at: now + 200, durationMs: 50, callClass: 'complex', status: 200, errorClass: null, creditsRemaining: null, gateWaitMs: 0 }].map((x) => JSON.stringify(x)).join('\n') + '\n');
  const cfgFile = path.join(dir, 'cfg.json');
  fs.writeFileSync(cfgFile, JSON.stringify({
    baseUrl: `http://127.0.0.1:${port}/`, durationMs: 1500, rampMs: 0, thinkMs: [20, 40], logDir: dir,
    pages: { lead: [{ name: 'Today', paths: ['/api/data'] }], investors: [{ name: 'Tickets', paths: ['/api/cases', '/api/slow'] }] },
    seats: { ir: { side: 'lead', cookie: 'gz_sid=abc', copies: 6 }, kam: { side: 'investors', cookie: 'gz_sid=def', copies: 15 } },
  }));
  const out = path.join(dir, 'report.json');
  const code = await new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(__dirname, 'load-test.mjs'), '--config', cfgFile, '--out', out], { stdio: 'ignore' });
    p.on('exit', resolve);
  });
  server.close();
  const report = JSON.parse(fs.readFileSync(out, 'utf8'));
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(code, 1, 'the stub answers sub-concurrency 429s, so the run fails');
  assert.ok(hits > 21, `every seat made calls (${hits})`);
  assert.match(cookieSeen, /^gz_sid=/);
  assert.deepEqual(report.seats, { lead: 6, investors: 15 });
  assert.ok(report.summary.causes['sub-concurrency'] > 0);
  assert.equal(report.planeB.calls, 1); assert.equal(report.planeB.peakComplex, 1);
  assert.deepEqual(report.verdict.failed, ['no concurrency / sub-concurrency 429 at the screens']);
});
