// D107 / M19-S13-H4 — what a Jev answer is allowed to mean.
//  • threshold per question type from jev/calibration/thresholds.json (written by `node jev/cli.mjs calibrate`),
//    falling back to the values in use before measurement (DEFAULTS);
//  • a type marked untrusted is still answered, but recorded PROVISIONAL (decide/ruling) or REVIEW (triage, relevance, audits)
//    regardless of confidence;
//  • below threshold: decide → PROVISIONAL, or OWNER when the question was well grounded (it cites a governing decision —
//    low confidence with the ruling in front of Jev means the decisions do not settle it, so it is the owner's call);
//    triage-class / relevance / audits → REVIEW;
//  • never-list: when the caller's own text (question, options, facts — not the grounding Jev adds) touches money amounts or
//    refunds, legal or signed-document wording, field-level security, seats/profiles/sharing, or licences, decide answers
//    "owner" and never picks an option.
// pick-control and judge-fact keep the runner's own fixed thresholds (STEP_MIN 0.60, PASS_AT 0.80, D63) and its verdict logic.
import fs from "node:fs"; import path from "node:path";
import { ROOT } from "./client.mjs";

export const DEFAULTS = {
  "pick-control": 0.60, "judge-fact": 0.80, relevance: 0.50, "triage-class": 0.60, decide: 0.70,
  ruling: 0.70, "cost-if-wrong": 0, "decisions-audit": 0.70, "build-audit": 0.70,
};
export const LOW_ACTION = { decide: "PROVISIONAL", ruling: "PROVISIONAL", "triage-class": "REVIEW", relevance: "REVIEW", "decisions-audit": "REVIEW", "build-audit": "REVIEW", "pick-control": "REVIEW", "judge-fact": "REVIEW" };

export const NEVER = {
  money: [/\brefund\w*/i, /\bamounts?\b/i, /₹/, /\bINR\b/, /\brupees?\b/i, /\bRs\.?\s?\d/i, /\blakhs?\b/i, /\bcrores?\b/i, /\bprice[sd]?\b/i, /\bfees?\b/i, /\bTDS\b/, /\binterest rate/i],
  legal: [/\blegal\w*/i, /\bclauses?\b/i, /\bsigned (document|paper|agreement|copy|pdf|contract)s?\b/i, /\b(agreement|contract|nda|letter|certificate|declaration) (wording|text|language|copy)\b/i,
    /\bwording of the (agreement|contract|nda|letter|certificate|declaration)\b/i, /\bterms (and|&) conditions\b/i, /\bT&C\b/, /\bdisclaimer\b/i, /\bstamp duty\b/i, /\bnotari[sz]\w*/i],
  fls: [/\bfield[- ]level security\b/i, /\bFLS\b/, /\bfield permissions?\b/i, /\bfield visibility\b/i],
  access: [/\bseats?\b/i, /\bprofiles?\b/i, /\bsharing\b/i, /\bsharing rules?\b/i, /\bpermission sets?\b/i],
  licence: [/\blicen[cs]e[sd]?\b/i, /\blicen[cs]ing\b/i, /\bsubscriptions?\b/i, /\beditions?\b/i],
};
/** Which never-list categories the caller's own text touches (question + options + facts). */
export function neverList(text) {
  const t = String(text || "");
  return Object.entries(NEVER).filter(([, res]) => res.some(r => r.test(t))).map(([k]) => k);
}

let cached = null;
export function thresholds(root = ROOT, reload = false) {
  if (cached && !reload) return cached;
  let file = {}; try { file = JSON.parse(fs.readFileSync(path.join(root, "jev", "calibration", "thresholds.json"), "utf8")).types || {}; } catch {}
  cached = Object.fromEntries(Object.keys(DEFAULTS).map(k => [k, {
    threshold: typeof file[k]?.threshold === "number" ? file[k].threshold : DEFAULTS[k],
    trusted: file[k] ? file[k].trusted !== false : true,
    measured: !!file[k] && typeof file[k].threshold === "number",
  }]));
  return cached;
}

/**
 * apply(type, answer, ctx) → { choice, confidence, status, reason, jev_choice }
 *   answer: a Jev choice answer {choice, confidence, probabilities} (or {score}/{noul}: pass `confidence` yourself)
 *   ctx: { text: the caller's own words (for the never-list), grounded: boolean (a governing decision was attached), table: thresholds override }
 * status: OK · PROVISIONAL · REVIEW · OWNER
 */
export function apply(type, answer, ctx = {}) {
  const T = (ctx.table || thresholds())[type] || { threshold: DEFAULTS[type] ?? 0.7, trusted: true };
  const conf = +(answer?.confidence ?? answer?.probabilities?.[answer?.choice] ?? 0);
  const base = { choice: answer?.choice, confidence: +conf.toFixed(2), jev_choice: answer?.choice, threshold: T.threshold, trusted: T.trusted };
  if (type === "decide") {
    const hit = neverList(ctx.text);
    if (hit.length) return { ...base, choice: "owner", status: "OWNER", reason: `never-list: ${hit.join(", ")}` };
    if (!T.trusted) return { ...base, status: "PROVISIONAL", reason: "decide is untrusted (under its calibration floor)" };
    if (conf < T.threshold) return ctx.grounded
      ? { ...base, choice: "owner", status: "OWNER", reason: `confidence ${base.confidence} < ${T.threshold} with the governing decisions attached — they do not settle it` }
      : { ...base, status: "PROVISIONAL", reason: `confidence ${base.confidence} < ${T.threshold}` };
    return { ...base, status: "OK", reason: "" };
  }
  const low = LOW_ACTION[type] || "REVIEW";
  if (!T.trusted) return { ...base, status: low, reason: `${type} is untrusted (under its calibration floor)` };
  if (conf < T.threshold) return { ...base, status: low, reason: `confidence ${base.confidence} < ${T.threshold}` };
  return { ...base, status: "OK", reason: "" };
}
