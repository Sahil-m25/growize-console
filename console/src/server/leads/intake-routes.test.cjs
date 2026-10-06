/* C3 — the five intake routes through the real handlers (guard in ENFORCE mode, policy, withErrorCapture, the real services),
 * with a Zoho double that answers Leads insert/read/update and COQL. Run from console/: node --test src/server/leads/intake-routes.test.cjs
 *
 *   POST /api/leads                 one lead, Idempotency-Key, Introduced_By "field missing"
 *   POST /api/leads/duplicate       the live hint on the Add page
 *   POST /api/leads/import          per-row verdicts
 *   POST /api/leads/[id]/assign     self only
 *   POST /api/leads/updates/read    the person's bookmark
 */
'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const H = require('../http/contract/harness.cjs');

const P = '554023';
const QUEUE = `${P}000099001`;
const EVENT = `${P}000099002`;
const OTHER = `${P}000099003`;
process.env.ZOHO_UNASSIGNED_QUEUE_USER_ID = QUEUE;

const json = (status, body) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const world = { inserts: [], puts: [], leads: new Map(), dupes: new Map(), failIntroducer: false, n: 0, coql: [] };
const harnessFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  const m = init.method || 'GET';
  if (!/\/crm\/v8\//.test(u.pathname)) return harnessFetch(url, init);
  if (m === 'POST' && u.pathname === '/crm/v8/Leads') {
    const row = JSON.parse(init.body).data[0];
    world.inserts.push(row);
    if (world.failIntroducer && 'Introduced_By' in row) {
      return json(400, { code: 'INVALID_DATA', details: { api_name: 'Introduced_By', json_path: '$.data[0].Introduced_By' }, message: 'invalid data', status: 'error' });
    }
    const id = `${P}00000${String(98000 + ++world.n)}`;
    return json(201, { data: [{ code: 'SUCCESS', status: 'success', message: 'record added', details: { id, Modified_Time: '2026-10-06T10:00:00+05:30' } }] });
  }
  if (m === 'POST' && u.pathname === '/crm/v8/coql') {
    const q = JSON.parse(init.body).select_query;
    world.coql.push(q);
    for (const [digits, row] of world.dupes) if (q.includes(digits)) return json(200, { data: [row], info: { count: 1, more_records: false } });
    return json(204, null);
  }
  const lead = /\/crm\/v8\/Leads\/(\d+)$/.exec(u.pathname);
  if (lead && m === 'GET') {
    const l = world.leads.get(lead[1]);
    return l ? json(200, { data: [{ id: lead[1], Owner: { id: l.owner }, Modified_Time: '2026-10-05T10:00:00+05:30' }] }) : json(204, null);
  }
  if (lead && m === 'PUT') {
    world.puts.push({ id: lead[1], row: JSON.parse(init.body).data[0], since: init.headers['If-Unmodified-Since'] });
    return json(200, { data: [{ code: 'SUCCESS', status: 'success', message: 'record updated', details: { id: lead[1], Modified_Time: '2026-10-06T11:00:00+05:30' } }] });
  }
  throw new Error(`unexpected synthetic CRM request ${m} ${u.pathname}`);
};

test.before(async () => { await H.installRuntime(); H.setMode('enforce'); });

const route = (p) => require(H.routeFile(p));
const post = (p, opts, params) => H.call(route(p), 'POST', p.replace('[id]', params ? params.id : 'x'), { params, contentType: 'application/json', ...opts });
const IR = H.WHO.ir;
const BODY = { name: 'Asha Rao', mobile: '98450 33021', source: 'Website' };

test('POST /api/leads: an IR adds a lead as themselves; the same press replays instead of adding twice', async () => {
  world.inserts.length = 0;
  const a = await post('/api/leads', { seat: 'ir', body: BODY, headers: { 'idempotency-key': 'press-route-0001' } });
  assert.equal(a.status, 200, a.text);
  assert.equal(a.json.ownerId, IR);
  assert.equal(a.json.replayed, false);
  assert.match(a.json.leadId, /^554023\d+$/);
  assert.equal(world.inserts.length, 1);
  assert.deepEqual(world.inserts[0].Owner, { id: IR });
  const b = await post('/api/leads', { seat: 'ir', body: BODY, headers: { 'idempotency-key': 'press-route-0001' } });
  assert.equal(b.status, 200);
  assert.equal(b.json.replayed, true);
  assert.equal(b.json.leadId, a.json.leadId);
  assert.equal(world.inserts.length, 1);
  const c = await post('/api/leads', { seat: 'ir', body: { ...BODY, name: 'Someone Else' }, headers: { 'idempotency-key': 'press-route-0001' } });
  assert.equal(c.status, 409);
  assert.equal(c.json.code, 'key-reused');
});

test('POST /api/leads: no session 401, a seat with no Leads page 403, no key 400, a bad body 400', async () => {
  assert.equal((await post('/api/leads', { body: BODY, headers: { 'idempotency-key': 'press-route-0002' } })).status, 401);
  assert.equal((await post('/api/leads', { seat: 'fin', body: BODY, headers: { 'idempotency-key': 'press-route-0002' } })).status, 403);
  const before = world.inserts.length;
  const noKey = await post('/api/leads', { seat: 'ir', body: BODY });
  assert.equal(noKey.status, 400);
  assert.equal(noKey.json.code, 'invalid-key');
  assert.equal((await post('/api/leads', { seat: 'ir', body: '[]', headers: { 'idempotency-key': 'press-route-0003' } })).status, 400);
  assert.equal((await post('/api/leads', { seat: 'ir', body: { ...BODY, name: 'A' }, headers: { 'idempotency-key': 'press-route-0004' } })).status, 422);
  assert.equal(world.inserts.length, before, 'nothing was written');
});

test('POST /api/leads: Introduced_By only when named; a missing field is 422 "introducer-field-missing" and nothing is saved', async () => {
  world.inserts.length = 0;
  const none = await post('/api/leads', { seat: 'ir', body: { ...BODY, mobile: '98450 33022', source: 'Referral — investor' }, headers: { 'idempotency-key': 'press-route-0005' } });
  assert.equal(none.status, 200, none.text);
  assert.ok(!('Introduced_By' in world.inserts[0]));
  world.failIntroducer = true;
  try {
    const miss = await post('/api/leads', { seat: 'ir', body: { ...BODY, mobile: '98450 33023', source: 'Referral — investor', introducedById: OTHER }, headers: { 'idempotency-key': 'press-route-0006' } });
    assert.equal(miss.status, 422);
    assert.equal(miss.json.code, 'introducer-field-missing');
    assert.match(miss.json.error, /Introduced_By field on Leads/);
    assert.equal(world.inserts.length, 2, 'one try, never retried without the field');
  } finally { world.failIntroducer = false; }
});

test('POST /api/leads: the event source needs the event (422) and an IR cannot name another owner', async () => {
  world.inserts.length = 0;
  const noEv = await post('/api/leads', { seat: 'ir', body: { ...BODY, mobile: '98450 33024', source: 'Events' }, headers: { 'idempotency-key': 'press-route-0007' } });
  assert.equal(noEv.status, 422);
  assert.equal(noEv.json.code, 'event-missing');
  const ok = await post('/api/leads', { seat: 'ir', body: { ...BODY, mobile: '98450 33025', source: 'Events', eventId: EVENT, ownerId: OTHER }, headers: { 'idempotency-key': 'press-route-0008' } });
  assert.equal(ok.status, 200);
  assert.deepEqual(world.inserts[0].Lead_Event, { id: EVENT });
  assert.deepEqual(world.inserts[0].Owner, { id: IR }, 'the owner is decided from the seat, not the body');
});

test('POST /api/leads/duplicate: none, own, a bad number, and the number is never echoed', async () => {
  world.dupes.set('9845033077', { id: `${P}000098500`, First_Name: 'Meera', Owner: { id: IR } });
  const own = await post('/api/leads/duplicate', { seat: 'ir', body: { mobile: '98450 33077' } });
  assert.equal(own.status, 200, own.text);
  assert.deepEqual(own.json, { status: 'own', leadId: `${P}000098500`, firstName: 'Meera' });
  assert.ok(!own.text.includes('33077'));
  const none = await post('/api/leads/duplicate', { seat: 'ir', body: { mobile: '98450 33088' } });
  assert.deepEqual(none.json, { status: 'none' });
  const bad = await post('/api/leads/duplicate', { seat: 'ir', body: { mobile: '123' } });
  assert.equal(bad.status, 422);
  assert.equal(bad.json.code, 'invalid-mobile');
  assert.equal((await post('/api/leads/duplicate', { seat: 'fin', body: { mobile: '98450 33088' } })).status, 403);
  assert.equal((await post('/api/leads/duplicate', {})).status, 401);
});

test('POST /api/leads/import: per-row verdicts, source Events, no consent, a retried file does not add twice', async () => {
  world.inserts.length = 0;
  const rows = [{ name: 'Asha Rao', mobile: '98450 33031' }, { name: 'X', mobile: '98450 33032' }, { name: 'Ravi Menon', mobile: '98450 33033', units: 3 }];
  const a = await post('/api/leads/import', { seat: 'ir', body: { eventId: EVENT, rows }, headers: { 'idempotency-key': 'file-route-0001' } });
  assert.equal(a.status, 200, a.text);
  assert.equal(a.json.added, 2);
  assert.equal(a.json.refused, 1);
  assert.deepEqual(a.json.rows.map((r) => r.status), ['added', 'refused', 'added']);
  assert.equal(a.json.rows[1].reason, 'invalid-name');
  assert.equal(world.inserts.length, 2);
  assert.ok(world.inserts.every((r) => r.Lead_Source === 'Events' && !Object.keys(r).some((k) => k.startsWith('Consent_'))));
  const b = await post('/api/leads/import', { seat: 'ir', body: { eventId: EVENT, rows }, headers: { 'idempotency-key': 'file-route-0001' } });
  assert.equal(b.json.added, 2);
  assert.ok(b.json.rows.filter((r) => r.status === 'added').every((r) => r.replayed));
  assert.equal(world.inserts.length, 2);
  const big = await post('/api/leads/import', { seat: 'ir', body: { eventId: EVENT, rows: Array.from({ length: 201 }, () => rows[0]) }, headers: { 'idempotency-key': 'file-route-0002' } });
  assert.equal(big.status, 413);
  assert.equal(big.json.code, 'too-many-rows');
  assert.equal((await post('/api/leads/import', { seat: 'ir', body: { eventId: EVENT, rows } })).status, 400);
});

const LEAD = `${P}000097001`;
test('POST /api/leads/[id]/assign: an IR takes an unowned lead for themselves, guarded by Modified_Time; an owned one is 409', async () => {
  world.leads.set(LEAD, { owner: QUEUE });
  world.puts.length = 0;
  const a = await post('/api/leads/[id]/assign', { seat: 'ir', body: {} }, { id: LEAD });
  assert.equal(a.status, 200, a.text);
  assert.equal(a.json.ownerId, IR);
  assert.equal(world.puts.length, 1);
  assert.deepEqual(world.puts[0].row.Owner, { id: IR });
  assert.equal(world.puts[0].since, '2026-10-05T10:00:00+05:30');
  const owned = `${P}000097002`;
  world.leads.set(owned, { owner: OTHER });
  const b = await post('/api/leads/[id]/assign', { seat: 'ir', body: {} }, { id: owned });
  assert.equal(b.status, 409);
  assert.equal(b.json.code, 'already-owned');
  assert.equal(world.puts.length, 1);
  const gone = await post('/api/leads/[id]/assign', { seat: 'ir', body: {} }, { id: `${P}000097003` });
  assert.equal(gone.status, 404);
});

test('POST /api/leads/[id]/assign: self only — a manager is refused (403), and the body cannot name another owner', async () => {
  world.puts.length = 0;
  const lead = `${P}000097004`;
  world.leads.set(lead, { owner: QUEUE });
  const mgr = await post('/api/leads/[id]/assign', { seat: 'conv', body: { to: OTHER } }, { id: lead });
  assert.equal(mgr.status, 403);
  assert.equal(world.puts.length, 0);
  const sneaky = await post('/api/leads/[id]/assign', { seat: 'ir', body: { to: OTHER, ownerId: OTHER } }, { id: lead });
  assert.equal(sneaky.status, 200);
  assert.deepEqual(world.puts[0].row.Owner, { id: IR }, 'the owner is always the signed-in person');
  assert.equal((await post('/api/leads/[id]/assign', { body: {} }, { id: lead })).status, 401);
});

test('POST /api/leads/updates/read: stores the person\'s own bookmark per kind, refuses an unknown kind', async () => {
  const ok = await post('/api/leads/updates/read', { seat: 'ir', body: { kinds: ['owner', 'stage'] } });
  assert.equal(ok.status, 200, ok.text);
  assert.deepEqual(ok.json, { ok: true });
  const { sharedState } = require('../state/runtime.ts');
  assert.ok(await sharedState().get(`lead-updates-seen|${IR}|owner`));
  assert.ok(await sharedState().get(`lead-updates-seen|${IR}|stage`));
  assert.equal(await sharedState().get(`lead-updates-seen|${IR}|lost`), null);
  assert.equal(await sharedState().get(`lead-updates-seen|${H.WHO.conv}|owner`), null, 'nobody else\'s bookmark moved');
  const bad = await post('/api/leads/updates/read', { seat: 'ir', body: { kinds: ['nope'] } });
  assert.equal(bad.status, 400);
  assert.equal((await post('/api/leads/updates/read', { body: { kinds: ['owner'] } })).status, 401);
  assert.equal((await post('/api/leads/updates/read', { seat: 'ir', body: [] })).status, 400);
});
