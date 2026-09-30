// Record what a round did. The only writer of progress.json and BLOCKED.md.
// node autopilot/done.mjs <q> <STORY> in_progress                      start of a round (counts an attempt)
// node autopilot/done.mjs <q> <STORY> done|review|waiting [--commit sha] [--note "…"]
// node autopilot/done.mjs <q> <STORY> --human <SUBTASK_ID> ["exact steps"]   add a person's item to BLOCKED.md
// node autopilot/done.mjs <q> <STORY> --human "PROVISIONAL: …" | "FACT CHANGE PROPOSED: …"
// node autopilot/done.mjs <q> REGRESSION done                           a full regression finished
// node autopilot/done.mjs <q> STOP "reason"                             stop the loop (creates autopilot/STOP)
import fs from "node:fs"; import { spawnSync } from "node:child_process";
import { P, queue, progress, write, dir, SATISFIED, PHASES, phasesFor, phaseOf, PHASE_OK, currentPhase, pinnedPhase } from "./lib.mjs";
const say = t => spawnSync(process.execPath, [P("autopilot", "notify.mjs"), t], { stdio: "ignore" });   // Slack, best effort
const a = process.argv.slice(2); const [q, id] = a;
const opt = k => { const i = a.indexOf(k); return i > -1 ? a[i + 1] : null; };
const pr = progress(q), Qd = queue(q), now = new Date().toISOString();
const story = Qd?.stories.find(s => s.id === id);
if (id === "STOP") { fs.writeFileSync(P("autopilot", "STOP"), `${now} ${a[2] || ""}\nDelete this file to let the autopilot continue.\n`); say(`:octagonal_sign: *Autopilot stopped* (${q}) — ${a[2] || ""}. Delete autopilot/STOP to resume.`); console.log("STOP written"); process.exit(0); }
if (id === "REGRESSION") {
  pr.last_regression_finished = PHASES.order.flatMap(p => Qd.stories.filter(s => phasesFor(s).includes(p) && PHASE_OK.has(pr.stories[s.id]?.phases?.[p]))).length;
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
// D98: a round works one story in one phase; only that phase's autopilot subtasks change.
const ph = status === "in_progress" ? (currentPhase(Qd, pr) || PHASES.order.at(-1)) : (S.current_phase || currentPhase(Qd, pr) || PHASES.order.at(-1));
S.phases ||= {}; S.phase_attempts ||= {};
if (status === "in_progress") { S.attempts = (S.attempts || 0) + 1; S.phase_attempts[ph] = (S.phase_attempts[ph] || 0) + 1; S.current_phase = ph; }
S.phases[ph] = status; S.at = now; if (opt("--note")) S.note = opt("--note"); if (opt("--commit")) (S.commits ||= []).push(opt("--commit"));
for (const t of story.subtasks.filter(t => /^Autopilot/.test(t.doer) && phaseOf(t) === ph))
  pr.subtasks[t.id] = { status: status === "done" || status === "waiting" ? "done" : status === "in_progress" ? "in_progress" : status === "regressed" ? "pending" : "review", at: now, phase: ph };
// the story's overall status follows its phases
const need = phasesFor(story), got = need.filter(p => PHASE_OK.has(S.phases[p]));
const peopleOpen = story.subtasks.some(t => !/^Autopilot/.test(t.doer) && pr.subtasks[t.id]?.status !== "done");
S.status = status === "in_progress" ? "in_progress" : need.some(p => S.phases[p] === "review") ? "review" : need.some(p => S.phases[p] === "regressed") ? "regressed"
  : got.length === need.length ? (peopleOpen ? "waiting" : "done") : "pending";
if (S.phases[ph] === "done" && peopleOpen && ph === need.at(-1)) S.phases[ph] = "waiting";
pr.rounds.push({ at: now, story: id, phase: ph, status: S.phases[ph], attempt: S.phase_attempts[ph], hours: story.subtasks.filter(t => /^Autopilot/.test(t.doer) && phaseOf(t) === ph).reduce((a, t) => a + (t.est_hours || 0), 0), note: S.note || "" });
write(`${dir(q)}/progress.json`, pr);
fs.appendFileSync(P(dir(q), "logs", "rounds.log"), `${now}\t${id}\t${S.status}\tattempt ${S.attempts}\t${S.note || ""}\n`);
const units = Qd.stories.filter(s => phasesFor(s).includes(ph)), done = units.filter(s => PHASE_OK.has(pr.stories[s.id]?.phases?.[ph])).length;
const icon = { done: ":white_check_mark:", waiting: ":hourglass_flowing_sand:", review: ":eyes:", in_progress: ":hammer:", regressed: ":warning:" }[S.status] || "";
if (status !== "in_progress") say(`${icon} *${id}* [${PHASES.names[ph]}] ${story.title} → *${S.phases[ph]}*${S.note ? " — " + S.note : ""}${S.commits?.length ? " · `" + S.commits.at(-1).slice(0, 7) + "`" : ""}  _(${PHASES.names[ph]}: ${done}/${units.length})_`);
if (done === units.length && status !== "in_progress") say(`:tada: *${PHASES.names[ph]} finished* — all ${done} units. Next: ${PHASES.names[PHASES.order[PHASES.order.indexOf(ph) + 1]] || "go-live gates"}.`);
// refresh the Slack tracker canvas after every recorded round (no-op without a token); D105: from pinned worktrees too, canvas.py merges the other autopilot/* branches
if (status !== "in_progress") for (const py of ["python3", "python", "py"]) { const r = spawnSync(py, [P("ops", "tracker", "canvas.py"), "--push"], { stdio: "ignore", timeout: 90000 }); if (!r.error && r.status !== 9009) break; }
console.log(`${id} [${ph}] → ${S.phases[ph]} (story: ${S.status})`);
