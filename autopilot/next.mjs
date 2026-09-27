// Pick the next piece of work — deterministic, so the model never chooses what to build.
// Usage: node autopilot/next.mjs <queue>            → prints the packet (JSON)
//        node autopilot/next.mjs <queue> --check    → exit 0 work ready · 1 queue finished · 2 only waiting on people · 3 STOP present
import fs from "node:fs";
import { P, queue, progress, SATISFIED, blockedDone, dir, write, PHASES, phasesFor, phaseStatus, PHASE_OK, currentPhase, autoTasks, phaseOf } from "./lib.mjs";
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
const REG_EVERY = 6;                                   // a full regression every 6 finished units
// D98: work goes phase by phase — 1 front end on demo data, 2 plug into Zoho, 3 test and harden (autopilot/phases.json).
const ph = currentPhase(Qd, pr);
const pst = id => phaseStatus(pr, id, ph);
const unitsIn = p => Qd.stories.filter(s => phasesFor(s).includes(p));
const builtUnits = PHASES.order.flatMap(p => unitsIn(p).filter(s => PHASE_OK.has(phaseStatus(pr, s.id, p)))).length;
// a dependency is fine when it is built in this phase, or has nothing to do in this phase
const depsOk = s => s.depends_on.every(d => { const x = Qd.stories.find(y => y.id === d); return !x || !phasesFor(x).includes(ph) || PHASE_OK.has(phaseStatus(pr, d, ph)) || phaseStatus(pr, d, ph) === "review"; });
const first = (PHASES.first?.[ph] || []);
const cands = ph ? unitsIn(ph).sort((a, b) => (first.includes(b.id) ? 1 : 0) - (first.includes(a.id) ? 1 : 0)) : [];
// 1) a unit whose regression broke  2) the next ready unit (queue order: day, Must first), not tried 3 times in this phase
const fix = ph && cands.find(s => pst(s.id) === "regressed" && (pr.stories[s.id].phase_attempts?.[ph] || 0) < 6);
const ready = ph && cands.find(s => ["pending", "in_progress"].includes(pst(s.id)) && depsOk(s) && (pr.stories[s.id]?.phase_attempts?.[ph] || 0) < 3);
const regDue = ph && ph !== "zoho" && builtUnits - (pr.last_regression_finished || 0) >= REG_EVERY;
const remaining = ph ? cands.filter(s => !PHASE_OK.has(pst(s.id))) : [];
if (flag === "--check") process.exit(fix || ready || regDue ? 0 : remaining.length ? 2 : 1);
const packet = s => { const later = s.subtasks.filter(t => /^Autopilot/.test(t.doer) && phaseOf(t) !== ph);
  return { ...s, phase: ph, phase_name: PHASES.names[ph], phase_gate: PHASES.gate[ph],
    subtasks: s.subtasks.filter(t => !/^Autopilot/.test(t.doer) || phaseOf(t) === ph),
    later_phases_do_not_build_now: later.map(t => `${t.id} [${PHASES.names[phaseOf(t)]}] ${t.title}`) }; };
if (fix) console.log(JSON.stringify({ type: "fix", ...packet(fix), why: pr.stories[fix.id].note }, null, 1));
else if (regDue) console.log(JSON.stringify({ type: "regression", phase: ph, stories: Qd.stories.filter(s => PHASES.order.some(p => PHASE_OK.has(phaseStatus(pr, s.id, p)) && p !== "zoho")).map(s => s.id),
  then: "node autopilot/test-story.mjs " + q + " --regression ; then node autopilot/done.mjs " + q + " REGRESSION done" }, null, 1));
else if (ready) console.log(JSON.stringify({ type: "story", queue: q, app: Qd.app, url: Qd.url, ...packet(ready), prototype_file: Qd.prototype,
  attempts_so_far: pr.stories[ready.id]?.phase_attempts?.[ph] || 0, previous_note: pr.stories[ready.id]?.note || null }, null, 1));
else console.log(JSON.stringify({ type: "none", phase: ph, why: !ph ? "every phase finished" : `${remaining.length} units in ${PHASES.names[ph]} wait on people, on review, or on dependencies`,
  waiting: remaining.slice(0, 10).map(s => ({ id: s.id, status: pst(s.id), blocked_by: s.depends_on.filter(d => { const x = Qd.stories.find(y => y.id === d); return x && phasesFor(x).includes(ph) && !PHASE_OK.has(phaseStatus(pr, d, ph)); }) })) }, null, 1));
