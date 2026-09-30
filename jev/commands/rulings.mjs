// rulings [--limit N] [--dry] [--render]: re-judge every open PROVISIONAL / FACT CHANGE PROPOSED line in BLOCKED.md with the
// decisions it cites, the nine rules and the story's acceptance (D106). Writes docs/reports/rulings-<date>.md (+ .json).
import fs from "node:fs";
import { jev, P, flag, opt, spent } from "./common.mjs"; import { q } from "../questions/index.mjs"; import { ground, sources } from "../ground.mjs"; import { thresholds } from "../policy.mjs";
export function items(src) {
  const out = [];
  for (const l of String(src).split(/\r?\n/)) {
    const m = l.match(/^- \[( |x|X)\] (\S+) \((M\d\d-S\d\d)\) (PROVISIONAL|FACT CHANGE PROPOSED):\s*(.+)$/); if (!m) continue;
    out.push({ ticked: m[1] !== " ", id: m[2], story: m[3], kind: m[4], text: m[5].trim() });
  }
  return out;
}
export const stateOf = (it) => {
  const sd = (sources().queue?.stories || []).find(s => s.id === it.story)?.decisions || [];
  const g = ground(it.text, { story: it.story, topK: 0, seats: false, extraCites: sd });
  const st = { note: `${it.kind}: ${it.text}`, decisions: g.state.decisions || {}, rules: g.state.rules, story: g.state.story ? { ...g.state.story, acceptance: g.state.story.acceptance.slice(0, 6) } : { id: it.story } };
  return { state: st, refs: g.cited };
};
export async function run(argv) {
  const render = flag(argv, "--render"), dry = flag(argv, "--dry"), lim = argv.includes("--limit") ? +opt(argv, "--limit") : Infinity;
  const all = items(fs.readFileSync(P("autopilot", "console", "BLOCKED.md"), "utf8"));
  const open = render ? [] : all.filter(i => !i.ticked).slice(0, lim);
  console.error(`${all.length} items, ${open.length} open${dry ? " (dry: no Jev calls)" : ""}`);
  const out = [];
  await jev.pool(open, 4, async (it) => {
    const { state, refs } = stateOf(it);
    if (dry) { out.push({ ...it, refs, choice: "-", conf: 0, cost: 0 }); return; }
    try { const a = await jev.ask(state, { ruling: q("ruling"), cost: q("cost-if-wrong") }, { caller: "rulings" });
      out.push({ ...it, refs, choice: a.ruling.choice, conf: +a.ruling.confidence.toFixed(2), probs: a.ruling.probabilities, cost: +(((a.cost.score ?? a.cost.value ?? 0) / 3)).toFixed(2) }); }
    catch (e) { out.push({ ...it, refs, choice: "error", conf: 0, cost: 0, err: String(e.message || e) }); }
    process.stderr.write(".");
  });
  const day = new Date().toISOString().slice(0, 10), f = P("docs", "reports", `rulings-${day}.md`);
  if (render) out.push(...JSON.parse(fs.readFileSync(P("docs", "reports", `rulings-${day}.json`), "utf8")));
  const TH = thresholds().ruling, T = TH.trusted ? TH.threshold : 2;   // untrusted: nothing is decisive, every lean is PROVISIONAL
  const grp = (k, lo = 0, hi = 2) => out.filter(o => o.choice === k && o.conf >= lo && o.conf < hi).sort((a, b) => b.conf - a.conf);
  const undecided = out.filter(o => o.choice !== "owner" && o.choice !== "error" && o.conf < T).sort((a, b) => b.cost - a.cost);
  const row = o => `| ${o.id} | ${o.kind === "PROVISIONAL" ? "P" : "FC"} | ${o.refs.join(" ") || "—"} | ${o.choice} ${o.conf} | ${o.cost} | ${o.text.replace(/\|/g, "/").slice(0, 220)} |`;
  const sec = (title, why, rows) => `## ${title} (${rows.length})\n\n${why}\n\n| Note | Kind | Cites | Jev | Cost if wrong | Text |\n|---|---|---|---|---|---|\n${rows.map(row).join("\n") || "| — | | | | | |"}\n\n`;
  const tlabel = TH.trusted ? String(T) : "— (ruling is untrusted: nothing is decisive)";
  const md = `# Rulings sheet — ${day}\n\nEvery open PROVISIONAL (P) and FACT CHANGE PROPOSED (FC) line in autopilot/console/BLOCKED.md, re-judged by Jev with the decisions it cites, the nine rules and the story's acceptance as facts (D106; one Jev layer, D107). For a P line, *confirm* = keep what was built; for an FC line, *confirm* = the test case is stale and should change, *reverse* = the case is right and the build should change. Jev = its pick and confidence; only picks at ${tlabel} or above are treated as decisive (jev/calibration/thresholds.json). Cost if wrong = 0 (one-line fix) … 1 (money or signed paper could already be wrong). **To rule:** tick the line in BLOCKED.md to confirm; to reverse, write the new choice under the line (the loop picks it up next round). Jev sorts; you decide.\n\n` +
    sec("Reverse — decisive", "Jev is confident the note contradicts a cited decision or rule. Each becomes a fix unit once you agree.", grp("reverse", T)) +
    sec("Confirm — decisive", "Jev is confident the note follows the decisions it cites: one tick each.", grp("confirm", T)) +
    sec("Needs you — a business call", "Money, licences, staffing, legal wording, or facts only you hold. Sorted by Jev's confidence that it is yours.", grp("owner")) +
    sec("Undecided — read these yourself, highest cost first", "Jev leaned one way below the threshold. Its lean is shown, but treat these as open.", undecided) +
    (grp("error").length ? sec("Not judged (API error)", "Re-run `node jev/cli.mjs rulings`.", grp("error")) : "") +
    `Counts: reverse (decisive) ${grp("reverse", T).length} · confirm (decisive) ${grp("confirm", T).length} · needs you ${grp("owner").length} · undecided ${undecided.length} · errors ${grp("error").length}. ${spent()}.\n`;
  fs.mkdirSync(P("docs", "reports"), { recursive: true }); fs.writeFileSync(f, md);
  if (!render) fs.writeFileSync(P("docs", "reports", `rulings-${day}.json`), JSON.stringify(out, null, 1));
  console.log(`wrote ${f}: reverse ${grp("reverse", T).length} · confirm ${grp("confirm", T).length} · owner ${grp("owner").length} · undecided ${undecided.length}`);
  return 0;
}
