import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { imDemoData } from "@fixtures/im/demo";
import { initialImUi } from "@/lib/im";
import type { ImState } from "@/lib/im";
import { ImDocs } from "./index";

const html = (me: string, f?: (s: ImState) => void) => {
  const s: ImState = { data: imDemoData(), ui: initialImUi() }; if (f) f(s);
  return renderToStaticMarkup(<ImDocs s={s} me={me} dispatch={() => {}} />);
};
const send = (s: ImState) => { s.ui.SEC.docs = "send"; };

describe("ImDocs (imx.js vDocs, vSendPanel)", () => {
  it("Head of Finance: out for signature, with Verify", () => {
    const h = html("harsha");
    expect(h).toContain('<span class="sub">uploaded, sent through Zoho Sign, and verified here — nowhere else</span>');
    expect(h).toContain("Out for signature<i class=\"warn\">1</i>");
    expect(h).toContain("Everything on file<i class=\"\">45</i>");
    expect(h).toContain("<b>FEMA declaration</b><div class=\"sm\">Regulatory · D-041</div>");
    expect(h).toContain('<div class="sm">6d ago · expires 09 Sep</div>');
    expect(h).toContain('<button class="chip">Verify</button>');
  });
  it("Auditor: no Verify, and sending is refused", () => {
    expect(html("latha")).not.toContain(">Verify<");
    expect(html("latha", send)).toContain('<div class="empty">Sending belongs to Finance\n    Operations, Compliance and the Head of Finance.</div>'.replace("\n    ", " "));
    expect(html("imran")).toBe("");
  });
  it("Compliance: the send panel, and the NRI Aadhaar OTP block", () => {
    const h = html("fahad", send);
    expect(h).toContain("<h3>Send a document</h3>");
    expect(h).toContain("Joseph Mathew — ARL-INV-0209 · NRI</option>");
    expect(h).toContain('<button class="chip " disabled="" title="Wet signature only">Power of attorney<span class="u">wet sign</span></button>');
    expect(h).toContain('<button class="act" disabled="" title="Pick the investor, the template and how it is signed">Send through Zoho Sign</button>');
    const b = html("fahad", s => { send(s); s.ui.SEL = "ARL-INV-0209"; s.ui.drafts.DTPL = "FEMA declaration"; });
    expect(b).toContain("<b>Joseph Mathew is an NRI.</b> Aadhaar OTP needs an Aadhaar linked to a live Indian mobile.");
    const ok = html("fahad", s => { send(s); s.ui.SEL = "ARL-INV-0209"; s.ui.drafts.DTPL = "FEMA declaration"; s.ui.drafts.DSIG = "Class 3 DSC"; });
    expect(ok).toContain('<button class="act">Send through Zoho Sign</button>');
    const rc = html("fahad", s => { send(s); s.ui.drafts.DTPL = "Advance receipt"; });
    expect(rc).not.toContain('<p class="lbl">Signing</p>');
  });
});
