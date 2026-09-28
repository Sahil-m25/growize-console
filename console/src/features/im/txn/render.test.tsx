import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { imDemoData } from "@fixtures/im/demo";
import { initialImUi } from "@/lib/im";
import type { ImState } from "@/lib/im";
import { ImTxn } from "./index";

const html = (me: string, f?: (s: ImState) => void) => {
  const s: ImState = { data: imDemoData(), ui: initialImUi() }; if (f) f(s);
  return renderToStaticMarkup(<ImTxn s={s} me={me} dispatch={() => {}} />);
};

describe("ImTxn (imx.js vTxn)", () => {
  it("Finance Operations: the register, its cuts and the totals", () => {
    const h = html("meena");
    expect(h).toContain("<h1>Payments</h1>");
    expect(h).toContain('<span class="sub">every rupee, with the reason it moved</span>');
    expect(h).toContain('<span class="sm">0 not reconciled</span>');
    expect(h).toContain("<b>₹8.88 Cr</b><span>received</span>");
    expect(h).toContain('<button class="sc on">Everything<i>15</i></button>');
    expect(h).toContain('<button class="sc ">Refunds and forfeits<i>0</i></button>');
    expect(h).toContain('<td class="sm">RTGS <span class="mono">HDFC1206771</span></td>');
    expect(h).toContain('<span class="tag go"><span class="dot"></span>matched</span>');
  });
  it("an empty cut, a pending refund row; KAM and Compliance cannot read it", () => {
    expect(html("harsha", s => { s.ui.TFILT = "out"; })).toContain('<div class="empty">Nothing in this cut.</div>');
    const h = html("sahil", s => { s.data.TXN.unshift({ id: "T-0099", inv: "ARL-INV-0205", kind: "refund", amt: 100000,
      mode: "NEFT", utr: "X1", on: "01 Sep", by: "meena", rec: "pending" }); });
    expect(h).toContain('<span class="sm">1 not reconciled</span>');
    expect(h).toContain("<b>−₹1 L</b>");
    expect(h).toContain('<span class="tag late">refund</span>');
    expect(h).toContain('<span class="tag due"><span class="dot"></span>pending</span>');
    expect(html("imran")).toBe("");
    expect(html("fahad")).toBe("");
  });
});
