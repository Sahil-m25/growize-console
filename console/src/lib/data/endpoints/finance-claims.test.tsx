/* M09-S01-W1 (Finance's Investors list) and M10-S03-W2 (the IR payment reports on Today and Payments):
   path / pick / fixture halves for the Finance seats and a refused one, and the claim answers' live calls. */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { imDemoData } from "@fixtures/im/demo";
import { imReducer, initialImUi, type ImState } from "@/lib/im";
import { runWrite, type ApiResult } from "../api";
import { financeInvestors } from "./investors";
import { claimConfirm, claimList, claimNotThere } from "./receipts";
import { ImTxn } from "@/features/im/txn";
import { claimLine } from "@/features/im/dash";

const book = (me: string) => ({ s: { data: imDemoData(), ui: initialImUi() } as ImState, me });
const data = <T,>(r: ApiResult<T>): T => { if (!r.ok) throw new Error(r.error); return r.data; };
const json = (b: unknown, status = 200) => ({ ok: status < 300, status, json: async () => b, headers: new Headers() }) as unknown as Response;

describe("financeInvestors (GET /api/investors/finance)", () => {
  it("path: only the Finance side reads it", () => {
    expect(financeInvestors.path(true)).toBe("/api/investors/finance");
    expect(financeInvestors.path(false)).toBeNull();
    const rows = [{ id: "1" }];
    expect(financeInvestors.pick({ rows, summary: {}, truncated: false })).toEqual({ rows, summary: {}, truncated: false });
  });
  it("Harsha: the numbers TC-IM04-001/002 read — 15 on the book, 40 units, the four cuts, paid and due", () => {
    const d = data(financeInvestors.fixture(book("harsha"), true));
    expect(d.rows).toHaveLength(15);
    expect(d.summary).toMatchObject({ onBook: 15, units: 40, kycNotPassed: 1, balanceOutstanding: 2, nri: 1, femaOutstanding: 1 });
    const prakash = d.rows.find(r => r.name === "Prakash Bhat")!;
    expect([prakash.paid, prakash.due, prakash.state]).toEqual([250000, 2250000, "reserved"]);
    expect(d.rows.find(r => r.name === "Joseph Mathew")).toMatchObject({ paid: 1000000, due: 9000000 });
  });
  it("rows carry status and money only — no PAN, Aadhaar, bank or reference (rule 7)", () => {
    const d = data(financeInvestors.fixture(book("sahil"), true));
    const keys = JSON.stringify(d.rows.map(r => Object.keys(r)));
    expect(keys).not.toMatch(/pan|aadh|aref|bank|ifsc|utr/i);
  });
  it("an account-management seat and a seat with no Investors page are refused, as the route refuses them", () => {
    expect(financeInvestors.fixture(book("imran"), true)).toMatchObject({ ok: false, status: 403, code: "seat-denied" });
    expect(financeInvestors.fixture(book("divya"), true)).toMatchObject({ ok: false, status: 403 });
    expect(financeInvestors.fixture(book("rohit"), true)).toMatchObject({ ok: false, status: 403 });
  });
});

describe("claimList (GET /api/claims) on Today and Payments", () => {
  it("Harsha reads the one open report with the figures the queue row and the drawer agree on", () => {
    const c = data(claimList.fixture(book("harsha"), undefined)).claims;
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ kind: "balance", mode: "RTGS", amountRupees: 2250000 });
    expect(claimLine(c[0]!)).toBe("Balance · ₹22.5 L · RTGS · said " + c[0]!.saidOn.slice(0, 6));
  });
  it("a KAM is refused and an ISO day from the route reads as a day", () => {
    expect(claimList.fixture(book("imran"), undefined)).toMatchObject({ ok: false, status: 403 });
    expect(claimLine({ claimId: "c", leadId: "", allotmentId: "", kind: "advance", mode: "NEFT", amountRupees: 100000, saidOn: "2026-09-23", byId: "u" })).toBe("Advance · ₹1 L · NEFT · said 23 Sep");
  });
  it("Payments shows the waiting report to Finance, and nothing to a KAM or when none is open", () => {
    const html = (me: string, f?: (s: ImState) => void) => { const s: ImState = { data: imDemoData(), ui: initialImUi() }; f?.(s);
      return renderToStaticMarkup(<ImTxn s={s} me={me} dispatch={() => {}} />); };
    const h = html("harsha");
    expect(h).toContain("Payment reports waiting on Finance");
    expect(h).toContain("Answer it");
    expect(html("imran")).not.toContain("Payment reports waiting");
    const none = html("harsha", s => { s.data.INBOX = s.data.INBOX.filter(n => n.kind !== "claim"); });
    expect(none).not.toContain("Payment reports waiting");
  });
  it("answering moves it off the list", () => {
    const s: ImState = { data: imDemoData(), ui: initialImUi() };
    const id = data(claimList.fixture({ s, me: "harsha" }, undefined)).claims[0]!.claimId;
    const after = imReducer(s, "harsha", { type: "rejectClaim", nid: id, why: "x" });
    expect(data(claimList.fixture({ s: after, me: "harsha" }, undefined)).claims).toHaveLength(0);
  });
});

describe("answering a report, live", () => {
  it("confirm sends the bank reference with an Idempotency-Key", async () => {
    const f = vi.fn().mockResolvedValue(json({ confirm: { claimId: "C1", answered: true, linked: true } }));
    const r = await runWrite("live", claimConfirm, book("harsha"), () => {}, { id: "C1", ref: "HDFC2708994" }, { fetch: f, idempotencyKey: "key-1" });
    expect(r.ok).toBe(true);
    const [url, init] = f.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe("/api/claims/C1/confirm");
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe("key-1");
    expect(JSON.parse(init.body as string)).toEqual({ ref: "HDFC2708994" });
  });
  it("not-there sends {reason}", async () => {
    const f = vi.fn().mockResolvedValue(json({ answer: { claimId: "C1", says: "Finance did not find it: not yet", duplicate: false } }));
    await runWrite("live", claimNotThere, book("harsha"), () => {}, { id: "C1", reason: "not yet" }, { fetch: f });
    const [url, init] = f.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe("/api/claims/C1/not-there");
    expect(JSON.parse(init.body as string)).toEqual({ reason: "not yet" });
  });
});
