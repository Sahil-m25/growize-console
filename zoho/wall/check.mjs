// Wall test (sandbox): prove Zoho itself enforces who-sees-what for each persona, independent of our console.
// Pure `evaluate` + `observe(call, persona)`; `call(method, path, body) -> Promise<{status, body}>` is the persona's OWN session
// (window.__z in the browser). No identity value is ever kept: observations hold counts, Seed_Keys, owner persona tags and booleans.
// Keep this file free of module imports and default exports: build-bundle.mjs strips `export ` to inline it into one browser script.
//
// Zoho v8 shapes relied on (docs fetched 5 Oct 2026):
//  GET /crm/v8/settings/modules  -> modules[].{api_name, viewable, creatable, editable, deletable} for the CURRENT user
//     https://www.zoho.com/crm/developer/docs/api/v8/modules-api.html
//  GET /crm/v8/settings/fields?module= -> fields[].{api_name, visible, view_type}; "Don't Show" fields are STILL listed, so this is advisory only
//     https://www.zoho.com/crm/developer/docs/api/v8/field-meta.html
//  GET /crm/v8/{Module}?fields=a,b&per_page=200&page=n -> data[], info.more_records; fields mandatory, max 50; NO_PERMISSION 403 at module level
//     https://www.zoho.com/crm/developer/docs/api/v8/get-records.html
//  DELETE /crm/v8/{Module}?ids=a,b (max 100) -> data[].{code:"SUCCESS"}; denial NO_PERMISSION / AUTHORIZATION_FAILED
//     https://www.zoho.com/crm/developer/docs/api/v8/delete-records.html
//  UNVERIFIED: how a record read answers a field hidden by FLS (key omitted vs 4xx). Both are read as "hidden"; an empty page falls back to metadata.
//  UNVERIFIED: GET /crm/v8/users?type=CurrentUser -> users[0].{role.name, profile.{id,name}} and GET /crm/v8/settings/profiles/{id} -> profiles[0].permissions_details[]
//     ({name|api_name|display_label, enabled}) readable by a non-admin. If not readable, export is reported null (skipped), not failed.
//  UNVERIFIED: GET /crm/v8/users?type=ActiveUsers readable by a non-admin (used only to map owners to persona tags; ctx.ownerMap overrides it).

export const SANDBOX_ZGID = "60090668120";
export const LIVE_ZGID = "60061770791";

export const MODULES = ["Leads", "Contacts", "LLP_UnitAllocation_Module", "Receipts", "Touches", "Cases", "LLP_Creation_Module", "Investor_Updates"];
const TAG_FIELDS = { Leads: ["Owner"], Contacts: ["Owner", "Originating_IR", "KAM"], LLP_UnitAllocation_Module: ["Owner"], Receipts: ["Owner"], Touches: ["Owner"], Cases: ["Owner"] };
const MAX_PAGES = 10;

export async function assertSandbox(call) {
  const r = await call("GET", "/crm/v8/org");
  const id = String(r?.body?.org?.[0]?.zgid ?? r?.body?.org?.[0]?.id ?? "");
  if (id !== SANDBOX_ZGID) throw new Error(`wall test refuses to run: org ${id || "unknown"} is not the sandbox ${SANDBOX_ZGID}${id === LIVE_ZGID ? " (this is the LIVE org)" : ""}`);
  return id;
}

/** persona label -> tag. users: [{id, full_name, profile:{name}}]. Admins map to "admin". */
export function ownerMapFromUsers(users, expectations) {
  const map = {};
  for (const u of users ?? []) {
    let tag = u.profile?.name === "Administrator" ? "admin" : null;
    for (const [key, p] of Object.entries(expectations.personas)) {
      if (key === "admin") continue;
      const esc = p.label.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp(`(^|[^a-z])${esc}([^a-z]|$)`).test(String(u.full_name ?? u.name ?? "").toLowerCase())) tag = key;
    }
    if (tag) { if (u.id) map[String(u.id)] = tag; if (u.full_name) map[String(u.full_name).toLowerCase()] = tag; }
  }
  return map;
}

const tagOf = (v, map) => (v == null ? "none" : map[String(v.id)] ?? map[String(v.name ?? "").toLowerCase()] ?? "other");
const denied = (r) => r.status === 403 || r.status === 401 || ["NO_PERMISSION", "AUTHORIZATION_FAILED", "OAUTH_SCOPE_MISMATCH"].includes(r.body?.code) || ["NO_PERMISSION", "AUTHORIZATION_FAILED"].includes(r.body?.data?.[0]?.code);

async function readAll(call, mod, fields) {
  const rows = []; let status = 0;
  for (let page = 1; page <= MAX_PAGES; page++) {
    let r = await call("GET", `/crm/v8/${mod}?fields=${fields.join(",")}&per_page=200&page=${page}`);
    if (page === 1 && r.status === 400 && fields.includes("Seed_Key")) { // module has no Seed_Key yet
      fields = fields.filter((f) => f !== "Seed_Key");
      r = await call("GET", `/crm/v8/${mod}?fields=${fields.join(",")}&per_page=200&page=${page}`);
    }
    if (page === 1) status = r.status;
    rows.push(...(r.body?.data ?? []));
    if (!r.body?.info?.more_records) break;
  }
  return { status, rows };
}

/** Gathers observations with the persona's own session. ctx.ownerMap: {userId|lowercased name: tag}. */
export async function observe(call, persona, expectations, ctx = {}) {
  const exp = expectations.personas[persona];
  if (!exp) throw new Error(`unknown persona ${persona}`);
  const map = ctx.ownerMap ?? {};
  const obs = { persona, user: { role: null, profile: null }, export: null, modules: {}, fields: {}, rows: {}, create: {} };

  const me = (await call("GET", "/crm/v8/users?type=CurrentUser")).body?.users?.[0];
  obs.user = { role: me?.role?.name ?? null, profile: me?.profile?.name ?? null };
  if (me?.profile?.id) {
    const pr = await call("GET", `/crm/v8/settings/profiles/${me.profile.id}`);
    const perm = (pr.body?.profiles?.[0]?.permissions_details ?? []).find((p) => /export/i.test(`${p.name} ${p.api_name} ${p.display_label}`));
    obs.export = perm ? perm.enabled === true : null;
  }

  const mr = await call("GET", "/crm/v8/settings/modules");
  for (const m of mr.body?.modules ?? []) if (MODULES.includes(m.api_name)) obs.modules[m.api_name] = { viewable: m.viewable === true, creatable: m.creatable === true, editable: m.editable === true };

  const fieldKeys = Object.keys(exp.fields);
  for (const mod of [...new Set(fieldKeys.map((k) => k.split(".")[0]))]) {
    const meta = {};
    const fr = await call("GET", `/crm/v8/settings/fields?module=${mod}`);
    for (const f of fr.body?.fields ?? []) meta[f.api_name] = f.visible === true;
    for (const key of fieldKeys.filter((k) => k.startsWith(mod + "."))) {
      const f = key.slice(mod.length + 1);
      const r = await call("GET", `/crm/v8/${mod}?fields=id,${f}&per_page=5`);
      const data = r.body?.data;
      let record = null; // key presence only: the value is never read
      if (r.status >= 400) record = false;
      else if (Array.isArray(data) && data.length) record = data.some((row) => Object.prototype.hasOwnProperty.call(row, f));
      obs.fields[key] = { record, meta: meta[f] ?? null };
    }
  }

  let leadId = null;
  for (const mod of Object.keys(TAG_FIELDS)) {
    const { status, rows } = await readAll(call, mod, ["id", "Seed_Key", ...TAG_FIELDS[mod]]);
    if (mod === "Leads" && rows[0]) leadId = rows[0].id;
    const out = rows.map((r) => ({ seedKey: r.Seed_Key ?? null, owner: tagOf(r.Owner, map), ...(mod === "Contacts" ? { originatingIr: tagOf(r.Originating_IR, map), kam: tagOf(r.KAM, map) } : {}) }));
    obs.rows[mod] = { status, count: out.length, seedKeys: out.map((r) => r.seedKey).filter(Boolean), rows: out };
  }

  const stamp = `WALL-${persona}-${Date.now()}`;
  for (const mod of ["Touches", "Receipts"]) {
    const rec = { Name: stamp, Test_Seed: true, Seed_Key: stamp };
    if (mod === "Touches" && leadId) rec.Lead = { id: leadId };
    if (mod === "Receipts") rec.Amount = 1;
    const r = await call("POST", `/crm/v8/${mod}`, { data: [rec] });
    const d = r.body?.data?.[0];
    const id = d?.code === "SUCCESS" ? d.details?.id : null;
    const c = { outcome: id ? "created" : denied(r) ? "denied" : "blocked-by-validation", allowed: !denied(r), deleted: null }; // validation errors are checked after permission (UNVERIFIED order)
    if (id) {
      const del = await call("DELETE", `/crm/v8/${mod}?ids=${id}`);
      c.deleted = del.body?.data?.[0]?.code === "SUCCESS";
      if (!c.deleted) c.leftoverId = id; // Test_Seed=true: the next reset removes it
    }
    obs.create[mod] = c;
  }
  return obs;
}

const matches = (row, pred, self) => Object.entries(pred).every(([k, v]) => row[k] === (v === "self" ? self : v));
const glob = (pat, s) => new RegExp("^" + pat.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$").test(s);
const tracesFor = (ex, check) => [...new Set(Object.entries(ex.traces).filter(([p]) => glob(p, check)).flatMap(([, t]) => t))];

/** expectations + persona + observations -> [{check, expected, actual, pass, traces, advisory?, detail?}]; pass null = not asserted / not observable. */
export function evaluate(ex, persona, obs) {
  const p = ex.personas[persona];
  const out = [];
  const add = (check, expected, actual, pass, extra = {}) => out.push({ check, expected, actual, pass, traces: tracesFor(ex, check), ...extra });
  const eq = (check, expected, actual) => add(check, expected, actual ?? "unknown", expected === null ? null : actual === expected);

  if (p.role) eq("identity.role", p.role, obs.user?.role); 
  eq("identity.profile", p.profile, obs.user?.profile);

  for (const [mod, flags] of Object.entries(p.modules)) for (const [flag, want] of Object.entries(flags)) {
    if (want === null) continue;
    eq(`module.${mod}.${flag}`, want, obs.modules?.[mod]?.[flag]);
  }

  for (const [key, want] of Object.entries(p.fields)) {
    const o = obs.fields?.[key] ?? {};
    const actual = o.record ?? o.meta ?? null;
    add(`field.${key}`, want, actual ?? "unknown", actual === null ? false : actual === want);
    if (o.meta != null) add(`fieldmeta.${key}`, want, o.meta, o.meta === want, { advisory: true });
  }

  const shared = new Set(ex.sharedSeedKeys ?? []);
  for (const [mod, rule] of Object.entries(p.scope)) {
    const r = obs.rows?.[mod] ?? { count: 0, rows: [], status: null };
    const rows = r.rows ?? [];
    const base = `scope.${mod}`;
    if (rule.mode === "none") add(`${base}.sees_nothing`, 0, r.count, r.count === 0);
    else if (rule.mode === "all") {
      const seen = new Set(rows.map((x) => x.owner));
      const missing = rule.mustSeeOwners.filter((t) => !seen.has(t));
      add(`${base}.sees_all_owners`, rule.mustSeeOwners.join(","), [...seen].filter((t) => rule.mustSeeOwners.includes(t)).join(","), missing.length === 0, missing.length ? { detail: `no row owned by ${missing.join(",")}` } : {});
    } else if (rule.mode === "allowlist") {
      const bad = rows.filter((x) => !(x.seedKey && shared.has(x.seedKey)) && !rule.allow.some((a) => matches(x, a, persona)));
      add(`${base}.no_foreign`, 0, bad.length, bad.length === 0, bad.length ? { detail: `leaked: ${bad.slice(0, 20).map((x) => `${x.seedKey ?? "no-key"}(owner=${x.owner}${x.originatingIr ? `,ir=${x.originatingIr},kam=${x.kam}` : ""})`).join(" ")}` } : {});
      for (const need of rule.mustSee ?? []) {
        const n = rows.filter((x) => matches(x, need, persona)).length;
        add(`${base}.sees_own.${Object.keys(need).join("+")}`, ">=1", n, n >= 1);
      }
    }
  }

  for (const [mod, want] of Object.entries(p.testCreate)) {
    const c = obs.create?.[mod];
    add(`create.${mod}`, want, c ? c.allowed : "unknown", want === null ? null : c ? c.allowed === want : false, c?.leftoverId ? { detail: `LEFTOVER test record ${c.leftoverId} (Test_Seed=true)` } : {});
  }
  add("export", p.export, obs.export, p.export === null || obs.export === null ? null : obs.export === p.export, obs.export === null && p.export !== null ? { detail: "profile not readable by this user: check Export by hand (runbook)" } : {});

  if (persona === "admin") {
    const broken = out.filter((r) => r.pass === false && !r.advisory);
    add("env.admin_control", "admin sees everything", broken.length ? `${broken.length} failing rows` : "ok", broken.length === 0, { detail: broken.length ? "TEST ENVIRONMENT BROKEN: admin must see everything; fix seed or login before reading other personas" : undefined });
  }
  return out;
}

export function summarize(rows, persona) {
  const hard = rows.filter((r) => !r.advisory);
  const failed = hard.filter((r) => r.pass === false);
  return { persona, total: hard.length, passed: hard.filter((r) => r.pass === true).length, failed: failed.length, skipped: hard.filter((r) => r.pass === null).length, advisoryFailed: rows.filter((r) => r.advisory && r.pass === false).length, ok: failed.length === 0, envBroken: persona === "admin" && failed.length > 0 };
}
