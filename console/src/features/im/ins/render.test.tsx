import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { imDemoData } from "@fixtures/im/demo";
import { initialImUi, type ImState } from "@/lib/im";
import { ImIns } from ".";

const st = (sec?: string): ImState => ({ data: imDemoData(), ui: { ...initialImUi(), SEC: sec ? { ins: sec } : {} } });
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const render = (me: string, sec?: string) => renderToStaticMarkup(<ImIns s={st(sec)} me={me} dispatch={() => {}} />);

describe("Insights (vIns)", () => {
  it("Head of Finance: the money sections, Collection first", () => {
    const h = render("harsha"), t = text(h);
    expect(t).toContain("Numbers the money side and the service side — the funnel lives on the lead side");
    for (const s of ["Collection", "At risk", "Paper", "Compliance", "Service"]) expect(t).toContain(s);
    expect(t).toContain("the 208-unit target is the BU plan's, not the Investors side's");
    expect(t).toContain("of the programme collected");
    expect(t).toContain("Banked is what has cleared. Committed is an advance held against a balance that has not — it is a liability until the rest lands, and it is never shown inside the banked figure.");
    expect(h).toContain('<a class="lnk" role="button" tabindex="0">Payments</a>');
  });
  it("At risk, Paper and Compliance", () => {
    /* M16-S08-W1: the route lists part-paid reservations with the balance still due, oldest receipt first (no forfeit exposure, no hold bands) */
    expect(text(render("harsha", "risk"))).toContain("Balance ageing ₹1.13 Cr still due on money already part-paid");
    expect(text(render("harsha", "risk"))).toContain("Joseph Mathew ₹10 L of ₹1 Cr in · last receipt 22 Aug ₹90 L");
    expect(text(render("harsha", "risk"))).toContain("Every reservation that lapses costs the investor ₹50,000 a unit and costs Growize a sale it had already counted. The longest since a receipt is the first worth anybody's morning.");
    const p = text(render("harsha", "paper"));
    expect(p).toContain("6d FEMA declaration Joseph Mathew · sent 26 Aug by Meena · Class 3 DSC · link expires 09 Sep Open");
    expect(p).toContain("The chasing itself belongs to the IR");
    const c = text(render("latha", "comp"));
    /* the route's row carries what is missing, never an Aadhaar figure (rule 7): PAN on file, bank not matched, FEMA outstanding */
    expect(c).toContain("Joseph Mathew ARL-INV-0209 KYC pending on file not matched outstanding allotment");
    expect(c).toContain("it blocks allotment , and it does so silently unless somebody reads this.");
  });
  it("Service: Finance head sees By manager; the Auditor does not", () => {
    const h = text(render("harsha", "svc"));
    expect(h).toContain("2 accounts gone quiet 85% inside their cadence 3 tickets past their window 1 ended on a concern By manager");
    expect(h).toContain("The shared pool no named manager 5 0 none — — 1 should be named");
    expect(text(render("latha", "svc"))).not.toContain("By manager");
  });
  it("AM seats: Service only; a KAM gets the cadence card for their own book", () => {
    const d = text(render("divya", "cash"));
    expect(d).toContain("Numbers how well the book is being looked after Service 2");
    expect(d).not.toContain("Collection");
    const k = text(render("imran"));
    expect(k).toContain("The cadence your book, by tier Tier A 4+ units a named manager, monthly 3");
    expect(k).toContain("It is a statement about what 2 people can deliver, written down before it is promised — which is the only version of a service promise anybody keeps. That is 3.3 conversations a month of yours.");
  });
  it("the administrators' seats do not read Insights", () => {
    expect(render("pradeep")).toBe("");
  });
});
