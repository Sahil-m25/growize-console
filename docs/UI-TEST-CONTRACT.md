# The UI test contract

_One page. M19-S01-T02 · D63 (Jev runs the cases through the UI), D101 (Jev triages what fails), D107 (one Jev layer). Written 4 Oct 2026 from `pm/jev-ui-runner.mjs`, `docs/runbooks/jev-rebaseline.md` and the a11y lint in `console/lint`._

A UI case is plain words that a tester could follow with the browser open. The runner follows them, Jev picks the control each step means and judges each fact against what the screen shows. Nothing inside the app is used, so the same case runs on the demo build, on staging and in production. If a case needs an app internal, it is not a UI case.

## What a case looks like

```json
{ "id": "TC-IM06-026", "story": "M11-S02", "seat": "harsha", "group": "M11",
  "title": "An investor's allotment with no LLP shows a Needs a link tag",
  "steps": ["Press Harsha Bhat on the sign-in screen", "Press 'Investors'", "Press 'Fatima Zaidi'", "Press 'What they hold'"],
  "expected": ["The Allotments card lists that allotment with a 'Needs a link' tag and 'no LLP on this allotment'."],
  "fixtures": ["DEMO_BOOK", "IM:ALLOTMENT_NO_LLP"] }
```

| Part | Rule |
|---|---|
| **Steps** | One action per step, using the control's visible label ("Press 'Assign to me' on Ritu Anand's row", "Type 'Rahul' in the Find an investor box"). The first step signs in as the seat. Quoted text is what gets typed or chosen. Name the row when a label repeats. A step that only looks says "Check" or "Look at". |
| **Expected (positive facts)** | A list of separate facts about the screen after the last step, one thing per line. Say what the screen shows ("The page does not offer X" is fine; "no longer", "now", "still" and internal names are not). A fact about a list gives the whole list or its count. A count the page does not print is not a fact. Quote the words on screen. |
| **Fixtures** | Named starting states, never app internals. Each is an entry in `pm/merge-audit/ui-sahil/fixtures-merged.json` (`description`, `prototype`, `staging`, optional `after_signin`) and a function in `console/fixtures/` (`apply.ts`, `im/money-fixtures.ts`); `apply.test.ts` fails if a catalogue entry or a cited fixture is not registered. Investors-side names are filed `IM:NAME` and cited bare or with the prefix. Fixture data is the demo book only: no real investor, PAN, bank number or signature. |
| **Seats** | `seat` is the person who signs in (rohit, kavya, harsha, meena, imran, tasneem, sahil, and so on). One seat per case; a case that needs two people is two cases or a manual UAT step. On staging a saved session per seat replaces the sign-in step. |
| **Calibration** | A case with `"expect_fail": true` states something false on purpose (a red banner "All investor records were deleted"). One per epic. Its title must not give it away (a title that said "seeded wrong" changed Jev's step choice, D63). |
| **Optional** | `clock` pins the time; `wait` raises the quiet time; `width` sets the viewport; `after_signin` on a fixture applies it after the first step. |

## How the runner judges

1. **The step.** The runner lists every visible control with its name, kind, state and the row it sits in. If the step names exactly one control by its full label, code picks it. Otherwise Jev chooses, and a pick under **STEP_MIN 0.60** marks the case unsure. A step with no matching control stops the case (never a PASS). A disabled control is never pressed.
2. **The facts.** Jev judges each expected fact on its own against the screen (menu, top bar, notices, open panel, rows with their buttons, page text). The case score is the lowest fact.
3. **The verdict.** **PASS** needs every fact at or above **PASS_AT 0.80**, no unsure step and no stuck step. **FAIL** is any fact at or below 0.10, or a page error or native dialog. Anything else is **REVIEW**: a person reads the score. `--retry-review` runs a REVIEW once more and keeps the better-evidenced result.
4. **The trust rule.** If any calibration case PASSES, the whole run is untrusted whatever else is green. PASS_AT is a measured number (0.80: no clear false pass in 375 near-miss wrong facts, 14 of 14 seeded-wrong cases caught, D63); it changes only from a new measurement (`node jev/cli.mjs calibrate`).
5. **Repeatability.** Jev answers are cached by input, so an identical screen scores identically. The runner waits for the page to settle (no request in flight, no DOM change for 250 ms, capped at 6 s) rather than a fixed pause. Tel, mail and WhatsApp links are blocked.

## What the app owes the runner (checked by the a11y lint, `npm run lint:a11y`)

- Every input, select and textarea has a programmatic name: a wrapping label, `label for`, `aria-label`, `aria-labelledby` or a title. A placeholder is never the name (a box is named by its label, never by what is typed in it). Rules: `jsx-a11y/label-has-associated-control`, `jsx-a11y/control-has-associated-label`, `gz/no-placeholder-only-label`.
- Every button and link has a name. A disabled control uses the `disabled` attribute, not a look.
- A collapsible section is `details`/`summary` or a button with `aria-expanded`; controls in a closed section are not focusable, so the runner treats them as unavailable.
- A list row's container holds the record's name, so "on Ritu Anand's row" finds it.
- A notice is `role="status"` (or `aria-live`) so it is read as a notice. No native `alert`, `confirm` or `prompt` (`node scripts/no-native-dialogs.cjs`).

## When a case is not PASS

Run it alone three times, then on the phase-1 prototype, and class it as `docs/runbooks/jev-rebaseline.md` section 3 does: **stale** (the fact is wrong: propose a fact change), **bug** (fix the app in its story), **flaky** (latency: a defect on whatever never goes quiet) or **borderline** (score straddles 0.80 with the fact true: reword to one plain fact, never lower PASS_AT). Jev's own triage classes (D101) are harness, control_missing, label_differs, behaviour_wrong and case_outdated. A UI change re-baselines its cases in the same story. Cases are edited only by whoever owns `pm/plan-merged/ui-cases.json`; the runner is never edited to fit a case.

## Run it

```
cd console && npm run build:local && PORT=3177 npm run start:local
FIXTURES=pm/merge-audit/ui-sahil/fixtures-merged.json SEED_CMD="node autopilot/seed-local.mjs" APP_URL=http://localhost:3177 \
  ONLY=TC-E09-015 node pm/jev-ui-runner.mjs pm/plan-merged/ui-cases.json http://localhost:3177 out.json --retry-review
```
