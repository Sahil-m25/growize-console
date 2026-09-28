// Phase-based forecast (D98, replaces D66's story pace; D104 splits done from waiting). Units = one story in one phase (autopilot/phases.json).
// Loop time left = Σ minutes per unit (assumed until a phase has 5 measured rounds, then measured) ÷ loop hours per day.
// Writes autopilot/status.json (read by ops/tracker/canvas.py) and PEOPLE-CALENDAR.md.   Usage: node autopilot/status.mjs [--md]
import fs from "node:fs";
import { P, queue, progress, write, HUMAN, PHASES, phasesFor, phaseStatus, PHASE_OK } from "./lib.mjs";
const read = (f, d) => { try { return JSON.parse(fs.readFileSync(P(f), "utf8")); } catch { return d; } };
const T = read("autopilot/targets.json", {}), AU = read("ops/tracker/audit.json", { stories: {} }).stories;
const q = "console", Qd = queue(q), pr = progress(q), now = new Date(), DAY = 864e5;
const perDay = T.loop_hours_per_day || 14, MPU = T.minutes_per_unit || {};
const key = (s, ph) => ph === "fe" ? `fe:${AU[s.id]?.front_end || "partly"}` : ph;
// measured minutes per unit: rounds of one phase, from in_progress to its result
const measured = {};
for (const ph of PHASES.order) {
  const r = pr.rounds.filter(x => x.phase === ph), spans = [];
  for (let i = 0; i < r.length; i++) if (r[i].status === "in_progress") { const e = r.slice(i + 1).find(x => x.story === r[i].story && x.status !== "in_progress"); if (e) spans.push((new Date(e.at) - new Date(r[i].at)) / 6e4); }
  if (spans.length >= 5) measured[ph] = spans.reduce((a, b) => a + b, 0) / spans.length;
}
const mins = (s, ph) => measured[ph] ?? MPU[key(s, ph)] ?? MPU[ph] ?? 30;
const phases = {}, projected = {}; let clock = +now;
// D100/D101: with the backend worktree running, phase 2 runs beside phase 1 (its own clock from now); phase 3 starts when both end.
const parallel = !!process.env.PROGRESS_VIEW; let feEnd = +now;
const SIDE = new Set(PHASES.parallel || []); let sideEnd = +now, saved = null;   // D105: phases run in a second worktree, own clock
for (const ph of PHASES.order) {
  if (parallel && ph === "zoho") { feEnd = clock; clock = +now; }
  if (SIDE.has(ph)) { saved = clock; clock = +now; }
  if (ph === PHASES.order.at(-1)) clock = Math.max(clock, sideEnd, parallel ? feEnd : 0);
  const units = Qd.stories.filter(s => phasesFor(s).includes(ph));
  const built = units.filter(s => PHASE_OK.has(phaseStatus(pr, s.id, ph))), review = units.filter(s => ["review", "regressed"].includes(phaseStatus(pr, s.id, ph)));
  // D104: "built" = code through the loop; "done" = proven; "waiting" = code written, proof waits on a person (sandbox, setup, decision)
  const done = units.filter(s => phaseStatus(pr, s.id, ph) === "done"), waiting = units.filter(s => phaseStatus(pr, s.id, ph) === "waiting");
  const left = units.filter(s => !PHASE_OK.has(phaseStatus(pr, s.id, ph)));
  for (const s of left) { clock += mins(s, ph) / 60 / perDay * DAY; projected[`${s.id}:${ph}`] = new Date(clock).toISOString(); }
  const leftMin = left.reduce((a, s) => a + mins(s, ph), 0);
  phases[ph] = { name: PHASES.names[ph], units: units.length, built: built.length, done: done.length, waiting: waiting.length, review: review.length, left: left.length,
    loop_hours_left: +(leftMin / 60).toFixed(1), minutes_per_unit: measured[ph] ? +measured[ph].toFixed(1) : null, source: measured[ph] ? "measured" : "assumed",
    finish: left.length ? new Date(clock).toISOString() : "done" };
  if (SIDE.has(ph)) { sideEnd = Math.max(sideEnd, clock); clock = saved; }
}
const current = PHASES.order.find(ph => phases[ph].left - phases[ph].review > 0) || null;   // D104: review alone does not hold a phase
const buildEnd = new Date(Math.max(clock, sideEnd)), testEnd = new Date(+buildEnd + (T.test_days || 6) * DAY);
const lastRound = pr.rounds.filter(r => r.status !== "replan").map(r => r.at).sort().at(-1) || null;
const idleH = lastRound ? (now - new Date(lastRound)) / 36e5 : null;
// people's items: Sahil's block the build; tester/business users belong to the testing after the loop
const people = [], testing = [];
for (const s of Qd.stories) for (const t of s.subtasks.filter(t => HUMAN(t.doer))) {
  if (pr.subtasks[t.id]?.status === "done") continue;
  const ph = PHASES.order.find(p => phasesFor(s).includes(p) && !PHASE_OK.has(phaseStatus(pr, s.id, p))) || PHASES.order.at(-1);
  const item = { q, story: s.id, id: t.id, doer: t.doer, title: t.title, hours: t.est_hours, need_by: projected[`${s.id}:${ph}`] || now.toISOString(), phase: ph };
  (t.when === "Testing phase" ? testing : people).push(item);
}
people.sort((a, b) => a.need_by.localeCompare(b.need_by));
const status = { at: now.toISOString(), targets: T, model: parallel ? "D98 phases, 1 and 2 in parallel" : "D98 phases", parallel, current_phase: current, phases, loop_hours_per_day: perDay,
  finish: { all: buildEnd.toISOString() }, test_end: testEnd.toISOString(), on_track: buildEnd <= new Date(T.build_target),
  stopped: fs.existsSync(P("autopilot", "STOP")), last_round: lastRound, idle_hours: idleH == null ? null : +idleH.toFixed(1),
  projected, people_next: people.slice(0, 40), people_due_soon: people.filter(p => new Date(p.need_by) - now < 1.5 * DAY), testing_phase: testing };
write("autopilot/status.json", status);
const fmt = iso => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
let md = `# People's calendar — in the order the autopilot will need it\n\nProjected from the phase forecast (${perDay} loop hours a day); refreshed every round by \`node autopilot/status.mjs\`. Do anything early — nothing waits on a date.\n\n| Needed by (projected) | Phase | Story | Who | Item | Hours |\n|---|---|---|---|---|---|\n`;
for (const p of people) md += `| ${fmt(p.need_by)} | ${PHASES.names[p.phase]} | ${p.story} | ${p.doer} | ${p.id} ${p.title} | ${p.hours} |\n`;
md += `\n## Testing phase (people, after the loop: ${fmt(buildEnd)} → ${fmt(testEnd)})\n\n| Story | Who | Item | Hours |\n|---|---|---|---|\n`;
for (const p of testing) md += `| ${p.story} | ${p.doer} | ${p.id} ${p.title} | ${p.hours} |\n`;
fs.writeFileSync(P("autopilot", "PEOPLE-CALENDAR.md"), md);
if (process.argv.includes("--md")) console.log([`*Growize build — ${fmt(now)}*`,
  ...PHASES.order.map(ph => `${phases[ph].name}: ${phases[ph].done} done · ${phases[ph].waiting} waiting on people${phases[ph].review ? ` · ${phases[ph].review} review` : ""} · ${phases[ph].left} left of ${phases[ph].units} · ${phases[ph].loop_hours_left} loop h left (${phases[ph].source})`),
  `Forecast: loop finished ${fmt(buildEnd)} · testing done ~${fmt(testEnd)} ${status.on_track ? ":large_green_circle:" : ":red_circle: behind the " + fmt(T.build_target) + " target"}`,
  idleH > 6 ? `:warning: The loop has not run for ${Math.round(idleH)} h — the forecast assumes ${perDay} h a day.` : ""].filter(Boolean).join("\n"));
