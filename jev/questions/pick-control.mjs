// Moved verbatim from pm/jev-ui-runner.mjs (D63/D64). Do not edit the wording without bumping `version`,
// re-running `node jev/cli.mjs calibrate pick-control` and the D63 gate. Threshold: STEP_MIN 0.60 (fixed by D63).
// build({ criteria }) — criteria = { none, look_only, e<id>: "<kind> \"<name>\" … in the <where> …" } as the runner lists them.
export default {
  name: "pick-control", type: "choice", version: 1,
  build: ({ criteria }) => ({ type: "choice", instructions: "A tester is running a UI test in this app. Which control on the screen does `step` tell them to press, type into or choose from? In this app, pressing a person's name (or their row) opens that person's record, menu links open pages, and the top-bar box searches. Pick the control a careful person would use; choose none only if nothing on screen could do it.", criteria }),
};
