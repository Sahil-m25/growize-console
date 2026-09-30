// calibrate [type …] [--dry]: run each question type's known-answer control set (jev/calibration/<type>.json), report accuracy,
// pick the threshold, and write jev/calibration/thresholds.json (D107 / M19-S13-H5). A type under its floor is untrusted.
//   threshold (choice types): the lowest t on a 0.50…0.95 grid where answers at confidence ≥ t are right at least `target`
//     of the time AND cover at least a third of the set (a set under MIN_N = 30 controls may not go below the default);
//     none → the type keeps its default and is untrusted.
//   trusted: overall accuracy ≥ floor and a threshold was found.
//   pick-control / judge-fact: thresholds stay fixed by D63 (STEP_MIN 0.60, PASS_AT 0.80); calibration only checks them
//     (pick: right ≥ 95% at ≥ 0.60; judge: near-miss false passes ≤ 1% and no seeded-wrong fact at ≥ 0.80).
// cost-if-wrong has no control set: it is a tie-break for ordering, never a gate.
import fs from "node:fs";
import { jev, P, flag, spent } from "./common.mjs"; import { q } from "../questions/index.mjs"; import { ground, sources } from "../ground.mjs";
import { DEFAULTS } from "../policy.mjs";
import { decideOne } from "./decide.mjs"; import { stateOf as rulingState } from "./rulings.mjs";
import { stateOf as auditState, related } from "./decisions-audit.mjs"; import { stateOf as buildState } from "./build-audit.mjs";
import { groundCase } from "./triage.mjs";
import { queue, progress } from "../../autopilot/lib.mjs";

export const SPEC = {
  decide: { target: 0.95, floor: 0.85 }, ruling: { target: 0.9, floor: 0.7 }, "triage-class": { target: 0.9, floor: 0.7 },
  relevance: { target: 0.9, floor: 0.8 }, "decisions-audit": { target: 0.9, floor: 0.7 }, "build-audit": { target: 0.9, floor: 0.7 },
  "pick-control": { fixed: 0.6, target: 0.95 }, "judge-fact": { fixed: 0.8, maxFalsePass: 0.01 },
};
export const MIN_N = 30;
const load = t => { try { return JSON.parse(fs.readFileSync(P("jev", "calibration", `${t}.json`), "utf8")); } catch { return null; } };
const conf = a => +(a?.confidence ?? a?.probabilities?.[a?.choice] ?? 0);

/** Pure: threshold and trust from rows [{right, conf}] */
export function choose(rows, { target, floor, fixed }, dflt) {
  const n = rows.length, acc = n ? rows.filter(r => r.right).length / n : 0;
  const at = t => { const xs = rows.filter(r => r.conf >= t); return { t, cover: n ? xs.length / n : 0, prec: xs.length ? xs.filter(r => r.right).length / xs.length : 0, k: xs.length }; };
  if (fixed !== undefined) { const a = at(fixed); return { n, accuracy: +acc.toFixed(3), threshold: fixed, fixed: true, precision: +a.prec.toFixed(3), coverage: +a.cover.toFixed(3), trusted: a.prec >= target }; }
  const grid = [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95].map(at);
  // a set under MIN_N controls may confirm or raise the default threshold, never lower it
  const ok = grid.find(g => g.prec >= target && g.cover >= 1 / 3 && (n >= MIN_N || g.t >= dflt));
  const pick = ok || at(dflt);
  return { n, accuracy: +acc.toFixed(3), threshold: pick.t, precision: +pick.prec.toFixed(3), coverage: +pick.cover.toFixed(3), floor, trusted: !!ok && acc >= floor };
}

const RUN = {
  async decide(set) {
    return jev.pool(set, jev.limit, async x => { const r = await decideOne({ question: `${x.question} (${x.cite})`, options: x.options, facts: "" }, jev, {});
      return { id: x.cite, right: r.jev_choice === x.answer, conf: r.confidence, got: r.jev_choice, want: x.answer, policy: r.status }; });
  },
  async ruling(set) {
    return jev.pool(set.items, jev.limit, async x => { const { state } = rulingState({ kind: x.kind, story: x.story, text: x.note });
      const a = (await jev.ask(state, { ruling: q("ruling") }, { caller: "calibrate" })).ruling; return { id: x.note.slice(0, 40), right: a.choice === x.answer, conf: conf(a), got: a.choice, want: x.answer }; });
  },
  async "triage-class"(set) {
    return jev.pool(set.items, jev.limit, async x => { const st = { case: x.case, run: x.run, ...groundCase(x.case) };
      const a = (await jev.ask(st, { why: q("triage-class") }, { caller: "calibrate" })).why; return { id: x.id, right: a.choice === x.answer, conf: conf(a), got: a.choice, want: x.answer }; });
  },
  async relevance(set) {
    const Qd = queue("console");
    const rows = await jev.pool(set.items, jev.limit, async x => { const s = Qd.stories.find(y => y.id === x.story);
      const story = { id: s.id, title: s.title, phase: "Front end on demo data", as_a: s.as_a, i_want: s.i_want, so_that: s.so_that, acceptance: s.acceptance, prototype_pages: s.prototype, zoho: s.zoho };
      const text = x.file.replace(/^console\//, "console/") + "\n" + fs.readFileSync(P(x.file), "utf8").slice(0, 1500);
      const a = (await jev.ask({ story, candidate: text.slice(0, 1800) }, { rel: q("relevance") }, { caller: "calibrate" })).rel; return { id: `${x.story}→${x.file}`, p: a.score / 3, want: x.relevant }; });
    return rows;
  },
  async "decisions-audit"(set) {
    const S = sources(); const strip = t => t.replace(/\s*—\s*\*\*Superseded by[^*]*\*\*/i, "").trim();
    const rows = Object.values(S.rows).filter(r => !r.missing).map(r => ({ ...r, text: strip(r.text) })).sort((a, b) => a.n - b.n);
    return jev.pool(set.items, jev.limit, async x => { const d = rows.find(r => r.id === x.id); const { state, qs } = auditState(d, rows, S.rules);
      const a = (await jev.ask(state, { verdict: qs.verdict }, { caller: "calibrate" })).verdict; return { id: x.id, right: a.choice === x.answer, conf: conf(a), got: a.choice, want: x.answer, related: related(d, rows).map(r => r.id).join(" ") }; });
  },
  async "build-audit"(set) {
    const Qd = queue("console"), pr = progress("console");
    const notes = {}; for (const r of pr.rounds) if (r.note && r.story !== "REGRESSION") (notes[r.story] ||= []).push(`[${r.phase} ${r.status}] ${r.note}`);
    return jev.pool(set.items, jev.limit, async x => { const s = Qd.stories.find(y => y.id === x.story); const St = pr.stories[s.id] || {};
      const { state, qs } = buildState(s, { ...St, subtasks: pr.subtasks }, [...new Set(notes[s.id] || [St.note].filter(Boolean))].slice(-4));
      const a = (await jev.ask(state, { verdict: qs.verdict }, { caller: "calibrate" })).verdict; return { id: x.story, right: a.choice === x.answer, conf: conf(a), got: a.choice, want: x.answer }; });
  },
  async "pick-control"(set) {
    return jev.pool(set.items, jev.limit, async x => { const a = (await jev.ask(x.state, { pick: q("pick-control", { criteria: x.criteria }) }, { caller: "calibrate" })).pick;
      return { id: x.id, how: x.how, right: a.choice === x.answer, conf: conf(a), got: a.choice, want: x.answer }; });
  },
  async "judge-fact"(set) {
    return jev.pool(set.items, jev.limit, async x => { const a = (await jev.ask(set.cases[x.case], { f0: q("judge-fact", { fact: x.fact }) }, { caller: "calibrate" })).f0;
      const p = a.noul ?? a.probability; return { id: x.case, how: x.how, fact: x.fact, truth: x.truth, p, right: (p >= 0.8) === x.truth, conf: x.truth ? p : 1 - p }; });
  },
};

// --from <ui-results.json> --gate-out <file>: judge near-miss mutations of that run's passing facts and write them in the
// format console/scripts/jev-calibration-gate.mjs reads (all[].{id, how, original, fact, p}) — the D63 check for one run.
export async function gateFile(resultsFile, outFile) {
  const { build, mutate } = await import("../calibration/build-ui-sets.mjs");
  const res = JSON.parse(fs.readFileSync(resultsFile, "utf8"));
  const { judge } = build([{ results: res, debug: [] }]);
  const items = judge.items.filter(i => i.how !== "original" && i.how !== "seeded");
  const orig = {}; for (const r of res.results) for (const f of r.facts || []) for (const m of mutate(f.fact)) orig[r.id + "\u0000" + m.fact] = f.fact;
  const rows = await RUN["judge-fact"]({ cases: judge.cases, items });
  const all = rows.map((r, i) => ({ id: items[i].case, how: items[i].how, original: orig[items[i].case + "\u0000" + items[i].fact], fact: items[i].fact, p: r.p }));
  const fp = all.filter(x => x.p >= 0.8).length;
  fs.writeFileSync(outFile, JSON.stringify({ summary: { mutated: all.length, false_pass_at: { "0.8": `${fp}/${all.length}` } }, all }, null, 1));
  console.log(`gate calibration: ${fp}/${all.length} near-miss false passes at 0.80 → ${outFile}`);
}

export async function run(argv) {
  if (argv.includes("--from")) { await gateFile(argv[argv.indexOf("--from") + 1], argv[argv.indexOf("--gate-out") + 1] || "jev-gate-calibration.json"); console.log(spent()); return 0; }
  const want = argv.filter(a => !a.startsWith("--")); const dry = flag(argv, "--dry");
  const types = (want.length ? want : Object.keys(SPEC)).filter(t => SPEC[t]);
  const prev = (() => { try { return JSON.parse(fs.readFileSync(P("jev", "calibration", "thresholds.json"), "utf8")); } catch { return { types: {} }; } })();
  const table = { measured: new Date().toISOString().slice(0, 10), note: "Written by node jev/cli.mjs calibrate (D107). threshold = lowest confidence where answers are right ≥ target and cover ≥ 1/3 of the set (a set under 30 controls cannot go below the default); trusted = accuracy ≥ floor and a threshold was found. pick-control/judge-fact thresholds are fixed by D63.", types: { ...prev.types } };
  const detail = {};
  for (const t of types) {
    const set = load(t); if (!set) { console.log(`${t}: no control set (jev/calibration/${t}.json)`); continue; }
    const size = Array.isArray(set) ? set.length : set.items.length;
    if (dry) { console.log(`${t}: ${size} controls (dry)`); continue; }
    const rows = (await RUN[t](set)).map(r => r?.error ? { right: false, conf: 0, error: r.error } : r);
    detail[t] = rows;
    let res;
    if (t === "judge-fact") {
      const neg = rows.filter(r => r.truth === false), fp = neg.filter(r => r.p >= 0.8), seeded = neg.filter(r => r.how === "seeded");
      const tp = rows.filter(r => r.truth && r.p >= 0.8).length, pos = rows.filter(r => r.truth).length;
      res = { n: rows.length, accuracy: +(rows.filter(r => r.right).length / rows.length).toFixed(3), threshold: 0.8, fixed: true,
        true_pass: `${tp}/${pos}`, false_pass: `${fp.length}/${neg.length}`, seeded_caught: `${seeded.filter(r => r.p < 0.8).length}/${seeded.length}`,
        trusted: fp.length / Math.max(1, neg.length) <= SPEC[t].maxFalsePass && seeded.every(r => r.p < 0.8) };
    } else if (t === "relevance") {
      // relevance is a 0–3 score kept at score/3 ≥ cut: pick the cut with the best accuracy
      // (a set under MIN_N may not go below the default cut; ties keep the default)
      const cuts = [1 / 3, 0.5, 2 / 3].map(c => ({ c, acc: rows.filter(r => (r.p >= c) === r.want).length / rows.length }));
      const allowed = cuts.filter(x => rows.length >= MIN_N || x.c >= DEFAULTS.relevance - 1e-9);
      const best = allowed.reduce((m, x) => x.acc > m.acc || (x.acc === m.acc && Math.abs(x.c - DEFAULTS.relevance) < 1e-9) ? x : m);
      rows.forEach(r => { r.got = r.p >= best.c; r.right = r.got === r.want; r.conf = r.p; });
      res = { n: rows.length, accuracy: +best.acc.toFixed(3), threshold: +best.c.toFixed(2), cuts: Object.fromEntries(cuts.map(x => [x.c.toFixed(2), +x.acc.toFixed(3)])), floor: SPEC[t].floor, trusted: best.acc >= SPEC[t].floor };
    } else res = choose(rows, SPEC[t], DEFAULTS[t]);
    table.types[t] = res;
    const wrong = rows.filter(r => !r.right).slice(0, 12).map(r => `${r.id}${r.how ? "/" + r.how : ""}: got ${r.got ?? (r.p !== undefined ? r.p : r.error)} want ${r.want ?? r.truth} @${(r.conf ?? 0).toFixed(2)}`);
    console.log(`${t.padEnd(16)} n ${String(res.n).padStart(3)} · accuracy ${res.accuracy} · threshold ${res.threshold}${res.fixed ? " (fixed, D63)" : ""} · ${res.trusted ? "trusted" : "UNTRUSTED"}` +
      (res.cuts ? ` · accuracy by cut ${JSON.stringify(res.cuts)}` : res.false_pass ? ` · false passes ${res.false_pass} · true pass ${res.true_pass} · seeded caught ${res.seeded_caught}` : ` · precision ${res.precision} @ coverage ${res.coverage}`) + (wrong.length ? "\n    wrong: " + wrong.join("\n           ") : ""));
  }
  if (!dry) {
    fs.writeFileSync(P("jev", "calibration", "thresholds.json"), JSON.stringify(table, null, 1) + "\n");
    fs.writeFileSync(P("jev", "calibration", "last-run.json"), JSON.stringify({ at: new Date().toISOString(), stats: { ...jev.stats }, detail }, null, 1));
  }
  console.log(spent());
  return 0;
}
