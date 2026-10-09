/* W6-A11Y-1 — a scrolling table wrapper is a named, focusable region (axe scrollable-region-focusable). */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Tw } from "./Tw";

describe("Tw", () => {
  it("is keyboard-focusable and named", () => {
    const html = renderToStaticMarkup(<Tw label="Document register, scrolls sideways"><table /></Tw>);
    expect(html).toContain('class="tw"');
    expect(html).toContain('role="region"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('aria-label="Document register, scrolls sideways"');
  });
  it("always has a name, and keeps the extra class and style", () => {
    const html = renderToStaticMarkup(<Tw className="scroll" style={{ maxHeight: 360 }}><table /></Tw>);
    expect(html).toContain('class="tw scroll"');
    expect(html).toContain('aria-label="Table, scrolls sideways"');
    expect(html).toContain("max-height:360px");
  });
});
