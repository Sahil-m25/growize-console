// From autopilot/jev.mjs `triage` (D101): why a UI case failed. Below threshold → REVIEW ("unsure_look_yourself").
export default {
  name: "triage-class", type: "choice", version: 1,
  build: () => ({ type: "choice", instructions: "Why did this UI test case fail in the app? Use `case` (what a person does and should then see) and `run` (which control each step pressed, where it stopped, and which expected facts were judged false).",
    criteria: { control_missing: "A step needed a control, field or page the app does not have.", label_differs: "The right control exists but its visible wording differs from the step, so it was not matched.",
      behaviour_wrong: "The steps ran, but afterwards the screen does not show what is expected (missing message, wrong data, wrong page, action did nothing).",
      case_outdated: "The case asks for something a later decision deliberately changed, so the expectation itself is out of date.",
      harness: "The run broke before the app was really tested: sign-in step, fixture, timeout or a page error at load." } }),
};
