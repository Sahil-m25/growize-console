// D120 sandbox access config. Run: node --test zoho/access/plan.test.mjs
// A fake Zoho (settings only, no records) answers the v8 calls plan.mjs makes.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { planAll, applySteps, verifyAll, planFieldSecurity, planProfiles, planSharing, planLayoutRequired, assertWall, ruleName } from "./plan.mjs";

const spec = JSON.parse(readFileSync(new URL("./spec.json", import.meta.url), "utf8"));
const SANDBOX = "60090668120", LIVE = "60061770791";
const ROLES = ["CEO", "Manager", "BU Owner", "Digital Infrastructure", "IR Manager", "Investor Relations", "Channel Partner", "Head of Finance",
  "Finance Operations", "Compliance and Audit", "Head of Account Management", "Key Account Manager", "Exec"];
const MODULES = spec.modules.concat(["Accounts", "Deals"]);
const GENERAL = ["Export", "Mass_Update", "Mass_Delete", "Import", "Mass_Transfer", "Change_Owner", "Share", "Merge", "Delete_Mail", "View_All", "Edit_All"];

function fakeZoho(zgid = SANDBOX, roleNames = ROLES) {
  let seq = 1000;
  const nid = () => String(++seq);
  const perms = []; // org-wide permission ids (UNVERIFIED assumption mirrored here)
  const pid = {};
  const add = (name, o) => { const x = { id: nid(), name, ...o }; pid[name] = x.id; perms.push(x); };
  for (const m of MODULES) for (const a of ["View", "Create", "Edit", "Delete"]) add(`Crm_Implied_${a}_${m}`, { module: m, display_label: a });
  for (const m of MODULES) for (const a of GENERAL) add(`Crm_Implied_${a}_${m}`, { module: m, display_label: m }); // live shape: label is the module name
  // live 5 Oct: child permissions need their parent enabled (Create/Edit/Delete <- View; Mass_Update <- Edit; Mass_Delete <- Delete; the rest <- View)
  for (const x of perms) {
    const m = x.module, a = x.name.slice("Crm_Implied_".length, -m.length - 1);
    const par = a === "View" ? null : a === "Mass_Update" ? "Edit" : a === "Mass_Delete" ? "Delete" : "View";
    x.parent_permissions = par ? [pid[`Crm_Implied_${par}_${m}`]] : [];
  }
  const enabled = {}; // profileId -> Set(permId)
  const profiles = [{ id: "P-ADMIN", display_label: "Administrator" }, { id: "P-STD", display_label: "Standard" }];
  for (const p of profiles) enabled[p.id] = new Set(perms.map((x) => x.id));
  const fields = {};
  for (const g of spec.fieldSecurity.groups) for (const [m, list] of Object.entries(g.fields)) {
    fields[m] = (fields[m] || []).concat(list.concat(["Name", "Owner"]).filter((a) => !(fields[m] || []).some((f) => f.api_name === a))
      .map((a) => ({ id: nid(), api_name: a, profiles: profiles.map((p) => ({ id: p.id, name: p.display_label, permission_type: "read_write" })) })));
  }
  const roles = roleNames.map((r) => ({ id: `R-${r}`, display_label: r, name: r }));
  const rules = {};
  const dataSharing = ["Leads", "Contacts", "LLP_UnitAllocation_Module", "Receipts", "Touches", "Cases"].map((m) => ({ module: { api_name: m }, share_type: "private" }))
    .concat(["LLP_Creation_Module", "Investor_Updates", "Mail_Templates"].map((m) => ({ module: { api_name: m }, share_type: "public_read_only" })));
  // layout-required fields (live 5 Oct: Standard layouts required these four)
  const REQ = { Contacts: ["PAN_Number", "Aadhaar_Number"], LLP_UnitAllocation_Module: ["Token_Advance_Amount"], LLP_Creation_Module: ["LLP_Status"] };
  const layouts = {};
  for (const m of Object.keys(fields)) {
    const fl = fields[m].map((f) => ({ id: f.id, api_name: f.api_name, required: (REQ[m] || []).includes(f.api_name) }));
    layouts[m] = [{ id: `L-${m}`, name: "Standard", sections: [{ id: `S1-${m}`, fields: fl.slice(0, 2) }, { id: `S2-${m}`, fields: fl.slice(2) }] }];
  }
  const isRequired = (m, id) => layouts[m].some((l) => l.sections.some((sec) => sec.fields.some((f) => f.id === id && f.required)));
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
          if (t.enabled) {
            const bad = perms.find((x) => x.id === t.id).parent_permissions.some((q) => !enabled[id].has(q));
            if (bad) return res(400, { profiles: [{ code: "INVALID_DATA", status: "error", message: "Child permission can not be enabled, since its parent permission is disabled" }] });
            enabled[id].add(t.id);
          } else enabled[id].delete(t.id);
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
    if (method === "GET" && p === "/crm/v8/settings/layouts") return res(200, { layouts: layouts[mod] || [] });
    if (method === "PATCH" && (m = /^\/crm\/v8\/settings\/layouts\/([^/]+)$/.exec(p))) {
      if (body.layouts[0].sections.reduce((n, sec) => n + sec.fields.length, 0) > 5) return res(400, { layouts: [{ code: "LIMIT_EXCEEDED", status: "error" }] });
      const l = layouts[mod].find((x) => x.id === m[1]);
      for (const sec of body.layouts[0].sections) for (const f of sec.fields) l.sections.find((x) => x.id === sec.id).fields.find((x) => x.id === f.id).required = f.required;
      return okItem("layouts", l.id);
    }
    if (method === "GET" && p === "/crm/v8/settings/fields") return res(200, { fields: fields[mod] || [] });
    if (method === "PATCH" && (m = /^\/crm\/v8\/settings\/fields\/([^/]+)$/.exec(p))) {
      const f = fields[mod].find((x) => x.id === m[1]);
      for (const pp of body.fields[0].profiles) {
        if (pp.permission_type !== "read_write" && isRequired(mod, f.id)) return res(400, { fields: [{ code: "INVALID_OPERATION", status: "error", message: "The field permission cannot be changed because it is a mandatory field" }] });
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
  return { call, writes, fields, profiles, enabled, perms, rules, layouts };
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
  const exp = (name) => z.perms.filter((x) => x.name.startsWith("Crm_Implied_Export_")).some((x) => z.enabled[idOf(z, name)].has(x.id));
  for (const p of spec.profiles) assert.equal(exp(p.name), false, `export ${p.name}`);
  assert.equal(exp("Administrator"), true, "Administrator untouched");
});

test("Share (D121 A, D122): on only for IR Manager and DI, only on Contacts/allotments/Touches; nobody else shares", async () => {
  const z = fakeZoho();
  const r = await applySteps(z.call, await planAll(z.call, spec), spec);
  assert.equal(r.ok, true, JSON.stringify(r.log.at(-1)));
  const has = (name, mod, a) => z.enabled[idOf(z, name)].has(z.perms.find((x) => x.name === `Crm_Implied_${a}_${mod}`).id);
  const SHARE = ["Contacts", "LLP_UnitAllocation_Module", "Touches"];
  for (const p of spec.profiles) for (const m of spec.modules) {
    const want = ["IR Manager", "Digital Infrastructure"].includes(p.name) && SHARE.includes(m);
    assert.equal(has(p.name, m, "Share"), want, `share ${p.name} ${m}`);
  }
});

test("D122: no Share Service profile, role, sharing rule or persona is planned; nothing asks for the role by hand", async () => {
  assert.ok(!JSON.stringify(spec).includes("Share Service"));
  assert.ok(!JSON.stringify(spec).includes("share-service"));
  const steps = await planAll(fakeZoho().call, spec);
  assert.equal(steps.filter((s) => s.kind === "manual" && /Share Service/.test(s.what)).length, 0);
});

test("D123 Q2: IR views allotments but every money field on the module is hidden from IR; IR has no Receipts", () => {
  const ir = spec.profiles.find((x) => x.name === "IR");
  assert.equal(ir.modules.LLP_UnitAllocation_Module, "v");
  assert.equal(ir.modules.Receipts, undefined, "IRs never read receipts (D69)");
  const g = spec.fieldSecurity.groups.find((x) => x.id === "allotment_money");
  for (const f of ["Token_Advance_Amount", "Total_Amount_Received", "Total_Amount_Receivable", "Capital_Invested"]) {
    assert.ok(g.fields.LLP_UnitAllocation_Module.includes(f), f);
  }
  assert.equal(g.default, "hidden");
  assert.ok(!("IR" in g.grant));
  // Price and yield: hidden from IR only; every other profile that views allotments keeps them (no regression for KAM, AM Head, Leadership).
  const p = spec.fieldSecurity.groups.find((x) => x.id === "allotment_price_ir");
  assert.deepEqual([...p.fields.LLP_UnitAllocation_Module].sort(), ["Annual_Rental_Yield", "Unit_Price"]);
  assert.equal(p.default, "hidden");
  assert.ok(!("IR" in p.grant));
  for (const prof of spec.profiles.filter((x) => x.name !== "IR" && x.modules.LLP_UnitAllocation_Module)) assert.ok(prof.name in p.grant, prof.name);
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

test("layout-required FLS fields: a not-required PATCH comes before the FLS steps; applying leaves nothing to do", async () => {
  const z = fakeZoho();
  const steps = await planAll(z.call, spec);
  const idx = (f) => steps.findIndex((s) => s.kind === "api" && f(s));
  const lay = steps.filter((s) => s.kind === "api" && s.path.includes("/settings/layouts/"));
  assert.ok(lay.length >= 3 && lay.every((s) => s.method === "PATCH"));
  const fieldsPatched = lay.flatMap((s) => s.body.layouts[0].sections.flatMap((x) => x.fields));
  assert.equal(fieldsPatched.length, 4);
  assert.ok(fieldsPatched.every((f) => f.required === false));
  assert.ok(Math.max(...lay.map((s) => steps.indexOf(s))) < idx((s) => s.path.includes("/settings/fields/")), "layouts before FLS");
  const r = await applySteps(z.call, steps, spec);
  assert.equal(r.ok, true, JSON.stringify(r.log.at(-1)));
  assert.deepEqual(api(await planAll(z.call, spec)), []);
  // without the layout steps Zoho refuses (mirror of the live error)
  const z2 = fakeZoho();
  const noLay = (await planAll(z2.call, spec)).filter((s) => !(s.path || "").includes("/settings/layouts/"));
  const r2 = await applySteps(z2.call, noLay, spec);
  assert.equal(r2.ok, false);
  assert.equal(r2.log.at(-1).code, "INVALID_OPERATION");
});

test("planLayoutRequired: max 5 field actions per call, grouped by section; non-FLS and non-required fields untouched", () => {
  const apis = spec.fieldSecurity.groups.find((g) => g.id === "bank").fields.Contacts; // 8 bank fields, all hidden for most profiles
  const mk = (n, req) => ({ id: `F${n}`, api_name: apis[n] || `Other${n}`, required: req });
  const layouts = { Contacts: [{ id: "L1", name: "Standard", sections: [
    { id: "SA", fields: [0, 1, 2, 3].map((n) => mk(n, true)) }, { id: "SB", fields: [4, 5, 6, 7].map((n) => mk(n, true)).concat([mk(20, true), mk(21, false)]) }] }] };
  const steps = planLayoutRequired(spec, layouts);
  assert.equal(steps.length, 2);
  assert.equal(steps[0].path, "/crm/v8/settings/layouts/L1?module=Contacts");
  assert.deepEqual(steps[0].body, { layouts: [{ sections: [{ id: "SA", fields: [0, 1, 2, 3].map((n) => ({ id: `F${n}`, required: false })) }, { id: "SB", fields: [{ id: "F4", required: false }] }] }] });
  assert.equal(steps[1].body.layouts[0].sections[0].fields.length, 3);
  assert.deepEqual(planLayoutRequired(spec, { Contacts: [{ id: "L1", sections: [{ id: "SA", fields: [mk(0, false)] }] }] }), []);
});

test("parent permissions: a general permission whose Edit stays off is skipped, not sent; enabled orphans are switched off; order View, Create/Edit, rest", () => {
  const prof = { name: "Test P", description: "d", modules: { Leads: "v" } };
  const sp = { ...spec, modules: ["Leads", "Touches"], profiles: [prof],
    general: { mass_update: { prefix: "Mass_Update", on: ["Test P"] }, mass_delete: { prefix: "Mass_Delete", on: ["Test P"] }, export: { prefix: "Export", on: [] } } };
  let n = 0;
  const P = (name, module, label, enabled, parents = []) => ({ id: `id${++n}`, name, module, display_label: label, enabled, parent_permissions: parents });
  const lv = P("Crm_Implied_View_Leads", "Leads", "View", false), le = P("Crm_Implied_Edit_Leads", "Leads", "Edit", false, [lv.id]);
  const lc = P("Crm_Implied_Create_Leads", "Leads", "Create", false, [lv.id]), ld = P("Crm_Implied_Delete_Leads", "Leads", "Delete", false, [lv.id]);
  const lmu = P("Crm_Implied_Mass_Update_Leads", "Leads", "Leads", false, [le.id]);
  const lmd = P("Crm_Implied_Mass_Delete_Leads", "Leads", "Leads", false, [ld.id]);
  // Touches: View/Edit enabled on Standard but the spec gives no access -> all off; its Export child of Edit chain is enabled and must go off first
  const tv = P("Crm_Implied_View_Touches", "Touches", "View", true), te = P("Crm_Implied_Edit_Touches", "Touches", "Edit", true, [tv.id]);
  const tc = P("Crm_Implied_Create_Touches", "Touches", "Create", true, [tv.id]), td = P("Crm_Implied_Delete_Touches", "Touches", "Delete", true, [tv.id]);
  const tmu = P("Crm_Implied_Mass_Update_Touches", "Touches", "Touches", true, [te.id]);
  const tex = P("Crm_Implied_Export_Touches", "Touches", "Touches", true, [tv.id]);
  const details = { permissions_details: [lmu, lmd, le, lc, ld, lv, tmu, td, tc, te, tex, tv] };
  const steps = planProfiles(sp, { profiles: [{ id: "S", display_label: "Standard" }, { id: "T", display_label: "Test P" }], details: { S: details, T: details } });
  const put = steps.find((s) => s.method === "PUT");
  const t = put.body.profiles[0].permissions_details;
  const sent = new Map(t.map((x) => [x.id, x.enabled]));
  assert.equal(sent.get(lv.id), true);
  for (const x of [le, lc, ld, lmu, lmd]) assert.ok(!sent.has(x.id), `${x.name} must not be sent`);
  assert.equal(sent.get(tmu.id), false); // View off removes every Touches child
  assert.equal(sent.get(tex.id), false); // not in the spec's lists, but orphaned by View off: explicit off
  assert.equal(t.filter((x) => x.enabled).length, 1);
  assert.equal(t[0].id, lv.id, "on first");
  const pos = (x) => t.findIndex((y) => y.id === x.id);
  assert.ok(pos(tv) > Math.max(pos(te), pos(tc), pos(td), pos(tmu), pos(tex)), "View off last");
  assert.ok(pos(te) > pos(tmu), "Mass Update off before Edit off");
  assert.match(put.why, /2 skipped/);
  // Edit on makes Mass Update sendable, after Edit
  const ok2 = planProfiles({ ...sp, profiles: [{ ...prof, modules: { Leads: "ve" } }] }, { profiles: [{ id: "S", display_label: "Standard" }, { id: "T", display_label: "Test P" }], details: { S: details, T: details } })
    .find((s) => s.method === "PUT").body.profiles[0].permissions_details.filter((x) => x.enabled).map((x) => x.id);
  assert.deepEqual(ok2, [lv.id, le.id, lmu.id]);
});

test("applySteps retries a busy sharing-rule POST (CANNOT_PROCESS), 10 s apart, 6 times at most; over budget it is retryable", async () => {
  const step = { kind: "api", method: "POST", path: "/crm/v8/settings/data_sharing/rules?module=Leads", body: { sharing_rules: [{}] } };
  const mk = (failFirst) => { let n = 0; return { n: () => n, call: async (m, p) => {
    if (p === "/crm/v8/org") return { status: 200, body: { org: [{ zgid: SANDBOX }] } };
    return ++n <= failFirst ? { status: 400, body: { sharing_rules: [{ code: "CANNOT_PROCESS", status: "error", message: "Sharing rule computation is in process" }] } }
      : { status: 201, body: { sharing_rules: [{ code: "SUCCESS", status: "success" }] } }; } }; };
  let clock = 0; const waits = [];
  const opts = { sleep: async (ms) => { waits.push(ms); clock += ms; }, now: () => clock, budgetMs: 1e9 };
  const a = mk(2); const r = await applySteps(a.call, [step], spec, opts);
  assert.equal(r.ok, true); assert.deepEqual(waits, [10000, 10000]); assert.equal(a.n(), 3);
  waits.length = 0; const b = mk(99); const r2 = await applySteps(b.call, [step], spec, opts);
  assert.equal(r2.ok, false); assert.equal(r2.retryable, undefined); assert.equal(waits.length, 6); assert.equal(b.n(), 7);
  clock = 0; waits.length = 0; const c = mk(99); const r3 = await applySteps(c.call, [step, step], spec, { ...opts, budgetMs: 35000 });
  assert.equal(r3.ok, false); assert.equal(r3.retryable, true); assert.equal(r3.next, 0); assert.equal(waits.length, 3); // 30 s waited, a 4th wait would pass 35 s
  const other = { kind: "api", method: "PATCH", path: "/crm/v8/settings/fields/1?module=Leads", body: {} };
  const d = await applySteps(async (m, p) => (p === "/crm/v8/org" ? { status: 200, body: { org: [{ zgid: SANDBOX }] } } : { status: 400, body: { fields: [{ code: "CANNOT_PROCESS", status: "error", message: "other" }] } }), [other], spec, opts);
  assert.equal(d.ok, false); assert.equal(d.log.length, 1, "non-sharing CANNOT_PROCESS is not retried");
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
  assert.ok(Buffer.byteLength(src) < 32000, `bundle ${Buffer.byteLength(src)} bytes`);
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
