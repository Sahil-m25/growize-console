/* M12-S04..S08 — THE ZOHO SIGN CHAIN: send, live status (webhook, remind, recall, periodic check), filing the signed
 * copy, block/supersede, and the investor app's embedded signing.
 *
 * Run from console/: node --test src/server/zoho-sign/sign-chain.test.cjs
 * Replays recorded (synthetic) Zoho CRM and Zoho Sign responses from __fixtures__/sign. No request reaches Zoho.
 */
'use strict';

const assert = require('node:assert/strict');
const { createHmac, randomUUID } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { before, test } = require('node:test');

const consoleRoot = path.resolve(__dirname, '..', '..', '..');
const srcRoot = path.join(consoleRoot, 'src');
const fx = path.join(srcRoot, 'lib', 'zoho', '__fixtures__', 'sign');
const contractsDir = path.resolve(consoleRoot, '..', 'contracts');
const ts = require(path.join(consoleRoot, 'node_modules', 'typescript'));
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoho-sign-chain-'));
process.on('exit', () => fs.rmSync(outDir, { recursive: true, force: true }));
const config = ts.readConfigFile(path.join(consoleRoot, 'tsconfig.json'), ts.sys.readFile);
const project = ts.parseJsonConfigFileContent(config.config, ts.sys, consoleRoot);
const options = { ...project.options, incremental: false, tsBuildInfoFile: undefined, plugins: undefined,
  module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10, noEmit: false, noEmitOnError: true, outDir, rootDir: srcRoot };
const program = ts.createProgram(['api', 'papers', 'send', 'file', 'actions', 'block', 'embed', 'webhook', 'status'].map((f) => path.join(srcRoot, 'server', 'zoho-sign', f + '.ts'))
  .concat([path.join(srcRoot, 'server', 'contracts', 'stub.ts'), path.join(srcRoot, 'server', 'access', 'guard-core.ts')]), options);
const diagnostics = [...ts.getPreEmitDiagnostics(program), ...program.emit().diagnostics];
if (diagnostics.length) {
  console.error(ts.formatDiagnostics(diagnostics, { getCanonicalFileName: (f) => f, getCurrentDirectory: () => consoleRoot, getNewLine: () => '\n' }));
  process.exit(1);
}
const Module = require('node:module');
process.env.NODE_PATH = path.join(consoleRoot, 'node_modules');
Module._initPaths();
const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  return resolveFilename.call(this, request.startsWith('@/') ? path.join(outDir, request.slice(2)) : request, ...rest);
};
const load = (f) => require(path.join(outDir, f));
const { createMemorySink, createOpsLog } = load('lib/zoho/log.js');
const { createZohoClient, createZohoServiceClient, userCredential, serviceCredential } = load('lib/zoho/client.js');
const { createSignApi, EMBED_URL_TTL_MS } = load('server/zoho-sign/api.js');
const { createSignSender } = load('server/zoho-sign/send.js');
const { createSignedFiler, createHandVerifier } = load('server/zoho-sign/file.js');
const { createSignActions, createOpenRequestCheck } = load('server/zoho-sign/actions.js');
const { createPaperBlocker, NOTHING_CAME_BACK } = load('server/zoho-sign/block.js');
const { createEmbedEndpoint } = load('server/zoho-sign/embed.js');
const { handleZohoSignWebhook, webhookEventKey } = load('server/zoho-sign/webhook.js');
const { PAPER_FIELDS, signStateOf } = load('server/zoho-sign/papers.js');
const { createSignStatusReader } = load('server/zoho-sign/status.js');
const { loadSchemas, createInProcessStub } = load('server/contracts/stub.js');
const { sign: hmacHex } = load('server/contracts/events.js');
const { apiRuleOf } = load('server/access/guard-core.js');

const P = '9007199254';
const HARSHA = `${P}740993002`, LATHA = `${P}740993903`, SAHIL = `${P}740993900`, KAMU = `${P}740994001`;
const ALLOT = `${P}740999401`, KIRAN = `${P}740997101`, JOSEPH = `${P}740997209`;
const REQ = '90071992547409981', REQ2 = '90071992547409982', TPL = '90071992547409970';
const NOW = Date.parse('2026-09-28T06:00:00Z');
const MOD = '2026-09-27T09:30:00+05:30';
const PII = ['kiran.fixture@example.invalid', 'joseph.fixture@example.invalid', 'Synthetic Kiran', 'SYNTHETIC-ONE-TIME-TOKEN', 'synthetic-', 'wrong unit count'];

const rec = (name) => JSON.parse(fs.readFileSync(path.join(fx, `${name}.response.json`), 'utf8'));
const toResponse = (r) => new Response(r.status === 204 ? null : (r.text !== undefined ? r.text : JSON.stringify(r.body)), { status: r.status, headers: r.headers || {} });
const immediateGate = () => ({ async acquire() { return { waitedMs: 0, release() {} }; }, async run(_c, t) { return t(); }, snapshot() { return {}; } });
const creds = new Map();
let svc;
before(async () => {
  for (const id of [HARSHA, LATHA, SAHIL, KAMU]) creds.set(id, await userCredential({ access_token: `synthetic-${id}`, api_domain: 'https://www.zohoapis.in', expires_in: 3_600 },
    { recordIdPrefix: P, gate: immediateGate(), log: createOpsLog(createMemorySink()), clock: () => NOW,
      fetch: async () => toResponse({ status: 200, body: { users: [{ id, status: 'active' }] } }) }));
  svc = serviceCredential('provider-callback', { access_token: 'synthetic-service-token', api_domain: 'https://www.zohoapis.in', expires_in: 3_600 }, NOW);
});
const who = (id, seat) => ({ credential: creds.get(id), seat });

/** One rig: a CRM client (user or service) and the Sign adapter, both answering from `route(call)`. */
function rig(route, { service = false } = {}) {
  const calls = [];
  const sink = createMemorySink();
  const log = createOpsLog(sink);
  const fetchOf = (host) => async (url, init) => {
    const u = decodeURIComponent(String(url));
    let body = init.body;
    const q = host === 'crm' && typeof body === 'string' && body.startsWith('{') ? (JSON.parse(body).select_query ?? null) : null;
    const c = { host, method: init.method, url: u, q, headers: init.headers, body: typeof body === 'string' ? body : body ? Buffer.from(body).toString('latin1') : null };
    calls.push(c);
    const r = await route(c);
    if (!r) throw new Error('unrouted ' + host + ' ' + c.method + ' ' + c.url);
    return toResponse(typeof r === 'string' ? rec(r) : r);
  };
  const mk = service ? createZohoServiceClient : createZohoClient;
  const crm = mk({ recordIdPrefix: P, gate: immediateGate(), log, maxAttempts: 1, clock: () => NOW, fetch: fetchOf('crm') });
  const sign = createSignApi({ origin: 'https://sign.zoho.in', gate: immediateGate(), log, maxAttempts: 1, clock: () => NOW, fetch: fetchOf('sign'), sleep: async () => {} });
  return { calls, sink, log, crm, sign, logText: () => JSON.stringify(sink.records()) };
}
const signCalls = (r, re) => r.calls.filter((c) => c.host === 'sign' && re.test(c.method + ' ' + c.url));
const crmWrites = (r) => r.calls.filter((c) => c.host === 'crm' && (c.method === 'PUT' || (c.method === 'POST' && !c.q) || c.method === 'DELETE'));
const noPii = (r) => { const t = r.logText(); for (const m of PII) assert.ok(!t.includes(m), `Plane B holds ${m}`); };
const K1 = 'send-press-000000000001', K2 = 'send-press-000000000002';

/* Common CRM routes for the allotment → Contact read. */
const readRoutes = (allot, contact = 'crm.contact.kiran') => (c) => {
  if (c.host === 'crm' && c.method === 'GET' && c.url.includes(`/LLP_UnitAllocation_Module/${ALLOT}`) && !c.url.includes('Attachments')) return allot;
  if (c.host === 'crm' && c.method === 'GET' && c.url.includes('/Contacts/')) return contact;
  return null;
};

/* ================================ M12-S04 send ================================ */

test('S04 AC1/AC6: Harsha sends the supplementary template with Aadhaar eSign — one Sign request, one guarded record write (id + method), on her own token', async () => {
  const r = rig((c) => readRoutes('crm.allotment.kiran-fresh')(c)
    || (c.host === 'sign' && c.method === 'GET' && c.url.endsWith(`/templates/${TPL}`) ? 'sign.template' : null)
    || (c.host === 'sign' && c.method === 'POST' && c.url.endsWith(`/templates/${TPL}/createdocument`) ? 'sign.createdocument' : null)
    || (c.host === 'crm' && c.method === 'PUT' ? 'crm.update.ok' : null));
  const sender = createSignSender({ crm: r.crm, sign: r.sign, log: r.log, clock: () => NOW });
  const input = { paper: 'supplementary', recordId: ALLOT, method: 'aadhaar', source: { kind: 'template', templateId: TPL }, expectedModifiedTime: MOD };
  const res = await sender.commit(who(HARSHA, 'fin'), input, K1);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.value.requestId, REQ);
  assert.equal(res.value.label, 'Out for signature — the IR is chasing');
  assert.equal(res.value.signedVia, 'Zoho Sign - Aadhaar');
  const create = signCalls(r, /createdocument/)[0];
  assert.equal(create.headers.Authorization, `Zoho-oauthtoken synthetic-${HARSHA}`, 'Zoho Sign records Harsha as the sender (D53)');
  const data = JSON.parse(new URLSearchParams(create.body).get('data'));
  assert.equal(data.templates.actions[0].recipient_email, 'kiran.fixture@example.invalid', 'recipient prefilled from the Contact');
  assert.equal(new URLSearchParams(create.body).get('is_quicksend'), 'true');
  const puts = r.calls.filter((c) => c.method === 'PUT');
  assert.equal(puts.length, 1, 'one save');
  assert.deepEqual(JSON.parse(puts[0].body).data[0], { Supplementary_Sign_Req_Id: REQ, Supplementary_Signed_Via: 'Zoho Sign - Aadhaar' });
  assert.ok(Object.entries(puts[0].headers).some(([k, v]) => k.toLowerCase() === 'if-unmodified-since' && v), 'guarded write');
  // double press, same key: the first answer, nothing sent twice
  const again = await sender.commit(who(HARSHA, 'fin'), input, K1);
  assert.equal(again.ok, true);
  assert.equal(again.value.duplicate, true);
  assert.equal(signCalls(r, /createdocument/).length, 1);
  noPii(r);
});

test('S04 template picker: the templates come from Zoho Sign on the sender\'s own token — ids and names, bad rows dropped; a seat that sends nothing is refused before any call', async () => {
  const r = rig((c) => (c.host === 'sign' && c.method === 'GET' && c.url.includes('/api/v1/templates?data=') ? 'sign.templates.list' : null));
  const sender = createSignSender({ crm: r.crm, sign: r.sign, log: r.log, clock: () => NOW });
  const ok = await sender.templates(who(HARSHA, 'fin'));
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.deepEqual(ok.value.map((t) => [t.templateId, t.name]), [[TPL, 'Synthetic supplementary'], ['90071992547409971', 'Synthetic allocation letter']]);
  const call = signCalls(r, /templates\?data=/)[0];
  assert.equal(call.headers.Authorization, `Zoho-oauthtoken synthetic-${HARSHA}`, 'her own token (D53)');
  const data = JSON.parse(new URL(call.url).searchParams.get('data'));
  assert.equal(data.page_context.sort_column, 'template_name');
  const none = rig(() => null);
  const refused = await createSignSender({ crm: none.crm, sign: none.sign, log: none.log, clock: () => NOW }).templates(who(LATHA, 'audit'));
  assert.equal(refused.ok, false);
  assert.equal(refused.reasonCode, 'seat-denied');
  assert.equal(none.calls.length, 0);
  noPii(r);
});

test('B-19: Sign refusing the person\'s own token answers code not-configured with words that say so; a server fault stays "not answering" with its own code', async () => {
  const r = rig(() => null);
  const down = (kind) => createSignSender({ crm: r.crm, sign: { listTemplates: async () => ({ ok: false, error: { kind, status: kind === 'forbidden' ? 403 : 500, code: '' } }) }, log: r.log, clock: () => NOW });
  const refused = await down('forbidden').templates(who(HARSHA, 'fin'));
  assert.deepEqual([refused.ok, refused.kind, refused.reasonCode], [false, 'source-error', 'not-configured']);
  assert.doesNotMatch(refused.message, /not answering/i);
  assert.match(refused.message, /not connected/i);
  const faulted = await down('server').templates(who(HARSHA, 'fin'));
  assert.deepEqual([faulted.reasonCode, /not answering/i.test(faulted.message)], ['server', true]);
  const unwired = await createSignSender({ crm: r.crm, sign: {}, log: r.log, clock: () => NOW }).templates(who(HARSHA, 'fin'));
  assert.deepEqual([unwired.reasonCode, /not answering/i.test(unwired.message)], ['not-configured', false]);
});

test('S04 AC2/AC4: the send panel prefills name and email from the Contact; for an NRI only email OTP is offered, with the reason', async () => {
  const r = rig((c) => (c.host === 'crm' && c.url.includes(`/Contacts/${JOSEPH}`) ? 'crm.contact.joseph-nri' : null)
    || (c.host === 'sign' && c.method === 'GET' && c.url.endsWith(`/requests/${REQ2}`) ? 'sign.get.joseph-inprogress' : null));
  const sender = createSignSender({ crm: r.crm, sign: r.sign, log: r.log, clock: () => NOW });
  const p = await sender.prefill(who(HARSHA, 'fin'), 'fema', JOSEPH);
  assert.equal(p.ok, true, JSON.stringify(p));
  assert.deepEqual(p.value.recipient, { name: 'Synthetic Joseph', email: 'joseph.fixture@example.invalid' });
  assert.equal(p.value.nri, true);
  assert.deepEqual([...p.value.methods], ['email-otp']);
  assert.match(p.value.methodNote, /NRI.*Aadhaar linked to a live Indian mobile/);
  assert.equal(p.value.current.state, 'sent');
  assert.equal(p.value.maySend, false, 'a request is already out');
});

test('S04 AC4: Aadhaar eSign to an NRI is refused in-page and nothing is sent', async () => {
  const fresh = rec('crm.contact.joseph-nri'); fresh.body.data[0].FEMA_Sign_Req_Id = null;
  const r = rig((c) => (c.host === 'crm' && c.url.includes(`/Contacts/${JOSEPH}`) ? fresh : null));
  const sender = createSignSender({ crm: r.crm, sign: r.sign, log: r.log, clock: () => NOW });
  const res = await sender.commit(who(HARSHA, 'fin'), { paper: 'fema', recordId: JOSEPH, method: 'aadhaar', source: { kind: 'template', templateId: TPL }, expectedModifiedTime: MOD }, K1);
  assert.equal(res.ok, false);
  assert.equal(res.reasonCode, 'aadhaar-not-for-nri');
  assert.match(res.message, /NRI/);
  assert.equal(signCalls(r, /POST/).length, 0);
  assert.equal(crmWrites(r).length, 0);
});

test('S04 AC5: a live request for the same paper refuses and names it; a verified one is "already on file"; nothing is sent', async () => {
  const r = rig((c) => readRoutes('crm.allotment.kiran-out')(c) || (c.host === 'sign' && c.method === 'GET' && c.url.endsWith(`/requests/${REQ}`) ? 'sign.get.viewed' : null));
  const sender = createSignSender({ crm: r.crm, sign: r.sign, log: r.log, clock: () => NOW });
  const input = { paper: 'supplementary', recordId: ALLOT, method: 'email-otp', source: { kind: 'template', templateId: TPL }, expectedModifiedTime: MOD };
  const res = await sender.commit(who(HARSHA, 'fin'), input, K1);
  assert.equal(res.reasonCode, 'already-out');
  assert.equal(res.requestId, REQ);
  assert.equal(signCalls(r, /POST/).length, 0);
  const v = rig(readRoutes('crm.allotment.kiran-verified'));
  const res2 = await createSignSender({ crm: v.crm, sign: v.sign, log: v.log }).commit(who(HARSHA, 'fin'), input, K2);
  assert.equal(res2.reasonCode, 'already-on-file');
  // a declined request may be replaced
  const d = rig((c) => readRoutes('crm.allotment.kiran-out')(c) || (c.host === 'sign' && c.method === 'GET' && c.url.endsWith(`/requests/${REQ}`) ? 'sign.get.declined' : null)
    || (c.host === 'sign' && c.url.endsWith(`/templates/${TPL}`) ? 'sign.template' : null) || (c.host === 'sign' && c.url.endsWith('/createdocument') ? 'sign.createdocument' : null)
    || (c.host === 'crm' && c.method === 'PUT' ? 'crm.update.ok' : null));
  const res3 = await createSignSender({ crm: d.crm, sign: d.sign, log: d.log }).commit(who(HARSHA, 'fin'), input, K2);
  assert.equal(res3.ok, true);
});

test('S04 AC7/AC8: an auditor, a viewer or a KAM is told sending belongs to Finance; the super user may send and is told Finance is the primary doer', async () => {
  const r = rig((c) => readRoutes('crm.allotment.kiran-fresh')(c) || (c.host === 'sign' && c.url.endsWith(`/templates/${TPL}`) ? 'sign.template' : null)
    || (c.host === 'sign' && c.url.endsWith('/createdocument') ? 'sign.createdocument' : null) || (c.host === 'crm' && c.method === 'PUT' ? 'crm.update.ok' : null));
  const sender = createSignSender({ crm: r.crm, sign: r.sign, log: r.log, clock: () => NOW });
  const input = { paper: 'supplementary', recordId: ALLOT, method: 'email-otp', source: { kind: 'template', templateId: TPL }, expectedModifiedTime: MOD };
  for (const [id, seat] of [[LATHA, 'audit'], [LATHA, 'exec'], [KAMU, 'kam'], [KAMU, 'ir']]) {
    const res = await sender.commit(who(id, seat), input, K1);
    assert.equal(res.reasonCode, 'seat-denied', seat);
    assert.equal(res.message, 'Sending belongs to Finance Operations, Compliance and the Head of Finance.');
    const p = await sender.prefill(who(id, seat), 'supplementary', ALLOT);
    assert.equal(p.reasonCode, 'seat-denied');
  }
  assert.equal(r.calls.length, 0, 'refused before any Zoho call');
  const su = await sender.commit(who(SAHIL, 'di'), input, K2);
  assert.equal(su.ok, true, JSON.stringify(su));
  assert.match(su.value.note, /Finance is the primary doer/);
});

test('S04 T04: the record write fails → the new request is recalled at once (compensating step) and the answer is "Not saved yet" / record-changed', async () => {
  for (const [put, expect] of [['crm.update.conflict', 'record-changed'], ['crm.update.server-error', 'not-saved']]) {
    const r = rig((c) => readRoutes('crm.allotment.kiran-fresh')(c) || (c.host === 'sign' && c.url.endsWith(`/templates/${TPL}`) ? 'sign.template' : null)
      || (c.host === 'sign' && c.url.endsWith('/createdocument') ? 'sign.createdocument' : null) || (c.host === 'sign' && c.url.endsWith(`/requests/${REQ}/recall`) ? 'sign.recall' : null)
      || (c.host === 'crm' && c.method === 'PUT' ? put : null));
    const res = await createSignSender({ crm: r.crm, sign: r.sign, log: r.log, clock: () => NOW })
      .commit(who(HARSHA, 'fin'), { paper: 'supplementary', recordId: ALLOT, method: 'email-otp', source: { kind: 'template', templateId: TPL }, expectedModifiedTime: MOD }, K1);
    assert.equal(res.ok, false);
    if (expect === 'record-changed') assert.equal(res.reasonCode, 'record-changed');
    else { assert.equal(res.kind, 'not-saved'); assert.equal(res.message, 'Not saved yet'); assert.equal(res.recalled, true); }
    assert.equal(signCalls(r, /\/recall$/).length, 1, 'recalled');
    assert.match(r.logText(), /record-write-failed\.recalled/);
  }
});

test('S04 AC3: an uploaded PDF with the signature box Finance placed — create (multipart) then submit with the field; Aadhaar on a PDF is refused', async () => {
  const r = rig((c) => readRoutes('crm.allotment.kiran-fresh')(c) || (c.host === 'sign' && c.method === 'POST' && c.url.endsWith('/api/v1/requests') ? 'sign.requests.created' : null)
    || (c.host === 'sign' && c.url.endsWith(`/requests/${REQ}/submit`) ? 'sign.submit' : null) || (c.host === 'crm' && c.method === 'PUT' ? 'crm.update.ok' : null));
  const sender = createSignSender({ crm: r.crm, sign: r.sign, log: r.log, clock: () => NOW });
  const pdf = () => { const b = new Uint8Array(300); b.set([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]); return b; };
  const bytes = pdf();
  const res = await sender.commit(who(HARSHA, 'fin'), { paper: 'supplementary', recordId: ALLOT, method: 'email-otp', expectedModifiedTime: MOD,
    source: { kind: 'pdf', fileName: 'Supplementary.pdf', bytes, field: { page: 2, x: 100, y: 600, width: 180, height: 40 } } }, K1);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.ok(bytes.every((b) => b === 0), 'the PDF bytes are zeroed');
  const up = signCalls(r, /POST .*\/api\/v1\/requests$/)[0];
  assert.match(up.headers['Content-Type'], /^multipart\/form-data; boundary=/);
  const sub = JSON.parse(new URLSearchParams(signCalls(r, /\/submit$/)[0].body).get('data'));
  assert.deepEqual({ ...sub.requests.actions[0].fields[0] }, { field_type_name: 'Signature', field_category: 'image', document_id: '90071992547409995', action_id: '90071992547409991', page_no: 2, x_coord: 100, y_coord: 600, abs_width: 180, abs_height: 40, is_mandatory: true });
  assert.equal(sub.requests.actions[0].verification_type, 'EMAIL');
  const a = await createSignSender({ crm: r.crm, sign: r.sign, log: r.log }).commit(who(HARSHA, 'fin'), { paper: 'allocation-letter', recordId: ALLOT, method: 'aadhaar', expectedModifiedTime: MOD,
    source: { kind: 'pdf', fileName: 'x.pdf', bytes: pdf(), field: { page: 0, x: 1, y: 1, width: 10, height: 10 } } }, K2);
  assert.equal(a.reasonCode, 'aadhaar-needs-template');
});

/* ================================ M12-S05 live status ================================ */

const SECRET = 'synthetic-webhook-secret-2026';
const hmacB64 = (body) => createHmac('sha256', SECRET).update(body, 'utf8').digest('base64');
const webhookDeps = (over = {}) => {
  const sink = createMemorySink();
  const log = createOpsLog(sink);
  const dead = [];
  const seenKeys = new Set();
  const status = over.status ?? 'completed';
  const d = {
    secrets: [SECRET], log, sink, dead,
    credential: async () => svc, invalidateCredential: () => {},
    sign: { async getRequest() { return { ok: true, value: { requestId: REQ, status, actionTime: null, modifiedTime: null, documentIds: [] }, status: 200, creditsRemaining: null }; } },
    crm: { async search(_c, module, q) {
      const hit = module === 'LLP_UnitAllocation_Module' && q.criteria.includes('Supplementary_Sign_Req_Id');
      return { ok: true, value: { records: hit ? [{ id: ALLOT, Supplementary_Sign_Req_Id: REQ }] : [], moreRecords: false }, status: 200, creditsRemaining: null };
    } },
    seen: { has: async (k) => seenKeys.has(k), add: async (k) => { seenKeys.add(k); } },
    deadLetter: (e) => dead.push(e),
    ...over.extra,
  };
  return d;
};

test('S05 AC1 (TC-IM07-017): a callback with a bad HMAC is refused, dead-lettered with no request id, logged in Plane B, and nothing is read or written', async () => {
  const d = webhookDeps();
  let reads = 0;
  d.sign = { async getRequest() { reads++; } };
  const body = fs.readFileSync(path.join(fx, 'webhook.completed.json'), 'utf8');
  const r = await handleZohoSignWebhook({ body, signature: hmacB64(body + ' ') }, d);
  assert.deepEqual(r, { ok: false, kind: 'invalid-signature', retryable: false });
  assert.equal(reads, 0);
  assert.equal(d.dead.length, 1);
  assert.equal(d.dead[0].reason, 'invalid-signature');
  assert.equal(d.dead[0].requestId, null);
  assert.match(JSON.stringify(d.sink.records()), /invalid-signature/);
});

test('S05 AC2: a valid callback is re-read from Zoho Sign; the same event again is ignored (dedupe on request + operation + time)', async () => {
  const d = webhookDeps({ status: 'declined' });
  let reads = 0;
  const inner = d.sign.getRequest; d.sign = { async getRequest(...a) { reads++; return inner(...a); } };
  const body = fs.readFileSync(path.join(fx, 'webhook.declined.json'), 'utf8');
  const first = await handleZohoSignWebhook({ body, signature: hmacB64(body) }, d);
  assert.equal(first.ok, true);
  assert.equal(first.outcome, 'observed', 'declined lives in Zoho Sign (D77): nothing to write');
  const again = await handleZohoSignWebhook({ body, signature: hmacB64(body) }, d);
  assert.equal(again.outcome, 'duplicate');
  assert.equal(reads, 1);
  assert.notEqual(webhookEventKey(body, REQ), webhookEventKey(fs.readFileSync(path.join(fx, 'webhook.completed.json'), 'utf8'), REQ));
});

test('S05/S06: a completed callback files the signed copy through the filer; a failed filing dead-letters and is not marked seen (redelivery retries)', async () => {
  let calls = 0, fail = true;
  const d = webhookDeps({ extra: { file: async (c, target, requestId) => {
    calls++;
    assert.equal(c, svc); assert.deepEqual({ ...target }, { module: 'LLP_UnitAllocation_Module', id: ALLOT, paper: 'supplementary' }); assert.equal(requestId, REQ);
    return fail ? { ok: false, kind: 'not-saved', step: 'set-signed', errorKind: 'server', compensated: true, retryable: true } : { ok: true, outcome: 'filed', attachmentId: `${P}740999601` };
  } } });
  const body = fs.readFileSync(path.join(fx, 'webhook.completed.json'), 'utf8');
  const r1 = await handleZohoSignWebhook({ body, signature: hmacB64(body) }, d);
  assert.deepEqual(r1, { ok: false, kind: 'file-failed', retryable: true });
  assert.equal(d.dead.at(-1).requestId, REQ);
  fail = false;
  const r2 = await handleZohoSignWebhook({ body, signature: hmacB64(body) }, d);
  assert.equal(r2.outcome, 'filed');
  assert.equal(calls, 2);
});

test('S05 AC3/AC4: the row state comes from Zoho Sign — Viewed once the investor opens it, Declined with the reason', async () => {
  const r = rig((c) => (c.url.endsWith(`/requests/${REQ}`) ? (c.headers.Authorization.includes('service') ? 'sign.get.declined' : 'sign.get.viewed') : null));
  const viewed = await r.sign.getRequest(creds.get(HARSHA), REQ);
  assert.equal(signStateOf(viewed.value), 'viewed');
  const declined = await r.sign.getRequest(svc, REQ);
  assert.equal(signStateOf(declined.value), 'declined');
  assert.equal(declined.value.declineReason, 'Synthetic: wrong unit count');
  noPii(r);
});

test('S05 AC5/AC6: remind and recall go through Zoho Sign on the person\'s token; a recall needs a reason, kept as a Zoho Note', async () => {
  const r = rig((c) => readRoutes('crm.allotment.kiran-out')(c) || (c.host === 'sign' && c.method === 'GET' ? 'sign.get.inprogress' : null)
    || (c.url.endsWith('/remind') ? 'sign.remind' : null) || (c.url.endsWith('/recall') ? 'sign.recall' : null) || (c.host === 'crm' && c.url.endsWith('/Notes') ? 'crm.notes.ok' : null));
  const a = createSignActions({ crm: r.crm, sign: r.sign, log: r.log, clock: () => NOW });
  const rem = await a.remind(who(HARSHA, 'fin'), 'supplementary', ALLOT);
  assert.equal(rem.ok, true, JSON.stringify(rem));
  assert.equal(rem.value.at, NOW);
  assert.equal(signCalls(r, /\/remind$/)[0].headers.Authorization, `Zoho-oauthtoken synthetic-${HARSHA}`);
  const noReason = await a.recall(who(HARSHA, 'fin'), 'supplementary', ALLOT, '  ');
  assert.equal(noReason.reasonCode, 'reason-required');
  assert.equal(signCalls(r, /\/recall$/).length, 0);
  const rc = await a.recall(who(HARSHA, 'fin'), 'supplementary', ALLOT, 'Wrong unit count on page 2');
  assert.equal(rc.ok, true);
  assert.equal(rc.value.label, 'Recalled');
  assert.equal(rc.value.noteSaved, true);
  const note = JSON.parse(r.calls.find((c) => c.url.endsWith('/Notes')).body).data[0];
  assert.equal(note.Note_Content, 'Reason: Wrong unit count on page 2');
  assert.deepEqual(note.Parent_Id, { module: { api_name: 'LLP_UnitAllocation_Module' }, id: ALLOT });
  assert.ok(!r.logText().includes('Wrong unit count'), 'the reason never enters a log');
  const viewer = await a.remind(who(LATHA, 'audit'), 'supplementary', ALLOT);
  assert.equal(viewer.reasonCode, 'seat-denied');
});

test('S05 AC7 (TC-IM07-018): the periodic check re-reads open requests under the service token and files a completed one', async () => {
  const r = rig((c) => (c.host === 'crm' && c.q ? (c.q.includes('from LLP_UnitAllocation_Module') && c.q.includes('Supplementary_Sign_Req_Id') ? 'crm.coql.open-one' : 'crm.coql.none') : null)
    || (c.host === 'sign' && c.url.endsWith(`/requests/${REQ}`) ? 'sign.get.completed' : null), { service: true });
  const filed = [];
  const check = createOpenRequestCheck({ crm: r.crm, sign: r.sign, log: r.log, clock: () => NOW,
    filer: { file: async (c, t, id) => { filed.push([t.id, t.paper, id]); return { ok: true, outcome: 'filed', attachmentId: null }; } } });
  const out = await check.run(svc);
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.report.checked, 1);
  assert.equal(out.report.filed, 1);
  assert.deepEqual(filed, [[ALLOT, 'supplementary', REQ]]);
  for (const q of r.calls.filter((c) => c.q)) assert.match(q.q, /is not null and \w+_Verified_At is null\) order by id asc limit \d+, 200$/);
  assert.match(r.logText(), /checked-1\.filed-1\.failed-0/);
});

test('S05: the per-viewer status reader (documents/list signStatus) reads Zoho Sign on the viewer\'s token; a completed request reads signed', async () => {
  const r = rig((c) => (c.url.endsWith(`/requests/${REQ}`) ? 'sign.get.completed' : c.url.endsWith(`/requests/${REQ2}`) ? 'sign.get.not-found' : null));
  const m = await createSignStatusReader(r.sign)(creds.get(HARSHA), [REQ, REQ2, REQ]);
  assert.equal(m.size, 1);
  assert.equal(m.get(REQ).status, 'completed');
  assert.equal(signCalls(r, /GET/).length, 2);
  assert.ok(signCalls(r, /GET/).every((c) => c.headers.Authorization === `Zoho-oauthtoken synthetic-${HARSHA}`));
});

/* ================================ M12-S06 filing ================================ */

const fileRoutes = (put, extra = () => null) => (c) => extra(c)
  || (c.host === 'crm' && c.method === 'GET' && c.url.includes(`/LLP_UnitAllocation_Module/${ALLOT}`) ? 'crm.allotment.kiran-out' : null)
  || (c.host === 'sign' && c.url.endsWith(`/requests/${REQ}/pdf`) ? 'sign.pdf' : null)
  || (c.host === 'sign' && c.url.endsWith(`/requests/${REQ}/completioncertificate`) ? 'sign.certificate' : null)
  || (c.host === 'crm' && c.method === 'POST' && c.url.endsWith('/Attachments') ? 'crm.attachment.ok' : null)
  || (c.host === 'crm' && c.method === 'POST' && c.url.endsWith('/files') ? 'crm.files.ok' : null)
  || (c.host === 'crm' && c.method === 'DELETE' ? 'crm.attachment.delete-ok' : null)
  || (c.host === 'crm' && c.method === 'PUT' ? put : null);

test('S06 AC1/AC3: completed → the certificate attached, the signed PDF in the Supplementary_Agreement slot and Supplementary_Verified_At (Agreement_Signed) set in ONE guarded write', async () => {
  const r = rig(fileRoutes('crm.update.ok'), { service: true });
  const res = await createSignedFiler({ crm: r.crm, sign: r.sign, log: r.log, clock: () => NOW }).file(svc, { module: 'LLP_UnitAllocation_Module', id: ALLOT, paper: 'supplementary' }, REQ);
  assert.deepEqual(res, { ok: true, outcome: 'filed', attachmentId: `${P}740999601` });
  const puts = r.calls.filter((c) => c.method === 'PUT');
  assert.equal(puts.length, 1);
  const data = JSON.parse(puts[0].body).data[0];
  assert.deepEqual(data.Supplementary_Agreement, [{ file_id: 'b1f5c0ffee0000000000000000000000000000000000000000000000000001' }]);
  assert.equal(data.Supplementary_Verified_At, '2026-09-28T11:30:00+05:30');
  assert.equal(signCalls(r, /\/pdf$/)[0].headers.Authorization, 'Zoho-oauthtoken synthetic-service-token');
  assert.ok(!r.logText().includes('synthetic signed agreement'));
});

test('S06 AC2: the signed-stamp write fails → the certificate attachment is deleted (compensating step), nothing looks verified, "Not saved yet" and retryable', async () => {
  const r = rig(fileRoutes('crm.update.server-error'), { service: true });
  const res = await createSignedFiler({ crm: r.crm, sign: r.sign, log: r.log, clock: () => NOW }).file(svc, { module: 'LLP_UnitAllocation_Module', id: ALLOT, paper: 'supplementary' }, REQ);
  assert.equal(res.ok, false);
  assert.equal(res.kind, 'not-saved');
  assert.equal(res.step, 'set-signed');
  assert.equal(res.compensated, true);
  assert.equal(res.retryable, true);
  const del = r.calls.filter((c) => c.method === 'DELETE');
  assert.equal(del.length, 1);
  assert.ok(del[0].url.endsWith(`/LLP_UnitAllocation_Module/${ALLOT}/Attachments/${P}740999601`));
});

test('S06: an already-verified slot is a no-op; a record naming another request is stale and nothing is written; a multi-document zip is not filed', async () => {
  const v = rig(fileRoutes('crm.update.ok', (c) => (c.method === 'GET' && c.host === 'crm' ? 'crm.allotment.kiran-verified' : null)), { service: true });
  const done = await createSignedFiler({ crm: v.crm, sign: v.sign, log: v.log }).file(svc, { module: 'LLP_UnitAllocation_Module', id: ALLOT, paper: 'supplementary' }, REQ);
  assert.equal(done.outcome, 'already-filed');
  assert.equal(signCalls(v, /GET/).length, 0);
  const s = rig(fileRoutes('crm.update.ok'), { service: true });
  const stale = await createSignedFiler({ crm: s.crm, sign: s.sign, log: s.log }).file(svc, { module: 'LLP_UnitAllocation_Module', id: ALLOT, paper: 'supplementary' }, '90071992547409989');
  assert.equal(stale.kind, 'stale');
  assert.equal(crmWrites(s).length, 0);
  const z = rig(fileRoutes('crm.update.ok', (c) => (c.url.endsWith('/pdf') ? 'sign.pdf.zip' : null)), { service: true });
  const zip = await createSignedFiler({ crm: z.crm, sign: z.sign, log: z.log }).file(svc, { module: 'LLP_UnitAllocation_Module', id: ALLOT, paper: 'supplementary' }, REQ);
  assert.equal(zip.step, 'download-pdf');
  assert.equal(crmWrites(z).length, 0);
});

test('S06 AC4/AC6: paper signed outside Zoho Sign — verified by hand with a reference (Note), by Finance only, and only once the signed copy is in the slot', async () => {
  const r = rig((c) => (c.host === 'crm' && c.method === 'GET' ? 'crm.allotment.slot-filled' : null) || (c.method === 'PUT' ? 'crm.update.ok' : null) || (c.url.endsWith('/Notes') ? 'crm.notes.ok' : null));
  const hv = createHandVerifier({ crm: r.crm, log: r.log, clock: () => NOW });
  const i = { paper: 'supplementary', recordId: ALLOT, method: 'Class 3 DSC', reference: 'EMU-0109-90001', expectedModifiedTime: MOD };
  const viewer = await hv.verify(who(LATHA, 'audit'), i);
  assert.equal(viewer.reasonCode, 'seat-denied');
  const ok = await hv.verify(who(HARSHA, 'fin'), i);
  assert.equal(ok.ok, true, JSON.stringify(ok));
  const put = JSON.parse(r.calls.find((c) => c.method === 'PUT').body).data[0];
  assert.deepEqual(put, { Supplementary_Verified_At: '2026-09-28T11:30:00+05:30', Supplementary_Verified_By: { id: HARSHA }, Supplementary_Signed_Via: 'Class 3 DSC' });
  assert.equal(JSON.parse(r.calls.find((c) => c.url.endsWith('/Notes')).body).data[0].Note_Content, 'Reference: EMU-0109-90001');
  const e = rig((c) => (c.host === 'crm' && c.method === 'GET' ? 'crm.allotment.slot-empty' : null));
  const empty = await createHandVerifier({ crm: e.crm, log: e.log }).verify(who(HARSHA, 'fin'), i);
  assert.equal(empty.reasonCode, 'no-signed-copy');
});

/* ================================ M12-S07 block ================================ */

test('S07 AC1: an out request — "Nothing has come back": recalled in Zoho Sign, the slot cleared in one guarded write, the reason kept as a Note', async () => {
  const r = rig((c) => (c.host === 'crm' && c.method === 'GET' && c.url.includes(`/Contacts/${JOSEPH}`) ? 'crm.contact.joseph-nri' : null)
    || (c.host === 'sign' && c.method === 'GET' ? 'sign.get.joseph-inprogress' : null) || (c.url.endsWith('/recall') ? 'sign.recall' : null)
    || (c.method === 'PUT' ? 'crm.update.contact-ok' : null) || (c.url.endsWith('/Notes') ? 'crm.notes.ok' : null));
  const b = createPaperBlocker({ crm: r.crm, sign: r.sign, log: r.log, clock: () => NOW });
  const res = await b.block(who(LATHA, 'comp'), { paper: 'fema', recordId: JOSEPH, reason: NOTHING_CAME_BACK, expectedModifiedTime: MOD });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.value.recalled, true);
  const put = JSON.parse(r.calls.find((c) => c.method === 'PUT').body).data[0];
  assert.deepEqual(put, { FEMA_Sign_Req_Id: null, FEMA_Signed_Via: null, FEMA_Verified_At: null, FEMA_Verified_By: null });
  assert.equal(JSON.parse(r.calls.find((c) => c.url.endsWith('/Notes')).body).data[0].Note_Content, 'Reason: Nothing has come back signed');
  const order = r.calls.filter((c) => c.method !== 'GET').map((c) => (c.url.endsWith('/recall') ? 'recall' : c.method === 'PUT' ? 'put' : 'note'));
  assert.deepEqual(order, ['recall', 'put', 'note']);
});

test('S07 AC2/AC3: a signed and verified supplementary is blocked — Agreement_Signed (Supplementary_Verified_At) cleared, so the lead\'s gate closes; no recall', async () => {
  const r = rig((c) => (c.host === 'crm' && c.method === 'GET' ? 'crm.allotment.kiran-verified' : null) || (c.method === 'PUT' ? 'crm.update.ok' : null) || (c.url.endsWith('/Notes') ? 'crm.notes.ok' : null));
  const res = await createPaperBlocker({ crm: r.crm, sign: r.sign, log: r.log, clock: () => NOW })
    .block(who(HARSHA, 'head'), { paper: 'supplementary', recordId: ALLOT, reason: 'Superseded by the corrected agreement', expectedModifiedTime: MOD });
  assert.equal(res.ok, true);
  assert.equal(res.value.wasVerified, true);
  assert.equal(res.value.gateCleared, true);
  assert.equal(res.value.recalled, false);
  assert.equal(signCalls(r, /./).length, 0);
  assert.equal(JSON.parse(r.calls.find((c) => c.method === 'PUT').body).data[0].Supplementary_Verified_At, null);
  assert.ok(!r.logText().includes('Superseded'));
});

test('S07 AC4: a KAM or a viewer cannot block; a reason is mandatory; a failed recall writes nothing', async () => {
  const r = rig((c) => readRoutes('crm.allotment.kiran-out')(c) || (c.host === 'sign' && c.method === 'GET' ? 'sign.get.inprogress' : null) || (c.url.endsWith('/recall') ? 'sign.recall.fail' : null));
  const b = createPaperBlocker({ crm: r.crm, sign: r.sign, log: r.log, clock: () => NOW });
  const i = { paper: 'supplementary', recordId: ALLOT, reason: 'Wrong', expectedModifiedTime: MOD };
  assert.equal((await b.block(who(KAMU, 'kam'), i)).reasonCode, 'seat-denied');
  assert.equal((await b.block(who(LATHA, 'audit'), i)).reasonCode, 'seat-denied');
  assert.equal((await b.block(who(HARSHA, 'fin'), { ...i, reason: '' })).reasonCode, 'reason-required');
  const failed = await b.block(who(HARSHA, 'fin'), { ...i, reason: 'Wrong unit count' });
  assert.equal(failed.kind, 'not-saved');
  assert.equal(r.calls.filter((c) => c.method === 'PUT').length, 0);
});

/* ================================ M12-S08 embedded signing ================================ */

const KEY = 'synthetic-contract-key-0123456789abcdef0123456789';
const HOST = 'https://app.growize.example';
const embedEvent = (over = {}) => ({
  event_id: randomUUID(), type: 'sign.embed', schema_version: 1, occurred_at: '2026-09-28T11:30:00+05:30',
  actor: { kind: 'investor', investor_contact_id: JOSEPH }, ids: { investor_contact_id: JOSEPH, arl_code: 'ARL-INV-0209' },
  payload: { request_id: REQ2, host: HOST, app_user_id: 'b7c1e0e2-0000-4000-8000-000000000001' }, ...over,
});
function embedRig(routeExtra = () => null) {
  const r = rig((c) => routeExtra(c) || (c.host === 'crm' && c.method === 'GET' && c.url.includes(`/Contacts/${JOSEPH}`) ? 'crm.contact.joseph-nri' : null)
    || (c.host === 'sign' && c.method === 'GET' && c.url.endsWith(`/requests/${REQ2}`) ? 'sign.get.joseph-inprogress' : null)
    || (c.host === 'sign' && c.url.includes('/embedtoken') ? 'sign.embedtoken' : null)
    || (c.host === 'crm' && c.q ? 'crm.coql.none' : null), { service: true });
  const seen = new Set();
  const ep = createEmbedEndpoint({ schemas: loadSchemas(contractsDir), keys: [KEY], seen: { has: async (k) => seen.has(k), add: async (k) => { seen.add(k); } },
    allowedHosts: [HOST], crm: r.crm, sign: r.sign, credential: async () => svc, log: r.log, clock: () => NOW });
  return { r, ep, send: (e) => { const body = JSON.stringify(e); return ep.handle(body, hmacHex(body, KEY)); } };
}

test('S08 AC2/AC5: the matching recipient gets a one-time embedded URL valid 2 minutes; it is never logged', async () => {
  const { r, send } = embedRig();
  const res = await send(embedEvent());
  assert.equal(res.status, 200, JSON.stringify(res));
  assert.match(res.signUrl, /^https:\/\/sign\.zoho\.in\//);
  assert.equal(res.expiresAt, NOW + EMBED_URL_TTL_MS);
  assert.equal(EMBED_URL_TTL_MS, 120_000);
  const call = signCalls(r, /embedtoken/)[0];
  assert.ok(call.url.endsWith(`/requests/${REQ2}/actions/90071992547409991/embedtoken`));
  assert.equal(new URLSearchParams(call.body).get('host'), HOST);
  noPii(r);
});

test('S08 AC3: anyone who is not the matching recipient is refused and logged — another Contact, a wrong ARL code, a request on someone else\'s paper, a bad signature, a foreign host, a replay', async () => {
  const { r, ep, send } = embedRig();
  assert.equal((await send(embedEvent({ actor: { kind: 'investor', investor_contact_id: KIRAN } }))).reason, 'wrong-identity');
  assert.equal((await send(embedEvent({ ids: { investor_contact_id: JOSEPH, arl_code: 'ARL-INV-0109' } }))).reason, 'arl-mismatch');
  assert.equal((await send(embedEvent({ payload: { request_id: REQ, host: HOST, app_user_id: 'u1' } }))).reason, 'not-your-request');
  assert.equal((await send(embedEvent({ payload: { request_id: REQ2, host: 'https://evil.example', app_user_id: 'u1' } }))).reason, 'host-not-allowed');
  const e = embedEvent(); const body = JSON.stringify(e);
  assert.equal((await ep.handle(body, hmacHex(body, 'another-key-0123456789abcdef0123456789'))).status, 401);
  assert.equal((await ep.handle(body, hmacHex(body, KEY))).status, 200);
  assert.deepEqual(await ep.handle(body, hmacHex(body, KEY)), { status: 409, reason: 'replayed' });
  assert.equal(signCalls(r, /embedtoken/).length, 1, 'one URL only');
  assert.match(r.logText(), /wrong-identity/);
  const someoneElse = rec('sign.get.joseph-inprogress'); someoneElse.body.requests.actions[0].recipient_email = 'kiran.fixture@example.invalid';
  const other = embedRig((c) => (c.host === 'sign' && c.method === 'GET' ? someoneElse : null));
  const wrongEmail = await other.send(embedEvent({ payload: { request_id: REQ2, host: HOST, app_user_id: 'u1' } }));
  assert.equal(wrongEmail.reason, 'not-recipient');
});

test('S08 AC1/AC4 (PROVISIONAL): a request created for the email path whose action Zoho will not embed answers 409 — the investor signs from the email', async () => {
  const { send } = embedRig((c) => (c.url.includes('/embedtoken') ? 'sign.embedtoken.not-embedded' : null));
  const res = await send(embedEvent());
  assert.deepEqual(res, { status: 409, reason: 'not-out' });
});

test('S08 T02: the sign.embed contract validates, and the stub receiver accepts it signed', async () => {
  const schemas = loadSchemas(contractsDir);
  assert.ok(schemas['sign.embed.json']);
  const stub = createInProcessStub({ schemas, keys: [KEY], clock: () => NOW });
  const e = embedEvent(); const body = JSON.stringify(e);
  const res = await stub.receiver.receive(body, hmacHex(body, KEY));
  assert.equal(res.status, 200, JSON.stringify(res));
  const bad = JSON.stringify({ ...e, event_id: randomUUID(), payload: { ...e.payload, extra: 1 } });
  assert.equal((await stub.receiver.receive(bad, hmacHex(bad, KEY))).status, 400);
});

test('routes: every new route is named in API_ROUTES and wrapped withErrorCapture(guardApi(...)); /api/sign/embed is open (HMAC)', () => {
  const api = path.join(srcRoot, 'app', 'api');
  for (const r of ['documents/sign/send', 'documents/sign/prefill', 'documents/sign/templates', 'documents/sign/remind', 'documents/sign/recall', 'documents/sign/block', 'documents/sign/verify', 'documents/sign/dead-letters', 'sign/embed', 'webhooks/zoho-sign']) {
    const src = fs.readFileSync(path.join(api, r, 'route.ts'), 'utf8');
    assert.ok(apiRuleOf('/api/' + r), r);
    assert.match(src, /export const (GET|POST) = withErrorCapture\(guardApi\(/, r);
  }
  assert.equal(apiRuleOf('/api/sign/embed').rule.kind, 'open');
  assert.equal(apiRuleOf('/api/documents/sign/send').key, '/api/documents');
  assert.equal(PAPER_FIELDS.supplementary.verifiedAt, 'Supplementary_Verified_At');
});

/* ============ M12-S12-NOTE-2: Finance's Send offers the agreed supplementary draft ============ */
const AGREED_LEAD = `${P}740996101`;
const ok200 = (rec1) => ({ status: 200, headers: { 'content-type': 'application/json' }, body: { data: [rec1] } });
const contactOf = (originLead) => { const c = rec('crm.contact.kiran'); c.body.data[0].Origin_Lead = originLead ? { id: originLead } : null; return c; };
const suppRig = (lead, contact = contactOf(AGREED_LEAD)) => {
  const r = rig((c) => readRoutes('crm.allotment.kiran-fresh', contact)(c)
    || (c.host === 'crm' && c.method === 'GET' && c.url.includes(`/Leads/${AGREED_LEAD}`) ? lead : null));
  return { r, sender: createSignSender({ crm: r.crm, sign: r.sign, log: r.log, clock: () => NOW }) };
};

test('M12-S12-NOTE-2: prefill of the supplementary carries the lead\'s agreed draft (ref, version, time) on the sender\'s own token', async () => {
  const { r, sender } = suppRig(ok200({ id: AGREED_LEAD, Supp_Agreed_Ref: 'https://workdrive.zoho.in/SUPP-L5-final', Supp_Agreed_Version: 2, Supp_Agreed_At: '2026-09-26T11:00:00+05:30' }));
  const p = await sender.prefill(who(HARSHA, 'fin'), 'supplementary', ALLOT);
  assert.equal(p.ok, true, JSON.stringify(p));
  assert.deepEqual(p.value.agreedDraft, { ref: 'https://workdrive.zoho.in/SUPP-L5-final', version: 2, at: '2026-09-26T11:00:00+05:30' });
  assert.equal(p.value.maySend, true);
  const leadRead = r.calls.find((c) => c.url.includes(`/Leads/${AGREED_LEAD}`));
  assert.match(leadRead.url, /Supp_Agreed_Ref/);
  assert.equal(leadRead.headers.Authorization ?? leadRead.headers.authorization, `Zoho-oauthtoken synthetic-${HARSHA}`, 'the sender\'s own token, never a service token');
  noPii(r);
  assert.equal(JSON.stringify(r.sink.records()).includes('SUPP-L5-final'), false, 'the draft link is never logged');
});

test('M12-S12-NOTE-2: an attachment ref is offered; a bad ref, an unagreed lead, an unreadable lead or no origin lead offers nothing', async () => {
  const att = await suppRig(ok200({ id: AGREED_LEAD, Supp_Agreed_Ref: `attachment:${P}740999502`, Supp_Agreed_Version: '1', Supp_Agreed_At: '2026-09-26T11:00:00+05:30' })).sender.prefill(who(HARSHA, 'fin'), 'supplementary', ALLOT);
  assert.deepEqual(att.value.agreedDraft, { ref: `attachment:${P}740999502`, version: 1, at: '2026-09-26T11:00:00+05:30' });
  for (const [name, lead, contact] of [
    ['javascript ref', ok200({ id: AGREED_LEAD, Supp_Agreed_Ref: 'javascript:alert(1)', Supp_Agreed_At: '2026-09-26T11:00:00+05:30' })],
    ['not agreed', ok200({ id: AGREED_LEAD, Supp_Agreed_Ref: null, Supp_Agreed_At: null })],
    ['draft only, no agreed stamp', ok200({ id: AGREED_LEAD, Supp_Agreed_Ref: 'https://writer.zoho.in/x' })],
    ['lead not readable', { status: 403, headers: { 'content-type': 'application/json' }, body: { code: 'NO_PERMISSION', status: 'error' } }],
    ['no origin lead', ok200({ id: AGREED_LEAD }), contactOf(null)],
  ]) {
    const p = await suppRig(lead, contact).sender.prefill(who(HARSHA, 'fin'), 'supplementary', ALLOT);
    assert.equal(p.ok, true, name);
    assert.equal(p.value.agreedDraft, null, name);
    assert.equal(p.value.maySend, true, name + ': the send itself is still offered');
  }
});

test('M12-S12-NOTE-2: only the supplementary paper carries an agreed draft; a paper already out offers none; a viewer is still refused', async () => {
  const fema = rig((c) => (c.host === 'crm' && c.url.includes(`/Contacts/${KIRAN}`) ? contactOf(AGREED_LEAD) : null));
  const f = await createSignSender({ crm: fema.crm, sign: fema.sign, log: fema.log, clock: () => NOW }).prefill(who(HARSHA, 'fin'), 'fema', KIRAN);
  assert.equal(f.ok, true, JSON.stringify(f));
  assert.equal(f.value.agreedDraft, null);
  assert.equal(fema.calls.some((c) => c.url.includes('/Leads/')), false, 'FEMA reads no lead');
  const out = rig((c) => readRoutes('crm.allotment.kiran-out', contactOf(AGREED_LEAD))(c)
    || (c.host === 'sign' && c.method === 'GET' && c.url.endsWith(`/requests/${REQ}`) ? 'sign.get.inprogress' : null));
  const o = await createSignSender({ crm: out.crm, sign: out.sign, log: out.log, clock: () => NOW }).prefill(who(HARSHA, 'fin'), 'supplementary', ALLOT);
  assert.equal(o.value.maySend, false);
  assert.equal(o.value.agreedDraft, null);
  const { sender } = suppRig(ok200({ id: AGREED_LEAD }));
  assert.equal((await sender.prefill(who(KAMU, 'kam'), 'supplementary', ALLOT)).reasonCode, 'seat-denied');
});

/* ================================ D131 sandbox mail sink ================================ */

async function withEnv(vars, fn) {
  const prev = {};
  for (const k of Object.keys(vars)) { prev[k] = process.env[k]; if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k]; }
  const warn = console.warn; const lines = []; console.warn = (l) => lines.push(String(l));
  try { return await fn(lines); } finally { console.warn = warn; for (const k of Object.keys(prev)) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; } }
}
const GUARD_PDF = { file: { fileName: 'x.pdf', contentType: 'application/pdf', bytes: new Uint8Array([37, 80, 68, 70, 45, 49]) }, requestName: 'x', method: 'email-otp', field: { page: 1, x: 1, y: 1, width: 10, height: 10 } };
const mailBody = (to) => ({ from: { email: 'harsha@agresearchlabs.com' }, to, subject: 's', content: 'c', format: 'text' });

test('D131: in sandbox, Zoho Sign refuses a real recipient before any request; an allowed one goes through; production is untouched', async () => {
  const cred = creds.get(HARSHA);
  // rigs are built first so the credential/data-centre binding is unchanged; the guard reads the environment at call time
  const r = rig(() => null);
  const ok = rig((c) => (c.method === 'GET' && c.url.endsWith(`/templates/${TPL}`) ? 'sign.template' : c.method === 'POST' ? 'sign.createdocument' : null));
  const prod = rig((c) => (c.method === 'GET' && c.url.endsWith(`/templates/${TPL}`) ? 'sign.template' : c.method === 'POST' ? 'sign.createdocument' : null));
  await withEnv({ ZOHO_CRM_ENVIRONMENT: 'sandbox', GZ_SANDBOX_MAIL_ALLOW: undefined }, async () => {
    for (const res of [
      await r.sign.createFromTemplate(cred, { templateId: TPL, requestName: 'x', recipient: { name: 'A', email: 'real.person@gmail.com' }, method: 'email-otp' }),
      await r.sign.createFromPdf(cred, { ...GUARD_PDF, recipient: { name: 'A', email: 'real.person@gmail.com' } }),
    ]) {
      assert.equal(res.ok, false);
      assert.deepEqual([res.error.kind, res.error.reason], ['refused', 'sandbox-mail-blocked']);
    }
    assert.equal(r.calls.length, 0, 'nothing reached Zoho Sign — not even a draft');
    assert.ok(!r.logText().includes('real.person'), 'Plane B holds no address');
    const sent = await ok.sign.createFromTemplate(cred, { templateId: TPL, requestName: 'x', recipient: { name: 'A', email: 'tech+gzseed-l1@agresearchlabs.com' }, method: 'email-otp' });
    assert.equal(sent.ok, true, JSON.stringify(sent));
  });
  await withEnv({ ZOHO_CRM_ENVIRONMENT: undefined }, async () => {
    const sent = await prod.sign.createFromTemplate(cred, { templateId: TPL, requestName: 'x', recipient: { name: 'A', email: 'real.person@gmail.com' }, method: 'email-otp' });
    assert.equal(sent.ok, true, 'production sends to any valid address, as before');
  });
});

test('D131: in sandbox, CRM send_mail is all-or-nothing and makes no request when any recipient is outside the allow list', async () => {
  const cred = creds.get(HARSHA);
  await withEnv({ ZOHO_CRM_ENVIRONMENT: 'sandbox', GZ_SANDBOX_MAIL_ALLOW: undefined }, async (lines) => {
    const r = rig(() => null);
    const res = await r.crm.sendMail(cred, 'Leads', AGREED_LEAD, mailBody([{ email: 'a@agresearchlabs.com' }, { email: 'real.person@gmail.com' }]));
    assert.equal(res.ok, false);
    assert.deepEqual([res.error.kind, res.error.reason], ['refused', 'sandbox-mail-blocked']);
    assert.equal(r.calls.length, 0);
    assert.equal(lines.length, 1);
    assert.ok(!/real\.person|gmail|agresearchlabs/.test(lines[0]), 'the log line carries hashes only');
    assert.ok(r.sink.records().some((x) => x.kind === 'refusal' && x.reason === 'sandbox-mail-blocked'));
  });
});
