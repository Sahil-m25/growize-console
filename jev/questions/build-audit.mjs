// From autopilot/build-audit.mjs (D109): does the recorded build match the acceptance and the decisions? `touches` names the decision drifted from.
export default {
  name: "build-audit", type: "choice", version: 1,
  build: () => ({ type: "choice", instructions: "Compare `build` (what the autopilot recorded doing) with `story.acceptance`, `decisions` (they govern) and `rules`. Pick one.",
    criteria: { aligned: "What was built follows the acceptance and the cited decisions; anything left is only waiting on the sandbox or a person.",
                drifted: "The build records doing something the acceptance or a cited decision does not say, or the opposite of one, without a decision that allows it.",
                incomplete: "The notes admit that part of the acceptance is not built and it is not merely waiting on a person or the sandbox.",
                unclear: "The notes are too thin to tell." } }),
  touches: ({ refs }) => ({ type: "choice", instructions: "If the build drifted from a decision, which one? Pick none otherwise.",
    criteria: Object.fromEntries([["none", "No drift from a decision."], ...refs.map(([d, t]) => [d, t.slice(0, 120)])]) }),
};
