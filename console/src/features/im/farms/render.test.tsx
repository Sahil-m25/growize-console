import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { imDemoData } from "@fixtures/im/demo";
import { initialImUi } from "@/lib/im";
import { ImFarms } from "./index";

const html = (me: string) => renderToStaticMarkup(<ImFarms s={{ data: imDemoData(), ui: initialImUi() }} me={me} dispatch={() => {}} />);

describe("ImFarms (imx.js vFarms)", () => {
  it("Head of Finance: the shelf with release rights", () => {
    const h = html("harsha");
    expect(h).toContain('<span class="sub">8.0 acres · 208 units · 96 released</span>');
    expect(h).toContain("56 free to sell");
    expect(h).toContain('<span class="sm">you can release land</span>');
    expect(h).toContain("<div class=\"sm\">29 allotted · 33 free</div>");
    expect(h).toContain("<div class=\"sm\">6 allotted · 5 reserved · 23 free</div>");
    expect(h).toContain('<button class="chip">Take it back</button>');
    expect(h).toContain('<span class="tag due">not released</span>');
    expect(h).toMatch(/<button class="chip">Release \d+<\/button>/);
    expect(h).toContain("<h3>What is happening on the land</h3>");
    expect(h).not.toContain(">Record progress<");
  });
  it("Key Account Manager: records progress, cannot release land", () => {
    const h = html("imran");
    expect(h).toContain('<span class="sm">read only</span>');
    expect(h).toContain('<button class="chip">Record progress</button>');
    expect(h).not.toContain("Take it back");
    expect(h).toContain("Told investors: ");
    expect(h).toContain("Block A — year-3 flowering ahead of schedule</a> · 28 Aug");
  });
  it("Auditor: read only on both cards; a system seat cannot read the page", () => {
    const h = html("latha");
    expect(h.match(/<span class="sm">read only<\/span>/g)?.length).toBe(2);
    expect(html("pradeep")).toBe("");
  });
});
