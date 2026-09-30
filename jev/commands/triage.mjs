// triage <result.json>: why each failed UI case failed, grouped into a fix list (D101).
import fs from "node:fs"; import path from "node:path";
import { jev, P, spent } from "./common.mjs"; import { q } from "../questions/index.mjs"; import { apply } from "../policy.mjs"; import { ground } from "../ground.mjs";
// D107: the case is grounded by topic (up to 3 decisions in force), so case_outdated can be seen against a later decision.
export const stateOf = (r, c = {}) => {
  const st = { case: { title: c.title, steps: c.steps, expected: c.expected }, run: { steps: (r.trace || []).map(t => ({ step: t.step, pressed: t.name || t.pick, problem: t.problem || null })),
    false_facts: (r.facts || []).filter(f => f.p < 0.8).map(f => f.fact), error: r.runError || (r.errors || []).join("; ") || null } };
  return { ...st, ...groundCase(c) };
};
export function groundCase(c = {}) {
  const g = ground([c.title, ...(c.expected || [])].join(" "), { story: null, topK: 3, rules: false, seats: false });
  return g.related.length ? { decisions_in_force: g.state.related } : {};
}
export async function run([file]) {
  if (!file) { console.error("usage: jev/cli.mjs triage <result.json>"); return 64; }
  const res = JSON.parse(fs.readFileSync(file, "utf8")).results.filter(r => !r.expect_fail && r.verdict !== "PASS");
  const cases = Object.fromEntries(JSON.parse(fs.readFileSync(P("pm", "plan-merged", "ui-cases.json"), "utf8")).cases.map(c => [c.id, c]));
  const ans = await jev.pool(res, jev.limit, r => jev.ask(stateOf(r, cases[r.id]), { why: q("triage-class") }, { caller: "triage" }));
  const groups = {}; let untrusted = false;
  res.forEach((r, i) => { const a = ans[i]?.why; const pol = a && apply("triage-class", a); if (pol && !pol.trusted) untrusted = true;
    const k = !a ? "error" : pol.status !== "OK" && pol.trusted ? "unsure_look_yourself" : a.choice;
    const t = r.trace || []; const at = t.find(x => x.problem) || null;
    (groups[k] ||= []).push({ case: r.id, conf: a ? +a.confidence.toFixed(2) : null, ...(pol && !pol.trusted ? { status: "REVIEW" } : {}), at: at ? at.step : null, false_facts: (r.facts || []).filter(f => f.p < 0.8).map(f => f.fact).slice(0, 3) }); });
  const order = ["harness", "control_missing", "label_differs", "behaviour_wrong", "case_outdated", "unsure_look_yourself", "error"];
  const out = Object.fromEntries(order.filter(k => groups[k]).map(k => [k, groups[k]]));
  if (untrusted) out.note = "REVIEW: triage-class is untrusted (under its calibration floor) — every group is a hint; read the result entries.";
  out.how_to_fix = { harness: "fix the run first (sign-in, fixture, load error); rerun before anything else", control_missing: "build the control as the prototype has it",
    label_differs: "use the prototype's exact wording", behaviour_wrong: "match the prototype's behaviour for that step",
    case_outdated: "do not change the case: write FACT CHANGE PROPOSED to BLOCKED.md", unsure_look_yourself: "read the result entry for these only" };
  console.log(JSON.stringify(out, null, 1)); console.error(`triage ${path.basename(file)} ${res.length} failed · ${spent()}`);
  return 0;
}
