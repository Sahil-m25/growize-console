/* M09-S07-T01 — investor search on recorded Zoho answers. Run from console/: node --test src/server/investors/search.test.cjs */
'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { compile, makeRig, makeHttpRig, P } = require('../cases/fixture-rig.cjs');

const load = compile(['server/investors/search.ts', 'server/data/events.ts', 'server/identity/plane-c.ts']);
const { createInvestorSearch, investorSearchRequestOf, investorQueryFor, SEARCH_FIELDS } = load('server/investors/search.js');
const FIN = `${P}740993001`, NEHA = `${P}740994002`, ROHIT = `${P}740995001`;
const B = `${P}740998302`;
const byQuery = (q) => /ARL_ID = /.test(q) ? ['investor-search', 'coql.code'] : /Mobile like/.test(q) ? ['investor-search', 'coql.phone'] : ['investor-search', 'coql.mysuru'];
const fin = async (rig) => ({ credential: await rig.cred(FIN), seat: 'fin' });
const search = (rig, extra = {}) => createInvestorSearch({ crm: rig.crm, events: rig.events, log: load('lib/zoho/log.js').createOpsLog(rig.sink), cache: rig.cache, ...extra });
const find = (rig, p, term, farmId = null, extra) => search(rig, extra).find(p, { term, farmId });

test("Finance types 'Mysuru': exactly the two Mysuru investors, last four digits only, no text in Plane B", async () => {
  const rig = await makeRig(load, byQuery);
  const r = await find(rig, await fin(rig), 'Mysuru');
  assert.equal(r.ok, true);
  assert.deepEqual(r.value.hits.map((h) => [h.name, h.code, h.city, h.phoneLast4]),
    [['Fixture Prakash', 'ARL-INV-0208', 'Mysuru', '5519'], ['Fixture Harish', 'ARL-INV-0216', 'Mysuru', '3017']]);
  assert.equal(r.value.book, 'org');
  const q = rig.queries[0];
  assert.match(q, /from Contacts where \(\(id is not null\) and \(\(First_Name like '%Mysuru%' or Last_Name like '%Mysuru%' or Mailing_City like '%Mysuru%' or ARL_ID like '%Mysuru%'\)\)\)/);
  assert.ok(!/Total_|PAN|Aadhaar|Bank/i.test(q));
  // Never the full number, never the query in the log.
  assert.ok(!JSON.stringify(r).includes('55519') && !JSON.stringify(r).includes('+91'));
  const logs = JSON.stringify(rig.sink.records());
  assert.ok(!/mysuru/i.test(logs));
  assert.ok(rig.sink.records().some((x) => x.kind === 'event' && x.action === 'investor-search' && x.reason === 'scope-org.count-2'));
});

test('an ARL code finds that one investor through an exact ARL_ID match', async () => {
  const rig = await makeRig(load, byQuery);
  const r = await find(rig, await fin(rig), 'arl-inv-0220');
  assert.deepEqual(r.value.hits.map((h) => h.code), ['ARL-INV-0220']);
  assert.match(rig.queries[0], /\(ARL_ID = 'ARL-INV-0220'\)/);
});

test('phone digits match the end of the mobile: Zoho is asked for the last four, the typed digits decide', async () => {
  const rig = await makeRig(load, byQuery);
  const r = await find(rig, await fin(rig), '33017');
  assert.match(rig.queries[0], /Mobile like '%3017'/);
  assert.deepEqual(r.value.hits.map((h) => [h.code, h.phoneLast4]), [['ARL-INV-0216', '3017']]);
  assert.equal((await find(rig, await fin(rig), '017')).reasonCode, 'term-too-short');
});

test("a KAM searches only their own book: KAM = me in the WHERE; a name outside it matches nobody; a slipped row is dropped and logged", async () => {
  const rig = await makeRig(load, (q) => /Joseph/.test(q) ? { status: 204, body: null } : byQuery(q));
  const p = { credential: await rig.cred(NEHA), seat: 'kam' };
  const none = await find(rig, p, 'Joseph');
  assert.deepEqual(none.value.hits, []);
  assert.match(rig.queries[0], new RegExp(`\\(KAM = '${NEHA}'\\)`));
  const r = await find(rig, p, 'Mysuru');
  assert.deepEqual(r.value.hits.map((h) => h.code), ['ARL-INV-0216']);
  assert.ok(rig.sink.records().some((x) => x.kind === 'refusal' && x.reason === 'outside-book' && x.recordIds.includes(`${P}740997208`)));
  assert.equal(r.value.book, 'own-book');
});

test("an IR matches only investors from their own leads (Originating_IR + Origin_Lead in the WHERE, admitContact after)", async () => {
  const rig = await makeRig(load, byQuery);
  const r = await find(rig, { credential: await rig.cred(ROHIT), seat: 'ir' }, 'Mysuru');
  assert.match(rig.queries[0], new RegExp(`Originating_IR = '${ROHIT}' and Origin_Lead is not null`));
  assert.deepEqual(r.value.hits.map((h) => h.code), ['ARL-INV-0208']);
  assert.ok(rig.sink.records().some((x) => x.kind === 'refusal' && x.reason === 'outside-book' && x.recordIds.includes(`${P}740997216`)));
});

test('a seat without an Investors book is refused before any read; a one-letter term is too short', async () => {
  const rig = await makeRig(load, byQuery);
  assert.equal((await find(rig, { credential: await rig.cred(ROHIT), seat: 'cp' }, 'Mysuru')).reasonCode, 'capability-missing');
  assert.equal((await find(rig, await fin(rig), 'a')).reasonCode, 'term-too-short');
  assert.equal(rig.queries.length, 0);
});

test('the wall: only q and farm; another module or own criteria refused; an owner filter ignored; nothing can break the quote', async () => {
  const req = (s) => investorSearchRequestOf(new URLSearchParams(s));
  assert.deepEqual(req('q=Mysuru&owner=123'), { ok: true, term: 'Mysuru', farmId: null });
  assert.deepEqual(req(`farm=${B}`), { ok: true, term: null, farmId: B });
  assert.equal(req('q=x&module=Leads').reasonCode, 'module-refused');
  assert.equal(req('q=x&module=Contacts').ok, true);
  for (const bad of ['q=x&criteria=(Owner:equals:1)', 'q=x&fields=PAN', 'q=a&q=b', 'farm=1%27', '', 'q=%20']) assert.equal(req(bad).ok, false, bad);
  const inj = investorQueryFor("x' or ARL_ID like '%");
  const rig = await makeRig(load, byQuery);
  await find(rig, await fin(rig), "Pr' or 1=1 --");
  assert.equal((rig.queries[0].match(/'/g) || []).length % 2, 0);
  assert.ok(!/1=1/.test(rig.queries[0]));
  assert.ok(inj.tokens.every((t) => !/['%]/.test(t)));
  assert.ok(!SEARCH_FIELDS.some((f) => /pan|bank|aadhaar|amount/i.test(f)));
});

test('the farm filter reads the LLP allotments (Cancelled excluded) and asks Contacts for those ids only', async () => {
  const route = (c) => c.path.endsWith('/Customer_List') ? ['investor-search', 'related.llp-b'] : byQuery(c.query);
  const rig = await makeHttpRig(load, route);
  const p = await fin(rig);
  const r = await find(rig, p, null, B);
  assert.equal(r.ok, true);
  assert.equal(r.value.farmId, B);
  const q = rig.calls.find((c) => c.path === '/coql').query;
  assert.match(q, new RegExp(`id in \\('${P}740997208', '${P}740997216'\\)`));
  assert.ok(!q.includes(`${P}740997230`));
  assert.equal(r.value.hits.length, 2);
  // q + farm: Kiran's number also ends 3017, but Kiran is not on the farm.
  const both = await find(rig, p, '3017', B);
  assert.deepEqual(both.value.hits.map((h) => h.code), ['ARL-INV-0216']);
});

test('only the count is cached, under the caller\'s scope and an HMAC of the query — never the words', async () => {
  const keys = [];
  const cache = { async readSettled(k, load) { keys.push(k); const v = await load(); return { state: 'fresh', value: v, asOf: 0 }; } };
  const rig = await makeRig(load, byQuery);
  await find(rig, { credential: await rig.cred(ROHIT), seat: 'ir' }, 'Mysuru', null, { cache });
  assert.equal(keys.length, 1);
  assert.deepEqual(keys[0].scope, { kind: 'user', userId: ROHIT });
  assert.match(keys[0].name, /^own-lead\.investors\.search\.[0-9a-f]{24}$/);
  assert.ok(!/mysuru/i.test(JSON.stringify(keys)));
});

test('a Zoho failure is a source error, never an empty result', async () => {
  const rig = await makeRig(load, () => ({ status: 500, body: { code: 'INTERNAL_ERROR' } }));
  const r = await find(rig, await fin(rig), 'Mysuru');
  assert.equal(r.kind, 'source-error');
});
