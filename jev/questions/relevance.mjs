// From autopilot/jev.mjs `context` (D101). Score 0–3; the caller keeps a candidate at score/3 ≥ threshold (default 0.5).
export default {
  name: "relevance", type: "score", version: 1,
  build: () => ({ type: "score", instructions: "How much does the developer building `story` (in `story.phase`) need to read `candidate` to do this work? Judge only this story and phase.",
    criteria: ["Unrelated to this story's screens, rules or data.", "Shares a word or topic, but the story would not use it.", "Useful background: nearby screen, shared helper or rule the story relies on.",
      "Must read: it is the screen, flow, rule, file or Zoho field this story builds or changes."] }),
};
