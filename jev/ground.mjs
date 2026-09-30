// D107 / M19-S13-H2 — one grounding function: what governs a question, attached as Jev state.
// Sources (each unit-tested in jev/test/ground.test.mjs):
//   1. decisions it cites  — every D-number in the text → its row in docs/DECISIONS.md (CRLF-safe; D01 ≡ D1);
//                            a row marked "Superseded by Dx" brings Dx along
//   2. decisions by topic  — lexical top-k over DECISIONS.md rows, skipping rows marked "Superseded by"
//   3. the nine rules      — CLAUDE.md "## The nine rules", one string per rule
//   4. story acceptance    — the story cited (M##-S##) from autopilot/console/queue.json
//   5. seat table          — SEATCAPS in console/src/domain (seat → page → capabilities), when the text is about access
// Size cap: the stable-JSON size of the result stays under `cap` chars; truncation is deterministic
// (related from the lowest rank, then seats, then acceptance from the end, then decision text to 300 chars,
// then cited decisions from the last cited). The rules are never dropped.
import fs from "node:fs"; import path from "node:path";
import { ROOT, stable } from "./client.mjs";

const readText = (root, ...p) => { try { return fs.readFileSync(path.join(root, ...p), "utf8"); } catch { return ""; } };
export const norm = d => "D" + parseInt(String(d).slice(1), 10);

// 1/2 — DECISIONS.md rows: { D1: { id, n, text, date, superseded } }
export function decisionRows(src) {
  const rows = {};
  for (const l of String(src).split(/\r?\n/)) {
    const m = l.match(/^\|\s*\[?(D\d+)\]?(?:\([^)]*\))?\s*\|(.*)$/); if (!m) continue;
    const cells = m[2].replace(/\|\s*$/, "").split(" | ").map(x => x.trim());
    const id = norm(m[1]), text = cells[0] || "", date = cells.length > 1 ? cells[cells.length - 1] : "";
    const sup = text.match(/Superseded by ([^*)]*)/i);
    rows[id] = { id, n: +id.slice(1), text, date, superseded: !!sup, by: sup ? citedIn(sup[1]) : [], missing: /^\*No file exists/.test(text) };
  }
  return rows;
}
export const citedIn = text => [...new Set((String(text).match(/\bD\d{1,3}\b/g) || []).map(norm))];

const STOP = new Set("the a an and or of to in on for with from by is are be as at it this that when then given their them they not no any every each can may must into than only after before its our your his her who what which where while shows show should would could does do has have was were will one two three".split(" "));
export const words = t => (String(t).toLowerCase().match(/[a-z][a-z0-9_]{2,}/g) || []).filter(w => !STOP.has(w));
export function topical(text, rows, k = 5, exclude = []) {
  const ex = new Set(exclude.map(norm));
  const cands = Object.values(rows).filter(r => !r.superseded && !r.missing && !ex.has(r.id));
  const q = new Set(words(text)), N = cands.length || 1, df = {};
  const toks = cands.map(c => { const s = new Set(words(c.text)); for (const w of s) df[w] = (df[w] || 0) + 1; return s; });
  return cands.map((c, i) => ({ c, s: [...q].reduce((a, w) => a + (toks[i].has(w) ? Math.log(1 + N / df[w]) : 0), 0) }))
    .filter(x => x.s > 0).sort((a, b) => b.s - a.s || a.c.n - b.c.n).slice(0, k).map(x => x.c);
}

// 3 — the nine rules
export function nineRules(claudeMd) {
  const sec = (String(claudeMd).replace(/\r\n/g, "\n").split("## The nine rules")[1] || "").split("\n## ")[0];
  const out = []; let cur = null;
  for (const l of sec.split("\n")) {
    const m = l.match(/^(\d)\.\s+(.*)$/);
    if (m) { if (cur) out.push(cur); cur = `${m[1]}. ${m[2]}`; }
    else if (cur && /^\s{2,}\S/.test(l)) cur += " " + l.trim();
    else if (cur && !l.trim()) { out.push(cur); cur = null; }
  }
  if (cur) out.push(cur);
  return out.map(r => r.replace(/\*\*/g, "").replace(/\s+/g, " ").trim()).slice(0, 9);
}

// 4 — story acceptance
export function storyOf(queue, id) {
  const s = (queue?.stories || []).find(x => x.id === id); if (!s) return null;
  return { id: s.id, title: s.title, so_that: s.so_that, acceptance: s.acceptance || [], decisions: s.decisions || [] };
}

// 5 — seat table from the SEATCAPS literal
export function seatTable(src) {
  const body = (String(src).split(/export const SEATCAPS[^=]*=\s*\{/)[1] || "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const end = body.search(/\n\};/); const lit = end > -1 ? body.slice(0, end) : body;
  const out = {};
  for (const m of lit.matchAll(/(\w+)\s*:\s*\{([^{}]*)\}/g)) {
    const pages = [...m[2].matchAll(/(\w+)\s*:\s*\[([^\]]*)\]/g)].map(p => `${p[1]}:${p[2].replace(/["'\s]/g, "")}`);
    out[m[1]] = pages.join(" ") || "(no console pages)";
  }
  return out;
}
export function findSeatcaps(root) {
  const hits = [];
  const walk = d => { let es = []; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) { const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!/node_modules|\.next|__fixtures__/.test(e.name)) walk(p); }
      else if (/\.tsx?$/.test(e.name) && !/\.test\./.test(e.name)) { const t = fs.readFileSync(p, "utf8"); if (/export const SEATCAPS\b/.test(t)) hits.push(t); } } };
  walk(path.join(root, "console", "src"));
  return hits[0] || "";
}
const ACCESS = /\b(seats?|roles?|profiles?|access|grant\w*|capabilit\w*|pages?|rail|menu|sharing|permission\w*|sign[- ]in)\b/i;

// Load the sources once per root.
const memo = new Map();
export function sources(root = ROOT) {
  if (memo.has(root)) return memo.get(root);
  let queue = null; try { queue = JSON.parse(readText(root, "autopilot", "console", "queue.json")); } catch {}
  const s = { rows: decisionRows(readText(root, "docs", "DECISIONS.md")), rules: nineRules(readText(root, "CLAUDE.md")), queue, seatSrc: null, root };
  memo.set(root, s); return s;
}

/**
 * ground(text, opts) → { state, cited, related, story, seats, dropped }
 * opts: root, story (id; default: first M##-S## in text), topK (5), seats ("auto" | true | false), rules (true),
 *       cap (12000 chars), extraCites (D-numbers to attach as cited, e.g. a story's own decisions)
 */
export function ground(text, opts = {}) {
  const S = opts.sources || sources(opts.root || ROOT);
  const cap = opts.cap ?? 12000, topK = opts.topK ?? 5;
  const storyId = opts.story === undefined ? (String(text).match(/\bM\d\d-S\d\d\b/) || [])[0] : opts.story;
  const story = storyId ? storyOf(S.queue, storyId) : null;
  // a cited row marked "Superseded by Dx" brings Dx with it, so the later ruling is in front of Jev too
  const direct = [...new Set([...citedIn(text), ...(opts.extraCites || []).map(norm)])].filter(d => S.rows[d]);
  const cited = [...new Set(direct.flatMap(d => [d, ...S.rows[d].by.filter(x => S.rows[x])]))];
  const related = topK ? topical(text, S.rows, topK, cited) : [];
  const wantSeats = opts.seats === true || (opts.seats !== false && ACCESS.test(String(text)));
  let seats = null;
  if (wantSeats) { if (S.seatSrc === null) S.seatSrc = findSeatcaps(S.root); seats = seatTable(S.seatSrc); if (!Object.keys(seats).length) seats = null; }

  const st = {
    decisions: Object.fromEntries(cited.map(d => [d, `${S.rows[d].text}${S.rows[d].date ? " (" + S.rows[d].date + ")" : ""}`])),
    related: Object.fromEntries(related.map(r => [r.id, `${r.text}${r.date ? " (" + r.date + ")" : ""}`])),
    rules: opts.rules === false ? undefined : S.rules,
    story: story ? { id: story.id, title: story.title, so_that: story.so_that, acceptance: [...story.acceptance] } : undefined,
    seats: seats || undefined,
  };
  const dropped = [];
  const size = () => stable(st).length;
  const relKeys = Object.keys(st.related);
  while (size() > cap && relKeys.length) { const k = relKeys.pop(); delete st.related[k]; dropped.push("related:" + k); }
  if (size() > cap && st.seats) { st.seats = undefined; dropped.push("seats"); }
  while (size() > cap && st.story?.acceptance.length) { st.story.acceptance.pop(); dropped.push("acceptance:" + st.story.acceptance.length); }
  if (size() > cap) for (const k of Object.keys(st.decisions)) if (st.decisions[k].length > 300) { st.decisions[k] = st.decisions[k].slice(0, 300) + "…"; dropped.push("trim:" + k); }
  const decKeys = Object.keys(st.decisions);
  while (size() > cap && decKeys.length) { const k = decKeys.pop(); delete st.decisions[k]; dropped.push("decision:" + k); }
  const state = {};
  for (const [k, v] of Object.entries(st)) if (v !== undefined && !(typeof v === "object" && !Array.isArray(v) && !Object.keys(v).length)) state[k] = v;
  return { state, cited: Object.keys(st.decisions), related: Object.keys(st.related), story: story?.id || null, seats: !!st.seats, dropped };
}
