/* R4: the AppSail image contract — standalone output, the listen-port mapping, a non-root user, no secrets baked in. */
'use strict';
const test = require('node:test'); const assert = require('node:assert/strict'); const fs = require('node:fs'); const path = require('node:path');
const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', '..', p), 'utf8');

test('next.config builds a standalone server', () => assert.match(read('console/next.config.mjs'), /output:\s*"standalone"/));
test('Dockerfile maps X_ZOHO_CATALYST_LISTEN_PORT (default 9000), binds 0.0.0.0, runs as node', () => {
  const d = read('console/Dockerfile');
  assert.match(d, /PORT=\$\{X_ZOHO_CATALYST_LISTEN_PORT:-9000\}/); assert.match(d, /HOSTNAME=0\.0\.0\.0/); assert.match(d, /^USER node$/m);
  assert.doesNotMatch(d, /^\s*(ENV|ARG)\s+\S*(SECRET|TOKEN|KEY)\S*=/mi);
});
test('.dockerignore keeps env files, keys and node_modules out of the context', () => {
  const i = read('.dockerignore');
  for (const p of ['**/node_modules', '**/.env', '.typesafe-key', '**/*.pem']) assert.ok(i.split('\n').includes(p), p);
});
test('catalyst/app-config.json is valid and starts the standalone server on the platform port', () => {
  const c = JSON.parse(read('catalyst/app-config.json'));
  assert.match(c.command, /X_ZOHO_CATALYST_LISTEN_PORT/); assert.match(c.command, /node server\.js/); assert.ok([128, 256, 512, 1024, 2048].includes(c.memory));
  assert.equal(Object.values(c.env_variables).some((v) => /secret|token/i.test(String(v))), false);
});
