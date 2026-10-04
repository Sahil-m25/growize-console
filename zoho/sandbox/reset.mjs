// Sandbox reset (M19-S03-T01): refuse unless the org is the sandbox, delete every record tagged Test_Seed, upsert the manifest.
// Two ways to run it:
//  - Node, service token (background work only, D53): node zoho/sandbox/reset.mjs   env: ZOHO_SANDBOX_ORG_ID, ZOHO_SANDBOX_API_DOMAIN, ZOHO_SANDBOX_TOKEN, ZOHO_SANDBOX_PERSONA_EMAILS (JSON {persona: email})
//  - Browser session of the sandbox admin: bundles/seed.js (build-bundle.mjs) → window.GZSeed, over window.__z.
// The sandbox needs Test_Seed (boolean) and Seed_Key (unique text) on each seeded module: see fields-plan.mjs.
// Shapes: Upsert https://www.zoho.com/crm/developer/docs/api/v8/upsert-records.html (data[<=100], duplicate_check_fields, response data[].details.id in input order, 207 on partial)
//         Search https://www.zoho.com/crm/developer/docs/api/v8/search-records.html (criteria, per_page<=200, info.more_records)
//         Delete https://www.zoho.com/crm/developer/docs/api/v8/delete-records.html (DELETE /{module}?ids=a,b, <=100)
//         Empty search answers 204 with no body: UNVERIFIED in the docs, handled either way. Users list: GET /crm/v8/users?type=ActiveUsers — UNVERIFIED shape (users[].id, .email).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const LIVE_ORG_ID = "60061770791";
export const PERSONAS = ["ir_a", "ir_b", "kam", "finance_ops", "compliance", "admin"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const STAMP = /^(\d{2}) (\w{3})(?: (\d{2}):(\d{2}))?$/;
const DAY = 864e5;

/** "25 Jul 11:00" (demo clock) → date shifted so the demo day lands on the run day. With a time: ISO datetime in Asia/Kolkata (+05:30), as Zoho wants an offset. */
export function shiftStamp(s, demoDay, runDay) {
  const m = STAMP.exec(s);
  if (!m || !MONTHS.includes(m[2])) return s;
  const demo = new Date(demoDay + "T00:00:00Z");
  let at = Date.UTC(demo.getUTCFullYear(), MONTHS.indexOf(m[2]), +m[1]);
  if (at > demo.getTime() + DAY) at = Date.UTC(demo.getUTCFullYear() - 1, MONTHS.indexOf(m[2]), +m[1]);
  return new Date(runDay.getTime() - (demo.getTime() - at)).toISOString().slice(0, 10) + (m[3] ? `T${m[3]}:${m[4]}:00+05:30` : "");
}
const shiftAll = (v, demoDay, runDay) =>
  typeof v === "string" ? shiftStamp(v, demoDay, runDay)
  : Array.isArray(v) ? v.map((x) => shiftAll(x, demoDay, runDay))
  : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shiftAll(x, demoDay, runDay)]))
  : v;

/** Modules parents-first, from the $refs in the rows (ties keep manifest order). Throws on a cycle or a ref to a module not in the manifest. */
export function dependencyOrder(manifest) {
  const mods = Object.keys(manifest.records);
  const deps = Object.fromEntries(mods.map((m) => [m, new Set(manifest.records[m].flatMap((r) => Object.values(r.$refs ?? {}).map(([pm]) => pm)).filter((pm) => pm !== m))]));
  for (const d of Object.values(deps)) for (const pm of d) if (!mods.includes(pm)) throw new Error(`ref to ${pm}, not in the manifest`);
  const out = [];
  while (out.length < mods.length) {
    const next = mods.find((m) => !out.includes(m) && [...deps[m]].every((d) => out.includes(d)));
    if (!next) throw new Error("dependency cycle in the manifest");
    out.push(next);
  }
  return out;
}

/** Who owns what, per module and persona (before user ids). Used by the README, the bundle's plan output and the tests. */
export function distribution(manifest) {
  const d = {};
  for (const [m, rows] of Object.entries(manifest.records)) {
    for (const r of rows) for (const [field, p] of Object.entries(r.$persona ?? {})) {
      const k = `${m}.${field}`;
      d[k] ??= {};
      d[k][p] = (d[k][p] ?? 0) + 1;
    }
  }
  return d;
}

/** Persona → user id. `users` given wins; else personaEmails ({persona: email}) is matched against api.listUsers(). A persona with no user falls back to admin (reported). */
export async function resolveUsers({ api, users, personaEmails }) {
  let map = { ...(users ?? {}) };
  if (!users) {
    const all = await api.listUsers();
    const byEmail = new Map(all.map((u) => [String(u.email).toLowerCase(), u.id]));
    for (const p of PERSONAS) { const id = byEmail.get(String(personaEmails?.[p] ?? "").toLowerCase()); if (id) map[p] = id; }
  }
  if (!map.admin) throw new Error("admin persona unresolved");
  const fallbacks = PERSONAS.filter((p) => !map[p]);
  for (const p of fallbacks) map[p] = map.admin;
  return { users: map, fallbacks };
}

/** One manifest row → the row Zoho gets: personas → { id }, seed-key refs → { id }, demo stamps → run-day stamps. */
export function resolveRow(row, { users, idMap, demoDay, runDay }) {
  const { $persona, $refs, ...plain } = row;
  const out = shiftAll(plain, demoDay, runDay);
  for (const [f, p] of Object.entries($persona ?? {})) {
    if (!users[p]) throw new Error(`persona ${p} has no user`);
    out[f] = { id: users[p] };
  }
  for (const [f, [pm, key]] of Object.entries($refs ?? {})) {
    const id = idMap[pm]?.[key];
    if (!id) throw new Error(`unresolved ref ${pm}/${key}`);
    out[f] = { id };
  }
  return out;
}

/** api: { org(): {id, apiDomain}, listTagged(module, field): ids[], remove(module, ids), upsert(module, rows): ids[] (input order), listUsers(): [{id, email}] }. */
export async function reset({ api, manifest, sandboxOrgId, runDay = new Date(), users, personaEmails }) {
  const org = await api.org();
  if (!sandboxOrgId || org.id === LIVE_ORG_ID || org.id !== sandboxOrgId || !/sandbox/i.test(org.apiDomain)) throw new Error("not a sandbox org");
  const order = dependencyOrder(manifest);
  const resolved = await resolveUsers({ api, users, personaEmails });
  const deleted = {}, counts = {}, idMap = {};
  for (const module of [...order].reverse()) { // children first
    const old = await api.listTagged(module, manifest.tagField);
    if (old.length) await api.remove(module, old);
    deleted[module] = old.length;
  }
  for (const module of order) {
    const rows = manifest.records[module].map((r) => resolveRow(r, { users: resolved.users, idMap, demoDay: manifest.demoDay, runDay }));
    const ids = (await api.upsert(module, rows)) ?? [];
    idMap[module] = Object.fromEntries(manifest.records[module].map((r, i) => [r.Seed_Key, ids[i]]));
    counts[module] = rows.length;
  }
  return { counts, deleted, fallbacks: resolved.fallbacks };
}

/** Api over a `call(method, path, body) → Promise<{status, body}>` — window.__z in the browser, fetch on a token in Node. Zoho v8 paths. Errors carry status and Zoho codes only, never record values. */
export function sessionApi(call, apiDomain) {
  const codes = (b) => [...new Set((b?.data ?? b?.users ?? []).map((x) => x?.code).filter(Boolean))].join(",");
  const must = (r, what, ok = [200, 201, 202, 207, 204]) => {
    if (!ok.includes(r.status)) throw new Error(`Zoho ${what} → ${r.status}${codes(r.body) ? " " + codes(r.body) : ""}`);
    return r.body ?? {};
  };
  return {
    org: async () => ({ id: String(must(await call("GET", "/crm/v8/org"), "GET org").org[0].zgid), apiDomain }),
    async listTagged(module, field) {
      const ids = [];
      for (let page = 1; ; page++) {
        const r = await call("GET", `/crm/v8/${module}/search?criteria=(${field}:equals:true)&per_page=200&page=${page}`);
        if (r.status === 204) return ids;
        const b = must(r, `search ${module}`);
        ids.push(...(b.data ?? []).map((x) => x.id));
        if (!b.info?.more_records) return ids;
      }
    },
    async remove(module, ids) {
      for (let i = 0; i < ids.length; i += 100) {
        const b = must(await call("DELETE", `/crm/v8/${module}?ids=${ids.slice(i, i + 100).join(",")}`), `delete ${module}`);
        const bad = (b.data ?? []).filter((x) => x.status !== "success");
        if (bad.length) throw new Error(`Zoho delete ${module} → ${codes({ data: bad })}`);
      }
    },
    async upsert(module, rows) {
      const ids = [];
      for (let i = 0; i < rows.length; i += 100) {
        const b = must(await call("POST", `/crm/v8/${module}/upsert`, { data: rows.slice(i, i + 100), duplicate_check_fields: ["Seed_Key"] }), `upsert ${module}`);
        const res = b.data ?? [];
        const bad = res.map((x, n) => [x, n]).filter(([x]) => x.status !== "success");
        if (bad.length || res.length !== Math.min(100, rows.length - i)) throw new Error(`Zoho upsert ${module} → ${bad.length} of ${res.length} failed ${codes({ data: bad.map(([x]) => x) })} first=${bad[0] ? rows[i + bad[0][1]].Seed_Key + (bad[0][0].details?.api_name ? " field " + bad[0][0].details.api_name : "") : "count"}`);
        ids.push(...res.map((x) => x.details.id));
      }
      return ids;
    },
    async listUsers() {
      const out = [];
      for (let page = 1; ; page++) {
        const b = must(await call("GET", `/crm/v8/users?type=ActiveUsers&per_page=200&page=${page}`), "GET users");
        out.push(...(b.users ?? []).map((u) => ({ id: u.id, email: u.email })));
        if (!b.info?.more_records) return out;
      }
    },
  };
}

// ---- node only (the bundle stops reading here) ----
/** Live api on the service token. */
export function liveApi({ apiDomain, token, fetchFn = fetch }) {
  const call = async (method, path, body) => {
    const r = await fetchFn(`${apiDomain}${path}`, { method, headers: { Authorization: `Zoho-oauthtoken ${token}`, "Content-Type": "application/json" }, body: body && JSON.stringify(body) });
    return { status: r.status, body: r.status === 204 ? null : await r.json().catch(() => null) };
  };
  return sessionApi(call, apiDomain);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { ZOHO_SANDBOX_ORG_ID, ZOHO_SANDBOX_API_DOMAIN, ZOHO_SANDBOX_TOKEN, ZOHO_SANDBOX_PERSONA_EMAILS } = process.env;
  const manifest = JSON.parse(readFileSync(new URL("./manifest.json", import.meta.url), "utf8"));
  reset({ api: liveApi({ apiDomain: ZOHO_SANDBOX_API_DOMAIN ?? "", token: ZOHO_SANDBOX_TOKEN }), manifest, sandboxOrgId: ZOHO_SANDBOX_ORG_ID, personaEmails: JSON.parse(ZOHO_SANDBOX_PERSONA_EMAILS ?? "{}") })
    .then((c) => console.log("reset ok", c), (e) => { console.error(e.message); process.exit(1); });
}
