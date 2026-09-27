// Shared helpers for the autopilot scripts. Paths are relative to the growize repo root.
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// D69-D73 (25 Sep 2026): one app, one plan, one queue. The old ir/im queues are kept below for reference only.
export const Q = {
  console: { plan: "pm/plan-merged/growize-console-plan.json", cases: "pm/plan-merged/ui-cases.json", fixtures: "pm/merge-audit/ui-sahil/fixtures-merged.json", gaps: "pm/plan-merged/gaps.json",
        app: "console", url: "http://localhost:3001", prototype: "console/prototype/growize-console-merged.html", next: null },
};
export const Q_RETIRED = {
  ir: { plan: "pm/tests/ir-console-plan.json", cases: "pm/tests/ui-cases.json", fixtures: "pm/tests/fixtures.json", gaps: "pm/tests/ir-gaps.json",
        app: "console", url: "http://localhost:3001", prototype: "console/prototype/ir-console-redesigned.html", next: "im" },
  im: { plan: "pm/tests/im-portal-plan.json", cases: "pm/tests/im-ui-cases.json", fixtures: "pm/tests/im-fixtures.json", gaps: "pm/tests/im-gaps.json",
        app: "portal", url: "http://localhost:3002", prototype: "portal/prototype/investor-management.html", next: null },
};
export const P = (...p) => path.join(ROOT, ...p);
export const read = (f, dflt) => { try { return JSON.parse(fs.readFileSync(P(f), "utf8")); } catch { return dflt; } };
export const write = (f, o) => { fs.mkdirSync(path.dirname(P(f)), { recursive: true }); const tmp = P(f) + ".tmp"; fs.writeFileSync(tmp, JSON.stringify(o, null, 1)); fs.renameSync(tmp, P(f)); };
export const dir = q => `autopilot/${q}`;
export const progress = q => read(`${dir(q)}/progress.json`, { stories: {}, subtasks: {}, rounds: [], last_regression_round: 0 });
export const queue = q => read(`${dir(q)}/queue.json`, null);
export const HUMAN = d => !/^Autopilot/.test(d || "");
export const SATISFIED = new Set(["done", "review", "waiting"]);   // a dependency that is built (a person may still owe their part)
export function blockedDone(q) {   // items the owner ticked in BLOCKED.md: lines "- [x] ID …" or containing "done"
  const f = P(dir(q), "BLOCKED.md"); if (!fs.existsSync(f)) return new Set();
  const ids = new Set();
  for (const line of fs.readFileSync(f, "utf8").split("\n")) {
    const m = line.match(/^\s*-\s*\[(x|X)\]\s*([A-Z0-9\-]+)/) || line.match(/^\s*-\s*\[ \]\s*([A-Z0-9\-]+).*\bdone\b/i);
    if (m) ids.add(m[2] || m[1]);
  }
  return ids;
}
export const today = () => new Date().toISOString().slice(0, 10);

// D98 phases: front end → Zoho → testing. A "unit" is one story in one phase.
export const PHASES = (() => { try { return JSON.parse(fs.readFileSync(P("autopilot", "phases.json"), "utf8")); } catch { return { order: ["all"], names: { all: "Build" }, types: { all: null }, gate: {}, first: {} }; } })();
export const phaseOf = t => PHASES.order.find(ph => !PHASES.types[ph] || PHASES.types[ph].includes(t.type)) || PHASES.order.at(-1);
export const autoTasks = (s, ph) => s.subtasks.filter(t => /^Autopilot/.test(t.doer) && phaseOf(t) === ph);
export const phasesFor = s => PHASES.order.filter(ph => autoTasks(s, ph).length);
export const phaseStatus = (pr, id, ph) => pr.stories[id]?.phases?.[ph] || "pending";
export const PHASE_OK = new Set(["done", "waiting"]);        // a phase unit counts as built; review still needs a look
/** The phase being worked: the first phase with a unit not yet built (review counts as not built). */
// D100: a second worktree can pin its phase with a one-word file autopilot/.phase (git-ignored), e.g. "zoho",
// so the backend loop runs beside the front-end loop without both picking the same units.
export const pinnedPhase = () => { try { const v = fs.readFileSync(P("autopilot", ".phase"), "utf8").trim(); return PHASES.order.includes(v) ? v : null; } catch { return null; } };
export function currentPhase(Qd, pr) {
  const pin = pinnedPhase();
  if (pin) return Qd.stories.some(s => phasesFor(s).includes(pin) && !PHASE_OK.has(phaseStatus(pr, s.id, pin))) ? pin : null;
  for (const ph of PHASES.order) if (Qd.stories.some(s => phasesFor(s).includes(ph) && !PHASE_OK.has(phaseStatus(pr, s.id, ph)))) return ph;
  return null;
}
