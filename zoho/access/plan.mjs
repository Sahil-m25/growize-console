// Sandbox access configuration (D120 draft): profiles, field-level security, sharing rules from zoho/access/spec.json.
// No imports: build-bundle.mjs inlines this file into a browser IIFE (ES2020). The pure planners take current Zoho state
// and return ordered, idempotent steps { kind: "api", method, path, body, why } | { kind: "manual", where, what, why }.
// The orchestration at the bottom takes an injected call(method, path, body) -> Promise<{ status, body }> (window.__z).
// Logs carry statuses and Zoho codes only, never record values; nothing here reads a record (settings endpoints only).
//
// Zoho CRM v8 shapes relied on (WebFetch, 5 Oct 2026):
//  GET  /crm/v8/org -> { org: [{ zgid }] }                       https://www.zoho.com/crm/developer/docs/api/v8/get-org-data.html
//  GET  /crm/v8/settings/profiles[/{id}] -> { profiles: [{ id, display_label, permissions_details: [{ id, name, module, display_label, enabled }] }] }
//                                                                 https://www.zoho.com/crm/developer/docs/api/v8/get-profiles.html
//  POST /crm/v8/settings/profiles/{id}/actions/clone { profiles: [{ name (<=50), description (<=250) }] } -> details.id
//                                                                 https://www.zoho.com/crm/developer/docs/api/v8/create-profile.html
//  PUT  /crm/v8/settings/profiles/{id} { profiles: [{ permissions_details: [{ id, enabled }] }] }  (one profile per call)
//                                                                 https://www.zoho.com/crm/developer/docs/api/v8/update-profile-permission.html
//  GET  /crm/v8/settings/fields?module=X -> { fields: [{ id, api_name, profiles: [{ id, name, permission_type }] }] }
//                                                                 https://www.zoho.com/crm/developer/docs/api/v8/field-meta.html
//  PATCH /crm/v8/settings/fields/{id}?module=X { fields: [{ id, profiles: [{ id, permission_type }] }] }; unlisted profiles unchanged
//                                                                 https://www.zoho.com/crm/developer/docs/api/v8/update-custom-fields.html
//  GET  /crm/v8/settings/layouts?module=X; PATCH /crm/v8/settings/layouts/{id}?module=X { layouts: [{ sections: [{ id, fields: [{ id, required }] }] }] }
//                                                                 https://www.zoho.com/crm/developer/docs/api/v8/update-custom-layout.html
//  GET/POST/PUT /crm/v8/settings/data_sharing/rules?module=X { sharing_rules: [{ name, type, shared_from, shared_to, permission_type, superiors_allowed }] }
//                                                                 https://www.zoho.com/crm/developer/docs/api/v8/create-data-sharing-rules.html
//                                                                 https://prezohoweb.zoho.com/crm/developer/docs/api/v8/data-sharing-rules.html
//  GET  /crm/v8/settings/roles -> { roles: [{ id, name, display_label }] }  https://www.zoho.com/crm/developer/docs/api/v8/get-roles.html
//  GET  /crm/v8/settings/data_sharing -> { data_sharing: [{ module: { api_name }, share_type }] }
//       UNVERIFIED on zoho.com (page 404); shape from https://help.zoho.com/portal/en/community/topic/kaizen-252-data-sharing-rules-api
//       and share_type values ("private" | "public_read_only" | ...) from a third-party mirror.
// UNVERIFIED: (a) permission ids are org-wide, so a fresh clone of Standard can be diffed with Standard's ids (if not, the PUT
// fails INVALID_DATA, apply stops, and the next plan() reads the real clone); (b) permissions_details.module is the module
// api_name for custom modules; (c) general permissions (export, mass update/delete, import) appear in permissions_details with
// those display labels - when not found the planner emits a manual step; (d) data sharing rules accept custom modules.

export const V = "/crm/v8";
const ACTIONS = { v: "View", c: "Create", e: "Edit", d: "Delete" };
const ORDER = ["v", "c", "e", "d"];
const PROFILES_PATH = "Setup > Users and Control > Security Control > Profiles";

// Rule 7 and ACCESS-PLAN §3 walls, checked on every plan: a spec that breaks them is refused before any step exists.
export const WALL = {
  bankReaders: ["Finance Head", "Finance Ops", "Digital Infrastructure"], // DI: D110 logged reveals (PROVISIONAL P2)
  identityNever: ["IR", "IR Manager", "Channel Partner", "Integration", "KAM", "Viewer", "Leadership", "AM Head", "Finance Ops"],
  aadhaarFullReaders: [],
  moneyModules: ["Receipts", "Investor_Payouts"],
};

export const ph = (name) => `{{profile:${name}}}`;
const nameOf = (p) => p.display_label || p.name;
const modOf = (p) => (p.module && typeof p.module === "object" ? p.module.api_name : p.module);

export function assertSandbox(orgBody, spec) {
  const zgid = String((orgBody && orgBody.org && orgBody.org[0] && orgBody.org[0].zgid) || "");
  if (zgid !== spec.org.sandboxZgid) {
    throw new Error(zgid === spec.org.liveZgid ? "refused: this is the LIVE org" : "refused: not the Growize sandbox org");
  }
}

export function assertWall(spec) {
  for (const g of spec.fieldSecurity.groups) {
    const reads = (p) => ((g.grant[p.name] || g.default) !== "hidden");
    for (const p of spec.profiles) {
      if (g.id === "bank" && reads(p) && !WALL.bankReaders.includes(p.name)) throw new Error(`wall: ${p.name} would read bank fields`);
      if (g.id === "identity" && reads(p) && WALL.identityNever.includes(p.name)) throw new Error(`wall: ${p.name} would read identity fields`);
      if (g.id === "aadhaar_full" && reads(p) && !WALL.aadhaarFullReaders.includes(p.name)) throw new Error(`wall: ${p.name} would read Aadhaar_Number`);
    }
  }
  const g = (id) => spec.fieldSecurity.groups.find((x) => x.id === id);
  for (const id of ["bank", "identity", "aadhaar_full"]) if (!g(id) || g(id).default !== "hidden") throw new Error(`wall: group ${id} must default to hidden`);
}

const findPerm = (details, module, action) =>
  (details.permissions_details || []).find((p) => (modOf(p) === module && String(p.display_label).toLowerCase() === action.toLowerCase()) || p.name === `Crm_Implied_${action}_${module}`);

/** Module letters ("vce") a profile detail actually has, or null per action when the permission is not exposed. */
export function actualModulePerms(details, module) {
  let s = "";
  for (const k of ORDER) {
    const p = findPerm(details, module, ACTIONS[k]);
    if (!p) return null;
    if (p.enabled) s += k;
  }
  return s;
}

/**
 * current = { profiles: [{ id, display_label|name }], details: { [profileId]: { permissions_details } } }.
 * New profiles are cloned from spec.cloneFrom; their permission diff is computed against the clone source, addressed by placeholder.
 */
export function planProfiles(spec, current) {
  const byName = new Map(current.profiles.map((p) => [nameOf(p), p]));
  const base = byName.get(spec.cloneFrom);
  if (!base) throw new Error(`profile ${spec.cloneFrom} not found`);
  const steps = [], updates = [], manual = [];
  for (const prof of spec.profiles) {
    const have = byName.get(prof.name);
    if (!have) {
      steps.push({ kind: "api", method: "POST", path: `${V}/settings/profiles/${base.id}/actions/clone`,
        body: { profiles: [{ name: prof.name, description: prof.description.slice(0, 250) }] }, creates: prof.name,
        why: `create profile ${prof.name} (clone of ${spec.cloneFrom}; ACCESS-PLAN §1)` });
    }
    const details = current.details[have ? have.id : base.id];
    if (!details) throw new Error(`profile detail missing for ${have ? prof.name : spec.cloneFrom}`);
    const on = [], off = [], missing = [], rank = new Map();
    for (const module of spec.modules) {
      const want = prof.modules[module] || "";
      for (const k of ORDER) {
        const p = findPerm(details, module, ACTIONS[k]);
        if (!p) { missing.push(`${module} ${ACTIONS[k]}=${want.includes(k) ? "on" : "off"}`); continue; }
        rank.set(p.id, k === "v" ? 0 : k === "d" ? 2 : 1);
        const desired = want.includes(k);
        if (!!p.enabled !== desired) (desired ? on : off).push({ id: p.id, enabled: desired });
      }
    }
    for (const [key, g] of Object.entries(spec.general)) {
      if (key === "_") continue;
      const holder = g.on.includes(prof.name);
      // Live 5 Oct probe: these are per-module permissions named Crm_Implied_<Prefix>_<Module>; match by name prefix.
      const re = g.label ? new RegExp(g.label, "i") : null;
      const hits = (details.permissions_details || []).filter((p) => g.prefix
        ? String(p.name).startsWith(`Crm_Implied_${g.prefix}_`)
        : re.test(String(p.display_label)) && !ACTIONS_SET.has(String(p.display_label)));
      if (!hits.length) { missing.push(`${key}=${holder ? "on" : "off"}`); continue; }
      // g.modules (D121 A Share): on only for these modules; every other module's permission of this kind stays off.
      const inScope = (p) => !g.modules || g.modules.includes(g.prefix ? String(p.name).slice(`Crm_Implied_${g.prefix}_`.length) : modOf(p));
      for (const p of hits) { const desired = holder && inScope(p); if (!!p.enabled !== desired) (desired ? on : off).push({ id: p.id, enabled: desired }); }
    }
    // Live 5 Oct: Zoho refuses a child permission whose parent is disabled. Final set = enabled + on - off; drop any id whose
    // parent_permissions are not all in it (iteratively); "on" toggles outside it are skipped; enabled ones that fall out get an "off".
    const perms = details.permissions_details || [];
    const known = new Set(perms.map((p) => p.id));
    const fin = new Set(perms.filter((p) => p.enabled).map((p) => p.id));
    for (const t of on) fin.add(t.id);
    for (const t of off) fin.delete(t.id);
    for (let again = true; again;) {
      again = false;
      for (const p of perms) {
        if (fin.has(p.id) && (p.parent_permissions || []).some((q) => known.has(q) && !fin.has(q))) { fin.delete(p.id); again = true; }
      }
    }
    const rk = (id) => (rank.has(id) ? rank.get(id) : 2);
    const onOk = on.filter((t) => fin.has(t.id)), skipped = on.length - onOk.length;
    const offIds = new Set(off.map((t) => t.id));
    for (const p of perms) if (p.enabled && !fin.has(p.id) && !offIds.has(p.id)) off.push({ id: p.id, enabled: false });
    // On: View, then Create/Edit, then the rest (Delete, general). Off: the reverse.
    onOk.sort((a, b) => rk(a.id) - rk(b.id)); off.sort((a, b) => rk(b.id) - rk(a.id));
    const toggles = onOk.concat(off).map(({ id, enabled }) => ({ id, enabled }));
    if (toggles.length) {
      updates.push({ kind: "api", method: "PUT", path: `${V}/settings/profiles/${have ? have.id : ph(prof.name)}`,
        body: { profiles: [{ permissions_details: toggles }] }, why: `${prof.name}: ${toggles.length} permission change(s)${skipped ? `, ${skipped} skipped (parent permission stays off)` : ""} (ACCESS-PLAN §1-§2, spec)` });
    }
    if (missing.length) {
      manual.push({ kind: "manual", where: `${PROFILES_PATH} > ${prof.name} > Module-level / Tools permissions`,
        what: `set ${missing.join("; ")}`, why: `${prof.name}: permission not exposed in permissions_details` });
    }
  }
  return steps.concat(updates, manual);
}
const ACTIONS_SET = new Set(Object.values(ACTIONS));

/**
 * Live 5 Oct: Zoho refuses field-level security on a layout-required field ("The field permission cannot be changed because it is a
 * mandatory field"). For every FLS field the spec hides or makes read_only for any profile, and which is required in any layout
 * section, step PATCH layouts/{id} required:false (merge semantics; <= 5 field actions per call). Runs before the FLS steps.
 * layoutsByModule = { [module]: [{ id, sections: [{ id, fields: [{ id, api_name, required }] }] }] }.
 */
export function planLayoutRequired(spec, layoutsByModule) {
  const lock = new Set();
  for (const g of spec.fieldSecurity.groups) {
    const restricted = spec.profiles.some((p) => ["hidden", "read_only"].includes(g.grant[p.name] || g.default));
    if (restricted) for (const [m, apis] of Object.entries(g.fields)) for (const a of apis) lock.add(`${m}.${a}`);
  }
  const steps = [];
  for (const [module, layouts] of Object.entries(layoutsByModule || {})) {
    for (const l of layouts || []) {
      const acts = [];
      for (const sec of l.sections || []) for (const f of sec.fields || []) {
        if (f.required === true && lock.has(`${module}.${f.api_name}`)) acts.push({ sec: sec.id, id: f.id, api: f.api_name });
      }
      for (let i = 0; i < acts.length; i += 5) {
        const chunk = acts.slice(i, i + 5), sections = [];
        for (const a of chunk) {
          let s = sections.find((x) => x.id === a.sec);
          if (!s) sections.push(s = { id: a.sec, fields: [] });
          s.fields.push({ id: a.id, required: false });
        }
        steps.push({ kind: "api", method: "PATCH", path: `${V}/settings/layouts/${l.id}?module=${module}`, body: { layouts: [{ sections }] },
          why: `layout ${module}${l.name ? ` "${l.name}"` : ""}: ${chunk.map((a) => a.api).join(", ")} not required so field security can apply (owner confirms before live)` });
      }
    }
  }
  return steps;
}

/** currentFields = { [module]: fields[] }; profileIdsByName must include spec.cloneFrom. */
export function planFieldSecurity(spec, currentFields, profileIdsByName) {
  assertWall(spec);
  const baseId = profileIdsByName[spec.cloneFrom];
  if (!baseId) throw new Error(`profile ${spec.cloneFrom} not found`);
  const steps = [];
  for (const g of spec.fieldSecurity.groups) {
    for (const [module, apis] of Object.entries(g.fields)) {
      for (const api of apis) {
        const f = (currentFields[module] || []).find((x) => x.api_name === api);
        if (!f) { steps.push({ kind: "manual", where: `Setup > Customization > Modules and Fields > ${module}`, what: `field ${api} not found - create it hidden, then re-plan`, why: `FLS group ${g.id}` }); continue; }
        const has = (id) => ((f.profiles || []).find((p) => p.id === id) || {}).permission_type;
        const profiles = [];
        for (const prof of spec.profiles) {
          const want = g.grant[prof.name] || g.default;
          const id = profileIdsByName[prof.name];
          const now = id ? has(id) : has(baseId);
          if (now !== want) profiles.push({ id: id || ph(prof.name), permission_type: want });
        }
        if (profiles.length) {
          steps.push({ kind: "api", method: "PATCH", path: `${V}/settings/fields/${f.id}?module=${module}`,
            body: { fields: [{ id: f.id, profiles }] }, why: `FLS ${module}.${api} for ${profiles.length} profile(s) (group ${g.id}; ${g.source})` });
        }
      }
    }
  }
  return steps;
}

/**
 * Module visibility (8-9 Oct 2026: Tasks, Calls, Events user_hidden -> visible). modulesMeta = GET /settings/modules -> modules[]
 * { api_name, status }. The update call is UNVERIFIED (not recorded), so a hidden module is a manual step, never a guessed write.
 */
export function planModuleVisibility(spec, modulesMeta) {
  const v = spec.moduleVisibility;
  if (!v) return [];
  if (!modulesMeta) return [{ kind: "manual", where: "Setup > Customization > Modules and Fields", what: `check by eye that ${v.visible.join(", ")} are shown (GET modules failed)`, why: "module visibility" }];
  return v.visible.filter((m) => ((modulesMeta.find((x) => x.api_name === m) || {}).status || "missing") !== "visible").map((m) => ({
    kind: "manual", where: "Setup > Customization > Modules and Fields > show the module", what: `${m}: set visible (now ${(modulesMeta.find((x) => x.api_name === m) || {}).status || "missing"})`, why: "module visibility (8-9 Oct 2026 sandbox change)" }));
}

const SHORT = { LLP_UnitAllocation_Module: "Allotments", Investor_Payouts: "Payouts" };
export const ruleName = (r) => `GZ ${SHORT[r.module] || r.module} - ${r.to}`;

/** currentRules = { [module]: sharing_rules[] }; roleIds = { roleName: id }. */
export function planSharing(spec, currentRules, roleIds) {
  const from = roleIds[spec.sharingRules.fromRole];
  if (!from) throw new Error(`role ${spec.sharingRules.fromRole} not found`);
  const steps = [];
  for (const r of spec.sharingRules.rules) {
    const to = roleIds[r.to];
    if (!to && r.roleManual) {
      steps.push({ kind: "manual", rule: ruleName(r), where: "Setup > Users and Control > Security Control > Roles", what: `create role "${r.to}" reporting to ${spec.sharingRules.fromRole}, no subordinates, then re-plan`, why: `${r.module}: sharing rule for ${r.to} needs the role (D121 A)` });
      continue;
    }
    if (!to) throw new Error(`role ${r.to} not found`);
    const want = { name: ruleName(r), type: "Record_Owner_Based", superiors_allowed: false,
      shared_from: { resource: { id: from }, type: "roles", subordinates: true },
      shared_to: { resource: { id: to }, type: "roles", subordinates: false }, permission_type: r.permission };
    const same = (x) => x.type === want.type && x.permission_type === want.permission_type && !!x.superiors_allowed === false &&
      x.shared_to && x.shared_to.type === "roles" && x.shared_to.resource && x.shared_to.resource.id === to && !x.shared_to.subordinates &&
      x.shared_from && x.shared_from.resource && x.shared_from.resource.id === from && !!x.shared_from.subordinates;
    const rules = currentRules[r.module] || [];
    if (rules.some(same)) continue;
    const named = rules.find((x) => x.name === want.name);
    const why = `${r.module}: ${r.to} gets ${r.permission} on every record (${r.source || `ACCESS-PLAN §2, D80${r.provisional ? "; PROVISIONAL P10" : ""}`})`;
    steps.push(named
      ? { kind: "api", method: "PUT", path: `${V}/settings/data_sharing/rules?module=${r.module}`, body: { sharing_rules: [Object.assign({ id: named.id }, want)] }, why: `update ${why}` }
      : { kind: "api", method: "POST", path: `${V}/settings/data_sharing/rules?module=${r.module}`, body: { sharing_rules: [want] }, why });
  }
  return steps;
}

/** Verify only (D80 set these): a mismatch becomes a manual step. dataSharing = data_sharing[]. */
export function planDefaultSharing(spec, dataSharing) {
  const steps = [];
  for (const [type, modules] of Object.entries(spec.defaultSharing)) {
    if (type === "_") continue;
    for (const m of modules) {
      const row = (dataSharing || []).find((x) => modOf(x) === m);
      const actual = row ? row.share_type : "missing";
      if (actual !== type) steps.push({ kind: "manual", where: "Setup > Users and Control > Security Control > Data Sharing Settings", what: `${m}: set ${type} (now ${actual})`, why: "D80 default sharing" });
    }
  }
  return steps;
}

// ---- orchestration over an injected call ------------------------------------------------------------------------------

const ok = (r) => r && r.status >= 200 && r.status < 300;
async function get(call, path) {
  const r = await call("GET", path);
  if (r && r.status === 204) return {};
  if (!ok(r)) throw new Error(`GET ${path.split("?")[0]} -> ${r && r.status} ${zcode(r && r.body)}`);
  return r.body || {};
}
function zcode(body) {
  if (!body) return "";
  const k = Object.keys(body).find((x) => Array.isArray(body[x]));
  const item = k ? body[k][0] : body;
  return item && item.code ? String(item.code) : "";
}
function zfailed(body) {
  const k = body && Object.keys(body).find((x) => Array.isArray(body[x]));
  return !!(k && body[k].some((x) => x && x.status === "error"));
}

export async function readState(call, spec) {
  assertSandbox(await get(call, `${V}/org`), spec);
  const profiles = (await get(call, `${V}/settings/profiles`)).profiles || [];
  const wanted = new Set(spec.profiles.map((p) => p.name).concat(spec.cloneFrom));
  const details = {}, profileIdsByName = {};
  for (const p of profiles) {
    if (!wanted.has(nameOf(p))) continue;
    profileIdsByName[nameOf(p)] = p.id;
    details[p.id] = ((await get(call, `${V}/settings/profiles/${p.id}`)).profiles || [])[0] || {};
  }
  const roleIds = {};
  for (const r of (await get(call, `${V}/settings/roles`)).roles || []) roleIds[r.display_label || r.name] = r.id;
  const fieldModules = new Set();
  for (const g of spec.fieldSecurity.groups) for (const m of Object.keys(g.fields)) fieldModules.add(m);
  const fields = {};
  for (const m of fieldModules) fields[m] = (await get(call, `${V}/settings/fields?module=${m}`)).fields || [];
  const layouts = {};
  for (const m of fieldModules) layouts[m] = (await get(call, `${V}/settings/layouts?module=${m}`)).layouts || [];
  const rules = {};
  for (const m of new Set(spec.sharingRules.rules.map((r) => r.module))) rules[m] = (await get(call, `${V}/settings/data_sharing/rules?module=${m}`)).sharing_rules || [];
  let dataSharing = null;
  try { dataSharing = (await get(call, `${V}/settings/data_sharing`)).data_sharing || []; } catch (e) { dataSharing = null; }
  let modulesMeta = null;
  try { modulesMeta = (await get(call, `${V}/settings/modules`)).modules || []; } catch (e) { modulesMeta = null; }
  return { profiles, details, profileIdsByName, roleIds, fields, layouts, rules, dataSharing, modulesMeta };
}

export function planFromState(spec, s) {
  return [].concat(
    planModuleVisibility(spec, s.modulesMeta),
    planProfiles(spec, { profiles: s.profiles, details: s.details }),
    planLayoutRequired(spec, s.layouts),
    planFieldSecurity(spec, s.fields, s.profileIdsByName),
    planSharing(spec, s.rules, s.roleIds),
    s.dataSharing ? planDefaultSharing(spec, s.dataSharing)
      : [{ kind: "manual", where: "Setup > Users and Control > Security Control > Data Sharing Settings", what: "check defaults by eye (GET data_sharing failed)", why: "D80 default sharing" }],
    (spec.personas.sandbox || []).map((p) => ({ kind: "manual", where: "Setup > Users and Control > Users > Add User", what: `test user "${p.label}": role ${p.role}, profile ${p.profile}`, why: "sandbox persona (licence-bound, not done by code)" })),
  );
}

export async function planAll(call, spec) {
  return planFromState(spec, await readState(call, spec));
}

function zmsg(body) {
  const k = body && Object.keys(body).find((x) => Array.isArray(body[x]));
  const item = k ? body[k][0] : body;
  return item && item.message ? String(item.message) : "";
}
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Runs api steps in order, stops at the first non-2xx or per-item error. Log: statuses and Zoho codes only.
 * Sharing-rule POSTs hit CANNOT_PROCESS "Sharing rule computation is in process" when posted back to back: such a step is retried
 * up to 6 times, 10 s apart. One browser call must stay well under 45 s, so when the next wait (or the next step) would pass
 * opts.budgetMs (35 s) it returns { ok:false, retryable:true, next:i }: re-plan (idempotent) and apply again.
 * opts = { sleep, now, budgetMs, retries, waitMs } (tests inject them).
 */
export async function applySteps(call, steps, spec, opts = {}) {
  const sleep = opts.sleep || sleepMs, now = opts.now || Date.now, budget = opts.budgetMs || 35000, retries = opts.retries || 6, wait = opts.waitMs || 10000;
  const t0 = now();
  assertSandbox(await get(call, `${V}/org`), spec);
  let ids = null;
  const resolve = async (text, force) => {
    if (text.indexOf("{{profile:") < 0) return text;
    if (!ids || force) { ids = {}; for (const p of (await get(call, `${V}/settings/profiles`)).profiles || []) ids[nameOf(p)] = p.id; }
    return text.replace(/\{\{profile:([^}]+)\}\}/g, (m, n) => { if (!ids[n]) throw new Error(`profile ${n} not created yet`); return ids[n]; });
  };
  const log = [], manual = [];
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (s.kind !== "api") { manual.push(s); log.push({ i, kind: "manual", where: s.where }); continue; }
    if (now() - t0 > budget) return { ok: false, retryable: true, next: i, log, manual };
    let path, body;
    try {
      path = await resolve(s.path);
      body = s.body ? JSON.parse(await resolve(JSON.stringify(s.body))) : undefined;
    } catch (e) {
      log.push({ i, method: s.method, path: s.path.split("?")[0], status: 0, code: "UNRESOLVED", message: e.message });
      return { ok: false, log, manual };
    }
    let r;
    for (let tries = 0; ; tries++) {
      r = await call(s.method, path, body);
      const code = zcode(r && r.body);
      const busy = !ok(r) || zfailed(r && r.body) ? code === "CANNOT_PROCESS" && (/computation/i.test(zmsg(r && r.body)) || path.indexOf("/data_sharing/rules") >= 0) : false;
      log.push({ i, method: s.method, path: path.split("?")[0], status: r && r.status, code });
      if (!busy) break;
      if (tries >= retries) return { ok: false, log, manual };
      if (now() - t0 + wait > budget) return { ok: false, retryable: true, next: i, log, manual };
      await sleep(wait);
    }
    if (!ok(r) || zfailed(r.body)) return { ok: false, log, manual };
    if (s.creates) ids = null; // a new profile id exists now
  }
  return { ok: true, log, manual };
}

/** Pass/fail table of spec vs actual: profile names, module perms, FLS, sharing rules, defaults. Settings only. */
export async function verifyAll(call, spec) {
  const s = await readState(call, spec);
  const rows = [];
  const row = (area, item, expected, actual) => rows.push({ area, item, expected, actual, pass: expected === actual });
  for (const prof of spec.profiles) {
    const id = s.profileIdsByName[prof.name];
    row("profile", prof.name, "exists", id ? "exists" : "missing");
    if (!id) continue;
    for (const m of spec.modules) {
      const a = actualModulePerms(s.details[id], m);
      row("module", `${prof.name} / ${m}`, prof.modules[m] || "-", a === null ? "not exposed" : a || "-");
    }
  }
  for (const g of spec.fieldSecurity.groups) {
    for (const [module, apis] of Object.entries(g.fields)) {
      for (const api of apis) {
        const f = (s.fields[module] || []).find((x) => x.api_name === api);
        for (const prof of spec.profiles) {
          const id = s.profileIdsByName[prof.name];
          const a = !f ? "field missing" : !id ? "profile missing" : (((f.profiles || []).find((p) => p.id === id) || {}).permission_type || "unset");
          row("fls", `${prof.name} / ${module}.${api}`, g.grant[prof.name] || g.default, a);
        }
      }
    }
  }
  const remaining = planSharing(spec, s.rules, s.roleIds).map((x) => x.rule || x.body.sharing_rules[0].name);
  for (const r of spec.sharingRules.rules) row("sharing", ruleName(r), r.permission, remaining.includes(ruleName(r)) ? "missing" : r.permission);
  if (s.dataSharing) for (const [type, ms] of Object.entries(spec.defaultSharing)) {
    if (type === "_") continue;
    for (const m of ms) row("default", m, type, ((s.dataSharing.find((x) => modOf(x) === m)) || {}).share_type || "missing");
  }
  for (const m of (spec.moduleVisibility || {}).visible || []) if (s.modulesMeta) row("visibility", m, "visible", (s.modulesMeta.find((x) => x.api_name === m) || {}).status || "missing");
  const fail = rows.filter((r) => !r.pass).length;
  return { pass: rows.length - fail, fail, rows };
}
