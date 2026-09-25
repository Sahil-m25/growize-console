# D27 — The console looks like a product: Inter embedded, an icon set, one control family, Airtable-style pills and tabs — UI only, the UX untouched

_10 Sep 2026 · amends D26's stylesheet, not its rule · no page, flow, label, layout or breakpoint changed_

The prototype's stylesheet was judged hard to read and amateur beside tools like Airtable: the font was fetched from Google Fonts and fell back to whatever Windows had when the file was opened locally; there was not a single icon; buttons, chips, tabs and inputs were five different heights and radii; every label was tracked uppercase; late leads were filled pink cards. Sahil asked for a simpler, easier, better-coloured UI **with the UX left exactly as it is**, chose the Airtable reference, and allowed markup and a few render lines to be touched for icons and an embedded font.

**What changed in `console/prototype/ir-console.html`.**

- **Inter is embedded** (latin + latin-ext, variable 400–700, ~178 KB base64) so it renders identically offline, on Windows and in the port. IBM Plex Mono stays external for numbers and stamps.
- **An icon set** — 33 inline SVG paths in a `ICONS` map with an `ic(key)` helper, drawn in `currentColor` at 16px. Used on the sidebar (one per nav key), the help and theme buttons, the search box and its clear button, the drawer close, the lead page back button, and the lead-page doors (`d-`+door key). Six render lines changed; every label they sit beside is unchanged.
- **One control family.** `.act` `.btn` `.chip` `.sc` `.tgl` `.sel` `.selw` `.inp` `.di2` and the search input are 32px tall (28px compact), 8px corners, 13px medium. Primary is the one green fill; secondary is white with a hairline; chips are soft grey pills that tint green when selected; section tabs are a segmented control; selects carry a real chevron.
- **Sentence-case labels.** `.lbl`, `th`, `.kpi .l`, `.stat span`, `.door .dt`, `.fi>span`, `.sech`, `.cal .dow` drop the tracked uppercase.
- **Tables** get a tinted sticky header, 40px rows, hairline column dividers on the leads grid, and a bold name column.
- **Tokens.** Cool grey ground, white cards, a `--card-3` step for pills, `--rc` / `--ctl` / `--ctl-sm` for control radius and heights, `--brand-ink` for text on green in both themes. Sidebar is the light grey rail with a white active item. Dark theme redone on the same tokens.
- **Queue cards** carry urgency as a 4px left edge, red for now and amber for soon, on a white card.

**What this does not change.** Nothing a user does, nothing a user reads. The pages, the drawer, the 760px phone re-layout, the one-screen desktop frame, the eight categorical source colours and all click handlers are as they were. Verified by rendering all fourteen screens in light, dark and at 390px for three seats with zero script errors.

**Consequence.** Per D26 the stylesheet is the design system, so the code step is: replace `console/src/app/console.css` with the new `<style>` block (font-face included) verbatim; port `ICONS` and `ic()` to `src/components/ui/Icon.tsx` and use it in the six places listed; drop the Google Fonts link for Inter from `layout.tsx`. `docs/design-spec.html`'s rendered swatches are the old values and should be refreshed when the spec is next touched.
