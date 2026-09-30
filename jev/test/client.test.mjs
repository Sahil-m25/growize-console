// jev/client.mjs with a stubbed fetch: key lookup, retry, pool limit, content-hash cache, JSONL log.
import test from "node:test"; import assert from "node:assert/strict";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
import { createClient, findKey, hashOf, pool } from "../client.mjs";
import { q } from "../questions/index.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "jev-"));
const ok = (answers, usage = { input_tokens: 10, output_tokens: 2 }) => ({ ok: true, status: 200, json: async () => ({ model: "jev-test", answers, usage }), text: async () => "" });
const bad = s => ({ ok: false, status: s, json: async () => ({}), text: async () => "err " + s });
const ANS = { d: { type: "choice", choice: "a", confidence: 0.9, probabilities: { a: 0.9, b: 0.1 } } };

test("key lookup: env var, then TS_KEY_FILE, then <root>/.typesafe-key", () => {
  const d = tmp(); fs.writeFileSync(path.join(d, ".typesafe-key"), "root-key\n"); fs.writeFileSync(path.join(d, "k2"), " file-key ");
  assert.equal(findKey({ env: { TYPESAFE_API_KEY: "env-key" }, root: d }), "env-key");
  assert.equal(findKey({ env: { TS_KEY_FILE: path.join(d, "k2") }, root: d }), "file-key");
  assert.equal(findKey({ env: {}, root: d }), "root-key");
  assert.equal(findKey({ env: {}, root: tmp() }), null);
});

test("sends model, state and questions with the bearer key; hidden __def is not sent", async () => {
  let seen; const c = createClient({ key: "K", cacheDir: null, logFile: null, fetch: async (u, o) => { seen = { u, o }; return ok(ANS); } });
  const qs = { d: q("decide", { question: "Q?", options: { a: "x", b: "y" }, has: ["facts"] }) };
  const a = await c.ask({ facts: "f" }, qs);
  assert.deepEqual(a, ANS); assert.equal(seen.u, "https://api.typesafe.ai/v1/systemone"); assert.equal(seen.o.headers.Authorization, "Bearer K");
  const body = JSON.parse(seen.o.body); assert.equal(body.model, "jev-latest"); assert.deepEqual(body.state, { facts: "f" }); assert.equal(body.questions.d.__def, undefined);
});

test("retries 429 and 5xx and network errors, then succeeds", async () => {
  const seq = [bad(429), bad(503), "throw", ok(ANS)]; const waits = [];
  const c = createClient({ key: "K", cacheDir: null, logFile: null, sleep: async ms => waits.push(ms), backoffMs: 10, retries: 4,
    fetch: async () => { const x = seq.shift(); if (x === "throw") throw new Error("ECONNRESET"); return x; } });
  assert.deepEqual(await c.ask({}, { d: { type: "choice" } }), ANS);
  assert.deepEqual(waits, [10, 20, 30]); assert.equal(c.stats.calls, 1);
});

test("does not retry a 4xx other than 429; gives up after the retries", async () => {
  let n = 0; const c = createClient({ key: "K", cacheDir: null, logFile: null, sleep: async () => {}, fetch: async () => (n++, bad(401)) });
  await assert.rejects(c.ask({}, { d: {} }), /401/); assert.equal(n, 1);
  let m = 0; const c2 = createClient({ key: "K", cacheDir: null, logFile: null, sleep: async () => {}, retries: 2, fetch: async () => (m++, bad(500)) });
  await assert.rejects(c2.ask({}, { d: {} }), /500/); assert.equal(m, 3);
});

test("content-hash cache: same state + questions → cached answer, no second call; a version bump misses", async () => {
  const dir = tmp(); let n = 0; const c = createClient({ key: "K", cacheDir: dir, logFile: null, cache: true, fetch: async () => (n++, ok(ANS)) });
  const mk = () => ({ d: q("ruling") });
  await c.ask({ a: 1, b: 2 }, mk()); await c.ask({ b: 2, a: 1 }, mk());     // key order does not matter
  assert.equal(n, 1); assert.equal(c.stats.cached, 1);
  const bumped = mk(); Object.defineProperty(bumped.d, "__def", { value: { name: "ruling", version: 99 } });
  assert.notEqual(hashOf("jev-latest", {}, mk()), hashOf("jev-latest", {}, bumped));
  await c.ask({ a: 1, b: 2 }, bumped); assert.equal(n, 2);
});

test("JSONL log: caller, question name+version, choice, probabilities, tokens, cached flag", async () => {
  const d = tmp(), log = path.join(d, "calls.jsonl");
  const c = createClient({ key: "K", cacheDir: path.join(d, "c"), logFile: log, cache: true, fetch: async () => ok(ANS, { input_tokens: 123, output_tokens: 4 }) });
  await c.ask({ x: 1 }, { d: q("decide", { question: "Q?", options: { a: "x", b: "y" } }) }, { caller: "t" });
  await c.ask({ x: 1 }, { d: q("decide", { question: "Q?", options: { a: "x", b: "y" } }) }, { caller: "t" });
  await c.ask({ x: 2 }, { pick: { type: "choice" } }, { caller: "ui-runner", def: "pick-control@1" });
  const [a, b, r] = fs.readFileSync(log, "utf8").trim().split("\n").map(JSON.parse);
  assert.deepEqual(a.questions.d, { name: "decide", version: 2 }); assert.equal(a.answers.d.choice, "a"); assert.deepEqual(a.answers.d.probabilities, { a: 0.9, b: 0.1 });
  assert.equal(a.input_tokens, 123); assert.equal(a.cached, false); assert.equal(a.caller, "t");
  assert.equal(b.cached, true); assert.equal(b.input_tokens, 0);
  assert.deepEqual(r.questions.pick, { name: "pick-control", version: 1 });
  assert.equal(c.stats.input_tokens, 246);
});

test("the pool keeps at most `concurrency` calls in flight", async () => {
  let live = 0, peak = 0;
  const c = createClient({ key: "K", cacheDir: null, logFile: null, concurrency: 3, fetch: async () => { live++; peak = Math.max(peak, live); await new Promise(r => setTimeout(r, 5)); live--; return ok(ANS); } });
  await Promise.all(Array.from({ length: 12 }, (_, i) => c.ask({ i }, { d: {} })));
  assert.equal(peak, 3);
  const out = await pool([1, 2, 3, 4], 2, async x => { if (x === 3) throw new Error("boom"); return x * 2; });
  assert.deepEqual(out, [2, 4, { error: "boom" }, 8]);
});
