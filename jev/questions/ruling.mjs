// From autopilot/rulings.mjs (D106): re-judge a PROVISIONAL / FACT CHANGE PROPOSED note.
export default {
  name: "ruling", type: "choice", version: 1,
  build: () => ({ type: "choice", instructions: "The build made `note` (a PROVISIONAL choice, or a proposed change to a test case's expected fact). Judge it against `decisions` (the rulings it cites, which govern), `rules` (the nine system rules) and `story` (what the story must achieve). Pick one.",
    criteria: { confirm: "The note follows the cited decisions and rules; the owner can simply tick it, and keeping it costs nothing later.",
                reverse: "The note contradicts a cited decision or rule, or the decisions clearly intend the other option; the build should change.",
                owner: "It hinges on money, licences, staffing, legal wording, data the owner alone knows, or a business preference no decision settles." } }),
};
