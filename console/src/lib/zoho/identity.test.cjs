/* IDENTITY WALL REGRESSION (M02-S04). Run from console/:  node src/lib/zoho/identity.test.cjs */
'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const consoleRoot = path.resolve(__dirname, '..', '..', '..');
const ts = require(path.join(consoleRoot, 'node_modules', 'typescript'));
const src = fs.readFileSync(path.join(__dirname, 'identity.ts'), 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const m = { exports: {} };
new Function('module', 'exports', js)(m, m.exports);
const id = m.exports;

test('record GET never asks for identity fields', () => {
  assert.deepEqual(id.safeFields(['Last_Name', 'pan', 'bank_account', 'Aadhaar_Number', 'aadhaar_last4']), ['Last_Name', 'aadhaar_last4']);
});
test('shaper returns masked forms only', () => {
  const o = id.shapeIdentity({ Last_Name: 'Bhat', pan: 'AFTPB1234L', bank_account: '000012341208', Aadhaar_Number: '1111 2222 5561' });
  assert.equal(o.pan_masked, 'AFT•••••L');
  assert.equal(o.bank_masked, '•••• •••• 1208');
  assert.equal(o.aadhaar_masked, '•••• •••• 5561');
  assert.ok(!/AFTPB1234L|000012341208|1111/.test(JSON.stringify(o)));
});
test('reveal rights per seat', () => {
  assert.ok(id.canReveal('head_of_finance', 'pan') && id.canReveal('head_of_finance', 'bank_account'));
  assert.ok(id.canReveal('compliance', 'pan') && !id.canReveal('compliance', 'bank_account'));
  assert.ok(id.canReveal('finance', 'bank_account') && !id.canReveal('finance', 'pan'));
  for (const r of ['ir', 'ir_manager', 'kam', 'viewer', 'auditor']) assert.ok(!id.canReveal(r, 'pan') && !id.canReveal(r, 'bank_account'));
  assert.deepEqual(id.revealFields('compliance', 'pan'), ['pan']);
  assert.throws(() => id.revealFields('kam', 'pan'));
  assert.throws(() => id.revealFields('head_of_finance', 'Aadhaar_Number'));
});
test('safeNote masks by seat', () => {
  const n = 'PAN AFTPB1234L acct 000012341208 aadhaar 1111 2222 5561';
  const kam = id.safeNote(n, 'kam');
  assert.ok(!/AFTPB1234L|000012341208|1111 2222/.test(kam));
  assert.ok(id.safeNote(n, 'compliance').includes('000012341208') === false);
  assert.ok(id.safeNote(n, 'compliance').includes('AFTPB1234L'));
});
test('field register: one writer, never also a plain reader-only clash', () => {
  const reg = JSON.parse(fs.readFileSync(path.join(consoleRoot, '..', 'zoho', 'field-register.json'), 'utf8')).fields;
  for (const g of ['supp_verified_at', 'advance_confirmed_at', 'balance_confirmed_at', 'allotted_at', 'account_opened_at'])
    assert.equal(reg.filter((f) => f.field === 'Leads.' + g).length, 1, g);
  for (const f of reg) assert.equal(typeof f.writer, 'string', f.field);
  assert.ok(!reg.find((f) => f.field === 'Contacts.pan').readers.includes('finance'));
  assert.deepEqual(reg.find((f) => f.field === 'Contacts.Aadhaar_Number').readers, []);
});
