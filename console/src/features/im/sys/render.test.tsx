import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { imDemoData } from "@fixtures/im/demo";
import { imReducer, initialImUi, type ImState } from "@/lib/im";
import { ImSys } from ".";

const st = (sec?: string): ImState => ({ data: imDemoData(), ui: { ...initialImUi(), SEC: sec ? { sys: sec } : {} } });
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const render = (s: ImState, me: string) => text(renderToStaticMarkup(<ImSys s={s} me={me} dispatch={() => {}} />));

describe("System (vSys)", () => {
  it("Super administrator: the link, investor details withheld", () => {
    const t = render(st(), "pradeep");
    expect(t).toContain("System the two applications, and whether they are telling each other the truth nothing stuck 5 in from the lead side 1 of those still open 0 sent back this session 0 stuck");
    expect(t).toContain("open IR claim event Investor details withheld · Rohit Verma · 27 Aug 17:35");
    expect(t).toContain("Nothing has gone back in this session.");
    expect(t).toContain("One fact, one writer.");
    expect(t).not.toMatch(/ARL-INV-\d/);
  });
  it("Do the books agree", () => {
    const t = render(st("agree"), "pradeep");
    expect(t).toContain("96 units released 40 units spoken for 56 free to sell 0 marks that disagree with the ledger");
    expect(t).toContain("No unit is sold twice holds 96 released, 40 spoken for Two investors are told they own the same trees.");
    expect(t).toContain("Every document has an owner holds");
  });
  it("Who did what: a reveal and a seat change appear, the identity itself never does", () => {
    let s = st("who");
    s = imReducer(s, "harsha", { type: "reveal", id: "ARL-INV-0205", f: "pan", why: "A filing or a TDS check" });
    s = imReducer(s, "pradeep", { type: "setSeat", k: "meena", r: "comp" });
    const t = render(s, "pradeep");
    expect(t).toContain("Who did what 1");
    expect(t).toContain("◉ Identity event HB Harsha Bhat · Investor details withheld");
    expect(t).toContain("Meena Raghavan: Finance Operations → Compliance & KYC");
    expect(t).not.toContain("AVRPM4471K");
    expect(t).toContain("Pradeep Ram Administration Super administrator");
  });
  it("What is not built; the Auditor and Finance head do not reach System", () => {
    expect(render(st("gaps"), "sahil")).toContain("open The link itself is a demo. INBOX and OUTBOX are arrays in this file.");
    expect(render(st(), "latha")).toBe("");
    expect(render(st(), "harsha")).toBe("");
  });
});
