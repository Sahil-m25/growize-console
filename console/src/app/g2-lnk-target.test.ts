/* W6-IRA-2 — the "Show" link beside the leads count is a 24px-high target (WCAG 2.5.8). CSS contract. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./console.css", import.meta.url), "utf8");
describe("W6-IRA-2: .g2-lnk target size", () => {
  it("is at least 24px high", () => {
    const rule = css.match(/\.g2-leads \.sub \.g2-lnk\{([^}]*)\}/);
    expect(rule).not.toBeNull();
    const h = rule![1].match(/min-height:(\d+)px/);
    expect(h && Number(h[1])).toBeGreaterThanOrEqual(24);
  });
});
