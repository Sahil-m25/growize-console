import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { imDemoData } from "@fixtures/im/demo";
import { imReducer, initialImUi, REVWHY } from "@/lib/im";
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
    expect(h).toContain('RTGS · <span class="mono">••• 6771</span>');
    expect(h).not.toContain("HDFC1206771");
    expect(h).toContain("Show the reference");
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
  it("Sahil (D68/D110): every reference masked, each row offers 'Show the reference' (TC-E15-009); after the logged reveal that row alone shows in full (TC-E11-016)", () => {
    const h = html("sahil");
    expect(h).toContain('SWIFT · <span class="mono">••• 8119</span>');
    expect(h).toContain('NEFT · <span class="mono">••• 8551</span>');
    expect(h).toContain('RTGS · <span class="mono">••• 8430</span>');
    expect(h).not.toContain("Finance only");
    expect(h.match(/Show the reference/g)).toHaveLength(15);     /* the button, once per row */
    const s: ImState = { data: imDemoData(), ui: initialImUi() };
    const after = imReducer(s, "sahil", { type: "revealRef", id: "T-0030" });
    const h2 = renderToStaticMarkup(<ImTxn s={after} me="sahil" dispatch={() => {}} />);
    expect(h2).toContain('SWIFT · <span class="mono">EMIR2608119</span>');
    expect(h2).toContain("Hide the reference");
    expect(h2).toContain('NEFT · <span class="mono">••• 8551</span>');
    expect(after.data.LOG[0]).toMatchObject({ what: "Revealed a bank reference", who: "sahil", note: "Payments · ••• 8119 · shown to Sahil Mohite" });
    /* the reveal belongs to the person who made it: Harsha still reads it masked */
    expect(renderToStaticMarkup(<ImTxn s={after} me="harsha" dispatch={() => {}} />)).toContain('SWIFT · <span class="mono">••• 8119</span>');
  });
  it("M18-S05-NOTE-3: 'Show the reference' asks the reason first — the bank-account chips — on that row only; nothing is logged or shown until one is chosen", () => {
    const s: ImState = { data: imDemoData(), ui: initialImUi() };
    expect(html("sahil")).not.toContain("Why do you need it?");
    const asking = imReducer(s, "sahil", { type: "refAsk", id: "T-0030" });
    expect(asking.ui.REVASK).toEqual({ id: "T-0030", f: "ref" });
    expect(asking.data.LOG.length).toBe(s.data.LOG.length);
    const h = renderToStaticMarkup(<ImTxn s={asking} me="sahil" dispatch={() => {}} />);
    expect(h.match(/Why do you need it\?/g)).toHaveLength(1);
    for (const r of REVWHY.acct) expect(h).toContain(`<button class="chip">${r}</button>`);
    expect(h).toContain('<button class="chip">Cancel</button>');
    expect(h).toContain('SWIFT · <span class="mono">••• 8119</span>');
    expect(imReducer(asking, "sahil", { type: "revCancel" }).ui.REVASK).toBeNull();
    /* the chosen reason closes the logged note; the reveal clears the ask */
    const after = imReducer(asking, "sahil", { type: "revealRef", id: "T-0030", why: "A payout or a refund" });
    expect(after.ui.REVASK).toBeNull();
    expect(after.data.LOG[0]).toMatchObject({ what: "Revealed a bank reference", note: "Payments · ••• 8119 · shown to Sahil Mohite · A payout or a refund" });
    /* words that are not one of the chips are not written */
    const odd = imReducer(s, "sahil", { type: "revealRef", id: "T-0030", why: "HDFC1206771 because" });
    expect(odd.data.LOG[0].note).toBe("Payments · ••• 8119 · shown to Sahil Mohite");
  });
  it("a seat that cannot reveal gets no button and no log: the Auditor reads 'Finance only', and revealRef is refused for it", () => {
    const h = html("latha");
    expect(h).toContain("Finance only");
    expect(h).not.toContain("Show the reference");
    const s: ImState = { data: imDemoData(), ui: initialImUi() };
    for (const me of ["latha", "imran", "fahad"]) {
      const r = imReducer(s, me, { type: "revealRef", id: "T-0030" });
      expect(r.data.LOG.length).toBe(s.data.LOG.length);
      expect(r.ui.SHOWN).toEqual({});
    }
  });
});
