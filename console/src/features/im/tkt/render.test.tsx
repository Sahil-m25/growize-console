import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { imDemoData } from "@fixtures/im/demo";
import { initialImUi } from "@/lib/im";
import type { ImState } from "@/lib/im";
import { ImTkt } from "./index";

const html = (me: string, f?: (s: ImState) => void) => {
  const s: ImState = { data: imDemoData(), ui: initialImUi() }; if (f) f(s);
  return renderToStaticMarkup(<ImTkt s={s} me={me} dispatch={() => {}} />);
};

describe("ImTkt (imx.js tkRow, vTkt)", () => {
  it("Key Account Manager: own queue, hand a bank ticket to Finance", () => {
    const h = html("imran");
    expect(h).toContain('<span class="sub">what an investor asks for after they have paid</span>');
    expect(h).toContain('<button class="act">＋ Open a ticket</button>');
    expect(h).not.toContain(">Mine<");
    expect(h).toContain('<button class="chip on">Hand it to Finance</button>');
    expect(h).toContain("a bank account cannot be changed from this side, and should not be");
    expect(h).toContain(" · 4 days old, SLA 2 working days");
    expect(h).toContain("which is why the category is on every row, and why this screen holds only the ones that are yours.");
  });
  it("Compliance: Mine cut, a bank ticket it cannot work", () => {
    const h = html("fahad");
    expect(h).toContain('<button class="sc on">Open<i>6</i></button><button class="sc ">Mine<i>1</i></button>');
    expect(h).toContain('<span class="tag">a bank ticket needs a seat that can see the account</span>');
    expect(h).toContain('<button class="chip">Waiting on them</button>');
    expect(h).toContain('<button class="chip on">Close it</button>');
    expect(h).toContain("category is on every row.</p>");
  });
  it("Auditor: read only, closed cut; an AM seat with nothing sees its empty state", () => {
    const a = html("latha", s => { s.ui.KFILT = "closed"; });
    expect(a).toContain('<span class="tag">read only</span>');
    expect(a).toContain('<span class="tag go"><span class="dot"></span>closed</span>');
    expect(a).toMatch(/ · closed <span class="mono">\d\d [A-Z][a-z]{2}<\/span>/);
    const n = html("neha", s => { s.data.TKT = []; });
    expect(n).toContain("Nothing assigned to you. A ticket on one of your accounts can still be Finance");
  });
  it("W2-KAM-2: live ISO opened / SLA stamps read as a day, an age in days and a formatted SLA - never 'opened 2026-1' or 'null days old'", () => {
    const h = html("imran", s => { s.data.TKT = s.data.TKT.map(t => ({ ...t, opened: "2026-08-29T04:15", sla: "2026-09-05T22:36" })); });
    expect(h).toContain('opened <span class="mono">29 Aug</span>');
    expect(h).toContain(" · 4 days old, SLA 05 Sep 22:36");
    expect(h).not.toMatch(/2026-1|null days|T22:36/);
    const none = html("imran", s => { s.data.TKT = s.data.TKT.map(t => ({ ...t, sla: "" })); });
    expect(none).toContain("old, SLA not set");
  });
});
