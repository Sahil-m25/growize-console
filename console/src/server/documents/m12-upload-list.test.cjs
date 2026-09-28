/* M12-S02-T02 (streaming upload to Zoho) and M12-S03-T02 (the Documents page read).
 *
 * Run from console/: node --test src/server/documents/m12-upload-list.test.cjs
 * Replays recorded Zoho responses (__fixtures__/documents). No request reaches Zoho.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { before, test } = require('node:test');

const consoleRoot = path.resolve(__dirname, '..', '..', '..');
const srcRoot = path.join(consoleRoot, 'src');
const fx = path.join(srcRoot, 'lib', 'zoho', '__fixtures__', 'documents');
const ts = require(path.join(consoleRoot, 'node_modules', 'typescript'));
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoho-m12-docs-'));
process.on('exit', () => fs.rmSync(outDir, { recursive: true, force: true }));
const config = ts.readConfigFile(path.join(consoleRoot, 'tsconfig.json'), ts.sys.readFile);
const project = ts.parseJsonConfigFileContent(config.config, ts.sys, consoleRoot);
const options = { ...project.options, incremental: false, tsBuildInfoFile: undefined, plugins: undefined,
  module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10, noEmit: false, noEmitOnError: true, outDir, rootDir: srcRoot };
const program = ts.createProgram(['server/documents/upload.ts', 'server/documents/upload-body.ts', 'server/documents/list.ts', 'server/zoho-sign/status.ts', 'server/access/guard-core.ts']
  .map((f) => path.join(srcRoot, f)), options);
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
const { createZohoClient, userCredential, MAX_UPLOAD_BYTES } = load('lib/zoho/client.js');
const { createUploader, sniffMime, SLOTS, NOT_SAVED } = load('server/documents/upload.js');
const { readLimitedBytes } = load('server/documents/upload-body.js');
const { createDocumentsList, documentsSideFor } = load('server/documents/list.js');
const guardCore = load('server/access/guard-core.js');
const { createSignStatusReader } = load('server/zoho-sign/status.js');

const P = '9007199254';
const HARSHA = `${P}740993002`, ROHIT = `${P}740995001`, OTHER_IR = `${P}740995002`, IMRAN = `${P}740994001`, LATHA = `${P}740993903`, SAHIL = `${P}740993900`;
const ALLOT = `${P}740999401`, JOSEPH = `${P}740997209`, LEAD_R = `${P}740996421`, LEAD_O = `${P}740996499`;
const NOW = Date.parse('2026-09-28T06:00:00Z');
const MOD = '2026-09-20T10:00:00+05:30';

const recorded = (name) => JSON.parse(fs.readFileSync(path.join(fx, `${name}.response.json`), 'utf8'));
const EMPTY = { status: 204, headers: {}, body: null };
const toResponse = (r) => new Response(r.status === 204 ? null : JSON.stringify(r.body), { status: r.status, headers: r.headers || {} });
const immediateGate = () => ({ async acquire() { return { waitedMs: 0, release() {} }; }, async run(_c, t) { return t(); }, snapshot() { return {}; } });
const creds = new Map();
before(async () => {
  for (const id of [HARSHA, ROHIT, OTHER_IR, IMRAN, LATHA, SAHIL]) creds.set(id, await userCredential({ access_token: `synthetic-${id}`, api_domain: 'https://www.zohoapis.in', expires_in: 3_600 },
    { recordIdPrefix: P, gate: immediateGate(), log: createOpsLog(createMemorySink()), clock: () => NOW,
      fetch: async () => toResponse({ status: 200, body: { users: [{ id, status: 'active' }] } }) }));
});

/** A rig whose fetch answers from `route(method, url, init)`; every request is recorded. */
function rig(route, extra = {}) {
  const calls = [];
  const sink = createMemorySink();
  const log = createOpsLog(sink);
  const crm = createZohoClient({ recordIdPrefix: P, gate: immediateGate(), log, maxAttempts: 1, clock: () => NOW,
    fetch: async (url, init) => {
      const u = decodeURIComponent(String(url));
      const q = typeof init.body === 'string' ? JSON.parse(init.body).select_query : null;
      const c = { method: init.method, url: u, q, headers: init.headers, body: init.body };
      calls.push(c);
      return toResponse(await route(c));
    } });
  return { calls, sink, log, crm, uploader: createUploader({ crm, log, clock: () => NOW }), list: createDocumentsList({ crm, log, clock: () => extra.clock ? extra.clock() : NOW, signStatus: extra.signStatus }) };
}
const pdf = (n = 1234) => { const b = new Uint8Array(n); b.set([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]); for (let i = 8; i < n; i++) b[i] = 65 + (i % 26); return b; };
const png = (n = 64) => { const b = new Uint8Array(n); b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); return b; };
const KEY = 'press-0000000000000001', KEY2 = 'press-0000000000000002';
const who = (id, seat) => ({ credential: creds.get(id), seat });
const logText = (sink) => JSON.stringify(sink.records());
const posts = (r) => r.calls.filter((c) => c.method === 'POST' && !c.q);

/* ---------------- M12-S02-T02: upload ---------------- */

test('magic bytes: PDF, PNG and JPEG are known by their first bytes; anything else is not', () => {
  assert.equal(sniffMime(pdf()), 'application/pdf');
  assert.equal(sniffMime(png()), 'image/png');
  assert.equal(sniffMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2])), 'image/jpeg');
  assert.equal(sniffMime(new TextEncoder().encode('MZ\x90\x00 an exe')), null);
  assert.equal(sniffMime(new Uint8Array(0)), null);
});

test('AC1/AC4/AC5: a PDF on an allotment goes to its Attachments on the uploader\'s own token; the bytes are zeroed; the log has ids only', async () => {
  let listed = 0;
  const r = rig((c) => {
    if (c.method === 'GET' && /LLP_UnitAllocation_Module\/\d+\/Attachments/.test(c.url)) return recorded(listed++ ? 'upload.attachments.after' : 'upload.attachments.before');
    if (c.method === 'POST' && c.url.endsWith(`/LLP_UnitAllocation_Module/${ALLOT}/Attachments`)) return recorded('upload.attachment.ok');
    throw new Error('unrouted ' + c.method + ' ' + c.url);
  });
  const bytes = pdf();
  const res = await r.uploader.commit(who(HARSHA, 'fin'), { scope: 'allotment', recordId: ALLOT, slot: null, fileName: 'Signed supplementary.pdf', contentType: 'application/pdf', bytes }, KEY);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.value.attachmentId, `${P}740999601`);
  assert.equal(res.value.duplicate, false);
  const p = posts(r);
  assert.equal(p.length, 1);
  assert.equal(p[0].headers.Authorization, `Zoho-oauthtoken synthetic-${HARSHA}`, 'Zoho records Harsha as the uploader (D53)');
  assert.match(p[0].headers['Content-Type'], /^multipart\/form-data; boundary=/);
  const wire = Buffer.from(p[0].body).toString('latin1');
  assert.match(wire, /name="file"; filename="Signed supplementary\.pdf"/);
  assert.match(wire, /Content-Type: application\/pdf/);
  assert.ok(wire.includes('%PDF-1.7'), 'the file itself is on the wire');
  assert.ok(bytes.every((x) => x === 0), 'AC5: the upload buffer is zeroed once Zoho answered');
  const logged = logText(r.sink);
  assert.ok(!logged.includes('Signed supplementary'), 'no file name in Plane B');
  assert.ok(!logged.includes('%PDF'), 'no bytes in Plane B');
  assert.ok(logged.includes(ALLOT), "Plane B has the record id");
});

test('AC2: over 20 MB is refused with the limit named and nothing is sent', async () => {
  const r = rig(() => { throw new Error('nothing may reach Zoho'); });
  const big = new Uint8Array(MAX_UPLOAD_BYTES + 1); big.set([0x25, 0x50, 0x44, 0x46, 0x2d]);
  const res = await r.uploader.commit(who(HARSHA, 'fin'), { scope: 'allotment', recordId: ALLOT, slot: null, fileName: 'big.pdf', contentType: 'application/pdf', bytes: big }, KEY);
  assert.equal(res.ok, false);
  assert.equal(res.reasonCode, 'too-large');
  assert.match(res.message, /20 MB/);
  assert.equal(r.calls.length, 0);
});

test('AC2 (route body): a declared or streamed size over the cap is refused before it is held; nothing touches disk', async () => {
  const declared = new Request('https://console.invalid/api/documents/upload', { method: 'POST', body: new Uint8Array(10), headers: { 'content-length': String(MAX_UPLOAD_BYTES + 1) } });
  assert.deepEqual(await readLimitedBytes(declared, MAX_UPLOAD_BYTES), { ok: false, reason: 'payload-too-large' });
  const stream = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(600)); c.enqueue(new Uint8Array(600)); c.close(); } });
  const streamed = new Request('https://console.invalid/x', { method: 'POST', body: stream, duplex: 'half' });
  assert.deepEqual(await readLimitedBytes(streamed, 1000), { ok: false, reason: 'payload-too-large' });
  const fine = await readLimitedBytes(new Request('https://console.invalid/x', { method: 'POST', body: pdf(50) }), 1000);
  assert.equal(fine.ok, true); assert.equal(fine.bytes.byteLength, 50);
  assert.deepEqual(await readLimitedBytes(new Request('https://console.invalid/x', { method: 'POST' }), 1000), { ok: false, reason: 'empty' });
});

test('AC3: a type outside PDF/JPG/PNG, or bytes that are not what the name and type say, are refused; nothing is sent', async () => {
  const r = rig(() => { throw new Error('nothing may reach Zoho'); });
  const base = { scope: 'allotment', recordId: ALLOT, slot: null };
  const cases = [
    [{ fileName: 'setup.exe', contentType: 'application/octet-stream', bytes: new TextEncoder().encode('MZ....') }, 'type-not-allowed'],
    [{ fileName: 'notes.txt', contentType: 'text/plain', bytes: new TextEncoder().encode('hello') }, 'type-not-allowed'],
    [{ fileName: 'statement.csv', contentType: 'text/csv', bytes: new TextEncoder().encode('a,b') }, 'type-not-allowed'],
    [{ fileName: 'photo.png', contentType: 'image/png', bytes: pdf() }, 'type-mismatch'],
    [{ fileName: 'paper.pdf', contentType: 'application/pdf', bytes: new TextEncoder().encode('<html>not a pdf') }, 'type-not-allowed'],
    [{ fileName: 'paper.pdf', contentType: 'image/png', bytes: png() }, 'type-mismatch'],
  ];
  for (const [f, code] of cases) {
    const res = await r.uploader.commit(who(HARSHA, 'fin'), { ...base, ...f }, KEY2);
    assert.equal(res.reasonCode, code, f.fileName);
  }
  assert.equal(r.calls.length, 0);
});

test('AC6: a typed slot ("Supplementary agreement") goes to ZFS and then its file-upload field, guarded by If-Unmodified-Since', async () => {
  let reads = 0;
  const r = rig((c) => {
    if (c.method === 'GET' && c.url.includes(`/LLP_UnitAllocation_Module/${ALLOT}?`)) return recorded(reads++ ? 'upload.slot.after' : 'upload.slot.before');
    if (c.method === 'POST' && /\/crm\/v8\/files$/.test(c.url)) return recorded('upload.file.ok');
    if (c.method === 'PUT' && c.url.endsWith(`/LLP_UnitAllocation_Module/${ALLOT}`)) return recorded('upload.update.ok');
    throw new Error('unrouted ' + c.method + ' ' + c.url);
  });
  const res = await r.uploader.commit(who(HARSHA, 'fin'), { scope: 'allotment', recordId: ALLOT, slot: 'supplementary-agreement', fileName: 'Signed supplementary.pdf', contentType: 'application/pdf', bytes: pdf(), expectedModifiedTime: MOD }, KEY);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.value.slot, 'supplementary-agreement');
  const put = r.calls.find((c) => c.method === 'PUT');
  assert.equal(put.headers['If-Unmodified-Since'], MOD);
  assert.deepEqual(JSON.parse(put.body), { data: [{ Supplementary_Agreement: [{ file_id: 'b8a4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4' }] }] });
  assert.ok(!logText(r.sink).includes('b8a4c3d2e1f0'), 'the ZFS file id is not logged');
  assert.equal(SLOTS.lead['signed-nda'].field, 'NDA');
});

test('AC6: a slot needs the record\'s Modified_Time; a changed record is "reload"; an unknown slot is refused', async () => {
  const r = rig((c) => {
    if (c.method === 'GET') return recorded('upload.slot.before');
    if (c.method === 'POST') return recorded('upload.file.ok');
    if (c.method === 'PUT') return recorded('upload.update.conflict');
    throw new Error('unrouted');
  });
  const f = { scope: 'allotment', recordId: ALLOT, fileName: 'a.pdf', contentType: 'application/pdf' };
  assert.equal((await r.uploader.commit(who(HARSHA, 'fin'), { ...f, slot: 'supplementary-agreement', bytes: pdf() }, KEY)).reasonCode, 'invalid-request');
  assert.equal((await r.uploader.commit(who(HARSHA, 'fin'), { ...f, slot: 'signed-nda', bytes: pdf(), expectedModifiedTime: MOD }, KEY)).reasonCode, 'unknown-slot');
  assert.equal(r.calls.length, 0);
  const res = await r.uploader.commit(who(HARSHA, 'fin'), { ...f, slot: 'supplementary-agreement', bytes: pdf(), expectedModifiedTime: MOD }, KEY);
  assert.equal(res.reasonCode, 'record-changed');
  assert.match(res.message, /Not saved yet/);
});

test('AC7: a part-way failure says "Not saved yet"; a second press does not create two attachments', async () => {
  // First press: Zoho answers 500 to the POST (it may have landed). Second press, same key: the recount shows it did.
  let lists = 0, postsSeen = 0;
  const r = rig((c) => {
    if (c.method === 'GET') return recorded(lists++ ? 'upload.attachments.after' : 'upload.attachments.before');
    if (c.method === 'POST') { postsSeen++; return recorded('upload.server-error'); }
    throw new Error('unrouted');
  });
  const input = () => ({ scope: 'allotment', recordId: ALLOT, slot: null, fileName: 'Signed supplementary.pdf', contentType: 'application/pdf', bytes: pdf() });
  const first = await r.uploader.commit(who(HARSHA, 'fin'), input(), KEY);
  assert.equal(first.ok, false);
  assert.equal(first.kind, 'not-saved');
  assert.equal(first.message, NOT_SAVED);
  assert.equal(first.unknownOutcome, true);
  const second = await r.uploader.commit(who(HARSHA, 'fin'), input(), KEY);
  assert.equal(second.ok, true, JSON.stringify(second));
  assert.equal(second.value.recovered, true);
  assert.equal(second.value.duplicate, true);
  assert.equal(postsSeen, 1, 'the second press did not POST again');
  const third = await r.uploader.commit(who(HARSHA, 'fin'), input(), KEY);
  assert.equal(third.ok, true); assert.equal(postsSeen, 1);
});

test('AC7: when the first press did not land, the same key sends it once more; two presses at once POST once', async () => {
  let postsSeen = 0, fail = true;
  const r = rig(async (c) => {
    if (c.method === 'GET') return recorded('upload.attachments.before');
    if (c.method === 'POST') { postsSeen++; await new Promise((ok) => setTimeout(ok, 20)); return recorded(fail ? 'upload.server-error' : 'upload.attachment.ok'); }
    throw new Error('unrouted');
  });
  const input = () => ({ scope: 'allotment', recordId: ALLOT, slot: null, fileName: 'Signed supplementary.pdf', contentType: 'application/pdf', bytes: pdf() });
  assert.equal((await r.uploader.commit(who(HARSHA, 'fin'), input(), KEY)).kind, 'not-saved');
  fail = false;
  const again = await r.uploader.commit(who(HARSHA, 'fin'), input(), KEY);
  assert.equal(again.ok, true); assert.equal(again.value.recovered, false);
  assert.equal(postsSeen, 2);
  const [a, b] = await Promise.all([
    r.uploader.commit(who(HARSHA, 'fin'), input(), KEY2),
    r.uploader.commit(who(HARSHA, 'fin'), input(), KEY2),
  ]);
  assert.equal(postsSeen, 3, 'double press in flight → one POST');
  assert.equal(a.ok && b.ok, true);
  assert.equal([a.value.duplicate, b.value.duplicate].sort().join(), 'false,true');
  const other = await r.uploader.commit(who(HARSHA, 'fin'), { ...input(), bytes: png(), fileName: 'x.png', contentType: 'image/png' }, KEY2);
  assert.equal(other.reasonCode, 'idempotency-key-reused');
});

test('seats: viewers, audit, KAM and an IR file nothing on the Investors side; an IR files the Signed NDA on their own lead only', async () => {
  const r = rig((c) => {
    if (c.method === 'GET' && c.url.includes(`/Leads/${LEAD_R}?`)) return recorded(c.url.includes('fields=NDA') ? 'upload.lead.no-nda' : 'upload.lead.rohit');
    if (c.method === 'GET' && c.url.includes(`/Leads/${LEAD_O}?`)) return recorded('upload.lead.other');
    if (c.method === 'POST' && /\/files$/.test(c.url)) return recorded('upload.file.ok');
    if (c.method === 'PUT' && c.url.endsWith(`/Leads/${LEAD_R}`)) return recorded('upload.update.ok');
    throw new Error('unrouted ' + c.method + ' ' + c.url);
  });
  const f = { scope: 'allotment', recordId: ALLOT, slot: null, fileName: 'a.pdf', contentType: 'application/pdf' };
  for (const [id, seat] of [[LATHA, 'audit'], [IMRAN, 'kam'], [ROHIT, 'ir'], [SAHIL, 'exec']]) {
    assert.equal((await r.uploader.commit(who(id, seat), { ...f, bytes: pdf() }, KEY)).reasonCode, 'seat-denied', seat);
  }
  assert.equal((await r.uploader.commit(who(HARSHA, 'fin'), { ...f, scope: 'lead', recordId: LEAD_R, bytes: pdf() }, KEY)).reasonCode, 'seat-denied', 'Finance files no lead papers');
  assert.equal(r.calls.length, 0);
  const nda = { scope: 'lead', slot: 'signed-nda', fileName: 'NDA signed.pdf', contentType: 'application/pdf', expectedModifiedTime: MOD };
  const other = await r.uploader.commit(who(ROHIT, 'ir'), { ...nda, recordId: LEAD_O, bytes: pdf() }, KEY);
  assert.equal(other.reasonCode, 'not-in-book');
  assert.equal(r.calls.filter((c) => c.method !== 'GET').length, 0, 'nothing sent for another IR\'s lead');
  const own = await r.uploader.commit(who(ROHIT, 'ir'), { ...nda, recordId: LEAD_R, bytes: pdf() }, KEY2);
  assert.equal(own.ok, true, JSON.stringify(own));
  assert.deepEqual(Object.keys(JSON.parse(r.calls.find((c) => c.method === 'PUT').body).data[0]), ['NDA']);
});

test('the routes are listed in the access guard', () => {
  assert.equal(guardCore.apiRuleOf('/api/documents/upload').key, '/api/documents');
  assert.equal(guardCore.apiRuleOf('/api/documents/list').key, '/api/documents');
  assert.equal(guardCore.apiRuleOf('/api/emails/investor/1').key, '/api/emails');
});

/* ---------------- M12-S03-T02: the Documents page read ---------------- */

function signRoute(opts = {}) {
  return (c) => {
    if (c.q) {
      if (opts.fail) return recorded('coql.sign-server-error');
      if (/from Contacts/.test(c.q)) return recorded(/FEMA_Verified_At is null/.test(c.q) ? 'coql.sign-fema-out' : 'coql.sign-fema-all');
      if (/from LLP_UnitAllocation_Module/.test(c.q)) return /Supplementary_Sign_Req_Id is not null\)/.test(c.q) && !/is null\)/.test(c.q.replace('is not null)', '')) ? recorded('coql.sign-alloc-all') : EMPTY;
      if (/from Leads/.test(c.q)) return recorded('coql.sign-nda-rohit');
      throw new Error('unrouted ' + c.q);
    }
    if (/\/Contacts\/\d+\/Attachments/.test(c.url)) return recorded('attachments.contact');
    if (/\/LLP_UnitAllocation_Module\/\d+\/Attachments/.test(c.url)) return recorded('attachments.allotment');
    throw new Error('unrouted ' + c.url);
  };
}

test('TC-IM07-001: Harsha sees "Out for signature" = 1 — Joseph Mathew\'s FEMA declaration, Class 3 DSC, with Verify', async () => {
  const r = rig(signRoute());
  const res = await r.list.read(creds.get(HARSHA), 'fin', 'out');
  assert.equal(res.ok, true, JSON.stringify(res));
  const p = res.page;
  assert.equal(p.side, 'investors');
  assert.equal(p.outCount, 1);
  assert.equal(p.rows.length, 1);
  const row = p.rows[0];
  assert.equal(row.label, 'FEMA declaration');
  assert.equal(row.party, 'Joseph Mathew (ARL-INV-0209)');
  assert.equal(row.method, 'Class 3 DSC');
  assert.equal(row.state, 'sent');
  assert.equal(row.recordId, JOSEPH);
  assert.equal(row.sign, null, 'no Sign reader in this rig (Zoho Sign not configured) → sign: null');
  assert.deepEqual(p.actions, { send: true, verify: true });
  assert.equal(p.fresh.tone, 'live');
  const qs = r.calls.map((c) => c.q).filter(Boolean);
  assert.ok(qs.every((q) => /Verified_At is null/.test(q)), 'out = not yet verified');
  assert.ok(!qs.some((q) => /from Leads/.test(q)), 'Finance has no lead-side list');
  assert.ok(r.calls.every((c) => c.headers.Authorization === `Zoho-oauthtoken synthetic-${HARSHA}`), 'own token');
});

test('TC-IM07-002: the Auditor reads the same row and is offered neither Send nor Verify', async () => {
  const r = rig(signRoute());
  const res = await r.list.read(creds.get(LATHA), 'audit', 'out');
  assert.equal(res.ok, true);
  assert.equal(res.page.rows[0].party, 'Joseph Mathew (ARL-INV-0209)');
  assert.deepEqual(res.page.actions, { send: false, verify: false });
  assert.equal(res.page.rows[0].yourMove, null);
});

test('TC-IM07-003: a KAM and the Head of AM have no Documents; nothing is read', async () => {
  const r = rig(signRoute());
  for (const [id, seat] of [[IMRAN, 'kam'], [IMRAN, 'amlead']]) {
    const res = await r.list.read(creds.get(id), seat, 'out');
    assert.equal(res.ok, false); assert.equal(res.reason, 'seat-denied');
  }
  assert.equal(r.calls.length, 0);
});

test('an IR sees only NDA paperwork on leads that are theirs, with their move', async () => {
  const r = rig(signRoute());
  const res = await r.list.read(creds.get(ROHIT), 'ir', 'out');
  assert.equal(res.ok, true);
  assert.equal(res.page.side, 'lead');
  assert.deepEqual(res.page.rows.map((x) => x.recordId), [LEAD_R], 'a row sharing let through from another IR is dropped');
  assert.equal(res.page.rows[0].yourMove, 'Remind them to sign');
  assert.deepEqual(res.page.actions, { send: false, verify: false });
  const qs = r.calls.map((c) => c.q);
  assert.ok(qs.every((q) => /from Leads/.test(q) && q.includes(`Owner = '${ROHIT}'`)), 'the IR\'s own filter is in the WHERE');
});

test('a person holding both halves (DI) gets the fuller Investors-side list once, not two lists', async () => {
  assert.equal(documentsSideFor('di', SAHIL), 'investors');
  assert.equal(documentsSideFor('ops', SAHIL), 'investors');
  const r = rig(signRoute());
  const res = await r.list.read(creds.get(SAHIL), 'di', 'out');
  assert.equal(res.page.side, 'investors');
  assert.ok(!r.calls.some((c) => /from Leads/.test(c.q || '')));
});

test('"Everything on file": verified papers too, plus the files the seat may list (no personal files for audit)', async () => {
  const r = rig(signRoute());
  const res = await r.list.read(creds.get(HARSHA), 'fin', 'all');
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.deepEqual(res.page.rows.map((x) => x.state).sort(), ['sent', 'verified', 'verified']);
  assert.equal(res.page.outCount, 1);
  assert.deepEqual(res.page.files.map((f) => f.scope).sort(), ['allotment', 'personal', 'personal']);
  const a = rig(signRoute());
  const au = await a.list.read(creds.get(LATHA), 'audit', 'all');
  assert.deepEqual(au.page.files.map((f) => f.scope), ['allotment'], 'audit reads no personal (KYC) files');
});

test('a per-viewer Sign reader, when wired, marks a completed request "signed" with Verify as Finance\'s move', async () => {
  const r = rig(signRoute(), { signStatus: async (_c, ids) => new Map(ids.map((id) => [id, { status: 'completed', sentAt: '2026-08-26T10:00:00+05:30', sentBy: 'x', expiresAt: '2026-09-09' }])) });
  const res = await r.list.read(creds.get(HARSHA), 'fin', 'out');
  assert.equal(res.page.rows[0].state, 'signed');
  assert.equal(res.page.rows[0].yourMove, 'Verify');
  assert.equal(res.page.rows[0].sign.expiresAt, '2026-09-09');
});

/** A per-viewer SignApi stand-in: getRequest answers the given Zoho request_status (and VIEWED action) for every id. */
const fakeSign = (status, viewed = false) => {
  const seen = [];
  return { seen, api: { async getRequest(cred, requestId) {
    seen.push(cred.userId);
    return { ok: true, value: { requestId, status, sentAt: Date.parse('2026-09-21T04:30:00Z'), modifiedTime: null, expiresAt: Date.parse('2026-10-05T04:30:00Z'),
      declineReason: null, actions: [{ actionId: '1', type: 'SIGN', status: viewed ? 'VIEWED' : 'NOACTION', recipientEmail: null, embedded: false }], documentIds: [] } };
  } } };
};

test('M12-S05 wiring: createSignStatusReader as signStatus — Viewed with the sent date, on the VIEWER\'s own credential (D53)', async () => {
  const f = fakeSign('inprogress', true);
  const r = rig(signRoute(), { signStatus: createSignStatusReader(f.api) });
  const res = await r.list.read(creds.get(HARSHA), 'fin', 'out');
  const row = res.page.rows[0];
  assert.equal(row.state, 'sent');
  assert.equal(row.sign.status, 'viewed');
  assert.equal(row.sign.label, 'Viewed');
  assert.equal(row.sign.sentAt, '2026-09-21T10:00+05:30');
  assert.equal(row.sign.expiresAt.slice(0, 10), '2026-10-05');
  assert.deepEqual([...new Set(f.seen)], [HARSHA], 'every Sign read on the viewer\'s own token');
});

test('M12-S05 wiring: a Declined / Recalled request is not "remind" — Finance sends a new one; the IR is told Finance will', async () => {
  for (const st of ['declined', 'recalled']) {
    const fin = await rig(signRoute(), { signStatus: createSignStatusReader(fakeSign(st).api) }).list.read(creds.get(HARSHA), 'fin', 'out');
    assert.equal(fin.page.rows[0].sign.label, st === 'declined' ? 'Declined' : 'Recalled');
    assert.equal(fin.page.rows[0].state, 'sent');
    assert.equal(fin.page.rows[0].yourMove, 'Send a new one');
    const ir = await rig(signRoute(), { signStatus: createSignStatusReader(fakeSign(st).api) }).list.read(creds.get(ROHIT), 'ir', 'out');
    assert.equal(ir.page.rows[0].yourMove, 'Finance to send a new one');
  }
});

test('D45: a failed read shows stale/error with the last good time — never old rows', async () => {
  let now = NOW, fail = false;
  const r = rig((c) => signRoute({ fail })(c), { clock: () => now });
  const ok = await r.list.read(creds.get(LATHA), 'audit', 'out');
  assert.equal(ok.ok, true);
  fail = true; now = NOW + 60_000;
  const stale = await r.list.read(creds.get(LATHA), 'audit', 'out');
  assert.equal(stale.ok, false);
  assert.equal(stale.kind, 'source-error');
  assert.equal(stale.rows, undefined);
  assert.equal(stale.fresh.at, NOW, 'the time of the last good read');
  assert.equal(stale.fresh.tone, 'stale');
  now = NOW + 10 * 60_000;
  assert.equal((await r.list.read(creds.get(LATHA), 'audit', 'out')).fresh.tone, 'error', 'past the five-minute ceiling');
  const never = await r.list.read(creds.get(SAHIL), 'di', 'all');
  assert.equal(never.fresh.at, null); assert.equal(never.fresh.tone, 'error');
});
