/* Shared by the logs tests: type-check the given roots under the project's tsconfig and emit them as
   CommonJS to a temp directory (the error-capture.test.cjs pattern). Not a test file itself. */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

module.exports = function compile(roots, tag) {
  const consoleRoot = path.resolve(__dirname, '..', '..', '..');
  const srcRoot = path.join(consoleRoot, 'src');
  const ts = require(path.join(consoleRoot, 'node_modules', 'typescript'));
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), tag + '-'));
  process.on('exit', () => fs.rmSync(outDir, { recursive: true, force: true }));
  const config = ts.readConfigFile(path.join(consoleRoot, 'tsconfig.json'), ts.sys.readFile);
  const project = ts.parseJsonConfigFileContent(config.config, ts.sys, consoleRoot);
  const options = {
    ...project.options, incremental: false, tsBuildInfoFile: undefined, plugins: undefined,
    module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10,
    noEmit: false, noEmitOnError: true, outDir, rootDir: srcRoot,
  };
  const program = ts.createProgram(roots.map((r) => path.join(srcRoot, ...r.split('/'))), options);
  const format = (d) => ts.formatDiagnostics(d, { getCanonicalFileName: (f) => f, getCurrentDirectory: () => consoleRoot, getNewLine: () => '\n' });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length) { console.error(format(diagnostics)); process.exit(1); }
  const emitted = program.emit();
  if (emitted.diagnostics.length) { console.error(format(emitted.diagnostics)); process.exit(1); }
  return { outDir, load: (rel) => require(path.join(outDir, ...rel.split('/'))) };
};
