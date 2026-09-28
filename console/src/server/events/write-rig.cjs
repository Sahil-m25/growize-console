/* Rig for the event writes and the sheet loader: one fetch that answers COQL by query and writes by
 * method + path from recorded responses (src/lib/zoho/__fixtures__/events). No request reaches Zoho. */
'use strict';
const { recorded, P, NOW } = require('../cases/fixture-rig.cjs');

const toResponse = (r) => new Response(r.status === 204 ? null : JSON.stringify(r.body), { status: r.status, headers: r.headers || {} });
const immediateGate = () => ({ async acquire() { return { waitedMs: 0, release() {} }; }, async run(_c, t) { return t(); }, snapshot() { return {}; } });
const fx = (name) => recorded('events', name);

/** route({method, path, query, body}) → fixture name | response object */
async function makeWriteRig(load, route, access = {}) {
  const { createMemorySink, createOpsLog } = load('lib/zoho/log.js');
  const { createZohoClient, userCredential } = load('lib/zoho/client.js');
  const { createPlaneCLog, createPlaneCMemorySink } = load('server/identity/plane-c.js');
  const { createInvestorEvents } = load('server/data/events.js');
  const sink = createMemorySink();
  const log = createOpsLog(sink);
  const events = createInvestorEvents({ log, planeC: createPlaneCLog(createPlaneCMemorySink()), clock: () => NOW });
  const calls = [];
  const crm = createZohoClient({ recordIdPrefix: P, gate: immediateGate(), log, maxAttempts: 1, clock: () => NOW,
    fetch: async (url, init) => {
      const u = new URL(url);
      const path = u.pathname.replace(/^\/crm\/v\d+/, '');
      const body = init.body ? JSON.parse(init.body) : null;
      const call = { method: init.method, path, query: body && body.select_query, body, headers: init.headers };
      calls.push(call);
      const r = route(call);
      return toResponse(typeof r === 'string' ? fx(r) : r);
    } });
  const cred = async (id) => userCredential({ access_token: `synthetic-${id}`, api_domain: 'https://www.zohoapis.in', expires_in: 3_600 },
    { recordIdPrefix: P, gate: immediateGate(), log: createOpsLog(createMemorySink()), clock: () => NOW,
      fetch: async () => toResponse({ status: 200, body: { users: [{ id, status: 'active' }] } }) });
  const authority = { async recheck(c) { return { userId: c.userId, mayEdit: true, mayLoad: true, eligibleStaffIds: null, unassignedQueueUserId: null, ...access }; } };
  return { crm, events, sink, calls, cred, authority, recordIdPrefix: P, clock: () => NOW };
}

module.exports = { makeWriteRig, P, NOW };
