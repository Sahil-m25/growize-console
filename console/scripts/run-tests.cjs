/* npm test (D101): run every *.test.cjs under src/ in its own `node --test` process, so one file that aborts
   cannot cancel the others. Cancelled tests count as failures. Exit 1 if anything failed or was cancelled. */
'use strict';
const { spawnSync } = require('node:child_process'); const fs = require('node:fs'); const path = require('node:path');
const root = path.resolve(__dirname, '..'); const files = [];
(function walk(d) { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name);
  if (f.isDirectory()) { if (!/node_modules|\.next/.test(f.name)) walk(p); } else if (/\.test\.cjs$/.test(f.name)) files.push(p); } })(path.join(root, 'src'));
const only = process.argv.slice(2); let bad = 0; const tot = { pass: 0, fail: 0, cancelled: 0 };
for (const f of files.filter(f => !only.length || only.some(o => f.includes(o)))) {
  const r = spawnSync(process.execPath, ['--test', f], { cwd: root, encoding: 'utf8', timeout: 300000 });
  const n = k => +((r.stdout.match(new RegExp('^# ' + k + ' (\\d+)', 'm')) || [])[1] || 0);
  const s = { pass: n('pass'), fail: n('fail'), cancelled: n('cancelled') }; for (const k in s) tot[k] += s[k];
  const ok = r.status === 0 && !s.fail && !s.cancelled; if (!ok) bad++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${path.relative(root, f)}  pass ${s.pass} fail ${s.fail} cancelled ${s.cancelled}`);
  if (!ok) console.log((r.stdout || '').split('\n').filter(l => /^not ok|error:|failureType/.test(l.trim())).slice(0, 8).map(l => '     ' + l.trim()).join('\n'));
}
console.log(`\n${files.length} files · pass ${tot.pass} · fail ${tot.fail} · cancelled ${tot.cancelled}`);
process.exit(bad ? 1 : 0);
