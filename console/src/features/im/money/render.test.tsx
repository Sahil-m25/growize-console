import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { imDemoData } from "@fixtures/im/demo";
import { initialImUi } from "@/lib/im";
import type { ImState, ImTxn } from "@/lib/im";
import { AppAccessCard, ArlHoldings, AllotCard, MoneyBlocks } from "./record";
import { PayoutsDue } from "./pages";
import { StatementCard } from "./statement";
import { MONEY_DRAWER_DEFS } from "./drawers";

const st = (f?: (s: ImState) => void): ImState => { const s: ImState = { data: imDemoData(), ui: initialImUi() }; if (f) f(s); return s; };
const props = (s: ImState, me: string) => ({ s, me, dispatch: () => {} });
const inv = (s: ImState, id: string) => s.data.INV.find(x => x.id === id)!;
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("the money cards, rendered from their endpoints' fixture halves", () => {
  it("Payments: the queue of payouts due this month, with Mark paid for Finance only", () => {
    const h = renderToStaticMarkup(<PayoutsDue {...props(st(), "harsha")} />);
    expect(text(h)).toContain("13 scheduled in Sep 2026");
    expect(h).toContain("Mark paid");
    expect(renderToStaticMarkup(<PayoutsDue {...props(st(), "imran")} />)).toBe("");
    expect(renderToStaticMarkup(<PayoutsDue {...props(st(), "latha")} />)).not.toContain("Mark paid");
  });
  it("the statement card: Finance Operations may upload, the Auditor is offered nothing", () => {
    const h = renderToStaticMarkup(<StatementCard {...props(st(), "meena")} />);
    expect(h).toContain("Upload the bank statement");
    expect(text(h)).toContain("Last reconciled: none yet");
    expect(renderToStaticMarkup(<StatementCard {...props(st(), "latha")} />)).toBe("");
  });
  it("App access: the card from the route's answer; a KAM reads it and cannot change it", () => {
    const s = st(), x = inv(s, "ARL-INV-0205");
    const h = renderToStaticMarkup(<AppAccessCard {...props(s, "harsha")} x={x} />);
    expect(text(h)).toContain("Welcome delivered");
    expect(h).toContain("Lock app access");
    expect(h).toContain("Preview app");
    expect(h).not.toContain("Test sign-in link");
    const k = renderToStaticMarkup(<AppAccessCard {...props(s, "imran")} x={x} />);
    expect(k).toContain("Finance controls app access.");
    expect(k).not.toContain("Lock app access");
    expect(renderToStaticMarkup(<AppAccessCard {...props(s, "sahil")} x={x} />)).toContain("Test sign-in link");
  });
  it("ARL holdings: the CCD and read only; nothing for a KAM", () => {
    const s = st(), x = inv(s, "ARL-INV-0212");
    const h = renderToStaticMarkup(<ArlHoldings {...props(s, "harsha")} x={x} />);
    expect(text(h)).toContain("ARL holdings read only");
    expect(h).toContain("H-01");
    expect(h).toContain("CCD");
    expect(renderToStaticMarkup(<ArlHoldings {...props(s, "imran")} x={x} />)).toBe("");
  });
  it("Money blocks: one block per farm with paid, due and what is recorded but not yet matched", () => {
    const s = st(x => {
      x.data.ALLOT!.push({ id: "AL-0205B", Customer: "ARL-INV-0205", LLP_Lookup: "LLP-B", Committed_Units: 2, Issued_Units: 0, Unit_Price: 2500000,
        Ticket_Snapshot: 5000000, Allocation_Status: "Reserved", Issued_On: null, Annual_Rental_Yield: 12 });
      x.data.TXN.filter(t => t.inv === "ARL-INV-0205").forEach(t => { t.Allotment = "AL-0205"; });
      x.data.TXN.unshift({ id: "T-0060", inv: "ARL-INV-0205", kind: "advance", amt: 500000, mode: "NEFT", utr: "X1", on: "02 Sep 10:00", by: "meena", rec: "pending", Allotment: "AL-0205B" } as ImTxn);
    });
    const t = text(renderToStaticMarkup(<MoneyBlocks {...props(s, "harsha")} x={inv(s, "ARL-INV-0205")} />));
    expect(t).toContain("Total across 2 farms");
    expect(t).toContain("recorded, not yet matched ₹5 L");
    expect(t).toContain("T-0060");
  });
  it("the Payouts tab of an allotment lists the 60 with the UTR masked", () => {
    const s = st(x => { x.ui.MX = { "al:ARL-INV-0212": "AL-0212|payouts" }; });
    const h = renderToStaticMarkup(<AllotCard {...props(s, "harsha")} x={inv(s, "ARL-INV-0212")} />);
    expect(h).toContain("••••0212");
    expect(h).not.toContain("PO2607100212");
    expect(h).toContain("Mark paid");
  });
  it("the drawers: Mark paid reads the allotment's schedule, the app preview reads the route's figures", () => {
    const s = st(x => { x.ui.MX = { "po:al": "AL-0219" }; });
    const po = s.data.PAYOUT!.find(p => p.Allotment === "AL-0219")!;
    const c = { ...props(s, "harsha"), id: po.id };
    const body = text(renderToStaticMarkup(<>{MONEY_DRAWER_DEFS.payout.body(c)}</>));
    expect(body).toContain("1 of 60");
    expect(body).toContain("Net to the investor");
    expect(text(renderToStaticMarkup(<>{MONEY_DRAWER_DEFS.payout.sub(c)}</>))).toContain("Block A");
    const pv = text(renderToStaticMarkup(<>{MONEY_DRAWER_DEFS.preview.body({ ...props(s, "harsha"), id: "ARL-INV-0212" })}</>));
    expect(pv).toContain("Preview — mock-up, not the live app");
    expect(pv).toContain("Hello, ");
    const lock = text(renderToStaticMarkup(<>{MONEY_DRAWER_DEFS.applock.body({ ...props(s, "harsha"), id: "ARL-INV-0205" })}</>));
    expect(lock).toContain("Sign-in is blocked from the moment you confirm");
  });
});
