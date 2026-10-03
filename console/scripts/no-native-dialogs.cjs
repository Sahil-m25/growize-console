/* M01-S07-T04 grep gate: no native browser dialog in app code. `alert(`, `confirm(`, `prompt(` called on window / globalThis,
   or called bare where the file does not itself bind that name (the Investors reducers bind local `alert`/`confirm` that write
   a note into state; the cases hook binds `confirm` from useApiWrite). Comments and string literals are ignored. Exit 1 on any hit.
   node scripts/no-native-dialogs.cjs [dir ...]   (default: src, tests excluded) */
'use strict';
const fs = require('node:fs'); const path = require('node:path');
const NAMES = ['alert', 'confirm', 'prompt'];

function strip(src) {   // blank out comments and string/template literal bodies, keep newlines so line numbers hold
  let out = '', i = 0; const n = src.length;
  const blank = (s) => s.replace(/[^\n]/g, ' ');
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { let j = src.indexOf('\n', i); if (j < 0) j = n; out += blank(src.slice(i, j)); i = j; }
    else if (c === '/' && d === '*') { let j = src.indexOf('*/', i + 2); j = j < 0 ? n : j + 2; out += blank(src.slice(i, j)); i = j; }
    else if (c === '"' || c === "'" || c === '`') {
      let j = i + 1; while (j < n && src[j] !== c) { if (src[j] === '\\') j++; j++; }
      out += c + blank(src.slice(i + 1, j)) + c; i = j + 1;
    } else { out += c; i++; }
  }
  return out;
}

function scan(src) {
  const code = strip(src); const hits = [];
  for (const name of NAMES) {
    const bound = new RegExp('(?:\\b(?:const|let|var|function)\\s+(?:\\{[^}]*\\b)?' + name + '\\b)|(?:\\b' + name + '\\s*[:=]\\s*(?:async\\s*)?\\()').test(code);
    const re = new RegExp('(?<![\\w$.])' + name + '\\s*\\(', 'g'); let m;
    while ((m = re.exec(code))) {
      const before = code.slice(Math.max(0, m.index - 12), m.index);
      if (/\b(?:async|function|get|set)\s+$/.test(before)) continue;   // a declaration, not a call
      if (bound) continue;
      hits.push({ line: code.slice(0, m.index).split('\n').length, call: name + '(' });
    }
    const w = new RegExp('\\b(?:window|globalThis|self|top)\\s*\\.\\s*' + name + '\\s*\\(', 'g');
    while ((m = w.exec(code))) hits.push({ line: code.slice(0, m.index).split('\n').length, call: m[0].replace(/\s+/g, '') });
  }
  return hits.sort((a, b) => a.line - b.line);
}

function walk(d, files = []) {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) { if (!/^(node_modules|\.next.*|__fixtures__)$/.test(f.name)) walk(p, files); }
    else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(f.name) && !/\.test\.[a-z]+$/.test(f.name)) files.push(p);
  }
  return files;
}

function run(dirs) {
  const bad = [];
  for (const d of dirs) for (const f of walk(d)) for (const h of scan(fs.readFileSync(f, 'utf8'))) bad.push(`${path.relative(process.cwd(), f)}:${h.line} ${h.call}`);
  return bad;
}

module.exports = { scan, strip, run };
if (require.main === module) {
  const dirs = process.argv.slice(2); const bad = run(dirs.length ? dirs : [path.resolve(__dirname, '..', 'src')]);
  if (bad.length) { console.error('native dialog call(s) found (M01-S07-T04):\n  ' + bad.join('\n  ')); process.exit(1); }
  console.log('no native dialogs: 0 hits');
}
