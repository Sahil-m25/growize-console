/* M12-S09-T01 — a record's emails, read through Zoho CRM's Emails API on the viewer's own token.
 *
 * Run from console/: node --test src/server/emails/emails.test.cjs
 * Replays recorded Zoho responses (__fixtures__/emails). No request reaches Zoho.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { before, test } = require('node:test');

const consoleRoot = path.resolve(__dirname, '..', '..', '..');
const srcRoot = path.join(consoleRoot, 'src');
const fx = path.join(srcRoot, 'lib', 'zoho', '__fixtures__', 'emails');
const ts = require(path.join(consoleRoot, 'node_modules', 'typescript'));
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zoho-emails-'));
process.on('exit', () => fs.rmSync(outDir, { recursive: true, force: true }));
const config = ts.readConfigFile(path.join(consoleRoot, 'tsconfig.json'), ts.sys.readFile);
const project = ts.parseJsonConfigFileContent(config.config, ts.sys, consoleRoot);
const options = { ...project.options, incremental: false, tsBuildInfoFile: undefined, plugins: undefined,
  module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10, noEmit: false, noEmitOnError: true, outDir, rootDir: srcRoot };
const program = ts.createProgram([path.join(srcRoot, 'server/emails/record-emails.ts')], options);
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
const { createRecordEmails } = load('server/emails/record-emails.js');

const P = '9007199254';
const HARSHA = `${P}740993002`, ROHIT = `${P}740995001`, OTHER_IR = `${P}740995002`, IMRAN = `${P}740994001`, SAHIL = `${P}740993900`;
const ALLOT = `${P}740999401`, JOSEPH = `${P}740997209`, KIRAN = `${P}740997320`, LEAD_R = `${P}740996421`, LEAD_O = `${P}740996499`;
const MSG1 = 'c6085fae06cbd7b75001fe70000000000000000000000000000000000001';
const NOW = Date.parse('2026-09-28T06:00:00Z');

const recorded = (name) => JSON.parse(fs.readFileSync(path.join(fx, `${name}.response.json`), 'utf8'));
const EMPTY = { status: 204, headers: {}, body: null };
const toResponse = (r) => new Response(r.status === 204 ? null : JSON.stringify(r.body), { status: r.status, headers: r.headers || {} });
const immediateGate = () => ({ async acquire() { return { waitedMs: 0, release() {} }; }, async run(_c, t) { return t(); }, snapshot() { return {}; } });
const creds = new Map();
before(async () => {
  for (const id of [HARSHA, ROHIT, OTHER_IR, IMRAN, SAHIL]) creds.set(id, await userCredential({ access_token: `synthetic-${id}`, api_domain: 'https://www.zohoapis.in', expires_in: 3_600 },
    { recordIdPrefix: P, gate: immediateGate(), log: createOpsLog(createMemorySink()), clock: () => NOW,
      fetch: async () => toResponse({ status: 200, body: { users: [{ id, status: 'active' }] } }) }));
});

/* Zoho's own filter, replayed: an IR's one-Contact read returns the Contact only when Originating_IR is that IR. */
const ORIGIN = { [JOSEPH]: OTHER_IR, [KIRAN]: ROHIT };
const CONTACT = { [JOSEPH]: 'coql.contact-joseph', [KIRAN]: 'coql.contact-kiran' };
function route(c, over = {}) {
  if (c.q) {
    if (/from LLP_UnitAllocation_Module/.test(c.q)) return c.q.includes(ALLOT) ? recorded('coql.allotment-kiran') : EMPTY;
    if (/from Contacts/.test(c.q)) {
      const id = (c.q.match(/id = '(\d+)'/) || [])[1];
      const ir = (c.q.match(/Originating_IR = '(\d+)'/) || [])[1];
      if (!CONTACT[id] || (ir && ORIGIN[id] !== ir)) return EMPTY;
      return recorded(CONTACT[id]);
    }
    throw new Error('unrouted ' + c.q);
  }
  if (/\/Emails\/[^/?]+/.test(c.url)) return over.open || recorded('open.contact');
  if (/\/Emails/.test(c.url)) return over.list || recorded('list.contact');
  if (c.url.includes(`/Leads/${LEAD_R}?`)) return recorded('lead.rohit');
  if (c.url.includes(`/Leads/${LEAD_O}?`)) return recorded('lead.other');
  throw new Error('unrouted ' + c.url);
}
function rig(over = {}) {
  const calls = [];
  const sink = createMemorySink();
  const log = createOpsLog(sink);
  const planeC = createPlaneCMemorySink();
  const events = createInvestorEvents({ log, planeC: createPlaneCLog(planeC), clock: () => NOW });
  const crm = createZohoClient({ recordIdPrefix: P, gate: immediateGate(), log, maxAttempts: 1, clock: () => NOW,
    fetch: async (url, init) => {
      const c = { method: init.method, url: decodeURIComponent(String(url)), q: typeof init.body === 'string' ? JSON.parse(init.body).select_query : null, headers: init.headers };
      calls.push(c);
      return toResponse(route(c, over));
    } });
  return { calls, sink, planeC, emails: createRecordEmails({ crm, events, log, clock: () => NOW }) };
}
const emailCalls = (r) => r.calls.filter((c) => /\/Emails/.test(c.url));
const everything = (r) => JSON.stringify(r.sink.records()) + JSON.stringify(r.planeC.events());

test('AC1: Finance opens an investor — the emails are listed from Zoho\'s Emails API on Harsha\'s own token', async () => {
  const r = rig();
  const res = await r.emails.list(creds.get(HARSHA), 'fin', 'investor', JOSEPH);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.value.emails.length, 2, 'a malformed row is dropped');
  const [a, b] = res.value.emails;
  assert.equal(a.subject, 'Your FEMA declaration');
  assert.equal(a.from.email, 'harsha@example.invalid');
  assert.equal(a.sent, true); assert.equal(b.sent, false);
  assert.equal(a.content, undefined, 'the list carries no body');
  const e = emailCalls(r);
  assert.equal(e.length, 1);
  assert.match(e[0].url, new RegExp(`/crm/v8/Contacts/${JOSEPH}/Emails$`));
  assert.ok(r.calls.every((c) => c.headers.Authorization === `Zoho-oauthtoken synthetic-${HARSHA}`));
});

test('AC4: opening an email returns its body to the caller only — never a subject, address or body in any log', async () => {
  const r = rig();
  const res = await r.emails.open(creds.get(HARSHA), 'fin', 'investor', JOSEPH, MSG1, HARSHA);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.match(res.value.content, /SECRET-BODY-MARKER/);
  assert.equal(res.value.attachments[0].size, 53422);
  assert.match(emailCalls(r)[0].url, new RegExp(`/Contacts/${JOSEPH}/Emails/${MSG1}\\?user_id=${HARSHA}$`));
  const logged = everything(r);
  for (const secret of ['SECRET-BODY-MARKER', 'FEMA declaration', 'example.invalid', 'Joseph']) assert.ok(!logged.includes(secret), secret);
  assert.ok(logged.includes(JOSEPH), 'Plane B has the record id');
});

test('AC4: nothing is cached — each open and each list asks Zoho again', async () => {
  const r = rig();
  await r.emails.list(creds.get(HARSHA), 'fin', 'investor', JOSEPH);
  await r.emails.list(creds.get(HARSHA), 'fin', 'investor', JOSEPH);
  await r.emails.open(creds.get(HARSHA), 'fin', 'investor', JOSEPH, MSG1);
  await r.emails.open(creds.get(HARSHA), 'fin', 'investor', JOSEPH, MSG1);
  assert.equal(emailCalls(r).length, 4);
});

test('AC2/AC3: a record Zoho will not open for this person shows an in-page refusal, never an empty list', async () => {
  const r = rig({ list: recorded('forbidden'), open: recorded('forbidden') });
  const l = await r.emails.list(creds.get(HARSHA), 'fin', 'investor', JOSEPH);
  assert.equal(l.ok, false); assert.equal(l.kind, 'refused'); assert.equal(l.reason, 'not-visible');
  assert.match(l.message, /cannot open this record/);
  const o = await r.emails.open(creds.get(HARSHA), 'fin', 'investor', JOSEPH, MSG1);
  assert.equal(o.reason, 'not-visible');
  const empty = rig({ list: EMPTY });
  const e = await empty.emails.list(creds.get(HARSHA), 'fin', 'investor', JOSEPH);
  assert.deepEqual(e.value.emails, [], 'what Zoho hides from this profile is not shown');
});

test('AC5 (D69): an IR sees their own lead\'s emails, never another IR\'s lead, never an investor unless from their own lead', async () => {
  const r = rig();
  const own = await r.emails.list(creds.get(ROHIT), 'ir', 'lead', LEAD_R);
  assert.equal(own.ok, true);
  const other = await r.emails.list(creds.get(ROHIT), 'ir', 'lead', LEAD_O);
  assert.equal(other.reason, 'not-in-book');
  const joseph = await r.emails.list(creds.get(ROHIT), 'ir', 'investor', JOSEPH);
  assert.equal(joseph.ok, false, 'Joseph came from another IR\'s lead');
  const kiran = await r.emails.list(creds.get(ROHIT), 'ir', 'investor', KIRAN);
  assert.equal(kiran.ok, true, 'Kiran came from Rohit\'s own lead');
  const e = emailCalls(r).map((c) => c.url);
  assert.equal(e.length, 2);
  assert.ok(!e.some((u) => u.includes(LEAD_O) || u.includes(JOSEPH)), 'no Emails call for a refused record');
});

test('an allotment\'s emails are admitted through its investor; Investors-side seats have no lead emails; KAM own book only', async () => {
  const r = rig();
  assert.equal((await r.emails.list(creds.get(HARSHA), 'fin', 'allotment', ALLOT)).ok, true);
  assert.match(emailCalls(r)[0].url, new RegExp(`/LLP_UnitAllocation_Module/${ALLOT}/Emails$`));
  assert.equal((await r.emails.list(creds.get(ROHIT), 'ir', 'allotment', ALLOT)).ok, true, 'Kiran\'s allotment, from Rohit\'s lead');
  assert.equal((await r.emails.list(creds.get(HARSHA), 'fin', 'lead', LEAD_R)).reason, 'seat-denied');
  assert.equal((await r.emails.list(creds.get(IMRAN), 'kam', 'investor', JOSEPH)).ok, false, 'not in Imran\'s book');
  assert.equal((await r.emails.list(creds.get(SAHIL), 'ops', 'lead', LEAD_O)).ok, true, 'DI reads every lead');
});

test('bad input is refused before Zoho is asked', async () => {
  const r = rig();
  assert.equal((await r.emails.list(creds.get(HARSHA), 'fin', 'deal', JOSEPH)).reason, 'invalid-request');
  assert.equal((await r.emails.list(creds.get(HARSHA), 'fin', 'investor', '12')).reason, 'invalid-request');
  assert.equal((await r.emails.open(creds.get(HARSHA), 'fin', 'investor', JOSEPH, '../x')).reason, 'invalid-request');
  assert.equal((await r.emails.list(creds.get(HARSHA), 'fin', 'investor', JOSEPH, 'bad index!')).reason, 'invalid-request');
  assert.equal(r.calls.length, 0);
});
