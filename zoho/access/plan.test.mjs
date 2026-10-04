// D120 sandbox access config. Run: node --test zoho/access/plan.test.mjs
// A fake Zoho (settings only, no records) answers the v8 calls plan.mjs makes.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { planAll, applySteps, verifyAll, planFieldSecurity, planProfiles, planSharing, assertWall, ruleName } from "./plan.mjs";

const spec = JSON.parse(readFileSync(new URL("./spec.json", import.meta.url), "utf8"));
const SANDBOX = "60090668120", LIVE = "60061770791";
const ROLES = ["CEO", "Manager", "BU Owner", "Digital Infrastructure", "IR Manager", "Investor Relations", "Channel Partner", "Head of Finance",
  "Finance Operations", "Compliance and Audit", "Head of Account Management", "Key Account Manager", "Exec"];
const MODULES = spec.modules.concat(["Accounts", "Deals"]);
const GENERAL = ["Export", "Mass Update", "Mass Delete", "Import"];

function fakeZoho(zgid = SANDBOX) {
  let seq = 1000;
  const nid = () => String(++seq);
  const perms = []; // org-wide permission ids (UNVERIFIED assumption mirrored here)
  for (const m of MODULES) for (const a of ["View", "Create", "Edit", "Delete"]) perms.push({ id: nid(), name: `Crm_Implied_${a}_${m}`, module: m, display_label: a });
  for (const m of MODULES) for (const a of GENERAL) perms.push({ id: nid(), name: `Crm_${a.replace(" ", "_")}_${m}`, module: m, display_label: a });
  const enabled = {}; // profileId -> Set(permId)
  const profiles = [{ id: "P-ADMIN", display_label: "Administrator" }, { id: "P-STD", display_label: "Standard" }];
  for (const p of profiles) enabled[p.id] = new Set(perms.map((x) => x.id));
  const fields = {};
  for (const g of spec.fieldSecurity.groups) for (const [m, list] of Object.entries(g.fields)) {
    fields[m] = (fields[m] || []).concat(list.concat(["Name", "Owner"]).filter((a) => !(fields[m] || []).some((f) => f.api_name === a))
      .map((a) => ({ id: nid(), api_name: a, profiles: profiles.map((p) => ({ id: p.id, name: p.display_label, permission_type: "read_write" })) })));
  }
  const roles = ROLES.map((r) => ({ id: `R-${r}`, display_label: r, name: r }));
  const rules = {};
  const dataSharing = ["Leads", "Contacts", "LLP_UnitAllocation_Module", "Receipts", "Touches", "Cases"].map((m) => ({ module: { api_name: m }, share_type: "private" }))
    .concat(["LLP_Creation_Module", "Investor_Updates", "Mail_Templates"].map((m) => ({ module: { api_name: m }, share_type: "public_read_only" })));
  const writes = [];
  const res = (status, body) => ({ status, body });
  const okItem = (k, id) => res(200, { [k]: [{ code: "SUCCESS", status: "success", details: { id } }] });
  async function call(method, path, body) {
    const [p, q] = path.split("?");
    const mod = q && new URLSearchParams(q).get("module");
    if (method !== "GET") writes.push(method + " " + p);
    let m;
    if (method === "GET" && p === "/crm/v8/org") return res(200, { org: [{ zgid }] });
    if (method === "GET" && p === "/crm/v8/settings/profiles") return res(200, { profiles: profiles.map((x) => ({ ...x })) });
    if ((m = /^\/crm\/v8\/settings\/profiles\/([^/]+)$/.exec(p))) {
      const id = m[1];
      if (!enabled[id]) return res(400, { profiles: [{ code: "INVALID_DATA", status: "error" }] });
      if (method === "GET") return res(200, { profiles: [{ id, permissions_details: perms.map((x) => ({ ...x, enabled: enabled[id].has(x.id) })) }] });
      if (method === "PUT") {
        for (const t of body.profiles[0].permissions_details) {
          if (!perms.some((x) => x.id === t.id)) return res(400, { profiles: [{ code: "INVALID_DATA", status: "error" }] });
          t.enabled ? enabled[id].add(t.id) : enabled[id].delete(t.id);
        }
        return okItem("profiles", id);
      }
    }
    if (method === "POST" && (m = /^\/crm\/v8\/settings\/profiles\/([^/]+)\/actions\/clone$/.exec(p))) {
      const name = body.profiles[0].name;
      if (profiles.some((x) => x.display_label === name)) return res(400, { profiles: [{ code: "DUPLICATE_DATA", status: "error" }] });
      const id = "P-" + nid();
      profiles.push({ id, display_label: name });
      enabled[id] = new Set(enabled[m[1]]);
      for (const fs of Object.values(fields)) for (const f of fs) f.profiles.push({ id, name, permission_type: f.profiles.find((x) => x.id === m[1]).permission_type });
      return okItem("profiles", id);
    }
    if (method === "GET" && p === "/crm/v8/settings/roles") return res(200, { roles });
    if (method === "GET" && p === "/crm/v8/settings/fields") return res(200, { fields: fields[mod] || [] });
    if (method === "PATCH" && (m = /^\/crm\/v8\/settings\/fields\/([^/]+)$/.exec(p))) {
      const f = fields[mod].find((x) => x.id === m[1]);
      for (const pp of body.fields[0].profiles) {
        const slot = f.profiles.find((x) => x.id === pp.id);
        if (!slot) return res(400, { fields: [{ code: "INVALID_DATA", status: "error" }] });
        slot.permission_type = pp.permission_type;
      }
      return okItem("fields", f.id);
    }
    if (p === "/crm/v8/settings/data_sharing/rules") {
      rules[mod] = rules[mod] || [];
      if (method === "GET") return res(200, { sharing_rules: rules[mod] });
      if (method === "POST") { const r = { id: nid(), status: "active", ...body.sharing_rules[0] }; rules[mod].push(r); return okItem("sharing_rules", r.id); }
    }
    if (method === "GET" && p === "/crm/v8/settings/data_sharing") return res(200, { data_sharing: dataSharing });
    return res(404, { code: "INVALID_URL_PATTERN" });
  }
  return { call, writes, fields, profiles, enabled, perms, rules };
}

const api = (steps) => steps.filter((s) => s.kind === "api");
const idOf = (z, name) => z.profiles.find((p) => p.display_label === name).id;
const fls = (z, module, api_, name) => z.fields[module].find((f) => f.api_name === api_).profiles.find((p) => p.id === idOf(z, name)).permission_type;

test("plan, apply, re-plan: second plan has no api step; verify passes everywhere", async () => {
  const z = fakeZoho();
  const steps = await planAll(z.call, spec);
  assert.equal(api(steps).filter((s) => s.creates).length, 12);
  const r = await applySteps(z.call, steps, spec);
  assert.equal(r.ok, true, JSON.stringify(r.log.at(-1)));
  const again = await planAll(z.call, spec);
  assert.deepEqual(api(again), []);
  const before = z.writes.length;
  await applySteps(z.call, again, spec);
  assert.equal(z.writes.length, before, "no second change");
  const v = await verifyAll(z.call, spec);
  assert.equal(v.fail, 0, JSON.stringify(v.rows.filter((x) => !x.pass).slice(0, 5)));
  assert.ok(v.rows.length > 600);
  assert.ok(!JSON.stringify(r.log).includes("read_write"), "log carries statuses and codes only");
});

test("refuses the live org and any unknown org: no write is made", async () => {
  for (const zgid of [LIVE, "123"]) {
    const z = fakeZoho(zgid);
    await assert.rejects(planAll(z.call, spec), zgid === LIVE ? /LIVE org/ : /not the Growize sandbox/);
    await assert.rejects(applySteps(z.call, [{ kind: "api", method: "POST", path: "/crm/v8/settings/profiles/P-STD/actions/clone", body: {} }], spec), /refused/);
    await assert.rejects(verifyAll(z.call, spec), /refused/);
    assert.deepEqual(z.writes, []);
  }
});

test("rule 7 wall: bank only Finance (+DI reveal, D110); PAN never IR/Integration; Aadhaar_Number hidden from all", async () => {
  const z = fakeZoho();
  await applySteps(z.call, await planAll(z.call, spec), spec);
  const bank = spec.fieldSecurity.groups.find((g) => g.id === "bank").fields.Contacts;
  for (const p of spec.profiles) {
    for (const f of bank) {
      const t = fls(z, "Contacts", f, p.name);
      if (!["Finance Head", "Finance Ops", "Digital Infrastructure"].includes(p.name)) assert.equal(t, "hidden", `${p.name} ${f}`);
    }
    assert.equal(fls(z, "Contacts", "Aadhaar_Number", p.name), "hidden", p.name);
  }
  for (const n of ["IR", "IR Manager", "Channel Partner", "Integration", "KAM", "Viewer", "Finance Ops"]) {
    for (const [m, f] of [["Contacts", "PAN_Number"], ["Leads", "PAN"], ["Contacts", "PAN_Proof"], ["Contacts", "Aadhaar_Last4"]]) assert.equal(fls(z, m, f, n), "hidden", `${n} ${m}.${f}`);
  }
  for (const n of ["IR", "KAM", "Viewer", "Leadership"]) {
    assert.equal(fls(z, "Receipts", "Amount", n), "hidden");
    assert.equal(fls(z, "LLP_UnitAllocation_Module", "Total_Amount_Received", n), "hidden");
    assert.equal(fls(z, "Investor_Payouts", "Payout_UTR", n), "hidden");
  }
  assert.equal(fls(z, "LLP_Creation_Module", "Units_Released", "Finance Head"), "read_write");
  assert.equal(fls(z, "LLP_Creation_Module", "LLP_Status", "Finance Ops"), "read_only");
  // module level: only Finance profiles create Receipts; Integration has Cases and nothing else
  const has = (name, mod, a) => z.enabled[idOf(z, name)].has(z.perms.find((x) => x.name === `Crm_Implied_${a}_${mod}`).id);
  for (const p of spec.profiles) assert.equal(has(p.name, "Receipts", "Create"), ["Finance Head", "Finance Ops"].includes(p.name), p.name);
  for (const m of spec.modules) assert.equal(has("Integration", m, "View"), m === "Cases", m);
  for (const p of spec.profiles) for (const m of spec.modules) assert.equal(has(p.name, m, "Delete"), false);
  const exp = (name) => z.perms.filter((x) => x.display_label === "Export").some((x) => z.enabled[idOf(z, name)].has(x.id));
  for (const p of spec.profiles) assert.equal(exp(p.name), false, `export ${p.name}`);
  assert.equal(exp("Administrator"), true, "Administrator untouched");
});

test("a spec that opens the wall is refused before any step", () => {
  const bad = (mut) => { const s = structuredClone(spec); mut(s); return s; };
  const ids = { Standard: "P-STD" };
  assert.throws(() => planFieldSecurity(bad((s) => { s.fieldSecurity.groups[0].grant.KAM = "read_only"; }), {}, ids), /KAM would read bank/);
  assert.throws(() => planFieldSecurity(bad((s) => { s.fieldSecurity.groups[1].grant.IR = "read_only"; }), {}, ids), /IR would read identity/);
  assert.throws(() => planFieldSecurity(bad((s) => { s.fieldSecurity.groups[1].grant.Integration = "read_write"; }), {}, ids), /Integration would read identity/);
  assert.throws(() => planFieldSecurity(bad((s) => { s.fieldSecurity.groups[2].grant["Compliance and Audit"] = "read_only"; }), {}, ids), /Aadhaar_Number/);
  assert.throws(() => planFieldSecurity(bad((s) => { s.fieldSecurity.groups[0].default = "read_only"; }), {}, ids), /wall/);
  assert.doesNotThrow(() => assertWall(spec));
});

test("planners: exposed-permission gaps become manual steps; sharing rules matched by content, not only name", () => {
  const std = { id: "S", display_label: "Standard" };
  const steps = planProfiles({ ...spec, profiles: [spec.profiles[3]] }, { profiles: [std], details: { S: { permissions_details: [] } } });
  assert.equal(steps[0].method, "POST");
  assert.equal(steps.at(-1).kind, "manual");
  assert.match(steps.at(-1).what, /export=off/);
  const roleIds = Object.fromEntries(ROLES.map((r) => [r, `R-${r}`]));
  const first = planSharing(spec, {}, roleIds);
  assert.equal(first.length, spec.sharingRules.rules.length);
  const existing = { Contacts: [{ id: "x", name: "made by hand", ...first[0].body.sharing_rules[0] }] };
  existing.Contacts[0].name = "made by hand";
  assert.equal(planSharing(spec, existing, roleIds).length, first.length - 1);
  const renamed = { Contacts: [{ id: "y", name: ruleName(spec.sharingRules.rules[0]), type: "Record_Owner_Based", permission_type: "read" }] };
  assert.equal(planSharing(spec, renamed, roleIds).find((s) => s.path.includes("Contacts")).method, "PUT");
  assert.throws(() => planSharing(spec, {}, { CEO: "R" }), /role Head of Finance not found/);
});

test("personas map to D80 roles and spec profiles; '&' kept out of profile names", () => {
  const names = new Set(spec.profiles.map((p) => p.name));
  for (const p of spec.personas.sandbox.concat(spec.personas.later)) { assert.ok(names.has(p.profile), p.profile); assert.ok(ROLES.includes(p.role), p.role); }
  assert.equal(spec.personas.sandbox.length, 5);
  for (const n of names) { assert.ok(!n.includes("&")); assert.ok(n.length <= 50); }
});

const SCHEMA = "/home/claude/work/sandbox-setup/sandbox-schema-2026-10-05.json";
test("every spec field and module exists in the sandbox schema (5 Oct read)", { skip: !(await import("node:fs")).existsSync(SCHEMA) }, () => {
  const mods = JSON.parse(readFileSync(SCHEMA, "utf8")).modules;
  for (const g of spec.fieldSecurity.groups) for (const [m, list] of Object.entries(g.fields)) for (const a of list) assert.ok(mods[m].split(",").some((x) => x.split(":")[0] === a), `${m}.${a}`);
  for (const m of spec.modules) if (!["Tasks", "Calls", "Notes"].includes(m)) assert.ok(mods[m], m);
});

test("built bundle runs in a page with window.__z: plan, apply, verify, then nothing left to do", async () => {
  const { execFileSync } = await import("node:child_process");
  const { tmpdir } = await import("node:os");
  const vm = await import("node:vm");
  const out = `${tmpdir()}/gz-access-${process.pid}.js`;
  execFileSync(process.execPath, [new URL("./build-bundle.mjs", import.meta.url).pathname, out]);
  const src = readFileSync(out, "utf8");
  assert.ok(Buffer.byteLength(src) < 26000, `bundle ${Buffer.byteLength(src)} bytes`);
  assert.ok(!/^\s*(import|export)\s/m.test(src), "no module syntax");
  const z = fakeZoho();
  const window = { __z: z.call };
  vm.runInNewContext(src, { window, URLSearchParams, structuredClone });
  const r = await window.GZAccess.apply(await window.GZAccess.plan());
  assert.equal(r.ok, true);
  assert.equal((await window.GZAccess.plan()).filter((s) => s.kind === "api").length, 0);
  assert.equal((await window.GZAccess.verify()).fail, 0);
  await assert.rejects(window.GZAccess.apply(), /pass the array/);
});
