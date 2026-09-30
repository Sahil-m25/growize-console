// D108 seed: audit docs/DECISIONS.md with Jev — is each decision still consistent with the nine rules and with the later decisions
// that share its topic? Writes docs/reports/decisions-audit-<date>.md (+ .json). Usage: node autopilot/decisions-audit.mjs [--limit N]
import fs from "node:fs"; import { P } from "./lib.mjs";
const argv = process.argv.slice(2), lim = argv.includes("--limit") ? +argv[argv.indexOf("--limit") + 1] : Infinity;
const KEY = fs.readFileSync(P(".typesafe-key"), "utf8").trim(); let calls = 0, tokens = 0;
async function jev(state, questions) { for (let a = 0; ; a++) { try {
  const r = await fetch("https://api.typesafe.ai/v1/systemone", { method: "POST", headers: { Authorization: "Bearer " + KEY, "Content-Type": "application/json" }, body: JSON.stringify({ model: "jev-latest", state, questions }) });
  if (r.ok) { const j = await r.json(); calls++; tokens += j.usage?.input_tokens || 0; return j.answers; } if (r.status !== 429 && r.status < 500) throw new Error(r.status); } catch (e) { if (a === 3) throw e; } await new Promise(s => setTimeout(s, 1500 * (a + 1))); } }
const rows = []; for (const l of fs.readFileSync(P("docs", "DECISIONS.md"), "utf8").split(/\r?\n/)) { const m = l.match(/^\| \[(D\d+)\]\(([^)]*)\) \| (.*)$/); if (!m) continue; const cells = m[3].split(" | ").map(x => x.replace(/\|\s*$/, "").trim());
  rows.push({ id: m[1], n: +m[1].slice(1), file: m[2], text: cells[0], date: cells[1] || "" }); }
const RULES = (fs.readFileSync(P("CLAUDE.md"), "utf8").split("## The nine rules")[1] || "").split("\n## ")[0].replace(/\s+/g, " ").slice(0, 3500);
const STOP = new Set("the a an and or of to in on for with from by is are be as at it this that when then given their them they not no any every each can may must into than only after before its our your his her who what which where while".split(" "));
const words = t => (t.toLowerCase().match(/[a-z][a-z0-9_]{2,}/g) || []).filter(w => !STOP.has(w));
const related = (d, k = 8) => { const q = new Set(words(d.text)); return rows.filter(x => x.id !== d.id).map(x => ({ x, s: [...q].filter(w => words(x.text).includes(w)).length + (x.n > d.n ? 0.5 : 0) })).filter(o => o.s > 1).sort((a, b) => b.s - a.s).slice(0, k).map(o => o.x); };
const out = []; const todo = rows.slice(0, lim);
const pool = async (xs, n, fn) => { let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < xs.length) await fn(xs[i++]); })); };
await pool(todo, 4, async (d) => {
  const rel = related(d); const later = rel.filter(x => x.n > d.n);
  const state = { decision: `${d.id} (${d.date}): ${d.text}`, rules: RULES, related: Object.fromEntries(rel.map(x => [x.id, `(${x.date}) ${x.text}`])) };
  const crit = { consistent: "It still stands: nothing in `rules` or `related` contradicts it.", superseded: "A later decision in `related` replaced it in whole or part, but this row does not say so.", contradicts_rule: "It conflicts with one of the nine `rules` as written.", contradicts_decision: "Two decisions in force disagree with each other and neither says it supersedes the other." };
  const qs = { verdict: { type: "choice", instructions: "Judge `decision` against `rules` and `related` (later ones are dated later). Pick one.", criteria: crit } };
  if (rel.length) qs.with = { type: "choice", instructions: "If `decision` is superseded by or in conflict with one of `related`, which one? Pick none if it stands.", criteria: Object.fromEntries([["none", "It stands."], ...rel.map(x => [x.id, x.text.slice(0, 120)])]) };
  try { const a = await jev(state, qs); out.push({ ...d, verdict: a.verdict.choice, conf: +a.verdict.confidence.toFixed(2), probs: a.verdict.probabilities, with: a.with?.choice || "none", withConf: +(a.with?.confidence || 0).toFixed(2), related: rel.map(x => x.id) }); }
  catch (e) { out.push({ ...d, verdict: "error", conf: 0, err: String(e.message || e) }); }
  process.stderr.write(".");
});
out.sort((a, b) => a.n - b.n);
const day = new Date().toISOString().slice(0, 10);
const flag = out.filter(o => o.verdict !== "consistent" && o.verdict !== "error").sort((a, b) => b.conf - a.conf);
const row = o => `| ${o.id} | ${o.date} | ${o.verdict} ${o.conf} | ${o.with !== "none" ? o.with + " " + o.withConf : "—"} | ${o.text.replace(/\|/g, "/").slice(0, 200)} |`;
const md = `# Decisions audit — ${day}\n\n${out.length} decisions from docs/DECISIONS.md, each judged by Jev against the nine rules and up to 8 topic-related decisions (lexical match; later ones marked by date). Verdicts: consistent · superseded (a later decision replaced it but the row does not say so) · contradicts_rule · contradicts_decision. Jev sorts; a person reads every flagged row. Calls ${calls}, input tokens ${tokens}.\n\n## Flagged, decisive (≥0.7) (${flag.filter(o => o.conf >= 0.7).length})\n\n| D | Date | Verdict | With | Text |\n|---|---|---|---|---|\n${flag.filter(o => o.conf >= 0.7).map(row).join("\n") || "| — | | | | |"}\n\n## Flagged, weak (<0.7) (${flag.filter(o => o.conf < 0.7).length})\n\n| D | Date | Verdict | With | Text |\n|---|---|---|---|---|\n${flag.filter(o => o.conf < 0.7).map(row).join("\n") || "| — | | | | |"}\n\n## Consistent (${out.filter(o => o.verdict === "consistent").length})\n\n${out.filter(o => o.verdict === "consistent").map(o => `${o.id} ${o.conf}`).join(" · ")}\n`;
fs.writeFileSync(P("docs", "reports", `decisions-audit-${day}.md`), md); fs.writeFileSync(P("docs", "reports", `decisions-audit-${day}.json`), JSON.stringify(out, null, 1));
console.log(`\n${out.length} judged: consistent ${out.filter(o => o.verdict === "consistent").length} · flagged ${flag.length} (decisive ${flag.filter(o => o.conf >= 0.7).length}) · errors ${out.filter(o => o.verdict === "error").length}`);
