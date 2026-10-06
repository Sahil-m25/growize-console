/* D132 — THE INVESTORS-SIDE CARE WRITES: logContact, saveDetails, passKyc / failKyc on the person's own token.
 *
 * Run from console/: node --test src/server/investors/care.test.cjs
 * Compiles the production module with the project's strict settings and drives it against an in-memory Zoho double that
 * records every call. No request reaches Zoho; every id and value is synthetic.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const consoleRoot = path.resolve(__dirname, '..', '..', '..');
const srcRoot = path.join(consoleRoot, 'src');
const ts = require(path.join(consoleRoot, 'node_modules', 'typescript'));
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoho-care-'));
process.on('exit', () => fs.rmSync(outDir, { recursive: true, force: true }));
const config = ts.readConfigFile(path.join(consoleRoot, 'tsconfig.json'), ts.sys.readFile);
const project = ts.parseJsonConfigFileContent(config.config, ts.sys, consoleRoot);
const options = {
  ...project.options, incremental: false, tsBuildInfoFile: undefined, plugins: undefined,
  module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10,
  noEmit: false, noEmitOnError: true, outDir, rootDir: srcRoot,
};
const program = ts.createProgram([path.join(srcRoot, 'server/investors/care.ts')], options);
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
const { createInvestorCare, parseDetailsCommand, nomineeFields, CARE_STATUS } = require(path.join(outDir, 'server/investors/care.js'));

const KAM = '554023000000300013', OTHER_KAM = '554023000000300011', COMP = '554023000000300020';
const CONTACT = '554023000000400001', LEAD = '554023000000700001', TOUCH = '554023000000800001', NOTE = '554023000000900001';
const MT = '2026-10-06T09:00:00+05:30', MT2 = '2026-10-06T10:00:00+05:30';
const NOW = Date.parse('2026-10-06T06:00:00Z');   /* 11:30 IST */
const SID = 'sid_fixture_care_000000000000000000000000';
const ok = (value) => ({ ok: true, value, status: 200, creditsRemaining: null });
const bad = (kind, extra = {}) => ({ ok: false, error: { kind, status: kind === 'conflict' ? 412 : 500, code: kind, recordId: CONTACT, ...extra }, creditsRemaining: null });

function rig({ me = KAM, grant = { seat: 'kam', ownBook: true }, contact = {}, allotted = true, pan = true, aref = true, fail = {} } = {}) {
  const calls = [];
  const events = { refusals: [], conflicts: [], refusal(u, a, r, ids) { this.refusals.push({ u, a, r, ids }); }, conflict(u, a, id) { this.conflicts.push({ u, a, id }); } };
  const rec = { id: CONTACT, KAM: { id: KAM }, Origin_Lead: { id: LEAD }, KAM_Intro_At: null, Residency: 'Resident', Modified_Time: MT, ...contact };
  const crm = {
    async getRecord(cred, module, id, o) { calls.push({ op: 'get', module, id, fields: o.fields, as: cred.userId }); return fail.get ? bad(fail.get) : ok(id === CONTACT ? rec : null); },
    async coql(cred, q) {
      calls.push({ op: 'coql', q, as: cred.userId });
      if (fail.coql) return bad(fail.coql);
      if (/LLP_UnitAllocation_Module/.test(q)) return ok({ records: allotted ? [{ id: '1', Customer: { id: CONTACT } }] : [], moreRecords: false });
      if (/PAN_Number is not null/.test(q)) return ok({ records: pan ? [{ id: CONTACT }] : [], moreRecords: false });
      if (/Aadhaar_Ref is not null/.test(q)) return ok({ records: aref ? [{ id: CONTACT }] : [], moreRecords: false });
      return ok({ records: [], moreRecords: false });
    },
    async update(cred, module, id, fields, o) { calls.push({ op: 'update', module, id, fields, since: o.ifUnmodifiedSince, as: cred.userId }); return fail.update ? bad(fail.update) : ok({ id, modifiedTime: MT2 }); },
    async insert(cred, module, records) {
      calls.push({ op: 'insert', module, records, as: cred.userId });
      if (fail.insert) return bad(fail.insert);
      return ok([{ index: 0, ok: true, id: module === 'Notes' ? NOTE : TOUCH, code: 'SUCCESS' }]);
    },
  };
  const authority = { async allow(cred, sid, cap) { calls.push({ op: 'allow', cap, sid }); return grant; } };
  const care = createInvestorCare({ crm, authority, events, clock: () => NOW });
  const p = { credential: { kind: 'user', userId: me, accessToken: 'x' }, sessionId: SID };
  return { care, calls, events, p };
}
const writes = (calls) => calls.filter((c) => c.op === 'update' || c.op === 'insert');

/* ---- logContact ---- */
test('logContact: the account\'s own KAM — one Touch on the origin lead, KAM_Intro_At stamped first, all on their own token', async () => {
  const { care, calls, p } = rig();
  const r = await care.logContact(p, CONTACT, { expectedModifiedTime: MT, channel: 'call', mood: 'concern', note: 'Asked about the payout date' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, { contactId: CONTACT, touchId: TOUCH, introduced: true, modifiedTime: MT2 });
  const w = writes(calls);
  assert.equal(w.length, 2);
  assert.deepEqual(w[0], { op: 'update', module: 'Contacts', id: CONTACT, fields: { KAM_Intro_At: '2026-10-06T11:30:00+05:30' }, since: MT, as: KAM });
  assert.equal(w[1].module, 'Touches');
  assert.deepEqual(w[1].records[0], { Name: 'Call 2026-10-06T11:30:00+05:30', Lead: { id: LEAD }, Channel: 'Call', Occurred_At: '2026-10-06T11:30:00+05:30',
    Is_Reply: false, Note: 'A concern — Asked about the payout date' });
  assert.ok(calls.every((c) => !c.as || c.as === KAM));
  assert.equal(calls[0].op, 'allow');
});
test('logContact: an introduction already made is not stamped again', async () => {
  const { care, calls, p } = rig({ contact: { KAM_Intro_At: '2026-09-01T10:00:00+05:30' } });
  const r = await care.logContact(p, CONTACT, { expectedModifiedTime: MT, channel: 'msg', mood: 'good' });
  assert.equal(r.ok, true); assert.equal(r.value.introduced, false);
  assert.deepEqual(writes(calls).map((c) => c.module), ['Touches']);
});
test('logContact: a seat without "care" is refused before anything is read (403 seat-denied)', async () => {
  const { care, calls, events, p } = rig({ me: COMP, grant: null });
  const r = await care.logContact(p, CONTACT, { expectedModifiedTime: MT, channel: 'call', mood: 'ok' });
  assert.deepEqual(r, { ok: false, kind: 'refused', reason: 'seat-denied' });
  assert.equal(CARE_STATUS['seat-denied'], 403);
  assert.deepEqual(calls.map((c) => c.op), ['allow']);
  assert.deepEqual(events.refusals[0], { u: COMP, a: 'investor-contact', r: 'seat-denied', ids: [CONTACT] });
});
test('logContact: a KAM on another manager\'s account is refused, nothing written (not-yours)', async () => {
  const { care, calls, p } = rig({ me: OTHER_KAM });
  const r = await care.logContact(p, CONTACT, { expectedModifiedTime: MT, channel: 'call', mood: 'ok' });
  assert.equal(r.reason, 'not-yours'); assert.equal(writes(calls).length, 0);
});
test('logContact: validation — an unknown channel, a missing version or an extra key is 400 invalid-request, Zoho untouched', async () => {
  for (const body of [{ expectedModifiedTime: MT, channel: 'fax', mood: 'ok' }, { channel: 'call', mood: 'ok' }, { expectedModifiedTime: MT, channel: 'call', mood: 'ok', nextDays: 14 }, null]) {
    const { care, calls, p } = rig();
    const r = await care.logContact(p, CONTACT, body);
    assert.equal(r.reason, 'invalid-request');
    assert.ok(!calls.some((c) => c.op === 'get' || c.op === 'update' || c.op === 'insert'));
  }
  assert.equal(CARE_STATUS['invalid-request'], 400);
});
test('logContact: a stale version is the conflict (409), nothing written', async () => {
  const { care, calls, events, p } = rig();
  const r = await care.logContact(p, CONTACT, { expectedModifiedTime: '2026-10-05T09:00:00+05:30', channel: 'call', mood: 'ok' });
  assert.equal(r.kind, 'conflict'); assert.equal(writes(calls).length, 0); assert.equal(events.conflicts.length, 1);
});
test('logContact: no origin lead, or no Issued allotment → 422, nothing written', async () => {
  let x = rig({ contact: { Origin_Lead: null } });
  assert.equal((await x.care.logContact(x.p, CONTACT, { expectedModifiedTime: MT, channel: 'call', mood: 'ok' })).reason, 'no-origin-lead');
  x = rig({ allotted: false });
  assert.equal((await x.care.logContact(x.p, CONTACT, { expectedModifiedTime: MT, channel: 'call', mood: 'ok' })).reason, 'not-allotted');
  assert.equal(writes(x.calls).length, 0);
});
test('logContact: a Zoho failure on the Touch is surfaced as a source error and the introduction is taken back', async () => {
  const { care, calls, p } = rig({ fail: { insert: 'server' } });
  const r = await care.logContact(p, CONTACT, { expectedModifiedTime: MT, channel: 'call', mood: 'ok' });
  assert.deepEqual(r, { ok: false, kind: 'source-error', errorKind: 'server' });
  const u = calls.filter((c) => c.op === 'update');
  assert.deepEqual(u.map((c) => [c.fields, c.since]), [[{ KAM_Intro_At: '2026-10-06T11:30:00+05:30' }, MT], [{ KAM_Intro_At: null }, MT2]]);
});
test('logContact: a Zoho failure reading the Contact is a source error (503), not a refusal', async () => {
  const { care, p } = rig({ fail: { get: 'unavailable' } });
  assert.deepEqual(await care.logContact(p, CONTACT, { expectedModifiedTime: MT, channel: 'call', mood: 'ok' }), { ok: false, kind: 'source-error', errorKind: 'unavailable' });
});

/* ---- saveDetails ---- */
test('saveDetails: the KAM\'s own account — one guarded PUT of the mapped Contacts fields', async () => {
  const { care, calls, p } = rig();
  const r = await care.saveDetails(p, CONTACT, { expectedModifiedTime: MT, changes: { ph: '+91 98450 00000', em: 'new@example.test', city: 'Mysuru', nominee: 'Asha Rao (Spouse)' } });
  assert.equal(r.ok, true);
  const w = writes(calls);
  assert.equal(w.length, 1);
  assert.deepEqual(w[0].fields, { Mobile: '+91 98450 00000', Email: 'new@example.test', Mailing_City: 'Mysuru', Nominee_Name: 'Asha Rao', Nominee_Relation: 'Spouse' });
  assert.equal(w[0].since, MT);
  assert.deepEqual([...r.value.fields], ['Mobile', 'Email', 'Mailing_City', 'Nominee_Name', 'Nominee_Relation']);
});
test('saveDetails: the name, the address, an identity field, a bad email or an empty phone are not accepted (400)', () => {
  for (const changes of [{ n: 'New Name' }, { addr: '1 Road' }, { PAN_Number: 'X' }, { em: 'nope' }, { ph: '' }, {}]) {
    assert.equal(parseDetailsCommand(CONTACT, { expectedModifiedTime: MT, changes }), null, JSON.stringify(changes));
  }
  assert.deepEqual(nomineeFields(''), { Nominee_Name: null, Nominee_Relation: null });
  assert.deepEqual(nomineeFields('Ravi'), { Nominee_Name: 'Ravi' });
});
test('saveDetails: wrong seat → seat-denied; another KAM\'s account → not-yours; Zoho 412 → conflict; Zoho error → source error', async () => {
  let x = rig({ grant: null });
  assert.equal((await x.care.saveDetails(x.p, CONTACT, { expectedModifiedTime: MT, changes: { city: 'X' } })).reason, 'seat-denied');
  x = rig({ me: OTHER_KAM });
  assert.equal((await x.care.saveDetails(x.p, CONTACT, { expectedModifiedTime: MT, changes: { city: 'X' } })).reason, 'not-yours');
  x = rig({ fail: { update: 'conflict' } });
  assert.equal((await x.care.saveDetails(x.p, CONTACT, { expectedModifiedTime: MT, changes: { city: 'X' } })).kind, 'conflict');
  x = rig({ fail: { update: 'server' } });
  assert.deepEqual(await x.care.saveDetails(x.p, CONTACT, { expectedModifiedTime: MT, changes: { city: 'X' } }), { ok: false, kind: 'source-error', errorKind: 'server' });
});

/* ---- decideKyc ---- */
const comp = (o = {}) => rig({ me: COMP, grant: { seat: 'comp', ownBook: false }, contact: { KAM: null }, ...o });
test('passKyc: Compliance — PAN and Aadhaar reference asked as presence tests only, then KYC Completed + KYC_Completed_On', async () => {
  const { care, calls, p } = comp();
  const r = await care.decideKyc(p, CONTACT, { expectedModifiedTime: MT, result: 'passed' });
  assert.deepEqual(r, { ok: true, value: { contactId: CONTACT, kyc: 'passed', on: '2026-10-06', noteId: null, modifiedTime: MT2 } });
  const q = calls.filter((c) => c.op === 'coql').map((c) => c.q);
  assert.equal(q.length, 2);
  for (const s of q) assert.match(s, /^select id from Contacts where \(id = '\d+' and \w+ is not null\) limit 0, 1$/);
  assert.ok(!calls.some((c) => c.op === 'get' && c.fields.some((f) => /PAN|Aadhaar|Bank/.test(f))), 'no identity field is selected');
  assert.deepEqual(writes(calls)[0].fields, { KYC: 'Completed', KYC_Completed_On: '2026-10-06' });
});
test('passKyc: a non-resident needs no Aadhaar reference; no PAN → 422 no-pan; no reference → 422 no-aadhaar', async () => {
  let x = comp({ contact: { KAM: null, Residency: 'NRI' }, aref: false });
  assert.equal((await x.care.decideKyc(x.p, CONTACT, { expectedModifiedTime: MT, result: 'passed' })).ok, true);
  x = comp({ pan: false });
  assert.equal((await x.care.decideKyc(x.p, CONTACT, { expectedModifiedTime: MT, result: 'passed' })).reason, 'no-pan');
  assert.equal(writes(x.calls).length, 0);
  x = comp({ aref: false });
  assert.equal((await x.care.decideKyc(x.p, CONTACT, { expectedModifiedTime: MT, result: 'passed' })).reason, 'no-aadhaar');
  assert.equal(CARE_STATUS['no-pan'], 422);
});
test('failKyc: KYC Failed, and the reason as a Note on the Contact', async () => {
  const { care, calls, p } = comp();
  const r = await care.decideKyc(p, CONTACT, { expectedModifiedTime: MT, result: 'failed', why: 'Documents do not match' });
  assert.equal(r.ok, true); assert.equal(r.value.noteId, NOTE);
  const w = writes(calls);
  assert.deepEqual(w[0].fields, { KYC: 'Failed', KYC_Completed_On: '2026-10-06' });
  assert.deepEqual(w[1].records[0], { Note_Title: 'KYC failed', Note_Content: 'Documents do not match', Parent_Id: { module: { api_name: 'Contacts' }, id: CONTACT } });
});
test('KYC: a KAM (no "kyc") is refused 403; a bad result is 400; a Zoho error is surfaced', async () => {
  let x = rig({ grant: null });
  assert.equal((await x.care.decideKyc(x.p, CONTACT, { expectedModifiedTime: MT, result: 'passed' })).reason, 'seat-denied');
  x = comp();
  assert.equal((await x.care.decideKyc(x.p, CONTACT, { expectedModifiedTime: MT, result: 'maybe' })).reason, 'invalid-request');
  x = comp({ fail: { coql: 'server' } });
  assert.deepEqual(await x.care.decideKyc(x.p, CONTACT, { expectedModifiedTime: MT, result: 'passed' }), { ok: false, kind: 'source-error', errorKind: 'server' });
  assert.equal(writes(x.calls).length, 0);
});
test('rule 7: a refusal line carries ids and a code only', async () => {
  const { care, events, p } = rig({ me: OTHER_KAM });
  await care.saveDetails(p, CONTACT, { expectedModifiedTime: MT, changes: { em: 'secret@example.test' } });
  assert.doesNotMatch(JSON.stringify(events.refusals), /secret|example/);
});
