// D106 (29 Sep 2026): re-judge every PROVISIONAL and FACT CHANGE PROPOSED line in BLOCKED.md with Jev, this time with the
// governing decisions (docs/DECISIONS.md rows it cites), the nine CLAUDE.md rules and the story's acceptance as `facts`,
// and sort them into confirm / reverse / owner so the owner rules on a short list. Writes docs/reports/rulings-<date>.md.
//   node autopilot/rulings.mjs [--limit N] [--dry]        key: .typesafe-key (never printed); log: autopilot/logs/jev.log
import fs from "node:fs";
import { P, queue, dir } from "./lib.mjs";
const argv = process.argv.slice(2), render = argv.includes("--render"), lim = argv.includes("--limit") ? +argv[argv.indexOf("--limit") + 1] : Infinity, dry = argv.includes("--dry");
const KEYF = [process.env.TS_KEY_FILE, P(".typesafe-key")].find(f => f && fs.existsSync(f));
if (!KEYF && !dry) { console.error("no TypeSafe key (.typesafe-key)"); process.exit(2); }
const KEY = KEYF ? fs.readFileSync(KEYF, "utf8").trim() : "";
let calls = 0, tokens = 0;
async function jev(state, questions) {
  for (let a = 0; ; a++) {
    try {
      const r = await fetch("https://api.typesafe.ai/v1/systemone", { method: "POST", headers: { Authorization: "Bearer " + KEY, "Content-Type": "application/json" }, body: JSON.stringify({ model: "jev-latest", state, questions }) });
      if (r.ok) { const j = await r.json(); calls++; tokens += j.usage?.input_tokens || 0; return j.answers; }
      if (r.status !== 429 && r.status < 500) throw new Error(r.status + " " + (await r.text()).slice(0, 200));
    } catch (e) { if (a === 3) throw e; }
    await new Promise(s => setTimeout(s, 1500 * (a + 1)));
  }
}
// sources
const DEC = {}; for (const l of fs.readFileSync(P("docs", "DECISIONS.md"), "utf8").split("\n")) { const m = l.match(/^\| \[(D\d+)\][^|]*\| ([^|]+)\|/); if (m) DEC[m[1]] = m[2].trim(); }
const CL = fs.readFileSync(P("CLAUDE.md"), "utf8"), RULES = (CL.split("## The nine rules")[1] || "").split("\n## ")[0].replace(/\s+/g, " ").slice(0, 3500);
const Qd = queue("console"), story = id => Qd.stories.find(s => s.id === id);
const items = [];
for (const l of fs.readFileSync(P(dir("console"), "BLOCKED.md"), "utf8").split("\n")) {
  const m = l.match(/^- \[( |x|X)\] (\S+) \((M\d\d-S\d\d)\) (PROVISIONAL|FACT CHANGE PROPOSED):\s*(.+)$/); if (!m) continue;
  items.push({ ticked: m[1] !== " ", id: m[2], story: m[3], kind: m[4], text: m[5].trim() });
}
const open = render ? [] : items.filter(i => !i.ticked).slice(0, lim);
console.error(`${items.length} items, ${open.length} open${dry ? " (dry: no Jev calls)" : ""}`);
const Q = {
  ruling: { type: "choice", instructions: "The build made `note` (a PROVISIONAL choice, or a proposed change to a test case's expected fact). Judge it against `decisions` (the rulings it cites, which govern), `rules` (the nine system rules) and `story` (what the story must achieve). Pick one.",
    criteria: { confirm: "The note follows the cited decisions and rules; the owner can simply tick it, and keeping it costs nothing later.",
                reverse: "The note contradicts a cited decision or rule, or the decisions clearly intend the other option; the build should change.",
                owner: "It hinges on money, licences, staffing, legal wording, data the owner alone knows, or a business preference no decision settles." } },
  cost: { type: "score", instructions: "If `note` is kept as built and later turns out wrong, how costly is the reversal?",
    criteria: ["A one-line code or copy change, no data touched.", "A day of rework or a test-suite change.", "Records or Zoho fields must be migrated.", "Money, legal paper or a signed document could already be wrong."] } };
const out = [];
const pool = async (xs, n, fn) => { let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < xs.length) await fn(xs[i++]); })); };
await pool(open, 4, async (it) => {
  const s = story(it.story), refs = [...new Set((it.text.match(/\bD\d+\b/g) || []).concat(s?.decisions || []))].filter(d => DEC[d]);
  const state = { note: `${it.kind}: ${it.text}`, decisions: Object.fromEntries(refs.map(d => [d, DEC[d]])), rules: RULES,
    story: s ? { id: s.id, title: s.title, so_that: s.so_that, acceptance: (s.acceptance || []).slice(0, 6) } : { id: it.story } };
  if (dry) { out.push({ ...it, refs, choice: "-", conf: 0, cost: 0 }); return; }
  try { const a = await jev(state, Q); out.push({ ...it, refs, choice: a.ruling.choice, conf: +a.ruling.confidence.toFixed(2), probs: a.ruling.probabilities, cost: +(((a.cost.score ?? a.cost.value ?? 0) / 3)).toFixed(2) }); }
  catch (e) { out.push({ ...it, refs, choice: "error", conf: 0, cost: 0, err: String(e.message || e) }); }
  process.stderr.write(".");
});
fs.mkdirSync(P("autopilot", "logs"), { recursive: true }); fs.appendFileSync(P("autopilot", "logs", "jev.log"), `${new Date().toISOString()}\trulings ${open.length} items\tcalls ${calls}\tinput_tokens ${tokens}\n`);
const day = new Date().toISOString().slice(0, 10), f = P("docs", "reports", `rulings-${day}.md`);
if (render) out.push(...JSON.parse(fs.readFileSync(P("docs", "reports", `rulings-${day}.json`), "utf8")));
const T = 0.7, grp = (k, lo = 0, hi = 2) => out.filter(o => o.choice === k && o.conf >= lo && o.conf < hi).sort((a, b) => b.conf - a.conf);
const undecided = out.filter(o => o.choice !== "owner" && o.choice !== "error" && o.conf < T).sort((a, b) => b.cost - a.cost);
const row = o => `| ${o.id} | ${o.kind === "PROVISIONAL" ? "P" : "FC"} | ${o.refs.join(" ") || "—"} | ${o.choice} ${o.conf} | ${o.cost} | ${o.text.replace(/\|/g, "/").slice(0, 220)} |`;
const sec = (title, why, rows) => `## ${title} (${rows.length})\n\n${why}\n\n| Note | Kind | Cites | Jev | Cost if wrong | Text |\n|---|---|---|---|---|---|\n${rows.map(row).join("\n") || "| — | | | | | |"}\n\n`;
const md = `# Rulings sheet — ${day}\n\nEvery open PROVISIONAL (P) and FACT CHANGE PROPOSED (FC) line in autopilot/console/BLOCKED.md, re-judged by Jev with the decisions it cites, the nine rules and the story's acceptance as facts (D106). For a P line, *confirm* = keep what was built; for an FC line, *confirm* = the test case is stale and should change, *reverse* = the case is right and the build should change. Jev = its pick and confidence; only picks at ${T} or above are treated as decisive. Cost if wrong = 0 (one-line fix) … 1 (money or signed paper could already be wrong). **To rule:** tick the line in BLOCKED.md to confirm; to reverse, write the new choice under the line (the loop picks it up next round). Jev sorts; you decide.\n\n` +
  sec("Reverse — decisive", "Jev is confident the note contradicts a cited decision or rule. Each becomes a fix unit once you agree.", grp("reverse", T)) +
  sec("Confirm — decisive", "Jev is confident the note follows the decisions it cites: one tick each.", grp("confirm", T)) +
  sec("Needs you — a business call", "Money, licences, staffing, legal wording, or facts only you hold. Sorted by Jev's confidence that it is yours.", grp("owner")) +
  sec("Undecided — read these yourself, highest cost first", "Jev leaned one way below " + T + ". Its lean is shown, but treat these as open.", undecided) +
  (grp("error").length ? sec("Not judged (API error)", "Re-run rulings.mjs.", grp("error")) : "") +
  `Counts: reverse (decisive) ${grp("reverse", T).length} · confirm (decisive) ${grp("confirm", T).length} · needs you ${grp("owner").length} · undecided ${undecided.length} · errors ${grp("error").length}. Jev calls ${calls}, input tokens ${tokens}.\n`;
fs.mkdirSync(P("docs", "reports"), { recursive: true }); fs.writeFileSync(f, md);
if (!render) fs.writeFileSync(P("docs", "reports", `rulings-${day}.json`), JSON.stringify(out, null, 1));
console.log(`wrote ${f}: reverse ${grp("reverse", T).length} · confirm ${grp("confirm", T).length} · owner ${grp("owner").length} · undecided ${undecided.length}`);
