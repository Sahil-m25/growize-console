// Run: node --test zoho/sandbox/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { planSeedFields, picklistGaps, usedFields, planGzFields, planPicklistAdds, GZ_FIELD_DEFS } from "./fields-plan.mjs";

const manifest = JSON.parse(readFileSync(new URL("./manifest.json", import.meta.url), "utf8"));
// The 5 Oct sandbox schema read lives outside the repo (a work folder). Without it (CI, fresh clone) the current fields are derived from
// the manifest itself plus Owner, which keeps the structural tests running; the one test that compares the manifest with the real
// schema is skipped, because against a derived schema it would prove nothing.
const SCHEMA = process.env.GZ_SANDBOX_SCHEMA || "/home/claude/work/sandbox-setup/sandbox-schema-2026-10-05.json";
const HAVE_SCHEMA = existsSync(SCHEMA);
const schema = HAVE_SCHEMA ? JSON.parse(readFileSync(SCHEMA, "utf8")).modules : null;
const fields = (m) => (schema[m] ? schema[m].split(",").map((f) => f.replace("*", "").split(":")[0]) : undefined);
const current = HAVE_SCHEMA ? Object.fromEntries(Object.keys(schema).map((m) => [m, fields(m)]))
  : Object.fromEntries(Object.entries(manifest.records).map(([m, rows]) => [m, ["Owner", ...usedFields(rows)]]));
const PROFILES = [{ id: "p1", name: "Administrator" }, { id: "p2", name: "Standard" }];

test("every seeded module gets Test_Seed (boolean) and Seed_Key (unique text), in one POST per module", () => {
  const { steps } = planSeedFields(manifest, current, { profiles: PROFILES });
  assert.deepEqual(steps.map((s) => s.path), Object.keys(manifest.records).map((m) => `/crm/v8/settings/fields?module=${m}`));
  for (const s of steps) {
    assert.equal(s.method, "POST");
    const [t, k] = s.body.fields;
    assert.deepEqual([t.field_label, t.data_type], ["Test Seed", "boolean"]);
    assert.deepEqual([k.field_label, k.data_type, k.unique], ["Seed Key", "text", { case_sensitive: false }]);
    assert.ok(s.body.fields.length <= 5);
  }
});

test("profiles: Administrator stays read_write, everyone else read_only", () => {
  const { steps } = planSeedFields(manifest, current, { profiles: PROFILES });
  for (const f of steps[0].body.fields) assert.deepEqual(f.profiles, [{ id: "p1", permission_type: "read_write" }, { id: "p2", permission_type: "read_only" }]);
  assert.match(planSeedFields(manifest, current).steps[0].why, /no profiles given/);
});

test("idempotent: once the fields exist, the plan is empty; one missing field gives a one-field step", () => {
  const after = Object.fromEntries(Object.entries(current).map(([m, f]) => [m, [...f, "Test_Seed", "Seed_Key"]]));
  assert.deepEqual(planSeedFields(manifest, after).steps, []);
  const half = { ...after, Leads: [...current.Leads, "Test_Seed"] };
  const { steps } = planSeedFields(manifest, half);
  assert.equal(steps.length, 1);
  assert.deepEqual(steps[0].body.fields.map((f) => f.field_label), ["Seed Key"]);
  assert.match(steps[0].why, /^Leads: create Seed_Key/);
  // object form {api: type} works too
  assert.deepEqual(planSeedFields(manifest, Object.fromEntries(Object.entries(after).map(([m, f]) => [m, Object.fromEntries(f.map((x) => [x, "text"]))]))).steps, []);
});

test("the manifest uses only api names the sandbox has (no GAP besides Documents)", { skip: !HAVE_SCHEMA && "sandbox schema read not on this machine (set GZ_SANDBOX_SCHEMA)" }, () => {
  const { gaps } = planSeedFields(manifest, current);
  assert.deepEqual(gaps.map((g) => g.gap), ["GAP Documents not seeded: no Documents module in the sandbox"]);
});

test("a manifest field the sandbox lacks, or a module it lacks, is a GAP", () => {
  const m = { records: { Leads: [{ Seed_Key: "x", Rung: 1, $persona: { Owner: "ir_a" } }], Nope: [{ Seed_Key: "y" }] } };
  const { gaps, steps } = planSeedFields(m, { Leads: ["Owner"] });
  assert.deepEqual(gaps.map((g) => g.gap), ["GAP Leads.Rung is in the manifest, not in the sandbox", "GAP module Nope is not in the sandbox"]);
  assert.equal(steps.length, 1);
});

test("picklist check names values the sandbox does not offer", () => {
  const gaps = picklistGaps(manifest, { Cases: { Priority: ["High", "Low"], Subject: [] }, Leads: { Lead_Source: ["Events"] } });
  const text = gaps.map((g) => g.gap);
  assert.ok(text.includes('GAP Cases.Priority has no option "Medium"'));
  assert.ok(text.includes('GAP Leads.Lead_Source has no option "Founder network"'));
  assert.ok(!text.some((t) => t.includes('"High"') || t.includes('"Events"')));
});

test("8-9 Oct 2026 fields: one POST per module, shapes as created, idempotent once they exist", () => {
  const cur = { Leads: ["Owner"], Cases: ["Owner"], Touches: ["Owner"], Receipts: ["Owner"] };
  const { steps, gaps } = planGzFields(cur);
  assert.deepEqual(gaps, []);
  assert.deepEqual(steps.map((s) => s.path), ["Leads", "Cases", "Touches", "Receipts"].map((m) => `/crm/v8/settings/fields?module=${m}`));
  const by = Object.fromEntries(steps.map((s) => [s.path.split("=")[1], s.body.fields]));
  assert.deepEqual(by.Leads.map((f) => [f.field_label, f.data_type]), [["Rung Undone At", "datetime"], ["Engagement Skipped", "boolean"]]);
  assert.deepEqual(by.Cases.map((f) => [f.field_label, f.data_type]), [["Handed By", "userlookup"], ["Handed At", "datetime"]]);
  assert.deepEqual(by.Touches.map((f) => [f.field_label, f.data_type]), [["Voided At", "datetime"]]);
  assert.deepEqual(by.Receipts, [{ field_label: "Idempotency Key", data_type: "text", length: 120, unique: { case_sensitive: false } }]);
  // Zoho derives api_name from the label
  for (const d of GZ_FIELD_DEFS) for (const f of d.fields) assert.equal(f.field.field_label.replace(/ /g, "_"), f.api);
  // Receipts also holds Seed_Key (unique): together still within Zoho's 2 unique fields per module
  assert.ok(GZ_FIELD_DEFS.flatMap((d) => d.fields).filter((f) => f.field.unique).length + 1 <= 2);
  const after = Object.fromEntries(Object.entries(cur).map(([m, f]) => [m, f.concat(GZ_FIELD_DEFS.find((d) => d.module === m).fields.map((x) => x.api))]));
  assert.deepEqual(planGzFields(after).steps, []);
  const half = { ...after, Cases: ["Owner", "Handed_By"] };
  assert.deepEqual(planGzFields(half).steps.map((s) => s.why), ["Cases: create Handed_At"]);
  assert.equal(planGzFields({}).gaps.length, 4);
  assert.deepEqual(planGzFields(cur, { profiles: PROFILES }).steps[0].body.fields[0].profiles.map((p) => p.permission_type), ["read_write", "read_write"]);
});

test("Leads.Consent_How gains 'Call' once; nothing to do when it is there", () => {
  const meta = { Leads: { Consent_How: { id: "F1", values: ["Email", "WhatsApp"] } } };
  const { steps } = planPicklistAdds(meta);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].path, "/crm/v8/settings/fields/F1?module=Leads");
  assert.deepEqual(steps[0].body.fields[0].pick_list_values.map((v) => v.actual_value), ["Email", "WhatsApp", "Call"]);
  assert.deepEqual(planPicklistAdds({ Leads: { Consent_How: { id: "F1", values: ["Email", "Call"] } } }).steps, []);
  assert.equal(planPicklistAdds({}).gaps.length, 1);
});
