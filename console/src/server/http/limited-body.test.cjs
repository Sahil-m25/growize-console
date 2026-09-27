/* M20-S08 LIMITED REQUEST BODY REGRESSION
 * Run from console/: node src/server/http/limited-body.test.cjs
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const consoleRoot = path.resolve(__dirname, '..', '..', '..');
const srcRoot = path.join(consoleRoot, 'src');
const ts = require(path.join(consoleRoot, 'node_modules', 'typescript'));
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoho-limited-body-'));
process.on('exit', () => fs.rmSync(outDir, { recursive: true, force: true }));

const config = ts.readConfigFile(path.join(consoleRoot, 'tsconfig.json'), ts.sys.readFile);
const project = ts.parseJsonConfigFileContent(config.config, ts.sys, consoleRoot);
const options = {
  ...project.options,
  incremental: false,
  tsBuildInfoFile: undefined,
  plugins: undefined,
  module: ts.ModuleKind.CommonJS,
  moduleResolution: ts.ModuleResolutionKind.Node10,
  noEmit: false,
  noEmitOnError: true,
  outDir,
  rootDir: srcRoot,
};
const source = path.join(srcRoot, 'server', 'http', 'limited-body.ts');
const program = ts.createProgram([source], options);
const format = (items) => ts.formatDiagnostics(items, {
  getCanonicalFileName: (file) => file,
  getCurrentDirectory: () => consoleRoot,
  getNewLine: () => '\n',
});
const diagnostics = ts.getPreEmitDiagnostics(program);
if (diagnostics.length) {
  console.error(format(diagnostics));
  process.exit(1);
}
const emitted = program.emit();
if (emitted.diagnostics.length) {
  console.error(format(emitted.diagnostics));
  process.exit(1);
}

const { readLimitedUtf8Body } = require(path.join(outDir, 'server', 'http', 'limited-body.js'));
const encoder = new TextEncoder();

function requestFromChunks(chunks, headers = {}) {
  let at = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (at >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(chunks[at++]);
    },
  });
  return new Request('https://callback.example.invalid', {
    method: 'POST',
    headers,
    body: stream,
    duplex: 'half',
  });
}

test('the byte cap is hard even when Content-Length is absent or falsely small', async () => {
  const exact = requestFromChunks([encoder.encode('ab'), encoder.encode('cd')]);
  assert.deepEqual(await readLimitedUtf8Body(exact, 4), { ok: true, body: 'abcd' });

  const absent = requestFromChunks([encoder.encode('ab'), encoder.encode('cde')]);
  assert.deepEqual(await readLimitedUtf8Body(absent, 4), { ok: false, reason: 'payload-too-large' });

  const falseLength = requestFromChunks(
    [encoder.encode('ab'), encoder.encode('cde')],
    { 'content-length': '1' },
  );
  assert.deepEqual(await readLimitedUtf8Body(falseLength, 4), { ok: false, reason: 'payload-too-large' });

  const unicodeExact = requestFromChunks([encoder.encode('€')]);
  assert.deepEqual(await readLimitedUtf8Body(unicodeExact, 3), { ok: true, body: '€' });
  const unicodeTooLarge = requestFromChunks([encoder.encode('€')]);
  assert.deepEqual(await readLimitedUtf8Body(unicodeTooLarge, 2), { ok: false, reason: 'payload-too-large' });
});

test('malformed UTF-8 fails closed instead of replacement-decoding signed bytes', async () => {
  const malformed = requestFromChunks([Uint8Array.from([0x7b, 0x22, 0xc3, 0x28, 0x22, 0x7d])]);
  assert.deepEqual(await readLimitedUtf8Body(malformed, 64), { ok: false, reason: 'invalid-utf8' });
});

test('a leading UTF-8 BOM survives decoding so the signed bytes round-trip exactly', async () => {
  const json = encoder.encode('{"requests":{}}');
  const original = Uint8Array.from([0xef, 0xbb, 0xbf, ...json]);
  const request = requestFromChunks([
    original.slice(0, 1),
    original.slice(1, 3),
    original.slice(3),
  ]);
  const result = await readLimitedUtf8Body(request, original.byteLength);
  assert.deepEqual(result, { ok: true, body: '\ufeff{"requests":{}}' });
  assert.deepEqual(Buffer.from(result.body, 'utf8'), Buffer.from(original), 're-encoding retains every signed byte');
});

test('abort and stream failure are generic fail-closed results', async () => {
  const controller = new AbortController();
  controller.abort();
  const unread = requestFromChunks([encoder.encode('must not be consumed')]);
  assert.deepEqual(await readLimitedUtf8Body(unread, 64, controller.signal), { ok: false, reason: 'aborted' });

  const broken = new Request('https://callback.example.invalid', {
    method: 'POST',
    body: new ReadableStream({ pull(streamController) { streamController.error(new Error('synthetic read failure')); } }),
    duplex: 'half',
  });
  assert.deepEqual(await readLimitedUtf8Body(broken, 64), { ok: false, reason: 'read-failed' });
});

test('abort cancels a pending stream read instead of waiting for another body chunk', async () => {
  let markPullStarted;
  const pullStarted = new Promise((resolve) => { markPullStarted = resolve; });
  let cancelled = false;
  const pendingStream = new ReadableStream({
    pull() {
      markPullStarted();
      return new Promise(() => {});
    },
    cancel() {
      cancelled = true;
    },
  });
  const request = new Request('https://callback.example.invalid', {
    method: 'POST',
    body: pendingStream,
    duplex: 'half',
  });
  const controller = new AbortController();
  const reading = readLimitedUtf8Body(request, 64, controller.signal);
  await pullStarted;
  controller.abort();

  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('pending body read was not cancelled on abort')), 500);
  });
  const result = await Promise.race([reading, timeout]);
  clearTimeout(timer);
  assert.deepEqual(result, { ok: false, reason: 'aborted' });
  assert.equal(cancelled, true, 'the underlying request stream was cancelled');
});

test('empty bodies work and invalid caps are programming errors', async () => {
  const empty = new Request('https://callback.example.invalid', { method: 'POST' });
  assert.deepEqual(await readLimitedUtf8Body(empty, 1), { ok: true, body: '' });
  await assert.rejects(readLimitedUtf8Body(empty, 0), RangeError);
  await assert.rejects(readLimitedUtf8Body(empty, Number.MAX_SAFE_INTEGER + 1), RangeError);
});
