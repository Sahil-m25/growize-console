// From autopilot/rulings.mjs (D106): 0 one-line fix … 3 money or signed paper could already be wrong (reported as score/3).
export default {
  name: "cost-if-wrong", type: "score", version: 1,
  build: () => ({ type: "score", instructions: "If `note` is kept as built and later turns out wrong, how costly is the reversal?",
    criteria: ["A one-line code or copy change, no data touched.", "A day of rework or a test-suite change.", "Records or Zoho fields must be migrated.", "Money, legal paper or a signed document could already be wrong."] }),
};
