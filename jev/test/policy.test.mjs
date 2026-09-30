// jev/policy.mjs: never-list (a test per trigger list), thresholds, untrusted types, below-threshold actions.
import test from "node:test"; import assert from "node:assert/strict";
import { neverList, apply, NEVER, DEFAULTS } from "../policy.mjs";
const A = (choice, confidence) => ({ choice, confidence, probabilities: { [choice]: confidence } });
const T = over => Object.fromEntries(Object.keys(DEFAULTS).map(k => [k, { threshold: DEFAULTS[k], trusted: true, ...(over[k] || {}) }]));

const CASES = {
  money: ["Should the refund go out before the cancellation is signed?", "What amount goes on the receipt?", "Show ₹5,00,000 or 5 lakh?", "Is Rs 500 the fee?", "Round the price to the nearest crore?", "Deduct TDS on payouts?"],
  legal: ["Which clause goes in the NDA?", "Can we change the agreement wording?", "Is the signed document filed to the Contact?", "Add a disclaimer to the letter?", "Who pays stamp duty?", "Is this legal?"],
  fls: ["Should field-level security hide PAN from KAMs?", "Change the FLS on Bank_Account?", "Set field permissions for Finance?"],
  access: ["Give Marketing a seat?", "Move Sahil to a new profile?", "Open a sharing rule for KAMs?", "Which profiles can reveal PAN?"],
  licence: ["Buy another Zoho licence?", "Upgrade the Sign subscription?", "Which edition carries blueprints?", "Is the org licensed for Portals?"],
};
for (const [cat, qs] of Object.entries(CASES)) test(`never-list: ${cat} → decide answers owner`, () => {
  assert.ok(NEVER[cat]);
  for (const text of qs) {
    assert.ok(neverList(text).includes(cat), `${cat}: ${text}`);
    const r = apply("decide", A("a", 0.99), { text, grounded: true, table: T({}) });
    assert.equal(r.choice, "owner", text); assert.equal(r.status, "OWNER"); assert.equal(r.jev_choice, "a");
  }
});

test("never-list stays quiet on ordinary build choices", () => {
  for (const text of ["Should the Leads page open sorted by next step?", "Copy the prototype's empty-state text?", "Which status to record after a failed save?", "Do the Payments page tabs keep their order?"])
    assert.deepEqual(neverList(text), [], text);
});

test("decide: above threshold OK; below → PROVISIONAL, or OWNER when well grounded", () => {
  const t = T({ decide: { threshold: 0.7 } });
  assert.equal(apply("decide", A("b", 0.9), { text: "x", table: t }).status, "OK");
  const p = apply("decide", A("b", 0.55), { text: "x", grounded: false, table: t }); assert.equal(p.status, "PROVISIONAL"); assert.equal(p.choice, "b");
  const o = apply("decide", A("b", 0.55), { text: "x", grounded: true, table: t }); assert.equal(o.status, "OWNER"); assert.equal(o.choice, "owner");
});

test("an untrusted type is answered but recorded PROVISIONAL (decide) or REVIEW (triage, relevance, audits) regardless of confidence", () => {
  const t = T({ decide: { trusted: false }, "triage-class": { trusted: false }, relevance: { trusted: false }, "build-audit": { trusted: false } });
  const d = apply("decide", A("a", 0.99), { text: "x", table: t }); assert.equal(d.status, "PROVISIONAL"); assert.equal(d.choice, "a");
  assert.equal(apply("triage-class", A("harness", 0.99), { table: t }).status, "REVIEW");
  assert.equal(apply("relevance", A("keep", 0.99), { table: t }).status, "REVIEW");
  assert.equal(apply("build-audit", A("aligned", 0.99), { table: t }).status, "REVIEW");
});

test("triage/relevance below threshold → REVIEW; thresholds come from the table", () => {
  const t = T({ "triage-class": { threshold: 0.6 } });
  assert.equal(apply("triage-class", A("harness", 0.59), { table: t }).status, "REVIEW");
  assert.equal(apply("triage-class", A("harness", 0.61), { table: t }).status, "OK");
  assert.equal(apply("relevance", { choice: "keep", confidence: 0.4 }, { table: T({ relevance: { threshold: 0.33 } }) }).status, "OK");
});
