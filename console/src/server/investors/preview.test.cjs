/* M10-S22-T02 (the app preview's data) and M10-S23-T02 (the test sign-in link).
 * Run from console/: node --test src/server/investors/preview.test.cjs
 * Replays recorded Zoho responses (__fixtures__/investors, __fixtures__/preview, __fixtures__/data). No request reaches Zoho. */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { before, test } = require('node:test');

const consoleRoot = path.resolve(__dirname, '..', '..', '..');
const srcRoot = path.join(consoleRoot, 'src');
const fx = path.join(srcRoot, 'lib', 'zoho', '__fixtures__');
const ts = require(path.join(consoleRoot, 'node_modules', 'typescript'));
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoho-preview-'));
process.on('exit', () => fs.rmSync(outDir, { recursive: true, force: true }));
const config = ts.readConfigFile(path.join(consoleRoot, 'tsconfig.json'), ts.sys.readFile);
const project = ts.parseJsonConfigFileContent(config.config, ts.sys, consoleRoot);
const options = { ...project.options, incremental: false, tsBuildInfoFile: undefined, plugins: undefined,
  module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10, noEmit: false, noEmitOnError: true, outDir, rootDir: srcRoot };
const program = ts.createProgram(['server/investors/preview.ts', 'server/investors/test-link.ts'].map((f) => path.join(srcRoot, f)), options);
const diagnostics = [...ts.getPreEmitDiagnostics(program), ...program.emit().diagnostics];
if (diagnostics.length) {
  console.error(ts.formatDiagnostics(diagnostics, { getCanonicalFileName: (f) => f, getCurrentDirectory: () => consoleRoot, getNewLine: () => '\n' }));
  process.exit(1);
}
const Module = require('node:module');
process.env.NODE_PATH = path.join(consoleRoot, 'node_modules');
Module._initPaths();
const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  return resolveFilename.call(this, request.startsWith('@/') ? path.join(outDir, request.slice(2)) : request, ...rest);
};
const load = (f) => require(path.join(outDir, f));
const { createMemorySink, createOpsLog } = load('lib/zoho/log.js');
const { createZohoClient, userCredential } = load('lib/zoho/client.js');
const { createPlaneCLog, createPlaneCMemorySink } = load('server/identity/plane-c.js');
const { createInvestorEvents } = load('server/data/events.js');
const { createAppPreviewReader, PREVIEW_LABEL, PAYOUT_AMOUNT_FIELDS } = load('server/investors/preview.js');
const { createTestLinks, createTestLinkRegister, testLinkState, TEST_LINK_MINUTES, isSuperUserSeat } = load('server/investors/test-link.js');

const P = '9007199254';
const HARSHA = `${P}740993002`, ROHIT = `${P}740995001`, OTHER_IR = `${P}740995002`, IMRAN = `${P}740994001`, SAHIL = `${P}740990001`;
const PRAKASH = `${P}740997301`, KIRAN = `${P}740997320`, RADHIKA = `${P}740994101`;
const NOW = Date.parse('2026-09-28T06:00:00Z');

const recorded = (dir, name) => JSON.parse(fs.readFileSync(path.join(fx, dir, `${name}.response.json`), 'utf8'));
const toResponse = (r) => new Response(r.status === 204 ? null : JSON.stringify(r.body), { status: r.status, headers: r.headers || {} });
const immediateGate = () => ({ async acquire() { return { waitedMs: 0, release() {} }; }, async run(_c, t) { return t(); }, snapshot() { return {}; } });
const creds = new Map();
before(async () => {
  for (const id of [HARSHA, ROHIT, OTHER_IR, IMRAN, SAHIL]) creds.set(id, await userCredential({ access_token: `synthetic-${id}`, api_domain: 'https://www.zohoapis.in', expires_in: 3_600 },
    { recordIdPrefix: P, gate: immediateGate(), log: createOpsLog(createMemorySink()), clock: () => NOW,
      fetch: async () => toResponse({ status: 200, body: { users: [{ id, status: 'active' }] } }) }));
});

const CONTACT = { [PRAKASH]: 'record.contact-prakash', [KIRAN]: 'record.contact-kiran', [RADHIKA]: 'record.contact-radhika' };
function route(url, q, payouts) {
  const u = String(url);
  if (!q) {
    const att = u.match(/\/(Contacts|LLP_UnitAllocation_Module|LLP_Creation_Module)\/(\d+)\/Attachments/);
    if (att) return recorded('investors', att[1] === 'Contacts' ? 'record.attachments-contact' : att[1] === 'LLP_Creation_Module' ? 'record.attachments-llp' : 'record.attachments-allotment');
    const one = u.match(/\/Contacts\/(\d+)(\?|$)/);
    if (one) return CONTACT[one[1]] ? recorded('investors', CONTACT[one[1]]) : recorded('data', 'coql.none');
    throw new Error('unrouted GET ' + u);
  }
  if (/from Investor_Payouts/.test(q)) return payouts ? recorded('preview', payouts) : q.includes(`${P}740998301`) ? recorded('preview', 'coql.payouts-prakash')
    : q.includes(`${P}740996101`) ? recorded('preview', 'coql.payouts-radhika') : recorded('data', 'coql.none');
  if (/from Leads/.test(q)) return recorded('investors', 'coql.said-yes-leads');
  if (/from Contacts/.test(q)) return /Originating_IR = /.test(q) ? recorded('investors', 'coql.said-yes-own-lead') : recorded('investors', 'coql.said-yes-contacts');
  if (/from LLP_UnitAllocation_Module/.test(q)) {
    if (q.includes(PRAKASH)) return recorded('investors', 'record.allotments-prakash');
    if (q.includes(RADHIKA)) return recorded('investors', 'record.allotments-radhika');
    return recorded('data', 'coql.none');
  }
  if (/from Receipts/.test(q)) return q.includes(`${P}740998301`) ? recorded('investors', 'record.receipts-prakash') : recorded('data', 'coql.none');
  if (/from LLP_Creation_Module/.test(q)) return recorded('investors', 'coql.finance-llps');
  throw new Error('unrouted query: ' + q);
}

function rig(payouts) {
  const calls = [];
  const sink = createMemorySink();
  const log = createOpsLog(sink);
  const planeCSink = createPlaneCMemorySink();
  const events = createInvestorEvents({ log, planeC: createPlaneCLog(planeCSink), clock: () => NOW });
  const crm = createZohoClient({ recordIdPrefix: P, gate: immediateGate(), log, maxAttempts: 1, clock: () => NOW,
    fetch: async (url, init) => { const q = init && init.body ? JSON.parse(init.body).select_query : null; calls.push(q || `GET ${String(url)}`); return toResponse(route(url, q, payouts)); } });
  return { crm, events, log, sink, planeCSink, calls, preview: createAppPreviewReader({ crm, events, log, clock: () => NOW }) };
}

/* ---------------- M10-S22-T02 ---------------- */

test('M10-S22: Finance previews Prakash — his name, units, project, stage timeline, payouts with amounts, documents; labelled, read-only', async () => {
  const r = rig();
  const res = await r.preview.read(creds.get(HARSHA), 'head', PRAKASH);
  assert.equal(res.ok, true, JSON.stringify(res));
  const p = res.preview;
  assert.deepEqual([p.label, p.readOnly, p.amounts], [PREVIEW_LABEL, true, true]);
  assert.equal(p.label, 'Preview — mock-up, not the live app');
  assert.deepEqual([...p.tabs], ['Home', 'Projects', 'Project', 'Financials', 'Documents', 'Activity', 'Profile']);
  assert.deepEqual([p.home.name, p.home.firstName, p.home.units, p.home.invested, p.home.paidOut], ['Prakash Bhat', 'Prakash', 1, 250000, 0]);
  assert.deepEqual(p.home.nextPayout, { dueOn: '2026-11-05', net: 15000 });
  assert.deepEqual(p.home.stages.map((s) => [s.t, s.done]), [['Reserved', true], ['Paid in full', false], ['Allotted', false], ['Monthly payouts', false]]);
  assert.deepEqual(p.projects.map((x) => [x.name, x.units, x.status, x.paymentStatus]), [['EKA LLP', 1, 'Reserved', 'Partial']]);
  assert.deepEqual(p.financials.payouts.map((x) => [x.id, x.state, x.net, x.tds]), [[`${P}741000101`, 'Scheduled', 15000, 1667]], "another allotment's payout is dropped");
  assert.equal(p.financials.due, 2250000);
  assert.ok(p.documents.length >= 1 && p.documents.some((d) => d.name === 'Signed NDA.pdf' && d.scope === 'personal'));
  assert.ok(p.activity.some((a) => a.t === 'Joined Growize' && a.at === '2026-08-20T11:00'));
  assert.ok(p.activity.every((a, i) => i === 0 || p.activity[i - 1].at >= a.at), 'newest first');
  assert.deepEqual([p.profile.pan, p.profile.bank, p.profile.city], ['Finance only', 'Finance only', 'Mysuru']);
  const q = r.calls.find((c) => /from Investor_Payouts/.test(c));
  assert.match(q, /where Allotment in \('9007199254740998301'\)/);
  assert.ok(!/UTR|Note/.test(q), 'no UTR, no note is read');
  assert.ok(!JSON.stringify(p).includes('FXPAN'), 'no identity value');
  const ev = r.sink.records().filter((x) => x.kind === 'event');
  assert.deepEqual(ev.map((x) => [x.action, x.actor.userId, x.recordIds]), [['app-preview', HARSHA, [PRAKASH]]]);
});

test('M10-S22: a KAM previews Radhika — dates and states of payouts, no amounts read at all; no documents', async () => {
  const r = rig();
  const res = await r.preview.read(creds.get(IMRAN), 'kam', RADHIKA);
  assert.equal(res.ok, true, JSON.stringify(res));
  const p = res.preview;
  assert.deepEqual([p.amounts, p.home.invested, p.home.paidOut, p.financials.due, p.documents], [false, null, null, null, null]);
  assert.deepEqual(p.financials.payouts.map((x) => [x.state, x.dueOn, x.net]), [['Paid', '2026-09-05', null], ['Scheduled', '2026-10-05', null]]);
  assert.deepEqual(p.home.nextPayout, { dueOn: '2026-10-05', net: null });
  assert.deepEqual(p.home.stages.map((s) => s.done), [true, true, true, true]);
  const q = r.calls.find((c) => /from Investor_Payouts/.test(c));
  for (const f of PAYOUT_AMOUNT_FIELDS) assert.ok(!q.includes(f), `${f} not selected for a KAM`);
  assert.equal(r.calls.some((c) => /from Receipts|Attachments/.test(c)), false);
});

test('M10-S22: an IR who did not own the lead is refused (no button, nothing read beyond the Contact); the owner IR may preview', async () => {
  const r = rig();
  const no = await r.preview.read(creds.get(OTHER_IR), 'ir', KIRAN);
  assert.deepEqual([no.ok, no.kind, no.reason], [false, 'refused', 'not-own-lead']);
  assert.equal(r.calls.some((c) => /Investor_Payouts/.test(c)), false);
  const yes = await rig().preview.read(creds.get(ROHIT), 'ir', KIRAN);
  assert.equal(yes.ok, true, JSON.stringify(yes));
  assert.equal(yes.preview.amounts, false);
});

test('M10-S22: Investor_Payouts not visible to the viewer (403) shows no payouts rather than failing; a seat with no record is refused', async () => {
  const res = await rig('coql.payouts-forbidden').preview.read(creds.get(HARSHA), 'head', PRAKASH);
  assert.equal(res.ok, true);
  assert.deepEqual([res.preview.financials.payouts.length, res.preview.home.nextPayout], [0, null]);
  const conv = await rig().preview.read(creds.get(ROHIT), 'conv', PRAKASH);
  assert.deepEqual([conv.ok, conv.reason], [false, 'seat-denied']);
});

/* ---------------- M10-S23-T02 ---------------- */

function links(opts = {}) {
  const r = rig();
  const minted = [];
  const issuer = opts.issuer === null ? null : opts.issuer ?? { async mint(req) { minted.push(req); return { ok: true, url: `https://app.example/test-sign-in/${req.linkId}` }; } };
  let n = 0;
  const register = createTestLinkRegister();
  const t = createTestLinks({ crm: r.crm, events: r.events, log: r.log, issuer, testAccounts: new Set(opts.tests ?? []), clock: () => NOW,
    newId: () => `00000000-0000-4000-8000-00000000000${++n}` }, register);
  return { ...r, t, minted };
}
const WHY = 'Investor says payouts tab is blank';

test('M10-S23: only the super user; a reason is required; refusals are Plane B lines by id', async () => {
  assert.deepEqual(['di', 'ops', 'head', 'root', 'kam'].map(isSuperUserSeat), [true, true, false, false, false]);
  const x = links();
  const a = await x.t.create(creds.get(HARSHA), 'head', PRAKASH, { why: WHY, confirm: true });
  assert.deepEqual([a.ok, a.reason], [false, 'seat-denied']);
  const b = await x.t.create(creds.get(SAHIL), 'di', PRAKASH, { why: '  ', confirm: true });
  assert.deepEqual([b.ok, b.reason], [false, 'why-missing']);
  assert.deepEqual(x.sink.records().filter((r) => r.kind === 'refusal').map((r) => [r.action, r.reason, r.recordIds]),
    [['test-link', 'seat-denied', [PRAKASH]], ['test-link', 'why-missing', [PRAKASH]]]);
  assert.equal(x.minted.length, 0);
  assert.equal(x.t.list('head'), null, 'no audit list for another seat');
});

test('M10-S23: a real investor needs the warning confirmed; then one link, 10 minutes, audit row with who, whom, when, why', async () => {
  const x = links();
  const ask = await x.t.create(creds.get(SAHIL), 'di', PRAKASH, { why: WHY });
  assert.deepEqual([ask.ok, ask.reason], [false, 'confirm-needed']);
  assert.match(ask.ask, /^Prakash Bhat is a real investor, not a test account\./);
  assert.match(ask.ask, /nothing is emailed to them/);
  assert.equal(x.minted.length, 0);
  const ok = await x.t.create(creds.get(SAHIL), 'di', PRAKASH, { why: WHY, confirm: true });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.deepEqual([ok.link.url.startsWith('https://'), ok.link.expiresAt - NOW, ok.link.real, ok.link.state, ok.link.by, ok.link.contactId],
    [true, TEST_LINK_MINUTES * 60_000, true, 'live', SAHIL, PRAKASH]);
  assert.deepEqual(x.minted, [{ linkId: ok.link.id, contactId: PRAKASH, expiresAt: NOW + 600_000 }]);
  const ev = x.sink.records().filter((r) => r.kind === 'event' && r.action === 'test-link-created');
  assert.deepEqual(ev.map((r) => [r.actor.userId, r.reason, r.recordIds]), [[SAHIL, `real.why-given.len-${WHY.length}`, [PRAKASH]]]);
  assert.ok(!JSON.stringify(x.sink.records()).includes('payouts tab'), 'the reason\'s words are never in a log line');
  /* M15-S05-NOTE-1: the Plane C authority line — who, seat, for which Contact, how long it lives; never the URL or the words */
  assert.deepEqual(x.planeCSink.events().map((e) => [e.action, e.outcome, e.who, e.seat, e.recordIds, e.ttlMinutes, e.reason]),
    [['test-link-issued', 'ok', SAHIL, 'di', [PRAKASH], TEST_LINK_MINUTES, 'real-investor']]);
  assert.ok(!JSON.stringify(x.planeCSink.events()).includes('payouts tab') && !JSON.stringify(x.planeCSink.events()).includes('https://'));
  const [row] = x.t.list('di', PRAKASH, NOW);
  assert.deepEqual([row.by, row.contactId, row.why, row.at, row.usedAt, row.state], [SAHIL, PRAKASH, WHY, NOW, null, 'live']);
});

test('M10-S23: first use or ten minutes, whichever is first; a test account needs no confirmation', async () => {
  const x = links({ tests: [PRAKASH] });
  const ok = await x.t.create(creds.get(SAHIL), 'ops', PRAKASH, { why: WHY });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(ok.link.real, false);
  assert.equal(x.t.used(ok.link.id, NOW + 60_000).ok, true);
  assert.deepEqual(x.t.used(ok.link.id, NOW + 120_000), { ok: false, reason: 'used' });
  assert.equal(x.t.list('di', PRAKASH, NOW + 120_000)[0].usedAt, NOW + 60_000);
  const late = await x.t.create(creds.get(SAHIL), 'di', PRAKASH, { why: WHY });
  assert.deepEqual(x.t.used(late.link.id, NOW + 600_000), { ok: false, reason: 'expired' });
  assert.deepEqual(x.t.used('not-a-link'), { ok: false, reason: 'unknown' });
  assert.equal(testLinkState({ usedAt: null, expiresAt: NOW + 1 }, NOW), 'live');
  assert.ok(x.sink.records().some((r) => r.kind === 'event' && r.action === 'test-link-used' && r.actor.job === 'investor-app'));
});

test('M10-S23: no app link service (MA1) → not-configured; an investor outside scope is refused before anything is minted', async () => {
  const x = links({ issuer: null });
  const r = await x.t.create(creds.get(SAHIL), 'di', PRAKASH, { why: WHY, confirm: true });
  assert.deepEqual([r.ok, r.reason], [false, 'not-configured']);
  const bad = links({ issuer: { async mint() { return { ok: true, url: 'javascript:alert(1)' }; } } });
  const b = await bad.t.create(creds.get(SAHIL), 'di', PRAKASH, { why: WHY, confirm: true });
  assert.deepEqual([b.ok, b.reason], [false, 'issuer-failed']);
  assert.equal(bad.t.list('di').length, 0);
  const y = links();
  const n = await y.t.create(creds.get(SAHIL), 'di', `${P}740997399`, { why: WHY, confirm: true });
  assert.deepEqual([n.ok, n.reason], [false, 'not-visible']);
  assert.equal(y.minted.length, 0);
});
