// SEED_CMD for local runs: apply a named fixture to the app running in FIXTURE_MODE=local (built in E16-S03-T03).
// Usage (set by the autopilot): SEED_CMD="node autopilot/seed-local.mjs" — the runner appends the fixture name.
const [name] = process.argv.slice(2); const url = (process.env.APP_URL || "http://localhost:3001") + "/api/test/fixture/" + encodeURIComponent(name);
const r = await fetch(url, { method: "POST" }).catch(e => ({ ok: false, status: 0, text: async () => String(e) }));
if (!r.ok) { console.error(`fixture ${name}: ${r.status} ${await r.text()}`); process.exit(1); }
