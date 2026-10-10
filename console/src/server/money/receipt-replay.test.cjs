/* M01-S08 RECEIPT REPLAY REGRESSION
 *
 * Run from console/: node src/server/money/receipt-replay.test.cjs
 *
 * Type-checks the production boundary with the project's TypeScript, then exercises it only with
 * sanitized recorded Zoho responses. No request reaches Zoho and no fixture contains real data.
 */
'use strict';

const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, before, test } = require('node:test');

// The service's deadline timers are unref'd on purpose (they must never hold a server process open).
// Several tests stall a dependency on a bare promise and wait for such a deadline; with nothing else
// ref'd, the event loop drains first and node:test cancels that test and every test after it. One
// ref'd handle for the life of this file keeps the loop alive; a real hang still fails at the npm
// test runner's per-file timeout.
const eventLoopKeepAlive = setInterval(() => {}, 60_000);
after(() => clearInterval(eventLoopKeepAlive));

const consoleRoot = path.resolve(__dirname, '..', '..', '..');
const srcRoot = path.join(consoleRoot, 'src');
const fixtureRoot = path.join(srcRoot, 'lib', 'zoho', '__fixtures__', 'receipts');
const ts = require(path.join(consoleRoot, 'node_modules', 'typescript'));
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoho-receipt-replay-'));
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
  'server/money/receipt-replay.ts',
  'server/money/register.ts',
  'server/money/by-allotment.ts',
  'server/state/memory.ts',
  'server/state/catalyst.ts',
  'server/state/fake-catalyst.ts',
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
const { classifyResponse, isFailure, parseCreditsRemaining } = load(path.join('lib', 'zoho', 'errors.js'));
const { createMemorySink, createOpsLog } = load(path.join('lib', 'zoho', 'log.js'));
const { createZohoClient, userCredential } = load(path.join('lib', 'zoho', 'client.js'));
const { createMemoryState } = load(path.join('server', 'state', 'memory.js'));
const { createCatalystState } = load(path.join('server', 'state', 'catalyst.js'));
const { createFakeCatalyst, FAKE_CONFIG } = load(path.join('server', 'state', 'fake-catalyst.js'));
const {
  ALLOTMENTS_MODULE,
  RECEIPTS_MODULE,
  RECEIPT_CONTEXT_MAX_AGE_MS,
  RECEIPT_IDEMPOTENCY_FIELD,
  RECEIPT_REPLAY_MAX_AGE_MS,
  createReceiptReplayService,
  outstandingRupees,
} = load(path.join('server', 'money', 'receipt-replay.js'));

const readJson = (name) => JSON.parse(fs.readFileSync(path.join(fixtureRoot, name), 'utf8'));
const recordings = {
  currentUserFinance: readJson('current-user.finance.response.json'),
  currentUserOther: readJson('current-user.other.response.json'),
  allotment: readJson('allotment.current.response.json'),
  allotmentTargetChanged: readJson('allotment.target-changed.response.json'),
  allotmentIdMismatch: readJson('allotment.id-mismatch.response.json'),
  allotmentImpossibleDate: readJson('allotment.impossible-date.response.json'),
  unsigned: readJson('allotment.unsigned.response.json'),
  supplementaryChanged: readJson('allotment.supplementary-changed.response.json'),
  reservationChanged: readJson('allotment.reservation-changed.response.json'),
  holdChanged: readJson('allotment.hold-changed.response.json'),
  empty: readJson('receipts.empty.response.json'),
  advance: readJson('receipts.advance.response.json'),
  partRecorded: readJson('receipts.part-recorded.response.json'),
  balanceRecorded: readJson('receipts.balance-recorded.response.json'),
  balanceRecordedFirstReplay: readJson('receipts.balance-recorded-first-replay.response.json'),
  balanceRecordedSameUtr: readJson('receipts.balance-recorded-same-utr.response.json'),
  excessCredit: readJson('receipts.excess-credit.response.json'),
  created: readJson('receipt.created.response.json'),
  duplicateData207: readJson('receipt.duplicate-data-207.response.json'),
  malformedPartial207: readJson('receipt.partial-malformed-207.response.json'),
  existingSame: readJson('receipt.existing-same.response.json'),
  existingConflict: readJson('receipt.existing-conflict.response.json'),
  existingKeyConflict: readJson('receipt.existing-key-conflict.response.json'),
  existingBalanceOtherKey: readJson('receipt.existing-balance-other-key.response.json'),
  serverError: readJson('source.server-error.response.json'),
};

const ALLOTMENT_ID = '9007199254740993001';
const CUSTOMER_ID = '9007199254740993002';
const LLP_ID = '9007199254740993003';
const RECEIPT_ID = '9007199254740993005';
const FILE_ID = 'ZFS_encrypted_fixture_9xQ2Lm7N';
const SIGN_REQUEST_ID = '9007199254740993007';
const ACTOR_ID = '9007199254740993090';
const OTHER_ACTOR_ID = '9007199254740993091';
const SESSION_ID = 'session_fixture_00000001';
const OTHER_SESSION_ID = 'session_fixture_00000002';
const FOREIGN_RECORD_ID = '8007199254740993999';
const IDEMPOTENCY_KEY = 'receipt_session_a_0001';
const OTHER_IDEMPOTENCY_KEY = 'receipt_session_b_0002';
const IDEMPOTENCY_SECRET = 'synthetic-receipt-idempotency-secret-0001';
const CONTEXT_SIGNING_SECRET = 'synthetic-receipt-context-signing-secret-0001';
const OLD_CONTEXT_SIGNING_SECRET = 'synthetic-receipt-context-signing-secret-old1';
const NEXT_CONTEXT_SIGNING_SECRET = 'synthetic-receipt-context-signing-secret-next1';
const ACCESS_TOKEN = 'synthetic-user-access-token-never-live';
const OTHER_ACCESS_TOKEN = 'synthetic-other-access-token-never-live';
const RECORD_ID_PREFIX = '9007199254';
const NOW = Date.parse('2026-09-02T09:02:00+05:30');

const BASE_INTENT = Object.freeze({
  allotmentId: ALLOTMENT_ID,
  kind: 'Full',
  amountRupees: 2250000,
  mode: 'RTGS',
  utr: ' hdfc2609001 ',
  receivedOn: '2026-09-02T09:00:00+05:30',
});
// The register's view of the fixture ledger (one Pending ₹2.5 L Advance): nothing matched, so all ₹25 L is still due
// (D21 — Pending never counts as matched) and ₹2.5 L is recorded and waiting.
const SIGNED_SNAPSHOT = Object.freeze({
  amountDueRupees: 2500000,
  recordedRupees: 250000,
  target: Object.freeze({ customerId: CUSTOMER_ID, llpId: LLP_ID }),
  supplementary: Object.freeze({
    fileIds: Object.freeze([FILE_ID]),
    signRequestId: SIGN_REQUEST_ID,
    signedVia: 'Zoho Sign – Aadhaar',
    verifiedAt: '2026-09-01T10:15:00+05:30',
  }),
  reservation: Object.freeze({
    allocationState: 'Reserved',
    units: 1,
    unitPriceRupees: 2500000,
    holdUntil: '2026-09-23',
    extensionState: null,
    extensionDecidedAt: null,
  }),
});
const UNSIGNED_SNAPSHOT = Object.freeze({
  ...SIGNED_SNAPSHOT,
  supplementary: Object.freeze({ fileIds: Object.freeze([]), signRequestId: null, signedVia: null, verifiedAt: null }),
});

const identityFor = (actor = ACTOR_ID, sessionId = SESSION_ID) => ({ credential: { userId: actor }, sessionId });
let credentialsByActor = new Map();

function recordedCurrentUserFetch(recording, accessToken) {
  return async (url, init) => {
    assert.equal(url, 'https://www.zohoapis.in/crm/v8/users?type=CurrentUser');
    assert.equal(init.method, 'GET');
    assert.equal(init.redirect, 'error');
    assert.equal(init.headers.Accept, 'application/json');
    assert.equal(init.headers.Authorization, `Zoho-oauthtoken ${accessToken}`);
    const response = recordedResponse(recording);
    assert.ok(response.body, 'the recorded CurrentUser reply is delivered as a stream');
    assert.equal(typeof response.body.getReader, 'function');
    return response;
  };
}

function immediateGate() {
  return {
    async acquire(callClass, signal) {
      assert.match(callClass, /^(simple|complex)$/);
      assert.equal(signal?.aborted ?? false, false);
      return { waitedMs: 0, release() {} };
    },
  };
}

before(async () => {
  const identityGate = immediateGate();
  const identityLog = createOpsLog(createMemorySink());
  const identities = [
    [ACTOR_ID, ACCESS_TOKEN, recordings.currentUserFinance],
    [OTHER_ACTOR_ID, OTHER_ACCESS_TOKEN, recordings.currentUserOther],
  ];
  const minted = await Promise.all(identities.map(async ([actorId, accessToken, recording]) => {
    const credential = await userCredential({
      access_token: accessToken,
      api_domain: 'https://www.zohoapis.in',
      expires_in: 3_600,
    }, {
      recordIdPrefix: RECORD_ID_PREFIX,
      gate: identityGate,
      log: identityLog,
      fetch: recordedCurrentUserFetch(recording, accessToken),
      clock: () => NOW,
    });
    assert.equal(credential.userId, actorId, 'CurrentUser is the only source of the local Zoho actor id');
    assert.match(credential.userId, /^9007199254\d+$/);
    return [actorId, credential];
  }));
  credentialsByActor = new Map(minted);
});

const credentialFor = (actor = ACTOR_ID) => {
  const credential = credentialsByActor.get(actor);
  assert.ok(credential, `recorded CurrentUser credential was not initialised for ${actor}`);
  return credential;
};
const principalFor = (actor = ACTOR_ID, sessionId = SESSION_ID) => ({ credential: credentialFor(actor), sessionId });
function durableKeyFor(principal, opaqueKey, secret = IDEMPOTENCY_SECRET) {
  const canonical = JSON.stringify(['receipt-v1', principal.credential.userId, principal.sessionId, opaqueKey]);
  return `receipt-v1_${createHmac('sha256', secret).update(canonical, 'utf8').digest('base64url')}`;
}
function contextTokenFor(principal, preparedAt, allotmentId, expected, secret = CONTEXT_SIGNING_SECRET) {
  const canonical = JSON.stringify([
    'receipt-context-v1',
    principal.credential.userId,
    principal.sessionId,
    preparedAt,
    allotmentId,
    expected.amountDueRupees,
    expected.recordedRupees,
    [expected.target.customerId, expected.target.llpId],
    [[...expected.supplementary.fileIds].sort(), expected.supplementary.signRequestId,
      expected.supplementary.signedVia, expected.supplementary.verifiedAt],
    [expected.reservation.allocationState, expected.reservation.units, expected.reservation.unitPriceRupees,
      expected.reservation.holdUntil, expected.reservation.extensionState, expected.reservation.extensionDecidedAt],
  ]);
  return `receipt-context-v1_${createHmac('sha256', secret).update(canonical, 'utf8').digest('base64url')}`;
}
const BASE_DURABLE_KEY = durableKeyFor(identityFor(), IDEMPOTENCY_KEY);
const OTHER_DURABLE_KEY = durableKeyFor(identityFor(), OTHER_IDEMPOTENCY_KEY);
const OTHER_SESSION_DURABLE_KEY = durableKeyFor(identityFor(ACTOR_ID, OTHER_SESSION_ID), IDEMPOTENCY_KEY);
const BASE_PREPARED_AT = NOW - 1_000;
const BASE_QUEUED_AT = NOW - 1_000;
const BASE_CONTEXT_TOKEN = contextTokenFor(identityFor(), BASE_PREPARED_AT, ALLOTMENT_ID, SIGNED_SNAPSHOT);
const PREPARED_CONTEXT_TOKEN = contextTokenFor(identityFor(), NOW, ALLOTMENT_ID, SIGNED_SNAPSHOT);
const OLD_CONTEXT_TOKEN = contextTokenFor(
  identityFor(),
  NOW - 1_000,
  ALLOTMENT_ID,
  SIGNED_SNAPSHOT,
  OLD_CONTEXT_SIGNING_SECRET,
);
const clone = (value) => JSON.parse(JSON.stringify(value));
function command(overrides = {}) {
  const signingPrincipal = overrides.signingPrincipal || principalFor();
  const queued = {
    preparedAt: BASE_PREPARED_AT,
    queuedAt: BASE_QUEUED_AT,
    idempotencyKey: IDEMPOTENCY_KEY,
    ...Object.fromEntries(Object.entries(overrides).filter(
      ([key]) => ![
        'intent',
        'expected',
        'contextToken',
        'contextSecret',
        'signingPrincipal',
        'boundActorId',
        'boundSessionId',
      ].includes(key),
    )),
    intent: { ...BASE_INTENT, ...(overrides.intent || {}) },
    expected: clone(Object.prototype.hasOwnProperty.call(overrides, 'expected') ? overrides.expected : SIGNED_SNAPSHOT),
  };
  queued.contextToken = Object.prototype.hasOwnProperty.call(overrides, 'contextToken')
    ? overrides.contextToken
    : contextTokenFor(
      signingPrincipal,
      queued.preparedAt,
      queued.intent.allotmentId,
      queued.expected,
      overrides.contextSecret || CONTEXT_SIGNING_SECRET,
    );
  return queued;
}

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

async function waitUntil(predicate, message = 'condition was not reached') {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail(message);
}

function classified(recording, perRecord = false) {
  const outcome = classifyResponse({ status: recording.status, body: recording.body, perRecord });
  const creditsRemaining = parseCreditsRemaining(recording.headers?.['x-api-credits-remaining']);
  if (isFailure(outcome)) return { ok: false, error: outcome, creditsRemaining };
  return { ok: true, outcome, creditsRemaining };
}

function pageResult(recording) {
  const parsed = classified(recording);
  if (!parsed.ok) return parsed;
  const body = parsed.outcome.kind === 'ok' && parsed.outcome.body && typeof parsed.outcome.body === 'object'
    ? parsed.outcome.body
    : null;
  const records = body && Array.isArray(body.data) ? body.data.map((row) => ({ ...row })) : [];
  return {
    ok: true,
    value: { records, moreRecords: body?.info?.more_records === true },
    status: parsed.outcome.status,
    creditsRemaining: parsed.creditsRemaining,
  };
}

function recordResult(recording) {
  const page = pageResult(recording);
  if (!page.ok) return page;
  return { ...page, value: page.value.records[0] || null };
}

function insertResult(recording) {
  const parsed = classified(recording, true);
  if (!parsed.ok) return parsed;
  return {
    ok: true,
    value: parsed.outcome.kind === 'ok' ? parsed.outcome.records || [] : [],
    status: parsed.outcome.status,
    creditsRemaining: parsed.creditsRemaining,
  };
}

const COQL_RECEIPT_FIELDS = [
  'id',
  'Allotment',
  'Kind',
  'Amount',
  'Mode',
  'UTR',
  'Received_On',
  RECEIPT_IDEMPOTENCY_FIELD,
  'Match_State',
  'Reversal_Of',
].join(', ');
const COQL_SELECT = `select ${COQL_RECEIPT_FIELDS} from ${RECEIPTS_MODULE}`;
const COQL_SHAPES = Object.freeze([
  Object.freeze({
    kind: 'key',
    field: RECEIPT_IDEMPOTENCY_FIELD,
    prefix: `${COQL_SELECT} where ${RECEIPT_IDEMPOTENCY_FIELD} = '`,
    suffix: "' limit 0, 2",
    value: /^receipt-v1_[A-Za-z0-9_-]{43}$/,
  }),
  Object.freeze({
    kind: 'utr',
    field: 'UTR',
    prefix: `${COQL_SELECT} where UTR = '`,
    suffix: "' limit 0, 2",
    value: /^[A-Z0-9][A-Z0-9._/-]{2,79}$/,
  }),
  Object.freeze({
    kind: 'allotment',
    field: 'Allotment',
    prefix: `${COQL_SELECT} where Allotment = '`,
    suffix: "' limit 0, 2000",
    value: /^\d{19}$/,
  }),
]);

function parseReceiptCoql(selectQuery) {
  for (const shape of COQL_SHAPES) {
    if (!selectQuery.startsWith(shape.prefix) || !selectQuery.endsWith(shape.suffix)) continue;
    const value = selectQuery.slice(shape.prefix.length, selectQuery.length - shape.suffix.length);
    assert.match(value, shape.value, `COQL ${shape.field} value is escaped and canonical`);
    assert.equal(selectQuery, `${shape.prefix}${value}${shape.suffix}`, 'the COQL statement has the exact allow-listed shape');
    return { kind: shape.kind, field: shape.field, value };
  }
  throw new Error(`unexpected recorded COQL statement ${selectQuery}`);
}

function recordingWithRows(template, rows) {
  const recording = clone(template);
  recording.status = 200;
  recording.body = {
    data: rows.map((row) => clone(row)),
    info: { more_records: false },
  };
  return recording;
}

function configured(value, callNumber, fallback) {
  if (typeof value === 'function') return value(callNumber);
  if (Array.isArray(value)) return callNumber <= value.length ? value[callNumber - 1] : value.at(-1);
  return value === undefined ? fallback : value;
}

function createRig(options = {}) {
  const calls = [];
  const sink = createMemorySink();
  const log = createOpsLog(sink);
  let sessionCalls = 0;
  let permissionCalls = 0;
  let keySearchCalls = 0;
  let insertAttempted = false;
  const insertedRows = [];

  const session = {
    async recheck(as, sessionId, signal) {
      sessionCalls++;
      calls.push({ op: 'session', as, sessionId, signal });
      const gate = configured(options.sessionGate, sessionCalls, null);
      if (gate) await gate;
      if (configured(options.sessionThrows, sessionCalls, false)) {
        throw new Error('synthetic session source failure');
      }
      return configured(options.sessionActive, sessionCalls, true) !== false;
    },
  };

  const permission = {
    async recheck(as, signal) {
      permissionCalls++;
      calls.push({ op: 'permission', as, signal });
      const gate = configured(options.permissionGate, permissionCalls, null);
      if (gate) await gate;
      if (configured(options.permissionThrows, permissionCalls, false)) {
        throw new Error('synthetic permission source failure');
      }
      return configured(options.permissionAllowed, permissionCalls, true) !== false;
    },
  };

  const crm = {
    async coql(as, selectQuery, coqlOptions) {
      const parsed = parseReceiptCoql(selectQuery);
      const dynamicRows = insertedRows.filter((row) => {
        if (parsed.kind === 'key') return row[RECEIPT_IDEMPOTENCY_FIELD] === parsed.value;
        if (parsed.kind === 'utr') return row.UTR === parsed.value;
        return row.Allotment?.id === parsed.value;
      });
      let recording;
      if (parsed.kind === 'key') {
        keySearchCalls++;
        const keyedRecording = options.keyRecordings instanceof Map
          ? options.keyRecordings.get(parsed.value)
          : options.keyRecordings?.[parsed.value];
        recording = dynamicRows.length > 0
          ? recordingWithRows(recordings.existingSame, dynamicRows)
          : (insertAttempted && options.keyRecordingAfterInsertFailure)
            || configured(options.keyRecording, keySearchCalls, null)
            || keyedRecording
            || recordings.empty;
      } else if (parsed.kind === 'utr') {
        recording = dynamicRows.length > 0
          ? recordingWithRows(recordings.existingSame, dynamicRows)
          : (insertAttempted && options.utrRecordingAfterInsert)
            || options.utrRecording
            || recordings.empty;
      } else if (insertedRows.length > 0 && options.contextRecordingAfterInsert) {
        recording = options.contextRecordingAfterInsert;
      } else {
        const baseline = options.contextRecording || recordings.advance;
        recording = dynamicRows.length > 0
          ? recordingWithRows(baseline, [...(baseline.body?.data || []), ...dynamicRows])
          : baseline;
      }
      calls.push({ op: `coql:${parsed.kind}`, as, selectQuery, options: { ...coqlOptions } });
      if (parsed.kind === 'allotment' && options.contextResult) return options.contextResult;
      if (options.sourceFailureAt === `${parsed.kind}-coql`) recording = recordings.serverError;
      return pageResult(recording);
    },
    async getRecord(as, module, id, getOptions) {
      calls.push({ op: 'getRecord', as, module, id, options: { ...getOptions } });
      assert.equal(module, ALLOTMENTS_MODULE);
      assert.equal(id, ALLOTMENT_ID);
      return recordResult(options.sourceFailureAt === 'getRecord'
        ? recordings.serverError
        : options.allotmentRecording || recordings.allotment);
    },
    async insert(as, module, recordsToInsert, insertOptions) {
      insertAttempted = true;
      calls.push({
        op: 'insert',
        as,
        module,
        records: recordsToInsert.map((record) => ({ ...record })),
        options: { ...insertOptions },
      });
      assert.equal(module, RECEIPTS_MODULE);
      const insertGate = configured(options.insertGate, calls.filter((call) => call.op === 'insert').length, null);
      if (options.insertStarted) options.insertStarted();
      if (insertGate) await insertGate;
      if (options.insertFailure) return options.insertFailure;
      const result = insertResult(options.sourceFailureAt === 'insert'
        ? recordings.serverError
        : options.insertRecording || recordings.created);
      if (result.ok && result.value.length === 1
        && result.value[0]?.ok && result.value[0].index === 0 && result.value[0].code === 'SUCCESS') {
        for (let index = 0; index < result.value.length; index++) {
          const outcome = result.value[index];
          if (!outcome?.ok || typeof outcome.id !== 'string'
            || !outcome.id.startsWith(RECORD_ID_PREFIX) || !recordsToInsert[index]) continue;
          insertedRows.push({ id: outcome.id, ...clone(recordsToInsert[index]), Reversal_Of: null });
        }
      }
      return result;
    },
  };

  return {
    calls,
    crm,
    log,
    sink,
    permission,
    session,
    service: createReceiptReplayService({
      crm,
      permission,
      session,
      log,
      recordIdPrefix: RECORD_ID_PREFIX,
      idempotencySecret: options.idempotencySecret || IDEMPOTENCY_SECRET,
      contextSigningSecret: options.contextSigningSecret || CONTEXT_SIGNING_SECRET,
      previousContextSigningSecrets: options.previousContextSigningSecrets,
      preparationTimeoutMs: options.preparationTimeoutMs,
      clock: options.clock || (() => NOW),
      state: options.state,
    }),
    sessionCalls: () => sessionCalls,
    permissionCalls: () => permissionCalls,
    insertCalls: () => calls.filter((call) => call.op === 'insert'),
  };
}

function recordedResponse(recording) {
  const text = Object.prototype.hasOwnProperty.call(recording, 'rawBody')
    ? recording.rawBody
    : JSON.stringify(recording.body);
  return new Response(text, {
    status: recording.status,
    headers: recording.headers || {},
  });
}

function createStrictEnvelopeRig(ledgerRecording) {
  const fetchCalls = [];
  const sink = createMemorySink();
  const log = createOpsLog(sink);
  const crm = createZohoClient({
    recordIdPrefix: RECORD_ID_PREFIX,
    gate: immediateGate(),
    log,
    maxAttempts: 1,
    clock: () => NOW,
    fetch: async (url, init) => {
      const parsed = new URL(url);
      fetchCalls.push({ method: init.method, pathname: parsed.pathname, body: init.body });
      if (parsed.pathname === `/crm/v8/${ALLOTMENTS_MODULE}/${ALLOTMENT_ID}`) {
        return recordedResponse(recordings.allotment);
      }
      if (parsed.pathname === '/crm/v8/coql') return recordedResponse(ledgerRecording);
      throw new Error(`unexpected synthetic CRM request ${init.method} ${parsed.pathname}`);
    },
  });
  const session = { async recheck() { return true; } };
  const permission = { async recheck() { return true; } };
  const service = createReceiptReplayService({
    crm,
    permission,
    session,
    log,
    recordIdPrefix: RECORD_ID_PREFIX,
    idempotencySecret: IDEMPOTENCY_SECRET,
    contextSigningSecret: CONTEXT_SIGNING_SECRET,
    clock: () => NOW,
  });
  return { fetchCalls, sink, service };
}

const PII_MARKERS = [
  'Synthetic Fixture Investor',
  'Synthetic Fixture Farm LLP',
  'fixture.investor@example.invalid',
  '+91 90000 00000',
  'ABCDE1234F',
  '000012341208',
  'Synthetic investor note must never enter Plane B',
  'Synthetic supplementary agreement.pdf',
  'HDFC2609001',
  IDEMPOTENCY_KEY,
  BASE_DURABLE_KEY,
  OTHER_DURABLE_KEY,
  OTHER_SESSION_DURABLE_KEY,
  BASE_CONTEXT_TOKEN,
  PREPARED_CONTEXT_TOKEN,
  OLD_CONTEXT_TOKEN,
  IDEMPOTENCY_SECRET,
  CONTEXT_SIGNING_SECRET,
  OLD_CONTEXT_SIGNING_SECRET,
  NEXT_CONTEXT_SIGNING_SECRET,
  SESSION_ID,
  OTHER_SESSION_ID,
  FOREIGN_RECORD_ID,
  CUSTOMER_ID,
  LLP_ID,
  ACCESS_TOKEN,
  '2250000',
];

function assertPlaneBPrivate(records, additional = []) {
  const dump = JSON.stringify(records);
  for (const marker of [...PII_MARKERS, ...additional]) {
    assert.ok(!dump.includes(marker), `Plane B must not contain ${JSON.stringify(marker)}`);
  }
  for (const record of records) {
    assert.ok(!('body' in record));
    assert.ok(!('response' in record));
    if (record.kind === 'refusal') {
      assert.deepEqual(
        Object.keys(record).sort(),
        ['action', 'actor', 'at', 'kind', 'reason', 'recordIds'].sort(),
        'a refusal has only the Plane B allow-list',
      );
    }
  }
}

function assertOneRefusal(rig, result, reasonCode) {
  assert.equal(result.ok, false);
  assert.equal(result.kind, 'refused');
  assert.equal(result.reasonCode, reasonCode);
  assert.equal(result.retryable, false);
  const refusals = rig.sink.records().filter((record) => record.kind === 'refusal');
  assert.equal(refusals.length, 1, `${reasonCode} writes exactly one refusal`);
  assert.equal(refusals[0].action, 'receipt-replay');
  assert.equal(refusals[0].reason, reasonCode);
  assertPlaneBPrivate(rig.sink.records());
}

function assertForeignRecordIdFiltered(rig, foreignId = FOREIGN_RECORD_ID) {
  const records = rig.sink.records();
  assert.ok(!JSON.stringify(records).includes(foreignId), 'Plane B must filter a returned foreign-org record id');
  for (const record of records) {
    if (!Array.isArray(record.recordIds)) continue;
    assert.ok(record.recordIds.every((id) => id.startsWith(RECORD_ID_PREFIX)),
      'every Plane B record id must belong to the configured Zoho org');
  }
}

test('prepare issues the live server snapshot and a valid context seal', async () => {
  const rig = createRig();
  const principal = principalFor();
  const result = await rig.service.prepare(principal, ALLOTMENT_ID);

  assert.deepEqual(result, {
    ok: true,
    value: {
      preparedAt: NOW,
      contextToken: PREPARED_CONTEXT_TOKEN,
      expected: SIGNED_SNAPSHOT,
    },
  });
  assert.equal(Object.hasOwn(result.value, 'boundActorId'), false);
  assert.equal(Object.hasOwn(result.value, 'boundSessionId'), false);
  assert.equal(Object.hasOwn(result.value, 'queuedAt'), false, 'the actual press time is not chosen during prepare');
  assert.equal(PREPARED_CONTEXT_TOKEN, 'receipt-context-v1_-c7vaaSAJ1SUqL9sxUgYIAp4lxSn45Uen9vrYziKMR0');
  assert.deepEqual(rig.calls.map((call) => call.op), [
    'session', 'permission', 'getRecord', 'coql:allotment', 'session', 'permission',
  ]);
  assert.ok(rig.calls.every((call) => call.as === principal.credential));
  assert.equal(rig.insertCalls().length, 0);
  assert.equal(rig.sink.records().length, 0);
});

test('prepare rechecks session and Finance permission after live reads before sealing', async (t) => {
  await t.test('session revoked during the reads', async () => {
    const rig = createRig({ sessionActive: [true, false] });
    const result = await rig.service.prepare(principalFor(), ALLOTMENT_ID);

    assertOneRefusal(rig, result, 'session-changed');
    assert.equal(Object.hasOwn(result, 'value'), false, 'a revoked session receives no sealed context');
    assert.deepEqual(rig.calls.map((call) => call.op), [
      'session', 'permission', 'getRecord', 'coql:allotment', 'session',
    ]);
    assert.equal(rig.permissionCalls(), 1, 'permission is not queried after the authoritative session revocation');
    assert.equal(rig.insertCalls().length, 0);
  });

  await t.test('Finance permission revoked during the reads', async () => {
    const rig = createRig({ permissionAllowed: [true, false] });
    const result = await rig.service.prepare(principalFor(), ALLOTMENT_ID);

    assertOneRefusal(rig, result, 'permission-changed');
    assert.equal(Object.hasOwn(result, 'value'), false, 'a lost money grant receives no sealed context');
    assert.deepEqual(rig.calls.map((call) => call.op), [
      'session', 'permission', 'getRecord', 'coql:allotment', 'session', 'permission',
    ]);
    assert.equal(rig.insertCalls().length, 0);
  });
});

test('prepare enforces its internal deadline when the caller supplies no signal', async () => {
  const stalledSession = deferred();
  const rig = createRig({
    sessionGate: stalledSession.promise,
    preparationTimeoutMs: 10,
  });
  const startedAt = Date.now();
  const result = await rig.service.prepare(principalFor(), ALLOTMENT_ID);
  const elapsedMs = Date.now() - startedAt;
  stalledSession.resolve(true);

  assert.deepEqual(result, {
    ok: false,
    kind: 'source-error',
    source: 'session',
    errorKind: 'aborted',
    retryable: true,
  });
  assert.ok(elapsedMs < 1_000, `the injected preparation deadline took ${elapsedMs}ms`);
  assert.deepEqual(rig.calls.map((call) => call.op), ['session']);
  assert.equal(rig.permissionCalls(), 0);
  assert.equal(rig.insertCalls().length, 0);
  assertPlaneBPrivate(rig.sink.records());
});

test('malformed successful receipt-ledger envelopes fail closed before any insert', async (t) => {
  const subset = clone(recordings.advance.body.data);
  const cases = [
    ['invalid JSON', { status: 200, headers: { 'content-type': 'application/json' }, rawBody: '{"data":' }],
    ['empty object', { status: 200, headers: { 'content-type': 'application/json' }, body: {} }],
    ['null data', { status: 200, headers: { 'content-type': 'application/json' }, body: { data: null } }],
    ['missing page info', { status: 200, headers: { 'content-type': 'application/json' }, body: { data: subset } }],
    ['missing more_records', {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: { data: subset, info: {} },
    }],
    ['nonboolean more_records', {
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: { data: subset, info: { more_records: 'false' } },
    }],
  ];

  for (const [name, ledgerRecording] of cases) {
    await t.test(name, async () => {
      const rig = createStrictEnvelopeRig(ledgerRecording);
      const result = await rig.service.prepare(principalFor(), ALLOTMENT_ID);

      assert.deepEqual(result, {
        ok: false,
        kind: 'source-error',
        source: 'zoho',
        errorKind: 'unexpected',
        retryable: false,
      });
      assert.deepEqual(rig.fetchCalls.map(({ method, pathname }) => ({ method, pathname })), [
        { method: 'GET', pathname: `/crm/v8/${ALLOTMENTS_MODULE}/${ALLOTMENT_ID}` },
        { method: 'POST', pathname: '/crm/v8/coql' },
      ]);
      assert.equal(rig.fetchCalls.some(({ pathname }) => pathname === `/crm/v8/${RECEIPTS_MODULE}`), false);
      assertPlaneBPrivate(rig.sink.records());
    });
  }
});

test('tampered server context is refused before permission or Zoho', async (t) => {
  for (const [name, mutate] of [
    ['preparedAt', (queued) => { queued.preparedAt -= 1; }],
    ['expected amount', (queued) => { queued.expected.amountDueRupees -= 1; }],
    ['expected target', (queued) => { queued.expected.target.customerId = '9007199254740993012'; }],
    ['context token', (queued) => { queued.contextToken = `receipt-context-v1_${'A'.repeat(43)}`; }],
  ]) {
    await t.test(name, async () => {
      const rig = createRig();
      const queued = command();
      mutate(queued);
      const result = await rig.service.replay(principalFor(), queued);

      assertOneRefusal(rig, result, 'context-token-invalid');
      assert.deepEqual(rig.calls, [], 'a changed server snapshot cannot reach permission or Zoho');
      assert.equal(rig.insertCalls().length, 0);
      assertPlaneBPrivate(rig.sink.records(), [queued.contextToken, '9007199254740993012']);
    });
  }
});

test('foreign-org allotment IDs are refused before CRM and never copied into Plane B', async (t) => {
  const foreignAllotmentId = '8007199254740993001';

  await t.test('prepare', async () => {
    const rig = createRig();
    const result = await rig.service.prepare(principalFor(), foreignAllotmentId);
    assertOneRefusal(rig, result, 'invalid-request');
    assert.deepEqual(rig.calls, []);
    assert.deepEqual(rig.sink.records()[0].recordIds, []);
    assert.ok(!JSON.stringify(rig.sink.records()).includes(foreignAllotmentId));
  });

  await t.test('replay', async () => {
    const rig = createRig();
    const result = await rig.service.replay(principalFor(), command({
      intent: { allotmentId: foreignAllotmentId },
    }));
    assertOneRefusal(rig, result, 'invalid-request');
    assert.deepEqual(rig.calls, []);
    assert.deepEqual(rig.sink.records()[0].recordIds, []);
    assert.ok(!JSON.stringify(rig.sink.records()).includes(foreignAllotmentId));
  });
});

test('foreign-org IDs returned by Zoho are never trusted or copied into Plane B', async (t) => {
  await t.test('Receipt row id', async () => {
    const existing = clone(recordings.existingSame);
    existing.body.data[0].id = FOREIGN_RECORD_ID;
    const rig = createRig({ keyRecording: existing });
    const result = await rig.service.replay(principalFor(), command());

    assertOneRefusal(rig, result, 'source-invalid');
    assert.deepEqual(rig.calls.map((call) => call.op), ['session', 'permission', 'coql:key']);
    assert.deepEqual(rig.sink.records()[0].recordIds, []);
    assert.equal(rig.insertCalls().length, 0);
    assertForeignRecordIdFiltered(rig);
  });

  await t.test('Receipt Allotment lookup', async () => {
    const ledger = clone(recordings.advance);
    ledger.body.data[0].Allotment.id = FOREIGN_RECORD_ID;
    const rig = createRig({ contextRecording: ledger });
    const result = await rig.service.replay(principalFor(), command());

    assertOneRefusal(rig, result, 'source-invalid');
    assert.deepEqual(rig.calls.map((call) => call.op), [
      'session', 'permission', 'coql:key', 'coql:utr', 'getRecord', 'coql:allotment',
    ]);
    assert.equal(rig.insertCalls().length, 0);
    assertForeignRecordIdFiltered(rig);
  });

  await t.test('Receipt Reversal_Of lookup', async () => {
    const existing = clone(recordings.existingSame);
    existing.body.data[0].Reversal_Of = { id: FOREIGN_RECORD_ID, name: 'Synthetic foreign reversal' };
    const rig = createRig({ keyRecording: existing });
    const result = await rig.service.replay(principalFor(), command());

    assertOneRefusal(rig, result, 'source-invalid');
    assert.deepEqual(rig.calls.map((call) => call.op), ['session', 'permission', 'coql:key']);
    assert.equal(rig.insertCalls().length, 0);
    assertForeignRecordIdFiltered(rig);
  });

  for (const sample of [
    ['Allotment Customer lookup', (row) => { row.Customer.id = FOREIGN_RECORD_ID; }],
    ['Allotment LLP lookup', (row) => { row.LLP.id = FOREIGN_RECORD_ID; }],
    ['Allotment attachment_Id fallback', (row) => {
      row.Supplementary_Agreement[0] = { attachment_Id: FOREIGN_RECORD_ID, file_Name: 'Synthetic fallback.pdf' };
    }],
    ['Allotment id fallback', (row) => {
      row.Supplementary_Agreement[0] = { id: FOREIGN_RECORD_ID, file_Name: 'Synthetic fallback.pdf' };
    }],
  ]) {
    await t.test(sample[0], async () => {
      const allotment = clone(recordings.allotment);
      sample[1](allotment.body.data[0]);
      const rig = createRig({ allotmentRecording: allotment });
      const result = await rig.service.prepare(principalFor(), ALLOTMENT_ID);

      assertOneRefusal(rig, result, 'source-invalid');
      assert.deepEqual(rig.calls.map((call) => call.op), ['session', 'permission', 'getRecord', 'coql:allotment']);
      assert.equal(rig.insertCalls().length, 0);
      assertForeignRecordIdFiltered(rig);
    });
  }

  await t.test('mismatched Allotment response id', async () => {
    const allotment = clone(recordings.allotment);
    allotment.body.data[0].id = FOREIGN_RECORD_ID;
    const rig = createRig({ allotmentRecording: allotment });
    const result = await rig.service.prepare(principalFor(), ALLOTMENT_ID);

    assertOneRefusal(rig, result, 'source-invalid');
    assert.deepEqual(rig.calls.map((call) => call.op), ['session', 'permission', 'getRecord']);
    assert.deepEqual(rig.sink.records()[0].recordIds, [ALLOTMENT_ID]);
    assert.equal(rig.insertCalls().length, 0);
    assertForeignRecordIdFiltered(rig);
  });

  await t.test('successful insert outcome id', async () => {
    const inserted = clone(recordings.created);
    inserted.body.data[0].details.id = FOREIGN_RECORD_ID;
    const rig = createRig({ insertRecording: inserted });
    const result = await rig.service.replay(principalFor(), command());

    assert.deepEqual(result, {
      ok: false,
      kind: 'source-error',
      source: 'zoho',
      errorKind: 'unexpected',
      retryable: true,
    });
    assert.equal(rig.insertCalls().length, 1);
    assert.equal(rig.calls.filter((call) => call.op === 'coql:key').length, 2,
      'an untrusted insert outcome is recovered only through the durable key');
    assert.ok(!JSON.stringify(result).includes(FOREIGN_RECORD_ID));
    assertForeignRecordIdFiltered(rig);
  });
});

test('an encrypted Zoho File System file_Id is accepted without a CRM record prefix', async () => {
  assert.match(FILE_ID, /^[A-Za-z0-9_-]{16,200}$/);
  assert.doesNotMatch(FILE_ID, /^\d{15,22}$/);
  assert.equal(FILE_ID.startsWith('9007199254'), false);
  const rig = createRig();
  const result = await rig.service.prepare(principalFor(), ALLOTMENT_ID);

  assert.equal(result.ok, true);
  assert.deepEqual(result.value.expected.supplementary.fileIds, [FILE_ID]);
  assert.equal(rig.sink.records().length, 0);
});

test('Zoho File System ids stay opaque while CRM attachment fallbacks stay org-scoped', async (t) => {
  const numericLookingZfsId = '8007199254740993999';

  await t.test('numeric-looking file_Id is accepted as an opaque ZFS token', async () => {
    const allotment = clone(recordings.allotment);
    allotment.body.data[0].Supplementary_Agreement = [{
      file_Id: numericLookingZfsId,
      file_Name: 'Synthetic numeric-looking encrypted token.pdf',
    }];
    const rig = createRig({ allotmentRecording: allotment });
    const result = await rig.service.prepare(principalFor(), ALLOTMENT_ID);

    assert.equal(result.ok, true);
    assert.deepEqual(result.value.expected.supplementary.fileIds, [numericLookingZfsId]);
    assert.equal(result.value.expected.supplementary.fileIds[0].startsWith(RECORD_ID_PREFIX), false);
    assert.equal(rig.insertCalls().length, 0);
    assert.equal(rig.sink.records().length, 0);
  });

  await t.test('foreign-prefix numeric attachment_Id is rejected as a CRM record id', async () => {
    const allotment = clone(recordings.allotment);
    allotment.body.data[0].Supplementary_Agreement = [{
      attachment_Id: numericLookingZfsId,
      file_Name: 'Synthetic foreign attachment fallback.pdf',
    }];
    const rig = createRig({ allotmentRecording: allotment });
    const result = await rig.service.prepare(principalFor(), ALLOTMENT_ID);

    assertOneRefusal(rig, result, 'source-invalid');
    assert.equal(rig.insertCalls().length, 0);
    assertForeignRecordIdFiltered(rig, numericLookingZfsId);
  });
});

test('more than five supplementary file IDs is invalid before source access', async () => {
  const expected = clone(SIGNED_SNAPSHOT);
  expected.supplementary.fileIds = [
    '9007199254740993101',
    '9007199254740993102',
    '9007199254740993103',
    '9007199254740993104',
    '9007199254740993105',
    '9007199254740993106',
  ];
  const rig = createRig();
  const result = await rig.service.replay(principalFor(), command({ expected }));

  assertOneRefusal(rig, result, 'invalid-request');
  assert.deepEqual(rig.calls, []);
  assert.deepEqual(rig.sink.records()[0].recordIds, []);
  assert.equal(rig.insertCalls().length, 0);
  assertPlaneBPrivate(rig.sink.records(), expected.supplementary.fileIds);
});

test('a bank reference longer than 80 characters is invalid before source access', async () => {
  const oversizedUtr = `A${'1'.repeat(80)}`;
  const rig = createRig();
  const result = await rig.service.replay(principalFor(), command({ intent: { utr: oversizedUtr } }));

  assertOneRefusal(rig, result, 'invalid-request');
  assert.deepEqual(rig.calls, []);
  assert.equal(rig.insertCalls().length, 0);
  assertPlaneBPrivate(rig.sink.records(), [oversizedUtr]);
});

test('a malformed principal short-circuits without traversing a huge untrusted command', async () => {
  let commandReads = 0;
  let fileReads = 0;
  const hugeFileIds = new Proxy(new Array(1_000_000), {
    get() {
      fileReads++;
      throw new Error('untrusted file IDs must not be traversed');
    },
  });
  const hostileCommand = new Proxy({ expected: { supplementary: { fileIds: hugeFileIds } } }, {
    get(target, property, receiver) {
      commandReads++;
      if (property === 'expected') return Reflect.get(target, property, receiver);
      throw new Error('untrusted command must not be parsed');
    },
  });
  const rig = createRig();
  let result;
  await assert.doesNotReject(async () => {
    result = await rig.service.replay({ credential: null, sessionId: null }, hostileCommand);
  });

  assertOneRefusal(rig, result, 'invalid-request');
  assert.equal(commandReads, 0);
  assert.equal(fileReads, 0);
  assert.deepEqual(rig.calls, []);
  assert.deepEqual(rig.sink.records()[0].recordIds, []);
});

test('an invalid clock sample fails closed before replay source access', async (t) => {
  for (const [name, now] of [
    ['NaN', Number.NaN],
    ['unsafe integer', Number.MAX_SAFE_INTEGER + 1],
  ]) {
    await t.test(name, async () => {
      const rig = createRig({ clock: () => now });
      const result = await rig.service.replay(principalFor(), command());
      assert.deepEqual(result, {
        ok: false,
        kind: 'source-error',
        source: 'zoho',
        errorKind: 'unexpected',
        retryable: true,
      });
      assert.deepEqual(rig.calls, []);
      assert.equal(rig.insertCalls().length, 0);
      assertPlaneBPrivate(rig.sink.records());
    });
  }

  await t.test('prepare refuses to mint a context with NaN time', async () => {
    const rig = createRig({ clock: () => Number.NaN });
    const result = await rig.service.prepare(principalFor(), ALLOTMENT_ID);
    assert.deepEqual(result, {
      ok: false,
      kind: 'source-error',
      source: 'zoho',
      errorKind: 'unexpected',
      retryable: true,
    });
    assert.deepEqual(rig.calls.map((call) => call.op), [
      'session', 'permission', 'getRecord', 'coql:allotment', 'session', 'permission',
    ]);
    assert.equal(rig.insertCalls().length, 0);
  });
});

test('unchanged live context creates one pending Receipt with the actor/session-bound durable key', async () => {
  const rig = createRig();
  const principal = principalFor();
  const result = await rig.service.replay(principal, command());

  assert.equal(BASE_DURABLE_KEY, 'receipt-v1_hKMO3OGM20-KYwnirYo4gOlpavJT_j81h0gQZdDXbz0');
  assert.deepEqual(result, { ok: true, receiptId: RECEIPT_ID, duplicate: false });
  assert.deepEqual(rig.calls.map((call) => call.op), [
    'session',
    'permission',
    'coql:key',
    'coql:utr',
    'getRecord',
    'coql:allotment',
    'session',
    'permission',
    'insert',
  ]);
  assert.ok(rig.calls.every((call) => call.as === principal.credential), 'every source call uses the current person');
  const insertion = rig.insertCalls()[0];
  assert.deepEqual(insertion.records, [{
    Name: `Allotment ${ALLOTMENT_ID} · Full`,
    Allotment: { id: ALLOTMENT_ID },
    Kind: 'Full',
    Amount: 2250000,
    Mode: 'RTGS',
    UTR: 'HDFC2609001',
    Received_On: '2026-09-02T09:00:00+05:30',
    Idempotency_Key: BASE_DURABLE_KEY,
    Match_State: 'Pending',
  }]);
  assert.deepEqual(rig.calls.filter((call) => call.op.startsWith('coql:')).map((call) => call.selectQuery), [
    `${COQL_SELECT} where Idempotency_Key = '${BASE_DURABLE_KEY}' limit 0, 2`,
    `${COQL_SELECT} where UTR = 'HDFC2609001' limit 0, 2`,
    `${COQL_SELECT} where Allotment = '${ALLOTMENT_ID}' limit 0, 2000`,
  ]);
  assert.equal(Object.hasOwn(rig.crm, 'search'), false, 'receipt discovery has no generic CRM search fallback');
  assert.equal(rig.sink.records().length, 0, 'the domain layer emitted no refusal');
});

test('receipt discovery uses recorded COQL only and has no crm.search dependency', async () => {
  const rig = createRig();
  assert.equal(Object.hasOwn(rig.crm, 'search'), false);

  const result = await rig.service.replay(principalFor(), command());
  assert.deepEqual(result, { ok: true, receiptId: RECEIPT_ID, duplicate: false });
  assert.equal(rig.calls.filter((call) => call.op.startsWith('coql:')).length, 3);
  assert.equal(rig.calls.some((call) => call.op.startsWith('search:')), false);
});

test('caller mutation while permission is awaited cannot change the captured money command', async () => {
  const permissionGate = deferred();
  const rig = createRig({ permissionGate: permissionGate.promise });
  const queued = command();
  const pending = rig.service.replay(principalFor(), queued);
  await waitUntil(() => rig.permissionCalls() === 1, 'execution did not reach the fresh permission check');
  assert.equal(rig.permissionCalls(), 1, 'execution is waiting inside the fresh permission check');

  queued.preparedAt = 0;
  queued.queuedAt = 0;
  queued.idempotencyKey = OTHER_IDEMPOTENCY_KEY;
  queued.intent.allotmentId = '9007199254740993999';
  queued.intent.kind = 'Refund';
  queued.intent.amountRupees = 1;
  queued.intent.mode = 'UPI';
  queued.intent.utr = 'MUTATED999';
  queued.intent.receivedOn = '2026-09-02T09:01:00+05:30';
  queued.expected.amountDueRupees = 1;
  queued.expected.supplementary.fileIds.push('9007199254740993998');
  queued.expected.reservation.allocationState = 'Cancelled';
  queued.expected.reservation.holdUntil = null;
  permissionGate.resolve();

  assert.deepEqual(await pending, { ok: true, receiptId: RECEIPT_ID, duplicate: false });
  assert.deepEqual(rig.insertCalls()[0].records, [{
    Name: `Allotment ${ALLOTMENT_ID} · Full`,
    Allotment: { id: ALLOTMENT_ID },
    Kind: 'Full',
    Amount: 2250000,
    Mode: 'RTGS',
    UTR: 'HDFC2609001',
    Received_On: '2026-09-02T09:00:00+05:30',
    Idempotency_Key: BASE_DURABLE_KEY,
    Match_State: 'Pending',
  }]);
  assert.equal(rig.calls.find((call) => call.op === 'coql:key').selectQuery,
    `${COQL_SELECT} where Idempotency_Key = '${BASE_DURABLE_KEY}' limit 0, 2`);
  assert.ok(!JSON.stringify(rig.calls).includes('MUTATED999'));
});

test('exact concurrent presses share one write; a later replay returns the persisted Receipt', async () => {
  const permissionGate = deferred();
  const rig = createRig({ permissionGate: permissionGate.promise });
  const principal = principalFor();
  const queued = command();

  const first = rig.service.replay(principal, queued);
  await waitUntil(() => rig.permissionCalls() === 1, 'first replay did not reach permission');
  const second = rig.service.replay(principal, clone(queued));
  assert.equal(rig.permissionCalls(), 1, 'the exact concurrent retry joins before another permission/source call');
  permissionGate.resolve();

  const [left, right] = await Promise.all([first, second]);
  assert.deepEqual(left, { ok: true, receiptId: RECEIPT_ID, duplicate: false });
  assert.deepEqual(right, { ok: true, receiptId: RECEIPT_ID, duplicate: true }, 'the joined press is answered as the duplicate it is');
  assert.equal(rig.insertCalls().length, 1);

  const later = await rig.service.replay(principal, clone(queued));
  assert.deepEqual(later, { ok: true, receiptId: RECEIPT_ID, duplicate: true });
  assert.equal(rig.insertCalls().length, 1, 'the persisted key answers without another insert');
  assert.equal(rig.calls.filter((call) => call.op === 'getRecord').length, 1, 'an applied retry precedes stale-context checks');
  assert.equal(rig.sink.records().length, 0);
});

test('different sealed contexts using one opaque key do not coalesce', async () => {
  const sessionGate = deferred();
  const rig = createRig({ sessionGate: sessionGate.promise });
  const first = rig.service.replay(principalFor(), command());
  await waitUntil(() => rig.sessionCalls() === 1, 'first replay did not reach the session gate');

  const otherContext = command({ preparedAt: NOW - 2_000 });
  assert.notEqual(otherContext.contextToken, BASE_CONTEXT_TOKEN);
  const conflicting = await rig.service.replay(principalFor(), otherContext);
  assertOneRefusal(rig, conflicting, 'idempotency-key-reused');
  assert.equal(rig.sessionCalls(), 1, 'the conflicting context does not join or start its own validation');

  sessionGate.resolve();
  assert.deepEqual(await first, { ok: true, receiptId: RECEIPT_ID, duplicate: false });
  assert.equal(rig.insertCalls().length, 1);
});

test('a session revoked immediately before insert prevents the money write', async () => {
  const rig = createRig({ sessionActive: [true, false] });
  const result = await rig.service.replay(principalFor(), command());

  assertOneRefusal(rig, result, 'session-changed');
  assert.deepEqual(rig.calls.map((call) => call.op), [
    'session',
    'permission',
    'coql:key',
    'coql:utr',
    'getRecord',
    'coql:allotment',
    'session',
  ]);
  assert.equal(rig.insertCalls().length, 0);
});

test('discardSession cancels validation and queued work before either can insert', async () => {
  const permissionGate = deferred();
  const rig = createRig({ permissionGate: permissionGate.promise });
  const first = rig.service.replay(principalFor(), command());
  await waitUntil(() => rig.permissionCalls() === 1, 'first replay did not reach permission');
  const queued = rig.service.replay(principalFor(), command({
    idempotencyKey: OTHER_IDEMPOTENCY_KEY,
    intent: { utr: 'ICIC2609002' },
  }));

  rig.service.discardSession(ACTOR_ID, SESSION_ID);
  const [firstResult, queuedResult] = await Promise.all([first, queued]);
  permissionGate.resolve();

  assert.equal(firstResult.ok, false);
  assert.equal(firstResult.reasonCode, 'session-changed');
  assert.equal(queuedResult.ok, false);
  assert.equal(queuedResult.reasonCode, 'session-changed');
  assert.deepEqual(rig.calls.map((call) => call.op), ['session', 'permission']);
  assert.equal(rig.insertCalls().length, 0);
  assert.equal(rig.sink.records().filter((record) => record.kind === 'refusal').length, 2);
  assertPlaneBPrivate(rig.sink.records(), [OTHER_IDEMPOTENCY_KEY, 'ICIC2609002']);
});

test('the signed-context deadline aborts queued validation and prevents a late insert', async () => {
  const sessionGate = deferred();
  const rig = createRig({ sessionGate: sessionGate.promise });
  const nearDeadlineAt = NOW - RECEIPT_REPLAY_MAX_AGE_MS + 25;
  const nearDeadline = command({ preparedAt: nearDeadlineAt, queuedAt: nearDeadlineAt });
  const startedAt = Date.now();
  const result = await rig.service.replay(principalFor(), nearDeadline);
  const elapsedMs = Date.now() - startedAt;
  sessionGate.resolve();

  assertOneRefusal(rig, result, 'save-expired');
  assert.ok(elapsedMs < 1_000, `deadline regression should finish promptly, took ${elapsedMs}ms`);
  assert.deepEqual(rig.calls.map((call) => call.op), ['session']);
  assert.equal(rig.insertCalls().length, 0);
});

test('only eight distinct receipt keys may wait for one allotment', async () => {
  const sessionGate = deferred();
  const rig = createRig({ sessionGate: sessionGate.promise });
  const pending = Array.from({ length: 8 }, (_, index) => rig.service.replay(principalFor(), command({
    idempotencyKey: `receipt_pending_${String(index + 1).padStart(4, '0')}`,
    intent: { utr: `PENDING${String(index + 1).padStart(3, '0')}` },
  })));
  const ninth = await rig.service.replay(principalFor(), command({
    idempotencyKey: 'receipt_pending_0009',
    intent: { utr: 'PENDING009' },
  }));

  assert.deepEqual(ninth, {
    ok: false,
    kind: 'source-error',
    source: 'zoho',
    errorKind: 'busy',
    retryable: true,
  });
  assert.equal(rig.insertCalls().length, 0);
  rig.service.discardSession(ACTOR_ID, SESSION_ID);
  const cancelled = await Promise.all(pending);
  sessionGate.resolve();
  assert.equal(cancelled.length, 8);
  assert.ok(cancelled.every((result) => result.ok === false && result.reasonCode === 'session-changed'));
  assert.equal(rig.insertCalls().length, 0);
});

test('the same opaque key in a new session is not accepted as the earlier session retry', async () => {
  const rig = createRig();
  const first = await rig.service.replay(principalFor(), command());
  assert.deepEqual(first, { ok: true, receiptId: RECEIPT_ID, duplicate: false });

  const nextSession = principalFor(ACTOR_ID, OTHER_SESSION_ID);
  const second = await rig.service.replay(nextSession, command({ signingPrincipal: nextSession }));
  assertOneRefusal(rig, second, 'balance-already-recorded');
  assert.equal(rig.insertCalls().length, 1);
  assert.notEqual(BASE_DURABLE_KEY, OTHER_SESSION_DURABLE_KEY);
  assert.deepEqual(rig.calls.filter((call) => call.op === 'coql:key').map((call) => call.selectQuery), [
    `${COQL_SELECT} where Idempotency_Key = '${BASE_DURABLE_KEY}' limit 0, 2`,
    `${COQL_SELECT} where Idempotency_Key = '${OTHER_SESSION_DURABLE_KEY}' limit 0, 2`,
  ]);
  assertPlaneBPrivate(rig.sink.records(), [OTHER_SESSION_DURABLE_KEY, OTHER_SESSION_ID]);
});

test('distinct concurrent balance receipts for one allotment serialize and the loser re-reads zero due', async () => {
  const rig = createRig();
  const principal = principalFor();
  const first = rig.service.replay(principal, command());
  const second = rig.service.replay(principal, command({
    idempotencyKey: OTHER_IDEMPOTENCY_KEY,
    intent: { utr: 'ICIC2609002' },
  }));

  const [winner, loser] = await Promise.all([first, second]);
  assert.deepEqual(winner, { ok: true, receiptId: RECEIPT_ID, duplicate: false });
  assertOneRefusal(rig, loser, 'balance-already-recorded');
  assert.equal(rig.insertCalls().length, 1, 'the serialized loser never writes');
  assert.deepEqual(rig.calls.map((call) => call.op), [
    'session',
    'permission',
    'coql:key',
    'coql:utr',
    'getRecord',
    'coql:allotment',
    'session',
    'permission',
    'insert',
    'session',
    'permission',
    'coql:key',
    'coql:utr',
    'getRecord',
    'coql:allotment',
  ]);
  assertPlaneBPrivate(rig.sink.records(), [OTHER_IDEMPOTENCY_KEY, 'ICIC2609002']);
});

test('principal mutation during an allotment wait cannot change the executing actor', async () => {
  const permissionGate = deferred();
  const rig = createRig({ permissionGate: permissionGate.promise });
  const first = rig.service.replay(principalFor(), command());
  await waitUntil(() => rig.permissionCalls() === 1, 'first replay did not reach permission');
  assert.equal(rig.permissionCalls(), 1);

  const mutablePrincipal = principalFor();
  const capturedCredential = mutablePrincipal.credential;
  const second = rig.service.replay(mutablePrincipal, command({
    idempotencyKey: OTHER_IDEMPOTENCY_KEY,
    intent: { utr: 'ICIC2609002' },
  }));
  mutablePrincipal.credential = credentialFor(OTHER_ACTOR_ID);
  mutablePrincipal.sessionId = OTHER_SESSION_ID;
  permissionGate.resolve();

  const [winner, waiter] = await Promise.all([first, second]);
  assert.deepEqual(winner, { ok: true, receiptId: RECEIPT_ID, duplicate: false });
  assertOneRefusal(rig, waiter, 'balance-already-recorded');
  assert.equal(rig.insertCalls().length, 1);
  const afterWinner = rig.calls.slice(rig.calls.findIndex((call) => call.op === 'insert') + 1);
  assert.ok(afterWinner.length > 0);
  assert.ok(afterWinner.every((call) => call.as === capturedCredential), 'queued work keeps the captured user credential');
  assert.ok(afterWinner.every((call) => call.as.userId === ACTOR_ID));
  assertPlaneBPrivate(rig.sink.records(), [OTHER_ACTOR_ID, OTHER_SESSION_ID]);
});

test('two-phase context-key rotation works in both directions without changing the durable receipt key', async (t) => {
  for (const sample of [
    {
      name: 'roll forward accepts the prior signer',
      current: NEXT_CONTEXT_SIGNING_SECRET,
      previous: OLD_CONTEXT_SIGNING_SECRET,
      commandSigner: OLD_CONTEXT_SIGNING_SECRET,
    },
    {
      name: 'rollback accepts the next signer',
      current: OLD_CONTEXT_SIGNING_SECRET,
      previous: NEXT_CONTEXT_SIGNING_SECRET,
      commandSigner: NEXT_CONTEXT_SIGNING_SECRET,
    },
  ]) {
    await t.test(sample.name, async () => {
      const rig = createRig({
        contextSigningSecret: sample.current,
        previousContextSigningSecrets: [sample.previous],
        keyRecording: recordings.existingSame,
      });
      const queued = command({ contextSecret: sample.commandSigner });

      const result = await rig.service.replay(principalFor(), queued);
      assert.deepEqual(result, { ok: true, receiptId: RECEIPT_ID, duplicate: true });
      assert.deepEqual(rig.calls.map((call) => call.op), ['session', 'permission', 'coql:key']);
      assert.equal(rig.calls.find((call) => call.op === 'coql:key').selectQuery,
        `${COQL_SELECT} where Idempotency_Key = '${BASE_DURABLE_KEY}' limit 0, 2`);
      assert.equal(durableKeyFor(principalFor(), queued.idempotencyKey), BASE_DURABLE_KEY);
      assert.equal(rig.insertCalls().length, 0);
      assert.equal(rig.sink.records().length, 0);
    });
  }
});

test('an expired signed command is refused before an exact matching row is queried', async () => {
  const rig = createRig({ keyRecording: recordings.existingSame });
  const result = await rig.service.replay(principalFor(), command({
    preparedAt: NOW - RECEIPT_REPLAY_MAX_AGE_MS,
    queuedAt: NOW - RECEIPT_REPLAY_MAX_AGE_MS,
  }));

  assertOneRefusal(rig, result, 'save-expired');
  assert.deepEqual(rig.calls, []);
  assert.equal(rig.insertCalls().length, 0);
});

test('a validly signed context even one millisecond in the future is expired before source access', async () => {
  const rig = createRig();
  const result = await rig.service.replay(principalFor(), command({ queuedAt: NOW + 1 }));

  assertOneRefusal(rig, result, 'save-expired');
  assert.deepEqual(rig.calls, []);
  assert.equal(rig.sessionCalls(), 0);
  assert.equal(rig.permissionCalls(), 0);
  assert.equal(rig.insertCalls().length, 0);
});

test('a press exactly five minutes after preparation is expired before replay sources', async () => {
  let clockNow = NOW;
  const rig = createRig({ clock: () => clockNow });
  const prepared = await rig.service.prepare(principalFor(), ALLOTMENT_ID);
  assert.equal(prepared.ok, true);
  const callsAfterPreparation = rig.calls.length;

  clockNow = prepared.value.preparedAt + RECEIPT_REPLAY_MAX_AGE_MS;
  const result = await rig.service.replay(principalFor(), command({
    preparedAt: prepared.value.preparedAt,
    queuedAt: clockNow,
    contextToken: prepared.value.contextToken,
    expected: prepared.value.expected,
  }));

  assertOneRefusal(rig, result, 'save-expired');
  assert.equal(rig.calls.length, callsAfterPreparation, 'the exact preparation-age boundary reaches no replay source');
  assert.equal(rig.insertCalls().length, 0);
});

test('queue timing fails closed before source access when context is stale or the press predates preparation', async (t) => {
  await t.test('stale prepared context', async () => {
    const rig = createRig();
    const result = await rig.service.replay(principalFor(), command({
      preparedAt: NOW - RECEIPT_CONTEXT_MAX_AGE_MS,
      queuedAt: NOW - 1_000,
    }));

    assertOneRefusal(rig, result, 'save-expired');
    assert.deepEqual(rig.calls, []);
    assert.equal(rig.insertCalls().length, 0);
  });

  await t.test('press before preparation', async () => {
    const rig = createRig();
    const result = await rig.service.replay(principalFor(), command({
      preparedAt: NOW - 1_000,
      queuedAt: NOW - 1_001,
    }));

    assertOneRefusal(rig, result, 'invalid-request');
    assert.deepEqual(rig.calls, []);
    assert.equal(rig.insertCalls().length, 0);
  });
});

test('an offline press gets its own full replay window inside the sealed context lifetime', async () => {
  let clockNow = NOW;
  const rig = createRig({ clock: () => clockNow });
  const prepared = await rig.service.prepare(principalFor(), ALLOTMENT_ID);
  assert.equal(prepared.ok, true);
  assert.equal(prepared.value.preparedAt, NOW);

  clockNow = NOW + RECEIPT_REPLAY_MAX_AGE_MS - 1_000;
  const pressedAt = clockNow;
  clockNow = pressedAt + RECEIPT_REPLAY_MAX_AGE_MS - 1_000;
  const replayed = await rig.service.replay(principalFor(), command({
    preparedAt: prepared.value.preparedAt,
    queuedAt: pressedAt,
    contextToken: prepared.value.contextToken,
    expected: prepared.value.expected,
  }));

  assert.deepEqual(replayed, { ok: true, receiptId: RECEIPT_ID, duplicate: false });
  assert.equal(clockNow - pressedAt, RECEIPT_REPLAY_MAX_AGE_MS - 1_000);
  assert.equal(clockNow - prepared.value.preparedAt, RECEIPT_CONTEXT_MAX_AGE_MS - 2_000);
  assert.equal(rig.insertCalls().length, 1);
});

test('one opaque key cannot identify two full receipt fingerprints', async (t) => {
  await t.test('in flight', async () => {
    const permissionGate = deferred();
    const rig = createRig({ permissionGate: permissionGate.promise });
    const principal = principalFor();
    const first = rig.service.replay(principal, command());
    await Promise.resolve();

    const conflicting = await rig.service.replay(principal, command({ intent: { mode: 'SWIFT' } }));
    assertOneRefusal(rig, conflicting, 'idempotency-key-reused');
    permissionGate.resolve();
    assert.deepEqual(await first, { ok: true, receiptId: RECEIPT_ID, duplicate: false });
    assert.equal(rig.insertCalls().length, 1);
  });

  await t.test('already persisted', async () => {
    const rig = createRig({ keyRecording: recordings.existingKeyConflict });
    const result = await rig.service.replay(principalFor(), command());
    assertOneRefusal(rig, result, 'idempotency-key-reused');
    assert.deepEqual(rig.calls.map((call) => call.op), ['session', 'permission', 'coql:key']);
    assert.equal(rig.insertCalls().length, 0);
  });
});

test('a UTR already used by a different logical receipt is refused only after fresh context', async () => {
  const rig = createRig({ utrRecording: recordings.existingConflict });
  const result = await rig.service.replay(principalFor(), command());

  assertOneRefusal(rig, result, 'receipt-reference-reused');
  assert.equal(rig.calls.filter((call) => call.op === 'getRecord').length, 1, 'the business context was re-read');
  assert.equal(rig.insertCalls().length, 0);
});

test('a COQL UTR miss is overruled by the normalized UTR in the authoritative ledger', async () => {
  const ledger = clone(recordings.balanceRecordedSameUtr);
  ledger.body.data[1].UTR = ' hdfc2609001 ';
  ledger.body.data[1].Match_State = 'Claimed';
  const rig = createRig({ utrRecording: recordings.empty, contextRecording: ledger });
  const result = await rig.service.replay(principalFor(), command());

  assertOneRefusal(rig, result, 'receipt-reference-reused');
  assert.deepEqual(rig.calls.map((call) => call.op), [
    'session',
    'permission',
    'coql:key',
    'coql:utr',
    'getRecord',
    'coql:allotment',
  ]);
  assert.equal(rig.insertCalls().length, 0);
  assertPlaneBPrivate(rig.sink.records(), [' hdfc2609001 ']);
});

test('a full-ledger COQL page above 2,000 rows is refused before row iteration or write', async () => {
  let rowReads = 0;
  const guardedRows = new Proxy(new Array(2_001), {
    get(target, property, receiver) {
      if (/^\d+$/.test(String(property))) {
        rowReads++;
        throw new Error('oversized ledger rows must not be parsed');
      }
      return Reflect.get(target, property, receiver);
    },
  });
  const rig = createRig({
    contextResult: {
      ok: true,
      value: { records: guardedRows, moreRecords: false },
      status: 200,
      creditsRemaining: null,
    },
  });
  const result = await rig.service.replay(principalFor(), command());

  assertOneRefusal(rig, result, 'source-invalid');
  assert.equal(rowReads, 0, 'the source-size bound is checked before any returned row is read');
  assert.equal(rig.insertCalls().length, 0);
  assert.deepEqual(rig.calls.map((call) => call.op), [
    'session', 'permission', 'coql:key', 'coql:utr', 'getRecord', 'coql:allotment',
  ]);
});

test('stale due is refused, including TC-IM01-010 with a different opaque key', async (t) => {
  await t.test('due changed but remains non-zero', async () => {
    const rig = createRig({ contextRecording: recordings.partRecorded });
    const result = await rig.service.replay(principalFor(), command());
    assertOneRefusal(rig, result, 'amount-due-changed');
    assert.equal(rig.insertCalls().length, 0);
  });

  for (const sample of [
    {
      name: 'second session used a different UTR',
      utrRecording: recordings.empty,
      contextRecording: recordings.balanceRecorded,
    },
    {
      name: 'second session used the same UTR but a different opaque key',
      utrRecording: recordings.existingBalanceOtherKey,
      contextRecording: recordings.balanceRecordedSameUtr,
    },
  ]) {
    await t.test(sample.name, async () => {
      const rig = createRig({ utrRecording: sample.utrRecording, contextRecording: sample.contextRecording });
      const result = await rig.service.replay(principalFor(), command({ idempotencyKey: OTHER_IDEMPOTENCY_KEY }));
      assertOneRefusal(rig, result, 'balance-already-recorded');
      assert.equal(rig.insertCalls().length, 0);
      const rows = sample.contextRecording.body.data;
      const recorded = rows.filter((row) => !['Claimed', 'Not found', 'Reversed'].includes(row.Match_State))
        .reduce((sum, row) => sum + (row.Kind === 'Refund' ? -row.Amount : row.Amount), 0);
      assert.equal(recorded, 2500000, 'the authoritative total stays at the ₹25 L commitment');
      assert.equal(rig.sink.records().filter((record) => record.kind === 'refusal').length, 1);
    });
  }
});

test('an excess-credit ledger remains readable with nothing left to record', async () => {
  const rig = createRig({ contextRecording: recordings.excessCredit });
  const result = await rig.service.prepare(principalFor(), ALLOTMENT_ID);
  // Both receipts are Pending: due stays the whole ₹25 L (nothing matched, D21), recorded is ₹26 L, outstanding 0.
  const expected = { ...clone(SIGNED_SNAPSHOT), amountDueRupees: 2500000, recordedRupees: 2600000 };

  assert.deepEqual(result, {
    ok: true,
    value: {
      preparedAt: NOW,
      contextToken: contextTokenFor(principalFor(), NOW, ALLOTMENT_ID, expected),
      expected,
    },
  });
  const recorded = recordings.excessCredit.body.data.reduce((sum, row) => sum + row.Amount, 0);
  assert.equal(recorded, 2600000);
  assert.equal(result.value.expected.recordedRupees, 2600000);
  assert.equal(outstandingRupees(result.value.expected), 0);
  assert.equal(rig.insertCalls().length, 0);
  assert.equal(rig.sink.records().length, 0);
});

test('an unchanged unsigned supplementary still permits recording money', async () => {
  const rig = createRig({ allotmentRecording: recordings.unsigned });
  const result = await rig.service.replay(principalFor(), command({
    idempotencyKey: 'receipt_unsigned_context_01',
    expected: UNSIGNED_SNAPSHOT,
  }));

  assert.deepEqual(result, { ok: true, receiptId: RECEIPT_ID, duplicate: false });
  assert.equal(rig.insertCalls().length, 1, 'recording is not gated by agreement verification');
  assert.equal(rig.sink.records().length, 0);
});

test('changed supplementary, reservation and hold snapshots each fail closed', async (t) => {
  for (const sample of [
    ['supplementary round', recordings.supplementaryChanged, 'supplementary-round-changed'],
    ['reservation state', recordings.reservationChanged, 'reservation-state-changed'],
    ['hold', recordings.holdChanged, 'hold-changed'],
  ]) {
    await t.test(sample[0], async () => {
      const rig = createRig({ allotmentRecording: sample[1] });
      const result = await rig.service.replay(principalFor(), command());
      assertOneRefusal(rig, result, sample[2]);
      assert.equal(rig.insertCalls().length, 0);
    });
  }
});

test('reservation drift takes precedence when the balance also fell to zero', async () => {
  const rig = createRig({
    allotmentRecording: recordings.reservationChanged,
    contextRecording: recordings.balanceRecorded,
  });
  const result = await rig.service.replay(principalFor(), command());

  assertOneRefusal(rig, result, 'reservation-state-changed');
  assert.notEqual(result.reasonCode, 'balance-already-recorded');
  assert.equal(rig.insertCalls().length, 0);
});

test('a live investor or LLP target change is refused before creating a receipt', async () => {
  const rig = createRig({ allotmentRecording: recordings.allotmentTargetChanged });
  const result = await rig.service.replay(principalFor(), command());

  assertOneRefusal(rig, result, 'allotment-target-changed');
  assert.equal(rig.insertCalls().length, 0);
  assertPlaneBPrivate(rig.sink.records(), [
    recordings.allotmentTargetChanged.body.data[0].Customer.id,
    recordings.allotmentTargetChanged.body.data[0].Customer.name,
  ]);
});

test('an allotment response for a different record id fails closed', async () => {
  const rig = createRig({ allotmentRecording: recordings.allotmentIdMismatch });
  const result = await rig.service.prepare(principalFor(), ALLOTMENT_ID);

  assertOneRefusal(rig, result, 'source-invalid');
  assert.deepEqual(rig.calls.map((call) => call.op), ['session', 'permission', 'getRecord']);
  assert.equal(rig.insertCalls().length, 0);
});

test('refunds cannot enter the inbound receipt replay flow', async () => {
  const rig = createRig();
  const result = await rig.service.replay(principalFor(), command({
    intent: { kind: 'Refund', amountRupees: 100000 },
  }));

  assertOneRefusal(rig, result, 'refund-requires-approved-flow');
  assert.deepEqual(rig.calls, [], 'the approved refund flow is required before any source access');
  assert.equal(rig.insertCalls().length, 0);
});

test('impossible request and source dates fail closed', async (t) => {
  await t.test('receipt timestamp', async () => {
    const rig = createRig();
    const result = await rig.service.replay(principalFor(), command({
      intent: { receivedOn: '2026-02-30T09:00:00+05:30' },
    }));
    assertOneRefusal(rig, result, 'invalid-request');
    assert.deepEqual(rig.calls, []);
  });

  await t.test('sealed supplementary timestamp', async () => {
    const expected = clone(SIGNED_SNAPSHOT);
    expected.supplementary.verifiedAt = '2026-02-30T10:15:00+05:30';
    const rig = createRig();
    const result = await rig.service.replay(principalFor(), command({ expected }));
    assertOneRefusal(rig, result, 'invalid-request');
    assert.deepEqual(rig.calls, []);
  });

  await t.test('Zoho hold date', async () => {
    const rig = createRig({ allotmentRecording: recordings.allotmentImpossibleDate });
    const result = await rig.service.prepare(principalFor(), ALLOTMENT_ID);
    assertOneRefusal(rig, result, 'source-invalid');
    assert.deepEqual(rig.calls.map((call) => call.op), ['session', 'permission', 'getRecord', 'coql:allotment']);
  });
});

test('overlong nullable Zoho text fails closed as an invalid source response', async () => {
  const allotment = clone(recordings.allotment);
  allotment.body.data[0].Supplementary_Signed_Via = 'X'.repeat(201);
  const rig = createRig({ allotmentRecording: allotment });
  const result = await rig.service.prepare(principalFor(), ALLOTMENT_ID);

  assertOneRefusal(rig, result, 'source-invalid');
  assert.deepEqual(rig.calls.map((call) => call.op), ['session', 'permission', 'getRecord', 'coql:allotment']);
  assert.equal(rig.insertCalls().length, 0);
  assertPlaneBPrivate(rig.sink.records(), [allotment.body.data[0].Supplementary_Signed_Via]);
});

test('permission is rechecked and a lost write grant reaches no CRM operation', async () => {
  const rig = createRig({ permissionAllowed: false });
  const result = await rig.service.replay(principalFor(), command());

  assertOneRefusal(rig, result, 'permission-changed');
  assert.deepEqual(rig.calls.map((call) => call.op), ['session', 'permission']);
  assert.equal(rig.insertCalls().length, 0);
});

test('a queue context cannot cross either a person or a session boundary', async (t) => {
  await t.test('person changed', async () => {
    const rig = createRig();
    const result = await rig.service.replay(principalFor(OTHER_ACTOR_ID), command());
    assertOneRefusal(rig, result, 'context-token-invalid');
    assert.deepEqual(rig.calls, [], 'the context seal rejects a different person before source access');
    assert.deepEqual(rig.sink.records()[0].actor, { kind: 'user', userId: OTHER_ACTOR_ID });
  });

  await t.test('session changed', async () => {
    const rig = createRig();
    const result = await rig.service.replay(principalFor(ACTOR_ID, OTHER_SESSION_ID), command());
    assertOneRefusal(rig, result, 'context-token-invalid');
    assert.deepEqual(rig.calls, [], 'the context seal rejects a different session before source access');
  });
});

test('malformed principals are refused without throwing or reaching a source', async (t) => {
  for (const [name, malformed] of [
    ['null principal', null],
    ['missing credential and session', {}],
    ['null credential', { credential: null, sessionId: SESSION_ID }],
    ['non-string session', { credential: credentialFor(), sessionId: 42 }],
  ]) {
    await t.test(name, async () => {
      const rig = createRig();
      let result;
      await assert.doesNotReject(async () => {
        result = await rig.service.replay(malformed, command());
      });
      assertOneRefusal(rig, result, 'invalid-request');
      assert.deepEqual(rig.calls, []);
    });
  }
});

test('post-dispatch cancellation with no recovery row is a nonretryable unknown outcome', async (t) => {
  const networkFailure = Object.freeze({
    ok: false,
    error: Object.freeze({ kind: 'network', status: null }),
    creditsRemaining: null,
  });
  const expected = {
    ok: false,
    kind: 'unknown-outcome',
    reason: 'the receipt outcome is unknown and must be reconciled by its idempotency key',
    retryable: false,
  };

  await t.test('deadline expires during POST', async () => {
    const insertGate = deferred();
    const nearDeadlineAt = NOW - RECEIPT_REPLAY_MAX_AGE_MS + 25;
    const rig = createRig({ insertGate: insertGate.promise, insertFailure: networkFailure });
    const pending = rig.service.replay(principalFor(), command({
      preparedAt: nearDeadlineAt,
      queuedAt: nearDeadlineAt,
    }));
    await waitUntil(() => rig.insertCalls().length === 1, 'replay did not dispatch the receipt POST');

    const result = await pending;
    insertGate.resolve();

    assert.deepEqual(result, expected);
    assert.equal(rig.insertCalls().length, 1);
    assert.equal(rig.calls.filter((call) => call.op === 'coql:key').length, 2,
      'deadline ambiguity performs one bounded durable-key recovery read');
    assert.equal(rig.sink.records().length, 0);
  });

  await t.test('sign-out aborts during POST', async () => {
    const insertGate = deferred();
    const rig = createRig({ insertGate: insertGate.promise, insertFailure: networkFailure });
    const pending = rig.service.replay(principalFor(), command());
    await waitUntil(() => rig.insertCalls().length === 1, 'replay did not dispatch the receipt POST');

    rig.service.discardSession(ACTOR_ID, SESSION_ID);
    const result = await pending;
    insertGate.resolve();

    assert.deepEqual(result, expected);
    assert.equal(rig.insertCalls().length, 1);
    assert.equal(rig.calls.filter((call) => call.op === 'coql:key').length, 2,
      'sign-out ambiguity performs one bounded durable-key recovery read');
    assert.equal(rig.sink.records().length, 0);
  });
});

test('a pre-aborted insert wait still observes the already-created CRM promise rejection', async () => {
  const observedUnhandled = [];
  const onUnhandled = (reason) => observedUnhandled.push(reason);
  const syntheticRejection = new Error('synthetic CRM insert rejection after synchronous sign-out');
  let rig;
  rig = createRig({
    insertStarted() {
      rig.service.discardSession(ACTOR_ID, SESSION_ID);
      throw syntheticRejection;
    },
  });
  process.on('unhandledRejection', onUnhandled);
  try {
    const result = await rig.service.replay(principalFor(), command());
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(result, {
      ok: false,
      kind: 'unknown-outcome',
      reason: 'the receipt outcome is unknown and must be reconciled by its idempotency key',
      retryable: false,
    });
    assert.equal(rig.insertCalls().length, 1);
    assert.equal(rig.calls.filter((call) => call.op === 'coql:key').length, 2,
      'the rejected POST is followed by one bounded durable-key recovery read');
    assert.deepEqual(observedUnhandled, [], 'the abandoned CRM promise rejection is always observed');
    assert.equal(rig.sink.records().length, 0);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

test('an unexpired network ambiguity remains retryable with the same durable key', async () => {
  const keyRecordings = new Map();
  const rig = createRig({
    keyRecordings,
    insertFailure: { ok: false, error: { kind: 'network', status: null }, creditsRemaining: null },
  });
  const queued = command();
  const first = await rig.service.replay(principalFor(), queued);

  assert.deepEqual(first, {
    ok: false,
    kind: 'source-error',
    source: 'zoho',
    errorKind: 'network',
    retryable: true,
  });
  assert.equal(rig.insertCalls().length, 1);
  assert.deepEqual(rig.calls.filter((call) => call.op === 'coql:key').map((call) => call.selectQuery), [
    `${COQL_SELECT} where Idempotency_Key = '${BASE_DURABLE_KEY}' limit 0, 2`,
    `${COQL_SELECT} where Idempotency_Key = '${BASE_DURABLE_KEY}' limit 0, 2`,
  ]);

  keyRecordings.set(BASE_DURABLE_KEY, recordings.existingSame);
  const retried = await rig.service.replay(principalFor(), clone(queued));
  assert.deepEqual(retried, { ok: true, receiptId: RECEIPT_ID, duplicate: true });
  assert.equal(rig.insertCalls().length, 1, 'same-key retry recovers the row instead of posting again');
  assert.equal(rig.sink.records().length, 0);
});

test('a client-style unexpected insert acknowledgement remains a retryable same-key ambiguity', async () => {
  const rig = createRig({
    insertFailure: {
      ok: false,
      error: { kind: 'unexpected', status: 200, code: 'MALFORMED_RESPONSE' },
      creditsRemaining: null,
    },
  });
  const result = await rig.service.replay(principalFor(), command());

  assert.deepEqual(result, {
    ok: false,
    kind: 'source-error',
    source: 'zoho',
    errorKind: 'unexpected',
    retryable: true,
  });
  assert.notEqual(result.retryable, false, 'an acknowledgement ambiguity is never reported as definitive failure');
  assert.equal(rig.insertCalls().length, 1);
  assert.deepEqual(rig.calls.filter((call) => call.op === 'coql:key').map((call) => call.selectQuery), [
    `${COQL_SELECT} where Idempotency_Key = '${BASE_DURABLE_KEY}' limit 0, 2`,
    `${COQL_SELECT} where Idempotency_Key = '${BASE_DURABLE_KEY}' limit 0, 2`,
  ]);
  assert.equal(rig.sink.records().length, 0);
});

test('an ambiguous insert failure recovers the landed receipt by its durable key', async () => {
  const rig = createRig({
    sourceFailureAt: 'insert',
    keyRecordingAfterInsertFailure: recordings.existingSame,
  });
  const result = await rig.service.replay(principalFor(), command());

  assert.deepEqual(result, { ok: true, receiptId: RECEIPT_ID, duplicate: true });
  assert.deepEqual(rig.calls.map((call) => call.op), [
    'session',
    'permission',
    'coql:key',
    'coql:utr',
    'getRecord',
    'coql:allotment',
    'session',
    'permission',
    'insert',
    'coql:key',
  ]);
  assert.equal(rig.insertCalls().length, 1);
  assert.equal(rig.calls.filter((call) => call.op === 'coql:key').length, 2);
  assert.equal(rig.sink.records().length, 0);
});

test('a single-row 207 duplicate collision recovers its winner without replaying the insert', async (t) => {
  await t.test('winning durable key', async () => {
    const rig = createRig({
      insertRecording: recordings.duplicateData207,
      keyRecordingAfterInsertFailure: recordings.existingSame,
    });
    const result = await rig.service.replay(principalFor(), command());

    assert.deepEqual(result, { ok: true, receiptId: RECEIPT_ID, duplicate: true });
    assert.equal(rig.insertCalls().length, 1);
    assert.equal(rig.calls.filter((call) => call.op === 'coql:key').length, 2);
    assert.equal(rig.sink.records().length, 0);
  });

  await t.test('winning exact UTR row during durable-key index lag', async () => {
    const rig = createRig({
      insertRecording: recordings.duplicateData207,
      utrRecordingAfterInsert: recordings.existingSame,
    });
    const result = await rig.service.replay(principalFor(), command());

    assert.deepEqual(result, { ok: true, receiptId: RECEIPT_ID, duplicate: true });
    assert.equal(rig.insertCalls().length, 1);
    assert.equal(rig.calls.filter((call) => call.op === 'coql:key').length, 2);
    assert.equal(rig.calls.filter((call) => call.op === 'coql:utr').length, 2);
    assert.equal(rig.calls.filter((call) => call.op === 'getRecord').length, 1,
      'the exact UTR winner does not require the lagging full ledger to be visible');
    assert.equal(rig.sink.records().length, 0);
  });

  await t.test('winning different UTR row', async () => {
    const rig = createRig({
      insertRecording: recordings.duplicateData207,
      utrRecordingAfterInsert: recordings.existingConflict,
    });
    const result = await rig.service.replay(principalFor(), command());

    assertOneRefusal(rig, result, 'receipt-reference-reused');
    assert.equal(rig.insertCalls().length, 1);
    assert.equal(rig.calls.filter((call) => call.op === 'coql:key').length, 2);
    assert.equal(rig.calls.filter((call) => call.op === 'coql:utr').length, 2);
    assert.equal(rig.calls.filter((call) => call.op === 'getRecord').length, 2,
      'a different UTR winner is reconciled against the fresh ledger');
  });
});

test('malformed or contradictory 207 outcomes recover by key and remain retryably ambiguous', async (t) => {
  const empty = clone(recordings.duplicateData207);
  empty.body.data = [];
  const malformedCode = clone(recordings.duplicateData207);
  malformedCode.body.data[0].code = 'bad code';
  const contradictorySuccess = clone(recordings.duplicateData207);
  contradictorySuccess.body.data[0].code = 'SUCCESS';
  contradictorySuccess.body.data[0].status = 'error';

  for (const [name, insertRecording] of [
    ['empty 207 data', empty],
    ['malformed failed code', malformedCode],
    ['failed row carrying SUCCESS', contradictorySuccess],
    ['multiple impossible outcomes', recordings.malformedPartial207],
  ]) {
    await t.test(name, async () => {
      const rig = createRig({ insertRecording });
      const result = await rig.service.replay(principalFor(), command());

      assert.deepEqual(result, {
        ok: false,
        kind: 'source-error',
        source: 'zoho',
        errorKind: 'unexpected',
        retryable: true,
      });
      assert.equal(rig.insertCalls().length, 1);
      assert.equal(rig.calls.filter((call) => call.op === 'coql:key').length, 2,
        'every ambiguous partial response first attempts durable-key recovery');
      assert.equal(rig.sink.records().length, 0);
    });
  }

  await t.test('one well-formed failed non-success code remains definitive', async () => {
    const definitive = clone(recordings.duplicateData207);
    definitive.body.data[0].code = 'INVALID_DATA';
    const rig = createRig({ insertRecording: definitive });
    const result = await rig.service.replay(principalFor(), command());

    assert.deepEqual(result, {
      ok: false,
      kind: 'source-error',
      source: 'zoho',
      errorKind: 'partial',
      retryable: false,
    });
    assert.equal(rig.insertCalls().length, 1);
    assert.equal(rig.calls.filter((call) => call.op === 'coql:key').length, 2);
    assert.equal(rig.sink.records().length, 0);
  });
});

test('malformed 2xx insert outcomes recover by key and remain retryably ambiguous', async (t) => {
  const empty = clone(recordings.created);
  empty.body.data = [];
  const multiple = clone(recordings.created);
  const second = clone(multiple.body.data[0]);
  second.details.id = '9007199254740993015';
  multiple.body.data.push(second);
  const contradictoryCode = clone(recordings.created);
  contradictoryCode.body.data[0].code = 'SYNTHETIC_NON_SUCCESS';
  const missingId = clone(recordings.created);
  delete missingId.body.data[0].details.id;

  for (const [name, insertRecording] of [
    ['empty outcome list', empty],
    ['multiple success outcomes for one input', multiple],
    ['status success with non-SUCCESS code', contradictoryCode],
    ['missing outcome id', missingId],
  ]) {
    await t.test(name, async () => {
      const rig = createRig({ insertRecording });
      const result = await rig.service.replay(principalFor(), command());

      assert.deepEqual(result, {
        ok: false,
        kind: 'source-error',
        source: 'zoho',
        errorKind: 'unexpected',
        retryable: true,
      });
      assert.equal(rig.insertCalls().length, 1);
      assert.equal(rig.calls.filter((call) => call.op === 'coql:key').length, 2,
        'an invalid success envelope is trusted only after durable-key recovery');
      assert.equal(rig.sink.records().length, 0);
    });
  }
});

test('a numeric insert acknowledgement id is ambiguous and trusted only after durable-key recovery', async (t) => {
  const numericId = Number(RECEIPT_ID);
  assert.equal(Number.isSafeInteger(numericId), false, 'the synthetic 19-digit Zoho id cannot survive JSON number parsing');
  const numericAcknowledgement = clone(recordings.created);
  numericAcknowledgement.body.data[0].details.id = numericId;

  await t.test('invisible winner remains retryable', async () => {
    const rig = createRig({ insertRecording: numericAcknowledgement });
    const result = await rig.service.replay(principalFor(), command());

    assert.deepEqual(result, {
      ok: false,
      kind: 'source-error',
      source: 'zoho',
      errorKind: 'unexpected',
      retryable: true,
    });
    assert.equal(rig.insertCalls().length, 1);
    assert.equal(rig.calls.filter((call) => call.op === 'coql:key').length, 2,
      'the malformed acknowledgement triggers one bounded durable-key recovery lookup');
    assert.equal(JSON.stringify(result).includes(String(numericId)), false);
    assertPlaneBPrivate(rig.sink.records(), [String(numericId)]);
  });

  await t.test('visible durable-key winner is recovered', async () => {
    const rig = createRig({
      insertRecording: numericAcknowledgement,
      keyRecordingAfterInsertFailure: recordings.existingSame,
    });
    const result = await rig.service.replay(principalFor(), command());

    assert.deepEqual(result, { ok: true, receiptId: RECEIPT_ID, duplicate: true });
    assert.equal(rig.insertCalls().length, 1);
    assert.equal(rig.calls.filter((call) => call.op === 'coql:key').length, 2);
    assert.equal(rig.sink.records().length, 0);
  });
});

test('session, permission and Zoho source failures do not create or disclose a receipt', async (t) => {
  await t.test('session source failed', async () => {
    const rig = createRig({ sessionThrows: true });
    const result = await rig.service.replay(principalFor(), command());
    assert.deepEqual(result, {
      ok: false,
      kind: 'source-error',
      source: 'session',
      errorKind: 'unexpected',
      retryable: true,
    });
    assert.deepEqual(rig.calls.map((call) => call.op), ['session']);
    assert.equal(rig.insertCalls().length, 0);
    assertPlaneBPrivate(rig.sink.records());
  });

  await t.test('permission source failed', async () => {
    const rig = createRig({ permissionThrows: true });
    const result = await rig.service.replay(principalFor(), command());
    assert.deepEqual(result, {
      ok: false,
      kind: 'source-error',
      source: 'permission',
      errorKind: 'unexpected',
      retryable: true,
    });
    assert.deepEqual(rig.calls.map((call) => call.op), ['session', 'permission']);
    assert.equal(rig.insertCalls().length, 0);
    assertPlaneBPrivate(rig.sink.records());
  });

  await t.test('Zoho source failed', async () => {
    const rig = createRig({ sourceFailureAt: 'key-coql' });
    const result = await rig.service.replay(principalFor(), command());
    assert.deepEqual(result, {
      ok: false,
      kind: 'source-error',
      source: 'zoho',
      errorKind: 'server',
      retryable: true,
    });
    assert.deepEqual(rig.calls.map((call) => call.op), ['session', 'permission', 'coql:key']);
    assert.equal(rig.insertCalls().length, 0);
    assert.ok(!JSON.stringify(result).includes(recordings.serverError.body.message));
    assertPlaneBPrivate(rig.sink.records(), [recordings.serverError.body.message]);
  });
});

test('Plane B refusal rows are IDs and fixed codes only, never receipt or investor data', async () => {
  const rig = createRig({ allotmentRecording: recordings.supplementaryChanged });
  const result = await rig.service.replay(principalFor(), command());
  assertOneRefusal(rig, result, 'supplementary-round-changed');

  const [line] = rig.sink.records();
  assert.deepEqual(line.actor, { kind: 'user', userId: ACTOR_ID });
  assert.deepEqual(line.recordIds, [ALLOTMENT_ID]);
  assertPlaneBPrivate(rig.sink.records(), [
    recordings.supplementaryChanged.body.data[0].Customer.name,
    recordings.supplementaryChanged.body.data[0].LLP.name,
  ]);
});

/* ---- M01-S08-NOTE-5: refunds and reversals through the one signed ledger (./ledger) --------------------------- */

const { createPaymentsRegister } = load(path.join('server', 'money', 'register.js'));
const { moneyOf } = load(path.join('server', 'money', 'by-allotment.js'));
const { ledgerOf } = load(path.join('server', 'money', 'ledger.js'));

let ledgerUtr = 0;
/** A synthetic Receipts row on the fixture allotment. n: 2-digit suffix of the record id. */
function ledgerRow(n, kind, amount, state, reversalOf = null) {
  ledgerUtr += 1;
  return {
    ...clone(recordings.advance.body.data[0]),
    id: `90071992547409931${String(n).padStart(2, '0')}`,
    Kind: kind, Amount: amount, Match_State: state, UTR: `SYNTHLEDGER${String(ledgerUtr).padStart(4, '0')}`,
    Reversal_Of: reversalOf ? { id: `90071992547409931${String(reversalOf).padStart(2, '0')}`, name: 'Synthetic reversed receipt' } : null,
  };
}
const ledgerOfRows = (rows) => recordingWithRows(recordings.advance, rows);
const snapshotWith = (amountDueRupees, recordedRupees) => ({ ...clone(SIGNED_SNAPSHOT), amountDueRupees, recordedRupees });

async function prepared(rows) {
  const rig = createRig({ contextRecording: ledgerOfRows(rows) });
  const result = await rig.service.prepare(principalFor(), ALLOTMENT_ID);
  return { rig, result };
}

/** The Payments register over the same rows and the same allotment (Reserved, 1 unit × ₹25 L). */
async function registerTotals(rows) {
  const allot = recordings.allotment.body.data[0];
  const crm = {
    async coql(_cred, q) {
      const records = /from Receipts/.test(q) ? rows.map((r) => ({ ...r, Created_By: r.Created_By }))
        : /Allocation_Status = 'Reserved'/.test(q) ? [{ id: ALLOTMENT_ID, Customer: allot.Customer, LLP: allot.LLP, Allocation_Status: allot.Allocation_Status,
          Issued_Units: allot.Issued_Units, Reserved_Units: allot.Reserved_Units, Unit_Price: allot.Unit_Price }] : [];
      return { ok: true, value: { records, moreRecords: false, invalidRecordIds: null } };
    },
  };
  const register = createPaymentsRegister({
    crm, log: createOpsLog(createMemorySink()), recordIdPrefix: RECORD_ID_PREFIX, clock: () => NOW,
    access: { async recheck(cred) { return { actor: { userId: cred.userId }, seesRegister: true, seesUtr: true, canRecord: true }; } },
  });
  const r = await register.read(principalFor());
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.value.totals;
}

test('NOTE-5: a refund after a match is money out; an inbound receipt after it is still recordable (D21)', async () => {
  const rows = [ledgerRow(1, 'Advance', 250000, 'Matched'), ledgerRow(2, 'Refund', 50000, 'Matched')];
  const { result } = await prepared(rows);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual([result.value.expected.amountDueRupees, result.value.expected.recordedRupees], [2300000, 0], '₹25 L − (₹2.5 L − ₹0.5 L)');
  const rig = createRig({ contextRecording: ledgerOfRows(rows) });
  const replayed = await rig.service.replay(principalFor(), command({ intent: { kind: 'Part', amountRupees: 100000 }, expected: snapshotWith(2300000, 0) }));
  assert.deepEqual(replayed, { ok: true, receiptId: RECEIPT_ID, duplicate: false });
  assert.equal(rig.insertCalls().length, 1);
  const totals = await registerTotals(rows);
  assert.deepEqual([totals.received, totals.refunded, totals.stillDue], [250000, 50000, 2300000]);
});

test('NOTE-5: a matched reversal cancels the receipt it points at — once, even when that receipt is also flipped to Reversed', async () => {
  for (const [name, rows] of [
    ['reversal row only', [ledgerRow(1, 'Advance', 250000, 'Matched'), ledgerRow(2, 'Refund', 250000, 'Matched', 1)]],
    ['reversal row and the receipt flipped', [ledgerRow(1, 'Advance', 250000, 'Reversed'), ledgerRow(2, 'Refund', 250000, 'Matched', 1)]],
    ['receipt flipped, no reversal row', [ledgerRow(1, 'Advance', 250000, 'Reversed')]],
  ]) {
    const { result } = await prepared(rows);
    assert.equal(result.ok, true, `${name}: ${JSON.stringify(result)}`);
    assert.deepEqual([result.value.expected.amountDueRupees, result.value.expected.recordedRupees], [2500000, 0], `${name}: nothing double-subtracted`);
    const totals = await registerTotals(rows);
    assert.deepEqual([totals.netBanked, totals.stillDue, totals.recorded.net], [0, 2500000, 0], name);
  }
  // ...and the inbound replay after it still lands (rule 3)
  const rows = [ledgerRow(1, 'Advance', 250000, 'Matched'), ledgerRow(2, 'Refund', 250000, 'Matched', 1)];
  const rig = createRig({ contextRecording: ledgerOfRows(rows) });
  const r = await rig.service.replay(principalFor(), command({ intent: { kind: 'Advance', amountRupees: 250000 }, expected: snapshotWith(2500000, 0) }));
  assert.equal(r.ok, true, JSON.stringify(r));
});

test('NOTE-5: reversal of a pending receipt, and a pending reversal of a matched one — Pending never counts as matched', async () => {
  for (const [name, rows, due, recorded] of [
    ['matched reversal of a pending receipt', [ledgerRow(1, 'Advance', 250000, 'Pending'), ledgerRow(2, 'Refund', 250000, 'Matched', 1)], 2500000, 0],
    ['pending reversal of a pending receipt', [ledgerRow(1, 'Advance', 250000, 'Pending'), ledgerRow(2, 'Refund', 250000, 'Pending', 1)], 2500000, 0],
    ['pending reversal of a matched receipt', [ledgerRow(1, 'Advance', 250000, 'Matched'), ledgerRow(2, 'Refund', 250000, 'Pending', 1)], 2250000, -250000],
    ['void (Not found) reversal', [ledgerRow(1, 'Advance', 250000, 'Matched'), ledgerRow(2, 'Refund', 250000, 'Not found', 1)], 2250000, 0],
  ]) {
    const { result } = await prepared(rows);
    assert.equal(result.ok, true, `${name}: ${JSON.stringify(result)}`);
    assert.deepEqual([result.value.expected.amountDueRupees, result.value.expected.recordedRupees], [due, recorded], name);
    const totals = await registerTotals(rows);
    assert.deepEqual([totals.stillDue, totals.recorded.net], [due, recorded], `${name}: the register agrees`);
  }
});

test('NOTE-5: a refund of a receipt already reversed is refused — by the replay and in the ledger', async () => {
  // replay never takes a refund (D22: money leaving has its own approved flow)
  const reversed = [ledgerRow(1, 'Advance', 250000, 'Matched'), ledgerRow(2, 'Refund', 250000, 'Matched', 1)];
  let rig = createRig({ contextRecording: ledgerOfRows(reversed) });
  const refund = await rig.service.replay(principalFor(), command({ intent: { kind: 'Refund', amountRupees: 250000 }, expected: snapshotWith(2500000, 0) }));
  assertOneRefusal(rig, refund, 'refund-requires-approved-flow');
  // a second refund recorded as reversing the same receipt would subtract it twice: the ledger is not sealed
  for (const extra of [ledgerRow(3, 'Refund', 250000, 'Matched', 1), ledgerRow(3, 'Refund', 250000, 'Pending', 1)]) {
    const { rig: r2, result } = await prepared([...reversed, extra]);
    assertOneRefusal(r2, result, 'source-invalid');
    assert.deepEqual([...ledgerOf([...reversed, extra].map((x) => ({ id: x.id, allotmentId: ALLOTMENT_ID, kind: x.Kind, amount: x.Amount, matchState: x.Match_State, reversalOf: x.Reversal_Of?.id ?? null }))).anomalies], [extra.id]);
  }
  // a reversal of a missing receipt, of a different amount, or of another reversal is refused the same way
  for (const bad of [
    [ledgerRow(1, 'Advance', 250000, 'Matched'), ledgerRow(2, 'Refund', 250000, 'Matched', 9)],
    [ledgerRow(1, 'Advance', 250000, 'Matched'), ledgerRow(2, 'Refund', 100000, 'Matched', 1)],
    [ledgerRow(1, 'Advance', 250000, 'Matched'), ledgerRow(2, 'Refund', 250000, 'Matched', 1), ledgerRow(3, 'Advance', 250000, 'Matched', 2)],
  ]) {
    rig = createRig({ contextRecording: ledgerOfRows(bad) });
    assertOneRefusal(rig, await rig.service.prepare(principalFor(), ALLOTMENT_ID), 'source-invalid');
    assert.equal(rig.insertCalls().length, 0);
  }
});

test('NOTE-5: a mixed ledger seals what the register and the Money section show, and replay stays idempotent', async () => {
  const rows = [
    ledgerRow(1, 'Advance', 250000, 'Matched'), ledgerRow(2, 'Part', 500000, 'Pending'), ledgerRow(3, 'Part', 100000, 'Reversed'),
    ledgerRow(4, 'Refund', 50000, 'Matched'), ledgerRow(5, 'Part', 300000, 'Matched'), ledgerRow(6, 'Refund', 300000, 'Matched', 5),
    ledgerRow(7, 'Part', 40000, 'Claimed'), ledgerRow(8, 'Refund', 20000, 'Pending'),
  ];
  const { result } = await prepared(rows);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual([result.value.expected.amountDueRupees, result.value.expected.recordedRupees], [2300000, 480000]);
  const totals = await registerTotals(rows);
  assert.deepEqual([totals.received, totals.refunded, totals.stillDue, totals.recorded.net], [250000, 50000, 2300000, 480000]);
  const asRows = rows.map((x) => ({ id: x.id, allotmentId: ALLOTMENT_ID, kind: x.Kind, amount: x.Amount, mode: null, utr: null, on: null, byId: null,
    matched: x.Match_State === 'Matched', matchState: x.Match_State, reversalOf: x.Reversal_Of?.id ?? null }));
  const m = moneyOf({ id: ALLOTMENT_ID, status: 'Reserved', units: 1, unitPrice: 2500000 }, asRows);
  assert.deepEqual([m.due, m.recorded], [2300000, 480000], 'the investor record reads the same numbers');

  // the same press twice: one write, the second answer is the persisted receipt
  const rig = createRig({ contextRecording: ledgerOfRows(rows) });
  const cmd = command({ intent: { kind: 'Part', amountRupees: 100000 }, expected: snapshotWith(2300000, 480000) });
  const first = await rig.service.replay(principalFor(), cmd);
  const second = await rig.service.replay(principalFor(), cmd);
  assert.deepEqual(first, { ok: true, receiptId: RECEIPT_ID, duplicate: false });
  assert.deepEqual(second, { ok: true, receiptId: RECEIPT_ID, duplicate: true });
  assert.equal(rig.insertCalls().length, 1);
});

test('NOTE-5: a pending balance recorded by another hand meanwhile is the balance already recorded', async () => {
  const before = [ledgerRow(1, 'Advance', 250000, 'Matched')];
  const after = [...before, ledgerRow(2, 'Full', 2250000, 'Pending')];
  const rig = createRig({ contextRecording: ledgerOfRows(after) });
  const r = await rig.service.replay(principalFor(), command({ idempotencyKey: OTHER_IDEMPOTENCY_KEY, expected: snapshotWith(2250000, 0) }));
  assertOneRefusal(rig, r, 'balance-already-recorded');
  assert.equal(rig.insertCalls().length, 0);
});

test('NOTE-5 property: for random ledgers, replay seals exactly the register\'s still-due and recorded totals', async () => {
  let seed = 0x5eed;
  const rand = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const KINDS = ['Advance', 'Part', 'Balance', 'Full', 'Refund', 'Forfeit'];
  const STATES = ['Pending', 'Matched', 'Matched', 'Not found', 'Reversed', 'Claimed'];
  for (let round = 0; round < 60; round++) {
    const rows = [];
    const count = 1 + rand(7);
    for (let i = 1; i <= count; i++) rows.push(ledgerRow(i, KINDS[rand(KINDS.length)], (1 + rand(20)) * 25000, STATES[rand(STATES.length)]));
    // up to two well-formed reversals of distinct non-reversal receipts
    const targets = rows.slice();
    for (let k = 0; k < rand(3) && targets.length; k++) {
      const t = targets.splice(rand(targets.length), 1)[0];
      rows.push(ledgerRow(20 + k, rand(2) ? 'Refund' : t.Kind, t.Amount, ['Matched', 'Pending', 'Not found'][rand(3)], Number(t.id.slice(-2))));
    }
    const shuffled = rows.slice().sort(() => rand(3) - 1);
    const a = await prepared(rows), b = await prepared(shuffled);
    assert.equal(a.result.ok, true, `round ${round}: ${JSON.stringify(a.result)}`);
    assert.deepEqual(b.result.value.expected, a.result.value.expected, `round ${round}: row order never changes the seal`);
    const totals = await registerTotals(rows);
    assert.equal(a.result.value.expected.amountDueRupees, totals.stillDue, `round ${round}: due`);
    assert.equal(a.result.value.expected.recordedRupees, totals.recorded.net, `round ${round}: recorded`);
    const again = await prepared(rows);
    assert.deepEqual(again.result.value.expected, a.result.value.expected, `round ${round}: prepare is repeatable`);
  }
});

/* ---- M01-S08-NOTE-4: Balance (D70's name for Part) and Forfeit rows on the allotment ------------------------------ */

/** A Forfeit as a lapse/release writes it: money kept, no bank transfer — no Mode, no UTR. */
const forfeitRow = (n, amount, state = 'Matched') => ({ ...ledgerRow(n, 'Forfeit', amount, state), Mode: null, UTR: null });

test('NOTE-4: a Balance row is inbound money like Part; a Forfeit is kept money — never money in, never money due', async () => {
  const rows = [ledgerRow(1, 'Advance', 250000, 'Matched'), ledgerRow(2, 'Balance', 100000, 'Matched'), forfeitRow(3, 50000),
    ledgerRow(4, 'Balance', 200000, 'Pending'), forfeitRow(5, 50000, 'Pending')];
  const { result } = await prepared(rows);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual([result.value.expected.amountDueRupees, result.value.expected.recordedRupees], [2150000, 200000],
    '₹25 L − (₹2.5 L + ₹1 L) matched; the forfeits neither pay nor owe');
  const totals = await registerTotals(rows);
  assert.deepEqual([totals.received, totals.refunded, totals.stillDue, totals.recorded.net], [350000, 0, 2150000, 200000], 'the register agrees');
  const asLedger = rows.map((x) => ({ id: x.id, allotmentId: ALLOTMENT_ID, kind: x.Kind, amount: x.Amount, matchState: x.Match_State, reversalOf: x.Reversal_Of?.id ?? null }));
  const sums = ledgerOf(asLedger).byAllotment.get(ALLOTMENT_ID);
  assert.deepEqual(sums, { matchedIn: 350000, matchedOut: 0, pendingIn: 200000, pendingOut: 0, forfeited: 50000 }, 'only the matched forfeit is kept money');
  // an inbound press after them still lands (rule 3) — before NOTE-4 the Forfeit/Balance rows made this source-invalid
  const rig = createRig({ contextRecording: ledgerOfRows(rows) });
  const r = await rig.service.replay(principalFor(), command({ intent: { kind: 'Part', amountRupees: 100000 }, expected: snapshotWith(2150000, 200000) }));
  assert.deepEqual(r, { ok: true, receiptId: RECEIPT_ID, duplicate: false });
  assert.equal(rig.insertCalls().length, 1);
});

test('NOTE-4: a lapse ledger — forfeit kept, the rest refunded — stands at the forfeit; a reversed forfeit is kept nowhere', async () => {
  // ₹3 L matched; on the lapse ₹50,000 is forfeited (one unit) and ₹2.5 L refunded: ₹50,000 stands, which is the forfeit
  const lapse = [ledgerRow(1, 'Advance', 300000, 'Matched'), forfeitRow(2, 50000), ledgerRow(3, 'Refund', 250000, 'Matched')];
  const s1 = ledgerOf(lapse.map((x) => ({ id: x.id, allotmentId: ALLOTMENT_ID, kind: x.Kind, amount: x.Amount, matchState: x.Match_State, reversalOf: null }))).byAllotment.get(ALLOTMENT_ID);
  assert.deepEqual([s1.matchedIn - s1.matchedOut, s1.forfeited], [50000, 50000]);
  const { result } = await prepared(lapse);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.value.expected.amountDueRupees, 2450000, 'Reserved fixture: due is commitment − standing; the forfeit row adds nothing');
  // a matched reversal of the forfeit cancels it once
  const undone = [...lapse, { ...forfeitRow(4, 50000), Reversal_Of: { id: lapse[1].id, name: 'Synthetic reversed receipt' } }];
  const s2 = ledgerOf(undone.map((x) => ({ id: x.id, allotmentId: ALLOTMENT_ID, kind: x.Kind, amount: x.Amount, matchState: x.Match_State, reversalOf: x.Reversal_Of?.id ?? null })));
  assert.deepEqual([s2.anomalies.length, s2.byAllotment.get(ALLOTMENT_ID).forfeited], [0, 0]);
  assert.equal((await prepared(undone)).result.ok, true);
});

test('NOTE-4: only a Forfeit may be bankless; a Balance without its UTR, or an unknown kind, is still refused', async (t) => {
  for (const [name, row] of [
    ['Balance with no UTR', { ...ledgerRow(2, 'Balance', 100000, 'Matched'), Mode: null, UTR: null }],
    ['Forfeit with a malformed UTR', { ...ledgerRow(2, 'Forfeit', 50000, 'Matched'), UTR: '??' }],
    ['unknown kind', ledgerRow(2, 'Bonus', 100000, 'Matched')],
  ]) {
    await t.test(name, async () => {
      const { rig, result } = await prepared([ledgerRow(1, 'Advance', 250000, 'Matched'), row]);
      assertOneRefusal(rig, result, 'source-invalid');
    });
  }
  // two bankless forfeits never collide as a "reused UTR"
  const { result } = await prepared([ledgerRow(1, 'Advance', 250000, 'Matched'), forfeitRow(2, 50000), forfeitRow(3, 50000, 'Pending')]);
  assert.equal(result.ok, true, JSON.stringify(result));
});

/* M18-S09-NOTE-8 (r7-idempotency): the replay guard and the per-allotment turn live in SharedState, so two instances
 * (one memory map two services share; two catalyst adapters over one fake backend) write one receipt, and the
 * stored answer holds no bank reference. Each instance is its own rig (its own CRM view): inserts are summed. */
const twoInstances = {
  memory: () => { const st = createMemoryState(); return { a: st, b: st }; },
  'fake catalyst': () => {
    const fake = createFakeCatalyst({ seed: 21 });
    const mk = () => createCatalystState(FAKE_CONFIG, { fetch: fake.fetch, sleep: async () => undefined });
    return { a: mk(), b: mk() };
  },
};
/** A state that remembers every value written through it. */
function spied(state, stored) {
  return { ...state, async set(key, value, ttl) { stored.push(String(value)); return state.set(key, value, ttl); } };
}
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

for (const [name, make] of Object.entries(twoInstances)) {
  test(`NOTE-8 (${name}): the same press on two instances writes one receipt; the stored answer carries no reference`, async () => {
    const { a, b } = make();
    const stored = [];
    const ra = createRig({ state: spied(a, stored), insertGate: pause(60) });
    const rb = createRig({ state: spied(b, stored), insertGate: pause(60) });
    const queued = command();
    const [left, right] = await Promise.all([ra.service.replay(principalFor(), queued), rb.service.replay(principalFor(), clone(queued))]);
    assert.equal(ra.insertCalls().length + rb.insertCalls().length, 1, 'one write across both instances');
    const won = [left, right].filter((r) => r.duplicate === false), joined = [left, right].filter((r) => r.duplicate === true);
    assert.equal(won.length, 1);
    assert.equal(joined.length, 1);
    assert.deepEqual(joined[0], { ok: true, receiptId: RECEIPT_ID, duplicate: true });
    assert.ok(stored.length >= 2, 'the guard stored its fingerprint and the answer');
    for (const v of stored) assert.ok(!/hdfc2609001/i.test(v), 'no bank reference in a stored value');
    assert.ok(stored.some((v) => v.includes(RECEIPT_ID)), 'the answer is the receipt id');
  });

  test(`NOTE-8 (${name}): two keys for one allotment take turns across instances`, async () => {
    const { a, b } = make();
    const release = deferred();
    const ra = createRig({ state: a, insertGate: release.promise });
    const rb = createRig({ state: b });
    const first = ra.service.replay(principalFor(), command());
    await waitUntil(() => ra.insertCalls().length === 1, 'the first press did not reach its insert');
    const second = rb.service.replay(principalFor(), command({ idempotencyKey: OTHER_IDEMPOTENCY_KEY, intent: { utr: 'ICIC2609002' } }));
    await pause(150);
    assert.equal(rb.sessionCalls(), 0, 'the other instance waits for the allotment turn and has read nothing');
    release.resolve();
    const [x, y] = await Promise.all([first, second]);
    assert.equal(x.ok, true);
    assert.equal(typeof y.ok, 'boolean', 'the second press is answered once the turn is free');
    assert.equal(rb.sessionCalls() > 0, true);
  });

  test(`NOTE-8 (${name}): a different press under the same key is refused as reused; a failure frees the key`, async () => {
    const { a, b } = make();
    const ra = createRig({ state: a });
    assert.equal((await ra.service.replay(principalFor(), command())).ok, true);
    const rb = createRig({ state: b });
    const other = await rb.service.replay(principalFor(), command({ intent: { amountRupees: 1 } }));
    assert.equal(other.reasonCode, 'idempotency-key-reused');
    assert.equal(rb.insertCalls().length, 0);
    const down = createRig({ state: make().a, sessionThrows: [true, false] });
    assert.equal((await down.service.replay(principalFor(), command())).ok, false);
    assert.equal((await down.service.replay(principalFor(), command())).ok, true, 'a source failure is not kept; the same key goes again');
  });
}
