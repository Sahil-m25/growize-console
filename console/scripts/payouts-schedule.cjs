/* M10-S20-T02 — the payouts schedule job from the command line (D82): fills the missing ones of each Issued
 * allotment's 60 monthly Investor_Payouts, never a duplicate (it re-reads what exists before any insert).
 *
 * Runs on the acting person's OWN Zoho access token (D53) — a Finance "pay" user's — never a service token.
 *
 *   ZOHO_ACCESS_TOKEN=… ZOHO_API_DOMAIN=https://www.zohoapis.in ZOHO_RECORD_PREFIX=1169101000 \
 *     node scripts/payouts-schedule.cjs --allotments <id>[,<id>…] | --file ids.txt  [--commit]
 *
 * Without --commit the run plans only (reads, no write). Up to 100 allotment ids a run.
 * Prints per-allotment status and counts only (no amounts, no names). Exit 0 when nothing failed.
 */
'use strict';
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const consoleRoot = path.resolve(__dirname, '..'); const srcRoot = path.join(consoleRoot, 'src');
const ts = require(path.join(consoleRoot, 'node_modules', 'typescript'));

const args = process.argv.slice(2); const arg = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const commit = args.includes('--commit');
const list = arg('--allotments'); const file = arg('--file');
const ids = [...(list ? list.split(',') : []), ...(file ? fs.readFileSync(file, 'utf8').split(/\s+/) : [])].map((s) => s.trim()).filter(Boolean);
const token = process.env.ZOHO_ACCESS_TOKEN; const apiDomain = process.env.ZOHO_API_DOMAIN || 'https://www.zohoapis.in'; const prefix = process.env.ZOHO_RECORD_PREFIX;
if (!ids.length || ids.length > 100 || !token || !prefix) {
  console.error('usage: ZOHO_ACCESS_TOKEN=… ZOHO_RECORD_PREFIX=… node scripts/payouts-schedule.cjs --allotments id1,id2 | --file ids.txt [--commit]  (1–100 ids)');
  process.exit(2);
}

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'payouts-schedule-'));
process.on('exit', () => fs.rmSync(outDir, { recursive: true, force: true }));
const cfg = ts.parseJsonConfigFileContent(ts.readConfigFile(path.join(consoleRoot, 'tsconfig.json'), ts.sys.readFile).config, ts.sys, consoleRoot);
const program = ts.createProgram(['lib/zoho/gate.ts', 'lib/zoho/log.ts', 'lib/zoho/client.ts', 'server/payouts/schedule.ts'].map((f) => path.join(srcRoot, f)),
  { ...cfg.options, incremental: false, tsBuildInfoFile: undefined, plugins: undefined, module: ts.ModuleKind.CommonJS,
    moduleResolution: ts.ModuleResolutionKind.Node10, noEmit: false, noEmitOnError: true, outDir, rootDir: srcRoot });
const diags = [...ts.getPreEmitDiagnostics(program), ...program.emit().diagnostics];
if (diags.length) { console.error(ts.formatDiagnostics(diags, { getCanonicalFileName: (f) => f, getCurrentDirectory: () => consoleRoot, getNewLine: () => '\n' })); process.exit(1); }
const Module = require('node:module');
process.env.NODE_PATH = path.join(consoleRoot, 'node_modules'); Module._initPaths();
const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) { return resolveFilename.call(this, request.startsWith('@/') ? path.join(outDir, request.slice(2)) : request, ...rest); };
const load = (f) => require(path.join(outDir, f));
const { createGate } = load('lib/zoho/gate.js'); const { createOpsLog, createMemorySink } = load('lib/zoho/log.js');
const { createZohoClient, userCredential } = load('lib/zoho/client.js'); const { createPayoutScheduleJob } = load('server/payouts/schedule.js');

(async () => {
  const gate = createGate(); const log = createOpsLog(createMemorySink());
  const cred = await userCredential({ access_token: token, api_domain: apiDomain, expires_in: 3600 }, { recordIdPrefix: prefix, gate, log });
  const crm = createZohoClient({ recordIdPrefix: prefix, gate, log });
  const res = await createPayoutScheduleJob({ crm, log, recordIdPrefix: prefix }).run(cred, ids, { commit });
  console.log(JSON.stringify({ commit, ...res }, null, 1));
  process.exit(res.ok && !res.outcomes.some((o) => o.status === 'failed') ? 0 : 1);
})().catch((e) => { console.error(`failed: ${e && e.name ? e.name : 'error'}`); process.exit(1); });
