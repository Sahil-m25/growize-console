/* The UI test contract's lint (M19-S01, D63): every control findable by its visible label.
   Only the accessibility rules run here — `npm run lint:a11y`. Three checks:
     jsx-a11y/label-has-associated-control   a <label> names a control (nested, or htmlFor)
     jsx-a11y/control-has-associated-label   a button, link or other control has a name
     gz/no-placeholder-only-label            an input or textarea is never named by its placeholder alone */
import tsParser from "@typescript-eslint/parser";
import jsxA11y from "eslint-plugin-jsx-a11y";
import placeholderOnly from "./lint/no-placeholder-only-label.mjs";

export default [
  { ignores: [".next/**", ".next-local/**", "node_modules/**", "prototype/**", "**/*.test.tsx"] },
  {
    files: ["src/**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: "latest", sourceType: "module", ecmaFeatures: { jsx: true } },
    },
    linterOptions: { reportUnusedDisableDirectives: "off" },
    plugins: {
      "jsx-a11y": jsxA11y,
      gz: { rules: { "no-placeholder-only-label": placeholderOnly } },
      /* the code carries react-hooks disable comments; the rule itself is not part of this lint */
      "react-hooks": { rules: { "exhaustive-deps": { meta: { schema: false }, create: () => ({}) } } },
    },
    rules: {
      "jsx-a11y/label-has-associated-control": ["error", { assert: "either", depth: 3 }],
      "jsx-a11y/control-has-associated-label": ["error", {
        depth: 4,
        labelAttributes: ["label", "title", "aria-label"],
        /* the plugin's recommended set: these are named by a label element or are containers */
        ignoreElements: ["audio", "canvas", "embed", "input", "textarea", "tr", "video", "select", "option", "td", "th"],
        ignoreRoles: ["grid", "listbox", "menu", "menubar", "radiogroup", "row", "tablist", "toolbar", "tree", "treegrid"],
      }],
      "gz/no-placeholder-only-label": ["error", { labelComponents: ["Field"] }],
    },
  },
];
