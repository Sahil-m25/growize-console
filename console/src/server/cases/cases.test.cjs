/* M13-S02-T02 — the tickets register by seat on recorded Zoho answers. Run from console/: node --test src/server/cases/cases.test.cjs */
'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { compile, makeRig, P } = require('./fixture-rig.cjs');

const load = compile(['server/cases/register.ts', 'server/cases/predicate.ts', 'server/data/scope.ts', 'server/data/events.ts', 'server/identity/plane-c.ts']);
const { createCasesRegister, cutsOf } = load('server/cases/register.js');
const { ownerWhere, inClause } = load('server/cases/predicate.js');
const { scopesFor } = load('server/data/scope.js');
const HARSHA = `${P}740993002`, KAM = `${P}740994001`, DIVYA = `${P}740994009`, LATHA = `${P}740993009`, IR = `${P}740995001`, FIN = `${P}740993001`;

const route = (q) => /COUNT\(id\)/.test(q) ? ['cases', /Owner = /.test(q) ? 'agg.cuts.kam' : 'agg.cuts.org'] : ['cases', /Owner = /.test(q) ? 'coql.cases.kam' : 'coql.cases.org'];

test('Head of Finance: Open shows 6, two high priority, rows in Zoho order; the counts come from one cached group-by', async () => {
  const rig = await makeRig(load, route);
  const reg = createCasesRegister(rig);
  const r = await reg.list({ credential: await rig.cred(HARSHA), seat: 'head' });
  assert.equal(r.ok, true);
  const open = r.rows.filter((x) => x.state !== 'closed');
  assert.deepEqual(open.map((x) => x.t), ['Change the bank account for payouts', 'Wants the Block A harvest note for her brother',
    'New address after a move to Baner', 'Asked to move her quarterly call to evenings', 'FIRC copy for the inward remittance', 'Add a nominee']);
  assert.equal(r.cuts.state, 'fresh');
  assert.deepEqual({ ...r.cuts.value }, { open: 6, high: 2, waiting: 1, closed: 1, all: 7 });
  assert.equal(open.filter((x) => x.pri === 'high').length, r.cuts.value.high);
  assert.equal(r.rows[0].cat, 'Bank');
  assert.equal(r.rows[0].inv, `${P}740997101`);
  assert.equal(r.rows[2].state, 'waiting');
  assert.equal(r.rows[6].closed, '2026-09-11T12:00');
  assert.equal(r.readOnly, false);
  assert.equal(r.offersMine, true);
  await reg.list({ credential: await rig.cred(FIN), seat: 'fin' }); // same org key: the count is not re-read
  assert.equal(rig.queries.filter((q) => /COUNT/.test(q)).length, 1);
  assert.match(rig.queries.find((q) => !/COUNT/.test(q)), /from Cases where \(id is not null\)/);
});

test('M13-S02/S03/S04: every register row carries Cases.Modified_Time as version (selected explicitly), for PATCH and the handover to send back', async () => {
  const rig = await makeRig(load, route);
  const r = await createCasesRegister(rig).list({ credential: await rig.cred(HARSHA), seat: 'head' });
  assert.equal(r.ok, true);
  assert.equal(r.rows[0].version, '2026-09-20T11:00:00+05:30');
  assert.ok(r.rows.every((x) => typeof x.version === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(x.version)));
  assert.match(rig.queries.find((q) => !/COUNT/.test(q)), /, Modified_Time from Cases where/);
});

test('a KAM sees exactly their own 3 tickets (Owner = me), not FIRC; no Mine cut', async () => {
  const rig = await makeRig(load, route);
  const r = await createCasesRegister(rig).list({ credential: await rig.cred(KAM), seat: 'kam' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.rows.map((x) => x.t), ['Change the bank account for payouts', 'Wants the Block A harvest note for her brother', 'New address after a move to Baner']);
  assert.ok(!r.rows.some((x) => /FIRC/.test(x.t)));
  assert.equal(r.offersMine, false);
  assert.equal(r.mine, 3);
  assert.ok(rig.queries.every((q) => q.includes(`Owner = '${KAM}'`)));
});

test('a ticket outside the KAM\'s book refuses the whole read and writes one Plane B line by id', async () => {
  const rig = await makeRig(load, (q) => /COUNT/.test(q) ? ['cases', 'agg.cuts.kam'] : ['cases', 'coql.cases.kam-foreign']);
  const r = await createCasesRegister(rig).list({ credential: await rig.cred(KAM), seat: 'kam' });
  assert.deepEqual(r, { ok: false, kind: 'refused', reason: 'scope-drift' });
  const lines = rig.sink.records().filter((x) => x.kind === 'refusal');
  assert.equal(lines.length, 1);
  assert.deepEqual([...lines[0].recordIds], [`${P}740998405`]);
  assert.ok(!JSON.stringify(lines).includes('FIRC'));
});

test('the Auditor reads the register read only', async () => {
  const rig = await makeRig(load, route);
  const r = await createCasesRegister(rig).list({ credential: await rig.cred(LATHA), seat: 'audit' });
  assert.equal(r.ok, true);
  assert.equal(r.readOnly, true);
});

test('the Head of AM reads by the role subtree — the same owner predicate the team views use', async () => {
  const rig = await makeRig(load, route);
  const r = await createCasesRegister({ ...rig, subtreeOf: async () => [KAM] }).list({ credential: await rig.cred(DIVYA), seat: 'amlead' });
  assert.equal(r.ok, false); // the org fixture holds Finance-owned cases: outside the subtree, so refused
  assert.equal(r.reason, 'scope-drift');
  assert.match(rig.queries[0], new RegExp(`Owner in \\('${DIVYA}', '${KAM}'\\)`));
  const noReader = await makeRig(load, route);
  const r2 = await createCasesRegister(noReader).list({ credential: await noReader.cred(DIVYA), seat: 'amlead' });
  assert.equal(r2.ok, true); // PROVISIONAL: without a subtree reader, the token under Zoho's role hierarchy limits it
});

test('an IR has no tickets book: refused before any call', async () => {
  const rig = await makeRig(load, route);
  const r = await createCasesRegister(rig).list({ credential: await rig.cred(IR), seat: 'ir' });
  assert.deepEqual(r, { ok: false, kind: 'refused', reason: 'no-book' });
  assert.equal(rig.queries.length, 0);
});

test('the owner predicate: one function for every scope; IN lists split at 100', () => {
  assert.equal(ownerWhere(scopesFor('kam', KAM).cases), `Owner = '${KAM}'`);
  assert.equal(ownerWhere(scopesFor('ir', IR).leads, { secondaryOwner: true }), `(Owner = '${IR}' or Secondary_Owner = '${IR}')`);
  assert.equal(ownerWhere(scopesFor('fin', FIN).cases), 'id is not null');
  assert.equal(ownerWhere(scopesFor('ir', IR).cases), null);
  const ids = Array.from({ length: 150 }, (_, i) => `${P}7409${String(i).padStart(5, '0')}`);
  const c = inClause('Owner', ids);
  assert.equal((c.match(/Owner in/g) || []).length, 2);
  assert.equal(inClause('Owner', ["1' or '1'='1"]), null);
});

test('a Zoho failure is a source error, never an empty register', async () => {
  const rig = await makeRig(load, () => ({ status: 500, body: { code: 'INTERNAL_ERROR' } }));
  const r = await createCasesRegister(rig).list({ credential: await rig.cred(HARSHA), seat: 'head' });
  assert.equal(r.kind, 'source-error');
  assert.deepEqual({ ...cutsOf([]) }, { open: 0, high: 0, waiting: 0, closed: 0, all: 0 });
});
