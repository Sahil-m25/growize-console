/* M17-S05 OWN PROFILE
 *
 * Run from console/: node src/server/people/profile.test.cjs
 *
 * Type-checks the capture boundary with the project's TypeScript, then drives it through the real
 * Zoho client with sanitized recorded responses only. No request reaches Zoho; every fixture is
 * synthetic. Whether live Zoho accepts the new picklist values and fields is M04-S01-T01's check.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { before, test } = require('node:test');

const consoleRoot = path.resolve(__dirname, '..', '..', '..');
const srcRoot = path.join(consoleRoot, 'src');
const fixtureRoot = path.join(srcRoot, 'lib', 'zoho', '__fixtures__', 'people');
const ts = require(path.join(consoleRoot, 'node_modules', 'typescript'));
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoho-people-'));
process.on('exit', () => fs.rmSync(outDir, { recursive: true, force: true }));

const config = ts.readConfigFile(path.join(consoleRoot, 'tsconfig.json'), ts.sys.readFile);
const project = ts.parseJsonConfigFileContent(config.config, ts.sys, consoleRoot);
const options = {
  ...project.options,
  incremental: false,
  tsBuildInfoFile: undefined,
  plugins: undefined,
  module: ts.ModuleKind.CommonJS,
  moduleResolution: ts.ModuleResolutionKind.Node10,
  noEmit: false,
  noEmitOnError: true,
  outDir,
  rootDir: srcRoot,
};
const sources = [
  'lib/zoho/errors.ts',
  'lib/zoho/gate.ts',
  'lib/zoho/log.ts',
  'lib/zoho/client.ts',
  'server/oauth/seat.ts',
  'domain/plan.ts',
  'server/leads/capture.ts',
  'server/people/profile.ts',
].map((file) => path.join(srcRoot, file));
const format = (items) => ts.formatDiagnostics(items, {
  getCanonicalFileName: (file) => file,
  getCurrentDirectory: () => consoleRoot,
  getNewLine: () => '\n',
});
const program = ts.createProgram(sources, options);
const diagnostics = ts.getPreEmitDiagnostics(program);
if (diagnostics.length) {
  console.error(format(diagnostics));
  process.exit(1);
}
const emitted = program.emit();
if (emitted.diagnostics.length) {
  console.error(format(emitted.diagnostics));
  process.exit(1);
}



const load = (file) => require(path.join(outDir, file));
const { createMemorySink, createOpsLog } = load(path.join('lib', 'zoho', 'log.js'));
const { createZohoClient, userCredential } = load(path.join('lib', 'zoho', 'client.js'));
const { createProfile } = load(path.join('server', 'people', 'profile.js'));
const P = '9007199254';
const ME = `${P}740995001`;
const NOW = Date.parse('2026-09-27T15:30:00Z');
const recorded = (name) => JSON.parse(fs.readFileSync(path.join(fixtureRoot, `${name}.response.json`), 'utf8'));
const toResponse = (r) => new Response(JSON.stringify(r.body), { status: r.status, headers: r.headers || {} });
const immediateGate = () => ({ async acquire() { return { waitedMs: 0, release() {} }; } });
let cred;
before(async () => { cred = await userCredential({ access_token: 'synthetic-me', api_domain: 'https://www.zohoapis.in', expires_in: 3_600 },
  { recordIdPrefix: P, gate: immediateGate(), log: createOpsLog(createMemorySink()), clock: () => NOW,
    fetch: async () => toResponse({ status: 200, body: { users: [{ id: ME, status: 'active' }] } }) }); });
const principal = () => ({ credential: cred, sessionId: 'session_fixture_profile_1' });
function rig(reply = 'user.updated', live = true) {
  const calls = [];
  const crm = createZohoClient({ recordIdPrefix: P, gate: immediateGate(), log: createOpsLog(createMemorySink()), maxAttempts: 1, clock: () => NOW,
    fetch: async (url, init) => { calls.push({ path: new URL(url).pathname, method: init.method, body: JSON.parse(init.body) }); return toResponse(recorded(reply)); } });
  return { svc: createProfile({ crm, session: { async recheck() { return live; } }, log: createOpsLog(createMemorySink()), clock: () => NOW }), calls };
}

test('my name and mobile are saved on my own Zoho user, and only mine', async () => {
  const r = rig();
  const res = await r.svc.update(principal(), { name: 'Synthetic  Profile Name', mobile: '98450 33021' });
  assert.deepEqual(res, { ok: true, value: { name: 'Synthetic Profile Name', mobile: '+919845033021' } });
  assert.deepEqual(r.calls, [{ path: `/crm/v8/users/${ME}`, method: 'PUT', body: { users: [{ first_name: 'Synthetic Profile', last_name: 'Name', mobile: '+919845033021' }] } }]);
});

test('a short name, a bad mobile or an email change is refused and nothing is written', async () => {
  const r = rig();
  assert.equal((await r.svc.update(principal(), { name: 'A' })).reasonCode, 'name-too-short');
  assert.equal((await r.svc.update(principal(), { name: 'Synthetic Name', mobile: '123' })).reasonCode, 'invalid-mobile');
  assert.equal((await r.svc.update(principal(), { name: 'Synthetic Name', email: 'x@example.invalid' })).reasonCode, 'email-read-only');
  assert.equal((await rig('user.updated', false).svc.update(principal(), { name: 'Synthetic Name' })).reasonCode, 'session-changed');
  assert.equal(r.calls.length, 0);
});

test('Zoho refusing the change comes back as an error, not a save', async () => {
  const res = await rig('user.no-permission').svc.update(principal(), { name: 'Synthetic Name' });
  assert.equal(res.ok, false);
  assert.equal(res.kind, 'source-error');
});

test('B-26: a mobile alone is saved with no name (the name is left as it is); a blank name is still refused; nothing at all is invalid', async () => {
  const r = rig();
  const res = await r.svc.update(principal(), { mobile: '+91 90000 07781' });
  assert.deepEqual(res, { ok: true, value: { name: null, mobile: '+919000007781' } });
  assert.deepEqual(r.calls, [{ path: `/crm/v8/users/${ME}`, method: 'PUT', body: { users: [{ mobile: '+919000007781' }] } }]);
  const q = rig();
  assert.equal((await q.svc.update(principal(), { name: '', mobile: '+91 90000 07781' })).reasonCode, 'name-too-short');
  assert.equal((await q.svc.update(principal(), {})).reasonCode, 'invalid-request');
  assert.equal(q.calls.length, 0);
});
