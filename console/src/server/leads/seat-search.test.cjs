/* THE TOP-BAR SEARCH FOLLOWS THE SEAT (M06-S03-W2, M06-S05-W2, D110 ruling 2)
 *
 * Run from console/: node --test src/server/leads/seat-search.test.cjs
 *
 * Compiles server/leads/seat-search.ts and drives it with recorded halves: the lead half is the walled lead search
 * (./search), the investor half the scoped investor search (../investors/search); both are stubs here that record
 * what they were asked, so each seat's answer — which half is asked, on whose token, and what reaches the page —
 * is checked without a Zoho call. The halves' own scope rules are tested in leads.test.cjs / wall.test.cjs and
 * investors' own suite.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const consoleRoot = path.resolve(__dirname, '..', '..', '..');
const srcRoot = path.join(consoleRoot, 'src');
const ts = require(path.join(consoleRoot, 'node_modules', 'typescript'));
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seat-search-'));
process.on('exit', () => fs.rmSync(outDir, { recursive: true, force: true }));

const config = ts.readConfigFile(path.join(consoleRoot, 'tsconfig.json'), ts.sys.readFile);
const project = ts.parseJsonConfigFileContent(config.config, ts.sys, consoleRoot);
const options = { ...project.options, incremental: false, tsBuildInfoFile: undefined, plugins: undefined,
  module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10, noEmit: false, noEmitOnError: true, outDir, rootDir: srcRoot };
const program = ts.createProgram([path.join(srcRoot, 'server/leads/seat-search.ts')], options);
const diagnostics = [...ts.getPreEmitDiagnostics(program), ...program.emit().diagnostics];
if (diagnostics.length) {
  console.error(ts.formatDiagnostics(diagnostics, { getCanonicalFileName: (f) => f, getCurrentDirectory: () => consoleRoot, getNewLine: () => '\n' }));
  process.exit(1);
}
const { createSeatSearch, searchPlanOf, seatSearchRequestOf } = require(path.join(outDir, 'server/leads/seat-search.js'));

const P = '9007199254';
const ME = `${P}740995001`, OTHER = `${P}740995009`;
const cred = { kind: 'user', userId: ME };
const q = (s) => new URLSearchParams(s);

const LEAD = (id, owner) => ({ id: `${P}74099620${id}`, name: `Synthetic Lead ${id}`, phoneLast4: '0001', stage: 'Lead captured', ownerId: owner });
const INV = (id) => ({ id: `${P}74099830${id}`, name: `Synthetic Investor ${id}`, code: `ARL-INV-000${id}`, city: 'Pune', phoneLast4: '0002' });

/** Stub halves: each records who asked it and answers what it is given. */
function rig({ lead = { ok: true, value: { book: 'yours', hits: [LEAD(1, ME)], more: 0 } }, inv = { ok: true, value: { book: 'org', hits: [INV(1)], more: 0, farmId: null } } } = {}) {
  const asked = { leads: [], investors: [] };
  const svc = createSeatSearch({
    leads: { async find(p, term) { asked.leads.push({ userId: p.credential.userId, term }); return lead; } },
    investors: async () => ({ async find(p, req) { asked.investors.push({ userId: p.credential.userId, seat: p.seat, term: req.term, farmId: req.farmId }); return inv; } }),
  });
  return { svc, asked };
}
const find = (r, seat, term = 'Synthetic', only = null) => r.svc.find({ credential: cred, sessionId: 'session_fixture_seat_0001', seat }, { term, only });

/* ---- the plan per seat ---- */
test('D110: IR and IR Manager search leads only, behind the Contacts wall', () => {
  for (const seat of ['ir', 'conv']) assert.deepEqual({ ...searchPlanOf(seat) }, { leads: true, investors: false, contactsWall: true }, seat);
});
test('D110: Digital Infrastructure and the business owner search org-wide, leads AND investors', () => {
  for (const seat of ['ops', 'di', 'bu']) assert.deepEqual({ ...searchPlanOf(seat) }, { leads: true, investors: true, contactsWall: false }, seat);
});
test('D110: Finance, KAM and Head of AM search investors within their scope, no leads', () => {
  for (const seat of ['head', 'fin', 'comp', 'kam', 'amlead']) assert.deepEqual({ ...searchPlanOf(seat) }, { leads: false, investors: true, contactsWall: false }, seat);
});
test('an unknown seat searches nothing', () => {
  assert.deepEqual({ ...searchPlanOf('marketing') }, { leads: false, investors: false, contactsWall: true });
});

/* ---- M06-S05-W2: the wall per seat ---- */
test('M06-S05: an IR naming Contacts is refused before anything is read', () => {
  assert.deepEqual(seatSearchRequestOf(q('q=Asha&module=Contacts'), searchPlanOf('ir')), { ok: false, reasonCode: 'module-refused' });
});
test('M06-S05: an IR Manager naming Contacts is refused too', () => {
  assert.deepEqual(seatSearchRequestOf(q('q=Asha&module=Contacts'), searchPlanOf('conv')), { ok: false, reasonCode: 'module-refused' });
});
test('M06-S05: Digital Infrastructure may name Contacts (its own token reads them)', () => {
  assert.deepEqual(seatSearchRequestOf(q('q=Asha&module=Contacts'), searchPlanOf('ops')), { ok: true, term: 'Asha', only: 'investors' });
  assert.deepEqual(seatSearchRequestOf(q('q=Asha'), searchPlanOf('ops')), { ok: true, term: 'Asha', only: null });
});
test('M06-S05: Finance may name Contacts; not Leads, which its seat does not read', () => {
  assert.deepEqual(seatSearchRequestOf(q('q=Asha&module=Contacts'), searchPlanOf('head')), { ok: true, term: 'Asha', only: 'investors' });
  assert.deepEqual(seatSearchRequestOf(q('q=Asha&module=Leads'), searchPlanOf('head')), { ok: false, reasonCode: 'module-refused' });
});
test('every seat: its own criteria or a second module is refused; an owner filter is ignored', () => {
  for (const seat of ['ir', 'ops', 'head']) {
    assert.deepEqual(seatSearchRequestOf(q('q=Asha&criteria=(Email:equals:x)'), searchPlanOf(seat)), { ok: false, reasonCode: 'invalid-request' }, seat);
    assert.equal(seatSearchRequestOf(q(`q=Asha&owner=${OTHER}`), searchPlanOf(seat)).ok, true, seat);
    assert.equal(seatSearchRequestOf(q('q=Asha&module=Accounts'), searchPlanOf(seat)).ok, false, seat);
  }
  assert.deepEqual(seatSearchRequestOf(q('q=Asha&module=Contacts&module=Leads'), searchPlanOf('ops')), { ok: false, reasonCode: 'invalid-request' });
});

/* ---- M06-S03-W2: who is asked, and what comes back ---- */
test('an IR: only the lead half is asked; hits are leads, their own', async () => {
  const r = rig();
  const res = await find(r, 'ir');
  assert.equal(res.ok, true);
  assert.equal(r.asked.investors.length, 0, 'never a Contacts read for an IR');
  assert.deepEqual(r.asked.leads, [{ userId: ME, term: 'Synthetic' }], 'on their own token');
  assert.deepEqual(res.value.hits.map((h) => [h.kind, h.mine]), [['lead', true]]);
  assert.equal(res.value.book, 'yours');
  assert.equal(res.value.investorBook, null);
});
test('an IR Manager: the team\'s leads; another IR\'s lead is marked not theirs', async () => {
  const r = rig({ lead: { ok: true, value: { book: 'team', hits: [LEAD(1, ME), LEAD(2, OTHER)], more: 0 } } });
  const res = await find(r, 'conv');
  assert.equal(r.asked.investors.length, 0);
  assert.equal(res.value.book, 'team');
  assert.deepEqual(res.value.hits.map((h) => h.mine), [true, false]);
});
test('Digital Infrastructure: leads and investors, each hit carrying its kind', async () => {
  const r = rig({ lead: { ok: true, value: { book: 'all', hits: [LEAD(1, OTHER)], more: 2 } }, inv: { ok: true, value: { book: 'all', hits: [INV(1), INV(2)], more: 0, farmId: null } } });
  const res = await find(r, 'ops');
  assert.deepEqual(res.value.hits.map((h) => h.kind), ['lead', 'investor', 'investor']);
  assert.deepEqual(r.asked.investors, [{ userId: ME, seat: 'ops', term: 'Synthetic', farmId: null }], 'the investor half on the same own token');
  assert.equal(res.value.book, 'all');
  assert.equal(res.value.investorBook, 'all');
  assert.equal(res.value.more, 2);
  assert.ok(res.value.hits.every((h) => !('mobile' in h) && /^\d{4}$/.test(h.phoneLast4)), 'never the full number');
});
test('Digital Infrastructure narrowing to Contacts asks only the investor half', async () => {
  const r = rig();
  await find(r, 'ops', 'Synthetic', 'investors');
  assert.equal(r.asked.leads.length, 0);
  assert.equal(r.asked.investors.length, 1);
});
test('Finance: only the investor half, within its scope; never a lead', async () => {
  const r = rig();
  const res = await find(r, 'head');
  assert.equal(r.asked.leads.length, 0, 'Finance never reads Leads');
  assert.deepEqual(res.value.hits.map((h) => h.kind), ['investor']);
  assert.equal(res.value.book, null);
  assert.equal(res.value.investorBook, 'org');
});
test('a KAM: the investor half answers their own book only (the half\'s scope is theirs)', async () => {
  const r = rig({ inv: { ok: true, value: { book: 'own-book', hits: [INV(3)], more: 0, farmId: null } } });
  const res = await find(r, 'kam');
  assert.equal(res.value.investorBook, 'own-book');
  assert.equal(r.asked.leads.length, 0);
});
test('the business owner: a lead half the seat cannot read is skipped, the investors still answer', async () => {
  const r = rig({ lead: { ok: false, kind: 'refused', reasonCode: 'capability-missing' } });
  const res = await find(r, 'bu');
  assert.equal(res.ok, true);
  assert.deepEqual(res.value.hits.map((h) => h.kind), ['investor']);
  assert.equal(res.value.book, null);
});
test('a term too short for both halves is term-too-short; for one half only, the other answers', async () => {
  let r = rig({ lead: { ok: false, kind: 'refused', reasonCode: 'term-too-short' }, inv: { ok: false, kind: 'refused', reasonCode: 'term-too-short' } });
  assert.deepEqual(await find(r, 'ops', 'a'), { ok: false, kind: 'refused', reasonCode: 'term-too-short' });
  r = rig({ inv: { ok: false, kind: 'refused', reasonCode: 'term-too-short' } });
  const res = await find(r, 'ops', '123');
  assert.deepEqual(res.value.hits.map((h) => h.kind), ['lead']);
});
test('a half Zoho did not answer fails the whole search — never a partial answer passed off as whole', async () => {
  const r = rig({ inv: { ok: false, kind: 'source-error', errorKind: 'network', retryable: true } });
  assert.deepEqual(await find(r, 'ops'), { ok: false, kind: 'source-error', errorKind: 'network', retryable: true });
});
test('a scope refusal from a half is the answer (scope-drift)', async () => {
  const r = rig({ inv: { ok: false, kind: 'refused', reasonCode: 'scope-drift' } });
  assert.deepEqual(await find(r, 'kam'), { ok: false, kind: 'refused', reasonCode: 'scope-drift' });
});
test('a seat with no search is refused without asking anyone', async () => {
  const r = rig();
  assert.deepEqual(await find(r, 'marketing'), { ok: false, kind: 'refused', reasonCode: 'capability-missing' });
  assert.equal(r.asked.leads.length + r.asked.investors.length, 0);
});
test('at most eight investors show; the rest are counted in "more"', async () => {
  const many = Array.from({ length: 11 }, (_, i) => ({ ...INV(1), id: `${P}7409983${String(i).padStart(2, '0')}` }));
  const r = rig({ inv: { ok: true, value: { book: 'org', hits: many, more: 1 } } });
  const res = await find(r, 'fin');
  assert.equal(res.value.hits.length, 8);
  assert.equal(res.value.more, 4);
});
