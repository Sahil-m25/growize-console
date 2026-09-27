import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { imDemoData } from "@fixtures/im/demo";
import { initialImUi } from "@/lib/im";
import type { ImDrafts, ImDrawerKey, ImState } from "@/lib/im";
import { ImDrawer, imDrawerTitle } from "./index";

const st = (k: ImDrawerKey, id: string | null, drafts?: Partial<ImDrafts>): ImState => {
  const ui = initialImUi();
  ui.DRW = { k, id };
  if (drafts) ui.drafts = { ...ui.drafts, ...drafts };
  return { data: imDemoData(), ui };
};
const html = (s: ImState, me: string, docked = false) =>
  renderToStaticMarkup(<ImDrawer s={s} me={me} dispatch={() => {}} docked={docked} />);
/** the text a reader sees: tags out, whitespace collapsed as a browser does */
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, "\"")
  .replace(/&amp;/g, "&").replace(/\s+/g, " ");

describe("the frame (vDrawer)", () => {
  it("renders nothing without a drawer, or one this seat may not read", () => {
    const s = { data: imDemoData(), ui: initialImUi() };
    expect(html(s, "harsha")).toBe("");
    expect(html(st("pay", "ARL-INV-0208"), "latha")).toBe("");
    expect(imDrawerTitle(st("pay", "ARL-INV-0208"), "latha")).toBeNull();
    expect(html(st("kyc", "ARL-INV-0208"), "imran")).toBe("");
  });
  it("draws the scrim, dialog, header, close button and width", () => {
    const h = html(st("pay", "ARL-INV-0208"), "harsha");
    expect(h).toContain('<div class="scrim"></div>');
    expect(h).toContain('role="dialog" aria-modal="true" aria-label="Record a receipt" style="--dw:430px"');
    expect(h).toContain("<h2>Record a receipt</h2>");
    expect(h).toContain('<div class="sub">Prakash Bhat</div>');
    expect(h).toContain('aria-label="Close “Record a receipt”" title="Close “Record a receipt” (Esc)"');
    expect(h).toContain('<footer class="drwf">');
    expect(imDrawerTitle(st("pay", "ARL-INV-0208"), "harsha")).toBe("Record a receipt");
  });
  it("docked: no scrim, not modal", () => {
    const h = html(st("upd", null), "fahad", true);
    expect(h).not.toContain("scrim");
    expect(h).toContain('aria-modal="false"');
    expect(h).toContain('<div class="sub">it appears in the investor&#x27;s app</div>');
  });
  it("the super user is told whose step it is", () => {
    const t = text(html(st("kyc", "ARL-INV-0208"), "sahil"));
    expect(t).toContain("Super user. The primary doer of this step is Compliance — Fahad Rizvi. You can do it here to test it; it is recorded as yours.");
    expect(text(html(st("kyc", "ARL-INV-0208"), "fahad"))).not.toContain("Super user.");
  });
});

describe("the drawers", () => {
  it("pay — a balance after the advance", () => {
    const t = text(html(st("pay", "ARL-INV-0208"), "harsha"));
    expect(t).toContain("What has landed");
    expect(t).not.toContain("The 10% advance");
    expect(t).toContain("The balance ₹22.5 L");
    expect(t).toContain("RTGS NEFT IMPS SWIFT Cheque");
    expect(t).toContain("Reserved, with a 30-day clock to");
    expect(t).toContain("The receipt is written here and appears on the IR's lead within the minute. They do not record it and cannot.");
    expect(t).toContain("Record it");
  });
  it("send — an NRI on Aadhaar OTP is refused", () => {
    const h = html(st("send", "ARL-INV-0209", { DTPL: "Allocation letter" }), "meena");
    const t = text(h);
    expect(t).toContain("Joseph Mathew is an NRI. Aadhaar OTP needs an Aadhaar linked to a live Indian mobile. Use a Class 3 DSC or a wet signature.");
    expect(h).toContain('disabled="" title="Pick a template">Send it</button>');
    expect(h).toContain('title="Already out or signed">Supplementary agreement<span class="u">on file</span>');
    expect(h).toContain('Power of attorney<span class="u">wet sign</span>');
  });
  it("kyc — the NRI note and the reveal control", () => {
    const t = text(html(st("kyc", "ARL-INV-0209"), "fahad"));
    expect(t).toContain("Non-resident — passport and visa route, no Aadhaar");
    expect(t).toContain("Non-resident — FEMA applies");
    expect(t).toContain("An NRI holding cannot be allotted without a signed FEMA declaration");
    expect(t).toContain("Pass it Fail it");
    expect(t).toContain("Finance Operations and above may see a bank account — not this seat");
  });
  it("claim — the IR's word and the two answers", () => {
    const t = text(html(st("claim", "N-08"), "harsha"));
    expect(t).toContain("Rohit Verma wrote this on the lead side 27 Aug 17:35");
    expect(t).toContain("It is not a receipt and it has moved nothing.");
    expect(t).toContain("Confirm and record it Not there yet");
    expect(html(st("claim", "N-08"), "divya")).toBe("");
  });
  it("verify — no word from the IR yet", () => {
    const t = text(html(st("verify", "D-041"), "fahad"));
    expect(t).toContain("Document FEMA declaration Regulatory");
    expect(t).toContain("No word from the IR yet. Verifying now is fine if the signed copy is in front of you");
    expect(t).toContain("The signed copy is here Nothing has come back");
  });
  it("kam — the pool, and a named manager's load", () => {
    const t = text(html(st("kam", "ARL-INV-0212"), "divya"));
    expect(t).toContain("The shared pool — no named manager");
    expect(t).toContain("Imran Sheikh holds it now.");
    const t2 = text(html(st("kam", "ARL-INV-0212", { KSEL: "neha" }), "divya"));
    expect(t2).toContain("What Neha carries today");
    expect(t2).toContain("a month at the cadences they are already promised, before this one.");
    expect(t2).toContain("Hand it to them");
  });
  it("talk — a KAM on their own book", () => {
    const t = text(html(st("talk", "ARL-INV-0212"), "imran"));
    expect(t).toContain("How Call Farm visit Email WhatsApp");
    expect(t).toContain("How it felt Warm Fine A concern");
    expect(t).toContain("On the cadence In a fortnight In a month In three months");
    expect(html(st("talk", "ARL-INV-0212"), "neha")).toBe("");
  });
  it("tkt, upd, field, details", () => {
    const tk = html(st("tkt", null), "meena");
    expect(text(tk)).toContain("Bank Compliance Records Query Access");
    expect(tk).toContain('title="An investor and a line saying what they want">Open it</button>');
    const up = text(html(st("upd", null, { UP: { t: "x", cat: "Produce", d: "", to: "all" } }), "fahad"));
    expect(up).toContain("Everyone on the book 15");
    expect(up).toContain("Publish it");
    const fh = html(st("field", null), "neha");
    expect(text(fh)).toContain("This is not a release.");
    expect(fh).toContain('title="Say what happened">Record it</button>');
    const dt = html(st("details", "ARL-INV-0212"), "imran");
    expect(text(dt)).toContain("A name change is not free.");
    expect(dt).toContain('value="Sanjay Kulkarni"');
    expect(dt).toContain("Save the changes");
  });
});
