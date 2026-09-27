/* M20-S08 SERVICE TOKEN REGRESSION
 * Run from console/: node src/server/oauth/service-token.test.cjs
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const consoleRoot = path.resolve(__dirname, '..', '..', '..');
const srcRoot = path.join(consoleRoot, 'src');
const fixtureRoot = path.join(srcRoot, 'lib', 'zoho', '__fixtures__', 'oauth');
const ts = require(path.join(consoleRoot, 'node_modules', 'typescript'));
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoho-service-token-'));
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
  'server/oauth/service-token.ts',
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
const {
  createServiceTokenProvider,
  SERVICE_TOKEN_REFRESH_SKEW_MS,
} = load(path.join('server', 'oauth', 'service-token.js'));

const CLIENT_ID = 'synthetic-client-id';
const CLIENT_SECRET = 'synthetic-client-secret';
const REFRESH_TOKEN = 'synthetic-refresh-token';
const ACCESS_TOKEN = 'synthetic-oauth-access-token-never-live';
const IDENTITY = 'fixture.service@example.invalid';

const readJson = (name) => JSON.parse(fs.readFileSync(path.join(fixtureRoot, name), 'utf8'));
const success = readJson('service-token.success.response.json');
const rotated = readJson('service-token.rotated.response.json');
const wrongDc = readJson('service-token.wrong-dc.response.json');
const invalid = readJson('service-token.invalid.response.json');
const denied = readJson('service-token.denied.response.json');

const replyFrom = (recording) => ({
  status: recording.status,
  headers: { get: (name) => recording.headers?.[name.toLowerCase()] || null },
  text: async () => JSON.stringify(recording.body),
});
const clockAt = (initial) => {
  let now = initial;
  const clock = () => now;
  clock.advance = (ms) => { now += ms; };
  return clock;
};
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

function providerHarness(fetch, clock = clockAt(1_000_000), providerOptions = {}) {
  const sink = createMemorySink();
  const log = createOpsLog(sink);
  const provider = createServiceTokenProvider({
    job: 'provider-callback',
    accountsOrigin: 'https://accounts.zoho.in',
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    refreshToken: REFRESH_TOKEN,
    fetch,
    clock,
    log,
    ...providerOptions,
  });
  return { provider, sink, clock };
}

function assertPlaneBHasNoSecrets(records, extra = []) {
  const dump = JSON.stringify(records);
  for (const secret of [CLIENT_ID, CLIENT_SECRET, REFRESH_TOKEN, ACCESS_TOKEN, IDENTITY, ...extra]) {
    assert.ok(!dump.includes(secret), `Plane B must not contain ${JSON.stringify(secret)}`);
  }
  for (const record of records) {
    assert.ok(!('body' in record));
    assert.ok(!('response' in record));
    assert.equal(record.endpoint, '/oauth/v2/token');
  }
}

test('refresh-token POST mints one cached service credential and Plane B contains no grant or secret', async () => {
  const calls = [];
  const clock = clockAt(1_000_000);
  const { provider, sink } = providerHarness(async (url, init) => {
    calls.push({ url, init });
    return replyFrom(success);
  }, clock);

  const first = await provider.credential();
  const second = await provider.credential();

  assert.strictEqual(second, first, 'the valid credential is cached');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://accounts.zoho.in/oauth/v2/token');
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(calls[0].init.headers, {
    Accept: 'application/json',
    'Content-Type': 'application/x-www-form-urlencoded',
  });
  const form = new URLSearchParams(calls[0].init.body);
  assert.equal(form.get('grant_type'), 'refresh_token');
  assert.equal(form.get('client_id'), CLIENT_ID);
  assert.equal(form.get('client_secret'), CLIENT_SECRET);
  assert.equal(form.get('refresh_token'), REFRESH_TOKEN);

  assert.equal(first.kind, 'service');
  assert.equal(first.job, 'provider-callback');
  assert.equal(first.apiDomain, 'https://www.zohoapis.in');
  assert.equal(first.accessToken, ACCESS_TOKEN);
  assert.equal(first.expiresAt, 1_000_000 + 3_600_000);
  assert.ok(first.expiresAt > clock() + SERVICE_TOKEN_REFRESH_SKEW_MS);
  assert.equal(Object.prototype.propertyIsEnumerable.call(first, 'accessToken'), false);
  assert.equal(JSON.parse(JSON.stringify(first)).accessToken, '[redacted]');

  assert.equal(sink.records().length, 1);
  assert.equal(sink.records()[0].errorClass, null);
  assertPlaneBHasNoSecrets(sink.records());
});

test('concurrent callers share one in-flight refresh and receive the same minted credential', async () => {
  const gate = deferred();
  let fetches = 0;
  const { provider, sink } = providerHarness(async () => {
    fetches++;
    return gate.promise;
  });

  const first = provider.credential();
  const second = provider.credential();
  assert.equal(fetches, 1, 'only one POST starts');
  gate.resolve(replyFrom(success));
  const [a, b] = await Promise.all([first, second]);

  assert.strictEqual(a, b);
  assert.equal(fetches, 1);
  assert.equal(sink.records().length, 1);
  assertPlaneBHasNoSecrets(sink.records());
});

test('malformed success and OAuth denial fail closed, are not cached, and never log response bodies', async (t) => {
  for (const [name, recording, expectedClass] of [
    ['malformed 200 grant', invalid, 'unexpected'],
    ['401 denial', denied, 'auth-rejected'],
  ]) {
    await t.test(name, async () => {
      let fetches = 0;
      const { provider, sink } = providerHarness(async () => {
        fetches++;
        return replyFrom(recording);
      });

      await assert.rejects(provider.credential(), /^Error: Zoho service credential is unavailable\.$/);
      await assert.rejects(provider.credential(), /^Error: Zoho service credential is unavailable\.$/);
      assert.equal(fetches, 2, 'a failed grant is never cached');
      assert.equal(sink.records().length, 2);
      assert.ok(sink.records().every((record) => record.errorClass === expectedClass));
      assertPlaneBHasNoSecrets(sink.records(), [recording.body.error_description]);
    });
  }
});

test('one caller can abort without cancelling the provider-owned refresh or another joiner', async () => {
  const gate = deferred();
  let fetches = 0;
  const { provider, sink } = providerHarness(async () => {
    fetches++;
    return gate.promise;
  });
  const controller = new AbortController();
  const leaving = provider.credential(controller.signal);
  const staying = provider.credential();
  controller.abort();
  await assert.rejects(leaving, /^Error: Zoho service credential is unavailable\.$/);
  assert.equal(fetches, 1, 'the shared refresh was not cancelled or restarted');

  gate.resolve(replyFrom(success));
  const credential = await staying;
  assert.equal(credential.accessToken, ACCESS_TOKEN);
  assert.strictEqual(await provider.credential(), credential, 'the joiner populated the cache');
  assert.equal(fetches, 1);
  assert.equal(sink.records().length, 1);
  assert.equal(sink.records()[0].errorClass, null);
  assertPlaneBHasNoSecrets(sink.records(), ['synthetic abort']);
});

test('an already-aborted caller starts no shared refresh', async () => {
  let fetches = 0;
  const { provider, sink } = providerHarness(async () => {
    fetches++;
    return replyFrom(success);
  });
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(provider.credential(controller.signal), /^Error: Zoho service credential is unavailable\.$/);
  assert.equal(fetches, 0);
  assert.equal(sink.records().length, 0);
});

test('provider-owned refresh timeout fails closed, clears singleflight state, and permits recovery', async () => {
  let fetches = 0;
  let recover = false;
  const { provider, sink } = providerHarness(async (_url, init) => {
    fetches++;
    if (recover) return replyFrom(success);
    return new Promise((resolve, reject) => {
      const abort = () => reject(Object.assign(new Error('synthetic provider timeout'), { name: 'AbortError' }));
      if (init.signal?.aborted) abort();
      else init.signal?.addEventListener('abort', abort, { once: true });
    });
  }, clockAt(1_000_000), { refreshTimeoutMs: 100 });
  await assert.rejects(provider.credential(), /^Error: Zoho service credential is unavailable\.$/);

  recover = true;
  const credential = await provider.credential();
  assert.equal(credential.accessToken, ACCESS_TOKEN);
  assert.equal(fetches, 2);
  assert.equal(sink.records()[0].errorClass, 'aborted');
  assert.equal(sink.records()[0].status, null);
  assert.equal(sink.records()[1].errorClass, null);
  assertPlaneBHasNoSecrets(sink.records(), ['synthetic provider timeout']);
});

test('invalidate clears only the rejected cached credential, never a newer grant', async () => {
  const responses = [success, rotated];
  let fetches = 0;
  const { provider, sink } = providerHarness(async () => replyFrom(responses[fetches++]));

  const oldCredential = await provider.credential();
  assert.strictEqual(await provider.credential(), oldCredential);
  provider.invalidate(oldCredential);
  const freshCredential = await provider.credential();
  assert.notStrictEqual(freshCredential, oldCredential);
  assert.equal(freshCredential.accessToken, rotated.body.access_token);
  assert.equal(fetches, 2);

  provider.invalidate(oldCredential);
  assert.strictEqual(await provider.credential(), freshCredential, 'late invalidation of the old grant keeps the newer cache');
  assert.equal(fetches, 2);
  assertPlaneBHasNoSecrets(sink.records(), [rotated.body.access_token]);
});

test('expected API domain refuses a valid Zoho grant from the wrong data centre', async () => {
  let fetches = 0;
  const { provider, sink } = providerHarness(async () => {
    fetches++;
    return replyFrom(wrongDc);
  }, clockAt(1_000_000), { expectedApiDomain: 'https://www.zohoapis.in' });

  await assert.rejects(provider.credential(), /^Error: Zoho service credential is unavailable\.$/);
  await assert.rejects(provider.credential(), /^Error: Zoho service credential is unavailable\.$/);
  assert.equal(fetches, 2, 'a wrong-DC grant is never cached');
  assert.ok(sink.records().every((record) => record.status === 200 && record.errorClass === 'unexpected'));
  assertPlaneBHasNoSecrets(sink.records(), [wrongDc.body.access_token]);
  assert.throws(() => providerHarness(async () => replyFrom(success), clockAt(1_000_000), {
    expectedApiDomain: 'https://not-zoho.example.invalid',
  }), /Zoho API host/, 'the expected domain itself is allowlisted');
});
