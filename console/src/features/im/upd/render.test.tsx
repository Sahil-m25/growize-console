import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { imDemoData } from "@fixtures/im/demo";
import { initialImUi } from "@/lib/im";
import { ImUpd } from "./index";

const html = (me: string) => renderToStaticMarkup(<ImUpd s={{ data: imDemoData(), ui: initialImUi() }} me={me} dispatch={() => {}} />);

describe("ImUpd (imx.js vUpd)", () => {
  it("Key Account Manager: may publish; every update says who it reached", () => {
    const h = html("imran");
    expect(h).toContain("<h1>Investor updates</h1>");
    expect(h).toContain("what is pushed to the investor&#x27;s app, and who it reached");
    expect(h).toContain('<button class="act">＋ Publish one</button>');
    expect(h).toContain("<b>Sent to 7 investors</b> — allotted investors only.");
    expect(h).toContain("<b>Sent to 1 investor</b> — NRI investors only.");
    expect(h).toContain("<b>Sent to 6 investors</b> — everyone on the book.");
  });
  it("Auditor: read only; Super user: may publish", () => {
    expect(html("latha")).toContain('<span class="tag">read only</span>');
    expect(html("sahil")).toContain("＋ Publish one");
    expect(html("pradeep")).toBe("");
  });
});
