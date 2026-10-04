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
