// Record what a round did. The only writer of progress.json and BLOCKED.md.
// node autopilot/done.mjs <q> <STORY> in_progress                      start of a round (counts an attempt)
// node autopilot/done.mjs <q> <STORY> done|review|waiting [--commit sha] [--note "…"]
// node autopilot/done.mjs <q> <STORY> --human <SUBTASK_ID> ["exact steps"]   add a person's item to BLOCKED.md
// node autopilot/done.mjs <q> <STORY> --human "PROVISIONAL: …" | "FACT CHANGE PROPOSED: …"
// node autopilot/done.mjs <q> REGRESSION done                           a full regression finished
// node autopilot/done.mjs <q> STOP "reason"                             stop the loop (creates autopilot/STOP)
import fs from "node:fs"; import { spawnSync } from "node:child_process";
import { P, queue, progress, write, dir, SATISFIED } from "./lib.mjs";
const say = t => spawnSync(process.execPath, [P("autopilot", "notify.mjs"), t], { stdio: "ignore" });   // Slack, best effort
const a = process.argv.slice(2); const [q, id] = a;
const opt = k => { const i = a.indexOf(k); return i > -1 ? a[i + 1] : null; };
const pr = progress(q), Qd = queue(q), now = new Date().toISOString();
const story = Qd?.stories.find(s => s.id === id);
if (id === "STOP") { fs.writeFileSync(P("autopilot", "STOP"), `${now} ${a[2] || ""}\nDelete this file to let the autopilot continue.\n`); say(`:octagonal_sign: *Autopilot stopped* (${q}) — ${a[2] || ""}. Delete autopilot/STOP to resume.`); console.log("STOP written"); process.exit(0); }
if (id === "REGRESSION") {
  pr.last_regression_finished = Qd.stories.filter(s => SATISFIED.has(pr.stories[s.id]?.status)).length;
  pr.rounds.push({ at: now, story: "REGRESSION", status: a[2] }); write(`${dir(q)}/progress.json`, pr);
  say(`:repeat: *Regression* (${q}) finished — ${a[3] || a[2]}`); console.log("regression recorded"); process.exit(0);
}
if (!story) { console.error(`unknown story ${id} in queue ${q}`); process.exit(64); }
const S = (pr.stories[id] ||= { status: "pending", attempts: 0 });
if (a[2] === "--human") {
  const what = a[3] || "", t = story.subtasks.find(x => x.id === what);
  const line = t ? `- [ ] ${t.id} (${id}, ${t.doer}${t.when ? ", " + t.when : ""}) ${t.title} — ${a[4] || t.detail}`
                 : `- [ ] ${id}-NOTE-${(S.notes = (S.notes || 0) + 1)} (${id}) ${what}`;
  const f = P(dir(q), "BLOCKED.md"); const body = fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "";
  if (!t || !body.includes(`- [ ] ${t.id} `) && !body.includes(`- [x] ${t.id} `)) { fs.appendFileSync(f, line + "\n"); say(`:raised_hand: *Needs you* (${q}) ${line.slice(6, 400)}`); }
  if (t) pr.subtasks[t.id] = pr.subtasks[t.id]?.status === "done" ? pr.subtasks[t.id] : { status: "blocked", at: now, note: "waiting on " + t.doer };
  write(`${dir(q)}/progress.json`, pr); console.log("added to BLOCKED.md"); process.exit(0);
}
const status = a[2];
if (!["in_progress", "done", "review", "waiting", "regressed"].includes(status)) { console.error("status must be in_progress|done|review|waiting|regressed"); process.exit(64); }
if (status === "in_progress") S.attempts = (S.attempts || 0) + 1;
S.status = status; S.at = now; if (opt("--note")) S.note = opt("--note"); if (opt("--commit")) (S.commits ||= []).push(opt("--commit"));
for (const t of story.subtasks.filter(t => /^Autopilot/.test(t.doer)))
  pr.subtasks[t.id] = { status: status === "done" || status === "waiting" ? "done" : status === "in_progress" ? "in_progress" : "review", at: now };
if (status === "done" && story.subtasks.some(t => !/^Autopilot/.test(t.doer) && pr.subtasks[t.id]?.status !== "done")) S.status = "waiting";
pr.rounds.push({ at: now, story: id, status: S.status, attempt: S.attempts, note: S.note || "" });
write(`${dir(q)}/progress.json`, pr);
fs.appendFileSync(P(dir(q), "logs", "rounds.log"), `${now}\t${id}\t${S.status}\tattempt ${S.attempts}\t${S.note || ""}\n`);
const done = Qd.stories.filter(s => SATISFIED.has(pr.stories[s.id]?.status)).length;
const icon = { done: ":white_check_mark:", waiting: ":hourglass_flowing_sand:", review: ":eyes:", in_progress: ":hammer:", regressed: ":warning:" }[S.status] || "";
if (status !== "in_progress") say(`${icon} *${id}* ${story.title} → *${S.status}*${S.note ? " — " + S.note : ""}${S.commits?.length ? " · `" + S.commits.at(-1).slice(0, 7) + "`" : ""}  _(${q}: ${done}/${Qd.stories.length} built)_`);
if (done === Qd.stories.length && status !== "in_progress") say(`:tada: *${q.toUpperCase()} build queue finished* — all ${done} stories built. Moving to testing.`);
console.log(`${id} → ${S.status}`);
