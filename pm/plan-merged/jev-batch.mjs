// Run a batch of Jev requests. Usage: node jev-batch.mjs jobs.json out.json [parallel]
// jobs.json: [{id, state, questions}] . Key: TS_KEY_FILE or ../../.typesafe-key (never printed).
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const keyFile = [process.env.TS_KEY_FILE, path.join(here, "..", "..", ".typesafe-key"), path.join(here, "..", ".typesafe-key")].find(f => f && fs.existsSync(f));
const KEY = fs.readFileSync(keyFile, "utf8").trim();
const [jf, of, par] = process.argv.slice(2);
const jobs = JSON.parse(fs.readFileSync(jf, "utf8"));
const done = fs.existsSync(of) ? JSON.parse(fs.readFileSync(of, "utf8")) : {};
async function jev(state, questions) {
  for (let a = 0; ; a++) {
    try {
      const r = await fetch("https://api.typesafe.ai/v1/systemone", { method: "POST",
        headers: { Authorization: "Bearer " + KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "jev-latest", state, questions }) });
      if (r.ok) return await r.json();
      if (r.status !== 429 && r.status < 500) return { error: r.status + " " + (await r.text()).slice(0, 300) };
    } catch (e) { if (a === 4) return { error: String(e) }; }
    await new Promise(s => setTimeout(s, 1500 * (a + 1)));
  }
}
const todo = jobs.filter(j => !done[j.id] || done[j.id].error);
let i = 0, tok = 0;
async function worker() { while (i < todo.length) { const j = todo[i++]; const r = await jev(j.state, j.questions);
  done[j.id] = r.error ? { error: r.error } : { answers: r.answers, model: r.model }; tok += (r.usage?.input_tokens || 0);
  if (i % 10 === 0) fs.writeFileSync(of, JSON.stringify(done)); } }
await Promise.all(Array.from({ length: +(par || 8) }, worker));
fs.writeFileSync(of, JSON.stringify(done));
console.log("jobs", jobs.length, "ran", todo.length, "errors", Object.values(done).filter(x => x.error).length, "input tokens", tok);
