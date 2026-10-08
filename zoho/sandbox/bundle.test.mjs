// The built bundle, run in a vm against a fake window.__z. Run: node --test zoho/sandbox/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const out = join(mkdtempSync(join(tmpdir(), "gzseed-")), "seed.js");
execFileSync("node", [new URL("./build-bundle.mjs", import.meta.url).pathname, out]);
const src = readFileSync(out, "utf8");

const load = (zgid, extra = {}) => {
  const calls = [];
  const z = async (method, path, body) => {
    calls.push(`${method} ${path}`);
    if (path === "/crm/v8/org") return { status: 200, body: { org: [{ zgid }] } };
    if (method === "POST" && extra.write) return extra.write(method, path, body);
    if (path.startsWith("/crm/v8/settings/profiles")) return { status: 200, body: { profiles: [{ id: "p1", name: "Administrator" }, { id: "p2", name: "Standard" }] } };
    if (path.startsWith("/crm/v8/settings/fields")) return { status: 200, body: { fields: [{ api_name: "Owner", data_type: "ownerlookup" }] } };
    if (path.startsWith("/crm/v8/users")) return { status: 200, body: { users: [{ id: "adm", email: "a@x.test" }], info: {} } };
    if (path.includes("/search")) return { status: 204, body: null };
    return extra.write ? extra.write(method, path, body) : { status: 200, body: {} };
  };
  const window = { __z: z };
  vm.runInNewContext(src, { window, location: { origin: "https://crmsandbox.zoho.in" } });
  return { GZSeed: window.GZSeed, calls };
};

test("bundle has no imports and exposes the five functions", () => {
  assert.doesNotMatch(src, /^(import|export) /m);
  const { GZSeed } = load("60090668120");
  assert.deepEqual(Object.keys(GZSeed).sort(), ["applyFields", "counts", "plan", "planFields", "reset"]);
  assert.equal(GZSeed.counts().seeded.Leads, 30);
  assert.equal(GZSeed.counts().deferred.Documents.rows, 45);
});

test("every function refuses the live org and writes nothing", async () => {
  const { GZSeed, calls } = load("60061770791");
  for (const f of [() => GZSeed.planFields(), () => GZSeed.applyFields([{ method: "POST", path: "/x", body: {} }]), () => GZSeed.plan({ personaEmails: {} }), () => GZSeed.reset({ confirm: true })])
    await assert.rejects(f(), /not a sandbox org/);
  assert.ok(calls.every((c) => c === "GET /crm/v8/org"));
});

test("reset without confirm is a dry run: reads, never writes", async () => {
  const { GZSeed, calls } = load("60090668120");
  const r = await GZSeed.reset({ personaEmails: { admin: "a@x.test" } });
  assert.equal(r.dryRun, true);
  assert.deepEqual([...r.fallbacksToAdmin], ["ir_a", "ir_b", "kam", "finance_ops", "compliance"]);
  assert.ok(calls.every((c) => c.startsWith("GET ")));
});

test("planFields then applyFields stops at the first failure and logs status and codes only", async () => {
  const { GZSeed } = load("60090668120", { write: async () => ({ status: 400, body: { fields: [{ code: "DUPLICATE_DATA", message: "secret" }] } }) });
  const { steps, gaps } = await GZSeed.planFields();
  assert.equal(steps.length, 7);
  assert.ok(gaps.length > 0);
  const log = await GZSeed.applyFields(steps);
  assert.equal(JSON.stringify(log.map((l) => [l.status, l.codes])), JSON.stringify([[400, "DUPLICATE_DATA"]]));
  assert.doesNotMatch(JSON.stringify(log), /secret/);
});

test("confirmed reset against a fake Zoho upserts every module in order and returns counts only", async () => {
  let n = 0;
  const { GZSeed } = load("60090668120", { write: async (m, p, b) => p.includes("/upsert") ? { status: 200, body: { data: b.data.map(() => ({ status: "success", details: { id: String(++n) } })) } } : { status: 200, body: { data: [] } } });
  const r = await GZSeed.reset({ personaEmails: { admin: "a@x.test" }, confirm: true });
  assert.equal(r.counts.Touches, 57);
  assert.deepEqual(Object.keys(r).sort(), ["counts", "deleted", "fallbacks"]);
});
