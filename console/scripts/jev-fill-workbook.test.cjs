/* node --test console/scripts/jev-fill-workbook.test.cjs — M19-S02-T03 workbook filler on a generated sample workbook. */
'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path'); const { spawnSync } = require('node:child_process');
const L = require('./jev-lib.cjs');
const py = (code, args = []) => spawnSync('python3', ['-c', code, ...args], { encoding: 'utf8' });
const HAVE = py('import openpyxl').status === 0;
const SCRIPT = path.join(__dirname, 'jev-fill-workbook.py');

const MAKE = `
import openpyxl, sys
wb = openpyxl.Workbook(); wb.active.title = 'Read me'; ws = wb.create_sheet('Test cases')
ws.append(['Test','Title','Jev result','Jev p','Facts below 0.80','Tester result','Result','Run date','Notes'])
ws.append(['TC-A-001','a','—',None,None,'Not run','=IF(F2<>"Not run",F2,C2)',None,'keep'])
ws.append(['TC-A-002','b','PASS',0.9,None,'Pass','=IF(F3<>"Not run",F3,C3)',None,'keep'])
ws.append(['TC-A-003','c','—',None,None,'Not run','=IF(F4<>"Not run",F4,C4)',None,'untouched'])
wb.save(sys.argv[1])`;
const READ = `
import openpyxl, sys, json
ws = openpyxl.load_workbook(sys.argv[1])['Test cases']
print(json.dumps([[c.value for c in r] for r in ws.iter_rows()], default=str))`;

test('fills Jev columns by id, keeps formulas and other columns, reports missing ids without adding them', { skip: !HAVE && 'openpyxl not installed' }, () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'jevwb-')); const wb = path.join(d, 'w.xlsx'), out = path.join(d, 'o.xlsx'), csv = path.join(d, 'r.csv');
  assert.equal(py(MAKE, [wb]).status, 0);
  const rows = L.resultRows({ ran: '2026-09-28T06:00:00Z', results: [
    { id: 'TC-A-001', verdict: 'REVIEW', p: 0.5, facts: [{ fact: 'x, "y"', p: 0.5 }] },
    { id: 'TC-A-002', verdict: 'FAIL', p: 0.02, facts: [{ fact: 'z', p: 0.02 }] },
    { id: 'TC-NOPE-9', verdict: 'PASS', p: 0.99, facts: [] }] });
  fs.writeFileSync(csv, L.toCsv(rows));
  const r = spawnSync('python3', [SCRIPT, csv, wb, '--out', out], { encoding: 'utf8' });
  assert.equal(r.status, 1, r.stderr);   // a CSV id is missing from the sheet
  const s = JSON.parse(r.stdout);
  assert.equal(s.filled, 2); assert.deepEqual(s.missing_in_sheet, ['TC-NOPE-9']);
  const t = JSON.parse(py(READ, [out]).stdout);
  assert.equal(t.length, 4);   // no row invented for TC-NOPE-9
  assert.deepEqual(t[1].slice(0, 5), ['TC-A-001', 'a', 'REVIEW', 0.5, '0.50 x, "y"']);
  assert.equal(t[1][6], '=IF(F2<>"Not run",F2,C2)'); assert.match(t[1][7], /^2026-09-28/); assert.equal(t[1][8], 'keep');
  assert.deepEqual(t[2].slice(2, 6), ['FAIL', 0.02, '0.02 z', 'Pass']);
  assert.deepEqual(t[3].slice(2, 5), ['—', null, null]); assert.equal(t[3][7], null);
  assert.equal(py(READ, [wb]).stdout.includes('REVIEW'), false);   // source untouched with --out
});

test('PASS with no failing facts writes an em dash; duplicate ids reported, last wins; all found -> exit 0', { skip: !HAVE && 'openpyxl not installed' }, () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'jevwb-')); const wb = path.join(d, 'w.xlsx'), csv = path.join(d, 'r.csv');
  assert.equal(py(MAKE, [wb]).status, 0);
  fs.writeFileSync(csv, L.toCsv(L.resultRows({ ran: '2026-09-28T00:00:00Z', results: [
    { id: 'TC-A-003', verdict: 'FAIL', p: 0.01, facts: [] }, { id: ' TC-A-003', verdict: 'PASS', p: 0.95, facts: [{ fact: 'ok', p: 0.95 }] }] })));
  const r = spawnSync('python3', [SCRIPT, csv, wb, '--in-place'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.deepEqual(JSON.parse(r.stdout).duplicate_ids_in_csv, ['TC-A-003']);
  assert.deepEqual(JSON.parse(py(READ, [wb]).stdout)[3].slice(2, 5), ['PASS', 0.95, '—']);
});

test('refuses a workbook without the Jev columns', { skip: !HAVE && 'openpyxl not installed' }, () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'jevwb-')); const wb = path.join(d, 'w.xlsx'), csv = path.join(d, 'r.csv');
  py("import openpyxl,sys\nwb=openpyxl.Workbook();ws=wb.active;ws.title='Test cases';ws.append(['Test','Title']);wb.save(sys.argv[1])", [wb]);
  fs.writeFileSync(csv, 'id,verdict\r\nTC-1,PASS\r\n');
  const r = spawnSync('python3', [SCRIPT, csv, wb, '--out', path.join(d, 'o.xlsx')], { encoding: 'utf8' });
  assert.notEqual(r.status, 0); assert.match(r.stderr, /missing columns/);
});
