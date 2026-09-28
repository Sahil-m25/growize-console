// M19-S02-T02 — staging fixture adapter. The Jev runner calls it as SEED_CMD with one fixture name:
//   SEED_CMD="node console/scripts/jev-staging-seed.mjs"  → node jev-staging-seed.mjs <FIXTURE>
//   node console/scripts/jev-staging-seed.mjs --reset        → clears every applied fixture (once before each case)
// Resolves the fixture's staging seed id (`seeded` in the FIXTURES file, or config.seeds) and POSTs the app's
// seed API: /api/test/fixture/<seed id> (reset: /api/test/reset), with the lane header x-gz-lane.
// A fixture with no seed exits 3 with "fixture X has no staging seed yet" — the case must not run.
// Env: STAGING_URL (or config.baseUrl, or APP_URL), FIXTURES, JEV_STAGING_CONFIG, JEV_SEED_TOKEN (sent as
// Authorization: Bearer, for when staging guards the test API), SEED_WAIT_MS (default 700).
import fs from "node:fs"; import { createRequire } from "node:module";
const { loadConfig, readJson, seedFor, noSeedMessage } = createRequire(import.meta.url)("./jev-lib.cjs");

export async function seed(arg, { cfg = loadConfig(), fix = process.env.FIXTURES ? readJson(process.env.FIXTURES, {}) : {}, fetchFn = fetch, env = process.env } = {}) {
  const base = cfg.baseUrl || env.APP_URL;
  if (!base) return { code: 2, msg: "no staging URL: set STAGING_URL or baseUrl in the config" };
  const app = new URL(base); const lane = cfg.lane || app.searchParams.get("lane") || "";
  let url;
  if (arg === "--reset") url = app.origin + "/api/test/reset";
  else {
    const id = seedFor(fix, arg, cfg.seeds);
    if (!id) return { code: 3, msg: noSeedMessage(arg) };
    url = app.origin + "/api/test/fixture/" + encodeURIComponent(id);
  }
  const headers = { ...(lane ? { "x-gz-lane": lane } : {}), ...(env.JEV_SEED_TOKEN ? { authorization: "Bearer " + env.JEV_SEED_TOKEN } : {}) };
  const r = await fetchFn(url, { method: "POST", headers }).catch(e => ({ ok: false, status: 0, text: async () => String(e) }));
  if (!r.ok) return { code: 1, msg: `${arg === "--reset" ? "reset" : "fixture " + arg}: ${r.status} ${await r.text()}` };
  return { code: 0, msg: arg === "--reset" ? "reset" : `seeded ${arg}`, url };
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("jev-staging-seed.mjs")) {
  const [arg] = process.argv.slice(2);
  if (!arg) { console.error("usage: jev-staging-seed.mjs <FIXTURE> | --reset"); process.exit(64); }
  const r = await seed(arg);
  (r.code ? console.error : console.log)(r.msg);
  if (!r.code && arg !== "--reset") await new Promise(res => setTimeout(res, +(process.env.SEED_WAIT_MS || 700)));
  process.exit(r.code);
}
