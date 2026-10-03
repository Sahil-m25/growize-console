/* M18-S14 — shared harness for the API contract suites (contract-table / refusals / leaks).
 *
 * Loads the REAL route handlers (TypeScript, transpiled on the fly) and calls them directly with constructed
 * Requests: no server, no network, no Zoho. What is faked, and nothing else:
 *   - `next/headers` (cookies()/headers() read the Request being served);
 *   - the Zoho sign-in runtime: `globalThis.__gzUserSessions` (the process-wide seam server/oauth/runtime keeps)
 *     holds a UserSessions whose session id names a seat; every other part of the route stack — guard.ts, the
 *     policy, the seat rules, the handlers, withErrorCapture — is production code (ENFORCE mode; `setMode('fixture')`
 *     switches one process to FIXTURE_MODE=local and the demo book);
 *   - `fetch`: a Zoho double. A COQL select over a module is answered from the module's RECORDED fixture (src/lib/zoho/__fixtures__,
 *     the ones the service tests replay) when there is one; every other CRM call gets a Zoho-shaped 403 (no retry, no backoff) carrying
 *     CANARY. It counts the calls. A handler that answered before calling it is judged on its own; one that reached it is "needs sandbox".
 * A later route needs only a row in contract-table.json; nothing here names a route.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const consoleRoot = path.resolve(__dirname, '..', '..', '..', '..');
const srcRoot = path.join(consoleRoot, 'src');
const ts = require(path.join(consoleRoot, 'node_modules', 'typescript'));

process.env.NODE_PATH = path.join(consoleRoot, 'node_modules');
Module._initPaths();

/* ---- environment: sign-in "configured" with dummy values; never fixture mode ------------------------- */
/* Two modes in one process (fixtureModeOn reads process.env at every call, so the mode can be switched between calls):
 *   enforce (default): sign-in "configured" with dummy values, the guard enforces, Zoho is the double below;
 *   fixture: FIXTURE_MODE=local, the demo book, the guard passes through (guard.ts's own rule for fixture mode).
 * Every request carries both session cookies, so a handler finds the one its mode reads. */
delete process.env.GZ_LOCAL_BUILD;
Object.assign(process.env, {
  NODE_ENV: 'test',
  ZOHO_ACCOUNTS_ORIGIN: 'https://accounts.zoho.in', ZOHO_OAUTH_CLIENT_ID: 'contract-suite-client', ZOHO_OAUTH_CLIENT_SECRET: 'contract-suite-secret',
  ZOHO_OAUTH_REDIRECT_URI: 'http://localhost:3002/api/auth/zoho/callback', ZOHO_SESSION_KEY: Buffer.alloc(32, 7).toString('base64'),
  ZOHO_CRM_RECORD_ID_PREFIX: '554023', ZOHO_SEAT_IDS: JSON.stringify({ roleIds: {}, profileIds: {} }),
  ZOHO_SIGN_API_ORIGIN: 'https://sign.zoho.in', RECEIPT_IDEMPOTENCY_SECRET: 'a'.repeat(40), RECEIPT_CONTEXT_SIGNING_SECRET: 'b'.repeat(40),
});
let MODE = 'enforce';
function setMode(m) {
  MODE = m;
  if (m === 'fixture') { process.env.FIXTURE_MODE = 'local'; process.env.GZ_LOCAL_BUILD = '1'; }
  else { delete process.env.FIXTURE_MODE; delete process.env.GZ_LOCAL_BUILD; }
}
setMode('enforce');

const CANARY = 'ZOHO_CANARY_9f3c';

/* ---- next/headers stub ------------------------------------------------------------------------------- */
let current = null; /* the Request being served */
const parseCookies = (h) => new Map((h || '').split(';').map((p) => p.trim()).filter(Boolean).map((p) => { const i = p.indexOf('='); return [p.slice(0, i), p.slice(i + 1)]; }));
const jar = () => {
  const m = parseCookies(current && current.headers.get('cookie'));
  return { get: (k) => (m.has(k) ? { name: k, value: m.get(k) } : undefined), has: (k) => m.has(k), getAll: () => [...m].map(([name, value]) => ({ name, value })), set() {}, delete() {} };
};
const stubPath = path.join(__dirname, '.next-headers-stub.cjs');
const stub = { cookies: async () => jar(), headers: async () => (current ? current.headers : new Headers()), draftMode: async () => ({ isEnabled: false }) };

const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === 'next/headers') return stubPath;
  let r = request;
  if (request.startsWith('@/')) r = path.join(srcRoot, request.slice(2));
  else if (request.startsWith('@fixtures/')) r = path.join(consoleRoot, 'fixtures', request.slice(10));
  return resolveFilename.call(this, r, ...rest);
};
require.cache[stubPath] = Object.assign(new Module(stubPath), { id: stubPath, filename: stubPath, loaded: true, exports: stub });

/* ---- TypeScript on the fly ---------------------------------------------------------------------------- */
const compilerOptions = { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX, sourceMap: false };
for (const ext of ['.ts', '.tsx']) {
  Module._extensions[ext] = function (mod, filename) {
    mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions, fileName: filename }).outputText, filename);
  };
}

const load = (rel) => require(path.join(srcRoot, rel));

/* pinned seat ids: dummy but well-formed (Teams and the hand-over read them) */
const { ZOHO_SEAT_POLICIES, createZohoSeatDirectory } = load('server/oauth/seat.ts');
const seatIds = { roleIds: {}, profileIds: {} };
Object.keys(ZOHO_SEAT_POLICIES).forEach((role, i) => { seatIds.roleIds[role] = `55402300000090${String(i).padStart(4, '0')}`; });
[...new Set(Object.values(ZOHO_SEAT_POLICIES).map((p) => p.profile))].forEach((prof, i) => { seatIds.profileIds[prof] = `55402300000091${String(i).padStart(4, '0')}`; });
process.env.ZOHO_SEAT_IDS = JSON.stringify(seatIds);

/* ---- the Zoho double ---------------------------------------------------------------------------------- */
const zoho = { calls: 0, urls: [], replayed: 0 };
const realFetch = globalThis.fetch;

/* Recorded fixtures (src/lib/zoho/__fixtures__, the ones the service tests replay): a COQL select over a module is answered
   with that module's recorded coql.<module>*.response.json, when one exists. Aggregates and everything else get the canary error. */
const FIX = path.join(srcRoot, 'lib', 'zoho', '__fixtures__');
const coqlFixtures = (() => {
  const m = new Map();
  for (const d of fs.readdirSync(FIX, { withFileTypes: true }).filter((e) => e.isDirectory())) {
    for (const f of fs.readdirSync(path.join(FIX, d.name)).sort()) {
      const x = /^coql\.([a-z0-9-]+?)(?:\.[^.]*)*\.response\.json$/.exec(f);
      if (!x) continue;
      const k = x[1]; (m.get(k) || m.set(k, []).get(k)).push(path.join(FIX, d.name, f));
    }
  }
  return m;
})();
const normModule = (n) => n.toLowerCase().replace(/_/g, '-');
function replayCoql(init) {
  let q = ''; try { q = JSON.parse(init.body).select_query || ''; } catch { return null; }
  if (/\b(count|sum|max|min|avg)\s*\(/i.test(q)) return null;
  const mod = /\bfrom\s+([A-Za-z_]+)/i.exec(q); if (!mod) return null;
  const n = normModule(mod[1]);
  const files = coqlFixtures.get(n) || coqlFixtures.get(n.replace(/s$/, '')) || coqlFixtures.get(n + 's');
  if (!files) return null;
  const pick = files.find((f) => /\.(org|response)\.json$/.test(f) && !/(401|403|406|408|no-permission|drift|conflict)/.test(f)) || files.find((f) => !/(401|403|406|408|no-permission|drift|conflict)/.test(f));
  if (!pick) return null;
  const rec = JSON.parse(fs.readFileSync(pick, 'utf8'));
  return new Response(JSON.stringify(rec.body), { status: rec.status || 200, headers: { 'content-type': 'application/json', ...(rec.headers || {}) } });
}
globalThis.fetch = async (url, init) => {
  const u = String(url && url.url ? url.url : url);
  if (/^https?:\/\/localhost/.test(u)) return realFetch(url, init);
  zoho.calls++; zoho.urls.push(u.replace(/\d{15,22}/g, ':id'));
  if (/\/coql(\?|$)/.test(u) && init && init.method === 'POST') { const r = replayCoql(init); if (r) { zoho.replayed++; return r; } }
  return new Response(JSON.stringify({ code: 'NO_PERMISSION', message: CANARY, details: { api_name: 'Contacts', path: '/data/0/PAN_Number' }, status: 'error' }), { status: 403, headers: { 'content-type': 'application/json' } });
};

/* ---- seats and sessions ------------------------------------------------------------------------------- */
const { CONSOLE_SEAT } = load('server/oauth/user-session.ts');
const SEATS = Object.freeze(Object.values(CONSOLE_SEAT).filter((t) => t !== null)); /* console tokens */
const WHO = Object.freeze(Object.fromEntries(SEATS.map((s, i) => [s, `55402300000010${String(i + 1).padStart(4, '0')}`])));
const SID = (seat) => `${seat}${'_'.repeat(43 - seat.length)}`; /* 43 chars, the shape of a real sid */
const seatOfSid = (sid) => (typeof sid === 'string' && /^[a-z]+_+$/.test(sid) ? sid.replace(/_+$/, '') : null);

let credentials = null;
async function credentialFor(seat) {
  if (!credentials) {
    credentials = {};
    const { userCredential } = load('lib/zoho/client.ts');
    const { createGate } = load('lib/zoho/gate.ts');
    const { createOpsLog } = load('lib/zoho/log.ts');
    const gate = createGate(); const log = createOpsLog({ write() {} });
    for (const s of SEATS) {
      credentials[s] = await userCredential({ access_token: 'contract-token-' + s, api_domain: 'https://www.zohoapis.in', expires_in: 3600 }, {
        recordIdPrefix: '554023', gate, log,
        fetch: async () => new Response(JSON.stringify({ users: [{ id: WHO[s], status: 'active' }] }), { status: 200, headers: { 'content-type': 'application/json' } }),
      });
    }
  }
  return credentials[seat];
}

async function installRuntime() {
  const { createGate } = load('lib/zoho/gate.ts'); const { createOpsLog } = load('lib/zoho/log.ts');
  await credentialFor(SEATS[0]);
  const sessions = {
    start: () => ({ url: 'https://accounts.zoho.in/', flowCookie: 'x' }),
    async callback() { return { ok: false, code: 'failed', message: 'not in the suite' }; },
    async current(sid) { const s = seatOfSid(sid); return s && WHO[s] ? { ok: true, session: { who: WHO[s], seat: s }, expiresAt: Date.now() + 3600e3 } : { ok: false, why: null }; },
    async credential(sid) { const s = seatOfSid(sid); return s && WHO[s] ? { ok: true, credential: await credentialFor(s), session: { who: WHO[s], seat: s } } : { ok: false, why: null }; },
    async signOut() {}, async endSessionsOf() { return 0; },
  };
  globalThis.__gzUserSessions = Object.freeze({ sessions, accounts: {}, sealer: {}, seats: createZohoSeatDirectory({ recordIdPrefix: '554023', roleIds: seatIds.roleIds, profileIds: seatIds.profileIds }), gate: createGate(), log: createOpsLog({ write() {} }), recordIdPrefix: '554023' });
  delete globalThis.__gzRouteGuard;
}

const routeFile = (template) => path.join(srcRoot, 'app', template.replace(/^\//, ''), 'route.ts');

/** Call an exported handler. `seat` = console seat token ('ir', 'fin' …) or null for no session cookie. */
async function call(mod, method, url, { seat = null, body, contentType, headers = {}, params = {} } = {}) {
  const h = new Headers(headers);
  if (seat) h.set('cookie', `gz_zsid=${SID(seat)}; gz_session=${load('lib/data/session.ts').encodeSession({ who: 'kavya', seat })}`);
  const init = { method, headers: h };
  if (body !== undefined && method !== 'GET') {
    if (contentType) h.set('content-type', contentType);
    init.body = typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body);
  }
  const req = new Request('http://localhost:3002' + url, init);
  current = req;
  const before = zoho.calls;
  try {
    const res = await mod[method](req, { params: Promise.resolve(params) });
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = undefined; }
    return { status: res.status, headers: Object.fromEntries(res.headers), text, json, zohoCalls: zoho.calls - before };
  } catch (e) {
    return { status: 0, thrown: String(e && e.message || e), text: '', json: undefined, zohoCalls: zoho.calls - before };
  } finally { current = null; }
}

/* ---- M12-S10: reader-level rigs (extension; the isolation suite uses these, nothing else is added) ----------------- */
/* The real readers (documents, emails, cases reach, searches, embed) take a ZohoClient on a person's own credential. `rig(route)`
   builds one on a fetch that hands every call to `route({method,url,q,body,headers})`, which returns a recorded response
   ({status,headers,body}) or [dir,name] naming src/lib/zoho/__fixtures__/<dir>/<name>.response.json. It counts the calls, keeps
   Plane B in memory and mints credentials. Nothing reaches Zoho; an unrouted call throws (the suite fails, never guesses). */
const P_PREFIX = '9007199254';
const NOW = Date.parse('2026-09-28T06:00:00Z');
const recorded = (dir, name) => JSON.parse(fs.readFileSync(path.join(FIX, dir, `${name}.response.json`), 'utf8'));
const toResponse = (r) => new Response(r.status === 204 ? null : (r.text !== undefined ? r.text : JSON.stringify(r.body)), { status: r.status, headers: r.headers || {} });
const immediateGate = () => ({ async acquire() { return { waitedMs: 0, release() {} }; }, async run(_c, t) { return t(); }, snapshot() { return {}; } });
function rig(route) {
  const { createMemorySink, createOpsLog } = load('lib/zoho/log.ts');
  const { createZohoClient, userCredential } = load('lib/zoho/client.ts');
  const { createPlaneCLog, createPlaneCMemorySink } = load('server/identity/plane-c.ts');
  const { createInvestorEvents } = load('server/data/events.ts');
  const { createScopedCache } = load('lib/zoho/cache.ts');
  const sink = createMemorySink(); const log = createOpsLog(sink);
  const events = createInvestorEvents({ log, planeC: createPlaneCLog(createPlaneCMemorySink()), clock: () => NOW });
  const calls = [];
  const crm = createZohoClient({ recordIdPrefix: P_PREFIX, gate: immediateGate(), log, maxAttempts: 1, clock: () => NOW,
    fetch: async (url, init) => {
      const c = { method: init.method, url: decodeURIComponent(String(url)), q: typeof init.body === 'string' && init.body.startsWith('{') ? (JSON.parse(init.body).select_query ?? null) : null, body: init.body, headers: init.headers };
      calls.push(c);
      const r = route(c);
      if (!r) throw new Error('unrouted ' + c.method + ' ' + (c.q || c.url));
      return toResponse(Array.isArray(r) ? recorded(r[0], r[1]) : r);
    } });
  const cred = (id) => userCredential({ access_token: `synthetic-${id}`, api_domain: 'https://www.zohoapis.in', expires_in: 3_600 },
    { recordIdPrefix: P_PREFIX, gate: immediateGate(), log: createOpsLog(createMemorySink()), clock: () => NOW,
      fetch: async () => toResponse({ status: 200, body: { users: [{ id, status: 'active' }] } }) });
  const refusals = () => sink.records().filter((x) => x.kind === 'refusal');
  return { calls, sink, log, events, crm, cred, cache: createScopedCache({ clock: () => NOW }), refusals, logText: () => JSON.stringify(sink.records()), P: P_PREFIX, NOW };
}

module.exports = { setMode, consoleRoot, srcRoot, load, call, routeFile, installRuntime, SEATS, WHO, CANARY, zoho, rig, recorded, toResponse, immediateGate, FIX, NOW };
