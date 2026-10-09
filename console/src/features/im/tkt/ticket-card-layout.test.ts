/* W4-2 — a ticket card keeps a floor on its title column and lets the hand-over sentence wrap (CSS contract). */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../../../app/console.css", import.meta.url), "utf8");
describe("W4-2: ticket card layout", () => {
  it("the title column has a minimum width and the card wraps", () => {
    expect(css).toMatch(/\.qc:has\(>\.who2\)\{flex-wrap:wrap/);
    expect(css).toMatch(/\.qc \.who2\{flex:1 1 240px;min-width:min\(240px,100%\)\}/);
  });
  it("the sentence beside the button wraps instead of overflowing", () => {
    expect(css).toMatch(/\.qc>\.chips \.sm\{[^}]*white-space:normal/);
  });
});
