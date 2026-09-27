// SEED_CMD for local runs: apply a named fixture to the app running in FIXTURE_MODE=local (built in E16-S03-T03).
// Usage (set by the autopilot): SEED_CMD="node autopilot/seed-local.mjs" — the runner appends the fixture name.
const [name] = process.argv.slice(2); const url = (process.env.APP_URL || "http://localhost:3001") + "/api/test/fixture/" + encodeURIComponent(name);
const r = await fetch(url, { method: "POST" }).catch(e => ({ ok: false, status: 0, text: async () => String(e) }));
if (!r.ok) { console.error(`fixture ${name}: ${r.status} ${await r.text()}`); process.exit(1); }
// The page picks a fixture up on its next version poll (every 250 ms) and re-fetches the data; give it
// that long before the runner reads the screen (the runner itself waits only ~200 ms).
await new Promise(r => setTimeout(r, +(process.env.SEED_WAIT_MS || 700)));
