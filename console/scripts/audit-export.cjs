/* M15-S03-T01 — the nightly audit export, run by the scheduler (cron / the hosting platform's job runner).
 *
 * Requests the Zoho org audit log export for one Asia/Kolkata day (default: yesterday), polls, downloads,
 * and seals it in the local append-only archive (src/server/activity/archive.ts). Runs on the audit-archive
 * SERVICE token (D53: background work), never a person's.
 *
 *   ZOHO_ACCOUNTS_ORIGIN=https://accounts.zoho.in ZOHO_OAUTH_CLIENT_ID=… ZOHO_OAUTH_CLIENT_SECRET=… \
 *   ZOHO_AUDIT_ARCHIVE_REFRESH_TOKEN=… AUDIT_ARCHIVE_DIR=/abs/dir node scripts/audit-export.cjs [--day YYYY-MM-DD]
 *
 * Prints one line: the day, the row count or a short failure code. Exit 1 on failure — the scheduler's
 * heartbeat (ops/runbooks/heartbeat-silent.md) is what alerts when the app is not the one running it.
 */
'use strict';
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const consoleRoot = path.resolve(__dirname, '..'); const srcRoot = path.join(consoleRoot, 'src');
const ts = require(path.join(consoleRoot, 'node_modules', 'typescript'));
const args = process.argv.slice(2); const i = args.indexOf('--day'); const day = i >= 0 ? args[i + 1] : undefined;
const need = ['ZOHO_OAUTH_CLIENT_ID', 'ZOHO_OAUTH_CLIENT_SECRET', 'ZOHO_AUDIT_ARCHIVE_REFRESH_TOKEN', 'AUDIT_ARCHIVE_DIR'].filter((k) => !process.env[k]);
if (need.length || (day !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(day))) { console.error(`usage: set ${need.join(', ') || 'the env'}; node scripts/audit-export.cjs [--day YYYY-MM-DD]`); process.exit(2); }

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-export-'));
process.on('exit', () => fs.rmSync(outDir, { recursive: true, force: true }));
const cfg = ts.parseJsonConfigFileContent(ts.readConfigFile(path.join(consoleRoot, 'tsconfig.json'), ts.sys.readFile).config, ts.sys, consoleRoot);
const program = ts.createProgram(['lib/zoho/log.ts', 'server/oauth/service-token.ts', 'server/activity/archive.ts', 'server/activity/export-job.ts'].map((f) => path.join(srcRoot, f)),
  { ...cfg.options, incremental: false, tsBuildInfoFile: undefined, plugins: undefined, module: ts.ModuleKind.CommonJS,
    moduleResolution: ts.ModuleResolutionKind.Node10, noEmit: false, noEmitOnError: true, outDir, rootDir: srcRoot });
const diags = [...ts.getPreEmitDiagnostics(program), ...program.emit().diagnostics];
if (diags.length) { console.error(ts.formatDiagnostics(diags, { getCanonicalFileName: (f) => f, getCurrentDirectory: () => consoleRoot, getNewLine: () => '\n' })); process.exit(1); }
const load = (f) => require(path.join(outDir, f));
const { createOpsLog, createMemorySink } = load('lib/zoho/log.js');
const { createServiceTokenProvider } = load('server/oauth/service-token.js');
const { createLocalAuditArchive } = load('server/activity/archive.js');
const { createZohoAuditExportSource, fetchUserDirectory, runAuditExport } = load('server/activity/export-job.js');

const net = async (url, init) => { const r = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(60_000) }); return { status: r.status, text: () => r.text(), arrayBuffer: () => r.arrayBuffer() }; };

(async () => {
  let code = 'unexpected';
  try {
    const provider = createServiceTokenProvider({ job: 'audit-archive', accountsOrigin: process.env.ZOHO_ACCOUNTS_ORIGIN || 'https://accounts.zoho.in',
      clientId: process.env.ZOHO_OAUTH_CLIENT_ID, clientSecret: process.env.ZOHO_OAUTH_CLIENT_SECRET, refreshToken: process.env.ZOHO_AUDIT_ARCHIVE_REFRESH_TOKEN,
      expectedApiDomain: 'https://www.zohoapis.in', log: createOpsLog(createMemorySink()) });
    code = 'token-unavailable';
    const credential = await provider.credential();
    code = 'users-unavailable';
    const userIdOf = await fetchUserDirectory({ credential, fetch: net });
    const r = await runAuditExport({ source: createZohoAuditExportSource({ credential, fetch: net }), archive: createLocalAuditArchive({ dir: path.resolve(process.env.AUDIT_ARCHIVE_DIR) }), userIdOf, day });
    console.log(r.ok ? `audit-export ${r.day} ${r.skipped ? 'already sealed' : `sealed ${r.rows} rows`}` : `audit-export ${r.day} FAILED ${r.code}`);
    process.exit(r.ok ? 0 : 1);
  } catch { console.log(`audit-export FAILED ${code}`); process.exit(1); }
})();
