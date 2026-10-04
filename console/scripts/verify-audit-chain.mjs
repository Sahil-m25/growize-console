#!/usr/bin/env node
/* Verify Plane C's hash chain for one UTC day, offline (docs/architecture/log-sink.md).
 *
 *   node scripts/verify-audit-chain.mjs --dir <LOG_DIR> --day 2026-10-03 [--anchor <hex>] [--json]
 *       the file sink: <LOG_DIR>/identity-<day>.jsonl
 *   node scripts/verify-audit-chain.mjs --segments <mirror> --day 2026-10-03 [--anchor <hex>] [--json]
 *       a local copy of the Stratus bucket: <mirror>/growize-logs/identity/<day>/<instance>/<seq>.jsonl + .manifest.json
 *
 * Exit 0 intact · 1 broken (each problem printed: edited, deleted, reordered, broken-link, unchained, segment-edited,
 * segment-missing, unsealed, manifest-mismatch, anchor-mismatch) · 2 usage or unreadable input.
 * The check is src/server/logs/chain.ts itself, transpiled on the fly, so the script and the System check never drift.
 * Prints chain ids, line numbers and hashes only — never a line's content. */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const consoleRoot = path.resolve(here, '..');
const require = createRequire(import.meta.url);

function loadChain() {
  const ts = require(path.join(consoleRoot, 'node_modules', 'typescript'));
  const src = fs.readFileSync(path.join(consoleRoot, 'src', 'server', 'logs', 'chain.ts'), 'utf8');
  const out = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gz-chain-')), 'chain.cjs');
  fs.writeFileSync(file, out);
  try { return require(file); } finally { fs.rmSync(path.dirname(file), { recursive: true, force: true }); }
}

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const day = opt('--day');
const dir = opt('--dir');
const mirror = opt('--segments');
const anchor = opt('--anchor') ?? null;
const usage = () => { console.error('usage: verify-audit-chain.mjs (--dir <LOG_DIR> | --segments <mirror>) --day YYYY-MM-DD [--anchor <hex>] [--json]'); process.exit(2); };
if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day) || (!dir === !mirror)) usage();

const parse = (text) => text.split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
const sha256 = (b) => createHash('sha256').update(b).digest('hex');

const segments = [];
if (dir) {
  const f = path.join(path.resolve(dir), `identity-${day}.jsonl`);
  if (!fs.existsSync(f)) { console.error(`no Plane C file for ${day} in ${dir}`); process.exit(2); }
  segments.push({ key: path.basename(f), manifest: null, lines: parse(fs.readFileSync(f, 'utf8')), problem: null });
} else {
  const base = path.join(path.resolve(mirror), 'growize-logs', 'identity', day);
  if (!fs.existsSync(base)) { console.error(`no Plane C segments for ${day} under ${mirror}`); process.exit(2); }
  for (const inst of fs.readdirSync(base).sort()) {
    const d = path.join(base, inst);
    const seqs = [...new Set(fs.readdirSync(d).map((n) => /^(\d{6})\./.exec(n)?.[1]).filter(Boolean))].sort();
    for (const seq of seqs) {
      const data = path.join(d, `${seq}.jsonl`), man = path.join(d, `${seq}.manifest.json`);
      let manifest = null;
      try { manifest = fs.existsSync(man) ? JSON.parse(fs.readFileSync(man, 'utf8')) : null; } catch { manifest = null; }
      if (!fs.existsSync(data)) { segments.push({ key: data, manifest, lines: [], problem: 'unreadable' }); continue; }
      const body = fs.readFileSync(data);
      if (!manifest) segments.push({ key: data, manifest: null, lines: parse(body.toString('utf8')), problem: 'unsealed' });
      else if (sha256(body) !== manifest.sha256) segments.push({ key: data, manifest, lines: [], problem: 'segment-edited' });
      else segments.push({ key: data, manifest, lines: parse(body.toString('utf8')), problem: null });
    }
  }
}

const { verifyChain } = loadChain();
const v = verifyChain(segments, { day, anchor });
if (args.includes('--json')) console.log(JSON.stringify(v, null, 2));
else {
  console.log(`${day}: ${v.ok ? 'INTACT' : 'BROKEN'} — ${v.lines} lines in ${v.chains} chain(s); anchor ${v.anchor}`);
  for (const p of v.problems) console.log(`  ${p.kind}${p.chain ? ` chain ${p.chain}` : ''}${p.at !== null ? ` at ${p.at}` : ''}`);
}
process.exit(v.ok ? 0 : 1);
