/* M19-S01 — the UI test contract's lint: the custom placeholder rule and the two jsx-a11y rules
   fail on an unlabelled control, naming the line, and pass the labelled forms the app uses. */
import { describe, expect, it } from "vitest";
import { Linter } from "eslint";
import tsParser from "@typescript-eslint/parser";
// @ts-expect-error — the plugin ships no types
import jsxA11y from "eslint-plugin-jsx-a11y";
// @ts-expect-error — a plain .mjs rule module, no types
import placeholderOnly from "../../lint/no-placeholder-only-label.mjs";

const linter = new Linter({ configType: "flat" });
const config = [{
  files: ["**/*.tsx"],
  languageOptions: { parser: tsParser, parserOptions: { ecmaFeatures: { jsx: true } } },
  plugins: { "jsx-a11y": jsxA11y, gz: { rules: { "no-placeholder-only-label": placeholderOnly } } },
  rules: {
    "gz/no-placeholder-only-label": ["error", { labelComponents: ["Field"] }],
    "jsx-a11y/label-has-associated-control": ["error", { assert: "either", depth: 3 }],
    "jsx-a11y/control-has-associated-label": ["error", { depth: 4, ignoreElements: ["input", "textarea", "select", "tr", "td", "th", "option"] }],
  },
}] as Linter.Config[];
const lint = (code: string) => linter.verify(code, config, "x.tsx").map(m => `${m.line}:${m.ruleId}`);

describe("a11y lint (M19-S01)", () => {
  it("fails an input named only by its placeholder, and a select with no label", () => {
    expect(lint(`const A = () => <div>\n<input placeholder="Name" />\n<select><option>a</option></select></div>;`))
      .toEqual(["2:gz/no-placeholder-only-label", "3:gz/no-placeholder-only-label"]);
  });
  it("passes a wrapping label, a Field, htmlFor, and aria-label", () => {
    expect(lint(`const A = () => <div>
      <label className="fi"><span>Full name</span><input placeholder="Priya" /></label>
      <Field label="Mobile"><input placeholder="+91" /></Field>
      <label htmlFor="q">Find</label><input id="q" placeholder="Search" />
      <input aria-label="Search investors" placeholder="Name, ARL ID, city…" />
      <input type="hidden" value="x" /></div>;`)).toEqual([]);
  });
  it("fails a button with no name and a label with no control", () => {
    expect(lint(`const A = () => <div><button type="button"></button><label>Orphan</label></div>;`))
      .toEqual(["1:jsx-a11y/control-has-associated-label", "1:jsx-a11y/label-has-associated-control"]);
  });
});
