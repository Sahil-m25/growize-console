/* M01-S01-T04/T06 ROUTE GUARD — seat presets, page and API refusal, Plane C line
 *
 * Run from console/: node --test src/server/access/guard.test.cjs
 *
 * Covers: every Zoho seat and the super user x every page (allowed vs refused, landing on the first page),
 * the story's rail acceptance per seat, the session guard (Plane C line holds ids only), fixture/stub
 * pass-through, API refusal is a 403 with no data, and every API route file is named and wrapped.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const test = require('node:test');

const consoleRoot = path.resolve(__dirname, '..', '..', '..');
const srcRoot = path.join(consoleRoot, 'src');
const ts = require(path.join(consoleRoot, 'node_modules', 'typescript'));
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'server-guard-'));
process.on('exit', () => fs.rmSync(outDir, { recursive: true, force: true }));

const config = ts.readConfigFile(path.join(consoleRoot, 'tsconfig.json'), ts.sys.readFile);
const project = ts.parseJsonConfigFileContent(config.config, ts.sys, consoleRoot);
const options = {
  ...project.options, incremental: false, tsBuildInfoFile: undefined, plugins: undefined,
  module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10,
  noEmit: false, noEmitOnError: true, outDir, rootDir: consoleRoot,
};
const sources = ['src/server/access/guard.ts'].map((f) => path.join(consoleRoot, f));
const program = ts.createProgram(sources, options);
const diagnostics = [...ts.getPreEmitDiagnostics(program), ...program.emit().diagnostics];
if (diagnostics.length) {
  console.error(ts.formatDiagnostics(diagnostics, { getCanonicalFileName: (f) => f, getCurrentDirectory: () => consoleRoot, getNewLine: () => '\n' }));
  process.exit(1);
}
process.env.NODE_PATH = path.join(consoleRoot, 'node_modules');
Module._initPaths();
const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  const r = request.startsWith('@/') ? path.join(outDir, 'src', request.slice(2))
    : request.startsWith('@fixtures/') ? path.join(outDir, 'fixtures', request.slice(10)) : request;
  return resolveFilename.call(this, r, ...rest);
};
const load = (f) => require(path.join(outDir, f));


const core = load('src/server/access/guard-core.js');
const guardRt = load('src/server/access/guard.js');
const { ZOHO_SEAT_SIDES } = load('src/server/access/policy.js');
const { createPlaneCLog, createPlaneCMemorySink } = load('src/server/identity/plane-c.js');
const { CONSOLE_SEAT } = load('src/server/oauth/user-session.js');
const { PAGE_IDS, NOPAGE_IDS, pageIdOf, reachForSides, seatPresets, decidePage, createGuard, refusalResponse, apiRuleOf, API_ROUTES, SUPER_USER_SIDES, ZOHO_SEAT_OF_TOKEN, GUARD_REFUSALS } = core;

const ID = '4876876000000123456';           /* a Zoho user id shape; no real person */
const PRESETS = seatPresets();
const SEATS = [...Object.keys(ZOHO_SEAT_SIDES), 'super-user'];
const sidesOf = (k) => (k === 'super-user' ? SUPER_USER_SIDES : ZOHO_SEAT_SIDES[k]);

test('T04: the page ids are the five bands of the rail (NAV + the Investors pages), /add is a no-page route', () => {
  assert.deepEqual([...PAGE_IDS].sort(), ['activity', 'docs', 'events', 'farms', 'goals', 'inv', 'invupd', 'leads', 'me', 'numbers', 'pay', 'people', 'system', 'tkt', 'today', 'updates', 'xfer']);
  assert.deepEqual([...NOPAGE_IDS], ['add']);
  assert.equal(pageIdOf('/leads/4876876000000999999'), 'leads');
  assert.equal(pageIdOf('/events/e1?x=1'), 'events');
  assert.equal(pageIdOf('/system'), 'system');
  assert.equal(pageIdOf('/'), null);
  assert.equal(pageIdOf('/_next/static/x.js'), null);
  assert.equal(pageIdOf(undefined), null);
});

test('T04: seat presets — the story acceptance per seat', () => {
  const has = (k, pages) => pages.every((p) => PRESETS[k].pages.includes(p));
  const lacks = (k, pages) => pages.every((p) => !PRESETS[k].pages.includes(p));
  /* IR (Rohit) */
  assert.ok(has('investor-relations', ['today', 'leads', 'events', 'updates', 'pay', 'docs', 'activity', 'me']));
  assert.ok(lacks('investor-relations', ['people', 'goals', 'system', 'xfer', 'numbers']));
  /* IR Manager (Tasneem) */
  assert.ok(has('ir-manager', ['people', 'goals', 'xfer', 'numbers']));
  assert.ok(lacks('ir-manager', ['system']));
  /* Finance (Harsha): the Investors band, Payments, Documents, and a Measure page */
  assert.ok(has('head-of-finance', ['inv', 'farms', 'tkt', 'invupd', 'pay', 'docs', 'numbers']));
  /* KAM: no Payments or Documents */
  assert.ok(has('key-account-manager', ['today', 'inv', 'farms', 'tkt', 'invupd', 'activity']));
  assert.ok(lacks('key-account-manager', ['pay', 'docs']));
  /* Sahil, the super user (D68): every page of all five bands */
  assert.deepEqual([...PRESETS['super-user'].pages].sort(), [...PAGE_IDS].sort());
  /* Administrator profiles never sign in; granted-only seats have nothing until a grant */
  for (const k of ['corporate-root', 'digital-infrastructure', 'viewer', 'business-unit-owner', 'channel-partner']) {
    assert.equal(PRESETS[k].admitted, false, k);
  }
  for (const k of SEATS) if (PRESETS[k].admitted) assert.equal(PRESETS[k].landing, 'today', k);
});

test('T04/T06: every seat x every page — allowed exactly when the rail holds it; a refusal lands on the first page', () => {
  let allowed = 0, refused = 0;
  for (const k of SEATS) {
    for (const page of [...PAGE_IDS, ...NOPAGE_IDS]) {
      const v = decidePage(sidesOf(k), 'w', {}, page);
      if (!PRESETS[k].admitted) {
        /* Administrator profiles are refused at the door (admitZohoSeat) and hold no session token at all */
        if (k === 'corporate-root' || k === 'digital-infrastructure') { assert.equal(CONSOLE_SEAT[k], null); continue; }
        assert.equal(v.ok, false); assert.equal(v.code, 'no-seat'); assert.equal(v.landing, '/');
        continue;
      }
      const want = PRESETS[k].pages.includes(page) || NOPAGE_IDS.includes(page);
      assert.equal(v.ok, want, `${k} ${page}`);
      if (v.ok) allowed++;
      else {
        refused++;
        assert.equal(v.status, 403); assert.equal(v.code, 'page'); assert.equal(v.message, GUARD_REFUSALS.page);
        assert.equal(v.landing, '/' + PRESETS[k].landing, `${k} ${page} lands on a page`);
        assert.ok(PRESETS[k].pages.includes(v.landing.slice(1)), `${k}: landing is reachable`);
      }
    }
  }
  assert.ok(allowed > 0 && refused > 0);
});

test('T04: a granted-only seat reaches exactly its grant, and lands on it', () => {
  const r = reachForSides(ZOHO_SEAT_SIDES.viewer, 'w', { numbers: ['view'] });
  assert.equal(r.admitted, true); assert.equal(r.landing, 'numbers');
  assert.equal(decidePage(ZOHO_SEAT_SIDES.viewer, 'w', { numbers: ['view'] }, 'numbers').ok, true);
  const v = decidePage(ZOHO_SEAT_SIDES.viewer, 'w', { numbers: ['view'] }, 'leads');
  assert.equal(v.ok, false); assert.equal(v.landing, '/numbers');
});

test('T04: every console seat token maps back to one Zoho seat', () => {
  for (const [seat, token] of Object.entries(CONSOLE_SEAT)) if (token) assert.equal(ZOHO_SEAT_OF_TOKEN[token], seat);
});

/* ---- the guard over a session ---------------------------------------------------------------------- */

function rig({ mode = 'enforce', session = { who: ID, seat: 'ir' }, grants } = {}) {
  const sink = createPlaneCMemorySink();
  const reads = { n: 0 };
  const g = createGuard({
    mode: () => mode,
    planeC: createPlaneCLog(sink),
    clock: () => 1_700_000_000_000,
    ...(grants ? { grants } : {}),
    async readSession() {
      reads.n++;
      if (mode === 'pass') throw new Error('pass-through must not read the session');
      return session ? { ok: true, session } : { ok: false, why: 'expired' };
    },
  });
  return { g, sink, reads };
}

test('T06: an IR typing /system is refused, lands on Today, and Plane C gets one line of ids and codes only', async () => {
  const { g, sink } = rig();
  const v = await g.page('system');
  assert.equal(v.ok, false); assert.equal(v.status, 403); assert.equal(v.code, 'page'); assert.equal(v.landing, '/today');
  const lines = sink.events();
  assert.equal(lines.length, 1);
  assert.deepEqual(Object.keys(lines[0]).sort(), ['action', 'at', 'outcome', 'reason', 'seat', 'who']);
  assert.deepEqual({ ...lines[0] }, { at: 1_700_000_000_000, who: ID, action: 'sign-in-refused', outcome: 'refused', reason: 'page-refused-system', seat: 'ir' });
  assert.doesNotMatch(JSON.stringify(lines), /@|Rohit|Deshpande|token|system page/i);
});

test('T06: a page the seat holds passes and writes nothing', async () => {
  const { g, sink } = rig({ session: { who: ID, seat: 'conv' } });
  for (const p of PRESETS['ir-manager'].pages) assert.equal((await g.page(p)).ok, true, p);
  assert.equal((await g.page(null)).ok, true);
  assert.equal(sink.events().length, 0);
});

test('T06: every signed-in seat x every page through the session guard matches the presets', async () => {
  for (const [seat, token] of Object.entries(CONSOLE_SEAT)) {
    if (!token) continue;
    const { g, sink } = rig({ session: { who: ID, seat: token } });
    let refusals = 0;
    for (const page of PAGE_IDS) {
      const v = await g.page(page);
      const want = PRESETS[seat].admitted && PRESETS[seat].pages.includes(page);
      assert.equal(v.ok, want, `${seat} ${page}`);
      if (!v.ok) refusals++;
    }
    assert.equal(sink.events().length, refusals, `${seat}: one Plane C line per refusal`);
    if (!PRESETS[seat].admitted) assert.ok(sink.events().every((e) => e.reason === 'no-grant' || e.reason === 'no-seat'));
  }
});

test('T06: signed out is a 401 carrying the sign-out reason; an unknown seat token is refused and logged', async () => {
  const out = rig({ session: null });
  const v = await out.g.page('today');
  assert.equal(v.ok, false); assert.equal(v.status, 401); assert.equal(v.signedOut, 'expired'); assert.equal(v.landing, '/');
  assert.equal(out.sink.events().length, 0);
  const odd = rig({ session: { who: ID, seat: 'root' } });
  const w = await odd.g.page('today');
  assert.equal(w.code, 'no-seat');
  assert.equal(odd.sink.events()[0].reason, 'no-seat');
});

test('T06: grants come from the reader; a reader that throws counts as no grant (fail closed)', async () => {
  const ok = rig({ session: { who: ID, seat: 'exec' }, grants: { grantsOf: () => ({ numbers: ['view'] }) } });
  assert.equal((await ok.g.page('numbers')).ok, true);
  assert.equal((await ok.g.page('leads')).landing, '/numbers');
  const bad = rig({ session: { who: ID, seat: 'exec' }, grants: { grantsOf: () => { throw new Error('down'); } } });
  const v = await bad.g.page('numbers');
  assert.equal(v.ok, false); assert.equal(v.code, 'no-grant');
});

test('T06: fixture mode / the phase-1 stub pass through without reading the session; production without Zoho is 503', async () => {
  const p = rig({ mode: 'pass' });
  assert.equal((await p.g.page('system')).ok, true);
  assert.equal((await p.g.api('/api/data')).ok, true);
  assert.equal((await p.g.api('/api/unlisted')).ok, true);
  assert.equal(p.reads.n, 0); assert.equal(p.sink.events().length, 0);
  const n = rig({ mode: 'not-configured' });
  const v = await n.g.api('/api/data');
  assert.equal(v.status, 503);
  assert.equal(guardRt.guardMode({ FIXTURE_MODE: 'local', NODE_ENV: 'development' }), 'pass');
  assert.equal(guardRt.guardMode({ NODE_ENV: 'development' }), 'pass');
  assert.equal(guardRt.guardMode({ NODE_ENV: 'production' }), 'not-configured');
});

/* ---- API handlers --------------------------------------------------------------------------------- */

test('T04: API rules — session routes, page routes by prefix, open routes said why, unlisted refused', async () => {
  assert.equal(apiRuleOf('/api/data').rule.kind, 'session');
  assert.equal(apiRuleOf('/api/leads/4876876000000999999').rule.page, 'leads');
  assert.equal(apiRuleOf('/api/datax'), null);
  const kam = rig({ session: { who: ID, seat: 'kam' } });
  const v = await kam.g.api('/api/leads/4876876000000999999');
  assert.equal(v.ok, false); assert.equal(v.status, 403);
  assert.equal(kam.sink.events()[0].reason, 'api-refused-leads');
  assert.equal((await kam.g.api('/api/data')).ok, true);
  assert.equal((await kam.g.api('/api/nope')).status, 403);
  assert.equal((await kam.g.api('/api/webhooks/zoho-sign')).ok, true);
});

test('T06: guardApi — a refused request is a 403 with the named message and no data; the handler never runs', async () => {
  const { g, sink } = rig({ session: { who: ID, seat: 'kam' } });
  globalThis.__gzRouteGuard = { guard: g, planeC: null };
  let ran = 0;
  const handler = guardRt.guardApi('/api/leads', async () => { ran++; return Response.json({ ds: { LEADS: ['secret'] } }); });
  const res = await handler(new Request('http://x/api/leads'));
  assert.equal(res.status, 403); assert.equal(ran, 0);
  const body = await res.json();
  assert.deepEqual(Object.keys(body).sort(), ['code', 'error', 'landing']);
  assert.equal(body.error, GUARD_REFUSALS.page); assert.equal(body.landing, '/today');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(sink.events().length, 1);
  /* allowed: the handler's own response, unchanged */
  const data = guardRt.guardApi('/api/data', async () => Response.json({ ok: 1 }, { status: 207 }));
  const r2 = await data(new Request('http://x/api/data'));
  assert.equal(r2.status, 207); assert.deepEqual(await r2.json(), { ok: 1 });
  /* pass-through (fixture mode): unchanged, session never read */
  const p = rig({ mode: 'pass' });
  globalThis.__gzRouteGuard = { guard: p.g, planeC: null };
  const r3 = await guardRt.guardApi('/api/data', async () => new Response('demo', { status: 200 }))(new Request('http://x/api/data'));
  assert.equal(await r3.text(), 'demo'); assert.equal(p.reads.n, 0);
  delete globalThis.__gzRouteGuard;
});

test('T04: every API route file (less test/** and auth/**) is named in API_ROUTES, and every guarded one is wrapped withErrorCapture(guardApi(...))', () => {
  const apiDir = path.join(srcRoot, 'app', 'api');
  const files = [];
  (function walk(d) { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (f.name === 'route.ts') files.push(p); } })(apiDir);
  const routes = files.map((f) => ({ f, route: '/api/' + path.relative(apiDir, path.dirname(f)).split(path.sep).join('/') }))
    .filter(({ route }) => !/^\/api\/(test|auth)(\/|$)/.test(route));
  assert.ok(routes.length >= 5);
  for (const { f, route } of routes) {
    const r = apiRuleOf(route);
    assert.ok(r, `${route} is not named in API_ROUTES`);
    const src = fs.readFileSync(f, 'utf8');
    if (r.rule.kind !== 'open') {
      const exports = src.match(/^export const (GET|POST|PUT|PATCH|DELETE) = .*$/gm) || [];
      assert.ok(exports.length > 0, route);
      for (const e of exports) assert.match(e, /= withErrorCapture\(guardApi\(/, `${route}: ${e}`);
    }
  }
  for (const r of Object.values(API_ROUTES)) if (r.kind === 'open') assert.ok(r.why.length > 10);
});
