/* Phase 2b wiring (D104): the Investors-page and Farms endpoints — M09-S02/S04/S07/S09, M11-S02/S03/S04/S05. */
import { describe, expect, it, vi } from "vitest";
import { imDemoData } from "@fixtures/im/demo";
import { initialImUi, type ImAction, type ImState } from "@/lib/im";
import { apiFetch, runWrite } from "../api";
import { farmRelease, farmShelf, farmTakeBack } from "./farms";
import { addPaid, amBook, investorSearch, kamAssign } from "./investors";
import { farmAllotments, investorAllot, investorAllotments } from "./allotments";

const demo = (): ImState => ({ data: imDemoData(), ui: initialImUi() });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const fetchOf = (status: number, body: unknown) => vi.fn(async (_u: string, _i?: RequestInit) => json(status, body));
const ok = <T,>(r: { ok: boolean } & Record<string, unknown>): T => { if (!r.ok) throw new Error(String(r.error)); return r.data as T; };

describe("M09-S02-W1 — the account-management counts", () => {
  it("path: only an account-management seat reads GET /api/investors/am", () => {
    expect(amBook.path(true)).toBe("/api/investors/am");
    expect(amBook.path(false)).toBeNull();
  });
  it("Imran (KAM): 4 under care; Divya (Head of AM): 13 allotted, one with no manager; Finance is refused", () => {
    const s = demo();
    expect(ok<{ summary: unknown }>(amBook.fixture({ s, me: "imran" }, true)).summary).toEqual({ underCare: 4, noManager: 0 });
    expect(ok<{ summary: unknown }>(amBook.fixture({ s, me: "divya" }, true)).summary).toEqual({ underCare: 13, noManager: 1 });
    expect(amBook.fixture({ s, me: "harsha" }, true)).toMatchObject({ ok: false, status: 403 });
  });
});

describe("M09-S04-W1 — name or move a manager", () => {
  it("live: PUT /api/investors/[id]/kam with the version; a refusal goes to the page note", async () => {
    const seen: ImAction[] = [];
    const f = fetchOf(403, { error: "Only a key account manager can be named.", code: "assignee-not-am" });
    const r = await runWrite("live", kamAssign, { s: demo(), me: "divya" }, (a: ImAction) => seen.push(a),
      { id: "ARL-INV-0209", kam: "999000000000001", expectedModifiedTime: "2026-09-01T10:00:00+05:30" }, { fetch: f });
    expect(f.mock.calls[0][0]).toBe("/api/investors/ARL-INV-0209/kam");
    expect(f.mock.calls[0][1]!.method).toBe("PUT");
    expect(JSON.parse(f.mock.calls[0][1]!.body as string)).toEqual({ kamUserId: "999000000000001", expectedModifiedTime: "2026-09-01T10:00:00+05:30" });
    expect(r.ok).toBe(false);
    expect(seen).toEqual([{ type: "note", msg: "Only a key account manager can be named." }]);
  });
  it("live: a success picks the route's kam answer", async () => {
    const r = await runWrite("live", kamAssign, { s: demo(), me: "divya" }, () => {}, { id: "1", kam: null, expectedModifiedTime: "2026-09-01T10:00:00+05:30" },
      { fetch: fetchOf(200, { kam: { contactId: "1", fromKam: "7", toKam: null, kamSince: null, modifiedTime: "x", changed: true } }) });
    expect(r).toEqual({ ok: true, data: { contactId: "1", fromKam: "7", toKam: null, kamSince: null, modifiedTime: "x", changed: true } });
  });
  it("fixture: the Head of AM runs assignKam; a KAM is refused before the reducer", async () => {
    const seen: ImAction[] = [];
    const r = await runWrite("fixture", kamAssign, { s: demo(), me: "divya" }, (a: ImAction) => seen.push(a), { id: "ARL-INV-0209", kam: "neha", expectedModifiedTime: null });
    expect(r).toEqual({ ok: true, data: { contactId: "ARL-INV-0209", toKam: "neha", changed: true } });
    expect(seen).toEqual([{ type: "assignKam", id: "ARL-INV-0209", k: "neha" }]);
    const k = await runWrite("fixture", kamAssign, { s: demo(), me: "imran" }, (a: ImAction) => seen.push(a), { id: "ARL-INV-0209", kam: "imran", expectedModifiedTime: null });
    expect(k).toMatchObject({ ok: false, status: 403 });
    expect(seen).toHaveLength(1);
  });
});

describe("M09-S07-W1 — the Investors search", () => {
  it("path encodes q and farm; nothing to read with neither", () => {
    expect(investorSearch.path({ q: "Mysuru", farm: null })).toBe("/api/investors/search?q=Mysuru");
    expect(investorSearch.path({ q: " ", farm: "123456789012345" })).toBe("/api/investors/search?farm=123456789012345");
    expect(investorSearch.path({ q: "", farm: null })).toBeNull();
  });
  it("fixture: Mysuru finds Prakash Bhat and Harish Gowda; an ARL code finds one; the hit has only the last four digits", () => {
    const s = demo();
    const m = ok<{ hits: { id: string; name: string; phoneLast4: string | null }[] }>(investorSearch.fixture({ s, me: "harsha" }, { q: "Mysuru", farm: null }));
    expect(m.hits.map(h => h.name).sort()).toEqual(["Harish Gowda", "Prakash Bhat"]);
    expect(m.hits.every(h => (h.phoneLast4 ?? "").length <= 4)).toBe(true);
    expect(ok<{ hits: unknown[] }>(investorSearch.fixture({ s, me: "harsha" }, { q: "ARL-INV-0208", farm: null })).hits).toHaveLength(1);
  });
  it("fixture: a KAM finds nobody outside their book; one letter is the route's term-too-short", () => {
    const s = demo();
    expect(ok<{ hits: unknown[] }>(investorSearch.fixture({ s, me: "neha" }, { q: "Prakash", farm: null })).hits).toEqual([]);
    expect(investorSearch.fixture({ s, me: "harsha" }, { q: "P", farm: null })).toMatchObject({ ok: false, status: 400, code: "term-too-short" });
  });
});

describe("M09-S09-W1 — Add investor", () => {
  const form = { name: "New Person", email: "new.person@example.test", mobile: "+91 98450 00000", llpId: "LLP-B", units: 1, amountPaid: 1000000, investmentDate: "2026-09-01" };
  it("live: POST add-paid with an Idempotency-Key; 409 hands the existing contact to the page as recordId", async () => {
    const f = fetchOf(409, { error: "Not saved yet — that email belongs to Asha.", code: "duplicate-email", existing: { contactId: "555", code: "ARL-INV-0001", name: "Asha" } });
    const r = await runWrite("live", addPaid, { s: demo(), me: "harsha" }, () => {}, form, { fetch: f, idempotencyKey: "key-12345678" });
    expect(f.mock.calls[0][0]).toBe("/api/investors/add-paid");
    expect((f.mock.calls[0][1]!.headers as Record<string, string>)["Idempotency-Key"]).toBe("key-12345678");
    expect(JSON.parse(f.mock.calls[0][1]!.body as string)).toEqual(form);
    expect(r).toMatchObject({ ok: false, status: 409, code: "duplicate-email", recordId: "555" });
    expect(await apiFetch("POST", "/x", { fetch: f })).toMatchObject({ recordId: "555" });
  });
  it("fixture: the reducer's addInvestor runs and the answer is the route's; Audit is refused", async () => {
    const seen: ImAction[] = [];
    const r = await runWrite("fixture", addPaid, { s: demo(), me: "harsha" }, (a: ImAction) => seen.push(a), form);
    expect(r).toMatchObject({ ok: true, data: { code: expect.stringMatching(/^ARL-INV-\d{4}$/) } });
    expect(seen).toEqual([{ type: "addInvestor", n: "New Person", em: "new.person@example.test", ph: "+91 98450 00000", llp: "LLP-B", units: 1, paid: 1000000, on: "2026-09-01" }]);
    expect(await runWrite("fixture", addPaid, { s: demo(), me: "imran" }, () => {}, form)).toMatchObject({ ok: false, status: 403 });
  });
});

describe("M11-S02-W1 — allotment rows", () => {
  it("paths", () => {
    expect(investorAllotments.path("ARL-INV-0208")).toBe("/api/investors/ARL-INV-0208/allotments");
    expect(investorAllotments.path(null)).toBeNull();
    expect(farmAllotments.path("LLP-B")).toBe("/api/farms/LLP-B/allotments");
  });
  it("fixture: Finance sees money on the rows; a KAM sees the price and amount (D139) but not Money, and only their own investor", () => {
    const s = demo();
    const fin = ok<{ allotments: { amount: number | null; investor: { id: string } }[]; money: boolean }>(investorAllotments.fixture({ s, me: "harsha" }, "ARL-INV-0208"));
    expect(fin.money).toBe(true);
    expect(fin.allotments.length).toBeGreaterThan(0);
    expect(fin.allotments[0].amount).not.toBeNull();
    const kamOwn = s.data.INV.find(x => x.kam === "imran")!.id;
    const own = ok<{ allotments: { amount: number | null; unitPrice: number | null }[]; money: boolean }>(investorAllotments.fixture({ s, me: "imran" }, kamOwn));
    expect(own.money).toBe(false);
    expect(own.allotments.length).toBeGreaterThan(0);
    expect(own.allotments.every(a => a.amount !== null && a.unitPrice !== null)).toBe(true);   /* W2-KAM-1 ruled: a KAM sees rupees */
    expect(investorAllotments.fixture({ s, me: "imran" }, "ARL-INV-0208")).toMatchObject({ ok: false, status: 404 });
  });
  it("fixture: the LLP's allotments and units; unknown LLP is 404", () => {
    const s = demo();
    const r = ok<{ allotments: unknown[]; units: { reserved: number; issued: number } }>(farmAllotments.fixture({ s, me: "harsha" }, "LLP-B"));
    expect(r.allotments.length).toBeGreaterThan(0);
    expect(farmAllotments.fixture({ s, me: "harsha" }, "LLP-nope")).toMatchObject({ ok: false, status: 404 });
  });
});

describe("M11-S03-W1 — the shelf", () => {
  it("fixture: the demo tiles (96 released, 35 allotted, 5 reserved or paid, 56 free) and Block B's bar", () => {
    const r = ok<{ tiles: Record<string, unknown>; llps: { block: string; allotted: number; reserved: number; free: number }[] }>(farmShelf.fixture({ s: demo(), me: "harsha" }, undefined));
    expect(r.tiles).toMatchObject({ units: 208, released: 96, allotted: 35, reservedOrPaid: 5, free: 56, oversold: false });
    expect(r.tiles.acres).toBeCloseTo(8, 5);
    expect(r.llps.find(l => l.block === "B")).toMatchObject({ allotted: 6, reserved: 5, free: 23 });
  });
  it("live path and a seat without Farms", () => {
    expect(farmShelf.path()).toBe("/api/farms/shelf");
    expect(farmShelf.fixture({ s: demo(), me: "pradeep" }, undefined)).toMatchObject({ ok: false, status: 403 });
  });
});

describe("M11-S04-W1 — Release N / Take it back", () => {
  const args = { id: "555", k: "C", version: "2026-09-01T10:00:00+05:30" };
  it("live: POST and DELETE /api/farms/[id]/release with {version}; the 422 goes to the page note", async () => {
    const seen: ImAction[] = [];
    const p = fetchOf(200, { llpId: "555", label: "Block C", released: 22, version: "v2" });
    expect(await runWrite("live", farmRelease, { s: demo(), me: "harsha" }, () => {}, args, { fetch: p })).toEqual({ ok: true, data: { llpId: "555", label: "Block C", released: 22, version: "v2" } });
    expect(p.mock.calls[0][0]).toBe("/api/farms/555/release");
    expect(p.mock.calls[0][1]!.method).toBe("POST");
    expect(JSON.parse(p.mock.calls[0][1]!.body as string)).toEqual({ version: "2026-09-01T10:00:00+05:30" });
    const d = fetchOf(422, { error: "Block A has 3 units held by investors and cannot be taken back.", code: "units-held", held: 3 });
    const r = await runWrite("live", farmTakeBack, { s: demo(), me: "harsha" }, (a: ImAction) => seen.push(a), { ...args, k: "A" }, { fetch: d });
    expect(d.mock.calls[0][1]!.method).toBe("DELETE");
    expect(r).toMatchObject({ ok: false, status: 422, code: "units-held" });
    expect(seen).toEqual([{ type: "note", msg: "Block A has 3 units held by investors and cannot be taken back." }]);
  });
  it("fixture: releaseBlock / holdBlock; a seat without the farm capability is refused first; held units come back as 422", async () => {
    const seen: ImAction[] = [];
    expect(await runWrite("fixture", farmRelease, { s: demo(), me: "harsha" }, (a: ImAction) => seen.push(a), args)).toMatchObject({ ok: true, data: { released: expect.any(Number) } });
    expect(await runWrite("fixture", farmTakeBack, { s: demo(), me: "harsha" }, (a: ImAction) => seen.push(a), { ...args, k: "A" })).toMatchObject({ ok: false, status: 422 });
    expect(seen).toEqual([{ type: "releaseBlock", k: "C" }, { type: "holdBlock", k: "A" }]);
    expect(await runWrite("fixture", farmRelease, { s: demo(), me: "meena" }, () => {}, args)).toMatchObject({ ok: false, status: 403 });
  });
});

describe("M11-S05-W1 / M11-S07-W1 — allot on the verified letter", () => {
  const a = { id: "ARL-INV-0210", did: "D-1", allotmentId: "999", reference: " EMU-1 ", expectedModifiedTime: null };
  it("live: POST /api/investors/[id]/allot {allotmentId, reference}; a 422 (facts missing, oversell) goes to the page note", async () => {
    const seen: ImAction[] = [];
    const msg = "Block B has 0 free units for 2 units — nothing was allotted.";
    const f = fetchOf(422, { error: msg, code: "oversell" });
    const r = await runWrite("live", investorAllot, { s: demo(), me: "harsha" }, (x: ImAction) => seen.push(x), a, { fetch: f });
    expect(f.mock.calls[0][0]).toBe("/api/investors/ARL-INV-0210/allot");
    expect(JSON.parse(f.mock.calls[0][1]!.body as string)).toEqual({ allotmentId: "999", reference: "EMU-1" });
    expect(r).toMatchObject({ ok: false, status: 422, code: "oversell", error: msg });
    expect(seen).toEqual([{ type: "note", msg }]);
  });
  it("fixture: the reducer's verifyDoc runs; a seat without the doc right is refused", async () => {
    const seen: ImAction[] = [];
    const r = await runWrite("fixture", investorAllot, { s: demo(), me: "harsha" }, (x: ImAction) => seen.push(x), a);
    expect(r.ok).toBe(true);
    expect(seen).toEqual([{ type: "verifyDoc", did: "D-1", ref: " EMU-1 " }]);
    expect(await runWrite("fixture", investorAllot, { s: demo(), me: "imran" }, () => {}, a)).toMatchObject({ ok: false, status: 403 });
  });
});
