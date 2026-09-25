// TC-E16-005 / TC-E16-006. Run: node --test zoho/sandbox/reset.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { reset, shiftStamp } from "./reset.mjs";

const manifest = JSON.parse(readFileSync(new URL("./manifest.json", import.meta.url), "utf8"));
const fakeApi = (org, leftovers = 3) => {
  const store = {}, log = [];
  for (const m of Object.keys(manifest.records)) store[m] = Array.from({ length: leftovers }, (_, i) => ({ id: `old${i}` }));
  return {
    store, log,
    org: async () => org,
    listTagged: async (m) => store[m].map((r) => r.id),
    remove: async (m, ids) => { log.push(["remove", m]); store[m] = store[m].filter((r) => !ids.includes(r.id)); },
    upsert: async (m, rows) => { log.push(["upsert", m]); store[m].push(...rows); },
  };
};
const SANDBOX = { id: "111", apiDomain: "https://crm.zohosandbox.com" };

test("TC-E16-005 reset leaves exactly the manifest, nothing from the last run", async () => {
  const api = fakeApi(SANDBOX);
  await reset({ api, manifest, sandboxOrgId: "111", runDay: new Date("2026-10-01T00:00:00Z") });
  for (const [m, rows] of Object.entries(manifest.records)) {
    assert.deepEqual(api.store[m].map((r) => r.Seed_Key), rows.map((r) => r.Seed_Key), m);
    assert.ok(api.store[m].every((r) => r.Test_Seed === true));
  }
  assert.deepEqual(Object.keys(manifest.records), ["Leads", "Contacts", "LLP_Creation_Module", "LLP_UnitAllocation_Module", "Receipts", "Documents", "Cases"]);
});

test("TC-E16-006 reset refuses production and changes nothing", async () => {
  for (const org of [{ id: "999", apiDomain: "https://www.zohoapis.in" }, { id: "111", apiDomain: "https://www.zohoapis.in" }]) {
    const api = fakeApi(org);
    await assert.rejects(reset({ api, manifest, sandboxOrgId: "111" }), /not a sandbox org/);
    assert.deepEqual(api.log, []);
  }
  await assert.rejects(reset({ api: fakeApi(SANDBOX), manifest, sandboxOrgId: undefined }), /not a sandbox org/);
});

test("dates keep their distance from the run day; identity never enters the manifest", () => {
  assert.equal(shiftStamp("25 Aug 11:00", "2026-09-02", new Date("2026-10-02T00:00:00Z")), "2026-09-24T11:00:00");
  assert.equal(shiftStamp("Call back", "2026-09-02", new Date()), "Call back");
  assert.doesNotMatch(readFileSync(new URL("./manifest.json", import.meta.url), "utf8"), /"(pan|aadh|aref|bank|acct|ifsc)":|AVRPM4471K/i);
});
