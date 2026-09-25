// Pick the next piece of work — deterministic, so the model never chooses what to build.
// Usage: node autopilot/next.mjs <queue>            → prints the packet (JSON)
//        node autopilot/next.mjs <queue> --check    → exit 0 work ready · 1 queue finished · 2 only waiting on people · 3 STOP present
import fs from "node:fs";
import { P, queue, progress, SATISFIED, blockedDone, dir, write } from "./lib.mjs";
const [q, flag] = process.argv.slice(2);
if (!q) { console.error("usage: next.mjs <queue> [--check]"); process.exit(64); }
if (fs.existsSync(P("autopilot", "STOP"))) { if (flag === "--check") process.exit(3); console.log(JSON.stringify({ type: "none", why: "autopilot/STOP exists" })); process.exit(0); }
const Qd = queue(q); if (!Qd) { console.error(`no queue for ${q}: run node autopilot/make-queue.mjs ${q}`); process.exit(64); }
const pr = progress(q), ticked = blockedDone(q);
for (const id of ticked) if (!pr.subtasks[id] || pr.subtasks[id].status !== "done") pr.subtasks[id] = { status: "done", by: "owner (BLOCKED.md)", at: new Date().toISOString() };
const st = id => pr.stories[id]?.status || "pending";
// a story is 'waiting' until every person's subtask is ticked; then it becomes done
for (const s of Qd.stories) if (st(s.id) === "waiting" && s.subtasks.filter(t => !/^Autopilot/.test(t.doer)).every(t => pr.subtasks[t.id]?.status === "done")) pr.stories[s.id].status = "done";
write(`${dir(q)}/progress.json`, pr);
const REG_EVERY = 6;                                   // a full regression every 6 finished stories
const finished = Qd.stories.filter(s => SATISFIED.has(st(s.id))).length;
const depsOk = s => s.depends_on.every(d => !Qd.stories.find(x => x.id === d) || SATISFIED.has(st(d)));   // deps outside this queue (e.g. IR ids) are assumed built
// 1) failures to fix first: a story whose regression broke
const fix = Qd.stories.find(s => st(s.id) === "regressed" && (pr.stories[s.id].attempts || 0) < 6);
// 2) the next ready story: earliest day, Must first (queue order), not tried 3 times
const ready = Qd.stories.find(s => ["pending", "in_progress"].includes(st(s.id)) && depsOk(s) && (pr.stories[s.id]?.attempts || 0) < 3);
const regDue = finished - (pr.last_regression_finished || 0) >= REG_EVERY;
const remaining = Qd.stories.filter(s => !SATISFIED.has(st(s.id)));
if (flag === "--check") process.exit(fix || ready || (regDue && finished) ? 0 : remaining.length ? 2 : 1);
if (fix) console.log(JSON.stringify({ type: "fix", ...fix, why: pr.stories[fix.id].note }, null, 1));
else if (regDue && finished && SATISFIED.has(st("M19-S03"))) console.log(JSON.stringify({ type: "regression", stories: Qd.stories.filter(s => SATISFIED.has(st(s.id))).map(s => s.id),
  then: "node autopilot/test-story.mjs " + q + " --regression ; then node autopilot/done.mjs " + q + " REGRESSION done" }, null, 1));
else if (ready) console.log(JSON.stringify({ type: "story", queue: q, app: Qd.app, url: Qd.url, ...ready, prototype_file: Qd.prototype,
  attempts_so_far: pr.stories[ready.id]?.attempts || 0, previous_note: pr.stories[ready.id]?.note || null }, null, 1));
else console.log(JSON.stringify({ type: "none", why: remaining.length ? `${remaining.length} stories wait on people or on stories marked review` : "queue finished",
  waiting: remaining.slice(0, 10).map(s => ({ id: s.id, status: st(s.id), blocked_by: s.depends_on.filter(d => !SATISFIED.has(st(d))) })) }, null, 1));
