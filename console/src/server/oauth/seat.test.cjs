/* M03-S05 SEAT RESOLUTION REGRESSION
 *
 * Run from console/: node src/server/oauth/seat.test.cjs
 *
 * Compiles the production resolver with the project's strict TypeScript settings, then exercises
 * only sanitized CurrentUser recordings. It never calls Zoho and contains no real user data.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const consoleRoot = path.resolve(__dirname, '..', '..', '..');
const srcRoot = path.join(consoleRoot, 'src');
const fixturePath = path.join(srcRoot, 'lib', 'zoho', '__fixtures__', 'oauth', 'current-user.seats.response.json');
const ts = require(path.join(consoleRoot, 'node_modules', 'typescript'));
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoho-seat-'));
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
const source = path.join(srcRoot, 'server', 'oauth', 'seat.ts');
const format = (items) => ts.formatDiagnostics(items, {
  getCanonicalFileName: (file) => file,
  getCurrentDirectory: () => consoleRoot,
  getNewLine: () => '\n',
});
const program = ts.createProgram([source], options);
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

const {
  createZohoSeatDirectory,
  ZOHO_SEAT_POLICIES,
} = require(path.join(outDir, 'server', 'oauth', 'seat.js'));
const recording = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const directoryConfig = () => ({
  recordIdPrefix: recording.recordIdPrefix,
  roleIds: structuredClone(recording.roleIds),
  profileIds: structuredClone(recording.profileIds),
});
const directory = createZohoSeatDirectory(directoryConfig());

test('M03-S05: every decided non-administrator D80 role resolves to its exact backend seat', () => {
  assert.equal(recording.accepted.length, 10);
  for (const row of recording.accepted) {
    const result = directory.resolveCurrentUser(row.body);
    assert.equal(result.ok, true, row.seat);
    assert.equal(result.value.seat, row.seat);
    assert.match(result.value.userId, /^554023\d+$/);
    assert.match(result.value.roleId, /^554023\d+$/);
    assert.match(result.value.profileId, /^554023\d+$/);
    assert.deepEqual(Object.keys(result.value).sort(), ['profileId', 'roleId', 'seat', 'userId']);
    assert.ok(Object.isFrozen(result.value));
  }
});

test('M03-S05: exact D80 mappings exist for CEO and Digital Infrastructure but Administrator tokens are refused', () => {
  for (const row of recording.administratorRefused) {
    const current = row.body.users[0];
    assert.equal(ZOHO_SEAT_POLICIES[current.role.name].seat, row.mappedSeat);
    assert.deepEqual(directory.resolveCurrentUser(row.body), {
      ok: false,
      reason: 'administrator-profile',
    });
  }
});

test('M03-S05: unknown, stale, Farm Operations and malformed CurrentUser recordings fail closed', () => {
  for (const row of recording.refused) {
    assert.deepEqual(directory.resolveCurrentUser(row.body), {
      ok: false,
      reason: row.reason,
    }, row.case);
  }
});

test('M03-S05: role matching is exact and never trims, folds case or accepts a substring', () => {
  const base = structuredClone(recording.accepted.find((row) => row.seat === 'investor-relations').body);
  for (const roleName of ['investor relations', 'Investor Relations ', 'Investor Relation', 'IR', 'Marketing']) {
    const body = structuredClone(base);
    body.users[0].role.name = roleName;
    assert.deepEqual(directory.resolveCurrentUser(body), { ok: false, reason: 'unknown-role' }, roleName);
  }
});

test('M03-S05: active alone never proves a full, confirmed human seat', () => {
  const base = structuredClone(recording.accepted[0].body);
  const cases = [
    ['missing confirmation', (user) => { delete user.confirm; }, 'unconfirmed'],
    ['string confirmation', (user) => { user.confirm = 'true'; }, 'unconfirmed'],
    ['missing user type', (user) => { delete user.type__s; }, 'unsupported-user-type'],
    ['portal user', (user) => { user.type__s = 'Client Portal User'; }, 'unsupported-user-type'],
    ['support user', (user) => { user.type__s = 'Support User'; }, 'unsupported-user-type'],
    ['sandbox developer', (user) => { user.type__s = 'Sandbox Developer User'; }, 'unsupported-user-type'],
  ];
  for (const [name, mutate, reason] of cases) {
    const body = structuredClone(base);
    mutate(body.users[0]);
    assert.deepEqual(directory.resolveCurrentUser(body), { ok: false, reason }, name);
  }
});

test('sandbox deployments accept a Sandbox Developer User seat; production and other types stay refused', () => {
  const sandboxDirectory = createZohoSeatDirectory({ ...directoryConfig(), sandbox: true });
  const row = recording.accepted[0];
  const dev = structuredClone(row.body);
  dev.users[0].type__s = 'Sandbox Developer User';
  assert.deepEqual(sandboxDirectory.resolveCurrentUser(dev), directory.resolveCurrentUser(row.body));
  assert.equal(directory.resolveCurrentUser(dev).ok, false, 'production still refuses it');
  for (const t of ['Client Portal User', 'Support User', 'Team User']) {
    const body = structuredClone(row.body);
    body.users[0].type__s = t;
    assert.deepEqual(sandboxDirectory.resolveCurrentUser(body), { ok: false, reason: 'unsupported-user-type' }, t);
  }
});

test('M03-S05: role/profile ids and names must both match the pinned sanitized export', () => {
  const base = structuredClone(recording.accepted.find((row) => row.seat === 'finance-operations').body);
  const cases = [
    ['numeric role id', (user) => { user.role.id = Number(user.role.id); }, 'malformed'],
    ['foreign role id', (user) => { user.role.id = '999999000000100008'; }, 'foreign-org'],
    ['recreated role', (user) => { user.role.id = '554023000000199998'; }, 'role-binding-mismatch'],
    ['numeric profile id', (user) => { user.profile.id = Number(user.profile.id); }, 'malformed'],
    ['foreign profile id', (user) => { user.profile.id = '999999000000200007'; }, 'foreign-org'],
    ['recreated profile', (user) => { user.profile.id = '554023000000299998'; }, 'profile-mismatch'],
    ['stale profile shorthand', (user) => { user.profile.name = 'Finance Operations'; }, 'profile-mismatch'],
  ];
  for (const [name, mutate, reason] of cases) {
    const body = structuredClone(base);
    mutate(body.users[0]);
    assert.deepEqual(directory.resolveCurrentUser(body), { ok: false, reason }, name);
  }
});

test('M03-S05: empty, multiple and non-object CurrentUser envelopes are malformed', () => {
  for (const body of [null, [], {}, { users: [] }, { users: [null] }, { users: [{}, {}] }, { users: 'one' }]) {
    assert.deepEqual(directory.resolveCurrentUser(body), { ok: false, reason: 'malformed' });
  }
});

test('M03-S05: inherited fields, accessors and hostile proxies are never Zoho source facts', () => {
  const valid = structuredClone(recording.accepted[0].body);
  const validUser = valid.users[0];

  const inheritedRoot = Object.create({ users: valid.users });
  assert.deepEqual(directory.resolveCurrentUser(inheritedRoot), { ok: false, reason: 'malformed' });

  const inheritedUsers = [];
  inheritedUsers.length = 1;
  Object.setPrototypeOf(inheritedUsers, Object.assign(Object.create(Array.prototype), { 0: validUser }));
  assert.deepEqual(directory.resolveCurrentUser({ users: inheritedUsers }), { ok: false, reason: 'malformed' });

  let arrayGetterCalls = 0;
  const accessorUsers = [];
  accessorUsers.length = 1;
  Object.defineProperty(accessorUsers, '0', { get() { arrayGetterCalls++; return validUser; } });
  assert.deepEqual(directory.resolveCurrentUser({ users: accessorUsers }), { ok: false, reason: 'malformed' });
  assert.equal(arrayGetterCalls, 0, 'an array-index accessor is never invoked');

  const hostileUsers = new Proxy([validUser], {
    getOwnPropertyDescriptor() { throw new Error('synthetic array trap'); },
  });
  assert.deepEqual(directory.resolveCurrentUser({ users: hostileUsers }), { ok: false, reason: 'malformed' });

  const inheritedUser = Object.create(validUser);
  Object.defineProperty(inheritedUser, 'id', { value: validUser.id, enumerable: true });
  assert.deepEqual(directory.resolveCurrentUser({ users: [inheritedUser] }), { ok: false, reason: 'inactive' });

  const inheritedRole = Object.create(validUser.role);
  const inheritedProfile = Object.create(validUser.profile);
  assert.deepEqual(directory.resolveCurrentUser({
    users: [{ ...validUser, role: inheritedRole, profile: inheritedProfile }],
  }), { ok: false, reason: 'malformed' });

  let getterCalls = 0;
  const accessorUser = structuredClone(validUser);
  Object.defineProperty(accessorUser, 'role', { enumerable: true, get() { getterCalls++; return validUser.role; } });
  assert.deepEqual(directory.resolveCurrentUser({ users: [accessorUser] }), { ok: false, reason: 'malformed' });
  assert.equal(getterCalls, 0, 'an accessor on untrusted input is never invoked');

  const hostile = new Proxy({}, { getOwnPropertyDescriptor() { throw new Error('synthetic trap'); } });
  assert.deepEqual(directory.resolveCurrentUser(hostile), { ok: false, reason: 'malformed' });

  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  assert.deepEqual(directory.resolveCurrentUser(revoked.proxy), { ok: false, reason: 'malformed' });
});

test('M03-S05: a fresh sign-in observes a role change for the same Zoho user', () => {
  const before = directory.resolveCurrentUser(recording.roleChange.before);
  const after = directory.resolveCurrentUser(recording.roleChange.after);
  assert.equal(before.ok, true);
  assert.equal(after.ok, true);
  assert.equal(before.value.userId, after.value.userId);
  assert.equal(before.value.seat, 'investor-relations');
  assert.equal(after.value.seat, 'ir-manager');
});

test('M03-S05: identity fields in a CurrentUser response never enter the resolution result', () => {
  const body = structuredClone(recording.accepted[0].body);
  body.users[0].email = 'synthetic-person@example.invalid';
  body.users[0].full_name = 'Synthetic Person';
  const result = directory.resolveCurrentUser(body);
  assert.equal(result.ok, true);
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes('synthetic-person'));
  assert.ok(!serialized.includes('Synthetic Person'));
  assert.ok(!serialized.includes('email'));
  assert.ok(!serialized.includes('full_name'));
});

test('M03-S05: missing, extra, foreign or aliased pinned ids stop startup', () => {
  const missingRole = directoryConfig();
  delete missingRole.roleIds.Exec;
  assert.throws(() => createZohoSeatDirectory(missingRole), /exactly the approved role names/);

  const extraProfile = directoryConfig();
  extraProfile.profileIds.Standard = '554023000000200099';
  assert.throws(() => createZohoSeatDirectory(extraProfile), /exactly the approved profile names/);

  const foreignRole = directoryConfig();
  foreignRole.roleIds.Exec = '999999000000100012';
  assert.throws(() => createZohoSeatDirectory(foreignRole), /configured CRM org/);

  const aliasedRole = directoryConfig();
  aliasedRole.roleIds.Exec = aliasedRole.roleIds['Investor Relations'];
  assert.throws(() => createZohoSeatDirectory(aliasedRole), /role ids must be unique/);
});

test('M03-S05: the directory captures pinned ids and cannot be altered after construction', () => {
  const mutable = directoryConfig();
  const captured = createZohoSeatDirectory(mutable);
  mutable.roleIds['Investor Relations'] = '554023000000199997';
  mutable.profileIds.IR = '554023000000299997';
  const result = captured.resolveCurrentUser(recording.roleChange.before);
  assert.equal(result.ok, true);
  assert.equal(result.value.seat, 'investor-relations');
  assert.ok(Object.isFrozen(captured));
  assert.ok(Object.isFrozen(ZOHO_SEAT_POLICIES));
});
