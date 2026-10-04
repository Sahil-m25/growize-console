/* M20-S07-T05 OUTBOUND ISOLATION — what the console pushes to the investor app for investor A never carries investor B's data
 * and is never routed as B's. Run from console/: node --test src/server/contracts/outbound-isolation.test.cjs
 *
 * What "subscription" is here: the console has ONE signed endpoint (stub.ts investorAppTarget: a single URL and key); there is no
 * per-investor URL or topic. An event is routed to an investor by the envelope's `ids.investor_contact_id` (the key the app files it
 * under), so "never goes to B's subscription" is asserted as: the routing key of an event is the investor whose values it carries,
 * and no event routed to A holds a value that belongs to B (id, ARL code, text, numbers) — in the body the app receives, in the
 * outbox's delivery state, in the ledger line and in the receiver's acknowledgement. (If the owner wants a topic or URL per
 * investor, that is a new contract, not a test: see the report's GAP line.)
 *
 * For EVERY outbound event type (the types the stub receiver accepts = the types the console pushes), two investors are built:
 *   - from the schema itself (every field filled, each investor-owned value stamped with a marker only that investor can produce),
 *   - from the real builders where the console has one (caseReplied, requestExecuted, farmProgress, farmShelfChanged,
 *     updatePublished, holdChangedEvent), and through the real update publisher (the one fan-out in the code: one event per investor).
 * They go through the real outbox and the in-process stub, interleaved, with A's deliveries failing while B's succeed.
 * Synthetic data only: markers and made-up record ids, no real investor data.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { compile, makeHttpRig, P, NOW } = require('../cases/fixture-rig.cjs');

const load = compile(['server/contracts/events.ts', 'server/contracts/stub.ts', 'server/contracts/outbox.ts', 'server/holds/rules.ts',
  'server/updates/publish.ts', 'server/cases/rights.ts', 'server/data/scope.ts', 'server/data/events.ts', 'server/identity/plane-c.ts']);
const { validateEvent, sign, verify } = load('server/contracts/events.js');
const { loadSchemas, createInProcessStub } = load('server/contracts/stub.js');
const { createOutbox, caseReplied, requestExecuted, farmProgress, farmShelfChanged, updatePublished, deliveriesForRecord, identityPaths } = load('server/contracts/outbox.js');
const { holdChangedEvent } = load('server/holds/rules.js');
const { createInvestorUpdates } = load('server/updates/publish.js');

const consoleRoot = path.resolve(__dirname, '..', '..', '..');
const contractsRoot = path.resolve(consoleRoot, '..', 'contracts');
const schemas = loadSchemas(contractsRoot);
const KEY = 'synthetic-contract-key-never-live-000000000002';

/* the outbound types: read from the stub receiver's own accept list (stub.ts) — what the console pushes to the app */
const stubSrc = fs.readFileSync(path.join(__dirname, 'stub.ts'), 'utf8');
const OUTBOUND = [...(/accepts \?\? \[([^\]]*)\]/.exec(stubSrc)[1]).matchAll(/"([a-z]+\.[a-z_]+)"/g)].map((m) => m[1]);
/* types with no investor in them by design (a farm's shelf, read by every investor): ids is {} */
const BROADCAST = new Set(['farm.shelf_changed']);

const INV = {
  A: { id: '554023700000000001', arl: 'ARL-INV-0001', tag: 'A', n: 7001, other: 'B' },
  B: { id: '554023700000000002', arl: 'ARL-INV-0002', tag: 'B', n: 7002, other: 'A' },
};
let seq = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
const PATTERN = (inv, p) => ({
  '^ARL-INV-[0-9]{4}$': inv.arl, '^[0-9]{10,25}$': inv.id, '^[0-9]{15,22}$': inv.id,
  '^[A-Za-z0-9-]{1,64}$': `req-${inv.tag}-${'x'.repeat(8)}`, '^[a-f0-9]{64}$': 'a'.repeat(64),
  '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?$': 'https://example.invalid' }[p]);

/** A value satisfying the schema node, with every investor-owned leaf stamped for `inv`. */
function sample(node, inv, name) {
  if ('const' in node) return node.const;
  if (node.enum) return node.enum[0];
  switch (node.type) {
    case 'string':
      if (node.format === 'uuid') return uuid();
      if (node.format === 'date-time') return '2026-09-27T21:00:00+05:30';
      if (node.pattern) { const v = PATTERN(inv, node.pattern); assert.ok(v, `no sample for pattern ${node.pattern}`); return v; }
      return `${inv.tag}-owned-${name}`;
    case 'integer': return Math.max(inv.n, node.minimum ?? 1);
    case 'number': return inv.n + 0.5;
    case 'boolean': return true;
    case 'array': return [sample(node.items ?? { type: 'string' }, inv, name)];
    case 'object': return Object.fromEntries(Object.entries(node.properties ?? {}).map(([k, p]) => [k, sample(p, inv, k)]));
    default: assert.fail(`unhandled schema node ${JSON.stringify(node).slice(0, 80)}`);
  }
}
const FARM = { id: '554023700000000900', arl: 'ARL-INV-0900', tag: 'F', n: 9001 };   /* values of a farm: shared by every investor, owned by none */
function fromSchema(type, who) {
  const inv = BROADCAST.has(type) ? FARM : who;
  const own = schemas[`${type}.json`].properties;
  const e = { event_id: uuid(), type, schema_version: 1, occurred_at: '2026-09-27T21:00:00+05:30', actor: { kind: 'system' },
    ids: BROADCAST.has(type) ? {} : { investor_contact_id: inv.id }, payload: sample(own.payload, inv, 'payload'), origin: 'console' };
  for (const k of ['actor', 'ids']) if (own[k]) e[k] = { ...e[k], ...sample({ ...own[k], type: 'object' }, inv, k), ...(own[k].properties?.kind?.const ? { kind: own[k].properties.kind.const } : {}) };
  if (!BROADCAST.has(type)) e.ids.investor_contact_id = inv.id;
  if (e.actor.investor_contact_id) e.actor.investor_contact_id = inv.id;
  return e;
}

/** Every value of an event that belongs to an investor, as the strings/numbers that could betray it. */
const values = (o, out = []) => { if (o && typeof o === 'object') for (const v of Object.values(o)) values(v, out); else if (o !== null && o !== undefined) out.push(o); return out; };
const owns = (inv, e) => { const j = JSON.stringify(e); return [inv.id, inv.arl, `${inv.tag}-owned-`, `req-${inv.tag}-`].filter((m) => j.includes(m)); };
const routeKeyOf = (e) => (e.ids && e.ids.investor_contact_id) || (e.actor && e.actor.investor_contact_id) || null;

function pipe({ failFor = null } = {}) {
  const stub = createInProcessStub({ schemas, keys: [KEY], clock: () => NOW });
  const sent = [];          /* every wire attempt: { to, key, body, signature, event } */
  const ledger = [];
  const fetch = async (url, init) => {
    const event = JSON.parse(init.body);
    sent.push({ url, idem: init.headers['Idempotency-Key'], body: init.body, signature: init.headers['X-Signature'], event });
    if (failFor && failFor(event)) return { status: 503, text: async () => '' };
    return stub.fetch(url, init);
  };
  let t = NOW;
  const outbox = createOutbox({ schemas, target: () => ({ url: 'stub://investor-app/events', key: KEY }), fetch, clock: () => t,
    ledger: { append: (l) => ledger.push(l) }, baseDelayMs: 1000, maxAttempts: 4 });
  return { stub, sent, ledger, outbox, fetch, tick: (ms = 60_000) => { t += ms; } };
}

test('the outbound set is read from the stub receiver, is non-empty, and every type has a schema', () => {
  assert.ok(OUTBOUND.length >= 11, `read ${OUTBOUND.length} outbound types`);
  for (const t of OUTBOUND) assert.ok(schemas[`${t}.json`], `${t} has no schema in contracts/`);
});

for (const type of OUTBOUND) {
  test(`${type}: two investors, interleaved, A failing then retried — per-event routing and payload isolation`, async () => {
    const tries = new Map(); const firstTry = (e) => { const n = (tries.get(e.event_id) || 0) + 1; tries.set(e.event_id, n); return n === 1; };
    const { outbox, stub, sent, ledger, tick } = pipe({ failFor: (e) => !BROADCAST.has(type) ? routeKeyOf(e) === INV.A.id && firstTry(e) : e.event_id === A.event_id && firstTry(e) });
    const A = fromSchema(type, INV.A), B = fromSchema(type, INV.B);
    for (const [inv, e] of [[INV.A, A], [INV.B, B]]) {
      assert.deepEqual(validateEvent(schemas, e), { ok: true, type }, `${type} for ${inv.tag} built from the schema`);
      if (!BROADCAST.has(type)) {
        assert.deepEqual(owns(INV[inv.other], e), [], `${type}: the ${inv.tag} event as built already holds ${inv.other}'s values`);
        assert.equal(routeKeyOf(e), inv.id, `${type}: the routing key of the ${inv.tag} event is ${inv.tag}`);
      }
    }
    assert.equal(outbox.enqueue(A).ok, true); assert.equal(outbox.enqueue(B).ok, true);
    await outbox.drain();                          /* B delivered; A refused by the receiver being down for A */
    assert.equal(outbox.state(B.event_id).status, 'delivered');
    assert.notEqual(outbox.state(A.event_id).status, 'delivered', 'A is not delivered while its receiver is down — and B being delivered does not deliver it');
    tick(); await outbox.drain();                  /* A retried to delivery (the receiver was down only for A's first attempt) */
    assert.equal(outbox.state(A.event_id).status, 'delivered');

    /* the wire: each attempt's body is that event alone, signed over exactly that body, idempotency key = its own event id */
    for (const s of sent) {
      assert.equal(s.idem, s.event.event_id);
      assert.equal(verify(s.body, s.signature, [KEY]), true, `${type}: signature over exactly the body sent`);
      assert.equal(s.url, 'stub://investor-app/events', 'one endpoint; routing is by the envelope key');
      if (!BROADCAST.has(type)) {
        const mine = routeKeyOf(s.event) === INV.A.id ? INV.A : INV.B;
        assert.deepEqual(owns(INV[mine.other], s.event), [], `${type}: an event routed to ${mine.tag} carries ${mine.other}'s values: ${s.body}`);
      }
    }
    /* the receiver (what the app files): per routing key, only that investor's values; each event applied once */
    const got = stub.recorded();
    assert.equal(got.length, 2, `${type}: both applied exactly once (A's retries did not apply twice)`);
    if (!BROADCAST.has(type)) for (const e of got) {
      const mine = routeKeyOf(e) === INV.A.id ? INV.A : INV.B;
      assert.deepEqual(owns(INV[mine.other], e), [], `${type}: receiver filed an event under ${mine.tag} carrying ${mine.other}'s values`);
      assert.ok(owns(mine, e).length > 0, `${type}: the ${mine.tag} event carries ${mine.tag}'s own values`);
    }
    /* the delivery state and the ledger: ids, type, status — each investor's record id on its own events only */
    if (!BROADCAST.has(type)) {
      assert.deepEqual(outbox.forRecord(INV.A.id).map((d) => d.eventId), [A.event_id]);
      assert.deepEqual(outbox.forRecord(INV.B.id).map((d) => d.eventId), [B.event_id]);
      for (const l of ledger) {
        const mine = l.eventId === A.event_id ? INV.A : INV.B;
        assert.equal(l.recordIds.includes(INV[mine.other].id), false, `${type}: the ledger line of ${mine.tag}'s event names ${mine.other}`);
        assert.deepEqual(Object.keys(l).sort(), ['at', 'attempts', 'eventId', 'reason', 'recordIds', 'status', 'type'], 'a ledger line is ids, type, status and codes only');
        assert.deepEqual(owns(INV.A, { ...l, recordIds: [] }).concat(owns(INV.B, { ...l, recordIds: [] })), [], 'no payload text in the ledger');
      }
    } else {
      assert.deepEqual(outbox.forRecord(INV.A.id).concat(outbox.forRecord(INV.B.id)), [], `${type}: a broadcast event is nobody's record`);
      for (const e of got) assert.deepEqual(owns(INV.A, e).concat(owns(INV.B, e)), [], `${type}: a broadcast event carries an investor's values`);
    }
    /* delivered events leave the queue payload-free: a replay of a delivered event is not possible, and no state holds the body */
    assert.equal(outbox.replay(A.event_id), false);
    assert.equal(JSON.stringify([outbox.state(A.event_id), outbox.state(B.event_id)]).includes('-owned-'), false, 'delivery state never carries payload text');
  });
}

test('acknowledging, bouncing, dead-lettering and replaying one investor\'s event touches only that investor\'s state', async () => {
  const { outbox } = pipe({ failFor: () => true });                  /* the receiver refuses everything: nothing is delivered by a drain */
  const A = fromSchema('case.replied', INV.A), B = fromSchema('case.replied', INV.B), A2 = fromSchema('update.published', INV.A);
  for (const e of [A, B, A2]) assert.equal(outbox.enqueue(e).ok, true);
  assert.equal(outbox.acknowledge(A.event_id, 'delivered'), true);
  assert.equal(outbox.state(A.event_id).status, 'delivered');
  assert.notEqual(outbox.state(B.event_id).status, 'delivered', 'A\'s push.delivered does not deliver B\'s event');
  assert.notEqual(outbox.state(A2.event_id).status, 'delivered', 'nor A\'s other event');
  assert.equal(outbox.acknowledge(B.event_id, 'bounced'), true);
  assert.equal(outbox.state(B.event_id).status, 'dead');
  assert.equal(outbox.state(A2.event_id).status, 'queued');
  assert.deepEqual(outbox.deadLetters().map((d) => d.eventId), [B.event_id]);
  assert.deepEqual(outbox.forRecord(INV.A.id).map((d) => d.eventId).sort(), [A.event_id, A2.event_id].sort());
  assert.deepEqual(outbox.forRecord(INV.B.id).map((d) => d.eventId), [B.event_id]);
  assert.equal(outbox.replay(B.event_id), true);
  assert.equal(outbox.state(B.event_id).status, 'queued');
  assert.equal(outbox.state(A.event_id).status, 'delivered', 'replaying B does not reopen A');
  /* an acknowledgement for an id the outbox does not hold changes nothing */
  assert.equal(outbox.acknowledge(uuid(), 'delivered'), false);
});

test('the same event for two investors is two events: an event id is never shared, and a duplicate event id is queued once, never re-routed', () => {
  const { outbox } = pipe();
  const A = fromSchema('case.replied', INV.A);
  const asB = { ...A, ids: { investor_contact_id: INV.B.id } };        /* a clash: the same event id, a different investor */
  assert.equal(outbox.enqueue(A).ok, true);
  const again = outbox.enqueue(asB);
  assert.equal(again.ok, true);
  assert.deepEqual(outbox.forRecord(INV.A.id).map((d) => d.eventId), [A.event_id]);
  assert.deepEqual(outbox.forRecord(INV.B.id), [], 'a colliding event id is queued once, under its first investor, never re-routed to the second');
});

test('stale delivery state: a ledger line for an event of A is never reported for B, and a restart reads as dead, never delivered', () => {
  const lines = [
    { at: 1, eventId: uuid(), type: 'case.replied', status: 'delivered', attempts: 1, reason: null, recordIds: [INV.A.id, '554023700000009001'] },
    { at: 2, eventId: uuid(), type: 'case.replied', status: 'queued', attempts: 0, reason: null, recordIds: [INV.B.id, '554023700000009002'] },
  ];
  assert.deepEqual(deliveriesForRecord([], lines, INV.A.id).map((d) => d.status), ['delivered']);
  assert.deepEqual(deliveriesForRecord([], lines, INV.B.id).map((d) => d.status), ['dead']);
  assert.deepEqual(deliveriesForRecord([], lines, '554023700000009999'), []);
  assert.deepEqual(deliveriesForRecord([], lines, INV.A.id).flatMap((d) => d.recordIds).filter((r) => r === INV.B.id), []);
});

test('the real builders: an event built for A holds A\'s ids and values only, validates, and passes the identity guard', () => {
  const at = NOW;
  const made = {
    A: [
      caseReplied({ caseId: '554023700000008001', contactId: INV.A.id, message: 'A-owned-message', byUserId: '554023700000007001', at }),
      requestExecuted({ appRequestId: 'req-A-xxxxxxxx', contactId: INV.A.id, state: 'received', caseId: '554023700000008001', byUserId: '554023700000007001', at }),
      farmProgress({ contactId: INV.A.id, project: 'A-owned-project', phase: 'Flowering', note: 'A-owned-note', at }),
      updatePublished({ updateId: '554023700000008101', contactId: INV.A.id, headline: 'A-owned-headline', kind: 'Produce', body: 'A-owned-body', byUserId: '554023700000007001', at }),
      holdChangedEvent({ allotmentId: '554023700000008201', investorId: INV.A.id, holdDay: '2026-10-20', state: 'extended', at, by: '554023700000007001', reason: '7 days' }),
    ],
    B: [
      caseReplied({ caseId: '554023700000008002', contactId: INV.B.id, message: 'B-owned-message', byUserId: '554023700000007001', at }),
      requestExecuted({ appRequestId: 'req-B-xxxxxxxx', contactId: INV.B.id, state: 'received', caseId: '554023700000008002', byUserId: '554023700000007001', at }),
      farmProgress({ contactId: INV.B.id, project: 'B-owned-project', phase: 'Harvest', note: 'B-owned-note', at }),
      updatePublished({ updateId: '554023700000008102', contactId: INV.B.id, headline: 'B-owned-headline', kind: 'Notice', body: 'B-owned-body', byUserId: '554023700000007001', at }),
      holdChangedEvent({ allotmentId: '554023700000008202', investorId: INV.B.id, holdDay: '2026-10-25', state: 'lapsed', at, by: '554023700000007001' }),
    ],
  };
  const { outbox } = pipe();
  for (const tag of ['A', 'B']) for (const e of made[tag]) {
    const inv = INV[tag];
    assert.equal(validateEvent(schemas, e).ok, true, `${e.type} valid`);
    assert.equal(routeKeyOf(e), inv.id, `${e.type}: routing key`);
    assert.deepEqual(identityPaths({ ...e, event_id: undefined, occurred_at: undefined }), [], `${e.type}: identity guard`);
    assert.deepEqual(owns(INV[inv.other], e), [], `${e.type} built for ${tag} holds ${inv.other}'s values`);
    assert.equal(outbox.enqueue(e).ok, true);
  }
  /* the shelf: no investor in it at all */
  const shelf = farmShelfChanged({ llpId: '554023700000008301', label: 'Farm LLP A', action: 'released', unitsReleased: 10, totalUnits: 100, byUserId: '554023700000007001', at });
  assert.deepEqual(shelf.ids, {});
  assert.equal(validateEvent(schemas, shelf).ok, true);
  assert.deepEqual(values(shelf).filter((v) => [INV.A.id, INV.B.id, INV.A.arl, INV.B.arl].includes(v)), []);
  assert.equal(JSON.stringify(shelf).includes('investor'), false, 'the shelf event names no investor');
});

test('the one fan-out (update.published): publishing to a segment of investors sends one event each, to its own routing key, and no event names another', async () => {
  const BOOK = Array.from({ length: 15 }, (_, i) => `${P}7409971${String(i + 1).padStart(2, '0')}`);
  const route = (c) => {
    if (c.path === '/coql') {
      if (/from Investor_Updates/.test(c.query)) return ['updates', 'coql.updates.list'];
      if (/from LLP_UnitAllocation_Module/.test(c.query)) return ['updates', /LLP = /.test(c.query) ? 'coql.allot.block-a' : 'coql.allot.issued'];
      if (/from Contacts/.test(c.query)) return ['updates', / in \(/.test(c.query) ? (/740997105/.test(c.query) ? 'coql.contacts.allotted' : 'coql.contacts.block-a') : 'coql.contacts.book'];
    }
    if (c.method === 'POST' && c.path === '/Investor_Updates') return ['updates', 'insert.update'];
    throw new Error(`unrouted ${c.method} ${c.path}`);
  };
  const rig = await makeHttpRig(load, route);
  const { outbox, stub, sent } = pipe();
  const push = async (e) => { const r = outbox.enqueue(e); await outbox.drain(); return r; };
  const HARSHA = `${P}740993002`;
  const r = await createInvestorUpdates({ ...rig, push, clock: () => NOW }).publish({ credential: await rig.cred(HARSHA), seat: 'head' },
    { headline: 'Quarterly statement', kind: 'Statement', audience: 'all', body: 'Statements for the quarter will be issued on 5 January.' });
  assert.equal(r.ok, true); assert.deepEqual(r.pushed, { queued: 15, refused: 0 });
  const got = stub.recorded();
  assert.equal(got.length, 15);
  assert.deepEqual(got.map(routeKeyOf).sort(), [...BOOK].sort(), 'one event per investor, each routed to its own id');
  for (const e of got) {
    const others = BOOK.filter((x) => x !== routeKeyOf(e));
    const j = JSON.stringify(e);
    assert.deepEqual(others.filter((x) => j.includes(x)), [], `the event routed to ${routeKeyOf(e)} names another investor`);
  }
  for (const id of BOOK) assert.equal(outbox.forRecord(id).length, 1, `${id}: one delivery state of its own`);
  assert.equal(new Set(sent.map((s) => s.event.event_id)).size, 15, 'no event id is shared between investors');
});

test('the identity guard holds for every outbound type: an investor-owned value that looks like PAN / account / UTR is refused before it is queued', () => {
  const { outbox } = pipe();
  for (const type of OUTBOUND) {
    const e = fromSchema(type, INV.A);
    const free = Object.entries(schemas[`${type}.json`].properties.payload.properties).filter(([, p]) => p.type === 'string' && !p.pattern && !p.enum && !p.format && !('const' in p)).map(([k]) => k);
    if (!free.length) continue;
    for (const [leak, shape] of [['pan', 'ABCDE1234F'], ['account', '50100288714520'], ['utr', 'HDFCR52026123456']]) {
      const bad = { ...e, event_id: uuid(), payload: { ...e.payload, [free[0]]: `see ${shape}` } };
      const r = outbox.enqueue(bad);
      assert.equal(r.ok, false, `${type}.${free[0]} carrying a ${leak} was queued`);
      assert.ok(['identity-in-event', 'invalid'].includes(r.reason), `${type}: ${leak} refused as ${r.reason}`);
    }
  }
});

test('a push signed for A does not verify for a body changed to B (the signature binds the routing key)', () => {
  const A = fromSchema('case.replied', INV.A);
  const body = JSON.stringify(A), sig = sign(body, KEY);
  const asB = JSON.stringify({ ...A, ids: { investor_contact_id: INV.B.id } });
  assert.equal(verify(body, sig, [KEY]), true);
  assert.equal(verify(asB, sig, [KEY]), false, 'rerouting a signed event to B breaks the signature');
});
