/* Phase 2b (D104), the money units of the Investors side: the register, claims, the bank statement, per-farm money, ARL
   holdings, payouts, and the investor's app (unlock, preview, test link). Fixture halves for a seat that may and a seat that
   may not; the live halves assert URL, method, body and Idempotency-Key; a write's fixture asserts the reducer action. */
import { describe, expect, it, vi } from "vitest";
import { imDemoData } from "@fixtures/im/demo";
import { imReducer, initialImUi, money, payoutSchedule as buildSchedule, type ImAction, type ImState, type ImTxn } from "@/lib/im";
import { runWrite } from "../api";
import type { ImBook } from "./im";
import { paymentsRegister, moneyBlocks, arlHoldings, revealReceiptRef } from "./payments";
import { claimConfirm, claimList, claimNotThere, claimOne } from "./receipts";
import { statementContinue, statementLatest, statementUpload } from "./statements";
import { payoutPaid, payoutQueue, payoutSchedule, payoutScheduleRun } from "./payouts";
import { appCard, appLock, appPreview, appUnlock, testLinkList, testLinkMake } from "./app";

const demo = (): ImState => ({ data: imDemoData(), ui: initialImUi() });
const book = (me: string, s: ImState = demo()): ImBook => ({ s, me });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const fetchOf = (status: number, body: unknown) => vi.fn(async (_u: string, _i?: RequestInit) => json(status, body));
const okd = <T,>(r: { ok: boolean } & Record<string, unknown>): T => { if (!r.ok) throw new Error(String(r.error)); return r.data as T; };
const pendingIn = (): ImState => {
  const s = demo();
  s.data.TXN.unshift({ id: "T-0050", inv: "ARL-INV-0208", kind: "balance", amt: 2250000, mode: "RTGS", utr: "HDFC9990001", on: "02 Sep 10:00", by: "meena", rec: "pending" } as ImTxn);
  s.data.TXN.unshift({ id: "T-0051", inv: "ARL-INV-0205", kind: "refund", amt: 100000, mode: "NEFT", utr: "HDFC9990002", on: "02 Sep 11:00", by: "meena", rec: "pending" } as ImTxn);
  return s;
};

describe("M10-S01-W1 — the Payments register, fixture half", () => {
  it("Head of Finance: matched-only totals as TC-IM05-001 reads them, the chip counts, the UTR masked and offered for reveal", () => {
    const d = okd<any>(paymentsRegister.fixture(book("harsha"), {}));
    expect(money(d.totals.received)).toBe("₹8.88 Cr");
    expect(d.totals.refunded).toBe(0);
    expect(money(d.totals.netBanked)).toBe("₹8.88 Cr");
    expect(money(d.totals.stillDue)).toBe("₹1.13 Cr");
    expect(d.counts).toEqual({ all: 15, advance: 2, full: 13, out: 0, pending: 0 });
    expect(d.totals.recorded).toEqual({ received: 0, refunded: 0, net: 0 });
    expect(d.rows.find((r: { id: string }) => r.id === "T-0030")).toMatchObject({ kind: "advance", utr: null, utrMask: "••• 8119", canReveal: true, utrHidden: false, investor: { name: "Joseph Mathew" } });
    expect(d.readOnly).toBe(false);
  });
  it("D21: a Pending receipt is recorded, shown apart, and in neither received nor net banked nor still due", () => {
    const base = okd<any>(paymentsRegister.fixture(book("harsha"), {}));
    const d = okd<any>(paymentsRegister.fixture(book("harsha", pendingIn()), {}));
    expect(d.totals.received).toBe(base.totals.received);
    expect(d.totals.refunded).toBe(0);
    expect(d.totals.stillDue).toBe(base.totals.stillDue);
    expect(d.totals.recorded).toEqual({ received: 2250000, refunded: 100000, net: 2150000 });
    expect(d.counts.pending).toBe(2);
    expect(d.counts.all).toBe(17);
    const pend = okd<any>(paymentsRegister.fixture(book("harsha", pendingIn()), { reconciled: false }));
    expect(pend.rows.map((r: { id: string }) => r.id).sort()).toEqual(["T-0050", "T-0051"]);
    expect(pend.counts.all).toBe(17);                               /* the chips count before the cut */
    expect(okd<any>(paymentsRegister.fixture(book("harsha", pendingIn()), { kind: "out" })).rows.map((r: { id: string }) => r.id)).toEqual(["T-0051"]);
  });
  it("the UTR is masked for every seat (rule 7): a seat that records reads \"••• 8119\" and may reveal it — the super user included (D68/D110); the Auditor reads null / utrHidden", () => {
    for (const me of ["sahil", "meena", "harsha"]) {
      const d = okd<any>(paymentsRegister.fixture(book(me), {}));
      expect(d.rows.every((r: any) => r.utr === null && !r.utrHidden && r.canReveal && /^••• \S{4}$/.test(r.utrMask))).toBe(true);
      expect(d.rows.find((r: { id: string }) => r.id === "T-0030").utrMask).toBe("••• 8119");
      expect(JSON.stringify(d)).not.toContain("EMIR2608119");
    }
    const a = okd<any>(paymentsRegister.fixture(book("latha"), {}));
    expect(a.rows.every((r: any) => r.utr === null && r.utrMask === null && !r.canReveal && r.utrHidden)).toBe(true);
    expect(JSON.stringify(a)).not.toContain("EMIR2608119");
    expect(okd<any>(paymentsRegister.fixture(book("latha"), {})).readOnly).toBe(true);
  });
  it("Show the reference — live: POST the receipt's reveal route with the chosen reason as { why } (M18-S05-NOTE-3), and read the full reference out of { reveal }", async () => {
    expect(revealReceiptRef.path({ id: "9007199254740996304" })).toBe("/api/receipts/9007199254740996304/reveal");
    expect(revealReceiptRef.body!({ id: "9007199254740996304", why: "A payout or a refund" })).toEqual({ why: "A payout or a refund" });
    expect(revealReceiptRef.body!({ id: "9007199254740996304" })).toBeUndefined();
    const fw = fetchOf(200, { reveal: { receiptId: "9007199254740996304", mode: "SWIFT", utr: "EMIR2608119" } });
    await runWrite("live", revealReceiptRef, book("sahil"), () => {}, { id: "9007199254740996304", why: "A name match against a cancelled cheque" }, { fetch: fw });
    expect(JSON.parse(String(fw.mock.calls[0][1]?.body))).toEqual({ why: "A name match against a cancelled cheque" });
    const f = fetchOf(200, { reveal: { receiptId: "9007199254740996304", mode: "SWIFT", utr: "EMIR2608119" } });
    const r = await runWrite("live", revealReceiptRef, book("sahil"), () => {}, { id: "9007199254740996304" }, { fetch: f });
    expect(r.ok && r.data).toEqual({ receiptId: "9007199254740996304", mode: "SWIFT", utr: "EMIR2608119" });
    expect(f.mock.calls[0][0]).toBe("/api/receipts/9007199254740996304/reveal");
    expect(f.mock.calls[0][1]?.method).toBe("POST");
    /* the step-up refusal reaches the page as the route's own words */
    const d = vi.fn();
    const e = await runWrite("live", revealReceiptRef, book("sahil"), d, { id: "9007199254740996304" }, { fetch: fetchOf(403, { error: "Confirm it is you with a fresh Zoho sign-in first.", code: "step-up" }) });
    expect(e.ok).toBe(false);
    expect(d).toHaveBeenCalledWith({ type: "note", msg: "Confirm it is you with a fresh Zoho sign-in first." });
  });
  it("Show the reference — fixture: the super user's reveal runs the reducer's revealRef and logs a named, masked line (TC-E11-016)", async () => {
    const dispatched: ImAction[] = [];
    const r = await runWrite("fixture", revealReceiptRef, book("sahil"), (a: ImAction) => dispatched.push(a), { id: "T-0030" }, {});
    expect(r.ok && r.data).toEqual({ receiptId: "T-0030", mode: "SWIFT", utr: "EMIR2608119" });
    expect(dispatched).toEqual([{ type: "revealRef", id: "T-0030" }]);
    const withWhy: ImAction[] = [];
    await runWrite("fixture", revealReceiptRef, book("sahil"), (x: ImAction) => withWhy.push(x), { id: "T-0030", why: "A payout or a refund" }, {});
    expect(withWhy).toEqual([{ type: "revealRef", id: "T-0030", why: "A payout or a refund" }]);
    const s = imReducer(demo(), "sahil", dispatched[0]);
    expect(s.data.LOG[0]).toMatchObject({ what: "Revealed a bank reference", who: "sahil", kind: "pii", note: "Payments · ••• 8119 · shown to Sahil Mohite" });
    expect(JSON.stringify(s.data.LOG[0])).not.toContain("EMIR2608119");
    expect(s.ui.SHOWN["sahil|T-0030:ref"]).toBe(true);
    for (const me of ["imran", "fahad", "latha"]) {
      const none: ImAction[] = [];
      const x = await runWrite("fixture", revealReceiptRef, book(me), (a: ImAction) => none.push(a), { id: "T-0030" }, {});
      expect(x.ok).toBe(false);
      expect(none).toEqual([]);
    }
  });
  it("a KAM and Compliance are refused; the path carries every argument", () => {
    for (const me of ["imran", "fahad"]) expect(paymentsRegister.fixture(book(me), {})).toMatchObject({ ok: false, status: 403 });
    expect(paymentsRegister.path({})).toBe("/api/payments");
    expect(paymentsRegister.path({ kind: "full", reconciled: false })).toBe("/api/payments?kind=full&reconciled=false");
  });
});

describe("M10-S03-W1 — an IR's payment report, fixture and live halves", () => {
  it("Finance: the waiting report and the drawer's figures as TC-IM05-011 reads them", () => {
    const l = okd<any>(claimList.fixture(book("harsha"), undefined));
    expect(l.claims).toHaveLength(1);
    expect(l.claims[0]).toMatchObject({ claimId: "N-08", kind: "balance", mode: "RTGS", amountRupees: 2250000, byId: "rohit" });
    const c = okd<any>(claimOne.fixture(book("harsha"), "N-08")).claim;
    expect(c).toMatchObject({ byName: "Rohit Verma", alreadyInRupees: 250000, outstandingRupees: 2250000, refLastFour: "8994", doer: "Finance", offers: ["confirm", "not-there"] });
    expect(claimOne.path("N-08")).toBe("/api/claims/N-08");
    expect(claimOne.path(null)).toBeNull();
  });
  it("a KAM gets no report; an unknown id is 404; an answered report is 409", () => {
    expect(claimList.fixture(book("imran"), undefined)).toMatchObject({ ok: false, status: 403 });
    expect(claimOne.fixture(book("imran"), "N-08")).toMatchObject({ ok: false, status: 403 });
    expect(claimOne.fixture(book("harsha"), "N-99")).toMatchObject({ ok: false, status: 404 });
    const s = demo(); s.data.ANS["N-08"] = { state: "notfound", by: "harsha", at: "x" };
    expect(claimOne.fixture(book("harsha", s), "N-08")).toMatchObject({ ok: false, status: 409, code: "already-answered" });
    expect(claimList.fixture(book("harsha", s), undefined)).toMatchObject({ ok: true, data: { claims: [] } });
  });
  it("Confirm and record it: POST with the bank reference and an Idempotency-Key; fixture runs confirmClaim", async () => {
    const f = fetchOf(200, { confirm: { claimId: "9", answered: true, linked: true, receipt: {} } });
    const r = await runWrite("live", claimConfirm, book("harsha"), () => {}, { id: "9", ref: "HDFC2708994" }, { fetch: f, idempotencyKey: "k-1" });
    expect(r).toMatchObject({ ok: true, data: { claimId: "9", answered: true } });
    expect(f.mock.calls[0][0]).toBe("/api/claims/9/confirm");
    expect(JSON.parse(f.mock.calls[0][1]!.body as string)).toEqual({ ref: "HDFC2708994" });
    expect((f.mock.calls[0][1]!.headers as Record<string, string>)["Idempotency-Key"]).toBe("k-1");
    const seen: ImAction[] = [];
    expect(await runWrite("fixture", claimConfirm, book("harsha"), a => seen.push(a), { id: "N-08", ref: "" })).toMatchObject({ ok: true, data: { claimId: "N-08" } });
    expect(seen).toEqual([{ type: "confirmClaim", nid: "N-08" }]);
  });
  it("Not there yet: POST { reason }; the reason is the IR's 'Finance did not find it: …'; fixture runs rejectClaim", async () => {
    const f = fetchOf(200, { answer: { claimId: "9", says: "Finance did not find it: not in HDFC yet", duplicate: false, moneyNotFound: null } });
    const r = await runWrite("live", claimNotThere, book("harsha"), () => {}, { id: "9", reason: "not in HDFC yet" }, { fetch: f });
    expect(r).toMatchObject({ ok: true, data: { says: "Finance did not find it: not in HDFC yet" } });
    expect(JSON.parse(f.mock.calls[0][1]!.body as string)).toEqual({ reason: "not in HDFC yet" });
    expect((f.mock.calls[0][1]!.headers as Record<string, string>)["Idempotency-Key"]).toBeUndefined();
    const seen: ImAction[] = [];
    const fx = await runWrite("fixture", claimNotThere, book("harsha"), a => seen.push(a), { id: "N-08", reason: "" });
    expect(fx).toMatchObject({ ok: true, data: { says: "Finance did not find it: Not in the account yet" } });
    expect(seen).toEqual([{ type: "rejectClaim", nid: "N-08" }]);
  });
  it("a live refusal lands in the page note", async () => {
    const seen: ImAction[] = [];
    const r = await runWrite("live", claimConfirm, book("harsha"), a => seen.push(a), { id: "9", ref: "" }, { fetch: fetchOf(422, { error: "Not saved yet — enter the bank reference you found.", code: "reference-required" }) });
    expect(r).toMatchObject({ ok: false, status: 422 });
    expect(seen).toEqual([{ type: "note", msg: "Not saved yet — enter the bank reference you found." }]);
  });
});

describe("M10-S05-W1 — the bank statement", () => {
  it("Finance Operations reads 'none yet'; a KAM and the Auditor are refused", () => {
    expect(statementLatest.fixture(book("meena"), undefined)).toMatchObject({ ok: true, data: { latest: null } });
    for (const me of ["imran", "latha"]) expect(statementLatest.fixture(book(me), undefined)).toMatchObject({ ok: false, status: 403 });
    expect(statementLatest.path()).toBe("/api/statements");
  });
  it("live upload sends the file as multipart (no JSON Content-Type); the fixture says it needs the live console", async () => {
    const form = new FormData(); form.append("file", new Blob(["a,b\n1,2"], { type: "text/csv" }), "week.csv");
    const f = fetchOf(200, { statement: { statementId: "1", attachmentId: "2", name: "week.csv", from: "2026-09-01", to: "2026-09-07", counts: { lines: 1, matched: 0, awaitingMatch: 0, needsOwner: 1, debits: 0, skipped: 0 }, matched: [], needsOwner: [] } });
    const r = await runWrite("live", statementUpload, book("meena"), () => {}, { form }, { fetch: f });
    expect(r).toMatchObject({ ok: true, data: { statementId: "1", counts: { needsOwner: 1 } } });
    const init = f.mock.calls[0][1]!;
    expect(f.mock.calls[0][0]).toBe("/api/statements");
    expect(init.body).toBe(form);
    expect((init.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
    expect(await runWrite("fixture", statementUpload, book("meena"), () => {}, { form })).toMatchObject({ ok: false, status: 503, code: "not-configured" });
    expect(await runWrite("fixture", statementUpload, book("imran"), () => {}, { form })).toMatchObject({ ok: false, status: 403 });
  });
  it("M18-S09-NOTE-3: a receipt left in continueWith is matched through POST /api/receipts/[id]/match {}; the fixture has nothing to continue", async () => {
    const f = fetchOf(200, { match: { receiptId: "9007199254741000001", state: "matched", matchedBy: "9007199254740994090", duplicate: false } });
    const r = await runWrite("live", statementContinue, book("meena"), () => {}, { receiptId: "9007199254741000001" }, { fetch: f });
    expect(r).toMatchObject({ ok: true, data: { receiptId: "9007199254741000001", state: "matched", matchedBy: "9007199254740994090" } });
    expect(f.mock.calls[0][0]).toBe("/api/receipts/9007199254741000001/match");
    expect(f.mock.calls[0][1]!.method).toBe("POST");
    expect(f.mock.calls[0][1]!.body).toBe("{}");
    expect(await runWrite("fixture", statementContinue, book("meena"), () => {}, { receiptId: "x" })).toMatchObject({ ok: false, status: 503 });
    expect(await runWrite("fixture", statementContinue, book("imran"), () => {}, { receiptId: "x" })).toMatchObject({ ok: false, status: 403 });
  });
});

describe("M10-S08-W1 — per-farm Money blocks", () => {
  const two = (): ImState => {
    const s = demo();
    s.data.ALLOT!.push({ id: "AL-0205B", Customer: "ARL-INV-0205", LLP_Lookup: "LLP-B", Committed_Units: 2, Issued_Units: 0, Unit_Price: 2500000, Ticket_Snapshot: 5000000,
      Allocation_Status: "Reserved", Issued_On: null, Annual_Rental_Yield: 12 });
    s.data.TXN.filter(t => t.inv === "ARL-INV-0205").forEach(t => { t.Allotment = "AL-0205"; });   /* with several allotments a receipt names its own */
    s.data.TXN.unshift({ id: "T-0060", inv: "ARL-INV-0205", kind: "advance", amt: 500000, mode: "NEFT", utr: "X1", on: "02 Sep 10:00", by: "meena", rec: "pending", Allotment: "AL-0205B" } as ImTxn);
    return s;
  };
  it("blocks per allotment; paid and due from matched money, recorded apart; the total only with two", () => {
    const one = okd<any>(moneyBlocks.fixture(book("harsha"), "ARL-INV-0208")).money;
    expect(one.blocks).toHaveLength(1);
    expect(one.total).toBeNull();
    expect(one.blocks[0]).toMatchObject({ allotmentId: "AL-0208", amount: 2500000, paid: 250000, due: 2250000, recorded: 0, paymentStatus: "Partial" });
    const d = okd<any>(moneyBlocks.fixture(book("harsha", two()), "ARL-INV-0205")).money;
    expect(d.blocks.map((b: any) => b.allotmentId)).toEqual(["AL-0205", "AL-0205B"]);
    const b = d.blocks[1];
    expect(b).toMatchObject({ paid: 0, due: 5000000, recorded: 500000, paymentStatus: "Yet to initiate" });
    expect(b.receipts.map((r: any) => r.id)).toEqual(["T-0060"]);
    expect(d.total).toEqual({ paid: 10000000, due: 5000000 });
    expect(d.unlinked).toEqual([]);
  });
  it("every demo allotment: the route's units × price is the recorded ticket (parity with what the screen showed)", () => {
    const s = demo();
    for (const a of s.data.ALLOT!) expect(a.Committed_Units * a.Unit_Price).toBe(a.Ticket_Snapshot);
  });
  it("a KAM is refused; an unknown investor is refused; the path is the route's", () => {
    expect(moneyBlocks.fixture(book("imran"), "ARL-INV-0205")).toMatchObject({ ok: false, status: 403 });
    expect(moneyBlocks.fixture(book("harsha"), "ARL-INV-9999")).toMatchObject({ ok: false, status: 403 });
    expect(moneyBlocks.path("ARL-INV-0205")).toBe("/api/investors/ARL-INV-0205/money");
    expect(moneyBlocks.path(null)).toBeNull();
  });
});

describe("M10-S09-W1 — ARL holdings, read-only", () => {
  it("Finance reads the holding and its transactions in date order; the route exports GET only", () => {
    const d = okd<any>(arlHoldings.fixture(book("harsha"), "ARL-INV-0212"));
    expect(d.readOnly).toBe(true);
    expect(d.holdings).toHaveLength(1);
    expect(d.holdings[0]).toMatchObject({ id: "H-01", instrument: "CCD", amount: 5000000, interestRatePct: 10 });
    const dates = d.holdings[0].transactions.map((t: any) => t.date);
    expect([...dates].sort()).toEqual(dates);
    expect(arlHoldings.path("ARL-INV-0212")).toBe("/api/investors/ARL-INV-0212/holdings");
  });
  it("a KAM, Compliance and the Auditor are refused", () => {
    for (const me of ["imran", "fahad", "latha"]) expect(arlHoldings.fixture(book(me), "ARL-INV-0212")).toMatchObject({ ok: false, status: 403 });
  });
});

describe("M10-S20-W1 — payouts", () => {
  it("the queue: this month's Scheduled payouts, with investor and farm; a KAM is refused", () => {
    const q = okd<any>(payoutQueue.fixture(book("harsha"), undefined));
    expect(q.month).toBe("2026-09");
    expect(q.due).toHaveLength(13);
    expect(q.overdue).toEqual([]);
    expect(q.due[0]).toMatchObject({ state: "Scheduled", investor: { id: expect.stringMatching(/^ARL-INV-/) }, farm: { name: expect.stringContaining("Block") } });
    expect(payoutQueue.fixture(book("imran"), undefined)).toMatchObject({ ok: false, status: 403 });
  });
  it("Scheduled payouts before this month are overdue, apart", () => {
    const s = demo(); const p = s.data.PAYOUT!.find(x => x.Payout_State === "Scheduled")!; p.Due_On = "2026-08-10"; p.Period_Month = "2026-08";
    const q = okd<any>(payoutQueue.fixture(book("harsha", s), undefined));
    expect(q.overdue.map((x: any) => x.id)).toEqual([p.id]);
    expect(q.due.map((x: any) => x.id)).not.toContain(p.id);
  });
  it("one allotment's schedule: the UTR only masked; 403 for a seat without payouts", () => {
    const d = okd<any>(payoutSchedule.fixture(book("harsha"), "AL-0212"));
    expect(d.payouts).toHaveLength(60);
    expect(d.payouts[0]).toMatchObject({ instalment: 1, state: "Paid", utrMasked: "••••0212", paidBy: { id: "harsha" } });
    expect(JSON.stringify(d)).not.toContain("PO2607100212");
    expect(payoutSchedule.fixture(book("imran"), "AL-0212")).toMatchObject({ ok: false, status: 403 });
    expect(payoutSchedule.path("AL-0212")).toBe("/api/payouts/allotments/AL-0212");
    expect(payoutSchedule.path(null)).toBeNull();
  });
  it("Mark paid: live POST with an Idempotency-Key per press and the schedule's modifiedTime; fixture runs markPayoutPaid", async () => {
    const args = { id: "PO-0219-01", paidOn: "2026-09-02", mode: "NEFT" as const, utr: "hdfc0001234", tds: 500, modifiedTime: "2026-09-01T10:00:00+05:30" };
    const f = fetchOf(200, { payout: { payoutId: "PO-0219-01", state: "Paid", paidOn: "2026-09-02", mode: "NEFT", utrMasked: "••••1234", gross: 100000, tds: 500, net: 99500, duplicate: false } });
    const r = await runWrite("live", payoutPaid, book("harsha"), () => {}, args, { fetch: f, idempotencyKey: "press-1" });
    expect(r).toMatchObject({ ok: true, data: { net: 99500, utrMasked: "••••1234" } });
    expect(f.mock.calls[0][0]).toBe("/api/payouts/PO-0219-01/paid");
    expect(JSON.parse(f.mock.calls[0][1]!.body as string)).toEqual({ paidOn: "2026-09-02", mode: "NEFT", utr: "hdfc0001234", tds: 500, modifiedTime: "2026-09-01T10:00:00+05:30" });
    expect((f.mock.calls[0][1]!.headers as Record<string, string>)["Idempotency-Key"]).toBe("press-1");
    const s = demo(); const p = s.data.PAYOUT!.find(x => x.Payout_State === "Scheduled")!;
    const seen: ImAction[] = [];
    const fx = await runWrite("fixture", payoutPaid, book("harsha", s), a => seen.push(a), { ...args, id: p.id });
    expect(fx).toMatchObject({ ok: true, data: { state: "Paid", utrMasked: "••••1234", tds: 500, net: p.Gross_Amount - 500 } });
    expect(seen).toEqual([{ type: "markPayoutPaid", id: p.id, paidOn: "2026-09-02", mode: "NEFT", utr: "hdfc0001234", tds: 500 }]);
  });
  it("Mark paid twice: the reducer's refusal comes back as a 422 (a payout is paid once)", async () => {
    const paid = demo().data.PAYOUT!.find(x => x.Payout_State === "Paid")!;
    const r = await runWrite("fixture", payoutPaid, book("harsha"), () => {}, { id: paid.id, paidOn: "2026-09-02", mode: "NEFT", utr: "NEW1", tds: 0, modifiedTime: null });
    expect(r).toMatchObject({ ok: false, status: 422 });
  });
  it("the schedule job: complete / created / skipped as the route reports; the reducer creates only the missing, never a duplicate", async () => {
    const s = demo();
    s.data.PAYOUT = s.data.PAYOUT!.filter(p => p.Allotment !== "AL-0219");
    const seen: ImAction[] = [];
    const r = await runWrite("fixture", payoutScheduleRun, book("harsha", s), a => seen.push(a), { allotmentIds: ["AL-0219", "AL-0212", "AL-0208", "AL-9"] });
    expect(okd<any>(r).outcomes.map((o: any) => [o.allotmentId, o.status, o.created ?? o.reason ?? ""])).toEqual([
      ["AL-0219", "created", 60], ["AL-0212", "complete", ""], ["AL-0208", "skipped", "not-issued"], ["AL-9", "skipped", "not-visible"]]);
    expect(seen).toEqual([{ type: "schedulePayouts", ids: ["AL-0219", "AL-0212", "AL-0208", "AL-9"] }]);
    const after = imReducer(s, "harsha", seen[0]);
    expect(after.data.PAYOUT!.filter(p => p.Allotment === "AL-0219")).toHaveLength(60);
    const again = imReducer(after, "harsha", seen[0]);
    expect(again.data.PAYOUT!.length).toBe(after.data.PAYOUT!.length);
    expect(buildSchedule(after.data.ALLOT!.find(a => a.id === "AL-0219")!)).toHaveLength(60);
    const f = fetchOf(200, { outcomes: [] });
    await runWrite("live", payoutScheduleRun, book("harsha"), () => {}, { allotmentIds: ["1"] }, { fetch: f });
    expect(f.mock.calls[0][0]).toBe("/api/payouts/schedule");
    expect(JSON.parse(f.mock.calls[0][1]!.body as string)).toEqual({ allotmentIds: ["1"], commit: true });
  });
});

describe("M10-S21-W1 — the App account card", () => {
  it("the card as the route reads it; Finance may change it, a KAM reads it", () => {
    const c = okd<any>(appCard.fixture(book("harsha"), "ARL-INV-0205")).card;
    expect(c).toMatchObject({ contactId: "ARL-INV-0205", access: "Invite", state: "delivered", mayChange: true, modifiedTime: null });
    expect(c.text).toContain("Welcome delivered");
    expect(okd<any>(appCard.fixture(book("imran"), "ARL-INV-0205")).card.mayChange).toBe(false);
    expect(appCard.fixture(book("imran"), "ARL-INV-0208")).toMatchObject({ ok: false, status: 403 });
    expect(appCard.path("ARL-INV-0205")).toBe("/api/investors/ARL-INV-0205/unlock");
  });
  it("unlock sends expectedModifiedTime; lock sends { reason, expectedModifiedTime } with DELETE; the fixtures run the reducer", async () => {
    const f = fetchOf(200, { card: { contactId: "1", state: "sending" }, already: false });
    await runWrite("live", appUnlock, book("harsha"), () => {}, { id: "1", expectedModifiedTime: "2026-09-01T10:00:00+05:30" }, { fetch: f });
    expect(f.mock.calls[0][1]!.method).toBe("POST");
    expect(JSON.parse(f.mock.calls[0][1]!.body as string)).toEqual({ expectedModifiedTime: "2026-09-01T10:00:00+05:30" });
    const g = fetchOf(200, { card: { contactId: "1", state: "locked" }, already: false });
    await runWrite("live", appLock, book("harsha"), () => {}, { id: "1", reason: "asked to pause", expectedModifiedTime: null }, { fetch: g });
    expect(g.mock.calls[0][0]).toBe("/api/investors/1/unlock");
    expect(g.mock.calls[0][1]!.method).toBe("DELETE");
    expect(JSON.parse(g.mock.calls[0][1]!.body as string)).toEqual({ reason: "asked to pause", expectedModifiedTime: null });
    const seen: ImAction[] = [];
    await runWrite("fixture", appLock, book("harsha"), a => seen.push(a), { id: "ARL-INV-0205", reason: "asked to pause", expectedModifiedTime: null });
    await runWrite("fixture", appUnlock, book("harsha"), a => seen.push(a), { id: "ARL-INV-0205", expectedModifiedTime: null });
    expect(seen).toEqual([{ type: "lockApp", id: "ARL-INV-0205", why: "asked to pause" }, { type: "sendWelcome", id: "ARL-INV-0205" }]);
  });
  it("a 409 'changed' reads 'Changed by someone else — reload.' in the page note", async () => {
    const seen: ImAction[] = [];
    await runWrite("live", appUnlock, book("harsha"), a => seen.push(a), { id: "1", expectedModifiedTime: "old" }, { fetch: fetchOf(409, { error: "x", code: "changed" }) });
    expect(seen).toEqual([{ type: "note", msg: "Changed by someone else — reload." }]);
  });
});

describe("M10-S22-W1 — the app preview", () => {
  it("Finance: the investor's figures; PAN and bank are always 'Finance only'", () => {
    const p = okd<any>(appPreview.fixture(book("harsha"), "ARL-INV-0212")).preview;
    expect(p).toMatchObject({ investorId: "ARL-INV-0212", readOnly: true, amounts: true, label: "Preview — mock-up, not the live app" });
    expect(p.tabs).toEqual(["Home", "Projects", "Project", "Financials", "Documents", "Activity", "Profile"]);
    expect(p.projects[0]).toMatchObject({ allotmentId: "AL-0212", units: 6 });
    expect(p.financials.payouts).toHaveLength(60);
    expect(p.home.paidOut).toBe(p.financials.payouts.filter((x: any) => x.state === "Paid").reduce((n: number, x: any) => n + x.net, 0));
    expect(p.profile).toMatchObject({ pan: "Finance only", bank: "Finance only" });
    expect(Array.isArray(p.documents)).toBe(true);
  });
  it("a KAM: no amounts, no paper; nobody else's investor", () => {
    const p = okd<any>(appPreview.fixture(book("imran"), "ARL-INV-0205")).preview;
    expect(p.amounts).toBe(false);
    expect(p.home.invested).toBeNull();
    expect(p.financials.payouts.every((x: any) => x.net === null)).toBe(true);
    expect(p.documents).toBeNull();
    expect(appPreview.fixture(book("imran"), "ARL-INV-0208")).toMatchObject({ ok: false, status: 403 });
    expect(appPreview.path("ARL-INV-0205")).toBe("/api/investors/ARL-INV-0205/preview");
    expect(appPreview.path(null)).toBeNull();
  });
});

describe("M10-S23-W1 — the test sign-in link", () => {
  it("only the super user; the list is this investor's", () => {
    expect(testLinkList.fixture(book("harsha"), "ARL-INV-0205")).toMatchObject({ ok: false, status: 403 });
    expect(okd<any>(testLinkList.fixture(book("sahil"), "ARL-INV-0205")).links).toEqual([]);
    expect(testLinkList.path("ARL-INV-0205")).toBe("/api/investors/ARL-INV-0205/test-link");
  });
  it("a real investor: the first press is 409 confirm-needed carrying the warning; with confirm the link is made", async () => {
    const seen: ImAction[] = [];
    const ask = await runWrite("fixture", testLinkMake, book("sahil"), a => seen.push(a), { id: "ARL-INV-0205", why: "check payouts", confirm: false });
    expect(ask).toMatchObject({ ok: false, status: 409, code: "confirm-needed" });
    expect((ask as { ask?: string }).ask).toContain("is a real investor, not a test account");
    expect(seen).toEqual([]);
    const made = await runWrite("fixture", testLinkMake, book("sahil"), a => seen.push(a), { id: "ARL-INV-0205", why: "check payouts", confirm: true });
    expect(made).toMatchObject({ ok: true, data: { contactId: "ARL-INV-0205", why: "check payouts", state: "live", url: expect.stringContaining("test-sign-in") } });
    expect(seen).toEqual([{ type: "createTestLink", id: "ARL-INV-0205", why: "check payouts" }, { type: "confirmYes" }]);
  });
  it("a reason is required; a seat that is not the super user is refused", async () => {
    const seen: ImAction[] = [];
    expect(await runWrite("fixture", testLinkMake, book("sahil"), a => seen.push(a), { id: "ARL-INV-0205", why: " ", confirm: true })).toMatchObject({ ok: false, status: 422 });
    expect(await runWrite("fixture", testLinkMake, book("harsha"), a => seen.push(a), { id: "ARL-INV-0205", why: "x", confirm: true })).toMatchObject({ ok: false, status: 403 });
  });
  it("live: POST { why, confirm }; the route's 409 carries `ask` through the transport", async () => {
    const f = fetchOf(409, { error: "Confirm to make a link for a real investor.", code: "confirm-needed", ask: "Aarav is a real investor, not a test account." });
    const r = await runWrite("live", testLinkMake, book("sahil"), () => {}, { id: "1", why: "check", confirm: false }, { fetch: f });
    expect(f.mock.calls[0][0]).toBe("/api/investors/1/test-link");
    expect(JSON.parse(f.mock.calls[0][1]!.body as string)).toEqual({ why: "check", confirm: false });
    expect(r).toMatchObject({ ok: false, status: 409, code: "confirm-needed", ask: "Aarav is a real investor, not a test account." });
  });
});
