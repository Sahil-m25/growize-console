// Build autopilot/<queue>/queue.json from the plan, and the people's calendar. Safe to re-run: progress.json is never overwritten.
// Usage: node autopilot/make-queue.mjs ir|im|all
import fs from "node:fs";
import { Q, P, read, write, dir, HUMAN } from "./lib.mjs";
const which = process.argv[2] || "all";
const cal = [];
for (const q of which === "all" ? Object.keys(Q) : [which]) {
  const cfg = Q[q], plan = read(cfg.plan), cases = read(cfg.cases, { cases: [] }).cases, gaps = read(cfg.gaps, []);
  if (!plan) { console.log(`no plan for ${q} (${cfg.plan})`); continue; }
  const byStory = {}; for (const c of cases) (byStory[c.story] ||= []).push(c.id);
  const calByEpic = {}; for (const c of cases.filter(c => c.expect_fail)) { const e = (c.story || c.id.replace(/^TC-/, "").split("-")[0]).split("-")[0]; (calByEpic[e] ||= []).push(c.id); }
  const inPlan = s => ["In plan", "In 3 weeks"].includes(s.plan || "In plan");
  const PRI = { Must: 0, Should: 1, Could: 2 };
  const stories = plan.stories.filter(inPlan).sort((a, b) => (a.day ?? 99) - (b.day ?? 99) || (PRI[a.priority] ?? 3) - (PRI[b.priority] ?? 3) || a.id.localeCompare(b.id));
  const out = stories.map(s => ({
    id: s.id, epic: s.epic, title: s.title, priority: s.priority, stage: s.stage, day: s.day ?? null, depends_on: s.depends_on || [],
    as_a: s.as_a, i_want: s.i_want, so_that: s.so_that, acceptance: s.acceptance, decisions: s.decisions || [], prototype: s.prototype || [], zoho: s.zoho || [],
    subtasks: plan.subtasks.filter(t => t.story === s.id).map(t => ({ id: t.id, type: t.type, title: t.title, detail: t.detail, doer: t.doer || t.owner, est_hours: t.est_hours, when: t.when || null })),
    tests: plan.tests.filter(t => t.story === s.id).map(t => ({ id: t.id, title: t.title, type: t.type, seat: t.seat, priority: t.priority, ui_mode: t.ui_mode,
      fixtures: t.fixtures || [], steps: t.ui_steps || t.steps, expected: t.ui_expected || t.expected })),
    ui_cases: byStory[s.id] || [], calibration: calByEpic[s.epic] || [],
    open_decisions: gaps.filter(g => g[0] === "Owner decision" && (g[2] || "").split(/,\s*/).some(a => a === s.epic || a === "All")).map(g => g[1]),
    known_gaps: gaps.filter(g => g[0] !== "Owner decision" && (g[2] || "").split(/,\s*/).some(a => a === s.epic)).map(g => g[1]),
  }));
  write(`${dir(q)}/queue.json`, { queue: q, app: cfg.app, url: cfg.url, prototype: cfg.prototype, next_queue: cfg.next, built: new Date().toISOString(), stories: out });
  if (!fs.existsSync(P(dir(q), "progress.json"))) write(`${dir(q)}/progress.json`, { stories: {}, subtasks: {}, rounds: [], last_regression_round: 0 });
  if (!fs.existsSync(P(dir(q), "BLOCKED.md"))) fs.writeFileSync(P(dir(q), "BLOCKED.md"), `# ${q.toUpperCase()} — things only a person can do\n\nThe autopilot adds items here and never waits for them. Tick an item when it is done: change \`- [ ]\` to \`- [x]\`.\n\n`);
  fs.mkdirSync(P(dir(q), "results"), { recursive: true }); fs.mkdirSync(P(dir(q), "logs"), { recursive: true });
  for (const s of plan.stories) for (const t of plan.subtasks.filter(t => t.story === s.id && HUMAN(t.doer || t.owner)))
    if (inPlan(s)) cal.push({ q, when: t.when || (t.day ? `D${t.day}` : ""), day: t.day ?? (parseInt((t.when || "").match(/^D(\d+)/)?.[1] || "99")), doer: t.doer || t.owner, id: t.id, title: t.title, hours: t.est_hours });
  console.log(`${q}: ${out.length} stories queued`);
}
// the people's calendar and the forecast come from status.mjs (progress-based, D66)
const { spawnSync } = await import("node:child_process");
spawnSync(process.execPath, [P("autopilot", "status.mjs")], { stdio: "inherit" });
