// jev/flake.mjs (M19-S08): the 7-day flip rule, quarantine, and the CI gate (a quarantined case is listed as failing and does not block).
import test from "node:test"; import assert from "node:assert/strict"; import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { flipsOf, plan, record, gate, loadQuarantine, run } from "../flake.mjs";
const E = (id, verdict, date) => ({ id, verdict, date });

test("flips: PASS<->not PASS across days; same-day re-runs are one reading", () => {
  assert.deepEqual(flipsOf([E("a", "PASS", "2026-10-01"), E("a", "REVIEW", "2026-10-02"), E("a", "PASS", "2026-10-03")]), ["2026-10-02", "2026-10-03"]);
  assert.deepEqual(flipsOf([E("a", "PASS", "2026-10-01"), E("a", "REVIEW", "2026-10-01"), E("a", "PASS", "2026-10-01")]), []);
  assert.deepEqual(flipsOf([E("a", "FAIL", "2026-10-01"), E("a", "REVIEW", "2026-10-02")]), []);   // not PASS both days: no flip
  assert.deepEqual(flipsOf([E("a", "PASS", "2026-10-01")]), []);
});
test("plan: two flips inside 7 days quarantine; two flips spread over 3 weeks do not; calibration cases are ignored", () => {
  const log = [E("a", "PASS", "2026-10-01"), E("a", "REVIEW", "2026-10-02"), E("b", "PASS", "2026-09-01"), E("b", "REVIEW", "2026-09-10"), E("cal", "FAIL", "2026-10-01")];
  const p = plan(log, [{ id: "a", verdict: "PASS", p: 0.9 }, { id: "b", verdict: "PASS", p: 0.9 }, { id: "cal", verdict: "PASS", p: 0.9, expect_fail: true }], "2026-10-03");
  assert.deepEqual(p.add.map(x => x.id), ["a"]); assert.equal(p.entries.length, 2);
});
test("record writes the log and quarantine.json with a fix-by date, once", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "flake-")); const log = path.join(d, "log.jsonl"), quarantine = path.join(d, "q.json");
  record([{ id: "a", verdict: "PASS" }], { date: "2026-10-01", log, quarantine });
  record([{ id: "a", verdict: "REVIEW" }], { date: "2026-10-02", log, quarantine });
  const r = record([{ id: "a", verdict: "PASS" }], { date: "2026-10-03", log, quarantine });
  assert.deepEqual(r.quarantined, ["a"]);
  const q = loadQuarantine(quarantine); assert.equal(q.cases.length, 1); assert.equal(q.cases[0].since, "2026-10-03"); assert.equal(q.cases[0].fix_by, "2026-10-17");
  assert.deepEqual(record([{ id: "a", verdict: "REVIEW" }], { date: "2026-10-04", log, quarantine }).quarantined, []);   // already on the list
  assert.equal(loadQuarantine(quarantine).cases.length, 1);
});
test("gate: a quarantined failing case is listed and does not block; others block; overdue is flagged", () => {
  const q = { cases: [{ id: "a", fix_by: "2026-10-17" }, { id: "z", fix_by: "2026-09-01" }] };
  const g = gate([{ id: "a", verdict: "REVIEW" }, { id: "b", verdict: "FAIL" }, { id: "c", verdict: "PASS" }, { id: "cal", verdict: "PASS", expect_fail: true }], q, "2026-10-05");
  assert.deepEqual(g.quarantined.map(r => r.id), ["a"]); assert.deepEqual(g.blocking.map(r => r.id), ["b"]); assert.deepEqual(g.overdue.map(c => c.id), ["z"]);
  assert.equal(gate([{ id: "a", verdict: "FAIL" }], q, "2026-10-05").blocking.length, 0);
});
test("CLI check: exit 0 when only quarantined cases fail (TC-E16-014), 1 when another does", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "flake-")); process.env.JEV_QUARANTINE = path.join(d, "q.json");
  fs.writeFileSync(process.env.JEV_QUARANTINE, JSON.stringify({ cases: [{ id: "a", since: "2026-10-01", fix_by: "2099-01-01" }] }));
  const f = path.join(d, "r.json"); fs.writeFileSync(f, JSON.stringify({ results: [{ id: "a", verdict: "REVIEW", p: 0.7 }, { id: "c", verdict: "PASS" }] }));
  try { assert.equal(run(["check", f]), 0); fs.writeFileSync(f, JSON.stringify({ results: [{ id: "a", verdict: "REVIEW" }, { id: "b", verdict: "FAIL" }] })); assert.equal(run(["check", f]), 1); }
  finally { delete process.env.JEV_QUARANTINE; }
});
