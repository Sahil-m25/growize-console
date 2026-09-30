// jev/questions: every definition is versioned, and pick-control / judge-fact are byte-identical to the UI runner's inline questions.
import test from "node:test"; import assert from "node:assert/strict"; import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
import { DEFS, q } from "../questions/index.mjs";
const runner = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "pm", "jev-ui-runner.mjs"), "utf8");

test("every definition has a name, type and integer version, and q() tags it (hidden) with both", () => {
  for (const name of ["pick-control", "judge-fact", "relevance", "triage-class", "decide", "ruling", "cost-if-wrong", "decisions-audit", "build-audit"]) {
    const d = DEFS[name]; assert.ok(d, name); assert.ok(Number.isInteger(d.version) && d.version >= 1, name);
    const x = q(name, { criteria: { none: "n" }, fact: "f", question: "Q?", options: { a: "x", b: "y" } });
    assert.equal(x.type, d.type, name); assert.deepEqual(x.__def, { name, version: d.version }); assert.ok(!Object.keys(x).includes("__def"));
  }
  assert.deepEqual(q("decisions-audit", { related: [{ id: "D2", text: "t" }] }, "with").__def, { name: "decisions-audit.with", version: 1 });
  assert.throws(() => q("nope"));
});

test("pick-control is the runner's question, verbatim", () => {
  const x = q("pick-control", { criteria: { none: "n" } });
  assert.ok(runner.includes(`{ pick: { type: "choice", instructions: ${JSON.stringify(x.instructions)}, criteria } }`));
});

test("judge-fact is the runner's question, verbatim", () => {
  const x = q("judge-fact", { fact: "__FACT__" });
  const tpl = "`" + x.instructions.replace("__FACT__", "${f}").replace(/`/g, "\\`").replace("\\`steps\\`", "\\`steps\\`") + "`";
  assert.ok(runner.includes("instructions: " + tpl), "instructions differ");
  assert.ok(runner.includes(`criteria: ${JSON.stringify(x.criteria).replace(/"(\w+)":/g, "$1: ").replace(/,(\w)/g, ", $1").replace(/^\{/, "{ ").replace(/\}$/, " }")}`), "criteria differ");
});

test("decide names only the state parts it was given", () => {
  const x = q("decide", { question: "Q?", options: { a: "x", b: "y" }, has: ["facts", "rules"] });
  assert.match(x.instructions, /`facts`/); assert.match(x.instructions, /`rules`/); assert.doesNotMatch(x.instructions, /`decisions`/);
  assert.deepEqual(x.criteria, { a: "x", b: "y" });
});
