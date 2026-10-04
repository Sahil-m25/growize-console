// Run: node --test zoho/sandbox/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { planSeedFields, picklistGaps } from "./fields-plan.mjs";

const manifest = JSON.parse(readFileSync(new URL("./manifest.json", import.meta.url), "utf8"));
const schema = JSON.parse(readFileSync("/home/claude/work/sandbox-setup/sandbox-schema-2026-10-05.json", "utf8")).modules;
const fields = (m) => (schema[m] ? schema[m].split(",").map((f) => f.replace("*", "").split(":")[0]) : undefined);
const current = Object.fromEntries(Object.keys(schema).map((m) => [m, fields(m)]));
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

test("the manifest uses only api names the sandbox has (no GAP besides Documents)", () => {
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
