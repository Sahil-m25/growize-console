// build-audit [--limit N]: for every built story, does the recorded build match its acceptance, the decisions it cites and the
// nine rules (D109)? Writes docs/reports/build-audit-<date>.md (+ .json).
import fs from "node:fs";
import { jev, P, opt, spent } from "./common.mjs"; import { q } from "../questions/index.mjs"; import { ground } from "../ground.mjs"; import { thresholds } from "../policy.mjs";
import { queue, progress } from "../../autopilot/lib.mjs";
export function stateOf(s, S, notes) {
  const g = ground("", { story: s.id, topK: 0, seats: false, extraCites: s.decisions || [], cap: 20000 });
  const refs = Object.entries(g.state.decisions || {});
  const doneSub = s.subtasks.filter(t => S.subtasks?.[t.id]?.status === "done").map(t => `${t.id} ${t.title}`);
  const state = { story: { id: s.id, title: s.title, so_that: s.so_that, acceptance: (s.acceptance || []).slice(0, 8) }, decisions: Object.fromEntries(refs), rules: (g.state.rules || []).join(" "),
    build: { phases: S.phases || {}, notes, subtasks_done: doneSub.slice(0, 12) } };
  const qs = { verdict: q("build-audit") }; if (refs.length) qs.touches = q("build-audit", { refs }, "touches");
  return { state, qs };
}
export async function run(argv) {
  const lim = argv.includes("--limit") ? +opt(argv, "--limit") : Infinity;
  const Qd = queue("console"), pr = progress("console");
  const built = Qd.stories.filter(s => { const ph = pr.stories[s.id]?.phases || {}; return Object.values(ph).some(v => ["done", "waiting", "review"].includes(v)); }).slice(0, lim);
  const notes = {}; for (const r of pr.rounds) if (r.note && r.story !== "REGRESSION") (notes[r.story] ||= []).push(`[${r.phase} ${r.status}] ${r.note}`);
  const out = [];
  await jev.pool(built, 4, async (s) => {
    const St = pr.stories[s.id] || {}; const ns = [...new Set(notes[s.id] || [St.note].filter(Boolean))].slice(-4);
    const { state, qs } = stateOf(s, { ...St, subtasks: pr.subtasks }, ns);
    try { const a = await jev.ask(state, qs, { caller: "build-audit" }); out.push({ id: s.id, title: s.title, verdict: a.verdict.choice, conf: +a.verdict.confidence.toFixed(2), touches: a.touches?.choice || "none", tconf: +(a.touches?.confidence || 0).toFixed(2), note: (ns.at(-1) || "").slice(0, 240), phases: St.phases }); }
    catch (e) { out.push({ id: s.id, title: s.title, verdict: "error", conf: 0, err: String(e.message || e) }); }
    process.stderr.write(".");
  });
  out.sort((a, b) => a.id.localeCompare(b.id));
  const TH = thresholds()["build-audit"], T = TH.trusted ? TH.threshold : 2;
  const day = new Date().toISOString().slice(0, 10), flagged = out.filter(o => !["aligned", "error"].includes(o.verdict)).sort((a, b) => b.conf - a.conf);
  const row = o => `| ${o.id} | ${o.verdict} ${o.conf} | ${o.touches !== "none" ? o.touches + " " + o.tconf : "—"} | ${o.title.replace(/\|/g, "/").slice(0, 70)} | ${(o.note || "").replace(/\|/g, "/").slice(0, 200)} |`;
  const tb = (h, rows) => `## ${h} (${rows.length})\n\n| Story | Verdict | Drifts from | Title | Last note |\n|---|---|---|---|---|\n${rows.map(row).join("\n") || "| — | | | | |"}\n\n`;
  const md = `# Build audit — ${day}\n\n${out.length} built stories, each judged by Jev: does the recorded build match the acceptance, the cited decisions and the nine rules? Verdicts: aligned · drifted · incomplete · unclear. Decisive = at or above ${TH.trusted ? T : "— (untrusted type: every flag is REVIEW)"}. Jev sorts; a person reads every flagged row. ${spent()}.\n\n` +
    tb("Drifted, decisive", flagged.filter(o => o.verdict === "drifted" && o.conf >= T)) + tb("Incomplete, decisive", flagged.filter(o => o.verdict === "incomplete" && o.conf >= T)) +
    tb("Flagged, weak or unclear — REVIEW", flagged.filter(o => o.conf < T || o.verdict === "unclear")) + `## Aligned (${out.filter(o => o.verdict === "aligned").length})\n\n${out.filter(o => o.verdict === "aligned").map(o => `${o.id} ${o.conf}`).join(" · ")}\n`;
  fs.writeFileSync(P("docs", "reports", `build-audit-${day}.md`), md); fs.writeFileSync(P("docs", "reports", `build-audit-${day}.json`), JSON.stringify(out, null, 1));
  console.log(`\n${out.length} judged: aligned ${out.filter(o => o.verdict === "aligned").length} · drifted ${out.filter(o => o.verdict === "drifted").length} · incomplete ${out.filter(o => o.verdict === "incomplete").length} · unclear ${out.filter(o => o.verdict === "unclear").length} · errors ${out.filter(o => o.verdict === "error").length}`);
  return 0;
}
