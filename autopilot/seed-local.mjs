// SEED_CMD for local runs: apply a named fixture to the app running in FIXTURE_MODE=local (built in E16-S03-T03).
// Usage (set by the autopilot): SEED_CMD="node autopilot/seed-local.mjs" — the runner appends the fixture name.
// APP_URL may carry a lane (http://localhost:3001/?lane=x) so several runs can share one dev server.
const [name] = process.argv.slice(2); const app = new URL(process.env.APP_URL || "http://localhost:3001");
const lane = app.searchParams.get("lane") || "";
const url = app.origin + "/api/test/fixture/" + encodeURIComponent(name);
const r = await fetch(url, { method: "POST", headers: lane ? { "x-gz-lane": lane } : {} }).catch(e => ({ ok: false, status: 0, text: async () => String(e) }));
if (!r.ok) { console.error(`fixture ${name}: ${r.status} ${await r.text()}`); process.exit(1); }
// The page picks a fixture up on its next version poll (every 250 ms) and re-fetches the data; give it
// that long before the runner reads the screen (the runner itself waits only ~200 ms).
await new Promise(r => setTimeout(r, +(process.env.SEED_WAIT_MS || 700)));
