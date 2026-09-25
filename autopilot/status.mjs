// Progress-based forecast (D66): no fixed days. The loop runs round the clock; dates are projected from the pace it
// actually achieves. Writes autopilot/status.json (read by pm/build_plan.py and the Cowork check) and PEOPLE-CALENDAR.md.
// Usage: node autopilot/status.mjs [--md]    (--md prints a Slack-ready summary)
import fs from "node:fs";
import { P, Q, queue, progress, write, SATISFIED, HUMAN } from "./lib.mjs";
const TARGETS = read("autopilot/targets.json", { build_start: "2026-09-24T18:00:00+05:30", build_target: "2026-10-03T23:59:00+05:30",
  test_days: 6, note: "Build everything (IR then IM) by Saturday 3 Oct; then test and harden; go live when the gates pass." });
function read(f, d) { try { return JSON.parse(fs.readFileSync(P(f), "utf8")); } catch { return d; } }
const now = new Date(), DAY = 864e5;
const order = [];                                   // one sequence across both products: the loop does IR, then IM
for (const q of Object.keys(Q)) { const Qd = queue(q); if (Qd) for (const s of Qd.stories) order.push({ q, s }); }
const prog = Object.fromEntries(Object.keys(Q).map(q => [q, progress(q)]));
const st = (q, id) => prog[q].stories[id]?.status || "pending";
const built = order.filter(o => SATISFIED.has(st(o.q, o.s.id)));
const left = order.filter(o => !SATISFIED.has(st(o.q, o.s.id)));
// measured pace: stories built in the last 48 h (at least 3 to trust it), else the pace the target needs
const since = now - 2 * DAY;
const recent = Object.values(prog).flatMap(p => p.rounds).filter(r => ["done", "waiting", "review"].includes(r.status) && new Date(r.at) > since && r.story !== "REGRESSION");
const start = new Date(TARGETS.build_start), target = new Date(TARGETS.build_target);
const needed = left.length / Math.max((target - now) / DAY, 0.25);
const measured = recent.length / 2;
const pace = recent.length >= 3 ? measured : Math.max(needed, 0.1);
const projected = {}; left.forEach((o, i) => projected[o.s.id] = new Date(+now + (i + 1) / pace * DAY).toISOString());
for (const o of built) projected[o.s.id] = prog[o.q].stories[o.s.id].at;
const finish = { all: left.length ? projected[left.at(-1).s.id] : (built.at(-1) && prog[built.at(-1).q].stories[built.at(-1).s.id].at) || now.toISOString() };
for (const q of Object.keys(Q)) { const l = left.filter(o => o.q === q); finish[q] = l.length ? projected[l.at(-1).s.id] : "built"; }
const testEnd = new Date(new Date(finish.all).getTime() + TARGETS.test_days * DAY).toISOString();
// people's items, in the order the loop will need them
// Sahil's items block the build; tester and business-user items belong to the testing phase after it
const people = [], testing = [];
for (const o of order) for (const t of o.s.subtasks.filter(t => HUMAN(t.doer))) {
  if (prog[o.q].subtasks[t.id]?.status === "done") continue;
  const item = { q: o.q, story: o.s.id, id: t.id, doer: t.doer, title: t.title, hours: t.est_hours, need_by: projected[o.s.id] };
  (t.when === "Testing phase" ? testing : people).push(item);
}
const dueSoon = people.filter(p => new Date(p.need_by) - now < 1.5 * DAY);
const status = { at: now.toISOString(), targets: TARGETS, pace: +pace.toFixed(2), pace_source: recent.length >= 3 ? "measured (last 48 h)" : "needed to hit the target",
  needed_pace: +needed.toFixed(2), measured_pace: +measured.toFixed(2),
  counts: Object.fromEntries(Object.keys(Q).map(q => [q, { built: built.filter(o => o.q === q).length, total: order.filter(o => o.q === q).length,
    review: order.filter(o => o.q === q && st(q, o.s.id) === "review").length, waiting: order.filter(o => o.q === q && st(q, o.s.id) === "waiting").length }])),
  finish, test_end: testEnd, on_track: new Date(finish.all) <= target, stopped: fs.existsSync(P("autopilot", "STOP")),
  last_round: Object.values(prog).flatMap(p => p.rounds).map(r => r.at).sort().at(-1) || null,
  projected, people_next: people.slice(0, 40), people_due_soon: dueSoon, testing_phase: testing };
write("autopilot/status.json", status);
const fmt = iso => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
let md = `# People's calendar — in the order the autopilot will need it\n\nProjected from the loop's pace (${status.pace} stories/day, ${status.pace_source}); refreshed every round by \`node autopilot/status.mjs\`. Do anything early — nothing waits on a date.\n\n| Needed by (projected) | Queue | Story | Who | Item | Hours |\n|---|---|---|---|---|---|\n`;
for (const p of people) md += `| ${fmt(p.need_by)} | ${p.q} | ${p.story} | ${p.doer} | ${p.id} ${p.title} | ${p.hours} |\n`;
md += `\n## Testing phase (after the build, projected ${fmt(finish.all)} → ${fmt(testEnd)})\n\n| Queue | Story | Who | Item | Hours |\n|---|---|---|---|---|\n`;
for (const p of testing) md += `| ${p.q} | ${p.story} | ${p.doer} | ${p.id} ${p.title} | ${p.hours} |\n`;
fs.writeFileSync(P("autopilot", "PEOPLE-CALENDAR.md"), md);
if (process.argv.includes("--md")) {
  const c = status.counts;
  console.log([`*Growize build — ${fmt(now)}*`,
    `IR console: ${c.ir?.built ?? 0}/${c.ir?.total ?? 0} built · IM portal: ${c.im?.built ?? 0}/${c.im?.total ?? 0} built` + (c.ir?.review + c.im?.review ? ` · ${c.ir.review + c.im.review} need review` : ""),
    `Pace ${status.pace}/day (${status.pace_source}); needed ${status.needed_pace}/day for ${fmt(TARGETS.build_target)}.`,
    `Projected: build done ${fmt(finish.all)} ${status.on_track ? ":large_green_circle: on track" : ":red_circle: behind target"} · testing done ~${fmt(testEnd)}`,
    status.stopped ? ":octagonal_sign: STOP file present — the loop is stopped." : "",
    dueSoon.length ? `*Needed from you in the next ~36 h (${dueSoon.length}):*\n` + dueSoon.slice(0, 12).map(p => `• ${p.id} ${p.title} (${p.q}, by ${fmt(p.need_by)})`).join("\n") : "Nothing needed from you in the next ~36 h."].filter(Boolean).join("\n"));
}
