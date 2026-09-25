// Sandbox reset (M19-S03-T01): refuse unless the org is the sandbox, delete every record tagged Test_Seed, upsert the manifest.
// Run: node zoho/sandbox/reset.mjs   env: ZOHO_SANDBOX_ORG_ID, ZOHO_SANDBOX_API_DOMAIN, ZOHO_SANDBOX_TOKEN (a service token — background work only, D53). The token is never printed.
// The sandbox needs a boolean field Test_Seed on each seeded module (human step, see autopilot/console/BLOCKED.md).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const STAMP = /^(\d{2}) (\w{3})(?: (\d{2}):(\d{2}))?$/;
const DAY = 864e5;

/** "25 Jul 11:00" (demo clock) → ISO date shifted so the demo day lands on the run day. */
export function shiftStamp(s, demoDay, runDay) {
  const m = STAMP.exec(s);
  if (!m || !MONTHS.includes(m[2])) return s;
  const demo = new Date(demoDay + "T00:00:00Z");
  let at = Date.UTC(demo.getUTCFullYear(), MONTHS.indexOf(m[2]), +m[1]);
  if (at > demo.getTime() + DAY) at = Date.UTC(demo.getUTCFullYear() - 1, MONTHS.indexOf(m[2]), +m[1]);
  return new Date(runDay.getTime() - (demo.getTime() - at)).toISOString().slice(0, 10) + (m[3] ? `T${m[3]}:${m[4]}:00` : "");
}
const shiftAll = (v, demoDay, runDay) =>
  typeof v === "string" ? shiftStamp(v, demoDay, runDay)
  : Array.isArray(v) ? v.map((x) => shiftAll(x, demoDay, runDay))
  : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shiftAll(x, demoDay, runDay)]))
  : v;

/** api: { org(): {id, apiDomain}, listTagged(module, field): ids[], remove(module, ids), upsert(module, records) }. */
export async function reset({ api, manifest, sandboxOrgId, runDay = new Date() }) {
  const org = await api.org();
  if (!sandboxOrgId || org.id !== sandboxOrgId || !/sandbox/i.test(org.apiDomain)) throw new Error("not a sandbox org");
  const counts = {};
  for (const [module, rows] of Object.entries(manifest.records)) {
    const old = await api.listTagged(module, manifest.tagField);
    if (old.length) await api.remove(module, old);
    await api.upsert(module, rows.map((r) => shiftAll(r, manifest.demoDay, runDay)));
    counts[module] = rows.length;
  }
  return counts;
}

/** Live api over Zoho CRM v6, on the service token. */
export function liveApi({ apiDomain, token, fetchFn = fetch }) {
  const call = async (method, path, body) => {
    const r = await fetchFn(`${apiDomain}/crm/v6${path}`, { method, headers: { Authorization: `Zoho-oauthtoken ${token}`, "Content-Type": "application/json" }, body: body && JSON.stringify(body) });
    if (!r.ok) throw new Error(`Zoho ${method} ${path.split("?")[0]} → ${r.status}`);
    return r.status === 204 ? {} : r.json();
  };
  return {
    org: async () => ({ id: String((await call("GET", "/org")).org[0].zgid), apiDomain }),
    async listTagged(module, field) {
      const ids = [];
      for (let page = 1; ; page++) {
        const r = await call("GET", `/${module}/search?criteria=(${field}:equals:true)&fields=id&per_page=200&page=${page}`);
        ids.push(...(r.data ?? []).map((x) => x.id));
        if (!r.info?.more_records) return ids;
      }
    },
    async remove(module, ids) { for (let i = 0; i < ids.length; i += 100) await call("DELETE", `/${module}?ids=${ids.slice(i, i + 100).join(",")}`); },
    async upsert(module, rows) { for (let i = 0; i < rows.length; i += 100) await call("POST", `/${module}/upsert`, { data: rows.slice(i, i + 100), duplicate_check_fields: ["Seed_Key"] }); },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { ZOHO_SANDBOX_ORG_ID, ZOHO_SANDBOX_API_DOMAIN, ZOHO_SANDBOX_TOKEN } = process.env;
  const manifest = JSON.parse(readFileSync(new URL("./manifest.json", import.meta.url), "utf8"));
  reset({ api: liveApi({ apiDomain: ZOHO_SANDBOX_API_DOMAIN ?? "", token: ZOHO_SANDBOX_TOKEN }), manifest, sandboxOrgId: ZOHO_SANDBOX_ORG_ID })
    .then((c) => console.log("reset ok", c), (e) => { console.error(e.message); process.exit(1); });
}
