/* Process-start hooks (server/ops/runtime startProcessHooks): the 10-minute Zoho Sign re-read (ensureSignCheck,
 * M12-S05-T02) starts once per process on the first wrapped request — lazily, never in fixture mode (D65).
 * Run from console/: node --test src/server/ops/process-hooks.test.cjs */
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const compile = require('../logs/compile.cjs');

const { outDir, load } = compile(['server/ops/runtime.ts'], 'ops-hooks');
const Module = require('node:module');
process.env.NODE_PATH = path.resolve(__dirname, '..', '..', '..', 'node_modules');
Module._initPaths();
const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  return resolveFilename.call(this, request.startsWith('@/') ? path.join(outDir, request.slice(2)) : request, ...rest);
};
const { startProcessHooks, withErrorCapture } = load('server/ops/runtime.js');

const fakeSign = () => { const f = { loads: 0, starts: 0 }; f.load = async () => { f.loads++; return { ensureSignCheck() { f.starts++; } }; }; return f; };
const reset = () => { delete globalThis.__gzOpsStarted; };
const tick = () => new Promise((r) => setImmediate(r));

test('the Sign check starts once per process, lazily, outside fixture mode', async () => {
  reset();
  const f = fakeSign();
  startProcessHooks({ NODE_ENV: 'production' }, f.load);
  startProcessHooks({ NODE_ENV: 'production' }, f.load);
  await tick();
  assert.deepEqual([f.loads, f.starts], [1, 1]);
});

test('never in fixture mode (FIXTURE_MODE=local): the Sign runtime is not even loaded', async () => {
  reset();
  const f = fakeSign();
  startProcessHooks({ FIXTURE_MODE: 'local', NODE_ENV: 'development' }, f.load);
  await tick();
  assert.deepEqual([f.loads, f.starts], [0, 0]);
});

test('a failing hook never fails the request; routes stay wrapped by withErrorCapture', async () => {
  reset();
  startProcessHooks({ NODE_ENV: 'production' }, async () => { throw new Error('no sign runtime'); });
  await tick();
  globalThis.__gzOpsStarted = true; // the hook has run for this process: the wrapped route below does not load the Sign runtime
  const h = withErrorCapture(async () => Response.json({ ok: true }), '/api/test');
  const res = await h(new Request('http://x/api/test'), {});
  assert.equal(res.status, 200);
  assert.ok(res.headers.get('x-request-id'));
});
