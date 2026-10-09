// Field prerequisites for the seed (pure; no I/O). planSeedFields(manifest, currentFieldsByModule, {profiles}) → { steps, gaps }.
// currentFieldsByModule: { Module: ["Api_Name", ...] | { Api_Name: type } } as read from GET /crm/v8/settings/fields?module=X.
// Create-field shape, verified 5 Oct 2026: https://www.zoho.com/crm/developer/docs/api/v8/create-custom-field.html
//   POST /crm/v8/settings/fields?module=X  body { fields: [ {field_label, data_type, length (text, 1-255), unique: {case_sensitive:false}, profiles: [{id, permission_type: read_write|read_only|hidden}]} ] }
//   max 5 fields per call; max 2 unique fields per module; response fields[].code "SUCCESS", details.id.
//   api_name cannot be sent: Zoho derives it from field_label, so "Test Seed" → Test_Seed and "Seed Key" → Seed_Key.
// Profiles: Administrator keeps read_write (the seed writes the fields through an admin session), every other profile read_only.
//   `profiles` is [{id, name}] from GET /crm/v8/settings/profiles; without it the step carries no profiles (all read_write) and says so in `why`.

const SPECIAL = new Set(["Seed_Key", "Test_Seed", "$persona", "$refs"]);
const names = (cur) => new Set(Array.isArray(cur) ? cur : Object.keys(cur ?? {}));

export const SEED_FIELD_DEFS = [
  { api: "Test_Seed", field: { field_label: "Test Seed", data_type: "boolean" } },
  { api: "Seed_Key", field: { field_label: "Seed Key", data_type: "text", length: 100, unique: { case_sensitive: false } } },
];

/** Field names a module's rows use, with the refs' parent modules and persona fields (which are user lookups on the module). */
export function usedFields(rows) {
  const used = new Set();
  for (const r of rows) {
    for (const k of Object.keys(r)) if (!SPECIAL.has(k)) used.add(k);
    for (const k of Object.keys(r.$persona ?? {})) used.add(k);
    for (const k of Object.keys(r.$refs ?? {})) used.add(k);
  }
  return used;
}

export function planSeedFields(manifest, currentFieldsByModule, { profiles } = {}) {
  const steps = [], gaps = [];
  for (const [module, rows] of Object.entries(manifest.records)) {
    const cur = currentFieldsByModule[module];
    if (!cur) { gaps.push({ module, gap: `GAP module ${module} is not in the sandbox` }); continue; }
    const have = names(cur);
    const make = SEED_FIELD_DEFS.filter((d) => !have.has(d.api)).map((d) => ({
      ...d.field,
      ...(profiles ? { profiles: profiles.map((p) => ({ id: p.id, permission_type: p.name === "Administrator" ? "read_write" : "read_only" })) } : {}),
    }));
    if (make.length) steps.push({ method: "POST", path: `/crm/v8/settings/fields?module=${module}`, body: { fields: make }, why: `${module}: create ${SEED_FIELD_DEFS.filter((d) => !have.has(d.api)).map((d) => d.api).join(" + ")}${profiles ? "" : " (no profiles given: all read_write)"}` });
    for (const f of [...usedFields(rows)].filter((f) => !have.has(f))) gaps.push({ module, field: f, gap: `GAP ${module}.${f} is in the manifest, not in the sandbox` });
  }
  for (const [module, d] of Object.entries(manifest.deferred ?? {})) gaps.push({ module, gap: `GAP ${module} not seeded: ${d.reason}` });
  return { steps, gaps };
}

/** Manifest picklist values the sandbox does not offer. metaByModule: { Module: { Api_Name: ["actual value", ...] } } for picklist fields only. Plain strings only (stamps and ids are not picklists). */
export function picklistGaps(manifest, metaByModule) {
  const gaps = [];
  for (const [module, rows] of Object.entries(manifest.records)) {
    const meta = metaByModule[module] ?? {};
    const seen = new Set();
    for (const r of rows) for (const [f, v] of Object.entries(r)) {
      if (!meta[f] || typeof v !== "string" || meta[f].includes(v) || seen.has(f + "\u0000" + v)) continue;
      seen.add(f + "\u0000" + v);
      gaps.push({ module, field: f, gap: `GAP ${module}.${f} has no option "${v}"` });
    }
  }
  return gaps;
}

// ---- Fields added to the sandbox by API on 8-9 Oct 2026 (Growize Staging, zgid 60090668120), captured as code -----------------
// Same create shape as above. UNVERIFIED (the original calls were not recorded): `userlookup` data_type shape, and that Zoho keeps the
// picklist values already on the field when PATCH sends them again with the new one. The per-profile field permission each field was
// created with is also not recorded: with no `profiles` given the step leaves Zoho's default (read_write for every profile), which the
// console needs for the writers (IR, KAM, Finance). Tighten per field in zoho/access/spec.json when the owner rules (CARRY-FORWARD).
export const GZ_FIELD_DEFS = [
  { module: "Leads", fields: [
    { api: "Rung_Undone_At", field: { field_label: "Rung Undone At", data_type: "datetime" } },
    { api: "Engagement_Skipped", field: { field_label: "Engagement Skipped", data_type: "boolean" } },
  ] },
  { module: "Cases", fields: [
    { api: "Handed_By", field: { field_label: "Handed By", data_type: "userlookup" } },
    { api: "Handed_At", field: { field_label: "Handed At", data_type: "datetime" } },
  ] },
  { module: "Touches", fields: [{ api: "Voided_At", field: { field_label: "Voided At", data_type: "datetime" } }] },
  { module: "Receipts", fields: [{ api: "Idempotency_Key", field: { field_label: "Idempotency Key", data_type: "text", length: 120, unique: { case_sensitive: false } } }] },
];

export const GZ_PICKLIST_ADDS = [{ module: "Leads", api: "Consent_How", add: ["Call"] }];

/** One POST per module for the fields it lacks (<= 5 per call). current: { Module: ["Api" ...] | { Api: type } }. A module the sandbox lacks is a gap. */
export function planGzFields(current, { profiles, defs = GZ_FIELD_DEFS } = {}) {
  const steps = [], gaps = [];
  for (const d of defs) {
    const cur = current[d.module];
    if (!cur) { gaps.push({ module: d.module, gap: `GAP module ${d.module} is not in the sandbox` }); continue; }
    const have = names(cur), make = d.fields.filter((f) => !have.has(f.api));
    for (let i = 0; i < make.length; i += 5) {
      const chunk = make.slice(i, i + 5);
      steps.push({ method: "POST", path: `/crm/v8/settings/fields?module=${d.module}`,
        body: { fields: chunk.map((f) => ({ ...f.field, ...(profiles ? { profiles: profiles.map((p) => ({ id: p.id, permission_type: "read_write" })) } : {}) })) },
        why: `${d.module}: create ${chunk.map((f) => f.api).join(" + ")}` });
    }
  }
  return { steps, gaps };
}

/** meta: { Module: { Api: { id, values: ["actual value", ...] } } } for the picklist fields. Adds only the values the field lacks. */
export function planPicklistAdds(meta, adds = GZ_PICKLIST_ADDS) {
  const steps = [], gaps = [];
  for (const a of adds) {
    const f = (meta[a.module] ?? {})[a.api];
    if (!f) { gaps.push({ module: a.module, field: a.api, gap: `GAP ${a.module}.${a.api} is not in the sandbox` }); continue; }
    const lack = a.add.filter((v) => !f.values.includes(v));
    if (!lack.length) continue;
    const pv = f.values.concat(lack).map((v) => ({ display_value: v, actual_value: v }));
    steps.push({ method: "PATCH", path: `/crm/v8/settings/fields/${f.id}?module=${a.module}`, body: { fields: [{ id: f.id, pick_list_values: pv }] }, why: `${a.module}.${a.api}: add option ${lack.map((v) => `"${v}"`).join(", ")}` });
  }
  return { steps, gaps };
}
