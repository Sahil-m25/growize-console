// context <STORY>: what to read for this story in this phase — prototype line ranges, code files, Zoho fields (D101).
import fs from "node:fs"; import path from "node:path";
import { jev, P, spent } from "./common.mjs"; import { q } from "../questions/index.mjs"; import { apply } from "../policy.mjs";
import { queue, progress, currentPhase, PHASES, phaseOf } from "../../autopilot/lib.mjs";
import { words } from "../ground.mjs";
function lexical(queryText, cands, k) {        // cheap first cut in code (BM25-like); Jev judges only the survivors
  const qs = new Set(words(queryText)), N = cands.length, df = {};
  const toks = cands.map(c => { const s = new Set(words(c.text)); for (const w of s) df[w] = (df[w] || 0) + 1; return s; });
  return cands.map((c, i) => ({ c, s: [...qs].reduce((a, w) => a + (toks[i].has(w) ? Math.log(1 + N / (df[w] || 1)) : 0), 0) + (c.boost || 0) }))
    .sort((a, b) => b.s - a.s).slice(0, k).map(x => x.c);
}
export async function run([id]) {
  const Qd = queue("console"), pr = progress("console"); const ph = currentPhase(Qd, pr);
  const s = id ? Qd.stories.find(x => x.id === id) : null; if (!s) { console.error("usage: jev/cli.mjs context <STORY>"); return 64; }
  const tasks = s.subtasks.filter(t => /^Autopilot/.test(t.doer) && phaseOf(t) === ph);
  const story = { id: s.id, title: s.title, phase: PHASES.names[ph], as_a: s.as_a, i_want: s.i_want, so_that: s.so_that, acceptance: s.acceptance,
    work_now: tasks.map(t => `${t.title}: ${t.detail}`), prototype_pages: s.prototype, zoho: s.zoho };
  const qtext = JSON.stringify(story);
  const L = fs.readFileSync(P("console", "prototype", "growize-console-merged.html"), "utf8").split("\n"); const proto = []; let st = 0, name = "markup";
  const flush = (end) => { if (end - st > 2) { const body = L.slice(st, end).filter(l => l.length < 3000).join("\n"); for (let a = 0; a < end - st; a += 150) proto.push({ kind: "prototype", start: st + a + 1, end: Math.min(end, st + a + 150), name, text: name + "\n" + body.split("\n").slice(a, a + 150).join("\n").slice(0, 1800) }); } };
  L.forEach((l, i) => { const m = l.match(/^\s{0,4}(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/); if (m) { flush(i); st = i; name = m[1]; } }); flush(L.length);
  const pages = (s.prototype || []).map(x => x.toLowerCase());
  for (const c of proto) if (pages.some(p => c.text.toLowerCase().includes(p))) c.boost = 1;
  const code = []; const walk = d => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name);
    if (f.isDirectory()) { if (!/node_modules|__fixtures__|\.next/.test(f.name)) walk(p); } else if (/\.(tsx?|mjs|cjs)$/.test(f.name) && !/\.test\./.test(f.name)) code.push({ kind: "code", file: path.relative(P(), p).replace(/\\/g, "/"), text: path.relative(P(), p) + "\n" + fs.readFileSync(p, "utf8").slice(0, 1500) }); } };
  walk(P("console", "src"));
  const zoho = JSON.parse(fs.readFileSync(P("pm", "plan-merged", "zoho-field-mapping.json"), "utf8")).map(r => ({ kind: "zoho", row: r.slice(0, 5), text: r.slice(0, 5).join(" · ") + " " + JSON.stringify(r[6] || "").slice(0, 200) }));
  const pick = [...lexical(qtext, proto, 36), ...lexical(qtext, code, 24), ...(ph === "fe" ? lexical(qtext, zoho, 8) : lexical(qtext, zoho, 30))];
  const ans = await jev.pool(pick, jev.limit, c => jev.ask({ story, candidate: c.text.slice(0, 1800) }, { rel: q("relevance") }, { caller: "context" }));
  pick.forEach((c, i) => { c.p = ans[i]?.rel ? ans[i].rel.score / 3 : 0; c.pol = apply("relevance", { choice: "keep", confidence: c.p }); });
  const top = (k, n) => pick.filter(c => c.kind === k && c.p >= c.pol.threshold).sort((a, b) => b.p - a.p).slice(0, n);
  const out = { story: s.id, phase: ph, at: new Date().toISOString(),
    prototype: top("prototype", 10).map(c => ({ lines: `${c.start}-${c.end}`, name: c.name, p: +c.p.toFixed(2) })),
    code: top("code", 8).map(c => ({ file: c.file, p: +c.p.toFixed(2) })),
    zoho: top("zoho", 12).map(c => ({ field: c.row.join(" · "), p: +c.p.toFixed(2) })) };
  const lines = out.prototype.reduce((a, c) => { const [x, y] = c.lines.split("-").map(Number); return a + y - x + 1; }, 0);
  out.note = `Read these first (prototype ${lines} of ${L.length} lines). Open other parts only if a gap remains.`;
  if (pick[0] && !pick[0].pol.trusted) out.note = "REVIEW: relevance is untrusted (under its calibration floor) — treat this list as a hint. " + out.note;
  fs.mkdirSync(P("autopilot", "console", "context"), { recursive: true });
  fs.writeFileSync(P("autopilot", "console", "context", `${s.id}-${ph}.json`), JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out, null, 1)); console.error(spent());
  return 0;
}
