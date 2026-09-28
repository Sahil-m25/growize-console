import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { imDemoData } from "@fixtures/im/demo";
import { imReducer, initialImUi, type ImState } from "@/lib/im";
import { ImAct } from ".";

const st = (): ImState => ({ data: imDemoData(), ui: initialImUi() });
const html = (s: ImState, me: string) => renderToStaticMarkup(<ImAct s={s} me={me} dispatch={() => {}} />);
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");

describe("Activity (vAct)", () => {
  it("Super user: the book's log, rows open the investor", () => {
    const h = html(st(), "sahil"), t = text(h);
    expect(t).toContain("Activity 12 accessible entries · your work on accounts you can open");
    expect(t).toContain("Everyone MR Meena 6 FR Fahad 3 HB Harsha 3 All kinds ₹ Money 3");
    expect(t).toContain("29 Aug 10:22 MR Meena ◑ Tickets Opened a ticket ARL-INV-0205 TK-0114 · bank account change");
    expect(h).toContain('<tr class="k" tabindex="0">');
  });
  it("Super administrator: organisation audit, investor details withheld", () => {
    const t = text(html(st(), "pradeep"));
    expect(t).toContain("organisation audit with investor details withheld");
    expect(t).toContain("Tickets event — Investor details withheld");
    expect(t).not.toMatch(/ARL-INV-\d/);
  });
  it("a reveal is counted and its value never shown; a KAM sees only their own work", () => {
    const s = imReducer(st(), "harsha", { type: "reveal", id: "ARL-INV-0205", f: "pan", why: "A filing or a TDS check" });
    const t = text(html(s, "harsha"));
    expect(t).toContain("1 identity reveal");
    expect(t).toContain("◉ Identity Revealed a PAN ARL-INV-0205 A filing or a TDS check");
    expect(t).not.toContain("AVRPM4471K");
    expect(text(html(st(), "imran"))).toContain("0 accessible entries · your work on accounts you can open Your activity All kinds When Who What Investor Detail Nothing in this cut.");
  });
  it("the who and kind filters narrow the rows", () => {
    const s = st(); s.ui.LOGWHO = "fahad"; s.ui.LOGKIND = "tkt";
    const t = text(html(s, "sahil"));
    expect(t).toContain("28 Aug 15:06 FR Fahad ◑ Tickets Opened a ticket ARL-INV-0209");
    expect(t).not.toContain("29 Aug 10:22");
  });
});
