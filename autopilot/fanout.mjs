// D111 (30 Sep 2026): fan-out — several agents build independent units at once, each in its own git worktree and branch;
// one coordinator plans the batches, merges, runs the gate once, and is the ONLY writer of progress.json and BLOCKED.md.
//   node autopilot/fanout.mjs plan [--phase wire] [--agents 7]         batches of open units, grouped by epic (JSON on stdout)
//   node autopilot/fanout.mjs worktrees <plan.json> <parent-dir> [base] one worktree per batch: branch agent/<batch>, node_modules linked
//   node autopilot/fanout.mjs record <results.json> [--dry]            record every agent's result in one pass (progress + BLOCKED)
// results.json: [{ "story": "M11-S03", "phase": "wire", "status": "done|review|waiting", "note": "one line: built · acceptance met · decisions",
//                  "commits": ["sha"], "notes": ["PROVISIONAL: …", "FACT CHANGE PROPOSED: …"], "subtasks": ["optional: ids actually done"] }]
// Models (AUTOPILOT.md "Fan-out"): builders = sonnet; the pattern for a new kind of unit, cross-cutting/security work,
// the Jev layer, and the integration merge = opus.
import fs from "node:fs"; import path from "node:path"; import { execFileSync } from "node:child_process";
import { P, queue, progress, write, dir, PHASES, phasesFor, phaseOf, phaseStatus, OPEN, currentPhase } from "./lib.mjs";
const [cmd, ...a] = process.argv.slice(2); const opt = (k, d) => { const i = a.indexOf(k); return i > -1 ? a[i + 1] : d; };
const q = "console", Qd = queue(q), pr = progress(q);

if (cmd === "plan") {
  const ph = opt("--phase", currentPhase(Qd, pr)), n = +opt("--agents", 7);
  const open = Qd.stories.filter(s => phasesFor(s).includes(ph) && OPEN(pr, s.id, ph));
  const byEpic = {}; for (const s of open) (byEpic[s.epic] ||= []).push(s);
  // largest epics first into the lightest batch: keeps an epic (shared screens and endpoint files) inside one agent
  const units = s => s.subtasks.filter(t => /^Autopilot/.test(t.doer) && phaseOf(t) === ph).length || 1;
  const batches = Array.from({ length: Math.min(n, Object.keys(byEpic).length) }, (_, i) => ({ name: `b${i + 1}`, epics: [], stories: [], units: 0 }));
  for (const [ep, ss] of Object.entries(byEpic).sort((x, y) => y[1].reduce((c, s) => c + units(s), 0) - x[1].reduce((c, s) => c + units(s), 0))) {
    const b = batches.sort((x, y) => x.units - y.units)[0];
    b.epics.push(ep); b.stories.push(...ss.map(s => s.id)); b.units += ss.reduce((c, s) => c + units(s), 0);
  }
  console.log(JSON.stringify({ phase: ph, gate: PHASES.gate[ph], batches: batches.filter(b => b.units).map(b => ({ ...b, name: `${ph}-${b.epics.join("-").toLowerCase()}` })) }, null, 1));
} else if (cmd === "worktrees") {
  const plan = JSON.parse(fs.readFileSync(a[0], "utf8")), parent = path.resolve(a[1]), base = a[2] || "HEAD";
  for (const b of plan.batches) {
    const wt = path.join(parent, b.name);
    execFileSync("git", ["worktree", "add", "-q", "-b", `agent/${b.name}`, wt, base], { cwd: P(), stdio: "inherit" });
    const nm = P("console", "node_modules"); if (fs.existsSync(nm)) fs.symlinkSync(nm, path.join(wt, "console", "node_modules"), "junction");
    for (const f of [".typesafe-key"]) if (fs.existsSync(P(f))) fs.copyFileSync(P(f), path.join(wt, f));
    console.log(`${b.name}\t${wt}\tagent/${b.name}\t${b.stories.join(" ")}`);
  }
} else if (cmd === "record") {
  const res = JSON.parse(fs.readFileSync(a[0], "utf8")), dry = a.includes("--dry"), now = new Date().toISOString();
  const bf = P(dir(q), "BLOCKED.md"); let blocked = fs.readFileSync(bf, "utf8"); const added = [];
  for (const r of res) {
    const s = Qd.stories.find(x => x.id === r.story); if (!s) { console.error(`unknown story ${r.story}`); process.exitCode = 1; continue; }
    if (!["done", "review", "waiting"].includes(r.status)) { console.error(`${r.story}: bad status ${r.status}`); process.exitCode = 1; continue; }
    const S = (pr.stories[r.story] ||= { status: "pending", attempts: 0 }); S.phases ||= {}; S.phase_attempts ||= {};
    S.phase_attempts[r.phase] = (S.phase_attempts[r.phase] || 0) + 1; S.attempts = (S.attempts || 0) + 1;
    S.phases[r.phase] = r.status; S.at = now; S.note = r.note; S.commits = [...new Set([...(S.commits || []), ...(r.commits || [])])];
    // r.subtasks (optional): only these were completed — e.g. the local half of a phase whose sandbox half waits
    for (const t of s.subtasks.filter(t => /^Autopilot/.test(t.doer) && phaseOf(t) === r.phase && (!r.subtasks || r.subtasks.includes(t.id))))
      pr.subtasks[t.id] = { status: r.status === "review" ? "review" : "done", at: now, phase: r.phase };
    const need = phasesFor(s), got = need.filter(p => ["done", "waiting"].includes(S.phases[p]));
    const peopleOpen = s.subtasks.some(t => !/^Autopilot/.test(t.doer) && pr.subtasks[t.id]?.status !== "done");
    S.status = need.some(p => S.phases[p] === "review") ? "review" : got.length === need.length ? (peopleOpen ? "waiting" : "done") : "pending";
    pr.rounds.push({ at: now, story: r.story, phase: r.phase, status: r.status, attempt: S.phase_attempts[r.phase], note: r.note, by: "fan-out (D111)" });
    for (const n of r.notes || []) { const line = `- [ ] ${r.story}-NOTE-${(S.notes = (S.notes || 0) + 1)} (${r.story}) ${n.replace(/\s+/g, " ").trim()}`; blocked += (blocked.endsWith("\n") ? "" : "\n") + line + "\n"; added.push(line); }
  }
  if (!dry) { write(`${dir(q)}/progress.json`, pr); fs.writeFileSync(bf, blocked); fs.mkdirSync(P(dir(q), "logs"), { recursive: true }); fs.appendFileSync(P(dir(q), "logs", "rounds.log"), res.map(r => `${now}\t${r.story}\t${r.phase}:${r.status}\tfan-out\t${r.note}\n`).join("")); }
  console.log(`${dry ? "[dry] " : ""}recorded ${res.length} units, ${added.length} BLOCKED.md lines`);
} else { console.error("usage: fanout.mjs plan [--phase p] [--agents n] | worktrees <plan.json> <parent-dir> [base] | record <results.json> [--dry]"); process.exit(64); }
