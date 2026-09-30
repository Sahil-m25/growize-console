// D107 / M19-S13-H3 — the versioned question library. q(name, input) returns the question to send, with a hidden
// __def {name, version} the client logs and hashes (never sent). q(name, input, "with") builds a named sub-question.
import pick from "./pick-control.mjs"; import judge from "./judge-fact.mjs"; import relevance from "./relevance.mjs";
import triage from "./triage-class.mjs"; import decide from "./decide.mjs"; import ruling from "./ruling.mjs";
import cost from "./cost-if-wrong.mjs"; import daudit from "./decisions-audit.mjs"; import baudit from "./build-audit.mjs";
export const DEFS = Object.fromEntries([pick, judge, relevance, triage, decide, ruling, cost, daudit, baudit].map(d => [d.name, d]));
export function q(name, input = {}, part = "build") {
  const d = DEFS[name]; if (!d) throw new Error("unknown Jev question " + name);
  const fn = d[part]; if (typeof fn !== "function") throw new Error(`${name} has no ${part}`);
  const out = fn(input);
  Object.defineProperty(out, "__def", { value: { name: part === "build" ? name : `${name}.${part}`, version: d.version }, enumerable: false, configurable: true });
  return out;
}
