/* R6 M19-S12-NOTE-7 — two permission cases that stories name and no test carried, called through the real route handlers
 * (harness.cjs: guard in ENFORCE mode, the real policy and withErrorCapture, Zoho a counting double):
 *   TC-E07-022  a seat that cannot work the lead cannot send   (a direct send request is refused; nothing is sent, no touch is written)
 *   TC-E16-013  an IR cannot write on a manager page           (403, and the refusal is logged)
 * The cases' wording names "emSend" and "the Plan write API" (the prototype's own function and page). The Plan page's writes are
 * console state (a reducer action: src/lib/selectors/manager-page-writes.test.ts), there is no server Plan route, so the writes
 * called here are every write route of a page an IR does not hold (People's POST/DELETE /api/grants among them; the manager and seat routes decide inside on Zoho reads,
 * which is teams-writes.test.cjs and seat-change.test.cjs). "The operational log" is Plane C's refused-action
 * line today (an API refusal at the door is an identity/authority event, authority.ts refusedAction); Plane B holds no line for it.
 * Run from console/: node --test src/server/http/contract/seat-refusal-cases.test.cjs */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./harness.cjs');
const T = require('./contract-table.cjs');
const C = require('./contract-lib.cjs');

const rows = T.table();
const rowOf = (route) => rows.find((r) => r.route === route);
const refused = (route) => H.SEATS.filter((s) => !rowOf(route).seats.includes(s));
const planeC = () => H.load('server/logs/factory.ts').sharedPlaneCSink();
const LEAD = C.ID;

/* every Zoho call the handlers make, by method: a refused write may read (who is asking) but must never write */
const methods = [];
const wrapped = globalThis.fetch;
globalThis.fetch = async (url, init) => { if (!/^https?:\/\/localhost/.test(String(url && url.url ? url.url : url))) methods.push((init && init.method) || 'GET'); return wrapped(url, init); };
const writesSince = (n) => methods.slice(n).filter((m) => m !== 'GET');

test.before(async () => { await H.installRuntime(); H.setMode('enforce'); });

test('TC-E07-022: every seat that cannot work leads is refused a direct send request; nothing is sent, no touch is written', async () => {
  const mod = require(H.routeFile('/api/leads/[id]/email'));
  const seats = refused('/api/leads/[id]/email');
  assert.ok(seats.length >= 5, `the seats without the Leads page: ${seats}`);
  assert.ok(!seats.includes('ir'), 'the IR works leads and is not in this set');
  const before = planeC().events().length;
  for (const seat of seats) {
    const res = await H.call(mod, 'POST', `/api/leads/${LEAD}/email`, { seat, params: { id: LEAD }, contentType: 'application/json',
      body: { expectedModifiedTime: '2026-09-28T09:00:00+05:30', template: 'intro', subject: 'Hello', message: 'Dear Meera' } });
    assert.equal(res.status, 403, `${seat}: ${res.status} ${res.text.slice(0, 120)}`);
    assert.equal(res.zohoCalls, 0, `${seat}: no Zoho call, so no send_mail and no Touches write`);
    assert.equal(res.json.sent, undefined, `${seat}: the answer does not say sent`);
    assert.deepEqual(C.refusalNamesNothing(res.json), [], seat);
  }
  const lines = planeC().events().slice(before);
  assert.equal(lines.length, seats.length, 'one refusal line each');
  assert.ok(lines.every((e) => e.outcome === 'refused' && ['refused-action', 'sign-in-refused'].includes(e.action)), 'each is a refusal line (a seat with no page at all is refused at admission)');
  assert.ok(lines.filter((e) => e.action === 'refused-action').every((e) => e.reason === 'api-leads'));
  /* no session at all is not a way round it */
  const anon = await H.call(mod, 'POST', `/api/leads/${LEAD}/email`, { params: { id: LEAD }, contentType: 'application/json', body: {} });
  assert.equal(anon.status, 401); assert.equal(anon.zohoCalls, 0);
});

test('TC-E16-013: an IR calling the write API of any page they do not hold gets a 403, nothing is written to Zoho, and the refusal is logged', async () => {
  /* every page-gated route the IR's seat does not reach, each of its write methods (People: grants; Events; Farms; Payments …) */
  const targets = rows.filter((r) => !r.excluded && r.rule && r.rule.kind === 'page' && !r.seats.includes('ir'));
  const calls = targets.flatMap((r) => r.methods.filter((m) => m !== 'GET').map((m) => [r, m]));
  assert.ok(calls.some(([r]) => r.route === '/api/grants'), 'the People page write is among them (the manager page this case is about)');
  assert.ok(calls.length >= 8, `${calls.length} write calls`);
  for (const [r, method] of calls) {
    const mod = require(H.routeFile(r.route));
    const url = r.route.replace(/\[[^\]]+\]/g, LEAD);
    const before = planeC().events().length, mark = methods.length;
    const res = await H.call(mod, method, url, { seat: 'ir', params: Object.fromEntries(r.params.map((p) => [p, LEAD])), contentType: 'application/json', body: {} });
    assert.equal(res.status, 403, `${method} ${r.route} as ir: ${res.status} ${res.text.slice(0, 120)}`);
    assert.deepEqual(writesSince(mark), [], `${method} ${r.route}: nothing was written to Zoho`);
    assert.deepEqual(C.refusalNamesNothing(res.json), [], `${method} ${r.route}`);
    const lines = planeC().events().slice(before);
    assert.ok(lines.some((e) => e.action === 'refused-action' && e.outcome === 'refused' && e.who === H.WHO.ir && e.seat === 'ir'),
      `${method} ${r.route}: the refusal is logged under the IR's id: ${JSON.stringify(lines)}`);
  }
});
