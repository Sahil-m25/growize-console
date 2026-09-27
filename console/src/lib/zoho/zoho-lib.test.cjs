/* ZOHO LIB REGRESSION — console/src/lib/zoho/. Run from console/:  node src/lib/zoho/zoho-lib.test.cjs
 *
 * Covers D45 (cache is not a copy: five-minute ceiling, error state instead of old data), D46/D53
 * (the gate's two pools), D47/D52 (Plane B never holds a body), D53 (no unscoped cache key; user and
 * service tokens cannot be swapped) and D44 via D45 (412 surfaces as a conflict).
 *
 * No test framework is installed and none may be (PORT-GUIDE). Like save-queue-regression.cjs and
 * privacy-port-regression.cjs, this uses the TypeScript compiler already in node_modules: it
 * type-checks the six modules under the project's own tsconfig (strict), emits them as CommonJS to a
 * temp directory, and runs them with plain node and node:test. The type tests compile small files
 * that MUST NOT compile — an unscoped cache key, a per-record cache value, a service token on a
 * screen's client, a body in a log line — and assert the compiler rejects each on the marked line.
 */
'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const consoleRoot = path.resolve(__dirname, '..', '..', '..');
const ts = require(path.join(consoleRoot, 'node_modules', 'typescript'));
const srcRoot = path.join(consoleRoot, 'src');
const MODULES = ['cache', 'gate', 'errors', 'log', 'client', 'adapter', 'cover-window-share'];
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoho-lib-'));
process.on('exit', () => fs.rmSync(outDir, { recursive: true, force: true }));

const config = ts.readConfigFile(path.join(consoleRoot, 'tsconfig.json'), ts.sys.readFile);
const project = ts.parseJsonConfigFileContent(config.config, ts.sys, consoleRoot);
const baseOptions = {
  ...project.options,
  incremental: false, tsBuildInfoFile: undefined, plugins: undefined,
  module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10,
};
const format = (d) => ts.formatDiagnostics(d, { getCanonicalFileName: (f) => f, getCurrentDirectory: () => consoleRoot, getNewLine: () => '\n' });

/* 1. Type-check (strict, the project's own settings) and emit. */
const program = ts.createProgram(MODULES.map((m) => path.join(__dirname, m + '.ts')), { ...baseOptions, noEmit: false, noEmitOnError: true, outDir, rootDir: srcRoot });
const preEmit = ts.getPreEmitDiagnostics(program);
if (preEmit.length) { console.error(format(preEmit)); process.exit(1); }
const emitted = program.emit();
if (emitted.diagnostics.length) { console.error(format(emitted.diagnostics)); process.exit(1); }
const load = (m) => require(path.join(outDir, 'lib', 'zoho', m + '.js'));

const { cacheKey, createScopedCache, createMemoryStore, MAX_AGE_MS, DEFAULT_TTL_MS } = load('cache');
const { createGate, classOf, GateQueueFullError } = load('gate');
const { classifyResponse, retryPolicy, backoffDelay, parseCreditsRemaining, isFailure } = load('errors');
const { createOpsLog, createMemorySink } = load('log');
const {
  createZohoClient,
  createZohoServiceClient,
  userCredential,
  serviceCredential,
  apiDomainOf,
  isUserCredential,
  MAX_TOKEN_LIFETIME_SECONDS,
  MAX_ZOHO_RESPONSE_BYTES,
} = load('client');
const { createFixtureAdapter, createLiveAdapter } = load('adapter');

const clockAt = (t0 = 0) => { let t = t0; const c = () => t; c.set = (v) => { t = v; }; c.advance = (ms) => { t += ms; }; return c; };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tick = () => new Promise((r) => setImmediate(r));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const USER = { kind: 'user', userId: 'kavya' };
const TEAM = { kind: 'subtree', managerId: 'tasneem' };
const RECORD_ID_PREFIX = '554023';
const ID = '554023000000527003';
const ID2 = '554023000000527011';
const FOREIGN_ID = '999999000000527003';

/* ===== TYPE TESTS: what must not compile ================================================= */

test('types: forbidden uses do not compile, each on its marked line; the control compiles clean', () => {
  const dir = path.join(outDir, 'typetests');
  fs.mkdirSync(dir);
  const from = (m) => JSON.stringify(path.join(__dirname, m));
  const preamble = [
    `import { cacheKey, createScopedCache, type CacheKey } from ${from('cache')};`,
    `import { createZohoClient, createZohoServiceClient, userCredential, serviceCredential } from ${from('client')};`,
    `import { createGate } from ${from('gate')};`,
    `import { createOpsLog, createMemorySink } from ${from('log')};`,
    `const cache = createScopedCache();`,
    `const load = async () => 1;`,
    `const gate = createGate(); const log = createOpsLog(createMemorySink());`,
    `const client = createZohoClient({ gate, log, recordIdPrefix: "554023" }); const service = createZohoServiceClient({ gate, log, recordIdPrefix: "554023" });`,
    `const grant = { access_token: "t", api_domain: "https://www.zohoapis.in" };`,
    `const mePromise = userCredential(grant, { recordIdPrefix: "554023", gate, log, fetch: async () => new Response(JSON.stringify({ users: [{ id: "${ID}", status: "active" }] }), { status: 200 }) });`,
    `const me = {} as Awaited<typeof mePromise>; const job = serviceCredential("audit-archive", grant);`,
    `const mine = cacheKey({ kind: "user", userId: "kavya" }, "numbers.funnel");`,
    `void cache; void load; void client; void service; void mePromise; void me; void job; void mine;`,
  ].join('\n');
  const LOG_LINE = `at: 0, actor: { kind: "user", userId: "kavya" }, op: "getRecord", method: "GET", endpoint: "/Leads/{id}", callClass: "simple", status: 200, durationMs: 1, gateWaitMs: 0, attempt: 1, creditsRemaining: null, errorClass: null, recordIds: []`;
  const forbidden = {
    'unscoped-string-key': `void cache.read("numbers.funnel", load);`,
    'unscoped-object-key': `void cache.read({ name: "numbers.funnel" }, load);`,
    'global-scope': `cacheKey({ kind: "global" }, "numbers.funnel");`,
    'team-scope-without-manager': `cacheKey({ kind: "subtree" }, "numbers.funnel");`,
    'undefined-scope': `cacheKey(undefined, "numbers.funnel");`,
    'hand-built-key-literal': `const forged: CacheKey = { scope: { kind: "user", userId: "kavya" }, name: "numbers.funnel" }; void forged;`,
    'empty-invalidation': `void cache.invalidate({});`,
    'per-record-object-value': `void cache.read(mine, async () => ({ Last_Name: "Pillai", Phone: "+91 99001 44821" }));`,
    'per-record-array-value': `void cache.read(mine, async () => [{ id: "${ID}", Email: "anand.pillai@gmail.com" }]);`,
    'bucket-with-extra-field': `void cache.read(mine, async () => [{ key: "L1", count: 1, phone: "+91 99001 44821" }]);`,
    'service-token-on-screen-client': `void client.getRecord(job, "Leads", "${ID}");`,
    'user-token-on-service-client': `void service.getRecord(me, "Leads", "${ID}");`,
    'caller-chosen-user-id': `void userCredential("kavya", grant);`,
    'bare-string-token': `void client.getRecord("1000.token", "Leads", "${ID}");`,
    'update-without-conflict-choice': `void client.update(me, "Leads", "${ID}", { City: "Kochi" });`,
    'body-in-a-log-line': `log.call({ ${LOG_LINE}, body: "{\\"Last_Name\\":\\"Pillai\\"}" });`,
    'response-in-a-log-line': `log.call({ ${LOG_LINE}, response: { data: [] } });`,
  };
  const control = [
    `const team = cacheKey({ kind: "subtree", managerId: "tasneem" }, "numbers.funnel");`,
    `const role = cacheKey<number>({ kind: "role", role: "corp" }, "numbers.kpi");`,
    `void cache.read(mine, async () => [{ key: "qualified", count: 3 }]);`,
    `void cache.read(team, async () => ({ qualified: 3, lost: 1 }));`,
    `void cache.read(role, async () => 7);`,
    `void cache.invalidate({ scope: { kind: "user", userId: "kavya" } }); void cache.invalidate({ prefix: "numbers." });`,
    `void client.getRecord(me, "Leads", "${ID}"); void service.getRecord(job, "Leads", "${ID}");`,
    `void client.update(me, "Leads", "${ID}", { City: "Kochi" }, { ifUnmodifiedSince: null });`,
    `log.call({ ${LOG_LINE} });`,
  ].join('\n');
  const files = {};
  const write = (name, body) => { const f = path.join(dir, name + '.ts'); fs.writeFileSync(f, `${preamble}\n${body}\nexport {};\n`); files[name] = f; };
  write('control', control);
  for (const [name, line] of Object.entries(forbidden)) write(name, `${line} /*FORBIDDEN*/`);
  const typeProgram = ts.createProgram(Object.values(files), { ...baseOptions, noEmit: true });
  const diagnosticsOf = (file) => { const sf = typeProgram.getSourceFile(file); return [...typeProgram.getSyntacticDiagnostics(sf), ...typeProgram.getSemanticDiagnostics(sf)]; };
  assert.equal(format(diagnosticsOf(files.control)), '', 'the control file (every legitimate use) compiles clean');
  for (const name of Object.keys(forbidden)) {
    const sf = typeProgram.getSourceFile(files[name]);
    const marked = sf.text.split('\n').findIndex((l) => l.includes('/*FORBIDDEN*/'));
    const diags = diagnosticsOf(files[name]);
    assert.ok(diags.length > 0, `${name}: must not compile`);
    for (const d of diags) assert.equal(sf.getLineAndCharacterOfPosition(d.start).line, marked, `${name}: the error is on the forbidden line, not elsewhere:\n${format([d])}`);
  }
});

/* ===== CACHE ============================================================================= */

test('cache: no key exists without a visibility scope (runtime half)', async () => {
  for (const bad of [undefined, null, {}, 'user:kavya', { kind: 'global' }, { kind: 'team', teamId: 'x' }, { kind: 'user' }, { kind: 'user', userId: '' },
    { kind: 'subtree', managerId: '   ' }, { kind: 'role', role: 42 }]) {
    assert.throws(() => cacheKey(bad, 'numbers.funnel'), TypeError, `scope ${JSON.stringify(bad)} is refused`);
  }
  assert.throws(() => cacheKey(USER, 'Anand Pillai +91 99001 44821'), TypeError, 'a key name is a label, not data');
  const cache = createScopedCache();
  await assert.rejects(cache.read({ scope: USER, name: 'numbers.funnel' }, async () => 1), /minted/, 'a forged key object is refused');
  await assert.rejects(cache.read('numbers.funnel', async () => 1), TypeError, 'a bare string is refused');
  const key = cacheKey({ kind: 'user', userId: 'kavya', extra: 'dropped' }, 'numbers.funnel');
  assert.deepEqual(key.scope, USER, 'only kind and id are kept');
  assert.ok(Object.isFrozen(key) && Object.isFrozen(key.scope));
});

test('cache: the five-minute ceiling cannot be configured past, and nothing older is ever returned', async () => {
  assert.equal(MAX_AGE_MS, 300_000);
  assert.throws(() => createScopedCache({ defaultTtlMs: MAX_AGE_MS + 1 }), RangeError);
  assert.throws(() => createScopedCache({ defaultTtlMs: 0 }), RangeError);
  const clock = clockAt();
  const cache = createScopedCache({ clock });
  const key = cacheKey(USER, 'badge.updates');
  await assert.rejects(cache.read(key, async () => 1, { ttlMs: MAX_AGE_MS + 1 }), RangeError);
  await assert.rejects(cache.read(key, async () => 1, { ttlMs: Infinity }), RangeError);
  let r = await cache.read(key, async () => 7, { ttlMs: MAX_AGE_MS });
  assert.equal(r.state, 'miss');
  assert.equal((await r.settled).state, 'fresh');
  clock.set(MAX_AGE_MS - 1);
  r = await cache.read(key, async () => 8, { ttlMs: MAX_AGE_MS });
  assert.equal(r.state, 'fresh'); assert.equal(r.value, 7); assert.equal(r.ageMs, MAX_AGE_MS - 1);
  clock.set(MAX_AGE_MS);
  r = await cache.read(key, async () => 8, { ttlMs: MAX_AGE_MS });
  assert.equal(r.state, 'miss', 'at exactly five minutes the value is gone'); assert.ok(!('value' in r));
  // A store claiming a ten-hour TTL (a Redis with a wrong EXPIRE) still cannot age a number past it.
  const raw = new Map();
  const store = { get: async (k) => raw.get(k), set: async (k, e) => { raw.set(k, e); }, delete: async (k) => { raw.delete(k); }, keys: async () => [...raw.keys()] };
  const clock2 = clockAt(1_000);
  const cache2 = createScopedCache({ clock: clock2, store });
  const key2 = cacheKey(USER, 'numbers.kpi');
  await (await cache2.read(key2, async () => 99)).settled;
  const [k] = raw.keys();
  raw.set(k, { ...raw.get(k), ttlMs: 36_000_000 });
  clock2.advance(MAX_AGE_MS - 1);
  assert.equal((await cache2.read(key2, async () => 100)).state, 'fresh', 'the ceiling still allows a value just under five minutes');
  clock2.advance(1);
  r = await cache2.read(key2, async () => { throw new Error('zoho down'); });
  assert.equal(r.state, 'miss', 'a corrupt ten-hour TTL is overridden by the ceiling'); assert.ok(!('value' in r));
  const settled = await r.settled;
  assert.equal(settled.state, 'error'); assert.ok(!('value' in settled));
});

test('cache: an expired entry plus a failed live fetch is an explicit error, never the old value', async () => {
  const clock = clockAt();
  const cache = createScopedCache({ clock, errorHoldMs: 5_000 });
  const key = cacheKey(TEAM, 'numbers.funnel');
  await (await cache.read(key, async () => [{ key: 'qualified', count: 7331 }])).settled;
  const down = async () => { throw { kind: 'server', status: 503 }; };
  // (a) Past its TTL, inside the ceiling: served once, labelled with its age, while the refresh runs.
  clock.set(DEFAULT_TTL_MS + 5_000);
  let r = await cache.read(key, down);
  assert.equal(r.state, 'stale-but-refreshing'); assert.equal(r.ageMs, DEFAULT_TTL_MS + 5_000); assert.equal(r.asOf, 0);
  const failed = await r.settled;
  assert.equal(failed.state, 'error'); assert.ok(!('value' in failed)); assert.equal(failed.reason, 'server'); assert.equal(failed.lastGoodAt, 0);
  // (b) The refresh failed: the old number is gone, and reads say so instead of serving it.
  r = await cache.read(key, down);
  assert.equal(r.state, 'error'); assert.ok(!('value' in r)); assert.equal(r.settled, null, 'held: no hammering Zoho');
  assert.ok(!JSON.stringify(r).includes('7331'), 'the old value is nowhere in the answer');
  // (c) After the hold the next read retries — and still answers error, still without the value.
  clock.advance(5_000);
  let calls = 0;
  r = await cache.read(key, async () => { calls++; throw new Error('still down'); });
  assert.equal(r.state, 'error'); assert.ok(r.settled);
  const again = await r.settled;
  assert.equal(again.state, 'error'); assert.ok(!('value' in again)); assert.equal(calls, 1);
  // (d) Cold past the ceiling: miss, then error.
  const key2 = cacheKey(USER, 'numbers.funnel');
  await (await cache.read(key2, async () => 5)).settled;
  clock.advance(MAX_AGE_MS);
  r = await cache.read(key2, down);
  assert.equal(r.state, 'miss'); assert.equal((await r.settled).state, 'error');
  // (e) Recovery is a fresh live number.
  clock.advance(5_000);
  const recovered = await cache.readSettled(key, async () => [{ key: 'qualified', count: 8 }]);
  assert.equal(recovered.state, 'fresh'); assert.equal(recovered.origin, 'live'); assert.deepEqual(recovered.value, [{ key: 'qualified', count: 8 }]);
});

test('cache: values are aggregates and counts only (runtime half)', async () => {
  const cache = createScopedCache();
  const bad = [{ Last_Name: 'Pillai' }, [{ id: ID, Email: 'anand.pillai@gmail.com' }], [{ key: 'L1', count: 1, phone: '+91 99001 44821' }],
    'Anand Pillai', NaN, Infinity, null, new Map(), { nested: { first: 'A' } }, [{ key: 'x'.repeat(81), count: 1 }],
    Array.from({ length: 501 }, (_, i) => ({ key: 'k' + i, count: i }))];
  for (const [i, value] of bad.entries()) {
    const r = await cache.readSettled(cacheKey(USER, `bad.${i}`), async () => value);
    assert.equal(r.state, 'error', `value ${i} is refused`); assert.equal(r.reason, 'not-an-aggregate');
  }
  for (const [i, value] of [3, { qualified: 2, lost: 1 }, [{ key: 'qualified', count: 2 }]].entries()) {
    const r = await cache.readSettled(cacheKey(USER, `good.${i}`), async () => value);
    assert.equal(r.state, 'fresh'); assert.deepEqual(r.value, value);
    if (typeof r.value === 'object') assert.ok(Object.isFrozen(r.value), 'stored values are frozen copies');
  }
});

test('cache: scopes never share an entry; concurrent reads share one load', async () => {
  const cache = createScopedCache();
  const own = await cache.readSettled(cacheKey(USER, 'numbers.funnel'), async () => 4);
  const team = await cache.readSettled(cacheKey(TEAM, 'numbers.funnel'), async () => 40);
  assert.equal(own.value, 4); assert.equal(team.value, 40);
  assert.equal((await cache.read(cacheKey(USER, 'numbers.funnel'), async () => 999)).value, 4, "the IR never sees the manager's number");
  let loads = 0;
  const gate = deferred();
  const key = cacheKey(USER, 'badge.bell');
  const [a, b] = await Promise.all([cache.read(key, () => { loads++; return gate.promise; }), cache.read(key, () => { loads++; return gate.promise; })]);
  gate.resolve(2);
  assert.equal(a.state, 'miss'); assert.equal(b.state, 'miss');
  assert.equal((await a.settled).value, 2); assert.equal((await b.settled).value, 2); assert.equal(loads, 1);
});

test('cache: invalidation by scope and by prefix; an invalidated in-flight load is not stored', async () => {
  const cache = createScopedCache();
  const keys = { ownFunnel: cacheKey(USER, 'numbers.funnel'), ownBell: cacheKey(USER, 'badge.bell'), teamFunnel: cacheKey(TEAM, 'numbers.funnel'), roleFunnel: cacheKey({ kind: 'role', role: 'corp' }, 'numbers.funnel') };
  for (const k of Object.values(keys)) await cache.readSettled(k, async () => 1);
  assert.equal(await cache.invalidate({ scope: USER }), 2);
  assert.equal((await cache.read(keys.teamFunnel, async () => 2)).state, 'fresh', 'another scope is untouched');
  assert.equal(await cache.invalidate({ prefix: 'numbers.' }), 2, 'a prefix crosses scopes (a Zoho change notification knows no scope)');
  assert.equal((await cache.read(keys.roleFunnel, async () => 2)).state, 'miss');
  await assert.rejects(cache.invalidate({}), TypeError);
  await assert.rejects(cache.invalidate({ prefix: '' }), TypeError);
  const slow = deferred();
  const key = cacheKey(USER, 'numbers.ageing');
  const pending = await cache.read(key, () => slow.promise);
  await cache.invalidate({ scope: USER, prefix: 'numbers.' });
  slow.resolve(12);
  const landed = await pending.settled;
  assert.equal(landed.state, 'fresh', 'its waiter still gets an answer, labelled with when it started');
  assert.equal((await cache.read(key, async () => 13)).state, 'miss', 'but a pre-write number is not stored after the write');
});

/* ===== GATE ============================================================================== */

test('gate: a burst of 50 calls never exceeds 12 in flight or 8 complex, and uses both pools fully', async () => {
  const gate = createGate();
  let inFlight = 0, complex = 0, maxIn = 0, maxComplex = 0;
  const calls = Array.from({ length: 50 }, (_, i) => {
    const cls = i < 20 ? 'complex' : 'simple';
    return gate.run(cls, async () => {
      inFlight++; if (cls === 'complex') complex++;
      maxIn = Math.max(maxIn, inFlight); maxComplex = Math.max(maxComplex, complex);
      const s = gate.snapshot();
      assert.ok(s.inFlight <= 12 && s.complexInFlight <= 8);
      await wait(1 + ((i * 7) % 5));
      inFlight--; if (cls === 'complex') complex--;
      return i;
    });
  });
  assert.deepEqual(await Promise.all(calls), Array.from({ length: 50 }, (_, i) => i));
  assert.ok(maxIn <= 12, `peak ${maxIn} in flight`); assert.ok(maxComplex <= 8, `peak ${maxComplex} complex`);
  assert.equal(maxIn, 12, 'the overall pool is used to its limit'); assert.equal(maxComplex, 8, 'the complex pool is used to its limit');
  const s = gate.snapshot();
  assert.equal(s.inFlight, 0); assert.equal(s.complexInFlight, 0); assert.equal(s.queued, 0);
});

test('gate: a simple call is not stuck behind complex calls waiting for a complex slot', async () => {
  const gate = createGate();
  const held = await Promise.all(Array.from({ length: 8 }, () => gate.acquire('complex')));
  const waitingComplex = gate.acquire('complex');
  const simple = await gate.acquire('simple');
  assert.equal(gate.snapshot().inFlight, 9); assert.equal(gate.snapshot().queued, 1);
  simple.release(); held[0].release();
  (await waitingComplex).release();
  held.slice(1).forEach((l) => l.release());
  held[0].release(); // idempotent
  assert.equal(gate.snapshot().inFlight, 0);
});

test('gate: a queued request carries an abort signal', async () => {
  const gate = createGate({ maxInFlight: 2, maxComplex: 1 });
  const a = await gate.acquire('simple');
  const b = await gate.acquire('simple');
  const controller = new AbortController();
  let ran = false;
  const queued = gate.run('simple', async () => { ran = true; }, controller.signal);
  assert.equal(gate.snapshot().queued, 1);
  controller.abort();
  await assert.rejects(queued, { name: 'AbortError' });
  assert.equal(gate.snapshot().queued, 0);
  a.release(); b.release(); await tick();
  assert.equal(ran, false, 'an aborted request never runs');
  await assert.rejects(gate.acquire('simple', AbortSignal.abort()), { name: 'AbortError' });
});

test('gate: limits keep headroom under Zoho\'s 20/10, and the queue is bounded', async () => {
  assert.throws(() => createGate({ maxInFlight: 20 }), RangeError);
  assert.throws(() => createGate({ maxComplex: 10 }), RangeError);
  assert.throws(() => createGate({ maxInFlight: 4, maxComplex: 6 }), RangeError);
  const gate = createGate({ maxInFlight: 1, maxComplex: 1, maxQueued: 1 });
  const held = await gate.acquire('simple');
  const one = gate.acquire('simple');
  await assert.rejects(gate.acquire('simple'), GateQueueFullError);
  held.release(); (await one).release();
  assert.equal(classOf({ op: 'coql' }), 'complex');
  assert.equal(classOf({ op: 'list', sortBy: true }), 'complex');
  assert.equal(classOf({ op: 'list', cvid: true }), 'complex');
  assert.equal(classOf({ op: 'list' }), 'simple');
  assert.equal(classOf({ op: 'write', records: 10 }), 'simple');
  assert.equal(classOf({ op: 'write', records: 11 }), 'complex');
  assert.equal(classOf({ op: 'send-mail' }), 'complex');
  assert.equal(classOf({ op: 'convert-lead' }), 'complex');
  assert.equal(classOf({ op: 'read' }), 'simple');
});

/* ===== ERRORS ============================================================================ */

test('errors: each 429 body classifies correctly, with its own retry policy', () => {
  const cases = [
    ['credits (Zoho v8 documented wording)', { code: 'TOO_MANY_REQUESTS', details: {}, message: 'Number of API requests for the 24 hour period is exceeded', status: 'error' }, 'credits-exhausted'],
    ['credits (older shape seen in the wild)', { code: 429, error: 'TOO_MANY_REQUESTS', error_info: 'Many requests fired than the allowed limit for the past 24 hours.', details: [] }, 'credits-exhausted'],
    ['credits (credits wording in details)', { code: 'TOO_MANY_REQUESTS', details: { remaining_credits: 0 }, message: 'limit reached', status: 'error' }, 'credits-exhausted'],
    ['concurrency', { code: 'TOO_MANY_REQUESTS', details: {}, message: 'The concurrency limit of the user for the app is exceeded', status: 'error' }, 'concurrency-exceeded', 'org'],
    ['sub-concurrency', { code: 'TOO_MANY_REQUESTS', details: {}, message: 'The sub-concurrency limit of the user for the app is exceeded', status: 'error' }, 'concurrency-exceeded', 'sub'],
    ['sub-concurrency by details key', { code: 'TOO_MANY_REQUESTS', details: { sub_concurrency_limit: 10 }, message: 'too many requests', status: 'error' }, 'concurrency-exceeded', 'sub'],
    ["Zoho's generic sentence names both", { code: 'TOO_MANY_REQUESTS', details: {}, message: 'Number of API requests for the 24 hour period is exceeded or the concurrency limit of the user for the app is exceeded', status: 'error' }, 'rate-limited-unclassified'],
    ['no telling words', { code: 'TOO_MANY_REQUESTS', details: {}, message: 'too many requests', status: 'error' }, 'rate-limited-unclassified'],
    ['no body', null, 'rate-limited-unclassified'],
  ];
  for (const [name, body, kind, pool] of cases) {
    const c = classifyResponse({ status: 429, body });
    assert.equal(c.kind, kind, name);
    if (pool) assert.equal(c.pool, pool, name);
    assert.ok(isFailure(c));
  }
  const credits = classifyResponse({ status: 429, body: cases[0][1] });
  assert.deepEqual(retryPolicy(credits, { idempotent: true }), { retry: false }, 'a credits-429 is never retried');
  const conc = retryPolicy(classifyResponse({ status: 429, body: cases[3][1] }), { idempotent: false });
  assert.ok(conc.retry && conc.baseMs <= 250 && conc.capMs <= 2_000, 'a concurrency-429 retries in milliseconds, even for a write');
  const vague = retryPolicy(classifyResponse({ status: 429, body: null }), { idempotent: true });
  assert.ok(vague.retry && vague.maxAttempts <= 3 && vague.baseMs >= 1_000, 'an unclassified 429 retries a little, slowly');
  const withAfter = classifyResponse({ status: 429, body: cases[3][1], retryAfter: '2' });
  assert.equal(withAfter.retryAfterMs, 2_000);
  assert.ok(backoffDelay(1, conc, withAfter.retryAfterMs, () => 0) >= 2_000, 'Retry-After is a floor');
});

test('errors: 207 Multi-Status is parsed per record and never treated as success', () => {
  const landed = { code: 'SUCCESS', details: { id: ID, Modified_Time: '2026-09-23T10:00:00+05:30' }, message: 'record updated', status: 'success', action: 'update' };
  const refused = { code: 'INVALID_DATA', details: { api_name: 'Email', expected_data_type: 'email' }, message: 'invalid data', status: 'error' };
  const c = classifyResponse({ status: 207, body: { data: [landed, refused] }, perRecord: true });
  assert.equal(c.kind, 'partial'); assert.ok(isFailure(c));
  assert.deepEqual(c.records.map((r) => [r.index, r.ok, r.id, r.code, r.field, r.action]), [[0, true, ID, 'SUCCESS', null, 'update'], [1, false, null, 'INVALID_DATA', 'Email', null]]);
  assert.deepEqual(retryPolicy(c, { idempotent: true }), { retry: false }, 'resending the batch would repeat what landed');
  assert.equal(classifyResponse({ status: 207, body: { data: [landed] } }).kind, 'partial', '207 is not success even when every record says so');
  assert.equal(classifyResponse({ status: 200, body: { data: [landed, refused] }, perRecord: true }).kind, 'partial', 'nor is a 200 carrying a failed record');
  assert.equal(classifyResponse({ status: 207, body: null }).kind, 'partial');
});

test('errors: 412 ALREADY_MODIFIED surfaces as a conflict and is never retried', () => {
  const top = classifyResponse({ status: 412, body: { code: 'ALREADY_MODIFIED', details: {}, message: 'Record updated time has already passed if-unmodified-since time', status: 'error' }, perRecord: true });
  assert.equal(top.kind, 'conflict'); assert.equal(top.code, 'ALREADY_MODIFIED');
  const wrapped = classifyResponse({ status: 412, body: { data: [{ code: 'ALREADY_MODIFIED', details: { id: ID }, message: 'x', status: 'error' }] }, perRecord: true });
  assert.equal(wrapped.kind, 'conflict'); assert.equal(wrapped.recordId, ID);
  const in200 = classifyResponse({ status: 200, body: { data: [{ code: 'ALREADY_MODIFIED', details: { id: ID }, message: 'x', status: 'error' }] }, perRecord: true });
  assert.equal(in200.kind, 'conflict', 'a conflict inside a 2xx body is still a conflict');
  assert.deepEqual(retryPolicy(top, { idempotent: true }), { retry: false });
});

test('errors: 400, 401, 403, 404, 204 and 5xx classify, with retries only where safe', () => {
  const invalid = classifyResponse({ status: 400, body: { data: [{ code: 'INVALID_DATA', details: { api_name: 'Mobile' }, message: 'invalid data', status: 'error' }] }, perRecord: true });
  assert.equal(invalid.kind, 'invalid-data'); assert.equal(invalid.field, 'Mobile'); assert.equal(retryPolicy(invalid, { idempotent: true }).retry, false);
  assert.equal(classifyResponse({ status: 400, body: { code: 'MANDATORY_NOT_FOUND', details: { api_name: 'Last_Name' }, message: 'required field not found', status: 'error' } }).field, 'Last_Name');
  assert.equal(classifyResponse({ status: 401, body: { code: 'INVALID_TOKEN', details: {}, message: 'invalid oauth token', status: 'error' } }).kind, 'auth-expired');
  assert.equal(classifyResponse({ status: 401, body: { code: 'OAUTH_SCOPE_MISMATCH', details: {}, message: 'x', status: 'error' } }).kind, 'auth-rejected');
  const forbidden = classifyResponse({ status: 403, body: { code: 'NO_PERMISSION', details: {}, message: 'permission denied', status: 'error' } });
  assert.equal(forbidden.kind, 'forbidden'); assert.deepEqual(retryPolicy(forbidden, { idempotent: true }), { retry: false }, 'a 403 is never retried');
  assert.equal(classifyResponse({ status: 404, body: { code: 'INVALID_URL_PATTERN' } }).kind, 'not-found');
  const empty = classifyResponse({ status: 204, body: null });
  assert.equal(empty.kind, 'empty'); assert.equal(isFailure(empty), false, '204 is "nothing matched", not an error');
  const server = classifyResponse({ status: 503, body: null });
  assert.equal(server.kind, 'server');
  assert.equal(retryPolicy(server, { idempotent: true }).retry, true, 'a 5xx read is retried');
  assert.equal(retryPolicy(server, { idempotent: false }).retry, false, 'a 5xx write may have landed: not retried');
  assert.equal(classifyResponse({ status: 200, body: { code: 'SUCCESS', details: {}, message: 'transition updated successfully', status: 'success' } }).kind, 'ok');
  assert.equal(classifyResponse({ status: 200, body: { code: 'RECORD_LOCKED', details: {}, message: 'x', status: 'error' } }).kind, 'invalid-data', 'a 2xx saying error is not success');
  const policy = { retry: true, maxAttempts: 5, baseMs: 100, capMs: 2_000 };
  for (let attempt = 1; attempt <= 8; attempt++) {
    const ceiling = Math.min(2_000, 100 * 2 ** (attempt - 1));
    assert.equal(backoffDelay(attempt, policy, null, () => 0), Math.round(ceiling / 2));
    assert.equal(backoffDelay(attempt, policy, null, () => 1), ceiling);
  }
  assert.equal(parseCreditsRemaining('21000'), 21000); assert.equal(parseCreditsRemaining(null), null); assert.equal(parseCreditsRemaining('lots'), null);
});

/* ===== CLIENT ============================================================================ */

const grantFor = (domain = 'https://www.zohoapis.eu', token = '1000.secret-token') => ({ access_token: token, api_domain: domain, expires_in: 3600, token_type: 'Bearer' });
const zohoReply = (status, body = null, headers = {}) => ({ status, body, headers });
const zohoRawReply = (status, rawText, headers = {}) => ({ status, rawText, headers });
const CURRENT_USER_RESPONSE = Object.freeze({ users: [Object.freeze({ id: ID, status: 'active' })] });
const identityResponse = (body = CURRENT_USER_RESPONSE, status = 200) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
const recordedCurrentUserFetch = (body = CURRENT_USER_RESPONSE, status = 200, calls = null) => async (url, init) => {
  if (calls) calls.push({ url, init });
  return identityResponse(body, status);
};
const streamedResponse = (chunks, { status = 200, onCancel = () => {} } = {}) => {
  const encoder = new TextEncoder();
  const bytes = chunks.map((chunk) => typeof chunk === 'string' ? encoder.encode(chunk) : chunk);
  let index = 0;
  return new Response(new ReadableStream({
    pull(controller) {
      if (index < bytes.length) controller.enqueue(bytes[index++]);
      else controller.close();
    },
    cancel(reason) { onCancel(reason); },
  }), { status });
};
const midBodyReadFailureResponse = (onCancel) => {
  const firstChunk = new TextEncoder().encode('{"data":');
  let reads = 0;
  return {
    status: 200,
    headers: { get: () => null },
    body: {
      getReader: () => ({
        read: async () => {
          reads++;
          if (reads === 1) return { done: false, value: firstChunk };
          throw new Error('synthetic connection reset');
        },
        cancel: async (reason) => { onCancel(reason); },
        releaseLock() {},
      }),
    },
    text: async () => { throw new Error('the streamed reader is authoritative'); },
  };
};
const userCredentialOptions = (options = {}) => ({
  recordIdPrefix: RECORD_ID_PREFIX,
  gate: createGate(),
  log: createOpsLog(createMemorySink()),
  fetch: recordedCurrentUserFetch(),
  ...options,
});
const mintUser = (tokenResponse = grantFor(), options = {}) => userCredential(tokenResponse, userCredentialOptions(options));
function rig(replies, extra = {}) {
  const sink = createMemorySink();
  const log = createOpsLog(sink);
  const gate = createGate();
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init, body: init.body === undefined ? undefined : JSON.parse(init.body) });
    const next = typeof replies === 'function' ? replies(url, init, calls.length) : replies.shift();
    assert.ok(next, `an unexpected call to ${url}`);
    if (next.response) return next.response;
    const responseBody = next.status === 204 ? null : Object.prototype.hasOwnProperty.call(next, 'rawText') ? next.rawText : JSON.stringify(next.body);
    return new Response(responseBody, { status: next.status, headers: next.headers });
  };
  const options = { gate, log, recordIdPrefix: RECORD_ID_PREFIX, fetch, sleep: async () => {}, random: () => 0.5, ...extra };
  return { sink, gate, calls, client: createZohoClient(options), service: createZohoServiceClient(options) };
}
const record = (id, fields = {}) => ({ id, ...fields });

test('client: the API domain comes from the token response, and a token is only sent to a Zoho API host', async () => {
  const eu = await mintUser(grantFor('https://www.zohoapis.eu'));
  const inn = await mintUser(grantFor('https://www.zohoapis.in'));
  const { client, calls } = rig(() => zohoReply(200, { data: [record(ID)] }));
  await client.getRecord(eu, 'Leads', ID);
  await client.getRecord(inn, 'Leads', ID);
  assert.equal(calls[0].url, `https://www.zohoapis.eu/crm/v8/Leads/${ID}`);
  assert.equal(calls[1].url, `https://www.zohoapis.in/crm/v8/Leads/${ID}`);
  assert.equal(calls[0].init.headers.Authorization, 'Zoho-oauthtoken 1000.secret-token');
  for (const bad of ['http://www.zohoapis.in', 'https://www.zohoapis.com.evil.net', 'https://tenant.zohoapis.in', 'https://www.zohoapis.xyz', 'https://evilzohoapis.com', 'https://evil.example', 'https://www.zohoapis.in/steal', 'https://www.zohoapis.in:8443', '', undefined]) {
    await assert.rejects(mintUser({ ...grantFor(), api_domain: bad }), TypeError, `api_domain ${bad} is refused`);
  }
  assert.equal(apiDomainOf('https://www.zohoapis.com.au/'), 'https://www.zohoapis.com.au');
  assert.ok(!JSON.stringify(eu).includes('secret-token') && !Object.keys(eu).includes('accessToken'), 'the token is redacted and non-enumerable');
});

test('client: user and service credentials require a bounded integral token lifetime', async () => {
  assert.equal(MAX_TOKEN_LIFETIME_SECONDS, 86_400);
  const invalidExpiries = [
    ['missing', undefined, true],
    ['invalid', '3600', false],
    ['zero', 0, false],
    ['negative', -1, false],
    ['huge', MAX_TOKEN_LIFETIME_SECONDS + 1, false],
    ['fractional', 1.5, false],
  ];
  let identityFetches = 0;
  for (const [name, expiresIn, omit] of invalidExpiries) {
    const grant = { ...grantFor(), expires_in: expiresIn };
    if (omit) delete grant.expires_in;
    await assert.rejects(
      userCredential(grant, userCredentialOptions({ fetch: async () => { identityFetches++; return identityResponse(); } })),
      /bounded expires_in/,
      `${name}: a user credential is not minted`,
    );
    assert.throws(
      () => serviceCredential('audit-archive', grant),
      /bounded expires_in/,
      `${name}: a service credential is not minted`,
    );
  }
  assert.equal(identityFetches, 0, 'invalid token metadata is rejected before CurrentUser');
});

test('client: user identity comes only from CurrentUser with an exact authenticated request', async () => {
  const calls = [];
  const tokenResponse = { ...grantFor('https://www.zohoapis.in'), user_id: FOREIGN_ID };
  const options = userCredentialOptions({
    userId: FOREIGN_ID,
    fetch: recordedCurrentUserFetch(CURRENT_USER_RESPONSE, 200, calls),
  });
  const me = await userCredential(tokenResponse, options);
  assert.equal(me.userId, ID, 'caller-supplied identity fields cannot choose the actor');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://www.zohoapis.in/crm/v8/users?type=CurrentUser');
  assert.equal(calls[0].init.method, 'GET');
  assert.deepEqual(calls[0].init.headers, { Accept: 'application/json', Authorization: 'Zoho-oauthtoken 1000.secret-token' });
  assert.equal(calls[0].init.redirect, 'error');
  assert.ok(calls[0].init.signal instanceof AbortSignal, 'the bounded identity request carries an abort signal');
});

test('client: malformed or untrusted CurrentUser responses mint no credential and reveal no detail', async () => {
  const failures = [
    ['foreign user', recordedCurrentUserFetch({ users: [{ id: FOREIGN_ID, status: 'active' }] })],
    ['multiple users', recordedCurrentUserFetch({ users: [{ id: ID, status: 'active' }, { id: ID2, status: 'active' }] })],
    ['inactive user', recordedCurrentUserFetch({ users: [{ id: ID, status: 'inactive' }] })],
    ['numeric id', recordedCurrentUserFetch({ users: [{ id: Number(ID), status: 'active' }] })],
    ['malformed json', recordedCurrentUserFetch('{"users":')],
    ['non-200 response', recordedCurrentUserFetch({ code: 'INVALID_TOKEN', token: '1000.secret-token' }, 401)],
    ['network failure', async () => { throw new Error('1000.secret-token failed for ' + FOREIGN_ID); }],
  ];
  for (const [name, fetch] of failures) {
    const sink = createMemorySink();
    await assert.rejects(
      userCredential(grantFor(), userCredentialOptions({ fetch, log: createOpsLog(sink) })),
      (error) => {
        assert.equal(error.constructor, TypeError, `${name}: typed failure`);
        assert.equal(error.message, 'Zoho CurrentUser verification failed.', `${name}: one generic message`);
        assert.ok(!error.message.includes('secret-token') && !error.message.includes(FOREIGN_ID), `${name}: no secret or identity in the error`);
        return true;
      },
    );
    const planeB = JSON.stringify(sink.records());
    assert.ok(!planeB.includes('secret-token') && !planeB.includes(FOREIGN_ID), `${name}: Plane B has no token or unverified identity`);
  }
});

test('client: identity latency cannot extend token expiry', async () => {
  const release = deferred();
  let clockCalls = 0;
  const pending = userCredential({ ...grantFor(), expires_in: 1 }, userCredentialOptions({
    clock: () => { clockCalls++; return clockCalls === 1 ? 1_000 : 900_000; },
    fetch: async () => { await release.promise; return identityResponse(); },
  }));
  await tick();
  release.resolve();
  const me = await pending;
  assert.equal(me.expiresAt, 2_000, 'expiry is based on issuance time before the identity request');
  assert.ok(clockCalls >= 1);
});

test('client: identity scope is captured before an in-flight options mutation', async () => {
  const entered = deferred();
  const release = deferred();
  const options = userCredentialOptions({
    fetch: async () => {
      entered.resolve();
      await release.promise;
      return identityResponse();
    },
  });
  const pending = userCredential(grantFor(), options);
  await entered.promise;
  options.recordIdPrefix = '999999';
  release.resolve();
  assert.equal((await pending).userId, ID, 'post-start mutation cannot change the accepted org');
});

test('client: a direct record id from another CRM org is rejected before fetch or Plane B', async () => {
  const me = await mintUser();
  const { client, calls, sink } = rig([]);
  await assert.rejects(client.getRecord(me, 'Leads', FOREIGN_ID), /does not belong to this configured CRM org/);
  assert.equal(calls.length, 0, 'a foreign-org id never reaches fetch');
  assert.deepEqual(sink.records(), [], 'a rejected foreign-org id never enters Plane B');
});

test('client: same-prefix direct ids outside Zoho record-id length bounds are rejected locally', async () => {
  const me = await mintUser();
  const { client, calls, sink } = rig([]);
  const shortId = RECORD_ID_PREFIX + '12345678';
  const overlongId = RECORD_ID_PREFIX + '12345678901234567';
  assert.equal(shortId.length, 14); assert.equal(overlongId.length, 23);
  await assert.rejects(client.getRecord(me, 'Leads', shortId), /Invalid record id/);
  await assert.rejects(client.getRecord(me, 'Leads', overlongId), /Invalid record id/);
  assert.equal(calls.length, 0, 'invalid lengths never reach fetch');
  assert.deepEqual(sink.records(), [], 'invalid lengths never enter Plane B');
});

test('client: record-id scope is captured at construction and cannot be changed through the options object', async () => {
  const sink = createMemorySink();
  const gate = createGate();
  const calls = [];
  const options = {
    gate,
    log: createOpsLog(sink),
    recordIdPrefix: RECORD_ID_PREFIX,
    fetch: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ data: [record(ID)] }), { status: 200 });
    },
    sleep: async () => {},
    random: () => 0.5,
  };
  const client = createZohoClient(options);
  options.recordIdPrefix = '999999';
  const me = await mintUser();

  assert.equal((await client.getRecord(me, 'Leads', ID)).ok, true, 'the configured local prefix remains authoritative');
  assert.deepEqual(sink.records()[0].recordIds, [ID], 'the local id remains visible in Plane B');
  await assert.rejects(client.getRecord(me, 'Leads', FOREIGN_ID), /does not belong to this configured CRM org/);
  assert.equal(calls.length, 1, 'the foreign id is rejected before a second fetch');
  assert.equal(sink.records().length, 1, 'the foreign id emits no Plane B line');
});

test('client: COQL and search log only returned record ids from the configured CRM org', async () => {
  const me = await mintUser();
  const { client, sink } = rig([
    zohoReply(200, { data: [record(ID), record(FOREIGN_ID)], info: { more_records: false } }),
    zohoReply(200, { data: [record(FOREIGN_ID), record(ID2)], info: { more_records: false } }),
  ]);
  assert.equal((await client.coql(me, 'select id from Leads limit 200')).ok, true);
  assert.equal((await client.search(me, 'Leads', { word: 'synthetic' })).ok, true);
  const calls = sink.records().filter((line) => line.kind === 'zoho-call');
  assert.deepEqual(calls.map((line) => [line.op, line.recordIds]), [
    ['coql', [ID]],
    ['search', [ID2]],
  ]);
  assert.ok(!JSON.stringify(calls).includes(FOREIGN_ID), 'the foreign-org id never enters Plane B');
});

test('client: user and service tokens cannot be swapped, and nothing unminted is accepted (runtime half)', async () => {
  const { client, service, calls } = rig(() => zohoReply(200, { data: [record(ID)] }));
  const me = await mintUser();
  const job = serviceCredential('audit-archive', grantFor());
  await assert.rejects(client.getRecord(job, 'Leads', ID), /never serves a screen/);
  await assert.rejects(service.getRecord(me, 'Leads', ID), TypeError);
  await assert.rejects(client.getRecord({ kind: 'user', userId: 'kavya', apiDomain: 'https://www.zohoapis.in', accessToken: 'x', expiresAt: null }, 'Leads', ID), /minted/);
  assert.throws(() => serviceCredential('admin', grantFor()), TypeError, 'there is no admin job');
  assert.equal(calls.length, 0);
  assert.equal((await service.getRecord(job, 'Leads', ID)).ok, true);
});

test('client: update() sends If-Unmodified-Since, and a 412 comes back as a typed conflict, not retried', async () => {
  const { client, calls, sink } = rig([zohoReply(412, { code: 'ALREADY_MODIFIED', details: {}, message: 'Record updated time has already passed if-unmodified-since time', status: 'error' })]);
  const me = await mintUser();
  const r = await client.update(me, 'Leads', ID, { City: 'Kochi' }, { ifUnmodifiedSince: '2026-09-23T10:00:00+05:30' });
  assert.equal(calls.length, 1, 'a conflict is never retried');
  assert.equal(calls[0].init.method, 'PUT'); assert.ok(calls[0].url.endsWith(`/crm/v8/Leads/${ID}`));
  assert.equal(calls[0].init.headers['If-Unmodified-Since'], '2026-09-23T10:00:00+05:30');
  assert.deepEqual(calls[0].body, { data: [{ City: 'Kochi' }] });
  assert.equal(r.ok, false); assert.equal(r.error.kind, 'conflict');
  assert.equal(sink.records()[0].errorClass, 'conflict');
  const ok = rig([zohoReply(200, { data: [{ code: 'SUCCESS', details: { id: ID, Modified_Time: '2026-09-23T10:05:00+05:30' }, message: 'record updated', status: 'success' }] })]);
  const acked = await ok.client.update(me, 'Leads', ID, { City: 'Kochi' }, { ifUnmodifiedSince: null });
  assert.equal(ok.calls[0].init.headers['If-Unmodified-Since'], undefined, 'an explicit null sends no header');
  assert.deepEqual(acked.value, { id: ID, modifiedTime: '2026-09-23T10:05:00+05:30' });
  await assert.rejects(client.update(me, 'Leads', ID, { City: 'Kochi' }, { ifUnmodifiedSince: 'yesterday' }), TypeError);
});

test('client: a stage is never written as a field; blueprintTransition() is the route', async () => {
  const { client, calls, sink } = rig([zohoReply(200, { code: 'SUCCESS', details: {}, message: 'transition updated successfully', status: 'success' })]);
  const me = await mintUser();
  const refused = await client.update(me, 'Leads', ID, { Lead_Status: 'Qualified' }, { ifUnmodifiedSince: null });
  assert.equal(refused.ok, false); assert.equal(refused.error.kind, 'refused'); assert.equal(refused.error.reason, 'stage-field-write');
  assert.equal(calls.length, 0, 'Zoho is never asked');
  assert.deepEqual(sink.records().map((r) => [r.kind, r.action, r.reason]), [['refusal', 'update', 'stage-field-write']], 'the refusal is in Plane B');
  const moved = await client.blueprintTransition(me, 'Leads', ID, '554023000000999001', { Qualification_Note: 'Scorecard done' });
  assert.equal(moved.ok, true);
  assert.equal(calls[0].init.method, 'PUT'); assert.ok(calls[0].url.endsWith(`/Leads/${ID}/actions/blueprint`));
  assert.deepEqual(calls[0].body, { blueprint: [{ transition_id: '554023000000999001', data: { Qualification_Note: 'Scorecard done' } }] });
  const custom = rig([], { blueprintOwnedFields: { Leads: ['Rung'] } });
  assert.equal((await custom.client.upsert(me, 'Leads', [{ Last_Name: 'X', Rung: 3 }], ['Mobile'])).error.reason, 'stage-field-write');
});

test('client: upsert() posts duplicate_check_fields, a 207 is a failure, and bulk over 10 is complex', async () => {
  const landed = { code: 'SUCCESS', details: { id: ID }, message: 'record added', status: 'success', action: 'insert' };
  const refused = { code: 'DUPLICATE_DATA', details: { api_name: 'Mobile' }, message: 'duplicate data', status: 'error' };
  const { client, calls, sink } = rig([zohoReply(207, { data: [landed, refused] }), zohoReply(200, { data: Array(11).fill(landed) }), zohoReply(200, { data: Array(10).fill(landed) })]);
  const me = await mintUser();
  const r = await client.upsert(me, 'Contacts', [{ Last_Name: 'A', Mobile: '1' }, { Last_Name: 'B', Mobile: '1' }], ['Mobile']);
  assert.equal(r.ok, false); assert.equal(r.error.kind, 'partial');
  assert.deepEqual(r.error.records.map((x) => x.ok), [true, false]);
  assert.ok(calls[0].url.endsWith('/Contacts/upsert')); assert.deepEqual(calls[0].body.duplicate_check_fields, ['Mobile']);
  assert.equal(calls.length, 1, 'a partial result is never resent');
  const eleven = Array.from({ length: 11 }, (_, i) => ({ Last_Name: 'L' + i }));
  assert.equal((await client.upsert(me, 'Contacts', eleven, ['Mobile'])).ok, true);
  assert.equal((await client.upsert(me, 'Contacts', eleven.slice(1), ['Mobile'])).ok, true);
  assert.deepEqual(sink.records().map((x) => x.callClass), ['simple', 'complex', 'simple']);
  await assert.rejects(client.upsert(me, 'Contacts', [], []), RangeError);
  await assert.rejects(client.upsert(me, 'Contacts', Array(101).fill({ Last_Name: 'x' }), []), RangeError);
});

test('client: insert() is create-only and never retries an ambiguous server failure', async () => {
  const landed = { code: 'SUCCESS', details: { id: ID }, message: 'record added', status: 'success' };
  const { client, calls } = rig([
    zohoReply(201, { data: [landed] }),
    zohoReply(503, { code: 'INTERNAL_ERROR', message: 'synthetic unavailable' }),
  ]);
  const me = await mintUser();
  const fields = { Allotment: { id: ID2 }, Kind: 'Full', Amount: 2250000, UTR: 'SYNTHETIC001' };
  const created = await client.insert(me, 'Receipts', [fields]);
  assert.equal(created.ok, true);
  assert.equal(created.value[0].id, ID);
  assert.equal(calls[0].init.method, 'POST');
  assert.ok(calls[0].url.endsWith('/crm/v8/Receipts'));
  assert.deepEqual(calls[0].body, { data: [fields] });

  const ambiguous = await client.insert(me, 'Receipts', [fields]);
  assert.equal(ambiguous.ok, false);
  assert.equal(ambiguous.error.kind, 'server');
  assert.equal(calls.length, 2, 'a create that may have landed is never resent');
  await assert.rejects(client.insert(me, 'Receipts', []), RangeError);
  await assert.rejects(client.insert(me, 'Receipts', Array(101).fill(fields)), RangeError);
  await assert.rejects(client.insert(me, 'Receipts', [{ id: ID, ...fields }]), /record id goes in the path/);
  assert.equal(calls.length, 2, 'an invalid create body never reaches Zoho');
});

test('client: numeric per-record details.id is neither accepted nor logged as an identifier', async () => {
  const numericId = Number(ID);
  const landed = { code: 'SUCCESS', details: { id: numericId }, message: 'record added', status: 'success' };
  const { client, sink } = rig([zohoReply(201, { data: [landed] })]);
  const me = await mintUser();
  const created = await client.insert(me, 'Receipts', [{ Allotment: { id: ID2 }, Amount: 1 }]);
  assert.equal(created.ok, true);
  assert.equal(created.value[0].id, null, 'a JSON number is never coerced into a Zoho id');
  assert.deepEqual(sink.records()[0].recordIds, [], 'a numeric acknowledgement id never enters Plane B');
});

test('client: only a runtime-minted user credential passes the server-boundary provenance check', async () => {
  const me = await mintUser();
  assert.equal(isUserCredential(me), true);
  assert.equal(isUserCredential({ kind: 'user', userId: 'kavya' }), false);
  assert.equal(isUserCredential(serviceCredential('audit-archive', grantFor())), false);
  assert.equal(isUserCredential(null), false);
});

test('client: retries follow the class — concurrency yes, credits no, 5xx only when idempotent', async () => {
  const me = await mintUser();
  const conc = { code: 'TOO_MANY_REQUESTS', details: {}, message: 'The concurrency limit of the user for the app is exceeded', status: 'error' };
  const a = rig([zohoReply(429, conc), zohoReply(200, { data: [record(ID)] })]);
  const r = await a.client.getRecord(me, 'Leads', ID);
  assert.equal(r.ok, true); assert.equal(a.calls.length, 2);
  assert.deepEqual(a.sink.records().map((x) => [x.attempt, x.status, x.errorClass]), [[1, 429, 'concurrency-exceeded'], [2, 200, null]]);
  const b = rig([zohoReply(429, { code: 'TOO_MANY_REQUESTS', details: {}, message: 'Number of API requests for the 24 hour period is exceeded', status: 'error' })]);
  const creditsOut = await b.client.getRecord(me, 'Leads', ID);
  assert.equal(creditsOut.error.kind, 'credits-exhausted'); assert.equal(b.calls.length, 1, 'a credits-429 is asked once');
  const c = rig(() => zohoReply(503, null));
  assert.equal((await c.client.getRecord(me, 'Leads', ID)).error.kind, 'server'); assert.equal(c.calls.length, 4, 'an idempotent read is retried to its policy');
  const d = rig(() => zohoReply(503, null));
  await d.client.update(me, 'Leads', ID, { City: 'Kochi' }, { ifUnmodifiedSince: null });
  assert.equal(d.calls.length, 1, 'a write that may have landed is not resent');
  const e = rig(() => zohoReply(403, { code: 'NO_PERMISSION', details: {}, message: 'permission denied', status: 'error' }));
  assert.equal((await e.client.getRecord(me, 'Leads', ID)).error.kind, 'forbidden'); assert.equal(e.calls.length, 1);
});

test('client: X-API-CREDITS-REMAINING is read when present and handed to the log', async () => {
  const me = await mintUser();
  const { client, sink } = rig([zohoReply(200, { data: [record(ID)] }), zohoReply(200, { data: [record(ID)] }, { 'X-API-CREDITS-REMAINING': '21000' })]);
  const quiet = await client.getRecord(me, 'Leads', ID);
  const warned = await client.getRecord(me, 'Leads', ID);
  assert.equal(quiet.creditsRemaining, null); assert.equal(warned.creditsRemaining, 21000);
  assert.deepEqual(sink.records().map((x) => x.creditsRemaining), [null, 21000]);
  const h = sink.headroom();
  assert.equal(h.creditsWarning, true, "the header's appearance is the warning (D47)"); assert.equal(h.lowestCreditsRemaining, 21000);
});

test('client: coql is a complex call; getRelated, search and getRecord read', async () => {
  const me = await mintUser();
  const { client, calls, sink } = rig([
    zohoReply(200, { data: [record(ID), record(ID2)], info: { more_records: true } }),
    zohoReply(204),
    zohoReply(200, { data: [record(ID2)], info: { more_records: false } }),
    zohoReply(204),
  ]);
  const page = await client.coql(me, "select Last_Name from Leads where Owner = '554023000000235011' limit 200");
  assert.deepEqual(page.value.records.map((x) => x.id), [ID, ID2]); assert.equal(page.value.moreRecords, true);
  assert.deepEqual(calls[0].body, { select_query: "select Last_Name from Leads where Owner = '554023000000235011' limit 200" });
  const none = await client.coql(me, 'select id from Leads where City = \'Nowhere\'');
  assert.deepEqual(none.value, { records: [], moreRecords: false }, '204 is an empty page');
  const related = await client.getRelated(me, 'Leads', ID, 'Notes', { fields: ['Note_Title'], perPage: 50 });
  assert.equal(related.value.records.length, 1);
  assert.ok(calls[2].url.includes(`/Leads/${ID}/Notes?per_page=50&fields=Note_Title`));
  const gone = await client.getRecord(me, 'Leads', ID);
  assert.equal(gone.ok, true); assert.equal(gone.value, null, 'nothing returned is null, not an error');
  assert.deepEqual(sink.records().map((x) => x.callClass), ['complex', 'complex', 'simple', 'simple']);
  await assert.rejects(client.coql(me, 'delete from Leads'), TypeError);
  await assert.rejects(client.getRecord(me, 'Leads/../Users', ID), TypeError);
  await assert.rejects(client.getRecord(me, 'Leads', 'L1'), TypeError);
});

test('client: malformed successful response envelopes fail closed and are logged as unexpected', async () => {
  const me = await mintUser();
  const { client, calls, sink } = rig([
    zohoRawReply(200, '{"data":'),
    zohoReply(200, null),
    zohoReply(200, {}),
    zohoReply(200, { data: null }),
    zohoReply(200, { data: [] }),
    zohoReply(200, { data: [], info: { more_records: 'false' } }),
  ]);
  const outcomes = [
    await client.getRecord(me, 'Leads', ID),
    await client.getRecord(me, 'Leads', ID),
    await client.getRecord(me, 'Leads', ID),
    await client.getRecord(me, 'Leads', ID),
    await client.search(me, 'Leads', { word: 'synthetic' }),
    await client.coql(me, 'select id from Leads limit 200'),
  ];
  assert.deepEqual(outcomes.map((outcome) => [outcome.ok, outcome.error.kind]), Array(6).fill([false, 'unexpected']));
  assert.equal(calls.length, 6);
  assert.deepEqual(sink.records().map((line) => line.errorClass), Array(6).fill('unexpected'));
});

test('client: streamed CRM responses enforce the byte cap, cancel overflow, and accept the exact cap', async () => {
  assert.equal(MAX_ZOHO_RESPONSE_BYTES, 5 * 1024 * 1024);
  let cancellations = 0;
  const oversized = streamedResponse([
    new Uint8Array(MAX_ZOHO_RESPONSE_BYTES),
    Uint8Array.of(0),
    Uint8Array.of(0),
  ], { onCancel: () => { cancellations++; } });
  const valid = JSON.stringify({ data: [record(ID)] });
  const exact = streamedResponse([valid + ' '.repeat(MAX_ZOHO_RESPONSE_BYTES - Buffer.byteLength(valid))]);
  const { client, sink } = rig([{ response: oversized }, { response: exact }]);
  const me = await mintUser();

  const refused = await client.getRecord(me, 'Leads', ID);
  assert.equal(refused.ok, false); assert.equal(refused.error.kind, 'unexpected');
  assert.equal(cancellations, 1, 'the response stream is cancelled as soon as it exceeds the cap');
  const accepted = await client.getRecord(me, 'Leads', ID);
  assert.equal(accepted.ok, true); assert.equal(accepted.value.id, ID, 'an exact-cap response is accepted');
  assert.deepEqual(sink.records().map((line) => line.errorClass), ['unexpected', null]);
});

test('client: invalid UTF-8 and invalid streamed chunks cancel the reader before failure returns', async () => {
  let utf8Cancellations = 0;
  const invalidUtf8 = streamedResponse([
    Uint8Array.from([0xc3, 0x28]),
    Uint8Array.of(0),
    Uint8Array.of(0),
  ], { onCancel: () => { utf8Cancellations++; } });

  let chunkCancellations = 0;
  const invalidChunks = [{ not: 'bytes' }, Uint8Array.of(0), Uint8Array.of(0)];
  let chunkIndex = 0;
  const invalidChunk = new Response(new ReadableStream({
    pull(controller) {
      if (chunkIndex < invalidChunks.length) controller.enqueue(invalidChunks[chunkIndex++]);
      else controller.close();
    },
    cancel() { chunkCancellations++; },
  }), { status: 200 });

  const { client, calls, sink } = rig([{ response: invalidUtf8 }, { response: invalidChunk }]);
  const me = await mintUser();
  const utf8 = await client.getRecord(me, 'Leads', ID);
  const chunk = await client.getRecord(me, 'Leads', ID);
  assert.equal(utf8.ok, false); assert.equal(utf8.error.kind, 'unexpected');
  assert.equal(chunk.ok, false); assert.equal(chunk.error.kind, 'unexpected');
  assert.deepEqual(
    [utf8Cancellations, chunkCancellations],
    [1, 1],
    'fatal UTF-8 and non-byte chunks both cancel their still-open streams',
  );
  assert.equal(calls.length, 2, 'malformed streamed bodies are unexpected and never retried');
  assert.deepEqual(sink.records().map((line) => line.errorClass), ['unexpected', 'unexpected']);
});

test('client: a mid-body read rejection is network, cancels, and retries idempotent GET and COQL', async () => {
  const me = await mintUser();

  let getCancellations = 0;
  const get = rig([
    { response: midBodyReadFailureResponse(() => { getCancellations++; }) },
    zohoReply(200, { data: [record(ID)] }),
  ]);
  const loaded = await get.client.getRecord(me, 'Leads', ID);
  assert.equal(loaded.ok, true); assert.equal(loaded.value.id, ID);
  assert.equal(getCancellations, 1, 'GET cancels the failed response reader');
  assert.equal(get.calls.length, 2, 'GET retries once after the mid-body transport failure');
  assert.deepEqual(get.sink.records().map((line) => line.errorClass), ['network', null]);

  let coqlCancellations = 0;
  const coql = rig([
    { response: midBodyReadFailureResponse(() => { coqlCancellations++; }) },
    zohoReply(200, { data: [record(ID2)], info: { more_records: false } }),
  ]);
  const page = await coql.client.coql(me, 'select id from Leads limit 200');
  assert.equal(page.ok, true); assert.deepEqual(page.value.records.map((row) => row.id), [ID2]);
  assert.equal(coqlCancellations, 1, 'COQL cancels the failed response reader');
  assert.equal(coql.calls.length, 2, 'COQL retries once after the mid-body transport failure');
  assert.deepEqual(coql.sink.records().map((line) => line.errorClass), ['network', null]);
});

test('client: a bodyless injected response is refused without calling its unbounded text fallback', async () => {
  let textCalls = 0;
  const bodyless = {
    status: 200,
    headers: { get: () => null },
    text: async () => {
      textCalls++;
      return JSON.stringify({ data: [record(ID)] });
    },
  };
  const { client, sink } = rig([], { fetch: async () => bodyless });
  const me = await mintUser();
  const result = await client.getRecord(me, 'Leads', ID);
  assert.equal(result.ok, false); assert.equal(result.error.kind, 'unexpected');
  assert.equal(textCalls, 0, 'a hard byte cap never delegates to an unbounded text() implementation');
  assert.equal(sink.records()[0].errorClass, 'unexpected');
});

test('client: CurrentUser enforces its 64 KiB streamed body cap', async () => {
  const maxBytes = 64 * 1024;
  const valid = JSON.stringify(CURRENT_USER_RESPONSE);
  const exact = streamedResponse([valid + ' '.repeat(maxBytes - Buffer.byteLength(valid))]);
  const accepted = await userCredential(grantFor(), userCredentialOptions({ fetch: async () => exact }));
  assert.equal(accepted.userId, ID, 'an exact-cap CurrentUser response is accepted');

  let cancellations = 0;
  const oversized = streamedResponse([
    new Uint8Array(maxBytes),
    Uint8Array.of(0),
    Uint8Array.of(0),
  ], { onCancel: () => { cancellations++; } });
  await assert.rejects(
    userCredential(grantFor(), userCredentialOptions({ fetch: async () => oversized })),
    /CurrentUser verification failed/,
  );
  assert.equal(cancellations, 1, 'the oversized CurrentUser stream is cancelled');
});

test('client: each endpoint rejects successful envelopes above its own row cap', async () => {
  const rows = (count) => Array.from({ length: count }, (_, index) => record(String(554023000010000000n + BigInt(index))));
  const landed = (count) => Array.from({ length: count }, (_, index) => ({
    code: 'SUCCESS',
    details: { id: String(554023000020000000n + BigInt(index)) },
    message: 'record added',
    status: 'success',
  }));
  const { client, calls, sink } = rig([
    zohoReply(200, { data: rows(2) }),
    zohoReply(200, { data: rows(201), info: { more_records: false } }),
    zohoReply(200, { data: rows(201), info: { more_records: false } }),
    zohoReply(200, { data: rows(2_001), info: { more_records: false } }),
    zohoReply(201, { data: landed(101) }),
    zohoReply(200, { data: landed(2) }),
    zohoReply(200, { data: landed(101) }),
  ]);
  const me = await mintUser();
  const outcomes = [
    await client.getRecord(me, 'Leads', ID),
    await client.search(me, 'Leads', { word: 'synthetic' }),
    await client.getRelated(me, 'Leads', ID, 'Notes', { fields: ['Note_Title'], perPage: 200 }),
    await client.coql(me, 'select id from Leads limit 2000'),
    await client.insert(me, 'Receipts', [{ Allotment: { id: ID2 }, Amount: 1 }]),
    await client.update(me, 'Leads', ID, { City: 'Kochi' }, { ifUnmodifiedSince: null }),
    await client.upsert(me, 'Contacts', [{ Last_Name: 'Synthetic' }], ['Mobile']),
  ];
  const endpoints = ['getRecord', 'search', 'getRelated', 'coql', 'insert', 'update', 'upsert'];
  for (let index = 0; index < outcomes.length; index++) {
    assert.equal(outcomes[index].ok, false, `${endpoints[index]} rejects an over-cap row set`);
    assert.equal(outcomes[index].error.kind, 'unexpected', `${endpoints[index]} fails closed`);
  }
  assert.equal(calls.length, 7, 'malformed successes are never retried');
  assert.deepEqual(sink.records().map((line) => line.errorClass), Array(7).fill('unexpected'));
});

test('client: wasDeleted() tells "deleted" apart from "not in the bin"', async () => {
  const me = await mintUser();
  const filler = Array.from({ length: 200 }, (_, i) => ({ id: String(554023000001000000n + BigInt(i)), deleted_by: { id: '1', name: 'x' }, deleted_time: 't', type: 'recycle' }));
  const hit = { id: ID, display_name: 'Anand Pillai', type: 'recycle', deleted_by: { name: 'Rohit Deshpande', id: '554023000000235011' }, created_by: { name: 'x', id: '1' }, deleted_time: '2026-09-20T11:00:00+05:30' };
  const found = rig([zohoReply(200, { data: filler, info: { more_records: true, page: 1 } }), zohoReply(200, { data: [hit], info: { more_records: false, page: 2 } })]);
  const r = await found.client.wasDeleted(me, 'Leads', ID);
  assert.deepEqual(r.value, { deleted: true, deletedBy: { id: '554023000000235011', name: 'Rohit Deshpande' }, deletedTime: '2026-09-20T11:00:00+05:30' });
  assert.ok(found.calls[1].url.includes('/Leads/deleted?type=recycle&page=2&per_page=200'));
  assert.ok(!JSON.stringify(r).includes('Anand Pillai'), 'the display name is not carried out');
  const absent = rig([zohoReply(200, { data: [filler[0]], info: { more_records: false } })]);
  assert.deepEqual((await absent.client.wasDeleted(me, 'Leads', ID)).value, { deleted: false, exhaustive: true });
  const emptyBin = rig([zohoReply(204)]);
  assert.deepEqual((await emptyBin.client.wasDeleted(me, 'Leads', ID)).value, { deleted: false, exhaustive: true });
  const deep = rig(() => zohoReply(200, { data: filler, info: { more_records: true } }));
  assert.deepEqual((await deep.client.wasDeleted(me, 'Leads', ID, { maxPages: 2 })).value, { deleted: false, exhaustive: false });
  assert.equal(deep.calls.length, 2);
});

test('client: share/unshare hit the Share Records path with a user-only body; the cover job logs ids, no values (TC-E02-017/018)', async () => {
  const job = serviceCredential('cover-window-share', grantFor());
  const { service: client, calls, sink } = rig(() => zohoReply(200, { share: [{ code: 'SUCCESS', status: 'success', details: { id: ID } }] }));
  const res = await load('cover-window-share').runCoverWindowShare(client, job, [
    { leadId: ID, coverUserId: '554023000000235011', state: 'open' },
    { leadId: ID2, coverUserId: '554023000000235011', state: 'closed' },
  ]);
  assert.deepEqual(res.map((r) => r.ok), [true, true]);
  assert.ok(calls[0].url.endsWith(`/Leads/${ID}/actions/share`) && calls[0].init.method === 'POST');
  assert.deepEqual(calls[0].body, { share: [{ share_related_records: false, user: { id: '554023000000235011' }, permission: 'read_write' }] });
  assert.ok(calls[1].url.endsWith(`/Leads/${ID2}/actions/share`) && calls[1].init.method === 'DELETE');
  assert.ok(sink.records().every((x) => x.actor.job === 'cover-window-share' && !('body' in x)), 'job name and ids only');
  await assert.rejects(client.share(job, 'Leads', ID, 'not-a-user', 'read'), TypeError);
});

test('client: an expired token is refused locally, without calling Zoho', async () => {
  const me = await mintUser({ ...grantFor(), expires_in: 1 }, { clock: () => 0 });
  const { client, calls, sink } = rig([], { clock: () => 5_000 });
  const r = await client.getRecord(me, 'Leads', ID);
  assert.equal(r.error.kind, 'auth-expired'); assert.equal(calls.length, 0);
  assert.equal(sink.records()[0].reason, 'token-expired');
});

test('client: a token expiring while queued is refused after gate acquisition and before fetch', async () => {
  let now = 0;
  let releases = 0;
  const entered = deferred();
  const allow = deferred();
  const queuedGate = {
    acquire: async () => {
      entered.resolve();
      await allow.promise;
      return { waitedMs: 1_000, release() { releases++; } };
    },
  };
  const me = await mintUser({ ...grantFor(), expires_in: 1 }, { clock: () => 0 });
  const { client, calls } = rig([], { gate: queuedGate, clock: () => now });
  const pending = client.getRecord(me, 'Leads', ID);
  await entered.promise;
  now = 1_000;
  allow.resolve();
  const result = await pending;
  assert.equal(result.ok, false); assert.equal(result.error.kind, 'auth-expired');
  assert.equal(calls.length, 0, 'an expired queued call never fetches');
  assert.equal(releases, 1, 'the acquired lease is released on local expiry refusal');
});

test('client: a token expiring during retry backoff is not used for another fetch', async () => {
  let now = 0;
  let sleeps = 0;
  const me = await mintUser({ ...grantFor(), expires_in: 1 }, { clock: () => 0 });
  const { client, calls } = rig(() => zohoReply(503, null), {
    clock: () => now,
    sleep: async () => { sleeps++; now = 1_000; },
  });
  const result = await client.getRecord(me, 'Leads', ID);
  assert.equal(result.ok, false); assert.equal(result.error.kind, 'auth-expired');
  assert.equal(sleeps, 1, 'one retry backoff completes before expiry is observed');
  assert.equal(calls.length, 1, 'there is no post-expiry retry fetch');
});

/* ===== LOG =============================================================================== */

test('log: Plane B never contains a request or response body', async () => {
  const PII = ['Anand Pillai', '+91 99001 44821', '9900144821', 'anand.pillai@gmail.com', 'ABCDE1234F', '1000.secret-token', 'Wants the block walked'];
  const me = await mintUser();
  const echo = (url, init) => {
    if (url.includes('/search')) return zohoReply(200, { data: [record(ID, { Last_Name: 'Anand Pillai', Mobile: '+91 99001 44821', Email: 'anand.pillai@gmail.com' })], info: { more_records: false } });
    if (url.endsWith('/coql')) return zohoReply(200, { data: [record(ID2, { PAN: 'ABCDE1234F', Note: 'Wants the block walked' })], info: { more_records: false } });
    if (url.includes('/upsert')) return zohoReply(400, { data: [{ code: 'INVALID_DATA', details: { api_name: 'PAN', value: 'ABCDE1234F' }, message: 'invalid data ABCDE1234F', status: 'error' }] });
    return zohoReply(200, { data: [{ code: 'SUCCESS', details: { id: ID, Modified_Time: '2026-09-23T10:05:00+05:30', Last_Name: 'Anand Pillai' }, message: 'record updated', status: 'success' }] });
  };
  const { client, sink } = rig(echo);
  await client.search(me, 'Leads', { phone: '+91 99001 44821' });
  await client.search(me, 'Leads', { criteria: '(Email:equals:anand.pillai@gmail.com)' });
  await client.coql(me, "select PAN from Contacts where Mobile = '9900144821'");
  await client.update(me, 'Leads', ID, { Last_Name: 'Anand Pillai', Description: 'Wants the block walked' }, { ifUnmodifiedSince: null });
  await client.upsert(me, 'Contacts', [{ Last_Name: 'Anand Pillai', PAN: 'ABCDE1234F' }], ['Mobile']);
  const log = createOpsLog(sink);
  log.call({ at: 1, actor: { kind: 'user', userId: 'kavya' }, op: 'search', method: 'GET', endpoint: '/Leads/search?phone=9900144821', callClass: 'simple', status: 200,
    durationMs: 3, gateWaitMs: 0, attempt: 1, creditsRemaining: null, errorClass: null, recordIds: ['9900144821', ID], body: 'Anand Pillai', response: { Mobile: '+91 99001 44821' } });
  log.call({ at: 1, actor: { kind: 'user', userId: 'anand.pillai@gmail.com' }, op: 'getRecord', method: 'GET', endpoint: '/Leads/{id}', callClass: 'simple', status: 200,
    durationMs: 3, gateWaitMs: 0, attempt: 1, creditsRemaining: null, errorClass: null, recordIds: [] });
  const records = sink.records();
  const dump = JSON.stringify(records);
  for (const s of PII) assert.ok(!dump.includes(s), `Plane B does not contain ${JSON.stringify(s)}`);
  const CALL_KEYS = ['kind', 'at', 'actor', 'op', 'method', 'endpoint', 'callClass', 'status', 'durationMs', 'gateWaitMs', 'attempt', 'creditsRemaining', 'errorClass', 'recordIds'];
  for (const r of records.filter((x) => x.kind === 'zoho-call')) {
    assert.deepEqual(Object.keys(r).sort(), [...CALL_KEYS].sort(), 'a call line has exactly the allowed fields');
    assert.ok(!r.endpoint.includes('?') && !r.endpoint.includes('='), `endpoint ${r.endpoint} carries no query`);
    for (const id of r.recordIds) assert.match(id, /^\d{15,22}$/);
    assert.ok(Object.isFrozen(r));
  }
  const smuggled = records.at(-2);
  assert.equal(smuggled.endpoint, '/unrecognised'); assert.deepEqual(smuggled.recordIds, [ID], 'a phone number does not pass for a record id');
  assert.deepEqual(records.at(-1).actor, { kind: 'user', userId: 'unrecognised' }, 'an email is never the actor id');
  assert.ok(records.some((r) => r.recordIds.includes(ID) && r.op === 'search'), 'but who read which record is kept');
  const throwing = createOpsLog({ write() { throw new Error('disk full'); } });
  assert.doesNotThrow(() => throwing.call({ ...records[0] }), 'a failing sink never fails the call it describes');
});

/* ===== ADAPTER =========================================================================== */

test('adapter (fixture): bound to one person; sees what Zoho would let them see', async () => {
  const kavya = createFixtureAdapter({ who: 'kavya' });
  const book = await kavya.readMyBook();
  assert.ok(book.ok && book.value.length > 0);
  assert.ok(book.value.every((v) => v.lead.own === 'kavya'), 'her book is her records');
  assert.equal((await kavya.readTeamBook()).error.kind, 'forbidden', 'an IR has no team book');
  assert.equal((await kavya.readLead('L2')).error.kind, 'forbidden', "another IR's lead is not visible");
  assert.equal((await kavya.readLead('NOPE')).error.kind, 'not-found');
  const nikhil = await createFixtureAdapter({ who: 'nikhil' }).readMyBook();
  assert.ok(nikhil.value.some((v) => v.lead.own === 'ananya'), "a cover window shares the covered IR's leads (D44)");
  const tasneem = await createFixtureAdapter({ who: 'tasneem' }).readTeamBook();
  assert.ok(tasneem.ok && ['kavya', 'rohit', 'ananya', 'nikhil'].every((p) => tasneem.value.some((v) => v.lead.own === p)), 'the manager sees her subtree');
  const withPaper = (await kavya.readLead('L3')).value;
  assert.ok(withPaper.paper && withPaper.paper.nda, 'the paper comes from seedBook()');
  assert.throws(() => createFixtureAdapter({ who: 'nobody' }), TypeError);
});

test('adapter (fixture): writes are conditional on the loaded version, and never touch the seed', async () => {
  const kavya = createFixtureAdapter({ who: 'kavya' });
  const loaded = (await kavya.readLead('L1')).value;
  assert.equal(loaded.lead.done, 1);
  const touched = await kavya.writeTouch('L1', 'msg', loaded.version);
  assert.ok(touched.ok); assert.notEqual(touched.value.version, loaded.version); assert.equal(touched.value.lead.touch.msg.length, 1);
  const stale = await kavya.moveRung('L1', { from: 1, to: 2 }, loaded.version);
  assert.equal(stale.error.kind, 'conflict', 'a stale version is a conflict, as a 412 would be');
  assert.equal((await kavya.moveRung('L1', { from: 3, to: 4 }, null)).error.kind, 'conflict', 'a stale rung is a conflict');
  const moved = await kavya.moveRung('L1', { from: 1, to: 2 }, touched.value.version);
  assert.ok(moved.ok); assert.equal(moved.value.lead.done, 2); assert.equal(moved.value.lead.at.length, 2);
  assert.equal((await kavya.moveRung('L1', { from: 2, to: 4 }, null)).error.kind, 'invalid', 'one step at a time');
  assert.equal((await kavya.moveRung('L5', { from: 5, to: 6 }, null)).error.kind, 'forbidden', "Finance's gate is not the IR's to tick");
  assert.equal((await kavya.writeTouch('L2', 'call', null)).error.kind, 'forbidden');
  const lost = await kavya.closeLost('L1', 'Timing — not now', '', null);
  assert.ok(lost.ok && lost.value.lead.lost.why === 'Timing — not now');
  assert.equal((await kavya.moveRung('L1', { from: 2, to: 3 }, null)).error.kind, 'invalid', 'a closed lead does not move');
  const { LEADS } = require(path.join(outDir, 'domain', 'leads.js'));
  const seedL1 = LEADS.find((l) => l.id === 'L1');
  assert.equal(seedL1.done, 1); assert.equal(seedL1.touch.msg.length, 0); assert.equal(seedL1.lost, undefined);
  const mutable = (await kavya.readLead('L3')).value;
  mutable.lead.done = 99;
  assert.equal((await kavya.readLead('L3')).value.lead.done, 4, 'a returned view is a copy');
});

test('adapter (fixture): funnels are cached per scope and invalidated by a write', async () => {
  const clock = clockAt(0);
  const cache = createScopedCache({ clock });
  const kavya = createFixtureAdapter({ who: 'kavya', cache, clock });
  const tasneem = createFixtureAdapter({ who: 'tasneem', cache, clock });
  const first = await kavya.readMyFunnel();
  assert.equal(first.state, 'miss');
  const own = await first.settled;
  const total = (buckets) => buckets.reduce((n, b) => n + b.count, 0);
  const mine = (await kavya.readMyBook()).value.length;
  assert.equal(total(own.value), mine);
  const team = await (await tasneem.readTeamFunnel()).settled;
  assert.ok(total(team.value) > total(own.value), "the manager's funnel counts the subtree — under its own key");
  assert.equal((await kavya.readMyFunnel()).state, 'fresh');
  const refused = await kavya.readTeamFunnel();
  assert.equal(refused.state, 'error'); assert.equal(refused.reason, 'forbidden'); assert.ok(!('value' in refused));
  const before = own.value.find((b) => b.key === 'capture').count;
  await kavya.moveRung('L1', { from: 1, to: 2 }, null);
  const after = await kavya.readMyFunnel();
  assert.equal(after.state, 'miss', "a write invalidates the writer's funnel");
  assert.equal((await after.settled).value.find((b) => b.key === 'capture').count, before - 1);
  assert.equal((await tasneem.readTeamFunnel()).state, 'miss', "and the manager's, which counted the same lead");
});

test('adapter (live): a typed stub that fails loudly, never falls back to the fixture', async () => {
  const { client, calls } = rig([]);
  const live = createLiveAdapter({ who: 'kavya', credential: await mintUser(), client, cache: createScopedCache() });
  assert.equal(live.source, 'live');
  for (const r of [await live.readMyBook(), await live.readLead('L1'), await live.moveRung('L1', { from: 1, to: 2 }, null)]) {
    assert.equal(r.ok, false); assert.equal(r.error.kind, 'not-implemented');
  }
  const funnel = await live.readMyFunnel();
  assert.equal(funnel.state, 'error'); assert.equal(funnel.reason, 'not-implemented');
  assert.equal(calls.length, 0);
});
