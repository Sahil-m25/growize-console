// D101: Jev (TypeSafe System One) makes the autopilot's small judgments, so the model spends tokens on code, not on reading and deliberating.
//   node autopilot/jev.mjs context [STORY]      what to read for this story in this phase: prototype line ranges, code files, Zoho fields
//   node autopilot/jev.mjs triage <result.json> why each failed UI case failed, grouped into a fix list
//   node autopilot/jev.mjs decide "<question>" "<opt>=<meaning>" ... [--state "<facts>" | --state-file f]
//                                              pick one option; LOW CONFIDENCE means record it as PROVISIONAL in BLOCKED.md
// Key: TS_KEY_FILE or .typesafe-key at the repo root (never printed). Every call is logged to autopilot/logs/jev.log.
import fs from "node:fs"; import path from "node:path";
import { P, queue, progress, currentPhase, PHASES, phaseOf } from "./lib.mjs";
const KEYF = [process.env.TS_KEY_FILE, P(".typesafe-key")].find(f => f && fs.existsSync(f));
if (!KEYF) { console.error("no TypeSafe key (.typesafe-key)"); process.exit(2); }
const KEY = fs.readFileSync(KEYF, "utf8").trim();
let calls = 0, tokens = 0;
async function jev(state, questions) {
  for (let a = 0; ; a++) {
    try {
      const r = await fetch("https://api.typesafe.ai/v1/systemone", { method: "POST", headers: { Authorization: "Bearer " + KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "jev-latest", state, questions }) });
      if (r.ok) { const j = await r.json(); calls++; tokens += j.usage?.input_tokens || 0; return j.answers; }
      if (r.status !== 429 && r.status < 500) throw new Error(r.status + " " + (await r.text()).slice(0, 200));
    } catch (e) { if (a === 3) throw e; }
    await new Promise(s => setTimeout(s, 1500 * (a + 1)));
  }
}
const pool = async (items, n, fn) => { const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; try { out[k] = await fn(items[k]); } catch (e) { out[k] = { error: String(e.message || e) }; } } })); return out; };
const log = (what) => { fs.mkdirSync(P("autopilot", "logs"), { recursive: true }); fs.appendFileSync(P("autopilot", "logs", "jev.log"), `${new Date().toISOString()}\t${what}\tcalls ${calls}\tinput_tokens ${tokens}\n`); };
const STOP = new Set("the a an and or of to in on for with from by is are be as at it this that when then given their them they not no any every each can may must into than only after before its our your his her who what which where while shows show".split(" "));
const words = t => (t.toLowerCase().match(/[a-z][a-z0-9_]{2,}/g) || []).filter(w => !STOP.has(w));
function lexical(queryText, cands, k) {        // cheap first cut in code (BM25-like); Jev judges only the survivors
  const q = new Set(words(queryText)), N = cands.length, df = {};
  const toks = cands.map(c => { const s = new Set(words(c.text)); for (const w of s) df[w] = (df[w] || 0) + 1; return s; });
  return cands.map((c, i) => ({ c, s: [...q].reduce((a, w) => a + (toks[i].has(w) ? Math.log(1 + N / (df[w] || 1)) : 0), 0) + (c.boost || 0) }))
    .sort((a, b) => b.s - a.s).slice(0, k).map(x => x.c);
}
const REL = { type: "score", instructions: "How much does the developer building `story` (in `story.phase`) need to read `candidate` to do this work? Judge only this story and phase.",
  criteria: ["Unrelated to this story's screens, rules or data.", "Shares a word or topic, but the story would not use it.", "Useful background: nearby screen, shared helper or rule the story relies on.",
    "Must read: it is the screen, flow, rule, file or Zoho field this story builds or changes."] };

async function context(id) {
  const Qd = queue("console"), pr = progress("console"); const ph = currentPhase(Qd, pr);
  const s = id ? Qd.stories.find(x => x.id === id) : null; if (!s) { console.error("usage: jev.mjs context <STORY>"); process.exit(64); }
  const tasks = s.subtasks.filter(t => /^Autopilot/.test(t.doer) && phaseOf(t) === ph);
  const story = { id: s.id, title: s.title, phase: PHASES.names[ph], as_a: s.as_a, i_want: s.i_want, so_that: s.so_that, acceptance: s.acceptance,
    work_now: tasks.map(t => `${t.title}: ${t.detail}`), prototype_pages: s.prototype, zoho: s.zoho };
  const qtext = JSON.stringify(story);
  // prototype: one candidate per function, plus windows for markup between functions (base64 lines skipped)
  const L = fs.readFileSync(P("console", "prototype", "growize-console-merged.html"), "utf8").split("\n"); const proto = []; let st = 0, name = "markup";
  const flush = (end) => { if (end - st > 2) { const body = L.slice(st, end).filter(l => l.length < 3000).join("\n"); for (let a = 0; a < end - st; a += 150) proto.push({ kind: "prototype", start: st + a + 1, end: Math.min(end, st + a + 150), name, text: name + "\n" + body.split("\n").slice(a, a + 150).join("\n").slice(0, 1800) }); } };
  L.forEach((l, i) => { const m = l.match(/^\s{0,4}(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/); if (m) { flush(i); st = i; name = m[1]; } }); flush(L.length);
  const pages = (s.prototype || []).map(x => x.toLowerCase());
  for (const c of proto) if (pages.some(p => c.text.toLowerCase().includes(p))) c.boost = 1;
  // code: every source file under console/src (tests excluded)
  const code = []; const walk = d => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name);
    if (f.isDirectory()) { if (!/node_modules|__fixtures__|\.next/.test(f.name)) walk(p); } else if (/\.(tsx?|mjs|cjs)$/.test(f.name) && !/\.test\./.test(f.name)) code.push({ kind: "code", file: path.relative(P(), p).replace(/\\/g, "/"), text: path.relative(P(), p) + "\n" + fs.readFileSync(p, "utf8").slice(0, 1500) }); } };
  walk(P("console", "src"));
  // Zoho mapping rows
  const zoho = JSON.parse(fs.readFileSync(P("pm", "plan-merged", "zoho-field-mapping.json"), "utf8")).map(r => ({ kind: "zoho", row: r.slice(0, 5), text: r.slice(0, 5).join(" · ") + " " + JSON.stringify(r[6] || "").slice(0, 200) }));
  const pick = [...lexical(qtext, proto, 36), ...lexical(qtext, code, 24), ...(ph === "fe" ? lexical(qtext, zoho, 8) : lexical(qtext, zoho, 30))];
  const ans = await pool(pick, 8, c => jev({ story, candidate: c.text.slice(0, 1800) }, { rel: REL }));
  pick.forEach((c, i) => c.p = ans[i]?.rel ? ans[i].rel.score / 3 : 0);
  const top = (k, n) => pick.filter(c => c.kind === k && c.p >= 0.5).sort((a, b) => b.p - a.p).slice(0, n);
  const out = { story: s.id, phase: ph, at: new Date().toISOString(),
    prototype: top("prototype", 10).map(c => ({ lines: `${c.start}-${c.end}`, name: c.name, p: +c.p.toFixed(2) })),
    code: top("code", 8).map(c => ({ file: c.file, p: +c.p.toFixed(2) })),
    zoho: top("zoho", 12).map(c => ({ field: c.row.join(" · "), p: +c.p.toFixed(2) })) };
  const lines = out.prototype.reduce((a, c) => { const [x, y] = c.lines.split("-").map(Number); return a + y - x + 1; }, 0);
  out.note = `Read these first (prototype ${lines} of ${L.length} lines). Open other parts only if a gap remains.`;
  fs.mkdirSync(P("autopilot", "console", "context"), { recursive: true });
  fs.writeFileSync(P("autopilot", "console", "context", `${s.id}-${ph}.json`), JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out, null, 1)); log(`context ${s.id} ${ph}`);
}

const WHY = { type: "choice", instructions: "Why did this UI test case fail in the app? Use `case` (what a person does and should then see) and `run` (which control each step pressed, where it stopped, and which expected facts were judged false).",
  criteria: { control_missing: "A step needed a control, field or page the app does not have.", label_differs: "The right control exists but its visible wording differs from the step, so it was not matched.",
    behaviour_wrong: "The steps ran, but afterwards the screen does not show what is expected (missing message, wrong data, wrong page, action did nothing).",
    case_outdated: "The case asks for something a later decision deliberately changed, so the expectation itself is out of date.",
    harness: "The run broke before the app was really tested: sign-in step, fixture, timeout or a page error at load." } };
async function triage(file) {
  const res = JSON.parse(fs.readFileSync(file, "utf8")).results.filter(r => !r.expect_fail && r.verdict !== "PASS");
  const cases = Object.fromEntries(JSON.parse(fs.readFileSync(P("pm", "plan-merged", "ui-cases.json"), "utf8")).cases.map(c => [c.id, c]));
  const ans = await pool(res, 8, r => { const c = cases[r.id] || {};
    return jev({ case: { title: c.title, steps: c.steps, expected: c.expected }, run: { steps: (r.trace || []).map(t => ({ step: t.step, pressed: t.name || t.pick, problem: t.problem || null })),
      false_facts: (r.facts || []).filter(f => f.p < 0.8).map(f => f.fact), error: r.runError || (r.errors || []).join("; ") || null } }, { why: WHY }); });
  const groups = {};
  res.forEach((r, i) => { const a = ans[i]?.why; const k = !a ? "error" : a.confidence < 0.6 ? "unsure_look_yourself" : a.choice;
    const t = r.trace || []; const at = t.find(x => x.problem) || null;
    (groups[k] ||= []).push({ case: r.id, conf: a ? +a.confidence.toFixed(2) : null, at: at ? at.step : null, false_facts: (r.facts || []).filter(f => f.p < 0.8).map(f => f.fact).slice(0, 3) }); });
  const order = ["harness", "control_missing", "label_differs", "behaviour_wrong", "case_outdated", "unsure_look_yourself", "error"];
  const out = Object.fromEntries(order.filter(k => groups[k]).map(k => [k, groups[k]]));
  out.how_to_fix = { harness: "fix the run first (sign-in, fixture, load error); rerun before anything else", control_missing: "build the control as the prototype has it",
    label_differs: "use the prototype's exact wording", behaviour_wrong: "match the prototype's behaviour for that step",
    case_outdated: "do not change the case: write FACT CHANGE PROPOSED to BLOCKED.md", unsure_look_yourself: "read the result entry for these only" };
  console.log(JSON.stringify(out, null, 1)); log(`triage ${path.basename(file)} ${res.length} failed`);
}

async function decide(argv) {
  const i = argv.indexOf("--state"), f = argv.indexOf("--state-file");
  const state = { facts: i > -1 ? argv[i + 1] : f > -1 ? fs.readFileSync(argv[f + 1], "utf8").slice(0, 12000) : "" };
  const drop = new Set([i, f].filter(x => x > -1).flatMap(x => [x, x + 1])); const rest = argv.filter((_, k) => !drop.has(k));
  const [question, ...opts] = rest; const criteria = Object.fromEntries(opts.map(o => { const j = o.indexOf("="); return [o.slice(0, j), o.slice(j + 1)]; }));
  if (!question || opts.length < 2) { console.error('usage: jev.mjs decide "<question>" "a=meaning" "b=meaning" [--state "<facts>"]'); process.exit(64); }
  const a = (await jev(state, { d: { type: "choice", instructions: question + (state.facts ? " Use `facts`." : ""), criteria } })).d;
  console.log(JSON.stringify({ choice: a.choice, confidence: +a.confidence.toFixed(2), probabilities: a.probabilities }));
  if (a.confidence < 0.7) console.log(`LOW CONFIDENCE: build "${a.choice}" and record "PROVISIONAL: ${question} → ${a.choice}" with done.mjs --human`);
  log(`decide ${question.slice(0, 60)} → ${a.choice} ${a.confidence.toFixed(2)}`);
}

const [cmd, ...args] = process.argv.slice(2);
if (cmd === "context") await context(args[0]);
else if (cmd === "triage") await triage(args[0]);
else if (cmd === "decide") await decide(args);
else { console.error("usage: jev.mjs context <STORY> | triage <result.json> | decide \"<q>\" \"a=..\" \"b=..\" [--state ..]"); process.exit(64); }
