// From autopilot/decisions-audit.mjs (D108): is a DECISIONS.md row still in force? `with` names the decision it clashes with.
export default {
  name: "decisions-audit", type: "choice", version: 1,
  build: () => ({ type: "choice", instructions: "Judge `decision` against `rules` and `related` (later ones are dated later). Pick one.",
    criteria: { consistent: "It still stands: nothing in `rules` or `related` contradicts it.", superseded: "A later decision in `related` replaced it in whole or part, but this row does not say so.",
      contradicts_rule: "It conflicts with one of the nine `rules` as written.", contradicts_decision: "Two decisions in force disagree with each other and neither says it supersedes the other." } }),
  with: ({ related }) => ({ type: "choice", instructions: "If `decision` is superseded by or in conflict with one of `related`, which one? Pick none if it stands.",
    criteria: Object.fromEntries([["none", "It stands."], ...related.map(x => [x.id, x.text.slice(0, 120)])]) }),
};
