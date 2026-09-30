// D107 / M19-S13-H1 — the one Jev client for the build workflow (never product runtime).
// Jev = TypeSafe System One: POST https://api.typesafe.ai/v1/systemone {model, state, questions} → {answers, usage}.
// One code path for: key lookup, retry on 429/5xx/network, a concurrency pool, a content-hash cache
// (same model + state + questions + question versions → the cached answer) and a JSONL log per call
// (jev/logs/calls.jsonl: caller, question type + version, choice, probabilities, score/noul, tokens, cached).
//
//   import { createClient, jev } from "../jev/client.mjs";
//   const a = await jev.ask(state, questions, { caller: "decide" });      // → answers
//
// Questions built by jev/questions/*.mjs carry a hidden (non-enumerable) __def {name, version}; it is logged and
// hashed but never sent. Env: TYPESAFE_API_KEY | TS_KEY_FILE | <repo>/.typesafe-key (never printed);
// JEV_CACHE=0 turns the cache off; JEV_POOL sets the concurrency (default 8).
import fs from "node:fs"; import path from "node:path"; import crypto from "node:crypto"; import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const URL = "https://api.typesafe.ai/v1/systemone";
export const MODEL = "jev-latest";

export function findKey({ env = process.env, root = ROOT, exists = fs.existsSync, read = f => fs.readFileSync(f, "utf8") } = {}) {
  if (env.TYPESAFE_API_KEY) return env.TYPESAFE_API_KEY.trim();
  const f = [env.TS_KEY_FILE, path.join(root, ".typesafe-key")].find(x => x && exists(x));
  return f ? read(f).trim() : null;
}

// Stable JSON (sorted keys) so the cache key does not depend on property order.
export const stable = v => Array.isArray(v) ? `[${v.map(stable).join(",")}]`
  : v && typeof v === "object" ? `{${Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => JSON.stringify(k) + ":" + stable(v[k])).join(",")}}`
  : JSON.stringify(v);
export const defsOf = questions => Object.fromEntries(Object.entries(questions).map(([k, q]) => [k, q.__def || { name: "ad-hoc:" + (q.type || "?"), version: 0 }]));
export const hashOf = (model, state, questions) => crypto.createHash("sha256").update(stable({ model, state, questions, defs: defsOf(questions) })).digest("hex");

// Pool helper: run fn over items with at most n in flight; a thrown item becomes {error}.
export async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, async () => {
    while (i < items.length) { const k = i++; try { out[k] = await fn(items[k], k); } catch (e) { out[k] = { error: String(e?.message || e) }; } }
  }));
  return out;
}

const summarise = a => {
  if (!a || typeof a !== "object") return a;
  const s = { type: a.type };
  if ("choice" in a) s.choice = a.choice;
  if ("score" in a) s.score = a.score;
  if ("noul" in a) s.noul = a.noul;
  if ("confidence" in a) s.confidence = a.confidence;
  if (a.probabilities) s.probabilities = a.probabilities;
  return s;
};

export function createClient(o = {}) {
  const root = o.root || ROOT;
  const doFetch = o.fetch || globalThis.fetch;
  const retries = o.retries ?? 4;                   // attempts = retries + 1
  const backoffMs = o.backoffMs ?? 1500;
  const sleep = o.sleep || (ms => new Promise(r => setTimeout(r, ms)));
  const cacheDir = o.cacheDir === undefined ? path.join(root, "jev", ".cache") : o.cacheDir;
  const useCache = o.cache ?? (process.env.JEV_CACHE !== "0");
  const logFile = o.logFile === undefined ? path.join(root, "jev", "logs", "calls.jsonl") : o.logFile;
  const limit = o.concurrency ?? (+process.env.JEV_POOL || 8);
  const model = o.model || MODEL;
  let key = o.key;
  const stats = { calls: 0, cached: 0, input_tokens: 0, output_tokens: 0, errors: 0 };

  // Global in-flight limit for this client (the pool): every ask waits for a slot.
  let active = 0; const waiting = [];
  const acquire = () => active < limit ? (active++, Promise.resolve()) : new Promise(r => waiting.push(r));
  const release = () => { const next = waiting.shift(); if (next) next(); else active--; };

  const log = rec => { if (!logFile) return; try { fs.mkdirSync(path.dirname(logFile), { recursive: true }); fs.appendFileSync(logFile, JSON.stringify(rec) + "\n"); } catch {} };

  async function post(state, questions) {
    if (!key) key = findKey({ root });
    if (!key) throw new Error("No TypeSafe key (TYPESAFE_API_KEY, TS_KEY_FILE or .typesafe-key)");
    for (let a = 0; ; a++) {
      try {
        const r = await doFetch(URL, { method: "POST", headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
          body: JSON.stringify({ model, state, questions }) });
        if (r.ok) return await r.json();
        const retry = r.status === 429 || r.status >= 500;
        const err = new Error(r.status + " " + String(await r.text()).slice(0, 200)); err.retry = retry;
        if (!retry) throw err;
        if (a >= retries) throw err;
      } catch (e) { if (e.retry === false || a >= retries) throw e; }
      await sleep(backoffMs * (a + 1));
    }
  }

  async function ask(state, questions, meta = {}) {
    // meta.def "name@version" labels plain questions (the UI runner keeps its own inline copies, D107)
    const tag = meta.def && String(meta.def).match(/^(.+)@(\d+)$/);
    const defs = Object.fromEntries(Object.entries(defsOf(questions)).map(([k, d]) => [k, tag && !questions[k].__def ? { name: tag[1], version: +tag[2] } : d]));
    const hash = hashOf(model, state, questions), t0 = Date.now();
    const cf = cacheDir && path.join(cacheDir, hash.slice(0, 2), hash + ".json");
    if (useCache && cf && fs.existsSync(cf)) {
      const j = JSON.parse(fs.readFileSync(cf, "utf8"));
      stats.cached++;
      log({ at: new Date().toISOString(), caller: meta.caller || null, hash: hash.slice(0, 16), cached: true, questions: defs,
        answers: Object.fromEntries(Object.entries(j.answers || {}).map(([k, v]) => [k, summarise(v)])), input_tokens: 0, output_tokens: 0, ms: 0 });
      return j.answers;
    }
    await acquire();
    let j;
    try { j = await post(state, questions); }
    catch (e) { stats.errors++; log({ at: new Date().toISOString(), caller: meta.caller || null, hash: hash.slice(0, 16), questions: defs, error: String(e.message || e).slice(0, 200) }); throw e; }
    finally { release(); }
    stats.calls++; stats.input_tokens += j.usage?.input_tokens || 0; stats.output_tokens += j.usage?.output_tokens || 0;
    if (useCache && cf) { try { fs.mkdirSync(path.dirname(cf), { recursive: true }); fs.writeFileSync(cf, JSON.stringify({ model: j.model, answers: j.answers })); } catch {} }
    log({ at: new Date().toISOString(), caller: meta.caller || null, hash: hash.slice(0, 16), cached: false, model: j.model, questions: defs,
      answers: Object.fromEntries(Object.entries(j.answers || {}).map(([k, v]) => [k, summarise(v)])),
      input_tokens: j.usage?.input_tokens || 0, output_tokens: j.usage?.output_tokens || 0, ms: Date.now() - t0 });
    return j.answers;
  }

  return { ask, stats, pool, get limit() { return limit; } };
}

// The shared default client (lazy key; cache and log under jev/).
export const jev = createClient();
