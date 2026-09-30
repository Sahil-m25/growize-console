// Moved verbatim from pm/jev-ui-runner.mjs (D63/D64). Do not edit the wording without bumping `version`,
// re-running `node jev/cli.mjs calibrate judge-fact` and the D63 gate. Threshold: PASS_AT 0.80 (fixed by D63).
// build({ fact }) — one expected fact; the state carries what_the_screen_shows.
export default {
  name: "judge-fact", type: "noul", version: 1,
  build: ({ fact }) => ({ type: "noul",
    instructions: `A tester ran \`steps\` in the app. Using only \`what_the_screen_shows\` (menu = every navigation link visible — a page not in this list is not shown; top_bar = the controls in the top bar; top_bar_text = everything written in the top bar, including status; notice = status messages; panel = any open panel; popup = search results or lists open over the page; rows = each row/area of the page with its text and the buttons it offers; page = the main page text), is this fact true: "${fact}"? Judge facts, not exact wording.`,
    criteria: { true: "Yes — the screen shows this fact.", false: "No — the screen contradicts it or does not show it." } }),
};
