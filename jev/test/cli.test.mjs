// jev/cli.mjs pieces that need no network: argument parsing, decide through a stub client, calibration threshold choice.
import test from "node:test"; import assert from "node:assert/strict";
import { parse, decideOne } from "../commands/decide.mjs"; import { choose } from "../commands/calibrate.mjs"; import { items } from "../commands/rulings.mjs";
import { main } from "../cli.mjs";

test("decide argument parsing", () => {
  const x = parse(["Which?", "a=one", "b=two=2", "--state", "facts here", "--story", "M01-S01", "--bare"]);
  assert.deepEqual(x, { question: "Which?", options: { a: "one", b: "two=2" }, facts: "facts here", story: "M01-S01", bare: true });
});

test("decide grounds the question, and the policy overrides on the never-list", async () => {
  let sent; const stub = { ask: async (state, qs) => { sent = { state, qs }; return { d: { choice: "a", confidence: 0.95, probabilities: { a: 0.95, b: 0.05 } } }; } };
  const r = await decideOne({ question: "Where do farms live? (D15)", options: { a: "in Zoho", b: "outside" } }, stub, {});
  assert.equal(r.status, "OK"); assert.equal(r.choice, "a"); assert.ok(sent.state.decisions.D110); assert.ok(sent.state.rules.length === 9);
  assert.match(sent.qs.d.instructions, /`decisions`/);
  const o = await decideOne({ question: "Should the refund be 95%?", options: { a: "yes", b: "no" } }, stub, {});
  assert.equal(o.choice, "owner"); assert.equal(o.status, "OWNER");
  const b = await decideOne({ question: "Q (D15)?", options: { a: "x", b: "y" }, bare: true }, stub, {});
  assert.deepEqual(Object.keys(sent.state), ["facts"]); assert.equal(b.cited.length, 0);
});

test("calibration threshold: lowest grid value with precision ≥ target and coverage ≥ 1/3; small sets never go below the default", () => {
  const rows = [...Array.from({ length: 30 }, () => ({ right: true, conf: 0.9 })), { right: false, conf: 0.55 }, { right: false, conf: 0.52 }];
  const big = choose(rows, { target: 0.95, floor: 0.85 }, 0.7); assert.equal(big.threshold, 0.55); assert.ok(big.trusted);
  const small = choose(rows.slice(20), { target: 0.9, floor: 0.7 }, 0.7); assert.equal(small.threshold, 0.7);
  const bad = choose(Array.from({ length: 10 }, (_, i) => ({ right: i < 4, conf: 0.9 })), { target: 0.9, floor: 0.7 }, 0.7); assert.equal(bad.trusted, false);
  const fixed = choose(rows, { fixed: 0.8, target: 0.95 }, 0.8); assert.equal(fixed.threshold, 0.8); assert.ok(fixed.fixed);
});

test("rulings reads open and ticked P/FC lines", () => {
  const src = "- [ ] M01-S01-NOTE-1 (M01-S01) PROVISIONAL: kept X\r\n- [x] M02-S02-NOTE-1 (M02-S02) FACT CHANGE PROPOSED: case Y\n- [ ] other line";
  assert.deepEqual(items(src).map(i => [i.id, i.ticked, i.kind]), [["M01-S01-NOTE-1", false, "PROVISIONAL"], ["M02-S02-NOTE-1", true, "FACT CHANGE PROPOSED"]]);
});

test("cli: unknown command → 64", async () => { assert.equal(await main(["nope"]), 64); });
