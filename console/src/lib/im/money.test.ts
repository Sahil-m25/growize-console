import { describe, expect, it } from "vitest";
import {
  UNIT, accessView, addInvestorGate, allotPayStatus, allotPickGate, allotsOf, allotsOnLlp, drawerReadable, dupEmail,
  emptyImData, fmtDate, imReducer, llpCounts, markPaidGate, mayHoldings, mayMatch, matchWhy, monthlyGross, nextInvId,
  onSale, paymentStatus, payoutNet, payoutSchedule, payoutsDue, prePick, qrCells, testLinkState, holdingsOf,
} from "./index";
import type { ImAllot, ImState } from "./index";
import { act, kit } from "./test-kit";

/* the kit book plus allotments on two LLPs, a schedule and app access */
const al = (o: Partial<ImAllot> & { id: string; Customer: string }): ImAllot => ({
  LLP_Lookup: "LLP-X", Committed_Units: 1, Issued_Units: 1, Unit_Price: UNIT, Ticket_Snapshot: UNIT,
  Allocation_Status: "Issued", Issued_On: "2026-08-01", Annual_Rental_Yield: 12, ...o,
});
function book(): ImState {
  const s = kit();
  const d = s.data;
  d.LLP = [
    { id: "LLP-X", Name: "Block X", Block_Code: "X", Unit_Price: UNIT, LLP_Status: "Open for Issuance", PAN: "AAKFX0000X",
      GST: "29AAKFX0000X1Z1", SPOCs: [], Insurer: "", Insurance_Policy_No: "", Insured_Till: "", Annual_Rental_Yield: 12 },
    { id: "LLP-Y", Name: "Block Y", Block_Code: "Y", Unit_Price: UNIT, LLP_Status: "Draft", PAN: "AAKFY0000Y",
      GST: "29AAKFY0000Y1Z1", SPOCs: [], Insurer: "", Insurance_Policy_No: "", Insured_Till: "", Annual_Rental_Yield: 12 },
  ];
  d.ALLOT = [
    al({ id: "AL-A1", Customer: "A1", Committed_Units: 4, Issued_Units: 4, Ticket_Snapshot: 4 * UNIT }),
    al({ id: "AL-B1", Customer: "B1", Committed_Units: 2, Issued_Units: 2, Ticket_Snapshot: 2 * UNIT }),
    /* R2 holds two allotments: its advance is on X, and one unit reserved on Y */
    al({ id: "AL-R2", Customer: "R2", Committed_Units: 1, Issued_Units: 0, Allocation_Status: "Reserved", Issued_On: null }),
    al({ id: "AL-R2-Y", Customer: "R2", LLP_Lookup: "LLP-Y", Committed_Units: 1, Issued_Units: 0, Allocation_Status: "Reserved", Issued_On: null }),
    al({ id: "AL-R1", Customer: "R1", Committed_Units: 1, Issued_Units: 0, Allocation_Status: "Reserved", Issued_On: null }),
  ];
  d.TXN.find(t => t.id === "T-0004")!.Allotment = "AL-R2";
  d.PAYOUT = payoutSchedule(d.ALLOT[0]).concat(payoutSchedule(d.ALLOT[1]));
  d.ACCESS = { A1: { App_Access: "Invite", App_Welcome_At: "01 Aug 10:00", App_Welcome_Channel: "Email" },
    R1: { App_Access: "Hold", App_Welcome_At: null, App_Welcome_Channel: null } };
  d.HOLDING = [{ id: "H-1", Contact: "A1", Instrument_Type: "CCD", Amount_Invested: 100, Invested_On: "2026-01-01", Interest_Rate: 10, Maturity_On: null }];
  return s;
}

describe("payouts (M10-S20, D82, D84)", () => {
  it("builds 60 monthly records from an issued allotment, the first due the month after issue", () => {
    const p = payoutSchedule(al({ id: "AL-Q", Customer: "Q", Issued_On: "2026-06-12", Issued_Units: 6, Committed_Units: 6 }));
    expect(p.length).toBe(60);
    expect(p[0]).toMatchObject({ Instalment_No: 1, Due_On: "2026-07-10", Period_Month: "2026-07", Payout_State: "Scheduled", TDS_Amount: 0 });
    expect(p[59].Due_On).toBe("2031-06-10");
    expect(p[0].Gross_Amount).toBe(150000);              /* 6 × ₹25 L × 12% ÷ 12 */
    expect(p[0].Net_Amount).toBe(p[0].Gross_Amount);
  });
  it("gives a Reserved or Cancelled allotment no schedule", () => {
    expect(payoutSchedule(al({ id: "AL-R", Customer: "R", Allocation_Status: "Reserved", Issued_On: null }))).toEqual([]);
    expect(payoutSchedule(al({ id: "AL-C", Customer: "C", Allocation_Status: "Cancelled" }))).toEqual([]);
  });
  it("nets TDS Finance typed and never computes it", () => {
    expect(payoutNet(25000, 0)).toBe(25000);
    expect(payoutNet(25000, 2500)).toBe(22500);
    expect(monthlyGross(al({ id: "x", Customer: "x" }))).toBe(25000);
  });
  it("queues the Scheduled payouts due in NOW's month, for Finance only", () => {
    const s = book();
    const due = payoutsDue(s, "fin");
    expect(due.map(p => p.id)).toEqual(["PO-A1-01", "PO-B1-01"]);
    expect(due.every(p => p.Due_On === "2026-09-10")).toBe(true);
    expect(payoutsDue(s, "aud")).toEqual([]);
    expect(payoutsDue(s, "kam1")).toEqual([]);
  });
  it("marks one paid once — the second press is refused and changes nothing", () => {
    let s = book();
    const pay = { type: "markPayoutPaid" as const, id: "PO-A1-01", paidOn: "2026-09-02", mode: "NEFT" as const, utr: "hdfc9", tds: 1000 };
    expect(markPaidGate(s, "fin", "PO-A1-01", "", 0, "2026-09-02")).toMatchObject({ ok: false });
    expect(markPaidGate(s, "fin", "PO-A1-01", "U1", 200000, "2026-09-02")).toMatchObject({ ok: false });
    expect(markPaidGate(s, "fin", "PO-A1-01", "U1", 0, "2026-09-03")).toMatchObject({ ok: false });
    expect(markPaidGate(s, "aud", "PO-A1-01", "U1", 0, "2026-09-02")).toMatchObject({ ok: false, msg: null });
    s = act(s, "ops1", pay);
    const p = s.data.PAYOUT!.find(x => x.id === "PO-A1-01")!;
    expect(p).toMatchObject({ Payout_State: "Paid", Paid_By: "ops1", Payout_UTR: "HDFC9", TDS_Amount: 1000, Net_Amount: 99000, Paid_On: "2026-09-02" });
    expect(s.data.LOG[0].what).toBe("Marked a payout paid");
    const again = act(s, "fin", pay);
    expect(again.ui.NOTE!.msg).toMatch(/already marked paid by Ops One/);
    expect(again.data.PAYOUT).toEqual(s.data.PAYOUT);
    /* one UTR pays one payout */
    expect(markPaidGate(s, "fin", "PO-B1-01", "HDFC9", 0, "2026-09-02")).toMatchObject({ ok: false });
  });
});

describe("allotments and receipts (M10-S07, M10-S08, M11-S01, M11-S02)", () => {
  it("reads Payment_Status from matched receipts against the allotment amount", () => {
    expect(paymentStatus(0, 100)).toBe("Yet to initiate");
    expect(paymentStatus(10, 100)).toBe("Partial");
    expect(paymentStatus(100, 100)).toBe("Full");
    const s = book();
    expect(allotPayStatus(s, s.data.ALLOT![0])).toBe("Full");
    expect(allotPayStatus(s, s.data.ALLOT![2])).toBe("Partial");
    expect(allotPayStatus(s, s.data.ALLOT![3])).toBe("Yet to initiate");
  });
  it("pre-picks the only allotment and requires a pick when there are several", () => {
    const s = book();
    expect(prePick(s, "fin", "R1")).toBe("AL-R1");
    expect(prePick(s, "fin", "R2")).toBe(null);
    expect(allotPickGate(s, "fin", "R2", null, "balance")).toMatchObject({ ok: false });
    expect(allotPickGate(s, "fin", "R2", "AL-R2", "balance")).toEqual({ ok: true });
    expect(allotPickGate(s, "fin", "R2", "AL-A1", "balance")).toMatchObject({ ok: false });
  });
  it("links nothing but a refund to a Cancelled allotment", () => {
    const s = book();
    s.data.ALLOT![1].Allocation_Status = "Cancelled";
    expect(allotPickGate(s, "fin", "B1", "AL-B1", "balance")).toMatchObject({ ok: false });
    expect(allotPickGate(s, "fin", "B1", "AL-B1", "refund")).toEqual({ ok: true });
  });
  it("refuses a receipt with no farm picked, and links the picked one", () => {
    const s = book();
    /* R2's supplementary is signed; its hold ran out, but recording money is always allowed (D21) */
    const r = act(s, "ops1", { type: "recordPay", id: "R2", kind: "balance", utr: "X1" });
    expect(r.ui.NOTE!.msg).toMatch(/Pick the farm/);
    expect(r.data.TXN.length).toBe(s.data.TXN.length);
    const ok = act(s, "ops1", { type: "recordPay", id: "R2", kind: "balance", utr: "X1", allot: "AL-R2" });
    expect(ok.data.TXN[0].Allotment).toBe("AL-R2");
    /* the receipt is for that farm's balance, and the other farm still owes, so it stays reserved */
    expect(ok.data.TXN[0].amt).toBe(UNIT - 500000);
    expect(ok.data.INV.find(x => x.id === "R2")!.st).toBe("reserved");
  });
  it("counts an LLP's reserved and issued units off its allotments; Cancelled counts for nothing", () => {
    const s = book();
    const X = s.data.LLP![0];
    s.data.FARMS[0].units = 10;
    expect(llpCounts(s, X)).toEqual({ reserved: 2, issued: 6, free: 2 });
    s.data.ALLOT![1].Allocation_Status = "Cancelled";
    expect(llpCounts(s, X)).toEqual({ reserved: 2, issued: 4, free: 4 });
    expect(onSale(X)).toBe(true);
    expect(onSale(s.data.LLP![1])).toBe(false);          /* Draft: not on sale */
  });
  it("shows a KAM only the allotments of investors they manage", () => {
    const s = book();
    expect(allotsOf(s, "kam1", "A1").length).toBe(1);
    expect(allotsOf(s, "kam1", "B1")).toEqual([]);
    expect(allotsOnLlp(s, "kam1", "LLP-X").map(a => a.id)).toEqual(["AL-A1"]);
    expect(allotsOnLlp(s, "fin", "LLP-X").length).toBe(4);
  });
  it("lists a row with no Customer to a Money seat, not to a KAM (Needs a link, M11-S02-NOTE-6)", () => {
    const s = book();
    s.data.ALLOT!.push({ ...s.data.ALLOT![0], id: "AL-ORPHAN", Customer: "" });
    expect(allotsOnLlp(s, "fin", "LLP-X").map(a => a.id)).toContain("AL-ORPHAN");
    expect(allotsOnLlp(s, "kam1", "LLP-X").map(a => a.id)).not.toContain("AL-ORPHAN");
  });
});

describe("app access (M10-S21, D93)", () => {
  it("reads the card's four states", () => {
    expect(accessView({ App_Access: "Hold", App_Welcome_At: null, App_Welcome_Channel: null }).t)
      .toBe("On hold — data synced, sign-in locked, no email sent");
    expect(accessView({ App_Access: "Invite", App_Welcome_At: null, App_Welcome_Channel: null }).t).toBe("Welcome sending…");
    expect(accessView({ App_Access: "Invite", App_Welcome_At: "02 Sep 10:00", App_Welcome_Channel: "Email" }).t)
      .toBe("Welcome delivered 02 Sep 10:00 · Email");
    expect(accessView({ App_Access: "Hold", App_Welcome_At: "x", App_Welcome_Channel: "Email", Locked_Reason: "asked" }).t)
      .toBe("Locked — sign-in blocked");
  });
  it("sends the welcome only after an in-page yes, then locks with a reason", () => {
    let s = book();
    s = act(s, "fin", { type: "sendWelcome", id: "R1" });
    expect(s.ui.NOTE!.kind).toBe("ask");
    expect(s.data.ACCESS!.R1.App_Access).toBe("Hold");
    s = act(s, "fin", { type: "confirmYes" });
    expect(s.data.ACCESS!.R1).toMatchObject({ App_Access: "Invite", App_Welcome_At: null });
    s = act(s, "fin", { type: "welcomeDelivered", id: "R1" });
    expect(s.data.ACCESS!.R1.App_Welcome_At).toBe("02 Sep 14:20");
    expect(act(s, "fin", { type: "lockApp", id: "R1", why: " " }).ui.NOTE!.kind).toBe("refuse");
    s = act(s, "fin", { type: "lockApp", id: "R1", why: "asked to pause" }, { type: "confirmYes" });
    expect(s.data.ACCESS!.R1).toMatchObject({ App_Access: "Hold", Locked_Reason: "asked to pause", Locked_By: "fin" });
    expect(s.data.LOG.map(e => e.what)).toContain("Sent the welcome and unlocked the app");
  });
  it("is Finance's: a KAM or an auditor changes nothing", () => {
    const s = book();
    expect(act(s, "kam1", { type: "sendWelcome", id: "A1" }).data.ACCESS).toEqual(s.data.ACCESS);
    expect(act(s, "aud", { type: "lockApp", id: "A1", why: "x" }).data.ACCESS).toEqual(s.data.ACCESS);
  });
  it("opens a new account On hold at the first money — no email", () => {
    const s = book();
    delete s.data.APP.R1; delete s.data.ACCESS!.R1;
    s.data.TXN = s.data.TXN.filter(t => t.inv !== "R1");
    s.data.TXN.unshift({ id: "T-0009", inv: "R1", kind: "advance", amt: 250000, mode: "NEFT", utr: "U9", on: "01 Sep 10:00", by: "ops1", rec: "pending" });
    const m = act(s, "fin", { type: "matchReceipt", tid: "T-0009" });
    expect(m.data.ACCESS!.R1).toMatchObject({ App_Access: "Hold", App_Welcome_At: null });
    expect(m.data.APP.R1.mark).toBe("tentative");
  });
});

describe("Match it (M10-S02, D113 ruling 1)", () => {
  const pend = (s: ImState) => {
    s.data.TXN.unshift({ id: "T-0050", inv: "R1", kind: "balance", amt: 2250000, mode: "RTGS", utr: "U50", on: "02 Sep 10:00", by: "ops1", rec: "pending" });
    return s.data.TXN[0];
  };
  it("offers Match it on an ordinary receipt to every Finance seat, the recorder included — no second person", () => {
    const s = book(); const t = pend(s);
    expect(mayMatch(s, "fin", t)).toBe(true);
    expect(mayMatch(s, "su", t)).toBe(true);
    expect(mayMatch(s, "ops1", t)).toBe(true);
    expect(mayMatch(s, "ops2", t)).toBe(true);
    expect(mayMatch(s, "aud", t)).toBe(false);
    expect(matchWhy(s, "ops1", t)).toBe(null);
    expect(matchWhy(s, "aud", t)).toBe(null);
  });
  it("a refund keeps its second hand: the Head of Finance or the super user, never its recorder or an ops seat", () => {
    const s = book();
    s.data.TXN.unshift({ id: "T-0051", inv: "R1", kind: "refund", amt: 100000, mode: "NEFT", utr: "U51", on: "02 Sep 11:00", by: "ops1", rec: "pending" });
    const t = s.data.TXN[0];
    expect(mayMatch(s, "fin", t)).toBe(true);
    expect(mayMatch(s, "su", t)).toBe(true);
    expect(mayMatch(s, "ops1", t)).toBe(false);
    expect(mayMatch(s, "ops2", t)).toBe(false);
    expect(matchWhy(s, "ops1", t)).toMatch(/You recorded this refund\. Money leaving is matched by a second person/);
    expect(matchWhy(s, "ops2", t)).toMatch(/Waiting for the Head of Finance or an administrator/);
  });
});

describe("ARL holdings (M10-S09)", () => {
  it("shows Finance with money access and hides them from a KAM and a viewer", () => {
    const s = book();
    expect(holdingsOf(s, "fin", "A1").length).toBe(1);
    expect(mayHoldings(s, "kam1")).toBe(false);
    expect(mayHoldings(s, "aud")).toBe(false);
    expect(mayHoldings(s, "comp")).toBe(false);
    expect(holdingsOf(s, "fin", "B1")).toEqual([]);
  });
});

describe("test sign-in link (M10-S23)", () => {
  it("is the super user's, needs a reason, warns on a real investor and is audited", () => {
    let s = book();
    expect(act(s, "fin", { type: "createTestLink", id: "A1", why: "check" }).data.TESTLINK).toBeUndefined();
    expect(act(s, "su", { type: "createTestLink", id: "A1", why: "" }).ui.NOTE!.kind).toBe("refuse");
    s = act(s, "su", { type: "createTestLink", id: "A1", why: "check the payouts screen" });
    expect(s.ui.NOTE!.msg).toMatch(/real investor/);
    s = act(s, "su", { type: "confirmYes" });
    const l = s.data.TESTLINK![0];
    expect(l).toMatchObject({ inv: "A1", by: "su", at: "2026-09-02T14:20", expires: "2026-09-02T14:30", usedAt: null });
    expect(s.data.LOG[0]).toMatchObject({ what: "Made a test sign-in link", inv: "A1" });
    expect(drawerReadable(s, "fin", "testlink", "A1")).toBe(false);
  });
  it("expires after ten minutes or at first use", () => {
    const l = { id: "TL-01", inv: "A1", by: "su", why: "x", at: "2026-09-02T14:20", expires: "2026-09-02T14:30", usedAt: null, url: "u" };
    expect(testLinkState(l, Date.UTC(2026, 8, 2, 14, 29))).toBe("live");
    expect(testLinkState(l, Date.UTC(2026, 8, 2, 14, 30))).toBe("expired");
    expect(testLinkState({ ...l, usedAt: "2026-09-02T14:22" }, Date.UTC(2026, 8, 2, 14, 23))).toBe("used");
  });
  it("draws a placeholder QR with its three finder squares", () => {
    const q = qrCells("https://example.test/x", 25);
    expect(q.length).toBe(25);
    expect(q[0].slice(0, 7).every(Boolean)).toBe(true);
    expect(q[1][1]).toBe(false);
    expect(qrCells("a")).toEqual(qrCells("a"));
  });
});

describe("add an investor who already paid (M09-S09)", () => {
  const f = { n: "New Person", em: "new@example.test", ph: "+91 90000 11111", llp: "LLP-X", units: 1, paid: UNIT, on: "2026-08-30" };
  it("refuses a duplicate email and names the investor it belongs to", () => {
    const s = book();
    expect(dupEmail(s, " A1@EXAMPLE.test ")!.id).toBe("A1");
    expect(addInvestorGate(s, "fin", { ...f, em: "a1@example.test" })).toMatchObject({ ok: false, msg: expect.stringMatching(/already belongs to Investor A1/) });
  });
  it("asks for every field and takes no holding on a Draft LLP", () => {
    const s = book();
    expect(addInvestorGate(s, "fin", { ...f, n: "", units: 0 })).toMatchObject({ ok: false, msg: expect.stringMatching(/name, units/) });
    expect(addInvestorGate(s, "fin", { ...f, llp: "LLP-Y" })).toMatchObject({ ok: false, msg: expect.stringMatching(/Draft/) });
    expect(addInvestorGate(s, "aud", f)).toMatchObject({ ok: false, msg: null });
  });
  it("creates the investor, the allotment and a pending receipt, On hold, with no email", () => {
    const s = book();
    s.data.FARMS[0].units = 20;
    expect(nextInvId(s)).toBe("ARL-INV-0003");      /* the kit's ids end R2 / N1: the largest number is 2 */
    const r = act(s, "fin", { type: "addInvestor", ...f });
    const x = r.data.INV[r.data.INV.length - 1];
    expect(x).toMatchObject({ n: "New Person", units: 1, st: "paid", blocks: { X: 1 } });
    expect(r.data.ALLOT!.find(a => a.Customer === x.id)).toMatchObject({ LLP_Lookup: "LLP-X", Allocation_Status: "Reserved" });
    expect(r.data.TXN[0]).toMatchObject({ inv: x.id, rec: "pending", amt: UNIT });
    expect(r.data.ACCESS![x.id]).toMatchObject({ App_Access: "Hold", App_Welcome_At: null });
    expect(r.data.OUTBOX.some(o => o.inv === x.id)).toBe(false);
    expect(r.ui.SEL).toBe(x.id);
  });
});

describe("D115 ruling 1: app access stays Hold until it is released", () => {
  it("added On hold; a match leaves it Hold; only Send welcome and unlock, by a seat with the right, opens it", () => {
    const s0 = book();
    s0.data.TXN.unshift({ id: "T-0050", inv: "R1", kind: "balance", amt: 2250000, mode: "RTGS", utr: "U50", on: "02 Sep 10:00", by: "ops1", rec: "pending" });
    const matched = act(s0, "ops1", { type: "matchReceipt", tid: "T-0050" });
    expect(matched.data.TXN[0]).toMatchObject({ rec: "matched" });
    expect(matched.data.ACCESS!.R1.App_Access).toBe("Hold");
    expect(accessView(matched.data.ACCESS!.R1).k).toBe("hold");
    const kam = act(matched, "kam1", { type: "sendWelcome", id: "R1" }, { type: "confirmYes" });
    expect(kam.data.ACCESS!.R1.App_Access).toBe("Hold");
    const released = act(matched, "fin", { type: "sendWelcome", id: "R1" }, { type: "confirmYes" });
    expect(released.data.ACCESS!.R1.App_Access).toBe("Invite");
    expect(released.data.LOG.some(e => e.what === "Sent the welcome and unlocked the app" && e.inv === "R1")).toBe(true);
  });
  it("an investor with no account reads that it is created On hold and waits for the release", () => {
    expect(accessView(null).t).toMatch(/created On hold.*locked until Finance presses Send welcome and unlock/);
  });
});

describe("the empty book stays empty", () => {
  it("adds nothing for the later decisions", () => {
    const d = emptyImData("2026-09-02T00:00");
    expect(d.LLP).toBeUndefined(); expect(d.ALLOT).toBeUndefined(); expect(d.PAYOUT).toBeUndefined();
    expect(fmtDate("2026-10-10")).toBe("10 Oct 2026");
    expect(imReducer({ data: d, ui: book().ui }, "x", { type: "mset", k: "a", v: "b" }).ui.MX).toEqual({ a: "b" });
  });
});
