/* M20-S08 ZOHO SIGN WEBHOOK REGRESSION
 *
 * Run from console/: node src/server/zoho-sign/webhook.test.cjs
 *
 * Type-checks and emits the production boundary with the project's TypeScript,
 * then exercises it with sanitized recorded Zoho responses. No request reaches
 * Zoho, and no fixture contains real investor data.
 */
'use strict';

const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const consoleRoot = path.resolve(__dirname, '..', '..', '..');
const srcRoot = path.join(consoleRoot, 'src');
const fixtureRoot = path.join(srcRoot, 'lib', 'zoho', '__fixtures__', 'zoho-sign');
const ts = require(path.join(consoleRoot, 'node_modules', 'typescript'));
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoho-sign-webhook-'));
process.on('exit', () => fs.rmSync(outDir, { recursive: true, force: true }));

const config = ts.readConfigFile(path.join(consoleRoot, 'tsconfig.json'), ts.sys.readFile);
const project = ts.parseJsonConfigFileContent(config.config, ts.sys, consoleRoot);
const baseOptions = {
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
  'lib/zoho/sign.ts',
  'server/zoho-sign/webhook.ts',
].map((file) => path.join(srcRoot, file));
const format = (diagnostics) => ts.formatDiagnostics(diagnostics, {
  getCanonicalFileName: (file) => file,
  getCurrentDirectory: () => consoleRoot,
  getNewLine: () => '\n',
});
const program = ts.createProgram(sources, baseOptions);
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
const { classifyResponse, isFailure } = load(path.join('lib', 'zoho', 'errors.js'));
const { createGate } = load(path.join('lib', 'zoho', 'gate.js'));
const { createMemorySink, createOpsLog } = load(path.join('lib', 'zoho', 'log.js'));
const { serviceCredential } = load(path.join('lib', 'zoho', 'client.js'));
const { createZohoSignClient, signOriginOf } = load(path.join('lib', 'zoho', 'sign.js'));
const {
  handleZohoSignWebhook,
  verifyZohoSignSignature,
  ZOHO_SIGN_SIGNATURE_HEADER,
} = load(path.join('server', 'zoho-sign', 'webhook.js'));

const SECRET = 'synthetic-webhook-secret-2026';
const ACCESS_TOKEN = 'synthetic-access-token-never-live';
const REQUEST_ID = '9007199254740993123';
const TARGET_ID = '9007199254740993124';
const DOCUMENT_ID = '9007199254740993125';
const DECOY_ID = '9007199254740993999';
const PII_MARKERS = [
  'Synthetic Fixture Person',
  'fixture.person@example.invalid',
  '+91 90000 00000',
  'Synthetic Fixture Investor',
  'fixture.investor@example.invalid',
  'Synthetic supplementary agreement',
  'fixture.owner@example.invalid',
  ACCESS_TOKEN,
  'synthetic-refreshed-access-token-never-live',
];

const readJson = (name) => JSON.parse(fs.readFileSync(path.join(fixtureRoot, name), 'utf8'));
const callbackBody = fs.readFileSync(path.join(fixtureRoot, 'webhook.completed.json'), 'utf8');
const completedResponse = readJson('sign-get.completed.response.json');
const omittedIdResponse = readJson('sign-get.omitted-id.response.json');
const mismatchedIdResponse = readJson('sign-get.mismatched-id.response.json');
const invalidIdResponse = readJson('sign-get.invalid-id.response.json');
const authExpiredResponse = readJson('sign-get.auth-expired.response.json');
const providerUnavailable = readJson('sign-get.unavailable.response.json');
const supplementaryResponse = readJson('crm-search.supplementary.response.json');
const truncatedResponse = readJson('crm-search.truncated.response.json');
const emptyResponse = readJson('crm-search.empty.response.json');
const crmAuthExpired = readJson('crm.auth-expired.response.json');
const crmUnavailable = readJson('crm.unavailable.response.json');

const signatureOf = (body, secret = SECRET) => createHmac('sha256', secret).update(body, 'utf8').digest('base64');
const ok = (value, status = 200) => ({ ok: true, value, status, creditsRemaining: null });
const failed = (recording) => {
  const error = classifyResponse({ status: recording.status, body: recording.body });
  assert.ok(isFailure(error), `recorded ${recording.status} response is a classified failure`);
  return { ok: false, error, creditsRemaining: null };
};

const credential = serviceCredential('provider-callback', {
  access_token: ACCESS_TOKEN,
  api_domain: 'https://www.zohoapis.in',
});
const refreshedCredential = serviceCredential('provider-callback', {
  access_token: 'synthetic-refreshed-access-token-never-live',
  api_domain: 'https://www.zohoapis.in',
});

function replyFrom(recording) {
  const headers = Object.fromEntries(Object.entries(recording.headers || {}).map(([name, value]) => [name.toLowerCase(), String(value)]));
  return {
    status: recording.status,
    headers: { get: (name) => headers[name.toLowerCase()] || null },
    text: async () => JSON.stringify(recording.body),
  };
}

function signHarness(log, recording = completedResponse, options = {}) {
  const calls = [];
  const recordings = Array.isArray(recording) ? recording : [recording];
  let responseAt = 0;
  const sign = createZohoSignClient({
    origin: options.origin || 'https://sign.zoho.in',
    gate: createGate(),
    log,
    maxAttempts: 1,
    clock: options.clock,
    fetch: async (url, init) => {
      calls.push({ url, method: init.method, headers: { ...init.headers } });
      const next = recordings[Math.min(responseAt, recordings.length - 1)];
      responseAt++;
      return replyFrom(next);
    },
  });
  return { sign, calls };
}

function crmHarness(options = {}) {
  const searches = [];
  const updates = [];

  const crm = {
    async search(as, module, query, callOptions) {
      searches.push({ as, module, query: { ...query }, options: { ...callOptions } });
      if (options.searchFailure) return failed(crmUnavailable);
      if (options.authFailureAlways || (options.authFailureOnce && searches.length <= 4)) return failed(crmAuthExpired);
      const isSupplementary = module === 'LLP_UnitAllocation_Module'
        && query.criteria === `(Supplementary_Sign_Req_Id:equals:${REQUEST_ID})`;
      const recorded = options.moreRecords ? truncatedResponse : supplementaryResponse;
      const rows = isSupplementary && options.target !== false
        ? recorded.body.data.map((record) => ({ ...record }))
        : emptyResponse.body.data;
      return ok({
        records: rows,
        moreRecords: isSupplementary && options.moreRecords === true,
        ...(isSupplementary && options.invalidRecordIds ? { invalidRecordIds: true } : {}),
      });
    },
    async update(as, module, id, fields, callOptions) {
      updates.push({ as, module, id, fields: { ...fields }, options: { ...callOptions } });
      if (options.updateFailure) return failed(crmUnavailable);
      return ok({ id, modifiedTime: '2026-09-27T09:31:00+05:30' });
    },
  };
  return { crm, searches, updates };
}

function webhookRig(options = {}) {
  const sink = createMemorySink();
  const log = createOpsLog(sink);
  const signSide = signHarness(log, options.signRecording || completedResponse);
  const crmSide = crmHarness(options.crm || {});
  let credentialCalls = 0;
  const invalidated = [];
  const credentials = options.credentials || [credential];
  return {
    ...signSide,
    ...crmSide,
    sink,
    deps: {
      secrets: [SECRET],
      sign: signSide.sign,
      crm: crmSide.crm,
      credential: async () => {
        credentialCalls++;
        if (options.credentialFailure) throw new Error('synthetic credential failure');
        return credentials[Math.min(credentialCalls - 1, credentials.length - 1)];
      },
      invalidateCredential: (rejected) => { invalidated.push(rejected); },
      log,
    },
    credentialCalls: () => credentialCalls,
    invalidated,
  };
}

function assertNoIdentityInPlaneB(records, additional = []) {
  const dump = JSON.stringify(records);
  for (const marker of [...PII_MARKERS, ...additional]) {
    assert.ok(!dump.includes(marker), `Plane B must not contain ${JSON.stringify(marker)}`);
  }
  for (const record of records) {
    assert.ok(!('body' in record));
    assert.ok(!('response' in record));
    if ('endpoint' in record) assert.ok(!record.endpoint.includes('?'), 'logged endpoints contain no query');
  }
}

test('HMAC is SHA-256/base64 over the exact raw body and the one documented header value', () => {
  const signature = signatureOf(callbackBody);
  assert.equal(ZOHO_SIGN_SIGNATURE_HEADER, 'x-zs-webhook-signature');
  assert.match(signature, /^[A-Za-z0-9+/]{43}=$/);
  assert.equal(verifyZohoSignSignature(callbackBody, signature, [SECRET]), true);
  assert.equal(verifyZohoSignSignature(callbackBody, signature, ['old-synthetic-secret', SECRET]), true, 'rotation keys are accepted');

  const headers = new Headers({ 'X-ZS-Webhook-Signature': signature });
  assert.equal(headers.get(ZOHO_SIGN_SIGNATURE_HEADER), signature, 'HTTP header lookup is case-insensitive');
  assert.equal(verifyZohoSignSignature(callbackBody, `sha256=${signature}`, [SECRET]), false, 'scheme prefixes are not part of the header value');
  assert.equal(verifyZohoSignSignature(callbackBody, `${signature}, ${signature}`, [SECRET]), false, 'combined duplicate headers are refused');
  assert.equal(verifyZohoSignSignature(callbackBody, null, [SECRET]), false);
  assert.equal(verifyZohoSignSignature(callbackBody, signature, ['different-synthetic-secret']), false);
  assert.equal(verifyZohoSignSignature(`${callbackBody} `, signature, [SECRET]), false, 'one raw whitespace byte changes the MAC');
  assert.equal(verifyZohoSignSignature(callbackBody.replace('declined', 'completed'), signature, [SECRET]), false, 'a payload change changes the MAC');
});

test('tampered or missing HMAC is refused before JSON parsing or any source call, without identity in Plane B', async (t) => {
  const validSignature = signatureOf(callbackBody);
  const cases = [
    {
      name: 'tampered',
      body: callbackBody.replace('declined', 'completed'),
      signature: validSignature,
    },
    {
      name: 'missing on malformed payload',
      body: '{"requests":{"recipient_name":"Never Parsed Fixture Person"',
      signature: null,
    },
  ];

  for (const sample of cases) {
    await t.test(sample.name, async () => {
      let signCalls = 0;
      let crmCalls = 0;
      let credentialCalls = 0;
      const sink = createMemorySink();
      const log = createOpsLog(sink);
      const result = await handleZohoSignWebhook(
        { body: sample.body, signature: sample.signature },
        {
          secrets: [SECRET],
          credential: async () => { credentialCalls++; return credential; },
          invalidateCredential() { throw new Error('must not invalidate a credential'); },
          log,
          sign: { async getRequest() { signCalls++; throw new Error('must not reach Sign'); } },
          crm: {
            async search() { crmCalls++; throw new Error('must not reach CRM'); },
            async update() { crmCalls++; throw new Error('must not reach CRM'); },
          },
        },
      );
      assert.deepEqual(result, { ok: false, kind: 'invalid-signature', retryable: false });
      assert.equal(signCalls, 0);
      assert.equal(crmCalls, 0);
      assert.equal(credentialCalls, 0, 'junk cannot trigger an OAuth refresh');
      assert.equal(sink.records().length, 1);
      assert.equal(sink.records()[0].reason, 'invalid-signature');
      assertNoIdentityInPlaneB(sink.records(), ['Never Parsed Fixture Person']);
    });
  }
});

test('recorded Sign response keeps every 19-digit id as a string and drops identity fields from Plane B', async () => {
  const sink = createMemorySink();
  const log = createOpsLog(sink);
  const { sign, calls } = signHarness(log);
  const result = await sign.getRequest(credential, REQUEST_ID);

  assert.equal(result.ok, true);
  assert.equal(result.value.requestId, REQUEST_ID);
  assert.equal(typeof result.value.requestId, 'string');
  assert.deepEqual(result.value.documentIds, [DOCUMENT_ID]);
  assert.equal(typeof result.value.documentIds[0], 'string');
  assert.deepEqual(Object.keys(result.value).sort(), ['actionTime', 'documentIds', 'modifiedTime', 'requestId', 'status']);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `https://sign.zoho.in/api/v1/requests/${REQUEST_ID}`);
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].headers.Authorization, `Zoho-oauthtoken ${ACCESS_TOKEN}`);
  assertNoIdentityInPlaneB(sink.records());
});

test('Sign origin and service credentials enforce allowlist, India DC, provenance and expiry before fetch', async () => {
  assert.equal(signOriginOf('https://sign.zoho.in'), 'https://sign.zoho.in');
  for (const bad of [
    'http://sign.zoho.in',
    'https://sign.zoho.in.evil.example.invalid',
    'https://sign.zoho.in:444',
    'https://sign.zoho.in/api/v1',
    'https://user:pass@sign.zoho.in',
  ]) assert.throws(() => signOriginOf(bad), TypeError, bad);

  const sink = createMemorySink();
  const { sign, calls } = signHarness(createOpsLog(sink), completedResponse, { clock: () => 1_000 });
  const forged = {
    kind: 'service',
    job: 'provider-callback',
    apiDomain: 'https://www.zohoapis.in',
    accessToken: 'synthetic-forged-token',
    expiresAt: null,
  };
  await assert.rejects(sign.getRequest(forged, REQUEST_ID), /credential minted/);

  const wrongDc = serviceCredential('provider-callback', {
    access_token: 'synthetic-wrong-dc-token',
    api_domain: 'https://www.zohoapis.com',
  });
  await assert.rejects(sign.getRequest(wrongDc, REQUEST_ID), /same data centre/);

  const expired = serviceCredential('provider-callback', {
    access_token: 'synthetic-expired-token',
    api_domain: 'https://www.zohoapis.in',
    expires_in: 1,
  }, 0);
  const result = await sign.getRequest(expired, REQUEST_ID);
  assert.equal(result.ok, false);
  assert.equal(result.error.kind, 'auth-expired');
  assert.equal(result.error.code, 'TOKEN_EXPIRED');
  assert.equal(calls.length, 0, 'all credential refusals happen before network access');
  assert.ok(sink.records().some((record) => record.kind === 'refusal' && record.reason === 'token-expired'));
  assertNoIdentityInPlaneB(sink.records(), ['synthetic-forged-token', 'synthetic-wrong-dc-token', 'synthetic-expired-token']);
});

test('Sign source rejects a present invalid or mismatched request_id, while documented omission uses the requested id', async (t) => {
  await t.test('omitted request_id is allowed', async () => {
    const sink = createMemorySink();
    const { sign } = signHarness(createOpsLog(sink), omittedIdResponse);
    const result = await sign.getRequest(credential, REQUEST_ID);
    assert.equal(result.ok, true);
    assert.equal(result.value.requestId, REQUEST_ID);
    assert.deepEqual(result.value.documentIds, [DOCUMENT_ID]);
  });

  for (const [name, recording] of [
    ['mismatched string request_id', mismatchedIdResponse],
    ['present numeric request_id', invalidIdResponse],
  ]) {
    await t.test(name, async () => {
      const sink = createMemorySink();
      const { sign } = signHarness(createOpsLog(sink), recording);
      const result = await sign.getRequest(credential, REQUEST_ID);
      assert.equal(result.ok, false);
      assert.equal(result.error.kind, 'invalid-data');
      assert.equal(result.error.code, 'INVALID_SIGN_RESPONSE');
      assert.ok(sink.records().some((record) => record.kind === 'refusal' && record.reason === 'invalid-source-response'));
      assertNoIdentityInPlaneB(sink.records());
    });
  }
});

test('valid callback re-fetches Sign, resolves the stored request id and remains observe-only', async () => {
  const rig = webhookRig();
  const signature = signatureOf(callbackBody);

  const first = await handleZohoSignWebhook({ body: callbackBody, signature }, rig.deps);
  const second = await handleZohoSignWebhook({ body: callbackBody, signature }, rig.deps);

  assert.deepEqual(first, { ok: true, outcome: 'observed', requestId: REQUEST_ID, recordId: TARGET_ID });
  assert.deepEqual(second, { ok: true, outcome: 'observed', requestId: REQUEST_ID, recordId: TARGET_ID });
  assert.equal(rig.calls.length, 2, 'every valid callback re-fetches the Sign source');
  assert.equal(rig.credentialCalls(), 2, 'each accepted delivery resolves a fresh service credential');
  assert.ok(rig.calls.every((call) => call.url.endsWith(`/requests/${REQUEST_ID}`)));
  assert.equal(JSON.parse(callbackBody).requests.request_status, 'declined', 'the callback status is deliberately contrary');
  assert.equal(completedResponse.body.requests.request_status, 'completed', 'the re-fetched source controls the consequence');

  assert.deepEqual(rig.searches.slice(0, 4).map((call) => [call.module, call.query.criteria]), [
    ['Leads', `(NDA_Sign_Req_Id:equals:${REQUEST_ID})`],
    ['Contacts', `(FEMA_Sign_Req_Id:equals:${REQUEST_ID})`],
    ['LLP_UnitAllocation_Module', `(Supplementary_Sign_Req_Id:equals:${REQUEST_ID})`],
    ['LLP_UnitAllocation_Module', `(Alloc_Letter_Sign_Req_Id:equals:${REQUEST_ID})`],
  ]);
  assert.equal(rig.searches.length, 8, 'the record is resolved again for the duplicate callback');
  assert.equal(rig.updates.length, 0, 'M12-S06 owns atomic PDF + certificate + Agreement_Signed');
  assert.equal(first.recordId, TARGET_ID);
  assert.notEqual(first.recordId, DECOY_ID, 'a target id in the callback is ignored');
  assertNoIdentityInPlaneB(rig.sink.records());
});

test('one auth failure invalidates the rejected credential and forces exactly one refresh/retry', async (t) => {
  await t.test('Sign 401', async () => {
    const rig = webhookRig({
      credentials: [credential, refreshedCredential],
      signRecording: [authExpiredResponse, completedResponse],
    });
    const result = await handleZohoSignWebhook(
      { body: callbackBody, signature: signatureOf(callbackBody) },
      rig.deps,
    );

    assert.deepEqual(result, { ok: true, outcome: 'observed', requestId: REQUEST_ID, recordId: TARGET_ID });
    assert.equal(rig.credentialCalls(), 2);
    assert.deepEqual(rig.invalidated, [credential]);
    assert.equal(rig.calls.length, 2, 'the source read is tried only once per credential');
    assert.equal(rig.calls[0].headers.Authorization, `Zoho-oauthtoken ${ACCESS_TOKEN}`);
    assert.equal(rig.calls[1].headers.Authorization, `Zoho-oauthtoken ${refreshedCredential.accessToken}`);
    assert.equal(rig.searches.length, 4);
    assert.ok(rig.searches.every((call) => call.as === refreshedCredential));
    assertNoIdentityInPlaneB(rig.sink.records(), [authExpiredResponse.body.message]);
  });

  await t.test('CRM 401', async () => {
    const rig = webhookRig({
      credentials: [credential, refreshedCredential],
      crm: { authFailureOnce: true },
    });
    const result = await handleZohoSignWebhook(
      { body: callbackBody, signature: signatureOf(callbackBody) },
      rig.deps,
    );

    assert.deepEqual(result, { ok: true, outcome: 'observed', requestId: REQUEST_ID, recordId: TARGET_ID });
    assert.equal(rig.credentialCalls(), 2);
    assert.deepEqual(rig.invalidated, [credential]);
    assert.equal(rig.calls.length, 1, 'a CRM auth retry does not repeat the successful Sign read');
    assert.equal(rig.searches.length, 8);
    assert.ok(rig.searches.slice(0, 4).every((call) => call.as === credential));
    assert.ok(rig.searches.slice(4).every((call) => call.as === refreshedCredential));
    assertNoIdentityInPlaneB(rig.sink.records(), [crmAuthExpired.body.message]);
  });
});

test('a target search reporting more records is ambiguous rather than silently choosing the first', async () => {
  const rig = webhookRig({ crm: { moreRecords: true } });
  const result = await handleZohoSignWebhook(
    { body: callbackBody, signature: signatureOf(callbackBody) },
    rig.deps,
  );

  assert.deepEqual(result, { ok: false, kind: 'ambiguous', retryable: false });
  assert.equal(rig.searches.length, 4);
  assert.equal(rig.updates.length, 0);
  assert.equal(rig.invalidated.length, 0);
  assert.ok(rig.sink.records().some((record) => record.kind === 'refusal'
    && record.reason === 'truncated-targets'
    && record.recordIds.includes(TARGET_ID)));
  assertNoIdentityInPlaneB(rig.sink.records());
});

test('a target search with a lossy or malformed source id is ambiguous, never unlinked', async () => {
  const rig = webhookRig({ crm: { invalidRecordIds: true } });
  const result = await handleZohoSignWebhook(
    { body: callbackBody, signature: signatureOf(callbackBody) },
    rig.deps,
  );

  assert.deepEqual(result, { ok: false, kind: 'ambiguous', retryable: false });
  assert.equal(rig.updates.length, 0);
  assert.ok(rig.sink.records().some((record) => record.kind === 'refusal' && record.reason === 'invalid-target-id'));
  assertNoIdentityInPlaneB(rig.sink.records());
});

test('a signed 19-digit JSON number is refused instead of being rounded or coerced', async () => {
  const body = `{"requests":{"request_id":${REQUEST_ID}}}`;
  let signCalls = 0;
  let crmCalls = 0;
  let credentialCalls = 0;
  const sink = createMemorySink();
  const log = createOpsLog(sink);
  const result = await handleZohoSignWebhook(
    { body, signature: signatureOf(body) },
    {
      secrets: [SECRET],
      credential: async () => { credentialCalls++; return credential; },
      invalidateCredential() { throw new Error('must not invalidate a credential'); },
      log,
      sign: { async getRequest() { signCalls++; throw new Error('must not reach Sign'); } },
      crm: {
        async search() { crmCalls++; throw new Error('must not reach CRM'); },
        async update() { crmCalls++; throw new Error('must not reach CRM'); },
      },
    },
  );
  assert.deepEqual(result, { ok: false, kind: 'invalid-payload', retryable: false });
  assert.equal(signCalls, 0);
  assert.equal(crmCalls, 0);
  assert.equal(credentialCalls, 0, 'invalid payloads cannot refresh OAuth');
  assertNoIdentityInPlaneB(sink.records(), [REQUEST_ID]);
});

test('a valid callback with no stored request-id match is accepted as unlinked', async () => {
  const rig = webhookRig({ crm: { target: false } });
  const result = await handleZohoSignWebhook(
    { body: callbackBody, signature: signatureOf(callbackBody) },
    rig.deps,
  );

  assert.deepEqual(result, { ok: true, outcome: 'unlinked', requestId: REQUEST_ID, recordId: null });
  assert.equal(rig.calls.length, 1);
  assert.equal(rig.searches.length, 4);
  assert.equal(rig.updates.length, 0);
  assert.ok(rig.sink.records().some((record) => record.kind === 'refusal' && record.reason === 'target-not-found'));
  assertNoIdentityInPlaneB(rig.sink.records());
});

test('provider and CRM failures are classified for retry without leaking their recorded bodies', async (t) => {
  await t.test('provider read failure', async () => {
    const rig = webhookRig({ signRecording: providerUnavailable });
    const result = await handleZohoSignWebhook(
      { body: callbackBody, signature: signatureOf(callbackBody) },
      rig.deps,
    );
    assert.deepEqual(result, { ok: false, kind: 'provider-failed', retryable: true });
    assert.equal(rig.credentialCalls(), 1);
    assert.equal(rig.calls.length, 1);
    assert.equal(rig.searches.length, 0);
    assert.equal(rig.updates.length, 0);
    assert.ok(rig.sink.records().some((record) => record.kind === 'zoho-call' && record.errorClass === 'server'));
    assertNoIdentityInPlaneB(rig.sink.records(), [providerUnavailable.body.message]);
  });

  await t.test('CRM lookup failure', async () => {
    const rig = webhookRig({ crm: { searchFailure: true } });
    const result = await handleZohoSignWebhook(
      { body: callbackBody, signature: signatureOf(callbackBody) },
      rig.deps,
    );
    assert.deepEqual(result, { ok: false, kind: 'crm-failed', retryable: true });
    assert.equal(rig.calls.length, 1);
    assert.equal(rig.searches.length, 4, 'parallel lookup starts every recorded-id search');
    assert.equal(rig.updates.length, 0);
    assertNoIdentityInPlaneB(rig.sink.records(), [crmUnavailable.body.message]);
  });

  await t.test('credential refresh failure', async () => {
    const rig = webhookRig({ credentialFailure: true });
    const result = await handleZohoSignWebhook(
      { body: callbackBody, signature: signatureOf(callbackBody) },
      rig.deps,
    );
    assert.deepEqual(result, { ok: false, kind: 'provider-failed', retryable: true });
    assert.equal(rig.credentialCalls(), 1);
    assert.equal(rig.calls.length, 0);
    assert.equal(rig.searches.length, 0);
    assert.equal(rig.updates.length, 0);
    assertNoIdentityInPlaneB(rig.sink.records());
  });
});
