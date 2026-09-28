/* M11-S05 — allotment on the verified allocation letter (T02) and the allotment.done contract (T04), on recorded Zoho
   answers under lib/zoho/__fixtures__/allot (never live Zoho). Run from console/: node --test src/server/investors/allot.test.cjs */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { compile, makeHttpRig, recorded, P } = require('../cases/fixture-rig.cjs');

const load = compile(['server/investors/allot.ts', 'server/farms/oversell.ts', 'server/data/events.ts', 'server/identity/plane-c.ts',
  'server/contracts/events.ts', 'server/contracts/stub.ts', 'server/leads/journey.ts']);
const { createAllot, allotTransition, refusalMessage, ALLOTTED_TEXT } = load('server/investors/allot.js');
const { createOversellGuard } = load('server/farms/oversell.js');
const { validateEvent } = load('server/contracts/events.js');
const { loadSchemas } = load('server/contracts/stub.js');
const { RUNGS } = load('server/leads/journey.js');
const schemas = loadSchemas(path.resolve(__dirname, '..', '..', '..', '..', 'contracts'));

const HARSHA = `${P}740993003`, LATHA = `${P}740993009`;
const PRAKASH = `${P}740990208`, JOSEPH = `${P}740990209`, AP = `${P}740998208`, AJ = `${P}740998209`, B = `${P}740998302`, T = `${P}740999701`;
const SID = 'session-harsha-0001';
const A = (n) => ['allot', n];

/** Prakash: paid in full, KYC passed, resident; Block B has 6 issued + 4 reserved besides him (34 released). */
function route(over = {}) {
  const n = {};
  const pick = (k, v) => { n[k] = (n[k] ?? 0) + 1; return typeof v === 'function' ? v(n[k]) : v; };
  return (c) => {
    if (c.method === 'GET' && c.path === `/LLP_UnitAllocation_Module/${AP}`) return pick('ap', over.allotment ?? A('allotment.prakash-reserved'));
    if (c.method === 'GET' && c.path === `/LLP_UnitAllocation_Module/${AJ}`) return pick('aj', over.allotment ?? A('allotment.joseph-reserved'));
    if (c.method === 'PUT' && c.path === `/LLP_UnitAllocation_Module/${AP}`) return over.stamp ?? A('write.prakash-letter-verified');
    if (c.method === 'PUT' && c.path === `/LLP_UnitAllocation_Module/${AJ}`) return over.stamp ?? A('write.joseph-letter-verified');
    if (c.method === 'GET' && c.path === `/Contacts/${PRAKASH}`) return pick('cp', over.contact ?? A('contact.prakash'));
    if (c.method === 'GET' && c.path === `/Contacts/${JOSEPH}`) return pick('cj', over.contact ?? A('contact.joseph'));
    if (c.path === '/coql' && /from Receipts where Allotment = '(\d+)'/.test(c.query)) {
      return pick('rc', over.receipts ?? (c.query.includes(AP) ? A('coql.receipts-prakash-full') : A('coql.receipts-joseph-advance')));
    }
    if (c.path === '/coql' && /from LLP_Creation_Module/.test(c.query)) return ['farms', 'coql.guard-llp-b'];
    if (c.path === '/coql' && /group by Allocation_Status/.test(c.query)) return over.held ?? A('agg.held-b-others');
    if (c.method === 'GET' && /\/actions\/blueprint$/.test(c.path)) return over.blueprint ?? A('blueprint.allot-open');
    if (c.method === 'PUT' && /\/actions\/blueprint$/.test(c.path)) return over.transition ?? A('transition.ok');
    throw new Error(`unexpected ${c.method} ${c.path} ${c.query ?? ''}`);
  };
}

async function setup(over = {}, opts = {}) {
  const rig = await makeHttpRig(load, route(over));
  const published = [];
  const allot = createAllot({
    crm: rig.crm, log: logOf(rig), recordIdPrefix: P, clock: () => Date.parse('2026-09-28T06:00:00Z'),
    oversell: createOversellGuard({ crm: rig.crm, events: rig.events }),
    authority: { async mayVerify(cred) { return opts.seat !== 'auditor' && cred.userId === HARSHA; } },
    publish: opts.publish ?? (async (e) => { published.push(e); const v = validateEvent(schemas, e); return v.ok ? { ok: true, eventId: e.event_id } : { ok: false, reason: v.reason }; }),
  });
  const me = { credential: await rig.cred(opts.seat === 'auditor' ? LATHA : HARSHA), sessionId: SID };
  return { rig, allot, me, published };
}
function logOf(rig) {
  const { createOpsLog } = load('lib/zoho/log.js');
  return createOpsLog(rig.sink);
}
const blueprintPuts = (rig) => rig.calls.filter((c) => c.method === 'PUT' && /\/actions\/blueprint$/.test(c.path));

test('TC-IM06-007: verifying Prakash Bhat\'s allocation letter allots him through the blueprint transition', async () => {
  const { rig, allot, me, published } = await setup();
  const r = await allot.allot(me, PRAKASH, { allotmentId: AP, reference: 'EMU-2808-99001', expectedModifiedTime: '2026-09-27T16:00:00+05:30' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual([r.already, r.value.status, r.value.text, r.value.units, r.value.llp.label], [false, 'Issued', ALLOTTED_TEXT, 1, 'Block B']);
  assert.equal(r.value.text, 'Allotted. The units are theirs and the allocation letter is on file.');
  // The stamp: a guarded field write of the verification only — never Allocation_Status.
  const stamp = rig.calls.find((c) => c.method === 'PUT' && c.path === `/LLP_UnitAllocation_Module/${AP}`);
  assert.deepEqual(Object.keys(stamp.body.data[0]).sort(), ['Alloc_Letter_Verified_At', 'Alloc_Letter_Verified_By']);
  assert.equal(stamp.body.data[0].Alloc_Letter_Verified_At, '2026-09-28T11:30:00+05:30');
  assert.equal(stamp.headers['if-unmodified-since'] !== undefined, true, 'guarded write');
  // The transition: discovered, then PUT /actions/blueprint with its id.
  const [put] = blueprintPuts(rig);
  assert.deepEqual(put.body, { blueprint: [{ transition_id: T, data: { Issued_Units: 1 } }] });
  assert.ok(!rig.writes().some((c) => c.body && c.body.data && c.body.data.some((d) => 'Allocation_Status' in d)), 'no field write of the status');
  // The order: stamp before the blueprint (its condition reads the stamp).
  const order = rig.calls.map((c) => `${c.method} ${c.path}`);
  assert.ok(order.indexOf(`PUT /LLP_UnitAllocation_Module/${AP}`) < order.indexOf(`PUT /LLP_UnitAllocation_Module/${AP}/actions/blueprint`));
  assert.equal(published.length, 1);
  assert.equal(r.value.event.published, true);
  // Logs: ids and codes; never a name or the reference.
  const logs = JSON.stringify(rig.sink.records());
  assert.ok(!/Prakash|Bhat|EMU-2808/.test(logs));
  assert.ok(rig.sink.records().some((x) => x.action === 'allotment-allot' && x.reason === 'under-account-management'));
});

test('TC-IM06-008: the allotment moves the shelf — Block B 7 allotted · 4 reserved · 23 free; allotment.done carries units, LLP, at', async () => {
  const { rig, allot, me, published } = await setup();
  const r = await allot.allot(me, PRAKASH, { allotmentId: AP });
  assert.equal(r.ok, true);
  const held = rig.calls.find((c) => c.query && /group by Allocation_Status/.test(c.query)).query;
  assert.match(held, new RegExp(`id != '${AP}'`), 'the allotment itself is left out of the count');
  // 6 issued + 4 reserved others; Prakash's 1 becomes issued: 7 · 4 · 34 − 11 = 23.
  const others = recorded('allot', 'agg.held-b-others').body.data;
  const issued = others.find((x) => x.Allocation_Status === 'Issued')['SUM(Issued_Units)'] + r.value.units;
  const reserved = others.find((x) => x.Allocation_Status === 'Reserved')['SUM(Reserved_Units)'];
  assert.equal(`${issued} allotted · ${reserved} reserved · ${34 - issued - reserved} free`, '7 allotted · 4 reserved · 23 free');
  const e = published[0];
  assert.deepEqual([e.type, e.payload.units, e.payload.project, e.payload.at], ['allotment.done', 1, 'Block B', '2026-09-28T11:30:00+05:30']);
  assert.deepEqual(e.ids, { investor_contact_id: PRAKASH, arl_code: 'ARL-INV-0208' });
});

test('TC-IM06-009: Joseph Mathew (balance due, KYC pending, FEMA outstanding) is refused in-page and stays reserved', async () => {
  const { rig, allot, me, published } = await setup();
  const r = await allot.allot(me, JOSEPH, { allotmentId: AJ });
  assert.deepEqual([r.ok, r.kind, r.reasonCode], [false, 'refused', 'facts-missing']);
  assert.deepEqual(r.missing, ['balance', 'kyc', 'fema']);
  assert.match(r.message, /^Joseph Mathew cannot be allotted yet because the balance is still outstanding/);
  assert.equal(blueprintPuts(rig).length, 0, 'no transition attempted');
  assert.equal(published.length, 0, 'no allotment.done');
  // The letter is verified and stays on file.
  assert.ok(rig.calls.some((c) => c.method === 'PUT' && c.path === `/LLP_UnitAllocation_Module/${AJ}`));
  assert.ok(!/Joseph|Mathew/.test(JSON.stringify(rig.sink.records())));
});

test('TC-IM06-010: the Auditor cannot verify — refused before anything is read or written', async () => {
  const { rig, allot, me } = await setup({}, { seat: 'auditor' });
  const r = await allot.allot(me, PRAKASH, { allotmentId: AP });
  assert.deepEqual([r.ok, r.reasonCode], [false, 'not-finance']);
  assert.equal(rig.calls.length, 0);
});

test('TC-IM06-016 (console side): Zoho refuses the transition (FEMA) — the refusal names FEMA, nothing is emitted', async () => {
  // The console's facts read clear at first; Zoho's blueprint refuses; the fresh read shows FEMA outstanding.
  const cleared = { status: 200, body: { data: [{ ...recorded('allot', 'contact.joseph').body.data[0], KYC: 'Completed', FEMA_Verified_At: '2026-09-20T10:00:00+05:30' }] } };
  const { rig, allot, me, published } = await setup({
    allotment: A('allotment.joseph-verified'), receipts: A('coql.receipts-joseph-full'), contact: cleared, transition: A('transition.fema-refused'),
  });
  // The fresh read after Zoho's refusal still reads clear here, so Zoho's word stands (generic message); below, FEMA open is named first.
  const r0 = await allot.allot(me, JOSEPH, { allotmentId: AJ });
  assert.deepEqual([r0.ok, r0.reasonCode], [false, 'blueprint-refused']);
  assert.equal(blueprintPuts(rig).length, 1);
  assert.equal(published.length, 0, 'no allotment.done');
  assert.ok(!rig.writes().some((c) => c.method === 'PUT' && c.path === `/LLP_UnitAllocation_Module/${AJ}`), 'already verified: no second stamp');
  const r = await setup({ allotment: A('allotment.joseph-verified'), receipts: A('coql.receipts-joseph-full'),
    contact: A('contact.joseph-balance-kyc-done'), transition: A('transition.fema-refused') });
  const refused = await r.allot.allot(r.me, JOSEPH, { allotmentId: AJ });
  assert.deepEqual([refused.reasonCode, refused.missing], ['facts-missing', ['fema']], 'the console names FEMA before Zoho has to');
  assert.match(refused.message, /because FEMA is not cleared/);
});

test('a blueprint whose conditions Zoho reports unmet is not attempted; no blueprint at all is "no-transition"', async () => {
  const unmet = await setup({ blueprint: A('blueprint.allot-criteria-unmet') });
  const r1 = await unmet.allot.allot(unmet.me, PRAKASH, { allotmentId: AP });
  assert.deepEqual([r1.ok, r1.reasonCode], [false, 'blueprint-refused']);
  assert.equal(blueprintPuts(unmet.rig).length, 0);
  assert.ok(!/Balance due must be zero/.test(JSON.stringify(unmet.rig.sink.records())), 'criteria text never logged');
  const none = await setup({ blueprint: A('blueprint.none') });
  const r2 = await none.allot.allot(none.me, PRAKASH, { allotmentId: AP });
  assert.deepEqual([r2.ok, r2.reasonCode], [false, 'no-transition']);
  assert.equal(blueprintPuts(none.rig).length, 0);
  assert.equal(none.published.length, 0);
});

test('the transition is found by its target value, else by name; Cancel is never taken', async () => {
  const byName = await setup({ blueprint: A('blueprint.allot-by-name') });
  const r = await byName.allot.allot(byName.me, PRAKASH, { allotmentId: AP });
  assert.equal(r.ok, true);
  assert.equal(blueprintPuts(byName.rig)[0].body.blueprint[0].transition_id, T);
  assert.equal(allotTransition([{ id: '1', name: 'Cancel', nextFieldValue: 'Cancelled', criteriaMatched: true, criteriaMessage: null, fields: [] }]), null);
});

test('second press on an Issued allotment: already, nothing written, no event re-emitted', async () => {
  const { rig, allot, me, published } = await setup({ allotment: A('allotment.prakash-issued') });
  const r = await allot.allot(me, PRAKASH, { allotmentId: AP });
  assert.deepEqual([r.ok, r.already, r.value.text], [true, true, ALLOTTED_TEXT]);
  assert.equal(rig.writes().filter((c) => c.method !== 'GET').length, 0);
  assert.equal(published.length, 0);
});

test('no signed letter on the allotment → refused; a changed allotment → "changed"; another Contact\'s allotment → not visible', async () => {
  const nl = await setup({ allotment: A('allotment.prakash-no-letter') });
  assert.equal((await nl.allot.allot(nl.me, PRAKASH, { allotmentId: AP })).reasonCode, 'letter-missing');
  const ch = await setup({ stamp: A('write.allotment-modified') });
  assert.equal((await ch.allot.allot(ch.me, PRAKASH, { allotmentId: AP })).reasonCode, 'changed');
  const st = await setup();
  assert.equal((await st.allot.allot(st.me, PRAKASH, { allotmentId: AP, expectedModifiedTime: '2026-09-01T10:00:00+05:30' })).reasonCode, 'changed');
  const other = await setup();
  assert.equal((await other.allot.allot(other.me, JOSEPH, { allotmentId: AP })).reasonCode, 'not-visible');
  const bad = await setup();
  assert.equal((await bad.allot.allot(bad.me, PRAKASH, { allotmentId: "x' or 1=1" })).reasonCode, 'invalid-request');
  assert.equal(bad.rig.calls.length, 0);
});

test('a full LLP refuses before the blueprint (oversell guard)', async () => {
  const { rig, allot, me } = await setup({ held: ['farms', 'agg.held-b-full'] });
  const r = await allot.allot(me, PRAKASH, { allotmentId: AP });
  assert.deepEqual([r.ok, r.reasonCode], [false, 'oversell']);
  assert.match(r.message, /^Block B has no free units for Prakash Bhat's 1 unit\.$/);
  assert.equal(blueprintPuts(rig).length, 0);
});

test('a push that is refused (the stub does not accept allotment.done) never undoes the allotment', async () => {
  const { allot, me, rig } = await setup({}, { publish: async () => ({ ok: false, reason: 'unknown-type' }) });
  const r = await allot.allot(me, PRAKASH, { allotmentId: AP });
  assert.equal(r.ok, true);
  assert.deepEqual(r.value.event, { published: false, eventId: null, reason: 'unknown-type' });
  assert.ok(rig.sink.records().some((x) => x.action === 'allotment-done-push' && x.reason === 'unknown-type'));
});

test('a direct write of Allocation_Status: Zoho refuses it (recorded) and allot.ts never writes the field', async () => {
  const rig = await makeHttpRig(load, () => A('direct-status-write.refused'));
  const w = await rig.crm.update(await rig.cred(HARSHA), 'LLP_UnitAllocation_Module', AP, { Allocation_Status: 'Issued' }, { ifUnmodifiedSince: null });
  assert.equal(w.ok, false);
  assert.equal(w.error.field ?? (w.error.records && w.error.records[0].field), 'Allocation_Status');
  const src = fs.readFileSync(path.join(__dirname, 'allot.ts'), 'utf8');
  assert.equal(/Allocation_Status\s*:/.test(src), false, 'no Allocation_Status field write in allot.ts');
});

test('client.blueprint(): GET /actions/blueprint parsed to transitions; 204 is null', async () => {
  const rig = await makeHttpRig(load, (c) => (c.path.endsWith(AP + '/actions/blueprint') ? A('blueprint.allot-open') : A('blueprint.none')));
  const cred = await rig.cred(HARSHA);
  const r = await rig.crm.blueprint(cred, 'LLP_UnitAllocation_Module', AP);
  assert.equal(r.ok, true);
  assert.deepEqual([r.value.fieldApiName, r.value.fieldValue, r.value.transitions.length], ['Allocation_Status', 'Reserved', 2]);
  assert.deepEqual(r.value.transitions[0], { id: T, name: 'Allot', nextFieldValue: 'Issued', criteriaMatched: true, criteriaMessage: null, fields: ['Issued_Units'] });
  const none = await rig.crm.blueprint(cred, 'LLP_UnitAllocation_Module', AJ);
  assert.deepEqual([none.ok, none.value], [true, null]);
});

/* ---- T04: contract test allotment.done ------------------------------------------------------------------ */

test('T04: allotment.done validates against contracts/allotment.done.json; a wrong payload does not', async () => {
  const { allot, me, published } = await setup();
  await allot.allot(me, PRAKASH, { allotmentId: AP });
  const e = published[0];
  assert.deepEqual(validateEvent(schemas, e), { ok: true, type: 'allotment.done' });
  assert.equal(e.origin, 'console');
  assert.equal(validateEvent(schemas, { ...e, payload: { units: 1, project: 'Block B' } }).ok, false, 'at is required');
  assert.equal(validateEvent(schemas, { ...e, payload: { ...e.payload, amount: 2500000 } }).ok, false, 'no extra payload field (no money)');
  assert.equal(validateEvent(schemas, { ...e, ids: { ...e.ids, arl_code: 'ARL-0208' } }).ok, false);
});

test('T04: the lead rung the allotment ticks — the "Allocated" rung is gated on alloc in server/leads/journey RUNGS', () => {
  const r = RUNGS.find((x) => x.field === 'Allocated_At');
  assert.ok(r && r.gate === 'alloc');
  // The story calls it rung 7; journey.ts numbers it 8 (Fully paid is 7). Reported, not changed here (read-only).
  assert.equal(r.n, 8);
});

test('refusalMessage lists facts in order', () => {
  assert.equal(refusalMessage('Joseph Mathew', ['balance']), 'Joseph Mathew cannot be allotted yet because the balance is still outstanding. The allocation letter stays on file; the units stay reserved.');
  assert.match(refusalMessage(null, ['balance', 'kyc', 'fema']), /^This investor cannot be allotted yet because the balance is still outstanding, KYC has not passed and FEMA is not cleared\./);
});
