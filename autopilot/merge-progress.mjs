// D100: merge the other worktree's autopilot progress into this one, story by story and phase by phase.
// Usage: node autopilot/merge-progress.mjs <branch>     e.g. node autopilot/merge-progress.mjs autopilot/backend
// Run it right after `git merge <branch>` (take either side of progress.json on a conflict first; this script fixes it).
import { execSync } from "node:child_process";
import { progress, write, dir } from "./lib.mjs";
const [ref] = process.argv.slice(2); if (!ref) { console.error("usage: merge-progress.mjs <branch>"); process.exit(64); }
const q = "console", mine = progress(q);
const theirs = JSON.parse(execSync(`git show ${ref}:autopilot/${q}/progress.json`, { encoding: "utf8" }));
const RANK = { pending: 0, in_progress: 1, regressed: 2, review: 3, waiting: 4, done: 5 };
const better = (a, b) => ((RANK[b] ?? -1) > (RANK[a] ?? -1) ? b : a);
for (const [id, t] of Object.entries(theirs.stories || {})) {
  const m = (mine.stories[id] ||= { status: "pending", attempts: 0 });
  m.phases ||= {}; m.phase_attempts ||= {};
  for (const [ph, st] of Object.entries(t.phases || {})) {
    m.phases[ph] = better(m.phases[ph], st);
    m.phase_attempts[ph] = Math.max(m.phase_attempts[ph] || 0, t.phase_attempts?.[ph] || 0);
  }
  m.commits = [...new Set([...(m.commits || []), ...(t.commits || [])])];
  if ((t.at || "") > (m.at || "")) { m.at = t.at; m.note = t.note; }
  m.status = better(m.status, t.status) === "done" && m.status !== "done" ? t.status : m.status;
}
for (const [id, t] of Object.entries(theirs.subtasks || {})) {
  const m = mine.subtasks[id];
  if (!m || (RANK[t.status] ?? -1) > (RANK[m.status] ?? -1) || (t.at || "") > (m.at || "") && t.status === m.status) mine.subtasks[id] = t;
}
const seen = new Set(mine.rounds.map(r => `${r.at}|${r.story}|${r.phase}|${r.status}`));
for (const r of theirs.rounds || []) if (!seen.has(`${r.at}|${r.story}|${r.phase}|${r.status}`)) mine.rounds.push(r);
mine.rounds.sort((a, b) => a.at.localeCompare(b.at));
write(`${dir(q)}/progress.json`, mine);
console.log(`merged progress from ${ref}`);
