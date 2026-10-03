/* TC-IM01-001 (M01-S01-T08): the shell loads offline, in standards mode, with its own font and one main landmark.
   Run from console/:  node src/app/shell-offline.test.cjs
   Static checks on the source the shell is built from (the old portal's `embed-design-tokens.cjs --check` fence has no counterpart here:
   Inter is embedded in console.css itself). If APP_URL is set, the served page is checked too. */
'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const src = path.resolve(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(src, ...p), 'utf8');
const walk = (d, o = []) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p, o); else if (/\.(tsx?|css)$/.test(f.name) && !/\.test\./.test(f.name)) o.push(p); } return o; };

test('no source links a font host or any remote stylesheet', () => {
  for (const f of walk(src)) {
    const t = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(t), path.relative(src, f));
  }
  assert.ok(!/@import\s+url\(\s*['"]?https?:/.test(read('app', 'console.css')));
});
test('Inter is embedded as a data: URL in console.css', () => {
  const css = read('app', 'console.css');
  assert.match(css, /@font-face\{font-family:'Inter'[^}]*src:url\(data:font\/woff2;base64,/);
});
test('the document is standards mode, English (India), with no <head> links to remote hosts', () => {
  const l = read('app', 'layout.tsx');
  assert.match(l, /<html lang="en-IN"/);
  assert.ok(!/<link[^>]+href="https?:/.test(l));
  assert.ok(!/quirks|<!doctype\s+[^h]/i.test(l)); // Next emits <!DOCTYPE html>
});
test('exactly one <main>; the aria-live regions are the two known ones (#live, #save-status)', () => {
  const mains = walk(src).filter((f) => /\.tsx$/.test(f)).flatMap((f) => (fs.readFileSync(f, 'utf8').match(/<main[\s>]/g) || []).map(() => f));
  assert.equal(mains.length, 1, mains.join(','));
  const live = walk(src).filter((f) => /\.tsx$/.test(f)).flatMap((f) => [...fs.readFileSync(f, 'utf8').matchAll(/aria-live="/g)].map(() => path.basename(f)));
  /* PROVISIONAL (M01-S01): the case says "one aria-live region" (old portal); the merged shell has the status line and the save-status
     line (M01-S08). Both are polite, one each. */
  assert.deepEqual(live.filter((f) => /^(Live|TopBar)\.tsx$/.test(f)).sort(), ['Live.tsx', 'TopBar.tsx']);
});
test('served page (only when APP_URL is set)', { skip: !process.env.APP_URL && 'APP_URL not set' }, async () => {
  const html = await (await fetch(process.env.APP_URL)).text();
  assert.match(html, /^<!DOCTYPE html>/i);
  assert.ok(!/fonts\.googleapis\.com/.test(html));
});
