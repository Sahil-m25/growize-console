/* M09-S08 — the Investors page for an IR (D113 ruling 2): the same list and record components, scoped and read-only. */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { imDemoData } from "@fixtures/im/demo";
import { initialImUi } from "@/lib/im";
import type { ImUi } from "@/lib/im";
import { ImInv } from "./index";

vi.mock("@/features/leads/nav", () => ({ useGoLead: () => () => {} }));

const text = (h: string) => h.replace(/<br\/?>/g, " ").replace(/<[^>]+>/g, "")
  .replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const render = (me: string, ui: Partial<ImUi> = {}, irSeat = true) => {
  const s = { data: imDemoData(), ui: { ...initialImUi(), ...ui } };
  const html = renderToStaticMarkup(<ImInv s={s} me={me} dispatch={() => {}} irSeat={irSeat} />);
  return { html, t: text(html) };
};
const rec = (me: string, id: string, sec: string) => render(me, { SEL: id, SEC: { ["inv:" + id]: sec } });
const MONEY = /₹|\bPaid\b|\bDue\b|\bMoney\b|Receipt|\bKYC\b|\bPAN\b|Aadhaar|\bBank\b|Finance only|FEMA|\bTier\b|\bprice\b|\byield\b/;

describe("M09-S08 — the IR's Investors list", () => {
  it("Rohit: five investors from his own leads, in the columns Investor, ARL ID, Farms, State, Lead", () => {
    const { t, html } = render("rohit");
    expect(t).toContain("Investors5 from your leads");
    expect(t).toContain("InvestorARL IDFarmsStateLead");
    expect(t).toContain("Prakash BhatARL-INV-0208Block B ×1reservedOpen lead ›");
    for (const n of ["Abhijit Sen", "Anjali Deshpande", "Sanjay Kulkarni", "T. Balasubramanian"]) expect(t).toContain(n);
    expect(html).toContain('placeholder="Name, ARL ID, farm…"');
    expect(html.match(/<tr class="k"/g)).toHaveLength(5);
  });
  it("AC2/AC4: nobody else's investor, and no money, KYC, tier, manager or identity column or control", () => {
    const { t } = render("rohit");
    expect(t).not.toContain("Radhika Menon");   /* Kavya's */
    expect(t).not.toMatch(MONEY);
    expect(t).not.toMatch(/Add investor|Balance outstanding|Gone quiet|Manager/);
  });
  it("Kavya sees hers, not Rohit's; an IR with no investor yet is told so", () => {
    const k = render("kavya").t;
    expect(k).toContain("Radhika Menon");
    expect(k).not.toContain("Prakash Bhat");
    expect(render("ananya").t).not.toContain("Prakash Bhat");
  });
  it("the search box narrows the IR's own list and cannot reach beyond it", () => {
    expect(render("rohit", { IQ: "prakash" }).t).toContain("Prakash Bhat");
    expect(render("rohit", { IQ: "prakash" }).t).not.toContain("Sanjay Kulkarni");
    expect(render("rohit", { IQ: "radhika" }).t).toContain("Nobody matches that.");
  });
});

describe("M09-S08 — the IR's record, read-only with money sections hidden", () => {
  it("Rohit on Prakash: Who they are, What they hold, Journey — no Money, Paper, Care or Tickets", () => {
    const who = rec("rohit", "ARL-INV-0208", "who").t;
    expect(who).toContain("Prakash BhatARL-INV-0208");
    expect(who).toContain("Who they areWhat they holdJourney");
    expect(who).toContain("Mobile+91 97400 55519");
    expect(who).toContain("This is your own investor, read only.");
    expect(who).not.toMatch(MONEY);
    expect(who).not.toMatch(/Paper|Care|Tickets|Change their details|Work the KYC|reveal/);
  });
  it("hold: units and land, no price, hold banner, release or extend, app account or holdings", () => {
    const h = rec("rohit", "ARL-INV-0208", "hold").t;
    expect(h).toContain("Units1");
    expect(h).toContain("1 on Block B");
    expect(h).toContain("Reserved. Not allotted until the balance lands.");
    expect(h).not.toMatch(MONEY);
    expect(h).not.toMatch(/Release|Extend|forfeit|App access|The app account|Allotment/i);
  });
  it("journey: the lead side's story up to Said yes", () => {
    const j = rec("rohit", "ARL-INV-0208", "jrn").t;
    expect(j).toContain("Said yes");
    expect(j).toContain("Brought in by you");
    expect(j).not.toMatch(MONEY);
  });
  it("AC2: another IR's investor by id does not open — the page says so and shows the IR's own list", () => {
    const { t } = render("rohit", { SEL: "ARL-INV-0209" });
    expect(t).toContain("Not opened.");
    expect(t).toContain("Prakash Bhat");
    expect(t).not.toContain("Radhika Menon");
    expect(t).not.toContain("ARL-INV-0209");
  });
});

describe("M09-S08 — the Investors-side pages are unchanged", () => {
  it("Finance still reads the whole book; a person with no Investors seat who is not an IR gets nothing", () => {
    expect(render("harsha", {}, false).t).toContain("15 on the book");
    expect(render("rohit", {}, false).html).toBe("");
  });
});
