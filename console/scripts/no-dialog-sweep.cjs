/* M01-S07-T06 no-dialog sweep: reads Jev runner result files (autopilot/<queue>/results/*.json or the paths given) and reports every
   case where the runner saw a native browser dialog (pm/jev-ui-runner.mjs records "native dialog: <text>" in `errors`, dismisses it
   and fails the case). Exit 1 if any, so a whole-suite run can be gated on it.
   node scripts/no-dialog-sweep.cjs [result.json | dir ...] */
'use strict';
const fs = require('node:fs'); const path = require('node:path');

function sweep(files) {
  const found = []; let cases = 0;
  for (const f of files) {
    let j; try { j = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { continue; }
    for (const r of j.results || []) {
      cases++;
      for (const e of r.errors || []) if (/^native dialog:/.test(e)) found.push({ file: path.basename(f), id: r.id, error: e });
    }
  }
  return { cases, found };
}
function expand(args) {
  const out = [];
  for (const a of args) {
    if (!fs.existsSync(a)) continue;
    if (fs.statSync(a).isDirectory()) for (const f of fs.readdirSync(a)) { if (f.endsWith('.json')) out.push(path.join(a, f)); }
    else out.push(a);
  }
  return out;
}
module.exports = { sweep, expand };
if (require.main === module) {
  const args = process.argv.slice(2); const files = expand(args.length ? args : [path.resolve(__dirname, '..', '..', 'autopilot', 'console', 'results')]);
  const { cases, found } = sweep(files);
  for (const x of found) console.error(`DIALOG ${x.id} (${x.file}): ${x.error}`);
  console.log(`no-dialog sweep: ${cases} case results in ${files.length} file(s), ${found.length} native dialog(s)`);
  process.exit(found.length ? 1 : 0);
}
