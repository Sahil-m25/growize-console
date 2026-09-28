// D104 (28 Sep 2026): turn every "FRONT-END LOOP" note in BLOCKED.md into a counted unit of phase 2b ("wire").
// Each note becomes one Autopilot subtask of type "Wiring" on its story in the merged plan (id <STORY>-W<n>, from: <NOTE id>),
// so make-queue.mjs, next.mjs and status.mjs count, pick and forecast it like any other unit. Idempotent: a note already carried is left alone.
// Usage: node autopilot/wire-units.mjs [--dry]        then: node autopilot/make-queue.mjs console
import fs from "node:fs";
import { P, Q, read, write, dir } from "./lib.mjs";
const dry = process.argv.includes("--dry");
const plan = read(Q.console.plan); if (!plan) { console.error("no plan"); process.exit(64); }
const lines = fs.readFileSync(P(dir("console"), "BLOCKED.md"), "utf8").split("\n");
const have = new Set(plan.subtasks.filter(t => t.type === "Wiring").map(t => t.from));
let added = 0, ticked = 0;
for (const l of lines) {
  const m = l.match(/^- \[( |x|X)\] (\S+) \((M\d\d-S\d\d)\) FRONT-END LOOP:\s*(.+)$/);
  if (!m) continue;
  const [, tick, note, story, text] = m;
  if (have.has(note)) continue;
  if (tick !== " ") { ticked++; continue; }
  const n = plan.subtasks.filter(t => t.story === story && t.type === "Wiring").length + 1;
  const title = text.replace(/\s+/g, " ").slice(0, 110).replace(/[,.;:]\s*\S*$/, "");
  plan.subtasks.push({ id: `${story}-W${n}`, story, type: "Wiring", title: `Wire: ${title}`, detail: text.trim(), est_hours: 1, owner: "Sahil", doer: "Autopilot", when: "Build", from: note });
  have.add(note); added++;
}
console.log(`${added} wiring unit(s) added, ${have.size} carried in the plan, ${ticked} note(s) already ticked`);
if (!dry && added) write(Q.console.plan, plan);
