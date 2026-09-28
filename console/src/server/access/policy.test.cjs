/* M03-S01-T01/T02 SERVER ACCESS POLICY
 *
 * Run from console/: node --test src/server/access/policy.test.cjs
 *
 * The server does not re-port the policy: it asks the front end's own functions (@/lib/selectors/access,
 * @/lib/data/admission). These tests (1) cover every seat of both sides of the merged prototype, (2) replay
 * the prototype probes (access-d60.test.ts) through the server's one-person book, (3) prove the server's
 * book agrees with the demo roster person by person, and (4) the staging sign-in list.
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
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'server-access-'));
process.on('exit', () => fs.rmSync(outDir, { recursive: true, force: true }));

const config = ts.readConfigFile(path.join(consoleRoot, 'tsconfig.json'), ts.sys.readFile);
const project = ts.parseJsonConfigFileContent(config.config, ts.sys, consoleRoot);
const options = {
  ...project.options, incremental: false, tsBuildInfoFile: undefined, plugins: undefined,
  module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10,
  noEmit: false, noEmitOnError: true, outDir, rootDir: consoleRoot,
};
const sources = ['src/server/access/policy.ts', 'src/server/access/signin-list.ts', 'fixtures/book/index.ts'].map((f) => path.join(consoleRoot, f));
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

const policy = load('src/server/access/policy.js');
const { signInList, signInListAllowed } = load('src/server/access/signin-list.js');
const { createZohoSeatDirectory, ZOHO_SEAT_POLICIES } = load('src/server/oauth/seat.js');
const { signInAdmits, admitted } = load('src/lib/data/admission.js');
const { consoleAccount } = load('src/lib/selectors/access.js');
const { SEATSCREENS, DEFSEATS, NOSIGN, BYGRANT } = load('src/domain/index.js');
const { ROLE } = load('src/lib/im/index.js');
const { demoBook } = load('fixtures/book/index.js');
const seatsFx = JSON.parse(fs.readFileSync(path.join(srcRoot, 'lib', 'zoho', '__fixtures__', 'oauth', 'current-user.seats.response.json'), 'utf8'));

const { ZOHO_SEAT_SIDES, admitZohoSeat, accessBook, seatAccess, readGrants, NO_GRANTS, ADMINISTRATOR_SEATS } = policy;
const LEAD_SEATS = Object.keys(SEATSCREENS);          /* ir cp conv exec ops corp bu fin am mkt */
const IM_ROLES = Object.keys(ROLE);                   /* head ops comp audit amlead kam di admin root */
const ZOHO_SEATS = [...new Set(Object.values(ZOHO_SEAT_POLICIES).map((p) => p.seat))];
const W = 'someone';

test('T01: every lead-side seat, alone — the three console seats always, granted-only seats only by a grant, Finance/AM/Marketing never', () => {
  assert.equal(LEAD_SEATS.length, 10);
  for (const seat of LEAD_SEATS) {
    const bare = accessBook(W, { lead: seat, im: null }, {});
    const granted = accessBook(W, { lead: seat, im: null }, { leads: ['view'] });
    const byDefault = DEFSEATS.includes(seat);
    const byGrant = BYGRANT.includes(seat);
    assert.equal(consoleAccount(bare.PEOPLE, W, bare.GRANT), byDefault, `${seat} without a grant`);
    assert.equal(consoleAccount(granted.PEOPLE, W, granted.GRANT), byDefault || byGrant, `${seat} with Leads · See it`);
    assert.equal(signInAdmits(granted, W), byDefault || byGrant, `${seat} signInAdmits`);
    if (NOSIGN.includes(seat)) assert.equal(signInAdmits(granted, W), false, `${seat} never signs in`);
  }
});

test('T01: every Investors-side seat, alone — each holds "view", so each is admitted on that side', () => {
  assert.equal(IM_ROLES.length, 9);
  for (const r of IM_ROLES) {
    const b = accessBook(W, { lead: 'fin', im: r }, {});
    assert.equal(signInAdmits(b, W), true, r);
    assert.equal(consoleAccount(b.PEOPLE, W, b.GRANT), false, `${r}: never through the lead door`);
  }
});

test('T01: every Zoho seat maps onto both sides; mkt, audit and admin have no D80 role', () => {
  assert.deepEqual(Object.keys(ZOHO_SEAT_SIDES).sort(), ZOHO_SEATS.sort());
  const leads = new Set(Object.values(ZOHO_SEAT_SIDES).map((s) => s.lead));
  const ims = new Set(Object.values(ZOHO_SEAT_SIDES).map((s) => s.im).filter(Boolean));
  assert.deepEqual(LEAD_SEATS.filter((s) => !leads.has(s)), ['mkt']);
  assert.deepEqual(IM_ROLES.filter((r) => !ims.has(r)).sort(), ['admin', 'audit']);
  assert.deepEqual([...ADMINISTRATOR_SEATS].sort(), ['corporate-root', 'digital-infrastructure']);
});

test('T02: admission for every Zoho seat, with and without a grant', () => {
  const want = {
    'corporate-root': ['no-seat', 'no-seat'], 'digital-infrastructure': ['no-seat', 'no-seat'],   /* Administrator profile */
    'ir-manager': ['leads', 'leads'], 'investor-relations': ['leads', 'leads'],
    'business-unit-owner': ['no-grant', 'leads'], 'channel-partner': ['no-grant', 'leads'], viewer: ['no-grant', 'leads'],
    'head-of-finance': ['investors', 'investors'], 'finance-operations': ['investors', 'investors'],
    'compliance-audit': ['investors', 'investors'], 'head-of-account-management': ['investors', 'investors'],
    'key-account-manager': ['investors', 'investors'],
  };
  assert.deepEqual(Object.keys(want).sort(), ZOHO_SEATS.sort());
  const side = (a) => (a.ok ? (a.sides.leads ? 'leads' : 'investors') : a.code);
  for (const [z, [bare, granted]] of Object.entries(want)) {
    assert.equal(side(admitZohoSeat(z, W, {})), bare, `${z} bare`);
    assert.equal(side(admitZohoSeat(z, W, { leads: ['view'] })), granted, `${z} granted Leads`);
  }
  assert.equal(admitZohoSeat('corporate-root', W, {}).reason, 'administrator-profile');
  assert.equal(admitZohoSeat('marketing', W, {}).reason, 'unknown-role');
  assert.equal(admitZohoSeat('__proto__', W, {}).ok, false);
});

test('T01: the prototype probes (access-d60.test.ts) hold through the server book', () => {
  /* the Operations Lead's seat presets nothing but Profile; a granted-only seat has no console until a page is granted */
  const bare = seatAccess('viewer', 'jhalak', {});
  assert.equal(bare.admission.ok, false);
  assert.deepEqual(bare.reach, []);
  /* granting Leads · See it admits her to Leads only */
  const j = seatAccess('viewer', 'jhalak', { leads: ['view'] });
  assert.equal(j.admission.ok, true);
  assert.deepEqual([...j.reach].sort(), ['leads', 'me', 'teamscope']);
  assert.deepEqual(j.capsFor('leads'), ['view']);
  assert.equal(j.may('leads', 'view'), true);
  assert.equal(j.hasCap('leads', 'edit'), false);
  /* an Operations Lead's role can never hold Change things on Leads */
  assert.deepEqual(j.seatShape('leads', ['view', 'edit', 'assign']), ['view']);
  /* reachCeil: the seat's ceiling, bounded by the chain (none read from Zoho yet) */
  assert.deepEqual(seatAccess('channel-partner', W, {}).ceiling, SEATSCREENS.cp);
  /* an IR carries their default grid; an IR Manager assigns */
  const ir = seatAccess('investor-relations', W, {});
  assert.equal(ir.may('leads', 'edit'), true);
  assert.equal(ir.may('leads', 'assign'), false);
  assert.equal(seatAccess('ir-manager', W, {}).may('leads', 'assign'), true);
  /* Investors side: Finance reads bank details, a KAM does not; nobody refused holds anything */
  assert.equal(seatAccess('head-of-finance', W, {}).imCan('bank'), true);
  assert.equal(seatAccess('key-account-manager', W, {}).imCan('bank'), false);
  assert.equal(seatAccess('head-of-finance', W, {}).may('leads', 'view'), false);
  assert.equal(seatAccess('digital-infrastructure', W, {}).imCan('view'), false);
});

test('T01: the server book agrees with the front end on every person of the demo roster', () => {
  const ds = demoBook();
  const rows = [];
  for (const k of ds.SIGNINS) {
    const p = ds.PEOPLE[k];
    if (!p.on) continue;                                            /* inactive: refused by seat.ts before policy */
    const im = ds.im.P[k] && ds.im.SIGNINS.includes(k) ? ds.im.P[k].r : null;
    const b = accessBook(k, { lead: p.seat, im }, ds.GRANT[k] || {});
    assert.equal(signInAdmits(b, k), signInAdmits(ds, k), k);
    rows.push(k);
  }
  assert.ok(rows.length >= 15);
  /* the merged prototype's list: Harsha (Finance) is in, Gokul (Marketing) and Jhalak/Arvind (no grant) are out */
  const list = admitted(ds);
  assert.ok(list.includes('harsha') && !list.includes('gokul') && !list.includes('jhalak') && !list.includes('arvind'));
});

test('T02: grants are read through an injectable reader that fails closed', async () => {
  assert.deepEqual(await readGrants(NO_GRANTS, W, 'exec'), {});
  assert.deepEqual(await readGrants({ grantsOf: () => { throw new Error('down'); } }, W, 'exec'), {});
  assert.deepEqual(await readGrants({ grantsOf: async () => null }, W, 'exec'), {});
  assert.deepEqual(await readGrants({ grantsOf: () => ({ leads: ['view', 7] }) }, W, 'exec'), { leads: ['view'] });
});

test('T02: the staging sign-in list offers exactly the Zoho users the callback would admit', async () => {
  const dir = createZohoSeatDirectory({ recordIdPrefix: seatsFx.recordIdPrefix, roleIds: seatsFx.roleIds, profileIds: seatsFx.profileIds });
  const users = [
    ...seatsFx.accepted.map((c) => ({ ...c.body.users[0], full_name: c.seat })),
    ...seatsFx.administratorRefused.map((c) => ({ ...c.body.users[0], full_name: c.mappedSeat })),
    ...seatsFx.refused.flatMap((c) => (c.body && Array.isArray(c.body.users) ? c.body.users : [])).map((u) => ({ ...u, full_name: 'refused' })),
  ];
  const listed = (await signInList({ users }, dir, NO_GRANTS)).map((r) => r.name).sort();
  assert.deepEqual(listed, ['compliance-audit', 'finance-operations', 'head-of-account-management', 'head-of-finance',
    'investor-relations', 'ir-manager', 'key-account-manager']);
  const withGrant = await signInList({ users }, dir, { grantsOf: (id, seat) => (seat === 'exec' ? { leads: ['view'] } : {}) });
  assert.ok(withGrant.some((r) => r.seat === 'viewer'));
  assert.ok(!withGrant.some((r) => r.seat === 'business-unit-owner'));
  assert.deepEqual(await signInList(null, dir, NO_GRANTS), []);
  assert.equal(signInListAllowed({ NODE_ENV: 'production' }), false);
  assert.equal(signInListAllowed({ NODE_ENV: 'production', GZ_SIGNIN_LIST: 'staging' }), true);
  assert.equal(signInListAllowed({ NODE_ENV: 'development' }), true);
});
