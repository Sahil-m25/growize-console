/* Shared rig for farms/events/cases tests: compiles the named TS modules with the project's settings and
 * replays recorded Zoho responses (src/lib/zoho/__fixtures__). No request reaches Zoho. */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const consoleRoot = path.resolve(__dirname, '..', '..', '..');
const srcRoot = path.join(consoleRoot, 'src');
const fx = path.join(srcRoot, 'lib', 'zoho', '__fixtures__');
const P = '9007199254';
const NOW = Date.parse('2026-09-28T06:00:00Z');

function compile(files) {
  const ts = require(path.join(consoleRoot, 'node_modules', 'typescript'));
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoho-fec-'));
  process.on('exit', () => fs.rmSync(outDir, { recursive: true, force: true }));
  const config = ts.readConfigFile(path.join(consoleRoot, 'tsconfig.json'), ts.sys.readFile);
  const project = ts.parseJsonConfigFileContent(config.config, ts.sys, consoleRoot);
  const options = { ...project.options, incremental: false, tsBuildInfoFile: undefined, plugins: undefined,
    module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10, noEmit: false, noEmitOnError: true, outDir, rootDir: srcRoot };
  const program = ts.createProgram(files.map((f) => path.join(srcRoot, f)), options);
  const diagnostics = [...ts.getPreEmitDiagnostics(program), ...program.emit().diagnostics];
  if (diagnostics.length) {
    console.error(ts.formatDiagnostics(diagnostics, { getCanonicalFileName: (f) => f, getCurrentDirectory: () => consoleRoot, getNewLine: () => '\n' }));
    process.exit(1);
  }
  const Module = require('node:module');
  process.env.NODE_PATH = path.join(consoleRoot, 'node_modules');
  Module._initPaths();
  const resolve = Module._resolveFilename;
  Module._resolveFilename = function (request, ...rest) { return resolve.call(this, request.startsWith('@/') ? path.join(outDir, request.slice(2)) : request, ...rest); };
  return (f) => require(path.join(outDir, f));
}

const recorded = (dir, name) => JSON.parse(fs.readFileSync(path.join(fx, dir, `${name}.response.json`), 'utf8'));
const toResponse = (r) => new Response(r.status === 204 ? null : JSON.stringify(r.body), { status: r.status, headers: r.headers || {} });
const immediateGate = () => ({ async acquire() { return { waitedMs: 0, release() {} }; }, async run(_c, t) { return t(); }, snapshot() { return {}; } });

/** A client, cache, Plane B sink and events on a fetch that routes each COQL query through `route(q)` → {dir,name}|response. */
async function makeRig(load, route) {
  const { createMemorySink, createOpsLog } = load('lib/zoho/log.js');
  const { createZohoClient, userCredential } = load('lib/zoho/client.js');
  const { createScopedCache } = load('lib/zoho/cache.js');
  const { createPlaneCLog, createPlaneCMemorySink } = load('server/identity/plane-c.js');
  const { createInvestorEvents } = load('server/data/events.js');
  const sink = createMemorySink();
  const log = createOpsLog(sink);
  const events = createInvestorEvents({ log, planeC: createPlaneCLog(createPlaneCMemorySink()), clock: () => NOW });
  const queries = [];
  const crm = createZohoClient({ recordIdPrefix: P, gate: immediateGate(), log, maxAttempts: 1, clock: () => NOW,
    fetch: async (_url, init) => { const q = JSON.parse(init.body).select_query; queries.push(q); const r = route(q); return toResponse(Array.isArray(r) ? recorded(r[0], r[1]) : r); } });
  const cache = createScopedCache({ clock: () => NOW });
  const cred = async (id) => userCredential({ access_token: `synthetic-${id}`, api_domain: 'https://www.zohoapis.in', expires_in: 3_600 },
    { recordIdPrefix: P, gate: immediateGate(), log: createOpsLog(createMemorySink()), clock: () => NOW,
      fetch: async () => toResponse({ status: 200, body: { users: [{ id, status: 'active' }] } }) });
  return { crm, cache, events, sink, queries, cred };
}


/** As makeRig, for writers: `route({ method, path, body, query, headers })` → [dir, name] | response.
 *  Every call is kept in `calls` (method, path, parsed body, headers) so a test can assert what was written. */
async function makeHttpRig(load, route) {
  const calls = [];
  const rig = await makeRig(load, () => { throw new Error('unused'); });
  const { createMemorySink, createOpsLog } = load('lib/zoho/log.js');
  const { createZohoClient } = load('lib/zoho/client.js');
  const crm = createZohoClient({ recordIdPrefix: P, gate: immediateGate(), log: createOpsLog(rig.sink), maxAttempts: 1, clock: () => NOW,
    fetch: async (url, init) => {
      const u = new URL(String(url));
      const body = init.body ? JSON.parse(init.body) : null;
      const headers = Object.fromEntries(new Headers(init.headers || {}).entries());
      const c = { method: init.method || 'GET', path: u.pathname.replace(/^\/crm\/v\d+/, ''), body, query: body && body.select_query, headers };
      calls.push(c);
      const r = route(c);
      return toResponse(Array.isArray(r) ? recorded(r[0], r[1]) : r);
    } });
  return { ...rig, crm, calls, writes: () => calls.filter((c) => c.path !== '/coql') };
}

module.exports = { compile, makeRig, makeHttpRig, recorded, P, NOW };
