// D109 seed: for every built story, does what the build recorded (round notes, finished subtasks) match the story's acceptance and the
// decisions it cites? Writes docs/reports/build-audit-<date>.md (+ .json). Usage: node autopilot/build-audit.mjs [--limit N]
import fs from "node:fs"; import { P, queue, progress, PHASES } from "./lib.mjs";
const argv = process.argv.slice(2), lim = argv.includes("--limit") ? +argv[argv.indexOf("--limit") + 1] : Infinity;
const KEY = fs.readFileSync(P(".typesafe-key"), "utf8").trim(); let calls = 0, tokens = 0;
async function jev(state, questions) { for (let a = 0; ; a++) { try {
  const r = await fetch("https://api.typesafe.ai/v1/systemone", { method: "POST", headers: { Authorization: "Bearer " + KEY, "Content-Type": "application/json" }, body: JSON.stringify({ model: "jev-latest", state, questions }) });
  if (r.ok) { const j = await r.json(); calls++; tokens += j.usage?.input_tokens || 0; return j.answers; } if (r.status !== 429 && r.status < 500) throw new Error(r.status); } catch (e) { if (a === 3) throw e; } await new Promise(s => setTimeout(s, 1500 * (a + 1))); } }
const DEC = {}; for (const l of fs.readFileSync(P("docs", "DECISIONS.md"), "utf8").split(/\r?\n/)) { const m = l.match(/^\| \[(D\d+)\][^|]*\| ([^|]+)\|/); if (m) DEC[m[1]] = m[2].trim(); }
const RULES = (fs.readFileSync(P("CLAUDE.md"), "utf8").split("## The nine rules")[1] || "").split("\n## ")[0].replace(/\s+/g, " ").slice(0, 3000);
const Qd = queue("console"), pr = progress("console");
const built = Qd.stories.filter(s => { const ph = pr.stories[s.id]?.phases || {}; return Object.values(ph).some(v => ["done", "waiting", "review"].includes(v)); }).slice(0, lim);
const notes = {}; for (const r of pr.rounds) if (r.note && r.story !== "REGRESSION") (notes[r.story] ||= []).push(`[${r.phase} ${r.status}] ${r.note}`);
const out = []; const pool = async (xs, n, fn) => { let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < xs.length) await fn(xs[i++]); })); };
await pool(built, 4, async (s) => {
  const S = pr.stories[s.id] || {}, doneSub = s.subtasks.filter(t => pr.subtasks[t.id]?.status === "done").map(t => `${t.id} ${t.title}`);
  const refs = (s.decisions || []).filter(d => DEC[d]);
  const state = { story: { id: s.id, title: s.title, so_that: s.so_that, acceptance: (s.acceptance || []).slice(0, 8) }, decisions: Object.fromEntries(refs.map(d => [d, DEC[d]])), rules: RULES,
    build: { phases: S.phases || {}, notes: [...new Set(notes[s.id] || [S.note].filter(Boolean))].slice(-4), subtasks_done: doneSub.slice(0, 12) } };
  const qs = { verdict: { type: "choice", instructions: "Compare `build` (what the autopilot recorded doing) with `story.acceptance`, `decisions` (they govern) and `rules`. Pick one.",
      criteria: { aligned: "What was built follows the acceptance and the cited decisions; anything left is only waiting on the sandbox or a person.",
                  drifted: "The build records doing something the acceptance or a cited decision does not say, or the opposite of one, without a decision that allows it.",
                  incomplete: "The notes admit that part of the acceptance is not built and it is not merely waiting on a person or the sandbox.",
                  unclear: "The notes are too thin to tell." } } };
  if (refs.length) qs.touches = { type: "choice", instructions: "If the build drifted from a decision, which one? Pick none otherwise.", criteria: Object.fromEntries([["none", "No drift from a decision."], ...refs.map(d => [d, DEC[d].slice(0, 120)])]) };
  try { const a = await jev(state, qs); out.push({ id: s.id, title: s.title, verdict: a.verdict.choice, conf: +a.verdict.confidence.toFixed(2), touches: a.touches?.choice || "none", tconf: +(a.touches?.confidence || 0).toFixed(2), note: (state.build.notes.at(-1) || "").slice(0, 240), phases: S.phases }); }
  catch (e) { out.push({ id: s.id, title: s.title, verdict: "error", conf: 0, err: String(e.message || e) }); }
  process.stderr.write(".");
});
out.sort((a, b) => a.id.localeCompare(b.id));
const day = new Date().toISOString().slice(0, 10), flag = out.filter(o => !["aligned", "error"].includes(o.verdict)).sort((a, b) => b.conf - a.conf);
const row = o => `| ${o.id} | ${o.verdict} ${o.conf} | ${o.touches !== "none" ? o.touches + " " + o.tconf : "—"} | ${o.title.replace(/\|/g, "/").slice(0, 70)} | ${o.note.replace(/\|/g, "/").slice(0, 200)} |`;
const T = (h, rows) => `## ${h} (${rows.length})\n\n| Story | Verdict | Drifts from | Title | Last note |\n|---|---|---|---|---|\n${rows.map(row).join("\n") || "| — | | | | |"}\n\n`;
const md = `# Build audit — ${day}\n\n${out.length} built stories, each judged by Jev: does the recorded build match the acceptance, the cited decisions and the nine rules? Verdicts: aligned · drifted · incomplete · unclear. Jev sorts; a person reads every flagged row. Calls ${calls}, input tokens ${tokens}.\n\n` +
  T("Drifted, decisive (≥0.7)", flag.filter(o => o.verdict === "drifted" && o.conf >= 0.7)) + T("Incomplete, decisive (≥0.7)", flag.filter(o => o.verdict === "incomplete" && o.conf >= 0.7)) +
  T("Flagged, weak (<0.7) or unclear", flag.filter(o => o.conf < 0.7 || o.verdict === "unclear")) + `## Aligned (${out.filter(o => o.verdict === "aligned").length})\n\n${out.filter(o => o.verdict === "aligned").map(o => `${o.id} ${o.conf}`).join(" · ")}\n`;
fs.writeFileSync(P("docs", "reports", `build-audit-${day}.md`), md); fs.writeFileSync(P("docs", "reports", `build-audit-${day}.json`), JSON.stringify(out, null, 1));
console.log(`\n${out.length} judged: aligned ${out.filter(o => o.verdict === "aligned").length} · drifted ${out.filter(o => o.verdict === "drifted").length} · incomplete ${out.filter(o => o.verdict === "incomplete").length} · unclear ${out.filter(o => o.verdict === "unclear").length} · errors ${out.filter(o => o.verdict === "error").length}`);
