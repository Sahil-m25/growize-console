import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { evaluate, summarize, observe, assertSandbox, ownerMapFromUsers, SANDBOX_ZGID, LIVE_ZGID, MODULES } from "./check.mjs";
import { buildBundle } from "./build-bundle.mjs";

const ex = JSON.parse(readFileSync(new URL("./expectations.json", import.meta.url), "utf8"));
const SENTINEL = "SENTINEL-PAN-ABCDE1234F";

/* ---- a seed with the owner distribution the real seed is meant to have ---- */
const SEED = {
  Leads: ["ir_a", "ir_a", "ir_b", "ir_b", "kam"].map((owner, i) => ({ seedKey: `L${i}`, owner })),
  Contacts: [{ seedKey: "C1", owner: "admin", originatingIr: "ir_a", kam: "kam" }, { seedKey: "C2", owner: "admin", originatingIr: "ir_b", kam: "kam" }, { seedKey: "C3", owner: "admin", originatingIr: "ir_a", kam: "other" }, { seedKey: "C4", owner: "ir_a", originatingIr: "ir_a", kam: "none" }, { seedKey: "C5", owner: "ir_b", originatingIr: "ir_b", kam: "none" }, { seedKey: "C6", owner: "kam", originatingIr: "none", kam: "kam" }],
  LLP_UnitAllocation_Module: ["ir_a", "ir_b", "kam"].map((owner, i) => ({ seedKey: `A${i}`, owner })),
  Receipts: ["ir_a", "ir_b", "kam"].map((owner, i) => ({ seedKey: `R${i}`, owner })),
  Touches: ["ir_a", "ir_a", "ir_b", "kam"].map((owner, i) => ({ seedKey: `T${i}`, owner })),
  Cases: ["ir_a", "ir_b", "kam", "finance_ops"].map((owner, i) => ({ seedKey: `K${i}`, owner })),
};
const matches = (row, pred, self) => Object.entries(pred).every(([k, v]) => row[k] === (v === "self" ? self : v));

/** The observation a correctly configured Zoho would produce for this persona. */
function ideal(persona) {
  const p = ex.personas[persona];
  const obs = { persona, user: { role: p.role, profile: p.profile }, export: p.export, modules: {}, fields: {}, rows: {}, create: {} };
  for (const [m, f] of Object.entries(p.modules)) obs.modules[m] = { viewable: f.viewable === true, creatable: f.creatable === true, editable: f.editable === true };
  for (const [k, v] of Object.entries(p.fields)) obs.fields[k] = { record: v, meta: v };
  for (const [m, rows] of Object.entries(SEED)) {
    const rule = p.scope[m];
    const seen = !rule ? [] : rule.mode === "none" ? [] : rule.mode === "all" ? rows : rows.filter((r) => rule.allow.some((a) => matches(r, a, persona)));
    obs.rows[m] = { status: rule?.mode === "none" ? 403 : 200, count: seen.length, seedKeys: seen.map((r) => r.seedKey), rows: seen };
  }
  for (const [m, w] of Object.entries(p.testCreate)) obs.create[m] = { outcome: w ? "created" : "denied", allowed: w === true, deleted: w ? true : null };
  return obs;
}
const clone = (o) => JSON.parse(JSON.stringify(o));
const find = (rows, check) => rows.find((r) => r.check === check);

test("expectations: every persona is complete and every field/check has a trace", () => {
  assert.deepEqual(ex.personaKeys, ["ir_a", "ir_b", "kam", "finance_ops", "compliance", "admin"]);
  for (const k of ex.personaKeys) {
    const p = ex.personas[k];
    assert.ok(p.label && p.profile && p.modules && p.fields && p.scope && p.testCreate && "export" in p, k);
    for (const m of Object.keys(p.modules)) assert.ok(MODULES.includes(m), m);
    const rows = evaluate(ex, k, ideal(k));
    for (const r of rows) assert.ok(r.traces.length > 0, `${k} ${r.check} has no traces`);
  }
});

test("plan rules, spelled out: PAN only Finance-side/Compliance, bank only Finance Ops, Aadhaar_Number nobody but the admin control", () => {
  const F = (p, f) => ex.personas[p].fields[f];
  for (const p of ["ir_a", "ir_b", "kam", "finance_ops"]) assert.equal(F(p, "Contacts.PAN_Number"), false, p);
  assert.equal(F("compliance", "Contacts.PAN_Number"), true);
  for (const p of ["ir_a", "ir_b", "kam", "compliance"]) assert.equal(F(p, "Contacts.Bank_Account_Number"), false, p);
  assert.equal(F("finance_ops", "Contacts.Bank_Account_Number"), true);
  for (const p of ["ir_a", "ir_b", "kam", "finance_ops", "compliance"]) assert.equal(F(p, "Contacts.Aadhaar_Number"), false, p);
  assert.equal(F("admin", "Contacts.Aadhaar_Number"), true, "Administrator ignores FLS (ACCESS-PLAN R1)");
  assert.equal(ex.personas.compliance.modules.Receipts.creatable, false);
  assert.equal(ex.personas.compliance.modules.Receipts.editable, false);
  assert.equal(ex.personas.compliance.modules.LLP_UnitAllocation_Module.editable, false);
});

test("every persona passes against its own ideal observation (seed distribution)", () => {
  for (const k of ex.personaKeys) {
    const s = summarize(evaluate(ex, k, ideal(k)), k);
    assert.equal(s.failed, 0, `${k}: ${JSON.stringify(s)}`);
    assert.ok(s.passed > 10, k);
  }
});

test("admin control: ideal admin passes env check; admin missing anything marks the environment broken", () => {
  const ok = evaluate(ex, "admin", ideal("admin"));
  assert.equal(find(ok, "env.admin_control").pass, true);
  const bad = ideal("admin"); bad.rows.Receipts = { status: 200, count: 0, seedKeys: [], rows: [] };
  const rows = evaluate(ex, "admin", bad);
  assert.equal(find(rows, "scope.Receipts.sees_all_owners").pass, false);
  assert.equal(find(rows, "env.admin_control").pass, false);
  assert.match(find(rows, "env.admin_control").detail, /ENVIRONMENT BROKEN/);
  assert.equal(summarize(rows, "admin").envBroken, true);
  const noPan = ideal("admin"); noPan.fields["Contacts.PAN_Number"] = { record: false, meta: false };
  assert.equal(summarize(evaluate(ex, "admin", noPan), "admin").envBroken, true);
});

test("IR A sees IR B's lead -> scope.Leads.no_foreign fails and names the Seed_Key", () => {
  const o = ideal("ir_a"); o.rows.Leads.rows.push(SEED.Leads[2]); o.rows.Leads.count++;
  const r = find(evaluate(ex, "ir_a", o), "scope.Leads.no_foreign");
  assert.deepEqual([r.pass, r.actual], [false, 1]);
  assert.match(r.detail, /L2\(owner=ir_b/);
});

test("IR A sees an investor of IR B's lead -> scope.Contacts fails; KAM sees another KAM's investor fails, unless shared", () => {
  const o = ideal("ir_a"); o.rows.Contacts.rows.push(SEED.Contacts[1]);
  assert.equal(find(evaluate(ex, "ir_a", o), "scope.Contacts.no_foreign").pass, false);
  const k = ideal("kam"); k.rows.Contacts.rows.push(SEED.Contacts[2]);
  assert.equal(find(evaluate(ex, "kam", k), "scope.Contacts.no_foreign").pass, false);
  const shared = { ...ex, sharedSeedKeys: ["C3"] };
  assert.equal(find(evaluate(shared, "kam", k), "scope.Contacts.no_foreign").pass, true);
});

test("a persona that sees nothing of its own fails sees_own (a wall that blocks everything is not a pass)", () => {
  const o = ideal("ir_b"); o.rows.Leads = { status: 200, count: 0, seedKeys: [], rows: [] };
  assert.equal(find(evaluate(ex, "ir_b", o), "scope.Leads.sees_own.owner").pass, false);
  assert.equal(find(evaluate(ex, "ir_b", o), "scope.Leads.no_foreign").pass, true);
});

test("IR sees any Receipt -> sees_nothing fails; Finance not seeing all Receipts owners fails", () => {
  const o = ideal("ir_a"); o.rows.Receipts = { status: 200, count: 1, seedKeys: ["R1"], rows: [SEED.Receipts[1]] };
  assert.equal(find(evaluate(ex, "ir_a", o), "scope.Receipts.sees_nothing").pass, false);
  const f = ideal("finance_ops"); f.rows.Contacts.rows = f.rows.Contacts.rows.filter((r) => r.owner !== "ir_b");
  assert.equal(find(evaluate(ex, "finance_ops", f), "scope.Contacts.sees_all_owners").pass, false);
});

test("sensitive fields: IR sees PAN, Finance Ops sees PAN, Compliance sees bank, anyone sees Aadhaar_Number -> each fails", () => {
  const cases = [["ir_a", "Contacts.PAN_Number"], ["finance_ops", "Contacts.PAN_Number"], ["compliance", "Contacts.Bank_Account_Number"], ["kam", "Contacts.Aadhaar_Number"], ["compliance", "Contacts.Aadhaar_Number"], ["kam", "Receipts.UTR"]];
  for (const [p, f] of cases) {
    const o = ideal(p); o.fields[f] = { record: true, meta: true };
    const r = find(evaluate(ex, p, o), `field.${f}`);
    assert.deepEqual([r.expected, r.actual, r.pass], [false, true, false], `${p} ${f}`);
  }
});

test("a field the record read cannot decide falls back to metadata; undecidable fails closed; meta mismatch is advisory only", () => {
  const o = ideal("ir_a"); o.fields["Contacts.PAN_Number"] = { record: null, meta: false };
  const rows = evaluate(ex, "ir_a", o);
  assert.equal(find(rows, "field.Contacts.PAN_Number").pass, true);
  o.fields["Contacts.PAN_Number"] = { record: null, meta: null };
  assert.equal(find(evaluate(ex, "ir_a", o), "field.Contacts.PAN_Number").pass, false);
  o.fields["Contacts.PAN_Number"] = { record: false, meta: true }; // record says hidden, metadata says listed visible
  const r2 = evaluate(ex, "ir_a", o);
  assert.equal(find(r2, "field.Contacts.PAN_Number").pass, true);
  assert.equal(find(r2, "fieldmeta.Contacts.PAN_Number").pass, false);
  assert.equal(summarize(r2, "ir_a").failed, 0);
  assert.equal(summarize(r2, "ir_a").advisoryFailed, 1);
});

test("modules and money writes: Compliance able to create a Receipt, IR able to edit Contacts, KAM able to read Receipts -> fail", () => {
  const c = ideal("compliance"); c.modules.Receipts.creatable = true; c.create.Receipts = { outcome: "created", allowed: true, deleted: false, leftoverId: "123" };
  const rows = evaluate(ex, "compliance", c);
  assert.equal(find(rows, "module.Receipts.creatable").pass, false);
  assert.equal(find(rows, "create.Receipts").pass, false);
  assert.match(find(rows, "create.Receipts").detail, /LEFTOVER test record 123/);
  const i = ideal("ir_a"); i.modules.Contacts.editable = true;
  assert.equal(find(evaluate(ex, "ir_a", i), "module.Contacts.editable").pass, false);
  const k = ideal("kam"); k.modules.Receipts.viewable = true;
  assert.equal(find(evaluate(ex, "kam", k), "module.Receipts.viewable").pass, false);
});

test("export: IR with Export fails; unreadable profile is skipped (null), not failed; wrong login fails identity", () => {
  const o = ideal("ir_a"); o.export = true;
  assert.equal(find(evaluate(ex, "ir_a", o), "export").pass, false);
  o.export = null;
  const r = find(evaluate(ex, "ir_a", o), "export");
  assert.equal(r.pass, null); assert.match(r.detail, /by hand/);
  const wrong = ideal("ir_a"); wrong.user = { role: "CEO", profile: "Administrator" };
  const rows = evaluate(ex, "ir_a", wrong);
  assert.equal(find(rows, "identity.role").pass, false);
  assert.equal(find(rows, "identity.profile").pass, false);
});

/* ---- observe(): a fake Zoho answering from the ideal state, as the persona's own session ---- */
function fakeCall(persona, { leakValue = SENTINEL, calls = [] } = {}) {
  const o = ideal(persona), p = ex.personas[persona];
  return Object.assign(async (method, path, body) => {
    calls.push(`${method} ${path.split("?")[0]}`);
    const [pathname, qs = ""] = path.split("?"); const q = new URLSearchParams(qs);
    if (pathname === "/crm/v8/users" && q.get("type") === "CurrentUser") return { status: 200, body: { users: [{ role: { name: p.role }, profile: { id: "p1", name: p.profile } }] } };
    if (pathname === "/crm/v8/settings/profiles/p1") return { status: 200, body: { profiles: [{ permissions_details: [{ api_name: "Import", enabled: true }, ...(p.export === null ? [] : [{ api_name: "Export", name: "Export", enabled: p.export }])] }] } };
    if (pathname === "/crm/v8/settings/modules") return { status: 200, body: { modules: Object.entries(o.modules).map(([api_name, f]) => ({ api_name, ...f })) } };
    if (pathname === "/crm/v8/settings/fields") return { status: 200, body: { fields: Object.entries(o.fields).filter(([k]) => k.startsWith(q.get("module") + ".")).map(([k, v]) => ({ api_name: k.split(".")[1], visible: v.meta })) } };
    const mod = pathname.split("/")[3];
    if (method === "GET") {
      const fields = q.get("fields").split(",");
      const r = o.rows[mod] ?? (o.modules[mod]?.viewable ? { status: 200, rows: [{ seedKey: "X" }] } : undefined); // farms etc.: rows exist but are not scope-checked
      if (!r) return { status: 403, body: { code: "NO_PERMISSION" } };
      if (r.status === 403) return { status: 403, body: { code: "NO_PERMISSION" } };
      const f = fields.length === 2 && fields[0] === "id" ? fields[1] : null; // a single-field probe
      if (f) { const vis = o.fields[`${mod}.${f}`]?.record; const rows = r.rows.length ? [vis ? { id: "1", [f]: leakValue } : { id: "1" }] : []; return { status: rows.length ? 200 : 204, body: rows.length ? { data: rows } : undefined }; }
      const user = (t) => (t === "none" ? null : { id: `id-${t}`, name: `Name ${t}` });
      return { status: 200, body: { data: r.rows.map((x, i) => ({ id: `r${i}`, Seed_Key: x.seedKey, Owner: user(x.owner), ...(mod === "Contacts" ? { Originating_IR: user(x.originatingIr), KAM: user(x.kam) } : {}) })), info: { more_records: false } } };
    }
    if (method === "POST") { const c = o.create[mod]; return c.allowed ? { status: 201, body: { data: [{ code: "SUCCESS", details: { id: "new1" } }] } } : { status: 403, body: { data: [{ code: "NO_PERMISSION" }] } }; }
    if (method === "DELETE") return { status: 200, body: { data: [{ code: "SUCCESS" }] } };
    throw new Error("unexpected " + method + path);
  }, { calls });
}
const ownerMap = Object.fromEntries(["ir_a", "ir_b", "kam", "finance_ops", "compliance", "admin"].map((t) => [`id-${t}`, t]));

test("observe + evaluate end to end with a fake Zoho: every persona passes, and no field value appears in the observation", async () => {
  for (const k of ex.personaKeys) {
    const call = fakeCall(k);
    const obs = await observe(call, k, ex, { ownerMap });
    assert.ok(!JSON.stringify(obs).includes(SENTINEL), `${k}: a sensitive value leaked into the observation`);
    const rows = evaluate(ex, k, obs);
    const bad = rows.filter((r) => r.pass === false && !r.advisory);
    assert.deepEqual(bad.map((r) => r.check), [], k);
    assert.ok(!JSON.stringify(rows).includes(SENTINEL));
  }
});

test("observe removes the test records it creates, and only touches Touches/Receipts with Test_Seed=true", async () => {
  const sent = [];
  const call = fakeCall("admin");
  const spy = async (m, p, b) => { if (m !== "GET") sent.push([m, p.split("?")[0], b?.data?.[0]?.Test_Seed]); return call(m, p, b); };
  const obs = await observe(spy, "admin", ex, { ownerMap });
  assert.deepEqual(sent, [["POST", "/crm/v8/Touches", true], ["DELETE", "/crm/v8/Touches", undefined], ["POST", "/crm/v8/Receipts", true], ["DELETE", "/crm/v8/Receipts", undefined]]);
  assert.equal(obs.create.Touches.deleted, true);
});

test("observe: a leaky Zoho (IR sees PAN key and an extra Receipt) is caught", async () => {
  const call = fakeCall("ir_a");
  const leaky = async (m, p, b) => {
    const r = await call(m, p, b);
    if (m === "GET" && p.startsWith("/crm/v8/Contacts?fields=id,PAN_Number")) return { status: 200, body: { data: [{ id: "1", PAN_Number: SENTINEL }] } };
    return r;
  };
  const obs = await observe(leaky, "ir_a", ex, { ownerMap });
  assert.ok(!JSON.stringify(obs).includes(SENTINEL));
  assert.equal(find(evaluate(ex, "ir_a", obs), "field.Contacts.PAN_Number").pass, false);
});

test("ownerMapFromUsers maps persona users by name and admins by profile; unknown owners become 'other'", () => {
  const m = ownerMapFromUsers([{ id: "1", full_name: "IR A Test", profile: { name: "IR" } }, { id: "2", full_name: "IR B Test" }, { id: "3", full_name: "Sahil", profile: { name: "Administrator" } }, { id: "4", full_name: "Someone" }, { id: "5", full_name: "Compliance and Audit Test" }], ex);
  assert.deepEqual([m["1"], m["2"], m["3"], m["4"], m["5"]], ["ir_a", "ir_b", "admin", undefined, "compliance"]);
});

test("org guard: refuses the live org and anything that is not the sandbox", async () => {
  const org = (zgid) => async () => ({ status: 200, body: { org: [{ zgid }] } });
  assert.equal(await assertSandbox(org(SANDBOX_ZGID)), SANDBOX_ZGID);
  await assert.rejects(assertSandbox(org(LIVE_ZGID)), /LIVE org/);
  await assert.rejects(assertSandbox(org("1")), /not the sandbox/);
  await assert.rejects(assertSandbox(async () => ({ status: 401, body: {} })), /unknown/);
});

test("bundle: one self-contained IIFE; in a fake browser it refuses the live org (no further call) and runs on the sandbox", async () => {
  const src = buildBundle();
  assert.ok(!/^\s*(import|export)\s/m.test(src));
  const run = async (zgid) => {
    const seen = [];
    const base = fakeCall("ir_a");
    const win = { __z: async (m, p, b) => { seen.push(p); return p === "/crm/v8/org" ? { status: 200, body: { org: [{ zgid }] } } : p.startsWith("/crm/v8/users?type=ActiveUsers") ? { status: 200, body: { users: [] } } : base(m, p, b); } };
    const logs = [];
    vm.runInNewContext(src, { window: win, console: { table: () => {}, log: (s) => logs.push(s) } });
    return { win, seen, logs };
  };
  const live = await run(LIVE_ZGID);
  await assert.rejects(live.win.GZWall.run("ir_a"), /LIVE org/);
  assert.deepEqual(live.seen, ["/crm/v8/org"]);
  const sb = await run(SANDBOX_ZGID);
  await assert.rejects(sb.win.GZWall.run("nobody"), /persona must be one of/);
  const res = await sb.win.GZWall.run("ir_a", { ownerMap });
  assert.equal(res.summary.failed, 0);
  assert.match(sb.logs[0], /GZWall ir_a: PASS/);
  assert.ok(res.table.every((r) => ["PASS", "skip", "warn"].includes(r.result)));
});
