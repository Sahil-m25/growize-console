/* node --test scripts/no-dialog-sweep.test.cjs — M01-S07-T06. */
'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { sweep, expand } = require('./no-dialog-sweep.cjs');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'nds-'));

test('reports a native dialog seen by the runner and ignores other page errors', () => {
  const d = tmp();
  fs.writeFileSync(path.join(d, 'a.json'), JSON.stringify({ results: [
    { id: 'TC-A', errors: [] }, { id: 'TC-B', errors: ['native dialog: Un-tick?'] }, { id: 'TC-C', errors: ['TypeError: x'] }] }));
  fs.writeFileSync(path.join(d, 'junk.json'), 'not json');
  const r = sweep(expand([d]));
  assert.equal(r.cases, 3); assert.deepEqual(r.found.map(x => x.id), ['TC-B']);
});
test('a clean run reports nothing', () => {
  const d = tmp(); fs.writeFileSync(path.join(d, 'a.json'), JSON.stringify({ results: [{ id: 'TC-A', errors: [] }] }));
  assert.equal(sweep(expand([d])).found.length, 0);
});
test('the runner still dismisses and records native dialogs as errors (the thing this sweep reads)', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', '..', 'pm', 'jev-ui-runner.mjs'), 'utf8');
  assert.match(src, /page\.on\("dialog",\s*d => \{ errors\.push\("native dialog: "/);
  assert.match(src, /errors\.length \? "FAIL"/);
});
