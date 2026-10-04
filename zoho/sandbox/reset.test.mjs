// TC-E16-005 / TC-E16-006 + seed resolution. Run: node --test zoho/sandbox/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { reset, shiftStamp, dependencyOrder, distribution, resolveUsers, sessionApi, LIVE_ORG_ID } from "./reset.mjs";

const manifest = JSON.parse(readFileSync(new URL("./manifest.json", import.meta.url), "utf8"));
const USERS = { ir_a: "u-ira", ir_b: "u-irb", kam: "u-kam", finance_ops: "u-fin", compliance: "u-cmp", admin: "u-adm" };
let seq = 0;
const fakeApi = (org, leftovers = 3) => {
  const store = {}, log = [];
  for (const m of Object.keys(manifest.records)) store[m] = Array.from({ length: leftovers }, (_, i) => ({ id: `old${i}` }));
  return {
    store, log,
    org: async () => org,
    listTagged: async (m) => store[m].map((r) => r.id),
    remove: async (m, ids) => { log.push(["remove", m]); store[m] = store[m].filter((r) => !ids.includes(r.id)); },
    upsert: async (m, rows) => { log.push(["upsert", m]); const ids = rows.map(() => `id${++seq}`); store[m].push(...rows.map((r, i) => ({ ...r, id: ids[i] }))); return ids; },
    listUsers: async () => Object.entries(USERS).map(([p, id]) => ({ id, email: `${p}@x.test` })),
  };
};
const SANDBOX = { id: "111", apiDomain: "https://crmsandbox.zoho.in" };
const emails = Object.fromEntries(Object.keys(USERS).map((p) => [p, `${p}@x.test`]));

test("TC-E16-005 reset leaves exactly the manifest, nothing from the last run", async () => {
  const api = fakeApi(SANDBOX);
  const out = await reset({ api, manifest, sandboxOrgId: "111", runDay: new Date("2026-10-01T00:00:00Z"), users: USERS });
  for (const [m, rows] of Object.entries(manifest.records)) {
    assert.deepEqual(api.store[m].map((r) => r.Seed_Key), rows.map((r) => r.Seed_Key), m);
    assert.ok(api.store[m].every((r) => r.Test_Seed === true));
    assert.equal(out.counts[m], rows.length);
    assert.equal(out.deleted[m], 3);
  }
  assert.deepEqual(Object.keys(manifest.records), ["LLP_Creation_Module", "Leads", "Contacts", "Touches", "LLP_UnitAllocation_Module", "Receipts", "Cases"]);
});

test("TC-E16-006 reset refuses production and changes nothing", async () => {
  for (const org of [{ id: "999", apiDomain: "https://www.zohoapis.in" }, { id: "111", apiDomain: "https://www.zohoapis.in" }]) {
    const api = fakeApi(org);
    await assert.rejects(reset({ api, manifest, sandboxOrgId: "111", users: USERS }), /not a sandbox org/);
    assert.deepEqual(api.log, []);
  }
  await assert.rejects(reset({ api: fakeApi(SANDBOX), manifest, sandboxOrgId: undefined, users: USERS }), /not a sandbox org/);
});

test("refuses the live org id even when the sandbox id was misconfigured to it, and even on a sandbox-looking domain", async () => {
  const api = fakeApi({ id: LIVE_ORG_ID, apiDomain: "https://crmsandbox.zoho.in" });
  await assert.rejects(reset({ api, manifest, sandboxOrgId: LIVE_ORG_ID, users: USERS }), /not a sandbox org/);
  assert.deepEqual(api.log, []);
  assert.equal(LIVE_ORG_ID, "60061770791");
});

test("dependency order: parents before children, deletes run the other way", async () => {
  const order = dependencyOrder(manifest), at = (m) => order.indexOf(m);
  assert.ok(at("LLP_Creation_Module") < at("LLP_UnitAllocation_Module") && at("Contacts") < at("LLP_UnitAllocation_Module"));
  assert.ok(at("LLP_UnitAllocation_Module") < at("Receipts") && at("Leads") < at("Touches") && at("Contacts") < at("Cases"));
  const api = fakeApi(SANDBOX);
  await reset({ api, manifest, sandboxOrgId: "111", users: USERS });
  const mods = (k) => api.log.filter(([a]) => a === k).map(([, m]) => m);
  assert.deepEqual(mods("upsert"), order);
  assert.deepEqual(mods("remove"), [...order].reverse());
  assert.throws(() => dependencyOrder({ records: { A: [{ $refs: { x: ["B", "1"] } }], B: [{ $refs: { y: ["A", "1"] } }] } }), /cycle/);
  assert.throws(() => dependencyOrder({ records: { A: [{ $refs: { x: ["Nope", "1"] } }] } }), /not in the manifest/);
});

test("seed keys become ids: every lookup holds the parent's id, no key leaks into a field", async () => {
  const api = fakeApi(SANDBOX);
  await reset({ api, manifest, sandboxOrgId: "111", users: USERS });
  const idOf = (m, k) => api.store[m].find((r) => r.Seed_Key === k).id;
  const alloc = api.store.LLP_UnitAllocation_Module.find((r) => r.Seed_Key === "ARL-INV-0205/A");
  assert.deepEqual(alloc.Customer, { id: idOf("Contacts", "ARL-INV-0205") });
  assert.deepEqual(alloc.LLP, { id: idOf("LLP_Creation_Module", "A") });
  assert.deepEqual(api.store.Receipts.find((r) => r.Seed_Key === "T-0041").Allotment, { id: idOf("LLP_UnitAllocation_Module", "ARL-INV-0212/A") });
  assert.deepEqual(api.store.Touches.find((r) => r.Seed_Key === "L2/msg/0").Lead, { id: idOf("Leads", "L2") });
  for (const rows of Object.values(api.store)) for (const r of rows) assert.ok(!("$refs" in r) && !("$persona" in r) && !("Contact_Key" in r));
  // a parent that did not return ids is an error, not a silent null
  const bad = fakeApi(SANDBOX); bad.upsert = async () => undefined;
  await assert.rejects(reset({ api: bad, manifest, sandboxOrgId: "111", users: USERS }), /unresolved ref/);
});

test("persona distribution: IR A and IR B each own leads and investors, one KAM, admin holds the unassigned pool", async () => {
  const d = distribution(manifest);
  assert.deepEqual(d["Leads.Owner"], { ir_a: 8, ir_b: 8, admin: 2 });
  assert.deepEqual(d["Contacts.Owner"], { ir_a: 7, ir_b: 8 });
  assert.deepEqual(d["Contacts.Originating_IR"], { ir_a: 7, ir_b: 8 });
  assert.deepEqual(d["Contacts.KAM"], { kam: 8 });
  assert.deepEqual(d["Cases.Owner"], { kam: 4, compliance: 1, finance_ops: 3 });
  assert.ok(manifest.records.Contacts.some((c) => !c.$persona.KAM), "some investors have no KAM, so a KAM-isolation test has something to hide");
  const api = fakeApi(SANDBOX);
  await reset({ api, manifest, sandboxOrgId: "111", users: USERS });
  const lead = (k) => api.store.Leads.find((r) => r.Seed_Key === k);
  assert.deepEqual(lead("L1").Owner, { id: "u-ira" });
  assert.deepEqual(lead("L2").Owner, { id: "u-irb" });
  assert.deepEqual(lead("U1").Owner, { id: "u-adm" });
  assert.deepEqual(api.store.Contacts.find((r) => r.Seed_Key === "ARL-INV-0205").KAM, { id: "u-kam" });
  assert.ok(api.store.Receipts.every((r) => r.Owner.id === "u-fin"));
});

test("users resolve by email; a missing persona falls back to admin and is reported; no admin is an error", async () => {
  const api = fakeApi(SANDBOX);
  const ok = await resolveUsers({ api, personaEmails: emails });
  assert.deepEqual(ok.users, USERS);
  assert.deepEqual(ok.fallbacks, []);
  const part = await resolveUsers({ api, personaEmails: { ...emails, ir_b: "nobody@x.test", kam: undefined } });
  assert.equal(part.users.ir_b, "u-adm");
  assert.equal(part.users.kam, "u-adm");
  assert.deepEqual(part.fallbacks, ["ir_b", "kam"]);
  await assert.rejects(resolveUsers({ api, personaEmails: { ir_a: "ir_a@x.test" } }), /admin persona unresolved/);
});

test("sessionApi speaks v8 paths: search by tag, upsert on Seed_Key, delete with ids, ids in input order", async () => {
  const calls = [];
  const call = async (method, path, body) => {
    calls.push([method, path, body]);
    if (path.includes("/org")) return { status: 200, body: { org: [{ zgid: 111 }] } };
    if (path.includes("/search")) return calls.filter((c) => c[1].includes("/search")).length === 1 ? { status: 200, body: { data: [{ id: "a" }], info: { more_records: false } } } : { status: 204, body: null };
    if (path.includes("/upsert")) return { status: 200, body: { data: body.data.map((_, i) => ({ status: "success", details: { id: `n${i}` } })) } };
    return { status: 200, body: { data: [{ status: "success" }] } };
  };
  const api = sessionApi(call, "https://crmsandbox.zoho.in");
  assert.deepEqual(await api.org(), { id: "111", apiDomain: "https://crmsandbox.zoho.in" });
  assert.deepEqual(await api.listTagged("Leads", "Test_Seed"), ["a"]);
  assert.deepEqual(await api.listTagged("Leads", "Test_Seed"), []);
  await api.remove("Leads", ["a", "b"]);
  assert.deepEqual(await api.upsert("Leads", [{ Seed_Key: "x" }, { Seed_Key: "y" }]), ["n0", "n1"]);
  assert.deepEqual(calls.map((c) => c[0] + " " + c[1]).slice(1), [
    "GET /crm/v8/Leads/search?criteria=(Test_Seed:equals:true)&per_page=200&page=1",
    "GET /crm/v8/Leads/search?criteria=(Test_Seed:equals:true)&per_page=200&page=1",
    "DELETE /crm/v8/Leads?ids=a,b",
    "POST /crm/v8/Leads/upsert",
  ]);
  assert.deepEqual(calls.at(-1)[2].duplicate_check_fields, ["Seed_Key"]);
  const failing = sessionApi(async () => ({ status: 207, body: { data: [{ status: "error", code: "INVALID_DATA", details: { api_name: "Residency" } }] } }));
  await assert.rejects(failing.upsert("Leads", [{ Seed_Key: "x", Residency: "secret-value" }]), (e) => /INVALID_DATA/.test(e.message) && /Residency/.test(e.message) && !/secret-value/.test(e.message));
});

test("dates keep their distance from the run day; identity never enters the manifest", () => {
  assert.equal(shiftStamp("25 Aug 11:00", "2026-09-02", new Date("2026-10-02T00:00:00Z")), "2026-09-24T11:00:00+05:30");
  assert.equal(shiftStamp("25 Aug", "2026-09-02", new Date("2026-10-02T00:00:00Z")), "2026-09-24");
  assert.equal(shiftStamp("Call back", "2026-09-02", new Date()), "Call back");
  const raw = readFileSync(new URL("./manifest.json", import.meta.url), "utf8");
  assert.doesNotMatch(raw, /"(pan|aadh|aref|bank|acct|ifsc|PAN|PAN_Number|Bank_Account_Number|Aadhaar_Number)":|AVRPM4471K|HDFC1206771/i);
  assert.ok(manifest.records.Receipts.every((r) => /^SEED-/.test(r.UTR)));
});
