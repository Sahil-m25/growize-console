/* node --test scripts/no-native-dialogs.test.cjs — M01-S07-T04 grep gate. */
'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const path = require('node:path'); const { scan, run } = require('./no-native-dialogs.cjs');

test('flags window.confirm, bare alert and prompt', () => {
  assert.equal(scan('if (!window.confirm("x")) return;').length, 1);
  assert.equal(scan('function f(){\n alert("no");\n}').length, 1);
  assert.equal(scan('const a = prompt ("name");').length, 1);
  assert.equal(scan('globalThis.alert("x")').length, 1);
});
test('ignores comments, strings, methods and locally bound names', () => {
  assert.equal(scan('// alert("x")\n/* confirm( */ const s = "alert(1)";').length, 0);
  assert.equal(scan('x.confirm(1); c.alert("m"); api.prompt(2)').length, 0);
  assert.equal(scan('async confirm(a) { return 1 }').length, 0);
  assert.equal(scan('const alert = (m) => note(m);\nalert("x");').length, 0);
  assert.equal(scan('const confirm = useApiWrite(ep);\nvoid confirm({});').length, 0);
});
test('the app source has zero native dialogs', () => {
  assert.deepEqual(run([path.resolve(__dirname, '..', 'src')]), []);
});
