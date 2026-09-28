/* M10-S01-T02 / M18-S12-T01 — move the legacy Amount_n/UTR_n/Date_n payments into Receipts.
 *
 * Runs on the acting human's OWN Zoho access token (D53; Sahil's), never a service or admin token.
 * The same script serves the sandbox dry run (M18-S12-T02) and production (M18-S12 AC4).
 *
 *   ZOHO_ACCESS_TOKEN=… ZOHO_API_DOMAIN=https://www.zohoapis.in ZOHO_RECORD_PREFIX=1169101000 \
 *     node scripts/migrate-legacy-payments.cjs --source allotments --modes ./modes.json [--commit]
 *
 * --source   allotments (LLP_UnitAllocation_Module, the as-found home) or contacts (M18-S12's wording)
 * --modes    a JSON file {"<UTR>": "NEFT|RTGS|IMPS|SWIFT|UPI|Cheque"} supplied by Finance; kept off the repo
 * --slots    optional JSON file [{"amount":"Amount_1","utr":"UTR","date":"Date_1"}, …] when live names differ
 * --commit   write; without it the run plans and reconciles only (dry run)
 * Prints the report: record ids, counts and reason codes only (no amounts, UTRs or names).
 */
'use strict';
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const consoleRoot = path.resolve(__dirname, '..'); const srcRoot = path.join(consoleRoot, 'src');
const ts = require(path.join(consoleRoot, 'node_modules', 'typescript'));

const args = process.argv.slice(2); const arg = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const source = arg('--source'); const modesFile = arg('--modes'); const slotsFile = arg('--slots'); const commit = args.includes('--commit');
const token = process.env.ZOHO_ACCESS_TOKEN; const apiDomain = process.env.ZOHO_API_DOMAIN || 'https://www.zohoapis.in'; const prefix = process.env.ZOHO_RECORD_PREFIX;
if (!['allotments', 'contacts'].includes(source) || !modesFile || !token || !prefix) {
  console.error('usage: ZOHO_ACCESS_TOKEN=… ZOHO_RECORD_PREFIX=… node scripts/migrate-legacy-payments.cjs --source allotments|contacts --modes modes.json [--slots slots.json] [--commit]');
  process.exit(2);
}

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-pay-'));
process.on('exit', () => fs.rmSync(outDir, { recursive: true, force: true }));
const cfg = ts.parseJsonConfigFileContent(ts.readConfigFile(path.join(consoleRoot, 'tsconfig.json'), ts.sys.readFile).config, ts.sys, consoleRoot);
const program = ts.createProgram(['lib/zoho/errors.ts', 'lib/zoho/gate.ts', 'lib/zoho/log.ts', 'lib/zoho/client.ts', 'server/money/migrate-legacy.ts'].map((f) => path.join(srcRoot, f)),
  { ...cfg.options, incremental: false, tsBuildInfoFile: undefined, plugins: undefined, module: ts.ModuleKind.CommonJS,
    moduleResolution: ts.ModuleResolutionKind.Node10, noEmit: false, noEmitOnError: true, outDir, rootDir: srcRoot });
const diags = [...ts.getPreEmitDiagnostics(program), ...program.emit().diagnostics];
if (diags.length) { console.error(ts.formatDiagnostics(diags, { getCanonicalFileName: (f) => f, getCurrentDirectory: () => consoleRoot, getNewLine: () => '\n' })); process.exit(1); }
const load = (f) => require(path.join(outDir, f));
const { createGate } = load('lib/zoho/gate.js'); const { createOpsLog, createMemorySink } = load('lib/zoho/log.js');
const { createZohoClient, userCredential } = load('lib/zoho/client.js'); const { createLegacyPaymentMigration } = load('server/money/migrate-legacy.js');

(async () => {
  const gate = createGate(); const sink = createMemorySink(); const log = createOpsLog(sink);
  const cred = await userCredential({ access_token: token, api_domain: apiDomain, expires_in: 3600 }, { recordIdPrefix: prefix, gate, log });
  const crm = createZohoClient({ recordIdPrefix: prefix, gate, log });
  const modes = JSON.parse(fs.readFileSync(modesFile, 'utf8'));
  const slots = slotsFile ? JSON.parse(fs.readFileSync(slotsFile, 'utf8')) : undefined;
  const res = await createLegacyPaymentMigration({ crm, log, recordIdPrefix: prefix }).run(cred, { source, modes, commit, slots });
  console.log(JSON.stringify(res, null, 1));
  process.exit(res.ok && res.value.status === 'done' ? 0 : 1);
})().catch((e) => { console.error(`failed: ${e && e.name ? e.name : 'error'}`); process.exit(1); });
