// An either/or build choice (D101/D106). v2 (D107): judged against whatever jev/ground.mjs attached — the decisions the
// question cites (they govern; a superseded row brings its successor), related decisions in force, the story and the nine rules.
// build({ question, options: {a: meaning, …}, has: [state keys] })
const PARTS = { facts: "`facts`", decisions: "`decisions` (the decisions it cites; they govern, and a later one overrides an earlier one it supersedes)",
  related: "`related` (other decisions in force on the same topic)", story: "`story` (what the story must achieve)", seats: "`seats` (what each console seat may do)", rules: "`rules` (the nine system rules)" };
export default {
  name: "decide", type: "choice", version: 2,
  build: ({ question, options, has = [] }) => {
    const parts = Object.keys(PARTS).filter(k => has.includes(k)).map(k => PARTS[k]);
    return { type: "choice", instructions: `${question} Judge against ${parts.length ? parts.join(", ") : "what you know"}. Pick the option they support.`, criteria: options };
  },
};
