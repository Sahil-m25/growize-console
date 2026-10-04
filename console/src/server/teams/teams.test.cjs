/* M17-S01-T01 TEAMS FROM ZOHO — members, roles and profiles (GET /users?type=AllUsers, /settings/roles,
 * /settings/profiles) joined with the grant store into member, seat, team and the rights grid, scoped by seat,
 * replayed from recorded fixtures (__fixtures__/teams). Never live Zoho.
 *
 * Run from console/: node --test src/server/teams/teams.test.cjs
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const test = require('node:test');

const consoleRoot = path.resolve(__dirname, '..', '..', '..');
const ts = require(path.join(consoleRoot, 'node_modules', 'typescript'));
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'server-teams-'));
process.on('exit', () => fs.rmSync(outDir, { recursive: true, force: true }));
const config = ts.readConfigFile(path.join(consoleRoot, 'tsconfig.json'), ts.sys.readFile);
const project = ts.parseJsonConfigFileContent(config.config, ts.sys, consoleRoot);
const options = {
  ...project.options, incremental: false, tsBuildInfoFile: undefined, plugins: undefined,
  module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10,
  noEmit: false, noEmitOnError: true, outDir, rootDir: consoleRoot,
};
const sources = ['src/server/teams/service.ts', 'src/server/access/grants.ts', 'src/lib/zoho/client.ts', 'src/lib/zoho/log.ts'].map((f) => path.join(consoleRoot, f));
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
const FXDIR = path.join(consoleRoot, 'src', 'lib', 'zoho', '__fixtures__');
const FX = (area, name) => JSON.parse(fs.readFileSync(path.join(FXDIR, area, name), 'utf8'));

const { createTeamsService, IN_MAX } = load('src/server/teams/service.js');
const { seatOrg, rightsGrid, TEAMS_REFUSALS } = load('src/server/teams/teams.js');
const { createGrantStore, grantReaderOf } = load('src/server/access/grants.js');
const { createZohoSeatDirectory } = load('src/server/oauth/seat.js');
const { createZohoClient, userCredential } = load('src/lib/zoho/client.js');
const { createMemorySink, createOpsLog } = load('src/lib/zoho/log.js');
const { createScopedCache } = load('src/lib/zoho/cache.js');

const P = '554023000000';
const U = (nn) => P + '3000' + nn;
const T0 = Date.parse('2026-09-28T12:00:00+05:30');
const seatsFx = FX('oauth', 'current-user.seats.response.json');
const pinned = { roleIds: seatsFx.roleIds, profileIds: seatsFx.profileIds };
const seats = createZohoSeatDirectory({ recordIdPrefix: seatsFx.recordIdPrefix, ...pinned });
const gate = () => ({ async acquire() { return { waitedMs: 0, release() {} }; } });
const toResponse = (rec) => new Response(JSON.stringify(rec.body), { status: rec.status, headers: rec.headers || {} });
const ALL_USERS = [...FX('teams', 'users.all.page1.response.json').body.users, ...FX('teams', 'users.all.page2.response.json').body.users];

async function credentialOf(id) {
  const body = { users: [ALL_USERS.find((u) => u.id === id)] };
  return userCredential({ access_token: `synthetic-${id}-token-never-live`, api_domain: 'https://www.zohoapis.in', expires_in: 3600 },
    { recordIdPrefix: '554023', gate: gate(), log: createOpsLog(createMemorySink()), clock: () => T0,
      fetch: async () => new Response(JSON.stringify(body), { status: 200 }) });
}

/** users: page-fixture override; roles/profiles: fixture names; agg: (module) => fixture name */
function rig({ users = (p) => `users.all.page${p}`, roles = 'settings.roles', profiles = 'settings.profiles', agg = (m) => (m === 'Leads' ? 'coql.leads-by-owner' : 'coql.accounts-by-kam'), grants = createGrantStore(), cache = createScopedCache({ clock: () => T0 }) } = {}) {
  const calls = [];
  const sink = createMemorySink();
  const log = createOpsLog(sink);
  const crm = createZohoClient({ recordIdPrefix: '554023', gate: gate(), log, maxAttempts: 1, clock: () => T0,
    fetch: async (url, init) => {
      const u = new URL(url);
      const call = { method: init.method, path: u.pathname, query: Object.fromEntries(u.searchParams), body: init.body ? JSON.parse(init.body) : null, auth: init.headers.Authorization };
      calls.push(call);
      if (u.pathname === '/crm/v8/users') return toResponse(FX('teams', `${users(u.searchParams.get('page'))}.response.json`));
      if (u.pathname === '/crm/v8/settings/roles') return toResponse(FX('teams', `${roles}.response.json`));
      if (u.pathname === '/crm/v8/settings/profiles') return toResponse(FX('teams', `${profiles}.response.json`));
      if (u.pathname === '/crm/v8/coql') return toResponse(FX('teams', `${agg(/from (\w+)/.exec(call.body.select_query)[1])}.response.json`));
      throw new Error(`unexpected ${init.method} ${u.pathname}`);
    } });
  const svc = createTeamsService({ crm, seats, pinned, grants: grantReaderOf(grants), cache, log, clock: () => T0 });
  return { svc, calls, sink };
}

async function listAs(r, nn, token) { return r.svc.list(await credentialOf(U(nn)), { who: U(nn), seat: token }); }

test('client: listUsers pages GET /users?type=AllUsers on the caller\'s own token; roles and profiles are ids and names only', async () => {
  const r = rig();
  const res = await listAs(r, '04', 'conv');
  assert.equal(res.ok, true);
  const users = r.calls.filter((c) => c.path === '/crm/v8/users');
  assert.deepEqual(users.map((c) => [c.query.type, c.query.page, c.query.per_page]), [['AllUsers', '1', '200'], ['AllUsers', '2', '200']]);
  assert.ok(r.calls.every((c) => c.auth === `Zoho-oauthtoken synthetic-${U('04')}-token-never-live`), 'every call on the viewer\'s own token (D53)');
  assert.ok(r.calls.some((c) => c.path === '/crm/v8/settings/roles') && r.calls.some((c) => c.path === '/crm/v8/settings/profiles'));
});

test('seatOrg: every user seated from pinned role/profile ids; a deactivated user is seated and marked left; an unknown role is a count', () => {
  const org = seatOrg(ALL_USERS, seats);
  assert.equal(org.members.length, 18);
  assert.equal(org.unseated, 1);
  assert.deepEqual(org.members.filter((m) => m.left).map((m) => m.id).sort(), [U('17'), U('18')]);
  assert.equal(org.members.find((m) => m.id === U('17')).seat, 'investor-relations');
  assert.equal(org.members.find((m) => m.id === U('03')).seat, 'digital-infrastructure');
});

test('IR Manager: herself and her IRs, the leaver marked left and flagged for handover; opens only her IRs; no emails', async () => {
  const r = rig();
  const res = await listAs(r, '04', 'conv');
  assert.equal(res.ok, true);
  const v = res.view;
  assert.deepEqual(v.members.map((m) => m.id), [U('04'), U('05'), U('14'), U('15'), U('16'), U('17')]);
  assert.equal(v.activeMembers, 5);
  assert.equal(v.members[0].you, true);
  assert.equal(v.members[0].canOpen, false);
  assert.deepEqual(v.members.filter((m) => m.canOpen).map((m) => m.id), [U('05'), U('14'), U('15'), U('16')]);
  const left = v.members.find((m) => m.id === U('17'));
  assert.equal(left.status, 'left'); assert.equal(left.handover, true); assert.equal(left.leads, 6); assert.equal(left.canOpen, false);
  assert.equal(v.members.find((m) => m.id === U('16')).leads, 0);
  assert.equal(v.members.find((m) => m.id === U('05')).managerId, U('04'));
  assert.equal(v.investorsSide, null);
  assert.equal(v.header, 'read only');
  assert.equal(v.unseated, null);
  const text = JSON.stringify(v);
  assert.ok(!/@example\.invalid|\+91/.test(text), 'no email or phone on the lead-side list');
  const q = r.calls.find((c) => c.path === '/crm/v8/coql').body.select_query;
  assert.match(q, /^select Owner, COUNT\(id\) from Leads where Owner in \('\d+'(, '\d+'){5}\) group by Owner limit 0, 2000$/);
});

test('IR Manager: a member outside her chain cannot be opened; her own IR can, with pages, grants and chain', async () => {
  const grants = createGrantStore();
  grants.set({ at: T0, by: U('04'), whom: U('05'), page: 'today', caps: ['view'] });
  const r = rig({ grants });
  const cred = await credentialOf(U('04'));
  const ok = await r.svc.member(cred, { who: U('04'), seat: 'conv' }, U('05'));
  assert.equal(ok.ok, true);
  assert.equal(ok.detail.side, 'lead');
  assert.deepEqual(ok.detail.chain.map((c) => c.id), [U('04'), U('02'), U('01')]);
  assert.deepEqual(ok.detail.grants, { today: ['view'] });
  assert.equal(ok.detail.email, null, 'an IR Manager does not change seats: no one else\'s email');
  assert.ok(ok.detail.pages.length > 0);
  for (const id of [U('07'), U('17'), U('11')]) {
    const no = await r.svc.member(cred, { who: U('04'), seat: 'conv' }, id);
    assert.equal(no.ok, false); assert.equal(no.status, 403); assert.equal(no.code, 'cannot-open');
  }
  const refusals = r.sink.records().filter((l) => l.kind === 'refusal' || l.action === 'teams-member');
  assert.ok(refusals.length >= 3);
});

test('Head of Finance: the Investors side seats with team and seat, every email, seat dropdowns but not her own', async () => {
  const r = rig();
  const res = await listAs(r, '07', 'head');
  assert.equal(res.ok, true);
  const v = res.view;
  assert.equal(v.header, 'you can change seats');
  const rows = v.investorsSide;
  assert.deepEqual(rows.map((x) => x.id).sort(), [U('01'), U('03'), U('07'), U('08'), U('09'), U('10'), U('11'), U('12'), U('13'), U('18')].sort());
  const me = rows.find((x) => x.you);
  assert.equal(me.id, U('07')); assert.equal(me.seatLabel, 'Head of Finance'); assert.deepEqual(me.seatOptions, []);
  assert.equal(me.team, 'Finance, Legal & Compliance');
  assert.ok(rows.find((x) => x.id === U('08')).seatOptions.length > 0);
  assert.equal(rows.find((x) => x.id === U('11')).team, 'Account Management');
  assert.equal(rows.find((x) => x.id === U('12')).role, null, 'a viewer seat holds no Investors seat');
  assert.ok(rows.filter((x) => x.status === 'active').every((x) => typeof x.email === 'string'));
  assert.equal(rows.find((x) => x.id === U('11')).accounts, 14);
  const leaver = rows.find((x) => x.id === U('18'));
  assert.equal(leaver.status, 'left'); assert.equal(leaver.handover, true); assert.deepEqual(leaver.seatOptions, []);
  assert.ok(!/\+91/.test(JSON.stringify(v)), 'never a phone');
});

test('KAM and viewer: read only, no seat control, exactly one email — their own', async () => {
  for (const [nn, token] of [['11', 'kam'], ['12', 'exec']]) {
    const res = await listAs(rig(), nn, token);
    assert.equal(res.ok, true, `${token} opens Teams`);
    const v = res.view;
    assert.equal(v.header, 'read only');
    assert.ok(v.investorsSide.every((x) => x.seatOptions.length === 0 && !x.otherTeam));
    const emails = v.investorsSide.map((x) => x.email).filter(Boolean);
    assert.deepEqual(emails, [`user${nn}@example.invalid`]);
  }
  const kam = await listAs(rig(), '11', 'kam');
  const acc = Object.fromEntries(kam.view.investorsSide.filter((x) => x.accounts !== null).map((x) => [x.id, x.accounts]));
  assert.deepEqual(acc, { [U('11')]: 14, [U('18')]: 5 }, 'a KAM sees their own book count, and a leaver\'s for handover');
});

test('Sahil (Digital Infrastructure): every member on both sides; seats can be changed; Finance has no login here', async () => {
  const res = await listAs(rig(), '03', 'ops');
  assert.equal(res.ok, true);
  const v = res.view;
  assert.equal(v.superUser, true);
  assert.equal(v.header, 'you can change seats');
  assert.equal(v.members.length, 18);
  assert.equal(v.activeMembers, 16);
  assert.ok(v.investorsSide.length >= 9);
  assert.equal(v.members.find((m) => m.id === U('07')).loginHere, false);
  assert.equal(v.members.find((m) => m.id === U('07')).investorsSide, true);
  assert.equal(v.unseated, 1);
});

test('an IR is refused with an in-page note (403 no-teams) and Plane B holds ids only', async () => {
  const r = rig();
  const res = await listAs(r, '05', 'ir');
  assert.equal(res.ok, false); assert.equal(res.status, 403); assert.equal(res.code, 'no-teams');
  assert.equal(res.message, TEAMS_REFUSALS['no-teams']);
  const text = JSON.stringify(r.sink.records());
  assert.match(text, /teams-open/);
  assert.ok(!/Test User|example\.invalid|synthetic-/.test(text), 'no name, email or token in the log');
});

test('a session seat token that no longer matches Zoho is refused (seat-moved)', async () => {
  const res = await listAs(rig(), '05', 'conv');
  assert.equal(res.ok, false); assert.equal(res.code, 'seat-moved');
});

test('counts are cached by the viewer\'s scope (aggregates only); a failed count read says unavailable, not zero', async () => {
  const cache = createScopedCache({ clock: () => T0 });
  const r1 = rig({ cache });
  assert.equal((await listAs(r1, '04', 'conv')).counts, 'live');
  const r2 = rig({ cache });
  const again = await listAs(r2, '04', 'conv');
  assert.equal(again.counts, 'cached');
  assert.equal(r2.calls.filter((c) => c.path === '/crm/v8/coql').length, 0);
  assert.equal(again.view.members.find((m) => m.id === U('05')).leads, 12);
  const bad = await listAs(rig({ agg: () => 'coql.aggregate.failed' }), '04', 'conv');
  assert.equal(bad.ok, true); assert.equal(bad.counts, 'unavailable');
  assert.ok(bad.view.members.every((m) => m.leads === null && m.handover === false));
  assert.equal(IN_MAX, 100);
});

test('Users unreadable: 503, nothing shown', async () => {
  const res = await listAs(rig({ users: () => 'coql.aggregate.failed' }), '04', 'conv');
  assert.equal(res.ok, false); assert.equal(res.status, 503); assert.equal(res.code, 'zoho-unavailable');
});

test('rights grid: one column per seat from Zoho roles and profiles; drift named; unreadable settings fall back to the pinned policy', async () => {
  const res = await listAs(rig(), '07', 'head');
  const g = res.grid;
  assert.equal(g.source, 'zoho');
  assert.equal(g.columns.length, 13);
  assert.deepEqual(g.columns.slice(0, 8).map((c) => c.seat), ['head', 'ops', 'comp', 'audit', 'amlead', 'kam', 'di', 'admin']);
  assert.ok(!g.columns.some((c) => c.seat === 'root'));
  const zr = (k) => g.columns.find((c) => c.seat === k).zohoRole;
  assert.equal(zr('audit'), 'Compliance and Audit'); assert.equal(zr('comp'), 'Compliance and Audit'); assert.equal(zr('admin'), 'Digital Infrastructure'); assert.equal(zr('kam'), 'Key Account Manager');
  assert.deepEqual(g.columns.find((c) => c.seat === 'audit').rights, ['view']);
  assert.ok(g.columns.slice(8).every((c) => c.im === null && c.provisional && c.rights.length === 0));
  assert.ok(g.columns.every((c) => !c.drift));
  const head = g.columns.find((c) => c.seat === 'head');
  assert.equal(head.profileName, 'Finance Head'); assert.equal(head.im, 'head'); assert.ok(head.rights.includes('team'));
  assert.equal(g.columns.filter((c) => c.im !== null).length, 8);
  assert.ok(g.columns.find((c) => c.seat === 'di').pages.length > 0);
  assert.ok(g.rights.some((x) => x.key === 'pii'));
  const drift = await listAs(rig({ profiles: 'settings.profiles.drift' }), '07', 'head');
  assert.deepEqual(drift.grid.columns.filter((c) => c.drift).map((c) => c.seat), ['kam']);
  const pin = await listAs(rig({ roles: 'settings.roles.no-permission' }), '11', 'kam');
  assert.equal(pin.ok, true); assert.equal(pin.grid.source, 'pinned'); assert.equal(pin.grid.columns.length, 13);
  assert.deepEqual(rightsGrid(null, null, pinned).columns.map((c) => c.drift), new Array(13).fill(false));
});

test('M17-S01-W2: the person drawer\'s clash, changed-from-the-seat and availability come with the member (no new read, no identity)', async () => {
  const grants = createGrantStore();
  grants.set({ at: T0, by: U('04'), whom: U('05'), page: 'leads', caps: ['view'] });
  const r = rig({ grants });
  const cred = await credentialOf(U('04'));
  const one = await r.svc.member(cred, { who: U('04'), seat: 'conv' }, U('05'));
  assert.equal(one.ok, true);
  const d = one.detail;
  assert.deepEqual(d.changed.map((c) => c.p), ['leads']);
  assert.equal(d.changed[0].gone, false);
  assert.deepEqual([...d.changed[0].off], ['edit'], 'the grant took Edit off their seat');
  assert.deepEqual(d.changed[0].on, []);
  assert.deepEqual(d.clash, [], 'their manager reaches every page their seat asks for');
  assert.deepEqual({ ...d.availability }, { out: false, soon: false, detail: 'No absence is recorded', cover: '' });
  // the same call reads the same Zoho as the list did: users, roles, profiles, one count — nothing for availability
  assert.ok(r.calls.every((c) => ['/crm/v8/users', '/crm/v8/settings/roles', '/crm/v8/settings/profiles', '/crm/v8/coql'].includes(c.path)));
  // a member nobody changed has nothing to flag
  const plain = await rig().svc.member(cred, { who: U('04'), seat: 'conv' }, U('14'));
  assert.equal(plain.ok, true);
  assert.deepEqual([plain.detail.changed.length, plain.detail.clash.length], [0, 0]);
  assert.ok(!/@example\.invalid|\+91/.test(JSON.stringify(plain.detail)), 'no email or phone for someone whose seat the viewer does not change');
});
