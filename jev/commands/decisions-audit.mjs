// decisions-audit [--limit N]: is each docs/DECISIONS.md row still consistent with the nine rules and the later decisions on
// its topic (D108)? Related = rows that cite it by number, then lexical topic matches (later ones preferred), up to 8.
import fs from "node:fs";
import { jev, P, opt, spent } from "./common.mjs"; import { q } from "../questions/index.mjs"; import { sources, words, citedIn } from "../ground.mjs"; import { thresholds } from "../policy.mjs";
export function related(d, rows, k = 8) {
  const citers = rows.filter(x => x.id !== d.id && x.n > d.n && citedIn(x.text.replace(/Superseded by[^*]*/i, "")).includes(d.id));
  const qw = new Set(words(d.text));
  const lex = rows.filter(x => x.id !== d.id && !citers.includes(x)).map(x => ({ x, s: [...qw].filter(w => words(x.text).includes(w)).length + (x.n > d.n ? 0.5 : 0) }))
    .filter(o => o.s > 1).sort((a, b) => b.s - a.s || a.x.n - b.x.n).map(o => o.x);
  return [...citers, ...lex].slice(0, k);
}
export function stateOf(d, rows, rules) {
  const rel = related(d, rows);
  const state = { decision: `${d.id} (${d.date}): ${d.text}`, rules: rules.join(" "), related: Object.fromEntries(rel.map(x => [x.id, `(${x.date}) ${x.text}`])) };
  const qs = { verdict: q("decisions-audit") }; if (rel.length) qs.with = q("decisions-audit", { related: rel }, "with");
  return { state, qs, rel };
}
export async function run(argv) {
  const lim = argv.includes("--limit") ? +opt(argv, "--limit") : Infinity;
  const S = sources(); const rows = Object.values(S.rows).filter(r => !r.missing).sort((a, b) => a.n - b.n);
  const out = [];
  await jev.pool(rows.slice(0, lim), 4, async (d) => {
    const { state, qs, rel } = stateOf(d, rows, S.rules);
    try { const a = await jev.ask(state, qs, { caller: "decisions-audit" }); out.push({ id: d.id, n: d.n, text: d.text, date: d.date, verdict: a.verdict.choice, conf: +a.verdict.confidence.toFixed(2), probs: a.verdict.probabilities, with: a.with?.choice || "none", withConf: +(a.with?.confidence || 0).toFixed(2), related: rel.map(x => x.id) }); }
    catch (e) { out.push({ id: d.id, n: d.n, text: d.text, date: d.date, verdict: "error", conf: 0, err: String(e.message || e) }); }
    process.stderr.write(".");
  });
  out.sort((a, b) => a.n - b.n);
  const TH = thresholds()["decisions-audit"], T = TH.trusted ? TH.threshold : 2;
  const day = new Date().toISOString().slice(0, 10);
  const flagged = out.filter(o => o.verdict !== "consistent" && o.verdict !== "error").sort((a, b) => b.conf - a.conf);
  const row = o => `| ${o.id} | ${o.date} | ${o.verdict} ${o.conf} | ${o.with !== "none" ? o.with + " " + o.withConf : "—"} | ${o.text.replace(/\|/g, "/").slice(0, 200)} |`;
  const tbl = rows => `| D | Date | Verdict | With | Text |\n|---|---|---|---|---|\n${rows.map(row).join("\n") || "| — | | | | |"}`;
  const md = `# Decisions audit — ${day}\n\n${out.length} decisions from docs/DECISIONS.md, each judged by Jev against the nine rules and up to 8 related decisions (those citing it, then topic matches; later ones marked by date). Verdicts: consistent · superseded · contradicts_rule · contradicts_decision. Decisive = at or above ${TH.trusted ? T : "— (untrusted type: every flag is REVIEW)"}. Jev sorts; a person reads every flagged row. ${spent()}.\n\n## Flagged, decisive (${flagged.filter(o => o.conf >= T).length})\n\n${tbl(flagged.filter(o => o.conf >= T))}\n\n## Flagged, weak — REVIEW (${flagged.filter(o => o.conf < T).length})\n\n${tbl(flagged.filter(o => o.conf < T))}\n\n## Consistent (${out.filter(o => o.verdict === "consistent").length})\n\n${out.filter(o => o.verdict === "consistent").map(o => `${o.id} ${o.conf}`).join(" · ")}\n`;
  fs.writeFileSync(P("docs", "reports", `decisions-audit-${day}.md`), md); fs.writeFileSync(P("docs", "reports", `decisions-audit-${day}.json`), JSON.stringify(out, null, 1));
  console.log(`\n${out.length} judged: consistent ${out.filter(o => o.verdict === "consistent").length} · flagged ${flagged.length} (decisive ${flagged.filter(o => o.conf >= T).length}) · errors ${out.filter(o => o.verdict === "error").length}`);
  return 0;
}
