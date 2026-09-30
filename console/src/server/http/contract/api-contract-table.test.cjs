/* M18-S14-H1 — the route manifest and contract table. Run from console/: node --test src/server/http/contract/api-contract-table.test.cjs
 *
 * Fails, naming the route, when a route under src/app/api is not in contract-table.json (or the JSON names one that is gone),
 * when a write has no body schema, or when a route is neither behind guardApi nor named `open`.
 */
'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
require('./harness.cjs');
const T = require('./contract-table.cjs');

const rows = T.generate();
const kept = T.read();

test('H1: every route under src/app/api is in the contract table, every write has a body schema, every door is guarded or named open', () => {
  const p = T.problems(rows, kept);
  assert.deepEqual(p, [], p.join('\n'));
});

test('H1: the table is generated from the code — routes, methods, guard rule and allowed seats', () => {
  const live = rows.filter((r) => !r.excluded);
  assert.ok(live.length >= 80, `${live.length} routes`);
  const by = (x) => live.find((r) => r.route === x);
  assert.deepEqual(by('/api/events').seats, ['conv', 'ir']);                 /* page:events, from SEATCAPS via seatPresets */
  assert.ok(!by('/api/cases').seats.includes('ir'), 'an IR does not reach Tickets');
  assert.ok(by('/api/data').seats.includes('kam') && !by('/api/data').seats.includes('exec'), 'session rule: every admitted seat; the grant-only ones are not admitted without a grant');
  assert.equal(by('/api/sign/embed').seats, '*');
  for (const r of live) {
    if (r.seats === '*') continue;
    assert.ok(r.seats.every((s) => T.read().routes[r.route]), r.route);
  }
});

test('H1: a route added later without a row fails the check and names it', () => {
  const added = [...rows, { route: '/api/brand-new', methods: ['GET', 'POST'], params: [], excluded: false, guard: '/api/data', guarded: true, rule: { kind: 'session' }, seats: [] }];
  const p = T.problems(added, kept);
  assert.equal(p.length, 1);
  assert.match(p[0], /route missing from the contract table: \/api\/brand-new/);
  /* a method added to a known route, a stale row, an unguarded door and a write without a schema are named too */
  const grown = rows.map((r) => (r.route === '/api/data' ? { ...r, methods: ['GET', 'DELETE'] } : r));
  assert.match(T.problems(grown, kept).join('\n'), /method missing from the contract table: DELETE \/api\/data/);
  assert.match(T.problems(rows.slice(1), kept).join('\n'), /row for a route that does not exist/);
  const open = rows.map((r) => (r.route === '/api/data' ? { ...r, guarded: false, rule: { kind: 'session' } } : r));
  assert.match(T.problems(open, kept).join('\n'), /neither wrapped by guardApi nor named open in API_ROUTES: \/api\/data/);
  const bare = { routes: { ...kept.routes, '/api/cases': { GET: {}, POST: {} } } };
  assert.match(T.problems(rows, bare).join('\n'), /no body schema for POST \/api\/cases/);
});

test('H1: excluded routes are exactly sign-in, webhooks, test hooks and the beacon', () => {
  const ex = rows.filter((r) => r.excluded).map((r) => r.route);
  for (const r of ex) assert.match(r, /^\/api\/(auth|webhooks|test|errors)(\/|$)/, r);
  for (const r of ['/api/auth/zoho', '/api/webhooks/zoho-sign', '/api/test/reset', '/api/errors']) assert.ok(ex.includes(r), r);
});
