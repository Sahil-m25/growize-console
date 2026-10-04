/* R6 M19-S12-NOTE-7 — the Zoho limit cases that stories name and no test carried:
 *   TC-E01-009  rate limit backs off without failing the page     (12 concurrent Leads searches as three users)
 *   TC-E15-004  first API-credits header raises the alarm          (Plane B event + one alert, not a second the same day)
 *   TC-IM12-015 a 429 burst shows stale-once, not an error page    (last good value with its age; never an unhandled error)
 * Each runs the real client, gate, cache and alert engine against a fetch double: nothing reaches Zoho.
 * The live halves (the real Retry-After Zoho sends, a mail that reaches Sahil's inbox) are staging cases; see
 * docs/reports/r6-missing-tests.md. Run from console/: node --test src/lib/zoho/rate-limit-cases.test.cjs */
'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const compile = require('../../server/logs/compile.cjs');

const { load } = compile(['lib/zoho/client.ts', 'lib/zoho/gate.ts', 'lib/zoho/log.ts', 'lib/zoho/cache.ts', 'server/ops/alerts.ts'], 'rate-limit-cases');
const { createZohoClient, userCredential } = load('lib/zoho/client.js');
const { createGate } = load('lib/zoho/gate.js');
const { createOpsLog, createMemorySink } = load('lib/zoho/log.js');
const { createScopedCache, cacheKey } = load('lib/zoho/cache.js');
const { createAlertEngine, createOutboxMailer, tapOpsSink } = load('server/ops/alerts.js');

const PREFIX = '554023';
const GRANT = { api_domain: 'https://www.zohoapis.in', expires_in: 3600, token_type: 'Bearer' };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const json = (status, body, headers = {}) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const CONCURRENCY_429 = { code: 'TOO_MANY_REQUESTS', details: {}, message: 'The concurrency limit of the user for the app is exceeded', status: 'error' };
const identity = (id) => async () => json(200, { users: [{ id, status: 'active' }] });
const mint = (who, extra = {}) => userCredential({ ...GRANT, access_token: `synthetic-token-${who}` }, {
  recordIdPrefix: PREFIX, gate: createGate(), log: createOpsLog(createMemorySink()), fetch: identity(`${PREFIX}00000010000${who}`), ...extra });

test('TC-E01-009: 12 concurrent Leads searches as three users never pass 12 in flight; a 429 is retried after its Retry-After and every page loads', async () => {
  const gate = createGate();
  const sink = createMemorySink();
  const sleeps = [];
  let inFlight = 0, peak = 0, served = 0;
  const throttled = new Set();       /* the first attempt of two searches is refused by Zoho with Retry-After: 2 */
  const fetch = async (url, init) => {
    inFlight++; peak = Math.max(peak, inFlight);
    try {
      await wait(4);
      const q = new URL(String(url)).searchParams.get('word');
      if ((q === 'search-3' || q === 'search-8') && !throttled.has(q)) { throttled.add(q); return json(429, CONCURRENCY_429, { 'Retry-After': '2' }); }
      served++;
      return json(200, { data: [{ id: `${PREFIX}000000527003` }], info: { more_records: false } });
    } finally { inFlight--; }
  };
  const client = createZohoClient({ gate, log: createOpsLog(sink), recordIdPrefix: PREFIX, fetch, sleep: async (ms) => { sleeps.push(ms); }, random: () => 0.5 });
  const people = await Promise.all(['1', '2', '3'].map((n) => mint(n, { gate })));
  const results = await Promise.all(Array.from({ length: 12 }, (_, i) => client.search(people[i % 3], 'Leads', { word: `search-${i}` })));
  assert.ok(results.every((r) => r.ok), 'every page loads: no search failed');
  assert.equal(served, 12);
  assert.ok(peak <= 12, `peak ${peak} calls in flight from the app`);
  assert.equal(sleeps.length, 2, 'exactly the two refused searches waited');
  assert.ok(sleeps.every((ms) => ms >= 2000), `each wait honours Retry-After (floor 2000 ms): ${sleeps}`);
  const attempts = sink.records().filter((x) => x.kind === 'zoho-call' && x.op === 'search');
  assert.deepEqual(attempts.filter((x) => x.status === 429).map((x) => [x.attempt, x.errorClass]), [[1, 'concurrency-exceeded'], [1, 'concurrency-exceeded']]);
  assert.equal(attempts.filter((x) => x.status === 200 && x.attempt === 2).length, 2, 'each refused search succeeded on its second attempt');

  /* the same ceiling under a heavier burst: 36 searches, still never more than 12 in flight */
  peak = 0; inFlight = 0;
  const burst = await Promise.all(Array.from({ length: 36 }, (_, i) => client.search(people[i % 3], 'Leads', { word: `burst-${i}` })));
  assert.ok(burst.every((r) => r.ok));
  assert.ok(peak <= 12 && peak > 1, `burst peak ${peak}`);
});

test('TC-E15-004: the first API-credits header of the day writes the Plane B event and one alert; a second header the same day does not re-alert', async () => {
  let now = Date.UTC(2026, 8, 28, 4, 30);   /* 10:00 Asia/Kolkata */
  const mailer = createOutboxMailer();
  const engine = createAlertEngine({ mailer, to: 'alerts@example.invalid', clock: () => now });
  const inner = createMemorySink();
  const replies = [json(200, { data: [{ id: `${PREFIX}000000527003` }] }), json(200, { data: [{ id: `${PREFIX}000000527003` }] }, { 'X-API-CREDITS-REMAINING': '24000' }),
    json(200, { data: [{ id: `${PREFIX}000000527003` }] }, { 'X-API-CREDITS-REMAINING': '23900' })];
  const client = createZohoClient({ gate: createGate(), log: createOpsLog(tapOpsSink(inner, () => engine)), recordIdPrefix: PREFIX, clock: () => now, fetch: async () => replies.shift() });
  const me = await mint('1', { clock: () => now });
  const id = `${PREFIX}000000527003`;
  await client.getRecord(me, 'Leads', id);
  await engine.settled();
  assert.equal(mailer.sent().length, 0, 'no header, no alarm');
  await client.getRecord(me, 'Leads', id);
  await engine.settled();
  const events = inner.records().filter((r) => r.kind === 'event').map((e) => [e.action, e.reason]);
  assert.equal(events[0][0], 'credits-alarm'); assert.equal(events[0][1], 'remaining-24000', 'the Plane B event carries the remaining value');
  assert.equal(mailer.sent().length, 1, 'the alert is sent as the header is processed (inside the 5-minute window)');
  assert.equal(mailer.sent()[0].to, 'alerts@example.invalid');
  assert.match(mailer.sent()[0].text, /credits=24000/);
  now += 30 * 60_000;
  await client.getRecord(me, 'Leads', id);
  await engine.settled();
  assert.equal(mailer.sent().length, 1, 'a second header the same day does not re-alert');
  assert.equal(inner.records().filter((r) => r.kind === 'event' && r.action === 'credits-alarm').length, 1);
});

test('TC-IM12-015: a 429 burst shows each screen its last good values with an age, once, and no unhandled error', async () => {
  let now = Date.UTC(2026, 8, 28, 4, 30);
  const sink = createMemorySink();
  const burst = { on: false };
  const client = createZohoClient({ gate: createGate(), log: createOpsLog(sink), recordIdPrefix: PREFIX, clock: () => now, maxAttempts: 1,
    fetch: async () => (burst.on ? json(429, CONCURRENCY_429, { 'Retry-After': '10' }) : json(200, { data: [{ Stage: 'Said yes', Total: '4' }], info: { more_records: false } })) });
  const me = await mint('1', { clock: () => now });
  const cache = createScopedCache({ clock: () => now });
  const SCOPE = { kind: 'user', userId: `${PREFIX}000000100001` };
  const screens = { dashboard: cacheKey(SCOPE, 'dashboard.counts'), insights: cacheKey(SCOPE, 'insights.counts') };
  const loader = () => async () => {
    const r = await client.coql(me, 'select Stage, count(id) from Leads group by Stage');
    if (!r.ok) throw Object.assign(new Error('zoho'), { kind: r.error.kind, retryAfterMs: r.error.retryAfterMs ?? null });
    return { saidYes: 4 };
  };
  for (const k of Object.values(screens)) assert.equal((await cache.readSettled(k, loader())).state, 'fresh');
  /* the burst begins: past the 45 s TTL, still inside the five-minute ceiling, both screens open */
  burst.on = true; now += 60_000;
  for (const [name, k] of Object.entries(screens)) {
    const shown = await cache.read(k, loader());
    assert.equal(shown.state, 'stale-but-refreshing', `${name}: the last good value is shown`);
    assert.deepEqual({ ...shown.value }, { saidYes: 4 }, `${name}: the same numbers`);
    assert.equal(shown.ageMs, 60_000, `${name}: with its age`);
    const settled = await shown.settled;                      /* the refresh fails: a 429 is a state, never a throw */
    assert.equal(settled.state, 'error'); assert.equal(settled.reason, 'concurrency-exceeded');
    assert.equal(settled.lastGoodAt, now - 60_000, `${name}: the error still says when the last good value was true`);
  }
  /* once: the next read inside the hold is an error state, not the old number again */
  assert.equal((await cache.read(screens.dashboard, loader())).state, 'error');
  /* the burst ends; the next read after the hold loads live and the number is back */
  burst.on = false; now += 15_000;
  const back = await cache.readSettled(screens.dashboard, loader());
  assert.equal(back.state, 'fresh');
});
