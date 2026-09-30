// Builds the pick-control and judge-fact control sets (D63 kind) from Jev UI runner output, so they can be re-measured
// by `node jev/cli.mjs calibrate` without a browser.
//   node jev/calibration/build-ui-sets.mjs <ui-results.json>[:<jev-ui-debug.log>] …
// Results come from `JEV_DEBUG=1 node pm/jev-ui-runner.mjs …` (the debug log holds the controls listed at each step).
// judge-fact: every fact of a PASS case (true, as D63's jev-calibrate took them), each seeded-wrong fact (false), and
//   deterministic near-miss mutations of the true facts (false): negation (shows ↔ does not show, offers ↔ does not offer)
//   and a changed number. Screens are stored once per case.
// pick-control: steps the runner resolved by exact label (answer known without Jev), steps Jev picked in cases that PASSed,
//   and a "none" control per label step with the right control removed.
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const cases = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(here, "..", "..", "pm", "plan-merged", "ui-cases.json"), "utf8")).cases.map(c => [c.id, c]));

export function mutate(fact) {
  const out = [];
  const neg = [[/\bdoes not show\b/, "shows"], [/\bdoes not offer\b/, "offers"], [/\bshows\b/, "does not show"], [/\boffers\b/, "does not offer"]];
  for (const [re, to] of neg) if (re.test(fact)) { out.push({ how: "negate", fact: fact.replace(re, to) }); break; }
  const n = fact.match(/\b(\d{1,6})\b/);
  if (n) out.push({ how: "number", fact: fact.replace(n[0], String(+n[1] + 7)) });
  return out.filter(m => m.fact !== fact);
}

export function build(inputs) {
  const judge = { cases: {}, items: [] }, pick = [];
  for (const { results, debug } of inputs) {
    for (const r of results.results) {
      const c = cases[r.id]; if (!c || !r.screen) continue;
      const state = { test: c.title, signed_in_as: c.seat || null, steps: r.trace.map(t => t.step), what_the_screen_shows: r.screen, step_trace: r.trace.map(({ step, name }) => ({ step, pressed: name })) };
      if (r.expect_fail) { judge.cases[r.id] = state; for (const f of r.facts) judge.items.push({ case: r.id, fact: f.fact, truth: false, how: "seeded" }); continue; }
      if (r.verdict !== "PASS") continue;
      judge.cases[r.id] = state;
      for (const f of r.facts) { judge.items.push({ case: r.id, fact: f.fact, truth: true, how: "original" }); for (const m of mutate(f.fact)) judge.items.push({ case: r.id, fact: m.fact, truth: false, how: m.how }); }
    }
    const byCase = {}; for (const l of debug) (byCase[l.case] ||= []).push(l);
    for (const r of results.results) {
      const dl = byCase[r.id] || []; const c = cases[r.id]; if (!c) continue;
      r.trace.forEach((t, i) => {
        const d = dl[i]; if (!d || d.step !== t.step) return;
        const state = { test: c.title, signed_in_as: c.seat || null, step: t.step, earlier_steps: r.trace.slice(0, i).map(x => x.step), screen_heading: "" };
        if (t.by === "label") {
          pick.push({ id: `${r.id}#${i}`, how: "label", state, criteria: d.criteria, answer: t.pick });
          const crit = { ...d.criteria }; delete crit[t.pick];
          const n = t.name && t.name.toLowerCase();   // remove every control with the same name so nothing else could do it
          for (const [k, v] of Object.entries(crit)) if (/^e\d+$/.test(k) && n && v.toLowerCase().includes(`"${n}"`)) delete crit[k];
          // …and from the row text of its neighbours: on a screen without the control, no row would mention it
          if (t.name) for (const k of Object.keys(crit)) if (/^e\d+$/.test(k)) crit[k] = crit[k].split(t.name).join("").replace(/\s{2,}/g, " ");
          pick.push({ id: `${r.id}#${i}-none`, how: "removed", state, criteria: crit, answer: "none" });
        } else if (r.verdict === "PASS" && t.pick && t.pick !== "none") pick.push({ id: `${r.id}#${i}`, how: "jev-pass", state, criteria: d.criteria, answer: t.pick });
      });
    }
  }
  // one item per distinct (step, controls on screen); at most CAP of each kind, taken at an even stride (deterministic)
  const seen = new Set(), uniq = pick.filter(p => { const k = p.how + "|" + p.state.step + "|" + JSON.stringify(p.criteria); if (seen.has(k)) return false; seen.add(k); return true; });
  const capped = ["label", "removed", "jev-pass"].flatMap(h => { const xs = uniq.filter(p => p.how === h), st = Math.max(1, Math.ceil(xs.length / CAP)); return xs.filter((_, i) => i % st === 0); });
  return { judge, pick: capped };
}
const CAP = 40;

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const inputs = process.argv.slice(2).map(a => { const [r, d] = a.split(":");
    return { results: JSON.parse(fs.readFileSync(r, "utf8")), debug: d ? fs.readFileSync(d, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l)) : [] }; });
  const { judge, pick } = build(inputs);
  fs.writeFileSync(path.join(here, "judge-fact.json"), JSON.stringify({ source: "Jev UI runner on console/prototype/growize-console-merged.html (D63 kind: PASS facts, seeded-wrong facts, near-miss mutations)", ...judge }));
  fs.writeFileSync(path.join(here, "pick-control.json"), JSON.stringify({ source: "Jev UI runner steps (label-resolved, Jev-picked in PASS cases, and none-controls)", items: pick }));
  const cnt = (xs, k) => xs.reduce((a, x) => (a[x[k]] = (a[x[k]] || 0) + 1, a), {});
  console.log("judge-fact", judge.items.length, cnt(judge.items, "how"), "cases", Object.keys(judge.cases).length, "· pick-control", pick.length, cnt(pick, "how"));
}
