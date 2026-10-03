/* M02-S04-T05 FIELD REGISTER CHECK + the app half of the seam cases TC-E02-007, TC-IM02-017, TC-IM04-020, TC-IM11-001, TC-IM11-002.
   Run from console/:  node src/lib/zoho/field-register.test.cjs
   Offline only. The register (zoho/field-register.json) names fields by the plan's logical name; the mapping
   (pm/plan-merged/zoho-field-mapping.json) and the as-found org doc give the Zoho API name. This ties the two so a register row that
   points at nothing, or a reveal right that drifts from identity.ts, fails CI. What only Zoho can prove is skipped as "needs sandbox". */
'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const consoleRoot = path.resolve(__dirname, '..', '..', '..');
const repo = path.join(consoleRoot, '..');
const ts = require(path.join(consoleRoot, 'node_modules', 'typescript'));
const js = ts.transpileModule(fs.readFileSync(path.join(__dirname, 'identity.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const m = { exports: {} }; new Function('module', 'exports', js)(m, m.exports); const id = m.exports;

const register = JSON.parse(fs.readFileSync(path.join(repo, 'zoho', 'field-register.json'), 'utf8')).fields;
const mapping = JSON.parse(fs.readFileSync(path.join(repo, 'pm', 'plan-merged', 'zoho-field-mapping.json'), 'utf8'));
const asFound = fs.readFileSync(path.join(repo, 'docs', 'zoho-org-as-found-2026-09-23.md'), 'utf8');
const bookSrc = fs.readFileSync(path.join(consoleRoot, 'src', 'server', 'investors', 'book.ts'), 'utf8');
const sensitive = new Set([...bookSrc.slice(bookSrc.indexOf('SENSITIVE_CONTACT_FIELDS'), bookSrc.indexOf(']);', bookSrc.indexOf('SENSITIVE_CONTACT_FIELDS'))).matchAll(/"([A-Za-z_0-9]+)"/g)].map((x) => x[1]));

const ROLES = new Set(['ir', 'ir_manager', 'kam', 'head_of_finance', 'finance', 'compliance', 'digital_infrastructure']);
/* logical register name -> Zoho API name. pan / bank_account / Aadhaar_Number are the stale aliases identity.ts still uses (book.ts says so). */
const API = { 'Contacts.pan': 'PAN_Number', 'Contacts.bank_account': 'Bank_Account_Number', 'Contacts.Aadhaar_Number': 'Aadhaar_Number', 'Contacts.aadhaar_last4': 'Aadhaar_Last4', 'Contacts.aadhaar_ref': 'Aadhaar_Ref' };
const GATE = ['supp_verified_at', 'advance_confirmed_at', 'balance_confirmed_at', 'allotted_at', 'account_opened_at'].map((g) => 'Leads.' + g);

test('register shape: unique rows, one writer each, known profiles', () => {
  const keys = register.map((f) => f.field); assert.equal(new Set(keys).size, keys.length, 'a field appears twice');
  for (const f of register) {
    assert.match(f.field, /^[A-Za-z_]+\.[A-Za-z_0-9]+$/, f.field);
    assert.ok(ROLES.has(f.writer), `${f.field}: writer ${f.writer}`);
    for (const r of f.readers) assert.ok(ROLES.has(r), `${f.field}: reader ${r}`);
    assert.equal(new Set(f.readers).size, f.readers.length, `${f.field}: duplicate reader`);
  }
});

test('every Contacts row resolves to the mapping, the as-found org or the sensitive-field list', () => {
  const inMapping = (mod, name) => mapping.some((r) => r[3] === mod && r[4] === name);
  for (const f of register.filter((x) => x.field.startsWith('Contacts.'))) {
    const api = API[f.field]; assert.ok(api, `${f.field} has no API-name alias in this test`);
    assert.ok(inMapping('Contacts', api) || new RegExp('\\b' + api + '\\b').test(asFound), `${f.field} -> ${api} is in neither the mapping nor the org doc`);
    assert.ok(sensitive.has(api), `${api} is missing from SENSITIVE_CONTACT_FIELDS (book.ts)`);
  }
});

test('every identity field is registered, and reveal rights in identity.ts equal the register readers', () => {
  for (const name of id.IDENTITY_FIELDS) assert.ok(register.some((f) => f.field === 'Contacts.' + name), name);
  for (const fld of ['pan', 'bank_account']) {
    const row = register.find((f) => f.field === 'Contacts.' + fld);
    assert.deepEqual([...row.readers].sort(), [...id.REVEAL_ROLES[fld]].sort(), fld);
    assert.equal(row.encrypted, true, fld + ' is encrypted');
  }
});

test('TC-IM11-001 (app half): each gate column has exactly one writer, Finance; no IR, KAM or manager may write it', () => {
  for (const g of GATE) {
    const rows = register.filter((f) => f.field === g); assert.equal(rows.length, 1, g);
    assert.equal(rows[0].writer, 'finance', g);
  }
  for (const f of register) assert.ok(!['ir', 'ir_manager', 'kam'].includes(f.writer), `${f.field} is writable by ${f.writer}`);
});
test('TC-IM11-001 (Zoho half)', { skip: 'needs sandbox: an IR test-user token PUT must be refused by Zoho field permissions' }, () => {});

test('TC-IM11-002 / TC-E02-007 / TC-IM02-017 / TC-IM04-020 (app half): no seat but the reveal seats ever receives pan, bank or Aadhaar', () => {
  const asked = ['Full_Name', 'pan', 'bank_account', 'Aadhaar_Number', 'aadhaar_last4', 'aadhaar_ref'];
  assert.deepEqual(id.safeFields(asked), ['Full_Name', 'aadhaar_last4', 'aadhaar_ref'], 'a record GET projection drops identity, keeps the masked-form fields');
  const rec = { Full_Name: 'Radhika Menon', pan: 'AFTPB1234L', bank_account: '000012341208', Aadhaar_Number: '1111 2222 5561' };
  const shaped = JSON.stringify(id.shapeIdentity(rec));
  assert.ok(!/AFTPB1234L|000012341208|1111 2222/.test(shaped));
  for (const k of ['pan', 'bank_account', 'Aadhaar_Number']) assert.ok(!(k in JSON.parse(shaped)), k);
  for (const role of ['ir', 'ir_manager', 'kam', 'digital_infrastructure']) {
    for (const f of ['pan', 'bank_account', 'aadhaar_ref']) assert.ok(!register.find((r) => r.field === 'Contacts.' + f).readers.includes(role), `${role} reads ${f}`);
    assert.ok(!id.canReveal(role, 'pan') && !id.canReveal(role, 'bank_account'), role);
    assert.throws(() => id.revealFields(role, 'pan'), role);
  }
  assert.deepEqual(register.find((r) => r.field === 'Contacts.Aadhaar_Number').readers, [], 'full Aadhaar is hidden from every profile');
  assert.ok(id.canReveal('head_of_finance', 'pan') && id.canReveal('finance', 'bank_account') && id.canReveal('compliance', 'pan'));
});
test('TC-IM04-020 (KAM book never selects identity): proved by src/server/investors/book.test.cjs noSensitiveSelect', () => {
  assert.match(fs.readFileSync(path.join(consoleRoot, 'src', 'server', 'investors', 'book.test.cjs'), 'utf8'), /noSensitiveSelect\(/);
});
for (const c of ['TC-E02-007', 'TC-IM02-017', 'TC-IM04-020', 'TC-IM11-002']) {
  test(`${c} (Zoho half)`, { skip: 'needs sandbox: a restricted test-user token against the real field-level security wall (T11, M02-S05)' }, () => {});
}
for (const c of ['TC-E02-008', 'TC-E02-009']) {
  test(`${c} (Zoho half)`, { skip: 'needs sandbox: Private sharing and the role hierarchy are Zoho settings, provable only with test-user tokens' }, () => {});
}
